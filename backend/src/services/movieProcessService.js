/**
 * Shared movie ingest processing (cover only; frames on demand)
 */

const path = require('path');
const config = require('../config');
const cacheService = require('./cacheService');
const storageService = require('./storageService');
const ffmpegService = require('./ffmpegService');
const { getAdaptiveFrameInterval } = require('../utils/frameInterval');
const logger = require('../utils/logger');

/**
 * @param {object} options
 * @param {string} options.movieId
 * @param {string} options.moviePath
 * @param {object} options.videoInfo
 * @param {Function} options.onProgress
 */
async function processMovieIngest({ movieId, moviePath, videoInfo, onProgress }) {
  const frameInterval = getAdaptiveFrameInterval(videoInfo.duration);

  onProgress(10, '正在提取封面...');
  const coverPath = storageService.getCoverPath(movieId);

  try {
    await ffmpegService.extractCover(moviePath, coverPath, {
      timestamp: Math.min(10, videoInfo.duration * 0.05),
      quality: config.frame.defaultQuality,
    });
    await cacheService.updateMovie(movieId, { coverFile: `${movieId}.jpg` });
  } catch (error) {
    logger.error('Cover extraction failed', { movieId, error: error.message });
  }

  onProgress(80, '正在生成帧索引...');

  const expectedFrames = Math.max(
    1,
    Math.floor(videoInfo.duration / frameInterval) + 1
  );

  await cacheService.updateMovie(movieId, {
    status: 'ready',
    frameInterval,
    totalFrames: expectedFrames,
  });

  onProgress(100, '处理完成');
}

module.exports = {
  processMovieIngest,
};
