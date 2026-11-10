/**
 * Headless tier smoke test.
 *
 * There is no usable browser in this sandbox (Chrome dies creating mojo named
 * pipes), so geometry is verified without a GPU: each tier factory is loaded
 * through Vite's SSR module runner with a stub canvas + a fetch shim that reads
 * from public/. That proves the tiers construct, expose the WorldTier contract,
 * report plausible triangle counts, degrade on lowQuality and dispose cleanly.
 *
 * It does NOT prove pixels, frame rate or colour. Those stay NOT_RUN.
 */
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());

/* ---------------------------------------------------------------- stubs */

function makeCtx2d() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const target = {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    globalAlpha: 1, globalCompositeOperation: 'source-over', textAlign: 'left', textBaseline: 'top',
    lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: '#000', filter: 'none',
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    putImageData: noop, measureText: (t) => ({ width: String(t).length * 6 }),
    setTransform: noop, resetTransform: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, transform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop,
    quadraticCurveTo: noop, arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, drawImage: noop, isPointInPath: () => false
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

function makeCanvas() {
  const el = {
    width: 1, height: 1, style: {},
    getContext(kind) { return kind === '2d' ? makeCtx2d() : null; },
    toDataURL: () => 'data:image/png;base64,',
    addEventListener: () => {}, removeEventListener: () => {},
    getBoundingClientRect: () => ({ width: 960, height: 540, left: 0, top: 0, right: 960, bottom: 540, x: 0, y: 0 })
  };
  return el;
}

function makeImg() {
  const handlers = { load: [], error: [] };
  const img = {
    width: 2, height: 2, naturalWidth: 2, naturalHeight: 2, crossOrigin: null, complete: true,
    style: {}, dataset: {}, removeAttribute() {}, setAttribute() {}, removeEventListener() {},
    addEventListener(type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); },
    decode: () => Promise.resolve()
  };
  let src = '';
  Object.defineProperty(img, 'src', {
    get: () => src,
    set(v) {
      src = v;
      setTimeout(() => {
        const ev = { type: 'load', target: img };
        for (const fn of handlers.load) fn(ev);
        if (typeof img.onload === 'function') img.onload(ev);
      }, 0);
    }
  });
  return img;
}

function installDom() {
  const doc = {
    createElement: (tag) => {
      if (tag === 'canvas') return makeCanvas();
      if (tag === 'img') return makeImg();
      return { style: {}, dataset: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } };
    },
    createElementNS: (ns, tag) => (tag === 'img' ? makeImg() : makeCanvas()),
    documentElement: { style: {} },
    body: { appendChild() {}, style: {}, dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} },
    addEventListener: () => {}, removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null
  };
  globalThis.document = doc;
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  if (!('navigator' in globalThis) || !globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', devicePixelRatio: 1 }, configurable: true });
  }
  globalThis.devicePixelRatio = 1;
  if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16);
  if (!globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:stub';
  if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};

  // fetch shim: relative URLs are served from public/
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/^https?:/i.test(u)) return realFetch(url, opts);
    const clean = u.split('?')[0].replace(/^\/+/, '');
    const file = path.join(ROOT, 'public', clean);
    try {
      const buf = await readFile(file);
      const res = new Response(buf, { status: 200, headers: { 'content-length': String(buf.length), 'content-type': 'application/octet-stream' } });
      return res;
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}

/* ------------------------------------------------------------- measure */

function measure(root) {
  let tris = 0;
  let meshes = 0;
  const materials = new Set();
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    const g = o.geometry;
    if (!g) return;
    const index = g.getIndex();
    const pos = g.getAttribute('position');
    const count = index ? index.count : pos ? pos.count : 0;
    const per = o.isInstancedMesh ? (o.count || 1) : 1;
    if (o.isMesh) tris += Math.floor(count / 3) * per;
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
  });
  return { tris, meshes, materials: materials.size };
}

/* ---------------------------------------------------------------- main */

const cases = [
  { name: 'valley', load: (m) => m.createValleyTier({ lowQuality: false, onProgress: (d, t, l) => console.log('  valley ' + d + '/' + t + ' ' + l) }) },
  { name: 'valley-low', load: (m) => m.createValleyTier({ lowQuality: true }) },
  { name: 'farview', load: (m) => m.createFarviewTier({ lowQuality: false }) },
  { name: 'farview-low', load: (m) => m.createFarviewTier({ lowQuality: true }) },
  { name: 'forest', load: (m) => m.createForestTier({ lowQuality: false, onProgress: (d, t, l) => console.log('  forest ' + d + '/' + t + ' ' + l) }) },
  { name: 'stream', load: (m) => m.createStreamTier({ lowQuality: false, onProgress: (d, t, l) => console.log('  stream ' + d + '/' + t + ' ' + l) }) },
  { name: 'micro-wet-rock', load: (m) => m.createMicroTierA({ lowQuality: false, levelId: 'wet-rock' }) },
  { name: 'micro-local-sio', load: (m) => m.createMicroTierA({ lowQuality: false, levelId: 'local-sio' }) }
];

const virtual = {
  valley: 'src/world/valley.ts',
  farview: 'src/world/farview.ts',
  forest: 'src/sites/forest.ts',
  stream: 'src/sites/stream.ts',
  micro: 'src/micro/route-a.ts'
};

installDom();

const STUB_GLTF = path.join(ROOT, 'tools/stub-gltf.ts');

const stubGltf = {
  name: 'stub-gltf',
  enforce: 'pre',
  resolveId(source) {
    if (/core\/gltf(\.ts)?$/.test(source)) return STUB_GLTF;
    return null;
  }
};

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  plugins: [stubGltf]
});

const loaded = new Map();
async function mod(name) {
  if (loaded.has(name)) return loaded.get(name);
  const m = await server.ssrLoadModule(virtual[name]);
  loaded.set(name, m);
  return m;
}

const results = [];
let failed = 0;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after ' + ms + 'ms (' + label + ')')), ms))
  ]);
}

const only = (process.env.SMOKE_ONLY || '').split(',').filter(Boolean);
for (const c of cases) {
  const name = c.name;
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  console.log('> ' + name);
  const key = name.startsWith('micro') ? 'micro' : name.replace('-low', '');
  const t0 = Date.now();
  try {
    const m = await mod(key);
    const tier = await withTimeout(c.load(m), 90000, name);
    const ms = Date.now() - t0;
    const stat = measure(tier.group);
    const poses = Object.keys(tier.poses || {});
    const problems = [];
    if (!tier.id) problems.push('missing id');
    if (!tier.defaultPose) problems.push('missing defaultPose');
    if (!poses.includes(tier.defaultPose)) problems.push('defaultPose not in poses');
    if (!tier.anchors) problems.push('missing anchors');
    if (typeof tier.update !== 'function') problems.push('missing update');
    if (typeof tier.dispose !== 'function') problems.push('missing dispose');
    if (stat.tris === 0) problems.push('no triangles');
    if (problems.length) failed++;
    results.push({
      name, id: tier.id, ms, tris: stat.tris, meshes: stat.meshes, materials: stat.materials,
      poses, anchors: tier.anchors.length, assetsLoaded: tier.stats?.assetsLoaded ?? null,
      assetsFailed: tier.stats?.assetsFailed ?? null, buildMs: ms, status: problems.length ? 'FAIL: ' + problems.join(', ') : 'PASS'
    });
    tier.dispose();
  } catch (err) {
    failed++;
    results.push({ name, ms: Date.now() - t0, status: 'ERROR: ' + (err && err.message ? err.message : String(err)), stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : '' });
  }
}

await server.close();

console.log(JSON.stringify(results, null, 1));
const lowPairs = results.filter((r) => r.name === 'valley' || r.name === 'valley-low');
if (lowPairs.length === 2) {
  const hi = lowPairs.find((r) => r.name === 'valley').tris;
  const lo = lowPairs.find((r) => r.name === 'valley-low').tris;
  const ok = lo < hi;
  if (!ok) failed++;
  console.log('lowQuality reduces valley triangles: ' + (ok ? 'PASS' : 'FAIL') + ' (' + hi + ' -> ' + lo + ')');
}
console.log(failed === 0 ? 'SMOKE PASS ' + results.length + '/' + results.length : 'SMOKE FAIL ' + failed);
process.exit(failed === 0 ? 0 : 1);
