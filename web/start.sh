#!/usr/bin/env bash
# ===========================================================================
#  通用媒体下载器 - macOS/Linux 启动脚本
# ===========================================================================
#  在终端中运行: chmod +x start.sh && ./start.sh
#  访问 http://localhost:5000
# ===========================================================================

set -e

echo "============================================================"
echo "  🌐 通用媒体下载器正在启动..."
echo "============================================================"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未检测到 Python 3，请先安装"
    echo "   macOS: brew install python"
    echo "   Linux: apt install python3 python3-pip"
    exit 1
fi

# Check ffmpeg (recommended for yt-dlp merging)
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️  建议安装 ffmpeg 以获得更好的视频合并效果"
    echo "   macOS: brew install ffmpeg"
    echo "   Linux: apt install ffmpeg"
fi

# Install dependencies
echo "📦 正在检查依赖..."
pip3 install -r requirements.txt -q

# Start server
echo ""
echo "✅ 启动成功！访问地址: http://localhost:5000"
echo "   局域网其他设备: http://本机IP:5000"
echo "   按 Ctrl+C 停止服务器"
echo "============================================================"
echo ""

python3 app.py
