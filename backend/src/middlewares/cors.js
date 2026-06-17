/**
 * CORS Middleware
 * Cross-Origin Resource Sharing configuration
 */

const cors = require('cors');

/**
 * CORS configuration
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow all origins in development
    // In production, you might want to restrict this
    if (process.env.NODE_ENV === 'development' || !origin) {
      callback(null, true);
    } else {
      // Check if origin is in allowed list
      const allowedOrigins = process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',')
        : [];
      
      if (allowedOrigins.includes(origin) || allowedOrigins.length === 0) {
        callback(null, true);
      } else {
        callback(new Error('CORS: Origin not allowed'));
      }
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

/**
 * CORS middleware
 */
const corsMiddleware = cors(corsOptions);

/**
 * Simple CORS middleware for API
 */
const simpleCorsMiddleware = cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

module.exports = {
  corsMiddleware,
  simpleCorsMiddleware,
};