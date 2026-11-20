import { XMLParser } from 'fast-xml-parser'

const WMTS_CAPABILITIES_URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/wmts/1.0.0/wmtscapabilities.xml'

let layersRequest

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
    const resources = [layer?.['ResourceURL']].flat().filter(Boolean)
    const resourceUrlObj = resources.find(resource => resource.resourceType === 'tile') || resources[0]
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
  }).filter(l => l.date && /^https:\/\/wayback\.maptiles\.arcgis\.com\//i.test(l.resourceUrl)
    && l.tileMatrixSets.includes('GoogleMapsCompatible'))
}

export function fetchWaybackLayers() {
  layersRequest ??= (async () => {
    const response = await fetch(WMTS_CAPABILITIES_URL, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const layers = parseCapabilities(await response.text())
    if (!layers.length) throw new Error('Wayback 目录为空或格式无效')
    return layers
  })().catch(error => {
    layersRequest = undefined
    throw error
  })
  return layersRequest
}

export function getWaybackTileUrl(layer, z, x, y) {
  return layer?.resourceUrl
    ?.replace(/\{TileMatrixSet\}/gi, 'GoogleMapsCompatible')
    .replace(/\{TileMatrix\}/gi, z)
    .replace(/\{TileRow\}/gi, y)
    .replace(/\{TileCol\}/gi, x)
}

export function getWaybackDates(layers) {
  if (!layers) return []
  const dateSet = new Set()
  for (const layer of layers) {
    if (layer.date) dateSet.add(layer.date)
  }
  return Array.from(dateSet).sort().reverse()
}
