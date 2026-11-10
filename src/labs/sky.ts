import * as THREE from 'three';
import { SkySystem } from '../core/sky';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null ? d : Number(v);
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 1.0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 20000);
const pitch = num('pitch', 6) * Math.PI / 180;
camera.position.set(0, 1.6, 0);
camera.lookAt(Math.sin(0) , Math.tan(pitch) * 100, -Math.cos(0) * 100);

const altitude = num('alt', 40) * Math.PI / 180;
const hour = num('hour', 14);
const az = -1.55 - ((hour - 12) / 12) * 0.9;
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(altitude), Math.sin(altitude), Math.cos(az) * Math.cos(altitude)).normalize();

const sky = new SkySystem({ sunDir });
sky.setCoverage(num('cov', 0.70));
scene.add(sky.group);

const sun = new THREE.DirectionalLight(0xfff1d2, 3.0);
sun.position.copy(sunDir).multiplyScalar(120);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd4e8, 0x54603c, 0.6));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ color: 0x5d6a45, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
scene.add(ground);

const hud = document.getElementById('hud') as HTMLDivElement;
hud.textContent = `sky lab (dev only)\nhour ${hour} alt ${(altitude * 180 / Math.PI).toFixed(0)}deg pitch ${(pitch * 180 / Math.PI).toFixed(0)}deg\ncov ${num('cov', 0.70).toFixed(2)} exp ${num('exp', 1.0).toFixed(2)}`;
document.body.dataset.skyLab = '1';

const clock = new THREE.Clock();
function tick(): void {
  sky.update(clock.getDelta(), camera);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
(window as unknown as { __sky: unknown }).__sky = {
  capture: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.9); }
};
