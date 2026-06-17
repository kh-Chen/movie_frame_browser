<template>
  <div class="timeline-container">
    <!-- Time row -->
    <div class="time-display">
      <span class="current-time" :class="{ active: isDragging }">{{ displayTime }}</span>
      <span class="time-separator">/</span>
      <span class="total-time">{{ totalTimeDisplay }}</span>
    </div>

    <!-- Scrubber rail -->
    <div class="timeline-rail" ref="trackRef" @click="handleTrackClick">
      <div class="track-inner">
        <div class="track-bg"></div>

        <!-- Sampled keyframe ticks (avoid visual noise) -->
        <div class="track-ticks" aria-hidden="true">
          <span
            v-for="frame in visibleKeyFrames"
            :key="frame.timestamp"
            class="tick"
            :style="{ left: `${timeToPosition(frame.timestamp)}%` }"
          ></span>
        </div>

        <div
          class="track-progress"
          :style="{ width: `${sliderPosition}%` }"
          :class="{ dragging: isDragging }"
        ></div>
      </div>

      <!-- Thumb with optional drag tooltip -->
      <div
        class="timeline-thumb"
        :style="{ left: `${sliderPosition}%` }"
        :class="{ dragging: isDragging }"
        @touchstart.prevent="handleTouchStart"
        @mousedown="handleMouseDown"
      >
        <Transition name="tooltip">
          <div v-if="isDragging" class="time-tooltip">{{ displayTime }}</div>
        </Transition>
        <div class="thumb-dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted, watch } from 'vue'
import { formatTime, formatTimeShort } from '../utils/formatTime'

const RAIL_PADDING = 0.08 // 8% margin each side per design spec
const MAX_VISIBLE_TICKS = 20

const props = defineProps({
  duration: {
    type: Number,
    default: 0
  },
  currentTime: {
    type: Number,
    default: 0
  },
  keyFrames: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['seek', 'dragging'])

const timeToPosition = (time) => {
  if (props.duration === 0) return RAIL_PADDING * 100
  const normalized = time / props.duration
  const usable = 1 - RAIL_PADDING * 2
  return (RAIL_PADDING + normalized * usable) * 100
}

const positionToTime = (position) => {
  const pct = position / 100
  const usable = 1 - RAIL_PADDING * 2
  const normalized = (pct - RAIL_PADDING) / usable
  return Math.max(0, Math.min(props.duration, normalized * props.duration))
}

const trackRef = ref(null)
const isDragging = ref(false)
const sliderPosition = ref(RAIL_PADDING * 100)

const displayTime = computed(() => formatTime(props.currentTime))
const totalTimeDisplay = computed(() => formatTimeShort(props.duration))

/** Sample keyframes so ticks stay readable on long movies */
const visibleKeyFrames = computed(() => {
  const frames = props.keyFrames
  if (frames.length <= MAX_VISIBLE_TICKS) return frames

  const step = Math.ceil(frames.length / MAX_VISIBLE_TICKS)
  const sampled = frames.filter((_, i) => i % step === 0)
  const last = frames[frames.length - 1]
  if (last && sampled[sampled.length - 1]?.timestamp !== last.timestamp) {
    sampled.push(last)
  }
  return sampled
})

watch(() => props.currentTime, (newTime) => {
  if (!isDragging.value && !isInertiaScrolling) {
    sliderPosition.value = timeToPosition(newTime)
  }
})

watch(() => props.duration, () => {
  sliderPosition.value = timeToPosition(props.currentTime)
})

let isInertiaScrolling = false
let startX = 0
let startPosition = 0
let velocity = 0
let lastX = 0
let lastTime = 0
let inertiaId = null
let dragThrottleTimer = null

const handleTouchStart = (e) => {
  if (e.touches.length !== 1) return
  beginDrag(e.touches[0].clientX)
  document.addEventListener('touchmove', handleTouchMove, { passive: false })
  document.addEventListener('touchend', handleTouchEnd)
  document.addEventListener('touchcancel', handleTouchEnd)
}

const handleTouchMove = (e) => {
  if (!isDragging.value || e.touches.length !== 1) return
  e.preventDefault()
  updateDragPosition(e.touches[0].clientX)
}

const handleTouchEnd = () => {
  if (!isDragging.value) return
  isDragging.value = false
  cleanupDragListeners()
  finishDrag()
}

const handleMouseDown = (e) => {
  beginDrag(e.clientX)
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const handleMouseMove = (e) => {
  if (!isDragging.value) return
  updateDragPosition(e.clientX)
}

const handleMouseUp = () => {
  if (!isDragging.value) return
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  finishDrag()
}

const beginDrag = (clientX) => {
  isDragging.value = true
  isInertiaScrolling = false
  startX = clientX
  startPosition = sliderPosition.value
  lastX = clientX
  lastTime = Date.now()
  velocity = 0
  if (inertiaId) {
    cancelAnimationFrame(inertiaId)
    inertiaId = null
  }
}

const updateDragPosition = (clientX) => {
  if (!trackRef.value) return

  const rect = trackRef.value.getBoundingClientRect()
  const deltaPosition = ((clientX - startX) / rect.width) * 100
  const newPosition = Math.max(0, Math.min(100, startPosition + deltaPosition))

  sliderPosition.value = newPosition

  const now = Date.now()
  const dt = now - lastTime
  if (dt > 0) {
    velocity = ((clientX - lastX) / dt) * 16
  }
  lastX = clientX
  lastTime = now

  if (!dragThrottleTimer) {
    dragThrottleTimer = setTimeout(() => {
      emit('dragging', positionToTime(newPosition))
      dragThrottleTimer = null
    }, 33)
  }
}

const finishDrag = () => {
  if (dragThrottleTimer) {
    clearTimeout(dragThrottleTimer)
    dragThrottleTimer = null
  }

  if (Math.abs(velocity) > 0.3) {
    applyInertia()
  } else {
    emit('seek', positionToTime(sliderPosition.value))
  }
}

const applyInertia = () => {
  isInertiaScrolling = true
  let currentVelocity = velocity
  const friction = 0.92
  const minVelocity = 0.1

  const animate = () => {
    if (!isInertiaScrolling) {
      emit('seek', positionToTime(sliderPosition.value))
      return
    }

    currentVelocity *= friction

    if (Math.abs(currentVelocity) < minVelocity) {
      isInertiaScrolling = false
      emit('seek', positionToTime(sliderPosition.value))
      return
    }

    sliderPosition.value = Math.max(0, Math.min(100, sliderPosition.value + currentVelocity * 0.5))
    emit('dragging', positionToTime(sliderPosition.value))
    inertiaId = requestAnimationFrame(animate)
  }

  inertiaId = requestAnimationFrame(animate)
}

const handleTrackClick = (e) => {
  if (e.target.closest('.timeline-thumb')) return

  const rect = trackRef.value.getBoundingClientRect()
  const position = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
  sliderPosition.value = position
  emit('seek', positionToTime(position))
}

const cleanupDragListeners = () => {
  document.removeEventListener('touchmove', handleTouchMove)
  document.removeEventListener('touchend', handleTouchEnd)
  document.removeEventListener('touchcancel', handleTouchEnd)
}

onUnmounted(() => {
  if (inertiaId) cancelAnimationFrame(inertiaId)
  if (dragThrottleTimer) clearTimeout(dragThrottleTimer)
  cleanupDragListeners()
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})
</script>

<style scoped>
.timeline-container {
  width: 100%;
  padding: 10px 16px 14px;
  background-color: var(--bg-secondary);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Time row ── */
.time-display {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
  font-variant-numeric: tabular-nums;
}

.current-time {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.02em;
  transition: color 0.15s ease;
}

.current-time.active {
  color: var(--accent-light);
}

.time-separator {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.2);
  user-select: none;
}

.total-time {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

/* ── Rail ── */
.timeline-rail {
  position: relative;
  height: 36px;
  cursor: pointer;
  touch-action: none;
  display: flex;
  align-items: center;
}

.track-inner {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  border-radius: 2px;
  overflow: hidden;
}

.track-bg {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.track-ticks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.tick {
  position: absolute;
  top: 0;
  width: 1px;
  height: 100%;
  background: rgba(255, 255, 255, 0.18);
  transform: translateX(-50%);
}

.track-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.08s linear;
  pointer-events: none;
}

.track-progress.dragging {
  transition: none;
}

/* ── Thumb ── */
.timeline-thumb {
  position: absolute;
  top: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 2;
}

.timeline-thumb:active {
  cursor: grabbing;
}

.thumb-dot {
  width: 14px;
  height: 14px;
  background: #fff;
  border: 2.5px solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.timeline-thumb.dragging .thumb-dot {
  transform: scale(1.25);
  box-shadow: 0 2px 12px rgba(233, 69, 96, 0.55);
}

/* Drag tooltip */
.time-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.time-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.75);
}

.tooltip-enter-active,
.tooltip-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

/* ── Mobile ── */
@media (max-width: 768px) {
  .timeline-container {
    padding: 12px 16px 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }

  .timeline-rail {
    height: 44px;
  }

  .thumb-dot {
    width: 16px;
    height: 16px;
  }
}
</style>
