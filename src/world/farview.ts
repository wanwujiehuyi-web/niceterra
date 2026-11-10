/**
 * WORLD-GONGGA-DISTANT — 贡嘎山三维远景（不可步行）
 * =============================================================================
 * 优先级（DESIGN_V2 §5）：山脊拓扑 > 群峰相对位置 > 谷地方向与遮挡 > 岩石纹理。
 *
 * 地形来自真实 DEM，不是手捏的山：
 *   Mapzen / Tilezen joerd Terrain Tiles（AWS Open Data elevation-tiles-prod，
 *   terrarium 编码，z12≈33 m/px 即 SRTM 30 m 原生）→ tools/dem-ingest.mjs →
 *   public/data/dem/gongga-farview.{json,bin}（三级 LOD，int16 米，行序 north→south）。
 *
 * 坐标：siteLocal ENU，x=东(m)，y=高程(EGM96 m，推断基准)，z=北(m)。
 *       参考原点 REF=(101.96E, 29.58N)，与 dem-ingest.mjs 的 REF 一致。
 *       远景色块相对于 REF 定位 → PARENT_RELATIVE。
 *
 * 诚实边界（必须随截图出现，meta/hud 里都有）：
 *  1) 地形 = 公开 DEM（区域参考 L3），不是本地实测；30 m 网格把峰顶削平约 130 m。
 *  2) 雪/冰/表碛/侧碛/林线 = 程序化图层（L4），layerDate 是场景标签，不是观测日期。
 *  3) 瓦片不含 provenance：影像获取日期 UNKNOWN，垂直基准 EGM96 为 INFERRED。
 *  4) 不参与近场碰撞，不得用于导航/边界/高程引用。
 */

import * as THREE from 'three';
import type { TierAnchor, TierCameraPose, TierOptions, TierStats, WorldTier } from './tier';

/* ========================================================================== *
 * 0. 常量与类型
 * ========================================================================== */

const DEM_BASE = '/data/dem/';

/** 与 tools/dem-ingest.mjs 的 REF 必须一致。 */
export const FARVIEW_REF = { lon: 101.96, lat: 29.58 };

/** 公开峰顶坐标：只用于方位描述与诚实比对，不参与几何生成。 */
export const GONGGA_SUMMIT_PUBLIC = {
  name: '贡嘎山 Minya Konka',
  lon: 101.8847,
  lat: 29.5953,
  elevM: 7556,
  note: '常用公开坐标（2005 年中国测量）；DEM 在 30 m 网格上把峰顶削平约 130 m，两者不可互换。',
};

export interface DemLevelHeader {
  id: string;
  extentM: number;
  cols: number;
  rows: number;
  spacingM: number;
  byteOffset: number;
  byteLength: number;
  bounds: { west: number; east: number; south: number; north: number };
  sourceZoom: number;
  stats: { min: number; max: number; mean: number; nodataCells: number };
}

export interface DemPeak {
  gridRow: number;
  gridCol: number;
  elevM: number;
  lon: number;
  lat: number;
  reliefWithin3kmM: number;
  note: string;
}

export interface DemHeader {
  schema: string;
  id: string;
  binBytes: number;
  binSha256: string;
  heightScale: number;
  heightOffset: number;
  ref: { lon: number; lat: number; name: string };
  metresPerDegree: { lat: number; lon: number };
  crs: { horizontal: string; renderFrame: string; regionalCandidate: string };
  verticalDatum: { value: string; status: string; note: string; accuracyM: string };
  source: Record<string, string>;
  license: Record<string, string>;
  processing: string[];
  levels: DemLevelHeader[];
  diagnostics: {
    demMaxElevM?: number;
    demMaxAt?: { lon: number; lat: number };
    deltaVsPublishedSummitM?: number;
    gridSampleAtPublishedSummit?: { r: number; c: number; elevM: number };
    deltaAtSummitCellM?: number;
    peaksDerived?: DemPeak[];
    honestNotes?: string[];
  };
  verification?: Array<Record<string, unknown>> | null;
  generatedAt: string;
}

export interface DemLevel {
  header: DemLevelHeader;
  heights: Float32Array;
}

export interface LoadedDem {
  header: DemHeader;
  levels: DemLevel[];
}

/* ========================================================================== *
 * 1. DEM 载入与采样
 * ========================================================================== */

let demCache: Promise<LoadedDem> | null = null;

/** 载入 public/data/dem。缺失时抛出带修复指引的错误（不静默降级）。 */
export function loadFarViewDem(): Promise<LoadedDem> {
  if (demCache) return demCache;
  demCache = (async () => {
    const jr = await fetch(DEM_BASE + 'gongga-farview.json', { cache: 'no-cache' });
    if (!jr.ok) {
      throw new Error('DEM 头部缺失 ' + DEM_BASE + 'gongga-farview.json (HTTP ' + jr.status + ')；先跑 node tools/dem-ingest.mjs');
    }
    const header = (await jr.json()) as DemHeader;
    const br = await fetch(DEM_BASE + 'gongga-farview.bin');
    if (!br.ok) throw new Error('DEM 数据缺失 ' + DEM_BASE + 'gongga-farview.bin (HTTP ' + br.status + ')');
    const buf = await br.arrayBuffer();
    if (buf.byteLength !== header.binBytes) {
      throw new Error('DEM bin 大小不符：期望 ' + header.binBytes + '，实际 ' + buf.byteLength);
    }
    const dv = new DataView(buf);
    const levels: DemLevel[] = header.levels.map((lv) => {
      const n = lv.cols * lv.rows;
      const heights = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        heights[i] = dv.getInt16(lv.byteOffset + i * 2, true) * header.heightScale + header.heightOffset;
      }
      return { header: lv, heights };
    });
    return { header, levels };
  })();
  return demCache;
}

export interface Projector {
  refLon: number;
  refLat: number;
  mPerDegLon: number;
  mPerDegLat: number;
  toWorldXZ(lon: number, lat: number): { x: number; z: number };
  toLonLat(x: number, z: number): { lon: number; lat: number };
}

/** 等距圆柱（WGS84 椭球在 REF 纬度的一阶近似；±48 km 内长度误差 <0.3%）。 */
export function makeProjector(header: DemHeader): Projector {
  const refLon = header.ref.lon;
  const refLat = header.ref.lat;
  const mPerDegLon = header.metresPerDegree.lon;
  const mPerDegLat = header.metresPerDegree.lat;
  return {
    refLon, refLat, mPerDegLon, mPerDegLat,
    toWorldXZ(lon: number, lat: number) {
      return { x: (lon - refLon) * mPerDegLon, z: -(lat - refLat) * mPerDegLat };
    },
    toLonLat(x: number, z: number) {
      return { lon: refLon + x / mPerDegLon, lat: refLat - z / mPerDegLat };
    },
  };
}

function bilinear(h: Float32Array, cols: number, rows: number, fx: number, fy: number): number {
  const x0 = Math.min(cols - 1, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(rows - 1, Math.max(0, Math.floor(fy)));
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const h00 = h[y0 * cols + x0];
  const h10 = h[y0 * cols + x1];
  const h01 = h[y1 * cols + x0];
  const h11 = h[y1 * cols + x1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}

export function sampleLevel(level: DemLevel, x: number, z: number, proj: Projector): number | null {
  const { lon, lat } = proj.toLonLat(x, z);
  const b = level.header.bounds;
  if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return null;
  const cols = level.header.cols;
  const rows = level.header.rows;
  const fx = ((lon - b.west) / (b.east - b.west)) * (cols - 1);
  const fy = ((b.north - lat) / (b.north - b.south)) * (rows - 1);
  return bilinear(level.heights, cols, rows, fx, fy);
}

/** 从细到粗找第一级覆盖该点的 DEM 并采样。 */
export function sampleHeightAt(dem: LoadedDem, x: number, z: number): number | null {
  const proj = makeProjector(dem.header);
  for (const lv of dem.levels) {
    const v = sampleLevel(lv, x, z, proj);
    if (v != null) return v;
  }
  return null;
}

/* ========================================================================== *
 * 2. 地表图层（程序化掩膜 + 日期预设）
 * ========================================================================== */

export interface LayerPreset {
  date: string;
  label: string;
  snowlineM: number;
  treelineM: number;
  debrisLineM: number;
  snowCover: number;
  hazeDensity: number;
  note: string;
}

/** 三档季节预设。全部是**制作档位**（L4），不是某天的卫星观测。 */
export const LAYER_PRESETS: LayerPreset[] = [
  { date: '2026-11-10', label: '初冬', snowlineM: 4750, treelineM: 3520, debrisLineM: 3900, snowCover: 1.0, hazeDensity: 0.000026, note: '11 月：雪线 4750 m，冰舌中下部裸冰+表碛，针叶林到 3520 m。' },
  { date: '2026-07-15', label: '雨季盛夏', snowlineM: 5150, treelineM: 3820, debrisLineM: 4050, snowCover: 0.92, hazeDensity: 0.00005, note: '7 月：雪线最高、雾最重，表碛区扩大。' },
  { date: '2026-02-01', label: '隆冬', snowlineM: 3450, treelineM: 3000, debrisLineM: 3300, snowCover: 1.0, hazeDensity: 0.000016, note: '2 月：雪线压到 3450 m，山脊全白，远景观测窗口。' },
];

export interface SurfaceLayerMeta {
  id: string;
  label: string;
  kind: 'DEM_DERIVED' | 'PROGRAMMATIC';
  layerDate: string;
  validTime: string;
  evidenceLevel: 'L3' | 'L4';
  note: string;
}

/** 海螺沟冰川走廊轴线：DESIGN_ONLY 人工种子，构建时吸附到 DEM 谷底（不是实测冰界）。 */
const GLACIER_AXIS_SEED = [
  { lon: 101.8830, lat: 29.5975, halfWidthM: 900 },
  { lon: 101.8930, lat: 29.6015, halfWidthM: 820 },
  { lon: 101.9040, lat: 29.6035, halfWidthM: 700 },
  { lon: 101.9150, lat: 29.6020, halfWidthM: 560 },
  { lon: 101.9270, lat: 29.5960, halfWidthM: 470 },
  { lon: 101.9400, lat: 29.5895, halfWidthM: 420 },
  { lon: 101.9530, lat: 29.5835, halfWidthM: 390 },
  { lon: 101.9650, lat: 29.5785, halfWidthM: 360 },
  { lon: 101.9770, lat: 29.5755, halfWidthM: 330 },
  { lon: 101.9880, lat: 29.5735, halfWidthM: 300 },
];

function smoothstepJs(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number): number => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) * (1 - u) + h(xi + 1, yi) * u;
  const b = h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

const GLACIER_AXIS_SEED_FIXED: typeof GLACIER_AXIS_SEED = GLACIER_AXIS_SEED;

function snapAxis(dem: LoadedDem, seed: typeof GLACIER_AXIS_SEED): Array<{ lon: number; lat: number; halfWidthM: number; elevM: number }> {
  const proj = makeProjector(dem.header);
  const out: Array<{ lon: number; lat: number; halfWidthM: number; elevM: number }> = [];
  for (let i = 0; i < seed.length; i++) {
    const p = seed[i];
    const prev = seed[Math.max(0, i - 1)];
    const next = seed[Math.min(seed.length - 1, i + 1)];
    const tx = (next.lon - prev.lon) * proj.mPerDegLon;
    const tz = -(next.lat - prev.lat) * proj.mPerDegLat;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl;
    const nz = tx / tl;
    const c = proj.toWorldXZ(p.lon, p.lat);
    let bestV = Infinity;
    let bestS = 0;
    for (let s = -1200; s <= 1200; s += 60) {
      const v = sampleLevel(dem.levels[0], c.x + nx * s, c.z + nz * s, proj)
        ?? sampleLevel(dem.levels[1], c.x + nx * s, c.z + nz * s, proj);
      if (v != null && v < bestV) { bestV = v; bestS = s; }
    }
    const ll = proj.toLonLat(c.x + nx * bestS, c.z + nz * bestS);
    out.push({ lon: ll.lon, lat: ll.lat, halfWidthM: p.halfWidthM, elevM: Math.round(bestV) });
  }
  return out;
}

interface MaskBuild {
  texture: THREE.DataTexture;
  rect: { west: number; east: number; south: number; north: number };
  note: string;
}

function distanceToAxis(px: number, pz: number, pts: Array<{ x: number; z: number; w: number }>): { d: number; w: number; t: number } {
  let best = { d: Infinity, w: 0, t: 0 };
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    segLen.push(l);
    total += l;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz;
    let t = l2 > 0 ? ((px - a.x) * vx + (pz - a.z) * vz) / l2 : 0;
    t = Math.min(1, Math.max(0, t));
    const d = Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
    if (d < best.d) best = { d, w: a.w + (b.w - a.w) * t, t: (acc + segLen[i] * t) / (total || 1) };
    acc += segLen[i];
  }
  return best;
}

function buildSurfaceMask(dem: LoadedDem, axis: Array<{ lon: number; lat: number; halfWidthM: number }>): MaskBuild {
  const proj = makeProjector(dem.header);
  const b = dem.levels[0].header.bounds;
  const rect = { west: b.west, east: b.east, south: b.south, north: b.north };
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const pts = axis.map((p) => {
    const w = proj.toWorldXZ(p.lon, p.lat);
    return { x: w.x, z: w.z, w: p.halfWidthM };
  });
  const snout = pts[pts.length - 1];

  for (let row = 0; row < size; row++) {
    const lat = rect.north - (row / (size - 1)) * (rect.north - rect.south);
    for (let col = 0; col < size; col++) {
      const lon = rect.west + (col / (size - 1)) * (rect.east - rect.west);
      const p = proj.toWorldXZ(lon, lat);
      const hit = distanceToAxis(p.x, p.z, pts);
      const h = sampleLevel(dem.levels[0], p.x, p.z, proj) ?? sampleLevel(dem.levels[1], p.x, p.z, proj) ?? 0;
      const inner = 1 - smoothstepJs(hit.w * 0.82, hit.w, hit.d);
      const ice = inner * (hit.t < 0.985 ? 1 : 0);
      const debrisFrac = ice * smoothstepJs(4150, 3250, h) * (0.55 + 0.45 * noise2(p.x * 0.0021, p.z * 0.0021));
      const lateral = smoothstepJs(1.28, 1.02, hit.d / Math.max(hit.w, 1))
        * smoothstepJs(0.92, 0.62, hit.d / Math.max(hit.w, 1))
        * smoothstepJs(0.30, 0.42, hit.t) * (1 - smoothstepJs(0.90, 0.985, hit.t));
      const ring = 1 - smoothstepJs(0.0, 420, Math.hypot(p.x - snout.x, p.z - snout.z));
      const moraine = Math.max(lateral, ring * smoothstepJs(2900, 2500, h));
      const o = (row * size + col) * 4;
      data[o] = Math.round(255 * ice);
      data[o + 1] = Math.round(255 * Math.min(1, debrisFrac));
      data[o + 2] = Math.round(255 * Math.min(1, moraine));
      data[o + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, rect, note: 'R=冰体 G=表碛 B=侧碛/终碛；覆盖 L0 24 km；走廊轴线 DESIGN_ONLY 种子 + DEM 谷底吸附' };
}

/* ========================================================================== *
 * 3. 着色器
 * ========================================================================== */

const VERT = `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uSnowColor;
uniform vec3 uIceColor;
uniform vec3 uRockColor;
uniform vec3 uForestColor;
uniform vec3 uDebrisColor;
uniform vec3 uMoraineColor;
uniform vec3 uHazeColor;
uniform float uSnowline;
uniform float uSnowNoise;
uniform float uTreeline;
uniform float uDebrisLine;
uniform float uSnowCover;
uniform float uHazeDensity;
uniform float uHazeScaleY;
uniform float uHazeBaseY;
uniform float uHazeGain;
uniform vec4 uRef;
uniform vec4 uMaskRect;
uniform sampler2D uMask;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}

void main() {
  vec3 P = vWorld;
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - P);
  float h = P.y;
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);

  float lon = uRef.x + P.x / uRef.z;
  float lat = uRef.y - P.z / uRef.w;
  vec2 muv = vec2((lon - uMaskRect.x) / (uMaskRect.y - uMaskRect.x),
                  (uMaskRect.w - lat) / (uMaskRect.w - uMaskRect.z));
  vec4 m = texture2D(uMask, clamp(muv, 0.0, 1.0));
  float inRect = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  float iceMask = m.r * inRect;
  float debrisMask = m.g * inRect;
  float moraineMask = m.b * inRect;

  float patchNoise = fbm(P.xz * 0.0007);
  float streak = fbm(vec2((P.x + P.z) * 0.0016, P.y * 0.009));
  vec3 rock = uRockColor * mix(0.70, 1.16, patchNoise) * mix(0.86, 1.12, streak);
  rock *= mix(1.0, 0.70, smoothstep(0.42, 0.95, slope));

  float clump = fbm(P.xz * 0.0035);
  float forest = smoothstep(uTreeline + 280.0, uTreeline - 340.0, h);
  forest *= smoothstep(0.62, 0.40, slope);
  forest *= smoothstep(0.26, 0.60, clump);
  vec3 forestCol = uForestColor * mix(0.74, 1.20, fbm(P.xz * 0.02));
  vec3 albedo = mix(rock, forestCol, clamp(forest, 0.0, 1.0));

  float sn = uSnowline + (fbm(P.xz * 0.0009) - 0.5) * uSnowNoise + (fbm(P.xz * 0.0041) - 0.5) * 90.0;
  float snow = smoothstep(sn - 150.0, sn + 170.0, h);
  snow *= 1.0 - smoothstep(0.58, 0.92, slope);
  snow = clamp(snow * uSnowCover, 0.0, 1.0);
  vec3 snowCol = uSnowColor * (0.94 + 0.06 * fbm(P.xz * 0.03));
  albedo = mix(albedo, snowCol, snow);

  vec3 iceCol = mix(uIceColor, uSnowColor, smoothstep(uSnowline - 200.0, uSnowline + 300.0, h));
  float ice = clamp(iceMask, 0.0, 1.0) * (1.0 - 0.50 * smoothstep(0.50, 0.90, slope));
  albedo = mix(albedo, iceCol, ice * 0.96);

  float debris = clamp(debrisMask, 0.0, 1.0) * smoothstep(uDebrisLine + 280.0, uDebrisLine - 320.0, h);
  vec3 debrisCol = uDebrisColor * mix(0.80, 1.16, fbm(P.xz * 0.012));
  albedo = mix(albedo, debrisCol, debris * (1.0 - 0.40 * snow));

  vec3 moraineCol = uMoraineColor * mix(0.84, 1.12, fbm(P.xz * 0.008));
  albedo = mix(albedo, moraineCol, clamp(moraineMask, 0.0, 1.0) * (1.0 - 0.55 * snow));

  float ndl = max(dot(n, uSunDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 amb = mix(uGroundColor, uSkyColor, sky);
  vec3 lit = albedo * (uSunColor * ndl * 1.32 + amb * 0.66);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(n, H), 0.0), 26.0) * (snow * 0.28 + ice * 0.44 + debris * 0.04);
  lit += uSunColor * spec * 0.55;

  float dist = length(cameraPosition - P);
  float hf = exp(-max(P.y - uHazeBaseY, 0.0) * uHazeScaleY);
  float fog = 1.0 - exp(-dist * uHazeDensity * hf);
  fog = clamp(fog * uHazeGain, 0.0, 0.94);
  float sunAmt = pow(max(dot(normalize(P - cameraPosition), uSunDir), 0.0), 4.0);
  vec3 haze = uHazeColor + uSunColor * sunAmt * 0.10;
  lit = mix(lit, haze, fog);

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ========================================================================== *
 * 4. 几何：网格 + 外缘裙边
 * ========================================================================== */

function buildLevelGeometry(level: DemLevel, step: number, skirtDepth: number): THREE.BufferGeometry {
  const { cols, rows, spacingM } = level.header;
  const h = level.heights;

  const idxC: number[] = [];
  for (let c = 0; c < cols; c += step) idxC.push(c);
  if (idxC[idxC.length - 1] !== cols - 1) idxC.push(cols - 1);
  const idxR: number[] = [];
  for (let r = 0; r < rows; r += step) idxR.push(r);
  if (idxR[idxR.length - 1] !== rows - 1) idxR.push(rows - 1);

  const nx = idxC.length;
  const ny = idxR.length;
  const pos = new Float32Array(nx * ny * 3);
  const nor = new Float32Array(nx * ny * 3);
  const cx = (cols - 1) / 2;
  const cz = (rows - 1) / 2;

  for (let r = 0; r < ny; r++) {
    const gr = idxR[r];
    for (let c = 0; c < nx; c++) {
      const gc = idxC[c];
      const x = (gc - cx) * spacingM;
      const z = (cz - gr) * spacingM;
      const y = h[gr * cols + gc];
      const i = (r * nx + c) * 3;
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      const cW = h[gr * cols + Math.max(0, gc - 1)];
      const cE = h[gr * cols + Math.min(cols - 1, gc + 1)];
      const cN = h[Math.max(0, gr - 1) * cols + gc];
      const cS = h[Math.min(rows - 1, gr + 1) * cols + gc];
      const dydx = (cE - cW) / (2 * spacingM);
      const dydz = (cN - cS) / (2 * spacingM);
      const nl = Math.hypot(dydx, 1, dydz);
      nor[i] = -dydx / nl; nor[i + 1] = 1 / nl; nor[i + 2] = -dydz / nl;
    }
  }

  const idx: number[] = [];
  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }

  const edgeNorth: number[] = [];
  const edgeSouth: number[] = [];
  const edgeWest: number[] = [];
  const edgeEast: number[] = [];
  for (let c = 0; c < nx; c++) { edgeNorth.push(c); edgeSouth.push((ny - 1) * nx + c); }
  for (let r = 0; r < ny; r++) { edgeWest.push(r * nx); edgeEast.push(r * nx + (nx - 1)); }
  const totalExtra = (edgeNorth.length + edgeSouth.length + edgeWest.length + edgeEast.length) * 2;
  const pos2 = new Float32Array(pos.length + totalExtra * 3);
  const nor2 = new Float32Array(nor.length + totalExtra * 3);
  pos2.set(pos); nor2.set(nor);
  let vp = pos.length / 3;
  const pushEdge = (list: number[]): void => {
    const base = vp;
    for (let i = 0; i < list.length; i++) {
      const vi = list[i] * 3;
      pos2[vp * 3] = pos[vi]; pos2[vp * 3 + 1] = pos[vi + 1]; pos2[vp * 3 + 2] = pos[vi + 2];
      nor2[vp * 3] = nor[vi]; nor2[vp * 3 + 1] = nor[vi + 1]; nor2[vp * 3 + 2] = nor[vi + 2];
      vp++;
      pos2[vp * 3] = pos[vi]; pos2[vp * 3 + 1] = pos[vi + 1] - skirtDepth; pos2[vp * 3 + 2] = pos[vi + 2];
      nor2[vp * 3] = nor[vi]; nor2[vp * 3 + 1] = nor[vi + 1]; nor2[vp * 3 + 2] = nor[vi + 2];
      vp++;
    }
    for (let i = 0; i < list.length - 1; i++) {
      const t0 = base + i * 2;
      const b0 = t0 + 1;
      const t1 = t0 + 2;
      const b1 = t0 + 3;
      const mx = (pos2[t0 * 3] + pos2[t1 * 3]) * 0.5;
      const mz = (pos2[t0 * 3 + 2] + pos2[t1 * 3 + 2]) * 0.5;
      const ex = pos2[t1 * 3] - pos2[t0 * 3];
      const ez = pos2[t1 * 3 + 2] - pos2[t0 * 3 + 2];
      const dot = (-ez) * mx + ex * mz;
      if (dot >= 0) idx.push(t0, b0, t1, t1, b0, b1);
      else idx.push(t0, t1, b0, t1, b1, b0);
    }
  };
  pushEdge(edgeNorth);
  pushEdge(edgeSouth);
  pushEdge(edgeWest);
  pushEdge(edgeEast);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor2, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/* ========================================================================== *
 * 5. 视线分析（CAM-HLG-C / W3D-02 的证据源）
 * ========================================================================== */

export interface LookFrom { lon: number; lat: number; eyeM: number }
export interface LookTo { lon: number; lat: number; altM: number }
export interface LineOfSightResult {
  visible: boolean;
  distanceM: number;
  observerEyeM: number;
  targetAltM: number;
  targetElevAngleDeg: number;
  maxTerrainElevAngleDeg: number;
  blocker: { lon: number; lat: number; terrainM: number; atM: number; clearanceM: number } | null;
  samples: number;
  method: string;
}

/** DEM 折线步进遮挡分析；不做地球曲率/折射修正（10–20 km 量级影响 <20 m）。 */
export function lineOfSight(dem: LoadedDem, from: LookFrom, to: LookTo): LineOfSightResult {
  const proj = makeProjector(dem.header);
  const a = proj.toWorldXZ(from.lon, from.lat);
  const b = proj.toWorldXZ(to.lon, to.lat);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const n = Math.max(2, Math.ceil(dist / Math.max(30, dist / 1200)));
  const targetAngle = Math.atan2(to.altM - from.eyeM, dist);
  let maxAngle = -Math.PI / 2;
  let blocker: LineOfSightResult['blocker'] = null;
  let samples = 0;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const terr = sampleHeightAt(dem, x, z);
    if (terr == null) continue;
    samples++;
    const d = dist * t;
    const ang = Math.atan2(terr - from.eyeM, d);
    if (ang > maxAngle) {
      maxAngle = ang;
      const rayY = from.eyeM + (to.altM - from.eyeM) * t;
      const ll = proj.toLonLat(x, z);
      blocker = {
        lon: Math.round(ll.lon * 1e6) / 1e6,
        lat: Math.round(ll.lat * 1e6) / 1e6,
        terrainM: Math.round(terr * 10) / 10,
        atM: Math.round(d),
        clearanceM: Math.round((rayY - terr) * 10) / 10,
      };
    }
  }
  const deg = (r: number): number => Math.round((r * 180 / Math.PI) * 100) / 100;
  return {
    visible: maxAngle <= targetAngle + 1e-4,
    distanceM: Math.round(dist),
    observerEyeM: Math.round(from.eyeM * 10) / 10,
    targetAltM: to.altM,
    targetElevAngleDeg: deg(targetAngle),
    maxTerrainElevAngleDeg: deg(maxAngle),
    blocker,
    samples,
    method: 'DEM 折线步进遮挡分析（L0 ' + dem.levels[0].header.spacingM + ' m 优先，超出退 L1）',
  };
}

/* ========================================================================== *
 * 6. 远景机位（DESIGN_ONLY，不是步道观景点）
 * ========================================================================== */

export interface FarPose {
  id: string;
  label: string;
  lon: number;
  lat: number;
  aboveTerrainM: number;
  targetLon: number;
  targetLat: number;
  targetAltM: number | 'terrain';
  fovDeg: number;
  note: string;
}

export const FARVIEW_POSES: FarPose[] = [
  {
    id: 'A', label: '群峰与谷地关系（东南 3/4）', lon: 102.012, lat: 29.498,
    aboveTerrainM: 1500, targetLon: 101.885, targetLat: 29.596, targetAltM: 'terrain',
    fovDeg: 46, note: '看主峰与东南侧群峰的前后遮挡关系。',
  },
  {
    id: 'B', label: '山脊拓扑侧视（南侧低空）', lon: 101.905, lat: 29.452,
    aboveTerrainM: 1100, targetLon: 101.905, targetLat: 29.615, targetAltM: 6200,
    fovDeg: 52, note: '只检查山脊层叠关系，不看纹理。',
  },
  {
    id: 'C', label: '谷底回望群峰（海螺沟样地一带）', lon: 101.9886, lat: 29.5731,
    aboveTerrainM: 120, targetLon: 101.885, targetLat: 29.596, targetAltM: 'terrain',
    fovDeg: 40, note: '从 GGFZH01 公开样地一带回望主峰；是否真的看得到要用 lineOfSight 验证（W3D-02）。',
  },
];

/* ========================================================================== *
 * 7. 主体
 * ========================================================================== */

export interface FarviewTier extends WorldTier {
  readonly id: string;
  poses: Record<string, TierCameraPose>;
  defaultPose: string;
  meta: {
    dem: {
      source: string;
      provider: string;
      endpoint: string;
      accessDate: string;
      acquisitionDate: string;
      resolution: string;
      crs: DemHeader['crs'];
      verticalDatum: DemHeader['verticalDatum'];
      license: DemHeader['license'];
      processing: string[];
      binSha256: string;
      levels: Array<{ id: string; spacingM: number; extentM: number; cols: number }>;
      demMaxElevM: number;
      demMaxAt: { lon: number; lat: number };
      deltaVsPublishedSummitM: number;
      verification: DemHeader['verification'];
      peaks: DemPeak[];
      peaksMethod?: string;
      honestNotes: string[];
    };
    layers: SurfaceLayerMeta[];
    limitations: string[];
    hud: string[];
  };
  dem: LoadedDem;
  projector: Projector;
  sampleHeight(x: number, z: number): number;
  setLayerDate(date: string): SurfaceLayerMeta;
  layerPresets: LayerPreset[];
  lineOfSight(from: LookFrom, to: LookTo): LineOfSightResult;
  /** 当前 LOD 与屏幕误差（诊断/证据） */
  lod: { level: string; screenErrorPx: number; cameraDistanceM: number; triangles: number; visibleLevels: string[] };
  hudLines(): string[];
}

/**
 * 构建贡嘎远景 tier。
 * 注意：本 tier 会把相机 far 推到 ~140 km（远景需要），并在 update 里维持；
 * 不要与近场 tier 同时挂在同一台相机上。
 */
export async function createFarviewTier(opts: TierOptions): Promise<FarviewTier> {
  const low = opts.lowQuality === true;
  const stats: TierStats = { assetsLoaded: 0, assetsFailed: 0, log: [] };
  const log = (s: string): void => { stats.log.push(s); };

  opts.onProgress?.(0, 4, '载入贡嘎 DEM');
  const dem = await loadFarViewDem();
  const proj = makeProjector(dem.header);
  opts.onProgress?.(1, 4, '吸附冰川走廊');
  const axis = snapAxis(dem, GLACIER_AXIS_SEED_FIXED);
  opts.onProgress?.(2, 4, '生成地表图层');
  const mask = buildSurfaceMask(dem, axis);
  opts.onProgress?.(3, 4, '构建三级地形');

  const preset = LAYER_PRESETS[0];
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.42, 0.55, 0.72).normalize() },
    uSunColor: { value: new THREE.Color(0xfff2dc) },
    uSkyColor: { value: new THREE.Color(0x9fc0e4) },
    uGroundColor: { value: new THREE.Color(0x5b5245) },
    uSnowColor: { value: new THREE.Color(0xf3f6fa) },
    uIceColor: { value: new THREE.Color(0xd7e6f2) },
    uRockColor: { value: new THREE.Color(0x5a554b) },
    uForestColor: { value: new THREE.Color(0x2f4028) },
    uDebrisColor: { value: new THREE.Color(0x6b6357) },
    uMoraineColor: { value: new THREE.Color(0x7f7769) },
    uHazeColor: { value: new THREE.Color(0xc3d5e6) },
    uSnowline: { value: preset.snowlineM },
    uSnowNoise: { value: 420 },
    uTreeline: { value: preset.treelineM },
    uDebrisLine: { value: preset.debrisLineM },
    uSnowCover: { value: preset.snowCover },
    uHazeDensity: { value: preset.hazeDensity },
    uHazeScaleY: { value: 1 / 2200 },
    uHazeBaseY: { value: 2600 },
    uHazeGain: { value: 1.0 },
    uRef: { value: new THREE.Vector4(proj.refLon, proj.refLat, proj.mPerDegLon, proj.mPerDegLat) },
    uMaskRect: { value: new THREE.Vector4(mask.rect.west, mask.rect.east, mask.rect.south, mask.rect.north) },
    uMask: { value: mask.texture },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.FrontSide,
    fog: false,
  });

  const group = new THREE.Group();
  group.name = 'WORLD-GONGGA-DISTANT';
  const terrainRoot = new THREE.Group();
  terrainRoot.name = 'GONGGA-DEM-LOD';
  group.add(terrainRoot);

  const step = low ? 2 : 1;
  const meshes: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0;
  dem.levels.forEach((lv, i) => {
    const geo = buildLevelGeometry(lv, step, 900);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'GONGGA-DEM-' + lv.header.id;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = i === 0;
    mesh.userData.levelIndex = i;
    meshes.push(mesh);
    terrainRoot.add(mesh);
    triangles += (geo.index ? geo.index.count : 0) / 3;
  });
  stats.assetsLoaded = dem.levels.length;
  log('DEM L0/L1/L2 ' + dem.levels.map((l) => l.header.cols + '²@' + l.header.spacingM + 'm').join(' / '));
  log('三角形 ' + Math.round(triangles));

  const layers: SurfaceLayerMeta[] = [
    { id: 'TERRAIN', label: '地形（DEM）', kind: 'DEM_DERIVED', layerDate: dem.header.source.accessDate ?? dem.header.generatedAt.slice(0, 10), validTime: '瓦片访问日 ' + (dem.header.source.accessDate ?? '?') + '；影像获取日期 UNKNOWN', evidenceLevel: 'L3', note: 'Tilezen/joerd terrarium（SRTM 30 m）→ 三级 LOD。区域参考级，不是本地实测。' },
    { id: 'SNOW', label: '雪盖（日期化）', kind: 'PROGRAMMATIC', layerDate: preset.date, validTime: preset.date + '（场景标签）', evidenceLevel: 'L4', note: '雪线 = 预设 + 420 m 噪声，坡度 >0.6 不挂雪。程序化，不是卫星雪盖产品。' },
    { id: 'ICE', label: '冰川冰/粒雪', kind: 'PROGRAMMATIC', layerDate: preset.date, validTime: preset.date + '（场景标签）', evidenceLevel: 'L4', note: '走廊轴线 DESIGN_ONLY 种子 + DEM 谷底吸附；冰体宽度/边界程序化，不是实测冰界。' },
    { id: 'DEBRIS', label: '表碛', kind: 'PROGRAMMATIC', layerDate: preset.date, validTime: preset.date + '（场景标签）', evidenceLevel: 'L4', note: '表碛覆盖率随高程降低而增加，边界带噪声；不是实测碎屑厚度。' },
    { id: 'MORAINE', label: '侧碛/终碛', kind: 'PROGRAMMATIC', layerDate: preset.date, validTime: preset.date + '（场景标签）', evidenceLevel: 'L4', note: '沿走廊外缘窄带 + 末端环带，示意位置。' },
    { id: 'FOREST', label: '森林坡面', kind: 'PROGRAMMATIC', layerDate: preset.date, validTime: preset.date + '（场景标签）', evidenceLevel: 'L4', note: '林线 + 坡度 + 团块噪声，避免等距同形（W3D-05）。' },
  ];
  let surface: SurfaceLayerMeta = layers[1];

  const setLayerDate = (date: string): SurfaceLayerMeta => {
    const p = LAYER_PRESETS.find((x) => x.date === date) ?? LAYER_PRESETS[0];
    uniforms.uSnowline.value = p.snowlineM;
    uniforms.uTreeline.value = p.treelineM;
    uniforms.uDebrisLine.value = p.debrisLineM;
    uniforms.uSnowCover.value = p.snowCover;
    uniforms.uHazeDensity.value = p.hazeDensity;
    for (const l of layers) {
      if (l.kind === 'PROGRAMMATIC') {
        l.layerDate = p.date;
        l.validTime = p.date + '（场景标签）';
      }
    }
    surface = layers[1];
    if (typeof document !== 'undefined') document.body.dataset.surfaceLayerDate = p.date;
    return surface;
  };

  const poses: Record<string, TierCameraPose> = {};
  for (const p of FARVIEW_POSES) {
    const e = proj.toWorldXZ(p.lon, p.lat);
    const t = proj.toWorldXZ(p.targetLon, p.targetLat);
    const eyeGround = sampleHeightAt(dem, e.x, e.z) ?? 4200;
    const tGround = sampleHeightAt(dem, t.x, t.z) ?? 6000;
    poses[p.id] = {
      position: [e.x, eyeGround + p.aboveTerrainM, e.z],
      target: [t.x, p.targetAltM === 'terrain' ? tGround : p.targetAltM, t.z],
    };
  }

  const lod = { level: dem.levels[0].header.id, screenErrorPx: 0, cameraDistanceM: 0, triangles: Math.round(triangles), visibleLevels: [dem.levels[0].header.id] };
  let lowQ = low;
  let current = 0;

  function selectLevel(camera: THREE.PerspectiveCamera): void {
    const fov = (camera.fov || 45) * Math.PI / 180;
    const heightPx = (camera.view as unknown as { height?: number } | null)?.height ?? 540;
    const k = heightPx / (2 * Math.tan(fov / 2));
    const dist = Math.max(1, camera.position.length());
    const budget = lowQ ? 3.2 : 1.8;
    let chosen = dem.levels.length - 1;
    for (let i = 0; i < dem.levels.length; i++) {
      const err = (dem.levels[i].header.spacingM / dist) * k;
      if (err <= budget) { chosen = i; break; }
    }
    if (chosen !== current) {
      for (let i = 0; i < meshes.length; i++) meshes[i].visible = i === chosen;
      current = chosen;
      lod.visibleLevels = [dem.levels[chosen].header.id];
    }
    const sp = dem.levels[chosen].header.spacingM;
    lod.level = dem.levels[chosen].header.id;
    lod.cameraDistanceM = Math.round(dist);
    lod.screenErrorPx = Math.round((sp / dist) * k * 100) / 100;
  }

  const hudLines = (): string[] => [
    'WORLD-GONGGA-DISTANT · 贡嘎远景（不可步行）',
    'DEM   Tilezen/joerd terrarium → SRTM 30 m (USGS) · 访问 ' + (dem.header.source.accessDate ?? '?'),
    'CRS   EPSG:4326 → siteLocal ENU x=东 y=高程 z=北 · REF ' + proj.refLon.toFixed(3) + 'E ' + proj.refLat.toFixed(3) + 'N',
    '基准  EGM96（推断 INFERRED）· 许可 USGS 公有领域 + Tilezen 署名',
    'DEM 最高 ' + (dem.header.diagnostics.demMaxElevM ?? 0) + ' m · 公开峰顶 7556 m · 差 ' + (dem.header.diagnostics.deltaVsPublishedSummitM ?? 0) + ' m（30 m 网格削平）',
    'LOD   ' + lod.level + ' · 屏幕误差 ' + lod.screenErrorPx + ' px · 相机距 ' + lod.cameraDistanceM + ' m',
    '图层  雪/冰/表碛/侧碛/林线 = 程序化 L4 · 日期 ' + surface.layerDate + '（不是观测）',
  ];

  if (typeof document !== 'undefined') {
    document.body.dataset.demSource =
      'Tilezen/joerd-terrarium(SRTM30m,USGS) z12/z11 access=' + (dem.header.source.accessDate ?? '?') +
      ' crs=EPSG:4326 vdatum=EGM96(INFERRED) license=pd+attrib sha256=' + dem.header.binSha256.slice(0, 16) +
      ' demMax=' + (dem.header.diagnostics.demMaxElevM ?? 0) + 'm';
    document.body.dataset.demSha256 = dem.header.binSha256;
    document.body.dataset.worldTier = 'far';
  }

  const tier: FarviewTier = {
    id: 'far',
    group,
    poses,
    defaultPose: 'A',
    anchors: [] as TierAnchor[], // 远景不可步行，按铁律不放站点锚点
    stats,
    dem,
    projector: proj,
    layerPresets: LAYER_PRESETS,
    lod,
    meta: {
      dem: {
        source: dem.header.source.name,
        provider: dem.header.source.provider,
        endpoint: dem.header.source.endpoint,
        accessDate: dem.header.source.accessDate ?? '',
        acquisitionDate: 'UNKNOWN（terrarium 瓦片不含影像获取日期）',
        resolution: 'z12 @29.6N ≈33 m/px（SRTM 30 m 原生）；z11 ≈66 m/px',
        crs: dem.header.crs,
        verticalDatum: dem.header.verticalDatum,
        license: dem.header.license,
        processing: dem.header.processing,
        binSha256: dem.header.binSha256,
        levels: dem.levels.map((l) => ({ id: l.header.id, spacingM: l.header.spacingM, extentM: l.header.extentM, cols: l.header.cols })),
        demMaxElevM: dem.header.diagnostics.demMaxElevM ?? 0,
        demMaxAt: dem.header.diagnostics.demMaxAt ?? { lon: 0, lat: 0 },
        deltaVsPublishedSummitM: dem.header.diagnostics.deltaVsPublishedSummitM ?? 0,
        verification: dem.header.verification ?? null,
        peaks: dem.header.diagnostics.peaksDerived ?? [],
        peaksMethod: 'L1 池化 + 5x5 局部极大 + 3 km 去重（DEM 派生，非权威峰顶坐标）',
        honestNotes: dem.header.diagnostics.honestNotes ?? [],
      },
      layers,
      limitations: [
        '地形是公开 DEM（区域参考 L3），不是海螺沟本地实测重建；峰顶被 30 m 网格削平约 130 m。',
        '雪/冰/表碛/侧碛/林线是程序化图层（L4），只保证「像这个季节」，不保证边界正确。',
        '垂直基准 EGM96 为推断；瓦片无 provenance，影像日期 UNKNOWN。',
        '远景不参与近场碰撞，不得用于导航、边界判定或高程引用。',
      ],
      hud: hudLines(),
    },
    sampleHeight(x: number, z: number): number {
      return sampleHeightAt(dem, x, z) ?? 0;
    },
    setLayerDate,
    lineOfSight(from: LookFrom, to: LookTo): LineOfSightResult {
      return lineOfSight(dem, from, to);
    },
    hudLines,
    update(dt: number, camera: THREE.PerspectiveCamera): void {
      void dt;
      if (camera.near > 2 || camera.far < 140000) {
        camera.near = 2;
        camera.far = 140000;
        camera.updateProjectionMatrix();
      }
      selectLevel(camera);
    },
    setQuality(lowQuality: boolean): void {
      lowQ = lowQuality;
      const s = lowQuality ? 2 : 1;
      geometries.length = 0;
      terrainRoot.children.slice().forEach((child, i) => {
        const mesh = child as THREE.Mesh;
        if (s !== 1) {
          // 低质量：整体减面（重建几何，dispose 旧几何）
          const geo = buildLevelGeometry(dem.levels[i], s, 900);
          mesh.geometry.dispose();
          mesh.geometry = geo;
          geometries.push(geo);
        }
      });
      current = -1;
    },
    dispose(): void {
      material.dispose();
      mask.texture.dispose();
      for (const g of geometries) g.dispose();
      terrainRoot.children.slice().forEach((c) => {
        const m = c as THREE.Mesh;
        m.geometry.dispose();
      });
      group.removeFromParent();
      terrainRoot.clear();
    },
  };
  opts.onProgress?.(4, 4, '贡嘎远景就绪');
  return tier;
}
