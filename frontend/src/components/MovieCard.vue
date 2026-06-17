<template>
  <div class="movie-card" @click="handleClick">
    <div class="movie-cover">
      <img 
        v-if="coverUrl" 
        :src="coverUrl" 
        :alt="movie.name"
        :class="{ loaded: coverLoaded }"
        @load="coverLoaded = true"
        @error="coverError = true"
      />
      <div v-else class="cover-placeholder">
        <span class="placeholder-icon">🎬</span>
      </div>
      <div v-if="movie.status === 'processing'" class="processing-overlay">
        <div class="processing-spinner"></div>
        <span>处理中</span>
      </div>
    </div>
    <div class="movie-info">
      <h3 class="movie-name">{{ movie.name }}</h3>
      <div class="movie-meta">
        <span class="duration">{{ formatDuration(movie.duration) }}</span>
        <span v-if="movie.resolution" class="resolution">{{ movie.resolution }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMovieApi } from '../composables/useMovieApi'
import { formatDuration } from '../utils/formatTime'

const props = defineProps({
  movie: {
    type: Object,
    required: true
  },
})

const router = useRouter()
const { getCoverUrl } = useMovieApi()

const coverUrl = computed(() => {
  if (props.movie.coverStatus === 'ready') {
    return getCoverUrl(props.movie.id)
  }
  return null
})

const coverLoaded = ref(false)
const coverError = ref(false)

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
.movie-card {
  background-color: var(--bg-secondary);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.movie-card:active {
  transform: scale(0.98);
}

.movie-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background-color: var(--bg-primary);
  overflow: hidden;
}

.movie-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-secondary), var(--bg-primary));
}

.placeholder-icon {
  font-size: 3rem;
  opacity: 0.5;
}

.processing-overlay {
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.processing-spinner {
  width: 32px;
  height: 32px;
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

.progress-bar {
  width: 60%;
  height: 4px;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--accent);
  transition: width 0.3s ease;
}

.movie-info {
  padding: 12px;
}

.movie-name {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.movie-meta {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.movie-meta span {
  display: flex;
  align-items: center;
}

.movie-meta span::before {
  content: '';
  width: 4px;
  height: 4px;
  background-color: var(--text-secondary);
  border-radius: 50%;
  margin-right: 6px;
}

.movie-meta span:first-child::before {
  display: none;
}
</style>