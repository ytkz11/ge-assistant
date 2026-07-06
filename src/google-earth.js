import { inflate } from 'pako'

const DEV = import.meta.env.DEV

const DBROOT_URL = DEV
  ? '/gproxy/dbroot'
  : 'https://khmdb.google.com/dbRoot.v5?&hl=en&gl=us&output=proto'

const FLATFILE_DEFAULT = DEV
  ? '/gproxy/flatfile?f1-{path}-i.{epoch}'
  : 'https://kh.google.com/flatfile?f1-{path}-i.{epoch}'

const FLATFILE_TM = DEV
  ? '/gproxy/flatfile?db=tm&f1-{path}-i.{epoch}-{dateHex}'
  : 'https://khmdb.google.com/flatfile?db=tm&f1-{path}-i.{epoch}-{dateHex}'

const QUADTREE_PACKET = DEV
  ? '/gproxy/flatfile?q2-{path}-q.{epoch}'
  : 'https://kh.google.com/flatfile?q2-{path}-q.{epoch}'

let encryptionKey = null
let rootEpoch = 0
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
  } else if (wireType === 5) {
    return { fieldNumber, wireType, value: null, bytesRead: tag.bytesRead + 4 }
  } else if (wireType === 1) {
    return { fieldNumber, wireType, value: null, bytesRead: tag.bytesRead + 8 }
  }
  return null
}

function skipField(buf, pos) {
  if (pos >= buf.length) return pos
  const tag = decodeVarint(buf, pos)
  if (tag.bytesRead === 0) return pos
  const wireType = tag.value & 0x07
  pos += tag.bytesRead

  if (wireType === 0) {
    const val = decodeVarint(buf, pos)
    return pos + val.bytesRead
  } else if (wireType === 2) {
    const len = decodeVarint(buf, pos)
    return pos + len.bytesRead + len.value
  } else if (wireType === 5) {
    return pos + 4
  } else if (wireType === 1) {
    return pos + 8
  }
  return pos
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
      if (field.fieldNumber === 1) encryptionData = field.value
      else if (field.fieldNumber === 2) dbrootData = field.value
    }
  }

  return { encryptionData, dbrootData }
}

function parseDbRootProto(bytes) {
  let pos = 0

  while (pos < bytes.length) {
    const field = readField(bytes, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 2) {
      const subPos = 0
      let subField = readField(field.value, subPos)
      if (subField && subField.wireType === 0) {
        rootEpoch = subField.value
        return
      }
    }

    if (field.wireType === 2) {
      let subPos = 0
      while (subPos < field.value.length) {
        const subField = readField(field.value, subPos)
        if (!subField) break
        subPos += subField.bytesRead
        if (subField.fieldNumber === 1 && subField.wireType === 0 && subField.value > 1000) {
          rootEpoch = subField.value
          return
        }
      }
    }
  }

  rootEpoch = 1
}

export async function fetchDbRoot() {
  if (encryptionKey) return { encryptionKey, rootEpoch }

  const resp = await fetch(DBROOT_URL, { referrerPolicy: 'no-referrer' })
  if (!resp.ok) throw new Error(`dbRoot fetch failed: ${resp.status}`)
  const buf = await resp.arrayBuffer()
  const bytes = new Uint8Array(buf)

  const outer = parseEncryptedDbRoot(bytes)
  if (!outer.encryptionData || !outer.dbrootData) {
    throw new Error('Failed to parse dbRoot protobuf')
  }

  encryptionKey = outer.encryptionData
  const decrypted = xorEncode(encryptionKey, outer.dbrootData)
  const decompressed = inflate(decrypted)
  parseDbRootProto(decompressed)

  return { encryptionKey, rootEpoch }
}

function tileToQuadTreePath(z, x, y) {
  let path = '0'
  for (let i = z - 1; i >= 0; i--) {
    const row = (y >> i) & 1
    const col = (x >> i) & 1
    if (row === 0) {
      path += col === 0 ? '0' : '1'
    } else {
      path += col === 0 ? '3' : '2'
    }
  }
  return path
}

function latLngToQuadTree(lat, lng, level) {
  const n = Math.pow(2, level)
  let x = Math.floor((lng + 180) / 360 * n)
  let y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)
  x = Math.min(Math.max(x, 0), n - 1)
  y = Math.min(Math.max(y, 0), n - 1)
  return tileToQuadTreePath(level, x, y)
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
  let sharedTileDate = 0

  while (pos < buf.length) {
    const field = readField(buf, pos)
    if (!field) break
    pos += field.bytesRead

    if (field.fieldNumber === 1 && field.wireType === 2) {
      datedTiles.push(decodeDatedTile(field.value))
    } else if (field.fieldNumber === 2 && field.wireType === 0) {
      sharedTileDate = field.value
    }
  }

  return { datedTiles, sharedTileDate }
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
    } else if (field.fieldNumber === 2 && field.wireType === 2) {
      sparseNodes.push(decodeSparseNode(field.value))
    }
  }

  return { packetEpoch, sparseNodes }
}

async function fetchAndDecrypt(url) {
  if (!encryptionKey) await fetchDbRoot()

  const resp = await fetch(url, { referrerPolicy: 'no-referrer' })
  if (!resp.ok) return null

  let buf = await resp.arrayBuffer()
  let bytes = new Uint8Array(buf)

  bytes = xorEncode(encryptionKey, bytes)

  try {
    return inflate(bytes)
  } catch {
    return bytes
  }
}

async function getQuadtreePacket(path, epoch) {
  const cacheKey = `${path}:${epoch}`
  if (packetCache.has(cacheKey)) return packetCache.get(cacheKey)

  const url = QUADTREE_PACKET.replace('{path}', path).replace('{epoch}', epoch)
  const data = await fetchAndDecrypt(url)
  if (!data) return null

  try {
    const packet = decodeQuadtreePacket(data)
    packetCache.set(cacheKey, packet)
    return packet
  } catch {
    return null
  }
}

async function traverseToLeaf(z, x, y) {
  await fetchDbRoot()

  let currentPacket = await getQuadtreePacket('0', rootEpoch)
  if (!currentPacket) return null

  let currentNode = null

  for (let level = 0; level < z; level++) {
    const bit = z - 1 - level
    const row = (y >> bit) & 1
    const col = (x >> bit) & 1
    let childIndex
    if (row === 0) {
      childIndex = col === 0 ? 0 : 1
    } else {
      childIndex = col === 0 ? 3 : 2
    }

    const sparseNode = currentPacket.sparseNodes.find(n => n.index === childIndex)
    if (!sparseNode || !sparseNode.node) break

    currentNode = sparseNode.node

    if (currentNode.cacheNodeEpoch === 0) break

    const childPath = tileToQuadTreePath(level + 1, x >> (z - 1 - level), y >> (z - 1 - level))
    currentPacket = await getQuadtreePacket(childPath, currentNode.cacheNodeEpoch)
    if (!currentPacket) break
  }

  return currentNode
}

export async function getTileEpochAndDate(z, x, y, targetDate) {
  const node = await traverseToLeaf(z, x, y)
  if (!node) return null

  const historyLayer = node.layers.find(l => l.type === 3)
  if (!historyLayer || !historyLayer.datesLayer) {
    const imageryLayer = node.layers.find(l => l.type === 0)
    if (imageryLayer) {
      return { epoch: imageryLayer.layerEpoch, dateHex: null, provider: 0 }
    }
    return null
  }

  const { datedTiles, sharedTileDate } = historyLayer.datesLayer

  if (targetDate) {
    for (const dt of datedTiles) {
      const dateStr = jpegCommentDateToDate(dt.date)
      if (dateStr === targetDate) {
        return { epoch: dt.datedTileEpoch, dateHex: dt.date.toString(16), provider: dt.provider }
      }
    }
  }

  if (datedTiles.length > 0) {
    const dt = datedTiles[datedTiles.length - 1]
    const dateStr = jpegCommentDateToDate(dt.date)
    return { epoch: dt.datedTileEpoch, dateHex: dt.date.toString(16), provider: dt.provider, date: dateStr }
  }

  if (sharedTileDate) {
    const dateStr = jpegCommentDateToDate(sharedTileDate)
    return { epoch: historyLayer.layerEpoch, dateHex: null, provider: 0, date: dateStr }
  }

  const imageryLayer = node.layers.find(l => l.type === 0)
  if (imageryLayer) {
    return { epoch: imageryLayer.layerEpoch, dateHex: null, provider: 0 }
  }

  return null
}

export async function getAvailableDates(z, x, y) {
  const node = await traverseToLeaf(z, x, y)
  if (!node) return []

  const historyLayer = node.layers.find(l => l.type === 3)
  if (!historyLayer || !historyLayer.datesLayer) return []

  const dates = []
  const { datedTiles, sharedTileDate } = historyLayer.datesLayer

  if (sharedTileDate) {
    const dateStr = jpegCommentDateToDate(sharedTileDate)
    if (dateStr) {
      dates.push({
        date: dateStr,
        epoch: historyLayer.layerEpoch,
        provider: 0,
        dateHex: null
      })
    }
  }

  for (const dt of datedTiles) {
    const dateStr = jpegCommentDateToDate(dt.date)
    if (!dateStr) continue
    dates.push({
      date: dateStr,
      epoch: dt.datedTileEpoch,
      provider: dt.provider,
      dateHex: dt.date.toString(16)
    })
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date))
}

export async function downloadGoogleHistoricalTile(tileZoom, x, y, epoch, dateHex) {
  if (!encryptionKey) await fetchDbRoot()

  const path = tileToQuadTreePath(tileZoom, x, y)

  if (dateHex) {
    const url = FLATFILE_TM.replace('{path}', path).replace('{epoch}', epoch).replace('{dateHex}', dateHex)
    const data = await fetchAndDecrypt(url)
    if (data) {
      try {
        return await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
      } catch {}
    }
  }

  const defaultUrl = FLATFILE_DEFAULT.replace('{path}', path).replace('{epoch}', epoch)
  const data = await fetchAndDecrypt(defaultUrl)
  if (!data) return null

  try {
    return await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
  } catch {
    return null
  }
}

export async function downloadGoogleTilePerTile(tileZoom, x, y, targetDate) {
  if (!encryptionKey) await fetchDbRoot()

  const tileInfo = await getTileEpochAndDate(tileZoom, x, y, targetDate)
  if (!tileInfo) return null

  const path = tileToQuadTreePath(tileZoom, x, y)

  if (tileInfo.dateHex) {
    const url = FLATFILE_TM.replace('{path}', path).replace('{epoch}', tileInfo.epoch).replace('{dateHex}', tileInfo.dateHex)
    const data = await fetchAndDecrypt(url)
    if (data) {
      try {
        return await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
      } catch {}
    }
  }

  if (tileInfo.epoch) {
    const defaultUrl = FLATFILE_DEFAULT.replace('{path}', path).replace('{epoch}', tileInfo.epoch)
    const data = await fetchAndDecrypt(defaultUrl)
    if (data) {
      try {
        return await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
      } catch {}
    }
  }

  return null
}

export function getGoogleTileUrl(tileZoom, x, y, epoch) {
  if (DEV) {
    return `/gproxy/kh?v=188&tx=${x},${y},${tileZoom}&n=404&ep=1&e=${epoch}`
  }
  return `https://khmdb.google.com/kh?v=188&tx=${x},${y},${tileZoom}&n=404&ep=1&e=${epoch}`
}

export { latLngToQuadTree }
