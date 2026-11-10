import * as THREE from 'three';
import { loadGLB, fitObject } from '../core/gltf';

const params = new URLSearchParams(location.search);
const only = params.get('only');
const limit = Number(params.get('limit') ?? 12);
const BASE = '/assets/v2/';

interface ManifestAsset {
  path: string; role: string; bytes: number; tris: number;
  sizeM: number[] | null; longestM: number | null;
  fit?: { targetSize: number; note: string };
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(Math.min(window.innerWidth, 960), Math.min(window.innerHeight, 540), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141c24);
const camera = new THREE.PerspectiveCamera(38, renderer.domElement.width / renderer.domElement.height, 0.02, 4000);

scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x3a4232, 1.1));
const key = new THREE.DirectionalLight(0xfff2da, 2.6);
key.position.set(-4, 6, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fc0e0, 0.9);
fill.position.set(5, 2, -4);
scene.add(fill);

const grid = new THREE.GridHelper(200, 200, 0x35506a, 0x243646);
grid.position.y = -0.001;
scene.add(grid);

const hud = document.getElementById('hud') as HTMLDivElement;
const log: string[] = [];
let loaded = 0;
let failed = 0;
let totalTris = 0;

const wrap = new THREE.Group();
scene.add(wrap);

function normalize(object: THREE.Object3D, target: number): number {
  return fitObject(object, { targetLongest: target, groundY: 0, castShadow: false, receiveShadow: false });
}

async function main(): Promise<void> {
  const res = await fetch(BASE + 'MANIFEST.json');
  const man = await res.json() as { assets: ManifestAsset[] };
  let list = man.assets.filter((a) => a.fit || a.role.startsWith('hero-prop'));
  if (only) list = man.assets.filter((a) => a.path.includes(only));
  list = list.slice(0, limit);
  hud.textContent = 'loading ' + list.length + ' assets';
  const spacing = 2.6;
  let i = 0;
  for (const a of list) {
    try {
      const gltf = await loadGLB(BASE + a.path);
      const target = a.fit ? a.fit.targetSize : 1.6;
      normalize(gltf.scene, target);
      gltf.scene.position.x = (i - (list.length - 1) / 2) * spacing;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; totalTris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }
      });
      wrap.add(gltf.scene);
      loaded++;
      log.push('OK   ' + a.path + ' tris=' + a.tris + ' target=' + target + 'm');
    } catch (err) {
      failed++;
      log.push('FAIL ' + a.path + ' ' + String((err as Error).message).slice(0, 60));
    }
    i++;
  }
  hud.textContent = 'v2 asset lab (dev only)\nloaded=' + loaded + ' failed=' + failed + ' tris=' + Math.round(totalTris) + '\n' + log.slice(0, 14).join('\n');
  document.body.dataset.assetLab = '1';
  document.body.dataset.assetLoaded = String(loaded);
  document.body.dataset.assetFailed = String(failed);
  document.body.dataset.assetLog = JSON.stringify(log);
  const width = list.length * spacing;
  camera.position.set(0, 1.9, width * 0.85 + 2.2);
  camera.lookAt(0, 0.9, 0);
}
void main();

const clock = new THREE.Clock();
function tick(): void {
  const t = clock.getElapsedTime();
  wrap.rotation.y = Math.sin(t * 0.12) * 0.06;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
(window as unknown as { __lab: unknown }).__lab = {
  capture: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.9); },
  manifest: () => fetch(BASE + 'MANIFEST.json').then((r) => r.json())
};
