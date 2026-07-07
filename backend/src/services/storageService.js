/**
 * Storage Service
 * File path management and cache operations
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const {
  DEFAULT_FPS,
  formatFrameFilename,
  formatKeyframeFilename,
  frameIndexToTimestamp,
  parseFrameFilename,
} = require('../utils/frameTimestamp');

/**
 * Get cover image path for a movie
 * @param {string} movieId - Movie ID
 * @returns {string} Cover image path
 */
function getCoverPath(movieId) {
  return path.join(config.paths.covers, `${movieId}.jpg`);
}

/**
 * Get frame image path for a movie by frame index
 * @param {string} movieId - Movie ID
 * @param {number} frameIndex - Zero-based frame index
 * @returns {string} Frame image path
 */
function getFramePath(movieId, frameIndex) {
  const movieFrameDir = path.join(config.paths.frames, movieId);
  return path.join(movieFrameDir, formatFrameFilename(frameIndex));
}

function getKeyframeFramePath(movieId, frameIndex) {
  const movieFrameDir = path.join(config.paths.frames, movieId);
  return path.join(movieFrameDir, formatKeyframeFilename(frameIndex));
}

/**
 * Resolve cached frame file (.jpg or .key.jpg) for a frame index.
 * @returns {Promise<{ path: string, filename: string, isKeyframe: boolean }|null>}
 */
async function resolveFrameFile(movieId, frameIndex) {
  const candidates = [
    { path: getKeyframeFramePath(movieId, frameIndex), isKeyframe: true },
    { path: getFramePath(movieId, frameIndex), isKeyframe: false },
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate.path)) {
      return {
        path: candidate.path,
        filename: path.basename(candidate.path),
        isKeyframe: candidate.isKeyframe,
      };
    }
  }

  return null;
}

function getKeyframesManifestPath(movieId) {
  return path.join(config.paths.frames, movieId, 'keyframes.json');
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
    config.paths.temp,
    config.paths.hls,
    config.paths.keyframeCache,
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
  result.temp = await calculateDirSize(config.paths.temp);
  result.total = result.covers + result.frames + result.temp;
  
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
async function listCachedFrames(movieId, fps) {
  const dir = path.join(config.paths.frames, movieId);
  const frameMap = new Map();

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jpg')) continue;
      const parsed = parseFrameFilename(entry.name);
      if (!parsed) continue;

      const { frameIndex, isKeyframe } = parsed;
      const existing = frameMap.get(frameIndex);
      if (existing && !isKeyframe && existing.isKeyframe) continue;

      const fullPath = path.join(dir, entry.name);
      const stat = await fs.stat(fullPath);
      frameMap.set(frameIndex, {
        frameIndex,
        timestamp: frameIndexToTimestamp(frameIndex, fps),
        filename: entry.name,
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

  const frames = Array.from(frameMap.values());
  frames.sort((a, b) => a.frameIndex - b.frameIndex);
  return frames;
}

/**
 * Delete a single non-keyframe frame image (.jpg, not .key.jpg).
 * @returns {Promise<{ deleted: boolean, reason?: string, frameIndex?: number, timestamp?: number, keyframeRetained?: boolean }>}
 */
async function deleteNonKeyframeFrame(movieId, frameIndex, fps = DEFAULT_FPS) {
  const plainPath = getFramePath(movieId, frameIndex);
  const keyPath = getKeyframeFramePath(movieId, frameIndex);

  if (!(await fileExists(plainPath))) {
    return { deleted: false, reason: 'NOT_FOUND' };
  }

  await fs.unlink(plainPath);
  const keyframeRetained = await fileExists(keyPath);

  return {
    deleted: true,
    frameIndex,
    timestamp: frameIndexToTimestamp(frameIndex, fps),
    keyframeRetained,
  };
}

/**
 * Delete all non-keyframe frame images for a movie.
 * @returns {Promise<{ deleted: number, freed: number }>}
 */
async function deleteAllNonKeyframeFrames(movieId) {
  const dir = path.join(config.paths.frames, movieId);
  let deleted = 0;
  let freed = 0;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = parseFrameFilename(entry.name);
      if (!parsed || parsed.isKeyframe) continue;

      const fullPath = path.join(dir, entry.name);
      const stat = await fs.stat(fullPath);
      await fs.unlink(fullPath);
      deleted += 1;
      freed += stat.size;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return { deleted, freed };
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
  getKeyframeFramePath,
  resolveFrameFile,
  getKeyframesManifestPath,
  saveKeyframesManifest,
  readKeyframesManifest,
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
  deleteNonKeyframeFrame,
  deleteAllNonKeyframeFrames,
};