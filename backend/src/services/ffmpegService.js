/**
 * FFmpeg Service
 * FFmpeg command wrapping for video processing operations
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { execFile, spawn } = require('child_process');
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

/**
 * Segment URI uses exclusive `end` (next boundary / next keyframe).
 * Players advance by EXTINF = end - start; ffmpeg must not emit media past `end`,
 * otherwise consecutive segments share frames and playback flashbacks.
 */
function formatHlsSegmentUri(segmentBase, start, end, options = {}) {
  let uri = `${segmentBase}?start=${start}&end=${end}`;
  if (options.forceEncode) {
    uri += '&enc=1';
  }
  return uri;
}

/** Guard so stream-copy demux stops strictly before the next segment's keyframe. */
const SEGMENT_END_EPS_SEC = 0.001;

/**
 * Assemble a VOD media playlist with required TARGETDURATION for hls.js.
 *
 * Each segment is independently remuxed with -reset_timestamps 1 (needed so
 * copied video PTS and re-encoded AAC both start at 0). Without an explicit
 * discontinuity between segments, players treat the replay of PTS≈0 as a
 * backward jump on the media timeline — native progress bar "rewinds" at
 * every segment boundary. Mark each boundary so hls.js/Safari adjust
 * timestampOffset instead.
 */
function finalizeHlsPlaylist(segmentEntries) {
  const maxDur = Math.max(1, ...segmentEntries.map((entry) => entry.dur));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${Math.ceil(maxDur)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];

  segmentEntries.forEach(({ dur, uri }, index) => {
    if (index > 0) {
      lines.push('#EXT-X-DISCONTINUITY');
    }
    lines.push(`#EXTINF:${dur.toFixed(3)},`);
    lines.push(uri);
  });

  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

/**
 * Build a VOD HLS playlist (m3u8 text) covering [start, videoDuration].
 * Fixed `segDur` grid — last resort when keyframe probing fails.
 *
 * Mid-GOP starts cannot be cut cleanly with `-c:v copy` (ffmpeg seeks back to
 * the previous keyframe → heavy overlap / flashback). Force encode each segment.
 */
function buildHlsPlaylist(start, videoDuration, segDur, segmentBase = 'segment') {
  const end = roundSeekTime(videoDuration);
  let cursor = roundSeekTime(Math.max(0, Math.min(start, end)));
  const minSeg = 0.1;
  const segmentEntries = [];

  while (cursor < end - 0.001) {
    const segEnd = Math.min(end, roundSeekTime(cursor + segDur));
    const dur = roundSeekTime(Math.max(minSeg, segEnd - cursor));
    segmentEntries.push({
      dur,
      uri: formatHlsSegmentUri(segmentBase, cursor, segEnd, { forceEncode: true }),
    });
    cursor = segEnd;
  }

  return finalizeHlsPlaylist(segmentEntries);
}

/**
 * In-memory cache of full-video keyframe timestamps per movie.
 * Keyed by video path (stable per source file, avoids re-probing on each
 * preview click). Entries are plain objects so they can be GC'd if needed.
 * @type {Map<string, { times: number[], duration: number, ts: number }>}
 */
const keyframeCache = new Map();

const KEYFRAME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (in-memory layer)

function getKeyframeCachePath(videoPath) {
  const hash = crypto.createHash('sha256').update(videoPath).digest('hex').slice(0, 20);
  return path.join(config.paths.keyframeCache, `${hash}.json`);
}

async function readKeyframeCacheFromDisk(videoPath, videoDuration) {
  const cachePath = getKeyframeCachePath(videoPath);
  try {
    const raw = await fsPromises.readFile(cachePath, 'utf8');
    const data = JSON.parse(raw);
    if (data.videoPath !== videoPath) return null;
    if (Math.abs((data.duration || 0) - videoDuration) >= 0.5) return null;
    if (!Array.isArray(data.times) || data.times.length === 0) return null;
    return data.times;
  } catch {
    return null;
  }
}

async function writeKeyframeCacheToDisk(videoPath, videoDuration, times) {
  const cachePath = getKeyframeCachePath(videoPath);
  await fsPromises.mkdir(path.dirname(cachePath), { recursive: true });
  await fsPromises.writeFile(cachePath, JSON.stringify({
    videoPath,
    duration: videoDuration,
    times,
    updatedAt: new Date().toISOString(),
  }));
}

async function deleteKeyframeCacheFromDisk(videoPath) {
  const cachePath = getKeyframeCachePath(videoPath);
  try {
    await fsPromises.unlink(cachePath);
  } catch {
    // Cache file may not exist.
  }
}

/**
 * Get the sorted list of keyframe timestamps for a video, probing the full
 * file once and caching the result. Falls back to null on probe failure.
 * @returns {Promise<number[]|null>}
 */
async function getCachedKeyframeTimes(videoPath, videoDuration) {
  const now = Date.now();
  const hit = keyframeCache.get(videoPath);
  if (hit && now - hit.ts < KEYFRAME_CACHE_TTL_MS && Math.abs(hit.duration - videoDuration) < 0.5) {
    return hit.times;
  }

  const fromDisk = await readKeyframeCacheFromDisk(videoPath, videoDuration);
  if (fromDisk) {
    keyframeCache.set(videoPath, { times: fromDisk, duration: videoDuration, ts: now });
    logger.debug('Keyframe cache loaded from disk', { videoPath, count: fromDisk.length });
    return fromDisk;
  }

  try {
    const times = await probeAllKeyframeTimes(videoPath, videoDuration);
    if (times.length === 0) {
      return null;
    }
    await writeKeyframeCacheToDisk(videoPath, videoDuration, times);
    keyframeCache.set(videoPath, { times, duration: videoDuration, ts: now });
    logger.info('Keyframe cache built and persisted', { videoPath, count: times.length });
    return times;
  } catch (error) {
    logger.warn('Full keyframe probe failed, will fall back to fixed-grid playlist', {
      error: error.message,
    });
    return null;
  }
}

/** Binary search: largest index i where times[i] <= target. Returns -1 if none. */
function findLastKeyframeAtOrBefore(times, target) {
  let lo = 0;
  let hi = times.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= target + 0.001) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Build a VOD HLS playlist whose segment boundaries align with real video
 * keyframes. Each segment starts at a keyframe timestamp, so
 * `ffmpeg -ss <start> -c copy -f mpegts` produces a TS that begins with an
 * IDR keyframe — hls.js can demux it without fatal buffer-append errors.
 *
 * Greedy aggregation: starting from the keyframe at or before `startTimestamp`,
 * accumulate keyframes until the accumulated span reaches `segDur`, then cut
 * the segment at the next keyframe. This keeps segments roughly `segDur` long
 * while guaranteeing every segment boundary is a keyframe.
 *
 * Falls back to `buildHlsPlaylist` (fixed grid, start-only alignment) when
 * keyframe probing is unavailable.
 *
 * @param {string} videoPath - Source video path (also used as cache key)
 * @param {number} startTimestamp - Requested preview start (seconds)
 * @param {number} videoDuration - Total video duration (seconds)
 * @param {number} segDur - Target segment duration (seconds)
 * @param {number} [fps] - Frame rate (unused for now, reserved for manifest reuse)
 * @returns {Promise<string>} m3u8 playlist text
 */
async function buildKeyframeAlignedPlaylist(
  videoPath,
  startTimestamp,
  videoDuration,
  segDur,
  fps,
  segmentBase = 'segment'
) {
  const times = await getCachedKeyframeTimes(videoPath, videoDuration);
  const end = roundSeekTime(videoDuration);

  if (!times || times.length === 0) {
    logger.warn('Keyframe-aligned playlist unavailable, falling back to fixed grid', {
      videoPath,
    });
    return buildHlsPlaylist(startTimestamp, videoDuration, segDur, segmentBase);
  }

  // Ensure the final boundary equals the video end so the last segment closes
  // cleanly. Avoid duplicating an end keyframe.
  const keyframes = times.slice();
  if (keyframes[keyframes.length - 1] < end - 0.001) {
    keyframes.push(end);
  }

  const startIdx = Math.max(0, findLastKeyframeAtOrBefore(keyframes, startTimestamp));
  const minSeg = 0.1;
  const targetSeg = Math.max(minSeg, segDur);

  const segmentEntries = [];

  let segStartIdx = startIdx;
  while (segStartIdx < keyframes.length - 1) {
    const segStart = roundSeekTime(keyframes[segStartIdx]);

    // Greedily extend until accumulated duration reaches targetSeg, or we hit
    // the last keyframe. Cut at keyframe[endIdx] — exclusive end of this segment
    // and start of the next (playlist ranges abut; no declared overlap).
    let endIdx = segStartIdx + 1;
    while (endIdx < keyframes.length - 1 &&
      keyframes[endIdx] - segStart < targetSeg) {
      endIdx += 1;
    }

    const segEnd = roundSeekTime(Math.min(end, keyframes[endIdx]));
    const dur = roundSeekTime(Math.max(minSeg, segEnd - segStart));

    segmentEntries.push({
      dur,
      uri: formatHlsSegmentUri(segmentBase, segStart, segEnd, { forceEncode: true }),
    });

    segStartIdx = endIdx;
  }

  return finalizeHlsPlaylist(segmentEntries);
}

/**
 * FFmpeg output options for remuxing a source clip into an HLS TS segment.
 * MP4/MKV H.264/HEVC in copy mode needs bitstream filters for annex-B.
 */
function buildHlsOutputOptions(videoCodec, videoPath, options = {}) {
  const streamMaps = ['-map', '0:v:0', '-map', '0:a?'];
  // Always transcode audio to AAC — source tracks (AC3/DTS/AAC-in-MP4) often
  // break hls.js when copied into transport/container segments.
  const audioOpts = ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'];
  const trailerOpts = ['-sn', '-dn'];

  if (options.forceEncode) {
    return [
      ...streamMaps,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      ...audioOpts,
      ...trailerOpts,
    ];
  }

  const normalized = (videoCodec || '').toLowerCase();
  const ext = path.extname(videoPath || '').toLowerCase();
  const isMp4Like = ['.mp4', '.m4v', '.mov', '.3gp'].includes(ext);

  switch (normalized) {
    case 'h264': {
      const opts = [...streamMaps];
      if (isMp4Like) {
        opts.push('-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb');
      } else {
        opts.push('-c:v', 'copy');
      }
      return [...opts, ...audioOpts, ...trailerOpts];
    }
    case 'hevc':
    case 'h265': {
      const opts = [...streamMaps];
      if (isMp4Like) {
        opts.push('-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb');
      } else {
        opts.push('-c:v', 'copy');
      }
      return [...opts, ...audioOpts, ...trailerOpts];
    }
    case 'mpeg2video':
      return [
        ...streamMaps,
        '-c:v', 'copy',
        ...audioOpts,
        ...trailerOpts,
      ];
    default:
      return [
        ...streamMaps,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        ...audioOpts,
        ...trailerOpts,
      ];
  }
}

/**
 * Stream a single HLS segment (MPEG-TS) from the source video to an HTTP
 * response. TS is the native HLS segment format — hls.js handles TS discontinuity
 * reliably, avoiding fMP4 timestamp-offset bugs that cause visual flashbacks.
 * Headers are sent only after ffmpeg produces the first byte.
 *
 * All segments use re-encode (NOT stream-copy). This guarantees each segment
 * begins with a fresh IDR keyframe and ends precisely at `endTime`, avoiding
 * boundary-overlap flashbacks caused by ffprobe-reported keyframe timestamps
 * drifting from actual PTS values.
 *
 * @param {number} startTime - Segment start (seconds)
 * @param {number} endTime - Exclusive end (seconds, next segment start)
 */
function generateHlsSegment(videoPath, startTime, endTime, res, options = {}) {
  const start = roundSeekTime(Math.max(0, startTime));
  const endExclusive = roundSeekTime(Math.max(start + 0.1, endTime));
  // Stop demux slightly before the next segment's start keyframe.
  const cutTo = roundSeekTime(Math.max(start + 0.05, endExclusive - SEGMENT_END_EPS_SEC));
  const mediaDur = roundSeekTime(Math.max(0.05, cutTo - start));
  const outputOptions = buildHlsOutputOptions(options.codec, videoPath, {
    forceEncode: Boolean(options.forceEncode),
  });

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    // Both as input options: absolute file timeline, exclusive of next boundary.
    '-ss', String(start),
    '-to', String(cutTo),
    '-i', videoPath,
    ...outputOptions,
    // Clamp remux/encode so AAC padding cannot stretch past EXTINF into the next segment.
    '-t', String(mediaDur),
    '-avoid_negative_ts', 'make_zero',
    '-fflags', '+genpts',
    '-reset_timestamps', '1',
    '-f', 'mpegts',
    'pipe:1',
  ];

  const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let settled = false;
  let stderr = '';
  let bytesWritten = 0;
  let timeoutId = null;

  const clearSegmentTimeout = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearSegmentTimeout();
    if (error && !res.headersSent && !res.writableEnded) {
      // Controller will send JSON via next(error).
      return;
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  timeoutId = setTimeout(() => {
    logger.error('HLS segment timed out', { videoPath, start, end: cutTo });
    try {
      proc.kill('SIGKILL');
    } catch (e) {
      logger.debug('HLS segment timeout kill failed', { error: e.message });
    }
  }, config.hls.segmentTimeoutSec * 1000);

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (stderr.length > 4000) {
      stderr = stderr.slice(-4000);
    }
  });

  proc.stdout.on('data', (chunk) => {
    bytesWritten += chunk.length;
    if (!res.headersSent) {
      res.status(200);
      res.set({
        'Content-Type': 'video/MP2T',
        'Cache-Control': 'no-cache',
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
    }
    res.write(chunk);
  });

  let settleFn = null;

  const done = new Promise((resolve, reject) => {
    settleFn = (err) => {
      if (settled) return;
      if (err) {
        logger.error('HLS segment failed', {
          videoPath, start, end: cutTo, bytesWritten, error: err.message, stderr: stderr.slice(0, 500),
        });
        finish(err);
        reject(err);
        return;
      }
      finish();
      resolve();
    };

    proc.on('error', (err) => {
      settleFn(err);
    });

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0 || bytesWritten === 0) {
        const message = stderr.trim() || `ffmpeg exited with code ${code}`;
        settleFn(new Error(message));
        return;
      }
      settleFn();
    });
  });

  proc.stdout.on('error', (err) => {
    if (settled || !settleFn) return;
    settleFn(err);
  });

  const kill = () => {
    clearSegmentTimeout();
    try {
      proc.kill('SIGKILL');
    } catch (e) {
      logger.debug('HLS segment kill failed (already exited)', { error: e.message });
    }
  };

  return { done, kill };
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

  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

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
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  
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
 * Extract all keyframes in a single ffmpeg pass, then rename to frame-index key files.
 * @returns {Promise<{frameIndices: number[], total: number}>}
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

  await writeKeyframeCacheToDisk(videoPath, videoDuration, timestamps);
  keyframeCache.set(videoPath, { times: timestamps, duration: videoDuration, ts: Date.now() });

  const scratchDir = tempDir || path.join(config.paths.temp, `keyframe-${Date.now()}`);
  await fsPromises.rm(scratchDir, { recursive: true, force: true });
  await fsPromises.mkdir(scratchDir, { recursive: true });
  await fsPromises.mkdir(outputDir, { recursive: true });

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

    const entries = await fsPromises.readdir(scratchDir);
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

    const savedFrameIndices = [];
    const seenFrameKeys = new Set();

    for (let i = 0; i < count; i++) {
      const frameIndex = getFrameIndex(timestamps[i], fps, videoDuration);
      const basename = formatFrameBasename(frameIndex);
      const destPath = path.join(outputDir, formatKeyframeFilename(frameIndex));
      const srcPath = path.join(scratchDir, batchFiles[i].name);

      try {
        await fsPromises.access(destPath);
        await fsPromises.unlink(srcPath);
      } catch {
        await fsPromises.rename(srcPath, destPath);
      }

      if (!seenFrameKeys.has(basename)) {
        seenFrameKeys.add(basename);
        savedFrameIndices.push(frameIndex);
      }

      if (progressCallback) {
        const pct = Math.round(90 + ((i + 1) / count) * 10);
        progressCallback(pct, `正在整理关键帧 (${i + 1}/${count})...`);
      }
    }

    logger.info('Keyframe batch extraction completed', {
      probed: timestamps.length,
      saved: savedFrameIndices.length,
    });

    return { frameIndices: savedFrameIndices, total: savedFrameIndices.length };
  } finally {
    await fsPromises.rm(scratchDir, { recursive: true, force: true });
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
  await fsPromises.mkdir(outputDir, { recursive: true });
  
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
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  
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
  probeAllKeyframeTimes,
  findKeyframeBefore,
  findAdjacentKeyframe,
  buildHlsPlaylist,
  buildKeyframeAlignedPlaylist,
  generateHlsSegment,
  deleteKeyframeCacheFromDisk,
  extractAllKeyframesBatch,
  extractFrameBatch,
  extractFramesSmart,
  generateSpriteSheet,
};