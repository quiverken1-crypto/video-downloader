"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell, session, net, dialog } = require("electron");
const { TaskManager } = require("./task-manager.cjs");
const { ProxyRouter } = require("./proxy.cjs");
const { inspectMedia, cleanUrl, platformFromUrl } = require("./media.cjs");
const { createApiServer } = require("./api-server.cjs");
const { ensureDataDirectories, paths } = require("./paths.cjs");
const { getToolVersions, updateTools, getUpdateState } = require("./updater.cjs");
const { openLoginCaptureWindow, PLATFORM_LOGIN_CONFIGS } = require("./cookie-capture.cjs");

const settingsFile = path.join(paths.dataRoot, "electron-settings.json");
const defaults = Object.freeze({
  mode: "video",
  quality: "best",
  proxy_mode: "auto",
  manual_proxy: "",
  subtitles: false,
  cover: false,
  auto_update_tools: true,
  download_dir: "",
});
const platformTargets = Object.freeze({
  youtube: "https://www.youtube.com/generate_204",
  bilibili: "https://www.bilibili.com/favicon.ico",
  instagram: "https://www.instagram.com/favicon.ico",
});

let mainWindow = null;
let manager = null;
let router = null;
let apiServer = null;
let settings = { ...defaults };
const previewCache = new Map();
const previewCacheTtl = 5 * 60 * 1000;

function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
  } catch {
    return { ...defaults };
  }
}

function saveSettings(next) {
  settings = { ...settings, ...next };
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  const temporary = `${settingsFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(temporary, settingsFile);
  if (manager) {
    manager.setDownloadRoot(getEffectiveDownloadRoot());
  }
  return { ...settings };
}

function getEffectiveDownloadRoot() {
  const custom = String(settings.download_dir || "").trim();
  if (custom) {
    try {
      fs.mkdirSync(custom, { recursive: true });
      return custom;
    } catch {}
  }
  return paths.downloadRoot;
}

async function applyProxySettings() {
  previewCache.clear();
  const mode = settings.proxy_mode;
  if (mode === "direct") {
    router.setManualProxy("");
    await session.defaultSession.setProxy({ mode: "direct" });
  } else if (mode === "manual" && settings.manual_proxy) {
    router.setManualProxy(settings.manual_proxy);
    await session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: settings.manual_proxy });
  } else {
    router.setManualProxy("");
    await session.defaultSession.setProxy({ mode: "system" });
  }
  await session.defaultSession.closeAllConnections();
}

function trusted(event) {
  const source = event.senderFrame?.url || "";
  if (!source.startsWith("file://")) throw new Error("来源校验失败");
}

async function routeFor(url) {
  if (settings.proxy_mode === "direct") return { proxy: "", source: "direct", display: "直连" };
  return router.resolve(url);
}

function isLoginRequiredError(errMsg) {
  const msg = String(errMsg || "").toLowerCase();
  return (
    msg.includes("redirect to login page") ||
    msg.includes("login") ||
    msg.includes("sign in") ||
    msg.includes("private") ||
    msg.includes("abortextraction") ||
    msg.includes("401") ||
    msg.includes("403")
  );
}

async function inspect(url) {
  const normalized = cleanUrl(url);
  const cached = previewCache.get(normalized);
  if (cached && Date.now() - cached.savedAt < previewCacheTtl) return { ...cached.value, cached: true };

  const started = Date.now();
  const route = await routeFor(normalized);
  try {
    const preview = await inspectMedia(normalized, { proxy: route.proxy, cookieFile: paths.cookieFile });
    previewCache.set(normalized, { value: preview, savedAt: Date.now() });
    if (previewCache.size > 64) previewCache.delete(previewCache.keys().next().value);
    mainWindow?.webContents.send("downloader:network", {
      routes: {
        [preview.platform]: {
          platform: preview.platform,
          ok: true,
          available: true,
          latency: Date.now() - started,
          route: route.display,
          source: route.source,
        },
      },
      checkedAt: Date.now(),
    });
    return preview;
  } catch (err) {
    const platform = platformFromUrl(normalized);
    if (isLoginRequiredError(err.message)) {
      const customErr = new Error(err.message);
      customErr.loginRequired = true;
      customErr.platform = platform;
      throw customErr;
    }
    throw err;
  }
}

function qualityFormat(mode, quality) {
  if (mode === "audio") return "ba/b";
  if (!quality || quality === "best") {
    // Select highest video stream + highest audio stream, fallback to best
    return "bestvideo+bestaudio/bestvideo*+bestaudio/best";
  }
  const height = Number(quality);
  if (Number.isFinite(height) && height > 0) {
    return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
  }
  return "bestvideo+bestaudio/best";
}

async function addTask(input) {
  const route = await routeFor(input.url);
  const downloadRoot = getEffectiveDownloadRoot();
  return manager.add({
    url: input.url,
    title: input.title || "",
    thumbnail: input.thumbnail || "",
    author: input.author || "",
    engine: input.engine || "",
    mode: input.mode || settings.mode,
    quality: input.quality || settings.quality,
    format: qualityFormat(input.mode || settings.mode, input.quality || settings.quality),
    subtitle: input.subtitles ?? settings.subtitles,
    thumbnailDownload: input.cover ?? settings.cover,
    description: Boolean(input.description),
    proxy: route.proxy,
    downloadRoot: downloadRoot,
  });
}

async function probeOne(platform, url) {
  const route = await router.resolve(url, { force: true });
  const started = Date.now();
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(3500) });
    return { platform, ok: response.status < 500, available: response.status < 500, latency: Date.now() - started, route: route.display, source: route.source };
  } catch (error) {
    return { platform, ok: false, available: false, latency: null, route: route.display, source: route.source, error: error.message };
  }
}

async function refreshNetwork() {
  const entries = await Promise.all(Object.entries(platformTargets).map(([name, url]) => probeOne(name, url)));
  const payload = { routes: Object.fromEntries(entries.map(item => [item.platform, item])), checkedAt: Date.now() };
  mainWindow?.webContents.send("downloader:network", payload);
  return payload;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 580,
    backgroundColor: "#0B0F14",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.on("closed", () => { mainWindow = null; });
}

function registerIpc() {
  const handle = (channel, callback) => ipcMain.handle(channel, async (event, payload = {}) => {
    trusted(event);
    return callback(payload);
  });
  handle("downloader:inspect", ({ url }) => inspect(url));
  handle("downloader:add-task", input => addTask(input));
  handle("downloader:stop-task", ({ taskId }) => manager.stop(taskId));
  handle("downloader:stop-all", () => manager.stopAll());
  handle("downloader:open-output", async () => {
    ensureDataDirectories();
    const root = getEffectiveDownloadRoot();
    fs.mkdirSync(root, { recursive: true });
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
    return { ok: true };
  });
  handle("downloader:open-cookie-dir", async () => {
    ensureDataDirectories();
    const error = await shell.openPath(paths.cookieRoot);
    if (error) throw new Error(error);
    return { ok: true };
  });
  handle("downloader:capture-login", async ({ platform = "bilibili" }) => {
    return openLoginCaptureWindow(platform, mainWindow);
  });
  handle("downloader:select-directory", async () => {
    const currentRoot = getEffectiveDownloadRoot();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择下载保存文件夹",
      defaultPath: currentRoot,
      properties: ["openDirectory", "createDirectory", "promptToCreate"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { canceled: false, path: result.filePaths[0] };
    }
    return { canceled: true };
  });
  handle("downloader:get-download-dir", () => ({
    path: getEffectiveDownloadRoot(),
    default: paths.downloadRoot,
    custom: settings.download_dir || "",
  }));
  handle("downloader:get-state", () => ({
    tasks: manager.list(),
    settings,
    network: {},
    downloadDir: getEffectiveDownloadRoot(),
    defaultDownloadDir: paths.downloadRoot,
  }));
  handle("downloader:refresh-network", () => refreshNetwork());
  handle("downloader:update-settings", async next => {
    const allowed = Object.fromEntries(Object.entries(next || {}).filter(([key]) => key in defaults));
    if (allowed.proxy_mode === "manual" && !String(allowed.manual_proxy || settings.manual_proxy).trim()) throw new Error("请填写手动代理地址");
    saveSettings(allowed);
    await applyProxySettings();
    return { ...settings, downloadDir: getEffectiveDownloadRoot() };
  });
  handle("downloader:get-tool-versions", () => getToolVersions());
  handle("downloader:get-update-state", () => getUpdateState());
  handle("downloader:update-tools", async () => {
    const route = await routeFor("https://github.com");
    return updateTools({
      proxy: route.proxy,
      onProgress: (p) => mainWindow?.webContents.send("downloader:tool-update-progress", p)
    });
  });
}

async function bootstrap() {
  ensureDataDirectories();
  settings = loadSettings();
  router = new ProxyRouter({ session: session.defaultSession, manualProxy: settings.proxy_mode === "manual" ? settings.manual_proxy : "" });
  await applyProxySettings();
  manager = new TaskManager({ maxConcurrent: 3, downloadRoot: getEffectiveDownloadRoot() });
  manager.on("task-updated", task => mainWindow?.webContents.send("downloader:task", task));
  registerIpc();
  try {
    apiServer = await createApiServer({
      manager,
      router,
      inspect,
      addTask,
      getToolVersions,
      updateTools,
      getUpdateState,
      getEffectiveDownloadRoot,
      setDownloadDir: (dir) => saveSettings({ download_dir: dir }),
    });
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }
  createWindow();

  // Background auto-update check if enabled
  if (settings.auto_update_tools !== false) {
    setTimeout(async () => {
      try {
        const route = await routeFor("https://github.com");
        await updateTools({
          proxy: route.proxy,
          onProgress: (p) => mainWindow?.webContents.send("downloader:tool-update-progress", p)
        });
      } catch {}
    }, 4000);
  }
}

function revealMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", revealMainWindow);
  app.whenReady().then(bootstrap).catch(error => { console.error(error); app.quit(); });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else revealMainWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { manager?.stopAll(); apiServer?.close?.(); });
}
