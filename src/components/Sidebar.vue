<template>
  <div class="sidebar" :class="{ open }">
    <div class="sidebar-header">
      <h1>GE Satellite Assistant</h1>
      <p class="subtitle">Google Earth 历史卫星图工具</p>
    </div>

    <div class="section">
      <label class="label">影像来源</label>
      <div class="provider-group">
        <button
          class="provider-btn"
          :class="{ active: provider === 'google' }"
          @click="$emit('update:provider', 'google')"
        >
          Google Earth
        </button>
        <button
          class="provider-btn wayback"
          :class="{ active: provider === 'wayback' }"
          @click="$emit('update:provider', 'wayback')"
        >
          Esri Wayback
        </button>
      </div>
    </div>

    <div class="section">
      <label class="label">缩放级别</label>
      <div class="zoom-control">
        <input
          type="range"
          min="1"
          max="21"
          :value="selectedZoom"
          @input="$emit('update:selected-zoom', parseInt($event.target.value))"
          class="zoom-slider"
        />
        <span class="zoom-value">{{ selectedZoom }}</span>
      </div>
    </div>

    <div class="section">
      <button class="query-btn" @click="$emit('query')" :disabled="loading">
        {{ loading ? '查询中...' : '查询当前位置可用影像' }}
      </button>
    </div>

    <div v-if="imageryDates.length > 0" class="section">
      <label class="label">可用历史影像 ({{ imageryDates.length }} 个)</label>
      <div class="date-list">
        <button
          v-for="item in imageryDates"
          :key="item.date"
          class="date-item"
          :class="{ active: selectedDate === item.date }"
          @click="$emit('update:selected-date', item.date)"
        >
          <span class="date-main">{{ item.date }}</span>
          <span v-if="item.epoch" class="date-epoch">v{{ item.epoch }}</span>
        </button>
      </div>
    </div>

    <div v-else class="section empty">
      <p>点击按钮查询当前区域的卫星影像可用日期</p>
    </div>

    <div class="section">
      <label class="label">叠加图层</label>
      <label class="toggle-row">
        <input
          type="checkbox"
          class="toggle-input"
          :checked="showLabels"
          @change="$emit('toggle-labels')"
        />
        <span class="toggle-slider-wrap">
          <span class="toggle-slider"></span>
        </span>
        <span class="toggle-label">OSM 道路标注</span>
      </label>
    </div>

    <div class="section">
      <button
        class="selection-btn"
        :class="{ active: selectionMode }"
        @click="$emit('toggle-selection')"
      >
        {{ selectionMode ? '完成框选' : '框选下载' }}
      </button>
      <div v-if="selectionRegion" class="region-info">
        <div class="region-label">已选区域</div>
        <div class="region-coords">
          {{ selectionRegion.south.toFixed(4) }}, {{ selectionRegion.west.toFixed(4) }}<br/>
          {{ selectionRegion.north.toFixed(4) }}, {{ selectionRegion.east.toFixed(4) }}
        </div>
        <div class="region-actions">
          <button class="download-btn" @click="$emit('open-download')">
            选择下载参数
          </button>
          <button class="clear-btn" @click="$emit('clear-selection')">
            清除选区
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  imageryDates: { type: Array, default: () => [] },
  selectedDate: { type: String, default: null },
  selectedZoom: { type: Number, default: 18 },
  loading: { type: Boolean, default: false },
  showLabels: { type: Boolean, default: false },
  selectionMode: { type: Boolean, default: false },
  selectionRegion: { type: Object, default: null },
  provider: { type: String, default: 'google' },
  open: { type: Boolean, default: true }
})

defineEmits([
  'update:selected-date',
  'update:selected-zoom',
  'update:provider',
  'query',
  'toggle-labels',
  'toggle-selection',
  'open-download',
  'clear-selection',
  'close'
])
</script>

<style scoped>
.sidebar {
  width: 320px;
  height: 100vh;
  background: #1a1a2e;
  color: #e0e0e0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 9999;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    box-shadow: none;
  }
  .sidebar.open {
    transform: translateX(0);
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
  }
}

.sidebar-header {
  padding: 20px;
  background: linear-gradient(135deg, #16213e, #0f3460);
  border-bottom: 1px solid #333;
}

.sidebar-header h1 {
  font-size: 18px;
  font-weight: 700;
  color: #00aaff;
  margin-bottom: 4px;
}

.subtitle {
  font-size: 12px;
  color: #888;
}

.section {
  padding: 16px 20px;
  border-bottom: 1px solid #2a2a3e;
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

.provider-group {
  display: flex;
  gap: 8px;
}

.provider-btn {
  flex: 1;
  padding: 10px 8px;
  background: #16213e;
  border: 1px solid #333;
  border-radius: 6px;
  color: #ccc;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
  text-align: center;
}

.provider-btn:hover {
  background: #1a3a5c;
  border-color: #00aaff;
}

.provider-btn.active {
  background: rgba(0, 170, 255, 0.15);
  border-color: #00aaff;
  color: #00aaff;
}

.provider-btn.wayback.active {
  background: rgba(76, 175, 80, 0.15);
  border-color: #4caf50;
  color: #4caf50;
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.zoom-slider {
  flex: 1;
  accent-color: #00aaff;
  height: 4px;
}

.zoom-value {
  font-size: 16px;
  font-weight: 700;
  color: #00aaff;
  min-width: 28px;
  text-align: center;
  font-family: monospace;
}

.query-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #0077b6, #00aaff);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.query-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #005f8a, #0088cc);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 170, 255, 0.3);
}

.query-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.date-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.date-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #16213e;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 13px;
}

.date-item:hover {
  background: #1a3a5c;
  border-color: #00aaff;
}

.date-item.active {
  background: rgba(0, 170, 255, 0.15);
  border-color: #00aaff;
  color: #00aaff;
}

.date-main {
  font-family: monospace;
  font-weight: 500;
}

.date-epoch {
  font-size: 11px;
  color: #666;
}

.empty {
  text-align: center;
  color: #666;
  font-size: 13px;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.toggle-input {
  display: none;
}

.toggle-slider-wrap {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: #333;
  border-radius: 20px;
  transition: background 0.2s;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  background: #888;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: all 0.2s;
}

.toggle-input:checked + .toggle-slider-wrap .toggle-slider {
  background: #00aaff;
}

.toggle-input:checked + .toggle-slider-wrap .toggle-slider::after {
  background: #fff;
  left: 18px;
}

.toggle-label {
  font-size: 13px;
  color: #ccc;
}

.selection-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #b8860b, #daa520);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.selection-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(218, 165, 32, 0.3);
}

.selection-btn.active {
  background: linear-gradient(135deg, #8b0000, #cc0000);
}

.selection-btn.active:hover {
  box-shadow: 0 4px 12px rgba(204, 0, 0, 0.3);
}

.region-info {
  margin-top: 12px;
  background: #16213e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px;
}

.region-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #4caf50;
  margin-bottom: 6px;
  font-weight: 600;
}

.region-coords {
  font-family: monospace;
  font-size: 11px;
  color: #aaa;
  line-height: 1.6;
  margin-bottom: 10px;
}

.download-btn {
  width: 100%;
  padding: 10px;
  background: linear-gradient(135deg, #2d8a4e, #34c759);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.download-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(52, 199, 89, 0.3);
}

.region-actions {
  display: flex;
  gap: 8px;
}

.region-actions .download-btn {
  flex: 1;
}

.clear-btn {
  padding: 10px 14px;
  background: #333;
  color: #ccc;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: #cc0000;
  color: #fff;
}

@media (max-width: 768px) {
  .sidebar-header {
    padding: 16px;
  }
  .sidebar-header h1 {
    font-size: 16px;
  }
  .section {
    padding: 12px 16px;
  }
  .query-btn, .selection-btn {
    padding: 14px;
    font-size: 15px;
  }
  .date-item {
    padding: 12px;
    font-size: 14px;
    min-height: 44px;
  }
  .provider-btn {
    padding: 12px 8px;
    font-size: 13px;
    min-height: 44px;
  }
  .download-btn, .clear-btn {
    padding: 12px;
    font-size: 14px;
    min-height: 44px;
  }
  .zoom-slider {
    height: 6px;
  }
  .toggle-row {
    min-height: 44px;
  }
}
</style>
