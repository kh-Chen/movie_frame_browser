/**
 * Task Controller
 * Business logic for task operations
 */

const cacheService = require('../services/cacheService');
const { taskQueue } = require('../services/taskQueue');

/**
 * Get task status
 */
async function getTaskStatus(req, res, next) {
  try {
    const { taskId } = req.params;

    const queueTask = taskQueue.getTask(taskId);
    if (queueTask) {
      const task = {
        taskId: queueTask.taskId,
        type: queueTask.type,
        status: queueTask.status,
        progress: queueTask.progress,
        message: queueTask.message,
        movieId: queueTask.movieId,
        error: queueTask.error,
      };
      return res.json({ task });
    }

    const task = await cacheService.getTask(taskId);

    if (!task) {
      return res.status(404).json({
        error: 'TASK_NOT_FOUND',
        message: '任务不存在',
        code: 404,
      });
    }

    res.json({
      task: {
        taskId: task.taskId,
        type: task.type,
        status: task.status,
        progress: task.progress,
        message: task.message,
        movieId: task.movieId,
        error: task.error,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get queue status
 */
async function getQueueStatus(req, res, next) {
  try {
    const status = taskQueue.getStatus();
    const workerStatus = taskQueue.getWorkerStatus();
    
    res.json({
      queue: status,
      worker: workerStatus,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel a task
 */
async function cancelTask(req, res, next) {
  try {
    const { taskId } = req.params;
    
    const cancelled = taskQueue.cancelTask(taskId);
    
    if (!cancelled) {
      return res.status(404).json({
        error: 'TASK_NOT_FOUND',
        message: '任务不存在或无法取消',
        code: 404,
      });
    }
    
    res.json({
      taskId,
      message: '任务已取消',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTaskStatus,
  getQueueStatus,
  cancelTask,
};