import * as THREE from 'three';
import { buildLevelA, ROUTE_A, disposeAllA, type MicroLevelABuild } from '../micro/route-a';
import { formatMeters } from '../micro/micro-utils';

/**
 * Dev-only lab for route A (HLG-STREAM-BIOFILM-01).
 * URL: /labs/micro.html?level=<levelId>&low=1&view=<viewId>
 * Exposes window.__lab.capture() -> JPEG data URL, plus info()/setLevel()/setView()/pause().
 * Never product UI: this page exists to photograph one declared level at a time.
 */

const params = new URLSearchParams(location.search);
const LOW = params.get('low') === '1';
const WIDTH = Math.min(960, Math.max(360, window.innerWidth));
const HEIGHT = Math.min(540, Math.max(260, window.innerHeight - 150));
const START_LEVEL = params.get('level') ?? ROUTE_A.levels[0].levelId;
const START_VIEW = params.get('view');

const stage = document.getElementById('stage') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const scaleLine = document.getElementById('scalebar-line') as HTMLDivElement;
const scaleLabel = document.getElementById('scalebar-label') as HTMLDivElement;
const controls = document.getElementById('controls') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: !LOW, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.style.width = WIDTH + 'px';
renderer.domElement.style.height = HEIGHT + 'px';
stage.insertBefore(renderer.domElement, stage.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e11);
const camera = new THREE.PerspectiveCamera(36, WIDTH / HEIGHT, 1e-3, 10);

let elapsed = 0;
let paused = false;
let readyState: 'loading' | 'ready' | 'error' = 'loading';
let lastError: string | null = null;

function applyCamera(): void {
  const setup = build.extras.camera;
  scene.background = new THREE.Color(setup.background);
  camera.near = setup.near;
  camera.far = setup.far;
  camera.fov = setup.fovDeg;
  camera.aspect = WIDTH / HEIGHT;
  camera.up.set(setup.up[0], setup.up[1], setup.up[2]);
  camera.position.set(setup.position[0], setup.position[1], setup.position[2]);
  camera.lookAt(setup.target[0], setup.target[1], setup.target[2]);
  camera.updateProjectionMatrix();
}

const IMAGING_LABEL: Record<string, string> = {
  'natural-light': '自然光',
  photogrammetry: '近景摄影测量',
  'optical-microscopy': '光学显微',
  SEM: 'SEM（灰度）',
  'fluorescence-microscopy': '荧光显微',
  'mechanism-diagram': '机制示意',
  'data-view': '数据视图',
  UNKNOWN: '成像 UNKNOWN'
};
const COLOR_LABEL: Record<string, string> = {
  natural: '自然色',
  grayscale: '灰度',
  'false-color': '伪彩（需标注）',
  fluorescence: '荧光映射',
  schematic: '示意色（编码）'
};

function renderHud(): void {
  const spec = build.extras;
  const extra = build;
  const chips = spec.legend
    .map(
      (entry) =>
        '<span><i style="background:#' + entry.color.toString(16).padStart(6, '0') + '"></i>' + entry.text + '</span>'
    )
    .join('');
  hud.innerHTML =
    '<h1>' + extra.levelId + ' · ' + spec.geometryNote.split('；')[0] + '</h1>' +
    '<div class="row">视场 <b>' + extra.fovLabel + '</b>（' + (extra.fovMeters ?? 0).toExponential(2) + ' m）· 成像 <b>' +
    (IMAGING_LABEL[extra.imaging] ?? extra.imaging) + '</b> · 颜色 <b>' + (COLOR_LABEL[extra.colorStatus] ?? extra.colorStatus) + '</b></div>' +
    '<div class="row">证据 <b>' + extra.evidence + '</b> · ' + spec.evidenceNote + ' · 样本 <b>' + spec.sampleStatus + '</b></div>' +
    '<div class="row">母体 <b>' + spec.parentObjectId + '</b> · 坐标状态 PARENT_RELATIVE（显微对象无经纬度）</div>' +
    '<div class="row">主张来源：' + spec.sources.join(' / ') + '</div>' +
    '<div class="limit">限制：' + extra.limitation + '</div>' +
    '<div id="legend">' + chips + '</div>';
  updateScaleBar();
}

function updateScaleBar(): void {
  const meters = build.extras.scaleBar.meters;
  if (!meters) {
    scaleLine.style.display = 'none';
    scaleLabel.textContent = '';
    return;
  }
  const target = new THREE.Vector3(...build.extras.camera.target);
  const direction = new THREE.Vector3().subVectors(target, camera.position);
  const distance = Math.max(direction.length(), build.extras.camera.near);
  const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
  const px = (meters / viewHeight) * HEIGHT;
  scaleLine.style.display = 'block';
  scaleLine.style.width = Math.max(8, Math.round(px)) + 'px';
  scaleLabel.textContent = formatMeters(meters);
  document.body.dataset.scaleBarPx = String(Math.round(px));
}

function createBuild(levelId: string): MicroLevelABuild {
  try {
    return buildLevelA(levelId, { renderer, lowQuality: LOW });
  } catch (err) {
    lastError = 'level "' + levelId + '" failed: ' + (err instanceof Error ? err.message : String(err));
    return buildLevelA(ROUTE_A.levels[0].levelId, { renderer, lowQuality: LOW });
  }
}

let build: MicroLevelABuild = createBuild(START_LEVEL);
scene.add(build.group);
let activeView = build.extras.views[0]?.id ?? 'default';
applyCamera();

function markReady(): void {
  const finish = (): void => {
    readyState = 'ready';
    document.body.dataset.ready = '1';
    document.body.dataset.level = build.levelId;
    document.body.dataset.fovMeters = String(build.fovMeters);
  };
  const ready = build.extras.ready;
  if (!ready) {
    finish();
    return;
  }
  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    finish();
  }, 4000);
  ready
    .then(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      finish();
    })
    .catch(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      finish();
    });
}

function setView(viewId: string): void {
  const view = build.extras.views.find((entry) => entry.id === viewId);
  if (!view) return;
  view.apply();
  activeView = viewId;
  build.extras.activeViewId = viewId;
  applyCamera();
  renderHud();
  buildControls();
}

function setLevel(levelId: string): void {
  if (levelId === build.levelId) return;
  let next: MicroLevelABuild;
  try {
    next = buildLevelA(levelId, { renderer, lowQuality: LOW });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    document.body.dataset.error = lastError;
    return;
  }
  scene.remove(build.group);
  build.dispose();
  build = next;
  scene.add(build.group);
  elapsed = 0;
  paused = false;
  activeView = build.extras.views[0]?.id ?? 'default';
  const requested = START_VIEW && build.extras.views.some((entry) => entry.id === START_VIEW) ? START_VIEW : null;
  if (requested) {
    const view = build.extras.views.find((entry) => entry.id === requested);
    view?.apply();
    activeView = requested;
  }
  applyCamera();
  renderHud();
  buildControls();
  markReady();
  const url = new URL(location.href);
  url.searchParams.set('level', levelId);
  history.replaceState(null, '', url);
}

function togglePause(): void {
  if (!build.extras.pausable) return;
  paused = !paused;
  if (paused) build.extras.pause?.();
  else build.extras.resume?.();
  document.body.dataset.paused = paused ? '1' : '0';
  buildControls();
}

function stepLevel(delta: number): void {
  const index = ROUTE_A.levels.findIndex((entry) => entry.levelId === build.levelId);
  const target = index + delta;
  if (target < 0 || target >= ROUTE_A.levels.length) return;
  setLevel(ROUTE_A.levels[target].levelId);
}

function makeButton(label: string, onClick: () => void, active = false, disabled = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', onClick);
  if (active) button.className = 'active';
  button.disabled = disabled;
  return button;
}

function buildControls(): void {
  controls.innerHTML = '';
  const index = ROUTE_A.levels.findIndex((entry) => entry.levelId === build.levelId);
  controls.appendChild(makeButton('← 上一层', () => stepLevel(-1), false, index <= 0));
  controls.appendChild(makeButton('下一层 →', () => stepLevel(1), false, index >= ROUTE_A.levels.length - 1));
  if (build.extras.pausable) {
    controls.appendChild(makeButton(paused ? '继续动画' : '暂停动画', togglePause, paused));
  }
  for (const view of build.extras.views) {
    const button = makeButton(view.label, () => setView(view.id), view.id === activeView);
    controls.appendChild(button);
  }
  document.body.dataset.pausable = build.extras.pausable ? '1' : '0';
  document.body.dataset.views = build.extras.views.map((view) => view.id).join(',');
  document.body.dataset.activeView = activeView;
}

const clock = new THREE.Clock();
function tick(): void {
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  build.update?.(dt, elapsed);
  renderer.render(scene, camera);
  document.body.dataset.triangles = String(renderer.info.render.triangles);
  document.body.dataset.calls = String(renderer.info.render.calls);
  requestAnimationFrame(tick);
}

function capture(): string {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/jpeg', 0.92);
}

interface LabApi {
  capture(): string;
  info(): Record<string, unknown>;
  setLevel(levelId: string): void;
  setView(viewId: string): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  readonly levels: string[];
  readonly readyState: string;
  readonly activeLevel: string;
  readonly activeView: string;
}

const api: LabApi = {
  capture,
  info: () => ({
    levelId: build.levelId,
    title: ROUTE_A.levels.find((entry) => entry.levelId === build.levelId)?.title ?? '',
    fovMeters: build.fovMeters,
    fovLabel: build.fovLabel,
    imaging: build.imaging,
    colorStatus: build.colorStatus,
    evidence: build.evidence,
    sampleStatus: build.extras.sampleStatus,
    parentObjectId: build.extras.parentObjectId,
    limitation: build.limitation,
    scaleBarMeters: build.scaleBarMeters,
    views: build.extras.views.map((view) => view.id),
    activeView,
    pausable: build.extras.pausable,
    paused,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    lowQuality: LOW,
    readyState,
    error: lastError
  }),
  setLevel,
  setView,
  pause: () => {
    paused = true;
    build.extras.pause?.();
    buildControls();
  },
  resume: () => {
    paused = false;
    build.extras.resume?.();
    buildControls();
  },
  togglePause,
  levels: ROUTE_A.levels.map((entry) => entry.levelId),
  get readyState() {
    return readyState;
  },
  get activeLevel() {
    return build.levelId;
  },
  get activeView() {
    return activeView;
  }
};

(window as unknown as { __lab: LabApi }).__lab = api;

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    stepLevel(-1);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    stepLevel(1);
  } else if (event.key === ' ') {
    event.preventDefault();
    togglePause();
  } else if (event.key === '1' || event.key === '2' || event.key === '3') {
    const view = build.extras.views[Number(event.key) - 1];
    if (view) setView(view.id);
  }
});

document.body.dataset.microLab = '1';
document.body.dataset.low = LOW ? '1' : '0';
document.body.dataset.canvas = WIDTH + 'x' + HEIGHT;
renderHud();
buildControls();
applyCamera();
markReady();
tick();

window.addEventListener('beforeunload', () => {
  disposeAllA();
});
