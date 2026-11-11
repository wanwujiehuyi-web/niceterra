
import * as THREE from 'three';
import { countTriangles, fitObject, loadGLB } from '../core/gltf';

/** Height sampler supplied by the host scene (render space: x = east metres, z = -north metres). */
export type HeightFn = (x: number, z: number) => number;

export const ASSET_ROOT = '/assets/v2/';
export const TEX_ROOT = '/textures/';

/** Only the v2 r7/r10 library entries used by the forest + stream sites. */
export const ASSETS = {
  abies: ASSET_ROOT + 'web/r7-abies-fabri.glb',
  betula: ASSET_ROOT + 'web/r7-betula-insignis.glb',
  sorbus: ASSET_ROOT + 'web/r7-sorbus-hemsleyana.glb',
  fargesia: ASSET_ROOT + 'web/r7-fargesia-bamboo.glb',
  boulder: ASSET_ROOT + 'r10/r10-wet-mossy-boulder.glb',
  fallenLog: ASSET_ROOT + 'r10/r10-mossy-fallen-log.glb',
  biofilmRock: ASSET_ROOT + 'web/r7-biofilm-rock.glb',
  wetRockAholo: '/assets/aholo/stream-wetrock-01-web.glb',
  mossyLogAholo: '/assets/aholo/mossy-fallen-log-01-web.glb',
  underwaterStone: ASSET_ROOT + 'web/underwater-stone-v9.glb',
  mossMat: ASSET_ROOT + 'web/r7-moss-mat.glb',
  firSapling: ASSET_ROOT + 'r10/r10-fir-sapling.glb'
} as const;

export const TEX = {
  groundColor: TEX_ROOT + 'forest_ground_04-color.jpg',
  groundNormal: TEX_ROOT + 'forest_ground_04-normal.jpg',
  groundRough: TEX_ROOT + 'forest_ground_04-roughness.jpg',
  bark: TEX_ROOT + 'trees/spruce-bark.png',
  branchA: TEX_ROOT + 'trees/spruce-branch-a.png',
  branchB: TEX_ROOT + 'trees/spruce-branch-b.png',
  branchC: TEX_ROOT + 'trees/spruce-branch-c.png',
  fern: TEX_ROOT + 'grass/fern-card.png',
  grass: TEX_ROOT + 'grass/grass-card.png',
  mossCard: TEX_ROOT + 'grass/moss-card.png',
  mossCarpet: TEX_ROOT + 'moss/moss-carpet.png',
  mossAlbedo: TEX_ROOT + 'pbr/moss/albedo.jpg',
  mossNormal: TEX_ROOT + 'pbr/moss/normal.png',
  graniteAlbedo: TEX_ROOT + 'pbr/granite/albedo.jpg',
  graniteNormal: TEX_ROOT + 'pbr/granite/normal.png',
  riverbedAlbedo: TEX_ROOT + 'pbr/riverbed/albedo.jpg',
  riverbedNormal: TEX_ROOT + 'pbr/riverbed/normal.png',
  riverbedRough: TEX_ROOT + 'pbr/riverbed/rough.jpg',
  daisy: TEX_ROOT + 'flowers/daisy-card.png',
  gentian: TEX_ROOT + 'flowers/gentian-card.png'
} as const;

// --------------------------------------------------------------------------------------
// deterministic randomness + noise
// --------------------------------------------------------------------------------------

export interface Rng {
  readonly seed: number;
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  sign(): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (items) => items[Math.floor(next() * items.length) % items.length],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1)
  };
}

export function hash2i(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function valueNoise2(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uz);
}

export function fbm2(x: number, z: number, octaves = 4, seed = 0): number {
  let value = 0;
  let amp = 0.5;
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise2(px, pz, seed + i * 17);
    const nx = 0.8 * px - 0.6 * pz;
    const nz = 0.6 * px + 0.8 * pz;
    px = nx * 2.03 + 11.3;
    pz = nz * 2.03 - 7.1;
    amp *= 0.5;
  }
  return value;
}

export interface SlopeInfo {
  dhdx: number;
  dhdz: number;
  /** rise / run (0 = flat, 1 = 45 degrees). */
  slope: number;
  /** downhill aspect in render space, x east / z south. */
  downX: number;
  downZ: number;
}

export function slopeInfo(heightAt: HeightFn, x: number, z: number, eps = 0.8): SlopeInfo {
  const dhdx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const dhdz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  const len = Math.hypot(dhdx, dhdz);
  return {
    dhdx,
    dhdz,
    slope: len,
    downX: len > 1e-6 ? -dhdx / len : 0,
    downZ: len > 1e-6 ? -dhdz / len : 0
  };
}

// --------------------------------------------------------------------------------------
// design stream line STREAM-HLG-01 (DESIGN_ONLY)
// --------------------------------------------------------------------------------------

/**
 * Nodes exactly as written in DESIGN_V2 #8.1, ENU metres (x east, y north).
 * DESIGN_ONLY: the real stream segment is not selected, so the geographic anchor is UNKNOWN.
 */
export const STREAM_DESIGN_NODES_ENU: ReadonlyArray<readonly [number, number]> = [
  [42, -60],
  [36, -38],
  [32, -24],
  [30, -16],
  [28, 0],
  [34, 22],
  [40, 44],
  [44, 60]
];

/** Same polyline in render coordinates (x = east, z = -north). */
export const STREAM_RENDER_POINTS: ReadonlyArray<readonly [number, number]> = STREAM_DESIGN_NODES_ENU.map(
  ([east, north]) => [east, -north] as const
);

/** Mean low-flow water width used by the design channel (metres, half width). */
export const STREAM_HALF_WIDTH = 2.05;
/** Outer edge of the design channel where it blends back into the host terrain. */
export const STREAM_BANK_REACH = 5.4;
/** Maximum design incision below the local bank height. */
export const STREAM_CARVE_DEPTH = 0.9;

export interface NearestStream {
  /** distance to the design centre line, metres. */
  dist: number;
  /** normalised position along the design polyline (0 at node 1, 1 at node 8). */
  t: number;
  /** closest point on the centre line (render space). */
  x: number;
  z: number;
  /** unit tangent in design-node order. */
  tx: number;
  tz: number;
}

/** Distance to the design stream polyline; used by both sites so their ground agrees. */
export function nearestStream(px: number, pz: number): NearestStream {
  const pts = STREAM_RENDER_POINTS;
  let bestDist = Infinity;
  let bestT = 0;
  let bestX = pts[0][0];
  let bestZ = pts[0][1];
  let bestTx = 0;
  let bestTz = 1;
  let travelled = 0;
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(len);
    total += len;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const u = len2 > 0 ? THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1) : 0;
    const cx = ax + dx * u;
    const cz = az + dz * u;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < bestDist) {
      bestDist = d;
      bestT = total > 0 ? (travelled + segs[i] * u) / total : 0;
      bestX = cx;
      bestZ = cz;
      const l = Math.hypot(dx, dz) || 1;
      bestTx = dx / l;
      bestTz = dz / l;
    }
    travelled += segs[i];
  }
  return { dist: bestDist, t: bestT, x: bestX, z: bestZ, tx: bestTx, tz: bestTz };
}

/** Design incision profile: full depth across the low-flow bed, tapering to 0 at the bank reach. */
export function streamChannelDepth(dist: number): number {
  if (dist >= STREAM_BANK_REACH) return 0;
  const inner = STREAM_HALF_WIDTH * 0.25;
  const u = THREE.MathUtils.clamp((dist - inner) / (STREAM_BANK_REACH - inner), 0, 1);
  const s = u * u * (3 - 2 * u);
  return STREAM_CARVE_DEPTH * (1 - s);
}

/**
 * Helper for host terrain integration: carve the DESIGN_ONLY stream channel into an existing DEM.
 * The lab DEM already includes this; a host terrain that does not will make the stream water float.
 */
export function carvedStreamHeight(heightAt: HeightFn, x: number, z: number): number {
  const s = nearestStream(x, z);
  return heightAt(x, z) - streamChannelDepth(s.dist);
}

// --------------------------------------------------------------------------------------
// texture + GLB asset helpers
// --------------------------------------------------------------------------------------

interface TextureOptions {
  srgb?: boolean;
  repeat?: [number, number];
  wrap?: boolean;
  anisotropy?: number;
}

const textureCache = new Map<string, Promise<THREE.Texture>>();

export function loadTexture(url: string, opts: TextureOptions = {}): Promise<THREE.Texture> {
  const srgb = opts.srgb ?? true;
  const key = url + '|' + (srgb ? 'srgb' : 'data');
  let request = textureCache.get(key);
  if (!request) {
    request = new THREE.TextureLoader().loadAsync(url).then((tex) => {
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    });
    textureCache.set(key, request);
  }
  const base = request.then((tex) => tex.clone());
  return base.then((tex) => {
    const wrap = opts.wrap ?? true;
    tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.repeat.set(opts.repeat?.[0] ?? 1, opts.repeat?.[1] ?? 1);
    if (opts.anisotropy) tex.anisotropy = opts.anisotropy;
    tex.needsUpdate = true;
    return tex;
  });
}

const templateCache = new Map<string, Promise<THREE.Object3D>>();

/** Loads one GLB scene and keeps it as a prototype so multiple instances share GPU memory. */
export function loadTemplate(url: string): Promise<THREE.Object3D> {
  let request = templateCache.get(url);
  if (!request) {
    request = loadGLB(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
    templateCache.set(url, request);
  }
  return request;
}

export interface InstanceOptions {
  targetLongest: number;
  groundY?: number;
  yaw?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface AssetInstance {
  object: THREE.Object3D;
  triangles: number;
}

/**
 * Clones a prototype GLB, fits it to a real metre length (GLB interiors are not metres) and
 * drops its bounding box onto local y = 0 so the caller can place it with a wrapper group.
 */
export async function instantiateAsset(url: string, opts: InstanceOptions): Promise<AssetInstance> {
  const source = await loadTemplate(url);
  const object = source.clone(true);
  fitObject(object, {
    targetLongest: opts.targetLongest,
    groundY: opts.groundY ?? 0,
    yaw: opts.yaw,
    castShadow: opts.castShadow ?? true,
    receiveShadow: opts.receiveShadow ?? true
  });
  object.updateMatrixWorld(true);
  return { object, triangles: countTriangles(object) };
}

export function shadowize(root: THREE.Object3D, cast: boolean, receive: boolean): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
  });
}

// --------------------------------------------------------------------------------------
// resource bookkeeping (site-owned resources only; shared prototypes are never disposed here)
// --------------------------------------------------------------------------------------

export class SiteResources {
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly materials = new Set<THREE.Material>();
  readonly textures = new Set<THREE.Texture>();

  geometry<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.add(geo);
    return geo;
  }

  material<T extends THREE.Material>(mat: T): T {
    this.materials.add(mat);
    return mat;
  }

  texture<T extends THREE.Texture>(tex: T): T {
    this.textures.add(tex);
    return tex;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

// --------------------------------------------------------------------------------------
// card geometry + materials + wind
// --------------------------------------------------------------------------------------

/** Horizontal branch card: length runs +x from the branch base, width spans z. Pivot at the trunk. */
export function horizontalCardGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0.5, 0, 0);
  return geo;
}

/** Vertical blade card: base at y = 0, centred in x, facing +z. */
export function verticalCardGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  return geo;
}

export interface WindSystem {
  readonly time: THREE.IUniform<number>;
  update(dt: number): void;
  /**
   * Adds a two-level sway to a material's vertex shader. 'branch' sways horizontally by distance
   * from the branch base; 'blade' sways by height. Instanced meshes additionally get a per-instance
   * phase from the instance origin so a whole stand never moves in lockstep.
   */
  apply(material: THREE.Material, kind: 'branch' | 'blade', amplitude: number, speed?: number): void;
}

let windMaterialId = 0;

export function createWind(): WindSystem {
  const time: THREE.IUniform<number> = { value: 0 };
  return {
    time,
    update(dt: number): void {
      time.value += dt;
    },
    apply(material: THREE.Material, kind: 'branch' | 'blade', amplitude: number, speed = 1): void {
      const standard = material as THREE.MeshStandardMaterial;
      const weight = kind === 'branch' ? 'float wq = transformed.x * transformed.x;' : 'float wq = max(transformed.y, 0.0);';
      const amp = amplitude.toFixed(4);
      const spd = speed.toFixed(3);
      const cacheKey = 'site-wind-' + windMaterialId++;
      standard.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = time;
        shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            '#ifdef USE_INSTANCING',
            '  vec2 windPhase = instanceMatrix[3].xz;',
            '#else',
            '  vec2 windPhase = vec2(0.0);',
            '#endif',
            '  float windSway = sin(uWindTime * ' + spd + ' + windPhase.x * 0.53 + windPhase.y * 0.37);',
            '  float windGust = 0.6 + 0.4 * sin(uWindTime * 0.19 + windPhase.x * 0.061 + windPhase.y * 0.043);',
            '  ' + weight,
            '  transformed.x += windSway * ' + amp + ' * windGust * wq;',
            '  transformed.z += cos(uWindTime * ' + (speed * 0.83).toFixed(3) + ' + windPhase.y * 0.71) * ' + (amplitude * 0.55).toFixed(4) + ' * windGust * wq;'
          ].join('\n')
        );
      };
      standard.customProgramCacheKey = () => cacheKey;
      standard.needsUpdate = true;
    }
  };
}

export interface CardMaterialOptions {
  texture: THREE.Texture;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  alphaTest?: number;
  transparent?: boolean;
  side?: THREE.Side;
  emissive?: THREE.ColorRepresentation;
}

export function makeCardMaterial(opts: CardMaterialOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: opts.texture,
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 0.82,
    metalness: 0,
    side: opts.side ?? THREE.DoubleSide,
    transparent: opts.transparent ?? false,
    alphaTest: opts.alphaTest ?? 0.38,
    depthWrite: true,
    emissive: opts.emissive ?? 0x000000
  });
  mat.alphaToCoverage = true;
  mat.envMapIntensity = 0.55;
  return mat;
}

// --------------------------------------------------------------------------------------
// procedural canvas textures (no AI imagery, no external assets)
// --------------------------------------------------------------------------------------

export function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Bamboo/fargesia leaf spray card: a few lanceolate leaves on a thin twig. */
export function makeBambooLeafTexture(seed = 41): THREE.CanvasTexture {
  const rng = makeRng(seed);
  return canvasTexture(256, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(96,108,52,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.98);
    ctx.quadraticCurveTo(size * 0.46, size * 0.55, size * 0.52, size * 0.16);
    ctx.stroke();
    for (let i = 0; i < 9; i++) {
      const t = 0.18 + i * 0.085;
      const side = i % 2 === 0 ? 1 : -1;
      const bx = size * 0.5 + side * 2;
      const by = size * (1 - t);
      const len = size * rng.range(0.17, 0.3);
      const wid = size * rng.range(0.026, 0.045);
      const angle = side > 0 ? rng.range(-0.95, -0.35) : rng.range(0.35, 0.95);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(angle);
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgb(74,96,44)');
      grad.addColorStop(0.55, 'rgb(104,132,58)');
      grad.addColorStop(1, 'rgb(128,152,72)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.55, -wid, len, 0);
      ctx.quadraticCurveTo(len * 0.55, wid, 0, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,78,36,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(len * 0.08, 0);
      ctx.lineTo(len * 0.94, 0);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** Broadleaf understory herb card (morphotype only; no species name is implied). */
export function makeBroadleafTexture(seed = 71): THREE.CanvasTexture {
  const rng = makeRng(seed);
  return canvasTexture(256, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(72,88,44,0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size);
    ctx.quadraticCurveTo(size * 0.46, size * 0.5, size * 0.54, size * 0.1);
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const t = 0.12 + i * 0.12;
      const side = i % 2 === 0 ? 1 : -1;
      const baseX = size * (0.5 + side * 0.02);
      const baseY = size * (1 - t);
      const len = size * rng.range(0.16, 0.27);
      const width = size * rng.range(0.055, 0.085);
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.rotate(side > 0 ? rng.range(-1.15, -0.45) : rng.range(0.45, 1.15));
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgb(52,74,36)');
      grad.addColorStop(0.6, 'rgb(86,120,52)');
      grad.addColorStop(1, 'rgb(118,148,70)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.45, -width, len, 0);
      ctx.quadraticCurveTo(len * 0.45, width, 0, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(132,158,86,0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(len * 0.06, 0);
      ctx.lineTo(len * 0.9, 0);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** Transparent white foam spray used for contact rings and wakes. */
export function makeFoamTexture(seed = 19): THREE.CanvasTexture {
  const rng = makeRng(seed);
  return canvasTexture(256, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    const blob = (cx: number, cy: number, r: number, alpha: number): void => {
      for (let ox = -size; ox <= size; ox += size) {
        for (let oy = -size; oy <= size; oy += size) {
          const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
          grad.addColorStop(0, 'rgba(255,255,255,' + alpha.toFixed(3) + ')');
          grad.addColorStop(0.55, 'rgba(255,255,255,' + (alpha * 0.6).toFixed(3) + ')');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    for (let i = 0; i < 90; i++) {
      blob(rng.range(0, size), rng.range(0, size), rng.range(4, 22), rng.range(0.25, 0.85));
    }
  });
}

/** Sample-frame marker card for ROCK-HLG-01 (PLANNED). */
export function makeSampleFrameTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(120,240,255,0.95)';
    ctx.lineWidth = 5;
    ctx.setLineDash([22, 12]);
    ctx.strokeRect(14, 14, size - 28, size - 28);
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    const tick = 24;
    const corners: Array<[number, number, number, number]> = [
      [14, 14, 1, 1],
      [size - 14, 14, -1, 1],
      [14, size - 14, 1, -1],
      [size - 14, size - 14, -1, -1]
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * tick, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * tick);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,240,255,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2 - 16, size / 2);
    ctx.lineTo(size / 2 + 16, size / 2);
    ctx.moveTo(size / 2, size / 2 - 16);
    ctx.lineTo(size / 2, size / 2 + 16);
    ctx.stroke();
  });
}

// --------------------------------------------------------------------------------------
// rock geometry
// --------------------------------------------------------------------------------------

/** Low-poly mossy rock: displaced icosahedron with a green top and grey flanks baked to vertex colour. */
export function makeMossyRockGeometry(seed: number, detail = 1, moss = 0.65): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const rng = makeRng(seed);
  const sx = rng.range(0.8, 1.25);
  const sy = rng.range(0.55, 0.95);
  const sz = rng.range(0.8, 1.25);
  const offset = new THREE.Vector3(rng.range(-0.2, 0.2), rng.range(-0.2, 0.2), rng.range(-0.2, 0.2));
  const mossColor = new THREE.Color(0x4d6b2b);
  const rockColor = new THREE.Color(0x6b6660);
  const darkColor = new THREE.Color(0x3f3c37);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * sx;
    const y = pos.getY(i) * sy;
    const z = pos.getZ(i) * sz;
    const warp = 0.16 * (valueNoise2(x * 2.3 + seed, z * 2.3, seed) - 0.5) + 0.1 * (valueNoise2(y * 5.1, x * 5.1, seed + 3) - 0.5);
    pos.setXYZ(i, x + offset.x + warp, y + offset.y + warp * 0.6, z + offset.z + warp);
    const ny = normals.getY(i);
    const top = THREE.MathUtils.smoothstep(ny, 0.15, 0.85);
    const speck = valueNoise2(x * 9.0 + 2, z * 9.0, seed + 11);
    const mossMask = THREE.MathUtils.clamp(top * moss + (speck - 0.5) * 0.45, 0, 1);
    const c = rockColor.clone().lerp(darkColor, valueNoise2(x * 3.0, z * 3.0, seed + 5) * 0.5);
    c.lerp(mossColor, mossMask);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Two or three vertical cards crossed around the Y axis; base at y = 0, each card is a unit square. */
export function crossCardGeometry(planes = 2, twist = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let p = 0; p < planes; p++) {
    const angle = twist + (p * Math.PI) / planes;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const nx = -dz;
    const nz = dx;
    const base = positions.length / 3;
    const corners: Array<[number, number]> = [
      [-0.5, 0],
      [0.5, 0],
      [0.5, 1],
      [-0.5, 1]
    ];
    for (const [ox, oy] of corners) {
      positions.push(ox * dx, oy, ox * dz);
      normals.push(nx, 0, nz);
      uvs.push(ox + 0.5, oy);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/** Terrain normal at a point (render space, y up). */
export function groundNormal(heightAt: HeightFn, x: number, z: number, eps = 0.7): THREE.Vector3 {
  const dhdx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const dhdz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  return new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
}

/** Applies a per-instance matrix + colour to an InstancedMesh. */
export function commitInstances(
  mesh: THREE.InstancedMesh,
  matrices: readonly THREE.Matrix4[],
  colors?: readonly THREE.Color[]
): void {
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
    if (colors) mesh.setColorAt(i, colors[i]);
  }
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
}

/** Small helper to compose a TRS matrix without allocating temporaries at call sites. */
export function trs(
  x: number,
  y: number,
  z: number,
  yaw: number,
  tiltX: number,
  tiltZ: number,
  sx: number,
  sy: number,
  sz: number
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}
