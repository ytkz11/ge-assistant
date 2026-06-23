<template>
  <div class="app">
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
    />
    <Sidebar
      :imagery-dates="imageryDates"
      :selected-date="selectedDate"
      :selected-zoom="selectedZoom"
      :loading="loading"
      :show-labels="showLabels"
      :selection-mode="selectionMode"
      :selection-region="selectionRegion"
      :provider="provider"
      @update:selected-date="selectedDate = $event"
      @update:selected-zoom="selectedZoom = $event"
      @update:provider="handleProviderChange"
      @query="handleQuery"
      @toggle-labels="showLabels = !showLabels"
      @toggle-selection="toggleSelection"
      @clear-selection="clearSelection"
      @open-download="showDownloadDialog = true"
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

const mapRef = ref(null)
const selectedDate = ref(null)
const selectedZoom = ref(18)
const imageryDates = ref([])
const loading = ref(false)
const currentCenter = ref({ lat: 39.9042, lng: 116.4074 })
const showLabels = ref(true)
const selectionMode = ref(false)
const selectionRegion = ref(null)
const provider = ref('google')
const waybackLayers = ref([])
const showDownloadDialog = ref(false)
const downloading = ref(false)

function handleCenterChange(coords) {
  currentCenter.value = coords
}

function handleSelectionComplete(region) {
  selectionRegion.value = region
  selectionMode.value = false
}

function toggleSelection() {
  if (selectionMode.value) {
    selectionMode.value = false
  } else {
    selectionRegion.value = null
    selectionMode.value = true
  }
}

function handleDownloadConfirm(params) {
  showDownloadDialog.value = false
  downloading.value = true

  if (mapRef.value) {
    mapRef.value.downloadTiles(params.bounds, params.zoom, 'tif').finally(() => {
      downloading.value = false
    })
  } else {
    downloading.value = false
  }
}

function handleProviderChange(newProvider) {
  if (provider.value === newProvider) return
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
  loading.value = true
  selectedDate.value = null

  try {
    if (provider.value === 'wayback') {
      const layers = await fetchWaybackLayers()
      waybackLayers.value = layers
      const dates = getWaybackDates(layers)
      imageryDates.value = dates.map(d => ({ date: d }))
    } else {
      imageryDates.value = generateDemoDates()
    }
  } catch (e) {
    console.error('Query failed:', e)
    if (provider.value === 'wayback') {
      imageryDates.value = []
      waybackLayers.value = []
    } else {
      imageryDates.value = generateDemoDates()
    }
  } finally {
    loading.value = false
    if (imageryDates.value.length > 0) {
      selectedDate.value = imageryDates.value[0].date
    }
  }
}

function generateDemoDates() {
  const dates = []
  const now = new Date()
  for (let i = 0; i < 15; i++) {
    const year = now.getFullYear() - i
    const month = Math.floor(Math.random() * 12) + 1
    const day = Math.floor(Math.random() * 28) + 1
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    dates.push({
      date: dateStr,
      epoch: 1000 + i * 10,
      label: dateStr
    })
  }
  return dates.sort((a, b) => b.date.localeCompare(a.date))
}
</script>

<style scoped>
.app {
  width: 100%;
  height: 100vh;
  position: relative;
  display: flex;
}
</style>
