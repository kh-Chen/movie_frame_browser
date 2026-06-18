/**
 * Movie Controller
 * Business logic for movie operations
 */

const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const cacheService = require('../services/cacheService');
const storageService = require('../services/storageService');
const ffmpegService = require('../services/ffmpegService');
const { taskQueue, PRIORITY } = require('../services/taskQueue');
const { processMovieIngest } = require('../services/movieProcessService');
const { getAdaptiveFrameInterval } = require('../utils/frameInterval');
const { resolvePathWithinRoot } = require('../utils/pathSecurity');
const { generateMovieId } = require('../utils/idGenerator');
const { formatTime, formatFileSize } = require('../utils/timeFormatter');
const logger = require('../utils/logger');
const { staticUrl } = require('../utils/staticUrl');

function setClipMetaHeaders(res, meta) {
  if (!meta) return;
  res.set('X-Clip-Start', String(meta.startTime));
  res.set('X-Clip-End', String(meta.endTime));
}

/**
 * Get all movies
 */
async function getMovies(req, res, next) {
  try {
    const movies = await cacheService.getMovies();
    
    const result = movies.map(movie => ({
      id: movie.id,
      name: movie.name,
      originalName: movie.originalName,
      size: movie.size,
      duration: movie.duration,
      resolution: movie.resolution,
      uploadedAt: movie.uploadedAt,
      status: movie.status || 'ready',
      coverStatus: movie.coverFile ? 'ready' : 'pending',
      frameIndexStatus: movie.totalFrames > 0 ? 'ready' : 'pending',
    }));
    
    res.json({ movies: result });
  } catch (error) {
    next(error);
  }
}

/**
 * Get movie by ID
 */
async function getMovie(req, res, next) {
  try {
    const { id } = req.params;
    const movie = await cacheService.getMovie(id);
    
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }
    
    const coverUrl = movie.coverFile
      ? staticUrl('covers', `${movie.id}.jpg`)
      : null;
    
    res.json({
      id: movie.id,
      name: movie.name,
      originalName: movie.originalName,
      size: movie.size,
      duration: movie.duration,
      resolution: movie.resolution,
      codec: movie.codec,
      uploadedAt: movie.uploadedAt,
      coverUrl,
      frames: `/api/movies/${id}/frames`,
      status: movie.status,
      frameInterval: movie.frameInterval,
      keyframesExtracted: movie.keyframesExtracted === true,
      keyframesCount: movie.keyframesCount || 0,
      keyframesExtractedAt: movie.keyframesExtractedAt || null,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete movie
 */
async function deleteMovie(req, res, next) {
  try {
    const { id } = req.params;
    const movie = await cacheService.getMovie(id);
    
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }
    
    // Remove generated cache only; source video on disk is not deleted
    await storageService.deleteMovieFiles(id);
    
    // Delete movie from database
    await cacheService.deleteMovie(id);
    
    // Delete associated tasks
    await cacheService.deleteTasksByMovie(id);
    
    res.json({
      message: '电影已删除',
      id,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get movie cover
 */
async function getMovieCover(req, res, next) {
  try {
    const { id } = req.params;
    const movie = await cacheService.getMovie(id);
    
    if (!movie || !movie.coverFile) {
      return res.status(404).json({
        error: 'COVER_NOT_READY',
        message: '封面尚未生成',
        code: 404,
      });
    }
    
    const coverPath = storageService.getCoverPath(id);
    const exists = await storageService.fileExists(coverPath);
    
    if (!exists) {
      return res.status(404).json({
        error: 'COVER_NOT_READY',
        message: '封面文件不存在',
        code: 404,
      });
    }
    
    // Redirect to static file
    res.redirect(staticUrl('covers', `${id}.jpg`));
  } catch (error) {
    next(error);
  }
}

/**
 * Get frame index
 */
async function getFrameIndex(req, res, next) {
  try {
    const { id } = req.params;
    const { interval } = req.query;
    
    const movie = await cacheService.getMovie(id);
    
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }
    
    const frameInterval = parseInt(interval, 10) || movie.frameInterval || getAdaptiveFrameInterval(movie.duration);
    
    // Generate timestamps
    const timestamps = [];
    for (let t = 0; t <= movie.duration; t += frameInterval) {
      timestamps.push(Math.floor(t));
    }
    
    const frames = timestamps.map(timestamp => ({
      timestamp,
      url: `/api/movies/${id}/frames/${timestamp}`,
    }));
    
    res.json({
      movieId: id,
      interval: frameInterval,
      totalFrames: frames.length,
      frames,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get frame at timestamp
 */
async function getFrame(req, res, next) {
  try {
    const { id, timestamp } = req.params;
    const { width, quality } = req.query;
    
    const movie = await cacheService.getMovie(id);
    
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }
    
    const ts = Math.round(parseFloat(timestamp) * 1000) / 1000;

    if (isNaN(ts) || ts < 0 || ts > movie.duration) {
      return res.status(400).json({
        error: 'INVALID_TIMESTAMP',
        message: '无效的时间戳',
        code: 400,
      });
    }
    
    const frameWidth = parseInt(width) || config.frame.defaultWidth;
    const frameQuality = parseInt(quality) || config.frame.defaultQuality;
    
    // Check if frame exists in cache
    const framePath = storageService.getFramePath(id, ts);
    const exists = await storageService.fileExists(framePath);
    
    if (exists) {
      // Redirect to static file
      return res.redirect(staticUrl('frames', id, `${ts}.jpg`));
    }
    
    // Generate frame on-demand
    const outputPath = framePath;
    
    try {
      await ffmpegService.extractFrame(movie.originalPath, ts, outputPath, {
        width: frameWidth,
        quality: frameQuality,
      });
      
      res.redirect(staticUrl('frames', id, `${ts}.jpg`));
    } catch (error) {
      logger.error('Frame extraction failed', { movieId: id, timestamp: ts, error: error.message });
      
      res.status(404).json({
        error: 'FRAME_NOT_FOUND',
        message: '时间戳超出范围或帧未生成',
        code: 404,
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Find adjacent keyframe for frame stepping
 */
async function getKeyframe(req, res, next) {
  try {
    const { id } = req.params;
    const { t, dir } = req.query;

    const movie = await cacheService.getMovie(id);
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }

    if (!t || !dir) {
      return res.status(400).json({
        error: 'MISSING_PARAMS',
        message: '缺少参数 t 或 dir',
        code: 400,
      });
    }

    const timestamp = Math.round(parseFloat(t) * 1000) / 1000;
    if (isNaN(timestamp) || timestamp < 0 || timestamp > movie.duration) {
      return res.status(400).json({
        error: 'INVALID_TIMESTAMP',
        message: '无效的时间戳',
        code: 400,
      });
    }

    const direction = dir === 'next' ? 'next' : dir === 'prev' ? 'prev' : null;
    if (!direction) {
      return res.status(400).json({
        error: 'INVALID_DIRECTION',
        message: 'dir 必须为 next 或 prev',
        code: 400,
      });
    }

    const keyframeTime = await ffmpegService.findAdjacentKeyframe(
      movie.originalPath,
      timestamp,
      direction,
      movie.duration
    );

    res.json({ timestamp: keyframeTime });
  } catch (error) {
    next(error);
  }
}

/**
 * Generate or get preview clip (MP4)
 */
async function getClip(req, res, next) {
  try {
    const { id } = req.params;
    const { t } = req.query;

    const movie = await cacheService.getMovie(id);
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }

    if (!t) {
      return res.status(400).json({
        error: 'MISSING_TIMESTAMP',
        message: '缺少时间戳参数 t',
        code: 400,
      });
    }

    const timestamp = Math.round(parseFloat(t) * 1000) / 1000;
    if (isNaN(timestamp) || timestamp < 0 || timestamp > movie.duration) {
      return res.status(400).json({
        error: 'INVALID_TIMESTAMP',
        message: '无效的时间戳',
        code: 400,
      });
    }

    const clipPath = storageService.getClipPath(id, timestamp);
    const exists = await storageService.fileExists(clipPath);

    if (exists) {
      const meta = await storageService.readClipMeta(id, timestamp);
      setClipMetaHeaders(res, meta);
      res.type('mp4');
      return res.sendFile(clipPath);
    }

    const covering = await storageService.findCoveringClip(id, timestamp);
    if (covering) {
      setClipMetaHeaders(res, covering.meta);
      res.type('mp4');
      return res.sendFile(covering.clipPath);
    }

    const existingTasks = await cacheService.getTasksByMovie(id);
    const generatingTask = existingTasks.find(
      (task) => task.type === 'clip_generate' &&
        Math.abs((task.params.timestamp || 0) - timestamp) < 0.001 &&
        task.status === 'processing'
    );

    if (generatingTask) {
      return res.status(202).json({
        taskId: generatingTask.taskId,
        status: 'generating',
        progress: generatingTask.progress || 0,
        message: '片段生成中，请稍候',
      });
    }

    const taskId = taskQueue.enqueue({
      type: 'clip_generate',
      movieId: id,
      priority: PRIORITY.HIGH,
      params: {
        moviePath: movie.originalPath,
        timestamp,
        videoDuration: movie.duration,
      },
      execute: async ({ onProgress, params }) => {
        onProgress(20, '正在截取片段...');
        const segment = await ffmpegService.generatePreviewClip(
          params.moviePath,
          params.timestamp,
          clipPath,
          { videoDuration: params.videoDuration }
        );
        await storageService.saveClipMeta(id, timestamp, segment);
        onProgress(100, '片段生成完成');
      },
    });

    res.status(202).json({
      taskId,
      status: 'generating',
      progress: 0,
      message: '片段生成中，请稍候',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List cached frame images on disk for a movie
 */
async function listCachedFrames(req, res, next) {
  try {
    const { id } = req.params;

    const movie = await cacheService.getMovie(id);
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }

    const cached = await storageService.listCachedFrames(id);
    const frames = cached.map((frame) => ({
      timestamp: frame.timestamp,
      url: staticUrl('frames', id, `${frame.timestamp}.jpg`),
      apiUrl: `/api/movies/${id}/frames/${frame.timestamp}`,
      size: frame.size,
      createdAt: frame.createdAt,
      isKeyframe: frame.isKeyframe === true,
    }));

    res.json({
      movieId: id,
      total: frames.length,
      frames,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List all extracted keyframe timestamps for a movie
 */
async function listKeyframes(req, res, next) {
  try {
    const { id } = req.params;

    const movie = await cacheService.getMovie(id);
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }

    const manifest = await storageService.readKeyframesManifest(id);
    const timestamps = manifest?.timestamps || [];
    const keyframes = timestamps.map((timestamp) => ({
      timestamp,
      url: `/api/movies/${id}/frames/${timestamp}`,
    }));

    res.json({
      movieId: id,
      extracted: movie.keyframesExtracted === true,
      total: keyframes.length,
      keyframes,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Extract all keyframes for a movie (background task)
 */
async function extractAllKeyframes(req, res, next) {
  try {
    const { id } = req.params;

    const movie = await cacheService.getMovie(id);
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }

    if (movie.keyframesExtracted) {
      return res.status(409).json({
        error: 'ALREADY_EXTRACTED',
        message: '该视频的关键帧已全部采集完成',
        keyframesCount: movie.keyframesCount || 0,
        keyframesExtractedAt: movie.keyframesExtractedAt,
        code: 409,
      });
    }

    const existingTasks = await cacheService.getTasksByMovie(id);
    const runningTask = existingTasks.find(
      (task) => task.type === 'keyframe_extract' &&
        (task.status === 'pending' || task.status === 'processing')
    );

    if (runningTask) {
      return res.status(202).json({
        taskId: runningTask.taskId,
        status: runningTask.status,
        message: '关键帧采集中，请稍候',
      });
    }

    const taskId = taskQueue.enqueue({
      type: 'keyframe_extract',
      movieId: id,
      priority: PRIORITY.NORMAL,
      params: {
        moviePath: movie.originalPath,
        duration: movie.duration,
      },
      execute: async ({ onProgress, params, movieId: taskMovieId }) => {
        const frameDir = path.join(config.paths.frames, taskMovieId);
        const tempDir = path.join(config.paths.temp, `keyframe-${taskMovieId}`);

        const { timestamps, total } = await ffmpegService.extractAllKeyframesBatch(
          params.moviePath,
          frameDir,
          {
            duration: params.duration,
            tempDir,
          },
          async (pct, msg) => onProgress(pct, msg)
        );

        for (const ts of timestamps) {
          await storageService.saveFrameMeta(taskMovieId, ts, { isKeyframe: true });
        }

        await storageService.saveKeyframesManifest(taskMovieId, {
          timestamps,
          extractedAt: new Date().toISOString(),
        });

        await cacheService.updateMovie(taskMovieId, {
          keyframesExtracted: true,
          keyframesCount: total,
          keyframesExtractedAt: new Date().toISOString(),
        });

        await onProgress(100, `关键帧采集完成 (${total} 帧)`);
      },
    });

    res.status(202).json({
      taskId,
      status: 'queued',
      message: '关键帧采集任务已加入队列',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List cached preview clips on disk for a movie
 */
async function listCachedClips(req, res, next) {
  try {
    const { id } = req.params;

    const movie = await cacheService.getMovie(id);
    if (!movie) {
      return res.status(404).json({
        error: 'MOVIE_NOT_FOUND',
        message: '电影不存在或已被删除',
        code: 404,
      });
    }

    const cached = await storageService.listCachedClips(id);
    const clips = (await Promise.all(cached.map(async (clip) => {
      const meta = await storageService.readClipMeta(id, clip.timestamp);
      if (!meta) return null;

      return {
        timestamp: clip.timestamp,
        startTime: meta.startTime,
        endTime: meta.endTime,
        duration: meta.duration,
        url: `/api/movies/${id}/clip?t=${clip.timestamp}`,
        staticUrl: staticUrl('clips', id, `t${clip.timestamp}.mp4`),
        size: clip.size,
        createdAt: clip.createdAt,
      };
    }))).filter(Boolean);

    res.json({
      movieId: id,
      total: clips.length,
      clips,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get cache status
 */
async function getCacheStatus(req, res, next) {
  try {
    const cacheSize = await storageService.getCacheSize();
    const movies = await cacheService.getMovies();

    const movieCaches = await Promise.all(
      movies.map(async (movie) => ({
        id: movie.id,
        name: movie.name,
        cacheSize: await storageService.getMovieCacheSize(movie.id),
      }))
    );

    res.json({
      total: cacheSize.total,
      totalFormatted: formatFileSize(cacheSize.total),
      frameCacheSize: cacheSize.frames,
      clipCacheSize: cacheSize.clips,
      maxSize: config.cache.maxSize,
      usagePercent: ((cacheSize.total / config.cache.maxSize) * 100).toFixed(2),
      breakdown: {
        covers: cacheSize.covers,
        frames: cacheSize.frames,
        clips: cacheSize.clips,
        temp: cacheSize.temp,
      },
      movies: movieCaches,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Clear frame/clip cache (all or one movie)
 */
async function clearCache(req, res, next) {
  try {
    const { movieId } = req.query;

    if (movieId) {
      const movie = await cacheService.getMovie(movieId);
      if (!movie) {
        return res.status(404).json({
          error: 'MOVIE_NOT_FOUND',
          message: '电影不存在或已被删除',
          code: 404,
        });
      }
      await storageService.deleteMovieCache(movieId);
      return res.json({
        message: '电影缓存已清理',
        movieId,
      });
    }

    const movies = await cacheService.getMovies();
    for (const movie of movies) {
      await storageService.deleteMovieCache(movie.id);
    }
    await storageService.cleanupTempFiles();

    res.json({
      message: '所有电影缓存已清理',
      count: movies.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Browse local movies directory (one level at a time)
 */
async function browseLocalDirectory(req, res, next) {
  try {
    const rootDir = path.resolve(config.localMovies.directory);
    const requestedPath = req.query.path;

    try {
      await fs.access(rootDir);
    } catch {
      return res.status(404).json({
        error: 'DIRECTORY_NOT_FOUND',
        message: `配置的目录不存在: ${rootDir}`,
        code: 404,
      });
    }

    let currentDir = rootDir;
    if (requestedPath) {
      const resolved = resolvePathWithinRoot(requestedPath, rootDir);
      if (!resolved) {
        return res.status(400).json({
          error: 'INVALID_PATH',
          message: '路径必须在配置的本地电影目录内',
          code: 400,
        });
      }

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        return res.status(404).json({
          error: 'DIRECTORY_NOT_FOUND',
          message: '目录不存在',
          code: 404,
        });
      }

      if (!stat.isDirectory()) {
        return res.status(400).json({
          error: 'NOT_A_DIRECTORY',
          message: '目标路径不是目录',
          code: 400,
        });
      }

      currentDir = resolved;
    }

    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    const supportedExtensions = config.api.supportedVideoFormats;
    const entries = [];

    for (const dirent of dirents) {
      const fullPath = path.join(currentDir, dirent.name);

      if (dirent.isDirectory()) {
        entries.push({
          name: dirent.name,
          path: fullPath,
          type: 'directory',
        });
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      const ext = path.extname(dirent.name).toLowerCase().slice(1);
      if (!supportedExtensions.includes(ext)) {
        continue;
      }

      const stats = await fs.stat(fullPath);
      entries.push({
        name: dirent.name,
        path: fullPath,
        type: 'file',
        extension: ext,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        modifiedAt: stats.mtime.toISOString(),
      });
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const parent = currentDir === rootDir ? null : path.dirname(currentDir);

    res.json({
      root: rootDir,
      path: currentDir,
      name: path.basename(currentDir),
      parent,
      entries,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List local movie files
 * Scans configured directory for video files
 */
async function listLocalMovies(req, res, next) {
  try {
    const moviesDir = config.localMovies.directory;
    
    // Check if directory exists
    try {
      await fs.access(moviesDir);
    } catch {
      return res.status(404).json({
        error: 'DIRECTORY_NOT_FOUND',
        message: `配置的目录不存在: ${moviesDir}`,
        code: 404,
      });
    }
    
    // Scan directory for video files
    const files = await fs.readdir(moviesDir, { withFileTypes: true });
    
    const movies = [];
    const supportedExtensions = config.api.supportedVideoFormats;
    
    for (const file of files) {
      if (file.isFile()) {
        const ext = path.extname(file.name).toLowerCase().slice(1);
        if (supportedExtensions.includes(ext)) {
          const filePath = path.join(moviesDir, file.name);
          const stats = await fs.stat(filePath);
          
          movies.push({
            name: path.basename(file.name, path.extname(file.name)),
            originalName: file.name,
            path: filePath,
            size: stats.size,
            sizeFormatted: formatFileSize(stats.size),
            extension: ext,
            modifiedAt: stats.mtime.toISOString(),
          });
        }
      }
    }
    
    // Sort by modified time (newest first)
    movies.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    
    res.json({
      directory: moviesDir,
      count: movies.length,
      movies,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Select/add a local movie file
 * Adds an existing file to the movie list without copying
 */
async function selectLocalMovie(req, res, next) {
  try {
    const { path: filePath, name } = req.body;

    if (!filePath) {
      return res.status(400).json({
        error: 'MISSING_PATH',
        message: '请提供文件路径',
        code: 400,
      });
    }

    const resolvedPath = resolvePathWithinRoot(filePath, config.localMovies.directory);
    if (!resolvedPath) {
      return res.status(400).json({
        error: 'INVALID_PATH',
        message: '文件路径必须在配置的本地电影目录内',
        code: 400,
      });
    }

    try {
      await fs.access(resolvedPath);
    } catch {
      return res.status(404).json({
        error: 'FILE_NOT_FOUND',
        message: '文件不存在',
        code: 404,
      });
    }

    const ext = path.extname(resolvedPath).toLowerCase().slice(1);
    if (!config.api.supportedVideoFormats.includes(ext)) {
      return res.status(400).json({
        error: 'UNSUPPORTED_FORMAT',
        message: `不支持的格式，支持：${config.api.supportedVideoFormats.join('、')}`,
        code: 400,
      });
    }
    
    // Check if already added
    const existingMovies = await cacheService.getMovies();
    const exists = existingMovies.some(m => m.originalPath === resolvedPath);

    if (exists) {
      return res.status(409).json({
        error: 'ALREADY_EXISTS',
        message: '该文件已被添加',
        code: 409,
      });
    }

    let videoInfo;
    try {
      videoInfo = await ffmpegService.getVideoInfo(resolvedPath);
    } catch (error) {
      return res.status(400).json({
        error: 'INVALID_VIDEO',
        message: '无法读取视频信息，文件可能损坏',
        code: 400,
      });
    }

    const stats = await fs.stat(resolvedPath);
    const movieId = generateMovieId();

    const movie = {
      id: movieId,
      name: name || path.basename(resolvedPath, path.extname(resolvedPath)),
      originalName: path.basename(resolvedPath),
      originalPath: resolvedPath,
      size: stats.size,
      duration: videoInfo.duration,
      resolution: `${videoInfo.width}x${videoInfo.height}`,
      codec: videoInfo.codec,
      bitrate: videoInfo.bitrate,
      uploadedAt: new Date().toISOString(),
      status: 'processing',
      coverFile: null,
      frameInterval: getAdaptiveFrameInterval(videoInfo.duration),
      totalFrames: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await cacheService.saveMovie(movie);

    const taskId = taskQueue.enqueue({
      type: 'movie_process',
      movieId,
      priority: PRIORITY.NORMAL,
      params: { moviePath: resolvedPath, movieId },
      execute: async ({ onProgress, params }) => {
        await processMovieIngest({
          movieId,
          moviePath: params.moviePath,
          videoInfo,
          onProgress,
        });
      },
    });

    res.status(202).json({
      taskId,
      status: 'processing',
      message: '电影已添加，正在提取封面和帧索引',
      movieId,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMovies,
  getMovie,
  deleteMovie,
  getMovieCover,
  getFrameIndex,
  getFrame,
  getKeyframe,
  listKeyframes,
  extractAllKeyframes,
  getClip,
  listCachedFrames,
  listCachedClips,
  getCacheStatus,
  clearCache,
  browseLocalDirectory,
  listLocalMovies,
  selectLocalMovie,
};