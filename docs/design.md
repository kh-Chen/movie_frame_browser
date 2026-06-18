# 电影帧浏览 Web 应用 - 产品设计文档

> 版本：v1.2  
> 日期：2026-06-18  
> 状态：已与实现对齐（backend/ + frontend/ 分目录）

---

## 1. 功能设计

### 1.1 整体交互流程

#### 用户路径

```
[选择本地电影] → [入库处理] → [封面展示] → [时间轴浏览] → [片段预览/续播] → [媒体库查看缓存]
```

具体步骤：

1. **选择电影**：首页点击「选择电影」，弹出服务器 `LOCAL_MOVIES_DIR` 目录下的视频列表
2. **入库处理**：选择后后端提取封面、写入帧索引元数据（帧图不预抽，按需生成）
3. **浏览**：进入 `Browse` 页，拖动时间轴，后端按需返回对应时间戳的帧图
4. **片段预览**：点击「预览」或帧图，内联播放 MP4 片段（关键帧对齐，默认前 1 秒、后 5 秒）
5. **续播**：片段播放结束后可继续下一段（`CLIP_CONTINUE_OFFSET` 控制偏移）
6. **媒体库**：`Gallery` 页查看已缓存的帧图与片段网格

#### 页面结构

**首页（Home）**

```
┌─────────────────────────────────────────────┐
│  Header: 电影帧浏览  [任务队列] [缓存管理]   │
├─────────────────────────────────────────────┤
│  [选择电影]                                  │
│  我的电影 (N)                                │
│  ┌──────┐ ┌──────┐ ┌──────┐                │
│  │ 封面 │ │ 封面 │ │ 封面 │  ...            │
│  └──────┘ └──────┘ └──────┘                │
└─────────────────────────────────────────────┘
```

**浏览页（Browse）**

```
┌─────────────────────────────────────────────┐
│  ← 电影名称  01:23:45        [信息] [删除]   │
├─────────────────────────────────────────────┤
│         主展示区 (FrameDisplay)              │
│    帧图 / 内联 MP4 片段预览                  │
├─────────────────────────────────────────────┤
│  [-10s][-5s][-3s][预览][+3s][+5s][+10s]      │
├─────────────────────────────────────────────┤
│  时间轴 (Timeline)                           │
│  [======●========================]           │
├─────────────────────────────────────────────┤
│  操作栏: [封面] [媒体库] [信息]             │
└─────────────────────────────────────────────┘
```

---

### 1.2 移动端交互方案

#### 时间轴滑动

| 操作 | 行为 |
|------|------|
| 单指水平滑动 | 移动时间轴滑块，显示对应时间戳帧图 |
| 点击时间轴任意位置 | 立即跳转到对应位置并显示帧图 |

- 滑块触控热区扩大到 44px
- 滑动过程中实时显示当前时间戳（格式：`HH:MM:SS`）

#### 帧显示策略

帧提取为 I/O 密集型操作，采用以下策略：

1. **按需提取**：滑动到新时间点时异步请求帧图
2. **帧预加载**：滑动停止后预加载相邻帧
3. **占位图**：加载期间显示灰色占位 + 动画
4. **质量自适应**：默认 JPEG 宽度 1280px，质量 75%

---

### 1.3 片段预览交互

- **触发方式**：浏览页工具栏「预览」按钮，或点击帧图进入片段模式
- **动画范围**：`CLIP_SEEK_BACK`（默认 1s）+ `CLIP_SEEK_FORWARD`（默认 5s），对齐关键帧
- **格式**：H.264 MP4（`GET /api/movies/:id/clip?t=`）
- **加载状态**：轮询 `GET /api/tasks/:taskId`，生成中显示进度
- **缓存策略**：同时间戳 clip 已存在则直接返回 MP4 文件
- **续播**：播放结束后点击续播，以下一段关键帧为起点生成新片段

---

## 2. API 设计

### 2.1 端点总览

| 方法 | 路径 | 描述 | 同步方式 |
|------|------|------|----------|
| GET | `/api/health` | 健康检查 | 同步 |
| GET | `/api/movies` | 列出所有电影 | 同步 |
| GET | `/api/movies/:id` | 获取电影元数据 | 同步 |
| DELETE | `/api/movies/:id` | 删除电影及缓存 | 同步 |
| GET | `/api/movies/:id/cover` | 获取封面图 | 同步（302） |
| GET | `/api/movies/:id/frames` | 获取帧索引（时间点列表） | 同步 |
| GET | `/api/movies/:id/frames/cached` | 列出已缓存帧图 | 同步 |
| GET | `/api/movies/:id/frames/:timestamp` | 获取指定时间戳帧图 | 同步（按需生成，302） |
| GET | `/api/movies/:id/clip` | 生成/获取 MP4 预览片段 | 同步或异步 |
| GET | `/api/movies/:id/clips` | 列出已缓存片段 | 同步 |
| GET | `/api/movies/local/list` | 列出本地目录可导入视频 | 同步 |
| POST | `/api/movies/local/select` | 登记本地路径为电影 | 异步 |
| GET | `/api/movies/cache/status` | 缓存占用统计 | 同步 |
| DELETE | `/api/movies/cache` | 清理缓存（可选 `movieId`） | 同步 |
| GET | `/api/tasks/:taskId` | 查询任务状态 | 同步 |
| GET | `/api/tasks/queue/status` | 任务队列状态 | 同步 |
| DELETE | `/api/tasks/:taskId` | 取消任务 | 同步 |

> **说明**：不支持文件上传 API（`POST /api/movies`）与 GIF 端点；电影通过本地目录选择入库。

---

### 2.2 详细 API 定义

#### GET `/api/movies`

获取电影列表。

**响应 - 200 OK**

```json
{
  "movies": [
    {
      "id": "mv_001",
      "name": "星际穿越",
      "originalName": "Interstellar.2014.1080p.BluRay.x264.mkv",
      "size": 8589934592,
      "duration": 10180.5,
      "resolution": "1920x1080",
      "uploadedAt": "2026-06-01T08:30:00Z",
      "status": "ready",
      "coverStatus": "ready",
      "frameIndexStatus": "ready"
    }
  ]
}
```

---

#### POST `/api/movies/local/select`

登记本地目录中的视频文件（不复制文件，仅记录 `originalPath`）。

**请求**

```json
{
  "path": "/mnt/movies/Interstellar.mkv",
  "name": "星际穿越（可选）"
}
```

**响应 - 202 Accepted**

```json
{
  "taskId": "task_abc123",
  "status": "processing",
  "message": "电影已登记，正在提取封面",
  "movieId": "mv_001"
}
```

---

#### GET `/api/movies/:id/frames`

获取帧索引列表（时间点，非预抽帧文件列表）。

**响应 - 200 OK**

```json
{
  "movieId": "mv_001",
  "interval": 5,
  "totalFrames": 2036,
  "frames": [
    { "timestamp": 0, "url": "/api/movies/mv_001/frames/0" },
    { "timestamp": 5, "url": "/api/movies/mv_001/frames/5" }
  ]
}
```

- `interval`：自适应间隔（秒），可通过 `?interval=30` 覆盖

---

#### GET `/api/movies/:id/frames/:timestamp`

获取指定时间戳的帧图。`:timestamp` 为秒数（整数）。

**查询参数**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| width | number | 图片最大宽度 | 1280 |
| quality | number | JPEG 质量 1-100 | 75 |

**响应 - 302 Found**（缓存命中或按需生成后）

```
Location: /movie/static/frames/mv_001/120.jpg
```

---

#### GET `/api/movies/:id/frames/cached`

列出磁盘上已缓存的帧图文件。

**响应 - 200 OK**

```json
{
  "movieId": "mv_001",
  "total": 42,
  "frames": [
    {
      "timestamp": 120,
      "url": "/movie/static/frames/mv_001/120.jpg",
      "apiUrl": "/api/movies/mv_001/frames/120",
      "size": 51200,
      "createdAt": "2026-06-18T10:00:00Z"
    }
  ]
}
```

---

#### GET `/api/movies/:id/clip`

生成或获取 MP4 预览片段。

**查询参数**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| t | number | 中心时间戳（秒） | 必需 |

**响应 - 200 OK**（片段已存在）

```
Content-Type: video/mp4
X-Clip-Start: 118.5
X-Clip-End: 125.0
[二进制 MP4 数据]
```

**响应 - 202 Accepted**（片段正在生成）

```json
{
  "taskId": "clip_mv001_120",
  "status": "generating",
  "progress": 0,
  "message": "片段生成中，请稍候"
}
```

客户端轮询 `GET /api/tasks/:taskId`，完成后重新请求 clip URL。

---

#### GET `/api/movies/:id/clips`

列出已缓存的预览片段。

**响应 - 200 OK**

```json
{
  "movieId": "mv_001",
  "total": 3,
  "clips": [
    {
      "timestamp": 120,
      "startTime": 118.5,
      "endTime": 125.0,
      "duration": 6.5,
      "url": "/api/movies/mv_001/clip?t=120",
      "staticUrl": "/movie/static/clips/mv_001/t120.mp4",
      "size": 1048576,
      "createdAt": "2026-06-18T10:05:00Z"
    }
  ]
}
```

---

#### GET `/api/tasks/:taskId`

查询异步任务状态。

**响应 - 200 OK**

```json
{
  "task": {
    "taskId": "task_abc123",
    "type": "movie_process",
    "status": "processing",
    "progress": 60,
    "message": "正在提取封面...",
    "movieId": "mv_001"
  }
}
```

**任务类型**

| type | 说明 |
|------|------|
| `movie_process` | 入库：封面 + 帧索引 |
| `clip_generate` | 片段生成 |
| `frame_extract` | 按需帧提取（内部） |

**status 枚举**

| 值 | 说明 |
|----|------|
| `pending` | 等待执行 |
| `processing` | 正在处理 |
| `completed` | 完成 |
| `failed` | 失败 |

---

### 2.3 错误处理规范

所有错误响应统一格式：

```json
{
  "error": "ERROR_CODE",
  "message": "人类可读的错误描述",
  "code": 400
}
```

**错误码表**

| ERROR_CODE | HTTP | 说明 |
|------------|------|------|
| `UNSUPPORTED_FORMAT` | 400 | 不支持的文件格式 |
| `INVALID_TIMESTAMP` | 400 | 无效的时间戳 |
| `MISSING_TIMESTAMP` | 400 | 缺少 `t` 参数 |
| `INVALID_PATH` | 400 | 路径不在允许目录内 |
| `MOVIE_NOT_FOUND` | 404 | 电影不存在 |
| `COVER_NOT_READY` | 404 | 封面未生成 |
| `FRAME_NOT_FOUND` | 404 | 帧提取失败 |
| `FILE_NOT_FOUND` | 404 | 本地文件不存在 |
| `DIRECTORY_NOT_FOUND` | 404 | 本地目录未配置 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 |
| `STORAGE_ERROR` | 500 | 存储读写错误 |
| `SERVER_BUSY` | 503 | CPU 负载过高 |

---

## 3. 数据设计

### 3.1 设计说明

单用户场景，**不引入关系型数据库**，元数据以 JSON 文件存储。

### 3.2 数据模型

#### 电影元数据 (`movies.json`)

```json
{
  "movies": [
    {
      "id": "mv_xxx",
      "name": "电影名称",
      "originalName": "原始文件名",
      "originalPath": "/mnt/movies/xxx.mkv",
      "size": 8589934592,
      "duration": 10180.5,
      "resolution": "1920x1080",
      "codec": "h264",
      "uploadedAt": "2026-06-01T08:30:00Z",
      "status": "ready",
      "coverFile": "mv_xxx.jpg",
      "frameInterval": 5,
      "totalFrames": 2036
    }
  ]
}
```

#### 任务表 (`tasks.json`)

```json
{
  "tasks": [
    {
      "taskId": "task_abc123",
      "type": "movie_process | clip_generate",
      "movieId": "mv_xxx",
      "status": "completed",
      "progress": 100,
      "message": "处理完成",
      "params": {},
      "createdAt": "2026-06-01T08:30:00Z"
    }
  ]
}
```

### 3.3 目录结构

```
DATA_PATH/
├── movies.json
└── tasks.json

STORAGE_PATH/
├── covers/
│   └── {movieId}.jpg
├── frames/
│   └── {movieId}/
│       └── {timestamp}.jpg    # 按需生成
├── clips/
│   └── {movieId}/
│       ├── t{timestamp}.mp4
│       └── t{timestamp}.json  # 片段元数据（起止时间）
└── temp/
    └── {taskId}/
```

> 电影源文件保留在 `LOCAL_MOVIES_DIR` 原位置，通过 `originalPath` 引用，ffmpeg 直接读取。

---

## 4. 技术架构

### 4.1 项目目录结构

```
movie-frame-browser/
├── README.md
├── docs/
│   ├── requirements.md
│   └── design.md
├── deploy/
│   ├── nginx.conf
│   └── deploy.sh
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── index.js              # 启动、缓存清理、任务清理
│       ├── app.js                # Express 中间件与静态挂载
│       ├── config/index.js
│       ├── routes/               # movies, tasks, health
│       ├── controllers/
│       ├── services/
│       │   ├── ffmpegService.js  # 封面、抽帧、片段、关键帧探测
│       │   ├── cacheService.js
│       │   ├── storageService.js
│       │   ├── movieProcessService.js
│       │   └── taskQueue.js
│       ├── utils/
│       │   ├── frameInterval.js
│       │   ├── cpuLoadMonitor.js
│       │   ├── pathSecurity.js
│       │   └── staticUrl.js
│       └── middlewares/
└── frontend/
    ├── vite.config.js            # base: /movie/
    └── src/
        ├── views/                # Home, Browse, Gallery, MovieDetail
        ├── components/           # Timeline, FrameDisplay, ClipPreview, ...
        ├── composables/          # useMovieApi, useFrameLoader, useClipLoader
        ├── stores/movieStore.js
        └── router/index.js
```

### 4.2 模块划分

| 模块 | 职责 | 关键导出 |
|------|------|----------|
| `ffmpegService` | 封面、抽帧、片段、关键帧探测 | `extractCover()`, `extractFrame()`, `generatePreviewClip()`, `computePreviewSegment()` |
| `cacheService` | movies.json / tasks.json | `getMovies()`, `saveMovie()`, `getTask()`, `updateTask()` |
| `storageService` | 路径与文件 CRUD、缓存统计 | `getCoverPath()`, `getFramePath()`, `getClipPath()`, `deleteMovieCache()` |
| `movieProcessService` | 本地选择后的入库流水线 | `processMovieIngest()` |
| `taskQueue` | FFmpeg 并发与 CPU 阈值 | `enqueue()`, `PRIORITY` |
| `movieController` | REST 入口 | 本地选择、帧/clip、缓存 API |
| `taskController` | 任务查询与取消 | `getTaskStatus()`, `getQueueStatus()` |

### 4.3 依赖包

**后端**

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "fluent-ffmpeg": "^2.1.2",
    "uuid": "^9.0.0",
    "winston": "^3.11.0",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "compression": "^1.7.4"
  }
}
```

**前端**

```json
{
  "dependencies": {
    "vue": "^3.4.21",
    "vue-router": "^4.3.0",
    "axios": "^1.6.7",
    "pinia": "^2.1.7"
  }
}
```

---

## 5. 性能与限制策略

### 5.1 CPU 限制

```
┌─────────────────────────────────────────────────┐
│                 主进程 (Node.js)                  │
│  ┌─────────────┐   ┌──────────────────────────┐  │
│  │  Express    │   │   Task Queue (内存)        │  │
│  └──────┬──────┘   │  信号量 + CPU 负载检测     │  │
│         │          └─────────────┬──────────────┘  │
│         ▼                        ▼                 │
│  ┌──────────────────────────────────────────┐    │
│  │   ffmpeg 进程池（MAX_CONCURRENT_FFMPEG）  │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

1. **信号量**：`MAX_CONCURRENT_FFMPEG`（默认 `cpuCores / 2`）
2. **CPU 负载检测**：`cpuLoadMonitor` 每 5 秒检测，负载 > 阈值时暂停入队
3. **任务优先级**：`clip_generate` > 帧提取 > 封面提取
4. **单进程限制**：`FFMPEG_THREADS=1`

### 5.2 缓存策略

| 缓存类型 | 保留策略 | 淘汰触发 |
|----------|----------|----------|
| 封面 | 永久 | 删除电影时 |
| 帧图（按需） | 永久 | 删除电影时 / LRU 全局清理 |
| 片段 | 永久 | 删除电影时 / LRU 全局清理 |
| 临时文件 | 启动清理 | 每次启动 |

### 5.3 并发控制

| 场景 | 控制策略 |
|------|----------|
| 同参数片段生成 | 合并为同一任务，避免重复入队 |
| 客户端轮询 | 任务完成后重新请求资源 URL |
| 静态文件 | Nginx 直接服务，减轻 Node.js 负担 |

---

## 6. 附录

### 6.1 ffmpeg 常用命令参考

```bash
# 提取封面
ffmpeg -ss 00:05:30 -i input.mkv -vframes 1 -q:v 2 cover.jpg

# 提取指定时间戳的帧
ffmpeg -ss 120 -i input.mkv -vframes 1 -q:v 2 -vf "scale=1280:-1" frame.jpg

# 生成预览片段（关键帧对齐后截取）
ffmpeg -ss 118.5 -to 125.0 -i input.mkv -c:v libx264 -preset fast clip.mp4
```

### 6.2 部署要点

- 前端 `base: '/movie/'`，后端 `PUBLIC_PATH=/movie`
- Nginx：`location /movie/` → `frontend/dist`，`location /api/` → 后端
- 静态资源路径与 `STORAGE_PATH` 一致，参考 `deploy/nginx.conf`
- PM2 守护后端，参考 `deploy/deploy.sh`

### 6.3 后续扩展方向

| 方向 | 说明 |
|------|------|
| 文件上传 | 支持 multipart 上传入库 |
| 用户认证 | 多用户场景 |
| 数据库迁移 | 数据量大时迁移至 SQLite |
| WebP 帧图 | 减小存储体积 |
