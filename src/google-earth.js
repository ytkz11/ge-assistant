import { inflate } from 'pako'

const DBROOT_URL = 'https://khmdb.google.com/dbRoot.v5?&hl=en&gl=us&output=proto'
const FLATFILE_URL = 'https://khmdb.google.com/flatfile?db=tm&f1={path}-i.{epoch}-{dateHex}'
const FLATFILE_NO_DATE = 'https://kh.google.com/flatfile?f1={path}-i.{epoch}'

let dbRootData = null
let encryptionKey = null

function xorDecrypt(key, data) {
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

function parseEncryptedDbRoot(bytes) {
  let pos = 0
  let encryptionData = null
  let dbrootData = null

  while (pos < bytes.length) {
    const tag = decodeVarint(bytes, pos)
    pos += tag.bytesRead
    const fieldNumber = tag.value >> 3
    const wireType = tag.value & 0x07

    if (wireType === 2) {
      const len = decodeVarint(bytes, pos)
      pos += len.bytesRead
      const data = bytes.slice(pos, pos + len.value)
      pos += len.value

      if (fieldNumber === 1) {
        encryptionData = data
      } else if (fieldNumber === 2) {
        dbrootData = data
      }
    } else {
      break
    }
  }

  return { encryptionData, dbrootData }
}

function parseDbRoot(bytes) {
  let pos = 0
  let dbrootVersion = 0
  let quadtrees = []

  while (pos < bytes.length) {
    const tag = decodeVarint(bytes, pos)
    pos += tag.bytesRead
    const fieldNumber = tag.value >> 3
    const wireType = tag.value & 0x07

    if (wireType === 0) {
      const val = decodeVarint(bytes, pos)
      pos += val.bytesRead
      if (fieldNumber === 1) dbrootVersion = val.value
    } else if (wireType === 2) {
      const len = decodeVarint(bytes, pos)
      pos += len.bytesRead
      pos += len.value
    } else {
      break
    }
  }

  return { dbrootVersion }
}

async function fetchDbRoot() {
  if (dbRootData) return dbRootData

  const resp = await fetch(DBROOT_URL, { referrerPolicy: 'no-referrer' })
  const buf = await resp.arrayBuffer()
  const bytes = new Uint8Array(buf)

  const encrypted = parseEncryptedDbRoot(bytes)
  if (!encrypted.encryptionData || !encrypted.dbrootData) {
    throw new Error('Failed to parse dbRoot protobuf')
  }

  encryptionKey = encrypted.encryptionData
  const decrypted = xorDecrypt(encryptionKey, encrypted.dbrootData)
  const decompressed = inflate(decrypted)

  dbRootData = { version: parseDbRoot(decompressed).dbrootVersion }
  return dbRootData
}

function latLngToQuadTree(lat, lng, level) {
  const n = Math.pow(2, level)
  let x = Math.floor((lng + 180) / 360 * n)
  let y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)

  x = Math.min(Math.max(x, 0), n - 1)
  y = Math.min(Math.max(y, 0), n - 1)

  let path = '0'
  for (let i = level - 1; i >= 0; i--) {
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

function dateToHex(dateStr) {
  const parts = dateStr.split('-')
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
  const ms = d.getTime()
  const days = Math.floor(ms / 86400000) + 719468
  return days.toString(16)
}

export function getGoogleHistoricalTileUrl(path, epoch, dateStr) {
  if (dateStr) {
    return FLATFILE_URL.replace('{path}', path).replace('{epoch}', epoch).replace('{dateHex}', dateToHex(dateStr))
  }
  return FLATFILE_NO_DATE.replace('{path}', path).replace('{epoch}', epoch)
}

export async function downloadGoogleHistoricalTile(path, epoch, dateStr) {
  const url = getGoogleHistoricalTileUrl(path, epoch, dateStr)
  try {
    const resp = await fetch(url, { referrerPolicy: 'no-referrer' })
    if (!resp.ok) return null
    const buf = await resp.arrayBuffer()
    const encrypted = new Uint8Array(buf)
    if (!encryptionKey) await fetchDbRoot()
    const decrypted = xorDecrypt(encryptionKey, encrypted)
    const blob = new Blob([decrypted], { type: 'image/jpeg' })
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

export function getGoogleTileQuadTree(x, y, z) {
  return latLngToQuadTree(0, 0, 0) // placeholder
}

export { latLngToQuadTree, fetchDbRoot }
