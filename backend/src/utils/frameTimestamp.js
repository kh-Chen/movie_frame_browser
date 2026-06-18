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
 * @param {string} filename - e.g. "00000123.jpg" or "00000123.key.jpg"
 * @returns {number|null}
 */
function parseFrameBasename(filename) {
  const parsed = parseFrameFilename(filename);
  return parsed?.frameIndex ?? null;
}

/**
 * @param {string} filename - e.g. "00000123.jpg" or "00000123.key.jpg"
 * @returns {{ frameIndex: number, isKeyframe: boolean }|null}
 */
function parseFrameFilename(filename) {
  const match = filename.match(/^(\d+)(?:\.key)?\.jpg$/i);
  if (!match) return null;
  return {
    frameIndex: parseInt(match[1], 10),
    isKeyframe: /\.key\.jpg$/i.test(filename),
  };
}

/** @param {number} frameIndex */
function formatFrameFilename(frameIndex) {
  return `${formatFrameBasename(frameIndex)}.jpg`;
}

/** @param {number} frameIndex */
function formatKeyframeFilename(frameIndex) {
  return `${formatFrameBasename(frameIndex)}.key.jpg`;
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
  parseFrameFilename,
  formatFrameFilename,
  formatKeyframeFilename,
};
