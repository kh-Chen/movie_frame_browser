/**
 * Tasks Router
 * Task-related API routes
 */

const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');

router.get('/queue/status', taskController.getQueueStatus);
router.get('/:taskId', taskController.getTaskStatus);
router.delete('/:taskId', taskController.cancelTask);

module.exports = router;
