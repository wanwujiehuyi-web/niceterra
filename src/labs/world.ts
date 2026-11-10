/**
 * dev-only 自查页：远景 / 谷地 两个 WorldTier 的取景与取证。
 *
 *   /labs/world.html?only=far|valley|both&low=1&pose=A|B|C&layer=2026-11-10
 *
 * 这不是产品截图：HUD 固定标注「dev-only 非产品截图」。
 * window.__lab.capture() 返回 jpeg dataURL；canvas 固定 960×540（≤960×540 约束）。
 */

import * as THREE from 'three';
import { SkySystem } from '../core/sky';
import { createFarviewTier, type FarviewTier } from '../world/farview';
import { createValleyTier, type ValleyTier } from '../world/valley';

const W = 960;
const H = 540;
const params = new URLSearchParams(location.search);
const low = params.get('low') === '1';
const only: string = params.get('only') ?? params.get('tier') ?? 'both';
const poseId = (params.get('pose') ?? 'A').toUpperCase();
const layerDate = params.get('layer') ?? '2026-11-10';

const host = document.getElementById('stage') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, W / H, 2, 140000);

const sunDir = new THREE.Vector3(0.42, 0.55, 0.72).normalize();
const sky = new SkySystem({ sunDir, lowQuality: low });
sky.setCoverage(0.68);
scene.add(sky.group);

const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
sun.position.copy(sunDir).multiplyScalar(3000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xb8d3ea, 0x5b5245, 0.75));

type AnyTier = FarviewTier | ValleyTier;
let farview: FarviewTier | null = null;
let valley: ValleyTier | null = null;
let active: AnyTier | null = null;

let lookAt = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();

function applyPose(id: string): void {
  if (!active) return;
  const p = active.poses[id] ?? active.poses[active.defaultPose];
  if (!p) return;
  camPos.fromArray(p.position);
  camTarget.fromArray(p.target);
  camera.position.copy(camPos);
  lookAt.copy(camTarget);
  camera.lookAt(lookAt);
  if (active.id === 'far') camera.fov = 46;
  else camera.fov = 52;
  camera.updateProjectionMatrix();
}

function hudText(extra = ''): void {
  const lines: string[] = [];
  lines.push('NiceTerra v2 · world lab — dev-only 非产品截图');
  lines.push('canvas ' + W + '×' + H + ' · tier=' + (active ? active.id : 'none') + ' · low=' + (low ? '1' : '0') + ' · pose=' + poseId);
  if (active) {
    for (const l of (active as ValleyTier).hudLines?.() ?? []) lines.push(l);
  }
  if (typeof document !== 'undefined' && document.body.dataset.demSource) {
    lines.push('body.dataset.demSource = ' + document.body.dataset.demSource);
  }
  if (farview) {
    lines.push('LOD ' + farview.lod.level + ' · screenErr ' + farview.lod.screenErrorPx + 'px · camDist ' + farview.lod.cameraDistanceM + ' m · tris ' + farview.lod.triangles);
  }
  if (extra) lines.push(extra);
  hud.textContent = lines.join('\n');
}

async function build(): Promise<void> {
  try {
    if (only === 'far' || only === 'both') {
      farview = await createFarviewTier({ lowQuality: low });
      farview.group.visible = only === 'far';
      scene.add(farview.group);
    }
    if (only === 'valley' || only === 'both') {
      valley = await createValleyTier({ lowQuality: low });
      valley.group.visible = true; // 两种可见性在下面按 only 再裁定一次
      scene.add(valley.group);
    }
    active = only === 'far' ? farview : valley ?? farview;
    if (farview && active === farview) {
      farview.setLayerDate(layerDate);
      farview.group.visible = true;
      if (valley) valley.group.visible = false;
    } else if (valley) {
      valley.group.visible = true;
      if (farview) farview.group.visible = false;
    }
    applyPose(poseId);
    hudText();
    document.body.dataset.labReady = '1';
    document.body.dataset.tier = active ? active.id : 'none';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hud.textContent = 'LAB ERROR: ' + msg;
    document.body.dataset.labError = msg;
  }
}

const clock = new THREE.Clock();
function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (active) active.update(dt, camera);
  sky.update(dt, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

const lab = {
  ready: build().then(() => true),
  capture: (): string => {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.9);
  },
  setPose: (id: string): void => { applyPose(id.toUpperCase()); hudText(); },
  setLayerDate: (d: string): void => { farview?.setLayerDate(d); hudText(); },
  showFar: (): void => {
    if (farview) { farview.group.visible = true; active = farview; }
    if (valley) valley.group.visible = false;
    applyPose('A'); hudText();
  },
  showValley: (): void => {
    if (valley) { valley.group.visible = true; active = valley; }
    if (farview) farview.group.visible = false;
    applyPose('A'); hudText();
  },
  setQuality: (l: boolean): void => { farview?.setQuality(l); valley?.setQuality(l); hudText('quality=' + (l ? 'low' : 'high')); },
  lineOfSight: (): unknown => {
    if (!farview) return null;
    const r = farview.lineOfSight(
      { lon: 101.9886, lat: 29.5731, eyeM: farview.sampleHeight(farview.projector.toWorldXZ(101.9886, 29.5731).x, farview.projector.toWorldXZ(101.9886, 29.5731).z) + 1.7 },
      { lon: 101.8847, lat: 29.5953, altM: farview.meta.dem.demMaxElevM },
    );
    hudText('LOS to summit: visible=' + r.visible + ' maxTerr=' + r.maxTerrainElevAngleDeg + '° target=' + r.targetElevAngleDeg + '°');
    return r;
  },
  status: (): Record<string, unknown> => ({
    tier: active ? active.id : 'none',
    low,
    pose: poseId,
    farLod: farview ? farview.lod : null,
    demSource: typeof document !== 'undefined' ? document.body.dataset.demSource ?? '' : '',
    assets: active ? active.stats : null,
    canvas: [W, H],
  }),
  dispose: (): void => { farview?.dispose(); valley?.dispose(); sky.dispose(); renderer.dispose(); },
};

(window as unknown as { __lab: typeof lab }).__lab = lab;
(document.body.dataset as Record<string, string>).labCanvas = W + 'x' + H;
