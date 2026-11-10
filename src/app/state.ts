/**
 * Shared state + URL router for NiceTerra.
 * DESIGN_V2 §15: placeId / siteId / parentObjectId / sampleId / routeId / levelId
 * plus cameraId / mode / dataVersion / assetVersion / selectedTab / compareMode.
 * URL, title, model, scale, evidence and sample status must stay in sync.
 */

import { APP_META, MESSAGES, ROUTES, SITES, type Mode, type TabId } from './content';
import { findMolecularObject } from '../micro/molecular';

export type Tier = 'valley' | 'site' | 'object' | 'micro' | 'molecular';
export type CompareMode = 'off' | 'reference' | 'before';

export interface AppState {
  mode: Mode;
  tier: Tier;
  placeId: string;
  siteId: string | null;
  routeId: string | null;
  levelId: string | null;
  sampleId: string | null;
  cameraId: string | null;
  tab: TabId;
  compare: CompareMode;
  dataVersion: string;
  assetVersion: string;
}

export const DEFAULT_STATE: AppState = {
  mode: 'journey',
  tier: 'valley',
  placeId: APP_META.placeId,
  siteId: null,
  routeId: null,
  levelId: null,
  sampleId: null,
  cameraId: 'CAM-HLG-A',
  tab: 'summary',
  compare: 'off',
  dataVersion: APP_META.dataVersion,
  assetVersion: APP_META.assetVersion
};

export type Listener = (state: AppState, reason: 'init' | 'patch' | 'route') => void;

const STORAGE_KEY = 'niceterra.session.v2';

function isMode(v: unknown): v is Mode {
  return v === 'journey' || v === 'free' || v === 'hypothesis';
}
function isTab(v: unknown): v is TabId {
  return v === 'summary' || v === 'evidence' || v === 'samples';
}

/** Reads the deep link: ?site=SITE-HLG-STREAM-01&route=...&level=A-03&mode=journey&tab=evidence */
export function readLocation(search: string): Partial<AppState> {
  const q = new URLSearchParams(search);
  const patch: Partial<AppState> = {};
  const mode = q.get('mode');
  if (isMode(mode)) patch.mode = mode;
  const tab = q.get('tab');
  if (isTab(tab)) patch.tab = tab;
  const site = q.get('site');
  if (site && SITES.some((s) => s.siteId === site)) patch.siteId = site;
  const route = q.get('route');
  if (route && ROUTES.some((r) => r.routeId === route)) {
    patch.routeId = route;
    const found = ROUTES.find((r) => r.routeId === route);
    if (found) patch.siteId = found.siteId;
  }
  const level = q.get('level');
  if (level) {
    const routeOfLevel = ROUTES.find((r) => r.levels.some((l) => l.levelId === level));
    if (routeOfLevel) {
      const lvl = routeOfLevel.levels.find((l) => l.levelId === level);
      patch.levelId = level;
      patch.routeId = routeOfLevel.routeId;
      patch.siteId = routeOfLevel.siteId;
      patch.tier = lvl?.kind === 'micro' ? 'micro' : lvl?.kind === 'object' ? 'object' : 'site';
    } else {
      // Universal molecular layer: mol-* levels resolve outside the four routes.
      const mol = findMolecularObject(level);
      if (mol) {
        patch.levelId = level;
        patch.routeId = null;
        patch.siteId = mol.siteId;
        patch.tier = 'molecular';
      }
    }
  }
  const sample = q.get('sample');
  if (sample) patch.sampleId = sample;
  const cam = q.get('cam');
  if (cam) patch.cameraId = cam;
  const compare = q.get('compare');
  if (compare === 'reference' || compare === 'before') patch.compare = compare;
  if (!patch.tier && patch.siteId) patch.tier = 'site';
  return patch;
}

export function toSearch(state: AppState): string {
  const q = new URLSearchParams();
  if (state.siteId) q.set('site', state.siteId);
  if (state.routeId) q.set('route', state.routeId);
  if (state.levelId) q.set('level', state.levelId);
  if (state.sampleId) q.set('sample', state.sampleId);
  if (state.cameraId && state.cameraId !== 'CAM-HLG-A') q.set('cam', state.cameraId);
  if (state.mode !== 'journey') q.set('mode', state.mode);
  if (state.tab !== 'summary') q.set('tab', state.tab);
  if (state.compare !== 'off') q.set('compare', state.compare);
  const s = q.toString();
  return s ? '?' + s : '';
}

export function routeLabel(state: AppState): string {
  if (state.tier === 'molecular' && state.levelId) {
    const mol = findMolecularObject(state.levelId);
    if (mol) return mol.name + ' · ' + (mol.siteName ?? '谷地');
  }
  const route = state.routeId ? ROUTES.find((r) => r.routeId === state.routeId) : undefined;
  const site = state.siteId ? SITES.find((s) => s.siteId === state.siteId) : undefined;
  const level = route && state.levelId ? route.levels.find((l) => l.levelId === state.levelId) : undefined;
  if (!site) return '海螺沟 · 谷地';
  if (!route) return '海螺沟 · ' + site.name;
  if (!level) return site.name + ' · 路线 ' + route.code;
  return level.name + ' · 路线 ' + route.code;
}

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial?: Partial<AppState>) {
    this.state = { ...DEFAULT_STATE, ...readLocation(window.location.search), ...initial };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Mutating entry point. Keeps the URL in sync and pushes a history entry. */
  patch(next: Partial<AppState>, opts: { history?: boolean; replace?: boolean } = {}): void {
    const history = opts.history ?? true;
    this.state = { ...this.state, ...next };
    // Back at the valley: the site route is cleared, so the URL cannot lie.
    if (this.state.tier === 'valley') {
      this.state.siteId = null;
      this.state.routeId = null;
      this.state.levelId = null;
      this.state.sampleId = null;
    }
    // The URL is part of the state contract (UX-04/05/06), so every patch
    // rewrites it. `history: true` additionally pushes a back-stack entry.
    this.syncUrl(history ? 'push' : 'replace');
    this.emit('patch');
  }

  applyFromLocation(): void {
    this.state = { ...DEFAULT_STATE, ...readLocation(window.location.search) };
    this.emit('route');
  }

  private syncUrl(mode: 'push' | 'replace' | 'none'): void {
    if (mode === 'none') return;
    const url = window.location.pathname + toSearch(this.state);
    if (mode === 'push') window.history.pushState({ nt: true }, '', url);
    else window.history.replaceState({ nt: true }, '', url);
  }

  private emit(reason: 'init' | 'patch' | 'route'): void {
    for (const fn of this.listeners) fn(this.state, reason);
  }

  /** Persists the last session so the poster can offer "继续上次探索". */
  persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ siteId: this.state.siteId, routeId: this.state.routeId, levelId: this.state.levelId, at: Date.now() })
      );
    } catch {
      /* storage may be blocked; the session simply will not resume */
    }
  }

  static lastSession(): { siteId: string | null; routeId: string | null } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { siteId?: string | null; routeId?: string | null; at?: number };
      if (!parsed.at || Date.now() - parsed.at > 1000 * 60 * 60 * 24 * 30) return null;
      return { siteId: parsed.siteId ?? null, routeId: parsed.routeId ?? null };
    } catch {
      return null;
    }
  }
}

export function statusOfSite(siteId: string | null): string {
  if (!siteId) return '谷地预览';
  const site = SITES.find((s) => s.siteId === siteId);
  return site ? site.name : '未知样区';
}

export const UNKNOWN = 'UNKNOWN';
export const NOT_CONNECTED_MESSAGE = MESSAGES.notConnected;
