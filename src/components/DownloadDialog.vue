<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('cancel')">
      <div class="modal">
        <div class="modal-header">
          <h3>下载影像</h3>
          <button class="close-btn" @click="$emit('cancel')">&times;</button>
        </div>

        <div class="modal-body">
          <div class="region-info">
            <label class="label">选择区域</label>
            <div class="coords">
              <span>北: {{ bounds.north.toFixed(6) }}</span>
              <span>南: {{ bounds.south.toFixed(6) }}</span>
              <span>西: {{ bounds.west.toFixed(6) }}</span>
              <span>东: {{ bounds.east.toFixed(6) }}</span>
            </div>
          </div>

          <div class="zoom-section">
            <label class="label">选择缩放级别</label>
            <div class="zoom-slider-row">
              <input
                type="range"
                :min="minZoom"
                :max="maxZoom"
                v-model.number="selectedZoom"
                class="zoom-slider"
              />
              <span class="zoom-value">{{ selectedZoom }}</span>
            </div>

            <div class="zoom-table">
              <div class="zoom-row header">
                <span>级别</span>
                <span>瓦片数</span>
                <span>像素尺寸</span>
                <span>RGBA 大小</span>
              </div>
              <div
                v-for="z in zoomRange"
                :key="z"
                class="zoom-row"
                :class="{ active: z === selectedZoom }"
                @click="selectedZoom = z"
              >
                <span>{{ z }}</span>
                <span>{{ getTileCount(z) }}</span>
                <span>{{ getImageSize(z) }}</span>
                <span>{{ getFileSize(z) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="export-options">
          <label>导出格式
            <select v-model="format">
              <option value="tif">GeoTIFF (EPSG:{{ provider === 'google' ? 4326 : 3857 }})</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label v-if="provider === 'google' && selectedDate">
            <input v-model="nearest" type="checkbox" /> 用最接近的日期替补缺失日期
          </label>
          <label><input v-model="allowMissing" type="checkbox" /> 允许缺失瓦片保留透明</label>
          <p v-if="!grid?.canExport" role="status">请降低缩放级别。每次最多导出 256 块瓦片，单边最多 8192 像素。</p>
        </div>

        <div class="modal-footer">
          <button class="btn cancel" @click="$emit('cancel')">取消</button>
          <button class="btn confirm" @click="confirm" :disabled="loading || !grid?.canExport">
            {{ loading ? '下载中...' : '开始下载' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getExportGrid } from '../imagery-grid'

const props = defineProps({
  visible: { type: Boolean, default: false },
  bounds: { type: Object, default: () => ({ north: 0, south: 0, west: 0, east: 0 }) },
  provider: { type: String, default: 'google' },
  selectedDate: { type: String, default: null },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['cancel', 'confirm'])

const selectedZoom = ref(18)
const format = ref('tif')
const nearest = ref(false)
const allowMissing = ref(false)
const grid = computed(() => getExportGrid(props.bounds, selectedZoom.value, props.provider))
const minZoom = 1
const maxZoom = computed(() => props.provider === 'wayback' ? 20 : 21)

const zoomRange = computed(() => {
  const range = []
  for (let z = minZoom; z <= maxZoom.value; z++) {
    range.push(z)
  }
  return range
})

watch(() => props.visible, visible => {
  if (!visible) return
  selectedZoom.value = Math.min(selectedZoom.value, maxZoom.value)
  while (selectedZoom.value > minZoom && !grid.value?.canExport) selectedZoom.value--
})

function getTileCount(z) {
  return `${getExportGrid(props.bounds, z, props.provider)?.total ?? '—'} 块`
}

function getImageSize(z) {
  const candidate = getExportGrid(props.bounds, z, props.provider)
  return candidate ? `${candidate.width} × ${candidate.height}` : '—'
}

function getFileSize(z) {
  const candidate = getExportGrid(props.bounds, z, props.provider)
  if (!candidate) return '—'
  const bytes = candidate.width * candidate.height * 4
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  } else {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
}

function confirm() {
  if (!grid.value?.canExport || props.loading) return
  emit('confirm', {
    zoom: selectedZoom.value,
    bounds: props.bounds,
    format: format.value,
    nearest: nearest.value,
    allowMissing: allowMissing.value
  })
}
</script>

<style scoped>
.export-options { display: grid; gap: 8px; padding: 12px 18px; }
.export-options p { color: #ffc107; }
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #1a1a2e;
  border-radius: 12px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  border: 1px solid #333;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #333;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: #00aaff;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 24px;
  cursor: pointer;
  padding: 0 4px;
}

.close-btn:hover {
  color: #fff;
}

.modal-body {
  padding: 20px;
}

.label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  margin-bottom: 8px;
  font-weight: 600;
}

.region-info {
  margin-bottom: 20px;
}

.coords {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  font-family: monospace;
  font-size: 12px;
  color: #ccc;
  background: #16213e;
  padding: 10px;
  border-radius: 6px;
}

.zoom-section {
  margin-top: 16px;
}

.zoom-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.zoom-slider {
  flex: 1;
  accent-color: #00aaff;
  height: 4px;
}

.zoom-value {
  font-size: 20px;
  font-weight: 700;
  color: #00aaff;
  min-width: 32px;
  text-align: center;
  font-family: monospace;
}

.zoom-table {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #333;
  border-radius: 6px;
}

.zoom-row {
  display: grid;
  grid-template-columns: 60px 80px 1fr 100px;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid #2a2a3e;
  cursor: pointer;
  transition: background 0.1s;
}

.zoom-row:last-child {
  border-bottom: none;
}

.zoom-row:hover {
  background: #1a3a5c;
}

.zoom-row.active {
  background: rgba(0, 170, 255, 0.15);
  color: #00aaff;
}

.zoom-row.header {
  background: #16213e;
  font-weight: 600;
  color: #888;
  cursor: default;
  position: sticky;
  top: 0;
}

.zoom-row.header:hover {
  background: #16213e;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid #333;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn.cancel {
  background: #333;
  color: #ccc;
}

.btn.cancel:hover {
  background: #444;
}

.btn.confirm {
  background: linear-gradient(135deg, #2d8a4e, #34c759);
  color: #fff;
}

.btn.confirm:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(52, 199, 89, 0.3);
}

.btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
