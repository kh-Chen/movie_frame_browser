/**
 * Logger Utility
 * Winston-based logging with structured output
 */

const winston = require('winston');
const path = require('path');
const config = require('../config');

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ' ' + JSON.stringify(meta);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Custom format for file output (JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'movie-frame-browser' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Error log file
    new winston.transports.File({
      filename: path.join(config.paths.data, 'logs', 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(config.paths.data, 'logs', 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

// Create request logger middleware
logger.requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl}`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });
  
  next();
};

module.exports = logger;