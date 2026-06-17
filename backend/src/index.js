/**
 * Application Entry Point
 * Start the Express server
 */

const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const storageService = require('./services/storageService');
const cacheService = require('./services/cacheService');

/**
 * Initialize the application
 */
async function initialize() {
  try {
    // Ensure storage directories exist
    await storageService.ensureDirectories();
    logger.info('Storage directories initialized');
    
    // Clean up old temp files
    const deletedTempFiles = await storageService.cleanupTempFiles();
    if (deletedTempFiles > 0) {
      logger.info(`Cleaned up ${deletedTempFiles} old temp files`);
    }
    
    // Clean up old tasks (older than 7 days)
    await cacheService.cleanupOldTasks(7);
    
    // Check cache size and cleanup if needed
    const cacheSize = await storageService.getCacheSize();
    const maxCacheSize = config.cache.maxSize;
    const threshold = config.cache.cleanupThreshold * maxCacheSize;
    
    if (cacheSize.total > threshold) {
      logger.info('Cache size above threshold, initiating cleanup', {
        currentSize: cacheSize.total,
        maxSize: maxCacheSize,
        threshold,
      });
      
      const targetSize = config.cache.cleanupTarget * maxCacheSize;
      const cleanupResult = await storageService.cleanupCache(targetSize);
      
      logger.info('Cache cleanup completed', cleanupResult);
    }
    
    logger.info('Initialization complete', {
      cacheSize: cacheSize.total,
      cacheSizeFormatted: formatBytes(cacheSize.total),
    });
  } catch (error) {
    logger.error('Initialization failed', { error: error.message });
    // Continue anyway, the app can still start
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Start the server
 */
async function startServer() {
  // Initialize
  await initialize();
  
  // Create app
  const app = createApp();
  
  // Start listening
  const server = app.listen(config.port, () => {
    logger.info(`Server started`, {
      port: config.port,
      nodeEnv: config.nodeEnv,
      maxConcurrentFFmpeg: config.taskQueue.maxConcurrent,
    });
    
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           Movie Frame Browser - Backend Server            ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${config.port}                    ║
║  Environment: ${config.nodeEnv.padEnd(48)}║
║  Max concurrent FFmpeg: ${config.taskQueue.maxConcurrent.toString().padEnd(38)}║
║  Max cache size: ${formatBytes(config.cache.maxSize).padEnd(46)}║
╚════════════════════════════════════════════════════════════╝
    `);
  });
  
  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
  
  return server;
}

// Start if run directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  });
}

module.exports = { startServer, initialize };