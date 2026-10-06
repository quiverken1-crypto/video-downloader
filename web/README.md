# 🌐 通用媒体下载器 - Universal Media Downloader

> **粘贴链接 · 预览内容 · 选择清晰度 · 一键下载**
> 支持 YouTube、B站、Instagram、TikTok、Twitter/X、Facebook、Reddit 等 1000+ 平台

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🎬 **多平台支持** | YouTube、B站、Instagram、TikTok、Twitter/X、Facebook、Reddit 等 |
| 🔍 **链接预览** | 粘贴链接后自动加载标题、封面、上传者信息 |
| 🎯 **清晰度选择** | 支持 4K/2K/1080p/720p/480p 等可选的下载画质 |
| 🔐 **登录获取 Cookie** | 可选：`pip install pywebview` 后在页面里登录平台，解锁需要登录的画质 |
| 📥 **视频+音频** | 支持视频下载和纯音频提取 (MP3) |
| 🖼️ **Instagram** | 支持帖子、Reels、轮播图的图片+视频下载 |
| 📋 **播放列表** | 支持 YouTube/B站 播放列表识别 |
| 💻 **跨平台部署** | Windows / macOS / Linux / Docker / NAS 均可运行 |
| 🌐 **局域网共享** | 局域网内其他设备可访问使用 |

## 🚀 快速启动

### 🪟 Windows
```bash
# 方式一：双击 start.bat
# 方式二：终端运行
cd platform-downloader
python app.py
```

### 🍎 macOS / 🐧 Linux
```bash
chmod +x start.sh && ./start.sh
# 或
cd platform-downloader
pip3 install -r requirements.txt
python3 app.py
```

### 🐳 Docker (任意平台)
```bash
# 构建并运行
docker build -t media-downloader .
docker run -d -p 5000:5000 -v downloads:/app/downloads media-downloader

# 或使用 docker-compose
docker-compose up -d
```

### 🖥️ NAS (群晖/威联通/Unraid)
通过 Docker 容器运行，映射 `5000` 端口和 `downloads` 数据卷即可。

## 📖 使用指南

1. **打开浏览器** 访问 `http://localhost:5000`
2. **粘贴链接** 到输入框（支持 YouTube、B站、Instagram 等）
3. **按回车** 或点击 🔍 解析，自动加载：
   - 📖 视频标题
   - 🖼️ 封面缩略图
   - 👤 上传者
   - 📊 可选的清晰度列表
4. **选择清晰度**（如 1080p、4K、音频等）
5. **点击下载** ✅

## 📱 支持的平台

| 平台 | 图标 | 说明 |
|------|------|------|
| YouTube | 🎬 | 视频、Shorts、播放列表 |
| B站 / Bilibili | 📺 | 视频、番剧、合集 |
| Instagram | 📷 | 帖子、Reels、轮播图 |
| TikTok | 🎵 | 视频、无字幕下载 |
| Twitter / X | 🐦 | 推文中的视频和图片 |
| Facebook | 📘 | 公开视频和帖子 |
| Reddit | 🤖 | 帖子中的视频和 GIF |
| Twitch | 🎮 | 直播片段、剪辑 |
| 小红书 | 📕 | 笔记中的图片和视频 |
| 微博 | 📱 | 博文中的视频 |
| 抖音 | 🎵 | 公开视频 |
| 1000+ 更多 | 🌐 | 通过 yt-dlp 引擎支持 |

## 🏗️ 项目结构

```
platform-downloader/
├── app.py              # Flask 后端 (主程序)
├── templates/
│   └── index.html      # 前端 UI
├── Dockerfile           # Docker 构建文件
├── docker-compose.yml   # Docker Compose 配置
├── requirements.txt     # Python 依赖
├── start.bat            # Windows 启动脚本
├── start.sh             # macOS/Linux 启动脚本
├── downloads/           # 下载文件存储目录
└── thumbnails/          # 封面缓存目录
```

## 🔧 技术栈

- **后端**: Python / Flask / yt-dlp
- **前端**: 纯原生 HTML + CSS + JavaScript (无框架依赖)
- **部署**: 支持原生运行 + Docker 容器化

## 📄 License

上游项目未声明许可证，本目录的修改部分随本仓库一起公开，仅供个人学习使用。

---

*基于 [sohamroyc/social-media-downloader](https://github.com/sohamroyc/social-media-downloader) 增强*
