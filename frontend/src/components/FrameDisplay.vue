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
      <!-- Clip preview mode (HLS) -->
      <template v-if="clipMode">
        <div v-if="hlsLoading" class="frame-placeholder clip-loading">
          <div class="loading-spinner"></div>
          <p class="clip-loading-text">正在加载视频...</p>
        </div>

        <video
          ref="clipVideoRef"
          class="clip-video fade-in"
          controls
          autoplay
          muted
          playsinline
        />

        <div v-if="hlsError" class="frame-error">
          <span class="error-icon">⚠️</span>
          <span>视频加载失败</span>
        </div>
      </template>

      <!-- Frame image mode -->
      <template v-else>
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
      </template>

      <div class="time-overlay">
        <span v-if="clipMode && hlsTimeRange" class="time-badge clip-range-badge">{{ hlsTimeRange }}</span>
        <span v-else class="time-badge">{{ displayTime }}</span>
      </div>

      <button
        v-if="clipMode"
        type="button"
        class="exit-clip-btn"
        title="返回帧预览"
        @click.stop="emit('exit-clip')"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { formatTime } from '../utils/formatTime'
import { useHlsPlayer } from '../composables/useHlsPlayer'

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
  movieId: {
    type: String,
    default: null
  },
  clipMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'step', 'exit-clip'])

const frameImg = ref(null)
const clipVideoRef = ref(null)
const currentSrc = ref(null)
const imageLoaded = ref(false)
const hasError = ref(false)

let startX = 0
let startY = 0
let pointerActive = false
let gestureMoved = false

const {
  isLoading: hlsLoading,
  hasError: hlsError,
  timeRange: hlsTimeRange,
  attachTo: attachHls,
  destroy: destroyHls,
} = useHlsPlayer(() => props.movieId)

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

watch(
  () => [props.clipMode, props.timestamp, props.movieId],
  ([mode]) => {
    if (mode && props.movieId) {
      nextTick(() => attachHls(clipVideoRef.value, props.timestamp))
    } else {
      destroyHls()
    }
  },
  { flush: 'post' }
)

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
  if (props.clipMode) {
    pointerActive = false
    gestureMoved = false
    return
  }

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
  if (props.clipMode || props.isLoading || !currentSrc.value) return
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

.clip-video {
  max-width: 100%;
  max-height: calc(100vh - 300px);
  object-fit: contain;
  opacity: 1;
  background: #000;
}

.clip-ended-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  z-index: 1;
}

.clip-action-btn {
  min-width: 88px;
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background-color: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease;
}

.clip-action-btn:hover {
  background-color: rgba(255, 255, 255, 0.25);
}

.clip-action-btn:active {
  transform: scale(0.96);
}

.clip-action-btn--primary {
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  color: #fff;
}

.clip-action-btn--primary:hover {
  filter: brightness(1.08);
}

.clip-loading {
  animation: none;
  gap: 12px;
}

.clip-loading-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.clip-progress {
  width: 160px;
}

.clip-progress-bar {
  height: 4px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.clip-progress-fill {
  height: 100%;
  background-color: var(--accent);
  transition: width 0.3s ease;
}

.clip-range-badge {
  font-size: 0.75rem;
}

.exit-clip-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: transparent;
  color: var(--text-primary);
  font-size: 1rem;
  cursor: pointer;
  z-index: 2;
}

.exit-clip-btn:hover {
  opacity: 0.75;
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
  z-index: 1;
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

@media (max-width: 768px) {
  .time-badge {
    font-size: 0.75rem;
    padding: 4px 8px;
  }
}
</style>
