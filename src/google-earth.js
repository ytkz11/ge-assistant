const DEV = import.meta.env.DEV

export function getGoogleTileUrl(tileZoom, x, y, epoch) {
  if (DEV) {
    return `/gproxy/kh?v=188&tx=${x},${y},${tileZoom}&n=404&ep=1&e=${epoch}`
  }
  return `https://khmdb.google.com/kh?v=188&tx=${x},${y},${tileZoom}&n=404&ep=1&e=${epoch}`
}

export async function downloadGoogleHistoricalTile(tileZoom, x, y, epoch) {
  const url = getGoogleTileUrl(tileZoom, x, y, epoch)
  try {
    const resp = await fetch(url, { referrerPolicy: 'no-referrer' })
    if (!resp.ok) return null
    const blob = await resp.blob()
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}
