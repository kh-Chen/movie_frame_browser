<template>
  <div class="movie-detail-page">
    <!-- Header -->
    <header class="page-header">
      <button class="back-btn" @click="goBack">
        <span>←</span>
      </button>
      <h1 class="page-title">电影详情</h1>
    </header>
    
    <!-- Loading state -->
    <div v-if="isLoading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>加载中...</p>
    </div>
    
    <!-- Content -->
    <main v-else-if="movie" class="page-content">
      <!-- Cover -->
      <section class="cover-section">
        <img 
          v-if="coverUrl" 
          :src="coverUrl" 
          :alt="movie.name"
          class="cover-image"
        />
        <div v-else class="cover-placeholder">
          <span>🎬</span>
        </div>
      </section>
      
      <!-- Info -->
      <section class="info-section">
        <h2 class="movie-name">{{ movie.name }}</h2>
        <p class="original-name">{{ movie.originalName }}</p>
        
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">时长</span>
            <span class="info-value">{{ formatDuration(movie.duration) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">分辨率</span>
            <span class="info-value">{{ movie.resolution || '未知' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">编码</span>
            <span class="info-value">{{ movie.codec || '未知' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">文件大小</span>
            <span class="info-value">{{ formatFileSize(movie.size) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">帧间隔</span>
            <span class="info-value">{{ movie.frameInterval || 60 }}秒</span>
          </div>
          <div class="info-item">
            <span class="info-label">上传时间</span>
            <span class="info-value">{{ formatDate(movie.uploadedAt) }}</span>
          </div>
        </div>
      </section>
      
      <!-- Actions -->
      <section class="actions-section">
        <button class="action-btn primary" @click="startBrowsing">
          <span>🎬</span>
          开始浏览
        </button>
        <button class="action-btn danger" @click="confirmDelete">
          <span>🗑️</span>
          删除电影
        </button>
      </section>
    </main>
    
    <!-- Empty state -->
    <div v-else class="empty-state">
      <span class="empty-icon">❌</span>
      <p>电影不存在</p>
      <button class="back-home-btn" @click="goBack">返回首页</button>
    </div>
    
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
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMovieStore } from '../stores/movieStore'
import { useMovieApi } from '../composables/useMovieApi'
import { formatDuration, formatFileSize } from '../utils/formatTime'
import LoadingOverlay from '../components/LoadingOverlay.vue'

const props = defineProps({
  id: {
    type: String,
    required: true
  }
})

const router = useRouter()
const store = useMovieStore()
const { getMovie, deleteMovie: apiDeleteMovie, getCoverUrl } = useMovieApi()

// State
const movie = ref(null)
const isLoading = ref(true)
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)

// Computed
const coverUrl = computed(() => {
  if (!movie.value) return null
  return getCoverUrl(movie.value.id)
})

// Load movie
const loadMovie = async () => {
  isLoading.value = true
  try {
    const data = await getMovie(props.id)
    movie.value = data
  } catch (error) {
    console.error('Failed to load movie:', error)
    movie.value = null
  } finally {
    isLoading.value = false
  }
}

// Format date
const formatDate = (dateStr) => {
  if (!dateStr) return '未知'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

// Go back
const goBack = () => {
  router.back()
}

// Start browsing
const startBrowsing = () => {
  router.push({ name: 'browse', params: { id: props.id } })
}

// Confirm delete
const confirmDelete = () => {
  showDeleteConfirm.value = true
}

// Delete movie
const deleteMovie = async () => {
  isDeleting.value = true
  try {
    await apiDeleteMovie(props.id)
    store.removeMovie(props.id)
    showDeleteConfirm.value = false
    router.push('/')
  } catch (error) {
    console.error('Failed to delete movie:', error)
    showDeleteConfirm.value = false
  } finally {
    isDeleting.value = false
  }
}

// Lifecycle
onMounted(() => {
  loadMovie()
})
</script>

<style scoped>
.movie-detail-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
}

.page-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
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

.page-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.loading-container,
.empty-state {
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

.empty-icon {
  font-size: 3rem;
}

.back-home-btn {
  padding: 12px 24px;
  background-color: var(--accent);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}

.page-content {
  flex: 1;
  padding: 20px;
}

.cover-section {
  margin-bottom: 24px;
}

.cover-image {
  width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 12px;
  background-color: var(--bg-secondary);
}

.cover-placeholder {
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-secondary);
  border-radius: 12px;
  font-size: 4rem;
  opacity: 0.5;
}

.info-section {
  margin-bottom: 24px;
}

.movie-name {
  margin: 0 0 4px;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.original-name {
  margin: 0 0 20px;
  font-size: 0.875rem;
  color: var(--text-secondary);
  word-break: break-all;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.actions-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.action-btn:active {
  transform: scale(0.98);
}

.action-btn.primary {
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  color: white;
}

.action-btn.danger {
  background-color: rgba(244, 67, 54, 0.1);
  color: #f44336;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
</style>