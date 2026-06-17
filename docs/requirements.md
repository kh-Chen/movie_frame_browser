# 电影帧浏览 Web 应用 - 技术约束分析报告

## 项目概述

| 项目 | 说明 |
|------|------|
| 应用名称 | Movie Frame Browser |
| 后端技术 | Node.js |
| 支持格式 | MP4, MKV |
| 部署环境 | 私人 Linux 服务器 + Nginx 反代 |
| 性能约束 | CPU 单核 ≤50%（可多核） |
| 主要访问 | 移动端优先 |

---

## 一、FFmpeg 抽帧策略

### 1.1 抽帧频率策略

#### 推荐方案：自适应抽帧

```javascript
// 抽帧间隔策略（按视频时长）
const frameExtractionInterval = {
  short: { duration: 600, interval: 1 },      // ≤10分钟：每秒1帧
  medium: { duration: 3600, interval: 5 },     // ≤1小时：每5秒1帧
  long: { duration: 7200, interval: 10 },    // ≤2小时：每10秒1帧
  veryLong: { duration: Infinity, interval: 30 } // >2小时：每30秒1帧
};

// FFmpeg 抽帧命令示例
const ffmpegCmd = (inputPath, outputPattern, interval) => 
  `ffmpeg -i "${inputPath}" -vf "fps=${1/interval},scale=320:-1" -q:v 5 "${outputPattern}"`;
```

#### 分辨率适配方案

| 原始分辨率 | 缩放策略 | 输出分辨率 | 适用场景 |
|-----------|----------|-----------|----------|
| 4K (3840+) | scale=480:-1 | 480p | 预览图 |
| 1080p | scale=320:-1 | 320p | 缩略图列表 |
| 720p | scale=240:-1 | 240p | 移动端列表 |
| <720p | 保持原比例 | 原尺寸 | 高质量查看 |

### 1.2 CPU 控制策略

```bash
# 使用线程限制 - 限制为2个线程
ffmpeg -i input.mkv -vf "fps=1/10,scale=320:-1" -threads 2 output_%03d.jpg

# 使用 nice/ionice 降低优先级
nice -n 10 ionice -c 2 -n 7 ffmpeg -i input.mkv ...

# 或使用 cgroup/cpuset 限制 CPU 使用
```

#### 推荐配置

```javascript
const ffmpegConfig = {
  threads: 2,           // 限制线程数
  priority: 'low',      // 低优先级调度
  maxConcurrent: 1,     // 串行处理，避免并发
  timeout: 300000       // 5分钟超时
};
```

### 1.3 抽帧时机

| 时机 | 触发条件 | 实现方式 |
|------|----------|----------|
| 上传时 | 用户上传新视频 | 后台异步任务 |
| 首次访问时 | 文件存在但无缓存 | 按需生成 |
| 预热模式 | 管理员手动触发 | 批量任务 |

---

## 二、缓存策略设计

### 2.1 缓存分层架构

```
┌─────────────────────────────────────────────────────────┐
│                    L1: 内存缓存                          │
│         (LRU, 最多1000帧, ~50MB, TTL: 30分钟)            │
├─────────────────────────────────────────────────────────┤
│                    L2: SSD 缓存                          │
│         (文件系统, 最大10GB, LRU清理)                     │
├─────────────────────────────────────────────────────────┤
│                    L3: 源文件                            │
│              (原始视频文件位置)                            │
└─────────────────────────────────────────────────────────┘
```

### 2.2 缓存存储位置

| 类型 | 存储位置 | 容量 | 适用场景 |
|------|----------|------|----------|
| 内存缓存 | Node.js 进程内存 | 50-100MB | 热点帧 |
| SSD缓存 | `/var/cache/movie-frames/` | 10GB | 常规帧 |
| 备份缓存 | 外接存储 | 视情况 | 大型视频集 |

### 2.3 缓存大小监控

```javascript
// 缓存监控服务
class CacheMonitor {
  constructor(options) {
    this.maxCacheSize = options.maxCacheSize || 10 * 1024 * 1024 * 1024; // 10GB
    this.cacheDir = options.cacheDir || '/var/cache/movie-frames';
    this.alertThreshold = 0.8; // 80% 告警
  }

  async getCacheStats() {
    const { size, fileCount } = await this.calculateDirSize(this.cacheDir);
    return {
      currentSize: size,
      maxSize: this.maxCacheSize,
      usagePercent: (size / this.maxCacheSize * 100).toFixed(2),
      fileCount,
      needsCleanup: size > this.maxCacheSize * 0.9
    };
  }

  async calculateDirSize(dir) {
    // 实现目录大小计算
  }

  async sendAlert(stats) {
    // 发送告警（邮件/钉钉/微信）
  }
}
```

### 2.4 缓存清理机制

#### LRU 策略（推荐）

```javascript
const LRU = require('lru-cache');

// 内存缓存
const memoryCache = new LRU({
  max: 1000,                    // 最大条目数
  maxSize: 50 * 1024 * 1024,    // 50MB
  sizeCalculation: (value) => value.length,
  ttl: 30 * 60 * 1000,          // 30分钟 TTL
  updateAgeOnGet: true
});

// SSD 缓存清理
async cleanupCache(targetSize) {
  const files = await this.getCacheFiles();
  const sorted = files.sort((a, b) => a.lastAccess - b.lastAccess);
  
  let freedSpace = 0;
  const targetFree = this.currentSize - targetSize;
  
  for (const file of sorted) {
    if (freedSpace >= targetFree) break;
    freedSpace += file.size;
    await fs.unlink(file.path);
  }
}
```

#### 清理规则

| 触发条件 | 执行操作 |
|---------|---------|
| 缓存 > 80% | 警告日志 |
| 缓存 > 90% | 清理至 70% |
| 缓存 > 95% | 紧急清理至 60% |
| 磁盘空间 < 1GB | 紧急清理 |
| 每周日凌晨 | 例行清理 |

---

## 三、动图生成策略

### 3.1 视频信息获取

```javascript
const ffprobe = require('fluent-ffmpeg').ffprobe;

async function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      resolve({
        duration: metadata.format.duration,
        width: videoStream.width,
        height: videoStream.height,
        codec: videoStream.codec_name,
        bitrate: parseInt(metadata.format.bit_rate),
        fps: evalFPS(videoStream.r_frame_rate)
      });
    });
  });
}

function evalFPS(fpsStr) {
  // 处理 "30000/1001" 格式
  const [num, den] = fpsStr.split('/').map(Number);
  return den ? (num / den).toFixed(2) : num;
}
```

### 3.2 GIF 生成参数优化

#### 核心参数

| 参数 | 推荐值 | 说明 |
|-----|-------|------|
| fps | 10 | 帧率，建议 8-15 |
| scale | 320:-1 | 宽度固定，高度自适应 |
| loop | 0 | 0=无限循环 |
| max_duration | 10 | 最大时长10秒 |
| start_time | 中间位置 | 从视频中间截取 |

#### FFmpeg GIF 生成命令

```bash
# 生成高质量 GIF（使用 palette 生成）
ffmpeg -i input.mkv \
  -ss 00:05:30 \
  -t 5 \
  -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  output.gif

# 快速预览 GIF（低质量）
ffmpeg -i input.mkv -ss 00:05:30 -t 3 -vf "fps=10,scale=240:-1" -y /tmp/preview.gif
```

### 3.3 预生成 vs 实时生成

| 策略 | 触发时机 | 优点 | 缺点 |
|-----|---------|------|------|
| 预生成 | 抽帧完成后 | 即点即看 | 占用存储 |
| 实时生成 | 首次请求时 | 按需存储 | 首次等待 |
| 混合策略 | 按热度 | 平衡性能 | 实现复杂 |

#### 推荐：混合策略

```javascript
async function generatePreview(videoPath, timestamp) {
  const cacheKey = this.getCacheKey(videoPath, timestamp);
  
  // 1. 检查缓存
  const cached = await this.cache.get(cacheKey);
  if (cached) return cached;
  
  // 2. 检查是否预生成
  const preGenerated = await this.checkPreGenerated(cacheKey);
  if (preGenerated) {
    return preGenerated;
  }
  
  // 3. 实时生成
  const gif = await this.createGif(videoPath, timestamp);
  await this.cache.set(cacheKey, gif);
  
  // 4. 记录访问热度
  this.recordAccess(cacheKey);
  
  return gif;
}
```

---

## 四、风险评估与缓解措施

### 4.1 机械盘随机读取性能

#### 问题描述
机械硬盘(HDD)的随机读取性能远低于顺序读取，可能导致：
- 抽帧速度缓慢（<5帧/秒）
- 响应延迟高（>2秒/帧）
- 视频播放卡顿

#### 缓解措施

| 措施 | 实施方案 | 效果 |
|-----|---------|-----|
| 批量抽帧 | 一次抽取10-50帧 | 减少寻道次数 |
| 顺序读取 | 从视频开头连续读取 | 利用预读取 |
| SSD缓存 | 热数据移至SSD | 随机访问加速 |
| 预热缓存 | 定期预抽关键帧 | 减少实时抽帧 |
| RAM盘 | 热点视频放在内存 | 最快访问 |

```javascript
// 批量抽帧优化
async function batchExtractFrames(videoPath, outputDir, options) {
  const { count = 50, duration } = options;
  const interval = duration / count;
  
  // 分批处理，每批20帧
  const batchSize = 20;
  const batches = Math.ceil(count / batchSize);
  
  for (let i = 0; i < batches; i++) {
    const start = i * batchSize * interval;
    const frames = Math.min(batchSize, count - i * batchSize);
    
    await this.extractBatch(videoPath, outputDir, start, frames, interval);
  }
}
```

### 4.2 大视频文件处理

#### 问题描述
>4GB 的视频文件可能导致：
- 内存溢出
- 处理超时
- 磁盘 I/O 瓶颈

#### 缓解措施

| 问题 | 方案 | 实现 |
|-----|------|-----|
| 内存溢出 | 流式处理 | 使用 pipe + stream |
| 处理超时 | 分段处理 | -ss -t 分段抽帧 |
| I/O瓶颈 | 限流 | 控制并发数 |
| 存储压力 | 分层存储 | 热/冷数据分离 |

```javascript
// 流式抽帧 - 不加载完整文件
const extractFrame = async (videoPath, timestamp) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .outputOptions(['-q:v', '5'])
      .pipe(resolve, { end: true })
      .on('error', reject);
  });
};

// 分段处理大文件
async function processLargeVideo(videoPath, outputDir) {
  const info = await getVideoInfo(videoPath);
  const segmentDuration = 300; // 5分钟一段
  
  for (let t = 0; t < info.duration; t += segmentDuration) {
    await processSegment(videoPath, outputDir, t, Math.min(segmentDuration, info.duration - t));
  }
}
```

### 4.3 内存占用控制

#### 监控指标

| 指标 | 警告值 | 危险值 |
|-----|-------|-------|
| 进程内存 | >512MB | >1GB |
| 系统内存 | >70% | >85% |
| Node Heap | >300MB | >500MB |

#### 控制策略

```javascript
// 内存控制中间件
const memoryGuard = async (req, res, next) => {
  const memUsage = process.memoryUsage();
  const usedMB = memUsage.heapUsed / 1024 / 1024;
  
  if (usedMB > 500) {
    // 强制 GC
    global.gc?.();
    await new Promise(r => setTimeout(r, 100));
    
    if (usedMB > 700) {
      return res.status(503).json({ 
        error: 'Service temporarily unavailable',
        reason: 'Memory pressure'
      });
    }
  }
  next();
};

// 进程内存限制
// node --max-old-space-size=512 server.js
```

### 4.4 风险矩阵

| 风险项 | 概率 | 影响 | 优先级 |
|-------|-----|-----|-------|
| HDD 随机读取慢 | 高 | 中 | P1 |
| 大文件内存溢出 | 中 | 高 | P1 |
| 缓存占满磁盘 | 中 | 高 | P2 |
| FFmpeg 崩溃 | 低 | 中 | P2 |
| 视频编码不支持 | 低 | 低 | P3 |

---

## 五、性能预估

### 5.1 抽帧性能

| 视频规格 | 分辨率 | 文件大小(1h) | 抽帧耗时 | CPU占用 |
|---------|--------|-------------|---------|--------|
| 720p | 1280x720 | ~2GB | ~30秒 | 30-40% |
| 1080p | 1920x1080 | ~4GB | ~45秒 | 35-45% |
| 4K | 3840x2160 | ~15GB | ~3分钟 | 45-50% |

### 5.2 响应时间预估

| 操作 | 冷缓存 | 热缓存 | 说明 |
|-----|-------|-------|-----|
| 帧列表加载 | 2-5秒 | <500ms | 含网络延迟 |
| 单帧查看 | 1-3秒 | <200ms | 有缩略图 |
| 片段预览 (clip) | 2-8秒 | <500ms | MP4，预生成后命中缓存 |

### 5.3 存储预估

| 视频(1小时) | 帧数(5秒间隔) | 缩略图大小 | GIF缓存 |
|------------|-------------|-----------|---------|
| 1080p 4GB | 720帧 | ~36MB (50KB/帧) | ~5MB |
| 720p 2GB | 720帧 | ~18MB | ~3MB |

---

## 六、技术建议总结

### 6.1 核心技术选型

| 组件 | 推荐方案 | 备选 |
|-----|---------|-----|
| 视频处理 | FFmpeg (静态编译) | fluent-ffmpeg |
| 图片格式 | WebP | JPEG/AVIF |
| 缓存 | LRU + Redis | memory-cache |
| 任务队列 | Bull (Redis) | 自实现 |
| 内存控制 | --max-old-space-size | cgroups |

### 6.2 部署建议

```nginx
# Nginx 反代配置
upstream movie_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    location /api/ {
        proxy_pass http://movie_backend;
        proxy_buffering off;
    }
    
    location /frames/ {
        alias /var/cache/movie-frames/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 6.3 监控指标

| 指标 | 采集方式 | 告警阈值 |
|-----|---------|---------|
| CPU 使用率 | top/htop | >50% 持续 5min |
| 内存使用 | /proc/meminfo | >80% |
| 磁盘使用 | df | >85% |
| 响应延迟 | APM | p95 >2s |
| 错误率 | 日志统计 | >1% |

---

## 七、实现状态（2026-06-02）

| 能力 | 状态 |
|------|------|
| 本地目录选择 | 已实现 |
| 封面 + 自适应预抽帧 | 已实现 |
| 时间轴浏览 + 帧预览 | 已实现（`Browse.vue`） |
| MP4 片段预览 | 已实现（默认 clip） |
| 缓存统计与清理 | 已实现 |
| 子路径部署 `/movie/` | 已实现 |

运维侧仍建议在目标机实测 FFmpeg 耗时与 `MAX_CACHE_SIZE` 容量规划。

---

*文档版本: 1.1*  
*创建日期: 2026-06-01*  
*更新日期: 2026-06-02*