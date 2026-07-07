import { ref, onUnmounted } from 'vue'
import Hls from 'hls.js'
import { useMovieApi } from './useMovieApi'
import { formatTimeShort } from '../utils/formatTime'

/**
 * HLS preview player composable.
 *
 * Attaches hls.js (or native HLS on Safari) to a <video> element and plays a
 * dynamically-packaged HLS stream starting from the keyframe at or before the
 * requested timestamp. Continuous playback until destroy() (called on close).
 */
export function useHlsPlayer(getMovieId) {
  const { getHlsPlaylistUrl } = useMovieApi()

  const isLoading = ref(false)
  const hasError = ref(false)
  const segmentStart = ref(null)
  const timeRange = ref('')

  let hls = null
  let currentVideo = null
  let attachToken = 0

  const resolveMovieId = () => (
    typeof getMovieId === 'function' ? getMovieId() : getMovieId
  )

  const markReady = (token) => {
    if (token !== attachToken) return
    isLoading.value = false
    if (!currentVideo) return

    const start = segmentStart.value
    const dur = currentVideo.duration
    if (Number.isFinite(start) && Number.isFinite(dur) && dur > 0) {
      timeRange.value = `${formatTimeShort(start)} ~ ${formatTimeShort(start + dur)}`
    }
  }

  const onError = (token) => {
    if (token !== attachToken) return
    isLoading.value = false
    hasError.value = true
  }

  const attachTo = (videoEl, timestamp) => {
    if (!videoEl) return
    destroy()

    const token = ++attachToken
    const movieId = resolveMovieId()
    if (!movieId) {
      onError(token)
      return
    }

    isLoading.value = true
    hasError.value = false
    segmentStart.value = timestamp
    timeRange.value = ''
    currentVideo = videoEl

    const url = getHlsPlaylistUrl(movieId, timestamp)

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = url
      videoEl.addEventListener('loadedmetadata', () => {
        markReady(token)
        videoEl.play().catch(() => {})
      }, { once: true })
      videoEl.addEventListener('error', () => onError(token), { once: true })
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        startPosition: 0,
        // Preview only needs a short buffer ahead; avoid flooding the server
        // with hundreds of segment requests for the full movie playlist.
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferHole: 0.5,
      })
      hls.attachMedia(videoEl)
      hls.loadSource(url)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        markReady(token)
        currentVideo?.play().catch(() => {})
      })

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        markReady(token)
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (token !== attachToken || !hls) return

        if (!data.fatal) {
          console.warn('HLS non-fatal error:', data.type, data.details)
          return
        }

        console.error('HLS fatal error:', data.type, data.details, data)

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
          return
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad()
          return
        }
        onError(token)
      })
    } else {
      onError(token)
    }
  }

  const destroy = () => {
    attachToken += 1
    if (hls) {
      hls.destroy()
      hls = null
    }
    if (currentVideo) {
      currentVideo.pause()
      currentVideo.removeAttribute('src')
      currentVideo.load()
      currentVideo = null
    }
    isLoading.value = false
  }

  onUnmounted(destroy)

  return {
    isLoading,
    hasError,
    segmentStart,
    timeRange,
    attachTo,
    destroy,
  }
}
