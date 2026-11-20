<template>
  <div class="app" :class="{ 'sidebar-open': sidebarOpen }">
    <MapView
      ref="mapRef"
      :selected-date="selectedDate"
      :imagery-dates="imageryDates"
      :show-labels="showLabels"
      :selection-mode="selectionMode"
      :provider="provider"
      :wayback-layers="waybackLayers"
      @center-change="handleCenterChange"
      @selection-complete="handleSelectionComplete"
      @update:selected-date="selectedDate = $event"
    />
    <button class="menu-toggle" :aria-expanded="sidebarOpen" aria-label="影像面板" @click="sidebarOpen = !sidebarOpen">
      <span class="menu-icon">{{ sidebarOpen ? '\u2715' : '\u2630' }}</span>
    </button>
    <Sidebar
      :imagery-dates="imageryDates"
      :selected-date="selectedDate"
      :loading="loading"
      :query-message="queryMessage"
      :download-message="downloadMessage"
      :downloading="downloading"
      :show-labels="showLabels"
      :selection-mode="selectionMode"
      :selection-region="selectionRegion"
      :provider="provider"
      :open="sidebarOpen"
      @update:selected-date="selectedDate = $event"
      @update:provider="handleProviderChange"
      @query="handleQuery"
      @toggle-labels="showLabels = !showLabels"
      @toggle-selection="toggleSelection"
      @clear-selection="clearSelection"
      @open-download="showDownloadDialog = true"
      @close="sidebarOpen = false"
    />
    <DownloadDialog
      :visible="showDownloadDialog"
      :bounds="selectionRegion || { north: 0, south: 0, west: 0, east: 0 }"
      :provider="provider"
      :selected-date="selectedDate"
      :loading="downloading"
      @cancel="showDownloadDialog = false"
      @confirm="handleDownloadConfirm"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import MapView from './components/MapView.vue'
import Sidebar from './components/Sidebar.vue'
import DownloadDialog from './components/DownloadDialog.vue'
import { fetchWaybackLayers, getWaybackDates } from './esri-wayback'
import { getAvailableDates } from './google-earth'
import { latLngToEarthTile } from './imagery-grid'

const mapRef = ref(null)
const selectedDate = ref(null)
const imageryDates = ref([])
const loading = ref(false)
const currentCenter = ref({ lat: 39.9042, lng: 116.4074, zoom: 5 })
const showLabels = ref(true)
const selectionMode = ref(false)
const selectionRegion = ref(null)
const provider = ref('wayback')
const queryMessage = ref('')
const downloadMessage = ref('')
let queryVersion = 0
const waybackLayers = ref([])
const showDownloadDialog = ref(false)
const downloading = ref(false)
const sidebarOpen = ref(false)

function handleCenterChange(coords) {
  currentCenter.value = coords
}

function handleSelectionComplete(region) {
  selectionRegion.value = region
  selectionMode.value = false
  sidebarOpen.value = true
}

function toggleSelection() {
  if (selectionMode.value) {
    selectionMode.value = false
  } else {
    selectionRegion.value = null
    selectionMode.value = true
    sidebarOpen.value = false
  }
}

async function handleDownloadConfirm(params) {
  if (downloading.value || !mapRef.value) return
  showDownloadDialog.value = false
  downloading.value = true
  downloadMessage.value = ''
  try {
    const { total, missing, substituted } = await mapRef.value.downloadTiles(params)
    downloadMessage.value = `已导出 ${total - missing}/${total} 块瓦片，日期替补 ${substituted} 块。`
  } catch (error) {
    downloadMessage.value = error.message
  } finally {
    downloading.value = false
  }
}

function handleProviderChange(newProvider) {
  if (provider.value === newProvider) return
  queryVersion++
  loading.value = false
  queryMessage.value = ''
  provider.value = newProvider
  selectedDate.value = null
  imageryDates.value = []
  showDownloadDialog.value = false
}

function clearSelection() {
  selectionRegion.value = null
  selectionMode.value = false
  if (mapRef.value) {
    mapRef.value.clearSelection()
  }
}

async function handleQuery() {
  const version = ++queryVersion
  loading.value = true
  queryMessage.value = ''
  selectedDate.value = null
  imageryDates.value = []
  try {
    if (provider.value === 'google') {
      const { lat, lng, zoom } = currentCenter.value
      const { x, y } = latLngToEarthTile(lat, lng, zoom)
      const dates = await getAvailableDates(zoom, x, y)
      if (version !== queryVersion) return
      imageryDates.value = dates
      queryMessage.value = dates.length
        ? `地图中心瓦片 · 缩放级别 ${zoom}。所选日期用于导出，地图仍显示参考底图。`
        : `地图中心瓦片在级别 ${zoom} 未返回历史日期。`
    } else {
      const layers = await fetchWaybackLayers()
      if (version !== queryVersion) return
      waybackLayers.value = layers
      imageryDates.value = getWaybackDates(layers).map(date => ({ date }))
      queryMessage.value = '日期为 Wayback 发布批次。实际拍摄日期随位置而变化。'
    }
    selectedDate.value = imageryDates.value[0]?.date ?? null
  } catch (error) {
    if (version !== queryVersion) return
    console.error('Imagery query failed:', error)
    queryMessage.value = provider.value === 'google'
      ? 'Google Earth 历史服务查询失败。浏览器跨域受限时，可切换到 Esri Wayback。'
      : 'Wayback 目录加载失败，请重试。'
  } finally {
    if (version === queryVersion) loading.value = false
  }
}
</script>

<style scoped>
.app {
  width: 100%;
  height: 100vh;
  position: relative;
  display: flex;
}

.menu-toggle {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 10000;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  border: none;
  font-size: 22px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.menu-icon {
  line-height: 1;
}

@media (max-width: 768px) {
  .menu-toggle {
    display: flex;
  }
}
</style>
