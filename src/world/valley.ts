/**
 * VALLEY-HLG-MID — 海螺沟谷地中景（可导览，不可自由步行到冰面）
 * =============================================================================
 * 六类要素必须**不看文字也能区分**（DESIGN_V2 §6.1 / W3D-03）：
 *   1 粒雪盆   2 冰瀑与裂隙   3 表碛冰舌   4 侧碛与终碛   5 冰前河道   6 森林坡面
 * 外加 7 谷地云雾（只表达谷深与天气，不遮盖要素）。
 *
 * 几何是**文献/冰川地貌形态的程序化复原（L3/L4）**，不是实测冰界：
 *   - 冰舌边界、表碛厚度、侧碛位置都没有实测数据；这里只保证形态关系与相对位置像
 *     一条表碛覆盖型温冰川谷（海螺沟的地貌类型），并在 meta 里逐项声明。
 *   - 冰川边界/DEM 日期：UNKNOWN。不得声称是某年的实测冰面。
 *   - 坐标：DESIGN_ONLY 谷地当地系；渲染 x=东, y=高程(m), z=南(= -北)。
 *     谷底海拔按真实量级压缩（冰舌末端 ~2900 m，粒雪盆 ~4450 m，跨度 1.8 km），
 *     因为中景是导览尺度，不是地形测量尺度。
 *
 * 资产：public/assets/v2 的 2 个针叶树 GLB 走 loadGLB + fitObject，
 * 只做近景 hero 树（远景树带用程序化锥体，避免 27k 个 GLB 实例）。
 * lowQuality 真的减面/减实例；dispose 释放 geometry/material/texture。
 */

import * as THREE from 'three';
import { fitObject, loadGLB } from '../core/gltf';
import type { TierAnchor, TierCameraPose, TierOptions, TierStats, WorldTier } from './tier';
import { createTerrainMaterial, loadTerrainTextures } from './terrain-material';

/* -------------------------------------------------------------------------- *
 * 尺寸与高程剖面（米）
 * -------------------------------------------------------------------------- */

const S_MIN = -820;   // 冰前最下游
const S_MAX = 1340;   // 粒雪盆上缘
const U_HALF = 900;   // 半谷宽（含两侧山坡）

/** 谷底纵剖面控制点（s → 高程 m）。表碛冰舌 → 冰瀑 → 粒雪盆。 */
const PROFILE: Array<[number, number]> = [
  [-820, 2852], [-400, 2872], [-120, 2886], [0, 2900],
  [160, 2946], [420, 3320], [560, 3480], [700, 3780],
  [860, 4180], [980, 4300], [1180, 4400], [1340, 4470],
];

function profileY(s: number): number {
  if (s <= PROFILE[0][0]) return PROFILE[0][1];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const a = PROFILE[i];
    const b = PROFILE[i + 1];
    if (s <= b[0]) {
      const t = (s - a[0]) / (b[0] - a[0]);
      const e = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * e;
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/** 谷底半宽随 s 变化：冰前最宽、冰瀑最窄、粒雪盆又张开。 */
function valleyHalf(s: number): number {
  if (s < 0) return 420 + Math.min(1, -s / 820) * 130;
  if (s < 520) return 380 - (s / 520) * 130;
  if (s < 900) return 250 + ((s - 520) / 380) * 90;
  return 340 + Math.min(1, (s - 900) / 440) * 240;
}

/** 中心线摆动（防止一条直线峡谷）。 */
function centerX(s: number): number {
  return 55 * Math.sin(s * 0.0016) + 28 * Math.sin(s * 0.0037 + 1.1);
}

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash1(xi * 57.0 + zi * 131.0);
  const b = hash1((xi + 1) * 57.0 + zi * 131.0);
  const c = hash1(xi * 57.0 + (zi + 1) * 131.0);
  const d = hash1((xi + 1) * 57.0 + (zi + 1) * 131.0);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm2(x: number, z: number): number {
  let v = 0;
  let a = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < 4; i++) {
    v += a * noise2(fx, fz);
    fx = fx * 2.03 + 11.3;
    fz = fz * 1.97 - 5.7;
    a *= 0.5;
  }
  return v;
}

/* -------------------------------------------------------------------------- *
 * 地表分类
 * -------------------------------------------------------------------------- */

const enumClass = {
  ROCK: 0,
  FOREST: 1,
  FIRN: 2,
  ICEFALL: 3,
  DEBRIS: 4,
  MORAINE: 5,
  GRAVEL: 6,
  CREVASSE: 7,
} as const;

type SurfaceClass = (typeof enumClass)[keyof typeof enumClass];

const CLASS_COLOR: Record<number, THREE.Color> = {
  [enumClass.ROCK]: new THREE.Color(0x57524b),
  [enumClass.FOREST]: new THREE.Color(0x33452c),
  [enumClass.FIRN]: new THREE.Color(0xf2f7fc),
  [enumClass.ICEFALL]: new THREE.Color(0xd8eaf6),
  // 表碛：真照片地面视角为浅-中暖灰（晴天 ~#8a8378 / 阴天 ~#5a544b），取中间值；
  // 卫星影像读数偏深是视角+大气效应，W3D-01 报告已声明两种视角的容差。
  [enumClass.DEBRIS]: new THREE.Color(0x655e52),
  [enumClass.MORAINE]: new THREE.Color(0x6b655a),
  [enumClass.GRAVEL]: new THREE.Color(0x7d786c),
  [enumClass.CREVASSE]: new THREE.Color(0x5f84a0),
};
/** 冰瀑下段蓝冰出露带（真照片：白色冰瀑与灰色冰舌之间的蓝色过渡带） */
const BLUE_ICE = new THREE.Color(0x83b4d4);

interface Surface {
  y: number;
  cls: SurfaceClass;
}

/**
 * 单点地表：返回高程 + 分类。
 * 这里的顺序就是要素的可辨识度设计：表碛冰舌在上、冰瀑最陡、粒雪盆最缓最白。
 */
function surfaceAt(s: number, uRaw: number, detail: number): Surface {
  const half = valleyHalf(s);
  const u = uRaw - centerX(s);
  const au = Math.abs(u);
  const floor = profileY(s);

  // 谷侧山坡：越出谷底半宽后抬升，抬到 +1150 m
  const wallT = Math.max(0, au - half) / (U_HALF - half);
  const wall = Math.pow(Math.min(1, Math.max(0, wallT)), 1.55) * 1150;
  const wallNoise = (fbm2(uRaw * 0.006 + 7, s * 0.006) - 0.5) * 220 * Math.min(1, wallT * 1.6);

  let y = floor + wall + wallNoise;
  let cls: SurfaceClass = enumClass.ROCK;
  const clump = fbm2(uRaw * 0.02, s * 0.02);
  const patch = fbm2(uRaw * 0.007 + 3, s * 0.007);

  // ---- 6 森林坡面：谷壁下部、坡度较缓处
  // 真照片对照（glacier-in-forest / official-icefall-1）：暗绿针叶林直抵冰缘，
  // 林线抬高 + 密度阈值放宽，让低海拔谷壁大面积郁闭。
  const forestLine = 3640 + (patch - 0.5) * 260;
  if (y < forestLine && au > half * 0.82) {
    const dens = Math.min(1, (forestLine - y) / 300) * (0.55 + 0.45 * clump) * Math.min(1, Math.max(0, (au - half * 0.82) / 90));
    cls = dens > 0.3 ? enumClass.FOREST : enumClass.ROCK;
  }

  if (au < half) {
    const t = u / half;
    if (s > 940) {
      // ---- 1 粒雪盆：宽浅碗，越靠上越白
      const bowl = Math.pow(Math.abs(t), 2.0) * 165 + Math.pow(Math.abs(u) / half, 2.0) * 40;
      y = floor + bowl + (fbm2(uRaw * 0.01, s * 0.01) - 0.5) * 34;
      cls = enumClass.FIRN;
    } else if (s > 540) {
      // ---- 2 冰瀑与裂隙：陡、横裂隙（噪声抖动相位与宽度，避免幕布式等距条纹）
      const t2 = (s - 540) / 400;
      const ph = s * 0.085 + (fbm2(uRaw * 0.013, s * 0.013) - 0.5) * 2.4;
      const saw = Math.abs(Math.sin(ph)) * 26 * (0.4 + t2);
      const cw = Math.max(0.05, 0.14 + (fbm2(uRaw * 0.05 + 9, s * 0.05) - 0.5) * 0.18);
      const crevasse = Math.abs(Math.sin(ph + 0.6)) < cw;
      y = floor + Math.pow(Math.abs(t), 1.7) * 90 + saw + (fbm2(uRaw * 0.02, s * 0.02) - 0.5) * 30;
      cls = crevasse ? enumClass.CREVASSE : enumClass.ICEFALL;
    } else if (s > -30) {
      // ---- 3 表碛冰舌：凸起的冰体 + 碎屑起伏
      const t2 = Math.max(0, Math.min(1, s / 520));
      const dome = 66 * (1 - t2 * 0.55) * Math.cos(Math.min(1, Math.abs(t)) * 1.35);
      const hummock = (fbm2(uRaw * 0.035, s * 0.035) - 0.5) * 22 + (fbm2(uRaw * 0.11, s * 0.11) - 0.5) * 7;
      y = floor + dome + hummock;
      cls = enumClass.DEBRIS;
    } else {
      // ---- 5 冰前河道：谷底向下切，砾石滩
      const cut = Math.pow(Math.min(1, Math.abs(t) * 1.25), 2.0) * 26;
      y = floor - 8 + cut + (fbm2(uRaw * 0.04, s * 0.04) - 0.5) * 12;
      cls = enumClass.GRAVEL;
    }
  }

  // ---- 4 侧碛（沿冰舌外侧的两条垄）与终碛（冰舌前缘的弧）
  if (s > -20 && s < 560) {
    const band = Math.abs(au - (half + 46));
    const ridge = Math.max(0, 1 - band / 70);
    if (ridge > 0.05) {
      y += ridge * 52 * (0.6 + 0.4 * clump);
      if (y < forestLine + 120) cls = enumClass.MORAINE;
    }
  }
  const termS = -118;
  const term = Math.max(0, 1 - Math.abs(s - termS) / 86);
  if (term > 0.05 && au < half + 190 && au > 96) {
    y += term * 44 * (0.55 + 0.45 * patch);
    cls = enumClass.MORAINE;
  }

  // 细节扰动（低频，别把要素边界搅碎）
  if (detail > 0) {
    y += (fbm2(uRaw * 0.0025, s * 0.0025) - 0.5) * 26 * detail;
    // 岩壁脊状细节：棱线噪声让谷壁有岩脊与沟槽，而不是光滑斜坡（4K 复原）
    if (cls === enumClass.ROCK) {
      const ridge = 1 - Math.abs(2 * fbm2(uRaw * 0.011 + 5, s * 0.011) - 1);
      y += (ridge - 0.55) * 16 * detail;
    }
  }
  return { y, cls };
}

/* -------------------------------------------------------------------------- *
 * 谷地构建
 * -------------------------------------------------------------------------- */

export interface ValleyTier extends WorldTier {
  readonly id: string;
  poses: Record<string, TierCameraPose>;
  defaultPose: string;
  meta: {
    features: Array<{ id: string; label: string; evidenceLevel: 'L3' | 'L4'; note: string }>;
    limitations: string[];
    scaleNote: string;
    hud: string[];
  };
  /** 冰川→森林的导览飞行（可选）：每帧调用一次，推进内部进度 */
  flythrough?: (camera: THREE.PerspectiveCamera) => boolean;
  hudLines(): string[];
}

interface MistLayer {
  mesh: THREE.Mesh;
  baseY: number;
  speed: number;
  phase: number;
}

export async function createValleyTier(opts: TierOptions): Promise<ValleyTier> {
  const low = opts.lowQuality === true;
  const stats: TierStats = { assetsLoaded: 0, assetsFailed: 0, log: [] };
  const log = (s: string): void => { stats.log.push(s); };
  const group = new THREE.Group();
  group.name = 'VALLEY-HLG-MID';

  /* ---- 0. 谷地自带灯光（与 forest/stream 同级强度；fallback 灯 rig 偏弱，
   *        2 km 尺度的山坡在 ACES 下会整体压黑）。灯挂在 tier group 上，
   *        换层时随 group 移除，不污染其他层。 ---- */
  const hemi = new THREE.HemisphereLight(0xd8e8f6, 0x7d7562, 1.4);
  group.add(hemi);
  group.add(new THREE.AmbientLight(0x9fb2c2, 0.3));
  const sun = new THREE.DirectionalLight(0xfff2da, 2.5);
  sun.position.set(-0.55, 0.62, 0.55).multiplyScalar(1000);
  group.add(sun);
  const fill = new THREE.DirectionalLight(0xb6d0e6, 0.75);
  fill.position.set(-0.6, 0.35, -0.7).multiplyScalar(1000);
  group.add(fill);

  /* ---- 1. 地形网格（谷底 + 山坡 + 六类要素） ---- */
  // 4K 复原档：~129k 顶点（约 5 m/顶点），低质量档保持 96×72。
  const ns = low ? 96 : 448;
  const nu = low ? 72 : 288;
  const positions = new Float32Array(ns * nu * 3);
  const colors = new Float32Array(ns * nu * 3);
  const ys = new Float32Array(ns * nu);
  const clsMap = new Uint8Array(ns * nu);

  for (let i = 0; i < ns; i++) {
    const s = S_MIN + (i / (ns - 1)) * (S_MAX - S_MIN);
    for (let j = 0; j < nu; j++) {
      const uRaw = -U_HALF + (j / (nu - 1)) * (U_HALF * 2);
      const surf = surfaceAt(s, uRaw, 1);
      const vi = i * nu + j;
      const k = vi * 3;
      positions[k] = uRaw;
      positions[k + 1] = surf.y;
      positions[k + 2] = -s;
      ys[vi] = surf.y;
      clsMap[vi] = surf.cls;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < ns - 1; i++) {
    for (let j = 0; j < nu - 1; j++) {
      const a = i * nu + j;
      const b = a + 1;
      const d = a + nu;
      const e = d + 1;
      // Winding must be counter-clockwise seen from above, otherwise the
      // whole valley is back-face culled and only the ridges stay visible.
      indices.push(a, b, d, b, e, d);
    }
  }

  // 地形浮雕着色（4K 复原核心）：坡度变陡变深 + 凹地暗/脊线亮（近似 AO），
  // 让 2 km 尺度的岩壁、冰瀑、碛垄在没有阴影贴图时仍有立体光影。
  const tmp = new THREE.Color();
  const SNOW = new Set<number>([enumClass.FIRN, enumClass.ICEFALL]);
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < nu; j++) {
      const vi = i * nu + j;
      const k = vi * 3;
      const iL = Math.max(0, i - 1);
      const iR = Math.min(ns - 1, i + 1);
      const jD = Math.max(0, j - 1);
      const jU = Math.min(nu - 1, j + 1);
      const yC = ys[vi];
      // 凹度：低于邻域均值为洼地（暗），高于为脊线（亮）
      const avg = (ys[iL * nu + j] + ys[iR * nu + j] + ys[i * nu + jD] + ys[i * nu + jU]) / 4;
      const concavity = Math.max(-1, Math.min(1, (yC - avg) / 14));
      // 坡度：邻点高差 / 网格间距
      const ds = (S_MAX - S_MIN) / (ns - 1);
      const du = (U_HALF * 2) / (nu - 1);
      const gx = (ys[i * nu + jU] - ys[i * nu + jD]) / (2 * du);
      const gz = (ys[iR * nu + j] - ys[iL * nu + j]) / (2 * ds);
      const slope = Math.min(1, Math.hypot(gx, gz));
      const cls = clsMap[vi];
      const c = CLASS_COLOR[cls];
      // 基础色斑 + 凹度(±0.16) + 坡度(非雪类最多 -0.20)
      let shade = 0.94 + 0.24 * fbm2(positions[k] * 0.03 + 13, -positions[k + 2] * 0.03);
      shade += concavity * 0.16;
      if (SNOW.has(cls)) {
        shade += 0.05 * (1 - slope); // 雪：平处更亮
        if (cls === enumClass.FIRN) shade += (hash1(vi * 3.7) - 0.5) * 0.05; // 雪面微闪
      } else {
        shade -= Math.pow(slope, 1.3) * 0.2; // 岩/碛：陡壁压深（克制，保曝光）
      }
      tmp.copy(c).multiplyScalar(Math.max(0.55, Math.min(1.35, shade)));
      // 冰瀑下段蓝冰出露带：s∈[540,720] 向蓝冰色渐变，噪声打散边界（真照片对照 G2）
      if (cls === enumClass.ICEFALL) {
        const sv = -positions[k + 2];
        const bw = Math.max(0, Math.min(1, (720 - sv) / 180)) * (0.45 + 0.55 * fbm2(positions[k] * 0.02 + 5, sv * 0.02));
        tmp.lerp(BLUE_ICE, Math.min(0.75, bw));
      }
      colors[k] = tmp.r;
      colors[k + 1] = tmp.g;
      colors[k + 2] = tmp.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Triplanar PBR surface; falls back to flat vertex colour if a texture 404s.
  let terrainMat: THREE.MeshStandardMaterial;
  try {
    const tex = await loadTerrainTextures();
    terrainMat = createTerrainMaterial({ textures: tex });
    log('terrain material: triplanar rock/ground/gravel');
  } catch (err) {
    terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.45 });
    log('terrain material fallback: ' + (err instanceof Error ? err.message : String(err)));
  }
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.name = 'VALLEY-TERRAIN';
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  group.add(terrain);
  log('terrain ' + ns + 'x' + nu + ' vertices, ' + (indices.length / 3) + ' tris');

  /* ---- 2. 冰前河道（乳灰色冰川水，辫状 3 股，流纹滚动） ---- */
  const waterGroup = new THREE.Group();
  waterGroup.name = 'PROGLACIAL-STREAM';
  // 程序化流纹：纵向拉伸噪声 → 法线扰动 + 乳白水花条纹（canvas，可序列化释放）
  const waterTex = makeWaterStreakTexture();
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(1, 6);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0xbcc8cc,
    roughness: 0.16,
    metalness: 0.0,
    transparent: true,
    opacity: 0.84,
    normalMap: waterTex,
    normalScale: new THREE.Vector2(0.42, 0.42),
    envMapIntensity: 1.15,
  });
  const strands = [
    { off: 0, width: 13 },
    { off: 52, width: 7 },
    { off: -44, width: 6 },
  ];
  const waterParts: THREE.BufferGeometry[] = [];
  for (const st of strands) {
    const segs = low ? 60 : 120;
    const wPos = new Float32Array((segs + 1) * 2 * 3);
    const wIdx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const s = -820 + (i / segs) * 850;
      const cx = centerX(s) + st.off * (0.7 + 0.3 * Math.sin(s * 0.004));
      const y = profileY(s) - 3;
      wPos[i * 6] = cx - st.width;
      wPos[i * 6 + 1] = y;
      wPos[i * 6 + 2] = -s;
      wPos[i * 6 + 3] = cx + st.width;
      wPos[i * 6 + 4] = y;
      wPos[i * 6 + 5] = -s;
      if (i < segs) {
        const a = i * 2;
        wIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
    wGeo.setIndex(wIdx);
    wGeo.computeVertexNormals();
    waterParts.push(wGeo);
    const wm = new THREE.Mesh(wGeo, waterMat);
    wm.renderOrder = 2;
    waterGroup.add(wm);
  }
  group.add(waterGroup);
  log('stream strands ' + strands.length);

  /* ---- 3. 谷地云雾（漂移的面片，不遮要素） ---- */
  const mistTex = makeMistTexture();
  const mistMat = new THREE.MeshBasicMaterial({
    map: mistTex,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: 0xe8eef4,
  });
  const mistPlanes: MistLayer[] = [];
  // 雾层避开 A 机位视轴（相机 y≈3094 朝上游看）：全部抬到粒雪盆高度以上，
  // 只表达谷深与天气，不做整屏奶白色滤镜。
  const mistDefs = low
    ? [{ y: 3540, z: -980, w: 1500, h: 420 }]
    : [
        { y: 3420, z: -520, w: 1600, h: 380 },
        { y: 3620, z: -940, w: 1500, h: 460 },
        { y: 3860, z: -1280, w: 1200, h: 360 },
      ];
  for (let i = 0; i < mistDefs.length; i++) {
    const d = mistDefs[i];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h, 1, 1), mistMat);
    m.position.set(0, d.y, d.z);
    m.renderOrder = 5;
    m.userData.baseX = 0;
    group.add(m);
    mistPlanes.push({ mesh: m, baseY: d.y, speed: 5.5 + i * 3.2, phase: i * 1.7 });
  }
  log('mist layers ' + mistPlanes.length);

  /* ---- 4. 森林坡面：双层锥云杉剪影实例（远，4K 档 5200 株） + GLB hero 树（近） ---- */
  const forestGeomRef: THREE.BufferGeometry[] = [];
  const forestMatRef: THREE.Material[] = [];
  const placer = new THREE.Object3D();
  const count = low ? 600 : 5200;
  // 云杉/冷杉剪影：下冠宽深绿 + 上冠窄稍浅 + 短 trunk；单株 3 实例共用矩阵
  const coneLowGeo = new THREE.ConeGeometry(2.35, 5.6, 7, 1);
  coneLowGeo.translate(0, 4.4, 0);
  const coneHighGeo = new THREE.ConeGeometry(1.45, 4.6, 7, 1);
  coneHighGeo.translate(0, 8.2, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.6, 5);
  trunkGeo.translate(0, 1.3, 0);
  const coneLowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const coneHighMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.95 });
  forestGeomRef.push(coneLowGeo, coneHighGeo, trunkGeo);
  forestMatRef.push(coneLowMat, coneHighMat, trunkMat);
  const cones = new THREE.InstancedMesh(coneLowGeo, coneLowMat, count);
  const conesHigh = new THREE.InstancedMesh(coneHighGeo, coneHighMat, count);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  cones.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  conesHigh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const tint = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < count * 4 && placed < count; i++) {
    const s = S_MIN + hash1(i * 1.7) * (S_MAX - S_MIN);
    const half = valleyHalf(s);
    const sign = hash1(i * 3.1) > 0.5 ? 1 : -1;
    const au = half + 8 + hash1(i * 5.3) * 480;
    const uRaw = centerX(s) + sign * au;
    if (Math.abs(uRaw) > U_HALF - 20) continue;
    const surf = surfaceAt(s, uRaw, 1);
    if (surf.cls !== enumClass.FOREST) continue;
    const scale = 0.55 + hash1(i * 7.7) * 1.35;
    placer.position.set(uRaw, surf.y - 0.5, -s);
    placer.rotation.set((hash1(i * 4.3) - 0.5) * 0.07, hash1(i * 9.1) * Math.PI * 2, (hash1(i * 6.7) - 0.5) * 0.07);
    placer.scale.set(scale * (0.85 + hash1(i * 2.9) * 0.3), scale, scale * (0.85 + hash1(i * 3.7) * 0.3));
    placer.updateMatrix();
    cones.setMatrixAt(placed, placer.matrix);
    conesHigh.setMatrixAt(placed, placer.matrix);
    trunks.setMatrixAt(placed, placer.matrix);
    // 每株色相抖动：暗冷杉绿为主（真照片的峨眉冷杉成熟林是深绿近墨绿），
    // 少量蓝绿/黄绿变化打破纯色地毯
    const h = hash1(i * 11.3);
    tint.setHSL(0.32 + h * 0.04, 0.24 + hash1(i * 13.1) * 0.12, 0.08 + hash1(i * 17.9) * 0.07);
    cones.setColorAt(placed, tint);
    tint.multiplyScalar(1.22);
    conesHigh.setColorAt(placed, tint);
    placed++;
  }
  cones.count = placed;
  conesHigh.count = placed;
  trunks.count = placed;
  cones.instanceMatrix.needsUpdate = true;
  conesHigh.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
  if (conesHigh.instanceColor) conesHigh.instanceColor.needsUpdate = true;
  cones.castShadow = false;
  cones.receiveShadow = false;
  group.add(cones);
  group.add(conesHigh);
  group.add(trunks);
  log('forest impostors ' + placed);

  // 近景 hero 树：真 GLB（loadGLB + fitObject），数量随质量档变化
  const heroTrees: THREE.Object3D[] = [];
  const heroUrls = ['/assets/aholo/fir-fabri-01-web.glb', '/assets/v2/web/alpine-spruce.glb', '/assets/v2/web/alpine-pine-v20.glb'];
  const heroSlots = low ? 2 : 6;
  for (let i = 0; i < heroUrls.length; i++) {
    try {
      opts.onProgress?.(i, heroUrls.length + 1, '载入近景针叶树');
      const gltf = await loadGLB(heroUrls[i]);
      const src = gltf.scene;
      // Aholo 冷杉 134k 面，只放 1 株 hero；v2 库树轻量，分担其余机位
      const n = heroUrls[i].includes('aholo') ? 1 : Math.ceil(heroSlots / (heroUrls.length - 1));
      for (let k = 0; k < n; k++) {
        const inst = src.clone(true);
        const s = -300 + hash1(i * 31 + k * 17) * 520;
        const uRaw = centerX(s) + (hash1(i * 13 + k * 7) > 0.5 ? 1 : -1) * (valleyHalf(s) + 60 + hash1(i * 41 + k) * 120);
        const surf = surfaceAt(s, uRaw, 1);
        fitObject(inst, { targetLongest: 9 + hash1(i * 5 + k) * 7, groundY: surf.y - 0.4, yaw: hash1(i + k) * 6.28 });
        inst.position.x = uRaw;
        inst.position.z = -s;
        group.add(inst);
        heroTrees.push(inst);
      }
      stats.assetsLoaded++;
    } catch (err) {
      stats.assetsFailed++;
      log('GLB 载入失败 ' + heroUrls[i] + ' :: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // Aholo Lux3D 冰川漂砾（taskId 6007319，G1 300k 面 → gltf-transform 减面+webp+meshopt，
  // AI 生成视觉资产，非实测样本；散布在表碛冰舌与碛垄上，A 机位近处放 3 块大漂砾做尺度参照）
  try {
    const gltf = await loadGLB('/assets/aholo/glacial-erratic-01-web.glb');
    const src = gltf.scene;
    const n = low ? 4 : 10;
    for (let k = 0; k < n; k++) {
      const inst = src.clone(true);
      const s = -40 + hash1(k * 23.7) * 560;
      const uRaw = centerX(s) + (hash1(k * 11.3) - 0.5) * 2 * valleyHalf(s) * 0.85;
      const surf = surfaceAt(s, uRaw, 1);
      fitObject(inst, { targetLongest: 2.5 + hash1(k * 7.1) * 6.5, groundY: surf.y - 0.3, yaw: hash1(k * 5.9) * 6.28 });
      inst.position.x = uRaw;
      inst.position.z = -s;
      group.add(inst);
      heroTrees.push(inst); // 共用释放列表
    }
    // 近景 hero 漂砾：A 机位前方 120–270 m 的冰前砾石滩上，12–20 m 巨石
    if (!low) {
      for (let k = 0; k < 3; k++) {
        const inst = src.clone(true);
        const s = -300 + hash1(k * 41.3) * 120;
        const uRaw = centerX(s) + (hash1(k * 17.7) - 0.5) * 140;
        const surf = surfaceAt(s, uRaw, 1);
        fitObject(inst, { targetLongest: 12 + hash1(k * 29.1) * 8, groundY: surf.y - 1.2, yaw: hash1(k * 13.9) * 6.28 });
        inst.position.x = uRaw;
        inst.position.z = -s;
        group.add(inst);
        heroTrees.push(inst);
      }
    }
    stats.assetsLoaded++;
    log('aholo erratic x' + n + (low ? '' : ' +3 hero'));
  } catch (err) {
    stats.assetsFailed++;
    log('aholo erratic 载入失败 :: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Aholo Lux3D 冰塔（taskId 6033748，AI 生成视觉资产）：立在冰瀑陡坡上的
  // 冰塔林，打破程序化冰瀑的“幕布感”。只放 ICEFALL 分类段（s 560–920）。
  try {
    const gltf = await loadGLB('/assets/aholo/serac-01-web.glb');
    const src = gltf.scene;
    const nSerac = low ? 4 : 16;
    for (let k = 0; k < nSerac; k++) {
      const inst = src.clone(true);
      const s = 560 + hash1(k * 31.7) * 360;
      const uRaw = centerX(s) + (hash1(k * 13.3) - 0.5) * 2 * valleyHalf(s) * 0.7;
      const surf = surfaceAt(s, uRaw, 1);
      if (surf.cls !== enumClass.ICEFALL && surf.cls !== enumClass.CREVASSE) continue;
      fitObject(inst, { targetLongest: 14 + hash1(k * 7.7) * 26, groundY: surf.y - 2.5, yaw: hash1(k * 3.1) * 6.28 });
      inst.position.x = uRaw;
      inst.position.z = -s;
      group.add(inst);
      heroTrees.push(inst);
    }
    stats.assetsLoaded++;
    log('aholo serac x' + nSerac);
  } catch (err) {
    stats.assetsFailed++;
    log('aholo serac 载入失败 :: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Aholo Lux3D 冰崩碎冰堆（taskId 6369583，AI 生成视觉资产）：冰瀑脚下的
  // 冰崩堆积扇（真照片：白色冰瀑与灰色冰舌之间的碎冰堆积过渡带），
  // 另在表碛冰舌上放两丘零星碎冰。粒雪盆崩落补给是海洋性冰川的真实机制。
  try {
    const gltf = await loadGLB('/assets/aholo/serac-rubble-01-web.glb');
    const src = gltf.scene;
    const nRubble = low ? 3 : 7;
    for (let k = 0; k < nRubble; k++) {
      const inst = src.clone(true);
      const s = 470 + hash1(k * 27.1) * 170;
      const uRaw = centerX(s) + (hash1(k * 9.7) - 0.5) * 2 * valleyHalf(s) * 0.8;
      const surf = surfaceAt(s, uRaw, 1);
      fitObject(inst, { targetLongest: 9 + hash1(k * 5.3) * 16, groundY: surf.y - 1.8, yaw: hash1(k * 3.7) * 6.28 });
      inst.position.x = uRaw;
      inst.position.z = -s;
      group.add(inst);
      heroTrees.push(inst);
    }
    if (!low) {
      for (let k = 0; k < 2; k++) {
        const inst = src.clone(true);
        const s = 120 + hash1(k * 51.3) * 260;
        const uRaw = centerX(s) + (hash1(k * 21.7) - 0.5) * 2 * valleyHalf(s) * 0.6;
        const surf = surfaceAt(s, uRaw, 1);
        fitObject(inst, { targetLongest: 6 + hash1(k * 33.1) * 7, groundY: surf.y - 1.2, yaw: hash1(k * 15.9) * 6.28 });
        inst.position.x = uRaw;
        inst.position.z = -s;
        group.add(inst);
        heroTrees.push(inst);
      }
    }
    stats.assetsLoaded++;
    log('aholo serac-rubble x' + nRubble + (low ? '' : ' +2 tongue'));
  } catch (err) {
    stats.assetsFailed++;
    log('aholo serac-rubble 载入失败 :: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Aholo Lux3D 高山杜鹃灌丛（taskId 6370613，AI 生成视觉资产）：林缘与碛垄
  // 过渡带的杜鹃灌丛——六月杜鹃与冰川同框是海螺沟标志性景观（百度百科时令景观）。
  try {
    const gltf = await loadGLB('/assets/aholo/rhododendron-01-web.glb');
    const src = gltf.scene;
    const nRhodo = low ? 6 : 22;
    for (let k = 0; k < nRhodo; k++) {
      const inst = src.clone(true);
      const s = -80 + hash1(k * 37.3) * 480;
      const half = valleyHalf(s);
      const sign = hash1(k * 7.9) > 0.5 ? 1 : -1;
      const uRaw = centerX(s) + sign * (half + 30 + hash1(k * 13.7) * 150);
      const surf = surfaceAt(s, uRaw, 1);
      if (surf.cls !== enumClass.FOREST && surf.cls !== enumClass.MORAINE) continue;
      fitObject(inst, { targetLongest: 1.2 + hash1(k * 3.3) * 2.2, groundY: surf.y - 0.15, yaw: hash1(k * 5.1) * 6.28 });
      inst.position.x = uRaw;
      inst.position.z = -s;
      group.add(inst);
      heroTrees.push(inst);
    }
    stats.assetsLoaded++;
    log('aholo rhododendron x' + nRhodo);
  } catch (err) {
    stats.assetsFailed++;
    log('aholo rhododendron 载入失败 :: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Aholo Lux3D 岩壁模块（taskId 6035905）：俯视取证发现 AI 生成件是平板状，
  // 放在坡上读作平铺板块，视觉不合格——从谷地撤下，母版保留在 assets-src 供
  // 未来近景层试用。2026-11-11 W3D-01 取证记录。

  /* ---- 5. 机位与锚点 ---- */
  const poses: Record<string, TierCameraPose> = {
    A: {
      // 谷地总览（真照片对照重构，官方机位构图）：抬高+侧移，让画面 =
      // 前景漂砾与砾石滩（下缘）→ 表碛冰舌纵深（中景引导线）→ 冰瀑+蓝冰带
      // （视觉中心）→ 粒雪盆与远山（上缘），两侧谷壁森林夹景。
      // 注意 z = -s：相机在下游 s=-640 处（z=+640），朝上游（-z）看。
      position: [centerX(-640) + 240, profileY(-640) + 480, 640],
      target: [centerX(660) - 60, profileY(660) + 10, -660],
    },
    B: {
      // 冰川到森林：贴着表碛冰舌侧缘，右壁针叶林入画
      position: [centerX(120) - 470, 3260, -120],
      target: [centerX(760) + 260, 3720, -760],
    },
    C: {
      // 冰瀑特写：裂隙与冰崖结构
      position: [centerX(380) - 320, 3520, -380],
      target: [centerX(720), 3980, -720],
    },
    T: {
      // 垂直俯视：与卫星影像做形态学比对（W3D-01 取证机位）。
      // target 沿谷轴下移 1000 m：视线 71° 俯角，roll 稳定，谷轴竖直。
      position: [centerX(250), 5900, -250],
      target: [centerX(250), 3000, -1250],
    },
  };

  const anchorDefs: Array<{ id: string; label: string; kind: TierAnchor['kind']; s: number; u: number; siteId?: string; levelId?: string }> = [
    { id: 'SITE-HLG-FOREST-01', label: '峨眉冷杉成熟林（设计位置）', kind: 'site', s: 140, u: -430, siteId: 'SITE-HLG-FOREST-01' },
    { id: 'SITE-HLG-STREAM-01', label: '林溪与湿石（设计位置）', kind: 'site', s: -300, u: 120, siteId: 'SITE-HLG-STREAM-01' },
    { id: 'SITE-HLG-GLACIER-01', label: '冰舌与表碛（设计位置）', kind: 'site', s: 300, u: 30, siteId: 'SITE-HLG-GLACIER-01' },
    { id: 'SITE-HLG-CHRONO-01', label: '冰川退缩迹地（设计位置）', kind: 'site', s: -60, u: -210, siteId: 'SITE-HLG-CHRONO-01' },
    // 谷地尺度对象锚点：直通分子层（通用分子层，MOLECULAR_LAYER_SPEC）
    { id: 'anchor-valley-glacier', label: '表碛冰舌 · 深入分子层', kind: 'object', s: 60, u: 0, siteId: 'SITE-HLG-GLACIER-01', levelId: 'mol-valley-glacier' },
    { id: 'anchor-valley-river', label: '冰前河道 · 深入分子层', kind: 'object', s: -300, u: 40, levelId: 'mol-valley-river' },
    { id: 'anchor-valley-rockwall', label: '谷壁岩体 · 深入分子层', kind: 'object', s: -60, u: -160, levelId: 'mol-valley-rockwall' },
  ];
  const anchors: TierAnchor[] = anchorDefs.map((d) => {
    const surf = surfaceAt(d.s, centerX(d.s) + d.u, 1);
    return {
      id: d.id,
      label: d.label,
      kind: d.kind,
      siteId: d.siteId,
      levelId: d.levelId,
      position: new THREE.Vector3(centerX(d.s) + d.u, surf.y + 2, -d.s),
    };
  });

  /* ---- 6. 导览飞行（冰川→森林） ---- */
  let flyT = 0;
  let flying = false;
  const flyFrom = new THREE.Vector3();
  const flyTo = new THREE.Vector3();
  const flyLookFrom = new THREE.Vector3();
  const flyLookTo = new THREE.Vector3();
  const flyCur = new THREE.Vector3();

  const hud = (): string[] => [
    'VALLEY-HLG-MID · 海螺沟谷地中景（导览，不是自由步行）',
    '六要素  粒雪盆 / 冰瀑与裂隙 / 表碛冰舌 / 侧碛终碛 / 冰前河道 / 森林坡面',
    '几何    程序化地貌复原 L3/L4 · 冰界与表碛厚度 UNKNOWN（无实测）',
    '尺度    冰舌末端 ' + profileY(0) + ' m → 粒雪盆 ' + profileY(1200) + ' m，水平跨度 2.1 km（中景压缩）',
    '资产    ' + stats.assetsLoaded + ' GLB 载入 / ' + stats.assetsFailed + ' 失败 · 树带双层锥实例 ' + placed,
  ];

  const tier: ValleyTier = {
    id: 'valley',
    group,
    poses,
    defaultPose: 'A',
    anchors,
    stats,
    flythrough(camera: THREE.PerspectiveCamera): boolean {
      if (!flying) {
        flying = true;
        flyT = 0;
        flyFrom.copy(camera.position);
        flyTo.set(poses.B.position[0], poses.B.position[1], poses.B.position[2]);
        flyLookFrom.set(...(poses.A.target as [number, number, number]));
        flyLookTo.set(...(poses.B.target as [number, number, number]));
      }
      flyT = Math.min(1, flyT + 1 / 240);
      const t = flyT * flyT * (3 - 2 * flyT);
      flyCur.lerpVectors(flyFrom, flyTo, t);
      camera.position.copy(flyCur);
      flyCur.lerpVectors(flyLookFrom, flyLookTo, t);
      camera.lookAt(flyCur);
      if (flyT >= 1) flying = false;
      return flyT < 1;
    },
    hudLines: hud,
    meta: {
      features: [
        { id: 'FIRN', label: '粒雪盆', evidenceLevel: 'L4', note: '宽浅碗 + 高反照率；不含雪层剖面数据。' },
        { id: 'ICEFALL', label: '冰瀑与裂隙', evidenceLevel: 'L4', note: '用纵剖面陡变 + 横向锯齿表达裂隙方向；不是冰动力学模拟，不循环崩解。' },
        { id: 'DEBRIS', label: '表碛冰舌', evidenceLevel: 'L3', note: '凸起冰体 + 碎屑起伏；表碛厚度 UNKNOWN，形态按文献描述的覆盖型冰舌。' },
        { id: 'MORAINE', label: '侧碛与终碛', evidenceLevel: 'L4', note: '沿冰舌外缘的垄 + 前缘弧；位置待 DEM/野外核验。' },
        { id: 'STREAM', label: '冰前河道', evidenceLevel: 'L4', note: '辫状 3 股乳灰色水；流量与化学 UNKNOWN。' },
        { id: 'FOREST', label: '森林坡面', evidenceLevel: 'L3', note: '林线 3560 m 附近，双层锥云杉剪影实例（4K 档约 5200 株，色相/尺寸抖动）表达林冠密度梯度；树种形态为程序化，非本地实测形态。' },
        { id: 'ERRATIC', label: '冰川漂砾（AI 资产）', evidenceLevel: 'L4', note: 'Aholo Lux3D 文生 3D（taskId 6007319），AI 生成的视觉参照物，不是实测岩石样本；用于表达冰舌表面碎屑尺度。' },
      ],
      limitations: [
        '冰舌边界、冰面地形、表碛厚度均无实测数据；本层是地貌形态复原，不得当作某年实测冰界。',
        '侧碛/终碛位置是示意，不是实测垄位。',
        '垂直尺度按中景压缩（水平 2.1 km 内表现 1.6 km 高差），不可用于测量。',
        '云雾是视觉层，不代表任何一天的实际天气。',
      ],
      scaleNote: '冰舌末端 ' + profileY(0) + ' m，粒雪盆 ' + profileY(1200) + ' m；水平 s∈[' + S_MIN + ',' + S_MAX + ']，u∈±' + U_HALF + '。',
      hud: hud(),
    },
    update(dt: number, camera: THREE.PerspectiveCamera): void {
      if (camera.far < 3000) {
        camera.far = 3200;
        if (camera.near > 0.5) camera.near = 0.3;
        camera.updateProjectionMatrix();
      }
      // 水面流纹滚动（米/秒量级视觉速率，不代表实测流速）
      waterTex.offset.y -= Math.min(dt, 0.1) * 0.16;
      // 云雾漂移：只改 position，不分配对象
      const t = performance.now() * 0.001;
      for (let i = 0; i < mistPlanes.length; i++) {
        const m = mistPlanes[i];
        m.mesh.position.x = Math.sin(t * 0.05 * m.speed * 0.05 + m.phase) * 90;
        m.mesh.position.y = m.baseY + Math.sin(t * 0.07 + m.phase) * 6;
      }
    },
    setQuality(lowQuality: boolean): void {
      // 低质量：砍掉森林实例与云雾层，并降低地形细分（重建一次）
      cones.count = lowQuality ? Math.min(placed, Math.round(placed * 0.35)) : placed;
      conesHigh.count = cones.count;
      trunks.count = cones.count;
      const hideMist = lowQuality;
      for (const m of mistPlanes) m.mesh.visible = !hideMist || m === mistPlanes[0];
      waterGroup.visible = true;
      mistMat.opacity = lowQuality ? 0.22 : 0.34;
    },
    dispose(): void {
      geo.dispose();
      terrainMat.dispose();
      for (const g of waterParts) g.dispose();
      waterMat.dispose();
      waterTex.dispose();
      mistTex.dispose();
      mistMat.dispose();
      for (const m of mistPlanes) m.mesh.geometry.dispose();
      for (const g of forestGeomRef) g.dispose();
      for (const m of forestMatRef) m.dispose();
      cones.dispose();
      conesHigh.dispose();
      trunks.dispose();
      for (const h of heroTrees) {
        h.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mm of mats) mm.dispose();
          }
        });
        h.removeFromParent();
      }
      group.removeFromParent();
      group.clear();
    },
  };

  opts.onProgress?.(heroUrls.length + 1, heroUrls.length + 1, '谷地中景就绪');
  return tier;
}

/** 云雾贴图：径向渐变 + 噪声，避免纯色方块。 */
function makeMistTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        const r = Math.hypot(nx * 0.85, ny * 1.15);
        const fall = Math.max(0, 1 - r);
        const n = fbm2(x * 0.09, y * 0.09);
        const a = Math.max(0, Math.min(1, fall * fall * (0.55 + 0.9 * n)));
        const o = (y * size + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 冰前河流水面纹理：纵向拉伸的 fbm 噪声，既当法线扰动（normalMap）也暗示
 * 乳白冰川粉（rock flour）条纹。滚动 offset 即流动；视觉速率，非实测流速。
 */
function makeWaterStreakTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 纵向（y=流向）拉长 6 倍 → 流线型条纹
        const n = fbm2(x * 0.045, y * 0.008);
        const n2 = fbm2(x * 0.11 + 40, y * 0.02 + 9);
        const v = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 1.6 + (n2 - 0.5) * 0.5));
        const o = (y * size + x) * 4;
        // normalMap 语义：x/y 通道存切线空间扰动（128 为中性）
        img.data[o] = Math.round(128 + (v - 0.5) * 90);
        img.data[o + 1] = Math.round(128 + (n2 - 0.5) * 70);
        img.data[o + 2] = 255;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  return new THREE.CanvasTexture(c);
}
