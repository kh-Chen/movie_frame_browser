/**
 * Storage Service
 * File path management and cache operations
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Get cover image path for a movie
 * @param {string} movieId - Movie ID
 * @returns {string} Cover image path
 */
function getCoverPath(movieId) {
  return path.join(config.paths.covers, `${movieId}.jpg`);
}

/**
 * Get frame image path for a movie at specific timestamp
 * @param {string} movieId - Movie ID
 * @param {number} timestamp - Timestamp in seconds
 * @returns {string} Frame image path
 */
function getFramePath(movieId, timestamp) {
  const movieFrameDir = path.join(config.paths.frames, movieId);
  return path.join(movieFrameDir, `${timestamp}.jpg`);
}

function getFrameMetaPath(movieId, timestamp) {
  return getFramePath(movieId, timestamp).replace(/\.jpg$/, '.meta.json');
}

function getKeyframesManifestPath(movieId) {
  return path.join(config.paths.frames, movieId, 'keyframes.json');
}

async function saveFrameMeta(movieId, timestamp, meta) {
  const metaPath = getFrameMetaPath(movieId, timestamp);
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(meta));
}

async function readFrameMeta(movieId, timestamp) {
  const metaPath = getFrameMetaPath(movieId, timestamp);
  try {
    const data = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveKeyframesManifest(movieId, data) {
  const manifestPath = getKeyframesManifestPath(movieId);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(data));
}

async function readKeyframesManifest(movieId) {
  const manifestPath = getKeyframesManifestPath(movieId);
  try {
    const data = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Get preview clip path (MP4, browser-playable)
 * @param {string} movieId
 * @param {number} timestamp - Center timestamp
 */
function getClipPath(movieId, timestamp) {
  const ts = Math.round(timestamp * 1000) / 1000;
  const movieClipDir = path.join(config.paths.clips, movieId);
  return path.join(movieClipDir, `t${ts}.mp4`);
}

function getClipMetaPath(movieId, timestamp) {
  return getClipPath(movieId, timestamp).replace(/\.mp4$/, '.json');
}

async function saveClipMeta(movieId, timestamp, meta) {
  const metaPath = getClipMetaPath(movieId, timestamp);
  await fs.writeFile(metaPath, JSON.stringify(meta));
}

async function readClipMeta(movieId, timestamp) {
  const metaPath = getClipMetaPath(movieId, timestamp);
  try {
    const data = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Get temporary file path
 * @param {string} taskId - Task ID
 * @param {string} filename - Filename
 * @returns {string} Temporary file path
 */
function getTempPath(taskId, filename) {
  const tempTaskDir = path.join(config.paths.temp, taskId);
  return path.join(tempTaskDir, filename);
}

/**
 * Ensure all required directories exist
 */
async function ensureDirectories() {
  const dirs = [
    config.paths.covers,
    config.paths.frames,
    config.paths.clips,
    config.paths.temp,
    path.join(config.paths.data, 'logs'),
  ];
  
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
  
  logger.debug('Storage directories ensured');
}

/**
 * Delete generated assets for a movie (cover, frames, clips)
 * @param {string} movieId - Movie ID
 */
async function deleteMovieFiles(movieId) {
  const dirs = [
    path.join(config.paths.frames, movieId),
    path.join(config.paths.clips, movieId),
    path.join(config.paths.temp, movieId),
  ];

  const files = [getCoverPath(movieId)];
  
  // Delete files
  for (const file of files) {
    try {
      await fs.unlink(file);
      logger.debug(`Deleted file: ${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to delete file: ${file}`, { error: error.message });
      }
    }
  }
  
  // Delete directories
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      logger.debug(`Deleted directory: ${dir}`);
    } catch (error) {
      logger.warn(`Failed to delete directory: ${dir}`, { error: error.message });
    }
  }
}

/**
 * Calculate total cache size
 * @returns {Promise<object>} Cache size information
 */
async function getCacheSize() {
  const result = {
    total: 0,
    covers: 0,
    frames: 0,
    clips: 0,
    temp: 0,
  };
  
  const calculateDirSize = async (dir) => {
    let size = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          size += stat.size;
        } else if (entry.isDirectory()) {
          size += await calculateDirSize(fullPath);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to calculate size for: ${dir}`, { error: error.message });
      }
    }
    return size;
  };
  
  result.covers = await calculateDirSize(config.paths.covers);
  result.frames = await calculateDirSize(config.paths.frames);
  result.clips = await calculateDirSize(config.paths.clips);
  result.temp = await calculateDirSize(config.paths.temp);
  result.total = result.covers + result.frames + result.clips + result.temp;
  
  return result;
}

/**
 * Get files with their access times for LRU cleanup
 * @param {string} dir - Directory to scan
 * @returns {Promise<Array>} Array of file objects with path, size, and lastAccess
 */
async function getCacheFiles(dir) {
  const files = [];
  
  const scanDir = async (directory) => {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          files.push({
            path: fullPath,
            size: stat.size,
            lastAccess: stat.atimeMs,
            created: stat.birthtimeMs,
          });
        } else if (entry.isDirectory()) {
          await scanDir(fullPath);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to scan directory: ${directory}`, { error: error.message });
      }
    }
  };
  
  await scanDir(dir);
  return files;
}

/**
 * Clean up cache to target size
 * @param {number} targetSize - Target size in bytes
 * @returns {Promise<object>} Cleanup result
 */
async function cleanupCache(targetSize) {
  const currentSize = await getCacheSize();
  
  if (currentSize.total <= targetSize) {
    return { freed: 0, filesDeleted: 0 };
  }
  
  const targetFree = currentSize.total - targetSize;
  let freedSpace = 0;
  let filesDeleted = 0;
  
  // Scan temp directory first (lowest priority)
  const dirs = [
    path.join(config.paths.temp),
    path.join(config.paths.frames),
    path.join(config.paths.clips),
    config.paths.covers,
  ];
  
  for (const dir of dirs) {
    if (freedSpace >= targetFree) break;
    
    const files = await getCacheFiles(dir);
    
    // Sort by last access time (oldest first) - LRU
    files.sort((a, b) => a.lastAccess - b.lastAccess);
    
    for (const file of files) {
      if (freedSpace >= targetFree) break;
      
      try {
        const normalized = file.path.split(path.sep).join('/');
        if (normalized.includes('/covers/') && !normalized.includes('/frames/')) {
          continue;
        }
        
        await fs.unlink(file.path);
        freedSpace += file.size;
        filesDeleted++;
        logger.debug(`Deleted for cache cleanup: ${file.path}`);
      } catch (error) {
        logger.warn(`Failed to delete during cleanup: ${file.path}`, { error: error.message });
      }
    }
  }
  
  logger.info(`Cache cleanup completed`, { freed: freedSpace, filesDeleted });
  return { freed: freedSpace, filesDeleted };
}

/**
 * Clean up old temp files (TTL: 24 hours)
 */
async function cleanupTempFiles() {
  const tempDir = config.paths.temp;
  const now = Date.now();
  const ttl = 24 * 60 * 60 * 1000; // 24 hours
  
  const files = await getCacheFiles(tempDir);
  let deletedCount = 0;
  
  for (const file of files) {
    if (now - file.created > ttl) {
      try {
        await fs.unlink(file.path);
        deletedCount++;
      } catch (error) {
        logger.warn(`Failed to delete old temp file: ${file.path}`, { error: error.message });
      }
    }
  }
  
  if (deletedCount > 0) {
    logger.info(`Temp files cleanup completed`, { deletedCount });
  }
  
  return deletedCount;
}

/**
 * Cache size for a single movie (frames + clips, not cover)
 */
async function getMovieCacheSize(movieId) {
  let size = 0;
  const dirs = [
    path.join(config.paths.frames, movieId),
    path.join(config.paths.clips, movieId),
  ];

  const calculateDirSize = async (dir) => {
    let dirSize = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          dirSize += stat.size;
        } else if (entry.isDirectory()) {
          dirSize += await calculateDirSize(fullPath);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to calculate movie cache size: ${dir}`, { error: error.message });
      }
    }
    return dirSize;
  };

  for (const dir of dirs) {
    size += await calculateDirSize(dir);
  }

  return size;
}

/**
 * Delete generated cache for one movie (frames, clips, temp)
 */
async function deleteMovieCache(movieId) {
  const dirs = [
    path.join(config.paths.frames, movieId),
    path.join(config.paths.clips, movieId),
    path.join(config.paths.temp, movieId),
  ];

  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      logger.debug(`Deleted cache directory: ${dir}`);
    } catch (error) {
      logger.warn(`Failed to delete cache directory: ${dir}`, { error: error.message });
    }
  }
}

/**
 * List cached frame images for a movie
 * @param {string} movieId
 * @returns {Promise<Array<{timestamp: number, size: number, createdAt: string}>>}
 */
async function listCachedFrames(movieId) {
  const dir = path.join(config.paths.frames, movieId);
  const frames = [];
  const manifest = await readKeyframesManifest(movieId);
  const keyframeSet = new Set(manifest?.timestamps || []);

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jpg')) continue;
      const timestamp = parseFloat(entry.name.replace('.jpg', ''));
      if (isNaN(timestamp)) continue;

      const fullPath = path.join(dir, entry.name);
      const stat = await fs.stat(fullPath);
      let isKeyframe = keyframeSet.has(timestamp);
      if (!isKeyframe) {
        const meta = await readFrameMeta(movieId, timestamp);
        isKeyframe = meta?.isKeyframe === true;
      }

      frames.push({
        timestamp,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        isKeyframe,
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to list cached frames: ${dir}`, { error: error.message });
    }
  }

  frames.sort((a, b) => a.timestamp - b.timestamp);
  return frames;
}

/**
 * List cached preview clips for a movie
 * @param {string} movieId
 * @returns {Promise<Array<{timestamp: number, size: number, createdAt: string}>>}
 */
async function listCachedClips(movieId) {
  const dir = path.join(config.paths.clips, movieId);
  const clips = [];
  const clipPattern = /^t([\d.]+)\.mp4$/;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(clipPattern);
      if (!match) continue;

      const timestamp = parseFloat(match[1]);
      const fullPath = path.join(dir, entry.name);
      const stat = await fs.stat(fullPath);

      clips.push({
        timestamp,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to list cached clips: ${dir}`, { error: error.message });
    }
  }

  clips.sort((a, b) => a.timestamp - b.timestamp);
  return clips;
}

/**
 * Find a cached clip whose segment covers the requested timestamp.
 * When multiple clips cover the point, prefer the one whose center is closest.
 * @param {string} movieId
 * @param {number} requestedTime - Timestamp in seconds
 * @returns {Promise<{timestamp: number, clipPath: string, meta: object}|null>}
 */
async function findCoveringClip(movieId, requestedTime) {
  const clips = await listCachedClips(movieId);
  let best = null;
  let bestDistance = Infinity;

  for (const clip of clips) {
    const meta = await readClipMeta(movieId, clip.timestamp);
    if (!meta || meta.startTime == null || meta.endTime == null) continue;

    if (requestedTime < meta.startTime - 0.001 || requestedTime > meta.endTime + 0.001) {
      continue;
    }

    const distance = Math.abs(clip.timestamp - requestedTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        timestamp: clip.timestamp,
        clipPath: getClipPath(movieId, clip.timestamp),
        meta,
      };
    }
  }

  return best;
}

/**
 * Check if a file exists
 * @param {string} filePath - File path
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file stats
 * @param {string} filePath - File path
 * @returns {Promise<object|null>}
 */
async function getFileStats(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

module.exports = {
  // Path getters
  getCoverPath,
  getFramePath,
  getFrameMetaPath,
  getKeyframesManifestPath,
  saveFrameMeta,
  readFrameMeta,
  saveKeyframesManifest,
  readKeyframesManifest,
  getClipPath,
  getClipMetaPath,
  saveClipMeta,
  readClipMeta,
  getTempPath,
  
  // Directory operations
  ensureDirectories,
  deleteMovieFiles,
  deleteMovieCache,
  getMovieCacheSize,
  getCacheSize,
  cleanupCache,
  cleanupTempFiles,
  
  // File operations
  fileExists,
  getFileStats,
  listCachedFrames,
  listCachedClips,
  findCoveringClip,
};