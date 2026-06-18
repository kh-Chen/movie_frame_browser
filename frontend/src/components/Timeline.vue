<template>
  <div class="timeline-container">
    <!-- Time row -->
    <div class="time-display">
      <span class="current-time" :class="{ active: isDragging || isFineDragging }">{{ displayTime }}</span>
      <span class="time-separator">/</span>
      <span class="total-time">{{ totalTimeDisplay }}</span>
    </div>

    <!-- Main scrubber rail -->
    <div class="timeline-rail" ref="trackRef" @click="handleTrackClick">
      <div class="track-inner">
        <div class="track-bg"></div>

        <div
          v-if="showFineRail"
          class="fine-window-marker"
          :style="fineWindowMarkerStyle"
        ></div>

        <div
          class="track-progress"
          :style="{ width: `${sliderPosition}%` }"
          :class="{ dragging: isDragging }"
        ></div>
      </div>

      <div
        class="timeline-thumb"
        :style="{ left: `${sliderPosition}%` }"
        :class="{ dragging: isDragging }"
        @touchstart.prevent="(e) => startDrag(e, 'main')"
        @mousedown="(e) => startDrag(e, 'main')"
      >
        <Transition name="tooltip">
          <div v-if="isDragging" class="time-tooltip">{{ displayTime }}</div>
        </Transition>
        <div class="thumb-dot"></div>
      </div>
    </div>

    <!-- Fine-tune rail (±5 min around current position) -->
    <div v-if="showFineRail" class="fine-tune-section">
      <div class="fine-tune-header">
        <span class="fine-bound">{{ formatTimeShort(fineWindowStart) }}</span>
        <span class="fine-label">微调 ±5分钟</span>
        <span class="fine-bound">{{ formatTimeShort(fineWindowEnd) }}</span>
      </div>

      <div class="timeline-rail fine-rail" ref="fineTrackRef" @click="(e) => handleTrackClick(e, 'fine')">
        <div class="track-inner track-inner--fine">
          <div class="track-bg"></div>
          <div class="track-center-mark"></div>
          <div
            class="track-progress track-progress--fine"
            :style="{ width: `${fineSliderPosition}%` }"
            :class="{ dragging: isFineDragging }"
          ></div>
        </div>

        <div
          class="timeline-thumb timeline-thumb--fine"
          :style="{ left: `${fineSliderPosition}%` }"
          :class="{ dragging: isFineDragging }"
          @touchstart.prevent="(e) => startDrag(e, 'fine')"
          @mousedown="(e) => startDrag(e, 'fine')"
        >
          <Transition name="tooltip">
            <div v-if="isFineDragging" class="time-tooltip">{{ displayTime }}</div>
          </Transition>
          <div class="thumb-dot thumb-dot--fine"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted, watch } from 'vue'
import { formatTime, formatTimeShort } from '../utils/formatTime'

const FINE_RANGE_SEC = 300
const FINE_RAIL_MIN_DURATION = FINE_RANGE_SEC * 2

const props = defineProps({
  duration: {
    type: Number,
    default: 0
  },
  currentTime: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['seek', 'dragging'])

const showFineRail = computed(() => props.duration > FINE_RAIL_MIN_DURATION)

const trackRef = ref(null)
const fineTrackRef = ref(null)
const isDragging = ref(false)
const isFineDragging = ref(false)
const sliderPosition = ref(0)
const fineSliderPosition = ref(50)
const fineWindowAnchor = ref(0)
const activeRail = ref(null)

const displayTime = computed(() => formatTime(props.currentTime))
const totalTimeDisplay = computed(() => formatTimeShort(props.duration))

const fineWindowStart = computed(() => {
  const anchor = isFineDragging.value ? fineWindowAnchor.value : props.currentTime
  return Math.max(0, anchor - FINE_RANGE_SEC)
})

const fineWindowEnd = computed(() => {
  const anchor = isFineDragging.value ? fineWindowAnchor.value : props.currentTime
  return Math.min(props.duration, anchor + FINE_RANGE_SEC)
})

const fineWindowSpan = computed(() => fineWindowEnd.value - fineWindowStart.value)

const fineWindowMarkerStyle = computed(() => {
  if (!showFineRail.value || props.duration === 0) return { display: 'none' }
  const left = (fineWindowStart.value / props.duration) * 100
  const width = (fineWindowSpan.value / props.duration) * 100
  return { left: `${left}%`, width: `${width}%` }
})

const timeToPosition = (time) => {
  if (props.duration === 0) return 0
  return (time / props.duration) * 100
}

const positionToTime = (position) => {
  const normalized = position / 100
  return Math.max(0, Math.min(props.duration, normalized * props.duration))
}

const timeToFinePosition = (time) => {
  if (fineWindowSpan.value === 0) return 50
  return ((time - fineWindowStart.value) / fineWindowSpan.value) * 100
}

const positionToFineTime = (position) => {
  const normalized = position / 100
  return Math.max(
    fineWindowStart.value,
    Math.min(fineWindowEnd.value, fineWindowStart.value + normalized * fineWindowSpan.value)
  )
}

const getRailState = (rail) => {
  if (rail === 'fine') {
    return {
      trackRef: fineTrackRef,
      isDragging: isFineDragging,
      getPosition: () => fineSliderPosition.value,
      setPosition: (v) => { fineSliderPosition.value = v },
      positionToTime: positionToFineTime
    }
  }
  return {
    trackRef,
    isDragging,
    getPosition: () => sliderPosition.value,
    setPosition: (v) => { sliderPosition.value = v },
    positionToTime
  }
}

watch(() => props.currentTime, (newTime) => {
  if (!isDragging.value) {
    sliderPosition.value = timeToPosition(newTime)
  }
  if (!isFineDragging.value) {
    fineSliderPosition.value = timeToFinePosition(newTime)
  }
})

watch(() => props.duration, () => {
  sliderPosition.value = timeToPosition(props.currentTime)
  fineSliderPosition.value = timeToFinePosition(props.currentTime)
})

watch(fineWindowStart, () => {
  if (!isFineDragging.value) {
    fineSliderPosition.value = timeToFinePosition(props.currentTime)
  }
})

let startX = 0
let startPosition = 0
let dragThrottleTimer = null

const prepareDrag = (rail) => {
  if (rail === 'fine') {
    isDragging.value = false
    fineWindowAnchor.value = props.currentTime
  } else {
    isFineDragging.value = false
  }
  activeRail.value = rail
  const state = getRailState(rail)
  state.isDragging.value = true
  return state
}

const startDrag = (e, rail) => {
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const state = prepareDrag(rail)
  startX = clientX
  startPosition = state.getPosition()

  if (e.type === 'touchstart') {
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('touchcancel', handleTouchEnd)
  } else {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }
}

const updateDragPosition = (clientX) => {
  const state = getRailState(activeRail.value)
  const trackEl = state.trackRef.value
  if (!trackEl) return

  const rect = trackEl.getBoundingClientRect()
  const deltaPosition = ((clientX - startX) / rect.width) * 100
  const newPosition = Math.max(0, Math.min(100, startPosition + deltaPosition))
  state.setPosition(newPosition)

  if (!dragThrottleTimer) {
    dragThrottleTimer = setTimeout(() => {
      emit('dragging', state.positionToTime(newPosition))
      dragThrottleTimer = null
    }, 33)
  }
}

const finishDrag = () => {
  const state = getRailState(activeRail.value)
  if (dragThrottleTimer) {
    clearTimeout(dragThrottleTimer)
    dragThrottleTimer = null
  }
  state.isDragging.value = false
  emit('seek', state.positionToTime(state.getPosition()))
  activeRail.value = null
}

const handleTouchMove = (e) => {
  if (!activeRail.value || e.touches.length !== 1) return
  e.preventDefault()
  updateDragPosition(e.touches[0].clientX)
}

const handleTouchEnd = () => {
  if (!activeRail.value) return
  cleanupTouchListeners()
  finishDrag()
}

const handleMouseMove = (e) => {
  if (!activeRail.value) return
  updateDragPosition(e.clientX)
}

const handleMouseUp = () => {
  if (!activeRail.value) return
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  finishDrag()
}

const handleTrackClick = (e, rail = 'main') => {
  if (e.target.closest('.timeline-thumb')) return

  const state = getRailState(rail)
  const trackEl = state.trackRef.value
  if (!trackEl) return

  const rect = trackEl.getBoundingClientRect()
  const position = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
  state.setPosition(position)
  emit('seek', state.positionToTime(position))
}

const cleanupTouchListeners = () => {
  document.removeEventListener('touchmove', handleTouchMove)
  document.removeEventListener('touchend', handleTouchEnd)
  document.removeEventListener('touchcancel', handleTouchEnd)
}

onUnmounted(() => {
  if (dragThrottleTimer) clearTimeout(dragThrottleTimer)
  cleanupTouchListeners()
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

.track-inner--fine {
  height: 6px;
  border-radius: 3px;
}

.track-bg {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.12);
  border-radius: inherit;
}

.fine-window-marker {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1;
}

.track-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
  transition: width 0.08s linear;
  pointer-events: none;
  z-index: 2;
}

.track-progress.dragging {
  transition: none;
}

.track-progress--fine {
  background: var(--accent-light, #ff8fa8);
  opacity: 0.85;
}

.track-center-mark {
  position: absolute;
  left: 50%;
  top: -3px;
  width: 1px;
  height: calc(100% + 6px);
  background: rgba(255, 255, 255, 0.25);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 1;
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
  z-index: 3;
}

.timeline-thumb:active {
  cursor: grabbing;
}

.timeline-thumb--fine {
  width: 36px;
  height: 36px;
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

.thumb-dot--fine {
  width: 12px;
  height: 12px;
  border-width: 2px;
  border-color: var(--accent-light, #ff8fa8);
}

.timeline-thumb.dragging .thumb-dot {
  transform: scale(1.25);
  box-shadow: 0 2px 12px rgba(233, 69, 96, 0.55);
}

/* ── Fine tune section ── */
.fine-tune-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.fine-tune-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}

.fine-bound {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  min-width: 3.5rem;
}

.fine-bound:first-child {
  text-align: left;
}

.fine-bound:last-child {
  text-align: right;
}

.fine-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.fine-rail {
  height: 32px;
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

  .fine-rail {
    height: 36px;
  }

  .thumb-dot {
    width: 16px;
    height: 16px;
  }

  .thumb-dot--fine {
    width: 14px;
    height: 14px;
  }
}
</style>
