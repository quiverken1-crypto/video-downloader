'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { paths, toolPath, toolInvocation } = require('./paths.cjs');

function parseUrl(value) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('链接格式不正确');
  return url;
}

function platformFromUrl(value) {
  const host = parseUrl(value).hostname.toLowerCase().replace(/^www\./, '');
  const matches = domain => host === domain || host.endsWith(`.${domain}`);
  if (matches('youtube.com') || host === 'youtu.be') return 'youtube';
  if (matches('bilibili.com') || host === 'b23.tv') return 'bilibili';
  if (matches('instagram.com')) return 'instagram';
  if (matches('tiktok.com')) return 'tiktok';
  if (matches('twitter.com') || host === 'x.com' || host.endsWith('.x.com')) return 'twitter';
  if (matches('facebook.com') || host === 'fb.watch') return 'facebook';
  if (matches('reddit.com') || host === 'redd.it') return 'reddit';
  if (matches('vimeo.com')) return 'vimeo';
  if (matches('twitch.tv')) return 'twitch';
  if (matches('dailymotion.com') || host === 'dai.ly') return 'dailymotion';
  if (matches('pinterest.com') || host === 'pin.it') return 'pinterest';
  if (matches('douyin.com')) return 'douyin';
  if (matches('xiaohongshu.com') || host === 'xhslink.com') return 'xiaohongshu';
  if (matches('weibo.com')) return 'weibo';
  return 'other';
}

function cleanUrl(value) {
  const url = parseUrl(value);
  const platform = platformFromUrl(url.href);
  if (platform === 'instagram') {
    url.search = '';
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
  }
  return url.href;
}

function instagramShortcode(value) {
  const url = parseUrl(value);
  const match = url.pathname.match(/^\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function safeName(value, fallback = '未命名') {
  const trimmed = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\.+$/g, '');
  return trimmed.slice(0, 120) || fallback;
}

function normalizeThumbnailUrl(value, platform = '') {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source);
    if (platform === 'bilibili' && parsed.protocol === 'http:' &&
        (parsed.hostname === 'hdslb.com' || parsed.hostname.endsWith('.hdslb.com'))) {
      parsed.protocol = 'https:';
      return parsed.href;
    }
  } catch {
    return source;
  }
  return source;
}

function outputDirectory(url, root = paths.downloadRoot) {
  const platform = platformFromUrl(url);
  const folderNames = {
    youtube: 'YouTube', bilibili: 'Bilibili', tiktok: 'TikTok',
    twitter: 'Twitter-X', facebook: 'Facebook', reddit: 'Reddit',
    vimeo: 'Vimeo', twitch: 'Twitch', dailymotion: 'Dailymotion',
    pinterest: 'Pinterest', douyin: 'Douyin', xiaohongshu: 'Xiaohongshu',
    weibo: 'Weibo', other: 'Other',
  };
  if (platform !== 'instagram') return path.join(root, folderNames[platform] || 'Other');
  return path.join(root, 'Instagram', '%(author)s', instagramShortcode(url) || '%(shortcode)s');
}

function cookieArgs(cookieFile = paths.cookieFile) {
  return cookieFile && fs.existsSync(cookieFile) ? ['--cookies', cookieFile] : [];
}

function engineOrder(platform) {
  if (platform === 'instagram') return ['gallery-dl'];
  if (['youtube', 'bilibili', 'vimeo', 'twitch', 'dailymotion'].includes(platform)) return ['yt-dlp'];
  return ['gallery-dl', 'yt-dlp'];
}

function normalizeExtractorRedirect(value) {
  const url = parseUrl(value);
  if (/(^|\.)pinterest\.[a-z.]+$/i.test(url.hostname)) {
    const pin = url.pathname.match(/\/pin\/(\d+)(?:\/|$)/i);
    if (pin) return `https://www.pinterest.com/pin/${pin[1]}/`;
  }
  return cleanUrl(url.href);
}

function buildDownloadCommand(task, options = {}) {
  const platform = task.platform || platformFromUrl(task.url);
  const proxy = task.proxy || options.proxy || '';
  const cookies = options.cookieFile || paths.cookieFile;
  if (platform === 'instagram' || task.engine === 'gallery-dl') {
    // gallery-dl's -D is an exact directory.  The author comes from the
    // preview metadata, and the shortcode keeps every post in its own folder.
    const postId = instagramShortcode(task.url) ||
      parseUrl(task.url).pathname.split('/').filter(Boolean).at(-1) || '媒体';
    const output = platform === 'instagram'
      ? path.join(options.downloadRoot || paths.downloadRoot, 'Instagram', safeName(task.author || '未知账号'), postId)
      : path.join(outputDirectory(task.url, options.downloadRoot), safeName(task.author || task.title || '媒体'), safeName(postId));
    const invocation = options.galleryDlPath
      ? { command: options.galleryDlPath, argsPrefix: [] }
      : toolInvocation('gallery-dl', options);
    const args = [...invocation.argsPrefix, '--directory', output, '--filename', '{num:>02}.{extension}', '--write-metadata', '--windows-filenames'];
    if (cookies && fs.existsSync(cookies)) args.push('--cookies', cookies);
    if (proxy) args.push('--proxy', proxy);
    args.push(task.url);
    return { command: invocation.command, args, cwd: options.downloadRoot || paths.downloadRoot, output };
  }
  const output = outputDirectory(task.url, options.downloadRoot);
  const format = task.mode === 'audio' ? 'ba/b' : (task.format || 'bv*+ba/b');
  const invocation = options.ytDlpPath
    ? { command: options.ytDlpPath, argsPrefix: [] }
    : toolInvocation('yt-dlp', options);
  const ffmpegExe = toolPath('ffmpeg', options);
  const args = [
    ...invocation.argsPrefix,
    '--newline', '--no-playlist',
    '--concurrent-fragments', '8',
    '--socket-timeout', '20',
    '--retries', '3',
    '--fragment-retries', '3',
    '-f', format,
    '-o', path.join(output, '%(title).160B [%(id)s].%(ext)s'),
  ];
  if (ffmpegExe && fs.existsSync(ffmpegExe)) {
    args.push('--ffmpeg-location', path.dirname(ffmpegExe));
  }
  if (task.mode === 'audio') args.push('--extract-audio', '--audio-format', 'mp3');
  if (task.subtitle) args.push('--write-subs', '--write-auto-subs');
  if (task.thumbnailDownload) args.push('--write-thumbnail');
  if (task.description) args.push('--write-description');
  if (cookies && fs.existsSync(cookies)) args.push('--cookies', cookies);
  if (proxy) args.push('--proxy', proxy);
  args.push(task.url);
  return { command: invocation.command, args, cwd: options.downloadRoot || paths.downloadRoot, output };
}

function inspectMedia(value, options = {}) {
  let url = cleanUrl(value);
  const platform = platformFromUrl(url);
  const spawnImpl = options.spawnImpl || spawn;

  const run = (engine) => new Promise((resolve, reject) => {
    const invocation = engine === 'gallery-dl'
      ? (options.galleryDlPath ? { command: options.galleryDlPath, argsPrefix: [] } : toolInvocation('gallery-dl', options))
      : (options.ytDlpPath ? { command: options.ytDlpPath, argsPrefix: [] } : toolInvocation('yt-dlp', options));
    const args = engine === 'gallery-dl'
      ? [...invocation.argsPrefix, '--dump-json', '--no-input']
      : [...invocation.argsPrefix, '--dump-single-json', '--no-playlist'];
    const ffmpegExe = toolPath('ffmpeg', options);
    if (engine === 'yt-dlp' && ffmpegExe && fs.existsSync(ffmpegExe)) {
      args.push('--ffmpeg-location', path.dirname(ffmpegExe));
    }
    args.push(
      ...cookieArgs(options.cookieFile || paths.cookieFile),
      ...(options.proxy ? ['--proxy', options.proxy] : []),
      url,
    );
    const child = spawnImpl(invocation.command, args, { windowsHide: true, shell: false });
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error(stderr.trim() || `${engine} 读取媒体信息失败（${code}）`));
      else resolve(stdout);
    });
  });

  return (async () => {
    const errors = [];
    for (const engine of engineOrder(platform)) {
      try {
        let parsed = JSON.parse((await run(engine)).trim());
        let records = engine === 'gallery-dl'
          ? (Array.isArray(parsed) ? parsed : []).flatMap(item => {
              if (item && !Array.isArray(item) && typeof item === 'object') return [item];
              if (!Array.isArray(item) || item[0] !== 3 || typeof item[2] !== 'object') return [];
              return [{ ...item[2], url: typeof item[1] === 'string' ? item[1] : item[2].url }];
            })
          : [parsed];
        if (engine === 'gallery-dl' && !records.length && Array.isArray(parsed)) {
          const redirect = parsed.find(item => Array.isArray(item) && item[0] === 6 && typeof item[1] === 'string');
          const target = redirect ? normalizeExtractorRedirect(redirect[1]) : '';
          if (target && target !== url) {
            url = target;
            parsed = JSON.parse((await run(engine)).trim());
            records = (Array.isArray(parsed) ? parsed : []).flatMap(item => {
              if (item && !Array.isArray(item) && typeof item === 'object') return [item];
              if (!Array.isArray(item) || item[0] !== 3 || typeof item[2] !== 'object') return [];
              return [{ ...item[2], url: typeof item[1] === 'string' ? item[1] : item[2].url }];
            });
          }
        }
        const json = records[0];
        if (!json) throw new Error('没有找到媒体内容');
        return {
          url, platform, engine,
          title: json.title || json.description || json.id || json.post_id || '未命名内容',
          thumbnail: normalizeThumbnailUrl(
            json.thumbnail || json.cover_url || json.display_url || json.url || '',
            platform,
          ),
          author: json.uploader || json.owner_username || json.username || json.author || '',
          duration: Number(json.duration || 0),
          mediaCount: engine === 'gallery-dl' ? records.length : Number(json.playlist_count || json.count || 1),
        };
      } catch (error) {
        errors.push(`${engine}: ${error.message}`);
      }
    }
    throw new Error(errors.join('\n') || '媒体信息解析失败');
  })();
}

function enumerateInstagramResults(url, root = paths.downloadRoot) {
  const shortcode = instagramShortcode(url);
  if (!shortcode) return [];
  const home = path.join(root, 'Instagram');
  if (!fs.existsSync(home)) return [];
  const result = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full);
      else if (full.toLowerCase().includes(shortcode.toLowerCase()) || full.split(path.sep).includes(shortcode)) result.push(full);
    }
  };
  visit(home);
  return result.sort();
}

function enumerateOutputFiles(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const result = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) visit(full);
      else result.push(full);
    }
  };
  visit(directory);
  return result.sort();
}

module.exports = { parseUrl, platformFromUrl, cleanUrl, instagramShortcode, safeName, normalizeThumbnailUrl, normalizeExtractorRedirect, outputDirectory, engineOrder, buildDownloadCommand, inspectMedia, enumerateInstagramResults, enumerateOutputFiles };
