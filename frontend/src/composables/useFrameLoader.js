import { ref, shallowRef } from 'vue'
import { useMovieStore } from '../stores/movieStore'
import { API_BASE } from '../utils/api'
import { DEFAULT_FPS, formatFrameTimestamp, quantizeToFrame } from '../utils/frameTimestamp'

export function useFrameLoader() {
  const store = useMovieStore()
  
  // LRU Cache for frame images (max 50)
  const frameCache = shallowRef(new Map())
  const MAX_CACHE_SIZE = 50
  
  // Loading states
  const loadingFrames = ref(new Set())
  // pendingRequests = Map<timestamp, Promise>
  const pendingRequests = ref(new Map())
  
  /**
   * Get frame from cache or load it
   */
  const getFrame = async (movieId, timestamp, width = 1280, fps = DEFAULT_FPS, duration = Infinity) => {
    const frameTimestamp = formatFrameTimestamp(quantizeToFrame(timestamp, fps, duration))
    const cacheKey = `${movieId}_${frameTimestamp}_${width}`
    
    // Check memory cache first
    if (frameCache.value.has(cacheKey)) {
      // Move to end (mark as recently used)
      const value = frameCache.value.get(cacheKey)
      frameCache.value.delete(cacheKey)
      frameCache.value.set(cacheKey, value)
      return value
    }
    
    // Check store cache
    const storeCached = store.getCachedFrame(cacheKey)
    if (storeCached) {
      return storeCached
    }
    
    // If already loading this frame, return the pending promise
    if (pendingRequests.value.has(cacheKey)) {
      return pendingRequests.value.get(cacheKey)
    }
    
    // Create loading promise
    const loadPromise = loadFrame(movieId, frameTimestamp, width, cacheKey)
    pendingRequests.value.set(cacheKey, loadPromise)
    
    try {
      const result = await loadPromise
      return result
    } finally {
      pendingRequests.value.delete(cacheKey)
    }
  }
  
  /**
   * Load frame image
   */
  const loadFrame = async (movieId, frameTimestamp, width, cacheKey) => {
    loadingFrames.value.add(frameTimestamp)
    
    try {
      const url = `${API_BASE}/movies/${movieId}/frames/${frameTimestamp}?width=${width}`
      
      const img = new Image()
      img.crossOrigin = 'anonymous'
      
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = url
      })
      
      // Add to cache with LRU eviction
      addToCache(cacheKey, img.src)
      store.cacheFrame(cacheKey, img.src)
      
      return img.src
    } catch (error) {
      console.error(`Failed to load frame at ${frameTimestamp}:`, error)
      return null
    } finally {
      loadingFrames.value.delete(frameTimestamp)
    }
  }
  
  /**
   * Add frame to LRU cache
   */
  const addToCache = (key, value) => {
    if (frameCache.value.size >= MAX_CACHE_SIZE) {
      // Delete oldest entry (first in Map)
      const firstKey = frameCache.value.keys().next().value
      frameCache.value.delete(firstKey)
    }
    frameCache.value.set(key, value)
  }
  
  /**
   * Check if frame is loading
   */
  const isLoading = (timestamp, fps = DEFAULT_FPS, duration = Infinity) => {
    const frameTimestamp = formatFrameTimestamp(quantizeToFrame(timestamp, fps, duration))
    return loadingFrames.value.has(frameTimestamp)
  }
  
  /**
   * Clear all cached frames
   */
  const clearCache = () => {
    frameCache.value.clear()
    store.clearFrameCache()
  }
  
  /**
   * Get cache size
   */
  const getCacheSize = () => {
    return frameCache.value.size
  }
  
  return {
    getFrame,
    isLoading,
    clearCache,
    getCacheSize,
    loadingFrames
  }
}