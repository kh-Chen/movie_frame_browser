/**
 * Quantize timestamps to video frame boundaries for consistent frame caching.
 */

export const DEFAULT_FPS = 30

export function formatFrameTimestamp(ts) {
  return Number(Number(ts).toFixed(6))
}

export function getFrameIndex(timestamp, fps = DEFAULT_FPS, duration = Infinity) {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    return 0
  }

  const safeFps = fps > 0 ? fps : DEFAULT_FPS
  const maxFrame = Number.isFinite(duration)
    ? Math.floor(duration * safeFps)
    : Infinity

  return Math.min(
    maxFrame,
    Math.max(0, Math.round(timestamp * safeFps))
  )
}

export function frameIndexToTimestamp(frameIndex, fps = DEFAULT_FPS) {
  const safeFps = fps > 0 ? fps : DEFAULT_FPS
  return formatFrameTimestamp(frameIndex / safeFps)
}

/**
 * Snap a timestamp to the nearest frame boundary.
 * @param {number} timestamp - Seconds
 * @param {number} [fps=DEFAULT_FPS]
 * @param {number} [duration=Infinity] - Clamp to last frame within duration
 * @returns {number}
 */
export function quantizeToFrame(timestamp, fps = DEFAULT_FPS, duration = Infinity) {
  return frameIndexToTimestamp(getFrameIndex(timestamp, fps, duration), fps)
}
