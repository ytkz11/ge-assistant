<template>
  <div class="map-container">
    <div ref="mapEl" class="map"></div>
    <div
      v-if="selectionActive"
      class="selection-overlay"
      @pointerdown.prevent="onMouseDown"
      @pointermove.prevent="onMouseMove"
      @pointerup.prevent="onMouseUp"
      @pointercancel="cancelDrag"
    ></div>
    <div v-if="selRect" class="selection-rect" :class="{ done: selectionDone }" :style="selStyle"></div>
    <div v-if="selectionActive && !selectionDone" class="selection-hint">在地图上拖拽框选区域</div>
    <div class="map-info">
      <span>Lat: {{ center.lat.toFixed(4) }}</span>
      <span>Lng: {{ center.lng.toFixed(4) }}</span>
      <span>Zoom: {{ zoom }}</span>
    </div>
    <div v-if="selectedDate" class="map-date-badge">{{ selectedDate }}</div>
    <div v-if="imageryDates.length > 0" class="tile-count">{{ imageryDates.length }} {{ provider === 'wayback' ? '个发布版本' : '个影像日期' }}</div>
    <div v-if="downloading" class="download-progress">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div></div>
      <div class="progress-text">下载中... {{ downloadCurrent }}/{{ downloadTotal }} 瓦片</div>
    </div>
    <label v-if="selectedDate && provider === 'wayback'" class="history-opacity">
      历史影像不透明度
      <input v-model.number="historyOpacity" type="range" min="0" max="1" step="0.1" />
    </label>
    <div v-if="imageryDates.length > 1" class="time-slider-wrap">
      <span class="time-label">{{ sliderDate }}</span>
      <input
        type="range"
        class="time-slider"
        aria-label="历史影像日期"
        :min="0"
        :max="imageryDates.length - 1"
        :value="sliderIndex"
        @input="onSliderInput"
      />
      <span class="time-range">{{ imageryDates[imageryDates.length - 1].date }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import L from 'leaflet'
import gcoord from 'gcoord'
import { getWaybackTileUrl } from '../esri-wayback'
import { getExportGrid, geoTiffMetadata } from '../imagery-grid'
import { downloadGoogleTilePerTile } from '../google-earth'

const props = defineProps({
  selectedDate: { type: String, default: null },
  imageryDates: { type: Array, default: () => [] },
  showLabels: { type: Boolean, default: false },
  selectionMode: { type: Boolean, default: false },
  provider: { type: String, default: 'google' },
  waybackLayers: { type: Array, default: () => [] }
})

const emit = defineEmits(['center-change', 'selection-complete', 'update:selected-date'])

const mapEl = ref(null)
let map = null
let satLayer = null
let historicalLayer = null
let labelsLayer = null

const center = ref({ lat: 39.9042, lng: 116.4074 })
const zoom = ref(5)
const historyOpacity = ref(1)

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

const sliderIndex = computed({
  get() {
    if (!props.selectedDate || props.imageryDates.length === 0) return 0
    const idx = props.imageryDates.findIndex(d => d.date === props.selectedDate)
    return idx >= 0 ? idx : 0
  },
  set(val) {}
})

const sliderDate = computed(() => {
  if (props.imageryDates[sliderIndex.value]) {
    return props.imageryDates[sliderIndex.value].date
  }
  return ''
})

function onSliderInput(e) {
  const val = parseInt(e.target.value)
  if (props.imageryDates[val]) {
    emit('update:selected-date', props.imageryDates[val].date)
  }
}

const selStyle = computed(() => {
  if (!selRect.value) return {}
  const r = selRect.value
  return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }
})

const DEV = import.meta.env.DEV
const GOOGLE_SAT = DEV
  ? '/gproxy/mt{s}/vt/lyrs=s&x={x}&y={y}&z={z}'
  : 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
const GCJ02_LABELS_URL = 'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8&ltype=4'

function createLabelsLayer() {
  return L.tileLayer(GCJ02_LABELS_URL, {
    maxZoom: 21,
    maxNativeZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    crossOrigin: true,
    pane: 'labels',
    attribution: '高德标注'
  })
}

function updateLabelsOffset() {
  if (!map || !labelsLayer) return
  const center = map.getCenter()
  const [gcjLng, gcjLat] = gcoord.transform([center.lng, center.lat], gcoord.WGS84, gcoord.GCJ02)
  const wgsPt = map.latLngToContainerPoint(L.latLng(center.lat, center.lng))
  const gcjPt = map.latLngToContainerPoint(L.latLng(gcjLat, gcjLng))
  const container = labelsLayer.getContainer()
  if (container) {
    container.style.transform = `translate(${wgsPt.x - gcjPt.x}px, ${wgsPt.y - gcjPt.y}px)`
  }
}

function createWaybackLayer(layer) {
  const url = getWaybackTileUrl(layer, '{z}', '{x}', '{y}')
  return url ? L.tileLayer(url, {
    maxZoom: 21, maxNativeZoom: 20, crossOrigin: true, attribution: 'Esri World Atlas Wayback'
  }) : null
}

function onMouseDown(e) {
  if (!e.isPrimary || e.button !== 0) return
  e.currentTarget.setPointerCapture(e.pointerId)
  isDragging = true
  selectionDone.value = false
  dragStartPx = { x: e.clientX, y: e.clientY }
  const mapContainer = mapEl.value.getBoundingClientRect()
  selRect.value = { left: e.clientX - mapContainer.left, top: e.clientY - mapContainer.top, width: 0, height: 0 }
}

function onMouseMove(e) {
  if (!e.isPrimary || !isDragging || !dragStartPx) return
  const mapContainer = mapEl.value.getBoundingClientRect()
  const x = Math.min(dragStartPx.x, e.clientX) - mapContainer.left
  const y = Math.min(dragStartPx.y, e.clientY) - mapContainer.top
  const w = Math.abs(e.clientX - dragStartPx.x)
  const h = Math.abs(e.clientY - dragStartPx.y)
  selRect.value = { left: x, top: y, width: w, height: h }
}

function onMouseUp(e) {
  if (!e.isPrimary || !isDragging) return
  onMouseMove(e)
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

function cancelDrag() {
  isDragging = false
  if (!selectionDone.value) clearSelection()
}

function clearSelection() {
  isDragging = false
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
  const response = await fetch(url, {
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) return null
  return { image: await createImageBitmap(await response.blob()) }
}

async function downloadTiles({ bounds, zoom: tileZoom, format, nearest, allowMissing }) {
  if (downloading.value) throw new Error('已有下载任务')
  const { provider, selectedDate, waybackLayers } = props
  const grid = getExportGrid(bounds, tileZoom, provider)
  if (!grid?.canExport) throw new Error('选区过大或无效，请缩小选区或降低缩放级别')

  if (!selectedDate) throw new Error('请先选择历史影像日期或 Wayback 发布版本')
  const waybackLayer = waybackLayers.find(layer => layer.date === selectedDate)
  if (provider === 'wayback' && !waybackLayer) throw new Error('请先选择 Wayback 版本')

  const count = 2 ** tileZoom
  function loadTile(column, row) {
    const x = ((column % count) + count) % count
    if (provider === 'wayback') {
      return loadTileImage(getWaybackTileUrl(waybackLayer, tileZoom, x, row))
    }
    return downloadGoogleTilePerTile(tileZoom, x, row, selectedDate, nearest)
  }

  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器无法创建导出画布')

  downloading.value = true
  downloadProgress.value = 0
  downloadCurrent.value = 0
  downloadTotal.value = grid.total
  let missing = 0
  let substituted = 0
  let nextTile = 0
  const columns = grid.right - grid.left + 1

  async function worker() {
    while (nextTile < grid.total) {
      const index = nextTile++
      const x = index % columns
      const y = Math.floor(index / columns)
      try {
        const tile = await loadTile(grid.left + x, grid.top + y)
        if (tile) {
          try {
            ctx.drawImage(tile.image, x * 256, y * 256, 256, 256)
            if (tile.substituted) substituted++
          } finally {
            tile.image.close()
          }
        } else {
          missing++
        }
      } catch {
        missing++
      }
      downloadCurrent.value++
      downloadProgress.value = Math.round(downloadCurrent.value / grid.total * 100)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(4, grid.total) }, worker))
    if (missing === grid.total || (missing && !allowMissing)) {
      throw new Error(`${missing}/${grid.total} 块瓦片无法加载，未生成文件`)
    }

    let blob
    if (format === 'tif') {
      const { writeArrayBuffer } = await import('geotiff')
      const pixels = new Uint8Array(ctx.getImageData(0, 0, grid.width, grid.height).data.buffer)
      blob = new Blob([writeArrayBuffer(pixels, geoTiffMetadata(grid))], { type: 'image/tiff' })
    } else {
      blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG 编码失败')), 'image/png')
      })
    }

    const suffix = [substituted ? 'mixed' : '', missing ? 'partial' : ''].filter(Boolean).join('_')
    const filename = `satellite_${provider}_${selectedDate || 'current'}_z${tileZoom}${suffix ? '_' + suffix : ''}.${format}`
    downloadBlob(blob, filename)
    return { total: grid.total, missing, substituted }
  } finally {
    downloading.value = false
    canvas.width = canvas.height = 0
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

onMounted(async () => {
  await nextTick()
  map = L.map(mapEl.value, { center: [39.9042, 116.4074], zoom: 5, zoomControl: true, attributionControl: false })
  L.control.attribution({ prefix: false }).addTo(map)

  satLayer = L.tileLayer(GOOGLE_SAT, { maxZoom: 21, subdomains: ['0', '1', '2', '3'], crossOrigin: true, attribution: 'Google Satellite' }).addTo(map)

  map.createPane('labels').style.zIndex = '450'
  labelsLayer = createLabelsLayer()
  if (props.showLabels) { labelsLayer.addTo(map); updateLabelsOffset() }

  const osmBaseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' })
  L.control.layers(
    { 'Google Satellite': satLayer, 'OpenStreetMap': osmBaseLayer },
    { '中文地名': labelsLayer },
    { collapsed: false }
  ).addTo(map)

  map.on('moveend', () => { center.value = { lat: map.getCenter().lat, lng: map.getCenter().lng }; zoom.value = map.getZoom(); emit('center-change', { ...center.value, zoom: zoom.value }); updateSelRectFromBounds(); updateLabelsOffset() })
  map.on('zoomend', () => { zoom.value = map.getZoom(); updateSelRectFromBounds(); updateLabelsOffset() })

  center.value = { lat: map.getCenter().lat, lng: map.getCenter().lng }
  zoom.value = map.getZoom()
  emit('center-change', { ...center.value, zoom: zoom.value })
})

onBeforeUnmount(() => map?.remove())

watch(() => props.selectionMode, (active) => {
  selectionActive.value = active
  if (active) {
    clearSelection()
    if (map) { map.dragging.disable(); map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair' }
  } else {
    cancelDrag()
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
  }
  historicalLayer?.setOpacity(historyOpacity.value)
})

watch(historyOpacity, opacity => historicalLayer?.setOpacity(opacity))

watch(() => props.showLabels, (show) => {
  if (!map) return
  if (show) { labelsLayer.addTo(map); updateLabelsOffset() } else { map.removeLayer(labelsLayer) }
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
  touch-action: none;
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

.history-opacity { position: absolute; top: 52px; right: 12px; z-index: 1000; display: grid; padding: 6px 10px; background: #171923; color: white; border-radius: 6px; font-size: 12px; }

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

.time-slider-wrap {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.85);
  padding: 10px 16px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.time-label {
  color: #00aaff;
  font-size: 14px;
  font-weight: 700;
  font-family: monospace;
  white-space: nowrap;
  min-width: 100px;
  text-align: center;
}

.time-slider {
  flex: 1;
  accent-color: #00aaff;
  height: 4px;
  cursor: pointer;
}

.time-range {
  color: #666;
  font-size: 11px;
  font-family: monospace;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .time-slider-wrap {
    padding: 8px 12px 10px;
    gap: 8px;
  }
  .time-label {
    font-size: 12px;
    min-width: 80px;
  }
  .time-range {
    font-size: 10px;
  }
}
</style>
