#!/bin/bash
# Movie Frame Browser - 服务器部署脚本

set -e

# ============================================
# 配置 (根据实际情况修改)
# ============================================

APP_DIR="/opt/movie-frame-browser"
DATA_DIR="$APP_DIR/data"
STATIC_DIR="$APP_DIR/static"
BACKEND_PORT="8080"
NODE_ENV="production"

# 缓存目录 (SSD)
CACHE_DIR="$APP_DIR/cache"
MAX_CACHE_SIZE="10G"  # 最大缓存大小

# ============================================
# 颜色输出
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================
# 准备工作
# ============================================

prepare() {
    log_info "开始准备工作..."
    
    # 创建目录
    mkdir -p "$APP_DIR"
    mkdir -p "$DATA_DIR"
    mkdir -p "$STATIC_DIR/covers"
    mkdir -p "$STATIC_DIR/frames"
    mkdir -p "$STATIC_DIR/clips"
    mkdir -p "$STATIC_DIR/temp"
    mkdir -p "$CACHE_DIR"
    mkdir -p "$DATA_DIR/logs"
    
    # 初始化数据文件
    if [ ! -f "$DATA_DIR/movies.json" ]; then
        echo '{"movies":[]}' > "$DATA_DIR/movies.json"
    fi
    if [ ! -f "$DATA_DIR/tasks.json" ]; then
        echo '{"tasks":[]}' > "$DATA_DIR/tasks.json"
    fi
    
    # 检查 FFmpeg
    if ! command -v ffmpeg &> /dev/null; then
        log_error "FFmpeg 未安装，请先安装: sudo apt install ffmpeg"
        exit 1
    fi
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi
    
    log_info "准备工作完成"
}

# ============================================
# 部署后端
# ============================================

deploy_backend() {
    log_info "部署后端服务..."
    
    # 复制后端代码 (从构建机器或 Git 拉取)
    # 这里假设代码已经在 APP_DIR 中
    if [ -f "$APP_DIR/backend/package.json" ]; then
        cd "$APP_DIR/backend"
        npm install --production
        
        # 创建环境变量文件
        cat > "$APP_DIR/backend/.env" << EOF
NODE_ENV=$NODE_ENV
PORT=$BACKEND_PORT
DATA_DIR=$DATA_DIR
STATIC_DIR=$STATIC_DIR
CACHE_DIR=$CACHE_DIR
MAX_CACHE_SIZE=$MAX_CACHE_SIZE
LOG_LEVEL=info
EOF
        
        log_info "后端依赖安装完成"
    else
        log_error "后端代码未找到: $APP_DIR/backend"
        exit 1
    fi
}

# ============================================
# 部署前端
# ============================================

deploy_frontend() {
    log_info "部署前端..."
    
    # 前端构建输出目录
    FRONTEND_DIST="$APP_DIR/frontend/dist"
    
    if [ -d "$FRONTEND_DIST" ]; then
        # 创建符号链接到 Nginx 根目录
        # 根据实际情况调整
        # ln -sf "$FRONTEND_DIST" /var/www/movie-frame-browser
        log_info "前端已部署到 $FRONTEND_DIST"
    else
        log_warn "前端构建目录未找到: $FRONTEND_DIST"
        log_info "请先在前端目录执行: npm run build"
    fi
}

# ============================================
# 配置 PM2 进程管理
# ============================================

setup_pm2() {
    log_info "配置 PM2 进程管理..."
    
    # 安装 PM2 (如果未安装)
    if ! command -v pm2 &> /dev/null; then
        npm install -g pm2
    fi
    
    # 创建 PM2 配置文件
    cat > "$APP_DIR/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: 'movie-frame-browser',
    script: 'src/index.js',
    cwd: '$APP_DIR/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: '$NODE_ENV',
      PORT: $BACKEND_PORT,
      DATA_DIR: '$DATA_DIR',
      STATIC_DIR: '$STATIC_DIR',
      CACHE_DIR: '$CACHE_DIR',
      MAX_CACHE_SIZE: '$MAX_CACHE_SIZE',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    error_file: '$DATA_DIR/logs/pm2-error.log',
    out_file: '$DATA_DIR/logs/pm2-out.log',
    log_file: '$DATA_DIR/logs/pm2-combined.log',
    time: true,
  }]
};
EOF
    
    # 启动服务
    cd "$APP_DIR"
    pm2 start ecosystem.config.js
    pm2 save
    
    # 设置开机自启
    pm2 startup
    
    log_info "PM2 配置完成"
}

# ============================================
# 缓存管理
# ============================================

manage_cache() {
    log_info "缓存管理..."
    
    # 显示缓存使用情况
    echo ""
    echo "缓存目录: $CACHE_DIR"
    echo ""
    
    # 检查各目录大小
    for dir in covers frames clips; do
        path="$STATIC_DIR/$dir"
        if [ -d "$path" ]; then
            size=$(du -sh "$path" 2>/dev/null | cut -f1)
            count=$(find "$path" -type f 2>/dev/null | wc -l)
            echo "  $dir: $size ($count 文件)"
        fi
    done
    
    echo ""
    
    # 提示清理命令
    echo "手动清理命令:"
    echo "  # 清理指定电影的缓存"
    echo "  rm -rf $STATIC_DIR/covers/\${MOVIE_ID}*"
    echo "  rm -rf $STATIC_DIR/frames/\${MOVIE_ID}"
    echo "  rm -rf $STATIC_DIR/clips/\${MOVIE_ID}"
    echo ""
    echo "  # 清理所有缓存"
    echo "  rm -rf $STATIC_DIR/covers/*"
    echo "  rm -rf $STATIC_DIR/frames/*"
    echo "  rm -rf $STATIC_DIR/clips/*"
}

# ============================================
# 启动服务
# ============================================

start() {
    log_info "启动服务..."
    cd "$APP_DIR"
    pm2 start movie-frame-browser || pm2 restart movie-frame-browser
    pm2 list
}

# ============================================
# 停止服务
# ============================================

stop() {
    log_info "停止服务..."
    pm2 stop movie-frame-browser || true
}

# ============================================
# 查看日志
# ============================================

logs() {
    pm2 logs movie-frame-browser --lines 100 --nostream
}

# ============================================
# 主菜单
# ============================================

show_help() {
    echo ""
    echo "Movie Frame Browser - 部署脚本"
    echo ""
    echo "用法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  prepare     - 准备工作 (创建目录, 检查依赖)"
    echo "  backend     - 部署后端"
    echo "  frontend    - 部署前端"
    echo "  pm2         - 配置 PM2"
    echo "  cache       - 缓存管理"
    echo "  start       - 启动服务"
    echo "  stop        - 停止服务"
    echo "  restart     - 重启服务"
    echo "  logs        - 查看日志"
    echo "  deploy      - 完整部署 (所有步骤)"
    echo "  help        - 显示帮助"
    echo ""
    echo "示例:"
    echo "  $0 deploy       # 完整部署"
    echo "  $0 start        # 启动服务"
    echo "  $0 logs         # 查看日志"
    echo ""
}

# ============================================
# 主程序
# ============================================

case "${1:-help}" in
    prepare)
        prepare
        ;;
    backend)
        deploy_backend
        ;;
    frontend)
        deploy_frontend
        ;;
    pm2)
        setup_pm2
        ;;
    cache)
        manage_cache
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        start
        ;;
    logs)
        logs
        ;;
    deploy)
        prepare
        deploy_backend
        deploy_frontend
        setup_pm2
        start
        log_info "部署完成!"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "未知命令: $1"
        show_help
        exit 1
        ;;
esac