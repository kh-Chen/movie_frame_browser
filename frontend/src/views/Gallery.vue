<template>
  <div class="gallery-page">
    <header class="page-header">
      <button class="back-btn" @click="goBack">
        <span>←</span>
      </button>
      <div class="header-info">
        <h1 class="page-title">{{ movie?.name || '媒体库' }}</h1>
        <span class="subtitle">已生成的帧与片段</span>
      </div>
    </header>

    <div v-if="isLoading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>加载中...</p>
    </div>

    <main v-else class="page-content">
      <!-- Tabs -->
      <div class="tab-bar">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'frames' }"
          @click="activeTab = 'frames'"
        >
          帧图片 ({{ frames.length }})
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'clips' }"
          @click="activeTab = 'clips'"
        >
          片段 ({{ clips.length }})
        </button>
      </div>

      <!-- Frames grid -->
      <section v-if="activeTab === 'frames'" class="media-section">
        <div v-if="frames.length === 0" class="empty-state">
          <span class="empty-icon">🖼️</span>
          <p>暂无已缓存的帧图片</p>
          <p class="empty-hint">浏览电影时会按需生成并缓存帧图片</p>
          <button class="action-link" @click="goToBrowse">去浏览电影</button>
        </div>
        <div v-else class="media-grid">
          <div
            v-for="frame in frames"
            :key="frame.timestamp"
            class="media-card"
            :class="{ 'media-card--keyframe': frame.isKeyframe }"
            @click="openFrame(frame)"
          >
            <div class="thumb-wrap">
              <img
                :src="getFrameUrl(movieId, frame.timestamp, 320)"
                :alt="`Frame at ${formatTime(frame.timestamp)}`"
                class="media-thumb"
                loading="lazy"
              />
              <span v-if="frame.isKeyframe" class="keyframe-badge">关键帧</span>
            </div>
            <div class="media-info">
              <span class="media-time">{{ formatTime(frame.timestamp) }}</span>
              <span class="media-size">{{ formatSize(frame.size) }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Clips grid -->
      <section v-if="activeTab === 'clips'" class="media-section">
        <div v-if="clips.length === 0" class="empty-state">
          <span class="empty-icon">🎬</span>
          <p>暂无已生成的片段</p>
          <p class="empty-hint">在浏览页面点击预览可生成片段</p>
          <button class="action-link" @click="goToBrowse">去浏览电影</button>
        </div>
        <div v-else class="media-grid clips-grid">
          <div
            v-for="clip in clips"
            :key="`${clip.timestamp}`"
            class="media-card clip-card"
            @click="openClip(clip)"
          >
            <div class="clip-thumb">
              <img
                :src="getFrameUrl(movieId, clip.timestamp, 320)"
                :alt="`Clip ${formatClipRange(clip)}`"
                class="media-thumb"
                loading="lazy"
              />
              <div class="play-overlay">
                <span class="play-icon">▶</span>
              </div>
            </div>
            <div class="media-info">
              <span class="media-time clip-range">{{ formatClipRange(clip) }}</span>
              <span class="media-size">{{ formatSize(clip.size) }}</span>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Frame lightbox -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="selectedFrame" class="lightbox-overlay" @click.self="selectedFrame = null">
          <div class="lightbox-content">
            <button class="lightbox-close" @click="selectedFrame = null">✕</button>
            <img
              :src="getFrameUrl(movieId, selectedFrame.timestamp, 1280)"
              :alt="`Frame at ${formatTime(selectedFrame.timestamp)}`"
              class="lightbox-image"
            />
            <div class="lightbox-footer">
              <span>{{ formatTime(selectedFrame.timestamp) }}</span>
              <button class="lightbox-action" @click="goToBrowseAt(selectedFrame.timestamp)">
                在浏览页查看
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <ClipPreview
      :visible="showClip"
      :movie-id="movieId"
      :timestamp="selectedClipTimestamp"
      @close="showClip = false"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMovieApi } from '../composables/useMovieApi'
import { formatTime, formatTimeShort, formatFileSize } from '../utils/formatTime'
import ClipPreview from '../components/ClipPreview.vue'

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
})

const router = useRouter()
const { getMovie, getCachedFrames, getCachedClips, getFrameUrl } = useMovieApi()

const movieId = props.id
const movie = ref(null)
const frames = ref([])
const clips = ref([])
const isLoading = ref(true)
const activeTab = ref('frames')
const selectedFrame = ref(null)
const showClip = ref(false)
const selectedClipTimestamp = ref(0)

const formatSize = (bytes) => formatFileSize(bytes)

const formatClipRange = (clip) => {
  if (clip.startTime != null && clip.endTime != null) {
    return `${formatTimeShort(clip.startTime)} ~ ${formatTimeShort(clip.endTime)}`
  }
  const seekBack = 1
  const seekForward = 5
  const start = Math.max(0, clip.timestamp - seekBack)
  const end = clip.timestamp + seekForward
  return `${formatTimeShort(start)} ~ ${formatTimeShort(end)}`
}

const loadData = async () => {
  isLoading.value = true
  try {
    const [movieData, framesData, clipsData] = await Promise.all([
      getMovie(movieId),
      getCachedFrames(movieId),
      getCachedClips(movieId),
    ])
    movie.value = movieData
    frames.value = framesData.frames || []
    clips.value = clipsData.clips || []
  } catch (error) {
    console.error('Failed to load gallery data:', error)
    frames.value = []
    clips.value = []
  } finally {
    isLoading.value = false
  }
}

const openFrame = (frame) => {
  selectedFrame.value = frame
}

const openClip = (clip) => {
  selectedClipTimestamp.value = clip.timestamp
  showClip.value = true
}

const goBack = () => {
  router.back()
}

const goToBrowse = () => {
  router.push({ name: 'browse', params: { id: movieId } })
}

const goToBrowseAt = (timestamp) => {
  router.push({ name: 'browse', params: { id: movieId }, query: { t: timestamp } })
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.gallery-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background-color: var(--bg-secondary);
  position: sticky;
  top: 0;
  z-index: 100;
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

.page-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitle {
  font-size: 0.75rem;
  color: var(--text-secondary);
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
  to { transform: rotate(360deg); }
}

.page-content {
  flex: 1;
  padding: 16px 20px 32px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.tab-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  background-color: var(--bg-primary);
  border-radius: 12px;
  padding: 4px;
}

.tab-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  background: transparent;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.tab-btn.active {
  background-color: var(--accent);
  color: white;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 768px) {
  .media-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
}

@media (min-width: 1024px) {
  .media-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.media-card {
  background-color: var(--bg-secondary);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.media-card:active {
  transform: scale(0.98);
}

.media-card--keyframe {
  border-color: rgba(233, 69, 96, 0.45);
}

.thumb-wrap {
  position: relative;
}

.keyframe-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(233, 69, 96, 0.9);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.media-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
  background-color: var(--bg-primary);
}

.clip-thumb {
  position: relative;
}

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.3);
}

.play-icon {
  width: 40px;
  height: 40px;
  background-color: rgba(233, 30, 99, 0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1rem;
}

.media-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
}

.media-time {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: monospace;
}

.clip-range {
  font-size: 0.7rem;
  letter-spacing: -0.02em;
}

.media-size {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 3rem;
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-state p {
  margin: 0 0 8px;
  font-size: 1rem;
  color: var(--text-primary);
}

.empty-hint {
  font-size: 0.875rem !important;
  color: var(--text-secondary) !important;
  margin-bottom: 20px !important;
}

.action-link {
  padding: 10px 24px;
  background-color: var(--accent);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

/* Lightbox */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.lightbox-content {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lightbox-close {
  position: absolute;
  top: -40px;
  right: 0;
  width: 36px;
  height: 36px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  color: white;
  font-size: 1rem;
  cursor: pointer;
  z-index: 1;
}

.lightbox-image {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 8px;
  object-fit: contain;
}

.lightbox-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  color: white;
  font-family: monospace;
}

.lightbox-action {
  padding: 8px 16px;
  background-color: var(--accent);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 0.875rem;
  cursor: pointer;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
