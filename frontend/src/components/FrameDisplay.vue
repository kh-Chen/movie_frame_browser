<template>
  <div
    class="frame-display"
    @click="handleClick"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
    @mousedown="onPointerDown"
    @mousemove="onPointerMove"
    @mouseup="onPointerUp"
    @mouseleave="onPointerUp"
  >
    <div class="frame-container">
      <div v-if="isLoading && !currentSrc" class="frame-placeholder">
        <div class="loading-spinner"></div>
      </div>

      <div v-else-if="hasError" class="frame-error">
        <span class="error-icon">⚠️</span>
        <span>加载失败</span>
      </div>

      <img
        v-if="currentSrc"
        ref="frameImg"
        :src="currentSrc"
        :alt="`帧 ${currentTimestamp}`"
        :class="{ 'fade-in': imageLoaded }"
        draggable="false"
        @load="onImageLoad"
        @error="onImageError"
      />

      <div v-else-if="!isLoading" class="frame-placeholder-static">
        <span class="placeholder-icon">🖼️</span>
        <span>暂无帧</span>
      </div>

      <div class="time-overlay">
        <span class="time-badge">{{ displayTime }}</span>
      </div>

      <button
        v-if="showPreviewButton"
        type="button"
        class="preview-btn"
        aria-label="片段预览"
        @click.stop="emit('preview')"
      >
        预览
      </button>
    </div>

    <p v-if="swipeHint" class="swipe-hint">{{ swipeHint }}</p>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { formatTime } from '../utils/formatTime'

const SWIPE_THRESHOLD_PX = 48
const TAP_THRESHOLD_PX = 12

const props = defineProps({
  src: {
    type: String,
    default: null
  },
  timestamp: {
    type: Number,
    default: 0
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  showPreviewButton: {
    type: Boolean,
    default: true
  },
  swipeHint: {
    type: String,
    default: '左右滑动切换帧'
  }
})

const emit = defineEmits(['click', 'preview', 'step'])

const frameImg = ref(null)
const currentSrc = ref(null)
const imageLoaded = ref(false)
const hasError = ref(false)

let startX = 0
let startY = 0
let pointerActive = false
let gestureMoved = false

const currentTimestamp = computed(() => props.timestamp)
const displayTime = computed(() => formatTime(props.timestamp))

watch(() => props.src, (newSrc) => {
  if (newSrc) {
    imageLoaded.value = false
    hasError.value = false
    currentSrc.value = newSrc
  } else {
    currentSrc.value = null
  }
}, { immediate: true })

const recordStart = (clientX, clientY) => {
  startX = clientX
  startY = clientY
  pointerActive = true
  gestureMoved = false
}

const recordMove = (clientX, clientY) => {
  if (!pointerActive) return
  const dx = Math.abs(clientX - startX)
  const dy = Math.abs(clientY - startY)
  if (dx > TAP_THRESHOLD_PX || dy > TAP_THRESHOLD_PX) {
    gestureMoved = true
  }
}

const finishGesture = (clientX, clientY) => {
  if (!pointerActive) return

  const dx = clientX - startX
  const dy = clientY - startY
  pointerActive = false

  if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
    emit('step', dx < 0 ? 1 : -1)
    return
  }

  if (!gestureMoved) {
    handleClick()
  }
  gestureMoved = false
}

const onTouchStart = (e) => {
  if (e.touches.length !== 1) return
  recordStart(e.touches[0].clientX, e.touches[0].clientY)
}

const onTouchMove = (e) => {
  if (e.touches.length !== 1) return
  recordMove(e.touches[0].clientX, e.touches[0].clientY)
}

const onTouchEnd = (e) => {
  if (e.changedTouches.length !== 1) return
  finishGesture(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
}

const onPointerDown = (e) => {
  if (e.button !== 0) return
  recordStart(e.clientX, e.clientY)
}

const onPointerMove = (e) => {
  if (!pointerActive) return
  recordMove(e.clientX, e.clientY)
}

const onPointerUp = (e) => {
  if (!pointerActive) return
  finishGesture(e.clientX, e.clientY)
}

const onImageLoad = () => {
  imageLoaded.value = true
  hasError.value = false
}

const onImageError = () => {
  hasError.value = true
  imageLoaded.value = false
}

const handleClick = () => {
  if (props.isLoading || !currentSrc.value) return
  emit('click')
}
</script>

<style scoped>
.frame-display {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-primary);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.frame-container {
  position: relative;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.frame-container img {
  max-width: 100%;
  max-height: calc(100vh - 300px);
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.frame-container img.fade-in {
  opacity: 1;
}

.frame-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-secondary), var(--bg-primary));
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.frame-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
}

.error-icon {
  font-size: 2.5rem;
}

.frame-placeholder-static {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  padding: 40px;
}

.placeholder-icon {
  font-size: 3rem;
  opacity: 0.5;
}

.time-overlay {
  position: absolute;
  bottom: 16px;
  right: 16px;
  pointer-events: none;
}

.time-badge {
  background-color: rgba(0, 0, 0, 0.7);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-family: monospace;
  backdrop-filter: blur(4px);
}

.preview-btn {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 2;
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(233, 69, 96, 0.45);
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.preview-btn:active {
  transform: scale(0.96);
}

.swipe-hint {
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  opacity: 0.75;
  pointer-events: none;
}

@media (max-width: 768px) {
  .time-badge {
    font-size: 0.75rem;
    padding: 4px 8px;
  }

  .preview-btn {
    bottom: 12px;
    left: 12px;
    padding: 7px 12px;
  }

  .swipe-hint {
    margin-top: 4px;
  }
}
</style>
