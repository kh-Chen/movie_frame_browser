# AGENTS.md

## 命令

```bash
# 后端 (backend/)
npm install && npm run dev    # nodemon 热重载，读取 backend/.env
npm start                     # 生产启动
npm test                      # jest（目前无测试文件）

# 前端 (frontend/)
npm install && npm run dev    # Vite :5173，代理 /api → localhost:8080
npm run build                 # 输出到 frontend/dist/
```

## 端口陷阱

`CLAUDE.md`、`README` 和 `.env.example` 写后端端口 8080，但**实际 `backend/.env` 配置为 60008**。`frontend/vite.config.js` 中 Vite 代理固定指向 `localhost:8080`。开发时若后端用 60008，需要手动改 `vite.config.js` 的 proxy target，或临时设 `PORT=8080`。

## 架构

```
backend/src/
  index.js → app.js → routes/ → controllers/ → services/ → utils/
  config/index.js   # 集中式配置，启动时自动创建所有目录

frontend/src/
  stores/movieStore.js          # Pinia, 持有 movies/currentMovie/currentTimestamp
  composables/useMovieApi.js    # 所有 API 调用与 URL 构造
  composables/useFrameLoader.js # 帧图加载，LRU 50，并发请求去重
  composables/useHlsPlayer.js   # hls.js 播放器，连续播放直到 destroy()
  utils/frameTimestamp.js       # 与后端 backend/src/utils/frameTimestamp.js 镜像
```

## 预览已改为 HLS（非 MP4 clip）

`CLAUDE.md` 中描述的 MP4 202 轮询 + `useClipLoader.js` **已废弃**。当前实现是 **HLS 动态打包**：

- 路由：`GET /api/movies/:id/hls/playlist.m3u8?t=` 和 `GET /api/movies/:id/hls/segment?start=&dur=`
- 前端：`useHlsPlayer.js` 使用 hls.js 持续播放
- Nginx：`/movie/api/` 需设 `proxy_buffering off`（流式 TS 分片）
- Express：`app.js` 中 compression 中间件对 `/hls/segment` 跳过压缩

旧的 `/api/movies/:id/clip` 路由已移除。

## 路由注册顺序（易错）

`backend/src/routes/movies.js` 中，静态路径（`/cache`、`/local/*`）**必须**排在 `/:id` 之前，否则会被参数路由吞掉。HLS 路由（`/hls/playlist.m3u8`、`/hls/segment`）在 `/:id` 子路径内，顺序靠前（19-20 行），同样重要。

## 帧文件命名与前后端同步

帧图文件名：`{8位零填充frameIndex}.jpg`，关键帧加 `.key.jpg` 后缀。
修改 `backend/src/utils/frameTimestamp.js` **必须同步** `frontend/src/utils/frameTimestamp.js`，否则缓存键错位。

## 子路径部署对齐（三处一致）

| 位置 | 值 |
|------|-----|
| `backend/.env` `PUBLIC_PATH` | `/movie` |
| `frontend/vite.config.js` `base` | `/movie/` |
| `frontend/.env.production` `VITE_API_URL` | `/movie/api` |

不一致会导致静态资源 404。

## 无数据库、无测试、无 lint

- 元数据全部 JSON 文件（`DATA_PATH/movies.json`、`tasks.json`），`cacheService.js` 管理
- 无 linter/formatter/typecheck 配置，纯 JavaScript（无 TypeScript）
- 测试框架 jest 已配置但无测试文件

## 关键环境变量

见 `backend/.env.example` 模板。实际开发配置在 `backend/.env`：

- `PORT` — 当前为 60008（非默认 8080）
- `MAX_CONCURRENT_FFMPEG` — 整数或 `auto`（= CPU 核数 / 2）
- `FFMPEG_THREADS` — 单进程线程数，当前为 1
- `HLS_SEGMENT_DURATION` / `HLS_SEGMENT_TIMEOUT_SEC` — HLS 分片参数
- `LOCAL_MOVIES_DIR` — 选择本地电影的扫描根目录

## 关键帧采集

可选的后台批量提取：`POST /api/movies/:id/keyframes/extract` → 202 异步任务，结果缓存到 `DATA_PATH/keyframe-cache/`，帧文件写入 `STORAGE_PATH/frames/{movieId}/`。
