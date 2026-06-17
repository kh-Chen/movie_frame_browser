# 电影帧浏览 Web 应用 - 产品设计文档

> 版本：v1.1  
> 日期：2026-06-02  
> 状态：已与实现对齐（backend/ + frontend/ 分目录）

---

## 1. 功能设计

### 1.1 整体交互流程

#### 用户路径

```
[上传/选择电影] → [等待处理] → [封面展示] → [时间轴浏览] → [帧预览/动图预览] → [返回浏览]
```

具体步骤：

1. **选择电影**：用户点击「选择电影」按钮，弹出文件选择器，展示服务器端文件列表（支持 MP4、MKV），
2. **后台处理**：用户选择文件后，后端启动 ffmpeg 提取封面图 + 预抽帧队列
3. **封面展示**：处理完成后，前端自动展示电影封面图作为起点
4. **时间轴浏览**：用户拖动/滑动底部时间轴，后端按需返回对应时间戳的帧图
5. **帧预览**：点击当前帧，弹出模态框，播放约 3 秒 MP4 片段（`/clip`）
6. **继续浏览**：关闭预览后，用户可继续滑动时间轴浏览

#### 页面结构

```
┌─────────────────────────────────────────────┐
│  Header: 电影名称 + 进度状态                 │
├─────────────────────────────────────────────┤
│                                             │
│         主展示区 (Frame Display)             │
│    显示当前时间戳对应的帧图片                │
│    点击放大 / 弹出 GIF 预览                  │
│                                             │
├─────────────────────────────────────────────┤
│  时间轴 (Timeline)                           │
│  [======●========================] 01:23:45  │
│  拖动滑块 → 动态显示对应帧                   │
├─────────────────────────────────────────────┤
│  操作栏: [封面] [信息] [删除]               │
└─────────────────────────────────────────────┘
```

---

### 1.2 移动端交互方案

#### 时间轴滑动

| 操作 | 行为 |
|------|------|
| 单指水平滑动 | 移动时间轴滑块，显示对应时间戳帧图 |
| 快速滑动（惯性滚动） | 持续更新帧图，松开后根据惯性递减采样频率 |
| 点击时间轴任意位置 | 立即跳转到对应位置并显示帧图 |

- 滑块默认宽度：4px，触控热区扩大到 44px × 高度
- 时间轴两端预留 8% 边距，防止边界操作困难
- 滑动过程中，实时显示当前时间戳（格式：`HH:MM:SS.ms`）

#### 手势操作

| 手势 | 行为 |
|------|------|
| 单指点击帧图片 | 触发 GIF 动图预览 |
| 双指捏合 | 缩放当前帧图片（可选功能） |
| 下拉刷新 | 重新加载电影帧索引（已有缓存时跳过） |
| 长按帧图片 | 保存当前帧到本地 |

#### 帧显示策略

由于帧提取依赖 ffmpeg 处理（I/O 密集型），采用以下策略保证流畅度：

1. **按需提取**：用户滑动时，先返回上次缓存的最近帧，同时异步请求新帧
2. **帧预加载**：在滑动停止超过 300ms 后，自动预加载相邻 ±5 秒的关键帧
3. **占位图**：新帧加载期间显示灰色占位块 + 加载动画
4. **质量自适应**：移动端帧图最大宽度 1280px，JPEG 质量 75%

---

### 1.3 帧预览与 GIF 动图预览交互细节

#### 帧预览（当前帧大图）

- 点击主展示区的帧图片 → 全屏展示该帧
- 支持左右滑动切换相邻帧（每次跳 1 秒）
- 显示时间戳和帧号信息

#### 片段预览（实现默认：MP4 clip）

- **触发方式**：点击帧图 → `GifPreview` 模态框（组件名保留）
- **动画范围**：由 `CLIP_WINDOW` 配置，默认中心 ±1.5 秒（约 3 秒）
- **格式**：H.264 MP4（`GET /api/movies/:id/clip?t=`），生成与缓存快于 GIF
- **加载状态**：轮询 `GET /api/tasks/:taskId`，生成中显示进度
- **缓存策略**：同时间戳 clip 已存在则直接 302 静态文件
- **GIF**：`GET /api/movies/:id/gif` 仍可用，前端默认不走此路径

---

## 2. API 设计

### 2.1 端点总览

| 方法 | 路径 | 描述 | 同步方式 |
|------|------|------|----------|
| GET | `/api/movies` | 列出所有电影 | 同步 |
| GET | `/api/movies/:id` | 获取电影元数据 | 同步 |
| DELETE | `/api/movies/:id` | 删除电影及缓存 | 同步 |
| GET | `/api/movies/:id/cover` | 获取封面图 | 同步（302 重定向到文件） |
| GET | `/api/movies/:id/frames` | 获取帧索引（时间点列表） | 同步 |
| GET | `/api/movies/:id/frames/:timestamp` | 获取指定时间戳的帧图 | 同步（302 重定向） |
| GET | `/api/movies/:id/clip` | 生成/获取 MP4 预览片段（推荐） | 异步（轮询任务状态） |
| GET | `/api/movies/local/list` | 列出本地目录可导入视频 | 同步 |
| POST | `/api/movies/local/select` | 登记本地路径为电影 | 异步 |
| GET | `/api/movies/cache/status` | 缓存占用统计 | 同步 |
| DELETE | `/api/movies/cache` | 清理缓存（可选 `movieId`） | 同步 |
| GET | `/api/tasks/:taskId` | 查询任务状态 | 同步 |
| GET | `/api/health` | 健康检查 | 同步 |

---

### 2.2 详细 API 定义

#### POST `/api/movies`

上传电影文件。文件通过 `multipart/form-data` 上传。

**请求**

```
Content-Type: multipart/form-data
Body:
  file: [二进制文件流]
  name: "电影名称（可选，自动从文件名提取）"
```

**响应 - 202 Accepted**

```json
{
  "taskId": "task_abc123",
  "status": "processing",
  "message": "电影已接收，正在提取封面和帧索引",
  "movieId": null
}
```

**响应 - 400 Bad Request**

```json
{
  "error": "UNSUPPORTED_FORMAT",
  "message": "不支持的格式，支持：MP4、MKV",
  "code": 400
}
```

---

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
      "coverStatus": "ready",
      "frameIndexStatus": "ready"
    }
  ]
}
```

---

#### GET `/api/movies/:id`

获取电影详情。

**响应 - 200 OK**

```json
{
  "id": "mv_001",
  "name": "星际穿越",
  "originalName": "Interstellar.2014.1080p.BluRay.x264.mkv",
  "size": 8589934592,
  "duration": 10180.5,
  "resolution": "1920x1080",
  "codec": "h264",
  "uploadedAt": "2026-06-01T08:30:00Z",
  "coverUrl": "/api/movies/mv_001/cover",
  "frames": "/api/movies/mv_001/frames",
  "status": "ready"
}
```

**响应 - 404 Not Found**

```json
{
  "error": "MOVIE_NOT_FOUND",
  "message": "电影不存在或已被删除",
  "code": 404
}
```

---

#### DELETE `/api/movies/:id`

删除电影及其所有缓存文件。

**响应 - 200 OK**

```json
{
  "message": "电影已删除",
  "id": "mv_001"
}
```

---

#### GET `/api/movies/:id/cover`

获取电影封面图。返回 302 重定向到静态文件 URL。

**响应 - 302 Found**

```
Location: /movie/static/covers/mv_001.jpg
```

**响应 - 404 Not Found**

```json
{
  "error": "COVER_NOT_READY",
  "message": "封面尚未生成",
  "code": 404
}
```

---

#### GET `/api/movies/:id/frames`

获取帧索引列表（即所有预抽帧的时间点）。

**响应 - 200 OK**

```json
{
  "movieId": "mv_001",
  "interval": 60,
  "totalFrames": 170,
  "frames": [
    { "timestamp": 0, "url": "/api/movies/mv_001/frames/0" },
    { "timestamp": 60, "url": "/api/movies/mv_001/frames/60" },
    { "timestamp": 120, "url": "/api/movies/mv_001/frames/120" }
  ]
}
```

- `interval`：帧间隔（秒），默认 60 秒
- 可通过查询参数 `?interval=30` 调整

---

#### GET `/api/movies/:id/frames/:timestamp`

获取指定时间戳的帧图。`:timestamp` 为秒数（整数）。

**查询参数**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| width | number | 图片最大宽度 | 1280 |
| quality | number | JPEG 质量 1-100 | 75 |

**响应 - 200 OK**

```
Content-Type: image/jpeg
[二进制图片数据]
```

**响应 - 302 Found**

```
Location: /movie/static/frames/mv_001/60.jpg
```

**响应 - 404 Not Found**

```json
{
  "error": "FRAME_NOT_FOUND",
  "message": "时间戳超出范围或帧未生成",
  "code": 404
}
```

---

#### GET `/api/movies/:id/gif`

生成或获取 GIF 动图。

**查询参数**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| t | number | 中心时间戳（秒） | 必需 |
| width | number | GIF 宽度 | 320 |
| fps | number | 帧率 | 10 |
| window | number | 前后各几秒 | 3 |

**响应 - 200 OK**（GIF 已存在，直接返回）

```
Content-Type: image/gif
Content-Length: 204800
[二进制 GIF 数据]
```

**响应 - 202 Accepted**（GIF 正在生成）

```json
{
  "taskId": "gif_mv001_120",
  "status": "generating",
  "progress": 45,
  "message": "GIF 生成中，请稍候"
}
```

此时客户端应轮询 `GET /api/tasks/gif_mv001_120` 获取状态。

---

#### GET `/api/tasks/:taskId`

查询异步任务状态。

**响应 - 200 OK**

```json
{
  "taskId": "task_abc123",
  "type": "movie_process",
  "status": "processing",
  "progress": 60,
  "message": "正在提取帧索引：已完成 100/170"
}
```

**status 状态枚举**

| 值 | 说明 |
|----|------|
| `pending` | 任务已创建，等待执行 |
| `processing` | 正在处理 |
| `completed` | 处理完成 |
| `failed` | 处理失败 |

---

### 2.3 错误处理规范

所有错误响应统一格式：

```json
{
  "error": "ERROR_CODE",
  "message": "人类可读的错误描述",
  "code": <HTTP状态码>,
  "details": {}  // 可选，附加信息
}
```

**错误码表**

| ERROR_CODE | HTTP 状态码 | 说明 |
|------------|-------------|------|
| `UNSUPPORTED_FORMAT` | 400 | 不支持的文件格式 |
| `FILE_TOO_LARGE` | 400 | 文件超过大小限制 |
| `INVALID_TIMESTAMP` | 400 | 无效的时间戳 |
| `MOVIE_NOT_FOUND` | 404 | 电影不存在 |
| `COVER_NOT_READY` | 404 | 封面未生成 |
| `FRAME_NOT_FOUND` | 404 | 帧不存在 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 |
| `GIF_GENERATION_FAILED` | 500 | GIF 生成失败 |
| `STORAGE_ERROR` | 500 | 存储读写错误 |
| `SERVER_BUSY` | 503 | 服务器繁忙（CPU 限制中） |

---

## 3. 数据库设计

### 3.1 设计说明

本应用为单用户场景，**不引入关系型数据库**，所有元数据以 JSON 文件存储。电影数量有限（数十到数百部），JSON 文件查询性能足够，且便于备份和迁移。

> 若未来扩展为多用户或数据量激增，可迁移至 SQLite 或 PostgreSQL。

### 3.2 数据模型

#### 电影元数据表 (`movies.json`)

```json
{
  "movies": [
    {
      "id": "mv_xxx",
      "name": "电影名称",
      "originalName": "原始文件名",
      "originalPath": "/storage/movies/xxx.mkv",
      "size": 8589934592,
      "duration": 10180.5,
      "resolution": "1920x1080",
      "codec": "h264",
      "bitrate": 8500000,
      "uploadedAt": "2026-06-01T08:30:00Z",
      "status": "ready",
      "coverFile": "mv_xxx.jpg",
      "frameInterval": 60,
      "totalFrames": 170,
      "createdAt": "2026-06-01T08:30:00Z",
      "updatedAt": "2026-06-01T08:35:00Z"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，格式 `mv_{random8}` |
| `name` | string | 显示名称（用户可修改） |
| `originalName` | string | 原始上传文件名 |
| `originalPath` | string | 电影文件在服务器上的存储路径 |
| `size` | number | 文件大小（字节） |
| `duration` | number | 时长（秒，精确到毫秒） |
| `resolution` | string | 分辨率，如 `1920x1080` |
| `codec` | string | 视频编码 |
| `status` | string | `uploading` / `processing` / `ready` / `error` |
| `coverFile` | string | 封面文件名（含扩展名） |
| `frameInterval` | number | 预抽帧间隔（秒），默认 60 |
| `totalFrames` | number | 预抽帧总数 |

#### 任务表 (`tasks.json`)

```json
{
  "tasks": [
    {
      "taskId": "task_abc123",
      "type": "movie_process | gif_generate | frame_extract",
      "movieId": "mv_xxx",
      "status": "pending | processing | completed | failed",
      "progress": 60,
      "message": "正在提取帧索引",
      "params": {},
      "createdAt": "2026-06-01T08:30:00Z",
      "updatedAt": "2026-06-01T08:35:00Z",
      "completedAt": null
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | 任务唯一标识 |
| `type` | string | 任务类型 |
| `movieId` | string | 关联的电影 ID |
| `status` | string | 任务状态 |
| `progress` | number | 进度 0-100 |
| `message` | string | 状态消息 |
| `params` | object | 任务参数（如 GIF 的时间戳、宽度等） |
| `error` | string | 失败时的错误信息 |

### 3.3 目录结构

```
/data/
├── movies.json           # 电影元数据
├── tasks.json             # 任务状态
└── storage/
    ├── originals/         # 原始电影文件（可选，节省 SSD 空间则跳过）
    ├── covers/           # 封面图
    │   └── {movieId}.jpg
    ├── frames/           # 预抽帧（按电影 ID 分目录）
    │   └── {movieId}/
    │       ├── 0.jpg
    │       ├── 60.jpg
    │       ├── 120.jpg
    │       └── ...
    ├── clips/            # MP4 预览片段（前端默认使用）
    │   └── {movieId}/
    ├── gifs/             # GIF 动图（可选/兼容）
    │   └── {movieId}/
    │       └── t{timestamp}_w{width}.gif
    └── temp/             # ffmpeg 临时文件
        └── {taskId}/
```

> **SSD vs 机械盘策略**：  
> - `covers/`、`frames/`、`gifs/` 放在 SSD 上，保证帧提取和 GIF 生成的 I/O 性能  
> - `storage/originals/` 可选：若服务器 SSD 充足则存储电影文件；若 SSD 紧张，电影文件保留在机械盘原位置，通过 `originalPath` 字段指向机械盘路径，ffmpeg 支持直接读取机械盘文件（I/O 会慢但不影响其他方面）

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
│       ├── index.js              # 启动、目录初始化、缓存清理
│       ├── app.js                # Express 中间件与静态挂载
│       ├── config/index.js
│       ├── routes/               # movies, tasks, health
│       ├── controllers/
│       ├── services/
│       │   ├── ffmpegService.js
│       │   ├── cacheService.js
│       │   ├── storageService.js
│       │   ├── movieProcessService.js  # 入库：封面 + 预抽帧
│       │   └── taskQueue.js
│       ├── utils/
│       │   ├── logger.js
│       │   ├── idGenerator.js
│       │   ├── timeFormatter.js
│       │   ├── frameInterval.js        # 时长自适应抽帧间隔
│       │   ├── pathSecurity.js
│       │   └── staticUrl.js            # PUBLIC_PATH 静态 URL
│       └── middlewares/
└── frontend/
    ├── vite.config.js            # base: /movie/
    └── src/
        ├── views/                # Home, Browse, MovieDetail
        ├── components/           # Timeline, FrameDisplay, GifPreview, ...
        ├── composables/          # useMovieApi, useFrameLoader
        ├── stores/movieStore.js
        └── router/index.js
```

运行时数据目录由 `.env` 指定（见 `backend/.env.example`）：`DATA_PATH`（JSON 元数据）、`STORAGE_PATH`（covers/frames/clips 与 temp）。

### 4.2 模块划分

| 模块 | 职责 | 关键导出 |
|------|------|----------|
| `ffmpegService` | 封面、抽帧、MP4 clip | `extractCover()`, `extractFrame()`, `generatePreviewClip()`, `getVideoInfo()` |
| `cacheService` | movies.json / tasks.json | `getMovies()`, `saveMovie()`, `getTask()`, `updateTask()` |
| `storageService` | 路径与文件 CRUD、缓存体积统计 | `getCoverPath()`, `getFramePath()`, `getClipPath()`, `deleteMovieCache()` |
| `movieProcessService` | 本地选择后的入库流水线 | `processMovieIngest()` |
| `taskQueue` | FFmpeg 并发与 CPU 阈值 | `enqueue()`, `PRIORITY` |
| `movieController` | REST 入口 | 本地选择、帧/clip、缓存 API |
| `taskController` | 任务查询 | `getTaskStatus()` |

### 4.3 依赖包清单

```json
{
  "dependencies": {
    "express": "^4.18.2",          // Web 框架
    "fluent-ffmpeg": "^2.1.2",     // ffmpeg 封装
    "uuid": "^9.0.0",              // ID 生成
    "winston": "^3.11.0",          // 日志
    "dotenv": "^16.3.1",           // 环境变量
    "cors": "^2.8.5",              // 跨域
    "compression": "^1.7.4"         // 响应压缩
  },
  "devDependencies": {
    "jest": "^29.7.0",             // 测试框架
    "supertest": "^6.3.3",         // API 测试
    "nodemon": "^3.0.2"            // 开发热重载
  }
}
```

> **说明**：
> - `fluent-ffmpeg` 已有较好的维护和生态，若追求更现代的 API 可考虑 `node-fluent-ffmpeg` 或直接使用 `child_process.spawn` 封装 ffmpeg 命令（更稳定，无依赖兼容问题）
> - 不引入数据库依赖，纯文件存储降低运维复杂度
> - 缓存清理在 `index.js` 启动时与定时逻辑中执行，无需 node-cron
> - 不引入 Redis，本地文件 + JSON 元数据即可

---

## 5. 性能与限制策略

### 5.1 CPU 限制方案

**目标**：单核 CPU 占用 ≤ 50%，可利用多核但单个 ffmpeg 进程不超过限制。

#### 方案：进程池 + 信号量

```
┌─────────────────────────────────────────────────┐
│                 主进程 (Node.js)                  │
│  ┌─────────────┐   ┌──────────────────────────┐  │
│  │  Express    │   │   Task Queue (内存)        │  │
│  │  Web Server │   │  ┌─────────────────────┐  │  │
│  └──────┬──────┘   │  │ [task] [task] ...   │  │  │
│         │          │  └──────────┬──────────┘  │  │
│         │          └─────────────┼────────────┘  │
│         │                         │               │
│         ▼                         ▼               │
│  ┌──────────────────────────────────────────┐    │
│  │   Worker Manager (控制并发)               │    │
│  │   - 信号量控制同时运行的 ffmpeg 进程数    │    │
│  │   - 动态检测 CPU 负载                     │    │
│  │   - 任务优先级（GIF > 帧 > 封面）         │    │
│  └───────────────────┬──────────────────────┘    │
└──────────────────────┼──────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  ┌─────────┐    ┌─────────┐    ┌─────────┐
  │ffmpeg 1 │    │ffmpeg 2 │    │ffmpeg 3 │   ... N 个
  └─────────┘    └─────────┘    └─────────┘
```

**实现要点**：

1. **Semaphore（信号量）**：限制同时运行的 ffmpeg 进程数  
   - `MAX_CONCURRENT_FFMPEG = Math.max(1, Math.floor(os.cpus().length / 2))`  
   - 例：4 核 CPU → 最多 2 个 ffmpeg 并行

2. **CPU 负载检测**：每 5 秒检测一次系统负载 `loadavg`  
   - 若 1 分钟平均负载 > CPU 核心数 × 0.8，暂停新任务入队
   - 已有任务继续完成，不强制终止

3. **任务优先级**：  
   - `high`：GIF 生成（用户主动触发，等待中）  
   - `normal`：帧提取（后台预抽）  
   - `low`：封面提取（一次性）

4. **单个 ffmpeg 进程限制**：
   - 设置 `-threads 1`，限制单进程只使用 1 个 CPU 核心
   - 多进程叠加时，总占用 ≤ 50%

### 5.2 多核利用策略

| 场景 | 策略 |
|------|------|
| 帧提取（批量） | 多个 ffmpeg 进程并行（受信号量限制），每个单线程 |
| GIF 生成 | 单 ffmpeg 进程，动态滤镜合成 6 秒动图 |
| Web 服务 | Node.js 主进程 + Express（I/O 密集，天然异步） |
| 静态文件 | Nginx 直接服务，不走 Node.js，零 CPU 消耗 |

> **Nginx 配置要点**：Nginx 作为静态资源服务器，直接返回 `covers/`、`frames/`、`gifs/` 下的文件，避免 Node.js 读写文件的开销。

### 5.3 缓存淘汰策略

#### 帧缓存

- **预抽帧**：每部电影按 60 秒间隔预抽帧（可配置）
- **缓存保留**：所有预抽帧永久保留直到电影被删除
- **按需帧**：非预抽帧时间点的帧，用完即删（TTL: 1 小时）
- **LRU 清理**：磁盘空间不足时，优先删除最久未访问的按需帧

#### GIF 缓存

- **永久缓存**：已生成的 GIF 永久保留（用户可能反复查看）
- **命名唯一**：按 `t{timestamp}_w{width}_fps{fps}` 命名，相同参数命中缓存

#### 清理规则

| 缓存类型 | 保留策略 | 淘汰触发 |
|----------|----------|----------|
| 封面 | 永久 | 删除电影时 |
| 预抽帧 | 永久 | 删除电影时 |
| 按需帧 | TTL 1 小时 | 定时任务每 6 小时清理 |
| GIF | 永久 | 删除电影时 |
| 临时文件 | TTL 24 小时 | 每次启动清理 + 定时任务每小时清理 |

### 5.4 并发控制

由于是**单用户应用**，并发不是主要瓶颈，但仍需处理以下情况：

| 场景 | 控制策略 |
|------|----------|
| 多帧同时请求 | 使用内存缓存（LRU Cache，最多 50 张帧图），避免重复磁盘 I/O |
| GIF 生成冲突 | 相同参数的 GIF 生成请求合并为一个，等待同一结果 |
| 上传 + 已有任务 | 队列排队，优先处理已有队列 |
| 客户端轮询 | 支持 `ETag`/`Last-Modified`，减少无效请求 |

#### 简单内存缓存（LRU）

```javascript
class LRUCache {
  constructor(maxSize = 50) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  get(key) { /* 命中并移到末尾 */ }
  set(key, value) { /* 超出容量则淘汰最老的 */ }
}
```

- 每个请求的帧图先查缓存，命中则直接返回
- 未命中则从磁盘读取或调用 ffmpeg 提取，结果写入缓存

---

## 6. 附录

### 6.1 ffmpeg 常用命令参考

```bash
# 提取封面（指定时间点，-ss 放前面加速定位）
ffmpeg -ss 00:05:30 -i input.mkv -vframes 1 -q:v 2 cover.jpg

# 提取指定时间戳的帧
ffmpeg -ss 120 -i input.mkv -vframes 1 -q:v 2 -vf "scale=1280:-1" frame.jpg

# 生成 GIF（6秒窗口，320宽，10fps）
ffmpeg -ss 117 -t 6 -i input.mkv \
  -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 output.gif
```

### 6.2 移动端适配参考

- 移动端帧图宽度上限：1280px
- 桌面端帧图宽度上限：1920px
- GIF 统一宽度：320px（节省流量）
- 时间轴高度：桌面 48px，移动 56px（触控更友好）
- 触控热区最小 44×44px（iOS HIG 标准）

### 6.3 后续扩展方向

| 方向 | 说明 |
|------|------|
| 帧批注 | 在帧上添加文字/涂鸦标注 |
| 播放预览 | 点击帧后直接播放对应片段视频 |
| 多语言 | 国际化（i18n）界面 |
| 用户认证 | 添加登录认证，支持多用户 |
| 数据库迁移 | 数据量大时迁移至 SQLite/PostgreSQL |