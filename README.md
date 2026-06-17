# Movie Frame Browser

电影帧浏览 Web 应用：从服务器本地目录选择视频，按时间轴浏览关键帧，点击预览短 MP4 片段（默认约 3 秒窗口）。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 18+、Express、fluent-ffmpeg、Winston |
| 前端 | Vue 3、Vite、Pinia、Vue Router、Axios |
| 媒体 | FFmpeg / FFprobe |
| 部署 | Nginx 反代（见 `deploy/nginx.conf`） |

## 功能概览

- 从 `LOCAL_MOVIES_DIR` 扫描并登记本地 MP4/MKV 等文件
- 后台任务队列：封面提取、自适应间隔预抽帧
- 浏览页：时间轴拖动、帧图展示、MP4 片段预览（`/api/movies/:id/clip`）
- 缓存管理：按电影或全局清理 frames/clips
- 静态资源由后端挂载，支持 `PUBLIC_PATH` 子路径部署

## 项目结构

```
movie-frame-browser/
├── backend/          # API 与 FFmpeg 处理
│   ├── src/
│   └── .env.example
├── frontend/         # Vue SPA（base: /movie/）
├── deploy/           # Nginx 与部署脚本
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

将 `frontend/dist` 部署到 Nginx `alias`（与 `vite.config.js` 中 `base: '/movie/'` 一致），参考 `deploy/nginx.conf`。

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/movies` | 电影列表 |
| GET/DELETE | `/api/movies/:id` | 详情 / 删除 |
| GET | `/api/movies/:id/cover` | 封面 |
| GET | `/api/movies/:id/frames` | 帧索引 |
| GET | `/api/movies/:id/frames/:ts` | 单帧 |
| GET | `/api/movies/:id/clip?t=` | 预览片段（推荐） |
| GET | `/api/movies/local/list` | 本地目录列表 |
| POST | `/api/movies/local/select` | 登记本地文件 |
| GET/DELETE | `/api/movies/cache` | 缓存统计 / 清理 |
| GET | `/api/tasks/:taskId` | 任务状态 |

完整约定见 [docs/design.md](docs/design.md)。

## 配置说明

环境变量模板：`backend/.env.example`。常用项：

- `PUBLIC_PATH`：与前端 `base` 一致，默认 `/movie`
- `LOCAL_MOVIES_DIR`：服务器视频目录（选择本地电影）
- `MAX_CACHE_SIZE` / `CACHE_CLEANUP_*`：磁盘缓存上限与自动清理
- `CLIP_*`：预览片段生成参数

## 文档

- [需求说明](docs/requirements.md)
- [产品设计（API、目录、架构）](docs/design.md)

## 许可

MIT
