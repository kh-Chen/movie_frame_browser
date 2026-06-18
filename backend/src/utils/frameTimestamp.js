/**
 * Quantize timestamps to video frame boundaries for consistent frame caching.
 */

const DEFAULT_FPS = 30;
const FRAME_FILE_PAD_WIDTH = 8;

function formatFrameTimestamp(ts) {
  return Number(Number(ts).toFixed(6));
}

/**
 * @param {number} timestamp - Seconds
 * @param {number} [fps=DEFAULT_FPS]
 * @param {number} [duration=Infinity]
 * @returns {number}
 */
function getFrameIndex(timestamp, fps = DEFAULT_FPS, duration = Infinity) {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    return 0;
  }

  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  const maxFrame = Number.isFinite(duration)
    ? Math.floor(duration * safeFps)
    : Infinity;

  return Math.min(
    maxFrame,
    Math.max(0, Math.round(timestamp * safeFps))
  );
}

/**
 * @param {number} frameIndex
 * @param {number} [fps=DEFAULT_FPS]
 * @returns {number}
 */
function frameIndexToTimestamp(frameIndex, fps = DEFAULT_FPS) {
  const safeFps = fps > 0 ? fps : DEFAULT_FPS;
  return formatFrameTimestamp(frameIndex / safeFps);
}

/**
 * Snap a timestamp to the nearest frame boundary.
 * @param {number} timestamp - Seconds
 * @param {number} [fps=DEFAULT_FPS]
 * @param {number} [duration=Infinity] - Clamp to last frame within duration
 * @returns {number}
 */
function quantizeToFrame(timestamp, fps = DEFAULT_FPS, duration = Infinity) {
  return frameIndexToTimestamp(getFrameIndex(timestamp, fps, duration), fps);
}

/**
 * Zero-padded frame file basename (without extension), e.g. "00000123".
 * @param {number} frameIndex
 * @returns {string}
 */
function formatFrameBasename(frameIndex) {
  return String(frameIndex).padStart(FRAME_FILE_PAD_WIDTH, '0');
}

/**
 * Parse a frame image filename into frame index.
 * @param {string} filename - e.g. "00000123.jpg"
 * @returns {number|null}
 */
function parseFrameBasename(filename) {
  const match = filename.match(/^(\d+)\.jpg$/i);
  if (!match) return null;
  return parseInt(match[1], 10);
}

module.exports = {
  DEFAULT_FPS,
  FRAME_FILE_PAD_WIDTH,
  formatFrameTimestamp,
  getFrameIndex,
  frameIndexToTimestamp,
  quantizeToFrame,
  formatFrameBasename,
  parseFrameBasename,
};
