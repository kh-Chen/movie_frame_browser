<template>
  <Teleport to="body">
    <Transition name="slide">
      <div v-if="visible" class="queue-overlay" @click.self="close">
        <div class="queue-panel">
          <div class="panel-header">
            <h2 class="panel-title">任务队列</h2>
            <button class="close-btn" @click="close">✕</button>
          </div>

          <div class="panel-content">
            <!-- Worker status -->
            <div class="worker-section">
              <h3 class="section-title">系统状态</h3>
              <div class="worker-grid">
                <div class="worker-item">
                  <span class="worker-label">并发任务</span>
                  <span class="worker-value">{{ worker.concurrent }} / {{ worker.maxConcurrent }}</span>
                </div>
                <div class="worker-item">
                  <span class="worker-label">CPU 负载</span>
                  <span class="worker-value" :class="cpuClass">{{ cpuPercent }}%</span>
                </div>
                <div class="worker-item">
                  <span class="worker-label">等待中</span>
                  <span class="worker-value">{{ pendingCount }}</span>
                </div>
              </div>
              <div class="cpu-bar">
                <div class="cpu-fill" :style="{ width: `${cpuPercent}%` }" :class="cpuClass"></div>
              </div>
            </div>

            <!-- Processing tasks -->
            <div class="task-section">
              <h3 class="section-title">处理中 ({{ processingTasks.length }})</h3>
              <div v-if="loading" class="loading-state">
                <div class="loading-spinner small"></div>
                <span>加载中...</span>
              </div>
              <div v-else-if="processingTasks.length === 0" class="empty-state">
                <span>暂无处理中的任务</span>
              </div>
              <div v-else class="task-list">
                <div v-for="task in processingTasks" :key="task.taskId" class="task-item processing">
                  <div class="task-header">
                    <span class="task-type">{{ formatTaskType(task.type) }}</span>
                    <span class="task-id">{{ shortId(task.taskId) }}</span>
                  </div>
                  <div class="task-progress">
                    <div class="progress-bar">
                      <div class="progress-fill" :style="{ width: `${task.progress || 0}%` }"></div>
                    </div>
                    <span class="progress-text">{{ task.progress || 0 }}%</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pending tasks -->
            <div class="task-section">
              <h3 class="section-title">等待中 ({{ pendingCount }})</h3>
              <div v-if="!loading && pendingTasks.length === 0" class="empty-state">
                <span>队列为空</span>
              </div>
              <div v-else class="task-list">
                <div v-for="task in pendingTasks" :key="task.taskId" class="task-item pending">
                  <div class="task-header">
                    <span class="task-type">{{ formatTaskType(task.type) }}</span>
                    <span class="priority-badge" :class="priorityClass(task.priority)">
                      {{ formatPriority(task.priority) }}
                    </span>
                  </div>
                  <div class="task-footer">
                    <span class="task-id">{{ shortId(task.taskId) }}</span>
                    <button
                      class="cancel-btn"
                      @click="handleCancel(task.taskId)"
                      :disabled="cancellingId === task.taskId"
                    >
                      {{ cancellingId === task.taskId ? '取消中...' : '取消' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-footer">
            <span class="refresh-hint">每 3 秒自动刷新</span>
            <button class="refresh-btn" @click="loadStatus" :disabled="loading">
              {{ loading ? '刷新中...' : '立即刷新' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useMovieApi } from '../composables/useMovieApi'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const { getQueueStatus, cancelTask } = useMovieApi()

const loading = ref(false)
const cancellingId = ref(null)
const worker = ref({
  concurrent: 0,
  maxConcurrent: 0,
  cpuUsage: 0,
})
const processingTasks = ref([])
const pendingTasks = ref([])
let pollTimer = null

const pendingCount = computed(() => pendingTasks.value.length)

const cpuPercent = computed(() => {
  return Math.min(100, Math.round((worker.value.cpuUsage || 0) * 100))
})

const cpuClass = computed(() => {
  if (cpuPercent.value > 80) return 'danger'
  if (cpuPercent.value > 60) return 'warning'
  return 'normal'
})

const TASK_TYPE_LABELS = {
  movie_process: '电影处理',
  clip_generate: '片段生成',
  frame_extract: '帧提取',
  keyframe_extract: '关键帧采集',
}

const PRIORITY_LABELS = {
  1: '高',
  2: '普通',
  3: '低',
}

const formatTaskType = (type) => TASK_TYPE_LABELS[type] || type
const formatPriority = (priority) => PRIORITY_LABELS[priority] || '普通'
const shortId = (id) => id ? id.slice(-8) : ''

const priorityClass = (priority) => {
  if (priority === 1) return 'high'
  if (priority === 3) return 'low'
  return 'normal'
}

const loadStatus = async () => {
  loading.value = true
  try {
    const data = await getQueueStatus()
    const queueData = data.queue?.queue || data.queue || {}
    worker.value = data.worker || {}

    processingTasks.value = data.queue?.processing || []

    const byPriority = queueData.byPriority || {}
    const pending = []
    for (const priority of [1, 2, 3]) {
      const tasks = byPriority[priority] || byPriority[String(priority)] || []
      for (const task of tasks) {
        pending.push({ ...task, priority })
      }
    }
    pendingTasks.value = pending
  } catch (error) {
    console.error('Failed to load queue status:', error)
    processingTasks.value = []
    pendingTasks.value = []
  } finally {
    loading.value = false
  }
}

const handleCancel = async (taskId) => {
  cancellingId.value = taskId
  try {
    await cancelTask(taskId)
    await loadStatus()
  } catch (error) {
    console.error('Failed to cancel task:', error)
  } finally {
    cancellingId.value = null
  }
}

const startPolling = () => {
  stopPolling()
  loadStatus()
  pollTimer = setInterval(loadStatus, 3000)
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const close = () => {
  emit('close')
}

watch(() => props.visible, (visible) => {
  if (visible) {
    startPolling()
  } else {
    stopPolling()
  }
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.queue-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 9999;
}

.queue-panel {
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
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

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 12px;
}

.worker-section {
  margin-bottom: 24px;
}

.worker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.worker-item {
  background-color: var(--bg-primary);
  border-radius: 10px;
  padding: 10px;
  text-align: center;
}

.worker-label {
  display: block;
  font-size: 0.7rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.worker-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.worker-value.warning {
  color: #ffc107;
}

.worker-value.danger {
  color: #f44336;
}

.cpu-bar {
  height: 6px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.cpu-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.cpu-fill.normal {
  background-color: var(--accent);
}

.cpu-fill.warning {
  background-color: #ffc107;
}

.cpu-fill.danger {
  background-color: #f44336;
}

.task-section {
  margin-bottom: 20px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  background-color: var(--bg-primary);
  border-radius: 12px;
  padding: 12px;
}

.task-item.processing {
  border-left: 3px solid var(--accent);
}

.task-item.pending {
  border-left: 3px solid rgba(255, 255, 255, 0.2);
}

.task-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.task-type {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.task-id {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: monospace;
}

.priority-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.priority-badge.high {
  background-color: rgba(233, 30, 99, 0.2);
  color: #e91e63;
}

.priority-badge.normal {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

.priority-badge.low {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
}

.task-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--accent);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  min-width: 32px;
  text-align: right;
}

.task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cancel-btn {
  padding: 6px 12px;
  background-color: rgba(244, 67, 54, 0.1);
  border: none;
  border-radius: 8px;
  color: #f44336;
  font-size: 0.75rem;
  cursor: pointer;
}

.cancel-btn:hover:not(:disabled) {
  background-color: rgba(244, 67, 54, 0.2);
}

.cancel-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.loading-spinner.small {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.refresh-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.refresh-btn {
  padding: 10px 20px;
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
}

.refresh-btn:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.15);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
}
</style>
