import api, { API_BASE } from '../utils/api'
import { DEFAULT_FPS, formatFrameTimestamp, quantizeToFrame } from '../utils/frameTimestamp'

export const useMovieApi = () => {
  /**
   * 获取电影列表
   */
  const getMovies = async () => {
    return api.get('/movies')
  }

  /**
   * 获取电影详情
   */
  const getMovie = async (id) => {
    return api.get(`/movies/${id}`)
  }

  /**
   * 删除电影
   */
  const deleteMovie = async (id) => {
    return api.delete(`/movies/${id}`)
  }

  /**
   * 获取封面URL
   */
  const getCoverUrl = (id) => {
    return `${API_BASE}/movies/${id}/cover`
  }

  /**
   * 获取帧图片URL
   */
  const getFrameUrl = (id, timestamp, width = 1280, fps = DEFAULT_FPS, duration = Infinity) => {
    const t = formatFrameTimestamp(quantizeToFrame(timestamp, fps, duration))
    return `${API_BASE}/movies/${id}/frames/${t}?width=${width}`
  }

  const getKeyframe = async (id, timestamp, direction) => {
    const t = Math.round(timestamp * 1000) / 1000
    const dir = direction > 0 ? 'next' : 'prev'
    return api.get(`/movies/${id}/keyframe`, { params: { t, dir } })
  }

  const getClipUrl = (id, timestamp) => {
    const t = Math.round(timestamp * 1000) / 1000
    return `${API_BASE}/movies/${id}/clip?t=${t}`
  }

  /**
   * 获取任务状态
   */
  const getTaskStatus = async (taskId) => {
    return api.get(`/tasks/${taskId}`)
  }

  /**
   * 浏览本地电影目录（文件树，单层）
   */
  const browseLocalDirectory = async (dirPath) => {
    const params = dirPath ? { path: dirPath } : undefined
    return api.get('/movies/local/browse', { params })
  }

  /**
   * 获取本地电影列表
   */
  const getLocalMovies = async () => {
    return api.get('/movies/local/list')
  }

  /**
   * 选择本地电影
   */
  const selectLocalMovie = async (path, name) => {
    return api.post('/movies/local/select', { path, name })
  }

  /**
   * 获取帧索引
   */
  const getFrameIndex = async (id, interval = 60) => {
    return api.get(`/movies/${id}/frames?interval=${interval}`)
  }

  /**
   * 获取缓存统计
   */
  const getCacheStats = async () => {
    return api.get('/movies/cache/status')
  }

  const clearCache = async (movieId) => {
    const url = movieId ? `/movies/cache?movieId=${movieId}` : '/movies/cache'
    return api.delete(url)
  }

  const getQueueStatus = async () => {
    return api.get('/tasks/queue/status')
  }

  const cancelTask = async (taskId) => {
    return api.delete(`/tasks/${taskId}`)
  }

  const getCachedFrames = async (id) => {
    return api.get(`/movies/${id}/frames/cached`)
  }

  const getCachedClips = async (id) => {
    return api.get(`/movies/${id}/clips`)
  }

  const deleteCachedFrame = async (id, timestamp) => {
    const t = formatFrameTimestamp(timestamp)
    return api.delete(`/movies/${id}/frames/cached/${t}`)
  }

  const deleteNonKeyframeFrames = async (id) => {
    return api.delete(`/movies/${id}/frames/cached/non-keyframes`)
  }

  const deleteCachedClip = async (id, timestamp) => {
    const t = Math.round(timestamp * 1000) / 1000
    return api.delete(`/movies/${id}/clips/${t}`)
  }

  const extractAllKeyframes = async (id) => {
    return api.post(`/movies/${id}/keyframes/extract`)
  }

  const getKeyframes = async (id) => {
    return api.get(`/movies/${id}/keyframes`)
  }

  return {
    getMovies,
    getMovie,
    deleteMovie,
    getCoverUrl,
    getFrameUrl,
    getKeyframe,
    getClipUrl,
    getTaskStatus,
    browseLocalDirectory,
    getLocalMovies,
    selectLocalMovie,
    getFrameIndex,
    getCacheStats,
    clearCache,
    getQueueStatus,
    cancelTask,
    getCachedFrames,
    getCachedClips,
    deleteCachedFrame,
    deleteNonKeyframeFrames,
    deleteCachedClip,
    extractAllKeyframes,
    getKeyframes,
  }
}