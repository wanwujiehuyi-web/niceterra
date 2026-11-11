
/**
 * SITE-HLG-FOREST-01 — 峨眉冷杉成熟林 (Hailuogou flagship site, DESIGN_ONLY 120×120 m tile).
 *
 * Vertical structure is the product: mature Abies canopy (25–38 m, individual variation, a
 * spatial point process rather than an even grid), a sub-canopy + companion layer, clumped
 * Fargesia bamboo, a herb layer, moss ground cover that prefers rock / log / wet soil, deadwood
 * at three decay stages, and canopy gaps that are real holes in the crowns (real shadow-map light,
 * no painted light spots).
 *
 * Honesty: the 120×120 m tile is DESIGN_ONLY (virtual production bounds, not a surveyed plot
 * boundary). Stand height / layer ranges are inspired by local Heluogou literature (L2 ranges),
 * but the individual stems are design geometry: evidence L4, never "measured".
 * The public GGFZH01 anchor (101.9886E, 29.5731N, 3160 m, SE 30–35°) is metadata only; it is not
 * used to fabricate per-tree coordinates.
 */

import * as THREE from 'three';
import { SkySystem } from '../core/sky';
import type { ModuleMeta, WorldModule } from '../scene/types';
import type { TierAnchor, TierCameraPose, TierOptions, TierStats, WorldTier } from '../world/tier';
import {
  ASSETS,
  TEX,
  type HeightFn,
  SiteResources,
  commitInstances,
  createWind,
  crossCardGeometry,
  fbm2,
  horizontalCardGeometry,
  instantiateAsset,
  loadTexture,
  makeMossyRockGeometry,
  makeRng,
  makeBroadleafTexture,
  makeBambooLeafTexture,
  nearestStream,
  slopeInfo,
  verticalCardGeometry,
  type Rng
} from './shared';

const SITE_ID = 'SITE-HLG-FOREST-01';
// Route C (HLG-MOSS-CHLOROPLAST-01) keeps its entry in the left rail; object anchors
// point at the universal molecular layer until route C geometry is built (P2).
const TILE_HALF = 60;
const SEED = 20261110;

interface CanopyGap {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
}

/** Five canopy gaps (real crown holes; light comes from the absence of crowns, not a decal). */
const GAPS: CanopyGap[] = [
  { x: 2, z: -8, rx: 9.5, rz: 7.5, rot: 0.4 },
  { x: 20, z: 22, rx: 7.5, rz: 9.0, rot: -0.3 },
  { x: -27, z: -4, rx: 7.0, rz: 6.0, rot: 0.9 },
  { x: -9, z: -34, rx: 8.5, rz: 7.0, rot: 0.1 },
  { x: 27, z: 34, rx: 6.0, rz: 6.5, rot: -0.6 }
];

function gapOpenAt(x: number, z: number): number {
  let open = 0;
  for (const g of GAPS) {
    const dx = x - g.x;
    const dz = z - g.z;
    const c = Math.cos(g.rot);
    const s = Math.sin(g.rot);
    const u = (dx * c - dz * s) / g.rx;
    const v = (dx * s + dz * c) / g.rz;
    const r = Math.sqrt(u * u + v * v);
    // 1 inside the gap, feathered to 0 at the crown edge
    open = Math.max(open, 1 - THREE.MathUtils.smoothstep(r, 0.62, 1.25));
  }
  return open;
}

/**
 * DESIGN_ONLY forest DEM: a SE-facing slope (downhill toward +east/+z in render space, matching
 * the documented SE aspect), broad macro relief, a shallow moist draw along the design stream
 * line, and micro hummocks. Never presented as a measured DEM.
 */
export function forestDesignHeight(x: number, z: number): number {
  const macro = (fbm2(x * 0.017, z * 0.017, 4, 21) - 0.5) * 8.5;
  const meso = (fbm2(x * 0.048 + 5, z * 0.048, 3, 27) - 0.5) * 2.1;
  const micro = (fbm2(x * 0.11, z * 0.11, 3, 33) - 0.5) * 0.55;
  const s = nearestStream(x, z);
  const draw = -0.75 * Math.exp(-Math.pow(s.dist / 8.5, 2));
  const hollow = -1.25 * Math.exp(-Math.pow(Math.hypot(x + 6, z - 26) / 13, 2));
  return 41 - 0.30 * (x + z) + macro + meso + micro + draw + hollow;
}

export interface ForestStats extends TierStats {
  triangles: number;
  treeCount: number;
  canopyGaps: number;
  trunks: number;
  branchCards: number;
  bambooClumps: number;
  herbs: number;
  deadwood: number;
  rocks: number;
}

export interface ForestTier extends WorldTier {
  meta: ModuleMeta;
  canopyGaps: number;
  treeCount: number;
  stats: ForestStats;
}

export interface ForestSiteModule extends WorldModule {
  meta: ModuleMeta;
  canopyGaps: number;
  treeCount: number;
  stats: ForestStats;
}

interface TreePlan {
  x: number;
  z: number;
  y: number;
  height: number;
  radius: number;
  crown: number;
  layer: 0 | 1 | 2;
  kind: 'fir' | 'broadleaf' | 'sapling';
  yaw: number;
  leanX: number;
  leanZ: number;
  tint: THREE.Color;
}

interface CoreBuild {
  group: THREE.Group;
  meta: ModuleMeta;
  canopyGaps: number;
  treeCount: number;
  stats: ForestStats;
  anchors: TierAnchor[];
  poses: Record<string, TierCameraPose>;
  update: (dt: number, camera: THREE.Camera) => void;
  setQuality: (low: boolean) => void;
  dispose: () => void;
  resources: SiteResources;
}

function planTrees(rng: Rng, heightAt: HeightFn, low: boolean, heroes: Array<{ x: number; z: number }>): TreePlan[] {
  const plans: TreePlan[] = [];
  const canopyTarget = low ? 32 : 186;
  const underTarget = low ? 16 : 72;
  const saplingTarget = low ? 14 : 62;
  const minCanopy = low ? 4.6 : 2.9;
  const minTree = low ? 2.4 : 1.7;
  const leafy = [new THREE.Color(0x1f3320), new THREE.Color(0x243a22), new THREE.Color(0x1b2c1d), new THREE.Color(0x2a3f23)];

  const farFromAll = (x: number, z: number, list: TreePlan[], min: number): boolean => {
    for (const t of list) {
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  };
  const farFromHeroes = (x: number, z: number): boolean => {
    for (const h of heroes) {
      const dx = h.x - x;
      const dz = h.z - z;
      if (dx * dx + dz * dz < (low ? 4 : 5.5) * (low ? 4 : 5.5)) return false;
    }
    return true;
  };

  // --- first canopy layer: spatial point process with terrain + gap constraints.
  let attempts = 0;
  while (plans.filter((p) => p.layer === 0).length < canopyTarget && attempts < 16000) {
    attempts++;
    const x = rng.range(-TILE_HALF + 4, TILE_HALF - 4);
    const z = rng.range(-TILE_HALF + 4, TILE_HALF - 4);
    const y = heightAt(x, z);
    const slope = slopeInfo(heightAt, x, z).slope;
    const stream = nearestStream(x, z);
    if (slope > 0.95) continue;
    if (stream.dist < 4.2) continue;
    if (gapOpenAt(x, z) > 0.55) continue;
    // density: slightly denser on the moist draw, thinner on steep dry noses
    const density = 0.62 + 0.30 * (fbm2(x * 0.035, z * 0.035, 2, 51) - 0.5) - slope * 0.18;
    if (rng.next() > density) continue;
    if (!farFromHeroes(x, z)) continue;
    if (!farFromAll(x, z, plans, minCanopy)) continue;
    // age / size class: mature Abies dominates; a few emergents are taller
    const ageClass = rng.next();
    const height = ageClass > 0.82 ? rng.range(33, 38) : ageClass > 0.45 ? rng.range(28, 33) : rng.range(25, 29);
    const radius = 0.28 + (height / 38) * 0.55 + rng.range(-0.06, 0.1);
    const crown = height * rng.range(0.17, 0.225);
    plans.push({
      x,
      z,
      y,
      height,
      radius,
      crown,
      layer: 0,
      kind: 'fir',
      yaw: rng.range(0, Math.PI * 2),
      leanX: rng.range(-0.035, 0.035),
      leanZ: rng.range(-0.035, 0.035),
      tint: leafy[rng.int(0, leafy.length - 1)]
    });
  }

  // --- second layer / companion trees: Betula insignis + Sorbus hemsleyana morphotypes.
  attempts = 0;
  while (plans.filter((p) => p.layer === 1).length < underTarget && attempts < 9000) {
    attempts++;
    const x = rng.range(-TILE_HALF + 3, TILE_HALF - 3);
    const z = rng.range(-TILE_HALF + 3, TILE_HALF - 3);
    const slope = slopeInfo(heightAt, x, z).slope;
    const stream = nearestStream(x, z);
    if (slope > 1.05 || stream.dist < 3.0) continue;
    if (!farFromAll(x, z, plans, minTree)) continue;
    const broadleaf = rng.next() < 0.55;
    const height = broadleaf ? rng.range(9, 18) : rng.range(4, 9);
    const radius = 0.05 + height * 0.011;
    plans.push({
      x,
      z,
      y: heightAt(x, z),
      height,
      radius,
      crown: height * (broadleaf ? rng.range(0.3, 0.42) : rng.range(0.2, 0.3)),
      layer: 1,
      kind: broadleaf ? 'broadleaf' : 'fir',
      yaw: rng.range(0, Math.PI * 2),
      leanX: rng.range(-0.06, 0.06),
      leanZ: rng.range(-0.06, 0.06),
      tint: leafy[rng.int(0, leafy.length - 1)]
    });
  }

  // --- regeneration: seedlings / saplings, concentrated at gap edges, logs and the moist draw.
  attempts = 0;
  while (plans.filter((p) => p.kind === 'sapling').length < saplingTarget && attempts < 9000) {
    attempts++;
    const x = rng.range(-TILE_HALF + 2, TILE_HALF - 2);
    const z = rng.range(-TILE_HALF + 2, TILE_HALF - 2);
    const slope = slopeInfo(heightAt, x, z).slope;
    if (slope > 1.2) continue;
    const gap = gapOpenAt(x, z);
    const stream = nearestStream(x, z);
    if (stream.dist < 2.4) continue;
    const release = 0.18 + gap * 0.5 + (stream.dist < 12 ? 0.2 : 0);
    if (rng.next() > release) continue;
    if (!farFromAll(x, z, plans, 1.0)) continue;
    const height = rng.range(0.8, 3.6);
    plans.push({
      x,
      z,
      y: heightAt(x, z),
      height,
      radius: 0.02 + height * 0.012,
      crown: height * rng.range(0.24, 0.34),
      layer: 2,
      kind: 'sapling',
      yaw: rng.range(0, Math.PI * 2),
      leanX: rng.range(-0.12, 0.12),
      leanZ: rng.range(-0.12, 0.12),
      tint: leafy[rng.int(0, leafy.length - 1)]
    });
  }

  return plans;
}

async function buildCore(opts: { lowQuality: boolean; heightAt: HeightFn; onProgress?: (done: number, total: number, label: string) => void }): Promise<CoreBuild> {
  const low = opts.lowQuality;
  const heightAt = opts.heightAt;
  const progress = opts.onProgress ?? (() => {});
  const rng = makeRng(SEED);
  const res = new SiteResources();
  const wind = createWind();
  const group = new THREE.Group();
  group.name = 'site-hlg-forest-01';
  const stats: ForestStats = {
    assetsLoaded: 0,
    assetsFailed: 0,
    log: [],
    triangles: 0,
    treeCount: 0,
    canopyGaps: GAPS.length,
    trunks: 0,
    branchCards: 0,
    bambooClumps: 0,
    herbs: 0,
    deadwood: 0,
    rocks: 0
  };

  const heroSpots = low ? [] : [{ x: -26, z: 18 }, { x: -6, z: -2 }];
  const plans = planTrees(rng, heightAt, low, heroSpots);
  stats.treeCount = plans.length;

  progress(1, 7, '布置乔木空间点过程');

  // ---------------------------------------------------------------- ground
  const groundSegs = low ? 72 : 132;
  const groundGeo = new THREE.PlaneGeometry(TILE_HALF * 2, TILE_HALF * 2, groundSegs, groundSegs);
  groundGeo.rotateX(-Math.PI / 2);
  const gpos = groundGeo.attributes.position as THREE.BufferAttribute;
  const gcol = new Float32Array(gpos.count * 3);
  const mossGreen = new THREE.Color(0xa9c47c);
  const wetGreen = new THREE.Color(0x93b271);
  const litterBrown = new THREE.Color(0xc9ab7b);
  const darkSoil = new THREE.Color(0x9a825f);
  const rockGrey = new THREE.Color(0xd0c9bd);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i);
    const z = gpos.getZ(i);
    const y = heightAt(x, z);
    gpos.setY(i, y);
    const slope = slopeInfo(heightAt, x, z, 0.9).slope;
    const stream = nearestStream(x, z);
    const moist = THREE.MathUtils.clamp(
      0.42 + 0.5 * (fbm2(x * 0.06 + 3, z * 0.06, 3, 61) - 0.5) + 0.45 * Math.exp(-Math.pow(stream.dist / 11, 2)) - slope * 0.25,
      0,
      1
    );
    const mossMask = THREE.MathUtils.clamp(moist * 1.15 - 0.18 + (fbm2(x * 0.2, z * 0.2, 2, 63) - 0.5) * 0.35, 0, 1);
    const litterMask = THREE.MathUtils.clamp(0.55 - mossMask + (fbm2(x * 0.14, z * 0.14, 2, 67) - 0.5) * 0.3, 0, 1);
    const rockMask = THREE.MathUtils.clamp((slope - 0.7) * 1.1 + (fbm2(x * 0.5, z * 0.5, 2, 69) - 0.55) * 0.5, 0, 1);
    tmpColor.copy(darkSoil).lerp(litterBrown, litterMask * 0.8 + 0.2);
    tmpColor.lerp(mossGreen, mossMask * 0.8);
    tmpColor.lerp(wetGreen, THREE.MathUtils.clamp((1 - stream.dist / 6) * 0.6, 0, 1) * mossMask);
    tmpColor.lerp(rockGrey, rockMask);
    gcol[i * 3] = tmpColor.r;
    gcol[i * 3 + 1] = tmpColor.g;
    gcol[i * 3 + 2] = tmpColor.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  groundGeo.computeVertexNormals();
  res.geometry(groundGeo);
  const [groundAlbedo, groundNormalMap, groundRough] = await Promise.all([
    loadTexture(TEX.groundColor, { repeat: [26, 26] }),
    loadTexture(TEX.groundNormal, { srgb: false, repeat: [26, 26] }),
    loadTexture(TEX.groundRough, { srgb: false, repeat: [26, 26] })
  ]);
  res.texture(groundAlbedo);
  res.texture(groundNormalMap);
  res.texture(groundRough);
  const groundMat = res.material(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(1.45, 1.4, 1.25),
      map: groundAlbedo,
      normalMap: groundNormalMap,
      roughnessMap: groundRough,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.45
    })
  );
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.name = 'forest-ground';
  group.add(ground);

  progress(2, 7, '地表与苔藓地被');

  // ---------------------------------------------------------------- textures
  const [branchA, branchB, branchC, fernTex, grassTex, mossTex, barkTex, mossAlbedo, mossNormal, graniteAlbedo, graniteNormal, broadleafTex, bambooTex] = await Promise.all([
    loadTexture(TEX.branchA),
    loadTexture(TEX.branchB),
    loadTexture(TEX.branchC),
    loadTexture(TEX.fern),
    loadTexture(TEX.grass),
    loadTexture(TEX.mossCard),
    loadTexture(TEX.bark, { repeat: [2, 4] }),
    loadTexture(TEX.mossAlbedo, { repeat: [1, 1] }),
    loadTexture(TEX.mossNormal, { srgb: false }),
    loadTexture(TEX.graniteAlbedo, { repeat: [1.6, 1.6] }),
    loadTexture(TEX.graniteNormal, { srgb: false }),
    Promise.resolve(makeBroadleafTexture(SEED + 5)),
    Promise.resolve(makeBambooLeafTexture(SEED + 9))
  ]);
  for (const tex of [branchA, branchB, branchC, fernTex, grassTex, mossTex, barkTex, mossAlbedo, mossNormal, graniteAlbedo, graniteNormal, broadleafTex, bambooTex]) res.texture(tex);

  // ---------------------------------------------------------------- trunk + branch instancing
  const trunkGeo = new THREE.CylinderGeometry(0.55, 1, 1, low ? 5 : 7, 1, false);
  trunkGeo.translate(0, 0.5, 0);
  res.geometry(trunkGeo);
  const trunkMat = res.material(
    new THREE.MeshStandardMaterial({ map: barkTex, color: 0xffffff, roughness: 0.95, metalness: 0 })
  );
  const trunkMatrices: THREE.Matrix4[] = [];
  const trunkColors: THREE.Color[] = [];

  const cardGeo = horizontalCardGeometry();
  res.geometry(cardGeo);
  const sprayGeo = verticalCardGeometry();
  res.geometry(sprayGeo);

  const branchBatches: THREE.Matrix4[][] = [[], [], []];
  const branchColors: THREE.Color[][] = [[], [], []];
  const crownCards = (t: TreePlan, baseY: number): void => {
    const whorlStep = t.kind === 'sapling' ? Math.max(0.35, t.height * 0.08) : low ? 2.6 : 1.55;
    const start = t.kind === 'broadleaf' ? 0.25 : t.kind === 'sapling' ? 0.12 : 0.22;
    const whorls = Math.max(3, Math.min(t.kind === 'sapling' ? 6 : low ? 8 : 17, Math.floor((t.height * (1 - start)) / whorlStep)));
    for (let w = 0; w < whorls; w++) {
      const u = whorls > 1 ? w / (whorls - 1) : 0;
      const rel = start + (1 - start) * u;
      const y = baseY + t.height * rel;
      // spruce crown profile: widest below the middle, tapering to a spire
      const profile = Math.pow(1 - rel, 0.65) * (0.45 + 0.55 * THREE.MathUtils.smoothstep(rel, 0.05, 0.25));
      const len = Math.max(0.25, t.crown * profile * rng.range(0.78, 1.18));
      const droop = (t.kind === 'broadleaf' ? 0.14 : 0.46) + (1 - rel) * 0.34 + rng.range(-0.08, 0.1);
      const count = t.kind === 'sapling' ? 4 : Math.max(4, Math.round(7.4 - u * 2.4));
      for (let b = 0; b < count; b++) {
        const angle = t.yaw + (b / count) * Math.PI * 2 + rng.range(-0.35, 0.35);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, -droop, 'YXZ'));
        const pos = new THREE.Vector3(t.x, y, t.z);
        m.compose(pos, q, new THREE.Vector3(len, 1, len * rng.range(0.62, 0.88)));
        const tint = new THREE.Color(1, 1, 1).multiplyScalar(rng.range(0.82, 1.16));
        const batch = rng.int(0, 2);
        branchBatches[batch].push(m);
        branchColors[batch].push(tint);
      }
    }
    // top spire: two vertical spray cards so the leader reads from below
    const topLen = Math.max(0.5, t.crown * 0.55);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw + i * Math.PI * 0.5, 0.06, 'YXZ'));
      m.compose(new THREE.Vector3(t.x, baseY + t.height * 0.93, t.z), q, new THREE.Vector3(topLen, topLen, 1));
      const spireBatch = rng.int(0, 2);
      branchBatches[spireBatch].push(m);
      branchColors[spireBatch].push(new THREE.Color(1, 1, 1).multiplyScalar(0.94));
    }
  };

  for (const t of plans) {
    const baseY = t.y - 0.12;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.leanX, t.yaw, t.leanZ, 'YXZ'));
    m.compose(new THREE.Vector3(t.x, baseY, t.z), q, new THREE.Vector3(t.radius, t.height * 1.01, t.radius));
    trunkMatrices.push(m);
    trunkColors.push(new THREE.Color(1, 1, 1).multiplyScalar(rng.range(0.62, 0.95)));
    crownCards(t, baseY);
  }
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trunkMatrices.length);
  commitInstances(trunkMesh, trunkMatrices, trunkColors);
  trunkMesh.castShadow = !low;
  trunkMesh.receiveShadow = true;
  trunkMesh.name = 'forest-trunks';
  group.add(trunkMesh);
  stats.trunks = trunkMatrices.length;

  const branchGeoMatOptions: Array<{ tex: THREE.Texture; color: number }> = [
    { tex: branchA, color: 0xffffff },
    { tex: branchB, color: 0xffffff },
    { tex: branchC, color: 0xffffff }
  ];
  const branchMeshes: THREE.InstancedMesh[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = res.material(
      (() => {
        const m = new THREE.MeshStandardMaterial({
          map: branchGeoMatOptions[i].tex,
          color: branchGeoMatOptions[i].color,
          roughness: 0.86,
          metalness: 0,
          side: THREE.DoubleSide,
          alphaTest: 0.42,
          alphaToCoverage: true
        });
        m.envMapIntensity = 0.5;
        return m;
      })()
    );
    wind.apply(mat, 'branch', 0.06, 1.1);
    const mesh = new THREE.InstancedMesh(cardGeo, mat, Math.max(1, branchBatches[i].length));
    commitInstances(mesh, branchBatches[i], branchColors[i]);
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.name = 'forest-canopy-' + i;
    group.add(mesh);
    branchMeshes.push(mesh);
    stats.branchCards += branchBatches[i].length;
  }

  progress(3, 7, '冠层与竹灌');

  // ---------------------------------------------------------------- hero GLB trees (non-low only)
  if (!low) {
    for (const spot of heroSpots) {
      try {
        progress(3, 7, '载入近景冷杉母体');
        const glb = await instantiateAsset(ASSETS.abies, {
          targetLongest: spot.x === -26 ? 34 : 37,
          groundY: 0,
          yaw: spot.x === -26 ? 0.6 : 2.1,
          castShadow: false,
          receiveShadow: true
        });
        const wrapper = new THREE.Group();
        wrapper.position.set(spot.x, heightAt(spot.x, spot.z) - 0.15, spot.z);
        wrapper.add(glb.object);
        wrapper.name = 'hero-abies';
        group.add(wrapper);
        stats.assetsLoaded++;
        stats.log.push('OK r7-abies-fabri @' + spot.x + ',' + spot.z + ' tris=' + glb.triangles);
      } catch (err) {
        stats.assetsFailed++;
        stats.log.push('FAIL r7-abies-fabri ' + String((err as Error).message).slice(0, 80));
      }
    }
    try {
      const glb = await instantiateAsset(ASSETS.betula, {
        targetLongest: 21,
        groundY: 0,
        yaw: 1.4,
        castShadow: false,
        receiveShadow: true
      });
      const wrapper = new THREE.Group();
      wrapper.position.set(-16, heightAt(-16, 30) - 0.1, 30);
      wrapper.add(glb.object);
      wrapper.name = 'hero-betula';
      group.add(wrapper);
      stats.assetsLoaded++;
      stats.log.push('OK r7-betula-insignis @-16,30 tris=' + glb.triangles);
    } catch (err) {
      stats.assetsFailed++;
      stats.log.push('FAIL r7-betula-insignis ' + String((err as Error).message).slice(0, 80));
    }
  }

  // ---------------------------------------------------------------- bamboo (Fargesia) clumps
  const culmGeo = new THREE.CylinderGeometry(0.7, 1, 1, low ? 4 : 5, 1, true);
  culmGeo.translate(0, 0.5, 0);
  res.geometry(culmGeo);
  const culmMat = res.material(
    new THREE.MeshStandardMaterial({ color: 0x7d8a45, roughness: 0.72, metalness: 0, side: THREE.DoubleSide })
  );
  const leafGeo = crossCardGeometry(2, 0.4);
  res.geometry(leafGeo);
  const leafMat = res.material(
    new THREE.MeshStandardMaterial({
      map: bambooTex,
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
      alphaTest: 0.3,
      alphaToCoverage: true
    })
  );
  wind.apply(leafMat, 'blade', 0.09, 1.45);
  const culmMatrices: THREE.Matrix4[] = [];
  const culmColors: THREE.Color[] = [];
  const leafMatrices: THREE.Matrix4[] = [];
  const leafColors: THREE.Color[] = [];
  const bambooTarget = low ? 42 : 138;
  let bambooPlaced = 0;
  let bambooAttempts = 0;
  while (bambooPlaced < bambooTarget && bambooAttempts < 5000) {
    bambooAttempts++;
    const x = rng.range(-TILE_HALF + 3, TILE_HALF - 3);
    const z = rng.range(-TILE_HALF + 3, TILE_HALF - 3);
    const slope = slopeInfo(heightAt, x, z).slope;
    const stream = nearestStream(x, z);
    if (slope > 1.1 || stream.dist < 2.6) continue;
    const gap = gapOpenAt(x, z);
    const moist = THREE.MathUtils.clamp(0.45 + 0.5 * Math.exp(-Math.pow(stream.dist / 14, 2)) + (fbm2(x * 0.05, z * 0.05, 2, 71) - 0.5), 0, 1);
    if (rng.next() > 0.22 + 0.42 * moist + 0.25 * gap) continue;
    // clumps are clustered, not an even carpet: reject if another clump is very close
    bambooPlaced++;
    const culms = low ? rng.int(6, 10) : rng.int(9, 17);
    const clumpR = rng.range(0.55, 1.5);
    for (let c = 0; c < culms; c++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = Math.sqrt(rng.next()) * clumpR;
      const px = x + Math.cos(ang) * rad;
      const pz = z + Math.sin(ang) * rad;
      const py = heightAt(px, pz);
      const h = rng.range(1.35, 2.75);
      const r = rng.range(0.009, 0.019);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.08, 0.08), rng.range(0, 6.28), rng.range(-0.08, 0.08), 'YXZ'));
      m.compose(new THREE.Vector3(px, py - 0.03, pz), q, new THREE.Vector3(r, h, r));
      culmMatrices.push(m);
      culmColors.push(new THREE.Color(0x7f8a45).multiplyScalar(rng.range(0.75, 1.1)));
      const leaves = low ? 1 : rng.int(2, 3);
      for (let l = 0; l < leaves; l++) {
        const lm = new THREE.Matrix4();
        const lq = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rng.range(-0.35, 0.35), rng.range(0, 6.28), rng.range(-0.45, 0.45), 'YXZ')
        );
        const size = rng.range(0.34, 0.62);
        lm.compose(new THREE.Vector3(px, py + h * rng.range(0.62, 0.96), pz), lq, new THREE.Vector3(size, size * rng.range(0.75, 1.1), size));
        leafMatrices.push(lm);
        leafColors.push(new THREE.Color(0.92, 0.98, 0.86).multiplyScalar(rng.range(0.82, 1.12)));
      }
    }
    stats.bambooClumps = bambooPlaced;
  }
  stats.bambooClumps = bambooPlaced;
  if (culmMatrices.length > 0) {
    const culms = new THREE.InstancedMesh(culmGeo, culmMat, culmMatrices.length);
    commitInstances(culms, culmMatrices, culmColors);
    culms.castShadow = false;
    culms.receiveShadow = true;
    culms.name = 'bamboo-culms';
    group.add(culms);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafMatrices.length);
    commitInstances(leaves, leafMatrices, leafColors);
    leaves.castShadow = false;
    leaves.receiveShadow = true;
    leaves.name = 'bamboo-leaves';
    group.add(leaves);
  }

  // ---------------------------------------------------------------- herb layer + moss ground cover
  const herbGroup = new THREE.Group();
  herbGroup.name = 'forest-herb-layer';
  group.add(herbGroup);
  interface Scatter {
    tex: THREE.Texture;
    count: number;
    minScale: number;
    maxScale: number;
    color: THREE.Color;
    wind: 'blade' | 'branch';
    amp: number;
    moistBias: number;
    shadeBias: number;
    planar?: boolean;
  }
  const scatters: Scatter[] = [
    { tex: fernTex, count: low ? 220 : 880, minScale: 0.55, maxScale: 1.25, color: new THREE.Color(0xd9e6c9), wind: 'blade', amp: 0.07, moistBias: 0.65, shadeBias: 0.4 },
    { tex: grassTex, count: low ? 160 : 640, minScale: 0.28, maxScale: 0.62, color: new THREE.Color(0xe4e9c6), wind: 'blade', amp: 0.1, moistBias: 0.35, shadeBias: -0.15 },
    { tex: broadleafTex, count: low ? 120 : 460, minScale: 0.32, maxScale: 0.78, color: new THREE.Color(0xdde7c8), wind: 'blade', amp: 0.06, moistBias: 0.6, shadeBias: 0.25 },
    { tex: mossTex, count: low ? 260 : 1200, minScale: 0.22, maxScale: 0.62, color: new THREE.Color(0xd7e6bd), wind: 'branch', amp: 0.01, moistBias: 0.85, shadeBias: 0.5, planar: true }
  ];
  const herbGeo = crossCardGeometry(2, 0);
  res.geometry(herbGeo);
  const herbStats: number[] = [];
  for (const s of scatters) {
    const mat = res.material(
      (() => {
        const m = new THREE.MeshStandardMaterial({
          map: s.tex,
          color: 0xffffff,
          roughness: 0.9,
          metalness: 0,
          side: THREE.DoubleSide,
          alphaTest: 0.34,
          alphaToCoverage: true
        });
        m.envMapIntensity = 0.45;
        return m;
      })()
    );
    wind.apply(mat, s.wind, s.amp, 1.3);
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    let placed = 0;
    let tries = 0;
    while (placed < s.count && tries < s.count * 40) {
      tries++;
      const x = rng.range(-TILE_HALF + 1.5, TILE_HALF - 1.5);
      const z = rng.range(-TILE_HALF + 1.5, TILE_HALF - 1.5);
      const slope = slopeInfo(heightAt, x, z).slope;
      const stream = nearestStream(x, z);
      const gap = gapOpenAt(x, z);
      if (slope > 1.35) continue;
      const moist = THREE.MathUtils.clamp(0.45 + 0.5 * Math.exp(-Math.pow(stream.dist / 13, 2)) + (fbm2(x * 0.07, z * 0.07, 2, 73) - 0.5), 0, 1);
      const shade = 1 - gap;
      const score = moist * s.moistBias + shade * s.shadeBias + rng.range(0, 0.35);
      if (rng.next() > score) continue;
      const y = heightAt(x, z);
      const scale = rng.range(s.minScale, s.maxScale);
      const m = new THREE.Matrix4();
      if (s.planar) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + rng.range(-0.25, 0.25), rng.range(0, 6.28), 0, 'YXZ'));
        m.compose(new THREE.Vector3(x, y + 0.03, z), q, new THREE.Vector3(scale, scale, scale));
      } else {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), rng.range(-0.08, 0.08), 'YXZ'));
        m.compose(new THREE.Vector3(x, y - 0.03, z), q, new THREE.Vector3(scale * 1.2, scale, scale * 1.2));
      }
      matrices.push(m);
      colors.push(s.color.clone().multiplyScalar(rng.range(0.7, 1.2)));
      placed++;
    }
    const mesh = new THREE.InstancedMesh(herbGeo, mat, Math.max(1, matrices.length));
    commitInstances(mesh, matrices, colors);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'herb-' + herbStats.length;
    herbGroup.add(mesh);
    herbStats.push(matrices.length);
    stats.herbs += matrices.length;
  }

  progress(4, 7, '苔藓与倒木');

  // ---------------------------------------------------------------- deadwood (3 decay stages) + snags
  const deadwoodGroup = new THREE.Group();
  deadwoodGroup.name = 'forest-deadwood';
  group.add(deadwoodGroup);
  const barkMat = res.material(
    new THREE.MeshStandardMaterial({ map: barkTex, color: 0x7b7266, roughness: 0.96, metalness: 0, vertexColors: true })
  );
  const woodMat = res.material(
    new THREE.MeshStandardMaterial({ map: barkTex, color: 0xa89478, roughness: 0.88, metalness: 0, vertexColors: true })
  );
  const decayMat = res.material(
    new THREE.MeshStandardMaterial({ map: barkTex, color: 0x5c5346, roughness: 0.98, metalness: 0, vertexColors: true })
  );
  const mossCardMatrices: THREE.Matrix4[] = [];
  const mossCardColors: THREE.Color[] = [];
  const mossCardTex = mossTex;

  interface LogPlan {
    x: number;
    z: number;
    yaw: number;
    length: number;
    radius: number;
    stage: 0 | 1 | 2;
  }
  const logPlans: LogPlan[] = [
    { x: -19, z: 25, yaw: 0.55, length: 8.5, radius: 0.46, stage: 0 },
    { x: 3, z: 12, yaw: 2.3, length: 6.2, radius: 0.38, stage: 1 },
    { x: 14, z: -18, yaw: 1.1, length: 7.4, radius: 0.42, stage: 2 },
    { x: -30, z: -12, yaw: 0.2, length: 5.0, radius: 0.3, stage: 1 },
    { x: -4, z: -22, yaw: 2.9, length: 4.4, radius: 0.26, stage: 2 },
    { x: 32, z: 12, yaw: 1.7, length: 5.6, radius: 0.33, stage: 0 },
    { x: -12, z: 36, yaw: 0.9, length: 4.0, radius: 0.24, stage: 1 },
    { x: 24, z: 40, yaw: 2.1, length: 3.6, radius: 0.22, stage: 2 }
  ];
  const activeLogs = low ? logPlans.slice(0, 4) : logPlans;
  for (let i = 0; i < activeLogs.length; i++) {
    const p = activeLogs[i];
    const geo = new THREE.CylinderGeometry(p.radius * 0.82, p.radius, p.length, low ? 7 : 10, low ? 4 : 7, false);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(p.stage === 0 ? 0x8d8478 : p.stage === 1 ? 0xa08d74 : 0x60584b);
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      const ang = Math.atan2(vz, vx);
      const wobble = 1 + 0.055 * Math.sin(ang * 3 + vy * 0.9) + 0.03 * Math.sin(vy * 2.3);
      pos.setXYZ(v, vx * wobble, vy, vz * wobble);
      // peel patches on stage 1, decay darkness on stage 2
      const patch = (fbm2(vx * 3 + i * 7, vy * 1.6, 2, 87) - 0.5) * (p.stage === 0 ? 0.25 : 0.7);
      const c = base.clone().offsetHSL(0, 0, patch * 0.25);
      if (p.stage === 2) c.multiplyScalar(0.8);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    res.geometry(geo);
    const mat = p.stage === 0 ? barkMat : p.stage === 1 ? woodMat : decayMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = Math.PI / 2;
    mesh.rotation.y = p.yaw;
    mesh.position.set(p.x, heightAt(p.x, p.z) + p.radius * (p.stage === 2 ? 0.35 : 0.75), p.z);
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.name = 'fallen-log-' + i + '-stage' + p.stage;
    deadwoodGroup.add(mesh);
    stats.deadwood++;
    // moss mats along the log top
    const mossCount = low ? 3 : p.stage === 0 ? 6 : 11;
    for (let m = 0; m < mossCount; m++) {
      const along = rng.range(-p.length * 0.45, p.length * 0.45);
      const wx = p.x + Math.cos(p.yaw) * along;
      const wz = p.z - Math.sin(p.yaw) * along;
      const wy = heightAt(wx, wz) + p.radius * (0.75 + 0.95);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35 + rng.range(-0.2, 0.2), rng.range(0, 6.28), 0, 'YXZ'));
      const s = rng.range(0.45, 1.05);
      mossCardMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(wx, wy, wz), q, new THREE.Vector3(s, s, s)));
      mossCardColors.push(new THREE.Color(0.9, 0.98, 0.82).multiplyScalar(rng.range(0.78, 1.12)));
    }
  }

  // Aholo Lux3D 苔藓倒木（taskId 6381289，AI 生成视觉资产，非实测样本）：
  // hero 倒木一株，补充程序化圆柱倒木的材质真实感
  try {
    const glb = await instantiateAsset(ASSETS.mossyLogAholo, {
      targetLongest: 7.5,
      groundY: 0,
      yaw: 1.9,
      castShadow: false,
      receiveShadow: true
    });
    const wrapper = new THREE.Group();
    wrapper.position.set(-22, heightAt(-22, 8) - 0.1, 8);
    wrapper.add(glb.object);
    wrapper.name = 'hero-aholo-mossy-log';
    group.add(wrapper);
    stats.assetsLoaded++;
    stats.log.push('OK aholo mossy-fallen-log tris=' + glb.triangles);
  } catch (err) {
    stats.assetsFailed++;
    stats.log.push('FAIL aholo mossy-fallen-log ' + String((err as Error).message).slice(0, 80));
  }

  // snags: three forms — tall broken, short stub, leaning
  interface SnagPlan {
    x: number;
    z: number;
    height: number;
    radius: number;
    form: 0 | 1 | 2;
  }
  const snagPlans: SnagPlan[] = [
    { x: 10, z: -6, height: 14, radius: 0.4, form: 0 },
    { x: -26, z: 6, height: 9, radius: 0.33, form: 1 },
    { x: -2, z: 22, height: 6.5, radius: 0.28, form: 2 },
    { x: 30, z: -30, height: 11, radius: 0.36, form: 0 },
    { x: -38, z: 28, height: 4.5, radius: 0.26, form: 1 },
    { x: 18, z: 34, height: 7.5, radius: 0.3, form: 2 },
    { x: -16, z: -24, height: 5.2, radius: 0.24, form: 0 }
  ];
  const activeSnags = low ? snagPlans.slice(0, 3) : snagPlans;
  for (let i = 0; i < activeSnags.length; i++) {
    const s = activeSnags[i];
    const geo = new THREE.CylinderGeometry(s.radius * 0.42, s.radius, s.height, low ? 6 : 9, low ? 3 : 6, false);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      const t = (vy + s.height / 2) / s.height;
      const jag = t > 0.97 ? 1 + 0.22 * Math.sin(vx * 21 + vz * 17) : 1;
      pos.setXYZ(v, vx * jag, vy - (t > 0.97 ? Math.abs(Math.sin(vx * 31)) * 0.5 : 0), vz * jag);
      const c = new THREE.Color(0x6d665b).multiplyScalar(0.75 + t * 0.3);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    res.geometry(geo);
    const mesh = new THREE.Mesh(geo, barkMat);
    const lean = s.form === 2 ? 0.32 : s.form === 1 ? 0.06 : 0.02;
    mesh.rotation.set(0.03, rng.range(0, 6.28), lean);
    mesh.position.set(s.x, heightAt(s.x, s.z) + s.height / 2 - 0.25, s.z);
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.name = 'snag-' + i + '-form' + s.form;
    deadwoodGroup.add(mesh);
    stats.deadwood++;
    // a few broken branch stubs on tall snags
    if (s.form === 0) {
      for (let b = 0; b < 3; b++) {
        const m = new THREE.Matrix4();
        const angle = rng.range(0, 6.28);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, -0.55, 'YXZ'));
        m.compose(
          new THREE.Vector3(s.x, heightAt(s.x, s.z) + s.height * rng.range(0.4, 0.8), s.z),
          q,
          new THREE.Vector3(rng.range(0.8, 1.6), 1, rng.range(0.5, 1.0))
        );
        branchBatches[2].push(m);
        branchColors[2].push(new THREE.Color(0x5c5346));
      }
    }
  }

  // stumps
  for (let i = 0; i < (low ? 2 : 4); i++) {
    const x = rng.range(-50, 50);
    const z = rng.range(-50, 50);
    if (nearestStream(x, z).dist < 4) continue;
    const h = rng.range(0.5, 1.5);
    const geo = new THREE.CylinderGeometry(rng.range(0.3, 0.6), rng.range(0.45, 0.8), h, low ? 6 : 9, 1, false);
    res.geometry(geo);
    const mesh = new THREE.Mesh(geo, decayMat);
    mesh.position.set(x, heightAt(x, z) + h / 2 - 0.12, z);
    mesh.rotation.set(0, rng.range(0, 6.28), rng.range(-0.1, 0.1));
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.name = 'stump-' + i;
    deadwoodGroup.add(mesh);
    stats.deadwood++;
  }

  // ---------------------------------------------------------------- mossy rocks
  const rockGroup = new THREE.Group();
  rockGroup.name = 'forest-rocks';
  group.add(rockGroup);
  const rockMaterial = res.material(
    new THREE.MeshStandardMaterial({
      map: graniteAlbedo,
      normalMap: graniteNormal,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.5
    })
  );
  const rockCount = low ? 6 : 16;
  for (let i = 0; i < rockCount; i++) {
    const x = rng.range(-52, 52);
    const z = rng.range(-52, 52);
    if (nearestStream(x, z).dist < 3.5) continue;
    const geo = makeMossyRockGeometry(SEED + i * 13, low ? 0 : 1, 0.75);
    res.geometry(geo);
    const mesh = new THREE.Mesh(geo, rockMaterial);
    const size = rng.range(0.35, 2.1);
    mesh.scale.set(size * rng.range(0.85, 1.2), size * rng.range(0.55, 0.9), size * rng.range(0.85, 1.2));
    mesh.position.set(x, heightAt(x, z) + size * 0.18, z);
    mesh.rotation.set(rng.range(-0.2, 0.2), rng.range(0, 6.28), rng.range(-0.2, 0.2));
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    mesh.name = 'mossy-rock-' + i;
    rockGroup.add(mesh);
    stats.rocks++;
    // rock-top moss patches
    for (let m = 0; m < (low ? 1 : 3); m++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 + rng.range(-0.3, 0.3), rng.range(0, 6.28), 0, 'YXZ'));
      const s = rng.range(0.3, 0.75);
      mossCardMatrices.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x + rng.range(-0.4, 0.4) * size, heightAt(x, z) + size * 0.55, z + rng.range(-0.4, 0.4) * size),
          q,
          new THREE.Vector3(s, s, s)
        )
      );
      mossCardColors.push(new THREE.Color(0.9, 0.98, 0.82).multiplyScalar(rng.range(0.8, 1.1)));
    }
  }

  // moss ground cards (wet soil preference)
  const extraMoss = low ? 180 : 620;
  for (let i = 0; i < extraMoss; i++) {
    const x = rng.range(-58, 58);
    const z = rng.range(-58, 58);
    const stream = nearestStream(x, z);
    if (rng.next() > THREE.MathUtils.clamp(0.25 + Math.exp(-Math.pow(stream.dist / 12, 2)) * 0.7, 0, 1)) continue;
    if (slopeInfo(heightAt, x, z).slope > 1.2) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + rng.range(-0.3, 0.3), rng.range(0, 6.28), 0, 'YXZ'));
    const s = rng.range(0.2, 0.55);
    mossCardMatrices.push(
      new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + 0.02, z), q, new THREE.Vector3(s, s, s))
    );
    mossCardColors.push(new THREE.Color(0.9, 0.98, 0.82).multiplyScalar(rng.range(0.75, 1.15)));
  }

  const mossMat = res.material(
    new THREE.MeshStandardMaterial({
      map: mossCardTex,
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      alphaTest: 0.32,
      alphaToCoverage: true
    })
  );
  wind.apply(mossMat, 'branch', 0.012, 0.7);
  const mossMesh = new THREE.InstancedMesh(herbGeo, mossMat, Math.max(1, mossCardMatrices.length));
  commitInstances(mossMesh, mossCardMatrices, mossCardColors);
  mossMesh.castShadow = false;
  mossMesh.receiveShadow = true;
  mossMesh.name = 'moss-ground-cover';
  group.add(mossMesh);

  // ---------------------------------------------------------------- anchors + poses
  const tallest = plans.filter((p) => p.layer === 0).sort((a, b) => b.height - a.height)[0] ?? plans[0];
  const logAnchorPlan = activeLogs[0];
  const logAnchorY = heightAt(logAnchorPlan.x, logAnchorPlan.z) + logAnchorPlan.radius * 1.7;
  const sapling = plans.find((p) => p.kind === 'sapling');
  const canopyAnchor = new THREE.Vector3(tallest.x, tallest.y + tallest.height * 0.55, tallest.z);
  const mossAnchor = new THREE.Vector3(-4, heightAt(-4, -22) + 0.55, -22);
  // find mossy rock closest to the moss anchor for a visible moss cushion
  let mossRock: THREE.Mesh | null = null;
  let mossRockDist = Infinity;
  rockGroup.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh) return;
    const d = Math.hypot(m.position.x - mossAnchor.x, m.position.z - mossAnchor.z);
    if (d < mossRockDist) {
      mossRockDist = d;
      mossRock = m;
    }
  });
  if (mossRock) {
    const mr = mossRock as THREE.Mesh;
    mossAnchor.set(mr.position.x, mr.position.y + mr.scale.y * 0.7, mr.position.z);
  }
  const logAnchor = new THREE.Vector3(logAnchorPlan.x, logAnchorY, logAnchorPlan.z);
  const seedlingAnchor = sapling
    ? new THREE.Vector3(sapling.x, sapling.y + sapling.height * 0.6, sapling.z)
    : new THREE.Vector3(2, heightAt(2, -8) + 1.2, -8);
  const gapAnchor = new THREE.Vector3(GAPS[0].x, heightAt(GAPS[0].x, GAPS[0].z) + 2.2, GAPS[0].z);

  const anchors: TierAnchor[] = [
    { id: 'anchor-forest-canopy', label: '林冠层 · 峨眉冷杉 25–38 m · 深入分子层', kind: 'object', position: canopyAnchor, siteId: SITE_ID, levelId: 'mol-forest-canopy' },
    { id: 'anchor-forest-moss', label: '苔藓垫 · 10 cm 生境（种属待鉴定）· 深入分子层', kind: 'sample', position: mossAnchor, siteId: SITE_ID, levelId: 'mol-forest-moss' },
    { id: 'anchor-forest-log', label: '倒木 · 腐朽阶段 I · 深入分子层', kind: 'object', position: logAnchor, siteId: SITE_ID, levelId: 'mol-forest-log' },
    { id: 'anchor-forest-seedling', label: '林下幼苗 · 更新层 · 深入分子层', kind: 'object', position: seedlingAnchor, siteId: SITE_ID, levelId: 'mol-forest-seedling' },
    { id: 'anchor-forest-gap', label: '林窗 · 冠层缺口', kind: 'object', position: gapAnchor, siteId: SITE_ID }
  ];

  const camAPos = new THREE.Vector3(-42, heightAt(-42, 48) + 1.65, 48);
  const camATarget = new THREE.Vector3(0, heightAt(0, -10) + 8, -10);
  const poses: Record<string, TierCameraPose> = {
    A: { position: [camAPos.x, camAPos.y, camAPos.z], target: [camATarget.x, camATarget.y, camATarget.z] },
    B: {
      position: [GAPS[0].x, heightAt(GAPS[0].x, GAPS[0].z + 8) + 1.7, GAPS[0].z + 8],
      target: [GAPS[0].x, heightAt(GAPS[0].x, GAPS[0].z) + 26, GAPS[0].z]
    },
    C: {
      position: [logAnchorPlan.x + 2.6, heightAt(logAnchorPlan.x + 2.6, logAnchorPlan.z + 2.2) + 1.15, logAnchorPlan.z + 2.2],
      target: [logAnchorPlan.x, logAnchorY, logAnchorPlan.z]
    }
  };

  // patch the canopy cards that were added for snag stubs after the instanced meshes were built
  const lateBranchMat = res.material(
    new THREE.MeshStandardMaterial({ map: branchC, color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.42 })
  );
  if (branchBatches[2].length > branchMeshes[2].count) {
    const extra = new THREE.InstancedMesh(cardGeo, lateBranchMat, branchBatches[2].length - branchMeshes[2].count);
    const start = branchMeshes[2].count;
    const mats = branchBatches[2].slice(start);
    const cols = branchColors[2].slice(start);
    commitInstances(extra, mats, cols);
    extra.castShadow = false;
    extra.receiveShadow = true;
    extra.name = 'dead-branch-stubs';
    group.add(extra);
  } else {
    // dispose the unused material immediately (no instance used it)
    lateBranchMat.dispose();
    res.materials.delete(lateBranchMat);
  }

  // count rendered triangles once for the log
  let tris = 0;
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const count = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
    tris += (count / 3) * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1);
  });
  stats.triangles = Math.round(tris);

  const meta: ModuleMeta = {
    assetId: SITE_ID,
    geometrySource:
      'DESIGN_ONLY procedural forest tier: Poisson-like stem map, procedural Abies LOD1 branch-card crowns, hero Abies/Betula GLB from /assets/v2 (generated assets, not survey); layer ranges informed by local literature (L2), individuals are design geometry',
    geometryDate: '2026-11-10',
    coordinateStatus: 'DESIGN_ONLY',
    evidenceLevel: 'L4',
    license: 'CC BY-SA 4.0 (reference imagery) / project asset library'
  };

  const herbDensityToggle: THREE.Object3D[] = [mossMesh];
  const setQuality = (nextLow: boolean): void => {
    for (const obj of herbDensityToggle) obj.visible = !nextLow;
    trunkMesh.castShadow = !nextLow;
    for (const b of branchMeshes) b.castShadow = !nextLow;
  };

  const update = (dt: number, _camera: THREE.Camera): void => {
    wind.update(dt);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    group.clear();
    res.dispose();
  };

  return { group, meta, canopyGaps: GAPS.length, treeCount: plans.length, stats, anchors, poses, update, setQuality, dispose, resources: res };
}

/** Builds the forest site module for a host scene that owns lighting (no lights/sky added here). */
export async function buildForestSite(opts: { lowQuality?: boolean; heightAt: HeightFn; onProgress?: (done: number, total: number, label: string) => void }): Promise<ForestSiteModule> {
  const core = await buildCore({ lowQuality: opts.lowQuality === true, heightAt: opts.heightAt, onProgress: opts.onProgress });
  return {
    group: core.group,
    meta: core.meta,
    canopyGaps: core.canopyGaps,
    treeCount: core.treeCount,
    stats: core.stats,
    update: (dt, _elapsed, camera) => core.update(dt, camera),
    setQuality: core.setQuality,
    dispose: core.dispose
  };
}

/** Builds the forest world tier: own DESIGN_ONLY DEM, sky, sun + shadow map, poses and anchors. */
export async function createForestTier(opts: TierOptions): Promise<ForestTier> {
  const low = opts.lowQuality;
  const progress = opts.onProgress ?? (() => {});
  const core = await buildCore({ lowQuality: low, heightAt: forestDesignHeight, onProgress: progress });
  const group = core.group;

  const sunDir = new THREE.Vector3(-0.62, 0.58, 0.52).normalize();
  const sky = new SkySystem({ sunDir, lowQuality: low });
  sky.setCoverage(0.58);
  group.add(sky.group);

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.9);
  sun.position.copy(sunDir).multiplyScalar(180);
  sun.target.position.set(0, 38, 0);
  sun.castShadow = true;
  const shadowSize = low ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -78;
  sun.shadow.camera.right = 78;
  sun.shadow.camera.top = 78;
  sun.shadow.camera.bottom = -78;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  group.add(sun);
  group.add(sun.target);
  group.add(new THREE.HemisphereLight(0xd6e6f5, 0x7a7260, 1.35));
  group.add(new THREE.AmbientLight(0x7f8f7a, 0.38));
  const fill = new THREE.DirectionalLight(0xb2cde6, 0.8);
  fill.position.set(40, 22, 44);
  group.add(fill);

  const update = (dt: number, camera: THREE.PerspectiveCamera): void => {
    sky.update(dt, camera);
    core.update(dt, camera);
  };
  const dispose = (): void => {
    core.group.remove(sky.group);
    sky.dispose();
    core.dispose();
  };

  progress(7, 7, '森林样区就绪');
  return {
    id: 'site-forest',
    group,
    poses: core.poses,
    defaultPose: 'A',
    anchors: core.anchors,
    stats: core.stats,
    meta: core.meta,
    canopyGaps: core.canopyGaps,
    treeCount: core.treeCount,
    update,
    setQuality: core.setQuality,
    dispose
  };
}
