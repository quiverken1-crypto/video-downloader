"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const subscribe = (channel, callback) => {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("downloader", Object.freeze({
  inspect: (url) => invoke("downloader:inspect", { url }),
  addTask: (options) => invoke("downloader:add-task", options),
  stopTask: (taskId) => invoke("downloader:stop-task", { taskId }),
  stopAll: () => invoke("downloader:stop-all"),
  openOutput: () => invoke("downloader:open-output"),
  openCookieDir: () => invoke("downloader:open-cookie-dir"),
  captureLogin: (platform) => invoke("downloader:capture-login", { platform }),
  selectDirectory: () => invoke("downloader:select-directory"),
  getDownloadDir: () => invoke("downloader:get-download-dir"),
  getState: () => invoke("downloader:get-state"),
  refreshNetwork: () => invoke("downloader:refresh-network"),
  updateSettings: (settings) => invoke("downloader:update-settings", settings),
  getToolVersions: () => invoke("downloader:get-tool-versions"),
  getUpdateState: () => invoke("downloader:get-update-state"),
  updateTools: () => invoke("downloader:update-tools"),
  onTask: (callback) => subscribe("downloader:task", callback),
  onNetwork: (callback) => subscribe("downloader:network", callback),
  onToolUpdateProgress: (callback) => subscribe("downloader:tool-update-progress", callback),
}));
