<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner" :class="{ small: size === 'small' }"></div>
          <p v-if="text" class="loading-text">{{ text }}</p>
          <p v-if="subtext" class="loading-subtext">{{ subtext }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  text: {
    type: String,
    default: ''
  },
  subtext: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'normal', // 'normal' | 'small'
    validator: (value) => ['normal', 'small'].includes(value)
  }
})
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(26, 26, 46, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
  padding: 24px;
}

.loading-spinner {
  width: 56px;
  height: 56px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-spinner.small {
  width: 32px;
  height: 32px;
  border-width: 3px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-primary);
}

.loading-subtext {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
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