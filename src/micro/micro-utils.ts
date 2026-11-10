import * as THREE from 'three';

/**
 * Shared procedural toolkit for the HLG-STREAM-BIOFILM-01 micro route (route A).
 *
 * Design rules baked into this file:
 * - Geometry is built in "field units": 1 unit == the level's field of view. The level group
 *   is then scaled by fovMeters, so every mesh inside is real metre size and the camera can
 *   stay in metres. This is what lets a 0.4 nm layer and a 20 cm layer share one builder API.
 * - Nothing here loads assets; route-a.ts owns asset loading so disposal stays in one place.
 * - Colour/model helpers only produce declared schematic encodings (colour is never evidence).
 */

export type Vec3 = [number, number, number];

/** Deterministic PRNG (mulberry32). Same seed -> same geometry across reloads. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const randRange = (rng: () => number, min: number, max: number): number => min + (max - min) * rng();
export const randSign = (rng: () => number): number => (rng() < 0.5 ? -1 : 1);

/** Integer hash -> [0,1). Used by the value noise below. */
function hash3i(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [-1,1]. Cheap enough for per-vertex displacement. */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const sx = x + seed * 31.7;
  const sy = y + seed * 17.3;
  const sz = z + seed * 11.1;
  const xi = Math.floor(sx);
  const yi = Math.floor(sy);
  const zi = Math.floor(sz);
  const xf = sx - xi;
  const yf = sy - yi;
  const zf = sz - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3i(xi, yi, zi);
  const c100 = hash3i(xi + 1, yi, zi);
  const c010 = hash3i(xi, yi + 1, zi);
  const c110 = hash3i(xi + 1, yi + 1, zi);
  const c001 = hash3i(xi, yi, zi + 1);
  const c101 = hash3i(xi + 1, yi, zi + 1);
  const c011 = hash3i(xi, yi + 1, zi + 1);
  const c111 = hash3i(xi + 1, yi + 1, zi + 1);
  const x00 = lerp(c000, c100, u);
  const x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u);
  const x11 = lerp(c011, c111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

/** Fractal sum of value noise. */
export function fbm3(x: number, y: number, z: number, octaves = 4, seed = 0): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 13);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / (norm || 1);
}

export function disposeMaterial(material: THREE.Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key] as { isTexture?: boolean; dispose?: () => void } | undefined;
    if (value && typeof value === 'object' && value.isTexture === true && typeof value.dispose === 'function') {
      value.dispose();
    }
  }
  material.dispose();
}

/** Deep disposal for a level group: geometries, materials, textures, instanced buffers. */
export function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; dispose?: () => void };
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.isInstancedMesh && typeof mesh.dispose === 'function') mesh.dispose();
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
  });
  for (const material of materials) disposeMaterial(material);
}

export interface LightSetup {
  ambient?: number;
  hemi?: { sky: number; ground: number; intensity: number };
  key?: { color: number; intensity: number; position: Vec3 };
  fill?: { color: number; intensity: number; position: Vec3 };
  rim?: { color: number; intensity: number; position: Vec3 };
}

/** Adds the standard 3-point style rig used by the micro layers. */
export function addLights(group: THREE.Group, setup: LightSetup): void {
  if (setup.ambient !== undefined) group.add(new THREE.AmbientLight(0xffffff, setup.ambient));
  if (setup.hemi) {
    group.add(new THREE.HemisphereLight(setup.hemi.sky, setup.hemi.ground, setup.hemi.intensity));
  }
  if (setup.key) {
    const light = new THREE.DirectionalLight(setup.key.color, setup.key.intensity);
    light.position.set(setup.key.position[0], setup.key.position[1], setup.key.position[2]);
    group.add(light);
  }
  if (setup.fill) {
    const light = new THREE.DirectionalLight(setup.fill.color, setup.fill.intensity);
    light.position.set(setup.fill.position[0], setup.fill.position[1], setup.fill.position[2]);
    group.add(light);
  }
  if (setup.rim) {
    const light = new THREE.DirectionalLight(setup.rim.color, setup.rim.intensity);
    light.position.set(setup.rim.position[0], setup.rim.position[1], setup.rim.position[2]);
    group.add(light);
  }
}

/**
 * Watertight-ish displaced icosahedron. Displacement is a deterministic function of the
 * surface direction, so duplicated vertices of the non-indexed polyhedron stay together.
 */
export function displacedIcosahedron(
  radius: number,
  detail: number,
  rng: () => number,
  amplitude: number,
  flattenY = 1
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  const phase = rng() * 100;
  const direction = new THREE.Vector3();
  for (let i = 0; i < array.length; i += 3) {
    direction.set(array[i], array[i + 1], array[i + 2]).normalize();
    const d =
      1 +
      amplitude * fbm3(direction.x * 2.1 + phase, direction.y * 2.1, direction.z * 2.1, 3, 7) +
      0.35 * amplitude * (rng() - 0.5);
    array[i] = direction.x * radius * d;
    array[i + 1] = direction.y * radius * d * flattenY;
    array[i + 2] = direction.z * radius * d;
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Adds a mottled vertex-colour attribute (two-colour blend by fbm). */
export function vertexColorNoise(
  geometry: THREE.BufferGeometry,
  colorA: THREE.Color,
  colorB: THREE.Color,
  scale = 2.5,
  seed = 3
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  const colors = new Float32Array((array.length / 3) * 3);
  const tmp = new THREE.Color();
  for (let i = 0, j = 0; i < array.length; i += 3, j += 3) {
    const n = fbm3(array[i] * scale, array[i + 1] * scale, array[i + 2] * scale, 4, seed);
    const t = clamp01(0.5 + 0.55 * n);
    tmp.copy(colorA).lerp(colorB, t);
    colors[j] = tmp.r;
    colors[j + 1] = tmp.g;
    colors[j + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Catmull-Rom tube through points (local units). */
export function tubeGeometry(points: Vec3[], radius: number, radialSegments = 6, closed = false): THREE.TubeGeometry {
  const vectors = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(vectors, closed, 'catmullrom', 0.5);
  const segments = Math.max(8, Math.min(220, points.length * 7));
  return new THREE.TubeGeometry(curve, segments, radius, radialSegments, closed);
}

/** Random-walk path with momentum, used for EPS filaments and water channels. */
export function walkPath(
  start: Vec3,
  steps: number,
  stepLength: number,
  rng: () => number,
  spread = 0.5
): Vec3[] {
  const points: Vec3[] = [[start[0], start[1], start[2]]];
  let x = start[0];
  let y = start[1];
  let z = start[2];
  let dx = (rng() - 0.5) * spread * 2;
  let dy = (rng() - 0.5) * spread * 2 + 0.18;
  let dz = (rng() - 0.5) * spread * 2;
  for (let i = 0; i < steps; i++) {
    dx = dx * 0.72 + (rng() - 0.5) * spread;
    dy = dy * 0.72 + (rng() - 0.5) * spread;
    dz = dz * 0.72 + (rng() - 0.5) * spread;
    const len = Math.hypot(dx, dy, dz) || 1;
    x += (dx / len) * stepLength;
    y += (dy / len) * stepLength;
    z += (dz / len) * stepLength;
    if (y < -0.02) y = -0.02 + rng() * 0.05;
    points.push([x, y, z]);
  }
  return points;
}

/**
 * Lens / boat shape for pennate diatom valves: elliptical cross sections along z,
 * tapering to points at both ends. Closed surface, so raphe lines sit on top of it.
 */
export function lensGeometry(
  length: number,
  width: number,
  height: number,
  segU = 26,
  segV = 14
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * 2 - 1;
    const taper = Math.sqrt(Math.max(0, 1 - u * u));
    for (let j = 0; j < segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const x = Math.cos(v) * width * 0.5 * taper;
      const y = Math.sin(v) * height * 0.5 * taper;
      const z = (u * length) / 2;
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * segV + j;
      const b = i * segV + ((j + 1) % segV);
      const c = (i + 1) * segV + j;
      const d = (i + 1) * segV + ((j + 1) % segV);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface SpherePatch {
  geometry: THREE.BufferGeometry;
  /** Point on the patch surface for (u,v) in [-1,1]^2. */
  at: (u: number, v: number, target?: THREE.Vector3) => THREE.Vector3;
  /** Outward unit normal at (u,v). */
  normalAt: (u: number, v: number, target?: THREE.Vector3) => THREE.Vector3;
}

/**
 * A rectangular patch of a sphere, used for curvature-accurate valve-face fragments.
 * The patch is centred on +Y so a world-up camera looks straight at it.
 */
export function spherePatch(
  radius: number,
  halfAngleU: number,
  halfAngleV: number,
  segU = 26,
  segV = 26
): SpherePatch {
  const at = (u: number, v: number, target = new THREE.Vector3()): THREE.Vector3 => {
    const theta = u * halfAngleU;
    const phi = v * halfAngleV;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    return target.set(radius * st, radius * ct * Math.cos(phi), radius * ct * Math.sin(phi));
  };
  const normalAt = (u: number, v: number, target = new THREE.Vector3()): THREE.Vector3 =>
    at(u, v, target).normalize();

  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * 2 - 1;
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * 2 - 1;
      const p = at(u, v);
      positions.push(p.x, p.y, p.z);
    }
  }
  const stride = segV + 1;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, at, normalAt };
}

/** Builds an InstancedMesh from matrices, optionally with per-instance colours. */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  colors?: THREE.Color[]
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  mesh.count = matrices.length;
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  if (colors) {
    for (let i = 0; i < colors.length; i++) mesh.setColorAt(i, colors[i]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Matrix that maps +Y (local cylinder axis) onto the given direction. */
export function orientMatrix(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  scale = 1
): THREE.Matrix4 {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize()
  );
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
}

/** Cylinder between two points (for bonds and struts). */
export function cylinderBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 8
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, radialSegments, 1, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(a).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.scale.set(1, length, 1);
  return mesh;
}

/**
 * Draws a legend card (colour swatch + label) into a texture and returns a camera-facing sprite.
 * Legend colours are model encoding only; the labels say so.
 */
export function makeLegendSprite(
  entries: Array<{ color: number; text: string }>,
  title?: string
): THREE.Sprite {
  const width = 512;
  const rowHeight = 56;
  const height = 40 + rowHeight * entries.length + (title ? 44 : 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(8,12,16,0.82)';
    ctx.strokeStyle = 'rgba(210,216,208,0.45)';
    ctx.lineWidth = 2;
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(r, 1);
    ctx.arcTo(width - 1, 1, width - 1, height - 1, r);
    ctx.arcTo(width - 1, height - 1, 1, height - 1, r);
    ctx.arcTo(1, height - 1, 1, 1, r);
    ctx.arcTo(1, 1, width - 1, 1, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    let y = 30;
    if (title) {
      ctx.fillStyle = '#F6F6F4';
      ctx.font = '600 24px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
      ctx.fillText(title, 24, y + 6);
      y += 44;
    }
    for (const entry of entries) {
      ctx.beginPath();
      ctx.fillStyle = '#' + entry.color.toString(16).padStart(6, '0');
      ctx.arc(40, y + 6, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(246,246,244,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#D2D8D0';
      ctx.font = '22px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
      ctx.fillText(entry.text, 70, y + 14);
      y += rowHeight;
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.62, (0.62 * height) / width, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** Radial vignette texture for SEM/TEM backdrops. */
export function radialGradientTexture(inner: string, outer: string, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size * 0.62);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Human metric label (cm / mm / μm / nm / Å) for HUD scale bars. */
export function formatMeters(meters: number): string {
  const a = Math.abs(meters);
  const trim = (value: number): string => String(parseFloat(value.toPrecision(3)));
  if (a >= 1) return trim(meters) + ' m';
  if (a >= 1e-2) return trim(meters * 100) + ' cm';
  if (a >= 1e-3) return trim(meters * 1e3) + ' mm';
  if (a >= 1e-6) return trim(meters * 1e6) + ' μm';
  if (a >= 1e-9) return trim(meters * 1e9) + ' nm';
  return trim(meters * 1e10) + ' Å';
}

/** Copies a float array into a position attribute (helper for custom meshes). */
export function setPositions(geometry: THREE.BufferGeometry, values: number[]): void {
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  geometry.computeVertexNormals();
}
