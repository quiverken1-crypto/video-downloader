/* global downloader */
(() => {
  'use strict';
  const api = window.downloader || {};
  const $ = (id) => document.getElementById(id);
  const elements = {
    url: $('urlInput'), inspect: $('inspectButton'), preview: $('preview'),
    previewCover: $('previewCover'), previewTitle: $('previewTitle'), previewMeta: $('previewMeta'),
    add: $('addButton'), dismiss: $('dismissPreviewButton'), message: $('message'),
    loginPrompt: $('loginPrompt'), promptLoginBtn: $('promptLoginBtn'),
    taskList: $('taskList'), empty: $('emptyState'), count: $('taskCount'), footer: $('footerStatus'),
    stopAll: $('stopAllButton'), openOutput: $('openOutputButton'), clear: $('clearButton'),
    settings: $('settingsDrawer'), settingsButton: $('settingsButton'), closeSettings: $('closeSettingsButton'),
    scrim: $('scrim'), settingsForm: $('settingsForm'), proxyMode: $('proxyModeSelect'),
    manualProxy: $('manualProxyField'), refreshNetwork: $('refreshNetworkButton'),
    updateTools: $('updateToolsButton'), toolsTip: $('toolsTip'),
    vYtDlp: $('vYtDlp'), vGalleryDl: $('vGalleryDl'), vFfmpeg: $('vFfmpeg'),
    autoUpdate: $('autoUpdateToggle'),
    downloadDir: $('downloadDirInput'), selectDir: $('selectDirButton'), resetDir: $('resetDirButton'),
    openCookie: $('openCookieButton'),
    loginIg: $('loginCaptureInstagramBtn'), loginBili: $('loginCaptureBilibiliBtn'), loginYt: $('loginCaptureYouTubeBtn'),
  };
  const taskNodes = new Map();
  const tasks = new Map();
  let preview = null;
  let lastFailedPlatform = 'bilibili';

  const text = (value, fallback = '') => value == null ? fallback : String(value);
  const invoke = async (name, ...args) => {
    if (typeof api[name] !== 'function') throw new Error(`本机接口尚未就绪：${name}`);
    return api[name](...args);
  };
  const notify = (message = '', error = false) => {
    elements.message.textContent = message;
    elements.message.classList.toggle('is-error', error);
  };
  const platformLabel = (value) => ({
    youtube: 'YouTube', bilibili: 'B站/Bilibili', instagram: 'Instagram',
    tiktok: 'TikTok', twitter: 'Twitter/X', facebook: 'Facebook',
    reddit: 'Reddit', vimeo: 'Vimeo', twitch: 'Twitch',
    dailymotion: 'Dailymotion', pinterest: 'Pinterest', douyin: '抖音',
    xiaohongshu: '小红书', weibo: '微博', other: '其他网站',
  })[text(value).toLowerCase()] || text(value, '媒体');
  const taskId = (task) => text(task?.task_id || task?.taskId || task?.id);
  const taskState = (task) => text(task?.status || task?.state, 'waiting').toLowerCase();
  const statusLabel = (state) => ({ waiting: '等待中', queued: '等待中', running: '下载中', downloading: '下载中', completed: '已完成', success: '已完成', failed: '下载失败', stopped: '已停止', cancelled: '已停止' })[state] || state;
  const progressNumber = (task) => { const value = Number(task?.progress ?? task?.progress_percent ?? task?.percent ?? 0); return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; };
  const routeText = (route) => {
    if (!route) return '未检测';
    const latency = route.latency_ms ?? route.latency ?? route.ms;
    const via = route.label || route.route || route.mode || route.proxy || '';
    if (route.error || route.available === false || route.ok === false) return route.error ? '线路异常' : '未连通';
    return `${via || '已连通'}${Number.isFinite(Number(latency)) ? ` · ${Math.round(Number(latency))}ms` : ''}`;
  };

  function setPreview(data) {
    preview = data || null;
    if (!preview) { elements.preview.classList.add('hidden'); return; }
    const cover = preview.cover_url || preview.coverUrl || preview.thumbnail || preview.cover || '';
    elements.previewCover.src = cover;
    elements.previewCover.hidden = !cover;
    elements.previewTitle.textContent = text(preview.title, '已找到媒体');
    const count = preview.media_count || preview.mediaCount;
    elements.previewMeta.textContent = [platformLabel(preview.platform), preview.duration ? text(preview.duration) : '', count ? `${count} 个媒体` : '可加入下载列表'].filter(Boolean).join(' · ');
    elements.preview.classList.remove('hidden');
    elements.loginPrompt.classList.add('hidden');
  }

  function createTaskNode(id) {
    const row = document.createElement('article'); row.className = 'task-row'; row.dataset.taskId = id;
    const cover = document.createElement('img'); cover.className = 'task-cover'; cover.alt = '';
    const info = document.createElement('div'); info.className = 'task-info';
    const title = document.createElement('strong'); title.className = 'task-title';
    const subtitle = document.createElement('span'); subtitle.className = 'task-subtitle'; info.append(title, subtitle);
    const progressWrap = document.createElement('div'); progressWrap.className = 'task-progress-wrap';
    const line = document.createElement('div'); line.className = 'task-progress-line'; const progress = document.createElement('div'); progress.className = 'task-progress'; line.append(progress);
    const meta = document.createElement('div'); meta.className = 'task-progress-meta'; const state = document.createElement('span'); state.className = 'status-tag'; const percent = document.createElement('span'); meta.append(state, percent); progressWrap.append(line, meta);
    const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'secondary task-stop'; stop.textContent = '停止'; stop.addEventListener('click', async () => { stop.disabled = true; try { await invoke('stopTask', id); } catch (err) { notify(text(err.message, '停止任务时出现问题'), true); stop.disabled = false; } });
    row.append(cover, info, progressWrap, stop); elements.taskList.append(row);
    const node = { row, cover, title, subtitle, progress, state, percent, stop }; taskNodes.set(id, node); return node;
  }

  function updateTask(task) {
    const id = taskId(task); if (!id) return;
    const current = { ...(tasks.get(id) || {}), ...task }; tasks.set(id, current);
    const node = taskNodes.get(id) || createTaskNode(id); const state = taskState(current); const complete = ['completed', 'success', 'failed', 'stopped', 'cancelled'].includes(state); const amount = progressNumber(current);
    node.row.classList.toggle('is-failed', state === 'failed'); node.row.classList.toggle('is-completed', ['completed', 'success'].includes(state));
    const cover = current.cover_url || current.coverUrl || current.thumbnail || current.cover || ''; if (cover && node.cover.src !== cover) node.cover.src = cover; node.cover.hidden = !cover;
    node.title.textContent = text(current.title, '媒体下载任务');
    node.subtitle.textContent = [platformLabel(current.platform), current.format || current.quality || '', current.error ? text(current.error) : ''].filter(Boolean).join(' · ');
    node.progress.style.width = `${amount}%`; node.state.textContent = statusLabel(state); node.percent.textContent = current.speed ? `${text(current.speed)} · ${Math.round(amount)}%` : `${Math.round(amount)}%`;
    node.stop.hidden = complete; node.stop.disabled = state === 'stopping';
    updateSummary();
  }
  function updateSummary() { const values = [...tasks.values()]; const active = values.filter((task) => ['running', 'downloading'].includes(taskState(task))).length; const queued = values.filter((task) => ['waiting', 'queued'].includes(taskState(task))).length; elements.empty.hidden = values.length > 0; elements.count.textContent = `${values.length} 个任务${active ? ` · ${active}/3 下载中` : ''}`; elements.footer.textContent = active ? `正在下载 ${active} 项${queued ? `，${queued} 项等待中` : ''}` : queued ? `${queued} 项等待下载` : values.length ? '所有任务已处理' : '等待新的下载任务'; }
  function removeFinished() { for (const [id, task] of tasks) { if (['completed', 'success', 'failed', 'stopped', 'cancelled'].includes(taskState(task))) { taskNodes.get(id)?.row.remove(); taskNodes.delete(id); tasks.delete(id); } } updateSummary(); }

  function updateNetwork(payload) {
    const routes = payload?.routes || payload?.platforms || payload || {};
    for (const platform of ['youtube', 'bilibili', 'instagram']) {
      const chip = document.querySelector(`.route-chip[data-platform="${platform}"]`); if (!chip) continue;
      const route = routes[platform] || routes[platform[0].toUpperCase() + platform.slice(1)] || (Array.isArray(routes) ? routes.find((item) => text(item.platform).toLowerCase() === platform) : null);
      const value = routeText(route); const badge = chip.querySelector('b'); badge.textContent = value;
      chip.classList.toggle('is-good', Boolean(route && !route.error && route.ok !== false && route.available !== false)); chip.classList.toggle('is-bad', Boolean(route && (route.error || route.ok === false || route.available === false))); chip.classList.toggle('is-warn', !route || (!chip.classList.contains('is-good') && !chip.classList.contains('is-bad')));
    }
  }

  async function refreshToolVersions() {
    try {
      const v = await invoke('getToolVersions');
      if (elements.vYtDlp) elements.vYtDlp.textContent = `v${v.ytDlp || '未知'}`;
      if (elements.vGalleryDl) elements.vGalleryDl.textContent = `v${v.galleryDl || '未知'}`;
      if (elements.vFfmpeg) elements.vFfmpeg.textContent = v.ffmpeg || '已启用';
    } catch (err) {
      if (elements.toolsTip) elements.toolsTip.textContent = '获取核心版本失败';
    }
  }

  function openDrawer(show) {
    elements.settings.classList.toggle('is-open', show);
    elements.settings.setAttribute('aria-hidden', String(!show));
    elements.settingsButton.setAttribute('aria-expanded', String(show));
    elements.scrim.classList.toggle('hidden', !show);
    if (show) {
      refreshToolVersions();
      setTimeout(() => elements.settings.querySelector('select, input, button')?.focus(), 20);
    } else elements.settingsButton.focus();
  }

  function applySettings(settings = {}) {
    const map = { mode: 'modeSelect', quality: 'qualitySelect', proxy_mode: 'proxyModeSelect', manual_proxy: 'manualProxyInput', subtitles: 'subtitleToggle', cover: 'coverToggle', auto_update_tools: 'autoUpdateToggle' };
    for (const [key, id] of Object.entries(map)) {
      const field = $(id);
      if (!field || settings[key] === undefined) continue;
      if (field.type === 'checkbox') field.checked = Boolean(settings[key]);
      else field.value = settings[key];
    }
    if (elements.downloadDir) {
      elements.downloadDir.value = settings.download_dir || '';
    }
    toggleManualProxy();
  }
  function toggleManualProxy() { elements.manualProxy.classList.toggle('hidden', elements.proxyMode.value !== 'manual'); }

  async function inspect() {
    const url = elements.url.value.trim();
    if (!url) { notify('请先粘贴一个链接。', true); elements.url.focus(); return; }
    elements.inspect.disabled = true; elements.inspect.textContent = '检查中…'; notify('正在读取标题和封面…');
    elements.loginPrompt.classList.add('hidden');
    try {
      const data = await invoke('inspect', url);
      setPreview(data?.preview || data);
      notify('链接已确认，可以加入下载列表。');
    } catch (err) {
      setPreview(null);
      const isLogin = err.message && (err.message.includes('redirect to login') || err.message.includes('login') || err.message.includes('Private') || err.loginRequired);
      if (isLogin) {
        lastFailedPlatform = url.includes('bilibili.com') ? 'bilibili' : url.includes('instagram.com') ? 'instagram' : url.includes('youtube.com') ? 'youtube' : 'bilibili';
        elements.loginPrompt.classList.remove('hidden');
        notify('该内容需要登录账号后获取。点击下方「立即打开网页登录」！', true);
      } else {
        notify(text(err?.message, '链接检查未完成，请检查网络线路或Cookie凭证后重试。'), true);
      }
    } finally {
      elements.inspect.disabled = false;
      elements.inspect.textContent = '检查链接';
    }
  }

  async function triggerLoginCapture(platform = 'bilibili') {
    notify(`正在打开 ${platformLabel(platform)} 登录窗口，请在弹窗中完成登录...`);
    try {
      const res = await invoke('captureLogin', platform);
      if (res?.ok) {
        notify(`✅ ${res.platformName || platform} 登录成功！高画质凭证已保存，正在重新解析...`);
        elements.loginPrompt.classList.add('hidden');
        if (elements.url.value.trim()) {
          setTimeout(inspect, 500);
        }
      } else {
        notify(text(res?.message, '未完成登录'), true);
      }
    } catch (err) {
      notify('打开登录窗口失败: ' + err.message, true);
    }
  }

  async function addTask() {
    if (!preview) return inspect();
    elements.add.disabled = true;
    try {
      const taskInput = {
        url: elements.url.value.trim() || preview.url,
        title: preview.title,
        thumbnail: preview.thumbnail || preview.cover_url || preview.coverUrl || preview.cover,
        author: preview.author || preview.username || '',
        engine: preview.engine || '',
        description: preview.description,
        batch: preview.batch,
        mode: $('modeSelect').value,
        quality: $('qualitySelect').value,
        subtitles: $('subtitleToggle').checked,
      };
      const result = await invoke('addTask', taskInput);
      const task = result?.task || result;
      if (task && taskId(task)) updateTask(task);
      elements.url.value = '';
      setPreview(null);
      notify('已加入下载列表。');
      elements.url.focus();
    } catch (err) {
      notify(text(err?.message, '加入任务时出现问题。'), true);
    } finally {
      elements.add.disabled = false;
    }
  }

  async function handleUpdateTools() {
    if (!elements.updateTools) return;
    elements.updateTools.disabled = true;
    elements.updateTools.textContent = '正在更新...';
    if (elements.toolsTip) elements.toolsTip.textContent = '正在通过清华镜像源下载最新核心组件...';
    try {
      const res = await invoke('updateTools');
      if (res?.ok) {
        notify('核心组件更新成功 ✅');
        if (elements.toolsTip) elements.toolsTip.textContent = '核心组件已是最新版本！';
      } else {
        notify(text(res?.message || res?.error, '更新完成'), false);
      }
      refreshToolVersions();
    } catch (err) {
      notify(text(err?.message, '更新核心失败'), true);
      if (elements.toolsTip) elements.toolsTip.textContent = '更新出错: ' + err.message;
    } finally {
      elements.updateTools.disabled = false;
      elements.updateTools.textContent = '立即检查更新';
    }
  }

  async function handleSelectDirectory() {
    try {
      const res = await invoke('selectDirectory');
      if (!res.canceled && res.path) {
        elements.downloadDir.value = res.path;
        await invoke('updateSettings', { download_dir: res.path });
        notify('下载保存位置已修改为：' + res.path);
      }
    } catch (err) {
      notify(text(err.message, '选择目录失败'), true);
    }
  }

  async function handleResetDirectory() {
    elements.downloadDir.value = '';
    await invoke('updateSettings', { download_dir: '' });
    notify('已恢复默认下载保存位置');
  }

  async function handleOpenCookieDir() {
    try {
      await invoke('openCookieDir');
      notify('已打开 Cookie 存放文件夹');
    } catch (err) {
      notify('打开文件夹失败: ' + err.message, true);
    }
  }

  async function loadInitialState() {
    try {
      const state = await invoke('getState');
      const data = state?.tasks || state?.items || [];
      (Array.isArray(data) ? data : Object.values(data)).forEach(updateTask);
      applySettings(state?.settings || {});
      updateNetwork(state?.network || state?.routes || {});
      refreshToolVersions();
    } catch (err) {
      notify('本机下载服务正在启动，请稍候。', false);
    }
  }

  elements.inspect.addEventListener('click', inspect);
  elements.add.addEventListener('click', addTask);
  elements.dismiss.addEventListener('click', () => setPreview(null));
  elements.url.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); inspect(); } });
  elements.stopAll.addEventListener('click', async () => { elements.stopAll.disabled = true; try { await invoke('stopAll'); notify('已发送全部停止指令。'); } catch (err) { notify(text(err.message, '停止任务时出现问题。'), true); } finally { elements.stopAll.disabled = false; } });
  elements.openOutput.addEventListener('click', async () => { try { await invoke('openOutput'); } catch (err) { notify(text(err.message, '打开目录时出现问题。'), true); } });
  elements.clear.addEventListener('click', removeFinished);
  elements.settingsButton.addEventListener('click', () => openDrawer(true));
  elements.closeSettings.addEventListener('click', () => openDrawer(false));
  elements.scrim.addEventListener('click', () => openDrawer(false));
  elements.proxyMode.addEventListener('change', toggleManualProxy);
  if (elements.updateTools) elements.updateTools.addEventListener('click', handleUpdateTools);
  if (elements.selectDir) elements.selectDir.addEventListener('click', handleSelectDirectory);
  if (elements.resetDir) elements.resetDir.addEventListener('click', handleResetDirectory);
  if (elements.openCookie) elements.openCookie.addEventListener('click', handleOpenCookieDir);
  if (elements.promptLoginBtn) elements.promptLoginBtn.addEventListener('click', () => triggerLoginCapture(lastFailedPlatform));
  if (elements.loginBili) elements.loginBili.addEventListener('click', () => triggerLoginCapture('bilibili'));
  if (elements.loginIg) elements.loginIg.addEventListener('click', () => triggerLoginCapture('instagram'));
  if (elements.loginYt) elements.loginYt.addEventListener('click', () => triggerLoginCapture('youtube'));

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && elements.settings.classList.contains('is-open')) openDrawer(false); });
  elements.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(elements.settingsForm);
    const settings = Object.fromEntries(form.entries());
    settings.subtitles = elements.subtitleToggle.checked;
    settings.cover = elements.coverToggle.checked;
    settings.auto_update_tools = elements.autoUpdate.checked;
    settings.download_dir = elements.downloadDir.value.trim();
    try {
      await invoke('updateSettings', settings);
      notify('设置已保存。');
      openDrawer(false);
    } catch (err) {
      notify(text(err.message, '保存设置时出现问题。'), true);
    }
  });
  elements.refreshNetwork.addEventListener('click', async () => {
    elements.refreshNetwork.disabled = true;
    elements.refreshNetwork.textContent = '测速中…';
    try {
      const result = await invoke('refreshNetwork');
      updateNetwork(result);
      notify('平台线路已更新。');
    } catch (err) {
      notify(text(err.message, '线路测速未完成。'), true);
    } finally {
      elements.refreshNetwork.disabled = false;
      elements.refreshNetwork.textContent = '测速线路';
    }
  });

  if (typeof api.onTask === 'function') api.onTask((payload) => updateTask(payload?.task || payload));
  if (typeof api.onNetwork === 'function') api.onNetwork((payload) => updateNetwork(payload));
  if (typeof api.onToolUpdateProgress === 'function') {
    api.onToolUpdateProgress((p) => {
      if (elements.toolsTip && p?.status) elements.toolsTip.textContent = p.status;
      if (p?.finished) refreshToolVersions();
    });
  }

  loadInitialState();
})();
