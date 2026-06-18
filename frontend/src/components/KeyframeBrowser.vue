<template>
  <Teleport to="body">
    <Transition name="slide-up">
      <div v-if="visible" class="kf-browser-overlay" @click.self="$emit('close')">
        <div class="kf-browser">
          <header class="kf-header">
            <h2>浏览关键帧</h2>
            <span class="kf-count">{{ keyframes.length }} 帧</span>
            <button class="close-btn" @click="$emit('close')">✕</button>
          </header>

          <div v-if="isLoading" class="kf-loading">
            <div class="loading-spinner"></div>
            <p>加载关键帧...</p>
          </div>

          <div v-else-if="keyframes.length === 0" class="kf-empty">
            <p>暂无关键帧数据</p>
          </div>

          <div v-else ref="scrollContainer" class="kf-scroll">
            <div class="waterfall" :style="{ '--kf-aspect-ratio': aspectRatioCss }">
              <div
                v-for="kf in keyframes"
                :key="kf.timestamp"
                :ref="(el) => setItemRef(kf.timestamp, el)"
                :data-timestamp="kf.timestamp"
                class="waterfall-item"
                :class="{ 'waterfall-item--active': kf.timestamp === activeTimestamp }"
                @click="$emit('select', kf.timestamp)"
              >
                <div class="kf-image-slot">
                  <img
                    v-if="visibleMap[kf.timestamp]"
                    :src="buildFrameUrl(kf.timestamp, 1280)"
                    :alt="`关键帧 ${formatTimeShort(kf.timestamp)}`"
                    class="kf-image"
                    decoding="async"
                  />
                </div>
                <span class="kf-time">{{ formatTimeShort(kf.timestamp) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useMovieApi } from '../composables/useMovieApi'
import { DEFAULT_FPS } from '../utils/frameTimestamp'
import { formatTimeShort } from '../utils/formatTime'

const PRELOAD_NEIGHBORS = 8
const OBSERVER_ROOT_MARGIN = '600px 0px'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  movieId: {
    type: String,
    required: true,
  },
  currentTimestamp: {
    type: Number,
    default: 0,
  },
  resolution: {
    type: String,
    default: '',
  },
  fps: {
    type: Number,
    default: undefined,
  },
  duration: {
    type: Number,
    default: undefined,
  },
})

defineEmits(['close', 'select'])

const { getKeyframes, getFrameUrl } = useMovieApi()

const frameFps = computed(() => props.fps || DEFAULT_FPS)
const frameDuration = computed(() => props.duration ?? Infinity)

const buildFrameUrl = (timestamp, width = 1280) => (
  getFrameUrl(props.movieId, timestamp, width, frameFps.value, frameDuration.value)
)

const keyframes = ref([])
const isLoading = ref(false)
const activeTimestamp = ref(0)
const visibleMap = ref({})
const scrollContainer = ref(null)
const itemRefs = new Map()

let observer = null

const parseAspectRatio = (resolution) => {
  if (!resolution) return '16 / 9'
  const match = resolution.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return '16 / 9'
  return `${match[1]} / ${match[2]}`
}

const aspectRatioCss = computed(() => parseAspectRatio(props.resolution))

const setItemRef = (timestamp, el) => {
  if (el) {
    itemRefs.set(timestamp, el)
  } else {
    itemRefs.delete(timestamp)
  }
}

const markVisible = (timestamp) => {
  if (visibleMap.value[timestamp]) return
  visibleMap.value = { ...visibleMap.value, [timestamp]: true }
}

const findClosestIndex = (t) => {
  if (!keyframes.value.length) return 0
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < keyframes.value.length; i++) {
    const dist = Math.abs(keyframes.value[i].timestamp - t)
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  }
  return bestIdx
}

const preloadAroundIndex = (centerIdx) => {
  const start = Math.max(0, centerIdx - PRELOAD_NEIGHBORS)
  const end = Math.min(keyframes.value.length - 1, centerIdx + PRELOAD_NEIGHBORS)
  for (let i = start; i <= end; i++) {
    markVisible(keyframes.value[i].timestamp)
  }
}

const findClosestTimestamp = (t) => {
  const idx = findClosestIndex(t)
  return keyframes.value[idx]?.timestamp ?? 0
}

const scrollToCurrent = async () => {
  await nextTick()
  const idx = findClosestIndex(props.currentTimestamp)
  const target = keyframes.value[idx]?.timestamp ?? 0
  activeTimestamp.value = target
  preloadAroundIndex(idx)
  requestAnimationFrame(() => {
    const el = itemRefs.get(target)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
    }
  })
}

const setupObserver = () => {
  observer?.disconnect()
  const root = scrollContainer.value
  if (!root) return

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const ts = Number(entry.target.dataset.timestamp)
        if (!Number.isNaN(ts)) {
          markVisible(ts)
        }
      }
    },
    { root, rootMargin: OBSERVER_ROOT_MARGIN, threshold: 0 }
  )

  for (const el of itemRefs.values()) {
    observer.observe(el)
  }
}

const teardownObserver = () => {
  observer?.disconnect()
  observer = null
}

const loadKeyframes = async () => {
  isLoading.value = true
  itemRefs.clear()
  visibleMap.value = {}
  try {
    const data = await getKeyframes(props.movieId)
    keyframes.value = data.keyframes || []
  } catch (error) {
    console.error('Failed to load keyframes:', error)
    keyframes.value = []
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await loadKeyframes()
      await scrollToCurrent()
      await nextTick()
      setupObserver()
    } else {
      teardownObserver()
      visibleMap.value = {}
      itemRefs.clear()
    }
  }
)

onUnmounted(() => {
  teardownObserver()
})
</script>

<style scoped>
.kf-browser-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 9999;
}

.kf-browser {
  width: 100%;
  height: 85vh;
  background-color: var(--bg-secondary);
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.kf-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.kf-header h2 {
  margin: 0;
  font-size: 1.125rem;
  color: var(--text-primary);
  flex: 1;
}

.kf-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: monospace;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 1rem;
  flex-shrink: 0;
}

.kf-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.kf-loading,
.kf-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.waterfall {
  display: flex;
  flex-direction: column;
}

.waterfall-item {
  width: 100%;
  margin-bottom: 2px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  background-color: var(--bg-primary);
  border: 2px solid transparent;
  transition: border-color 0.2s ease;
  box-sizing: border-box;
}

.waterfall-item:active {
  opacity: 0.85;
}

.waterfall-item--active {
  border-color: var(--accent);
  box-shadow: 0 0 12px rgba(233, 69, 96, 0.4);
}

.kf-image-slot {
  width: 100%;
  aspect-ratio: var(--kf-aspect-ratio, 16 / 9);
  background-color: var(--bg-primary);
}

.kf-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background-color: var(--bg-primary);
}

.kf-time {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px 6px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
  color: #fff;
  font-size: 0.625rem;
  font-family: monospace;
  font-weight: 600;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
