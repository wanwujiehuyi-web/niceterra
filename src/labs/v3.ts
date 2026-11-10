import * as THREE from 'three';
import { loadGLB, fitObject } from '../core/gltf';

// dev-only viewer for v3 asset candidates. Not part of the product surface.
const params = new URLSearchParams(location.search);
const only = params.get('only');
const limit = Number(params.get('limit') ?? 14);
const BASE = '/assets/v3/';

interface V3Asset {
  path: string;
  role: string;
  bytes: number;
  tris: number;
  bboxSizeM: number[];
  longestM: number;
  fit?: { targetSize: number; note?: string };
  evidenceLevel?: string;
  taskId?: string;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(Math.min(window.innerWidth, 1400), Math.min(window.innerHeight, 760), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141c24);
const camera = new THREE.PerspectiveCamera(38, renderer.domElement.width / renderer.domElement.height, 0.002, 6000);

scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x3a4232, 1.15));
const key = new THREE.DirectionalLight(0xfff2da, 2.4);
key.position.set(-4, 6, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fc0e0, 0.8);
fill.position.set(5, 2, -4);
scene.add(fill);

const grid = new THREE.GridHelper(60, 60, 0x35506a, 0x243646);
scene.add(grid);

const hud = document.getElementById('hud') as HTMLDivElement;
const log: string[] = [];
let loaded = 0;
let failed = 0;
let totalTris = 0;

const wrap = new THREE.Group();
scene.add(wrap);

async function main(): Promise<void> {
  const res = await fetch(BASE + 'MANIFEST.json');
  const man = (await res.json()) as { assets: V3Asset[] };
  let list = man.assets.slice();
  if (only) list = list.filter((a) => a.path.includes(only));
  list = list.slice(0, limit);
  hud.textContent = 'loading ' + list.length + ' v3 assets';
  const scaleRef = Math.max(...list.map((a) => a.fit ? a.fit.targetSize : a.longestM || 1), 1);
  const spacing = scaleRef * 1.35;
  let i = 0;
  for (const a of list) {
    try {
      const gltf = await loadGLB(BASE + a.path);
      const target = a.fit ? a.fit.targetSize : Math.max(...a.bboxSizeM);
      // GLBs are baked in metres; fitObject here is only a safety net for a 0.5 mm quantisation drift.
      fitObject(gltf.scene, { targetLongest: target, groundY: 0, castShadow: false, receiveShadow: false });
      gltf.scene.position.x = (i - (list.length - 1) / 2) * spacing;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) totalTris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      });
      wrap.add(gltf.scene);
      loaded++;
      log.push('OK   ' + a.path + ' L=' + a.evidenceLevel + ' ' + target + 'm');
    } catch (err) {
      failed++;
      log.push('FAIL ' + a.path + ' ' + String((err as Error).message).slice(0, 70));
    }
    i++;
  }
  hud.textContent = 'v3 asset lab (dev only, AI-generated, L4 visual reference)\nloaded=' + loaded + ' failed=' + failed + ' tris=' + Math.round(totalTris) + '\n' + log.slice(0, 16).join('\n');
  document.body.dataset.v3Lab = '1';
  document.body.dataset.v3Loaded = String(loaded);
  document.body.dataset.v3Failed = String(failed);
  document.body.dataset.v3Log = JSON.stringify(log);
  const width = list.length * spacing;
  if (list.length === 1) {
    camera.position.set(-scaleRef * 0.55, scaleRef * 0.85, scaleRef * 1.75);
    camera.lookAt(0, scaleRef * 0.45, 0);
  } else {
    camera.position.set(0, scaleRef * 0.8, width * 0.55 + scaleRef * 1.4);
    camera.lookAt(0, scaleRef * 0.35, 0);
  }
}

void main().catch((err) => {
  hud.textContent = 'v3 lab failed: ' + String((err as Error).message);
  document.body.dataset.v3Error = String((err as Error).message);
});

const clock = new THREE.Clock();
function tick(): void {
  wrap.rotation.y = Math.sin(clock.getElapsedTime() * 0.12) * 0.05;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
(window as unknown as { __v3lab: unknown }).__v3lab = {
  capture: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.9); },
  manifest: () => fetch(BASE + 'MANIFEST.json').then((r) => r.json()),
};
