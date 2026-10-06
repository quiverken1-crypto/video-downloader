'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { ensureDataDirectories, paths } = require('./paths.cjs');
const { cleanUrl, platformFromUrl, buildDownloadCommand, enumerateInstagramResults, enumerateOutputFiles } = require('./media.cjs');

function clone(task) {
  const { child, ...publicTask } = task;
  return { ...publicTask };
}

function parseProgress(line) {
  const percent = line.match(/\[download\]\s+([\d.]+)%/i);
  const speed = line.match(/\bat\s+([^\s]+(?:\s*\w+\/s)?)/i);
  const eta = line.match(/\bETA\s+([0-9:]+)/i);
  return percent ? { progress: Math.min(100, Number(percent[1])), speed: speed?.[1] || '', eta: eta?.[1] || '' } : null;
}

class TaskManager extends EventEmitter {
  constructor({ maxConcurrent = 3, runner, downloadRoot = paths.downloadRoot, cookieFile = paths.cookieFile, commandOptions = {} } = {}) {
    super();
    this.maxConcurrent = Math.max(0, Number(maxConcurrent) || 0);
    this.runner = runner || this._spawnRunner.bind(this);
    this.downloadRoot = downloadRoot;
    this.cookieFile = cookieFile;
    this.commandOptions = commandOptions;
    this.tasks = new Map();
    this.queue = [];
    this.running = 0;
    this.sequence = 0;
  }

  setDownloadRoot(newRoot) {
    if (newRoot && typeof newRoot === 'string') {
      this.downloadRoot = newRoot;
    }
  }

  add(input) {
    const url = cleanUrl(input.url);
    const task = {
      id: `task_${Date.now()}_${++this.sequence}`,
      url,
      platform: platformFromUrl(url),
      engine: input.engine || (platformFromUrl(url) === 'instagram' ? 'gallery-dl' : 'yt-dlp'),
      title: input.title || '', thumbnail: input.thumbnail || '', author: input.author || '',
      mode: input.mode || 'video', quality: input.quality || 'best',
      format: input.format || '', subtitle: Boolean(input.subtitle), thumbnailDownload: Boolean(input.thumbnailDownload),
      description: Boolean(input.description), status: 'queued', progress: 0, speed: '', eta: '', error: '',
      createdAt: new Date().toISOString(), startedAt: '', completedAt: '', files: [], proxy: input.proxy || '',
      downloadRoot: input.downloadRoot || this.downloadRoot, child: null,
    };
    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this._emit(task);
    queueMicrotask(() => this._drain());
    return clone(task);
  }

  list() { return [...this.tasks.values()].map(clone); }
  get(id) { const task = this.tasks.get(id); return task ? clone(task) : null; }
  activeCount() { return this.running; }

  stop(id) {
    const task = this.tasks.get(id);
    if (!task || ['completed', 'failed', 'stopped'].includes(task.status)) return task ? clone(task) : null;
    if (task.status === 'queued') this.queue = this.queue.filter(value => value !== id);
    task.status = 'stopped';
    task.completedAt = new Date().toISOString();
    task.child?.kill();
    this._emit(task);
    return clone(task);
  }

  stopAll() { return this.list().filter(task => ['queued', 'running'].includes(task.status)).map(task => this.stop(task.id)); }
  clearFinished() {
    for (const [id, task] of this.tasks) if (['completed', 'failed', 'stopped'].includes(task.status)) this.tasks.delete(id);
    this.emit('tasks-cleared');
  }

  async _drain() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift();
      const task = this.tasks.get(id);
      if (!task || task.status !== 'queued') continue;
      this._run(task);
    }
  }

  async _run(task) {
    this.running += 1;
    task.status = 'running'; task.startedAt = new Date().toISOString();
    this._emit(task);
    const dlRoot = task.downloadRoot || this.downloadRoot;
    try {
      const result = await this.runner(task, this);
      if (task.status !== 'stopped') {
        task.status = 'completed'; task.progress = 100; task.completedAt = new Date().toISOString();
        task.files = Array.isArray(result?.files) ? result.files : (task.platform === 'instagram' ? enumerateInstagramResults(task.url, dlRoot) : []);
        this._emit(task);
      }
    } catch (error) {
      if (task.status !== 'stopped') {
        task.status = 'failed'; task.error = error?.message || String(error); task.completedAt = new Date().toISOString();
        this._emit(task);
      }
    } finally {
      task.child = null;
      this.running -= 1;
      this._drain();
    }
  }

  _spawnRunner(task) {
    ensureDataDirectories();
    const dlRoot = task.downloadRoot || this.downloadRoot;
    const { command, args, cwd, output } = buildDownloadCommand(task, { ...this.commandOptions, downloadRoot: dlRoot, cookieFile: this.cookieFile });
    fs.mkdirSync(cwd, { recursive: true });
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true, shell: false });
      task.child = child;
      let stderr = '';
      const observe = chunk => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const update = parseProgress(line);
          if (update) { Object.assign(task, update); this._emit(task); }
          this.emit('task-log', { id: task.id, line });
        }
      };
      child.stdout?.on('data', observe);
      child.stderr?.on('data', chunk => { stderr += chunk; observe(chunk); });
      child.once('error', reject);
      child.once('close', code => {
        if (task.status === 'stopped') return resolve({ files: [] });
        if (code === 0) resolve({
          files: task.engine === 'gallery-dl'
            ? enumerateOutputFiles(output)
            : (task.platform === 'instagram' ? enumerateInstagramResults(task.url, dlRoot) : []),
        });
        else reject(new Error(stderr.trim().slice(-1500) || `下载进程退出（${code}）`));
      });
    });
  }

  _emit(task) { this.emit('task-updated', clone(task)); }
}

module.exports = { TaskManager, parseProgress };
