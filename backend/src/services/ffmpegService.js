/**
 * FFmpeg Service
 * FFmpeg command wrapping for video processing operations
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const config = require('../config');
const logger = require('../utils/logger');
const { formatTime } = require('../utils/timeFormatter');

/**
 * Get FFmpeg binary path (uses system ffmpeg by default)
 * Can be configured via FFMPEG_PATH environment variable
 */
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// Default FFmpeg options
const defaultOptions = {
  threads: config.ffmpeg.threads,
  timeout: config.ffmpeg.timeout,
};

const ffmpegTimeoutSec = Math.max(30, Math.ceil(config.ffmpeg.timeout / 1000));
const clipTimeoutSec = Math.min(ffmpegTimeoutSec, Math.max(10, parseInt(process.env.CLIP_FFMPEG_TIMEOUT_SEC, 10) || 20));

/** Round seek times to avoid ultra-long decimal timestamps from the timeline. */
function roundSeekTime(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

/** Compute center ± window segment, capped by max duration. */
function computePreviewSegment(timestamp, window, videoDuration, maxDuration) {
  const effectiveWindow = Math.min(window, config.frame.defaultClipWindow);
  const center = roundSeekTime(timestamp);
  const startTime = roundSeekTime(Math.max(0, center - effectiveWindow));
  let endTime = roundSeekTime(center + effectiveWindow);
  if (videoDuration != null) {
    endTime = roundSeekTime(Math.min(videoDuration, endTime));
  }
  let duration = Math.max(0.1, roundSeekTime(endTime - startTime));
  duration = Math.min(duration, maxDuration ?? config.frame.defaultClipMaxDuration);
  return { startTime, duration, center, window: effectiveWindow };
}

/** Nearest keyframe at or before timestamp (stream-copy seek alignment). */
async function findKeyframeBefore(videoPath, timestamp) {
  const t = roundSeekTime(timestamp);
  const searchStart = Math.max(0, t - 60);
  const interval = `${searchStart}%@${t}`;

  try {
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-skip_frame', 'nokey',
      '-show_entries', 'frame=best_effort_timestamp_time',
      '-of', 'csv=p=0',
      '-read_intervals', interval,
      videoPath,
    ], { maxBuffer: 1024 * 1024 });

    const times = stdout.trim().split('\n')
      .map((line) => parseFloat(line))
      .filter((n) => !Number.isNaN(n) && n <= t + 0.001);

    if (times.length === 0) {
      return Math.max(0, t);
    }
    return roundSeekTime(Math.max(...times));
  } catch (error) {
    logger.warn('Keyframe probe failed, using requested start', { error: error.message });
    return Math.max(0, t);
  }
}

/** Resolve actual source timeline bounds from a generated clip file. */
async function resolveClipSegment(videoPath, clipPath, segment, videoDuration = null) {
  const { startTime: requestedStart, duration: requestedDuration } = segment;
  const clipInfo = await getVideoInfo(clipPath);
  const actualStart = await findKeyframeBefore(videoPath, requestedStart);
  let actualEnd = roundSeekTime(actualStart + clipInfo.duration);
  if (videoDuration != null) {
    actualEnd = roundSeekTime(Math.min(videoDuration, actualEnd));
  }

  return {
    startTime: actualStart,
    endTime: actualEnd,
    duration: roundSeekTime(Math.max(0.1, actualEnd - actualStart)),
    requestedStartTime: requestedStart,
    requestedEndTime: roundSeekTime(requestedStart + requestedDuration),
  };
}

/**
 * Extract a short MP4 clip for browser playback (stream copy, then ultrafast transcode).
 * @returns {Promise<object>} Actual segment bounds in source video timeline
 */
async function generatePreviewClip(videoPath, timestamp, window, outputPath, options = {}) {
  const { videoDuration = null, width = config.frame.defaultClipWidth } = options;
  const segment = computePreviewSegment(
    timestamp,
    window,
    videoDuration,
    config.frame.defaultClipMaxDuration
  );
  const { startTime, duration } = segment;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const transcodeScale = width > 0
    ? `scale=${width}:-2:flags=fast_bilinear`
    : 'scale=480:-2:flags=fast_bilinear';

  try {
    await executeFfmpegCommand('Preview clip (copy)', () =>
      ffmpeg(videoPath, { timeout: clipTimeoutSec })
        .inputOptions(['-ss', String(startTime)])
        .outputOptions([
          '-t', String(duration),
          '-an',
          '-sn',
          '-dn',
          '-c', 'copy',
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero',
        ])
        .output(outputPath)
    );
  } catch (copyError) {
    logger.warn('Preview clip stream-copy failed, using ultrafast transcode', {
      error: copyError.message,
    });
    await executeFfmpegCommand('Preview clip (transcode)', () =>
      ffmpeg(videoPath, { timeout: clipTimeoutSec })
        .inputOptions(['-ss', String(startTime)])
        .outputOptions([
          '-t', String(duration),
          '-an',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '28',
          '-vf', transcodeScale,
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
        ])
        .output(outputPath)
    );
  }

  return resolveClipSegment(videoPath, outputPath, segment, videoDuration);
}

/**
 * Execute an FFmpeg command with logging and error handling
 * @param {string} description - Description of the operation
 * @param {Function} commandFn - Function that creates and returns the command
 * @returns {Promise<void>}
 */
async function executeFfmpegCommand(description, commandFn) {
  return new Promise((resolve, reject) => {
    const command = commandFn();
    
    logger.debug(`FFmpeg: ${description}`, { input: command._inputs, output: command._output });
    
    command
      .on('start', (commandLine) => {
        logger.debug(`FFmpeg command started: ${commandLine.substring(0, 200)}...`);
      })
      .on('progress', (progress) => {
        logger.debug(`FFmpeg progress`, { 
          percent: progress.percent,
          currentTime: formatTime(progress.currentTime),
        });
      })
      .on('error', (err, stdout, stderr) => {
        logger.error(`FFmpeg error: ${description}`, { 
          error: err.message,
          stderr: stderr.substring(0, 500),
        });
        reject(err);
      })
      .on('end', () => {
        logger.debug(`FFmpeg completed: ${description}`);
        resolve();
      })
      .run();
  });
}

/**
 * Get video information using ffprobe
 * @param {string} videoPath - Path to video file
 * @returns {Promise<object>} Video metadata
 */
async function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.error('Failed to get video info', { error: err.message, path: videoPath });
        return reject(err);
      }
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        return reject(new Error('No video stream found'));
      }
      
      // Parse frame rate
      let fps = 30;
      if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        fps = den ? (num / den).toFixed(2) : num;
      }
      
      const info = {
        duration: parseFloat(metadata.format.duration) || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        codec: videoStream.codec_name || 'unknown',
        bitrate: parseInt(metadata.format.bit_rate) || 0,
        fps: parseFloat(fps),
        format: metadata.format.format_name || 'unknown',
        size: parseInt(metadata.format.size) || 0,
      };
      
      logger.debug('Video info retrieved', { 
        path: videoPath, 
        duration: info.duration,
        resolution: `${info.width}x${info.height}`,
      });
      
      resolve(info);
    });
  });
}

/**
 * Extract cover image from video
 * @param {string} videoPath - Path to video file
 * @param {string} outputPath - Path for output cover image
 * @param {object} options - Extraction options
 * @param {number} options.timestamp - Timestamp to extract cover (default: 5% of duration)
 * @param {number} options.width - Output width (default: 1280)
 * @param {number} options.quality - JPEG quality 1-100 (default: 85)
 */
async function extractCover(videoPath, outputPath, options = {}) {
  const { timestamp = null, width = 1280, quality = 85 } = options;
  const qScale = Math.max(1, Math.min(31, Math.round(31 * (100 - quality) / 100)));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    let command = ffmpeg(videoPath);

    command = command.inputOptions([
      `-ss ${timestamp || 10}`,
      '-accurateSeek',
    ]);

    command = command.outputOptions([
      '-vframes', '1',
      '-q:v', String(qScale),
      '-vf', `scale=${width}:-1`,
      '-threads', String(config.ffmpeg.threads),
    ]);
    
    command
      .output(outputPath)
      .on('start', (cmd) => {
        logger.debug('Cover extraction started', { cmd: cmd.substring(0, 200) });
      })
      .on('error', (err) => {
        logger.error('Cover extraction failed', { error: err.message });
        reject(err);
      })
      .on('end', () => {
        logger.info('Cover extracted successfully', { output: outputPath });
        resolve();
      })
      .run();
  });
}

/**
 * Extract a single frame at specified timestamp
 * @param {string} videoPath - Path to video file
 * @param {number} timestamp - Timestamp in seconds
 * @param {string} outputPath - Path for output frame image
 * @param {object} options - Extraction options
 * @param {number} options.width - Output width (default: 1280)
 * @param {number} options.quality - JPEG quality 1-100 (default: 75)
 */
async function extractFrame(videoPath, timestamp, outputPath, options = {}) {
  const { width = config.frame.defaultWidth, quality = config.frame.defaultQuality } = options;
  
  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  
  return executeFfmpegCommand('frame extraction', () => {
    return ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .outputOptions([
        '-q:v', String(Math.max(1, Math.min(31, Math.round(31 * (100 - quality) / 100)))), // Quality mapping
        '-vf', `scale=${width}:-1:flags=lanczos`,
        '-threads', String(config.ffmpeg.threads),
      ])
      .output(outputPath);
  });
}

/**
 * Extract frames at multiple timestamps
 * @param {string} videoPath - Path to video file
 * @param {number[]} timestamps - Array of timestamps in seconds
 * @param {string} outputDir - Directory for output frames
 * @param {object} options - Extraction options
 * @param {number} options.width - Output width (default: 1280)
 * @param {number} options.quality - JPEG quality 1-100 (default: 75)
 * @param {Function} progressCallback - Callback for progress updates
 */
async function extractFrameBatch(videoPath, timestamps, outputDir, options = {}, progressCallback = null) {
  const { width = config.frame.defaultWidth, quality = config.frame.defaultQuality } = options;
  
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  
  const total = timestamps.length;
  let completed = 0;
  
  // Process frames sequentially to avoid overwhelming the system
  for (const timestamp of timestamps) {
    const outputPath = path.join(outputDir, `${timestamp}.jpg`);
    
    try {
      await extractFrame(videoPath, timestamp, outputPath, { width, quality });
      completed++;
      
      if (progressCallback) {
        progressCallback({
          completed,
          total,
          percent: Math.round((completed / total) * 100),
          currentTimestamp: timestamp,
        });
      }
      
      logger.debug('Batch frame extracted', { timestamp, completed, total });
    } catch (error) {
      logger.error('Batch frame extraction failed', { timestamp, error: error.message });
      // Continue with next frame even if one fails
    }
  }
  
  return { completed, total };
}

/**
 * Extract frames using scene detection
 * @param {string} videoPath - Path to video file
 * @param {string} outputDir - Directory for output frames
 * @param {object} options - Extraction options
 * @param {number} options.interval - Base interval in seconds
 * @param {number} options.width - Output width
 * @param {number} options.quality - JPEG quality
 */
async function extractFramesSmart(videoPath, outputDir, options = {}) {
  const info = await getVideoInfo(videoPath);
  const { interval = 60, width = 1280, quality = 75 } = options;
  
  // Generate timestamps based on interval
  const timestamps = [];
  for (let t = 0; t < info.duration; t += interval) {
    timestamps.push(Math.floor(t));
  }
  
  // Include the last frame
  if (timestamps[timestamps.length - 1] !== Math.floor(info.duration)) {
    timestamps.push(Math.floor(info.duration));
  }
  
  return extractFrameBatch(videoPath, timestamps, outputDir, { width, quality });
}

/**
 * Generate video thumbnail sprite sheet
 * @param {string} videoPath - Path to video file
 * @param {string} outputPath - Path for output sprite sheet
 * @param {object} options - Sprite options
 * @param {number} options.columns - Number of columns (default: 10)
 * @param {number} options.width - Thumbnail width (default: 160)
 * @param {number} options.interval - Interval between thumbnails (default: 60 seconds)
 */
async function generateSpriteSheet(videoPath, outputPath, options = {}) {
  const { columns = 10, width = 160, interval = 60 } = options;
  
  const info = await getVideoInfo(videoPath);
  const numFrames = Math.ceil(info.duration / interval);
  const rows = Math.ceil(numFrames / columns);
  
  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  
  return executeFfmpegCommand('sprite sheet generation', () => {
    return ffmpeg(videoPath)
      .outputOptions([
        '-vf', `fps=1/${interval},scale=${width}:-1:tile=${columns}x${rows}`,
        '-threads', String(config.ffmpeg.threads),
      ])
      .output(outputPath);
  });
}

module.exports = {
  getVideoInfo,
  extractCover,
  extractFrame,
  computePreviewSegment,
  resolveClipSegment,
  generatePreviewClip,
  extractFrameBatch,
  extractFramesSmart,
  generateSpriteSheet,
};