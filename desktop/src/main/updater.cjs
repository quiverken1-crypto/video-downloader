'use strict';

const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { paths, toolPath, toolInvocation, findPython } = require('./paths.cjs');

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 60000;
    const child = spawn(command, args, { windowsHide: true, shell: false, ...options });
    let stdout = '';
    let stderr = '';
    let timer = null;

    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`命令执行超时 (${Math.round(timeout / 1000)}s): ${command}`));
      }, timeout);
    }

    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      options.onLog?.(text);
    });
    child.stderr?.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      options.onLog?.(text);
    });

    child.once('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.once('close', code => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || stdout.trim() || `进程退出码: ${code}`));
    });
  });
}

async function getToolVersions(options = {}) {
  const python = findPython(options);
  const result = {
    ytDlp: '未检测到',
    galleryDl: '未检测到',
    ffmpeg: '未检测到',
    python: python ? '已配置' : '未检测到',
    pythonPath: python || '',
  };

  // 1. Check Python yt_dlp and gallery_dl
  if (python && fs.existsSync(python)) {
    try {
      const checkCode = 'import sys, yt_dlp, yt_dlp.version, gallery_dl; print(f"{yt_dlp.version.__version__}|{gallery_dl.__version__}|{sys.version.split()[0]}")';
      const out = await runCommand(python, ['-c', checkCode], { timeout: 8000 });
      const parts = out.stdout.split('|');
      if (parts.length >= 3) {
        result.ytDlp = parts[0];
        result.galleryDl = parts[1];
        result.python = parts[2];
      }
    } catch {}
  }

  // 2. Fallback to bundled executables if not resolved
  if (result.ytDlp === '未检测到') {
    const ytExe = toolPath('yt-dlp', options);
    if (ytExe && fs.existsSync(ytExe)) {
      try {
        const out = await runCommand(ytExe, ['--version'], { timeout: 8000 });
        result.ytDlp = out.stdout.trim();
      } catch {}
    }
  }

  if (result.galleryDl === '未检测到') {
    const gExe = toolPath('gallery-dl', options);
    if (gExe && fs.existsSync(gExe)) {
      try {
        const out = await runCommand(gExe, ['--version'], { timeout: 8000 });
        result.galleryDl = out.stdout.trim();
      } catch {}
    }
  }

  // 3. Check FFmpeg
  const ffmpegExe = toolPath('ffmpeg', options) || 'ffmpeg';
  try {
    const out = await runCommand(ffmpegExe, ['-version'], { timeout: 6000 });
    const match = out.stdout.match(/ffmpeg version\s+([^\s]+)/i);
    result.ffmpeg = match ? match[1] : '已启用';
  } catch {}

  return result;
}

let isUpdating = false;
let updateLogs = [];
let lastStatus = '未开始';
let lastCheckTime = '';

async function updateTools({ proxy = '', onProgress = () => {} } = {}) {
  if (isUpdating) return { ok: false, message: '更新任务正在进行中' };
  isUpdating = true;
  updateLogs = [];
  lastStatus = '正在更新下载核心...';

  const log = (msg) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    updateLogs.push(entry);
    lastStatus = msg;
    onProgress({ log: entry, status: msg, updating: true });
  };

  try {
    log('开始检查并更新下载核心组件...');
    const python = findPython();
    let updatedViaPip = false;

    // 1. Try updating python modules via domestic Tsinghua/Aliyun mirror
    if (python && fs.existsSync(python)) {
      const mirrors = [
        'https://pypi.tuna.tsinghua.edu.cn/simple',
        'https://mirrors.aliyun.com/pypi/simple/',
        'https://pypi.org/simple',
      ];
      for (const mirror of mirrors) {
        try {
          log(`正在通过镜像源更新 (${mirror.split('/')[2]})...`);
          const res = await runCommand(
            python,
            ['-m', 'pip', 'install', '-U', 'yt-dlp', 'gallery-dl', '-i', mirror],
            { timeout: 120000, onLog: (data) => log(data.trim()) }
          );
          log('✅ yt-dlp 与 gallery-dl 核心更新成功！');
          updatedViaPip = true;
          break;
        } catch (err) {
          log(`镜像源提示: ${err.message.slice(0, 100)}`);
        }
      }
    }

    // 2. Also try updating bundled .exe if present
    const ytExe = toolPath('yt-dlp');
    if (ytExe && fs.existsSync(ytExe)) {
      try {
        log('正在检查独立版 yt-dlp.exe 更新...');
        const ytArgs = proxy ? ['--proxy', proxy, '-U'] : ['-U'];
        await runCommand(ytExe, ytArgs, { timeout: 30000, onLog: (data) => log(data.trim()) });
        log('yt-dlp.exe 检查更新完毕');
      } catch (err) {
        log(`yt-dlp.exe 更新提示: ${err.message.slice(0, 80)}`);
      }
    }

    const gExe = toolPath('gallery-dl');
    if (gExe && fs.existsSync(gExe)) {
      try {
        log('正在检查独立版 gallery-dl.exe 更新...');
        const gArgs = proxy ? ['--proxy', proxy, '-U'] : ['-U'];
        await runCommand(gExe, gArgs, { timeout: 30000, onLog: (data) => log(data.trim()) });
        log('gallery-dl.exe 检查更新完毕');
      } catch (err) {
        log(`gallery-dl.exe 更新提示: ${err.message.slice(0, 80)}`);
      }
    }

    const versions = await getToolVersions();
    lastCheckTime = new Date().toLocaleString();
    lastStatus = '下载核心已是最新版本';
    log(`更新完成！当前版本: yt-dlp=${versions.ytDlp}, gallery-dl=${versions.galleryDl}`);

    return { ok: true, versions, logs: updateLogs };
  } catch (error) {
    lastStatus = `更新出错: ${error.message}`;
    log(`❌ 更新失败: ${error.message}`);
    return { ok: false, error: error.message, logs: updateLogs };
  } finally {
    isUpdating = false;
    onProgress({ status: lastStatus, updating: false, finished: true });
  }
}

function getUpdateState() {
  return {
    updating: isUpdating,
    lastStatus,
    lastCheckTime,
    logs: updateLogs,
  };
}

module.exports = { getToolVersions, updateTools, getUpdateState };
