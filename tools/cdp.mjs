/**
 * Minimal Chrome DevTools Protocol driver (no playwright, no puppeteer).
 * The sandbox blocks playwright's spawn EPERM and piped stdio, so we drive the
 * real Chrome over WebSocket instead: navigate, wait for a JS condition, click,
 * collect console errors, and capture screenshots at an exact pixel size.
 *
 * Usage (as a library):
 *   const b = await launch({ width: 1440, height: 1000 });
 *   await b.goto(url);
 *   await b.waitFor("window.__nt && document.querySelector('#poster').hidden", 60000);
 *   await b.shot('out.png');
 *   const errs = b.errors;
 *   await b.close();
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

export async function launch(opts = {}) {
  const width = opts.width ?? 1440;
  const height = opts.height ?? 1000;
  const dpr = opts.dpr ?? 1;
  const port = opts.port ?? 9333 + Math.floor(Math.random() * 200);
  const profile = opts.profile ?? path.resolve('.cache/cdp-profile-' + port);
  mkdirSync(profile, { recursive: true });
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--force-device-scale-factor=' + dpr,
    '--window-size=' + width + ',' + height,
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + port,
    'about:blank'
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false });

  let version = null;
  for (let i = 0; i < 100; i++) {
    try {
      version = await getJson('http://127.0.0.1:' + port + '/json/version');
      break;
    } catch {
      await sleep(150);
    }
  }
  if (!version) {
    try { proc.kill(); } catch {}
    throw new Error('chrome did not expose a debugging port');
  }

  const targets = await getJson('http://127.0.0.1:' + port + '/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const errors = [];
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push(msg.params.type + ': ' + text);
      if (msg.params.type === 'error') errors.push(text);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      logs.push('log/' + e.level + ': ' + e.text);
      if (e.level === 'error') errors.push(e.text + (e.url ? ' @ ' + e.url : ''));
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 120000);
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: Boolean(opts.mobile)
  });

  const api = {
    port,
    errors,
    logs,
    send,
    async goto(url, timeout = 60000) {
      await send('Page.navigate', { url });
      const start = Date.now();
      for (;;) {
        const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (r.result && r.result.value === 'complete') return;
        if (Date.now() - start > timeout) throw new Error('goto timeout');
        await sleep(120);
      }
    },
    async eval(expression, awaitPromise = true) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text || 'eval failed');
      }
      return r.result.value;
    },
    async waitFor(expression, timeout = 60000, interval = 200) {
      const start = Date.now();
      for (;;) {
        let v = false;
        try { v = await api.eval(expression); } catch { v = false; }
        if (v) return true;
        if (Date.now() - start > timeout) throw new Error('waitFor timeout: ' + expression);
        await sleep(interval);
      }
    },
    async click(selector) {
      return api.eval("(() => { const el = document.querySelector(" + JSON.stringify(selector) + "); if (!el) return false; el.click(); return true; })()");
    },
    async shot(file, opts2 = {}) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...opts2 });
      mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      writeFileSync(file, Buffer.from(r.data, 'base64'));
      return path.resolve(file);
    },
    async resize(w, h, dpr2 = dpr) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr2, mobile: false });
      await sleep(400);
    },
    async close() {
      try { await send('Browser.close'); } catch {}
      try { ws.close(); } catch {}
      try { proc.kill(); } catch {}
    }
  };
  return api;
}
