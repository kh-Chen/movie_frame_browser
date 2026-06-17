/**
 * Cache Service
 * JSON file CRUD operations for movies and tasks
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

let moviesMutationChain = Promise.resolve();
let tasksMutationChain = Promise.resolve();

function runMoviesMutation(fn) {
  const result = moviesMutationChain.then(fn);
  moviesMutationChain = result.catch(() => {});
  return result;
}

function runTasksMutation(fn) {
  const result = tasksMutationChain.then(fn);
  tasksMutationChain = result.catch(() => {});
  return result;
}

/**
 * Read JSON file, returns default value if file doesn't exist
 * @param {string} filePath - Path to JSON file
 * @param {object} defaultValue - Default value if file doesn't exist
 * @returns {Promise<object>} Parsed JSON content
 */
async function readJsonFile(filePath, defaultValue = { movies: [] }) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return default
      await writeJsonFile(filePath, defaultValue);
      return defaultValue;
    }
    logger.error(`Error reading JSON file: ${filePath}`, { error: error.message });
    throw error;
  }
}

/**
 * Write JSON file
 * @param {string} filePath - Path to JSON file
 * @param {object} data - Data to write
 */
async function writeJsonFile(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error(`Error writing JSON file: ${filePath}`, { error: error.message });
    throw error;
  }
}

// ============= Movies CRUD =============

/**
 * Get all movies
 * @returns {Promise<Array>} Array of movies
 */
async function getMovies() {
  const data = await readJsonFile(config.paths.movies, { movies: [] });
  return data.movies || [];
}

/**
 * Get movie by ID
 * @param {string} id - Movie ID
 * @returns {Promise<object|null>} Movie object or null
 */
async function getMovie(id) {
  const movies = await getMovies();
  return movies.find(m => m.id === id) || null;
}

/**
 * Save a new movie
 * @param {object} movie - Movie object
 */
async function saveMovie(movie) {
  return runMoviesMutation(async () => {
    const data = await readJsonFile(config.paths.movies, { movies: [] });
    data.movies.push(movie);
    await writeJsonFile(config.paths.movies, data);
    logger.info(`Movie saved: ${movie.id}`, { movieId: movie.id, name: movie.name });
  });
}

/**
 * Update a movie
 * @param {string} id - Movie ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object|null>} Updated movie or null
 */
async function updateMovie(id, updates) {
  return runMoviesMutation(async () => {
    const data = await readJsonFile(config.paths.movies, { movies: [] });
    const index = data.movies.findIndex(m => m.id === id);

    if (index === -1) {
      return null;
    }

    data.movies[index] = {
      ...data.movies[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await writeJsonFile(config.paths.movies, data);
    logger.info(`Movie updated: ${id}`, { movieId: id, updates: Object.keys(updates) });

    return data.movies[index];
  });
}

/**
 * Delete a movie
 * @param {string} id - Movie ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteMovie(id) {
  return runMoviesMutation(async () => {
    const data = await readJsonFile(config.paths.movies, { movies: [] });
    const index = data.movies.findIndex(m => m.id === id);

    if (index === -1) {
      return false;
    }

    data.movies.splice(index, 1);
    await writeJsonFile(config.paths.movies, data);
    logger.info(`Movie deleted: ${id}`, { movieId: id });

    return true;
  });
}

// ============= Tasks CRUD =============

/**
 * Get all tasks
 * @returns {Promise<Array>} Array of tasks
 */
async function getTasks() {
  const data = await readJsonFile(config.paths.tasks, { tasks: [] });
  return data.tasks || [];
}

/**
 * Get task by ID
 * @param {string} taskId - Task ID
 * @returns {Promise<object|null>} Task object or null
 */
async function getTask(taskId) {
  const tasks = await getTasks();
  return tasks.find(t => t.taskId === taskId) || null;
}

/**
 * Get tasks by movie ID
 * @param {string} movieId - Movie ID
 * @returns {Promise<Array>} Array of tasks for the movie
 */
async function getTasksByMovie(movieId) {
  const tasks = await getTasks();
  return tasks.filter(t => t.movieId === movieId);
}

/**
 * Save a new task
 * @param {object} task - Task object
 */
async function saveTask(task) {
  return runTasksMutation(async () => {
    const data = await readJsonFile(config.paths.tasks, { tasks: [] });
    data.tasks.push(task);
    await writeJsonFile(config.paths.tasks, data);
    logger.debug(`Task saved: ${task.taskId}`, { taskId: task.taskId, type: task.type });
  });
}

/**
 * Update a task
 * @param {string} taskId - Task ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object|null>} Updated task or null
 */
async function updateTask(taskId, updates) {
  return runTasksMutation(async () => {
    const data = await readJsonFile(config.paths.tasks, { tasks: [] });
    const index = data.tasks.findIndex(t => t.taskId === taskId);

    if (index === -1) {
      return null;
    }

    data.tasks[index] = {
      ...data.tasks[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === 'completed' || updates.status === 'failed') {
      data.tasks[index].completedAt = new Date().toISOString();
    }

    await writeJsonFile(config.paths.tasks, data);

    if (updates.status) {
      logger.info(`Task status updated: ${taskId}`, {
        taskId,
        status: updates.status,
        progress: updates.progress,
      });
    }

    return data.tasks[index];
  });
}

/**
 * Delete a task
 * @param {string} taskId - Task ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteTask(taskId) {
  const data = await readJsonFile(config.paths.tasks, { tasks: [] });
  const index = data.tasks.findIndex(t => t.taskId === taskId);
  
  if (index === -1) {
    return false;
  }
  
  data.tasks.splice(index, 1);
  await writeJsonFile(config.paths.tasks, data);
  
  return true;
}

/**
 * Delete all tasks for a movie
 * @param {string} movieId - Movie ID
 */
async function deleteTasksByMovie(movieId) {
  const data = await readJsonFile(config.paths.tasks, { tasks: [] });
  const originalLength = data.tasks.length;
  
  data.tasks = data.tasks.filter(t => t.movieId !== movieId);
  
  if (data.tasks.length < originalLength) {
    await writeJsonFile(config.paths.tasks, data);
    logger.info(`Tasks deleted for movie: ${movieId}`, { 
      movieId, 
      count: originalLength - data.tasks.length 
    });
  }
}

// ============= Cleanup =============

/**
 * Clean up old completed/failed tasks (older than specified days)
 * @param {number} daysOld - Delete tasks older than this many days
 */
async function cleanupOldTasks(daysOld = 7) {
  const data = await readJsonFile(config.paths.tasks, { tasks: [] });
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const originalLength = data.tasks.length;
  data.tasks = data.tasks.filter(t => {
    if (t.status !== 'completed' && t.status !== 'failed') {
      return true;
    }
    const taskDate = new Date(t.completedAt || t.updatedAt);
    return taskDate > cutoffDate;
  });
  
  if (data.tasks.length < originalLength) {
    await writeJsonFile(config.paths.tasks, data);
    logger.info(`Old tasks cleaned up`, { 
      originalCount: originalLength, 
      newCount: data.tasks.length,
      deletedCount: originalLength - data.tasks.length
    });
  }
}

module.exports = {
  // Movies
  getMovies,
  getMovie,
  saveMovie,
  updateMovie,
  deleteMovie,
  
  // Tasks
  getTasks,
  getTask,
  getTasksByMovie,
  saveTask,
  updateTask,
  deleteTask,
  deleteTasksByMovie,
  
  // Cleanup
  cleanupOldTasks,
};