#!/usr/bin/env node
/**
 * dem-ingest.mjs — NiceTerra v2 · WORLD-GONGGA-DISTANT 远景 DEM 摄取器
 * ---------------------------------------------------------------------------
 * 把「Mapzen / Tilezen joerd Terrain Tiles（AWS Open Data: elevation-tiles-prod）」
 * 的 terrarium 编码 PNG 瓦片，摄取成 NiceTerra 远景可用的分级高程网格。
 *
 * 这个脚本存在的唯一理由：远景（贡嘎）不允许用手搓山形。层规范 spec/01 要求
 * WORLD-GONGGA-DISTANT 的 source = 「有来源、日期与许可的 DEM」。所以这里记录
 * 真实的下载日期、瓦片坐标、原始数据源（SRTM/GMTED）、CRS、垂直基准、许可，
 * 并把处理链与诊断（最高点 vs 公开峰顶高程的差额）落盘，供 HUD/元数据直接引用。
 *
 * 用法：
 *   node tools/dem-ingest.mjs                     # 抓瓦片 + 生成网格（默认）
 *   node tools/dem-ingest.mjs --verify            # 额外用 opentopodata(srtm30m) 交叉校验
 *   node tools/dem-ingest.mjs --no-cache          # 忽略本地瓦片缓存
 *   node tools/dem-ingest.mjs --zoom 13           # 换源瓦片级别（默认按 LOD 自动分档）
 *   node tools/dem-ingest.mjs --out public/data/dem
 *
 * 产物（默认 public/data/dem/）：
 *   gongga-farview.bin   int16 LE 高程（米），三级 LOD 依次拼接
 *   gongga-farview.json  头部：CRS/垂直基准/来源/日期/许可/处理链/诊断/统计
 *
 * 诚实边界（会写进 json，也会被 farview.ts 读进 meta）：
 *   - terrarium 瓦片本身不带 provenance；「本区为 SRTM 30m」是根据 tilezen joerd
 *     的数据源表 + 该纬度无更高精度公开覆盖推断的，标记为 inferred，不是瓦片自述。
 *   - SRTM 高程为 EGM96 大地水准面正高，垂直精度约 ±10 m 量级，不是 2005 年中国
 *     测量的 7556 m 椭球/正高体系；峰顶常被 30 m 网格削平。差值是数据事实，不是 bug。
 *   - 本网格是「用于远景造型与视线分析的地形」而不是测绘成果，不得用于导航/边界。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'dem-tiles');

/* ------------------------------------------------------------------ *
 * 0. 配置：区域、参考原点、LOD 网格
 * ------------------------------------------------------------------ */

/** ENU 参考原点（siteLocal 原点）：远景网格的 (0,0,0)。选在海螺沟谷口一带。 */
export const REF = { lon: 101.96, lat: 29.58, name: 'HLG-REF' };

/** 公开坐标，仅用于「不许把区域代表点当峰顶」的自检，不参与网格生成。 */
export const PUBLISHED = {
  gonggaSummit: { name: '贡嘎山 Minya Konka', lon: 101.8847, lat: 29.5953, elevM: 7556, ref: '常用公开坐标（2005 年中国测量），非本 DEM 值' },
  plot: { name: 'GGFZH01', lon: 101.9886, lat: 29.5731, elevM: 3160, ref: '公开样地；verticalDatum UNKNOWN' },
};

/** WGS84 椭球在 REF 处的每度米长（纬向/经向），用于经纬度 ↔ ENU 的等距圆柱近似。 */
export function metresPerDegree(latDeg) {
  const p = (latDeg * Math.PI) / 180;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  const mPerDegLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  return { mPerDegLat, mPerDegLon, mPerDegLatM: mPerDegLat };
}

/**
 * 三级 LOD。extentM = 正方形边长（米，以 REF 为中心）。
 * samples 决定网格分辨率与几何面数；spacing = extentM / (samples-1)。
 */
const LODS = [
  // L0 半径 12 km：从谷口一带回看群峰时，峰顶（REF 西 7.3 km）与其西坡都要在窗口内。
  { id: 'L0', extentM: 24000, samples: 320, zoom: 12 },
  { id: 'L1', extentM: 40000, samples: 224, zoom: 12 },
  { id: 'L2', extentM: 96000, samples: 160, zoom: 11 },
];

/* ------------------------------------------------------------------ *
 * 1. Web Mercator / terrarium
 * ------------------------------------------------------------------ */

const TILE = 256;
function lon2tileX(lon, z) { return ((lon + 180) / 360) * Math.pow(2, z); }
function lat2tileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileX2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tileY2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/* ---- 极小 PNG 解码器（只支持 8bit RGB/RGBA、非隔行 —— terrarium 就是这样） ---- */

function readPng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('PNG without IHDR');
  if (ihdr.bitDepth !== 8) throw new Error('only 8-bit PNG supported, got ' + ihdr.bitDepth);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = ihdr.colorType === 2 ? 3 : ihdr.colorType === 6 ? 4 : ihdr.colorType === 0 ? 1 : -1;
  if (channels < 0) throw new Error('unsupported colorType ' + ihdr.colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const { width: W, height: H } = ihdr;
  const stride = W * channels;
  const out = Buffer.alloc(H * stride);
  let rp = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[rp++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rp++];
      const a = i >= channels ? out[rowStart + i - channels] : 0;
      const b = y > 0 ? out[prevStart + i] : 0;
      const c = y > 0 && i >= channels ? out[prevStart + i - channels] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p0 = a + b - c;
          const pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + ft);
      }
      out[rowStart + i] = v & 0xff;
    }
  }
  return { width: W, height: H, channels, data: out };
}

/** terrarium: elev = (R * 256 + G + B / 256) - 32768 */
function terrariumToFloat(png) {
  const { width: W, height: H, channels, data } = png;
  const f = new Float32Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += channels) {
    f[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
  }
  return f;
}

/* ------------------------------------------------------------------ *
 * 2. 瓦片抓取（带磁盘缓存 + 重试）
 * ------------------------------------------------------------------ */

const TILE_HOSTS = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(z, x, y, { noCache = false, retries = 3 } = {}) {
  const file = path.join(CACHE_DIR, String(z), String(x), y + '.png');
  if (!noCache && existsSync(file)) {
    return { buf: await readFile(file), cached: true, bytes: (await stat(file)).size };
  }
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const host = TILE_HOSTS[attempt % TILE_HOSTS.length];
    const url = host + '/' + z + '/' + x + '/' + y + '.png';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'NiceTerra-v2/dem-ingest (research; contact: repo owner)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error('suspiciously small tile ' + buf.length);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, buf);
      return { buf, cached: false, bytes: buf.length, url };
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error('tile fetch failed z' + z + '/' + x + '/' + y + ': ' + (lastErr && lastErr.message));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. 单级 LOD：抓瓦片 → 拼 mosaics → 区域平均重采样
 * ------------------------------------------------------------------ */

async function buildLevel(level, opts) {
  const { mPerDegLat, mPerDegLon } = metresPerDegree(REF.lat);
  const half = level.extentM / 2;
  const west = REF.lon - half / mPerDegLon;
  const east = REF.lon + half / mPerDegLon;
  const north = REF.lat + half / mPerDegLat;
  const south = REF.lat - half / mPerDegLat;

  const z = level.zoom;
  const tx0 = Math.max(0, Math.floor(lon2tileX(west, z)));
  const tx1 = Math.min(Math.pow(2, z) - 1, Math.floor(lon2tileX(east, z)));
  const ty0 = Math.max(0, Math.floor(lat2tileY(north, z))); // 北 = 较小的 y
  const ty1 = Math.min(Math.pow(2, z) - 1, Math.floor(lat2tileY(south, z)));

  const nx = tx1 - tx0 + 1;
  const ny = ty1 - ty0 + 1;
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty]);

  const W = nx * TILE;
  const H = ny * TILE;
  const mosaic = new Float32Array(W * H);

  const results = await mapLimit(tiles, 8, async ([tx, ty]) => fetchTile(z, tx, ty, opts));
  let bytes = 0, fetched = 0;
  results.forEach((r) => { bytes += r.bytes; if (!r.cached) fetched++; });

  tiles.forEach(([tx, ty], k) => {
    const px = (tx - tx0) * TILE;
    const py = (ty - ty0) * TILE;
    const png = readPng(results[k].buf);
    const f = terrariumToFloat(png);
    for (let r = 0; r < TILE; r++) {
      for (let c = 0; c < TILE; c++) {
        mosaic[(py + r) * W + (px + c)] = f[r * TILE + c];
      }
    }
  });

  // mosaics 的精确经纬度范围
  const mWest = tileX2lon(tx0, z);
  const mEast = tileX2lon(tx1 + 1, z);
  const mNorth = tileY2lat(ty0, z);
  const mSouth = tileY2lat(ty1 + 1, z);

  // 目标网格：以 REF 为中心、边长 extentM 的正方形（等距圆柱近似）
  const n = level.samples;
  const heights = new Float32Array(n * n);
  const spacingM = level.extentM / (n - 1);
  let min = Infinity, max = -Infinity, sum = 0, nodata = 0;
  let minLatLon = [0, 0], maxLatLon = [0, 0];

  for (let r = 0; r < n; r++) {
    // 行 0 = 最北
    const lat = north - (r / (n - 1)) * (north - south);
    for (let c = 0; c < n; c++) {
      const lon = west + (c / (n - 1)) * (east - west);
      // 单元边界（半格外扩，做面积平均而不是点采样）
      const halfLat = (north - south) / (n - 1) / 2;
      const halfLon = (east - west) / (n - 1) / 2;
      const la0 = lat - halfLat, la1 = lat + halfLat;
      const lo0 = lon - halfLon, lo1 = lon + halfLon;

      const px0 = ((lo0 - mWest) / (mEast - mWest)) * W;
      const px1 = ((lo1 - mWest) / (mEast - mWest)) * W;
      const py0 = ((mNorth - la1) / (mNorth - mSouth)) * H;
      const py1 = ((mNorth - la0) / (mNorth - mSouth)) * H;

      const ix0 = Math.max(0, Math.floor(px0)), ix1 = Math.min(W - 1, Math.ceil(px1) - 1);
      const iy0 = Math.max(0, Math.floor(py0)), iy1 = Math.min(H - 1, Math.ceil(py1) - 1);
      let acc = 0, cnt = 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const v = mosaic[iy * W + ix];
          if (!Number.isFinite(v) || v < -1200 || v > 9000) continue;
          acc += v; cnt++;
        }
      }
      let hv;
      if (cnt === 0) {
        // 兜底：最近邻（记录数量，绝不静默）
        const cx = Math.min(W - 1, Math.max(0, Math.round((px0 + px1) / 2)));
        const cy = Math.min(H - 1, Math.max(0, Math.round((py0 + py1) / 2)));
        hv = mosaic[cy * W + cx];
        nodata++;
        if (!Number.isFinite(hv)) hv = -32768;
      } else hv = acc / cnt;

      heights[r * n + c] = hv;
      if (hv < min) { min = hv; minLatLon = [lon, lat]; }
      if (hv > max) { max = hv; maxLatLon = [lon, lat]; }
      sum += hv;
    }
  }

  return {
    level, z, heights, n, spacingM,
    bounds: { west, east, south, north },
    tileRange: { z, x: [tx0, tx1], y: [ty0, ty1], count: tiles.length },
    mosaicBounds: { west: mWest, east: mEast, south: mSouth, north: mNorth },
    stats: {
      min: round1(min), max: round1(max), mean: round1(sum / (n * n)),
      minAt: { lon: round6(minLatLon[0]), lat: round6(minLatLon[1]) },
      maxAt: { lon: round6(maxLatLon[0]), lat: round6(maxLatLon[1]) },
      nodataCells: nodata,
    },
    tileBytes: bytes, tilesFetched: fetched,
  };
}

/* ------------------------------------------------------------------ *
 * 4. 诊断：峰顶检测 / 与公开值比对 / 视线资源
 * ------------------------------------------------------------------ */

function round1(v) { return Math.round(v * 10) / 10; }
function round6(v) { return Math.round(v * 1e6) / 1e6; }

/**
 * 在 L0 网格上找区域峰顶：先按 ~1.5 km 做最大池化（避免沿山脊线的大量"平台微极大"），
 * 再在池化网格上取 5×5 局部极大，按 3 km 最小间距去重。
 * 这些是 DEM 派生值，不是权威峰顶坐标；报告里必须与公开坐标分别标注。
 */
function findPeaks(lv, limit = 6, coarseM = 1500, minSepM = 3000) {
  const { heights: h, n } = lv;
  const sp = lv.spacingM;
  const factor = Math.max(1, Math.round(coarseM / sp));
  const nc = Math.floor(n / factor);
  const coarse = new Float32Array(nc * nc);
  const where = new Int32Array(nc * nc); // 池化单元内的细网格索引
  for (let cr = 0; cr < nc; cr++) {
    for (let cc = 0; cc < nc; cc++) {
      let best = -Infinity, bi = -1;
      for (let r = cr * factor; r < Math.min(n, (cr + 1) * factor); r++) {
        for (let c = cc * factor; c < Math.min(n, (cc + 1) * factor); c++) {
          const v = h[r * n + c];
          if (v > best) { best = v; bi = r * n + c; }
        }
      }
      coarse[cr * nc + cc] = best;
      where[cr * nc + cc] = bi;
    }
  }

  const cand = [];
  for (let cr = 0; cr < nc; cr++) {
    for (let cc = 0; cc < nc; cc++) {
      const v = coarse[cr * nc + cc];
      let isMax = true;
      for (let dr = -2; dr <= 2 && isMax; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = cr + dr, c2 = cc + dc;
          if (rr < 0 || c2 < 0 || rr >= nc || c2 >= nc) continue;
          if (coarse[rr * nc + c2] > v + 0.05) { isMax = false; break; }
        }
      }
      if (isMax) cand.push({ cr, cc, v, fine: where[cr * nc + cc] });
    }
  }
  cand.sort((a, b) => b.v - a.v);
  const candidatesScanned = cand.length;

  const stepM = factor * sp;
  const picked = [];
  // 注意：picked 里存的是输出条目（gridRow/gridCol），去重要单独记池化坐标，
  // 否则 q.cr 为 undefined -> NaN -> 只有第一个峰能通过（这个 bug 真出现过）。
  const taken = [];
  for (const p of cand) {
    if (picked.length >= limit) break;
    const ok = taken.every((q) => Math.hypot((p.cr - q.cr) * stepM, (p.cc - q.cc) * stepM) >= minSepM);
    if (!ok) continue;
    taken.push({ cr: p.cr, cc: p.cc });
    const r = Math.floor(p.fine / n), c = p.fine % n;
    const lon = lv.bounds.west + (c / (n - 1)) * (lv.bounds.east - lv.bounds.west);
    const lat = lv.bounds.north - (r / (n - 1)) * (lv.bounds.north - lv.bounds.south);
    // 相对起伏：峰点 3 km 半径内最低值
    const rad = Math.round(3000 / sp);
    let low = p.v;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const v2 = h[rr * n + cc];
        if (v2 < low) low = v2;
      }
    }
    picked.push({
      gridRow: r, gridCol: c, elevM: round1(p.v), lon: round6(lon), lat: round6(lat),
      reliefWithin3kmM: round1(p.v - low), note: 'DEM 派生区域最高点，不是权威峰顶坐标',
    });
  }
  return { peaks: picked, candidatesScanned, coarseStepM: round1(stepM) };
}

function nearestGridSample(lv, lon, lat) {
  const { bounds, n, heights } = lv;
  const c = Math.round(((lon - bounds.west) / (bounds.east - bounds.west)) * (n - 1));
  const r = Math.round(((bounds.north - lat) / (bounds.north - bounds.south)) * (n - 1));
  if (r < 0 || c < 0 || r >= n || c >= n) return null;
  return { r, c, elevM: round1(heights[r * n + c]) };
}

/** opentopodata 交叉校验：同一位置的 SRTM30m 服务值 vs 本网格值（同为 SRTM 家族，只能验证投影/摄取）。 */
async function verifyAgainstSRTM(levels) {
  const l0 = levels[0];
  const probes = [
    { name: 'gongga-summit-area', lon: PUBLISHED.gonggaSummit.lon, lat: PUBLISHED.gonggaSummit.lat },
    { name: 'ref-origin', lon: REF.lon, lat: REF.lat },
    { name: 'plot-GGFZH01', lon: PUBLISHED.plot.lon, lat: PUBLISHED.plot.lat },
    { name: 'valley-south', lon: 102.02, lat: 29.55 },
    { name: 'ridge-west', lon: 101.9, lat: 29.64 },
    { name: 'glacier-tongue', lon: 101.95, lat: 29.62 },
  ];
  const out = [];
  for (const p of probes) {
    const local = nearestGridSample(l0, p.lon, p.lat);
    const url = 'https://api.opentopodata.org/v1/srtm30m?locations=' + p.lat + ',' + p.lon;
    let api = null, err = null;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'NiceTerra-v2/dem-ingest' } });
      if (res.ok) {
        const j = await res.json();
        api = j.results && j.results[0] ? j.results[0].elevation : null;
      } else err = 'HTTP ' + res.status;
    } catch (e) { err = e.message; }
    out.push({
      ...p,
      gridElevM: local ? local.elevM : null,
      gridCell: local ? { row: local.r, col: local.c } : null,
      srtm30mApiElevM: api,
      deltaM: api != null && local ? round1(local.elevM - api) : null,
      note: '同源校验（SRTM 家族），只证明投影/瓦片摄取正确，不证明绝对高程精度',
      error: err,
    });
    await sleep(1100); // opentopodata 免费档限速 1 req/s
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 5. 主流程
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const o = { verify: false, noCache: false, out: path.join(ROOT, 'public', 'data', 'dem'), zoomOverride: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verify') o.verify = true;
    else if (a === '--no-cache') o.noCache = true;
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--zoom') o.zoomOverride = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log('见文件头注释'); process.exit(0); }
    else { console.error('unknown arg: ' + a); process.exit(2); }
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv);
  const startedAt = new Date();
  const lods = LODS.map((l) => (opts.zoomOverride ? { ...l, zoom: opts.zoomOverride } : l));

  console.log('[dem-ingest] REF=' + REF.lon + ',' + REF.lat + '  target=' + opts.out);
  const levels = [];
  for (const l of lods) {
    process.stdout.write('[dem-ingest] ' + l.id + ' extent=' + l.extentM / 1000 + 'km samples=' + l.samples + ' z=' + l.zoom + ' ... ');
    const lv = await buildLevel(l, { noCache: opts.noCache });
    const sp = (lv.bounds.north - lv.bounds.south);
    console.log(
      'tiles=' + lv.tileRange.count + ' (fetched ' + lv.tilesFetched + ') ' +
      'elev=' + lv.stats.min + '..' + lv.stats.max + 'm mean=' + lv.stats.mean + ' ' +
      'spacing=' + round1(lv.spacingM) + 'm',
    );
    void sp;
    levels.push(lv);
  }

  // 落盘：bin（三级拼接）+ json 头
  const total = levels.reduce((a, l) => a + l.n * l.n * 2, 0);
  const bin = Buffer.alloc(total);
  let off = 0;
  const levelMeta = levels.map((lv) => {
    const bytes = lv.n * lv.n * 2;
    for (let i = 0; i < lv.n * lv.n; i++) {
      bin.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(lv.heights[i]))), off + i * 2);
    }
    const m = {
      id: lv.level.id,
      extentM: lv.level.extentM,
      cols: lv.n, rows: lv.n,
      spacingM: round1(lv.spacingM),
      byteOffset: off, byteLength: bytes,
      bounds: {
        west: round6(lv.bounds.west), east: round6(lv.bounds.east),
        south: round6(lv.bounds.south), north: round6(lv.bounds.north),
      },
      rowOrder: 'north-to-south',
      sourceZoom: lv.tileRange.z,
      sourceTiles: lv.tileRange,
      stats: lv.stats,
    };
    off += bytes;
    return m;
  });

  const l0 = levels[0];
  // 用 L1（40 km / 179 m）找区域群峰：L0 只有 16 km，池化后窗口太大只剩一个极大。
  const peakScan = findPeaks(levels[1]);
  const peaks = peakScan.peaks;
  const summitPublished = PUBLISHED.gonggaSummit;
  const localAtSummit = nearestGridSample(l0, summitPublished.lon, summitPublished.lat);
  const delta = l0.stats.max - summitPublished.elevM;

  let verification = null;
  if (opts.verify) {
    console.log('[dem-ingest] cross-check opentopodata srtm30m ...');
    verification = await verifyAgainstSRTM(levels);
    verification.forEach((v) => console.log('   ' + v.name.padEnd(18) + ' grid=' + v.gridElevM + ' api=' + v.srtm30mApiElevM + ' Δ=' + v.deltaM));
  }

  const sha = createHash('sha256').update(bin).digest('hex');

  const header = {
    schema: 'niceterra.dem.v1',
    id: 'GONGGA-DISTANT-DEM',
    asset: 'WORLD-GONGGA-DISTANT',
    bin: 'gongga-farview.bin',
    binBytes: bin.length,
    binSha256: sha,
    dtype: 'int16',
    endian: 'little',
    heightScale: 1,
    heightOffset: 0,
    nodata: -32768,
    rowOrder: 'north-to-south',

    ref: { ...REF, note: 'siteLocal ENU 原点；渲染 x=东, y=高程, z=-北' },
    metresPerDegree: {
      lat: round1(metresPerDegree(REF.lat).mPerDegLat),
      lon: round1(metresPerDegree(REF.lat).mPerDegLon),
      note: 'WGS84 椭球在 REF 纬度的一阶近似（等距圆柱），±48 km 内长度误差 <0.3%',
    },
    crs: {
      horizontal: 'EPSG:4326 (WGS84 geographic), sampled via Web Mercator (EPSG:3857) tile grid',
      renderFrame: 'siteLocal ENU tangent plane at REF (x=east, y=up, z=-north), metres, float32',
      regionalCandidate: 'EPSG:32647 未复核（见 WORK_BASELINE_V2 §五套坐标）',
    },
    verticalDatum: {
      value: 'EGM96 orthometric height (SRTM)',
      status: 'INFERRED',
      note: 'terrarium 瓦片不含 provenance；按 tilezen joerd 数据源表推断本区为 SRTM 30m/EGM96。不是 1985 国家高程基准，也不是椭球高。',
      accuracyM: '±10 量级（SRTM 标称 16 m LE90）',
    },
    source: {
      name: 'Mapzen / Tilezen joerd Terrain Tiles (AWS Open Data)',
      provider: 'Terrain Tiles — elevation-tiles-prod (us-east-1)',
      endpoint: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      encoding: 'terrarium RGB',
      underlying: 'SRTM 30m (本区；GMTED2010 兜底) courtesy of the U.S. Geological Survey',
      accessedAt: startedAt.toISOString(),
      accessDate: startedAt.toISOString().slice(0, 10),
      tilesetVersion: 'UNKNOWN（桶内瓦片无版本号；tilezen joerd 最后更新未知）',
      resolutionNote: 'z12 @29.6N ≈ 33 m/px ≈ SRTM 30 m 原生；z11 ≈ 66 m/px',
    },
    license: {
      id: 'Public domain (USGS SRTM) + attribution required by Tilezen',
      attribution: 'United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.',
      citation: 'Terrain Tiles was accessed on ' + startedAt.toISOString().slice(0, 10) + ' from https://registry.opendata.aws/terrain-tiles.',
      registry: 'https://registry.opendata.aws/terrain-tiles/',
      attributionDoc: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
      managedBy: 'Mapzen, a Linux Foundation project (tilezen/joerd)',
      redistribution: 'OK（属公有领域 USGS 数据；保留上述 attribution）',
    },
    processing: [
      'fetch terrarium PNG tiles (z12 for L0/L1, z11 for L2) from elevation-tiles-prod',
      'decode PNG (zlib inflate + per-row unfilter), terrarium -> float metres: (R*256+G+B/256)-32768',
      'mosaic tiles into a single geographic raster (row 0 = north)',
      'area-average resample onto a REF-centred square grid per LOD (equal-area box filter, not point sampling)',
      'reject non-finite / <-1200 m / >9000 m cells before averaging (counted as nodata)',
      'round to int16 metres, store little-endian; heights are EGM96 orthometric metres',
      'no smoothing, no pit-filling, no vertical-datum shift applied (raw SRTM-derived surface)',
    ],
    levels: levelMeta,
    diagnostics: {
      publishedSummit: summitPublished,
      demMaxElevM: l0.stats.max,
      demMaxAt: l0.stats.maxAt,
      deltaVsPublishedSummitM: round1(delta),
      gridSampleAtPublishedSummit: localAtSummit,
      deltaAtSummitCellM: localAtSummit ? round1(localAtSummit.elevM - summitPublished.elevM) : null,
      peaksDerived: peaks,
      peaksCandidatesScanned: peakScan.candidatesScanned,
      peaksMethod: 'L1 网格（40 km, 179 m）先按 ~1.5 km 最大池化，再取 5x5 局部极大（容差 5 cm），3 km 最小间距去重',
      honestNotes: [
        'SRTM 30 m 网格无法表达 7556 m 的尖峰：峰顶被削平，本网格最高点几乎必然低于公开峰顶高程。',
        '不得把本网格最高点当作贡嘎主峰坐标；峰顶相对位置用公开坐标，高程用 DEM 派生值并标注来源。',
        'terrarium 瓦片无 provenance，垂直基准为推断（INFERRED）；如需权威基准需换 Copernicus GLO-30/ASTER GDEM 并重新登记。',
        '本产物是远景造型/视线分析用地形，不是测绘成果，不得用于导航、边界或高程引用。',
      ],
    },
    verification: verification,
    generatedAt: startedAt.toISOString(),
    generator: 'tools/dem-ingest.mjs',
  };

  await mkdir(opts.out, { recursive: true });
  await writeFile(path.join(opts.out, 'gongga-farview.bin'), bin);
  await writeFile(path.join(opts.out, 'gongga-farview.json'), JSON.stringify(header, null, 2) + '\n');

  console.log('[dem-ingest] wrote ' + path.join(opts.out, 'gongga-farview.bin') + ' (' + bin.length + ' B)');
  console.log('[dem-ingest] wrote ' + path.join(opts.out, 'gongga-farview.json'));
  console.log('[dem-ingest] DEM max ' + l0.stats.max + ' m at ' + JSON.stringify(l0.stats.maxAt) +
    ' | published 7556 m | delta ' + round1(delta) + ' m');
  console.log('[dem-ingest] peaks: candidates=' + peakScan.candidatesScanned + ' picked=' + peaks.length);
  peaks.slice(0, 6).forEach((p, i) => console.log('   peak' + (i + 1) + ' ' + p.elevM + ' m @ ' + p.lon + ',' + p.lat + ' relief3km=' + p.reliefWithin3kmM));
}

main().catch((e) => { console.error('[dem-ingest] FAILED:', e && e.stack ? e.stack : e); process.exit(1); });
