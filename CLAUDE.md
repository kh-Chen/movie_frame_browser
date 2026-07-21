# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

电影帧浏览 Web 应用：从服务器本地目录登记视频，按时间轴浏览关键帧，预览 MP4 片段（关键帧对齐，默认中心前 1 秒、后 5 秒）。前后端分离的纯 JavaScript 项目（Vue 3 + Express），无 TypeScript、无数据库。

## 常用命令

### 后端（`backend/`）

```bash
npm install          # 安装依赖
npm run dev          # nodemon 热重载开发（读取 backend/.env）
npm start            # 生产启动
npm test             # 运行 jest（目前项目尚无测试文件）
npm run test:watch
npm run test:coverage
```

健康检查：`GET /api/health`。

### 前端（`frontend/`）

```bash
npm install
npm run dev          # Vite dev server，5173 端口，代理 /api → localhost:8080
npm run build        # 生产构建到 frontend/dist
npm run preview
```

### 运行时前置

- Node.js 18+
- `ffmpeg` / `ffprobe` 必须在 PATH 中（或通过 `FFMPEG_PATH` / `FFPROBE_PATH` 指定）

## 架构关键点

### 后端分层（`backend/src/`）

```
index.js → app.js (createApp 工厂) → routes/ → controllers/ → services/ → utils/
```

- **config/index.js**：集中式配置，启动时自动创建 `STORAGE_PATH`、`DATA_PATH`、`TEMP_PATH` 及子目录（covers/frames/clips/temp）。环境变量优先，缺省值见 `.env.example`。
- **routes/movies.js**：注意静态路径（`/cache`、`/local/*`）必须在 `/:id` 之前注册，否则会被参数路由吞掉。
- **controllers**：HTTP 适配层，业务逻辑在 services。错误通过 `next(error)` 传递给 `middlewares/errorHandler.js`。
- **services**：
  - `ffmpegService.js` — 所有 FFmpeg/FFprobe 调用（封面、单帧、批量帧、片段生成、关键帧查找、视频信息）
  - `taskQueue.js` — 基于 Semaphore 的并发受限任务队列（单例），CPU 负载门控
  - `movieProcessService.js` — 入库流程（仅提取封面 + 写帧索引元数据，帧图不预抽）
  - `storageService.js` — 文件路径管理与磁盘缓存操作
  - `cacheService.js` — JSON 元数据持久化（`movies.json`、`tasks.json`），无数据库

### 按需帧生成（核心策略）

帧图**不批量预抽**，而是请求时生成：

1. `GET /api/movies/:id/frames/:ts` → controller 调 `ffmpegService.extractFrame` → 302 重定向到静态文件
2. 静态文件由 `app.js` 挂载在 `/static` 与 `${PUBLIC_PATH}/static` 两个路径（见 `utils/staticUrl.js`）
3. 帧文件按 frameIndex 命名（零填充 8 位）：`00000123.jpg`，关键帧用 `.key.jpg` 后缀：`00000123.key.jpg`

### 片段预览的 202 轮询模式

`GET /api/movies/:id/clip?t=` 有两种响应：

- **缓存命中**：直接返回 MP4（200，`Content-Type: video/mp4`），并通过 `X-Clip-Start` / `X-Clip-End` 响应头传递实际片段起止时间
- **未命中**：返回 `202 + { taskId }`，前端轮询 `GET /api/tasks/:taskId` 直到 `completed`，再带 `&cache=` 破缓存重新请求 clip

前端 `useClipLoader.js` 实现了这一逻辑，并在失败时降级为静态帧序列（`loadFallbackFrames`）。

### 任务队列与优先级

`taskQueue.js` 中的 `Semaphore` 控制 FFmpeg 并发数（`MAX_CONCURRENT_FFMPEG`，可设 `auto`）。三级优先级：

| 优先级 | 用途 | 触发方 |
|--------|------|--------|
| HIGH (1) | `clip_generate` 片段生成 | 用户点击预览 |
| NORMAL (2) | 帧提取、关键帧批量采集 | 后台 |
| LOW (3) | 封面提取（入库时） | 一次性 |

CPU 负载超过 `CPU_LOAD_THRESHOLD`（默认 0.8）时队列暂停接新任务。任务状态持久化到 `tasks.json`，启动时清理超过 7 天的旧任务。

### 时间戳量化与帧边界对齐

`utils/frameTimestamp.js` 是前后端共用的关键模块（前端有同名镜像）：

- `quantizeToFrame(timestamp, fps, duration)` — 把任意时间戳对齐到最近帧边界
- `getFrameIndex(timestamp, fps, duration)` — 时间戳转 frameIndex
- `frameIndexToTimestamp(frameIndex, fps)` — 反向转换
- `formatFrameBasename(frameIndex)` — 8 位零填充文件名

**重要**：前端请求帧 URL 前会先 `quantizeToFrame`，确保相同时间戳命中同一缓存文件。修改帧命名规则需同步前后端两个 `frameTimestamp.js`。

### 关键帧步进

`ffmpegService.findAdjacentKeyframe` 用 `ffprobe -skip_frame nokey -show_entries frame=best_effort_timestamp_time -read_intervals` 在 `[t, t+60s]` 区间内查找下一个/上一个关键帧时间戳，避免扫描全片。

### 子路径部署对齐

三处必须保持一致，否则静态资源 404：

| 位置 | 值 |
|------|-----|
| `backend/.env` `PUBLIC_PATH` | `/movie`（根路径部署设为空） |
| `frontend/vite.config.js` `base` | `/movie/` |
| `frontend/.env.production` `VITE_API_URL` | `/movie/api` |

`utils/staticUrl.js` 根据 `publicPath` 生成静态 URL 前缀（`/movie/static` 或 `/static`），并在 Express 同时挂载两个路径以兼容旧 `/static`。

### 路径安全

`utils/pathSecurity.js` 的 `resolvePathWithinRoot(filePath, allowedRoot)` 用于「选择本地电影」等接受用户输入路径的接口，防止目录遍历。任何新增的文件读取接口都应先过此函数。

### 缓存清理

- 启动时：检查 `STORAGE_PATH` 总大小，超过 `MAX_CACHE_SIZE * CACHE_CLEANUP_THRESHOLD` 时按 LRU 清理到 `MAX_CACHE_SIZE * CACHE_CLEANUP_TARGET`
- 清理顺序：`temp/` → `frames/` → `clips/` → `covers/`（covers 中的非 frames 文件受保护）
- API：`DELETE /api/movies/cache?movieId=` 按电影或全局清理

### 前端结构（`frontend/src/`）

- **stores/movieStore.js**：Pinia store，持有 `movies`、`currentMovie`、`currentTimestamp`、`frameCache`（LRU 50）
- **composables/**：
  - `useMovieApi.js` — 所有 API 调用与 URL 构造（`getFrameUrl`、`getClipUrl`、`getKeyframe` 等）
  - `useFrameLoader.js` — 帧图加载，LRU 缓存 + pending 请求去重（同一 timestamp 并发请求合并）
  - `useClipLoader.js` — 片段加载，处理 202 轮询、blob URL 生命周期、预加载下一段、失败降级
- **router/index.js**：`createWebHistory('/movie/')`，路由 `/`、`/browse/:id`、`/gallery/:id`、`/movie/:id`
- **utils/api.js**：axios 实例，`baseURL = import.meta.env.VITE_API_URL`（开发 `/api`，生产 `/movie/api`），响应拦截器直接返回 `response.data`

## 环境变量

模板见 `backend/.env.example`。关键项：

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 后端端口 | 8080（开发）|
| `PUBLIC_PATH` | 子路径前缀，与 Vite base 一致 | `/movie` |
| `DATA_PATH` | JSON 元数据目录 | `backend/data` |
| `STORAGE_PATH` | 静态输出目录 | `backend/static` |
| `LOCAL_MOVIES_DIR` | 「选择电影」扫描根目录 | `../movies` |
| `CLIP_SEEK_BACK` / `CLIP_SEEK_FORWARD` | 片段预览前后秒数 | 1 / 5 |
| `CLIP_CONTINUE_OFFSET` | 续播下一段起始偏移 | 1 |
| `MAX_CONCURRENT_FFMPEG` | FFmpeg 并发数或 `auto` | CPU 核数 / 2 |
| `MAX_CACHE_SIZE` | 磁盘缓存上限（字节）| 10GB |

## 开发注意事项

- **端口约定**：README 与 `.env.example` 写 8080，实际 `backend/.env` 配置为 60008。前端 Vite 代理固定指向 `localhost:8080`，若后端用其他端口需同步修改 `frontend/vite.config.js`。
- **数据/静态目录**：`backend/data/` 与 `backend/static/` 在运行时生成，已 gitignore。`movies.json`、`tasks.json` 首次运行时创建。
- **FFmpeg 超时**：`FFMPEG_TIMEOUT`（默认 5 分钟）控制一般任务，`CLIP_FFMPEG_TIMEOUT_SEC`（默认 20 秒）单独控制片段生成。批量关键帧采集有独立的动态超时（`getBatchKeyframeTimeoutSec`，按时长计算）。
- **修改帧命名/量化逻辑**：必须同步 `backend/src/utils/frameTimestamp.js` 与 `frontend/src/utils/frameTimestamp.js`，否则缓存键错位。
- **新增 API 路由**：在 `routes/movies.js` 中，含字面量段的路径（如 `/cache`、`/local`、`/frames/cached`）必须排在 `/:id` 之前。
- **静态文件 Content-Type**：`app.js` 的 `setHeaders` 显式设置 jpg/png/mp4 的 Content-Type 与 Cache-Control（frames 7 天、clips/covers 30 天）。

## 文档

- `docs/requirements.md` — 技术约束与性能策略
- `docs/design.md` — 产品设计、API 约定、目录结构、页面交互细节
