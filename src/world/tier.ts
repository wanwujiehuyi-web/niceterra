/**
 * The contract every world tier implements so WorldApp can swap them.
 * valley (谷地) / site (样区) / object (母体) / micro (微观层) all render into
 * one THREE.Group and expose named camera poses + clickable anchors.
 */

import type * as THREE from 'three';

export interface TierCameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface TierAnchor {
  id: string;
  label: string;
  kind: 'site' | 'object' | 'sample' | 'level';
  position: THREE.Vector3;
  siteId?: string;
  routeId?: string;
  levelId?: string;
}

export interface TierOptions {
  lowQuality: boolean;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface TierStats {
  assetsLoaded: number;
  assetsFailed: number;
  log: string[];
}

export interface WorldTier {
  /** Stable name used in stats and the loading overlay. */
  readonly id: string;
  group: THREE.Group;
  poses: Record<string, TierCameraPose>;
  defaultPose: string;
  anchors: TierAnchor[];
  stats: TierStats;
  update: (dt: number, camera: THREE.PerspectiveCamera) => void;
  setQuality: (low: boolean) => void;
  dispose: () => void;
}
