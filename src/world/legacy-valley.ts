/**
 * Valley tier prototype scene: the Hailuogou valley floor with creek, forest
 * edges and hero props. Extracted from the P1 main.ts so the app shell can own
 * the renderer, camera and lifecycle.
 *
 * This is a scaffold tier. It is NOT the final Hailuogou site geometry: the
 * valley module from src/world/valley.ts replaces it once delivered.
 */

import * as THREE from 'three';
import { SkySystem } from '../core/sky';
import { buildTerrain } from './terrain';
import { createGroundMaterial } from './ground-material';
import { loadGLB, fitObject, countTriangles } from '../core/gltf';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface Anchor {
  id: string;
  label: string;
  kind: 'site' | 'object' | 'sample';
  position: THREE.Vector3;
  siteId?: string;
  routeId?: string;
  levelId?: string;
}

export interface ValleyStats {
  assetsLoaded: number;
  assetsFailed: number;
  assetTris: number;
  log: string[];
  cobbles: number;
}

export interface ValleyTier {
  group: THREE.Group;
  terrain: ReturnType<typeof buildTerrain>;
  sky: SkySystem;
  poses: Record<'A' | 'B' | 'C', CameraPose>;
  anchors: Anchor[];
  stats: ValleyStats;
  update: (dt: number, camera: THREE.PerspectiveCamera) => void;
  setQuality: (low: boolean) => void;
  dispose: () => void;
}

interface Placement {
  id: string;
  path: string;
  x: number;
  z: number;
  size: number;
  yaw?: number;
  count?: number;
  /** Sink the fitted object by this fraction of its size (large cliff chunks). */
  sink?: number;
  shadow?: boolean;
}

const POSES: Record<'A' | 'B' | 'C', CameraPose> = {
  // CAM-HLG-A: eye height on the valley floor, channel in the lower third.
  A: { position: [0.15, 1.5, 14], target: [0.9, 4.2, -70] },
  // CAM-HLG-B: creek-level view along the stepped bed.
  B: { position: [3.4, 1.05, 6], target: [-0.6, 2.2, -48] },
  // CAM-HLG-C: looking up-valley toward the massif (view direction only; the
  // massif module owns the geometry and the DEM-derived sightline).
  C: { position: [-1.2, 2.2, 2], target: [2.0, 26, -150] }
};

const HERO_PLACEMENTS: Placement[] = [
  { id: 'rock-hlg-01', path: 'r10/r10-wet-mossy-boulder.glb', x: 1.15, z: 8.6, size: 2.4, yaw: 2.1 },
  { id: 'log-hlg-01', path: 'r10/r10-mossy-fallen-log.glb', x: -2.6, z: -5.5, size: 2.0, yaw: 0.7 },
  { id: 'flowers-hlg-01', path: 'r10/r10-alpine-wildflowers.glb', x: -1.9, z: 3.2, size: 0.6, count: 3, shadow: false },
  { id: 'fir-hlg-01', path: 'r10/r10-fir-sapling.glb', x: 2.9, z: -13, size: 3.2 },
  { id: 'spruce-hlg-01', path: 'web/alpine-spruce.glb', x: -6.4, z: -18, size: 11 },
  { id: 'spruce-hlg-02', path: 'web/alpine-spruce.glb', x: 7.2, z: -26, size: 14, yaw: 1.1 },
  { id: 'spruce-hlg-03', path: 'web/alpine-spruce.glb', x: -9.5, z: -34, size: 9, yaw: 2.4 },
  { id: 'spruce-hlg-04', path: 'web/alpine-spruce.glb', x: 5.4, z: -14, size: 12, yaw: 0.4 },
  { id: 'spruce-hlg-05', path: 'web/alpine-spruce.glb', x: -12.5, z: -22, size: 15 },
  { id: 'birch-hlg-01', path: 'web/birch-v20.glb', x: 3.4, z: -7, size: 7.5, yaw: 1.7 },
  { id: 'birch-hlg-02', path: 'web/birch-v20.glb', x: -4.2, z: -11, size: 6.5 },
  { id: 'cliff-hlg-01', path: 'web/granite-cliff-v3.glb', x: -46, z: -104, size: 110, yaw: 0.9, sink: 0.34 }
];

const LOW_QUALITY_KEEP = new Set(['rock-hlg-01', 'log-hlg-01', 'fir-hlg-01', 'spruce-hlg-01', 'birch-hlg-01']);

/** Builds the valley tier. Terrain and ground materials are synchronous; GLB props stream in. */
export async function createValleyTier(options: { lowQuality?: boolean; onProgress?: (msg: string, frac: number) => void } = {}): Promise<ValleyTier> {
  const lowQuality = options.lowQuality ?? false;
  const progress = options.onProgress ?? (() => {});
  const group = new THREE.Group();
  group.name = 'tier-valley';

  const sunDir = new THREE.Vector3(-0.62, 0.58, 0.52).normalize();
  const sky = new SkySystem({ sunDir });
  group.add(sky.group);

  const sun = new THREE.DirectionalLight(0xfff0d0, 3.0);
  sun.position.copy(sunDir).multiplyScalar(200);
  sun.target.position.set(0, 0, -40);
  sun.castShadow = true;
  const shadowSize = lowQuality ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  group.add(sun.target);
  group.add(new THREE.HemisphereLight(0xbcd4e8, 0x4c5638, 0.55));

  progress('地形剖面与溪道', 0.05);
  const terrain = buildTerrain({ lowQuality });
  group.add(terrain.mesh);

  // --- water surface: ribbon along the channel, following the stepped profile.
  progress('水面与湿石', 0.2);
  const RIBBON_SEGMENTS = lowQuality ? 420 : 1200;
  const ribbonPositions = new Float32Array((RIBBON_SEGMENTS + 1) * 2 * 3);
  const ribbonUvs = new Float32Array((RIBBON_SEGMENTS + 1) * 2 * 2);
  const ribbonIndices: number[] = [];
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    const z = 32 - t * 300;
    const cx = terrain.channelX(z);
    const y = terrain.waterY(z) + 0.02;
    const halfW = 2.1 * (0.94 + 0.06 * Math.sin(z * 0.13));
    ribbonPositions[i * 6 + 0] = cx - halfW;
    ribbonPositions[i * 6 + 1] = y;
    ribbonPositions[i * 6 + 2] = z;
    ribbonPositions[i * 6 + 3] = cx + halfW;
    ribbonPositions[i * 6 + 4] = y;
    ribbonPositions[i * 6 + 5] = z;
    ribbonUvs[i * 4 + 0] = 0;
    ribbonUvs[i * 4 + 1] = t * 40;
    ribbonUvs[i * 4 + 2] = 1;
    ribbonUvs[i * 4 + 3] = t * 40;
    if (i < RIBBON_SEGMENTS) {
      const a = i * 2;
      ribbonIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3));
  ribbonGeo.setAttribute('uv', new THREE.BufferAttribute(ribbonUvs, 2));
  ribbonGeo.setIndex(ribbonIndices);
  ribbonGeo.computeVertexNormals();
  const waterNormal = new THREE.TextureLoader().load('/textures/pbr/riverbed/normal.png');
  waterNormal.wrapS = THREE.RepeatWrapping;
  waterNormal.wrapT = THREE.RepeatWrapping;
  waterNormal.repeat.set(2, 60);
  const ribbonMat = new THREE.MeshPhysicalMaterial({
    color: 0x49808a,
    roughness: 0.14,
    metalness: 0,
    transparent: true,
    opacity: 0.8,
    envMapIntensity: 1.25,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    side: THREE.DoubleSide
  });
  const water = new THREE.Mesh(ribbonGeo, ribbonMat);
  water.name = 'valley-water';
  group.add(water);

  // --- creek cobbles: the water line needs something to read against.
  const cobbleCount = lowQuality ? 36 : 90;
  const cobbleGeo = new THREE.IcosahedronGeometry(1, lowQuality ? 2 : 3);
  const cobblePos = cobbleGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cobblePos.count; i++) {
    const x = cobblePos.getX(i);
    const y = cobblePos.getY(i);
    const z = cobblePos.getZ(i);
    const n = 1 + 0.26 * Math.sin(x * 4.1 + z * 3.7) + 0.16 * Math.cos(y * 5.3);
    cobblePos.setXYZ(i, x * n, y * n * 0.78, z * n);
  }
  cobbleGeo.computeVertexNormals();
  const cobbleMat = new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.9, envMapIntensity: 0.5 });
  const cobbles = new THREE.InstancedMesh(cobbleGeo, cobbleMat, cobbleCount);
  cobbles.castShadow = !lowQuality;
  cobbles.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placedCobbles = 0;
  let guard = 0;
  while (placedCobbles < cobbleCount && guard < 6000) {
    guard++;
    const z = 26 - Math.random() * 280;
    const cx = terrain.channelX(z);
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = cx + side * (0.5 + Math.random() * 6.5);
    const scale = 0.16 + Math.pow(Math.random(), 2.2) * 1.5;
    dummy.position.set(x, terrain.heightAt(x, z) + scale * 0.3, z);
    dummy.rotation.set(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.4);
    dummy.scale.set(scale * (0.85 + Math.random() * 0.5), scale * (0.55 + Math.random() * 0.5), scale * (0.85 + Math.random() * 0.5));
    dummy.updateMatrix();
    cobbles.setMatrixAt(placedCobbles, dummy.matrix);
    const shade = 0.62 + Math.random() * 0.5;
    tint.setRGB(shade, shade * 0.99, shade * 0.93);
    cobbles.setColorAt(placedCobbles, tint);
    placedCobbles++;
  }
  if (cobbles.instanceColor) cobbles.instanceColor.needsUpdate = true;
  group.add(cobbles);

  const stats: ValleyStats = { assetsLoaded: 0, assetsFailed: 0, assetTris: 0, log: [], cobbles: placedCobbles };

  // --- ground material (textures first, then the material swap).
  progress('地表材质', 0.32);
  const texLoader = new THREE.TextureLoader();
  const [turf, gravel, moss] = await Promise.all([
    texLoader.loadAsync('/textures/pbr/meadow/albedo.jpg'),
    texLoader.loadAsync('/textures/river_small_rocks-color.jpg'),
    texLoader.loadAsync('/textures/pbr/moss/albedo.jpg')
  ]);
  const groundMat = createGroundMaterial({ textures: { turf, gravel, moss }, waterY: terrain.waterY, channelDistance: terrain.channelDistance });
  const setWaterY = (groundMat.userData as { setWaterY?: (y: number) => void }).setWaterY;
  setWaterY?.(terrain.waterY(POSES.A.position[2] - 4));
  terrain.mesh.material = groundMat;

  // --- hero props.
  const placements = lowQuality ? HERO_PLACEMENTS.filter((p) => LOW_QUALITY_KEEP.has(p.id)) : HERO_PLACEMENTS;
  const cache = new Map<string, THREE.Object3D>();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    progress('近景资产 ' + (i + 1) + '/' + placements.length, 0.4 + 0.55 * (i / placements.length));
    try {
      if (!cache.has(p.path)) {
        const gltf = await loadGLB('/assets/v2/' + p.path);
        cache.set(p.path, gltf.scene);
      }
      const base = cache.get(p.path)!;
      const count = p.count ?? 1;
      for (let k = 0; k < count; k++) {
        const instance = k === 0 ? base.clone(true) : base.clone(true);
        const jitterX = k === 0 ? 0 : (k - 1) * 0.55 + Math.random() * 0.2;
        const jitterZ = k === 0 ? 0 : Math.random() * 0.6 - 0.3;
        instance.position.set(p.x + jitterX, 0, p.z + jitterZ);
        instance.rotation.y = p.yaw ?? Math.random() * Math.PI * 2;
        fitObject(instance, {
          targetLongest: p.size,
          groundY: terrain.heightAt(p.x + jitterX, p.z + jitterZ),
          castShadow: p.shadow !== false && p.size < 20,
          receiveShadow: true
        });
        if (p.sink) instance.position.y -= p.size * p.sink;
        instance.name = p.id + (k > 0 ? '-' + k : '');
        stats.assetTris += countTriangles(instance);
        group.add(instance);
      }
      stats.assetsLoaded++;
      stats.log.push('OK ' + p.path + ' @' + p.x + ',' + p.z + ' size=' + p.size);
    } catch (err) {
      stats.assetsFailed++;
      stats.log.push('FAIL ' + p.path + ' ' + String((err as Error).message).slice(0, 80));
    }
  }

  // Anchors are local coordinates inside the design tile (DESIGN_ONLY) except
  // the forest sample, which is lifted from the public GGFZH01 plot metadata.
  const anchors: Anchor[] = [
    { id: 'anchor-stream', label: '林溪与湿石', kind: 'site', position: new THREE.Vector3(0.4, 1.1, 2.0), siteId: 'SITE-HLG-STREAM-01', routeId: 'HLG-STREAM-BIOFILM-01' },
    { id: 'anchor-rock', label: '湿溪石 ROCK-HLG-01', kind: 'sample', position: new THREE.Vector3(1.15, 0.75, 8.6), siteId: 'SITE-HLG-STREAM-01', routeId: 'HLG-STREAM-BIOFILM-01', levelId: 'wet-rock' },
    { id: 'anchor-forest', label: '峨眉冷杉成熟林', kind: 'site', position: new THREE.Vector3(-6.4, 2.2, -18), siteId: 'SITE-HLG-FOREST-01', routeId: 'HLG-MOSS-CHLOROPLAST-01' },
    { id: 'anchor-glacier', label: '冰舌与表碛（远景方向）', kind: 'site', position: new THREE.Vector3(5.0, 16, -150), siteId: 'SITE-HLG-GLACIER-01', routeId: 'HLG-DEBRIS-MICROBE-01' },
    { id: 'anchor-chrono', label: '冰川退缩迹地', kind: 'site', position: new THREE.Vector3(-14, 3.4, -62), siteId: 'SITE-HLG-CHRONO-01', routeId: 'HLG-CHRONO-P-01' }
  ];

  let elapsed = 0;
  const update = (dt: number, camera: THREE.PerspectiveCamera): void => {
    elapsed += dt;
    sky.update(dt, camera);
    // Gentle respawn of the water normal offset so the creek reads as flowing.
    waterNormal.offset.y = (elapsed * 0.045) % 1;
  };

  const setQuality = (low: boolean): void => {
    sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  };

  const dispose = (): void => {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    terrain.dispose();
    sky.dispose();
  };

  return { group, terrain, sky, poses: POSES, anchors, stats, update, setQuality, dispose };
}
