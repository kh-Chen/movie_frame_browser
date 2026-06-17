/**
 * Time Formatter Utility
 * Format timestamps and durations for display
 */

/**
 * Format seconds to HH:MM:SS.ms format
 * @param {number} seconds - Time in seconds
 * @param {boolean} includeMs - Include milliseconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds, includeMs = false) {
  if (typeof seconds !== 'number' || isNaN(seconds)) {
    return '00:00:00';
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  const pad = (n, len = 2) => n.toString().padStart(len, '0');
  
  if (includeMs) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

/**
 * Format seconds to compact format (e.g., "1h 23m" or "5m 30s")
 * @param {number} seconds - Time in seconds
 * @returns {string} Compact formatted time
 */
function formatTimeCompact(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) {
    return '0s';
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  return `${secs}s`;
}

/**
 * Format timestamp to ISO string
 * @param {number|Date} timestamp - Unix timestamp or Date object
 * @returns {string} ISO formatted date string
 */
function formatISO(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toISOString();
}

/**
 * Parse time string to seconds
 * Supports formats: "HH:MM:SS", "MM:SS", "SS"
 * @param {string} timeStr - Time string
 * @returns {number} Time in seconds
 */
function parseTimeToSeconds(timeStr) {
  if (typeof timeStr !== 'string') {
    return 0;
  }
  
  const parts = timeStr.split(':').map(Number);
  
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  
  return 0;
}

/**
 * Format file size to human readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || bytes === 0) {
    return '0 B';
  }
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Format percentage
 * @param {number} value - Value between 0 and 1
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage
 */
function formatPercentage(value, decimals = 1) {
  if (typeof value !== 'number' || isNaN(value)) {
    return '0%';
  }
  return `${(value * 100).toFixed(decimals)}%`;
}

module.exports = {
  formatTime,
  formatTimeCompact,
  formatISO,
  parseTimeToSeconds,
  formatFileSize,
  formatPercentage,
};