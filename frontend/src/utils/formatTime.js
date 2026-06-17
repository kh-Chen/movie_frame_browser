/**
 * 格式化时间戳为 HH:MM:SS.ms 格式
 * @param {number} seconds - 秒数（可带小数）
 * @returns {string} 格式化后的时间字符串
 */
export function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) {
    return '00:00:00.000'
  }
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  
  const pad = (num, len = 2) => String(num).padStart(len, '0')
  
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`
}

/**
 * 格式化时间为 MM:SS 格式（无小时）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
export function formatTimeShort(seconds) {
  if (seconds == null || isNaN(seconds)) {
    return '00:00'
  }
  
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  
  const pad = (num) => String(num).padStart(2, '0')
  
  return `${pad(minutes)}:${pad(secs)}`
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小
 */
export function formatFileSize(bytes) {
  if (bytes == null || isNaN(bytes)) {
    return '0 B'
  }
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

/**
 * 格式化持续时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化的持续时间
 */
export function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) {
    return '0分钟'
  }
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }
  return `${minutes}分钟`
}