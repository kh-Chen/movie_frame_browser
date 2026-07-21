import { ref, onUnmounted } from 'vue'
import Hls from 'hls.js'
import { useMovieApi } from './useMovieApi'
import { formatTimeShort } from '../utils/formatTime'
import { createCachingFragLoader } from './hlsFragCacheLoader'

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
  let mediaRecoveries = 0
  let onTimeUpdate = null

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

  const onError = (token, reason) => {
    if (token !== attachToken) return
    isLoading.value = false
    hasError.value = true
    if (reason) {
      console.error('HLS preview failed:', reason)
    }
  }

  const attachTo = (videoEl, timestamp) => {
    if (!videoEl) return
    destroy()

    const token = ++attachToken
    mediaRecoveries = 0
    const movieId = resolveMovieId()
    if (!movieId) {
      onError(token, 'missing movieId')
      return
    }

    isLoading.value = true
    hasError.value = false
    segmentStart.value = timestamp
    timeRange.value = ''
    currentVideo = videoEl

    const url = getHlsPlaylistUrl(movieId, timestamp)

    // Prefer hls.js whenever MSE is available. Edge/Chrome may report native
    // HLS via canPlayType, but native media requests use Range: bytes=0- and
    // bypass our fragment memory/HTTP cache loader entirely.
    if (Hls.isSupported()) {
      // Only override fragment loader. Playlist/manifest must keep the default
      // text loader — our cache loader returns ArrayBuffer and breaks m3u8 parse.
      const CachingLoader = createCachingFragLoader(Hls.DefaultConfig.loader)
      hls = new Hls({
        enableWorker: false,
        progressive: false,
        startPosition: 0,
        maxBufferLength: 16,
        maxMaxBufferLength: 30,
        backBufferLength: 120,
        maxBufferHole: 0.5,
        fLoader: CachingLoader,
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

      let lastMediaTime = 0
      onTimeUpdate = () => {
        if (token !== attachToken || !currentVideo) return
        const t = currentVideo.currentTime
        if (Number.isFinite(t) && lastMediaTime > 0 && t < lastMediaTime - 1) {
          console.warn('HLS timeline rewind detected:', {
            from: lastMediaTime,
            to: t,
          })
        }
        if (Number.isFinite(t)) lastMediaTime = t
      }
      videoEl.addEventListener('timeupdate', onTimeUpdate)

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (token !== attachToken || !hls) return

        if (!data.fatal) {
          console.warn('HLS non-fatal error:', data.type, data.details)
          return
        }

        console.error('HLS fatal error:', data.type, data.details, data)

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
          mediaRecoveries += 1
          hls.recoverMediaError()
          return
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad()
          return
        }
        onError(token, `${data.type}:${data.details}`)
      })
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = url
      videoEl.addEventListener('loadedmetadata', () => {
        markReady(token)
        videoEl.play().catch(() => {})
      }, { once: true })
      videoEl.addEventListener('error', () => {
        onError(token, videoEl.error || 'native video error')
      }, { once: true })
    } else {
      onError(token, 'HLS not supported')
    }
  }

  const destroy = () => {
    attachToken += 1
    if (hls) {
      hls.destroy()
      hls = null
    }
    if (currentVideo) {
      if (onTimeUpdate) {
        currentVideo.removeEventListener('timeupdate', onTimeUpdate)
        onTimeUpdate = null
      }
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
