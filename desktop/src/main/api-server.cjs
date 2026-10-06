'use strict';

const http = require('node:http');
const { inspectMedia } = require('./media.cjs');
const { paths } = require('./paths.cjs');

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.destroy(new Error('请求过大')); });
    request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON 格式不正确')); } });
    request.on('error', reject);
  });
}

function createHandler({ manager, router, inspect = inspectMedia, addTask, getToolVersions, updateTools, getUpdateState, getEffectiveDownloadRoot, setDownloadDir }) {
  return async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'OPTIONS') return json(response, 204, {});
      if (request.method === 'GET' && pathname === '/health') return json(response, 200, { ok: true, service: 'multi-platform-downloader' });
      if (request.method === 'GET' && pathname === '/tasks') return json(response, 200, { tasks: manager.list(), active: manager.activeCount(), maxConcurrent: manager.maxConcurrent });
      if (request.method === 'POST' && pathname === '/tasks') {
        const input = await readJson(request);
        return json(response, 201, await (addTask ? addTask(input) : manager.add(input)));
      }
      if (request.method === 'POST' && pathname === '/inspect') {
        const input = await readJson(request);
        const route = router ? await router.resolve(input.url) : null;
        return json(response, 200, await inspect(input.url, { proxy: input.proxy || route?.proxy || '' }));
      }
      const stop = pathname.match(/^\/tasks\/([^/]+)\/stop$/);
      if (request.method === 'POST' && stop) {
        const task = manager.stop(decodeURIComponent(stop[1]));
        return task ? json(response, 200, task) : json(response, 404, { error: '任务不存在' });
      }
      if (request.method === 'POST' && pathname === '/tasks/stop-all') return json(response, 200, { tasks: manager.stopAll() });
      if (request.method === 'POST' && pathname === '/tasks/clear-finished') { manager.clearFinished(); return json(response, 200, { ok: true }); }
      if (request.method === 'GET' && pathname === '/network') return json(response, 200, { manualProxy: router?.manualProxy ? router.manualProxy.replace(/:\/\/([^:/@]+):[^@]+@/, '://$1:***@') : '' });
      if (request.method === 'POST' && pathname === '/network') {
        if (!router) return json(response, 501, { error: '线路服务未启用' });
        const input = await readJson(request); router.setManualProxy(input.manualProxy || '');
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && pathname === '/download-path') {
        const current = getEffectiveDownloadRoot ? getEffectiveDownloadRoot() : paths.downloadRoot;
        return json(response, 200, { path: current, default: paths.downloadRoot });
      }
      if (request.method === 'POST' && pathname === '/download-path') {
        const input = await readJson(request);
        if (setDownloadDir) setDownloadDir(input.path || '');
        return json(response, 200, { ok: true, path: getEffectiveDownloadRoot ? getEffectiveDownloadRoot() : paths.downloadRoot });
      }
      if (request.method === 'GET' && pathname === '/tools/version') {
        const versions = getToolVersions ? await getToolVersions() : {};
        const state = getUpdateState ? getUpdateState() : {};
        return json(response, 200, { ok: true, versions, updateState: state });
      }
      if (request.method === 'POST' && pathname === '/tools/update') {
        if (!updateTools) return json(response, 501, { error: '更新功能未启用' });
        updateTools();
        return json(response, 200, { ok: true, message: '更新任务已启动' });
      }
      return json(response, 404, { error: '接口不存在' });
    } catch (error) { return json(response, 400, { error: error?.message || String(error) }); }
  };
}

async function createApiServer({ manager, router, inspect, addTask, getToolVersions, updateTools, getUpdateState, getEffectiveDownloadRoot, setDownloadDir, host = '127.0.0.1', port = 17896 } = {}) {
  if (!manager) throw new Error('需要 TaskManager');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new Error('本机接口只监听本机地址');
  const server = http.createServer(createHandler({ manager, router, inspect, addTask, getToolVersions, updateTools, getUpdateState, getEffectiveDownloadRoot, setDownloadDir }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  return { server, host, port: address.port, url: `http://${host === '::1' ? '[::1]' : host}:${address.port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { createApiServer, createHandler };
