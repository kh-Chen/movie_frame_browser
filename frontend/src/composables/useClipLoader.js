import { ref, computed, onUnmounted } from 'vue'
import { formatTimeShort } from '../utils/formatTime'
import { useMovieApi } from './useMovieApi'

const CLIP_SEEK_BACK_SEC = 1
const CLIP_SEEK_FORWARD_SEC = 5
const CLIP_CONTINUE_OFFSET_SEC = 1

export function useClipLoader(movieId) {
  const { getClipUrl, getFrameUrl, getTaskStatus } = useMovieApi()

  const isLoading = ref(false)
  const loadingProgress = ref(0)
  const loadingText = ref('正在加载片段...')
  const clipUrl = ref(null)
  const hasError = ref(false)
  const fallbackFrames = ref([])
  const segmentStart = ref(null)
  const segmentEnd = ref(null)
  const activeTimestamp = ref(null)

  let pollTimer = null
  let preloadCache = null

  const getNextTimestamp = (movieDuration) => {
    let end = segmentEnd.value
    if (end == null && activeTimestamp.value != null) {
      end = activeTimestamp.value + CLIP_SEEK_FORWARD_SEC
    }
    if (end == null) return null
    const next = Math.round((end + CLIP_CONTINUE_OFFSET_SEC) * 1000) / 1000
    if (movieDuration != null && next > movieDuration) return null
    return next
  }

  const timeRange = computed(() => {
    if (segmentStart.value != null && segmentEnd.value != null) {
      return `${formatTimeShort(segmentStart.value)} ~ ${formatTimeShort(segmentEnd.value)}`
    }
    if (activeTimestamp.value == null) return ''
    const start = activeTimestamp.value - CLIP_SEEK_BACK_SEC
    const end = activeTimestamp.value + CLIP_SEEK_FORWARD_SEC
    return `${formatTimeShort(Math.max(0, start))} ~ ${formatTimeShort(end)}`
  })

  const waitForClip = (url) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.onloadeddata = () => resolve(url)
      video.onerror = () => reject(new Error('Clip load failed'))
      video.src = url
    })
  }

  const pollClipTask = async (taskId, url) => {
    const maxAttempts = 60

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const data = await getTaskStatus(taskId)
      const task = data.task || data

      loadingProgress.value = task.progress || 0
      loadingText.value = task.message || '正在截取片段...'

      if (task.status === 'completed') {
        const cacheBusted = `${url}&cache=${Date.now()}`
        await waitForClip(cacheBusted)
        return cacheBusted
      }

      if (task.status === 'failed') {
        throw new Error(task.error || '片段生成失败')
      }

      await new Promise((resolve) => {
        pollTimer = setTimeout(resolve, 500)
      })
    }

    throw new Error('片段生成超时')
  }

  const loadFallbackFrames = (timestamp) => {
    hasError.value = true
    loadingText.value = '片段加载失败，尝试加载静态帧...'

    const frames = []
    const interval = 1.5
    const start = timestamp - CLIP_SEEK_BACK_SEC

    for (let i = 0; i < 5; i++) {
      const t = start + i * interval
      if (t >= 0) {
        frames.push(getFrameUrl(movieId, Math.floor(t)))
      }
    }

    fallbackFrames.value = frames
  }

  const revokeClipUrl = () => {
    if (clipUrl.value && clipUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(clipUrl.value)
    }
    clipUrl.value = null
  }

  const clearPreloadCache = () => {
    if (preloadCache?.clipUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(preloadCache.clipUrl)
    }
    preloadCache = null
  }

  const applyPreloadedClip = (timestamp) => {
    if (!preloadCache || preloadCache.timestamp !== timestamp) return false
    revokeClipUrl()
    activeTimestamp.value = timestamp
    clipUrl.value = preloadCache.clipUrl
    segmentStart.value = preloadCache.segmentStart
    segmentEnd.value = preloadCache.segmentEnd
    preloadCache = null
    hasError.value = false
    loadingProgress.value = 100
    return true
  }

  const fetchClipFromServer = async (timestamp) => {
    const url = getClipUrl(movieId, timestamp)
    let resolvedUrl = null
    let start = null
    let end = null

    const response = await fetch(url, {
      headers: { Accept: 'video/mp4, application/json' },
    })

    const contentType = response.headers.get('content-type') || ''

    if (response.ok && (contentType.includes('video/mp4') || contentType.includes('octet-stream'))) {
      const startHeader = response.headers.get('X-Clip-Start')
      const endHeader = response.headers.get('X-Clip-End')
      if (startHeader != null && endHeader != null) {
        start = parseFloat(startHeader)
        end = parseFloat(endHeader)
      }
      resolvedUrl = URL.createObjectURL(await response.blob())
    } else if (response.status === 202) {
      const data = await response.json()
      loadingText.value = data.message || '正在截取片段...'
      resolvedUrl = await pollClipTask(data.taskId, url)
      try {
        const metaResponse = await fetch(`${url}&cache=${Date.now()}`, { method: 'HEAD' })
        const startHeader = metaResponse.headers.get('X-Clip-Start')
        const endHeader = metaResponse.headers.get('X-Clip-End')
        if (startHeader != null && endHeader != null) {
          start = parseFloat(startHeader)
          end = parseFloat(endHeader)
        }
      } catch {
        // Non-fatal
      }
    } else {
      throw new Error(`Unexpected clip response: ${response.status}`)
    }

    return { clipUrl: resolvedUrl, segmentStart: start, segmentEnd: end }
  }

  const reset = () => {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    clearPreloadCache()
    revokeClipUrl()
    isLoading.value = false
    loadingProgress.value = 0
    loadingText.value = '正在加载片段...'
    hasError.value = false
    fallbackFrames.value = []
    segmentStart.value = null
    segmentEnd.value = null
    activeTimestamp.value = null
  }

  const markError = () => {
    hasError.value = true
  }

  const loadClip = async (timestamp) => {
    if (applyPreloadedClip(timestamp)) {
      isLoading.value = false
      return
    }

    isLoading.value = true
    hasError.value = false
    loadingProgress.value = 0
    loadingText.value = '正在加载片段...'
    segmentStart.value = null
    segmentEnd.value = null
    activeTimestamp.value = timestamp
    revokeClipUrl()
    fallbackFrames.value = []

    try {
      const data = await fetchClipFromServer(timestamp)
      clipUrl.value = data.clipUrl
      if (data.segmentStart != null && data.segmentEnd != null) {
        segmentStart.value = data.segmentStart
        segmentEnd.value = data.segmentEnd
      }
      loadingProgress.value = 100
    } catch (error) {
      console.error('Failed to load clip:', error)
      loadFallbackFrames(timestamp)
    } finally {
      isLoading.value = false
    }
  }

  const preloadNextClip = async (movieDuration) => {
    const nextTs = getNextTimestamp(movieDuration)
    if (nextTs == null) return
    if (preloadCache?.timestamp === nextTs) return

    clearPreloadCache()

    try {
      const data = await fetchClipFromServer(nextTs)
      preloadCache = { timestamp: nextTs, ...data }
    } catch {
      // Preload is best-effort
    }
  }

  const continueToNextClip = async (movieDuration) => {
    const nextTs = getNextTimestamp(movieDuration)
    if (nextTs == null) return null

    await loadClip(nextTs)
    return nextTs
  }

  onUnmounted(reset)

  return {
    isLoading,
    loadingProgress,
    loadingText,
    clipUrl,
    hasError,
    fallbackFrames,
    timeRange,
    segmentStart,
    segmentEnd,
    getNextTimestamp,
    loadClip,
    preloadNextClip,
    continueToNextClip,
    reset,
    markError,
  }
}
