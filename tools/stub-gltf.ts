/**
 * Test-only stand-in for src/core/gltf.ts.
 * The headless smoke test has no image decoder, so real GLB parsing hangs.
 * Swapping in this stub isolates tier *construction* (geometry, poses, anchors,
 * dispose) from asset fidelity. Real GLB loading stays NOT_RUN here and must be
 * verified in a browser.
 */
import * as THREE from 'three';

export async function loadGLB(url: string): Promise<any> {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x556644 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'stub:' + url;
  group.add(mesh);
  return { scene: group, scenes: [group], animations: [], cameras: [], asset: { generator: 'stub' }, parser: {} };
}

export interface FitOptions {
  targetLongest: number;
  groundY?: number;
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
  return scale;
}

export function countTriangles(object: THREE.Object3D): number {
  let tris = 0;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const count = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0;
    tris += count / 3;
  });
  return Math.round(tris);
}
