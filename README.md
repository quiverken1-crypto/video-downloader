# 多平台视频下载器

保存 B 站、YouTube、Instagram 的视频和图片。有两个版本，**都需要下载到自己电脑上运行**（不是在线网站），选一个用就行：

| | 桌面版 | 本地网页版 |
|---|---|---|
| 适合 | 直接双击使用 | 想在局域网 / NAS / Docker 里跑，或者想改代码 |
| 需要 | Windows 10/11 64 位 | Python 3.8+（或 Docker） |
| 下载 | [video-downloader-desktop-win64.zip](https://github.com/quiverken1-crypto/video-downloader/releases/latest/download/video-downloader-desktop-win64.zip)（约 350 MB） | [video-downloader-web.zip](https://github.com/quiverken1-crypto/video-downloader/releases/latest/download/video-downloader-web.zip) |
| 用法 | 解压后双击「多平台视频下载器.exe」 | 解压后双击 `start.bat`，浏览器打开 http://localhost:5000 |

两个版本都基于 yt-dlp、gallery-dl 和 FFmpeg。访问 YouTube / Instagram 需要电脑能上外网（例如 Clash 开启系统代理）。

## 桌面版

- Electron 程序，内置 yt-dlp、gallery-dl、FFmpeg，不需要装别的东西。
- 下载内容保存在 `桌面\视频下载器\下载内容`；想换位置，设置环境变量 `VIDEO_DOWNLOADER_HOME`。
- 最多同时下载 3 项，其余自动排队。本机接口 `http://127.0.0.1:17896` 可以给脚本调用。
- 源码在 [`desktop/`](desktop)，安装包在 [Releases](https://github.com/quiverken1-crypto/video-downloader/releases)。

## 本地网页版

在你自己的电脑（或 NAS）上启动一个小服务器，再用浏览器打开操作界面，下载流量走你自己的网络。

- Flask 程序，第一次运行 `start.bat` 时会自动安装依赖。
- 局域网里的其他设备也能通过 `http://电脑IP:5000` 访问。
- 支持 Docker：`cd web && docker compose up -d`。
- 源码在 [`web/`](web)，基于 [sohamroyc/social-media-downloader](https://github.com/sohamroyc/social-media-downloader) 修改。

## 隐私

登录平台得到的 Cookie 只保存在你自己的电脑上（桌面版在 `桌面\视频下载器\Cookie`，网页版在程序目录的 `cookies.txt`）。仓库和安装包里都不包含任何 Cookie 或下载记录。

请只下载你有权保存的内容，并遵守各平台的使用条款。
