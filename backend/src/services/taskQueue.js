/**
 * Task Queue Service
 * CPU-limited task queue with semaphore control
 */

const os = require('os');
const config = require('../config');
const logger = require('../utils/logger');
const { generateTaskId } = require('../utils/idGenerator');
const { cpuLoadMonitor } = require('../utils/cpuLoadMonitor');
const cacheService = require('./cacheService');

// Semaphore for controlling concurrent ffmpeg processes
class Semaphore {
  constructor(maxCount) {
    this.maxCount = maxCount;
    this.count = 0;
    this.waiting = [];
  }

  async acquire() {
    if (this.count < this.maxCount) {
      this.count++;
      return;
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release() {
    this.count--;
    if (this.waiting.length > 0 && this.count < this.maxCount) {
      this.count++;
      const resolve = this.waiting.shift();
      resolve();
    }
  }

  get status() {
    return {
      current: this.count,
      max: this.maxCount,
      waiting: this.waiting.length,
    };
  }
}

// Priority levels
const PRIORITY = {
  HIGH: 1,      // Clip generation (user-triggered)
  NORMAL: 2,    // Frame extraction (background)
  LOW: 3,       // Cover extraction (one-time)
};

// Task status
const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Main task queue class
class TaskQueue {
  constructor() {
    this.semaphore = new Semaphore(config.taskQueue.maxConcurrent);
    this.queue = [];
    this.processing = new Map(); // taskId -> task info
    this.isProcessing = false;

    cpuLoadMonitor.start();

    // Start queue processor
    this.startProcessor();
    
    logger.info('Task queue initialized', {
      maxConcurrent: config.taskQueue.maxConcurrent,
      cpuCores: os.cpus().length,
    });
  }

  /**
   * Get current normalized CPU load (0-1).
   */
  getCpuLoad() {
    return cpuLoadMonitor.getLoad();
  }

  /**
   * Check if we should accept new tasks based on CPU load
   */
  shouldAcceptTasks() {
    return cpuLoadMonitor.shouldAccept(config.taskQueue.cpuLoadThreshold);
  }

  /**
   * Add a task to the queue
   * @param {object} taskConfig - Task configuration
   * @param {string} taskConfig.type - Task type (movie_process, clip_generate, frame_extract)
   * @param {string} taskConfig.movieId - Associated movie ID
   * @param {object} taskConfig.params - Task-specific parameters
   * @param {number} taskConfig.priority - Task priority (1=high, 2=normal, 3=low)
   * @param {Function} taskConfig.execute - Async function to execute
   * @returns {string} Task ID
   */
  enqueue(taskConfig) {
    const taskId = generateTaskId();
    
    const task = {
      taskId,
      type: taskConfig.type,
      movieId: taskConfig.movieId,
      priority: taskConfig.priority || PRIORITY.NORMAL,
      status: TASK_STATUS.PENDING,
      progress: 0,
      message: 'Task queued',
      params: taskConfig.params || {},
      execute: taskConfig.execute,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Add to queue in priority order
    const insertIndex = this.queue.findIndex(t => t.priority > task.priority);
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
    
    // Save task to persistent storage
    cacheService.saveTask({
      taskId: task.taskId,
      type: task.type,
      movieId: task.movieId,
      status: task.status,
      progress: task.progress,
      message: task.message,
      params: task.params,
      createdAt: task.createdAt,
    }).catch(err => {
      logger.error('Failed to save task to storage', { taskId, error: err.message });
    });
    
    logger.info('Task enqueued', { 
      taskId, 
      type: task.type, 
      priority: task.priority,
      queueLength: this.queue.length,
    });
    
    // Trigger queue processing
    this.processQueue();
    
    return taskId;
  }

  /**
   * Process the queue
   */
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    while (this.queue.length > 0) {
      // Check CPU load before processing new task
      if (!this.shouldAcceptTasks()) {
        logger.info('CPU load too high, waiting...', { 
          queueLength: this.queue.length,
        });
        await this.delay(5000); // Wait 5 seconds
        continue;
      }
      
      // Check semaphore
      if (this.semaphore.count >= this.semaphore.maxCount) {
        await this.delay(1000); // Wait for semaphore
        continue;
      }
      
      const task = this.queue.shift();
      if (!task) break;
      
      // Execute task with semaphore
      this.executeTask(task);
    }
    
    this.isProcessing = false;
  }

  /**
   * Execute a single task
   */
  async executeTask(task) {
    await this.semaphore.acquire();
    
    this.processing.set(task.taskId, task);
    
    try {
      // Update task status to processing
      task.status = TASK_STATUS.PROCESSING;
      task.startedAt = new Date().toISOString();
      await this.updateTaskStatus(task.taskId, {
        status: TASK_STATUS.PROCESSING,
        message: 'Processing started',
      });
      
      logger.info('Task started', { taskId: task.taskId, type: task.type });
      
      // Execute the task function
      await task.execute({
        onProgress: async (progress, message) => {
          task.progress = progress;
          task.message = message;
          await this.updateTaskStatus(task.taskId, { progress, message });
        },
        movieId: task.movieId,
        params: task.params,
      });
      
      // Task completed successfully
      task.status = TASK_STATUS.COMPLETED;
      task.completedAt = new Date().toISOString();
      await this.updateTaskStatus(task.taskId, {
        status: TASK_STATUS.COMPLETED,
        progress: 100,
        message: 'Task completed',
      });
      
      logger.info('Task completed', { taskId: task.taskId, type: task.type });
      
    } catch (error) {
      // Task failed
      task.status = TASK_STATUS.FAILED;
      task.error = error.message;
      task.completedAt = new Date().toISOString();
      
      await this.updateTaskStatus(task.taskId, {
        status: TASK_STATUS.FAILED,
        message: `Failed: ${error.message}`,
        error: error.message,
      });
      
      logger.error('Task failed', { taskId: task.taskId, error: error.message });
    } finally {
      this.processing.delete(task.taskId);
      this.semaphore.release();
      
      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Update task status in storage
   */
  async updateTaskStatus(taskId, updates) {
    try {
      await cacheService.updateTask(taskId, updates);
    } catch (error) {
      logger.error('Failed to update task status', { taskId, error: error.message });
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    const queueByPriority = {
      [PRIORITY.HIGH]: [],
      [PRIORITY.NORMAL]: [],
      [PRIORITY.LOW]: [],
    };
    
    for (const task of this.queue) {
      queueByPriority[task.priority].push({
        taskId: task.taskId,
        type: task.type,
        status: task.status,
      });
    }
    
    const processingTasks = [];
    for (const [taskId, task] of this.processing) {
      processingTasks.push({
        taskId,
        type: task.type,
        status: task.status,
        progress: task.progress,
        startedAt: task.startedAt,
      });
    }
    
    return {
      queue: {
        pending: this.queue.length,
        byPriority: queueByPriority,
      },
      processing: processingTasks,
      completed: 0, // Would need to track this
    };
  }

  /**
   * Get worker status
   */
  getWorkerStatus() {
    const cpuStatus = cpuLoadMonitor.getStatus();

    return {
      concurrent: this.semaphore.count,
      maxConcurrent: this.semaphore.maxCount,
      cpuUsage: cpuStatus.load,
      cpuLoadMethod: cpuStatus.method,
      cpuLoadHistory: cpuStatus.history,
      systemLoadavg: cpuStatus.systemLoadavg,
      cpuCores: cpuStatus.cpuCores,
    };
  }

  /**
   * Get task from queue or processing
   */
  getTask(taskId) {
    // Check processing tasks
    const processingTask = this.processing.get(taskId);
    if (processingTask) return processingTask;
    
    // Check queue
    return this.queue.find(t => t.taskId === taskId);
  }

  /**
   * Cancel a pending task
   */
  cancelTask(taskId) {
    const index = this.queue.findIndex(t => t.taskId === taskId);
    if (index !== -1) {
      const task = this.queue.splice(index, 1)[0];
      task.status = TASK_STATUS.FAILED;
      task.error = 'Task cancelled';
      
      this.updateTaskStatus(taskId, {
        status: TASK_STATUS.FAILED,
        message: 'Task cancelled',
      });
      
      logger.info('Task cancelled', { taskId });
      return true;
    }
    return false;
  }

  /**
   * Start the queue processor with periodic checks
   */
  startProcessor() {
    // Check queue every second
    setInterval(() => {
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }, 1000);
    
    // Log CPU status every 5 seconds (sampling handled by cpuLoadMonitor)
    setInterval(() => {
      logger.debug('CPU status check', this.getWorkerStatus());
    }, 5000);
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create singleton instance
const taskQueue = new TaskQueue();

module.exports = {
  taskQueue,
  PRIORITY,
  TASK_STATUS,
};