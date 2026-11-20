const TILE_SIZE = 256
const MAX_MERCATOR_LAT = 85.0511287798066
const HALF_WORLD_METRES = Math.PI * 6378137

export function latLngToTile(lat, lng, zoom) {
  const count = 2 ** zoom
  const radians = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI / 180
  const x = Math.floor((lng + 180) / 360 * count)
  const y = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * count)
  return {
    x: ((x % count) + count) % count,
    y: Math.max(0, Math.min(count - 1, y))
  }
}

export function latLngToEarthTile(lat, lng, zoom) {
  const count = 2 ** zoom
  const x = Math.floor((lng + 180) / 360 * count)
  const y = count - 1 - Math.floor((lat + 180) / 360 * count)
  return { x: ((x % count) + count) % count, y }
}

export function getExportGrid({ north, south, west, east }, zoom, provider = 'wayback') {
  if (![north, south, west, east].every(Number.isFinite) ||
      north <= south || east <= west || east - west > 360 ||
      !Number.isInteger(zoom) || zoom < 1 || zoom > 21) return null

  const count = 2 ** zoom
  const geographic = provider === 'google'
  if (geographic && (north > 90 || south < -90)) return null
  const top = geographic
    ? Math.floor((180 - north) / 360 * count)
    : latLngToTile(north, west, zoom).y
  const bottom = geographic
    ? Math.min(count - 1, Math.ceil((180 - south) / 360 * count) - 1)
    : latLngToTile(south, west, zoom).y
  // Keep columns unwrapped so selections crossing 180 degrees stay contiguous.
  const left = Math.floor((west + 180) / 360 * count)
  const right = Math.ceil((east + 180) / 360 * count) - 1
  const width = (right - left + 1) * TILE_SIZE
  const height = (bottom - top + 1) * TILE_SIZE
  const total = (width / TILE_SIZE) * (height / TILE_SIZE)
  const halfWorld = geographic ? 180 : HALF_WORLD_METRES
  const scale = 2 * halfWorld / (count * TILE_SIZE)
  return {
    left, right, top, bottom, width, height, total, scale,
    geographic,
    canExport: total <= 256 && width <= 8192 && height <= 8192,
    west: left * TILE_SIZE * scale - halfWorld,
    north: halfWorld - top * TILE_SIZE * scale
  }
}

export function geoTiffMetadata(grid) {
  return {
    width: grid.width,
    height: grid.height,
    ModelTiepoint: [0, 0, 0, grid.west, grid.north, 0],
    ModelPixelScale: [grid.scale, grid.scale, 0],
    GTRasterTypeGeoKey: 1,
    ...(grid.geographic
      ? { GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 }
      : { GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 3857, ProjLinearUnitsGeoKey: 9001 }),
    PhotometricInterpretation: 2,
    BitsPerSample: [8, 8, 8, 8],
    SamplesPerPixel: 4,
    ExtraSamples: [2]
  }
}

export function selectDatedTile(entries, targetDate, nearest = false) {
  const exact = entries.find(entry => entry.date === targetDate)
  if (exact || !nearest) return exact
  const target = Date.parse(targetDate)
  return entries.reduce((best, entry) => {
    const distance = Math.abs(Date.parse(entry.date) - target)
    if (!Number.isFinite(distance)) return best
    const bestDistance = best ? Math.abs(Date.parse(best.date) - target) : Infinity
    return distance < bestDistance || (distance === bestDistance && entry.date < best.date)
      ? entry
      : best
  }, undefined)
}
