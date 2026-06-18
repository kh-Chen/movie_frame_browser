<template>
  <div class="select-movie-container">
    <button 
      class="select-btn"
      @click="openDialog"
    >
      <span class="btn-icon">📂</span>
      <span class="btn-text">选择电影</span>
    </button>

    <!-- Select Dialog -->
    <Teleport to="body">
      <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
        <div class="dialog">
          <div class="dialog-header">
            <h3>选择本地电影</h3>
            <button class="close-btn" @click="closeDialog">×</button>
          </div>

          <div class="dialog-body">
            <!-- Loading state -->
            <div v-if="loading" class="loading-state">
              <div class="spinner"></div>
              <span>正在加载目录...</span>
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="error-state">
              <p class="error-message">{{ error }}</p>
              <button class="retry-btn" @click="loadDirectory(currentPath)">重试</button>
            </div>

            <!-- Directory browser -->
            <div v-else-if="directoryInfo" class="file-browser">
              <div class="path-bar">
                <button
                  class="up-btn"
                  :disabled="!directoryInfo.parent"
                  @click="goUp"
                  title="上级目录"
                >
                  ←
                </button>
                <div class="breadcrumb">
                  <button
                    v-for="(crumb, index) in breadcrumbs"
                    :key="crumb.path"
                    class="breadcrumb-item"
                    :class="{ active: index === breadcrumbs.length - 1 }"
                    @click="navigateTo(crumb.path)"
                  >
                    {{ crumb.name }}
                  </button>
                </div>
              </div>

              <div v-if="entries.length === 0" class="empty-state inline-empty">
                <p>当前目录下没有子文件夹或可导入的视频</p>
              </div>

              <div v-else class="entry-list">
                <div
                  v-for="entry in entries"
                  :key="entry.path"
                  class="entry-item"
                  :class="{
                    directory: entry.type === 'directory',
                    selected: selectedMovie?.path === entry.path,
                  }"
                  @click="handleEntryClick(entry)"
                >
                  <div class="entry-icon">
                    {{ entry.type === 'directory' ? '📁' : '🎬' }}
                  </div>
                  <div class="entry-info">
                    <div class="entry-name">{{ entry.name }}</div>
                    <div v-if="entry.type === 'file'" class="entry-meta">
                      <span class="entry-ext">{{ entry.extension.toUpperCase() }}</span>
                      <span class="entry-size">{{ entry.sizeFormatted }}</span>
                    </div>
                  </div>
                  <div v-if="entry.type === 'directory'" class="entry-action">›</div>
                  <div v-else-if="selectedMovie?.path === entry.path" class="check-icon">✓</div>
                </div>
              </div>
            </div>
          </div>

          <div class="dialog-footer">
            <button class="cancel-btn" @click="closeDialog">取消</button>
            <button 
              class="confirm-btn" 
              :disabled="!selectedMovie || confirming"
              @click="confirmSelection"
            >
              {{ confirming ? '添加中...' : '确认添加' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Add progress dialog -->
    <Teleport to="body">
      <div v-if="showProgress" class="dialog-overlay">
        <div class="dialog progress-dialog">
          <div class="dialog-header">
            <h3>正在处理</h3>
          </div>
          <div class="dialog-body">
            <p class="processing-name">{{ processingMovie?.name }}</p>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
            </div>
            <p class="progress-text">{{ progress }}% - {{ progressMessage }}</p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useMovieApi } from '../composables/useMovieApi'

const emit = defineEmits(['select-success', 'select-error'])

const { browseLocalDirectory, selectLocalMovie, getTaskStatus } = useMovieApi()

const showDialog = ref(false)
const showProgress = ref(false)
const loading = ref(false)
const confirming = ref(false)
const error = ref(null)
const directoryInfo = ref(null)
const currentPath = ref(null)
const selectedMovie = ref(null)
const progress = ref(0)
const progressMessage = ref('')
const processingMovie = ref(null)

let pollInterval = null

const entries = computed(() => directoryInfo.value?.entries || [])

const breadcrumbs = computed(() => {
  const info = directoryInfo.value
  if (!info) return []

  const separator = info.root.includes('\\') ? '\\' : '/'
  const rootName = info.root.split(/[/\\]/).filter(Boolean).pop() || info.root
  const crumbs = [{ name: rootName, path: info.root }]

  if (info.path === info.root) {
    return crumbs
  }

  const relative = info.path.slice(info.root.length).replace(/^[/\\]/, '')
  const parts = relative.split(/[/\\]/).filter(Boolean)
  let accumulated = info.root.replace(/[/\\]+$/, '')

  for (const part of parts) {
    accumulated = `${accumulated}${separator}${part}`
    crumbs.push({ name: part, path: accumulated })
  }

  return crumbs
})

const openDialog = async () => {
  showDialog.value = true
  selectedMovie.value = null
  currentPath.value = null
  await loadDirectory(null)
}

const closeDialog = () => {
  if (confirming.value || showProgress.value) return
  showDialog.value = false
  selectedMovie.value = null
  error.value = null
  directoryInfo.value = null
  currentPath.value = null
}

const loadDirectory = async (path) => {
  loading.value = true
  error.value = null

  try {
    const data = await browseLocalDirectory(path)
    directoryInfo.value = data
    currentPath.value = data.path
  } catch (err) {
    error.value = err.response?.data?.message || err.message || '无法加载目录'
    directoryInfo.value = null
  } finally {
    loading.value = false
  }
}

const navigateTo = (path) => {
  if (path === currentPath.value) return
  selectedMovie.value = null
  loadDirectory(path)
}

const goUp = () => {
  if (!directoryInfo.value?.parent) return
  navigateTo(directoryInfo.value.parent)
}

const handleEntryClick = (entry) => {
  if (entry.type === 'directory') {
    navigateTo(entry.path)
    return
  }

  selectedMovie.value = {
    name: entry.name.replace(/\.[^.]+$/, ''),
    path: entry.path,
    extension: entry.extension,
    sizeFormatted: entry.sizeFormatted,
  }
}

const confirmSelection = async () => {
  if (!selectedMovie.value || confirming.value) return

  confirming.value = true

  try {
    const data = await selectLocalMovie(
      selectedMovie.value.path,
      selectedMovie.value.name
    )

    showDialog.value = false
    showProgress.value = true
    processingMovie.value = selectedMovie.value
    progress.value = 0
    progressMessage.value = '准备中...'

    pollTaskStatus(data.taskId, data.movieId)

    emit('select-success', {
      movieId: data.movieId,
      taskId: data.taskId,
      movie: selectedMovie.value,
    })
  } catch (err) {
    error.value = err.response?.data?.message || err.message || '添加失败'
    confirming.value = false
    emit('select-error', err)
  }
}

const pollTaskStatus = async (taskId, movieId) => {
  const poll = async () => {
    try {
      const data = await getTaskStatus(taskId)
      const task = data.task || data

      if (task) {
        progress.value = task.progress || 0
        progressMessage.value = task.message || '处理中...'

        if (task.status === 'completed') {
          stopPolling()
          showProgress.value = false
          emit('select-success', { movieId, completed: true })
        } else if (task.status === 'failed') {
          stopPolling()
          showProgress.value = false
          emit('select-error', new Error(task.error || '处理失败'))
        }
      }
    } catch {
      // 忽略轮询错误，继续尝试
    }
  }

  pollInterval = setInterval(poll, 1000)
  await poll()
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  confirming.value = false
}

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.select-movie-container {
  position: relative;
}

.select-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px 20px;
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  border: none;
  border-radius: 12px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  touch-action: manipulation;
}

.select-btn:active {
  transform: scale(0.98);
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.dialog {
  background-color: var(--bg-secondary);
  border-radius: 16px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.progress-dialog {
  max-width: 400px;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.2s;
}

.close-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: var(--text-secondary);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  text-align: center;
}

.error-message {
  color: #ff6b6b;
  margin: 0;
}

.retry-btn {
  padding: 8px 16px;
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 8px;
  color: var(--text-primary);
  cursor: pointer;
}

.retry-btn:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.inline-empty {
  padding: 24px 12px;
}

.file-browser {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.up-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  cursor: pointer;
}

.up-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.breadcrumb-item {
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breadcrumb-item:not(.active):hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.breadcrumb-item.active {
  color: var(--text-primary);
  cursor: default;
}

.breadcrumb-item:not(:last-child)::after {
  content: '/';
  margin-left: 4px;
  color: var(--text-secondary);
  pointer-events: none;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s;
  border: 2px solid transparent;
}

.entry-item:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.entry-item.selected {
  border-color: var(--accent);
  background-color: rgba(255, 107, 139, 0.15);
}

.entry-icon {
  font-size: 1.5rem;
}

.entry-info {
  flex: 1;
  min-width: 0;
}

.entry-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-meta {
  display: flex;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 4px;
}

.entry-ext {
  background-color: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
}

.entry-action {
  color: var(--text-secondary);
  font-size: 1.25rem;
  line-height: 1;
}

.check-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--accent);
  border-radius: 50%;
  font-size: 0.875rem;
  color: white;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.dialog-footer button {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s, background-color 0.2s;
}

.cancel-btn {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

.cancel-btn:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.confirm-btn {
  background: linear-gradient(135deg, var(--accent), #ff6b8a);
  color: white;
}

.confirm-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.processing-name {
  text-align: center;
  font-weight: 500;
  margin: 0 0 16px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #ff6b8a);
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 12px 0 0;
}
</style>
