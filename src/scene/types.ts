import * as THREE from 'three';

/** 坐标状态枚举（docs/WORK_BASELINE_V2.md §3） */
export type CoordinateStatus =
  | 'PUBLIC_COORDINATE'
  | 'HISTORICAL_SAMPLE'
  | 'DESIGN_ONLY'
  | 'PARENT_RELATIVE'
  | 'DATED_GEOMETRY'
  | 'UNKNOWN';

/** 证据等级 L1–L5 */
export type EvidenceLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/** 样本生命周期 */
export type SampleStatus =
  | 'PLANNED'
  | 'COLLECTED'
  | 'PROCESSED'
  | 'IMAGED'
  | 'IDENTIFIED'
  | 'PUBLISHED';

export type ColorStatus = 'natural' | 'grayscale' | 'false-color' | 'fluorescence' | 'schematic';
export type ImagingMethod =
  | 'natural-light'
  | 'photogrammetry'
  | 'optical-microscopy'
  | 'SEM'
  | 'fluorescence-microscopy'
  | 'mechanism-diagram'
  | 'data-view'
  | 'UNKNOWN';

/** 任何进入场景的模块统一接口 */
export interface WorldModule {
  readonly group: THREE.Group;
  update?(dt: number, elapsed: number, camera: THREE.Camera): void;
  setQuality?(low: boolean): void;
  dispose(): void;
}

/** 场景模块元数据：必须能回答「几何来自哪里、日期、证据、许可」 */
export interface ModuleMeta {
  assetId: string;
  geometrySource: string;
  geometryDate?: string;
  coordinateStatus: CoordinateStatus;
  evidenceLevel: EvidenceLevel;
  license?: string;
  placeholder?: boolean;
}

/** 微观层构建结果：每层独立几何 + 十项必填元数据 */
export interface MicroLevelBuild {
  levelId: string;
  group: THREE.Group;
  update?(dt: number, elapsed: number): void;
  dispose(): void;
  /** 视场：物理层给米制，数据视图给 null */
  fovMeters: number | null;
  fovLabel: string;
  imaging: ImagingMethod;
  colorStatus: ColorStatus;
  evidence: EvidenceLevel;
  limitation: string;
  /** 比例尺参考长度（米），用于屏幕上画 scale bar；数据视图为 null */
  scaleBarMeters: number | null;
}

/** 场景管理器当前所处层级 */
export type SceneTier = 'farview' | 'valley' | 'site' | 'micro';

/** 每个样区的位置由样区 ENU 定义（x 东、y 北、z 上） */
export interface SiteLocalFrame {
  siteId: string;
  eastM: number;
  northM: number;
  /** 三维修剪：把 ENU 的 (东,北) 映射到渲染平面的 (x, z)，z 取负北 */
  toRender(eastM: number, northM: number): { x: number; z: number };
}
