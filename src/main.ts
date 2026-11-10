/**
 * Entry point: poster first, then capability check, then the valley tier.
 *
 * Loading state machine (DESIGN_V2 §14):
 *   idle -> capability-check -> poster-ready -> loading-core -> interactive
 * plus loading-next-level / recoverable-error / context-lost / paused / static-mode.
 * Counters appear only for real, enumerable tasks.
 */

import './ui/styles.css';
import { MESSAGES, POSTER, ROUTES, SITES, type Mode, type TabId } from './app/content';
import { Store, routeLabel } from './app/state';
import { detectCapability, capabilitySummary, type Capability } from './app/capability';
import { loadScience } from './app/science';
import { WorldApp } from './app/world-app';
import { Shell } from './ui/shell';
import { loadTierFor, tierKey, takeFromCache, putInCache, cacheSize, clearTierCache } from './app/tiers';
import { findMolecularObject } from './micro/molecular';

type LoadPhase =
  | 'idle'
  | 'capability-check'
  | 'poster-ready'
  | 'loading-core'
  | 'interactive'
  | 'loading-next-level'
  | 'recoverable-error'
  | 'context-lost'
  | 'static-mode';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('missing #app');
const app: HTMLElement = rootEl;

const store = new Store();
let shell: Shell;
let world: WorldApp | null = null;
let capability: Capability | null = null;
let phase: LoadPhase = 'idle';
let entered = false;
let lowQuality = false;
let activeTier = 'none';
let busy = false;

function setPhase(next: LoadPhase): void {
  phase = next;
  app!.dataset.phase = next;
}

/* ------------------------------------------------------------------ boot */

async function start(): Promise<void> {
  setPhase('capability-check');
  shell = new Shell(app!, {
    onEnter: () => void enterWorld(),
    onResume: () => void enterWorld(true),
    onRetry: () => location.reload(),
    onPrev: () => step(-1),
    onNext: () => step(1),
    onExit: () => goValley(),
    onFar: () => void toggleFar(),
    onHypothesis: (delta) => applyHypothesis(delta),
    onSite: (siteId) => selectSite(siteId),
    onRoute: (routeId) => selectRoute(routeId),
    onLevel: (levelId) => selectLevel(levelId),
    onTab: (tab: TabId) => store.patch({ tab }, { history: false }),
    onMode: (mode: Mode) => store.patch({ mode }, { history: false }),
    onAnchor: (anchor) => {
      if (anchor.levelId) selectLevel(anchor.levelId);
      else if (anchor.siteId) selectSite(anchor.siteId);
      else if (anchor.routeId) selectRoute(anchor.routeId);
    }
  });

  shell.setMode(store.get().mode);
  shell.refresh(store.get());
  shell.setBottomState(store.get(), { prev: false, next: true, exit: false });
  shell.renderSceneMeta(store.get(), { tier: 'valley', fps: 0, triangles: 0 });

  capability = detectCapability();
  // Test hooks (never on for real users): ?force=nowebgl simulates a device without WebGL2.
  const force = new URLSearchParams(location.search).get('force');
  if (force === 'nowebgl') capability = { ...capability, webgl2: false };
  window.__ntCapability = capabilitySummary(capability);
  app.dataset.renderer = capability.renderer;
  shell.renderPosterStages(1, 0, 0);
  shell.showLoadingText('检测图形能力…');

  const science = await loadScience();
  shell.renderPosterStages(2, 0, 0);
  shell.setProgress(science.ok ? 0.2 : 0.12);
  if (!science.ok) shell.toast(MESSAGES.specMissing);

  if (!capability.webgl2) {
    setPhase('static-mode');
    shell.showLoadingText('这台设备没有可用的 WebGL2。');
    shell.setStaticMode(POSTER.staticHint);
    shell.renderPosterStages(3, 0, 0);
    const enter = document.getElementById('btn-enter');
    if (enter) enter.textContent = POSTER.staticMode;
    return;
  }

  setPhase('poster-ready');
  shell.showLoadingText('地点海报已就绪。');
  store.persist();

  // Screenshot / evidence hook: ?autostart=1 enters the world without a click.
  if (new URLSearchParams(location.search).get('autostart') === '1') {
    void enterWorld();
  }
}

/* ---------------------------------------------------------------- enter */

async function enterWorld(resume = false): Promise<void> {
  if (entered || busy) return;
  if (phase === 'static-mode') {
    shell.hidePoster();
    return;
  }
  entered = true;
  const enterBtn = document.getElementById('btn-enter');
  const resumeBtn = document.getElementById('btn-resume');
  enterBtn?.setAttribute('disabled', 'true');
  resumeBtn?.setAttribute('disabled', 'true');
  shell.renderPosterStages(3, 0, 0);
  shell.showLoadingText('读取三维场景…');

  const host = document.getElementById('scene');
  if (!host) throw new Error('missing #scene');
  const forced = new URLSearchParams(location.search).get('quality');
  lowQuality = forced === 'high' ? false : forced === 'low' ? true : capability ? capability.software || capability.dpr > 2 : false;
  setPhase('loading-core');

  world = new WorldApp({
    host,
    reducedMotion: capability?.reducedMotion ?? false,
    onContextLost: () => {
      setPhase('context-lost');
      world?.stop();
      shell.toast(MESSAGES.contextLost);
    }
  });

  window.__nt = {
    app: world,
    scene: world.scene,
    camera: world.camera,
    renderer: world.renderer,
    store,
    stats: () => world?.stats(),
    anchors: () => world?.anchors(),
    setPose: (id) => world?.setPose(id),
    capture: (q) => world?.capture(q) ?? ''
  };

  try {
    const first = await loadTierFor('valley', store.get(), {
      lowQuality,
      current: 'none',
      onProgress: (done, total, label) => {
        shell.showLoadingText(label);
        shell.setProgress(0.25 + (total > 0 ? done / total : 0.35) * 0.7);
        if (total > 0) shell.renderPosterStages(4, done, total);
      }
    });
    if (!first) throw new Error('谷地层没有返回任何几何');
    world.install(first);
    window.__ntBuilds = (window.__ntBuilds ?? 0) + 1;
    activeTier = first.id;
    setPhase('interactive');
    shell.setProgress(1);
    shell.hidePoster();
    syncWorld();
    // Deep link: ?site= / ?route= / ?level= open that tier straight away, and
    // ?view=far opens the read-only Gongga view. Same code path as a click.
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'far') {
      await applyTier('far');
    } else if (store.get().tier !== 'valley') {
      await applyTier(store.get().tier);
    }
    if (resume) {
      const last = Store.lastSession();
      if (last?.siteId) selectSite(last.siteId);
    }
    if (!capability?.reducedMotion) startTour();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setPhase('recoverable-error');
    shell.setProgress(0);
    shell.showLoadingText('三维场景没有启动：' + msg);
    shell.toast(MESSAGES.webglFailed);
    entered = false;
    enterBtn?.removeAttribute('disabled');
    resumeBtn?.removeAttribute('disabled');
    // The poster is still usable; the archive stays readable either way.
    shell.setStaticMode('三维场景没有启动：' + msg + '。下面是可读的静态档案。');
  }
}

/**
 * Guided tour, DESIGN_V2 §6.3: 地理定位 8–12 s → 冰川到森林 10–15 s →
 * 四个入口 (常驻). It only moves between documented poses, is cancelled by any
 * pointer input, and is skipped for reduced motion.
 */
let tourTimers: number[] = [];
let touring = false;

function cancelTour(reason = '用户操作'): void {
  if (!touring) return;
  touring = false;
  for (const t of tourTimers) window.clearTimeout(t);
  tourTimers = [];
  shell.toast('已跳过导览（' + reason + '）');
}

function startTour(): void {
  if (!world || capability?.reducedMotion) return;
  touring = true;
  const step = (pose: string, label: string, delay: number): void => {
    tourTimers.push(window.setTimeout(() => {
      if (!touring) return;
      world?.setPose(pose);
      window.__ntTour = label;
    }, delay));
  };
  step('A', '导览 1/3 · 地理定位', 300);
  step('B', '导览 2/3 · 冰川到森林', 10000);
  step('A', '导览 3/3 · 四个入口', 22500);
  tourTimers.push(window.setTimeout(() => { touring = false; window.__ntTour = 'done'; }, 34000));
}

/* ------------------------------------------------------------- selection */

function selectSite(siteId: string): void {
  if (!siteId) return;
  store.patch({ siteId, routeId: null, levelId: null, tier: 'site' }, { history: false });
  store.persist();
  void applyTier('site');
}

function selectRoute(routeId: string): void {
  const route = ROUTES.find((r) => r.routeId === routeId);
  if (!route) return;
  const first = route.levels[0];
  store.patch(
    {
      routeId,
      siteId: route.siteId,
      levelId: first?.levelId ?? null,
      tier: first?.kind === 'micro' ? 'micro' : first?.kind === 'object' ? 'object' : 'site'
    },
    { history: false }
  );
  store.persist();
  void applyTier('site');
}

function selectLevel(levelId: string): void {
  // Universal molecular layer: mol-* levels live outside the four flagship routes.
  const mol = findMolecularObject(levelId);
  if (mol) {
    store.patch({ routeId: null, siteId: mol.siteId, levelId, tier: 'molecular' }, { history: false });
    store.persist();
    void applyTier('molecular');
    return;
  }
  const route = ROUTES.find((r) => r.levels.some((l) => l.levelId === levelId));
  if (!route) return;
  const level = route.levels.find((l) => l.levelId === levelId);
  const tier = level?.kind === 'micro' ? 'micro' : level?.kind === 'object' ? 'object' : 'site';
  store.patch({ routeId: route.routeId, siteId: route.siteId, levelId, tier }, { history: false });
  store.persist();
  void applyTier(tier);
}

function step(dir: 1 | -1): void {
  const state = store.get();
  // Molecular terminal layer: up returns to the parent site (or valley), down is the end.
  if (state.tier === 'molecular') {
    if (dir === -1) {
      if (state.siteId) selectSite(state.siteId);
      else goValley();
    } else {
      shell.toast('分子层已是纵深终点。返回上一级回到母体对象。');
    }
    return;
  }
  const route = state.routeId ? ROUTES.find((r) => r.routeId === state.routeId) : undefined;
  if (!route) {
    if (dir === 1) {
      const first = SITES[0];
      if (first) selectSite(first.siteId);
    }
    return;
  }
  const idx = state.levelId ? route.levels.findIndex((l) => l.levelId === state.levelId) : -1;
  if (dir === 1) {
    const next = route.levels[idx + 1];
    if (next) selectLevel(next.levelId);
    else shell.toast('已经是这条路线的最后一层。可以退到谷地，换一条路线。');
  } else {
    const prev = idx <= 0 ? null : route.levels[idx - 1];
    if (prev) selectLevel(prev.levelId);
    else goValley();
  }
}

function goValley(): void {
  const state = store.get();
  if (state.tier === 'valley') return;
  store.patch({ tier: 'valley', siteId: null, routeId: null, levelId: null }, { history: false });
  void applyTier('valley');
}

/* ---------------------------------------------------------------- tiers */

async function toggleFar(): Promise<void> {
  if (!world) return;
  if (activeTier === 'farview') {
    await applyTier('valley');
    shell.toast('已回到海螺沟谷地。');
    return;
  }
  await applyTier('far');
  shell.toast('贡嘎山脉三维远景：只读观察，不能步行。');
}

async function applyTier(tier: string): Promise<void> {
  if (!world || busy) return;
  busy = true;
  setPhase('loading-next-level');
  try {
    const state = store.get();
    const key = tierKey(tier, state);
    const cached = takeFromCache(key);
    const built = cached ?? (await loadTierFor(tier, state, { lowQuality, current: activeTier }));
    if (!built) {
      setPhase('interactive');
      shell.toast(MESSAGES.notConnected);
      return;
    }
    window.__ntPreload = { id: built.id, state: cached ? 'cache-hit' : 'built', cacheSize: cacheSize() };
    world.install(built, { fadeMs: 400 });
    window.__ntBuilds = (window.__ntBuilds ?? 0) + 1;
    activeTier = built.id;
    setPhase('interactive');
    syncWorld();
    // Prefetch only once the swap has settled: two heavy builds at the same
    // time made the software rasteriser take minutes instead of seconds.
    window.setTimeout(() => schedulePrefetch(), 2500);
  } catch (err) {
    setPhase('recoverable-error');
    shell.toast('换层失败，已保留当前层：' + (err instanceof Error ? err.message : String(err)));
    window.setTimeout(() => setPhase('interactive'), 0);
  } finally {
    busy = false;
  }
}

/**
 * Hypothesis mode (L5). It only ever moves a rendering uniform on a copy of the
 * look — the claims, levels and samples in public/data/science stay untouched,
 * so the scientific baseline cannot drift. The panel labels every value L5.
 */
function applyHypothesis(deltaM: number): void {
  if (!world) return;
  let touched = 0;
  world.scene.traverse((obj) => {
    const mesh = obj as unknown as { material?: { userData?: Record<string, unknown> } | Array<{ userData?: Record<string, unknown> }> };
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const u = m.userData && (m.userData.snowLineUniform as { value: number } | undefined);
      if (u) {
        u.value = 4200 + deltaM;
        touched++;
      }
    }
  });
  window.__ntHypothesis = { snowLineDeltaM: deltaM, materialsTouched: touched };
  shell.toast('L5 假设：雪线上移 ' + deltaM + ' m（非事实陈述，科学基线未改动）');
}

function syncWorld(): void {
  if (!world || !shell) return;
  const state = store.get();
  shell.setMode(state.mode);
  shell.refresh(state);
  shell.setBottomState(state, { prev: state.tier !== 'valley', next: true, exit: state.tier !== 'valley' });
  shell.renderSceneMeta(state, {
    tier: activeTier,
    fps: world.stats().fps,
    triangles: world.stats().triangles
  });
  shell.setAnchors(world.anchors());
}

/* --------------------------------------------------------------- events */

store.subscribe(() => {
  if (!shell) return;
  app!.dataset.tier = store.get().tier;
  syncWorld();
});

/**
 * LOAD-10: prefetch the next level on the current route during idle time.
 * Bounded to one build at a time and two cached tiers; it never starts while a
 * user-initiated swap is in flight, and failures are silent.
 */
function schedulePrefetch(): void {
  const state = store.get();
  const route = state.routeId ? ROUTES.find((r) => r.routeId === state.routeId) : undefined;
  if (!route || !state.levelId) return;
  const idx = route.levels.findIndex((l) => l.levelId === state.levelId);
  const next = route.levels[idx + 1];
  if (!next) return;
  const nextTier = next.kind === 'micro' ? 'micro' : next.kind === 'object' ? 'object' : 'site';
  const nextState = { ...state, levelId: next.levelId, tier: nextTier as typeof state.tier };
  const key = tierKey(nextTier, nextState);
  window.setTimeout(() => {
    if (busy || !world || phase !== 'interactive') return;
    void loadTierFor(nextTier, nextState, { lowQuality, current: activeTier })
      .then((built) => {
        if (!built) return;
        putInCache(key, built);
        window.__ntPreload = { id: built.id, state: 'prefetched', cacheSize: cacheSize() };
      })
      .catch(() => {
        /* prefetch failures stay silent: the user has not asked for this level yet */
      });
  }, 1400);
}

window.addEventListener('beforeunload', () => clearTierCache());

window.addEventListener('popstate', () => store.applyFromLocation());

// LOAD-09: a hidden tab must not keep rendering or keep GPU memory warm.
document.addEventListener('visibilitychange', () => {
  if (!world) return;
  if (document.hidden) {
    world.stop();
  } else if (phase === 'interactive') {
    world.start();
  }
});

window.addEventListener('pointerdown', () => cancelTour('点击'), { passive: true });

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    goValley();
    return;
  }
  if (ev.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
  if (ev.key === 'ArrowRight') step(1);
  if (ev.key === 'ArrowLeft') step(-1);
});

// Anchor projection is throttled: 10 Hz is enough for a pointer target.
window.setInterval(() => {
  if (!world || phase !== 'interactive') return;
  shell.setAnchors(world.anchors());
}, 120);

// FPS / triangle labels refresh at 2 Hz, never per frame.
window.setInterval(() => {
  if (!world || phase !== 'interactive' || !shell) return;
  const s = world.stats();
  shell.renderSceneMeta(store.get(), { tier: activeTier, fps: s.fps, triangles: s.triangles });
}, 500);

declare global {
  interface Window {
    __nt?: {
      app: WorldApp;
      scene: unknown;
      camera: unknown;
      renderer: unknown;
      store: Store;
      stats: () => unknown;
      anchors: () => unknown;
      setPose: (id: string) => void;
      capture: (q?: number) => string;
    };
    __ntCapability?: string;
    __ntBuilds?: number;
    __ntHypothesis?: { snowLineDeltaM: number; materialsTouched: number };
    __ntPreload?: { id: string; state: string; cacheSize: number };
    __ntTour?: string;
  }
}

void start().catch((err) => {
  // A failure before the shell exists must not leave a blank page.
  const detail = err instanceof Error ? err.message : String(err);
  const poster = document.getElementById('poster-status');
  if (poster) poster.textContent = '启动失败：' + detail;
  console.error('[niceterra] start failed', err);
});

void routeLabel;
