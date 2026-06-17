<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="clip-preview-overlay" @click="handleOverlayClick">
        <div class="clip-preview-modal">
          <div class="modal-header">
            <span class="modal-title">片段预览</span>
            <span class="time-range">{{ timeRange }}</span>
            <button class="close-btn" @click="close">
              <span>✕</span>
            </button>
          </div>

          <div class="modal-content">
            <div v-if="isLoading" class="loading-state">
              <div class="loading-spinner"></div>
              <p class="loading-text">{{ loadingText }}</p>
              <div v-if="loadingProgress > 0" class="progress-container">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: loadingProgress + '%' }"></div>
                </div>
                <span class="progress-text">{{ loadingProgress }}%</span>
              </div>
            </div>

            <video
              v-else-if="clipUrl && !hasError"
              :src="clipUrl"
              class="clip-video"
              controls
              autoplay
              loop
              muted
              playsinline
              @error="markError"
            />

            <div v-else-if="hasError" class="error-state">
              <span class="error-icon">⚠️</span>
              <p class="error-text">片段加载失败</p>
              <p class="error-hint">显示静态帧预览</p>
              <div class="static-frames">
                <img
                  v-for="(frame, index) in fallbackFrames"
                  :key="index"
                  :src="frame"
                  :alt="'Frame ' + (index + 1)"
                  class="static-frame"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { watch } from 'vue'
import { useClipLoader } from '../composables/useClipLoader'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  movieId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Number,
    required: true
  }
})

const emit = defineEmits(['close'])

const {
  isLoading,
  loadingProgress,
  loadingText,
  clipUrl,
  hasError,
  fallbackFrames,
  timeRange,
  loadClip,
  reset,
  markError,
} = useClipLoader(props.movieId)

watch(() => props.visible, (visible) => {
  if (visible) {
    loadClip(props.timestamp)
  } else {
    reset()
  }
})

watch(() => props.timestamp, () => {
  if (props.visible) {
    loadClip(props.timestamp)
  }
})

const close = () => {
  emit('close')
}

const handleOverlayClick = (e) => {
  if (e.target === e.currentTarget) {
    close()
  }
}
</script>

<style scoped>
.clip-preview-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
}

.clip-preview-modal {
  width: 100%;
  max-width: 480px;
  background-color: var(--bg-secondary);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.modal-header {
  display: flex;
  align-items: center;
  padding: 16px;
  background-color: var(--bg-primary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-title {
  font-weight: 600;
  color: var(--text-primary);
}

.time-range {
  flex: 1;
  text-align: center;
  font-size: 0.875rem;
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  transition: background-color 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.modal-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 200px;
  max-height: 400px;
  background: #000;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  margin: 0;
  font-size: 0.875rem;
}

.progress-container {
  width: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
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
}

.clip-video {
  width: 100%;
  max-height: 360px;
  object-fit: contain;
  border-radius: 8px;
  background: #000;
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.error-icon {
  font-size: 2.5rem;
}

.error-text {
  color: var(--text-primary);
  margin: 0;
}

.error-hint {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
}

.static-frames {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 12px;
}

.static-frame {
  width: 80px;
  height: 45px;
  object-fit: cover;
  border-radius: 4px;
  opacity: 0.8;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-active .clip-preview-modal,
.fade-leave-active .clip-preview-modal {
  transition: transform 0.3s ease;
}

.fade-enter-from .clip-preview-modal,
.fade-leave-to .clip-preview-modal {
  transform: scale(0.9);
}

@media (max-width: 480px) {
  .clip-preview-modal {
    max-height: 85vh;
  }

  .modal-content {
    max-height: 320px;
  }

  .clip-video {
    max-height: 280px;
  }
}
</style>
