import { ref, computed, onUnmounted } from 'vue'
import { formatTimeShort } from '../utils/formatTime'
import { useMovieApi } from './useMovieApi'

const PREVIEW_WINDOW_SEC = 1.5

export function useClipLoader(movieId) {
  const { getClipUrl, getFrameUrl, getTaskStatus } = useMovieApi()

  const isLoading = ref(false)
  const loadingProgress = ref(0)
  const loadingText = ref('正在截取片段...')
  const clipUrl = ref(null)
  const hasError = ref(false)
  const fallbackFrames = ref([])
  const segmentStart = ref(null)
  const segmentEnd = ref(null)
  const activeTimestamp = ref(null)

  let pollTimer = null

  const timeRange = computed(() => {
    if (segmentStart.value != null && segmentEnd.value != null) {
      return `${formatTimeShort(segmentStart.value)} ~ ${formatTimeShort(segmentEnd.value)}`
    }
    if (activeTimestamp.value == null) return ''
    const start = activeTimestamp.value - PREVIEW_WINDOW_SEC
    const end = activeTimestamp.value + PREVIEW_WINDOW_SEC
    return `${formatTimeShort(Math.max(0, start))} ~ ${formatTimeShort(end)}`
  })

  const applyClipMetaHeaders = (response) => {
    const start = response.headers.get('X-Clip-Start')
    const end = response.headers.get('X-Clip-End')
    if (start == null || end == null) return
    const startNum = parseFloat(start)
    const endNum = parseFloat(end)
    if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
      segmentStart.value = startNum
      segmentEnd.value = endNum
    }
  }

  const fetchClipMeta = async (url) => {
    try {
      const response = await fetch(url, { method: 'HEAD' })
      applyClipMetaHeaders(response)
    } catch {
      // Non-fatal
    }
  }

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
    const start = timestamp - PREVIEW_WINDOW_SEC

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

  const reset = () => {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    revokeClipUrl()
    isLoading.value = false
    loadingProgress.value = 0
    loadingText.value = '正在截取片段...'
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
    isLoading.value = true
    hasError.value = false
    loadingProgress.value = 0
    loadingText.value = '正在截取片段...'
    segmentStart.value = null
    segmentEnd.value = null
    activeTimestamp.value = timestamp
    revokeClipUrl()
    fallbackFrames.value = []

    const url = getClipUrl(movieId, timestamp)

    try {
      const response = await fetch(url, {
        headers: { Accept: 'video/mp4, application/json' },
      })

      const contentType = response.headers.get('content-type') || ''

      if (response.ok && (contentType.includes('video/mp4') || contentType.includes('octet-stream'))) {
        applyClipMetaHeaders(response)
        clipUrl.value = URL.createObjectURL(await response.blob())
        loadingProgress.value = 100
        return
      }

      if (response.status === 202) {
        const data = await response.json()
        clipUrl.value = await pollClipTask(data.taskId, url)
        await fetchClipMeta(`${url}&cache=${Date.now()}`)
        loadingProgress.value = 100
        return
      }

      throw new Error(`Unexpected clip response: ${response.status}`)
    } catch (error) {
      console.error('Failed to load clip:', error)
      loadFallbackFrames(timestamp)
    } finally {
      isLoading.value = false
    }
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
    loadClip,
    reset,
    markError,
  }
}
