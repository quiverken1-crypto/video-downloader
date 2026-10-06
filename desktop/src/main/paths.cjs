'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Keep media outside the application bundle so updating the app never touches a
// user's cookies or completed downloads.  The environment overrides are also
// useful for portable installs and automated tests.
const desktop = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, 'Desktop')
  : path.resolve(process.cwd(), 'Desktop');
// Default to the user's real desktop (Windows may redirect it, e.g. to D:\桌面).
function realDesktop() {
  try { return require('electron').app.getPath('desktop'); } catch { return desktop; }
}
const dataRoot = process.env.VIDEO_DOWNLOADER_HOME || path.join(realDesktop(), '视频下载器');

const paths = Object.freeze({
  dataRoot,
  downloadRoot: path.join(dataRoot, '下载内容'),
  cookieRoot: path.join(dataRoot, 'Cookie'),
  cookieFile: path.join(dataRoot, 'Cookie', 'cookies.txt'),
  taskStore: path.join(dataRoot, 'tasks.json'),
  desktop,
});

function ensureDataDirectories(custom = paths) {
  for (const dir of [custom.dataRoot, custom.downloadRoot, custom.cookieRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return custom;
}

function toolPath(name, options = {}) {
  const root = options.resourcesPath || process.resourcesPath || process.cwd();
  const executable = process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name;
  const candidates = [
    path.join(root, 'tools', executable),
    path.resolve(__dirname, '../../resources/tools', executable),
    path.join(root, executable),
    executable,
  ];
  return candidates.find(candidate => candidate === executable || fs.existsSync(candidate));
}

function findPython(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  if (options.pythonPath && existsSync(options.pythonPath)) return options.pythonPath;
  if (process.env.PLATFORM_DOWNLOADER_PYTHON && existsSync(process.env.PLATFORM_DOWNLOADER_PYTHON)) {
    return process.env.PLATFORM_DOWNLOADER_PYTHON;
  }
  const userProfile = process.env.USERPROFILE || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(userProfile, 'anaconda3', 'python.exe'),
    'C:\\ProgramData\\anaconda3\\python.exe',
  ];
  if (localAppData) {
    const pyDir = path.join(localAppData, 'Programs', 'Python');
    if (existsSync(pyDir)) {
      try {
        for (const item of fs.readdirSync(pyDir)) {
          candidates.push(path.join(pyDir, item, 'python.exe'));
        }
      } catch {}
    }
  }
  for (const cand of candidates) {
    if (cand && existsSync(cand)) return cand;
  }
  return '';
}

function toolInvocation(name, options = {}) {
  const moduleName = { 'yt-dlp': 'yt_dlp', 'gallery-dl': 'gallery_dl' }[name];
  const existsSync = options.existsSync || fs.existsSync;
  const python = findPython(options);
  const moduleDirectory = python && moduleName
    ? path.join(path.dirname(python), 'Lib', 'site-packages', moduleName)
    : '';

  // The bundled tools are large self-extracting executables. On Windows their
  // cold start is much slower than an already-installed Python module.
  if (moduleName && python && existsSync(python) &&
      (options.pythonPath || existsSync(moduleDirectory))) {
    return { command: python, argsPrefix: ['-m', moduleName], source: 'python-module' };
  }
  return { command: toolPath(name, options), argsPrefix: [], source: 'bundled-executable' };
}

module.exports = { paths, ensureDataDirectories, toolPath, toolInvocation, findPython };
