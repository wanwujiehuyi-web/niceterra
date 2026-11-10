import * as THREE from 'three';
import { loadGLB, fitObject } from '../core/gltf';
import { MdLite, structureForMaterial, AMPLITUDE_EXAGGERATION } from './md-lite';
import type {
  ColorStatus,
  EvidenceLevel,
  ImagingMethod,
  MicroLevelBuild,
  SampleStatus
} from '../scene/types';
import type { TierAnchor, TierCameraPose, TierOptions, TierStats, WorldTier } from '../world/tier';
import {
  addLights,
  clamp01,
  cylinderBetween,
  displacedIcosahedron,
  disposeObject,
  fbm3,
  formatMeters,
  instanced,
  lensGeometry,
  makeLegendSprite,
  makeRng,
  orientMatrix,
  radialGradientTexture,
  randRange,
  spherePatch,
  tubeGeometry,
  vertexColorNoise,
  walkPath,
  type Vec3
} from './micro-utils';

/**
 * Route A — HLG-STREAM-BIOFILM-01 (湿溪石—生物膜—硅藻—生物硅)
 *
 * Every level below is its own geometry and its own observation logic. Nothing is a scaled
 * copy of a previous layer: the 20 cm view is a photogrammetric rock surface, the 200 μm view
 * is a schematic EPS network, the 20 μm view is a whole frustule, the 2 μm view is a curved
 * areola fragment, the 200 nm view is a fracture cross-section, the 20 nm view is a particle
 * aggregate, the 2 nm view is an animated condensation mechanism and the 0.4 nm view is a
 * local, deliberately imperfect Si-O cluster.
 *
 * Coordinate honesty: micro objects never receive a latitude/longitude. Position is only
 * PARENT_RELATIVE to ROCK-HLG-01 at SITE-HLG-STREAM-01 (site ENU 30, -16, w+0.12), and the
 * sample itself is PLANNED — no Hailuogou micrograph or measurement backs these models.
 */

export const ROUTE_A_ID = 'HLG-STREAM-BIOFILM-01';
export const SITE_ID = 'SITE-HLG-STREAM-01';
export const PARENT_OBJECT_ID = 'ROCK-HLG-01';
/** Parent object placement (documentation only; the micro group itself is origin-relative). */
export const PARENT_ENU = { eastM: 30, northM: -16, zOffsetFromWaterM: 0.12, coordinateStatus: 'PLANNED' as const };

export interface MicroLevelSpec {
  levelId: string;
  title: string;
  index: number;
  fovLabel: string;
  fovMeters: number | null;
  imaging: ImagingMethod;
  colorStatus: ColorStatus;
  evidence: EvidenceLevel;
  limitation: string;
  sampleStatus: SampleStatus;
  parentObjectId: string;
  scaleBarMeters: number | null;
  geometrySource: string;
  colorNote: string;
  evidenceNote: string;
  sources: string[];
  actions: { up: string; down: string; reset: string };
  views?: string[];
}

export interface MicroRouteSpec {
  routeId: string;
  name: string;
  levels: MicroLevelSpec[];
}

export interface MicroBuildContext {
  /** Optional: the tier adapter has no renderer, builders only need scale hints. */
  renderer?: THREE.WebGLRenderer;
  lowQuality?: boolean;
}

export interface MicroCameraSetup {
  near: number;
  far: number;
  fovDeg: number;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  background: number;
}

export interface MicroLevelView {
  id: string;
  label: string;
  apply: () => void;
}

export interface MicroLevelLegendEntry {
  color: number;
  text: string;
}

export interface MicroLevelExtras {
  camera: MicroCameraSetup;
  scaleBar: { meters: number; label: string };
  views: MicroLevelView[];
  activeViewId: string;
  legend: MicroLevelLegendEntry[];
  legendTitle?: string;
  geometryNote: string;
  evidenceNote: string;
  colorNote: string;
  sources: string[];
  actions: { up: string; down: string; reset: string };
  parentObjectId: string;
  sampleStatus: SampleStatus;
  /** True when the level contains a pausable mechanism animation. */
  pausable: boolean;
  pause?: () => void;
  resume?: () => void;
  isPaused?: () => boolean;
  ready?: Promise<void>;
}

export type MicroLevelABuild = MicroLevelBuild & { readonly extras: MicroLevelExtras };

export const ROUTE_A: MicroRouteSpec = {
  routeId: ROUTE_A_ID,
  name: '湿溪石—生物膜—硅藻—生物硅',
  levels: [
    {
      levelId: 'wet-rock',
      title: '湿溪石',
      index: 1,
      fovLabel: '20 cm',
      fovMeters: 0.2,
      imaging: 'photogrammetry',
      colorStatus: 'natural',
      evidence: 'L2',
      limitation:
        '宏观待 L1；当前 DESIGN_ONLY/L2。石面来自 r7 母体资产的概念性近景渲染，不是海螺沟实测摄影测量；生物膜斑块位置未采样，取样点标注为设计标注。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 0.05,
      geometrySource: 'r7-biofilm-rock.glb 母体（fitObject 拟合）+ 程序化水膜/砾石/生物膜斑块；GLB 为 DESIGN_ONLY',
      colorNote: '自然光渲染，未做伪彩；湿润高光属材质表现，非荧光或染色',
      evidenceNote: 'DESIGN_ONLY/L2：形态参考一般湿溪石，非本样实测',
      sources: ['SRC-BIOFILM-2016', 'ASSET r7-biofilm-rock.glb (DESIGN_ONLY)'],
      actions: { up: '放大 → 生物膜基质 200 μm', down: '—（路线起点）', reset: '复位视角' },
      views: ['overview']
    },
    {
      levelId: 'biofilm-matrix',
      title: '生物膜基质',
      index: 2,
      fovLabel: '200 μm',
      fovMeters: 2e-4,
      imaging: 'mechanism-diagram',
      colorStatus: 'schematic',
      evidence: 'L4',
      limitation:
        '示意重建：EPS 纤维直径、孔隙率与细胞密度只按一般文献尺度设定，非本样测量；颜色为声明的编码色。与上一层仅共享取样位置，几何独立。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 5e-5,
      geometrySource: '程序化纤维随机游走管 + 孔隙壳层 + 细胞胶囊与附着足；无资产复用',
      colorNote: '示意色：青绿=EPS 基质、琥珀=细胞、深蓝=孔隙/水（编码色，非染色、非荧光）',
      evidenceNote: 'L4：结构示意，未经本样成像验证',
      sources: ['SRC-MATRIX-2010', 'SRC-BIOFILM-2016'],
      actions: { up: '放大 → 硅藻群落 50 μm', down: '缩小 → 湿溪石 20 cm', reset: '复位视角' },
      views: ['matrix', 'pores']
    },
    {
      levelId: 'diatom-assemblage',
      title: '硅藻群落',
      index: 3,
      fovLabel: '50 μm',
      fovMeters: 5e-5,
      imaging: 'optical-microscopy',
      colorStatus: 'natural',
      evidence: 'L4',
      limitation:
        '群落组成、密度与优势种 UNKNOWN。形态示例参照一般淡水附着硅藻，非海螺沟本地名录，未鉴定到种；叶绿体只示意存在，不代表具体类群。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 1e-5,
      geometrySource: '四类独立形态（舟形羽纹、无壳缝带形、中心圆盘、棒状具柄）+ 独立基质碎片',
      colorNote: '明场透射视觉：硅壳透明偏灰，叶绿体黄褐；自然色，非伪彩',
      evidenceNote: 'L3 一般形态学 + L4 本样成像缺失（合写为 L4）',
      sources: ['SRC-DIATOM-2008'],
      actions: { up: '放大 → 完整硅藻壳 20 μm', down: '缩小 → 生物膜基质 200 μm', reset: '复位视角' },
      views: ['community', 'substrate']
    },
    {
      levelId: 'diatom-frustule',
      title: '完整硅藻壳',
      index: 4,
      fovLabel: '20 μm',
      fovMeters: 2e-5,
      imaging: 'optical-microscopy',
      colorStatus: 'natural',
      evidence: 'L4',
      limitation:
        '未鉴定到种：壳体为一般羽纹类示例。壳面/壳环两个视角是同一个独立几何的两种观察方向，不是两套模型；壳面曲率与壳环带按量级设定，非实测。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 5e-6,
      geometrySource: '独立 lens 壳体 + 双层壳环带 + 壳缝/中节示意；非上一层模型缩放',
      colorNote: '明场偏冷自然色 + 边缘暗线；非伪彩',
      evidenceNote: 'L3 属级形态 + L4 未鉴定到种（合写为 L4）',
      sources: ['SRC-DIATOM-2008'],
      actions: { up: '放大 → 壳面局部 2 μm', down: '缩小 → 硅藻群落 50 μm', reset: '复位视角' },
      views: ['valve', 'girdle', 'oblique']
    },
    {
      levelId: 'valve-detail',
      title: '壳面局部',
      index: 5,
      fovLabel: '2 μm',
      fovMeters: 2e-6,
      imaging: 'SEM',
      colorStatus: 'grayscale',
      evidence: 'L4',
      limitation:
        '孔纹直径/密度与肋纹间距只按文献量级设定，非本样测量；曲率半径取壳体量级，非实测。灰度仅视觉语言，不代表真实电子信号。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 5e-7,
      geometrySource: '球面曲率片段 + 六边形孔纹环（实例化）+ 肋纹条带 + 碎屑；与上一层观察逻辑不同',
      colorNote: '灰度 SEM 视觉语言',
      evidenceNote: 'L4：文献尺度示意',
      sources: ['SRC-DIATOM-2008'],
      actions: { up: '放大 → 壳壁剖面 200 nm', down: '缩小 → 完整硅藻壳 20 μm', reset: '复位视角' },
      views: ['surface', 'oblique']
    },
    {
      levelId: 'wall-section',
      title: '壳壁剖面',
      index: 6,
      fovLabel: '200 nm',
      fovMeters: 2e-7,
      imaging: 'SEM',
      colorStatus: 'grayscale',
      evidence: 'L4',
      limitation:
        '剖面为机制示意：孔道数量、壁厚与水合层厚度均非实测，未给出精确数值。灰度 SEM 语言只用于表达形貌对比。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 5e-8,
      geometrySource: '独立断面块体：外表面、断口锯齿、贯穿孔道、水合生物硅内衬层',
      colorNote: '灰度 SEM，中低对比',
      evidenceNote: 'L4：机制剖面示意',
      sources: ['SRC-DIATOM-2008'],
      actions: { up: '放大 → 生物硅聚集 20 nm', down: '缩小 → 壳面局部 2 μm', reset: '复位视角' },
      views: ['section', 'oblique']
    },
    {
      levelId: 'silica-aggregation',
      title: '生物硅聚集',
      index: 7,
      fovLabel: '20 nm',
      fovMeters: 2e-8,
      imaging: 'SEM',
      colorStatus: 'grayscale',
      evidence: 'L4',
      limitation:
        '颗粒尺寸分布与聚集度示意，非 DLS/TEM 实测；短程聚集不是晶格，无长程有序。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 5e-9,
      geometrySource: '实例化不规则纳米颗粒 + 短程接触簇 + 少量孤立颗粒；暗背景',
      colorNote: '灰度，暗场式背景',
      evidenceNote: 'L4：机制示意',
      sources: ['SRC-DIATOM-2008', 'SRC-MATRIX-2010'],
      actions: { up: '放大 → 硅酸缩合 2 nm', down: '缩小 → 壳壁剖面 200 nm', reset: '复位视角' },
      views: ['overview', 'cluster']
    },
    {
      levelId: 'condensation',
      title: '硅酸缩合',
      index: 8,
      fovLabel: '2 nm',
      fovMeters: 2e-9,
      imaging: 'mechanism-diagram',
      colorStatus: 'schematic',
      evidence: 'L4',
      limitation:
        '可暂停机制动画：原子路径与时间尺度为解释性示意，明确不是分子动力学模拟，不代表真实反应速率或能垒。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 5e-10,
      geometrySource: '独立原子球棍（Si/O/H）+ 反应箭头 + 随时间插值的成键/脱水状态机',
      colorNote: '示意色：Si 琥珀、O 珊瑚、H 白；箭头青色表示反应方向（模型编码）',
      evidenceNote: 'L4；非分子动力学',
      sources: ['SRC-DIATOM-2008'],
      actions: { up: '放大 → 局部硅氧结构 0.4 nm', down: '缩小 → 生物硅聚集 20 nm', reset: '复位并对齐动画起点' },
      views: ['mechanism']
    },
    {
      levelId: 'local-sio',
      title: '局部硅氧结构',
      index: 9,
      fovLabel: '0.4 nm',
      fovMeters: 4e-10,
      imaging: 'data-view',
      colorStatus: 'schematic',
      evidence: 'L4',
      limitation:
        '局部球棍模型：键长/键角为示意取值，非晶体学精修；刻意保留断键、缺桥氧与端羟基，不能外推为无限完美晶格。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 1e-10,
      geometrySource: '独立 Si-O 四面体小簇（共享顶点）+ 悬键/端羟基 + 图例；无周期性',
      colorNote: '球棍编码色：Si/O/H，仅模型编码，不代表真实颜色；图例标注声明的编码',
      evidenceNote: 'L4：局部模型，非实测结构',
      sources: ['SRC-DIATOM-2008'],
      actions: { up: '放大 → 硅氧网络·分子运动 1 nm', down: '缩小 → 硅酸缩合 2 nm', reset: '复位视角' },
      views: ['cluster', 'defect']
    },
    {
      levelId: 'sio2-md',
      title: '硅氧网络 · 分子运动',
      index: 10,
      fovLabel: '1 nm',
      fovMeters: 1e-9,
      imaging: 'mechanism-diagram',
      colorStatus: 'schematic',
      evidence: 'L4',
      limitation:
        '分子动力学示意（MD-lite）：SiO₄ 四面体片段做温度参数化晶格谐振，振幅夸大 ' +
        AMPLITUDE_EXAGGERATION +
        '× 以便可见；动画速率不代表真实时间尺度（真实键振动 ~10¹³ Hz）。opal-A 的长程无序与结构水未完整建模。',
      sampleStatus: 'PLANNED',
      parentObjectId: PARENT_OBJECT_ID,
      scaleBarMeters: 2e-10,
      geometrySource:
        'MD-lite opal-A 片段：SiO4 四面体角共享网络（Si–O 0.161 nm、O–Si–O 109.47°）+ 谐振运动引擎（A ∝ √(k_B·T/k)）',
      colorNote:
        'CPK 元素配色（Si 米黄 / O 红），球棍式渲染：球半径取 0.6×共价半径为视觉约定；编码色不代表真实颜色、非荧光',
      evidenceNote: 'L4：分子动力学示意（MD-lite），非全原子力场模拟、非实测结构',
      sources: ['SRC-OPAL-A', 'SRC-QUARTZ-GEOMETRY'],
      actions: { up: '—（分子层终点）', down: '缩小 → 局部硅氧结构 0.4 nm', reset: '复位视角' },
      views: ['overview']
    }
  ]
};

export const ROUTE_A_LEVELS: readonly MicroLevelSpec[] = ROUTE_A.levels;

export function findLevelSpecA(levelId: string): MicroLevelSpec | undefined {
  return ROUTE_A.levels.find((level) => level.levelId === levelId);
}

interface LevelRuntime {
  group: THREE.Group;
  update?: (dt: number, elapsed: number) => void;
  dispose: () => void;
  camera?: MicroCameraSetup;
  views?: MicroLevelView[];
  activeViewId?: string;
  legend?: MicroLevelLegendEntry[];
  legendTitle?: string;
  pausable?: boolean;
  pause?: () => void;
  resume?: () => void;
  isPaused?: () => boolean;
  ready?: Promise<void>;
}

interface CameraOptions {
  dir?: Vec3;
  distance?: number;
  fovDeg?: number;
  background?: number;
  up?: Vec3;
  target?: Vec3;
}

/**
 * Camera distances are expressed in field units and then multiplied by the field of view,
 * so the same numbers work for 20 cm and for 0.4 nm. near/far follow the scale of the level:
 * for 0.4 nm this yields 1e-10 m .. 1e-8 m, for 20 cm 5e-5 m .. 5 m.
 */
function makeCamera(fovMeters: number, options: CameraOptions = {}): MicroCameraSetup {
  const dir = new THREE.Vector3(...(options.dir ?? [0.32, 0.42, 1])).normalize();
  const distance = (options.distance ?? 1.6) * fovMeters;
  const target = options.target ?? [0, 0, 0];
  // Near plane follows the field of view but is floored at 1e-10 m (0.1 nm): below that the
  // depth buffer loses precision and the 0.4 nm layer would clip its own atoms.
  return {
    near: Math.max(fovMeters * 2.5e-4, 1e-10),
    far: fovMeters * 25,
    fovDeg: options.fovDeg ?? 36,
    position: [dir.x * distance + target[0], dir.y * distance + target[1], dir.z * distance + target[2]],
    target: [target[0], target[1], target[2]],
    up: options.up ?? [0, 1, 0],
    background: options.background ?? 0x0b1014
  };
}

/** Builds the ten-item metadata record around a level's geometry. */
function assemble(spec: MicroLevelSpec, runtime: LevelRuntime): MicroLevelABuild {
  const fovMeters = spec.fovMeters;
  if (fovMeters !== null) runtime.group.scale.setScalar(fovMeters);
  runtime.group.name = 'micro-route-A:' + spec.levelId;
  const camera: MicroCameraSetup = runtime.camera ?? makeCamera(fovMeters ?? 1);
  const legend = runtime.legend ?? [];
  if (legend.length > 0) {
    const sprite = makeLegendSprite(legend, runtime.legendTitle);
    sprite.position.set(-0.52, 0.42, -0.2);
    sprite.scale.multiplyScalar(0.9);
    runtime.group.add(sprite);
  }
  const extras: MicroLevelExtras = {
    camera,
    scaleBar: {
      meters: spec.scaleBarMeters ?? 0,
      label: spec.scaleBarMeters === null ? '—' : formatMeters(spec.scaleBarMeters)
    },
    views: runtime.views ?? [],
    activeViewId: runtime.activeViewId ?? (runtime.views?.[0]?.id ?? 'overview'),
    legend,
    legendTitle: runtime.legendTitle,
    geometryNote: spec.geometrySource,
    evidenceNote: spec.evidenceNote,
    colorNote: spec.colorNote,
    sources: spec.sources.slice(),
    actions: { ...spec.actions },
    parentObjectId: spec.parentObjectId,
    sampleStatus: spec.sampleStatus,
    pausable: runtime.pausable === true,
    pause: runtime.pause,
    resume: runtime.resume,
    isPaused: runtime.isPaused,
    ready: runtime.ready
  };
  const build: MicroLevelABuild = {
    levelId: spec.levelId,
    group: runtime.group,
    update: runtime.update,
    dispose: runtime.dispose,
    fovMeters: spec.fovMeters,
    fovLabel: spec.fovLabel,
    imaging: spec.imaging,
    colorStatus: spec.colorStatus,
    evidence: spec.evidence,
    limitation: spec.limitation,
    scaleBarMeters: spec.scaleBarMeters,
    extras
  };
  return build;
}

/** Mesh helper with shared material handling kept local to a level. */
function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function standardMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0, ...params });
}

/* ------------------------------------------------------------------ */
/* Level 1 — 湿溪石 / 20 cm: natural light + photogrammetric rock        */
/* ------------------------------------------------------------------ */

const ROCK_GLB = '/assets/v2/web/r7-biofilm-rock.glb';
const ROCK_LONGEST_UNITS = 2.4;

function buildWetRock(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(20401);
  const disposables: Array<() => void> = [];
  let disposed = false;
  let glbRoot: THREE.Object3D | null = null;
  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  addLights(group, {
    hemi: { sky: 0xbfd3e0, ground: 0x3b382c, intensity: 1.05 },
    key: { color: 0xfff0d4, intensity: 2.4, position: [-3.1, 4.2, 2.6] },
    fill: { color: 0x9dbad2, intensity: 0.65, position: [4.0, 1.6, -3.2] },
    rim: { color: 0xdfe9ef, intensity: 0.45, position: [0.4, 2.4, -4.4] }
  });

  // Procedural fallback boulder: only visible until the GLB arrives (or if it never does).
  const fallbackMaterial = standardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 });
  const fallbackGeometry = displacedIcosahedron(1.15, low ? 3 : 4, rng, 0.16, 0.52);
  vertexColorNoise(fallbackGeometry, new THREE.Color(0x413d34), new THREE.Color(0x6b6455), 2.2, 9);
  const fallback = mesh(fallbackGeometry, fallbackMaterial);
  fallback.position.set(0, -0.34, 0);
  group.add(fallback);
  disposables.push(() => fallbackGeometry.dispose(), () => fallbackMaterial.dispose());

  // Wet film pools + biofilm sheen patches: translucent, low roughness, deliberately slow.
  const waterMaterial = standardMaterial({
    color: 0x5f7d8a,
    roughness: 0.07,
    metalness: 0.12,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  });
  const biofilmMaterial = standardMaterial({
    color: 0x40502c,
    roughness: 0.38,
    metalness: 0.0,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    vertexColors: false
  });
  const waterGeometry = new THREE.SphereGeometry(1, low ? 14 : 22, low ? 8 : 12);
  const waterPatches: THREE.Mesh[] = [];
  const waterBaseScaleY: number[] = [];
  for (let i = 0; i < (low ? 5 : 9); i++) {
    const patch = mesh(waterGeometry, waterMaterial);
    const radius = randRange(rng, 0.10, 0.30);
    patch.position.set(randRange(rng, -0.5, 0.5), 0.012 + rng() * 0.02, randRange(rng, -0.42, 0.42));
    patch.scale.set(radius, radius * 0.035, radius * randRange(rng, 0.6, 1.0));
    patch.rotation.y = rng() * Math.PI;
    group.add(patch);
    waterPatches.push(patch);
    waterBaseScaleY.push(patch.scale.y);
  }
  for (let i = 0; i < (low ? 4 : 7); i++) {
    const patch = mesh(waterGeometry, biofilmMaterial);
    const radius = randRange(rng, 0.06, 0.20);
    patch.position.set(randRange(rng, -0.55, 0.55), 0.016 + rng() * 0.015, randRange(rng, -0.45, 0.45));
    patch.scale.set(radius, radius * 0.028, radius * randRange(rng, 0.5, 0.9));
    patch.rotation.y = rng() * Math.PI;
    group.add(patch);
  }
  disposables.push(() => waterGeometry.dispose(), () => waterMaterial.dispose(), () => biofilmMaterial.dispose());

  // Coarse sand / gravel grains on the surface (2–8 mm at this scale).
  const grainGeometry = displacedIcosahedron(1, low ? 0 : 1, rng, 0.22);
  const grainMaterial = standardMaterial({ color: 0x6f6857, roughness: 0.95 });
  const grainCount = low ? 60 : 150;
  const grainMatrices: THREE.Matrix4[] = [];
  const grainColors: THREE.Color[] = [];
  for (let i = 0; i < grainCount; i++) {
    const radius = randRange(rng, 0.008, 0.038);
    const position = new THREE.Vector3(
      randRange(rng, -0.85, 0.85),
      randRange(rng, 0.0, 0.05),
      randRange(rng, -0.7, 0.7)
    );
    const direction = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    const matrix = orientMatrix(position, direction, radius);
    grainMatrices.push(matrix);
    grainColors.push(new THREE.Color().setHSL(0.09, 0.08, randRange(rng, 0.22, 0.46)));
  }
  const grains = instanced(grainGeometry, grainMaterial, grainMatrices, grainColors);
  group.add(grains);
  disposables.push(() => grainGeometry.dispose(), () => grainMaterial.dispose());

  // Sampling-location annotation: a thin ring marking where the 200 μm layer is taken.
  // It is an annotation, not a physical object on the rock.
  const ringGeometry = new THREE.TorusGeometry(0.055, 0.0016, 6, low ? 40 : 72);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xf2efe6, transparent: true, opacity: 0.85, depthTest: true });
  const ring = mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.035, 0);
  group.add(ring);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const tick = mesh(new THREE.BoxGeometry(0.0016, 0.0016, 0.018), ringMaterial);
    tick.position.set(Math.cos(angle) * 0.078, 0.035, Math.sin(angle) * 0.078);
    tick.rotation.y = -angle;
    group.add(tick);
  }
  disposables.push(() => ringGeometry.dispose(), () => ringMaterial.dispose());

  // Photogrammetric parent rock, loaded asynchronously; replaced fallback keeps the layer usable.
  const loadPromise = loadGLB(ROCK_GLB)
    .then((gltf) => {
      if (disposed) {
        gltf.scene.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            const mat = m.material as THREE.Material | THREE.Material[];
            for (const one of Array.isArray(mat) ? mat : [mat]) one.dispose();
          }
        });
        return;
      }
      glbRoot = gltf.scene;
      fitObject(glbRoot, { targetLongest: ROCK_LONGEST_UNITS, castShadow: false, receiveShadow: true, yaw: 0.35 });
      const box = new THREE.Box3().setFromObject(glbRoot);
      const center = box.getCenter(new THREE.Vector3());
      glbRoot.position.x -= center.x;
      glbRoot.position.z -= center.z;
      glbRoot.position.y += -0.02 - box.min.y;
      group.add(glbRoot);
      fallback.visible = false;
    })
    .catch(() => {
      // Keep the procedural boulder; the HUD reports the degraded parent via extras.ready.
    })
    .finally(() => {
      if (readyResolve) readyResolve();
    });

  const clock = { t: 0 };
  const update = (dt: number): void => {
    clock.t += dt;
    const shimmer = 0.5 + 0.5 * Math.sin(clock.t * 0.45);
    waterMaterial.roughness = 0.055 + shimmer * 0.06;
    waterMaterial.opacity = 0.38 + shimmer * 0.06;
    for (let i = 0; i < waterPatches.length; i++) {
      waterPatches[i].scale.y = waterBaseScaleY[i] * (1 + Math.sin(clock.t * 0.18 + i) * 0.05);
    }
  };

  const dispose = (): void => {
    disposed = true;
    for (const fn of disposables) fn();
    disposeObject(group);
    void loadPromise;
  };

  return {
    group,
    update,
    dispose,
    ready,
    camera: makeCamera(spec.fovMeters ?? 0.2, {
      dir: [0.22, 0.5, 1],
      distance: 1.35,
      fovDeg: 38,
      background: 0x6f7f86,
      target: [0, 0.02, 0],
      up: [0, 1, 0]
    }),
    views: [
      {
        id: 'overview',
        label: '概览',
        apply: () => {
          group.rotation.set(0, 0, 0);
        }
      }
    ],
    legend: [
      { color: 0x5f7d8a, text: '水膜（材质示意）' },
      { color: 0x40502c, text: '生物膜斑块（设计标注）' },
      { color: 0xf2efe6, text: '取样位置标注（非实物）' }
    ],
    legendTitle: '20 cm · 自然光'
  };
}

/* ------------------------------------------------------------------ */
/* Level 2 — 生物膜基质 / 200 μm: schematic EPS network                  */
/* ------------------------------------------------------------------ */

function buildBiofilmMatrix(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(20502);
  const camera = makeCamera(spec.fovMeters ?? 2e-4, {
    dir: [0.14, 0.42, 1],
    distance: 1.5,
    fovDeg: 34,
    background: 0x061417
  });

  addLights(group, {
    ambient: 0.35,
    hemi: { sky: 0x8fe6d8, ground: 0x08181a, intensity: 0.7 },
    key: { color: 0xd8fff4, intensity: 1.6, position: [-2.2, 2.6, 2.4] },
    fill: { color: 0x4f9cff, intensity: 0.7, position: [2.6, 0.6, -1.8] }
  });

  const matrix = new THREE.Group();
  group.add(matrix);

  // Substrate fragment (the same sampling spot, different observation logic).
  const substrateGeometry = displacedIcosahedron(1.25, low ? 3 : 4, rng, 0.2, 0.3);
  vertexColorNoise(substrateGeometry, new THREE.Color(0x1c2624), new THREE.Color(0x35403a), 3.0, 12);
  const substrateMaterial = standardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const substrate = mesh(substrateGeometry, substrateMaterial);
  substrate.position.set(0, -0.62, -0.1);
  matrix.add(substrate);

  // Pore voids: dark spheres declared as "空隙" encoding, not empty space rendered honestly.
  const poreGeometry = new THREE.SphereGeometry(1, low ? 10 : 16, low ? 8 : 12);
  const poreMaterial = standardMaterial({ color: 0x05141a, roughness: 0.6, metalness: 0.0 });
  for (let i = 0; i < (low ? 7 : 13); i++) {
    const radius = randRange(rng, 0.035, 0.075);
    const position = new THREE.Vector3(
      randRange(rng, -0.42, 0.42),
      randRange(rng, -0.16, 0.3),
      randRange(rng, -0.3, 0.2)
    );
    const pore = mesh(poreGeometry, poreMaterial);
    pore.position.copy(position);
    pore.scale.set(radius, radius * randRange(rng, 0.7, 1.1), radius);
    matrix.add(pore);
  }

  // EPS filaments: random-walk tubes. Diameter exaggerated for legibility (declared in legend).
  const fibreMaterial = standardMaterial({
    color: 0x63d9c4,
    emissive: 0x0d3c37,
    emissiveIntensity: 0.55,
    roughness: 0.45,
    metalness: 0.05
  });
  const filmMaterial = standardMaterial({
    color: 0x8ef0dd,
    emissive: 0x11504a,
    emissiveIntensity: 0.4,
    roughness: 0.35,
    transparent: true,
    opacity: 0.28,
    depthWrite: false
  });
  const filamentCount = low ? 12 : 26;
  for (let i = 0; i < filamentCount; i++) {
    const start: Vec3 = [
      randRange(rng, -0.55, 0.55),
      randRange(rng, -0.42, -0.1),
      randRange(rng, -0.35, 0.35)
    ];
    const path = walkPath(start, low ? 4 : 7, 0.085, rng, 0.85);
    const geometry = tubeGeometry(path, randRange(rng, 0.0035, 0.0065), low ? 4 : 6);
    matrix.add(mesh(geometry, fibreMaterial));
    if (rng() < 0.4) {
      const sheetGeometry = tubeGeometry(path, 0.014, 4);
      const sheet = mesh(sheetGeometry, filmMaterial);
      sheet.scale.set(1.5, 1.5, 1.5);
      matrix.add(sheet);
    }
  }

  // Cells: capsule rods, some with thin attachment pili reaching the substrate.
  const cellMaterial = standardMaterial({
    color: 0xe8b24a,
    emissive: 0x3a2405,
    emissiveIntensity: 0.35,
    roughness: 0.5,
    metalness: 0.0
  });
  const pilusMaterial = standardMaterial({ color: 0xf0d9a8, roughness: 0.6 });
  const cellGeometry = new THREE.CapsuleGeometry(0.0095, 0.03, low ? 3 : 6, low ? 6 : 10);
  const cellCount = low ? 9 : 20;
  for (let i = 0; i < cellCount; i++) {
    const cell = mesh(cellGeometry, cellMaterial);
    const position = new THREE.Vector3(
      randRange(rng, -0.5, 0.5),
      randRange(rng, -0.2, 0.26),
      randRange(rng, -0.34, 0.26)
    );
    cell.position.copy(position);
    cell.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize()
    );
    cell.scale.setScalar(randRange(rng, 0.7, 1.3));
    matrix.add(cell);
    if (rng() < 0.55) {
      const tip = position.clone().add(new THREE.Vector3(randRange(rng, -0.06, 0.06), -0.1, randRange(rng, -0.06, 0.06)));
      const pilus = cylinderBetween(position, tip, 0.0016, pilusMaterial, 4);
      matrix.add(pilus);
    }
  }

  // Water channels: very faint translucent tubes threading the matrix.
  const channelMaterial = standardMaterial({
    color: 0x4a86ff,
    transparent: true,
    opacity: 0.16,
    roughness: 0.2,
    depthWrite: false
  });
  for (let i = 0; i < (low ? 2 : 4); i++) {
    const path = walkPath(
      [randRange(rng, -0.5, 0.5), randRange(rng, -0.3, -0.05), randRange(rng, -0.3, 0.3)],
      6,
      0.14,
      rng,
      0.4
    );
    matrix.add(mesh(tubeGeometry(path, 0.02, 5), channelMaterial));
  }

  const state = { t: 0, paused: false };
  const update = (dt: number): void => {
    if (state.paused) return;
    state.t += dt;
    matrix.rotation.y = Math.sin(state.t * 0.11) * 0.085;
    matrix.rotation.x = Math.sin(state.t * 0.07 + 1.1) * 0.025;
    matrix.position.y = Math.sin(state.t * 0.09) * 0.006;
  };

  return {
    group,
    update,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'matrix',
    views: [
      {
        id: 'matrix',
        label: '基质网',
        apply: () => {
          const fov = spec.fovMeters ?? 2e-4;
          camera.position = [-0.21 * fov, 0.42 * fov, 1.5 * fov];
          camera.target = [0, 0, 0];
          camera.up = [0, 1, 0];
        }
      },
      {
        id: 'pores',
        label: '孔隙',
        apply: () => {
          const fov = spec.fovMeters ?? 2e-4;
          camera.position = [0.72 * fov, 0.2 * fov, 0.95 * fov];
          camera.target = [0.18 * fov, -0.06 * fov, 0.0];
        }
      }
    ],
    legend: [
      { color: 0x63d9c4, text: 'EPS 纤维（直径已夸大显示）' },
      { color: 0xe8b24a, text: '细菌细胞（示意，非鉴定）' },
      { color: 0x05141a, text: '孔隙 / 空隙（示意）' },
      { color: 0x4a86ff, text: '水通道（示意）' }
    ],
    legendTitle: '200 μm · 示意色',
    pausable: true,
    pause: () => {
      state.paused = true;
    },
    resume: () => {
      state.paused = false;
    },
    isPaused: () => state.paused
  };
}

/* ------------------------------------------------------------------ */
/* Level 3 — 硅藻群落 / 50 μm: brightfield optical community            */
/* ------------------------------------------------------------------ */

function buildDiatomAssemblage(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(20603);
  const fov = spec.fovMeters ?? 5e-5;
  const camera = makeCamera(fov, {
    dir: [0.1, 0.52, 1],
    distance: 1.5,
    fovDeg: 34,
    background: 0xe9e5dc
  });

  // Brightfield light: flat, slightly warm, low contrast. No cast shadows in a light microscope.
  addLights(group, {
    ambient: 1.15,
    hemi: { sky: 0xfffaf0, ground: 0xd8d2c4, intensity: 0.9 },
    key: { color: 0xfff6e2, intensity: 1.1, position: [-1.4, 2.2, 2.2] },
    fill: { color: 0xdce8f2, intensity: 0.55, position: [1.8, 0.8, -1.6] }
  });

  // Diffuser backdrop: the bright field behind the community.
  const backdropMaterial = new THREE.MeshBasicMaterial({ color: 0xe9e5dc, toneMapped: false });
  const backdrop = mesh(new THREE.PlaneGeometry(4, 3), backdropMaterial);
  backdrop.position.set(0, 0.1, -1.1);
  group.add(backdrop);

  // Substrate fragment: the sampling spot's rock surface at 50 μm.
  const substrateGeometry = displacedIcosahedron(1.5, low ? 3 : 4, rng, 0.22, 0.22);
  vertexColorNoise(substrateGeometry, new THREE.Color(0x6b6353), new THREE.Color(0x8d8474), 2.2, 21);
  const substrateMaterial = standardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
  const substrate = mesh(substrateGeometry, substrateMaterial);
  substrate.position.set(0.05, -0.62, -0.05);
  group.add(substrate);

  const silicaMaterial = standardMaterial({
    color: 0xc9b98f,
    roughness: 0.28,
    metalness: 0.0,
    transparent: true,
    opacity: 0.62,
    depthWrite: false
  });
  const chloroplastMaterial = standardMaterial({
    color: 0xa8782c,
    emissive: 0x3a2408,
    emissiveIntensity: 0.35,
    roughness: 0.75,
    transparent: true,
    opacity: 0.85
  });
  const stalkMaterial = standardMaterial({ color: 0xd8ceb4, roughness: 0.6, transparent: true, opacity: 0.7 });

  const community = new THREE.Group();
  group.add(community);

  const addChloroplast = (parent: THREE.Group, length: number, width: number): void => {
    const geometry = new THREE.SphereGeometry(1, low ? 8 : 14, low ? 6 : 10);
    const chloroplast = mesh(geometry, chloroplastMaterial);
    chloroplast.scale.set(width * 0.26, 0.012, length * 0.3);
    chloroplast.rotation.x = Math.PI * 0.5;
    parent.add(chloroplast);
  };

  // A. Naviculoid pennate valve (boat shaped) with a visible raphe line.
  const naviculaGeometry = lensGeometry(0.34, 0.11, 0.035, low ? 16 : 26, low ? 8 : 14);
  const rapheGeometry = new THREE.CylinderGeometry(0.0035, 0.0016, 0.28, 5, 1, false);
  for (let i = 0; i < (low ? 3 : 5); i++) {
    const cell = new THREE.Group();
    const valve = mesh(naviculaGeometry, silicaMaterial);
    valve.rotation.x = Math.PI * 0.5;
    cell.add(valve);
    const raphe = mesh(rapheGeometry, silicaMaterial);
    raphe.rotation.x = Math.PI * 0.5;
    raphe.position.y = 0.019;
    cell.add(raphe);
    addChloroplast(cell, 0.34, 0.11);
    cell.position.set(randRange(rng, -0.5, 0.52), randRange(rng, -0.02, 0.12), randRange(rng, -0.34, 0.3));
    cell.rotation.y = randRange(rng, -0.9, 0.9);
    cell.rotation.z = randRange(rng, -0.08, 0.08);
    community.add(cell);
  }

  // B. Araphid ribbon / tablet diatom with transverse striae.
  const ribbonGeometry = lensGeometry(0.46, 0.085, 0.05, low ? 14 : 22, low ? 8 : 12);
  const striaGeometry = new THREE.CylinderGeometry(0.0018, 0.0018, 0.072, 4, 1, false);
  for (let i = 0; i < (low ? 2 : 3); i++) {
    const cell = new THREE.Group();
    const body = mesh(ribbonGeometry, silicaMaterial);
    body.rotation.x = Math.PI * 0.5;
    cell.add(body);
    const count = low ? 8 : 14;
    for (let k = 0; k < count; k++) {
      const stria = mesh(striaGeometry, silicaMaterial);
      stria.rotation.z = Math.PI * 0.5;
      stria.position.set(0, 0.026, -0.19 + (k / (count - 1)) * 0.38);
      cell.add(stria);
    }
    addChloroplast(cell, 0.46, 0.085);
    cell.position.set(randRange(rng, -0.55, 0.45), randRange(rng, 0.02, 0.1), randRange(rng, -0.2, 0.3));
    cell.rotation.y = randRange(rng, 0.3, 1.4);
    community.add(cell);
  }

  // C. Centric diatom disc with radial pattern (a different morphology, not a scaled copy).
  const discGeometry = new THREE.CylinderGeometry(0.13, 0.135, 0.03, low ? 20 : 34, 1, false);
  const radialGeometry = new THREE.CylinderGeometry(0.0018, 0.0018, 0.12, 4, 1, false);
  for (let i = 0; i < (low ? 1 : 2); i++) {
    const cell = new THREE.Group();
    const disc = mesh(discGeometry, silicaMaterial);
    cell.add(disc);
    for (let k = 0; k < (low ? 10 : 18); k++) {
      const angle = (k / (low ? 10 : 18)) * Math.PI * 2;
      const line = mesh(radialGeometry, silicaMaterial);
      line.rotation.z = Math.PI * 0.5;
      line.rotation.y = angle;
      line.position.set(Math.cos(angle) * 0.055, 0.016, Math.sin(angle) * 0.055);
      cell.add(line);
    }
    addChloroplast(cell, 0.22, 0.22);
    cell.position.set(randRange(rng, -0.45, -0.15), randRange(rng, 0.04, 0.14), randRange(rng, -0.3, 0.05));
    cell.rotation.z = randRange(rng, -0.12, 0.12);
    community.add(cell);
  }

  // D. Club-shaped diatom on a stalk: the attachment habit, not just a shell shape.
  const clubGeometry = lensGeometry(0.24, 0.13, 0.05, low ? 14 : 20, low ? 8 : 12);
  for (let i = 0; i < (low ? 2 : 3); i++) {
    const cell = new THREE.Group();
    const body = mesh(clubGeometry, silicaMaterial);
    body.rotation.x = Math.PI * 0.5;
    body.position.y = 0.1;
    cell.add(body);
    addChloroplast(cell, 0.12, 0.1);
    const stalkPath: Vec3[] = [
      [0, -0.16, 0],
      [0.01, -0.08, 0.005],
      [0.008, -0.02, 0.004]
    ];
    cell.add(mesh(tubeGeometry(stalkPath, 0.005, 5), stalkMaterial));
    cell.position.set(randRange(rng, 0.18, 0.55), randRange(rng, 0.06, 0.16), randRange(rng, -0.3, 0.15));
    cell.rotation.y = randRange(rng, -0.7, 0.7);
    community.add(cell);
  }

  // Detritus / silt grains that share the field, so the field is not an icon array.
  const siltGeometry = displacedIcosahedron(1, 0, rng, 0.25);
  const siltMaterial = standardMaterial({ color: 0x9a8f78, roughness: 0.85 });
  const siltMatrices: THREE.Matrix4[] = [];
  const siltColors: THREE.Color[] = [];
  for (let i = 0; i < (low ? 22 : 55); i++) {
    const radius = randRange(rng, 0.0025, 0.008);
    const matrix = orientMatrix(
      new THREE.Vector3(randRange(rng, -0.7, 0.7), randRange(rng, -0.14, 0.14), randRange(rng, -0.5, 0.5)),
      new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      radius
    );
    siltMatrices.push(matrix);
    siltColors.push(new THREE.Color().setHSL(0.1, 0.15, randRange(rng, 0.35, 0.6)));
  }
  community.add(instanced(siltGeometry, siltMaterial, siltMatrices, siltColors));

  return {
    group,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'community',
    views: [
      {
        id: 'community',
        label: '群落',
        apply: () => {
          camera.position = [0.1 * fov, 0.52 * fov, 1.5 * fov];
          camera.target = [0, 0.02 * fov, 0];
          camera.up = [0, 1, 0];
        }
      },
      {
        id: 'substrate',
        label: '附着面',
        apply: () => {
          camera.position = [-0.75 * fov, -0.16 * fov, 1.2 * fov];
          camera.target = [0.02 * fov, 0.02 * fov, 0];
          camera.up = [0, 1, 0];
        }
      }
    ],
    legend: [
      { color: 0xc9b98f, text: '硅质壳（透明示意）' },
      { color: 0xa8782c, text: '叶绿体（黄褐，示意）' },
      { color: 0xd8ceb4, text: '附着柄（示意）' }
    ],
    legendTitle: '50 μm · 明场'
  };
}

/* ------------------------------------------------------------------ */
/* Level 4 — 完整硅藻壳 / 20 μm: one independent frustule, two view axes */
/* ------------------------------------------------------------------ */

function buildDiatomFrustule(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(20704);
  const fov = spec.fovMeters ?? 2e-5;
  const camera = makeCamera(fov, {
    dir: [0.05, 1, 0.02],
    distance: 1.55,
    fovDeg: 32,
    background: 0xdfe4e2,
    up: [0, 0, 1]
  });

  addLights(group, {
    ambient: 1.0,
    hemi: { sky: 0xf4f8f8, ground: 0xbfc6c0, intensity: 0.85 },
    key: { color: 0xffffff, intensity: 1.25, position: [-1.2, 2.0, 1.6] },
    rim: { color: 0xd6e6f2, intensity: 0.5, position: [1.6, 0.6, -1.8] }
  });

  const backdrop = mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshBasicMaterial({ color: 0xdfe4e2, toneMapped: false })
  );
  backdrop.position.set(0, 0, -0.85);
  group.add(backdrop);

  // Frustule frame: long axis X, width Z, height Y. Pennate, not a scaled community cell.
  const halfLength = 0.35;
  const halfWidth = 0.15;
  const girdleHalfHeight = 0.09;
  const domeHeight = 0.075;

  const silicaMaterial = standardMaterial({
    color: 0xd8cfb6,
    roughness: 0.22,
    metalness: 0.0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const girdleMaterial = standardMaterial({
    color: 0xc3b795,
    roughness: 0.3,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const seamMaterial = standardMaterial({
    color: 0xb2a583,
    roughness: 0.35,
    transparent: true,
    opacity: 0.85
  });
  const chloroplastMaterial = standardMaterial({
    color: 0xa9822f,
    emissive: 0x2e1c05,
    emissiveIntensity: 0.4,
    roughness: 0.7,
    transparent: true,
    opacity: 0.9
  });

  const frustule = new THREE.Group();
  frustule.rotation.x = 0.02;
  group.add(frustule);

  // Girdle wall (the lateral wall between the two valves).
  const girdleGeometry = new THREE.CylinderGeometry(1, 1, 1, low ? 28 : 56, 1, true);
  const girdle = mesh(girdleGeometry, girdleMaterial);
  girdle.scale.set(halfLength, girdleHalfHeight * 2, halfWidth);
  frustule.add(girdle);

  // Two domed valves (top and bottom), each its own half sphere.
  const domeGeometry = new THREE.SphereGeometry(1, low ? 32 : 64, low ? 10 : 20, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const topValve = mesh(domeGeometry, silicaMaterial);
  topValve.scale.set(halfLength, domeHeight, halfWidth);
  topValve.position.y = girdleHalfHeight;
  frustule.add(topValve);
  const bottomValve = mesh(domeGeometry, silicaMaterial);
  bottomValve.scale.set(halfLength, domeHeight, halfWidth);
  bottomValve.rotation.x = Math.PI;
  bottomValve.position.y = -girdleHalfHeight;
  frustule.add(bottomValve);

  // Girdle bands: elliptical rings around the wall (壳环带), visible in the girdle view.
  const bandHeights = [-0.055, 0, 0.055];
  for (let i = 0; i < bandHeights.length; i++) {
    const y = bandHeights[i];
    const points: Vec3[] = [];
    const steps = low ? 30 : 60;
    for (let k = 0; k < steps; k++) {
      const angle = (k / steps) * Math.PI * 2;
      points.push([Math.cos(angle) * halfLength, y, Math.sin(angle) * halfWidth]);
    }
    frustule.add(mesh(tubeGeometry(points, 0.0042, 5, true), seamMaterial));
  }

  // Valve/girdle seam on both ends of the valves.
  for (const y of [girdleHalfHeight, -girdleHalfHeight]) {
    const points: Vec3[] = [];
    const steps = low ? 30 : 60;
    for (let k = 0; k < steps; k++) {
      const angle = (k / steps) * Math.PI * 2;
      points.push([Math.cos(angle) * halfLength * 1.002, y, Math.sin(angle) * halfWidth * 1.002]);
    }
    frustule.add(mesh(tubeGeometry(points, 0.005, 5, true), seamMaterial));
  }

  // Raphe: a straight slit along the apical axis on the top valve (valve-face feature).
  const raphePoints: Vec3[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = (k / 12) * 2 - 1;
    raphePoints.push([t * halfLength * 0.94, girdleHalfHeight + domeHeight * Math.sqrt(Math.max(0.02, 1 - t * t)) + 0.004, 0]);
  }
  frustule.add(mesh(tubeGeometry(raphePoints, 0.0055, 6), seamMaterial));

  // Coarse striae rows: only a hint of ornamentation; areolae are the 2 μm layer's job.
  const striaeMaterial = standardMaterial({ color: 0xbeb18d, roughness: 0.4, transparent: true, opacity: 0.5 });
  for (let i = 0; i < (low ? 6 : 11); i++) {
    const t = (i / (low ? 5 : 10)) * 2 - 1;
    const x = t * halfLength * 0.82;
    const domeY = girdleHalfHeight + domeHeight * Math.sqrt(Math.max(0.02, 1 - t * t)) + 0.002;
    const points: Vec3[] = [];
    for (let k = 0; k <= 8; k++) {
      const u = (k / 8) * 2 - 1;
      points.push([x, domeY - 0.008 * u * u, u * halfWidth * 0.86]);
    }
    frustule.add(mesh(tubeGeometry(points, 0.0022, 4), striaeMaterial));
  }

  // Two visible chloroplast bodies through the translucent shell.
  for (const sign of [-1, 1] as const) {
    const chloroplast = mesh(new THREE.SphereGeometry(1, low ? 10 : 18, low ? 8 : 12), chloroplastMaterial);
    chloroplast.scale.set(0.19, 0.042, 0.078);
    chloroplast.position.set(sign * 0.1, 0.0, 0.0);
    frustule.add(chloroplast);
  }

  // A little detritus on the valve face keeps it from reading as a clean icon.
  const speckGeometry = displacedIcosahedron(1, 0, rng, 0.3);
  const speckMaterial = standardMaterial({ color: 0x9c937c, roughness: 0.9 });
  const speckMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < (low ? 8 : 18); i++) {
    const angle = rng() * Math.PI * 2;
    const t = rng() * 2 - 1;
    const x = t * halfLength * 0.85;
    const z = Math.cos(angle) * halfWidth * 0.8;
    const y = girdleHalfHeight + domeHeight * Math.sqrt(Math.max(0.05, 1 - t * t)) + 0.003;
    speckMatrices.push(
      orientMatrix(new THREE.Vector3(x, y, z), new THREE.Vector3(rng() - 0.5, 1, rng() - 0.5).normalize(), randRange(rng, 0.002, 0.006))
    );
  }
  frustule.add(instanced(speckGeometry, speckMaterial, speckMatrices));

  // A faint halo rim so the silhouette reads against the bright field.
  const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x9aa49c, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const halo = mesh(
    new THREE.RingGeometry(1, 1.06, low ? 40 : 72),
    haloMaterial
  );
  halo.rotation.x = -Math.PI * 0.5;
  halo.scale.set(halfLength * 1.08, halfWidth * 1.08, 1);
  halo.position.y = -girdleHalfHeight - domeHeight - 0.004;
  frustule.add(halo);

  const views: MicroLevelView[] = [
    {
      id: 'valve',
      label: '壳面视角',
      apply: () => {
        camera.position = [0.02 * fov, 1.55 * fov, 0.001 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 0, 1];
      }
    },
    {
      id: 'girdle',
      label: '壳环视角',
      apply: () => {
        camera.position = [1.55 * fov, 0.16 * fov, 0.02 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 1, 0];
      }
    },
    {
      id: 'oblique',
      label: '斜视',
      apply: () => {
        camera.position = [0.95 * fov, 0.95 * fov, 0.7 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 1, 0];
      }
    }
  ];

  return {
    group,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'valve',
    views,
    legend: [
      { color: 0xd8cfb6, text: '硅质壳（透明示意）' },
      { color: 0xa9822f, text: '叶绿体（示意）' },
      { color: 0xb2a583, text: '壳缝 / 壳环带（形态示意）' }
    ],
    legendTitle: '20 μm · 明场'
  };
}

/* ------------------------------------------------------------------ */
/* Level 5 — 壳面局部 / 2 μm: curved areola fragment, grayscale SEM       */
/* ------------------------------------------------------------------ */

function buildValveDetail(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(20805);
  const fov = spec.fovMeters ?? 2e-6;
  const radius = 6;
  const halfAngleU = Math.PI * 0.034;
  const halfAngleV = Math.PI * 0.028;
  const camera = makeCamera(fov, {
    dir: [0.08, 0.42, 1],
    distance: 1.45,
    fovDeg: 30,
    background: 0x08090b
  });

  // SEM language: hard key light, dark background, near-zero ambient.
  addLights(group, {
    ambient: 0.12,
    key: { color: 0xf2f5f7, intensity: 3.1, position: [-2.4, 3.0, 2.2] },
    fill: { color: 0x93a2ad, intensity: 0.5, position: [3.2, 0.4, 1.4] },
    rim: { color: 0xdfe9f0, intensity: 0.9, position: [1.2, 1.4, -3.4] }
  });

  const patch = spherePatch(radius, halfAngleU, halfAngleV, low ? 14 : 30, low ? 14 : 30);
  const baseMaterial = standardMaterial({
    color: 0xb6bcc0,
    roughness: 0.58,
    metalness: 0.06,
    side: THREE.DoubleSide
  });
  const base = mesh(patch.geometry, baseMaterial);
  group.add(base);

  // Areolae: hexagonal rims arranged in a hex grid, each oriented to the local surface normal.
  const hexPoints: Vec3[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (k / 6) * Math.PI * 2 + Math.PI / 6;
    hexPoints.push([Math.cos(angle), 0, Math.sin(angle)]);
  }
  const hexGeometry = tubeGeometry(hexPoints, 0.13, 4, true);
  const rimMaterial = standardMaterial({ color: 0xd3d8dc, roughness: 0.5, metalness: 0.05 });
  const rimMatrices: THREE.Matrix4[] = [];
  const arcPitch = 0.088;
  const stepU = Math.tan(arcPitch / radius) / halfAngleU;
  const stepV = Math.tan(arcPitch / radius) / halfAngleV;
  const gridStep = low ? 2 : 1;
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const basisQuaternion = new THREE.Quaternion();
  const spinQuaternion = new THREE.Quaternion();
  for (let iv = -10; iv <= 10; iv += gridStep) {
    const v = iv * stepV;
    if (Math.abs(v) > 0.94) continue;
    for (let iu = -11; iu <= 11; iu += gridStep) {
      const u = (iu + (iv % 2 === 0 ? 0 : 0.5)) * stepU;
      if (Math.abs(u) > 0.94) continue;
      const position = patch.at(u, v);
      patch.normalAt(u, v, normal);
      basisQuaternion.setFromUnitVectors(up, normal);
      spinQuaternion.setFromAxisAngle(up, rng() * Math.PI);
      const quaternion = basisQuaternion.clone().multiply(spinQuaternion);
      const scale = 0.042 * gridStep;
      rimMatrices.push(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale)));
    }
  }
  group.add(instanced(hexGeometry, rimMaterial, rimMatrices));

  // Costae: raised transapical ribs following the curvature (areolae stop at the ribs).
  const costaMaterial = standardMaterial({ color: 0xc3c9cd, roughness: 0.52, metalness: 0.05 });
  for (let r = 0; r < (low ? 3 : 4); r++) {
    const u = -0.72 + r * 0.5;
    const points: Vec3[] = [];
    for (let k = 0; k <= 16; k++) {
      const v = (k / 16) * 1.8 - 0.9;
      const point = patch.at(u, v);
      patch.normalAt(u, v, normal);
      points.push([point.x + normal.x * 0.012, point.y + normal.y * 0.012, point.z + normal.z * 0.012]);
    }
    group.add(mesh(tubeGeometry(points, 0.014, 5), costaMaterial));
  }

  // Fracture / debris grains: broken shell pieces at the patch edge.
  const debrisGeometry = displacedIcosahedron(1, low ? 0 : 1, rng, 0.35);
  const debrisMaterial = standardMaterial({ color: 0xa9afb3, roughness: 0.7 });
  const debrisMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < (low ? 12 : 34); i++) {
    const u = randRange(rng, -0.98, 0.98);
    const v = randRange(rng, -0.98, 0.98);
    const point = patch.at(u, v);
    patch.normalAt(u, v, normal);
    debrisMatrices.push(
      orientMatrix(
        new THREE.Vector3(point.x + normal.x * 0.01, point.y + normal.y * 0.01, point.z + normal.z * 0.01),
        normal.clone(),
        randRange(rng, 0.004, 0.017)
      )
    );
  }
  group.add(instanced(debrisGeometry, debrisMaterial, debrisMatrices));

  const views: MicroLevelView[] = [
    {
      id: 'surface',
      label: '正视（孔纹）',
      apply: () => {
        camera.position = [0.09 * fov, 0.42 * fov, 1.1 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 1, 0];
      }
    },
    {
      id: 'oblique',
      label: '斜视（曲率）',
      apply: () => {
        camera.position = [0.82 * fov, 0.36 * fov, 0.85 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 1, 0];
      }
    }
  ];

  return {
    group,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'surface',
    views,
    legend: [],
    legendTitle: undefined
  };
}

/* ------------------------------------------------------------------ */
/* Level 6 — 壳壁剖面 / 200 nm: fracture cross-section, grayscale SEM    */
/* ------------------------------------------------------------------ */

function buildWallSection(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(20906);
  const fov = spec.fovMeters ?? 2e-7;
  const camera = makeCamera(fov, {
    dir: [0.12, 0.26, 1],
    distance: 1.55,
    fovDeg: 30,
    background: 0x07080a
  });

  addLights(group, {
    ambient: 0.1,
    key: { color: 0xf4f7f8, intensity: 3.0, position: [-2.6, 2.8, 2.6] },
    fill: { color: 0x8d9aa4, intensity: 0.45, position: [2.4, 0.2, 2.2] },
    rim: { color: 0xe8f0f4, intensity: 1.1, position: [0.6, 1.2, -3.2] }
  });

  // Wall geometry: outer skin (top), inner skin (bottom), vertical struts between them.
  // The gaps between struts are the pore channels that cross the wall.
  const wallLength = 2.5;
  const wallDepth = 0.62;
  const thickness = 0.58;
  const skinThickness = 0.075;
  const outerY = thickness * 0.5;
  const innerY = -thickness * 0.5;

  const silicaMaterial = standardMaterial({ color: 0xa8afb5, roughness: 0.62, metalness: 0.04 });
  const silicaDark = standardMaterial({ color: 0x7d858c, roughness: 0.68, metalness: 0.03 });
  const hydratedMaterial = standardMaterial({
    color: 0xc3cbd1,
    roughness: 0.4,
    metalness: 0.02,
    transparent: true,
    opacity: 0.45,
    depthWrite: false
  });

  // Outer surface: a wavy plate with noise displacement along the surface normal.
  const outerGeometry = new THREE.PlaneGeometry(wallLength, wallDepth, low ? 26 : 56, low ? 8 : 18);
  outerGeometry.rotateX(-Math.PI * 0.5);
  const outerPosition = outerGeometry.getAttribute('position') as THREE.BufferAttribute;
  const outerArray = outerPosition.array as Float32Array;
  for (let i = 0; i < outerArray.length; i += 3) {
    outerArray[i + 1] += fbm3(outerArray[i] * 3.6, outerArray[i + 2] * 3.6, 0.4, 3, 31) * 0.016;
  }
  outerPosition.needsUpdate = true;
  outerGeometry.computeVertexNormals();
  const outerSkin = mesh(outerGeometry, silicaMaterial);
  outerSkin.position.y = outerY;
  group.add(outerSkin);

  const innerGeometry = new THREE.PlaneGeometry(wallLength, wallDepth, low ? 20 : 40, low ? 6 : 12);
  innerGeometry.rotateX(Math.PI * 0.5);
  const innerSkin = mesh(innerGeometry, silicaDark);
  innerSkin.position.y = innerY;
  group.add(innerSkin);

  // Side faces close the block so the fracture face reads as a solid of material.
  const sideGeometry = new THREE.BoxGeometry(0.06, thickness, wallDepth);
  for (const x of [-wallLength * 0.5, wallLength * 0.5]) {
    const side = mesh(sideGeometry, silicaMaterial);
    side.position.set(x, 0, 0);
    group.add(side);
  }

  // Vertical struts (wall material) with channels between them.
  const strutGeometry = new THREE.BoxGeometry(1, thickness - skinThickness * 1.6, wallDepth * 0.94);
  const strutWidth = 0.062;
  const channelWidth = 0.1;
  const strutMaterial = standardMaterial({ color: 0x9aa2a8, roughness: 0.66, metalness: 0.03 });
  const strutStep = strutWidth + channelWidth;
  const strutCount = Math.floor(wallLength / strutStep);
  const strutMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < strutCount; i++) {
    const x = -wallLength * 0.5 + strutStep * (i + 0.5);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), randRange(rng, -0.04, 0.04)),
      new THREE.Vector3(strutWidth, 1, 1)
    );
    strutMatrices.push(matrix);
  }
  group.add(instanced(strutGeometry, strutMaterial, strutMatrices));

  // Hydrated silica: irregular thin sheets on the inner wall (declared as a示意 layer).
  for (let i = 0; i < (low ? 3 : 6); i++) {
    const width = randRange(rng, 0.16, 0.42);
    const geometry = new THREE.PlaneGeometry(width, wallDepth * randRange(rng, 0.5, 0.92), 6, 4);
    geometry.rotateX(-Math.PI * 0.5);
    const sheet = mesh(geometry, hydratedMaterial);
    sheet.position.set(randRange(rng, -wallLength * 0.42, wallLength * 0.42), innerY + skinThickness * 0.9, randRange(rng, -0.05, 0.05));
    sheet.rotation.z = randRange(rng, -0.04, 0.04);
    group.add(sheet);
  }

  // Fracture shards at both broken ends: the section is a break, not a machined cut.
  const shardGeometry = displacedIcosahedron(1, low ? 0 : 1, rng, 0.4);
  const shardMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < (low ? 8 : 20); i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const matrix = orientMatrix(
      new THREE.Vector3(side * randRange(rng, wallLength * 0.42, wallLength * 0.6), randRange(rng, -0.28, 0.28), randRange(rng, -0.25, 0.25)),
      new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      randRange(rng, 0.01, 0.05)
    );
    shardMatrices.push(matrix);
  }
  group.add(instanced(shardGeometry, silicaMaterial, shardMatrices));

  // Sub-nanometre surface granularity: SEM texture, not physical claim.
  const grainGeometry = new THREE.SphereGeometry(1, 6, 5);
  const grainMaterial = standardMaterial({ color: 0x8b9399, roughness: 0.75 });
  const grainMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < (low ? 80 : 220); i++) {
    const matrix = orientMatrix(
      new THREE.Vector3(
        randRange(rng, -wallLength * 0.5, wallLength * 0.5),
        outerY + 0.008 + Math.abs(fbm3(rng() * 4, rng() * 4, 0.2, 2, 5)) * 0.02,
        randRange(rng, -wallDepth * 0.5, wallDepth * 0.5)
      ),
      new THREE.Vector3(0, 1, 0),
      randRange(rng, 0.004, 0.012)
    );
    grainMatrices.push(matrix);
  }
  group.add(instanced(grainGeometry, grainMaterial, grainMatrices));

  const views: MicroLevelView[] = [
    {
      id: 'section',
      label: '剖面',
      apply: () => {
        camera.position = [0.13 * fov, 0.28 * fov, 1.2 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 1, 0];
      }
    },
    {
      id: 'oblique',
      label: '斜视（壁厚）',
      apply: () => {
        camera.position = [0.86 * fov, 0.44 * fov, 0.9 * fov];
        camera.target = [0, 0, 0];
        camera.up = [0, 1, 0];
      }
    }
  ];

  return {
    group,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'section',
    views,
    legend: [
      { color: 0xa8afb5, text: '外层硅质壁（灰度示意）' },
      { color: 0x0a0c0e, text: '孔道（贯穿壁厚）' },
      { color: 0xc3cbd1, text: '水合生物硅层（示意）' }
    ],
    legendTitle: '200 nm · 灰度 SEM'
  };
}

/* ------------------------------------------------------------------ */
/* Level 7 — 生物硅聚集 / 20 nm: short-range particle aggregation        */
/* ------------------------------------------------------------------ */

function buildSilicaAggregation(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(21007);
  const fov = spec.fovMeters ?? 2e-8;
  const camera = makeCamera(fov, {
    dir: [0.1, 0.22, 1],
    distance: 1.5,
    fovDeg: 32,
    background: 0x04060a
  });

  addLights(group, {
    ambient: 0.16,
    key: { color: 0xf2f6f8, intensity: 2.5, position: [-2.2, 2.4, 2.6] },
    fill: { color: 0x7f909c, intensity: 0.5, position: [2.6, 0.1, 1.4] },
    rim: { color: 0xdfeaf0, intensity: 1.6, position: [1.4, 1.6, -2.8] }
  });

  // Dark-field style glow behind the aggregate (a visual-language element, not a measured signal).
  const glowTexture = radialGradientTexture('rgba(150,168,178,0.42)', 'rgba(4,6,10,0)', 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  glow.scale.set(2.4, 2.4, 1);
  glow.position.set(0, 0, -0.9);
  group.add(glow);

  // Amorphous silica substrate: a low, dull mass that some aggregates sit on.
  const substrateGeometry = displacedIcosahedron(1.6, low ? 3 : 4, rng, 0.16, 0.12);
  const substrateMaterial = standardMaterial({ color: 0x4b555c, roughness: 0.8, metalness: 0.02 });
  const substrate = mesh(substrateGeometry, substrateMaterial);
  substrate.position.set(0.05, -0.52, -0.15);
  group.add(substrate);

  const particleGeometry = displacedIcosahedron(1, low ? 1 : 2, rng, 0.26);
  const particleMaterial = standardMaterial({
    color: 0xb9c0c5,
    roughness: 0.5,
    metalness: 0.06,
    vertexColors: false,
    flatShading: false
  });

  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const necks: THREE.Object3D[] = [];
  const neckMaterial = standardMaterial({ color: 0x9aa4ab, roughness: 0.55, metalness: 0.05 });
  const direction = new THREE.Vector3();
  const previous = new THREE.Vector3();

  const addParticle = (position: THREE.Vector3, radius: number): void => {
    matrices.push(
      orientMatrix(position, direction.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), radius)
    );
    const shade = randRange(rng, 0.55, 0.86);
    colors.push(new THREE.Color(shade, shade, shade * 1.02));
  };

  // Short-range aggregates: random-walk chains of contacting primary particles.
  const clusterCount = low ? 7 : 13;
  for (let c = 0; c < clusterCount; c++) {
    const center = new THREE.Vector3(
      randRange(rng, -0.55, 0.55),
      randRange(rng, -0.28, 0.34),
      randRange(rng, -0.25, 0.2)
    );
    const count = low ? 4 : 5 + Math.floor(rng() * 9);
    let current = center.clone();
    let lastRadius = randRange(rng, 0.028, 0.06);
    addParticle(current, lastRadius);
    for (let i = 1; i < count; i++) {
      const radius = randRange(rng, 0.024, 0.062);
      previous.copy(current);
      const step = (lastRadius + radius) * 0.92;
      direction.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      current = current.clone().addScaledVector(direction, step);
      addParticle(current, radius);
      // Sintered neck between contacting particles (aggregation, not free particles).
      const neck = cylinderBetween(previous, current, Math.min(lastRadius, radius) * 0.45, neckMaterial, 6);
      necks.push(neck);
      lastRadius = radius;
    }
  }

  // Isolated primary particles: aggregation is short-range, not a continuous network.
  for (let i = 0; i < (low ? 8 : 20); i++) {
    addParticle(
      new THREE.Vector3(randRange(rng, -0.85, 0.85), randRange(rng, -0.4, 0.42), randRange(rng, -0.4, 0.3)),
      randRange(rng, 0.016, 0.042)
    );
  }

  group.add(instanced(particleGeometry, particleMaterial, matrices, colors));
  for (const neck of necks) group.add(neck);

  const views: MicroLevelView[] = [
    {
      id: 'overview',
      label: '聚集概览',
      apply: () => {
        camera.position = [0.1 * fov, 0.22 * fov, 1.5 * fov];
        camera.target = [0, 0.02 * fov, 0];
        camera.up = [0, 1, 0];
      }
    },
    {
      id: 'cluster',
      label: '短程聚集',
      apply: () => {
        camera.position = [0.18 * fov, 0.1 * fov, 0.72 * fov];
        camera.target = [0.05 * fov, 0.02 * fov, 0];
        camera.up = [0, 1, 0];
      }
    }
  ];

  return {
    group,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'overview',
    views,
    legend: [
      { color: 0xb9c0c5, text: '一次硅质颗粒（示意粒径）' },
      { color: 0x9aa4ab, text: '接触颈（示意，非实测）' },
      { color: 0x4b555c, text: '无定形硅质基底' }
    ],
    legendTitle: '20 nm · 灰度'
  };
}

/* ------------------------------------------------------------------ */
/* Level 8 — 硅酸缩合 / 2 nm: pausable mechanism animation               */
/* ------------------------------------------------------------------ */

function buildCondensation(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const fov = spec.fovMeters ?? 2e-9;
  const camera = makeCamera(fov, {
    dir: [0.14, 0.3, 1],
    distance: 1.5,
    fovDeg: 34,
    background: 0x05060d
  });

  addLights(group, {
    ambient: 0.5,
    key: { color: 0xffffff, intensity: 2.1, position: [-2.4, 3.0, 2.6] },
    fill: { color: 0x6f8cff, intensity: 0.55, position: [2.6, 0.4, 1.6] },
    rim: { color: 0x8fe8ff, intensity: 0.9, position: [0.8, 1.8, -2.8] }
  });

  // Schematic atom encoding (declared in the legend): Si amber, O coral, H white.
  const siMaterial = standardMaterial({ color: 0xffb454, emissive: 0x40250a, emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.1 });
  const oMaterial = standardMaterial({ color: 0xff6b5a, emissive: 0x3d0f0b, emissiveIntensity: 0.4, roughness: 0.45, metalness: 0.08 });
  const hMaterial = standardMaterial({ color: 0xf2f5f8, roughness: 0.5, metalness: 0.05 });
  const bondMaterial = standardMaterial({ color: 0x9aa3ab, roughness: 0.55, metalness: 0.25 });
  const bridgeMaterial = standardMaterial({
    color: 0x9aa3ab,
    roughness: 0.55,
    metalness: 0.25,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });

  const up = new THREE.Vector3(0, 1, 0);
  const bondGeometryCache = new Map<number, THREE.CylinderGeometry>();
  const bondGeometry = (radius: number): THREE.CylinderGeometry => {
    const key = Math.round(radius * 1e4);
    const cached = bondGeometryCache.get(key);
    if (cached) return cached;
    const geometry = new THREE.CylinderGeometry(radius, radius, 1, low ? 6 : 10, 1, false);
    bondGeometryCache.set(key, geometry);
    return geometry;
  };
  const placeBond = (bond: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void => {
    const direction = new THREE.Vector3().subVectors(b, a);
    const length = direction.length() || 1e-6;
    bond.position.copy(a).addScaledVector(direction, 0.5);
    bond.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    bond.scale.set(1, length, 1);
  };
  const atom = (geometry: THREE.SphereGeometry, material: THREE.Material, position: THREE.Vector3, radius: number): THREE.Mesh => {
    const sphere = mesh(geometry, material);
    sphere.position.copy(position);
    sphere.scale.setScalar(radius);
    return sphere;
  };

  const siGeometry = new THREE.SphereGeometry(1, low ? 12 : 22, low ? 8 : 14);
  const oGeometry = new THREE.SphereGeometry(1, low ? 10 : 18, low ? 8 : 12);
  const hGeometry = new THREE.SphereGeometry(1, low ? 6 : 10, low ? 4 : 8);

  const tetraDirs = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(-1, -1, 1)
  ].map((v) => v.normalize());

  const siRadius = 0.082;
  const oRadius = 0.058;
  const hRadius = 0.03;
  const siOBond = 0.135;
  const oHBond = 0.072;

  // One orthosilicic acid monomer: Si(OH)4 as a rigid ball-and-stick group.
  const createMonomer = (): THREE.Group => {
    const monomer = new THREE.Group();
    monomer.add(atom(siGeometry, siMaterial, new THREE.Vector3(0, 0, 0), siRadius));
    for (const dir of tetraDirs) {
      const oPosition = dir.clone().multiplyScalar(siOBond);
      monomer.add(atom(oGeometry, oMaterial, oPosition, oRadius));
      const bond = new THREE.Mesh(bondGeometry(0.013), bondMaterial);
      placeBond(bond, new THREE.Vector3(0, 0, 0), oPosition);
      monomer.add(bond);
      const hPosition = dir.clone().multiplyScalar(siOBond + oHBond);
      monomer.add(atom(hGeometry, hMaterial, hPosition, hRadius));
      const hBond = new THREE.Mesh(bondGeometry(0.009), bondMaterial);
      placeBond(hBond, oPosition, hPosition);
      monomer.add(hBond);
    }
    return monomer;
  };

  const monomers: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const monomer = createMonomer();
    group.add(monomer);
    monomers.push(monomer);
  }

  // Reaction arrows: explanation of direction only, not a force or flux.
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.0, depthWrite: false });
  const arrows: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const arrowGroup = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 6), arrowMaterial);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 8), arrowMaterial);
    head.position.y = 0.19;
    arrowGroup.add(shaft, head);
    arrowGroup.rotation.z = Math.PI * 0.5;
    group.add(arrowGroup);
    arrows.push(arrowGroup);
  }

  // Bridging oxygen + its two Si-O bonds: the condensation product.
  const bridges: THREE.Group[] = [];
  const bridgeAtoms: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const bridge = new THREE.Group();
    const o = atom(oGeometry, bridgeMaterial, new THREE.Vector3(0, 0, 0), oRadius);
    const bondA = new THREE.Mesh(bondGeometry(0.014), bridgeMaterial);
    const bondB = new THREE.Mesh(bondGeometry(0.014), bridgeMaterial);
    bridge.add(o, bondA, bondB);
    bridge.visible = false;
    group.add(bridge);
    bridges.push(bridge);
    bridgeAtoms.push(o);
  }

  // Released water molecules (each with its own fade-able material).
  const waters: Array<{ group: THREE.Group; material: THREE.MeshStandardMaterial }> = [];
  for (let i = 0; i < 2; i++) {
    const waterMaterial = standardMaterial({
      color: 0x9fc4ff,
      roughness: 0.4,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const water = new THREE.Group();
    const o = atom(oGeometry, waterMaterial, new THREE.Vector3(0, 0, 0), oRadius * 0.85);
    const h1 = atom(hGeometry, waterMaterial, new THREE.Vector3(0.055, 0.045, 0), hRadius * 0.9);
    const h2 = atom(hGeometry, waterMaterial, new THREE.Vector3(-0.05, 0.048, 0.02), hRadius * 0.9);
    const b1 = new THREE.Mesh(bondGeometry(0.008), waterMaterial);
    placeBond(b1, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.055, 0.045, 0));
    const b2 = new THREE.Mesh(bondGeometry(0.008), waterMaterial);
    placeBond(b2, new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.05, 0.048, 0.02));
    water.add(o, h1, h2, b1, b2);
    water.visible = false;
    group.add(water);
    waters.push({ group: water, material: waterMaterial });
  }

  const state = { t: 0, paused: false };
  const PERIOD = 14;
  const keyTimes = [0, 0.28, 0.52, 0.8, 1];
  const trajectories: Vec3[][] = [
    [
      [-0.66, 0.06, 0.03],
      [-0.17, 0.02, 0],
      [-0.16, 0.02, 0],
      [-0.14, 0.02, 0],
      [-0.66, 0.06, 0.03]
    ],
    [
      [0.6, -0.1, 0.05],
      [0.18, -0.02, 0],
      [0.17, -0.02, 0],
      [0.15, -0.03, 0],
      [0.6, -0.1, 0.05]
    ],
    [
      [0.06, 0.68, -0.14],
      [0.05, 0.62, -0.12],
      [0.05, 0.5, -0.1],
      [0.1, 0.2, -0.02],
      [0.06, 0.68, -0.14]
    ]
  ];

  const sample = (path: Vec3[], p: number, target: THREE.Vector3): THREE.Vector3 => {
    let i = 0;
    while (i < keyTimes.length - 2 && p > keyTimes[i + 1]) i++;
    const span = keyTimes[i + 1] - keyTimes[i] || 1;
    const local = clamp01((p - keyTimes[i]) / span);
    const eased = local * local * (3 - 2 * local);
    const a = path[i];
    const b = path[i + 1];
    return target.set(
      a[0] + (b[0] - a[0]) * eased,
      a[1] + (b[1] - a[1]) * eased,
      a[2] + (b[2] - a[2]) * eased
    );
  };

  const siWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const tmpA = new THREE.Vector3();
  const tmpMid = new THREE.Vector3();

  const bridgeProgress = (p: number, center: number, width: number): number => {
    const start = center - width * 0.5;
    const end = center + width * 0.5;
    if (p < start || p > end) return 0;
    return clamp01((p - start) / (end - start));
  };

  const updateBridges = (p: number): void => {
    const intensity = [bridgeProgress(p, 0.36, 0.14), bridgeProgress(p, 0.63, 0.14)];
    for (let i = 0; i < bridges.length; i++) {
      const amount = intensity[i];
      const bridge = bridges[i];
      bridge.visible = amount > 0.02;
      if (!bridge.visible) continue;
      const a = siWorld[i];
      const b = siWorld[i + 1];
      tmpMid.copy(a).add(b).multiplyScalar(0.5);
      bridgeAtoms[i].position.copy(tmpMid);
      const bondA = bridge.children[1] as THREE.Mesh;
      const bondB = bridge.children[2] as THREE.Mesh;
      placeBond(bondA, a, tmpMid);
      placeBond(bondB, tmpMid, b);
      bridgeMaterial.opacity = 0.9 * amount;
    }
    for (let i = 0; i < waters.length; i++) {
      const water = waters[i];
      const windowStart = i === 0 ? 0.34 : 0.61;
      const life = clamp01((p - windowStart) / 0.22);
      const active = life > 0.02 && life < 1;
      water.group.visible = active;
      if (!active) continue;
      const a = siWorld[i];
      const b = siWorld[i + 1];
      tmpMid.copy(a).add(b).multiplyScalar(0.5);
      const direction = tmpA.set(0.5 + i * 0.2, 0.8, 0.35).normalize();
      water.group.position.copy(tmpMid).addScaledVector(direction, 0.06 + life * 0.42);
      water.material.opacity = 0.85 * (1 - life);
      water.group.rotation.y = life * 1.2;
    }
    const arrowFade = [bridgeProgress(p, 0.18, 0.18), bridgeProgress(p, 0.47, 0.16)];
    for (let i = 0; i < arrows.length; i++) {
      arrows[i].visible = arrowFade[i] > 0.02;
      if (arrows[i].visible) {
        arrows[i].position.set(i === 0 ? -0.38 : 0.32, i === 0 ? 0.06 : -0.06, 0.16);
        arrows[i].position.y += Math.sin(p * Math.PI * 2) * 0.02;
      }
    }
    arrowMaterial.opacity = 0.55;
  };

  // Slow turntable motion to expose 3D structure; gated by pause like the reaction clock.
  const update = (dt: number): void => {
    if (state.paused) return;
    state.t += dt;
    const p = (state.t % PERIOD) / PERIOD;
    for (let i = 0; i < monomers.length; i++) {
      sample(trajectories[i], p, monomers[i].position);
      monomers[i].rotation.y = p * Math.PI * 0.6 + i * 0.7;
      siWorld[i].copy(monomers[i].position);
    }
    updateBridges(p);
    group.rotation.y = Math.sin(state.t * 0.08) * 0.08;
    // Keep the legend readable: rotate the whole mechanism, not the legend sprite.
    for (const child of group.children) {
      if ((child as THREE.Sprite).isSprite) child.rotation.y = -group.rotation.y;
    }
  };

  return {
    group,
    update,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'mechanism',
    views: [
      {
        id: 'mechanism',
        label: '反应机制',
        apply: () => {
          camera.position = [0.14 * fov, 0.3 * fov, 1.5 * fov];
          camera.target = [0, 0.02 * fov, 0];
          camera.up = [0, 1, 0];
        }
      }
    ],
    legend: [
      { color: 0xffb454, text: 'Si 原子（编码色）' },
      { color: 0xff6b5a, text: 'O 原子（编码色）' },
      { color: 0xf2f5f8, text: 'H 原子（编码色）' },
      { color: 0x7fe3ff, text: '箭头 = 反应方向示意' }
    ],
    legendTitle: '2 nm · 机制动画（非分子动力学）',
    pausable: true,
    pause: () => {
      state.paused = true;
    },
    resume: () => {
      state.paused = false;
    },
    isPaused: () => state.paused
  };
}

/* ------------------------------------------------------------------ */
/* Level 9 — 局部硅氧结构 / 0.4 nm: local, deliberately imperfect Si-O   */
/* ------------------------------------------------------------------ */

function buildLocalSio(ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const low = ctx.lowQuality === true;
  const group = new THREE.Group();
  const rng = makeRng(21109);
  const fov = spec.fovMeters ?? 4e-10;
  const camera = makeCamera(fov, {
    dir: [0.3, 0.4, 1],
    distance: 1.6,
    fovDeg: 32,
    background: 0x04060c
  });

  addLights(group, {
    ambient: 0.55,
    key: { color: 0xffffff, intensity: 2.2, position: [-2.4, 2.8, 2.6] },
    fill: { color: 0x7d95ff, intensity: 0.5, position: [2.6, 0.2, 1.4] },
    rim: { color: 0x9fe6ff, intensity: 0.85, position: [0.8, 1.6, -2.8] }
  });

  const siMaterial = standardMaterial({ color: 0xffc46b, emissive: 0x42290a, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.1 });
  const oMaterial = standardMaterial({ color: 0xff7a6a, emissive: 0x3a0f0b, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.08 });
  const hMaterial = standardMaterial({ color: 0xeef4f8, roughness: 0.5, metalness: 0.05 });
  const bondMaterial = standardMaterial({ color: 0x8f98a2, roughness: 0.5, metalness: 0.3 });
  const danglingMaterial = standardMaterial({
    color: 0x8f98a2,
    roughness: 0.5,
    metalness: 0.3,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  });

  const siGeometry = new THREE.SphereGeometry(1, low ? 12 : 22, low ? 8 : 14);
  const oGeometry = new THREE.SphereGeometry(1, low ? 10 : 18, low ? 8 : 12);
  const hGeometry = new THREE.SphereGeometry(1, low ? 6 : 10, low ? 4 : 8);
  const bondGeometry = new THREE.CylinderGeometry(1, 1, 1, low ? 6 : 10, 1, false);

  const up = new THREE.Vector3(0, 1, 0);
  const placeBond = (bond: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void => {
    const direction = new THREE.Vector3().subVectors(b, a);
    const length = direction.length() || 1e-6;
    bond.position.copy(a).addScaledVector(direction, 0.5);
    bond.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    bond.scale.set(radius, length, radius);
  };
  const addSphere = (geometry: THREE.SphereGeometry, material: THREE.Material, position: THREE.Vector3, radius: number): THREE.Mesh => {
    const sphere = mesh(geometry, material);
    sphere.position.copy(position);
    sphere.scale.setScalar(radius);
    group.add(sphere);
    return sphere;
  };

  const siRadius = 0.088;
  const oRadius = 0.066;
  const hRadius = 0.034;
  const siObond = 0.4; // 0.16 nm at a 0.4 nm field of view
  const ohBond = 0.24;

  /** Builds one Si-O bond with a small, deterministic length jitter (the model is not idealised). */
  const connect = (a: THREE.Vector3, b: THREE.Vector3, material: THREE.Material = bondMaterial, radius = 0.018): THREE.Mesh => {
    const bond = mesh(bondGeometry, material);
    placeBond(bond, a, b, radius);
    group.add(bond);
    return bond;
  };

  const jitterDirection = (direction: THREE.Vector3, amount: number): THREE.Vector3 => {
    return direction
      .clone()
      .add(new THREE.Vector3(randRange(rng, -amount, amount), randRange(rng, -amount, amount), randRange(rng, -amount, amount)))
      .normalize();
  };

  const tetra = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(-1, -1, 1)
  ].map((v) => v.normalize());

  const central = new THREE.Vector3(0, 0, 0);
  addSphere(siGeometry, siMaterial, central, siRadius);

  // Four Si-O bonds around the central Si; one tetrahedral direction is intentionally vacant
  // (a dangling Si, i.e. the local structure is incomplete, not an infinite lattice).
  const centralO: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const direction = jitterDirection(tetra[i], 0.09);
    const length = siObond * (1 + randRange(rng, -0.06, 0.06));
    const position = central.clone().addScaledVector(direction, length);
    centralO.push(position);
    addSphere(oGeometry, oMaterial, position, oRadius);
    connect(central, position);
  }

  const addSilanol = (oxygen: THREE.Vector3, outward: THREE.Vector3): void => {
    const hPosition = oxygen.clone().addScaledVector(jitterDirection(outward, 0.2), ohBond);
    addSphere(hGeometry, hMaterial, hPosition, hRadius);
    connect(oxygen, hPosition, bondMaterial, 0.012);
  };

  // Two of the three oxygens bridge into neighbouring tetrahedra: real network, not free units.
  const neighbourCount = 2;
  for (let i = 0; i < neighbourCount; i++) {
    const oxygen = centralO[i];
    const outward = oxygen.clone().normalize();
    // Si-O-Si is bent (~130-150 deg), so the neighbour sits at an angle, not in a straight line.
    const bendAxis = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, -1, 1), randRange(rng, -1, 1)).normalize();
    const bendAngle = (130 + rng() * 20) * (Math.PI / 180) - Math.PI * 0.5;
    const bridgeDirection = outward.clone().applyAxisAngle(bendAxis, bendAngle).normalize();
    const neighbour = oxygen.clone().addScaledVector(bridgeDirection, siObond * (1 + randRange(rng, -0.05, 0.05)));
    addSphere(siGeometry, siMaterial, neighbour, siRadius * 0.95);
    connect(oxygen, neighbour);

    // Neighbour tetrahedron: only the two oxygens facing the camera are completed.
    for (let k = 0; k < 4; k++) {
      const direction = jitterDirection(tetra[k], 0.1);
      const candidate = neighbour.clone().addScaledVector(direction, siObond * (1 + randRange(rng, -0.05, 0.05)));
      if (candidate.distanceTo(central) < siObond * 1.35) continue;
      if (candidate.z < -0.42) continue;
      addSphere(oGeometry, oMaterial, candidate, oRadius * 0.92);
      connect(neighbour, candidate);
      if (k === 3) {
        addSilanol(candidate, direction);
      } else if (k === 2) {
        // Deprotonated terminal oxygen (a charged surface site in this schematic).
        addSphere(hGeometry, hMaterial, candidate.clone().addScaledVector(direction, ohBond * 0.6), hRadius * 0.5);
      }
    }
  }

  // Free silanol on the third central oxygen.
  addSilanol(centralO[2], centralO[2].clone().normalize());

  // Dangling bond indicator: a short, faded stub where the vacant oxygen would be.
  const vacantDirection = jitterDirection(tetra[3], 0.08);
  const stubEnd = central.clone().addScaledVector(vacantDirection, siObond * 0.62);
  connect(central, stubEnd, danglingMaterial, 0.014);
  addSphere(oGeometry, danglingMaterial, stubEnd, oRadius * 0.7);

  const views: MicroLevelView[] = [
    {
      id: 'cluster',
      label: '局部簇',
      apply: () => {
        camera.position = [0.3 * fov, 0.4 * fov, 1.6 * fov];
        camera.target = [0, 0.02 * fov, 0];
        camera.up = [0, 1, 0];
      }
    },
    {
      id: 'defect',
      label: '缺损位点',
      apply: () => {
        camera.position = [0.75 * fov, 0.12 * fov, 1.05 * fov];
        camera.target = [0.18 * fov, -0.12 * fov, 0];
        camera.up = [0, 1, 0];
      }
    }
  ];

  return {
    group,
    dispose: () => disposeObject(group),
    camera,
    activeViewId: 'cluster',
    views,
    legend: [
      { color: 0xffc46b, text: 'Si（球棍编码色）' },
      { color: 0xff7a6a, text: 'O（球棍编码色）' },
      { color: 0xeef4f8, text: 'H（球棍编码色）' },
      { color: 0x8f98a2, text: 'Si–O 键（半透明 = 缺损/悬键）' }
    ],
    legendTitle: '0.4 nm · 非完美局部晶格'
  };
}

/* ------------------------------------------------------------------ */
/* Level 10 — 硅氧网络·分子运动 / 1 nm: MD-lite pausable molecular motion */
/* ------------------------------------------------------------------ */

function buildSioMd(_ctx: MicroBuildContext, spec: MicroLevelSpec): LevelRuntime {
  const group = new THREE.Group();
  const fov = spec.fovMeters ?? 1e-9;
  const structure = structureForMaterial('silica-opal');
  if (!structure) throw new Error('sio2-md: silica-opal structure missing');
  // 1 field unit = 1 nm: fragment spans ~0.6 nm, camera distance = 1.6 × fov matches peers.
  const md = new MdLite(structure, { temperatureK: 298, speed: 1, paused: false }, 1, 1010);
  group.add(md.group);

  addLights(group, {
    ambient: 0.6,
    key: { color: 0xffffff, intensity: 2.0, position: [-2.2, 2.6, 2.4] },
    fill: { color: 0x7d95ff, intensity: 0.45, position: [2.4, 0.2, 1.2] },
    rim: { color: 0x9fe6ff, intensity: 0.8, position: [0.6, 1.4, -2.6] }
  });

  const camera = makeCamera(fov, {
    dir: [0.3, 0.42, 1],
    distance: 1.7,
    fovDeg: 34,
    background: 0x04060c
  });

  return {
    group,
    update: (dt) => md.update(dt),
    dispose: () => md.dispose(),
    camera,
    activeViewId: 'overview',
    views: [
      {
        id: 'overview',
        label: '四面体网络',
        apply: () => {
          camera.position = [0.3 * fov * 1.7, 0.42 * fov * 1.7, 1.7 * fov];
          camera.target = [0.15, 0, 0.15];
          camera.up = [0, 1, 0];
        }
      }
    ],
    legend: [
      { color: 0xf0c8a0, text: 'Si（CPK 编码色）' },
      { color: 0xff0d0d, text: 'O（CPK 编码色）' },
      { color: 0x9aa0a6, text: 'Si–O 键' }
    ],
    legendTitle: '1 nm · MD-lite 晶格谐振（T=298 K，振幅×' + AMPLITUDE_EXAGGERATION + '）',
    pausable: true,
    pause: () => md.pause(),
    resume: () => md.resume(),
    isPaused: () => md.isPaused()
  };
}

/* ------------------------------------------------------------------ */
/* Dispatch, lifecycle and WorldTier adapter                            */
/* ------------------------------------------------------------------ */

type LevelBuilder = (ctx: MicroBuildContext, spec: MicroLevelSpec) => LevelRuntime;

const BUILDERS: Record<string, LevelBuilder> = {
  'wet-rock': buildWetRock,
  'biofilm-matrix': buildBiofilmMatrix,
  'diatom-assemblage': buildDiatomAssemblage,
  'diatom-frustule': buildDiatomFrustule,
  'valve-detail': buildValveDetail,
  'wall-section': buildWallSection,
  'silica-aggregation': buildSilicaAggregation,
  condensation: buildCondensation,
  'local-sio': buildLocalSio,
  'sio2-md': buildSioMd
};

const activeBuilds = new Set<MicroLevelABuild>();

/**
 * Builds one route-A level. Unknown ids throw instead of silently falling back,
 * so a bad URL or a stale dataVersion surfaces as a recoverable error in the app.
 */
export function buildLevelA(levelId: string, ctx: MicroBuildContext): MicroLevelABuild {
  const spec = findLevelSpecA(levelId);
  if (!spec) throw new Error('HLG-STREAM-BIOFILM-01 has no level "' + levelId + '"');
  const builder = BUILDERS[levelId];
  if (!builder) throw new Error('HLG-STREAM-BIOFILM-01 level "' + levelId + '" has no geometry builder');
  const build = assemble(spec, builder(ctx, spec));
  activeBuilds.add(build);
  const rawDispose = build.dispose;
  build.dispose = () => {
    activeBuilds.delete(build);
    rawDispose();
  };
  return build;
}

/** Compatibility alias for call sites that use the original function name. */
export function buildMicroLevelA(levelId: string, ctx: MicroBuildContext): MicroLevelABuild {
  return buildLevelA(levelId, ctx);
}

/** Releases every level built through this module (idempotent). */
export function disposeAllA(): void {
  for (const build of Array.from(activeBuilds)) {
    try {
      build.dispose();
    } catch {
      // A level must never break teardown of the others.
    }
  }
  activeBuilds.clear();
}

export interface MicroTierAOptions extends TierOptions {
  /** Starting level; defaults to the 20 cm parent level. */
  levelId?: string;
}

export interface MicroTierA extends WorldTier {
  /** Switches the visible level in place; returns the new build. */
  setLevel: (levelId: string) => MicroLevelABuild;
  /** Currently visible level build (palette, scale bar, legend, pause hooks). */
  current: () => MicroLevelABuild;
  /** Pauses the current level's pausable mechanism animation, if it has one. */
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
}

function buildPoses(build: MicroLevelABuild): Record<string, TierCameraPose> {
  const poses: Record<string, TierCameraPose> = {
    default: { position: build.extras.camera.position, target: build.extras.camera.target }
  };
  const camera = build.extras.camera;
  const savePosition = camera.position;
  const saveTarget = camera.target;
  const saveUp = camera.up;
  for (const view of build.extras.views) {
    view.apply();
    poses[view.id] = { position: camera.position, target: camera.target };
  }
  camera.position = savePosition;
  camera.target = saveTarget;
  camera.up = saveUp;
   return poses;
}

function levelAnchors(activeLevelId: string, fovMeters: number): TierAnchor[] {
  const anchors: TierAnchor[] = [];
  const count = ROUTE_A.levels.length;
  for (let i = 0; i < count; i++) {
    const spec = ROUTE_A.levels[i];
    const isActive = spec.levelId === activeLevelId;
    const angle = (i / count) * Math.PI * 2;
    const radius = isActive ? 0 : 0.42 * fovMeters;
    anchors.push({
      id: 'anchor:' + spec.levelId,
      label: spec.index + '. ' + spec.title + ' · ' + spec.fovLabel,
      kind: 'level',
      position: new THREE.Vector3(
        Math.cos(angle) * radius,
        isActive ? 0 : Math.sin(angle) * radius * 0.5,
        0
      ),
      siteId: SITE_ID,
      routeId: ROUTE_A_ID,
      levelId: spec.levelId
    });
  }
  return anchors;
}

/**
 * WorldTier adapter for the flagship micro route. Pose names follow the level's
 * declared views ('default', 'valve', 'girdle', ...). The tier owns near/far and FOV
 * because a 0.4 nm layer cannot share the 20 cm layer's clipping planes.
 */
export async function createMicroTierA(options: MicroTierAOptions): Promise<MicroTierA> {
  const group = new THREE.Group();
  group.name = 'micro-tier-A';
  const stats: TierStats = { assetsLoaded: 0, assetsFailed: 0, log: [] };
  const initialLevel = options.levelId && findLevelSpecA(options.levelId) ? options.levelId : 'wet-rock';

  let quality = options.lowQuality;
  let current: MicroLevelABuild = buildLevelA(initialLevel, {
    lowQuality: quality
  });
  group.add(current.group);

  const applyCameraContract = (camera: THREE.PerspectiveCamera): void => {
    const cam = current.extras.camera;
    let changed = false;
    if (camera.near !== cam.near) {
      camera.near = cam.near;
      changed = true;
    }
    if (camera.far !== cam.far) {
      camera.far = cam.far;
      changed = true;
    }
    if (Math.abs(camera.fov - cam.fovDeg) > 1e-6) {
      camera.fov = cam.fovDeg;
      changed = true;
    }
    if (changed) camera.updateProjectionMatrix();
  };

  let poses = buildPoses(current);
  let anchors = levelAnchors(initialLevel, current.fovMeters ?? 1);
  let elapsed = 0;

  const tier: MicroTierA = {
    id: 'micro-A',
    group,
    get poses() {
      return poses;
    },
    get defaultPose() {
      return 'default';
    },
    get anchors() {
      return anchors;
    },
    stats,
    update: (dt: number, camera: THREE.PerspectiveCamera): void => {
      applyCameraContract(camera);
      elapsed += dt;
      current.update?.(dt, elapsed);
    },
    setQuality: (low: boolean): void => {
      if (low === quality) return;
      quality = low;
      const levelId = current.levelId;
      group.remove(current.group);
      current.dispose();
      current = buildLevelA(levelId, { lowQuality: quality });
      group.add(current.group);
      poses = buildPoses(current);
      anchors = levelAnchors(levelId, current.fovMeters ?? 1);
      elapsed = 0;
      stats.log.push('setQuality: ' + (low ? 'low' : 'high') + ' -> rebuilt ' + levelId);
    },
    dispose: (): void => {
      group.remove(current.group);
      current.dispose();
      activeBuilds.delete(current);
      group.clear();
      stats.log.push('dispose: micro tier A released');
    },
    setLevel: (levelId: string): MicroLevelABuild => {
      const next = buildLevelA(levelId, { lowQuality: quality });
      group.remove(current.group);
      current.dispose();
      current = next;
      group.add(current.group);
      poses = buildPoses(current);
      anchors = levelAnchors(levelId, current.fovMeters ?? 1);
      elapsed = 0;
      stats.log.push('setLevel: ' + levelId);
      return current;
    },
    current: () => current,
    pause: () => {
      current.extras.pause?.();
    },
    resume: () => {
      current.extras.resume?.();
    },
    isPaused: () => current.extras.isPaused?.() === true
  };

  stats.log.push('micro-A:' + initialLevel + ' built (' + (quality ? 'low' : 'high') + ' quality)');
  stats.log.push('geometry: procedural per level; parent GLB for wet-rock only (DESIGN_ONLY)');
  if (options.onProgress) options.onProgress(1, 1, 'micro level ready: ' + initialLevel);
  if (current.extras.ready) {
    void current.extras.ready.then(() => {
      stats.log.push('parent GLB settle: wet-rock');
    });
  }
  return tier;
}
