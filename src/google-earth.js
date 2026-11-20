import { selectDatedTile } from './imagery-grid.js'
import { inflate } from 'pako'

const DEV = import.meta.env?.DEV

const DBROOT_URL = DEV
  ? '/gproxy/dbroot'
  : 'https://khmdb.google.com/dbRoot.v5?db=tm&hl=en&gl=us&output=proto'

const FLATFILE_DEFAULT = DEV
  ? '/gproxy/earth-default?f1-{path}-i.{epoch}'
  : 'https://kh.google.com/flatfile?f1-{path}-i.{epoch}'

const FLATFILE_TM = DEV
  ? '/gproxy/flatfile?db=tm&f1-{path}-i.{epoch}-{dateHex}'
  : 'https://khmdb.google.com/flatfile?db=tm&f1-{path}-i.{epoch}-{dateHex}'

const QUADTREE_PACKET = DEV
  ? '/gproxy/flatfile?db=tm&qp-{path}-q.{epoch}'
  : 'https://khmdb.google.com/flatfile?db=tm&qp-{path}-q.{epoch}'

let encryptionKey = null
let rootEpoch = 0
let rootRequest
const packetCache = new Map()

function xorEncode(key, data) {
  const result = new Uint8Array(data)
  let off = 16
  for (let j = 0; j < result.length; j++) {
    result[j] ^= key[off]
    off++
    if ((off & 7) === 0) off += 16
    if (off >= key.length) off = (off + 8) % 24
  }
  return result
}

function decodeVarint(buf, offset) {
  let result = 0
  let shift = 0
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos]
    result |= (byte & 0x7f) << shift
    pos++
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value: result, bytesRead: pos - offset }
}

function readField(buf, pos) {
  if (pos >= buf.length) return null
  const tag = decodeVarint(buf, pos)
  if (tag.bytesRead === 0) return null
  const fieldNumber = tag.value >> 3
  const wireType = tag.value & 0x07
  pos += tag.bytesRead

  if (wireType === 0) {
    const val = decodeVarint(buf, pos)
    return { fieldNumber, wireType, value: val.value, bytesRead: tag.bytesRead + val.bytesRead }
  } else if (wireType === 2) {
    const len = decodeVarint(buf, pos)
    const data = buf.slice(pos + len.bytesRead, pos + len.bytesRead + len.value)
    return { fieldNumber, wireType, value: data, bytesRead: tag.bytesRead + len.bytesRead + len.value }
  } else if (wireType === 3) {
    const start = pos
    while (pos < buf.length) {
      const field = readField(buf, pos)
      if (!field) break
      if (field.wireType === 4) {
        if (field.fieldNumber !== fieldNumber) break
        return { fieldNumber, wireType, value: buf.subarray(start, pos), bytesRead: pos - start + tag.bytesRead + field.bytesRead }
      }
      pos += field.bytesRead
    }
    throw new Error('Invalid Google Earth protobuf group')
  } else if (wireType === 4) {
    return { fieldNumber, wireType, bytesRead: tag.bytesRead }
  } else if (wireType === 5) {
    return { fieldNumber, wireType, value: null, bytesRead: tag.bytesRead + 4 }
  } else if (wireType === 1) {
    return { fieldNumber, wireType, value: null, bytesRead: tag.bytesRead + 8 }
  }
  return null
}

function parseEncryptedDbRoot(bytes) {
  let pos = 0
  let encryptionData = null
  let dbrootData = null

  while (pos < bytes.length) {
    const field = readField(bytes, pos)
    if (!field) break
    pos += field.bytesRead
    if (field.wireType === 2) {
      if (field.fieldNumber === 2) encryptionData = field.value
      else if (field.fieldNumber === 3) dbrootData = field.value
    }
  }

  return { encryptionData, dbrootData }
}

function decompressPacket(bytes) {
  if (bytes.length < 8) throw new Error('Truncated Google Earth packet')
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = header.getUint32(0, true)
  if (magic !== 0x7468dead && magic !== 0xadde6874) {
    throw new Error('Invalid Google Earth packet header')
  }
  const payload = inflate(bytes.subarray(8))
  if (payload.length !== header.getUint32(4, magic === 0x7468dead)) {
    throw new Error('Invalid Google Earth packet size')
  }
  return payload
}

function readRootEpoch(bytes) {
  for (let pos = 0; pos < bytes.length;) {
    const field = readField(bytes, pos)
    if (!field) break
    pos += field.bytesRead
    if (field.fieldNumber !== 13 || field.wireType !== 2) continue
    for (let offset = 0; offset < field.value.length;) {
      const version = readField(field.value, offset)
      if (!version) break
      offset += version.bytesRead
      if (version.fieldNumber === 1 && version.wireType === 0 && version.value > 0) return version.value
    }
  }
  throw new Error('Missing Google Earth quadtree version')
}

export function fetchDbRoot() {
  rootRequest ??= loadDbRoot().catch(error => {
    rootRequest = undefined
    throw error
  })
  return rootRequest
}

async function loadDbRoot() {
  const resp = await fetch(DBROOT_URL, {
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) throw new Error(`dbRoot fetch failed: ${resp.status}`)
  const buf = await resp.arrayBuffer()
  const bytes = new Uint8Array(buf)

  const outer = parseEncryptedDbRoot(bytes)
  if (!outer.encryptionData || !outer.dbrootData) {
    throw new Error('Failed to parse dbRoot protobuf')
  }

  const decrypted = xorEncode(outer.encryptionData, outer.dbrootData)
  rootEpoch = readRootEpoch(decompressPacket(decrypted))
  encryptionKey = outer.encryptionData

  return { encryptionKey, rootEpoch }
}

export function tileToQuadTreePath(z, x, y) {
  let path = '0'
  for (let bit = z - 1; bit >= 0; bit--) {
    const row = 1 - ((y >> bit) & 1)
    const col = (x >> bit) & 1
    path += (row << 1) | (row ^ col)
  }
  return path
}

export function packetIndex(path) {
  const root = path.length <= 4
  const offset = root ? 0 : Math.floor((path.length - 1) / 4) * 4
  let index = 0
  for (let i = offset + 1; i < path.length; i++) index = index * 4 + Number(path[i]) + 1
  return root ? index : index + Number(path[offset]) * 85 + 1
}

function jpegCommentDateToDate(val) {
  const year = (val >> 9) & 0x7FF
  const month = (val >> 5) & 0xf
  const day = val & 0x1f
  if (year === 0 || month === 0 || day === 0) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function decodeQuadtreeNode(buf) {
  let pos = 0
  let flags = 0
  let cacheNodeEpoch = 0
  let layers = []

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 0) {
      flags = field.value
    } else if (field.fieldNumber === 2 && field.wireType === 0) {
      cacheNodeEpoch = field.value
    } else if (field.fieldNumber === 3 && field.wireType === 2) {
      layers.push(decodeQuadtreeLayer(field.value))
    }
  }

  return { flags, cacheNodeEpoch, layers }
}

function decodeQuadtreeLayer(buf) {
  let pos = 0
  let type = 0
  let layerEpoch = 0
  let provider = 0
  let datesLayer = null

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 0) {
      type = field.value
    } else if (field.fieldNumber === 2 && field.wireType === 0) {
      layerEpoch = field.value
    } else if (field.fieldNumber === 3 && field.wireType === 0) {
      provider = field.value
    } else if (field.fieldNumber === 4 && field.wireType === 2) {
      datesLayer = decodeImageryDates(field.value)
    }
  }

  return { type, layerEpoch, provider, datesLayer }
}

function decodeImageryDates(buf) {
  let pos = 0
  let datedTiles = []

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 2) {
      datedTiles.push(decodeDatedTile(field.value))
    }
  }

  return { datedTiles }
}

function decodeDatedTile(buf) {
  let pos = 0
  let date = 0
  let datedTileEpoch = 0
  let provider = 0

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 0) {
      date = field.value
    } else if (field.fieldNumber === 2 && field.wireType === 0) {
      datedTileEpoch = field.value
    } else if (field.fieldNumber === 3 && field.wireType === 0) {
      provider = field.value
    }
  }

  return { date, datedTileEpoch, provider }
}

function decodeSparseNode(buf) {
  let pos = 0
  let index = 0
  let node = null

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 3 && field.wireType === 0) {
      index = field.value
    } else if (field.fieldNumber === 4 && field.wireType === 2) {
      node = decodeQuadtreeNode(field.value)
    }
  }

  return { index, node }
}

function decodeQuadtreePacket(buf) {
  let pos = 0
  let packetEpoch = 0
  let sparseNodes = []

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 0) {
      packetEpoch = field.value
    } else if (field.fieldNumber === 2 && field.wireType === 3) {
      sparseNodes.push(decodeSparseNode(field.value))
    }
  }

  return { packetEpoch, sparseNodes }
}

async function fetchAndDecrypt(url) {
  if (!encryptionKey) await fetchDbRoot()

  const resp = await fetch(url, {
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000)
  })
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`Google Earth HTTP ${resp.status}`)

  return xorEncode(encryptionKey, new Uint8Array(await resp.arrayBuffer()))
}

async function getQuadtreePacket(path, epoch) {
  const cacheKey = `${path}:${epoch}`
  if (packetCache.has(cacheKey)) return packetCache.get(cacheKey)

  const url = QUADTREE_PACKET.replace('{path}', path).replace('{epoch}', epoch)
  const request = fetchAndDecrypt(url)
    .then(data => data ? decodeQuadtreePacket(decompressPacket(data)) : null)
    .catch(error => {
      if (packetCache.get(cacheKey) === request) packetCache.delete(cacheKey)
      throw error
    })
  packetCache.set(cacheKey, request)
  if (packetCache.size > 256) packetCache.delete(packetCache.keys().next().value)
  const packet = await request
  if (!packet && packetCache.get(cacheKey) === request) packetCache.delete(cacheKey)
  return packet
}

async function traverseToLeaf(z, x, y) {
  await fetchDbRoot()

  const path = tileToQuadTreePath(z, x, y)
  let packet = await getQuadtreePacket('0', rootEpoch)
  if (!packet) throw new Error('Google Earth Time Machine root packet unavailable')
  for (let length = 4; length < path.length; length += 4) {
    const prefix = path.slice(0, length)
    const parent = packet.sparseNodes.find(item => item.index === packetIndex(prefix))?.node
    if (!parent?.cacheNodeEpoch) return null
    packet = await getQuadtreePacket(prefix, parent.cacheNodeEpoch)
    if (!packet) return null
  }
  return packet.sparseNodes.find(item => item.index === packetIndex(path))?.node ?? null
}

export async function getAvailableDates(z, x, y) {
  const node = await traverseToLeaf(z, x, y)
  if (!node) return []

  const historyLayer = node.layers.find(l => l.type === 3)
  if (!historyLayer || !historyLayer.datesLayer) return []

  const dates = new Map()
  const defaultLayer = node.layers.find(layer => layer.type === 0)
  for (const entry of historyLayer.datesLayer.datedTiles) {
    if (entry.date <= 545) continue
    const date = jpegCommentDateToDate(entry.date)
    const epoch = entry.provider ? entry.datedTileEpoch : defaultLayer?.layerEpoch
    if (!date || !epoch) continue
    dates.set(date, { date, epoch, dateHex: entry.provider ? entry.date.toString(16) : null })
  }
  return [...dates.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export async function downloadGoogleTilePerTile(z, x, y, targetDate, nearest = false) {
  const dates = await getAvailableDates(z, x, y)
  const path = tileToQuadTreePath(z, x, y)
  while (dates.length) {
    const tile = selectDatedTile(dates, targetDate, nearest)
    if (!tile) return null

    const template = tile.dateHex ? FLATFILE_TM : FLATFILE_DEFAULT
    const url = template.replace('{path}', path).replace('{epoch}', tile.epoch)
      .replace('{dateHex}', tile.dateHex)
    const data = await fetchAndDecrypt(url)
    if (data) {
      const image = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
      return { image, substituted: tile.date !== targetDate }
    }
    if (!nearest) return null
    dates.splice(dates.indexOf(tile), 1)
  }
  return null
}
