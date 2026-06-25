<template>
  <div class="map-container">
    <div ref="mapEl" class="map"></div>
    <div
      v-if="selectionActive"
      class="selection-overlay"
      @mousedown.prevent="onMouseDown"
      @mousemove.prevent="onMouseMove"
      @mouseup.prevent="onMouseUp"
    ></div>
    <div v-if="selRect" class="selection-rect" :class="{ done: selectionDone }" :style="selStyle"></div>
    <div v-if="selectionActive && !selectionDone" class="selection-hint">在地图上拖拽框选区域</div>
    <div class="map-info">
      <span>Lat: {{ center.lat.toFixed(4) }}</span>
      <span>Lng: {{ center.lng.toFixed(4) }}</span>
      <span>Zoom: {{ zoom }}</span>
    </div>
    <div v-if="selectedDate" class="map-date-badge">{{ selectedDate }}</div>
    <div v-if="imageryDates.length > 0" class="tile-count">{{ imageryDates.length }} images available</div>
    <div v-if="downloading" class="download-progress">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div></div>
      <div class="progress-text">下载中... {{ downloadCurrent }}/{{ downloadTotal }} 瓦片</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import L from 'leaflet'
import { writeArrayBuffer } from 'geotiff'
import { getWaybackTileUrl, latLngToTile, tileLatLngBounds } from '../esri-wayback'
import { fetchDbRoot, latLngToQuadTree, downloadGoogleHistoricalTile } from '../google-earth'

const props = defineProps({
  selectedDate: { type: String, default: null },
  imageryDates: { type: Array, default: () => [] },
  showLabels: { type: Boolean, default: false },
  selectionMode: { type: Boolean, default: false },
  provider: { type: String, default: 'google' },
  waybackLayers: { type: Array, default: () => [] }
})

const emit = defineEmits(['center-change', 'selection-complete'])

const mapEl = ref(null)
let map = null
let satLayer = null
let historicalLayer = null
let labelsLayer = null

const center = ref({ lat: 39.9042, lng: 116.4074 })
const zoom = ref(5)

const downloading = ref(false)
const downloadProgress = ref(0)
const downloadCurrent = ref(0)
const downloadTotal = ref(0)

const selectionActive = ref(false)
const selectionDone = ref(false)
let isDragging = false
let dragStartPx = null
const selRect = ref(null)
const selBounds = ref(null)

const selStyle = computed(() => {
  if (!selRect.value) return {}
  const r = selRect.value
  return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }
})

const GOOGLE_SAT = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
const LABELS_URL = 'https://webrd{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

function createGoogleHistoricalLayer(date, epoch) {
  const proto = location.protocol === 'https:' ? 'https' : 'http'
  return L.tileLayer(`${proto}://khmdb.google.com/kh?v=188&tx={x},{y},{z}&n=404&ep=1&e=${epoch}`, { maxZoom: 21, opacity: 1.0 })
}

function createWaybackLayer(layer) {
  if (!layer || !layer.resourceUrl) return null
  const layerIdMatch = layer.resourceUrl.match(/\/tile\/(\d+)\//)
  const layerId = layerIdMatch ? layerIdMatch[1] : null
  if (!layerId) return null
  return L.tileLayer(
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/${layerId}/{z}/{y}/{x}`,
    { maxZoom: 20, tileSize: 256, crossOrigin: true, attribution: 'Esri World Atlas Wayback' }
  )
}

function onMouseDown(e) {
  isDragging = true
  selectionDone.value = false
  dragStartPx = { x: e.clientX, y: e.clientY }
  const mapContainer = mapEl.value.getBoundingClientRect()
  selRect.value = { left: e.clientX - mapContainer.left, top: e.clientY - mapContainer.top, width: 0, height: 0 }
}

function onMouseMove(e) {
  if (!isDragging || !dragStartPx) return
  const mapContainer = mapEl.value.getBoundingClientRect()
  const x = Math.min(dragStartPx.x, e.clientX) - mapContainer.left
  const y = Math.min(dragStartPx.y, e.clientY) - mapContainer.top
  const w = Math.abs(e.clientX - dragStartPx.x)
  const h = Math.abs(e.clientY - dragStartPx.y)
  selRect.value = { left: x, top: y, width: w, height: h }
}

function onMouseUp(e) {
  if (!isDragging) return
  isDragging = false
  if (!selRect.value || selRect.value.width < 5 || selRect.value.height < 5) {
    selRect.value = null
    return
  }
  const topLeft = map.containerPointToLatLng(L.point(selRect.value.left, selRect.value.top))
  const bottomRight = map.containerPointToLatLng(L.point(selRect.value.left + selRect.value.width, selRect.value.top + selRect.value.height))
  selBounds.value = { north: topLeft.lat, south: bottomRight.lat, west: topLeft.lng, east: bottomRight.lng }
  selectionDone.value = true
  emit('selection-complete', selBounds.value)
}

function clearSelection() {
  selRect.value = null
  selBounds.value = null
  selectionDone.value = false
}

function updateSelRectFromBounds() {
  if (!map || !selBounds.value) return
  const b = selBounds.value
  const nw = map.latLngToContainerPoint(L.latLng(b.north, b.west))
  const se = map.latLngToContainerPoint(L.latLng(b.south, b.east))
  selRect.value = {
    left: Math.min(nw.x, se.x),
    top: Math.min(nw.y, se.y),
    width: Math.abs(se.x - nw.x),
    height: Math.abs(se.y - nw.y)
  }
}

async function loadTileImage(url) {
  try {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' })
    if (!response.ok) return null
    const blob = await response.blob()
    return await createImageBitmap(blob)
  } catch (e) {
    return null
  }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function getTileUrl(provider, selectedDate, waybackLayers, tileZoom, x, y) {
  if (provider === 'wayback' && selectedDate && waybackLayers.length > 0) {
    const layer = waybackLayers.find(l => l.date === selectedDate)
    if (layer) return getWaybackTileUrl(layer, tileZoom, x, y)
  }
  if (provider === 'google') {
    const subdomain = ['0', '1', '2', '3'][Math.floor(Math.random() * 4)]
    return `https://mt${subdomain}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${tileZoom}`
  }
  return null
}

async function loadGoogleHistoricalTile(tileZoom, x, y) {
  try {
    await fetchDbRoot()
    const bounds = tileLatLngBounds(x, y, tileZoom)
    const lat = (bounds.north + bounds.south) / 2
    const lng = (bounds.east + bounds.west) / 2
    const path = latLngToQuadTree(lat, lng, tileZoom)
    const entry = props.imageryDates.find(d => d.date === props.selectedDate)
    const epoch = entry ? entry.epoch : 0
    return await downloadGoogleHistoricalTile(path, epoch, props.selectedDate)
  } catch (e) {
    console.warn('Google historical tile failed, falling back:', e)
    return null
  }
}

async function downloadTiles(bounds, tileZoom, format) {
  console.log('downloadTiles called:', { provider: props.provider, selectedDate: props.selectedDate, waybackLayersCount: props.waybackLayers.length, bounds, tileZoom, format })

  const tileNE = latLngToTile(bounds.north, bounds.east, tileZoom)
  const tileSW = latLngToTile(bounds.south, bounds.west, tileZoom)
  const tileSize = 256
  const tilesX = tileNE.x - tileSW.x + 1
  const tilesY = tileSW.y - tileNE.y + 1
  const totalTiles = tilesX * tilesY

  downloading.value = true
  downloadProgress.value = 0
  downloadCurrent.value = 0
  downloadTotal.value = totalTiles

  const canvas = document.createElement('canvas')
  canvas.width = tilesX * tileSize
  canvas.height = tilesY * tileSize
  const ctx = canvas.getContext('2d')

  const batchSize = 4
  let loaded = 0

  for (let ty = tileNE.y; ty <= tileSW.y; ty++) {
    for (let tx = tileSW.x; tx <= tileNE.x; tx += batchSize) {
      const batch = []
      const batchEnd = Math.min(tx + batchSize, tileNE.x + 1)

      for (let bx = tx; bx < batchEnd; bx++) {
        const px = (bx - tileSW.x) * tileSize
        const py = (ty - tileNE.y) * tileSize

        if (props.provider === 'google' && props.selectedDate) {
          batch.push({ px, py, useGoogle: true, z: tileZoom, x: bx, y: ty })
        } else {
          const url = getTileUrl(props.provider, props.selectedDate, props.waybackLayers, tileZoom, bx, ty)
          if (url) batch.push({ url, px, py })
        }
      }

      const images = await Promise.all(batch.map(b => {
        if (b.useGoogle) return loadGoogleHistoricalTile(b.z, b.x, b.y)
        return loadTileImage(b.url)
      }))

      for (let i = 0; i < images.length; i++) {
        if (images[i]) {
          ctx.drawImage(images[i], batch[i].px, batch[i].py, tileSize, tileSize)
        }
        loaded++
        downloadCurrent.value = loaded
        downloadProgress.value = Math.round((loaded / totalTiles) * 100)
      }
      await delay(10)
    }
  }

  if (format === 'tif') {
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const values = new Uint8Array(imageData.data.buffer)
      const swBounds = tileLatLngBounds(tileSW.x, tileSW.y, tileZoom)
      const neBounds = tileLatLngBounds(tileNE.x, tileNE.y, tileZoom)
      const metadata = {
        height: canvas.height, width: canvas.width,
        ModelTiepoint: [0, 0, 0, swBounds.west, neBounds.north, 0],
        ModelPixelScale: [(neBounds.east - swBounds.west) / canvas.width, Math.abs((neBounds.north - swBounds.south) / canvas.height), 0],
        SampleFormat: [1, 1, 1, 1], BitsPerSample: [8, 8, 8, 8],
        PhotometricInterpretation: 2, Compression: 1,
        StripByteCounts: [canvas.width * canvas.height * 4], RowsPerStrip: canvas.height,
      }
      const arrayBuffer = await writeArrayBuffer(values, metadata)
      downloadBlob(new Blob([arrayBuffer], { type: 'image/tiff' }), `satellite_${props.selectedDate || 'area'}_z${tileZoom}.tif`)
    } catch (e) {
      console.error('TIF export failed, falling back to PNG:', e)
      canvas.toBlob(blob => downloadBlob(blob, `satellite_${props.selectedDate || 'area'}_z${tileZoom}.png`), 'image/png')
    }
  } else {
    canvas.toBlob(blob => downloadBlob(blob, `satellite_${props.selectedDate || 'area'}_z${tileZoom}.png`), 'image/png')
  }
  downloading.value = false
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  await nextTick()
  map = L.map(mapEl.value, { center: [39.9042, 116.4074], zoom: 5, zoomControl: true, attributionControl: false })
  L.control.attribution({ prefix: false }).addTo(map)

  satLayer = L.tileLayer(GOOGLE_SAT, { maxZoom: 21, subdomains: ['0', '1', '2', '3'], crossOrigin: true, attribution: 'Google Satellite' }).addTo(map)
  labelsLayer = L.tileLayer(LABELS_URL, { maxZoom: 18, subdomains: ['1', '2', '3', '4'], crossOrigin: true, attribution: 'AutoNavi' })
  if (props.showLabels) labelsLayer.addTo(map)

  const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' })
  L.control.layers({ 'Google Satellite': satLayer, 'OpenStreetMap': osmLayer }, {}, { collapsed: false }).addTo(map)

  map.on('moveend', () => { center.value = { lat: map.getCenter().lat, lng: map.getCenter().lng }; zoom.value = map.getZoom(); emit('center-change', center.value); updateSelRectFromBounds() })
  map.on('zoomend', () => { zoom.value = map.getZoom(); updateSelRectFromBounds() })

  center.value = { lat: map.getCenter().lat, lng: map.getCenter().lng }
  zoom.value = map.getZoom()
  emit('center-change', center.value)
})

watch(() => props.selectionMode, (active) => {
  selectionActive.value = active
  if (active) {
    clearSelection()
    if (map) { map.dragging.disable(); map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair' }
  } else {
    if (map) { map.dragging.enable(); map.doubleClickZoom.enable(); map.getContainer().style.cursor = '' }
  }
})

watch(() => props.selectedDate, (newDate) => {
  if (!map) return
  if (historicalLayer) { map.removeLayer(historicalLayer); historicalLayer = null }
  if (!newDate) return

  if (props.provider === 'wayback' && props.waybackLayers.length > 0) {
    const layer = props.waybackLayers.find(l => l.date === newDate)
    if (layer) { historicalLayer = createWaybackLayer(layer); if (historicalLayer) historicalLayer.addTo(map) }
  } else if (props.provider === 'google' && props.imageryDates.length > 0) {
    const entry = props.imageryDates.find(d => d.date === newDate)
    if (entry) { historicalLayer = createGoogleHistoricalLayer(newDate, entry.epoch); historicalLayer.addTo(map) }
  }
})

watch(() => props.showLabels, (show) => {
  if (!map) return
  if (show) labelsLayer.addTo(map); else map.removeLayer(labelsLayer)
})

defineExpose({ downloadTiles, clearSelection })
</script>

<style scoped>
.map-container { flex: 1; height: 100vh; position: relative; }
.map { width: 100%; height: 100%; }

.selection-overlay {
  position: absolute;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
}

.selection-rect {
  position: absolute;
  border: 3px solid #00aaff;
  background: rgba(0, 170, 255, 0.2);
  pointer-events: none;
  z-index: 10000;
}

.selection-rect.done {
  border-color: #34c759;
  background: rgba(52, 199, 89, 0.2);
}

.selection-hint {
  position: absolute;
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 10001;
  background: rgba(0, 0, 0, 0.8);
  color: #ffc107;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px; font-weight: 600;
  pointer-events: none;
}

.map-info { position: absolute; bottom: 12px; left: 12px; z-index: 1000; background: rgba(0,0,0,0.75); color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; display: flex; gap: 16px; font-family: monospace; }
.map-date-badge { position: absolute; top: 12px; right: 12px; z-index: 1000; background: rgba(0,120,255,0.9); color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 16px; font-weight: 600; font-family: monospace; }
.tile-count { position: absolute; top: 12px; left: 12px; z-index: 1000; background: rgba(0,0,0,0.65); color: #aaa; padding: 6px 12px; border-radius: 6px; font-size: 11px; }

.download-progress { position: absolute; bottom: 50px; left: 50%; transform: translateX(-50%); z-index: 1001; background: rgba(0,0,0,0.9); padding: 12px 20px; border-radius: 8px; min-width: 200px; max-width: 90vw; }
.progress-bar { width: 100%; height: 6px; background: #333; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #00aaff, #34c759); border-radius: 3px; transition: width 0.1s; }
.progress-text { color: #ccc; font-size: 12px; text-align: center; }

@media (max-width: 768px) {
  .map-info {
    bottom: 8px;
    left: 8px;
    gap: 8px;
    font-size: 10px;
    padding: 4px 8px;
  }
  .map-date-badge {
    top: 8px;
    right: 8px;
    font-size: 13px;
    padding: 6px 12px;
  }
  .tile-count {
    top: 8px;
    left: 8px;
    font-size: 10px;
    padding: 4px 8px;
  }
  .selection-hint {
    font-size: 12px;
    padding: 8px 14px;
  }
}
</style>
