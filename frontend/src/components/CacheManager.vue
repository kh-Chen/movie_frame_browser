<template>
  <Teleport to="body">
    <Transition name="slide">
      <div v-if="visible" class="cache-manager-overlay" @click.self="close">
        <div class="cache-manager-panel">
          <!-- Header -->
          <div class="panel-header">
            <h2 class="panel-title">缓存管理</h2>
            <button class="close-btn" @click="close">✕</button>
          </div>
          
          <!-- Content -->
          <div class="panel-content">
            <!-- Overview -->
            <div class="cache-overview">
              <div class="overview-item">
                <span class="overview-label">帧缓存</span>
                <span class="overview-value">{{ formatSize(stats.frameCacheSize) }}</span>
              </div>
              <div class="overview-item total">
                <span class="overview-label">总计</span>
                <span class="overview-value">{{ formatSize(stats.totalSize) }}</span>
              </div>
            </div>
            
            <!-- Usage bar -->
            <div class="usage-section">
              <div class="usage-header">
                <span>存储使用</span>
                <span class="usage-percent">{{ usagePercent }}%</span>
              </div>
              <div class="usage-bar">
                <div 
                  class="usage-fill" 
                  :style="{ width: `${usagePercent}%` }"
                  :class="usageClass"
                ></div>
              </div>
              <div class="usage-hint">
                最多使用 {{ formatSize(maxStorage) }}
              </div>
            </div>
            
            <!-- Movie caches -->
            <div class="movie-caches">
              <h3 class="section-title">电影缓存</h3>
              
              <div v-if="loadingMovies" class="loading-state">
                <div class="loading-spinner small"></div>
                <span>加载中...</span>
              </div>
              
              <div v-else-if="movieCaches.length === 0" class="empty-state">
                <span>暂无缓存</span>
              </div>
              
              <div v-else class="movie-list">
                <div 
                  v-for="movie in movieCaches" 
                  :key="movie.id"
                  class="movie-item"
                >
                  <div class="movie-info">
                    <span class="movie-name">{{ movie.name }}</span>
                    <span class="movie-size">{{ formatSize(movie.cacheSize) }}</span>
                  </div>
                  <div class="movie-actions">
                    <button
                      class="view-btn"
                      @click="goToGallery(movie.id)"
                    >
                      查看
                    </button>
                    <button 
                      class="delete-btn"
                      @click="deleteMovieCache(movie.id)"
                      :disabled="deletingId === movie.id"
                    >
                      {{ deletingId === movie.id ? '删除中...' : '删除' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="panel-footer">
            <button class="clear-all-btn" @click="clearAllCache" :disabled="isClearing">
              {{ isClearing ? '清理中...' : '清理所有缓存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatFileSize } from '../utils/formatTime'
import { useMovieApi } from '../composables/useMovieApi'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'cleared'])

const router = useRouter()
const { getCacheStats, clearCache, getMovies } = useMovieApi()

// State
const loadingMovies = ref(false)
const isClearing = ref(false)
const deletingId = ref(null)
const stats = ref({
  frameCacheSize: 0,
  totalSize: 0,
  movies: [],
})
const movies = ref([])
const maxStorage = ref(10 * 1024 * 1024 * 1024)

const usagePercent = computed(() => {
  if (!maxStorage.value) return 0
  return Math.min(100, Math.round((stats.value.totalSize / maxStorage.value) * 100))
})

const usageClass = computed(() => {
  if (usagePercent.value > 80) return 'danger'
  if (usagePercent.value > 60) return 'warning'
  return 'normal'
})

const movieCaches = computed(() => {
  return (stats.value.movies || []).map((movie) => ({
    id: movie.id,
    name: movie.name,
    cacheSize: movie.cacheSize || 0,
  }))
})

// Format size
const formatSize = (bytes) => {
  return formatFileSize(bytes)
}

// Load cache stats
const loadStats = async () => {
  try {
    const data = await getCacheStats()
    stats.value = {
      frameCacheSize: data.frameCacheSize ?? data.breakdown?.frames ?? 0,
      totalSize: data.total ?? 0,
      movies: data.movies || [],
    }
    if (data.maxSize) {
      maxStorage.value = data.maxSize
    }
  } catch (error) {
    console.error('Failed to load cache stats:', error)
    stats.value = {
      frameCacheSize: 0,
      totalSize: 0,
      movies: [],
    }
  }
}

// Load movies
const loadMovies = async () => {
  loadingMovies.value = true
  try {
    const data = await getMovies()
    movies.value = data.movies || []
  } catch (error) {
    console.error('Failed to load movies:', error)
    movies.value = []
  } finally {
    loadingMovies.value = false
  }
}

// Clear all cache
const clearAllCache = async () => {
  isClearing.value = true
  try {
    await clearCache()
    await loadStats()
    emit('cleared')
  } catch (error) {
    console.error('Failed to clear cache:', error)
  } finally {
    isClearing.value = false
  }
}

// Delete movie cache
const deleteMovieCache = async (movieId) => {
  deletingId.value = movieId
  try {
    await clearCache(movieId)
    await loadStats()
  } catch (error) {
    console.error('Failed to delete movie cache:', error)
  } finally {
    deletingId.value = null
  }
}

// Close panel
const close = () => {
  emit('close')
}

const goToGallery = (movieId) => {
  close()
  router.push({ name: 'gallery', params: { id: movieId } })
}

// Watch for visibility changes
watch(() => props.visible, (visible) => {
  if (visible) {
    loadStats()
    loadMovies()
  }
})
</script>

<style scoped>
.cache-manager-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 9999;
}

.cache-manager-panel {
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  background-color: var(--bg-secondary);
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.panel-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.cache-overview {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.overview-item {
  background-color: var(--bg-primary);
  border-radius: 12px;
  padding: 12px;
  text-align: center;
}

.overview-item.total {
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
}

.overview-label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.overview-item.total .overview-label {
  color: rgba(255, 255, 255, 0.8);
}

.overview-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.overview-item.total .overview-value {
  color: white;
}

.usage-section {
  margin-bottom: 24px;
}

.usage-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.usage-percent {
  color: var(--text-primary);
  font-weight: 600;
}

.usage-bar {
  height: 8px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.usage-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.usage-fill.normal {
  background-color: var(--accent);
}

.usage-fill.warning {
  background-color: #ffc107;
}

.usage-fill.danger {
  background-color: #f44336;
}

.usage-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 12px;
}

.movie-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.movie-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background-color: var(--bg-primary);
  border-radius: 12px;
}

.movie-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.movie-name {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.movie-size {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.movie-actions {
  display: flex;
  gap: 8px;
}

.view-btn {
  padding: 8px 12px;
  background-color: rgba(233, 30, 99, 0.1);
  border: none;
  border-radius: 8px;
  color: var(--accent);
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.view-btn:hover {
  background-color: rgba(233, 30, 99, 0.2);
}

.delete-btn {
  padding: 8px 16px;
  background-color: rgba(244, 67, 54, 0.1);
  border: none;
  border-radius: 8px;
  color: #f44336;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.delete-btn:hover:not(:disabled) {
  background-color: rgba(244, 67, 54, 0.2);
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.loading-spinner.small {
  width: 20px;
  height: 20px;
  border-width: 2px;
}

.panel-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.clear-all-btn {
  width: 100%;
  padding: 14px;
  background-color: rgba(244, 67, 54, 0.1);
  border: 1px solid rgba(244, 67, 54, 0.3);
  border-radius: 12px;
  color: #f44336;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.clear-all-btn:hover:not(:disabled) {
  background-color: rgba(244, 67, 54, 0.2);
}

.clear-all-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Transitions */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
}

.slide-enter-active .cache-manager-panel,
.slide-leave-active .cache-manager-panel {
  transition: transform 0.3s ease;
}

.slide-enter-from .cache-manager-panel,
.slide-leave-to .cache-manager-panel {
  transform: translateY(100%);
}

/* Mobile optimizations */
@media (max-width: 480px) {
  .cache-overview {
    grid-template-columns: 1fr;
  }
}
</style>