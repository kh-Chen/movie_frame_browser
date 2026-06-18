<template>
  <div class="movie-row" @click="handleClick">
    <div class="movie-name" :title="displayName">{{ displayName }}</div>
    <div class="movie-meta">
      <span v-if="movie.status === 'processing'" class="status-processing">
        <span class="processing-dot"></span>
        处理中
      </span>
      <span v-if="movie.duration" class="duration">{{ formatDuration(movie.duration) }}</span>
      <span v-if="movie.resolution" class="resolution">{{ movie.resolution }}</span>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.35;
  color: var(--text-primary);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.movie-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  white-space: nowrap;
  padding-top: 1px;
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

@media (max-width: 480px) {
  .movie-row {
    flex-direction: column;
    gap: 4px;
  }

  .movie-meta {
    padding-top: 0;
  }
}
</style>
