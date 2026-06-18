# 电影帧浏览 Web 应用 - 技术约束分析报告

## 项目概述

| 项目 | 说明 |
|------|------|
| 应用名称 | Movie Frame Browser |
| 后端技术 | Node.js 18+、Express |
| 支持格式 | MP4、MKV、AVI、MOV、WMV |
| 部署环境 | 私人 Linux 服务器 + Nginx 反代 + PM2 |
| 性能约束 | CPU 单核 ≤50%（可多核并行，受信号量限制） |
| 主要访问 | 移动端优先 |

---

## 一、FFmpeg 抽帧策略

### 1.1 抽帧频率策略

#### 实现方案：自适应帧索引 + 按需抽帧

入库时仅计算帧索引间隔，不批量预抽帧。用户浏览时间轴时，后端按需调用 FFmpeg 提取并缓存单帧。

```javascript
// 帧索引间隔（按视频时长，见 backend/src/utils/frameInterval.js）
function getAdaptiveFrameInterval(durationSeconds) {
  if (duration <= 600) return 1;      // ≤10分钟：每秒
  if (duration <= 3600) return 5;     // ≤1小时：每5秒
  if (duration <= 7200) return 10;    // ≤2小时：每10秒
  return 30;                          // >2小时：每30秒
}
```

帧索引用于时间轴刻度与步进；实际帧图在 `GET /api/movies/:id/frames/:timestamp` 首次请求时生成并写入 `STORAGE_PATH/frames/{movieId}/{ts}.jpg`。

#### 分辨率适配

| 场景 | 默认参数 | 说明 |
|------|----------|------|
| 浏览帧图 | `width=1280`, `quality=75` | 可通过查询参数覆盖 |
| 封面 | 原比例，JPEG quality 75 | 入库时提取 |

### 1.2 CPU 控制策略

```javascript
// 任务队列（backend/src/services/taskQueue.js）
const PRIORITY = {
  HIGH: 1,    // 片段生成（用户触发）
  NORMAL: 2,  // 帧提取（按需）、关键帧批量采集
  LOW: 3,     // 封面提取（入库）
};

// 并发控制
MAX_CONCURRENT_FFMPEG = Math.max(1, floor(cpuCores / 2))  // 或 env 指定
FFMPEG_THREADS = 1
CPU_LOAD_THRESHOLD = 0.8  // 负载过高时暂停入队
```

#### 推荐配置

- 单 ffmpeg 进程 `-threads 1`，多进程受信号量限制
- 片段生成超时 `CLIP_FFMPEG_TIMEOUT_SEC`（默认 20 秒）
- 通用 FFmpeg 超时 `FFMPEG_TIMEOUT`（默认 300 秒）

### 1.3 抽帧时机

| 时机 | 触发条件 | 实现方式 |
|------|----------|----------|
| 入库时 | 用户选择本地电影 | 仅提取封面 + 写入帧索引元数据 |
| 浏览时 | 时间轴 seek 到新时间点 | `getFrame` 按需提取并缓存 |
| 步进时 | 滑动/方向键切换帧 | `getKeyframe` 探测相邻关键帧，再按需取帧 |
| 片段预览时 | 用户点击预览 | `clip_generate` 异步任务 |
| 关键帧采集 | 用户手动触发（浏览页 🎞️） | `keyframe_extract` 异步批量提取 |

### 1.4 关键帧采集策略

除自适应时间轴索引外，支持可选的**全片关键帧批量采集**：

1. **探测**：`ffprobe` 分块探测全片关键帧时间戳，写入 `frames/{movieId}/keyframes.json`
2. **提取**：单次 FFmpeg 进程（`-skip_frame nokey`）批量输出，再按时间戳重命名至 `frames/{movieId}/{ts}.jpg`
3. **标记**：帧元数据 `isKeyframe: true`，电影元数据记录 `keyframesExtracted` / `keyframesCount`
4. **用途**：瀑布流浏览（`KeyframeBrowser`）、媒体库关键帧标记、精确关键帧步进

采集为后台低优先级任务（`PRIORITY.NORMAL`），与按需抽帧、片段生成共享 FFmpeg 信号量。

---

## 二、缓存策略设计

### 2.1 缓存分层

```
┌─────────────────────────────────────────────────────────┐
│  L1: 前端内存（帧 URL 缓存、相邻帧预加载）                │
├─────────────────────────────────────────────────────────┤
│  L2: 磁盘缓存（STORAGE_PATH）                           │
│      covers/  frames/{movieId}/  clips/{movieId}/     │
├─────────────────────────────────────────────────────────┤
│  L3: 源文件（LOCAL_MOVIES_DIR，通过 originalPath 引用）   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 缓存存储位置

| 类型 | 存储路径 | 说明 |
|------|----------|------|
| 元数据 | `DATA_PATH/movies.json`, `tasks.json` | JSON 文件 |
| 封面 | `STORAGE_PATH/covers/{movieId}.jpg` | 入库时生成 |
| 帧图 | `STORAGE_PATH/frames/{movieId}/{ts}.jpg` | 按需或批量关键帧采集生成，持久保留 |
| 关键帧清单 | `STORAGE_PATH/frames/{movieId}/keyframes.json` | 批量采集完成后写入 |
| 片段 | `STORAGE_PATH/clips/{movieId}/t{ts}.mp4` | 预览时生成，持久保留 |
| 临时 | `STORAGE_PATH/temp/` | 启动时与定时清理 |

### 2.3 缓存大小监控

- `GET /api/movies/cache/status` 返回总量、分项（covers/frames/clips/temp）及每部电影占用
- 启动时若超过 `MAX_CACHE_SIZE × CACHE_CLEANUP_THRESHOLD`，自动清理至 `MAX_CACHE_SIZE × CACHE_CLEANUP_TARGET`
- 前端 `CacheManager` 组件支持手动按电影或全局清理

### 2.4 缓存清理机制

| 触发条件 | 执行操作 |
|---------|---------|
| 启动时缓存 > 90% 上限 | LRU 清理至 70% |
| 用户手动清理 | `DELETE /api/movies/cache`（可选 `movieId`） |
| 删除电影 | 同步删除该电影所有缓存 |
| 启动时 | 清理过期 temp 文件、7 天前的任务记录 |

---

## 三、片段预览策略

### 3.1 视频信息获取

入库与按需处理均通过 `ffprobe` 获取时长、分辨率、编码等元数据。

### 3.2 片段生成参数

| 参数 | 默认值 | 说明 |
|-----|-------|------|
| `CLIP_SEEK_BACK` | 1 | 中心时间戳向前 seek |
| `CLIP_SEEK_FORWARD` | 5 | 中心时间戳向后 seek |
| `CLIP_CONTINUE_OFFSET` | 1 | 续播下一段时的起始偏移 |
| 对齐方式 | 关键帧 | ffprobe 探测最近关键帧作为起止点 |

片段生成使用 H.264 MP4，比 GIF 生成更快、体积更小。前端 `Browse.vue` 支持内联预览与续播下一段。

### 3.3 生成流程

1. `GET /api/movies/:id/clip?t=` 检查磁盘缓存
2. 命中 → 直接返回 MP4（含 `X-Clip-Start` / `X-Clip-End` 响应头）
3. 未命中 → 入队 `clip_generate` 任务，返回 202 + `taskId`
4. 客户端轮询 `GET /api/tasks/:taskId` 直至完成，再请求 clip URL

---

## 四、风险评估与缓解措施

### 4.1 机械盘随机读取性能

| 措施 | 实施方案 | 效果 |
|-----|---------|-----|
| 按需抽帧 | 仅提取用户浏览的时间点 | 减少无效 I/O |
| 关键帧对齐片段 | ffprobe 探测关键帧 | 避免全片解码 |
| SSD 缓存 | frames/clips 放 SSD | 随机访问加速 |
| 并发限制 | 信号量 + CPU 负载检测 | 避免 I/O 拥塞 |

### 4.2 大视频文件处理

| 问题 | 方案 |
|-----|------|
| 处理超时 | `-ss` 前置定位 + 分段超时控制 |
| I/O 瓶颈 | `MAX_CONCURRENT_FFMPEG` 限流 |
| 存储压力 | `MAX_CACHE_SIZE` 自动清理 |

### 4.3 风险矩阵

| 风险项 | 概率 | 影响 | 优先级 |
|-------|-----|-----|-------|
| HDD 随机读取慢 | 高 | 中 | P1 |
| 缓存占满磁盘 | 中 | 高 | P2 |
| FFmpeg 崩溃 | 低 | 中 | P2 |
| 视频编码不支持 | 低 | 低 | P3 |

---

## 五、性能预估

### 5.1 响应时间预估

| 操作 | 冷缓存 | 热缓存 | 说明 |
|-----|-------|-------|-----|
| 帧列表加载 | <500ms | <200ms | 仅返回时间戳列表 |
| 单帧查看 | 1-3秒 | <200ms | 按需 FFmpeg 抽帧 |
| 片段预览 | 2-8秒 | <500ms | MP4，关键帧对齐 |

### 5.2 存储预估

| 视频(1小时) | 索引帧数(5秒间隔) | 实际缓存帧数 | 说明 |
|------------|-----------------|-------------|------|
| 1080p | ~720 个时间点 | 取决于浏览量 | 仅缓存用户看过的帧 |
| 片段 | — | 取决于预览次数 | 每段约数 MB |

---

## 六、技术建议总结

### 6.1 核心技术选型（已实现）

| 组件 | 方案 |
|-----|------|
| 视频处理 | FFmpeg + fluent-ffmpeg |
| 元数据存储 | JSON 文件（无数据库） |
| 任务队列 | 内存队列 + 信号量（无 Redis） |
| 缓存淘汰 | 启动时阈值清理 + API 手动清理 |
| 前端 | Vue 3 + Pinia + Vite |

### 6.2 部署建议

- Nginx 反代 API，静态资源可由 Nginx 直接服务 `covers/`、`frames/`、`clips/`
- 后端 PM2 守护，参考 `deploy/deploy.sh`
- 配置 `PUBLIC_PATH=/movie` 与前端 `base` 一致

### 6.3 监控指标

| 指标 | 采集方式 | 告警阈值 |
|-----|---------|---------|
| CPU 使用率 | `cpuLoadMonitor` | 负载 > 核心数 × 0.8 |
| 磁盘使用 | `GET /api/movies/cache/status` | usagePercent > 90% |
| 任务积压 | `GET /api/tasks/queue/status` | waiting > 10 |

---

## 七、实现状态（2026-06-18）

| 能力 | 状态 |
|------|------|
| 本地目录分层浏览（`local/browse`） | 已实现 |
| 本地目录选择（`LOCAL_MOVIES_DIR`） | 已实现 |
| 封面提取 + 自适应帧索引 | 已实现 |
| 按需抽帧 + 磁盘缓存 | 已实现 |
| 相邻关键帧步进（滑动/方向键） | 已实现 |
| 全片关键帧批量采集 | 已实现 |
| 关键帧瀑布流浏览（`KeyframeBrowser`） | 已实现 |
| 时间轴浏览（`Browse.vue`） | 已实现 |
| 内联 MP4 片段预览 + 续播 | 已实现 |
| 媒体库（`Gallery.vue`，含关键帧标记） | 已实现 |
| 任务队列面板 | 已实现 |
| 缓存统计与清理 | 已实现 |
| 子路径部署 `/movie/` | 已实现 |
| 文件上传 API | 未实现（仅本地选择） |
| GIF 预览 | 未实现（已改用 MP4 clip） |

运维侧仍建议在目标机实测 FFmpeg 耗时、关键帧批量采集时长与 `MAX_CACHE_SIZE` 容量规划。

---

*文档版本: 1.3*  
*创建日期: 2026-06-01*  
*更新日期: 2026-06-18*
