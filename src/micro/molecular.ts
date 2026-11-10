import * as THREE from 'three';
import type { TierAnchor, WorldTier } from '../world/tier';
import { MdLite, structureForMaterial, AMPLITUDE_EXAGGERATION, type MaterialClass } from './md-lite';

/**
 * 通用分子层（MOLECULAR_LAYER_SPEC v1.0）：每一个可拾取物体都能深入到分子层，
 * 终点是可暂停的 MD-lite 分子运动视图。
 *
 * 科学边界：
 * - 分子身份只来自登记表的 materialClass；无来源对象（UNKNOWN）不生成路线。
 * - 全部为 L4 机制示意：成像 mechanism-diagram、颜色 schematic（CPK 编码色）、
 *   坐标 PARENT_RELATIVE（分子对象不得伪造经纬度）、样本状态如实（多为 PLANNED）。
 * - 振幅夸大 AMPLITUDE_EXAGGERATION×、动画速率不代表真实时间尺度——随层元数据声明。
 */

export interface MolecularObjectEntry {
  /** 场景对象 ID（与锚点/母体对应） */
  objectId: string;
  /** 层级 ID（URL/分享主键）：mol-<objectId> */
  levelId: string;
  name: string;
  siteId: string | null;
  siteName: string | null;
  materialClass: MaterialClass;
  fovMeters: number;
  fovLabel: string;
  parentNote: string;
  sampleStatus: 'PLANNED' | 'COLLECTED' | 'PROCESSED' | 'IMAGED' | 'IDENTIFIED' | 'PUBLISHED';
}

/** 全对象登记：森林 4 + 溪流 3 + 谷地 3。林窗是地点不是物体，不登记。 */
export const MOLECULAR_OBJECTS: MolecularObjectEntry[] = [
  {
    objectId: 'FOREST-CANOPY-01', levelId: 'mol-forest-canopy', name: '峨眉冷杉枝叶 · 分子层',
    siteId: 'SITE-HLG-FOREST-01', siteName: '峨眉冷杉成熟林', materialClass: 'cellulose-plant',
    fovMeters: 3e-9, fovLabel: '3 nm', parentNote: '针叶细胞壁骨架：纤维素 Iβ 微纤丝', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'FOREST-MOSS-01', levelId: 'mol-forest-moss', name: '苔藓垫 · 分子层',
    siteId: 'SITE-HLG-FOREST-01', siteName: '峨眉冷杉成熟林', materialClass: 'cellulose-plant',
    fovMeters: 3e-9, fovLabel: '3 nm', parentNote: '苔藓植物体细胞壁：纤维素 Iβ（光合机构见路线 C）', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'FOREST-LOG-01', levelId: 'mol-forest-log', name: '倒木 · 分子层',
    siteId: 'SITE-HLG-FOREST-01', siteName: '峨眉冷杉成熟林', materialClass: 'cellulose-plant',
    fovMeters: 3e-9, fovLabel: '3 nm', parentNote: '腐朽木材残余骨架：纤维素 Iβ（木质素未建模，UNKNOWN）', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'FOREST-SEEDLING-01', levelId: 'mol-forest-seedling', name: '林下幼苗 · 分子层',
    siteId: 'SITE-HLG-FOREST-01', siteName: '峨眉冷杉成熟林', materialClass: 'cellulose-plant',
    fovMeters: 3e-9, fovLabel: '3 nm', parentNote: '幼苗组织细胞壁：纤维素 Iβ', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'STREAM-CASCADE-01', levelId: 'mol-stream-cascade', name: '迭水 · 分子层',
    siteId: 'SITE-HLG-STREAM-01', siteName: '林溪与湿石', materialClass: 'water-liquid',
    fovMeters: 2e-9, fovLabel: '2 nm', parentNote: '冰川融水：液态水氢键网络（Langevin 扩散 + 氢键闪现）', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'STREAM-FACE-01', levelId: 'mol-stream-face', name: '湿岩面 · 分子层',
    siteId: 'SITE-HLG-STREAM-01', siteName: '林溪与湿石', materialClass: 'silicate-rock',
    fovMeters: 1e-9, fovLabel: '1 nm', parentNote: '岩面主体按硅酸盐矿物（石英）示，水膜见迭水分子层', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'STREAM-BAR-01', levelId: 'mol-stream-bar', name: '砾石坝 · 分子层',
    siteId: 'SITE-HLG-STREAM-01', siteName: '林溪与湿石', materialClass: 'silicate-rock',
    fovMeters: 1e-9, fovLabel: '1 nm', parentNote: '砾石按硅酸盐矿物（石英）示；岩性组成 UNKNOWN（未采样鉴定）', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'VALLEY-GLACIER-01', levelId: 'mol-valley-glacier', name: '表碛冰舌 · 分子层',
    siteId: 'SITE-HLG-GLACIER-01', siteName: '冰舌与表碛', materialClass: 'water-ice',
    fovMeters: 2e-9, fovLabel: '2 nm', parentNote: '冰川冰：冰 Ih 六方晶格（晶格谐振）', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'VALLEY-RIVER-01', levelId: 'mol-valley-river', name: '冰前河道 · 分子层',
    siteId: null, siteName: null, materialClass: 'water-liquid',
    fovMeters: 2e-9, fovLabel: '2 nm', parentNote: '冰前河水：液态水氢键网络', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'VALLEY-ROCKWALL-01', levelId: 'mol-valley-rockwall', name: '谷壁岩体 · 分子层',
    siteId: null, siteName: null, materialClass: 'silicate-rock',
    fovMeters: 1e-9, fovLabel: '1 nm', parentNote: '谷壁基岩按硅酸盐矿物（石英）示；岩性 UNKNOWN（未采样）', sampleStatus: 'PLANNED'
  },
  {
    objectId: 'CHRONO-SOIL-01', levelId: 'mol-chrono-soil', name: '冰退迹地土壤 · 分子层',
    siteId: 'SITE-HLG-CHRONO-01', siteName: '冰川退缩迹地', materialClass: 'clay-soil',
    fovMeters: 2e-9, fovLabel: '2 nm', parentNote: '土壤粘土矿物代表：高岭石 1:1 层（矿物组成 UNKNOWN，待 XRD）', sampleStatus: 'PLANNED'
  }
];

export function findMolecularObject(levelId: string): MolecularObjectEntry | undefined {
  return MOLECULAR_OBJECTS.find((o) => o.levelId === levelId);
}

export function isMolecularLevelId(levelId: string | null | undefined): boolean {
  return typeof levelId === 'string' && levelId.startsWith('mol-') && findMolecularObject(levelId) !== undefined;
}

/* ------------------------------------------------------------------ tier */

export interface MolecularTierOptions {
  objectId: string;
  lowQuality?: boolean;
}

/** Builds the terminal molecular level for one registered object as a WorldTier. */
export function createMolecularTier(opts: MolecularTierOptions): WorldTier {
  const entry = MOLECULAR_OBJECTS.find((o) => o.objectId === opts.objectId);
  if (!entry) throw new Error('molecular tier: unknown object "' + opts.objectId + '"');
  const structure = structureForMaterial(entry.materialClass);
  if (!structure) throw new Error('molecular tier: materialClass ' + entry.materialClass + ' has no structure');

  const group = new THREE.Group();
  group.name = 'molecular:' + entry.objectId;

  // Outer scale: 1 nm -> fovMeters metres, matching the micro-tier convention
  // (content spans ~1 nm ≈ one field of view).
  const inner = new THREE.Group();
  const md = new MdLite(structure, { temperatureK: 298, speed: 1, paused: false }, 1, 20261110);
  // Centre the structure on the origin.
  const box = new THREE.Box3().setFromObject(md.group);
  const centre = box.getCenter(new THREE.Vector3());
  md.group.position.sub(centre);
  inner.add(md.group);
  inner.scale.setScalar(entry.fovMeters);
  group.add(inner);

  // Local lights (field-unit scale; the tier brings its own rig).
  const amb = new THREE.HemisphereLight(0xeaf2fb, 0x2a2620, 0.85);
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-2.2, 2.6, 2.4).multiplyScalar(entry.fovMeters);
  const rim = new THREE.DirectionalLight(0x9fe6ff, 0.7);
  rim.position.set(0.6, 1.4, -2.6).multiplyScalar(entry.fovMeters);
  group.add(amb, key, rim);

  const fov = entry.fovMeters;
  const poses = {
    overview: {
      position: [0.32 * fov * 1.7, 0.42 * fov * 1.7, 1.7 * fov] as [number, number, number],
      target: [0, 0, 0] as [number, number, number]
    }
  };

  const anchors: TierAnchor[] = [];
  const stats = { assetsLoaded: 0, assetsFailed: 0, log: ['MD-lite ' + structure.id + ' · ' + structure.atoms.length + ' atoms'] };

  return {
    id: 'molecular:' + entry.objectId,
    group,
    poses,
    defaultPose: 'overview',
    anchors,
    stats,
    update: (dt) => md.update(dt),
    setQuality: () => {
      /* molecular layers are cheap; quality switch is a no-op (declared) */
    },
    dispose: () => md.dispose()
  };
}

export { AMPLITUDE_EXAGGERATION };
