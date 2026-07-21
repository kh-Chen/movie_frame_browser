/**
 * Fragment loader that wraps hls.js XhrLoader:
 * - Strips Range headers (Edge/progressive `bytes=0-` defeats HTTP cache)
 * - Serves repeated URLs from a shared in-memory LRU without network
 * - Keeps `this.stats` compatible with AbrController._abandonRulesCheck
 */

const DEFAULT_MAX_ENTRIES = 24
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024
const LOADER_TAG = 'mfb-frag-cache-v2'

/** @type {Map<string, ArrayBuffer>} */
const sharedCache = new Map()
let sharedBytes = 0
let loggedActive = false

function byteLength(data) {
  if (!data) return 0
  if (typeof data.byteLength === 'number') return data.byteLength
  return 0
}

function normalizeUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url, self.location?.href || undefined)
    u.hash = ''
    return u.href
  } catch {
    return String(url).split('#')[0]
  }
}

function cachePut(url, data) {
  const key = normalizeUrl(url)
  if (!key || !data) return
  const size = byteLength(data)
  if (size <= 0 || size > DEFAULT_MAX_BYTES) return

  if (sharedCache.has(key)) {
    sharedBytes -= byteLength(sharedCache.get(key))
    sharedCache.delete(key)
  }

  while (
    sharedCache.size >= DEFAULT_MAX_ENTRIES ||
    (sharedBytes + size > DEFAULT_MAX_BYTES && sharedCache.size > 0)
  ) {
    const oldest = sharedCache.keys().next().value
    sharedBytes -= byteLength(sharedCache.get(oldest))
    sharedCache.delete(oldest)
  }

  const copy = data.slice ? data.slice(0) : data
  sharedCache.set(key, copy)
  sharedBytes += byteLength(copy)
}

function cacheGet(url) {
  const key = normalizeUrl(url)
  const data = sharedCache.get(key)
  if (!data) return null
  sharedCache.delete(key)
  sharedCache.set(key, data)
  return data
}

function stripRange(context) {
  if (!context) return
  context.rangeStart = undefined
  context.rangeEnd = undefined
  if (context.headers) {
    const next = { ...context.headers }
    delete next.Range
    delete next.range
    context.headers = next
  }
}

/**
 * @param {typeof import('hls.js').default.DefaultConfig.loader} BaseLoader
 */
export function createCachingFragLoader(BaseLoader) {
  if (!BaseLoader) {
    throw new Error('Hls.DefaultConfig.loader is required')
  }

  return class CachingFragLoader extends BaseLoader {
    constructor(config) {
      super(config)
      this._cacheTimer = null
      if (!loggedActive) {
        loggedActive = true
        console.info(`[HLS] ${LOADER_TAG} active`)
      }
    }

    abort() {
      if (this._cacheTimer != null) {
        self.clearTimeout(this._cacheTimer)
        this._cacheTimer = null
      }
      super.abort()
    }

    destroy() {
      if (this._cacheTimer != null) {
        self.clearTimeout(this._cacheTimer)
        this._cacheTimer = null
      }
      super.destroy()
    }

    load(context, config, callbacks) {
      stripRange(context)

      const url = context?.url
      const cached = url ? cacheGet(url) : null

      if (cached) {
        // Mirror XhrLoader: stats must exist before AbrController polls `.loading`
        const now = self.performance.now()
        const size = byteLength(cached)
        this.stats.loading.start = now
        this.stats.loading.first = now
        this.stats.loading.end = now
        this.stats.loaded = size
        this.stats.total = size
        this.stats.chunkCount = 1
        this.context = context

        this._cacheTimer = self.setTimeout(() => {
          this._cacheTimer = null
          if (this.stats.aborted) return
          callbacks.onSuccess(
            { url, data: cached.slice(0), code: 200 },
            this.stats,
            context,
            null
          )
        }, 0)
        return
      }

      const userOnSuccess = callbacks.onSuccess
      callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
        if (response?.data && (ctx?.url || url)) {
          cachePut(ctx?.url || url, response.data)
        }
        userOnSuccess(response, stats, ctx, networkDetails)
      }

      // Optional marker for HAR verification (XHR path).
      if (!context.headers) context.headers = {}
      context.headers['X-MFB-Frag-Loader'] = LOADER_TAG

      super.load(context, config, callbacks)
    }
  }
}

export function getFragCacheStats() {
  return { entries: sharedCache.size, bytes: sharedBytes }
}
