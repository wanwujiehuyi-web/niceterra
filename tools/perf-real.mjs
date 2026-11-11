/**
 * PERF 真机性能驱动：headed Chrome（真实 GPU）+ CDP，对生产构建跑
 * PERF-07（进入时长）、PERF-01（三层帧率）、PERF-03（换层+内存）、
 * PERF-04（20 分钟长跑）。与 cdp.mjs 的区别：不 headless、不 SwiftShader、
 * 不 --disable-gpu、不做设备仿真——测的就是真实窗口真实显卡。
 *
 * 前置：dev/preview 服务器已在 BASE 上运行（生产构建）。
 * 用法：node tools/perf-real.mjs [--quick]
 *   --quick 只做 GPU 验证 + PERF-07 + 谷地 20s 抽测（排障用）
 * 输出：reports/v3/perf/perf-real-<ts>.json + 控制台摘要
 * 后台：nohup node tools/perf-real.mjs > .cache/perf-real.log 2>&1 &
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.PERF_BASE || 'http://127.0.0.1:5390';
const PORT = 9377;
const PROFILE = path.resolve('.cache/perf-profile');
const QUICK = process.argv.includes('--quick');
const OUT_DIR = 'reports/v3/perf';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + s);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

/* ------------------------------------------------------------ CDP client */

let ws, nextId = 1;
const pending = new Map();
const errors = [];

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

async function connect() {
  let version = null;
  for (let i = 0; i < 120; i++) {
    try { version = await getJson('http://127.0.0.1:' + PORT + '/json/version'); break; }
    catch { await sleep(250); }
  }
  if (!version) throw new Error('chrome 调试端口未就绪');
  log('chrome: ' + version.Browser + ' / ' + version['User-Agent'].slice(0, 60));
  const targets = await getJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text || 'exception');
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
}

async function evaljs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text || 'eval failed');
  }
  return r.result.value;
}

async function waitFor(expression, timeout = 180000, interval = 250) {
  const start = Date.now();
  for (;;) {
    let v = false;
    try { v = await evaljs(expression); } catch { v = false; }
    if (v) return true;
    if (Date.now() - start > timeout) throw new Error('waitFor timeout: ' + expression);
    await sleep(interval);
  }
}

async function goto(url) {
  await send('Page.navigate', { url });
  await waitFor('document.readyState === "complete"', 120000);
}

/* ------------------------------------------------------------ perf 工具 */

/** 读 __ntPerf 快照（buckets/heap 全量） */
async function perfDump() {
  return evaljs(
    "(() => { const p = window.__ntPerf; if (!p) return null; return JSON.parse(JSON.stringify({ frames: p.frames, fpsNow: p.fpsNow, heapNowMb: p.heapNowMb, buckets: p.buckets, heap: p.heap, marks: p.marks })); })()"
  );
}

function fpsStats(buckets, skipSec = 10) {
  const xs = buckets.filter((b) => b.t >= skipSec * 1000).map((b) => b.fps).sort((a, b) => a - b);
  if (!xs.length) return null;
  const q = (p) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  return {
    n: xs.length,
    min: xs[0],
    p5: q(0.05),
    median: q(0.5),
    mean: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100
  };
}

const waitTierReady = () => waitFor("document.getElementById('app').dataset.phase === 'interactive'", 180000);

/* ------------------------------------------------------------ 主流程 */

mkdirSync(PROFILE, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const args = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--mute-audio',
  '--window-size=1920,1080',
  '--window-position=40,40',
  '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + PORT,
  'about:blank'
];
log('启动 headed Chrome（真实 GPU，profile=.cache/perf-profile, port=' + PORT + '）');
const proc = spawn(CHROME, args, { stdio: 'ignore' });

const result = { generatedAt: new Date().toISOString(), base: BASE, quick: QUICK };

try {
  await connect();

  // ---- GPU 验证：必须是真实显卡，SwiftShader 直接中止 ----
  await goto('about:blank');
  const gpu = await evaljs(`(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'NO_WEBGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })()`);
  result.gpu = gpu;
  log('WebGL renderer: ' + gpu);
  if (/swiftshader/i.test(String(gpu))) throw new Error('仍是软渲染（SwiftShader），真机测试中止');
  result.gpuReal = /nvidia|amd|intel|angle/i.test(String(gpu));

  const display = await evaljs('JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, screen: [screen.width, screen.height] })');
  result.display = JSON.parse(display);
  log('窗口/显示: ' + display);

  // ---- PERF-07：进入三维时长（目标：桌面 <= 5000ms）----
  const url = (extra) => BASE + '/?autostart=1&tour=0&perf=1' + (extra || '');
  const t0 = Date.now();
  await goto(url(''));
  await waitTierReady();
  result.perf07_enterMs = Date.now() - t0;
  log('PERF-07 进入三维: ' + result.perf07_enterMs + ' ms（含网络/构建，目标 <=5000ms）');

  // ---- PERF-01a：谷地帧率 ----
  const VALLEY_SEC = QUICK ? 20 : 70;
  await evaljs('window.__ntPerf.reset(); true');
  log('PERF-01a 谷地采样 ' + VALLEY_SEC + 's ...');
  await sleep(VALLEY_SEC * 1000);
  const valleyDump = await perfDump();
  result.perf01_valley = fpsStats(valleyDump.buckets, QUICK ? 5 : 10);
  log('PERF-01a 谷地: ' + JSON.stringify(result.perf01_valley));

  if (!QUICK) {
    // ---- PERF-01b：远景帧率 ----
    await evaljs("document.getElementById('btn-far').click(); true");
    await waitTierReady();
    await waitFor("window.__nt && window.__nt.stats && true", 30000);
    await evaljs('window.__ntPerf.reset(); true');
    log('PERF-01b 远景采样 60s ...');
    await sleep(60000);
    const farDump = await perfDump();
    result.perf01_far = fpsStats(farDump.buckets, 10);
    log('PERF-01b 远景: ' + JSON.stringify(result.perf01_far));

    // ---- PERF-01c：分子层帧率（硅藻壳路线）----
    await goto(url('&site=SITE-HLG-STREAM-01&route=HLG-STREAM-BIOFILM-01&level=diatom-frustule'));
    await waitTierReady();
    await evaljs('window.__ntPerf.reset(); true');
    log('PERF-01c 分子层采样 60s ...');
    await sleep(60000);
    const microDump = await perfDump();
    result.perf01_micro = fpsStats(microDump.buckets, 10);
    log('PERF-01c 分子层: ' + JSON.stringify(result.perf01_micro));

    // ---- PERF-03：换层计时 + 内存增长（5 轮：谷地→森林→谷地→远景）----
    await goto(url(''));
    await waitTierReady();
    const cycles = [];
    for (let i = 0; i < 5; i++) {
      const c = { cycle: i + 1 };
      let t = Date.now();
      await evaljs("document.querySelector('[data-site=\\'SITE-HLG-FOREST-01\\']').click(); true");
      await waitTierReady();
      c.toForestMs = Date.now() - t;
      t = Date.now();
      await evaljs("document.getElementById('btn-exit').click(); true");
      await waitTierReady();
      c.toValleyMs = Date.now() - t;
      t = Date.now();
      await evaljs("document.getElementById('btn-far').click(); true");
      await waitTierReady();
      c.toFarMs = Date.now() - t;
      t = Date.now();
      await evaljs("document.getElementById('btn-far').click(); true");
      await waitTierReady();
      c.backValleyMs = Date.now() - t;
      c.heapMb = (await perfDump()).heapNowMb;
      log('PERF-03 轮' + (i + 1) + ': ' + JSON.stringify(c));
      cycles.push(c);
    }
    result.perf03_cycles = cycles;

    // ---- PERF-04：20 分钟长跑（谷地驻留，每 2 分钟远/谷往返一次制造内存搅动）----
    log('PERF-04 20 分钟长跑开始 ...');
    await evaljs('window.__ntPerf.reset(); true');
    const soakStart = Date.now();
    for (let m = 2; m <= 20; m += 2) {
      const wait = soakStart + m * 60000 - Date.now();
      if (wait > 0) await sleep(wait);
      await evaljs("document.getElementById('btn-far').click(); true");
      await waitTierReady();
      await evaljs("document.getElementById('btn-far').click(); true");
      await waitTierReady();
      const d = await perfDump();
      log('PERF-04 ' + m + 'min: fps=' + d.fpsNow + ' heap=' + d.heapNowMb + 'MB buckets=' + d.buckets.length);
    }
    const soakDump = await perfDump();
    result.perf04 = {
      fps: fpsStats(soakDump.buckets, 10),
      heapFirst5: soakDump.heap.slice(0, 5).map((h) => h.mb),
      heapLast5: soakDump.heap.slice(-5).map((h) => h.mb),
      heapSlopeMbPerMin: soakDump.heap.length > 4
        ? Math.round(((soakDump.heap[soakDump.heap.length - 1].mb - soakDump.heap[0].mb) / ((soakDump.heap[soakDump.heap.length - 1].t - soakDump.heap[0].t) / 60000)) * 100) / 100
        : null,
      buckets: soakDump.buckets.length
    };
    log('PERF-04 汇总: ' + JSON.stringify(result.perf04));
  }

  result.consoleErrors = errors.slice(0, 20);
  result.verdict = 'DONE';
} catch (err) {
  result.verdict = 'ABORT: ' + (err && err.message ? err.message : String(err));
  log(result.verdict);
} finally {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const file = OUT_DIR + '/perf-real-' + stamp + '.json';
  writeFileSync(file, JSON.stringify(result, null, 2));
  log('结果已写 ' + file);
  try { await send('Browser.close'); } catch {}
  try { proc.kill(); } catch {}
}
