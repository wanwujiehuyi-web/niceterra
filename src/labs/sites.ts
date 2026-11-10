/**
 * Dev-only self-check page for the two Hailuogou site tiers.
 *
 * URL:
 *   /labs/sites.html?only=forest|stream&pose=A|B|C|...&low=0|1
 *
 * Canvas is capped at 960 × 540. window.__lab exposes capture() (JPEG data URL), captureMeta(),
 * setPose(), stats() and the live tier so evidence screenshots can be taken without devtools.
 * The page is a lab, not a product screen: the badge says so.
 */

import * as THREE from 'three';
import { createRenderer } from '../core/renderer';
import { createForestTier, type ForestTier } from '../sites/forest';
import { createStreamTier, type StreamTier } from '../sites/stream';

type Site = 'forest' | 'stream';
type Tier = ForestTier | StreamTier;

interface LabMeta {
  site: Site;
  pose: string;
  camera: [number, number, number];
  target: [number, number, number];
  stats: Record<string, unknown>;
  siteId: string;
  coordinateStatus: string;
  evidenceLevel: string;
  anchors: Array<{ id: string; label: string; kind: string; routeId?: string; levelId?: string; position: [number, number, number] }>;
  selected: Record<string, unknown> | null;
  sampleFrame: Record<string, unknown> | null;
}

interface LabApi {
  ready: Promise<void>;
  capture: () => string;
  captureMeta: () => LabMeta;
  setPose: (name: string) => boolean;
  poses: () => string[];
  stats: () => Record<string, unknown>;
  sampleFrame: () => Record<string, unknown> | null;
  selectAt: (clientX: number, clientY: number) => Record<string, unknown> | null;
  site: Site;
  scene: THREE.Scene;
  tier: () => Tier | null;
}

const params = new URLSearchParams(location.search);
const siteRaw = (params.get('only') ?? 'forest').toLowerCase();
const site: Site = siteRaw === 'stream' ? 'stream' : 'forest';
const low = params.get('low') === '1';
const poseParam = params.get('pose');

const stage = document.getElementById('stage') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const width = Math.max(320, Math.min(window.innerWidth, 960));
const height = Math.max(240, Math.min(window.innerHeight, 540));
stage.style.width = width + 'px';
stage.style.height = height + 'px';
stage.style.marginTop = Math.max(0, Math.floor((window.innerHeight - height) / 2)) + 'px';

const { renderer } = createRenderer(stage);
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.shadowMap.enabled = true;
renderer.toneMappingExposure = 1.24;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f0f);
scene.fog = new THREE.FogExp2(0xc9d9e6, site === 'forest' ? 0.0042 : 0.0032);

const camera = new THREE.PerspectiveCamera(52, width / height, 0.06, 900);
const lookAt = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let tier: Tier | null = null;
let tierPoses: Record<string, { position: [number, number, number]; target: [number, number, number] }> = {};
let activePose = '';
let selected: Record<string, unknown> | null = null;
let readyResolve: (() => void) | null = null;
const ready = new Promise<void>((resolve) => {
  readyResolve = resolve;
});
const clock = new THREE.Clock();
let frames = 0;
let firstFrame = false;
let hudAt = 0;

function applyPose(name: string): boolean {
  const pose = tierPoses[name];
  if (!pose) return false;
  activePose = name;
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  lookAt.set(pose.target[0], pose.target[1], pose.target[2]);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();
  return true;
}

function tierStatsRecord(current: Tier): Record<string, unknown> {
  const s = current.stats as unknown as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(s)) {
    const value = s[key];
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') extra[key] = value;
  }
  if (current.id === 'site-forest') {
    const forest = current as ForestTier;
    extra.siteId = forest.meta.assetId;
    extra.treeCount = forest.treeCount;
    extra.canopyGaps = forest.canopyGaps;
  } else {
    const stream = current as StreamTier;
    extra.siteId = stream.meta.assetId;
    extra.rockObject = 'ROCK-HLG-01';
  }
  return extra;
}

function sampleFrameRecord(current: Tier): Record<string, unknown> | null {
  if (current.id !== 'site-stream') return null;
  const frame = (current as StreamTier).getSampleFrame();
  return {
    objectId: frame.objectId,
    sampleStatus: frame.sampleStatus,
    coordinateStatus: 'PLANNED / PARENT_RELATIVE',
    position: frame.position.toArray().map((v) => Math.round(v * 1000) / 1000),
    normal: frame.normal.toArray().map((v) => Math.round(v * 1000) / 1000)
  };
}

function selectAt(clientX: number, clientY: number): Record<string, unknown> | null {
  if (!tier) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(tier.group, true);
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      const data = node.userData as { objectId?: string; sampleStatus?: string; position?: number[]; normal?: number[] };
      if (data && data.objectId) {
        selected = {
          objectId: data.objectId,
          sampleStatus: data.sampleStatus ?? 'UNKNOWN',
          position: data.position ?? null,
          normal: data.normal ?? null,
          distanceM: Math.round(hit.distance * 100) / 100
        };
        return selected;
      }
      node = node.parent;
    }
  }
  selected = null;
  return null;
}

function renderPanel(current: Tier): void {
  const stats = tierStatsRecord(current);
  const lines: string[] = [];
  lines.push(site === 'forest' ? '林冠层 · 乔木 25–38 m' : '林溪 · 水面 + 河床 + 湿线');
  lines.push('coordinate  ' + current.meta.coordinateStatus);
  lines.push('evidence    ' + current.meta.evidenceLevel);
  if (current.meta.placeholder) lines.push('placeholder  true (design geometry)');
  lines.push('pose        ' + activePose + '   (keys: ' + Object.keys(tierPoses).join('/') + ')');
  lines.push('');
  lines.push('stats');
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === 'number') lines.push('  ' + key + ' = ' + (Math.round(value * 100) / 100));
    else if (typeof value === 'string') lines.push('  ' + key + ' = ' + value);
  }
  lines.push('');
  lines.push('anchors (' + current.anchors.length + ')');
  for (const anchor of current.anchors) {
    lines.push('  ' + anchor.id + '  [' + anchor.kind + '] ' + anchor.label);
    if (anchor.routeId || anchor.levelId) lines.push('    ' + (anchor.routeId ?? '') + ' / ' + (anchor.levelId ?? ''));
  }
  const frame = sampleFrameRecord(current);
  if (frame) {
    lines.push('');
    lines.push('sample frame (clickable)');
    lines.push('  ' + frame.objectId + ' · ' + frame.sampleStatus);
    lines.push('  pos ' + JSON.stringify(frame.position) + '  n ' + JSON.stringify(frame.normal));
  }
  if (selected) {
    lines.push('');
    lines.push('selected');
    lines.push('  ' + JSON.stringify(selected));
  }
  lines.push('');
  lines.push('assets ' + current.stats.assetsLoaded + ' ok / ' + current.stats.assetsFailed + ' fail');
  panel.textContent = lines.join('\n');
}

function updateHud(current: Tier): void {
  const stats = current.stats as unknown as Record<string, unknown>;
  const tris = typeof stats.triangles === 'number' ? String(Math.round(stats.triangles)) : '?';
  const extra = current.id === 'site-forest'
    ? 'trees=' + (current as ForestTier).treeCount + ' gaps=' + (current as ForestTier).canopyGaps
    : 'stations=' + String(stats.stations ?? '?') + ' cascades=' + String(stats.cascades ?? '?') + ' foamRings=' + String(stats.foamRings ?? '?');
  hud.textContent = 'v2 lab · sites (dev only)\n' +
    'site=' + current.meta.assetId + '  ' + current.meta.coordinateStatus + '  ' + current.meta.evidenceLevel + '\n' +
    extra + '  tris≈' + tris + '  draw=' + renderer.info.render.calls + '\n' +
    'pose=' + activePose + '  canvas=' + width + '×' + height + '  low=' + String(low);
  renderPanel(current);
}

function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (tier) {
    tier.update(dt, camera);
    renderer.render(scene, camera);
    frames++;
    if (!firstFrame) {
      firstFrame = true;
      document.body.dataset.ready = '1';
      readyResolve?.();
    }
    const now = performance.now();
    if (now - hudAt > 600) {
      hudAt = now;
      updateHud(tier);
      document.body.dataset.frames = String(frames);
      document.body.dataset.pose = activePose;
    }
  }
}

async function main(): Promise<void> {
  hud.textContent = 'v2 lab · sites (dev only)\nbuilding ' + site + (low ? ' (low)' : '') + ' …';
  const onProgress = (done: number, total: number, label: string): void => {
    hud.textContent = 'v2 lab · sites (dev only)\n' + site + ' ' + done + '/' + total + ' · ' + label;
  };
  tier = site === 'forest'
    ? await createForestTier({ lowQuality: low, onProgress })
    : await createStreamTier({ lowQuality: low, onProgress });
  scene.add(tier.group);
  tierPoses = tier.poses as Record<string, { position: [number, number, number]; target: [number, number, number] }>;
  const poseKeys = Object.keys(tierPoses);
  const desired = poseParam && tierPoses[poseParam] ? poseParam : tier.defaultPose;
  if (!applyPose(desired) && poseKeys.length > 0) applyPose(poseKeys[0]);
  renderer.compile(scene, camera);
  document.body.dataset.site = site;
  document.body.dataset.poses = JSON.stringify(poseKeys);
  const streamTier = tier;
  document.body.dataset.sampleFrame = JSON.stringify(sampleFrameRecord(streamTier));
  updateHud(tier);
  clock.start();
  loop();
  void ready;
}

const api: LabApi = {
  ready,
  capture: () => {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.92);
  },
  captureMeta: (): LabMeta => {
    if (!tier) throw new Error('tier not ready');
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const focus = camera.position.clone().addScaledVector(dir, 6);
    return {
      site,
      pose: activePose,
      camera: [camera.position.x, camera.position.y, camera.position.z].map((v) => Math.round(v * 100) / 100) as [number, number, number],
      target: [focus.x, focus.y, focus.z].map((v) => Math.round(v * 100) / 100) as [number, number, number],
      stats: tierStatsRecord(tier),
      siteId: tier.meta.assetId,
      coordinateStatus: tier.meta.coordinateStatus,
      evidenceLevel: tier.meta.evidenceLevel,
      anchors: tier.anchors.map((a) => ({
        id: a.id,
        label: a.label,
        kind: a.kind,
        routeId: a.routeId,
        levelId: a.levelId,
        position: [Math.round(a.position.x * 100) / 100, Math.round(a.position.y * 100) / 100, Math.round(a.position.z * 100) / 100]
      })),
      selected,
      sampleFrame: sampleFrameRecord(tier)
    };
  },
  setPose: (name: string) => applyPose(name),
  poses: () => Object.keys(tierPoses),
  stats: () => (tier ? tierStatsRecord(tier) : {}),
  sampleFrame: () => (tier ? sampleFrameRecord(tier) : null),
  selectAt,
  site,
  scene,
  tier: () => tier
};

(window as unknown as { __lab: LabApi }).__lab = api;

renderer.domElement.addEventListener('pointerdown', (event) => {
  const hit = selectAt(event.clientX, event.clientY);
  if (tier) {
    updateHud(tier);
    document.body.dataset.selected = JSON.stringify(hit);
  }
});

window.addEventListener('beforeunload', () => {
  if (tier) {
    scene.remove(tier.group);
    tier.dispose();
    tier = null;
  }
  renderer.dispose();
});

void main();
