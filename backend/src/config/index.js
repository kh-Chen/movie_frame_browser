/**
 * Configuration Module
 * Centralized configuration management for the application
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Load environment variables
require('dotenv').config();

// Base paths
const ROOT_PATH = path.resolve(__dirname, '../../');
const STATIC_PATH = process.env.STORAGE_PATH || path.join(ROOT_PATH, 'static');
const DATA_PATH = process.env.DATA_PATH || path.join(ROOT_PATH, 'data');
const TEMP_PATH = process.env.TEMP_PATH || path.join(STATIC_PATH, 'temp');

// Ensure directories exist
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
};

// Create required directories
ensureDir(STATIC_PATH);
ensureDir(path.join(STATIC_PATH, 'covers'));
ensureDir(path.join(STATIC_PATH, 'frames'));
ensureDir(path.join(STATIC_PATH, 'clips'));
ensureDir(TEMP_PATH);
ensureDir(path.join(TEMP_PATH, 'hls'));
ensureDir(path.join(DATA_PATH, 'keyframe-cache'));
ensureDir(DATA_PATH);

// Calculate max concurrent ffmpeg processes based on CPU cores
const getMaxConcurrent = () => {
  if (process.env.MAX_CONCURRENT_FFMPEG === 'auto') {
    return Math.max(1, Math.floor(os.cpus().length / 2));
  }
  return parseInt(process.env.MAX_CONCURRENT_FFMPEG) || Math.max(1, Math.floor(os.cpus().length / 2));
};

// Public URL prefix when app is served under a subpath (e.g. /movie). Empty = site root.
const publicPath = (process.env.PUBLIC_PATH ?? '/movie').replace(/\/$/, '');

// Configuration object
const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',

  // HTTP path prefix for redirects and static URLs (empty string = deploy at root)
  publicPath,

  // Paths
  paths: {
    root: ROOT_PATH,
    static: STATIC_PATH,
    data: DATA_PATH,
    temp: TEMP_PATH,
    covers: path.join(STATIC_PATH, 'covers'),
    frames: path.join(STATIC_PATH, 'frames'),
    clips: path.join(STATIC_PATH, 'clips'),
    hls: path.join(TEMP_PATH, 'hls'),
    keyframeCache: path.join(DATA_PATH, 'keyframe-cache'),
    movies: path.join(DATA_PATH, 'movies.json'),
    tasks: path.join(DATA_PATH, 'tasks.json'),
  },

  // FFmpeg settings
  ffmpeg: {
    threads: parseInt(process.env.FFMPEG_THREADS) || 1,
    timeout: parseInt(process.env.FFMPEG_TIMEOUT) || 300000, // 5 minutes
    priority: process.env.FFMPEG_PRIORITY || 'low',
  },

  // Cache settings
  cache: {
    maxSize: parseInt(process.env.MAX_CACHE_SIZE) || 10737418240, // 10GB
    cleanupThreshold: parseFloat(process.env.CACHE_CLEANUP_THRESHOLD) || 0.9,
    cleanupTarget: parseFloat(process.env.CACHE_CLEANUP_TARGET) || 0.7,
  },

  // Frame settings
  frame: {
    defaultInterval: parseInt(process.env.DEFAULT_FRAME_INTERVAL) || 60,
    defaultWidth: parseInt(process.env.DEFAULT_FRAME_WIDTH) || 1280,
    defaultQuality: parseInt(process.env.DEFAULT_FRAME_QUALITY) || 75,
  },

  // HLS dynamic packaging settings (on-demand segment generation, no cache)
  hls: {
    segmentDuration: parseFloat(process.env.HLS_SEGMENT_DURATION) || 6,
    segmentTimeoutSec: Math.max(10, parseInt(process.env.HLS_SEGMENT_TIMEOUT_SEC, 10) || 30),
  },

  // Task queue settings
  taskQueue: {
    maxConcurrent: getMaxConcurrent(),
    cpuLoadThreshold: parseFloat(process.env.CPU_LOAD_THRESHOLD) || 0.8,
  },

  // API settings
  api: {
    supportedVideoFormats: ['mp4', 'mkv', 'avi', 'mov', 'wmv'],
  },

  // Local movies directory (for selecting existing files)
  localMovies: {
    directory: process.env.LOCAL_MOVIES_DIR || path.join(ROOT_PATH, '../movies'),
    scanOnStart: process.env.LOCAL_MOVIES_SCAN_ON_START !== 'false',
  },
};

module.exports = config;