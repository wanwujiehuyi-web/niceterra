/**
 * User-facing copy for the Hailuogou flagship world.
 * Baseline: docs/spec/DESIGN_V2.txt (V2.0), docs/WORK_BASELINE_V2.md.
 * Science claims live in public/data/science/*.json; this file holds UI copy only.
 */

export const APP_META = {
  brand: 'NICETERRA',
  tagline: 'NEAR-EARTH WORLDS',
  placeId: 'PLACE-HAILUOGOU',
  placeName: '海螺沟',
  placeSub: '贡嘎山东坡 · 冰川森林谷地',
  dataVersion: 'spec-v2.0',
  assetVersion: 'assets-v2'
} as const;

export interface PosterStage {
  id: 'spec' | 'capability' | 'poster' | 'valley' | 'materials' | 'hotspots';
  label: string;
}

export const POSTER = {
  eyebrow: '一个地点 · 四个样区 · 四条可检验的深入路线',
  title: '海螺沟：从冰川森林，走进一滴水',
  lead: '贡嘎山脉只是三维远景，不能步行。可探索的地方只有一处：海螺沟谷地。',
  enter: '开始探索',
  resume: '继续上次探索',
  staticMode: '静态探索',
  retry: '重新检测图形',
  stages: [
    { id: 'spec', label: '读取地点与科学档案' },
    { id: 'capability', label: '检测图形能力' },
    { id: 'poster', label: '准备海螺沟地点海报' },
    { id: 'valley', label: '校准山脊与谷地' },
    { id: 'materials', label: '布置森林、冰川与溪流' },
    { id: 'hotspots', label: '准备湿溪石观察窗' }
  ] as PosterStage[],
  honesty: '证据等级 L1–L5 逐层标注。生成资产、机制示意图与实测数据分开记录，不会互相冒充。',
  credit:
    '海报底图：AI 生成的氛围图（非实测影像、非产品截图）。场景内的海螺沟几何由程序化重建 + DEM 着色构成，证据等级逐层标注。',
  staticHint:
    '这台设备没有可用的 WebGL2，三维场景无法启动。下面的样区说明、路线与科学边界仍然可读。'
} as const;

export type Mode = 'journey' | 'free' | 'hypothesis';

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'journey', label: '尺度旅程', hint: '沿设计路线逐层深入，可随时返回上一级' },
  { id: 'free', label: '自由探索', hint: '在样区内自由移动并点选对象查看档案' },
  { id: 'hypothesis', label: '假设实验', hint: '改变参数，观察机制视图的响应，结果标为 L4/L5' }
];

export interface SiteEntry {
  siteId: string;
  name: string;
  tier: 'forest' | 'stream' | 'glacier' | 'chrono';
  status: 'PLANNED' | 'BUILDING' | 'READY';
  oneLiner: string;
  coordinate: string;
  coordinateNote: string;
}

export const SITES: SiteEntry[] = [
  {
    siteId: 'SITE-HLG-FOREST-01',
    name: '峨眉冷杉成熟林',
    tier: 'forest',
    status: 'PLANNED',
    oneLiner: '25–38 m 冠层、苔藓层与林下更新；读取森林结构而不是拍一张森林。',
    coordinate: 'WGS84 101.9886°E, 29.5731°N · 3160 m',
    coordinateNote: '公开样地 GGFZH01 · PUBLIC_COORDINATE · 高程基准 UNKNOWN'
  },
  {
    siteId: 'SITE-HLG-STREAM-01',
    name: '林溪与湿石',
    tier: 'stream',
    status: 'PLANNED',
    oneLiner: '冰融溪的阶梯河床、迎水面湿石与生物膜；旗舰路线 A 的入口。',
    coordinate: '溪线 STREAM-HLG-01 · DESIGN_ONLY',
    coordinateNote: '样区锚点 UNKNOWN；溪线节点为设计坐标，不是实测位置'
  },
  {
    siteId: 'SITE-HLG-GLACIER-01',
    name: '冰舌与表碛',
    tier: 'glacier',
    status: 'PLANNED',
    oneLiner: '冰舌、表碛覆盖与冰瀑；按年份标注退缩，不用一张静态图代替过程。',
    coordinate: '冰舌前缘 · DATED_GEOMETRY',
    coordinateNote: '几何按年份版本记录；垂直基准与冰面高程 UNKNOWN'
  },
  {
    siteId: 'SITE-HLG-CHRONO-01',
    name: '冰川退缩迹地',
    tier: 'chrono',
    status: 'PLANNED',
    oneLiner: '从裸碛到土壤、根系与磷过程；路线 B 的时间序列。',
    coordinate: '迹地样带 · DESIGN_ONLY',
    coordinateNote: '年代序列依赖可获取的退缩年代，当前 PENDING_SOURCE'
  }
];

export interface RouteLevel {
  /** Canonical stable ID from public/data/spec/02_海螺沟微观路线.json. Never renumber. */
  levelId: string;
  name: string;
  /** Field of view (micro levels) or the data view label. */
  scale: string;
  kind: 'scene' | 'object' | 'micro';
  /** True when this level is a data/mechanism view rather than a physical zoom. */
  dataView?: boolean;
}

export interface RouteEntry {
  routeId: string;
  code: 'A' | 'B' | 'C' | 'D';
  name: string;
  siteId: string;
  status: 'PLANNED' | 'BUILDING' | 'READY';
  summary: string;
  levels: RouteLevel[];
}

/**
 * Level IDs follow the design package (02 JSON) so a shared link keeps meaning
 * across sessions. Order is presentation only; order is not a share key.
 */
export const ROUTES: RouteEntry[] = [
  {
    routeId: 'HLG-STREAM-BIOFILM-01',
    code: 'A',
    name: '湿溪石—生物膜—硅藻—生物硅',
    siteId: 'SITE-HLG-STREAM-01',
    status: 'PLANNED',
    summary: '旗舰路线，10 层。从一块迎水面的湿石进入到硅藻壳体、生物硅循环与硅氧网络的分子运动。',
    levels: [
      { levelId: 'wet-rock', name: '湿溪石', scale: '20 cm · 近景摄影测量与 PBR', kind: 'object' },
      { levelId: 'biofilm-matrix', name: '生物膜基质', scale: '200 μm · EPS、孔隙、细胞附着', kind: 'micro' },
      { levelId: 'diatom-assemblage', name: '硅藻群落', scale: '50 μm · 附着群落形态示例', kind: 'micro' },
      { levelId: 'diatom-frustule', name: '完整硅藻壳', scale: '20 μm · 壳体、壳面、壳环', kind: 'micro' },
      { levelId: 'valve-detail', name: '壳面局部', scale: '2 μm · 孔纹、肋纹与曲率', kind: 'micro' },
      { levelId: 'wall-section', name: '壳壁剖面', scale: '200 nm · 孔道、壁厚、水合生物硅', kind: 'micro' },
      { levelId: 'silica-aggregation', name: '生物硅聚集', scale: '20 nm · 纳米聚集与短程结构', kind: 'micro' },
      { levelId: 'condensation', name: '硅酸缩合', scale: '2 nm · 可暂停机制动画', kind: 'micro' },
      { levelId: 'local-sio', name: '局部硅氧结构', scale: '0.4 nm · 非完美晶格局部模型', kind: 'micro' },
      { levelId: 'sio2-md', name: '硅氧网络 · 分子运动', scale: '1 nm · MD-lite 分子动力学示意（可暂停）', kind: 'micro' }
    ]
  },
  {
    routeId: 'HLG-CHRONO-P-01',
    code: 'B',
    name: '冰退之后—土壤—根际—磷过程',
    siteId: 'SITE-HLG-CHRONO-01',
    status: 'PLANNED',
    summary: '7 层。冰川退缩序列上的土壤发育与磷过程；磷与基因层是机制/数据视图，不是连续物理缩放。',
    levels: [
      { levelId: 'chronosequence', name: '研究序列', scale: '出露年份与研究样地', kind: 'scene', dataView: true },
      { levelId: 'soil-profile', name: '土壤剖面', scale: '剖面、根系与有机质层', kind: 'object' },
      { levelId: 'rhizosphere', name: '根际观察窗', scale: '根—土—微生物界面', kind: 'micro' },
      { levelId: 'aggregate', name: '土壤团聚体', scale: '矿物、有机质与孔隙', kind: 'micro' },
      { levelId: 'microbial-interface', name: '微生物界面', scale: '细胞与矿物表面', kind: 'micro' },
      { levelId: 'phosphorus-process', name: '磷过程', scale: '矿物磷溶解与有机磷矿化', kind: 'micro' },
      { levelId: 'gene-evidence', name: '功能基因证据', scale: '基因组数据视图，非连续物理缩放', kind: 'micro', dataView: true }
    ]
  },
  {
    routeId: 'HLG-MOSS-CHLOROPLAST-01',
    code: 'C',
    name: '苔藓—叶细胞—叶绿体—光合膜',
    siteId: 'SITE-HLG-FOREST-01',
    status: 'PLANNED',
    summary: '5 层。苔藓垫到类囊体膜，颜色声明必须随层改变成像方式。',
    levels: [
      { levelId: 'moss-cushion', name: '苔藓垫', scale: '10 cm · L2 生境；种属待鉴定', kind: 'object' },
      { levelId: 'moss-leaf', name: '叶片', scale: '1 mm · L3+L4', kind: 'micro' },
      { levelId: 'leaf-cell', name: '叶细胞', scale: '50 μm · L4', kind: 'micro' },
      { levelId: 'chloroplast', name: '叶绿体', scale: '5 μm · L4', kind: 'micro' },
      { levelId: 'thylakoid', name: '光合膜', scale: '100 nm · L4', kind: 'micro' }
    ]
  },
  {
    routeId: 'HLG-DEBRIS-MICROBE-01',
    code: 'D',
    name: '冰表碎屑—微生物群落',
    siteId: 'SITE-HLG-GLACIER-01',
    status: 'PLANNED',
    summary: '4 层。冰面碎屑上的微生物群落，末层是数据视图。',
    levels: [
      { levelId: 'debris-transect', name: '冰舌表碛样带', scale: '样带 · L2', kind: 'scene', dataView: true },
      { levelId: 'debris-particle', name: '碎屑颗粒', scale: '厚度、稳定性与孔隙 · L2+L4', kind: 'object' },
      { levelId: 'microhabitat', name: '微生物微生境', scale: '碎屑表面 · L4', kind: 'micro' },
      { levelId: 'community-data', name: '群落数据', scale: '群落组成与共存网络数据视图', kind: 'micro', dataView: true }
    ]
  }
];

/**
 * Camera registry. The two site cameras are transcribed verbatim from
 * DESIGN_V2 TABLE 23 (siteLocal ENU metres, render z = -north):
 *   CAM-HLG-A  (-42, -48, DEM+1.65) -> (0, +10, DEM+8)
 *   CAM-HLG-B  (24, -34, DEM+0.75)  -> (0, +20, DEM+4)
 * CAM-HLG-C is VIEWSHED_DERIVED and may not be hand-placed.
 */
export interface CameraSpec {
  cameraId: string;
  siteId: string | null;
  /** siteLocal ENU: [eastM, northM, heightAboveDemM] */
  position: [number, number, number];
  /** siteLocal ENU: [eastM, northM, heightAboveDemM | 'terrain'] */
  target: [number, number, number | 'terrain'];
  status: 'DESIGN_ONLY' | 'PUBLIC_COORDINATE' | 'VIEWSHED_DERIVED' | 'PENDING_SOURCE';
  note: string;
}

export const CAMERAS: CameraSpec[] = [
  {
    cameraId: 'CAM-HLG-A',
    siteId: 'SITE-HLG-FOREST-01',
    position: [-42, -48, 1.65],
    target: [0, 10, 8],
    status: 'DESIGN_ONLY',
    note: '森林地面机位，视高 1.65 m；保留设计标识，实测后替换'
  },
  {
    cameraId: 'CAM-HLG-B',
    siteId: 'SITE-HLG-STREAM-01',
    position: [24, -34, 0.75],
    target: [0, 20, 4],
    status: 'DESIGN_ONLY',
    note: '贴近水面的低机位，视高 0.75 m；保留设计标识'
  },
  {
    cameraId: 'CAM-HLG-C',
    siteId: 'SITE-HLG-FOREST-01',
    position: [0, 0, 0],
    target: [0, 0, 0],
    status: 'VIEWSHED_DERIVED',
    note: '必须由 DEM 视线分析反推；已实跑：自 GGFZH01 看主峰被 1348 m 处 4048 m 山脊遮挡，改用谷地导览机位'
  }
];

export const TABS = [
  { id: 'summary', label: '概要' },
  { id: 'evidence', label: '证据' },
  { id: 'samples', label: '样本' }
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const ACTIONS = {
  prev: '上一级',
  next: '继续深入',
  exit: '退到谷地',
  enterSite: '进入样区',
  viewRoute: '查看路线',
  close: '关闭'
} as const;

export const EVIDENCE_LEVELS = [
  { id: 'L1', label: '本地实测重建', hint: '本地实测数据驱动的几何/影像' },
  { id: 'L2', label: '本地文献复原', hint: '依据本地文献的结构性复原' },
  { id: 'L3', label: '区域参考', hint: '区域参考替代，不能当本地实测' },
  { id: 'L4', label: '机制示意', hint: '机制示意，不是观测影像' },
  { id: 'L5', label: '假设场景', hint: '假设条件下的情景，非事实陈述' }
] as const;

export const MESSAGES = {
  notConnected: '该尺度层尚未接入。当前版本只开放谷地预览与样区档案。',
  webglFailed: '三维渲染没有启动成功。可以继续查看静态档案，或重新检测图形能力。',
  contextLost: '图形上下文丢失，画面已暂停。可尝试重新载入三维场景。',
  specMissing: '科学档案未能读取，界面仍可用，但证据与来源字段会标记为 UNKNOWN。'
} as const;

export function siteById(siteId: string | null): SiteEntry | undefined {
  return SITES.find((s) => s.siteId === siteId);
}

export function routeById(routeId: string | null): RouteEntry | undefined {
  return ROUTES.find((r) => r.routeId === routeId);
}
