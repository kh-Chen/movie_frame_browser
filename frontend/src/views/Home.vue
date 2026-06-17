<template>
  <div class="home-page">
    <!-- Header -->
    <header class="page-header">
      <h1 class="page-title">电影帧浏览</h1>
      <div class="header-actions">
        <button class="header-btn" @click="showTaskQueue = true" title="任务队列">
          <span>📋</span>
        </button>
        <button class="header-btn" @click="showCacheManager = true" title="缓存管理">
          <span>💾</span>
        </button>
      </div>
    </header>
    
    <!-- Main content -->
    <main class="page-content">
      <section class="select-section">
        <UploadButton
          @select-success="handleSelectSuccess"
          @select-error="handleSelectError"
        />
      </section>
      
      <!-- Movie list -->
      <section class="movie-section">
        <h2 class="section-title">
          我的电影
          <span class="movie-count">({{ movies.length }})</span>
        </h2>
        
        <!-- Loading state -->
        <div v-if="isLoading" class="loading-container">
          <div class="loading-spinner"></div>
          <p>加载中...</p>
        </div>
        
        <!-- Empty state -->
        <div v-else-if="movies.length === 0" class="empty-state">
          <span class="empty-icon">🎬</span>
          <p class="empty-text">暂无电影</p>
          <p class="empty-hint">点击上方按钮从本地目录添加电影</p>
        </div>
        
        <!-- Movie grid -->
        <div v-else class="movie-grid">
          <MovieCard
            v-for="movie in movies"
            :key="movie.id"
            :movie="movie"
          />
        </div>
      </section>
    </main>
    
    <!-- Cache Manager Panel -->
    <CacheManager 
      :visible="showCacheManager"
      @close="showCacheManager = false"
      @cleared="handleCacheCleared"
    />

    <!-- Task Queue Panel -->
    <TaskQueuePanel
      :visible="showTaskQueue"
      @close="showTaskQueue = false"
    />
    
    <!-- Loading overlay -->
    <LoadingOverlay 
      :visible="showGlobalLoading"
      :text="globalLoadingText"
    />
    
    <!-- Toast notification -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toast.visible" class="toast" :class="toast.type">
          {{ toast.message }}
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useMovieStore } from '../stores/movieStore'
import { useMovieApi } from '../composables/useMovieApi'
import MovieCard from '../components/MovieCard.vue'
import UploadButton from '../components/UploadButton.vue'
import CacheManager from '../components/CacheManager.vue'
import TaskQueuePanel from '../components/TaskQueuePanel.vue'
import LoadingOverlay from '../components/LoadingOverlay.vue'

const store = useMovieStore()
const { getMovies } = useMovieApi()

// State
const isLoading = ref(false)
const showCacheManager = ref(false)
const showTaskQueue = ref(false)
const showGlobalLoading = ref(false)
const globalLoadingText = ref('')
// Toast
const toast = ref({
  visible: false,
  message: '',
  type: 'info' // 'info' | 'success' | 'error'
})

// Computed
const movies = computed(() => store.movies)

// Load movies
const loadMovies = async () => {
  isLoading.value = true
  try {
    const data = await getMovies()
    store.setMovies(data.movies || [])
  } catch (error) {
    console.error('Failed to load movies:', error)
    showToast('加载电影列表失败', 'error')
    store.setMovies([])
  } finally {
    isLoading.value = false
  }
}

const handleSelectSuccess = (payload) => {
  if (payload?.completed) {
    showToast('电影处理完成', 'success')
    loadMovies()
    return
  }
  if (payload?.movieId) {
    showToast('电影已添加，正在处理…', 'info')
    setTimeout(loadMovies, 500)
  }
}

const handleSelectError = (error) => {
  showToast(error?.message || '添加失败', 'error')
}

// Handle cache cleared
const handleCacheCleared = () => {
  showToast('缓存已清理', 'success')
}

// Show toast
const showToast = (message, type = 'info') => {
  toast.value = {
    visible: true,
    message,
    type
  }
  
  setTimeout(() => {
    toast.value.visible = false
  }, 3000)
}

// Load movies on mount
onMounted(() => {
  loadMovies()
})
</script>

<style scoped>
.home-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background-color: var(--bg-secondary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.header-btn {
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
  transition: background-color 0.2s ease;
}

.header-btn:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.page-content {
  flex: 1;
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.select-section {
  margin-bottom: 32px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px;
}

.movie-count {
  font-weight: 400;
  color: var(--text-secondary);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-secondary);
  gap: 16px;
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

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 4rem;
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-text {
  margin: 0 0 8px;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-hint {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.movie-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

/* Tablet and up */
@media (min-width: 768px) {
  .page-content {
    padding: 32px;
  }
  
  .movie-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
}

@media (min-width: 1024px) {
  .movie-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 12px;
  font-size: 0.875rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 10001;
}

.toast.success {
  background-color: #4caf50;
}

.toast.error {
  background-color: #f44336;
}

.toast.info {
  background-color: var(--bg-secondary);
}

/* Toast transitions */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
</style>