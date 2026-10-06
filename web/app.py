#!/usr/bin/env python3
"""
Universal Media Downloader (DeepSeek Edition)
Enhanced with multi-platform support, video/audio preview, quality selection,
real-time progress tracking, automatic FFmpeg detection, and auto-update capabilities.
"""

import sys
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from flask import Flask, request, render_template, jsonify, send_file, send_from_directory
import os
import tempfile
import re
from datetime import datetime
import yt_dlp
import json
import zipfile
import shutil
import threading
import time
import uuid
import subprocess
import webbrowser
from pathlib import Path

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, 'downloads')
THUMBNAIL_DIR = os.path.join(BASE_DIR, 'thumbnails')
COOKIES_FILE = os.path.join(BASE_DIR, 'cookies.txt')
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(THUMBNAIL_DIR, exist_ok=True)

# ─── Config management ───────────────────────────────────────────────
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

def get_download_dir():
    cfg = load_config()
    custom = cfg.get('download_path', '').strip()
    if custom and os.path.isdir(custom):
        return custom
    return DOWNLOAD_DIR

# ─── FFmpeg auto-detection ───────────────────────────────────────────
def find_ffmpeg():
    cmd = shutil.which('ffmpeg')
    if cmd:
        return cmd
    candidates = [
        os.path.join(BASE_DIR, 'tools', 'ffmpeg.exe'),
        os.path.join(BASE_DIR, '..', '平台下载', '多平台视频下载器-Codex', 'resources', 'tools', 'ffmpeg.exe'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None

_ffmpeg_bin = find_ffmpeg()
if _ffmpeg_bin:
    _ffmpeg_dir = os.path.dirname(_ffmpeg_bin)
    if _ffmpeg_dir not in os.environ.get('PATH', ''):
        os.environ['PATH'] = _ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')

# ─── Tools & Auto Update ──────────────────────────────────────────────
tool_update_lock = threading.Lock()
tool_update_status = {
    'updating': False,
    'last_check': '',
    'last_status': '未开始',
    'logs': [],
}

def get_tools_versions():
    versions = {
        'yt_dlp': '未安装',
        'gallery_dl': '未安装',
        'ffmpeg': '未检测到',
        'python': sys.version.split()[0],
    }
    try:
        import yt_dlp
        import yt_dlp.version
        versions['yt_dlp'] = getattr(yt_dlp.version, '__version__', getattr(yt_dlp, '__version__', '已安装'))
    except Exception:
        pass

    try:
        import gallery_dl
        versions['gallery_dl'] = getattr(gallery_dl, '__version__', '已安装')
    except Exception:
        pass

    ffmpeg_path = find_ffmpeg()
    if ffmpeg_path:
        try:
            res = subprocess.run([ffmpeg_path, '-version'], capture_output=True, text=True, timeout=5)
            first_line = res.stdout.splitlines()[0] if res.stdout else ''
            m = re.search(r'ffmpeg version\s+([^\s]+)', first_line, re.IGNORECASE)
            versions['ffmpeg'] = m.group(1) if m else '已安装'
            versions['ffmpeg_path'] = ffmpeg_path
        except Exception:
            versions['ffmpeg'] = '已检测到'
    return versions

def update_tools_task(auto=False):
    global tool_update_status
    with tool_update_lock:
        if tool_update_status['updating']:
            return
        tool_update_status['updating'] = True
        tool_update_status['logs'] = []
        tool_update_status['last_status'] = '正在检查并更新下载核心...'

    def log(msg):
        with tool_update_lock:
            tool_update_status['logs'].append(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
            tool_update_status['last_status'] = msg

    try:
        log("开始检查 yt-dlp 和 gallery-dl 更新...")
        pip_mirrors = [
            "https://pypi.tuna.tsinghua.edu.cn/simple",
            "https://mirrors.aliyun.com/pypi/simple/",
            "https://pypi.org/simple",
        ]
        success = False
        for mirror in pip_mirrors:
            try:
                log(f"正在尝试从镜像源更新 ({mirror.split('/')[2]})...")
                cmd = [sys.executable, "-m", "pip", "install", "-U", "yt-dlp", "gallery-dl", "-i", mirror]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if res.returncode == 0:
                    log("✅ yt-dlp 与 gallery-dl 核心组件更新完成！")
                    success = True
                    break
                else:
                    detail = (res.stderr.strip() or res.stdout.strip())[:120]
                    log(f"镜像源提示: {detail}")
            except Exception as e:
                log(f"镜像源连接异常: {e}")

        if not success:
            log("⚠️ 尝试使用 pip 默认源更新...")
            cmd = [sys.executable, "-m", "pip", "install", "-U", "yt-dlp", "gallery-dl"]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if res.returncode == 0:
                log("✅ yt-dlp 与 gallery-dl 核心组件更新完成！")
                success = True

        versions = get_tools_versions()
        log(f"当前组件版本: yt-dlp={versions.get('yt_dlp')}, gallery-dl={versions.get('gallery_dl')}")
    except Exception as e:
        log(f"❌ 更新出错: {e}")
    finally:
        with tool_update_lock:
            tool_update_status['updating'] = False
            tool_update_status['last_check'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def trigger_background_update(delay=3):
    def _run():
        time.sleep(delay)
        cfg = load_config()
        if cfg.get('auto_update_tools', True):
            update_tools_task(auto=True)
    t = threading.Thread(target=_run, daemon=True)
    t.start()

# ─── Formatting helpers ───────────────────────────────────────────────
download_progress = {}
progress_lock = threading.Lock()

def format_bytes(n):
    if n <= 0:
        return '0 B'
    for unit in ['B', 'KB', 'MB', 'GB']:
        if n < 1024:
            return f'{n:.1f} {unit}'
        n /= 1024
    return f'{n:.1f} TB'

def format_speed(n):
    if n <= 0:
        return ''
    return format_bytes(n) + '/s'

def format_eta(seconds):
    if seconds is None or seconds <= 0:
        return ''
    s = int(seconds)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f'{h}:{m:02d}:{s:02d}'
    return f'{m}:{s:02d}'

def sanitize_folder_name(name):
    name = re.sub(r'[\\/*?:"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    if len(name) > 80:
        name = name[:80].rstrip()
    return name or '未命名'

def normpath(path):
    if not path:
        return path
    return path.replace('\\', '/')

def get_user_agent():
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

# ─── Platform Detection ───────────────────────────────────────────────
def detect_platform(url):
    url_lower = url.lower().strip()
    patterns = {
        'youtube': (r'(youtube\.com|youtu\.be)', '🎬'),
        'bilibili': (r'(bilibili\.com|b23\.ww|b23\.tv)', '📺'),
        'bilibili_hk': (r'bili\.(tv|2233\.io)', '📺'),
        'instagram': (r'instagram\.com', '📷'),
        'tiktok': (r'tiktok\.com', '🎵'),
        'twitter': (r'(twitter\.com|x\.com)', '🐦'),
        'facebook': (r'(facebook\.com|fb\.watch|fb\.com)', '📘'),
        'reddit': (r'reddit\.com', '🤖'),
        'twitch': (r'twitch\.tv', '🎮'),
        'vimeo': (r'vimeo\.com', '🎥'),
        'pinterest': (r'pinterest\.[a-z]+|pin\.it', '📌'),
        'douyin': (r'douyin\.com', '🎵'),
        'xiaohongshu': (r'xiaohongshu\.com|xhslink\.com', '📕'),
        'weibo': (r'weibo\.com', '📱'),
    }
    for name, (pattern, icon) in patterns.items():
        if re.search(pattern, url_lower):
            return name, icon
    return 'unknown', '🌐'

def get_platform_display_name(platform_key):
    names = {
        'youtube': 'YouTube', 'bilibili': 'B站/Bilibili', 'bilibili_hk': 'B站/Bilibili',
        'instagram': 'Instagram', 'tiktok': 'TikTok', 'twitter': 'Twitter/X',
        'facebook': 'Facebook', 'reddit': 'Reddit', 'twitch': 'Twitch',
        'vimeo': 'Vimeo', 'pinterest': 'Pinterest', 'douyin': '抖音',
        'xiaohongshu': '小红书', 'weibo': '微博', 'unknown': '其他平台'
    }
    return names.get(platform_key, platform_key)

def ensure_platform_dir(platform_key):
    base = get_download_dir()
    pdir = os.path.join(base, platform_key)
    os.makedirs(pdir, exist_ok=True)
    return pdir

# ─── Gallery-dl Helper ────────────────────────────────────────────────
def _gallery_dl_command():
    try:
        import gallery_dl
        return [sys.executable, '-m', 'gallery_dl']
    except ImportError:
        pass
    g_exe = shutil.which('gallery-dl')
    if g_exe:
        return [g_exe]
    candidates = [
        os.path.join(BASE_DIR, 'tools', 'gallery-dl.exe'),
        os.path.join(BASE_DIR, '..', '平台下载', '多平台视频下载器-Codex', 'resources', 'tools', 'gallery-dl.exe'),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return [c]
    return [sys.executable, '-m', 'gallery_dl']

def _instagram_cookie_args():
    return ['--cookies', COOKIES_FILE] if os.path.exists(COOKIES_FILE) else []

def parse_gallery_dl_output(output):
    payload = json.loads(output.lstrip('\ufeff').strip())
    if isinstance(payload, dict):
        payload = [payload]

    records = []
    container = {}
    for item in payload if isinstance(payload, list) else []:
        if isinstance(item, dict):
            records.append(item)
        elif isinstance(item, list) and len(item) >= 2:
            if item[0] == 2 and isinstance(item[1], dict):
                container = item[1]
            elif item[0] == 3 and len(item) >= 3 and isinstance(item[2], dict):
                record = dict(item[2])
                if isinstance(item[1], str):
                    record.setdefault('url', item[1])
                records.append(record)

    if not records:
        if 'login' in output.lower() or 'redirect' in output.lower():
            raise RuntimeError('Instagram 需要登录账号（HTTP redirect to login page）')
        raise RuntimeError('Instagram 帖子中没有找到可下载的图片或视频（可能需要登录账号）')

    first = records[0]
    return {
        'title': (first.get('description') or container.get('description') or
                  first.get('title') or first.get('post_shortcode') or 'Instagram 帖子'),
        'uploader': (first.get('owner_username') or first.get('username') or
                     first.get('author') or container.get('username') or ''),
        'thumbnail': (first.get('display_url') or first.get('thumbnail') or
                      first.get('url') or ''),
        'duration': 0,
        'media_count': len(records),
        'records': records,
    }

def inspect_instagram_with_gallery_dl(url, runner=subprocess.run):
    command = [
        *_gallery_dl_command(), '--dump-json', '--no-input',
        *_instagram_cookie_args(), url,
    ]
    result = runner(command, capture_output=True, text=True, encoding='utf-8',
                    errors='replace', timeout=60)
    raw_text = (result.stdout or '') + '\n' + (result.stderr or '')
    if 'redirect to login page' in raw_text or 'abortextraction' in raw_text.lower():
        raise RuntimeError('Instagram 需要登录账号（HTTP redirect to login page）')
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or '').strip()
        raise RuntimeError(detail or 'gallery-dl 解析 Instagram 失败')
    return parse_gallery_dl_output(result.stdout)

def download_instagram_with_gallery_dl(url, destination, runner=subprocess.run):
    os.makedirs(destination, exist_ok=True)
    command = [
        *_gallery_dl_command(),
        '--directory', destination,
        '--filename', '{num:>02}.{extension}',
        '--write-metadata', '--windows-filenames', '--no-input',
        *_instagram_cookie_args(), url,
    ]
    result = runner(command, capture_output=True, text=True, encoding='utf-8',
                    errors='replace', timeout=600)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or '').strip()
        raise RuntimeError(detail or 'gallery-dl 下载 Instagram 失败')

    media_extensions = {
        '.jpg', '.jpeg', '.png', '.webp', '.gif',
        '.mp4', '.mov', '.m4v', '.webm',
    }
    files = sorted(
        Path(destination, name)
        for name in os.listdir(destination)
        if Path(destination, name).is_file()
        and Path(name).suffix.lower() in media_extensions
    )
    if not files:
        raise RuntimeError('Instagram 下载进程结束，但没有生成任何图片或视频')
    return files

# ─── Preview & Format Extraction ──────────────────────────────────────
def extract_info(url):
    ffmpeg_bin = find_ffmpeg()
    base_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'skip_download': True,
        'force_generic_extractor': False,
        'cookiefile': COOKIES_FILE if os.path.exists(COOKIES_FILE) else None,
    }
    if ffmpeg_bin:
        base_opts['ffmpeg_location'] = os.path.dirname(ffmpeg_bin)

    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            return ydl.extract_info(url, download=False)
    except Exception as first_err:
        try:
            fallback_opts = dict(base_opts)
            fallback_opts['cookiesfrombrowser'] = ('chrome',)
            with yt_dlp.YoutubeDL(fallback_opts) as ydl:
                return ydl.extract_info(url, download=False)
        except Exception:
            pass
        raise Exception(f"提取信息失败: {str(first_err)}")

def extract_formats(info):
    formats = []
    seen = set()
    if not info or 'formats' not in info:
        return formats
    for f in info['formats']:
        height = f.get('height', 0) or 0
        ext = f.get('ext', 'unknown')
        vcodec = f.get('vcodec', 'none')
        acodec = f.get('acodec', 'none')
        fps = f.get('fps', 0) or 0
        filesize = f.get('filesize', 0) or 0
        tbr = f.get('tbr', 0) or 0
        format_note = f.get('format_note', '') or ''
        format_id = f.get('format_id', '')
        has_video = vcodec != 'none'
        has_audio = acodec != 'none'

        if not has_video and not has_audio:
            continue

        codec_label = ''
        if has_video:
            vc = vcodec.split('.')[0] if vcodec and vcodec != 'none' else ''
            vc_map = {'avc1': 'H.264', 'hev1': 'H.265', 'h265': 'H.265',
                      'vp9': 'VP9', 'av01': 'AV1', 'vp8': 'VP8',
                      'theora': 'Theora', 'h264': 'H.264'}
            codec_label = vc_map.get(vc, vc)

        if has_video and has_audio:
            category = 'combined'
            if height >= 2160:
                quality_label = f'4K ({height}p)'
            elif height >= 1440:
                quality_label = f'2K ({height}p)'
            elif height >= 1080:
                quality_label = '1080p'
            elif height >= 720:
                quality_label = '720p'
            elif height >= 480:
                quality_label = '480p'
            elif height >= 360:
                quality_label = '360p'
            else:
                quality_label = f'{height}p' if height > 0 else '视频'
            if fps > 30:
                quality_label += f' {fps}fps'
            type_label = f'视频+音频 · {ext}'
            tag = '含音频'
        elif has_video and not has_audio:
            category = 'video_only'
            if height >= 2160:
                quality_label = f'4K ({height}p)'
            elif height >= 1440:
                quality_label = f'2K ({height}p)'
            elif height >= 1080:
                quality_label = '1080p'
            elif height >= 720:
                quality_label = '720p'
            elif height >= 480:
                quality_label = '480p'
            elif height >= 360:
                quality_label = '360p'
            else:
                quality_label = f'{height}p' if height > 0 else '视频'
            if fps > 30:
                quality_label += f' {fps}fps'
            type_label = f'视频(无声) · {ext}'
            tag = '⚠️ 无声'
        else:
            category = 'audio_only'
            abr = f.get('abr', 0) or 0
            quality_label = f'音频 {abr}kbps' if abr > 0 else '音频'
            type_label = f'音频 · {ext}'
            tag = '🎵 纯音频'
            codec_label = ''

        if codec_label:
            type_label += f' · {codec_label}'

        dedup = (height, ext, has_video, has_audio, fps)
        if dedup in seen:
            continue
        seen.add(dedup)

        formats.append({
            'format_id': format_id, 'ext': ext,
            'quality_label': quality_label,
            'type_label': type_label,
            'category': category,
            'tag': tag,
            'height': height, 'fps': fps,
            'filesize': filesize, 'tbr': round(tbr, 1) if tbr else 0,
            'has_video': has_video, 'has_audio': has_audio,
            'vcodec': vcodec, 'acodec': acodec, 'format_note': format_note,
        })

    def sort_key(x):
        group_order = {'combined': 0, 'video_only': 1, 'audio_only': 2}
        return (group_order.get(x['category'], 9), -x['height'])

    formats.sort(key=sort_key)
    return formats

def detect_is_playlist(info):
    if info.get('_type') == 'playlist' or 'entries' in info:
        entries = info.get('entries', [])
        if entries:
            entry = entries[0] if isinstance(entries, list) else None
            if entry and isinstance(entry, dict):
                return True, len([e for e in entries if e])
    return False, 0

def select_download_format(format_id, has_video=True, has_audio=False):
    best_selectors = {
        'best',
        'bestvideo+bestaudio/best',
        'bestvideo*+bestaudio/best',
    }
    if format_id == 'best' and has_video:
        return 'bestvideo*+bestaudio/best'
    if format_id in best_selectors:
        return format_id
    if has_video and not has_audio:
        return f'{format_id}+bestaudio/best'
    return format_id

# ─── Download Task Worker ─────────────────────────────────────────────
def make_progress_hook(task_id):
    hook_start = time.time()
    last_bytes = 0
    last_time = hook_start

    def hook(d):
        nonlocal last_bytes, last_time
        with progress_lock:
            state = d.get('status', '')
            p = download_progress.get(task_id, {})
            if state == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate', 0) or 0
                downloaded = d.get('downloaded_bytes', 0) or 0
                speed = d.get('speed', 0) or 0
                eta = d.get('eta', 0) or 0
                progress_pct = (downloaded / total * 100) if total > 0 else 0

                now = time.time()
                if now - last_time > 1.5:
                    last_time = now
                    last_bytes = downloaded

                p.update({
                    'status': 'downloading',
                    'progress': round(progress_pct, 1),
                    'downloaded': format_bytes(downloaded),
                    'total': format_bytes(total),
                    'downloaded_bytes': downloaded,
                    'total_bytes': total,
                    'speed': format_speed(speed),
                    'eta': format_eta(eta),
                    'speed_raw': speed,
                    'eta_raw': eta,
                    'filename': os.path.basename(d.get('filename', '')),
                })
                download_progress[task_id] = p
            elif state == 'finished':
                p.update({
                    'status': 'processing',
                    'progress': 99,
                    'message': '正在处理合并音视频文件...',
                })
                download_progress[task_id] = p
    return hook

def download_worker(task_id, url, format_spec):
    try:
        platform_key, _ = detect_platform(url)
        if platform_key == 'instagram':
            info = inspect_instagram_with_gallery_dl(url)
        else:
            ffmpeg_bin = find_ffmpeg()
            ydl_info_opts = {
                'quiet': True, 'no_warnings': True,
                'extract_flat': False, 'skip_download': True,
                'cookiefile': COOKIES_FILE if os.path.exists(COOKIES_FILE) else None,
            }
            if ffmpeg_bin:
                ydl_info_opts['ffmpeg_location'] = os.path.dirname(ffmpeg_bin)
            try:
                with yt_dlp.YoutubeDL(ydl_info_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
            except Exception:
                ydl_info_opts['cookiesfrombrowser'] = ('chrome',)
                with yt_dlp.YoutubeDL(ydl_info_opts) as ydl:
                    info = ydl.extract_info(url, download=False)

            platform_key = info.get('extractor_key', 'unknown').lower()
            if platform_key == 'youtube':
                platform_key = 'youtube'
            elif 'bilibili' in platform_key:
                platform_key = 'bilibili'
            elif 'tiktok' in platform_key:
                platform_key = 'tiktok'
            elif 'twitter' in platform_key or platform_key == 'x':
                platform_key = 'twitter'
            elif 'facebook' in platform_key:
                platform_key = 'facebook'
            elif 'reddit' in platform_key:
                platform_key = 'reddit'
            else:
                platform_key = detect_platform(url)[0]

        is_playlist = info.get('_type') == 'playlist' or 'entries' in info

        if is_playlist:
            raw_title = info.get('title', '播放列表') or '播放列表'
            entries = info.get('entries', [])
            valid = [e for e in entries if e and isinstance(e, dict)]
            if valid:
                first = valid[0]
                raw_title = f"{sanitize_folder_name(first.get('title', '播放列表'))[:40]} 等{len(valid)}个视频"
        else:
            raw_title = info.get('title', '未命名') or '未命名'
            uploader = info.get('uploader', info.get('channel', '')) or ''
            if uploader:
                raw_title = f"{uploader} - {raw_title}"

        folder_name = sanitize_folder_name(raw_title)
        platform_dir = ensure_platform_dir(platform_key)
        download_folder = os.path.join(platform_dir, folder_name)

        if os.path.exists(download_folder):
            suffix = 2
            while os.path.exists(f"{download_folder}_{suffix}"):
                suffix += 1
            download_folder = f"{download_folder}_{suffix}"
        os.makedirs(download_folder, exist_ok=True)

        ffmpeg_bin = find_ffmpeg()
        ydl_opts = {
            'outtmpl': os.path.join(download_folder, '%(title)s.%(ext)s'),
            'format': format_spec,
            'merge_output_format': 'mp4',
            'ignoreerrors': True,
            'quiet': True,
            'no_warnings': True,
            'writethumbnail': False,
            'progress_hooks': [make_progress_hook(task_id)],
            'postprocessor_args': {'ffmpeg': ['-movflags', '+faststart']},
            'cookiefile': COOKIES_FILE if os.path.exists(COOKIES_FILE) else None,
            'throttledratelimit': 50000,
            'concurrent_fragments': 5,
            'sleep_interval': 0.5,
            'max_sleep_interval': 1,
            'socket_timeout': 30,
            'extractor_retries': 5,
            'file_access_retries': 5,
            'retry_sleep_functions': {
                'http': lambda n: 1 + 2 ** (n - 1),
            },
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
        }
        if ffmpeg_bin:
            ydl_opts['ffmpeg_location'] = os.path.dirname(ffmpeg_bin)

        if platform_key == 'instagram':
            with progress_lock:
                download_progress[task_id] = {
                    'status': 'downloading',
                    'progress': 10,
                    'message': '正在下载 Instagram 媒体...',
                }
            download_instagram_with_gallery_dl(url, download_folder)
        else:
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
            except Exception:
                ydl_opts['cookiesfrombrowser'] = ('chrome',)
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)

        # Save thumbnail
        thumb_dest = ''
        thumbnail_url = info.get('thumbnail', '') if isinstance(info, dict) else ''
        if thumbnail_url:
            try:
                thumb_ext = 'jpg'
                if '.' in thumbnail_url.split('/')[-1]:
                    thumb_ext = thumbnail_url.split('?')[0].split('.')[-1] or 'jpg'
                thumb_dest = os.path.join(download_folder, f'_cover.{thumb_ext}')
                if not os.path.exists(thumb_dest):
                    import requests as req
                    r = req.get(thumbnail_url, headers={'User-Agent': get_user_agent()}, timeout=10)
                    if r.status_code == 200:
                        with open(thumb_dest, 'wb') as f:
                            f.write(r.content)
            except Exception:
                thumb_dest = ''

        active_dl_dir = get_download_dir()
        files = []
        if os.path.exists(download_folder):
            for f in sorted(os.listdir(download_folder)):
                fpath = os.path.join(download_folder, f)
                if os.path.isfile(fpath):
                    is_thumb = f.startswith('_cover.')
                    files.append({
                        'name': f,
                        'path': normpath(os.path.relpath(fpath, active_dl_dir)),
                        'size': os.path.getsize(fpath),
                        'size_human': format_bytes(os.path.getsize(fpath)),
                        'is_thumbnail': is_thumb,
                    })

        title = sanitize_folder_name(raw_title)
        thumb_rel = normpath(os.path.relpath(thumb_dest, active_dl_dir)) if thumb_dest and os.path.exists(thumb_dest) else ''

        with progress_lock:
            download_progress[task_id] = {
                'status': 'done',
                'progress': 100,
                'message': f'下载完成！共 {len(files)} 个文件',
                'title': title[:200],
                'files': files,
                'folder': normpath(os.path.relpath(download_folder, active_dl_dir)),
                'thumbnail': thumb_rel,
            }
    except Exception as e:
        with progress_lock:
            download_progress[task_id] = {
                'status': 'error',
                'progress': 0,
                'message': f'下载失败: {str(e)}',
            }

# ─── Flask Routes ─────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/preview', methods=['POST'])
def preview():
    try:
        data = request.get_json() or {}
        url = data.get('url', '').strip()
        if not url:
            return jsonify({'status': 'error', 'message': '请输入URL'})

        platform_key, platform_icon = detect_platform(url)
        platform_name = get_platform_display_name(platform_key)

        if platform_key == 'instagram':
            ig_info = inspect_instagram_with_gallery_dl(url)
            return jsonify({
                'status': 'success',
                'platform': 'instagram',
                'platform_name': 'Instagram',
                'platform_icon': '📷',
                'title': ig_info['title'][:200],
                'uploader': ig_info['uploader'][:100],
                'thumbnail': ig_info['thumbnail'],
                'duration': 0,
                'is_playlist': ig_info['media_count'] > 1,
                'playlist_count': ig_info['media_count'],
                'formats': [{
                    'format_id': 'best', 'ext': 'jpg',
                    'quality_label': '最佳质量 (原图)',
                    'type_label': '图片 · jpg',
                    'category': 'combined', 'tag': '🌟 推荐',
                    'height': 0, 'fps': 0, 'filesize': 0, 'tbr': 0,
                    'has_video': False, 'has_audio': False,
                    'vcodec': '', 'acodec': '', 'format_note': '',
                }],
                'url': url,
            })

        info = extract_info(url)
        is_playlist, playlist_count = detect_is_playlist(info)

        if is_playlist:
            entries = info.get('entries', [])
            first_entry = next((e for e in entries if e and isinstance(e, dict)), None)
            if first_entry:
                title = first_entry.get('title', info.get('title', '播放列表'))
                thumbnail = first_entry.get('thumbnail', '')
                uploader = first_entry.get('uploader', info.get('uploader', ''))
                duration = 0
                formats = []
            else:
                title = info.get('title', '播放列表')
                thumbnail = ''
                uploader = ''
                duration = 0
                formats = []
        else:
            title = info.get('title', '未知标题')
            thumbnail = info.get('thumbnail', '')
            uploader = info.get('uploader', info.get('channel', ''))
            duration = info.get('duration', 0)
            formats = extract_formats(info)

        best_formats = []
        if formats:
            best_video = next((f for f in formats if f['has_video'] and f['has_audio']), None)
            if best_video:
                highest_video = max((f for f in formats if f['has_video']), key=lambda x: x['height'], default=None)
                top_quality = highest_video['quality_label'] if highest_video else best_video['quality_label']
                best_formats.append({
                    'format_id': 'bestvideo*+bestaudio/best', 'ext': 'mp4',
                    'quality_label': f'最佳画质 ({top_quality})', 'type_label': '视频+音频 · mp4',
                    'category': 'combined', 'tag': '🌟 推荐',
                    'height': (highest_video or best_video)['height'], 'fps': (highest_video or best_video)['fps'],
                    'filesize': 0, 'tbr': 0, 'has_video': True, 'has_audio': True,
                    'vcodec': '', 'acodec': '', 'format_note': '',
                })
            else:
                best_video_only = next((f for f in formats if f['has_video']), None)
                if best_video_only:
                    best_formats.append({
                        'format_id': 'bestvideo*+bestaudio/best', 'ext': 'mp4',
                        'quality_label': f"最佳画质 ({best_video_only['quality_label']}+音轨)", 'type_label': '视频+音频 · mp4',
                        'category': 'combined', 'tag': '🌟 自动合并音轨',
                        'height': best_video_only['height'], 'fps': best_video_only['fps'],
                        'filesize': 0, 'tbr': 0, 'has_video': True, 'has_audio': True,
                        'vcodec': '', 'acodec': '', 'format_note': '',
                    })
            best_audio = next((f for f in formats if not f['has_video'] and f['has_audio']), None)
            if not best_audio:
                best_audio = next((f for f in formats if f['has_audio']), None)
            if best_audio:
                best_formats.append({
                    'format_id': 'bestaudio/best', 'ext': 'mp3',
                    'quality_label': '最佳音质 (音频)', 'type_label': '音频 · mp3',
                    'category': 'audio_only', 'tag': '🎵 纯音频',
                    'height': 0, 'fps': 0, 'filesize': 0, 'tbr': 0,
                    'has_video': False, 'has_audio': True,
                    'vcodec': '', 'acodec': '', 'format_note': '',
                })
        all_formats = best_formats + formats

        thumbnail_local = ''
        if thumbnail:
            try:
                import requests as req
                ext = 'jpg'
                if '.' in thumbnail.split('/')[-1]:
                    ext = thumbnail.split('?')[0].split('.')[-1] or 'jpg'
                thumb_filename = f"thumb_{abs(hash(url))}.{ext}"
                thumb_path = os.path.join(THUMBNAIL_DIR, thumb_filename)
                if not os.path.exists(thumb_path):
                    r = req.get(thumbnail, headers={'User-Agent': get_user_agent()}, timeout=10)
                    if r.status_code == 200:
                        with open(thumb_path, 'wb') as f:
                            f.write(r.content)
                thumbnail_local = f'/thumbnails/{thumb_filename}'
            except Exception:
                thumbnail_local = thumbnail

        return jsonify({
            'status': 'success', 'platform': platform_key,
            'platform_name': platform_name, 'platform_icon': platform_icon,
            'title': title[:200] if title else '未知标题',
            'uploader': uploader[:100] if uploader else '',
            'thumbnail': thumbnail_local or thumbnail,
            'duration': duration, 'is_playlist': is_playlist,
            'playlist_count': playlist_count,
            'formats': all_formats[:30], 'url': url,
        })
    except Exception as e:
        err_str = str(e)
        is_login = any(k in err_str.lower() for k in ('redirect to login page', 'login', 'private', 'sign in', '401', '403', 'abortextraction', 'cookies'))
        return jsonify({'status': 'error', 'message': f'解析失败: {err_str}', 'login_required': is_login, 'platform': platform_key})


@app.route('/api/open-login', methods=['POST'])
def open_login_endpoint():
    try:
        data = request.get_json() or {}
        platform = data.get('platform', 'instagram')
        script = os.path.join(BASE_DIR, 'login_capture.py')
        res = subprocess.run([sys.executable, script, platform], capture_output=True, text=True, timeout=360)
        if 'SUCCESS_CAPTURED' in res.stdout:
            return jsonify({'status': 'success', 'message': '登录成功，已自动捕获并保存 Cookie！'})
        elif 'ERROR_NO_WEBVIEW' in res.stdout:
            return jsonify({'status': 'error', 'message': '未检测到 webview 组件，请在控制台运行 pip install pywebview'})
        else:
            return jsonify({'status': 'error', 'message': '未完成登录或窗口已关闭'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/download', methods=['POST'])
def download():
    try:
        data = request.get_json() or {}
        url = data.get('url', '').strip()
        format_id = data.get('format_id', 'best')
        has_video = data.get('has_video', True)
        has_audio = data.get('has_audio', False)

        if not url:
            return jsonify({'status': 'error', 'message': '请输入URL'})

        format_spec = select_download_format(format_id, has_video, has_audio)
        task_id = str(uuid.uuid4())

        with progress_lock:
            download_progress[task_id] = {
                'status': 'starting', 'progress': 0,
                'message': '正在启动下载...',
                'downloaded': '0 B', 'total': '--', 'speed': '', 'eta': '',
                'filename': '', 'title': '', 'files': [], 'folder': '',
            }

        thread = threading.Thread(target=download_worker, args=(task_id, url, format_spec))
        thread.daemon = True
        thread.start()

        return jsonify({'status': 'started', 'task_id': task_id, 'format_spec': format_spec})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/progress/<task_id>')
def get_progress(task_id):
    with progress_lock:
        p = download_progress.get(task_id)
        if p is None:
            return jsonify({'status': 'unknown', 'message': '任务未找到'})
        return jsonify(p)

@app.route('/thumbnails/<filename>')
def serve_thumbnail(filename):
    return send_from_directory(THUMBNAIL_DIR, filename)

@app.route('/downloads')
def list_downloads():
    try:
        items = []
        base = get_download_dir()
        if os.path.exists(base):
            for item in sorted(os.listdir(base), reverse=True):
                item_path = os.path.join(base, item)
                if os.path.isfile(item_path):
                    items.append({
                        'name': item, 'type': 'file',
                        'size': os.path.getsize(item_path),
                        'size_human': format_bytes(os.path.getsize(item_path)),
                        'path': item,
                    })
                elif os.path.isdir(item_path):
                    platform_name = item
                    subdirs = [d for d in os.listdir(item_path)
                               if os.path.isdir(os.path.join(item_path, d))]
                    if subdirs:
                        for sub in sorted(subdirs, reverse=True):
                            sub_path = os.path.join(item_path, sub)
                            file_list = []
                            total_size = 0
                            for root, dirs, files in os.walk(sub_path):
                                for f in files:
                                    fp = os.path.join(root, f)
                                    sz = os.path.getsize(fp)
                                    file_list.append({
                                        'name': f,
                                        'rel_path': normpath(os.path.relpath(fp, sub_path)),
                                        'size': sz,
                                        'size_human': format_bytes(sz),
                                        'is_thumbnail': f.startswith('_cover.'),
                                    })
                                    total_size += sz
                            thumb_path = ''
                            for fname in os.listdir(sub_path):
                                if fname.startswith('_cover.'):
                                    thumb_path = normpath(os.path.relpath(os.path.join(sub_path, fname), base))
                                    break
                            rel_path = normpath(os.path.relpath(sub_path, base))
                            items.append({
                                'name': sub,
                                'type': 'folder',
                                'platform': platform_name,
                                'file_count': len(file_list),
                                'total_size': total_size,
                                'size_human': format_bytes(total_size),
                                'files': file_list[:50],
                                'path': rel_path,
                                'thumbnail': thumb_path,
                            })
                    else:
                        file_list = []
                        total_size = 0
                        for root, dirs, files in os.walk(item_path):
                            for f in files:
                                fp = os.path.join(root, f)
                                sz = os.path.getsize(fp)
                                file_list.append({
                                    'name': f,
                                    'rel_path': normpath(os.path.relpath(fp, item_path)),
                                    'size': sz,
                                    'size_human': format_bytes(sz),
                                })
                                total_size += sz
                        items.append({
                            'name': item, 'type': 'folder',
                            'file_count': len(file_list),
                            'total_size': total_size, 'size_human': format_bytes(total_size),
                            'files': file_list[:50], 'path': item,
                        })
        return jsonify({'items': items})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download-file/<path:filepath>')
def download_file(filepath):
    try:
        base = get_download_dir()
        full_path = os.path.normpath(os.path.join(base, filepath))
        if not full_path.startswith(os.path.normpath(base)):
            return jsonify({'error': '访问被拒绝'}), 403
        if os.path.exists(full_path):
            name = os.path.basename(filepath)
            is_image = name.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'))
            return send_file(full_path, as_attachment=not is_image)
        return jsonify({'error': '文件不存在'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download-folder/<path:foldername>')
def download_folder(foldername):
    try:
        base = get_download_dir()
        folder_path = os.path.normpath(os.path.join(base, foldername))
        if not folder_path.startswith(os.path.normpath(base)):
            return jsonify({'error': '访问被拒绝'}), 403
        if os.path.exists(folder_path) and os.path.isdir(folder_path):
            temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
            temp_zip.close()
            with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(folder_path):
                    for file in files:
                        full = os.path.join(root, file)
                        rel = os.path.relpath(full, folder_path)
                        zipf.write(full, rel)
            return send_file(temp_zip.name, as_attachment=True, download_name=f"{os.path.basename(folder_path)}.zip")
        return jsonify({'error': '文件夹不存在'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/delete-file', methods=['POST'])
def delete_file():
    try:
        data = request.get_json() or {}
        item_path = data.get('path', '')
        if not item_path:
            return jsonify({'status': 'error', 'message': '缺少路径参数'})
        base = get_download_dir()
        full_path = os.path.normpath(os.path.join(base, item_path))
        if not full_path.startswith(os.path.normpath(base)):
            return jsonify({'status': 'error', 'message': '路径不合法'})
        if os.path.isdir(full_path):
            shutil.rmtree(full_path)
            return jsonify({'status': 'success', 'message': '文件夹已删除'})
        elif os.path.isfile(full_path):
            os.remove(full_path)
            return jsonify({'status': 'success', 'message': '文件已删除'})
        return jsonify({'status': 'error', 'message': '文件不存在'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/clear-downloads', methods=['POST'])
def clear_downloads():
    try:
        base = get_download_dir()
        if os.path.exists(base):
            for item in os.listdir(base):
                item_path = os.path.join(base, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                elif os.path.isfile(item_path):
                    os.remove(item_path)
        return jsonify({'status': 'success', 'message': '已清空下载目录'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/download-path', methods=['GET', 'POST'])
def download_path_endpoint():
    if request.method == 'GET':
        return jsonify({
            'path': get_download_dir(),
            'default': DOWNLOAD_DIR,
        })
    data = request.get_json() or {}
    new_path = data.get('path', '').strip()
    cfg = load_config()
    if not new_path:
        cfg.pop('download_path', None)
        save_config(cfg)
        return jsonify({'status': 'success', 'path': DOWNLOAD_DIR})
    if os.path.isdir(new_path) or not os.path.exists(new_path):
        os.makedirs(new_path, exist_ok=True)
        cfg['download_path'] = new_path
        save_config(cfg)
        return jsonify({'status': 'success', 'path': new_path})
    return jsonify({'status': 'error', 'message': '无效的目录路径'})

@app.route('/cookies', methods=['GET', 'POST'])
def cookies_endpoint():
    if request.method == 'GET':
        exists = os.path.exists(COOKIES_FILE)
        size = os.path.getsize(COOKIES_FILE) if exists else 0
        domains = []
        if exists:
            try:
                with open(COOKIES_FILE, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    if 'bilibili.com' in content: domains.append('B站 (已解锁4K/1080P60)')
                    if 'instagram.com' in content: domains.append('Instagram')
                    if 'youtube.com' in content or 'google.com' in content: domains.append('YouTube')
                    if 'twitter.com' in content or 'x.com' in content: domains.append('Twitter/X')
                    if 'douyin.com' in content: domains.append('抖音')
                    if 'xiaohongshu.com' in content: domains.append('小红书')
            except Exception:
                pass
        return jsonify({
            'exists': exists,
            'size': size,
            'size_human': format_bytes(size),
            'domains': domains,
        })
    data = request.get_json() or {}
    action = data.get('action')
    if action == 'upload':
        content = data.get('content', '')
        with open(COOKIES_FILE, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({'status': 'success', 'message': 'Cookies 已保存'})
    elif action == 'delete':
        if os.path.exists(COOKIES_FILE):
            os.remove(COOKIES_FILE)
        return jsonify({'status': 'success', 'message': '已清除所有平台的 Cookie'})
    return jsonify({'status': 'error', 'message': '未知操作'})

@app.route('/instagram-login', methods=['POST'])
def instagram_login():
    try:
        data = request.get_json() or {}
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        if not username or not password:
            return jsonify({'status': 'error', 'message': '请输入用户名和密码'})

        import instaloader
        L = instaloader.Instaloader()
        try:
            L.login(username, password)
            L.save_session_to_file(os.path.join(BASE_DIR, 'instagram_session'))
            cfg = load_config()
            cfg['instagram_user'] = username
            cfg['instagram_pass'] = password
            save_config(cfg)
            return jsonify({'status': 'success', 'message': f'✅ Instagram 登录成功！已保存 {username} 的会话'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'登录失败: {str(e)[:100]}'})
    except ImportError:
        return jsonify({'status': 'error', 'message': 'instaloader 未安装'})

@app.route('/instagram-status', methods=['GET'])
def instagram_status():
    session_file = os.path.join(BASE_DIR, 'instagram_session')
    cfg = load_config()
    user = cfg.get('instagram_user', '')
    return jsonify({
        'logged_in': os.path.exists(session_file),
        'user': user,
    })

# ─── Tools & Auto Update API ──────────────────────────────────────────
@app.route('/api/tools/version', methods=['GET'])
def tools_version():
    cfg = load_config()
    return jsonify({
        'status': 'success',
        'versions': get_tools_versions(),
        'update_status': tool_update_status,
        'auto_update': cfg.get('auto_update_tools', True),
    })

@app.route('/api/tools/update', methods=['POST'])
def tools_update():
    threading.Thread(target=update_tools_task, daemon=True).start()
    return jsonify({'status': 'started', 'message': '已启动下载核心工具更新任务'})

@app.route('/api/tools/update_status', methods=['GET'])
def tools_update_status_endpoint():
    return jsonify({
        'status': 'success',
        'update_status': tool_update_status,
        'versions': get_tools_versions(),
    })

@app.route('/api/tools/auto_update', methods=['POST'])
def toggle_auto_update():
    data = request.get_json() or {}
    enabled = bool(data.get('enabled', True))
    cfg = load_config()
    cfg['auto_update_tools'] = enabled
    save_config(cfg)
    return jsonify({'status': 'success', 'auto_update': enabled})

# ─── Main ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("  Universal Media Downloader (DeepSeek Edition)")
    print("=" * 60)
    print("  Supported platforms: YouTube, Bilibili, Instagram, TikTok, Twitter/X, etc.")
    print("  Features: Preview, Quality Select, Progress Tracking, Auto-update")
    print("=" * 60)
    print("  Local URL: http://localhost:5000")
    print("=" * 60)
    print("  Press Ctrl+C to stop server.")
    print()

    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        print(f"  LAN URL: http://{local_ip}:5000")
        print()
    except Exception:
        pass

    # Automatically open browser in 1 second
    def open_browser():
        time.sleep(1.0)
        try:
            webbrowser.open("http://localhost:5000")
        except Exception:
            pass
    threading.Thread(target=open_browser, daemon=True).start()

    # Start background auto-updater check
    trigger_background_update(delay=3)

    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)
