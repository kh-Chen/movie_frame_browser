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
const { DEFAULT_FPS, formatFrameBasename, formatKeyframeFilename, getFrameIndex, quantizeToFrame } = require('../utils/frameTimestamp');

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
// fluent-ffmpeg timeout is seconds; internally uses setTimeout(timeout * 1000)
const MAX_FFMPEG_TIMEOUT_SEC = 2147483;

/** Timeout for full-video keyframe batch (seconds). */
function getBatchKeyframeTimeoutSec(videoDurationSec) {
  const estimatedSec = Math.ceil(videoDurationSec * 3);
  return Math.min(
    MAX_FFMPEG_TIMEOUT_SEC,
    Math.max(ffmpegTimeoutSec, estimatedSec, 600)
  );
}

/** Round seek times to avoid ultra-long decimal timestamps from the timeline. */
function roundSeekTime(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

/** Compute preview segment: back seek + keyframe, forward seek + keyframe. */
async function computePreviewSegment(videoPath, timestamp, videoDuration = null) {
  const center = roundSeekTime(timestamp);
  const seekBack = config.frame.defaultClipSeekBack;
  const seekForward = config.frame.defaultClipSeekForward;

  const startTarget = roundSeekTime(Math.max(0, center - seekBack));
  let endTarget = roundSeekTime(center + seekForward);
  if (videoDuration != null) {
    endTarget = roundSeekTime(Math.min(videoDuration, endTarget));
  }

  const startTime = await findKeyframeBefore(videoPath, startTarget);
  let endTime = await findKeyframeAfter(videoPath, endTarget, videoDuration);
  if (videoDuration != null) {
    endTime = roundSeekTime(Math.min(videoDuration, endTime));
  }
  if (endTime <= startTime) {
    endTime = roundSeekTime(Math.min(
      videoDuration ?? startTime + 0.1,
      startTime + 0.1
    ));
  }

  const duration = Math.max(0.1, roundSeekTime(endTime - startTime));
  return {
    startTime,
    endTime,
    duration,
    center,
    seekBack,
    seekForward,
  };
}

/** Probe all keyframe timestamps across the full video (chunked for long files). */
async function probeAllKeyframeTimes(videoPath, duration) {
  const CHUNK_SEC = 600;
  const allTimes = new Set();
  let start = 0;

  while (start <= duration + 0.001) {
    const end = Math.min(duration, start + CHUNK_SEC);
    const times = await probeKeyframeTimes(videoPath, start, end);
    for (const t of times) {
      allTimes.add(roundSeekTime(t));
    }
    if (end >= duration) break;
    start = end + 0.001;
  }

  return Array.from(allTimes).sort((a, b) => a - b);
}

/** Probe keyframe timestamps within [startSec, endSec] (seconds from file start). */
async function probeKeyframeTimes(videoPath, startSec, endSec) {
  const start = roundSeekTime(Math.max(0, startSec));
  const end = roundSeekTime(Math.max(start, endSec));
  const duration = Math.max(0.001, roundSeekTime(end - start));
  const interval = `${start}%+${duration}`;

  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-skip_frame', 'nokey',
    '-show_entries', 'frame=best_effort_timestamp_time',
    '-of', 'csv=p=0',
    '-read_intervals', interval,
    videoPath,
  ], { maxBuffer: 1024 * 1024 });

  return stdout.trim().split('\n')
    .map((line) => parseFloat(line))
    .filter((n) => !Number.isNaN(n));
}

/** Nearest keyframe at or before timestamp. */
async function findKeyframeBefore(videoPath, timestamp) {
  const t = roundSeekTime(timestamp);
  const searchStart = Math.max(0, t - 60);

  try {
    const times = await probeKeyframeTimes(videoPath, searchStart, t);
    const valid = times.filter((n) => n <= t + 0.001);

    if (valid.length === 0) {
      return Math.max(0, t);
    }
    return roundSeekTime(Math.max(...valid));
  } catch (error) {
    logger.warn('Keyframe probe failed, using requested start', { error: error.message });
    return Math.max(0, t);
  }
}

/** Nearest keyframe at or after timestamp. */
async function findKeyframeAfter(videoPath, timestamp, videoDuration = null) {
  const t = roundSeekTime(timestamp);
  const searchEnd = videoDuration != null
    ? roundSeekTime(Math.min(videoDuration, t + 60))
    : roundSeekTime(t + 60);

  try {
    const times = await probeKeyframeTimes(videoPath, t, searchEnd);
    const valid = times.filter((n) => n >= t - 0.001);

    if (valid.length === 0) {
      return t;
    }
    return roundSeekTime(Math.min(...valid));
  } catch (error) {
    logger.warn('Keyframe probe (after) failed, using requested end', { error: error.message });
    return t;
  }
}

const KEYFRAME_STEP_EPS = 0.001;

/** Next or previous keyframe relative to current position. */
async function findAdjacentKeyframe(videoPath, timestamp, direction, videoDuration = null) {
  const t = roundSeekTime(timestamp);

  if (direction === 'next' || direction === 1) {
    const searchEnd = videoDuration != null
      ? roundSeekTime(Math.min(videoDuration, t + 60))
      : roundSeekTime(t + 60);

    try {
      const times = await probeKeyframeTimes(videoPath, t, searchEnd);
      const valid = times.filter((n) => n > t + KEYFRAME_STEP_EPS);

      if (valid.length > 0) {
        let next = roundSeekTime(Math.min(...valid));
        if (videoDuration != null && next > videoDuration) {
          next = roundSeekTime(videoDuration);
        }
        return next;
      }

      if (videoDuration != null && t >= videoDuration - KEYFRAME_STEP_EPS) {
        return roundSeekTime(videoDuration);
      }
      return t;
    } catch (error) {
      logger.warn('Keyframe step (next) failed', { error: error.message });
      return t;
    }
  }

  const searchStart = Math.max(0, t - 60);

  try {
    const times = await probeKeyframeTimes(videoPath, searchStart, t);
    const valid = times.filter((n) => n < t - KEYFRAME_STEP_EPS);

    if (valid.length > 0) {
      return roundSeekTime(Math.max(...valid));
    }

    if (t <= KEYFRAME_STEP_EPS) {
      return 0;
    }
    return t;
  } catch (error) {
    logger.warn('Keyframe step (prev) failed', { error: error.message });
    return t;
  }
}

/** Resolve actual source timeline bounds from a generated clip file. */
async function resolveClipSegment(_videoPath, clipPath, segment, videoDuration = null) {
  const { startTime, endTime: requestedEndTime } = segment;
  const clipInfo = await getVideoInfo(clipPath);
  let actualEnd = roundSeekTime(startTime + clipInfo.duration);
  if (videoDuration != null) {
    actualEnd = roundSeekTime(Math.min(videoDuration, actualEnd));
  }

  return {
    startTime,
    endTime: actualEnd,
    duration: roundSeekTime(Math.max(0.1, actualEnd - startTime)),
    requestedStartTime: startTime,
    requestedEndTime,
  };
}

/**
 * Extract a short MP4 clip for browser playback (stream copy only).
 * @returns {Promise<object>} Actual segment bounds in source video timeline
 */
async function generatePreviewClip(videoPath, timestamp, outputPath, options = {}) {
  const { videoDuration = null } = options;
  const segment = await computePreviewSegment(videoPath, timestamp, videoDuration);
  const { startTime, duration } = segment;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

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

/** Parse ffmpeg timemark "HH:MM:SS.ms" to seconds. */
function parseTimemark(timemark) {
  if (!timemark || typeof timemark !== 'string') return 0;
  const parts = timemark.split(':');
  if (parts.length < 3) return 0;
  const seconds = parseFloat(parts[2]);
  const minutes = parseInt(parts[1], 10);
  const hours = parseInt(parts[0], 10);
  if ([seconds, minutes, hours].some((n) => Number.isNaN(n))) return 0;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Extract all keyframes in a single ffmpeg pass, then rename to timestamp-based files.
 * @param {string} videoPath
 * @param {string} outputDir - Final frame directory (frames/{movieId})
 * @param {object} options
 * @param {string} options.tempDir - Scratch directory for sequential output
 * @param {number} options.duration - Video duration (seconds)
 * @param {number} options.width
 * @param {number} options.quality
 * @param {Function} progressCallback - (percent, message) => void
 * @returns {Promise<{timestamps: number[], total: number}>}
 */
async function extractAllKeyframesBatch(videoPath, outputDir, options = {}, progressCallback = null) {
  const {
    tempDir,
    duration: knownDuration = null,
    fps = DEFAULT_FPS,
    width = config.frame.defaultWidth,
    quality = config.frame.defaultQuality,
  } = options;

  const videoDuration = knownDuration ?? (await getVideoInfo(videoPath)).duration;

  if (progressCallback) {
    progressCallback(5, '正在探测关键帧...');
  }

  const timestamps = await probeAllKeyframeTimes(videoPath, videoDuration);
  if (timestamps.length === 0) {
    throw new Error('未找到关键帧');
  }

  const scratchDir = tempDir || path.join(config.paths.temp, `keyframe-${Date.now()}`);
  await fs.rm(scratchDir, { recursive: true, force: true });
  await fs.mkdir(scratchDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const qv = String(Math.max(1, Math.min(31, Math.round(31 * (100 - quality) / 100))));
  const batchTimeoutSec = getBatchKeyframeTimeoutSec(videoDuration);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath, { timeout: batchTimeoutSec })
        .inputOptions(['-skip_frame', 'nokey'])
        .outputOptions([
          '-vsync', '0',
          '-vf', `scale=${width}:-1:flags=lanczos`,
          '-q:v', qv,
          '-threads', String(config.ffmpeg.threads),
        ])
        .output(path.join(scratchDir, '%06d.jpg'))
        .on('start', (commandLine) => {
          logger.info('Keyframe batch extraction started', {
            command: commandLine.substring(0, 300),
            keyframeCount: timestamps.length,
            timeoutSec: batchTimeoutSec,
          });
        })
        .on('progress', (progress) => {
          if (!progressCallback) return;

          let pct = progress.percent;
          if (pct == null && progress.timemark && videoDuration > 0) {
            pct = (parseTimemark(progress.timemark) / videoDuration) * 100;
          }
          if (pct != null) {
            const mapped = Math.round(5 + Math.min(100, Math.max(0, pct)) * 0.85);
            progressCallback(mapped, '正在采集关键帧...');
          }
        })
        .on('error', (err, _stdout, stderr) => {
          logger.error('Keyframe batch extraction failed', {
            error: err.message,
            stderr: (stderr || '').substring(0, 500),
          });
          reject(err);
        })
        .on('end', resolve)
        .run();
    });

    const entries = await fs.readdir(scratchDir);
    const batchFiles = entries
      .filter((f) => /^\d+\.jpg$/i.test(f))
      .map((f) => ({
        name: f,
        index: parseInt(f.replace(/\.jpg$/i, ''), 10),
      }))
      .sort((a, b) => a.index - b.index);

    if (batchFiles.length !== timestamps.length) {
      logger.warn('Keyframe count mismatch between ffprobe and ffmpeg output', {
        probed: timestamps.length,
        extracted: batchFiles.length,
      });
    }

    const count = Math.min(batchFiles.length, timestamps.length);
    if (count === 0) {
      throw new Error('关键帧提取未产出任何文件');
    }

    const savedTimestamps = [];
    const seenFrameKeys = new Set();

    for (let i = 0; i < count; i++) {
      const frameIndex = getFrameIndex(timestamps[i], fps, videoDuration);
      const basename = formatFrameBasename(frameIndex);
      const destPath = path.join(outputDir, formatKeyframeFilename(frameIndex));
      const srcPath = path.join(scratchDir, batchFiles[i].name);

      try {
        await fs.access(destPath);
        await fs.unlink(srcPath);
      } catch {
        await fs.rename(srcPath, destPath);
      }

      if (!seenFrameKeys.has(basename)) {
        seenFrameKeys.add(basename);
        savedTimestamps.push(quantizeToFrame(timestamps[i], fps, videoDuration));
      }

      if (progressCallback) {
        const pct = Math.round(90 + ((i + 1) / count) * 10);
        progressCallback(pct, `正在整理关键帧 (${i + 1}/${count})...`);
      }
    }

    logger.info('Keyframe batch extraction completed', {
      probed: timestamps.length,
      saved: savedTimestamps.length,
    });

    return { timestamps: savedTimestamps, total: savedTimestamps.length };
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
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
  probeAllKeyframeTimes,
  findAdjacentKeyframe,
  resolveClipSegment,
  generatePreviewClip,
  extractAllKeyframesBatch,
  extractFrameBatch,
  extractFramesSmart,
  generateSpriteSheet,
};