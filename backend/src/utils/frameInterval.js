/**
 * Adaptive frame index interval by video duration (see docs/requirements.md)
 */

function getAdaptiveFrameInterval(durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 600) return 1;
  if (duration <= 3600) return 5;
  if (duration <= 7200) return 10;
  return 30;
}

module.exports = {
  getAdaptiveFrameInterval,
};
