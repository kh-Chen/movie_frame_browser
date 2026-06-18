<template>
  <div class="movie-row" @click="handleClick">
    <div class="movie-name" :title="displayName">{{ displayName }}</div>
    <div class="movie-meta-row">
      <div class="movie-meta">
        <span v-if="movie.status === 'processing'" class="status-processing">
          <span class="processing-dot"></span>
          处理中
        </span>
        <span v-if="movie.duration" class="duration">{{ formatDuration(movie.duration) }}</span>
        <span v-if="movie.resolution" class="resolution">{{ movie.resolution }}</span>
      </div>
      <button
        class="delete-btn"
        title="删除电影"
        @click.stop="emit('delete', movie)"
      >
        🗑️
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { formatDuration } from '../utils/formatTime'

const props = defineProps({
  movie: {
    type: Object,
    required: true
  },
})

const emit = defineEmits(['delete'])

const router = useRouter()

const displayName = computed(() => props.movie.originalName || props.movie.name)

const handleClick = () => {
  const ready =
    props.movie.status === 'ready' ||
    (props.movie.coverStatus === 'ready' && props.movie.frameIndexStatus === 'ready')
  if (ready) {
    router.push({ name: 'browse', params: { id: props.movie.id } })
  }
}
</script>

<style scoped>
.movie-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background-color: var(--bg-secondary);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.movie-row:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.movie-row:active {
  background-color: rgba(255, 255, 255, 0.08);
}

.movie-name {
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.35;
  color: var(--text-primary);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.movie-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 18px;
}

.movie-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.status-processing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent);
}

.processing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.delete-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.6875rem;
  line-height: 1;
  opacity: 0.45;
  transition: opacity 0.15s ease, background-color 0.15s ease;
  padding: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: unset;
}

.delete-btn:hover {
  opacity: 1;
  background-color: rgba(244, 67, 54, 0.15);
}
</style>
