/**
 * Express Application
 * Main application configuration and middleware setup
 */

const express = require('express');
const path = require('path');
const compression = require('compression');

const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const { corsMiddleware } = require('./middlewares/cors');
const { getStaticMountPaths } = require('./utils/staticUrl');

/**
 * Create and configure Express application
 */
function createApp() {
  const app = express();
  
  // Trust proxy for correct IP detection behind reverse proxy
  app.set('trust proxy', true);
  
  // ============================================
  // Middleware
  // ============================================
  
  // Request logging
  app.use(logger.requestLogger);
  
  // CORS
  app.use(corsMiddleware);
  
  // Compression for responses (skip binary streaming endpoints)
  app.use(compression({
    filter: (req, res) => {
      const url = req.originalUrl || req.url || '';
      if (/\/hls\/segment(?:\?|$)/.test(url)) {
        return false;
      }
      return compression.filter(req, res);
    },
  }));
  
  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));
  
  // Parse URL-encoded bodies
  app.use(express.urlencoded({ extended: true }));
  
  // ============================================
  // Static files
  // ============================================
  
  const staticFileOptions = {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
        res.setHeader('Content-Type', 'image/jpeg');
      } else if (filePath.endsWith('.png')) {
        res.setHeader('Content-Type', 'image/png');
      } else if (filePath.endsWith('.mp4')) {
        res.setHeader('Content-Type', 'video/mp4');
      }

      if (filePath.includes(`${path.sep}frames${path.sep}`) || filePath.includes('/frames/')) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      } else if (filePath.includes(`${path.sep}clips${path.sep}`) || filePath.includes('/clips/')) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
      } else if (filePath.includes(`${path.sep}covers${path.sep}`) || filePath.includes('/covers/')) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
      }
    },
  };

  for (const mountPath of getStaticMountPaths()) {
    app.use(mountPath, express.static(config.paths.static, staticFileOptions));
  }
  
  // ============================================
  // API Routes
  // ============================================
  
  app.use('/api', routes);
  
  // ============================================
  // Error handling
  // ============================================
  
  // 404 handler
  app.use(notFoundHandler);
  
  // Error handler
  app.use(errorHandler);
  
  return app;
}

module.exports = { createApp };