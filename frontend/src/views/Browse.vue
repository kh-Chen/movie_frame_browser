<template>
  <div class="browse-page">
    <!-- Header -->
    <header class="page-header">
      <button class="back-btn" @click="goBack">
        <span>←</span>
      </button>
      <div class="header-info">
        <h1 class="movie-title">{{ movie?.name || '加载中...' }}</h1>
        <span class="progress-text">{{ progressText }}</span>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="showInfo = true" title="电影信息">
          <span>ℹ️</span>
        </button>
        <button class="action-btn danger" @click="confirmDelete" title="删除电影">
          <span>🗑️</span>
        </button>
      </div>
    </header>
    
    <!-- Loading state -->
    <div v-if="isLoading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>加载电影信息...</p>
    </div>
    
    <!-- Main content -->
    <main v-else class="page-content">
      <!-- Frame display -->
      <section class="frame-section">
        <FrameDisplay
          :src="currentFrameUrl"
          :timestamp="currentTimestamp"
          :is-loading="isFrameLoading(currentTimestamp)"
          :clip-mode="isClipMode"
          :clip-url="clipUrl"
          :clip-loading="clipLoading"
          :clip-loading-text="clipLoadingText"
          :clip-loading-progress="clipLoadingProgress"
          :clip-error="clipHasError"
          :clip-time-range="clipTimeRange"
          :can-continue-clip="canContinueClip"
          @step="stepFrame"
          @exit-clip="stopClipPreview"
          @clip-error="markClipError"
          @clip-ended="handleClipEnded"
          @clip-continue="continueClipSegment"
        />
      </section>

      <!-- Seek toolbar -->
      <section class="seek-toolbar">
        <button type="button" class="toolbar-btn" @click="seekBy(-60)">-60s</button>
        <button type="button" class="toolbar-btn" @click="seekBy(-30)">-30s</button>
        <button type="button" class="toolbar-btn" @click="seekBy(-10)">-10s</button>
        <button
          type="button"
          class="toolbar-btn toolbar-btn--accent"
          :class="{ 'toolbar-btn--active': isClipMode }"
          @click="toggleClipPreview"
        >
          {{ isClipMode ? '停止' : '预览' }}
        </button>
        <button type="button" class="toolbar-btn" @click="seekBy(10)">+10s</button>
        <button type="button" class="toolbar-btn" @click="seekBy(30)">+30s</button>
        <button type="button" class="toolbar-btn" @click="seekBy(60)">+60s</button>
      </section>
      
      <!-- Timeline -->
      <section class="timeline-section">
        <Timeline 
          :duration="movie?.duration || 0"
          :current-time="currentTimestamp"
          @seek="handleSeek"
          @dragging="handleDragging"
        />
      </section>
      
      <!-- Action bar -->
      <section class="action-bar">
        <button class="action-item" @click="goToGallery">
          <span class="action-icon">📁</span>
          <span class="action-label">媒体库</span>
        </button>
        <button class="action-item" @click="goToCover">
          <span class="action-icon">🖼️</span>
          <span class="action-label">封面</span>
        </button>
        <button class="action-item" @click="showInfo = true">
          <span class="action-icon">ℹ️</span>
          <span class="action-label">信息</span>
        </button>
        <button class="action-item" @click="confirmDelete">
          <span class="action-icon">🗑️</span>
          <span class="action-label">删除</span>
        </button>
      </section>
    </main>
    
    <!-- Movie Info Modal -->
    <Teleport to="body">
      <Transition name="slide-up">
        <div v-if="showInfo" class="info-modal-overlay" @click.self="showInfo = false">
          <div class="info-modal">
            <div class="modal-header">
              <h2>电影信息</h2>
              <button class="close-btn" @click="showInfo = false">✕</button>
            </div>
            <div class="modal-content">
              <div class="info-row">
                <span class="info-label">名称</span>
                <span class="info-value">{{ movie?.name }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">原始文件</span>
                <span class="info-value">{{ movie?.originalName }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">时长</span>
                <span class="info-value">{{ formatDuration(movie?.duration) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">分辨率</span>
                <span class="info-value">{{ movie?.resolution }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">编码</span>
                <span class="info-value">{{ movie?.codec || '未知' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">文件大小</span>
                <span class="info-value">{{ formatFileSize(movie?.size) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">帧间隔</span>
                <span class="info-value">{{ movie?.frameInterval || 60 }}秒</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    
    <!-- Delete confirmation -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showDeleteConfirm" class="confirm-overlay" @click.self="showDeleteConfirm = false">
          <div class="confirm-modal">
            <h3>确认删除</h3>
            <p>确定要删除电影「{{ movie?.name }}」吗？此操作不可撤销。</p>
            <div class="confirm-actions">
              <button class="cancel-btn" @click="showDeleteConfirm = false">取消</button>
              <button class="delete-btn" @click="deleteMovie" :disabled="isDeleting">
                {{ isDeleting ? '删除中...' : '删除' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    
    <!-- Loading overlay -->
    <LoadingOverlay 
      :visible="isDeleting"
      text="正在删除..."
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMovieStore } from '../stores/movieStore'
import { useMovieApi } from '../composables/useMovieApi'
import { useFrameLoader } from '../composables/useFrameLoader'
import { formatDuration, formatFileSize, formatTimeShort } from '../utils/formatTime'
import FrameDisplay from '../components/FrameDisplay.vue'
import Timeline from '../components/Timeline.vue'
import LoadingOverlay from '../components/LoadingOverlay.vue'
import { useClipLoader } from '../composables/useClipLoader'

const props = defineProps({
  id: {
    type: String,
    required: true
  }
})

const router = useRouter()
const route = useRoute()
const store = useMovieStore()
const { getMovie, deleteMovie: apiDeleteMovie, getFrameUrl, getKeyframe } = useMovieApi()
const { preloadFrames, isLoading: isFrameLoading } = useFrameLoader()

// State
const movieId = ref(props.id)
const movie = ref(null)
const isLoading = ref(true)
const currentTimestamp = ref(0)
const isClipMode = ref(false)

const {
  isLoading: clipLoading,
  loadingProgress: clipLoadingProgress,
  loadingText: clipLoadingText,
  clipUrl,
  hasError: clipHasError,
  timeRange: clipTimeRange,
  getNextTimestamp,
  loadClip,
  preloadNextClip,
  continueToNextClip,
  reset: resetClip,
  markError: markClipError,
} = useClipLoader(movieId.value)
const showInfo = ref(false)
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)

// Preload state
let preloadTimer = null

const PRELOAD_RANGE_SEC = 1

// Computed
const currentFrameUrl = computed(() => {
  if (!movie.value || currentTimestamp.value === null) return null
  return getFrameUrl(movieId.value, currentTimestamp.value)
})

const progressText = computed(() => {
  if (!movie.value) return ''
  const percent = Math.round((currentTimestamp.value / movie.value.duration) * 100)
  return `${formatTimeShort(currentTimestamp.value)} / ${formatTimeShort(movie.value.duration)} (${percent}%)`
})

const canContinueClip = computed(() => {
  if (!movie.value) return false
  return getNextTimestamp(movie.value.duration) != null
})

// Load movie
const loadMovie = async () => {
  isLoading.value = true
  try {
    const data = await getMovie(movieId.value)
    movie.value = data
    store.setCurrentMovie(data)

    const queryTime = parseFloat(route.query.t)
    if (!isNaN(queryTime) && queryTime >= 0 && queryTime <= data.duration) {
      currentTimestamp.value = queryTime
      schedulePreload(queryTime)
    } else {
      currentTimestamp.value = 0
      schedulePreload(0)
    }
  } catch (error) {
    console.error('Failed to load movie:', error)
    movie.value = null
  } finally {
    isLoading.value = false
  }
}

// Step by adjacent keyframe (swipe / arrow keys)
const stopClipPreview = () => {
  if (!isClipMode.value) return
  isClipMode.value = false
  resetClip()
}

const seekBy = (deltaSec) => {
  if (!movie.value) return
  stopClipPreview()
  const next = Math.max(
    0,
    Math.min(movie.value.duration, currentTimestamp.value + deltaSec)
  )
  if (next === currentTimestamp.value) return
  currentTimestamp.value = next
  schedulePreload(next)
}

const stepFrame = async (direction) => {
  if (!movie.value) return
  stopClipPreview()
  try {
    const data = await getKeyframe(movieId.value, currentTimestamp.value, direction)
    const next = data.timestamp
    if (next === currentTimestamp.value) return
    currentTimestamp.value = next
    schedulePreload(next)
  } catch (error) {
    console.error('Keyframe step failed:', error)
  }
}

// Handle seek
const handleSeek = (timestamp) => {
  stopClipPreview()
  currentTimestamp.value = timestamp
}

// Handle dragging
const handleDragging = (timestamp) => {
  if (isClipMode.value) {
    stopClipPreview()
  }
  currentTimestamp.value = timestamp
  // Cancel any scheduled preload during drag
  if (preloadTimer) {
    clearTimeout(preloadTimer)
    preloadTimer = null
  }
}

// Schedule preload after 300ms of no activity
const schedulePreload = (timestamp) => {
  if (preloadTimer) {
    clearTimeout(preloadTimer)
  }
  
  preloadTimer = setTimeout(() => {
    preloadFrames(movieId.value, timestamp, PRELOAD_RANGE_SEC)
  }, 300)
}

const handleKeydown = (event) => {
  if (showInfo.value || showDeleteConfirm.value) return
  if (isClipMode.value) return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    stepFrame(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    stepFrame(1)
  }
}

const toggleClipPreview = async () => {
  if (isClipMode.value) {
    stopClipPreview()
    return
  }
  isClipMode.value = true
  await loadClip(currentTimestamp.value)
}

const handleClipEnded = () => {
  if (!movie.value || !canContinueClip.value) return
  preloadNextClip(movie.value.duration)
}

const continueClipSegment = async () => {
  if (!movie.value) return
  const nextTs = await continueToNextClip(movie.value.duration)
  if (nextTs == null) return
  currentTimestamp.value = nextTs
  schedulePreload(nextTs)
}

// Go to gallery
const goToGallery = () => {
  router.push({ name: 'gallery', params: { id: movieId.value } })
}

// Go to cover
const goToCover = () => {
  stopClipPreview()
  currentTimestamp.value = 0
  schedulePreload(0)
}

// Go back
const goBack = () => {
  router.push('/')
}

// Confirm delete
const confirmDelete = () => {
  showDeleteConfirm.value = true
}

// Delete movie
const deleteMovie = async () => {
  isDeleting.value = true
  try {
    await apiDeleteMovie(movieId.value)
    store.removeMovie(movieId.value)
    showDeleteConfirm.value = false
    router.push('/')
  } catch (error) {
    console.error('Failed to delete movie:', error)
    showDeleteConfirm.value = false
  } finally {
    isDeleting.value = false
  }
}

// Handle back button/gesture
const handlePopState = () => {
  // Cleanup on back navigation
}

// Watch for movie changes
watch(movieId, () => {
  loadMovie()
})

// Lifecycle
onMounted(() => {
  loadMovie()
  window.addEventListener('popstate', handlePopState)
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  if (preloadTimer) {
    clearTimeout(preloadTimer)
  }
  resetClip()
  window.removeEventListener('popstate', handlePopState)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.browse-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
}

.page-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--bg-secondary);
  gap: 12px;
}

.back-btn {
  width: 40px;
  height: 40px;
  border: none;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-info {
  flex: 1;
  min-width: 0;
}

.movie-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: monospace;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  width: 40px;
  height: 40px;
  border: none;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 1.125rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn.danger:hover {
  background-color: rgba(244, 67, 54, 0.3);
}

.loading-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.page-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.frame-section {
  flex: 1;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-primary);
}

.frame-section :deep(.frame-display) {
  width: 100%;
  height: 100%;
}

.timeline-section {
  position: relative;
}

.seek-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px;
  background-color: var(--bg-secondary);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.toolbar-btn {
  flex: 0 0 auto;
  padding: 5px 2px;
  border: none;
  border-radius: 8px;
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease;
}

.toolbar-btn:active {
  transform: scale(0.96);
}

.toolbar-btn:hover {
  background-color: rgba(255, 255, 255, 0.12);
}

.toolbar-btn--accent {
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  color: #fff;
  box-shadow: 0 2px 8px rgba(233, 69, 96, 0.35);
}

.toolbar-btn--accent:hover {
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  filter: brightness(1.08);
}

.toolbar-btn--active {
  background: rgba(255, 255, 255, 0.18);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.toolbar-btn--accent.toolbar-btn--active {
  background: rgba(233, 69, 96, 0.35);
  box-shadow: inset 0 0 0 1px rgba(233, 69, 96, 0.5);
  filter: none;
}

.action-bar {
  display: flex;
  justify-content: space-around;
  padding: 16px;
  background-color: var(--bg-secondary);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.action-item:hover:not(:disabled) {
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.05);
}

.action-item--accent {
  color: var(--accent);
}

.action-item--accent:hover {
  color: #fff;
  background-color: rgba(233, 69, 96, 0.25);
}

.action-icon {
  font-size: 1.25rem;
}

.action-label {
  font-size: 0.75rem;
}

/* Info modal */
.info-modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 9999;
}

.info-modal {
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  background-color: var(--bg-secondary);
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.125rem;
  color: var(--text-primary);
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
}

.modal-content {
  padding: 20px;
  overflow-y: auto;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.info-value {
  color: var(--text-primary);
  font-size: 0.875rem;
  text-align: right;
  max-width: 60%;
  word-break: break-all;
}

/* Confirm modal */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.confirm-modal {
  background-color: var(--bg-secondary);
  border-radius: 16px;
  padding: 24px;
  max-width: 320px;
  width: 100%;
}

.confirm-modal h3 {
  margin: 0 0 12px;
  font-size: 1.125rem;
  color: var(--text-primary);
}

.confirm-modal p {
  margin: 0 0 20px;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 12px;
}

.cancel-btn,
.delete-btn {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 10px;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.cancel-btn {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.delete-btn {
  background-color: #f44336;
  color: white;
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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