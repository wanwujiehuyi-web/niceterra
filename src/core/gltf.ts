import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Shared GLB loading for v2.
 *
 * V1 lesson: 82 concurrent GLB requests (2.4 GB of unoptimised meshes) exhausted the
 * renderer on the first frame. Every load in v2 goes through this queue, and every
 * asset is fitted from its own bounding box so placements are in real metres.
 */

const MAX_CONCURRENT_GLB = 4;

let gltfLoader: GLTFLoader | null = null;
let active = 0;
const waiting: Array<() => void> = [];

function loader(): GLTFLoader {
  if (gltfLoader) return gltfLoader;
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_GLB) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = waiting.shift();
  if (next) next();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function loadGLB(url: string, retries = 3): Promise<GLTF> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire();
    try {
      return await loader().loadAsync(url);
    } catch (err) {
      lastError = err;
    } finally {
      release();
    }
    if (attempt < retries) await sleep(350 * (attempt + 1) + Math.random() * 250);
  }
  throw lastError instanceof Error ? lastError : new Error('loadGLB failed: ' + url);
}

export interface FitOptions {
  /** Desired length of the longest axis, in metres (real-world scale). */
  targetLongest: number;
  /** Drop the object so its bounding-box bottom sits on this height. */
  groundY?: number;
  /** Extra yaw in radians. */
  yaw?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function fitObject(object: THREE.Object3D, opts: FitOptions): number {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = opts.targetLongest / longest;
  object.scale.setScalar(scale);
  if (opts.yaw) object.rotation.y = opts.yaw;
  object.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(object);
  if (opts.groundY !== undefined) object.position.y += opts.groundY - box2.min.y;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    const mat = mesh.material as THREE.Material | THREE.Material[];
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (m && 'envMapIntensity' in m) (m as THREE.MeshStandardMaterial).envMapIntensity = 0.55;
    }
  });
  return scale;
}

export function countTriangles(object: THREE.Object3D): number {
  let tris = 0;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position ? geometry.attributes.position.count : 0;
    tris += count / 3;
  });
  return Math.round(tris);
}
