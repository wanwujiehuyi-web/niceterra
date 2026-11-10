/**
 * Tier registry: turns an AppState tier into a WorldTier.
 *
 * Registered today:
 *   valley  -> src/world/valley.ts      (海螺沟谷地中景，可导览)
 *   far     -> src/world/farview.ts     (贡嘎远景，只读，不可步行)
 *   object  -> src/micro/route-a.ts      (母体层，路线 A 第 1 层)
 *   micro   -> src/micro/route-a.ts      (路线 A 九层微观)
 *
 *   site    -> src/sites/forest.ts | src/sites/stream.ts (样区层)
 *
 * Returning null means "not connected": the shell keeps the current tier and
 * says so instead of showing an empty or wrong world.
 */

import type { AppState } from './state';
import type { TierOptions, WorldTier } from '../world/tier';
import { createValleyTier } from '../world/valley';
import { createFarviewTier } from '../world/farview';
import { createMicroTierA, ROUTE_A_ID } from '../micro/route-a';
import { createForestTier } from '../sites/forest';
import { createStreamTier } from '../sites/stream';

export interface TierLoadOptions extends TierOptions {
  current: string;
  onProgress?: (done: number, total: number, label: string) => void;
}

export const TIER_IDS = {
  valley: 'valley',
  far: 'farview',
  object: 'micro-a',
  micro: 'micro-a'
} as const;

export async function loadTierFor(tier: string, state: AppState, opts: TierLoadOptions): Promise<WorldTier | null> {
  const progress = opts.onProgress;

  if (tier === 'valley') {
    if (opts.current === 'valley') return null;
    return createValleyTier({ lowQuality: opts.lowQuality, onProgress: progress });
  }

  if (tier === 'far') {
    if (opts.current === 'farview') return null;
    return createFarviewTier({ lowQuality: opts.lowQuality, onProgress: progress });
  }

  if (tier === 'object' || tier === 'micro') {
    // Only route A has geometry so far. Other routes must not silently show
    // route A's molecules while the UI claims to be on route B/C/D.
    if (state.routeId !== ROUTE_A_ID) return null;
    const levelId = state.levelId ?? 'wet-rock';
    if (opts.current === 'micro-a:' + levelId) return null;
    return createMicroTierA({ lowQuality: opts.lowQuality, onProgress: progress, levelId });
  }

  if (tier === 'site' || tier === 'object') {
    if (state.siteId === 'SITE-HLG-FOREST-01') {
      if (opts.current === 'site-forest') return null;
      return createForestTier({ lowQuality: opts.lowQuality, onProgress: progress });
    }
    if (state.siteId === 'SITE-HLG-STREAM-01') {
      if (opts.current === 'site-stream') return null;
      return createStreamTier({ lowQuality: opts.lowQuality, onProgress: progress });
    }
    // SITE-HLG-GLACIER-01 and SITE-HLG-CHRONO-01 have data + claims but no
    // walkable geometry yet: say so instead of showing the wrong site.
    return null;
  }

  return null;
}

/* ------------------------------------------------------------------ cache */
/**
 * Bounded prefetch cache for adjacent levels (LOAD-10).
 * At most two built tiers are kept: the next level on the current route and the
 * next site. Prefetch never runs on the frame that handles a click, and a tier
 * taken from the cache is removed from it so nothing is installed twice.
 */
const CACHE_LIMIT = 2;
const cache = new Map<string, WorldTier>();

export function tierKey(tier: string, state: AppState): string {
  return tier + '|' + (state.siteId ?? '-') + '|' + (state.levelId ?? '-');
}

export function cacheSize(): number {
  return cache.size;
}

export function takeFromCache(key: string): WorldTier | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  return hit;
}

export function putInCache(key: string, tier: WorldTier): void {
  while (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.get(oldest)?.dispose();
    cache.delete(oldest);
  }
  cache.set(key, tier);
}

export function clearTierCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
