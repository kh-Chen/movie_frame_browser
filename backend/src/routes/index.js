/**
 * Routes Index
 * Aggregate all routes
 */

const express = require('express');
const router = express.Router();

const moviesRouter = require('./movies');
const tasksRouter = require('./tasks');

// Mount routers
router.use('/movies', moviesRouter);
router.use('/tasks', tasksRouter);

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;