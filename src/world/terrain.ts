import * as THREE from 'three';

export interface TerrainOptions {
  seed?: number;
  lowQuality?: boolean;
}

export interface TerrainBundle {
  mesh: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
  /** Distance from the river centre line, in metres. */
  channelDistance: (x: number, z: number) => number;
  channelX: (z: number) => number;
  /** Water surface height at a given z (follows the stepped long profile). */
  waterY: (z: number) => number;
  /** Bed height mid-channel at a given z. */
  bedY: (z: number) => number;
  /** Longitudinal profile samples for verification (z, bed elevation). */
  profile: Array<{ z: number; bed: number; water: number; drop: number }>;
  dispose: () => void;
}

const CHANNEL_HALF_WIDTH = 2.1;   // 4.2 m wetted channel: a real mountain creek
const BANK_SLOPE = 0.55;
const BANK_ROLL = 26;             // metres before the valley wall takes over

// Step pools: hard, physical drops in the long profile (z, drop in metres, pool length)
const STEPS: Array<{ z: number; drop: number }> = [
  { z: -6, drop: 0.42 }, { z: -16, drop: 0.66 }, { z: -27, drop: 0.35 },
  { z: -39, drop: 0.82 }, { z: -52, drop: 0.48 }, { z: -66, drop: 0.71 },
  { z: -82, drop: 0.55 }, { z: -101, drop: 0.92 }, { z: -124, drop: 0.63 },
  { z: -150, drop: 0.78 }, { z: -182, drop: 0.44 }, { z: -220, drop: 0.86 }
];

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, z: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    v += amp * smoothNoise(fx, fz);
    fx = fx * 2.03 + 13.7;
    fz = fz * 1.97 - 7.3;
    amp *= 0.5;
  }
  return v;
}

/** Long profile: the absolute elevation of the water surface at z. */
function waterProfile(z: number): number {
  let y = -0.10 - z * 0.0115;
  for (const s of STEPS) {
    // upstream (z < s.z) sits higher by the drop; smooth over 2.4 m
    y += s.drop * (1 - smoothstep01((z - (s.z - 1.2)) / 2.4));
  }
  // gentle riffle undulation between steps
  y += Math.sin(z * 0.21) * 0.03;
  return y;
}

function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function channelX(z: number): number {
  return 3.0 * Math.sin(z * 0.020) + 1.35 * Math.sin(z * 0.057 + 1.1);
}

function waterY(z: number): number {
  return waterProfile(z);
}

function bedY(z: number): number {
  // pools are ~0.55 m deep, riffles ~0.16 m
  const pool = smoothNoise(z * 0.09, 4.2);
  return waterProfile(z) - 0.16 - pool * 0.42;
}

function heightAt(x: number, z: number): number {
  const cx = channelX(z);
  const d = Math.abs(x - cx);
  const w = waterY(z);
  const bed = bedY(z);

  if (d < CHANNEL_HALF_WIDTH) {
    // parabolic bed cross-section with gravel bars
    const t = d / CHANNEL_HALF_WIDTH;
    const bar = smoothNoise(x * 0.7 + 11, z * 0.7) * 0.09;
    return bed + (w - bed) * t * t + bar;
  }

  const bankT = Math.min(1, (d - CHANNEL_HALF_WIDTH) / BANK_ROLL);
  const bankH = (d - CHANNEL_HALF_WIDTH) * BANK_SLOPE;
  const roll = (fbm(x * 0.035, z * 0.035, 4) - 0.5) * 3.2 * bankT;
  const hummock = (fbm(x * 0.16, z * 0.16, 3) - 0.5) * 0.5 * bankT;
  // valley wall beyond ~BANK_ROLL, rising toward the ridge
  const wall = Math.max(0, d - BANK_ROLL) * 0.42;
  const wallNoise = (fbm(x * 0.012 + 5, z * 0.012, 4) - 0.5) * 26 * Math.min(1, wall / 40);
  return w + bankH + roll + hummock + wall + wallNoise;
}

function channelDistance(x: number, z: number): number {
  return Math.abs(x - channelX(z));
}

export function buildTerrain(opts: TerrainOptions = {}): TerrainBundle {
  const low = opts.lowQuality ?? false;
  const width = 700;
  const depth = 1500;
  const segX = low ? 220 : 520;
  const segZ = low ? 480 : 1150;

  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -depth * 0.5 + 120);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const bankAttr = new Float32Array(pos.count);
  const meadow = new THREE.Color(0x5e7440);
  const gravel = new THREE.Color(0x8d8676);
  const wetRock = new THREE.Color(0x4c5148);
  const forestFloor = new THREE.Color(0x3b4a30);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    const d = channelDistance(x, z);
    bankAttr[i] = d;
    const slope = Math.abs(heightAt(x + 1.2, z) - y) + Math.abs(heightAt(x, z + 1.2) - y);
    let col = tmp.copy(meadow);
    if (d < CHANNEL_HALF_WIDTH + 0.4) col.copy(gravel).lerp(wetRock, 0.35);
    else if (d < CHANNEL_HALF_WIDTH + 2.6) col.lerp(gravel, 0.62);
    else if (d < CHANNEL_HALF_WIDTH + 4.2) col.lerp(wetRock, 0.22);
    if (y > waterY(z) + 12) col.lerp(forestFloor, 0.55);
    if (slope > 1.1) col.lerp(gravel, 0.45);
    // patchy variation so the albedo is never flat
    const patch = 0.82 + fbm(x * 0.09 + 3, z * 0.09, 3) * 0.36;
    colors[i * 3] = col.r * patch;
    colors[i * 3 + 1] = col.g * patch;
    colors[i * 3 + 2] = col.b * patch;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aBank', new THREE.BufferAttribute(bankAttr, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.4
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'v2-terrain';

  const profile: TerrainBundle['profile'] = [];
  for (let z = 20; z > -260; z -= 1) {
    profile.push({ z, bed: bedY(z), water: waterY(z), drop: STEPS.some((s) => Math.abs(z - s.z) < 1.4) ? 1 : 0 });
  }

  return {
    mesh,
    heightAt,
    channelDistance,
    channelX,
    waterY,
    bedY,
    profile,
    dispose: () => { geo.dispose(); mat.dispose(); }
  };
}
