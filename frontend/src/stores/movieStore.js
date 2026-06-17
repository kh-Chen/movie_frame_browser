import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useMovieStore = defineStore('movie', () => {
  // State
  const movies = ref([])
  const currentMovie = ref(null)
  const currentTimestamp = ref(0)
  const isLoading = ref(false)
  const frameCache = ref(new Map())

  // Getters
  const readyMovies = computed(() => 
    movies.value.filter(m => m.status === 'ready')
  )

  const getMovieById = computed(() => (id) => 
    movies.value.find(m => m.id === id)
  )

  // Actions
  function setMovies(list) {
    movies.value = list
  }

  function addMovie(movie) {
    movies.value.push(movie)
  }

  function updateMovie(id, updates) {
    const index = movies.value.findIndex(m => m.id === id)
    if (index !== -1) {
      movies.value[index] = { ...movies.value[index], ...updates }
    }
  }

  function removeMovie(id) {
    movies.value = movies.value.filter(m => m.id !== id)
    if (currentMovie.value?.id === id) {
      currentMovie.value = null
    }
  }

  function setCurrentMovie(movie) {
    currentMovie.value = movie
    if (movie) {
      currentTimestamp.value = 0
    }
  }

  function setCurrentTimestamp(timestamp) {
    currentTimestamp.value = timestamp
  }

  function setLoading(loading) {
    isLoading.value = loading
  }

  // Frame cache management
  function cacheFrame(timestamp, imageData) {
    // LRU cache with max 50 entries
    if (frameCache.value.size >= 50) {
      const firstKey = frameCache.value.keys().next().value
      frameCache.value.delete(firstKey)
    }
    frameCache.value.set(timestamp, imageData)
  }

  function getCachedFrame(timestamp) {
    return frameCache.value.get(timestamp)
  }

  function clearFrameCache() {
    frameCache.value.clear()
  }

  return {
    // State
    movies,
    currentMovie,
    currentTimestamp,
    isLoading,
    frameCache,
    // Getters
    readyMovies,
    getMovieById,
    // Actions
    setMovies,
    addMovie,
    updateMovie,
    removeMovie,
    setCurrentMovie,
    setCurrentTimestamp,
    setLoading,
    cacheFrame,
    getCachedFrame,
    clearFrameCache
  }
})