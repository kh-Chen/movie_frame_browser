# Movie Frame Browser

电影帧浏览 Web 应用：从服务器本地目录选择视频，按时间轴浏览关键帧，预览 MP4 片段（关键帧对齐，默认中心前 1 秒、后 5 秒）。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 18+、Express、fluent-ffmpeg、Winston |
| 前端 | Vue 3、Vite、Pinia、Vue Router、Axios |
| 媒体 | FFmpeg / FFprobe |
| 部署 | Nginx 反代 + PM2（见 `deploy/`） |

## 功能概览

- 从 `LOCAL_MOVIES_DIR` 分层浏览并登记本地视频（MP4、MKV、AVI、MOV、WMV）
- 入库处理：提取封面 + 生成自适应帧索引（帧图按需提取，不批量预抽）
- 浏览页：时间轴拖动、帧图展示、按相邻关键帧步进（滑动/方向键）、内联 MP4 片段预览与续播
- 关键帧采集：可选后台批量提取全片关键帧，支持瀑布流浏览全部关键帧
- 媒体库页：查看已缓存的帧图与片段（关键帧带标记）
- 任务队列面板：查看后台 FFmpeg 任务进度（含关键帧采集）
- 缓存管理：按电影或全局清理 frames/clips
- 静态资源由后端挂载，支持 `PUBLIC_PATH` 子路径部署

## 页面路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | Home | 电影列表、选择本地电影、缓存与任务管理 |
| `/browse/:id` | Browse | 时间轴浏览、帧预览、片段预览 |
| `/gallery/:id` | Gallery | 已缓存帧图与片段网格 |
| `/movie/:id` | MovieDetail | 电影元数据详情 |

前端 `base` 为 `/movie/`，完整 URL 形如 `https://host/movie/browse/:id`。

## 项目结构

```
movie-frame-browser/
├── backend/          # API 与 FFmpeg 处理
│   ├── src/
│   └── .env.example
├── frontend/         # Vue SPA（base: /movie/）
├── deploy/           # Nginx 配置片段与部署脚本
└── docs/
    ├── requirements.md
    └── design.md
```

## 快速开始

### 1. 环境

- Node.js 18+
- FFmpeg、FFprobe 在 PATH 中可用

### 2. 后端

```bash
cd backend
cp .env.example .env
# 编辑 .env：DATA_PATH、STORAGE_PATH、LOCAL_MOVIES_DIR 等（见 .env.example）
npm install
npm run dev
```

默认监听 `http://localhost:8080`，健康检查：`GET /api/health`。

### 3. 前端

```bash
cd frontend
npm install
npm run dev
```

开发服务器 `http://localhost:5173`，Vite 将 `/api` 与 `/movie/api` 代理到后端。

### 4. 生产构建

```bash
cd frontend && npm run build
cd backend && npm start
```

将 `frontend/dist` 部署到 Nginx `alias`（与 `vite.config.js` 中 `base: '/movie/'` 一致），参考 `deploy/nginx.conf`。完整部署流程见 `deploy/deploy.sh`。

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/movies` | 电影列表 |
| GET/DELETE | `/api/movies/:id` | 详情 / 删除 |
| GET | `/api/movies/:id/cover` | 封面（302 静态文件） |
| GET | `/api/movies/:id/frames` | 帧索引（时间点列表） |
| GET | `/api/movies/:id/frames/cached` | 已缓存帧图列表 |
| GET | `/api/movies/:id/frames/:ts` | 单帧（按需生成，302 静态文件） |
| GET | `/api/movies/:id/clip?t=` | 预览片段（缓存命中直接返回 MP4，否则 202 + 轮询任务） |
| GET | `/api/movies/:id/clips` | 已缓存片段列表 |
| GET | `/api/movies/:id/keyframe?t=&dir=` | 查找相邻关键帧（`dir=next` / `prev`） |
| GET | `/api/movies/:id/keyframes` | 已采集关键帧时间戳列表 |
| POST | `/api/movies/:id/keyframes/extract` | 批量采集全片关键帧（202 异步任务） |
| GET | `/api/movies/local/browse` | 分层浏览本地目录（可选 `?path=`） |
| GET | `/api/movies/local/list` | 本地根目录可导入视频列表（扁平） |
| POST | `/api/movies/local/select` | 登记本地文件 |
| GET | `/api/movies/cache/status` | 缓存占用统计 |
| DELETE | `/api/movies/cache` | 清理缓存（可选 `?movieId=`） |
| GET | `/api/tasks/:taskId` | 任务状态 |
| GET | `/api/tasks/queue/status` | 任务队列状态 |
| DELETE | `/api/tasks/:taskId` | 取消任务 |

完整约定见 [docs/design.md](docs/design.md)。

## 配置说明

环境变量模板：`backend/.env.example`。常用项：

| 变量 | 说明 |
|------|------|
| `PUBLIC_PATH` | 与前端 `base` 一致，默认 `/movie`；根路径部署设为 `PUBLIC_PATH=` |
| `PORT` | 后端端口，开发默认 8080 |
| `DATA_PATH` | JSON 元数据目录（`movies.json`、`tasks.json`） |
| `STORAGE_PATH` | 静态输出目录（`covers/`、`frames/`、`clips/`） |
| `LOCAL_MOVIES_DIR` | 服务器视频目录（「选择电影」扫描路径） |
| `CLIP_SEEK_BACK` / `CLIP_SEEK_FORWARD` | 片段预览前后 seek 秒数，默认 1 / 5 |
| `CLIP_CONTINUE_OFFSET` | 续播下一段时的起始偏移，默认 1 秒 |
| `MAX_CACHE_SIZE` / `CACHE_CLEANUP_*` | 磁盘缓存上限与自动清理 |
| `MAX_CONCURRENT_FFMPEG` | FFmpeg 并发数，或设为 `auto` |
| `ALLOWED_ORIGINS` | 生产环境 CORS 白名单（逗号分隔） |

## 文档

- [需求说明](docs/requirements.md) — 技术约束与性能策略
- [产品设计](docs/design.md) — API、目录结构、架构

## 许可

MIT
