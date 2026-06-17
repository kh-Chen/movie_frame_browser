/**
 * Error Handler Middleware
 * Unified error handling for the application
 */

const logger = require('../utils/logger');

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
  // Log error
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  
  // Handle API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      code: err.statusCode,
    });
  }
  
  // Handle JSON parse errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'INVALID_JSON',
      message: '无效的 JSON 格式',
      code: 400,
    });
  }
  
  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: err.message,
      code: 400,
    });
  }
  
  // Default server error
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' 
      ? '服务器内部错误' 
      : err.message,
    code: 500,
  });
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `路由 ${req.method} ${req.path} 不存在`,
    code: 404,
  });
}

/**
 * Async handler wrapper to catch errors
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  ApiError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
};