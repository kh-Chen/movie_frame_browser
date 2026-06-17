/**
 * ID Generator Utility
 * Generate unique IDs for movies and tasks
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a movie ID
 * Format: mv_{random8}
 * @returns {string} Movie ID
 */
function generateMovieId() {
  const uuid = uuidv4().replace(/-/g, '').substring(0, 8);
  return `mv_${uuid}`;
}

/**
 * Generate a task ID
 * Format: task_{random}
 * @returns {string} Task ID
 */
function generateTaskId() {
  return `task_${uuidv4()}`;
}

/**
 * Generate a generic unique ID
 * @param {string} prefix - Optional prefix
 * @returns {string} Unique ID
 */
function generateUniqueId(prefix = 'id') {
  const uuid = uuidv4().replace(/-/g, '');
  return prefix ? `${prefix}_${uuid}` : uuid;
}

module.exports = {
  generateMovieId,
  generateTaskId,
  generateUniqueId,
};