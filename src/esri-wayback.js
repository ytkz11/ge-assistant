import { XMLParser } from 'fast-xml-parser'

const WMTS_CAPABILITIES_URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/wmts/1.0.0/wmtscapabilities.xml'

let cachedLayers = null

function parseCapabilities(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    isArray: (name) => {
      if (name === 'Layer') return true
      if (name === 'TileMatrixSetLink') return true
      return false
    }
  })
  const result = parser.parse(xmlText)

  const contents = result?.['Capabilities']?.['Contents']
  if (!contents) return []

  const rawLayers = contents['Layer']
  if (!rawLayers) return []

  const layerArray = Array.isArray(rawLayers) ? rawLayers : [rawLayers]

  return layerArray.map(layer => {
    const title = layer?.['ows:Title'] || ''
    const identifier = layer?.['ows:Identifier'] || ''
    const format = layer?.['Format'] || ''
    const resourceUrlObj = layer?.['ResourceURL']
    const resourceUrl = resourceUrlObj?.['template'] || ''

    const dateMatch = title.match(/\(Wayback (\d{4}-\d{2}-\d{2})\)/)
    const date = dateMatch ? dateMatch[1] : null

    const tileMatrixSetLinks = layer?.['TileMatrixSetLink']
    let tileMatrixSets = []
    if (Array.isArray(tileMatrixSetLinks)) {
      tileMatrixSets = tileMatrixSetLinks.map(l => l?.['TileMatrixSet']).filter(Boolean)
    } else if (tileMatrixSetLinks) {
      tileMatrixSets = [tileMatrixSetLinks['TileMatrixSet']].filter(Boolean)
    }

    return { title, identifier, format, resourceUrl, date, tileMatrixSets }
  }).filter(l => l.date && l.resourceUrl)
}

export async function fetchWaybackLayers() {
  if (cachedLayers) return cachedLayers

  try {
    const resp = await fetch(WMTS_CAPABILITIES_URL)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const xmlText = await resp.text()
    cachedLayers = parseCapabilities(xmlText)
    return cachedLayers
  } catch (e) {
    console.error('Failed to fetch Wayback capabilities:', e)
    return []
  }
}

export function getWaybackTileUrl(layer, z, x, y) {
  if (!layer || !layer.resourceUrl) return null
  const layerIdMatch = layer.resourceUrl.match(/\/tile\/(\d+)\//)
  const layerId = layerIdMatch ? layerIdMatch[1] : null
  if (!layerId) return null
  return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/${layerId}/${z}/${y}/${x}`
}

export function getWaybackDates(layers) {
  if (!layers) return []
  const dateSet = new Set()
  for (const layer of layers) {
    if (layer.date) dateSet.add(layer.date)
  }
  return Array.from(dateSet).sort().reverse()
}

export function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom)
  const x = Math.floor((lng + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x, y }
}

export function tileLatLngBounds(tx, ty, zoom) {
  const n = Math.pow(2, zoom)
  const lonMin = tx / n * 360 - 180
  const lonMax = (tx + 1) / n * 360 - 180
  const latMinRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + 1) / n)))
  const latMaxRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n)))
  return {
    west: lonMin,
    east: lonMax,
    south: latMinRad * 180 / Math.PI,
    north: latMaxRad * 180 / Math.PI
  }
}
