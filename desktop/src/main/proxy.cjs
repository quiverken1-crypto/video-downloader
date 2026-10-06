'use strict';

const net = require('node:net');

function proxyUrlFromRule(rule) {
  if (!rule || /^\s*DIRECT\s*$/i.test(rule)) return '';
  // Electron returns values such as "PROXY host:port; DIRECT" or
  // "SOCKS5 host:port". Use the first usable upstream rule.
  const match = String(rule).match(/\b(PROXY|HTTPS|HTTP|SOCKS5?|SOCKS)\s+([^;\s]+)/i);
  if (!match) return '';
  const protocol = /^SOCKS/i.test(match[1]) ? 'socks5' : 'http';
  return `${protocol}://${match[2]}`;
}

function redactProxy(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    if (parsed.password) parsed.password = '***';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(value).replace(/:\/\/([^:/@]+):[^@]+@/, '://$1:***@');
  }
}

function isProxyUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch { return false; }
}

function probe(proxy, timeout = 900) {
  if (!proxy) return Promise.resolve({ ok: true, latency: 0 });
  let parsed;
  try { parsed = new URL(proxy); } catch { return Promise.resolve({ ok: false, latency: null }); }
  const started = Date.now();
  return new Promise(resolve => {
    const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) });
    const done = ok => { socket.destroy(); resolve({ ok, latency: ok ? Date.now() - started : null }); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeout, () => done(false));
  });
}

class ProxyRouter {
  constructor({ session, manualProxy = '', probeFn = probe } = {}) {
    this.session = session;
    this.manualProxy = manualProxy;
    this.probeFn = probeFn;
    this.cache = new Map();
  }

  setManualProxy(value = '') {
    if (value && !isProxyUrl(value)) throw new Error('代理地址格式不正确');
    this.manualProxy = value;
    this.cache.clear();
  }

  async resolve(url, { force = false } = {}) {
    const origin = new URL(url).origin;
    if (!force && this.cache.has(origin)) return this.cache.get(origin);
    let proxy = this.manualProxy;
    let source = proxy ? 'manual' : 'direct';
    if (!proxy && this.session?.resolveProxy) {
      proxy = proxyUrlFromRule(await this.session.resolveProxy(url));
      source = proxy ? 'system' : 'direct';
    }
    const result = { proxy, source, display: redactProxy(proxy) || '直连' };
    this.cache.set(origin, result);
    return result;
  }

  async test(url) {
    const route = await this.resolve(url, { force: true });
    return { ...route, ...(await this.probeFn(route.proxy)) };
  }
}

module.exports = { ProxyRouter, proxyUrlFromRule, redactProxy, isProxyUrl, probe };
