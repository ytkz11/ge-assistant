import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import { geoTiffMetadata, getExportGrid, latLngToEarthTile, latLngToTile, selectDatedTile } from '../src/imagery-grid.js'
import { packetIndex, tileToQuadTreePath } from '../src/google-earth.js'
import { fetchWaybackLayers, getWaybackDates, getWaybackTileUrl } from '../src/esri-wayback.js'

test('tile indices stay in range at the poles and wrap at the antimeridian', () => {
  assert.deepEqual(latLngToTile(90, 180, 2), { x: 0, y: 0 })
  assert.deepEqual(latLngToTile(-90, -181, 2), { x: 3, y: 3 })
})

test('export grid crosses the antimeridian and caps canvas size', () => {
  const grid = getExportGrid({ west: 179, east: 181, north: 1, south: 0 }, 4)
  assert.equal(grid.left, 15)
  assert.equal(grid.right, 16)
  assert.equal(grid.width, 512)
  assert.equal(getExportGrid({ west: 170, east: 180, north: 20, south: 10 }, 20).canExport, false)
  assert.equal(getExportGrid({ west: 170, east: 165, north: 20, south: 10 }, 4), null)
})

test('GeoTIFF round-trips Web Mercator coordinates and unassociated alpha', async () => {
  const grid = getExportGrid({ west: 116, east: 117, north: 21, south: 20 }, 4)
  const rgba = new Uint8Array(grid.width * grid.height * 4)
  rgba.set([10, 20, 30, 127])
  const tiff = await fromArrayBuffer(writeArrayBuffer(rgba, geoTiffMetadata(grid)))
  const image = await tiff.getImage()
  assert.equal(image.getGeoKeys().ProjectedCSTypeGeoKey, 3857)
  assert.deepEqual(image.getOrigin(), [grid.west, grid.north, 0])
  assert.deepEqual(image.getResolution(), [grid.scale, -grid.scale, 0])
  assert.deepEqual([...image.getFileDirectory().getValue('ExtraSamples')], [2])
  assert.deepEqual([...await image.readRasters({ window: [0, 0, 1, 1], interleave: true })], [10, 20, 30, 127])
})

test('date matching is exact by default and resolves nearer dates deterministically', () => {
  const newer = { date: '2020-01-03' }
  const older = { date: '2020-01-01' }
  assert.equal(selectDatedTile([newer, older], newer.date), newer)
  assert.equal(selectDatedTile([newer, older], '2020-01-02'), undefined)
  assert.equal(selectDatedTile([newer, older], '2020-01-02', true), older)
  assert.equal(selectDatedTile([newer, older], '2020-01-08', true), newer)
})

test('Wayback catalog retries failure, shares requests and uses the WMTS template', async () => {
  const originalFetch = globalThis.fetch
  const resource = 'https://wayback.maptiles.arcgis.com/wmts/{TileMatrixSet}/tile/123/{TileMatrix}/{TileRow}/{TileCol}'
  let requests = 0
  globalThis.fetch = async () => {
    if (++requests === 1) return new Response('', { status: 503 })
    return new Response(`<Capabilities><Contents><Layer>
      <ows:Title>World Imagery (Wayback 2024-05-01)</ows:Title>
      <TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL template="${resource}" resourceType="tile" />
    </Layer></Contents></Capabilities>`)
  }
  try {
    await assert.rejects(fetchWaybackLayers(), /503/)
    const pending = fetchWaybackLayers()
    assert.equal(fetchWaybackLayers(), pending)
    const layers = await pending
    assert.equal(requests, 2)
    assert.deepEqual(getWaybackDates(layers), ['2024-05-01'])
    assert.equal(getWaybackTileUrl(layers[0], 5, 10, 8), 'https://wayback.maptiles.arcgis.com/wmts/GoogleMapsCompatible/tile/123/5/8/10')
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('Google Earth uses the native geographic grid and Keyhole packet indices', () => {
  const { x, y } = latLngToEarthTile(39.630575, -104.841299, 21)
  const path = tileToQuadTreePath(21, x, y)
  assert.equal(path, '0301232010121332030111')
  assert.equal(packetIndex(path.slice(0, 4)), 70)
  assert.equal(packetIndex(path.slice(0, 8)), 248)
  assert.equal(packetIndex(path), 88)

  const grid = getExportGrid({ west: 0, east: 45, north: 45, south: 0 }, 3, 'google')
  assert.deepEqual([grid.width, grid.height, grid.west, grid.north], [256, 256, 0, 45])
  const metadata = geoTiffMetadata(grid)
  assert.equal(metadata.GeographicTypeGeoKey, 4326)
  assert.equal(metadata.GTModelTypeGeoKey, 2)
  assert.deepEqual(metadata.ModelPixelScale, [45 / 256, 45 / 256, 0])
})
