import { ref, shallowRef } from 'vue'
import { useMovieStore } from '../stores/movieStore'
import { API_BASE } from '../utils/api'

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
  const getFrame = async (movieId, timestamp, width = 1280) => {
    const cacheKey = `${movieId}_${timestamp}_${width}`
    
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
    const loadPromise = loadFrame(movieId, timestamp, width, cacheKey)
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
  const loadFrame = async (movieId, timestamp, width, cacheKey) => {
    loadingFrames.value.add(timestamp)
    
    try {
      const timestampSec = Math.floor(timestamp)
      const url = `${API_BASE}/movies/${movieId}/frames/${timestampSec}?width=${width}`
      
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
      console.error(`Failed to load frame at ${timestamp}:`, error)
      return null
    } finally {
      loadingFrames.value.delete(timestamp)
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
   * Preload frames around a timestamp
   */
  const preloadFrames = async (movieId, timestamp, range = 5, width = 1280) => {
    const promises = []
    const interval = 1 // 1 second interval for preloading
    
    for (let i = -range; i <= range; i++) {
      if (i === 0) continue // Skip current timestamp
      const t = timestamp + i * interval
      if (t >= 0) {
        promises.push(getFrame(movieId, t, width))
      }
    }
    
    await Promise.allSettled(promises)
  }
  
  /**
   * Check if frame is loading
   */
  const isLoading = (timestamp) => {
    return loadingFrames.value.has(timestamp)
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
    preloadFrames,
    isLoading,
    clearCache,
    getCacheSize,
    loadingFrames
  }
}