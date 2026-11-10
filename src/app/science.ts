/**
 * Typed access to public/data/science/*.json.
 * The science files are the single source of truth for claims, samples and the
 * canonical level order; content.ts only carries short UI copy.
 * Every fetch is allowed to fail: the shell degrades to UNKNOWN, never to a
 * made-up fact.
 */

export interface Claim {
  claimId: string;
  claimType: string;
  text: string;
  sourceId: string | null;
  sourceIds: string[];
  evidenceLevel: string;
  evidenceLevels: string[];
  evidenceNote: string | null;
  validTime: string | null;
  validTimeNote: string | null;
  reviewStatus: string | null;
  reviewStatusCode: string | null;
  limitation: string | null;
  coordinateStatus: string | null;
  siteIds: string[];
  routeIds: string[];
  levelIds: string[];
  pages: number[] | null;
  canAppearInProduct: boolean;
}

export interface Sample {
  sampleId: string;
  sampleName: string;
  siteId: string;
  parentObjectId: string | null;
  parentObjectStatus: string | null;
  coordinateStatus: string;
  sampleStatus: string;
  sampleStatusReason: string | null;
  plannedMethods: string[];
  plannedImaging: string[] | null;
  plannedObservation: string[] | null;
  routeIds: string[];
  levelIds: string[];
  claimIds: string[];
  canPublish: boolean;
  mustNotClaim: string[] | null;
}

export interface ScienceLevel {
  levelId: string;
  label: string;
  order: number;
  fovMeters: number | null;
  fovLabel: string | null;
  fovStatus: string;
  view: string | null;
  dataViewType: string | null;
  isDataView: boolean;
  parentObjectId: string | null;
  sampleId: string | null;
  sampleStatus: string;
  assetId: string | null;
  physicalScale: boolean;
  viewKind: string;
  model: string | null;
  imaging: string | null;
  colorStatus: string | null;
  evidenceLevel: string;
  evidenceLevels: string[];
  evidenceNote: string | null;
  limitation: string | null;
  claimIds: string[];
  previousLevelId: string | null;
  nextLevelId: string | null;
}

export interface ScienceRoute {
  routeId: string;
  code: string;
  name: string;
  siteId: string;
  siteName: string;
  flagship: boolean;
  sampleStatus: string;
  intent: string;
  levelCount: number;
  startLevelId: string;
  endLevelId: string;
  levelOrder: string[];
  dataViewLevelIds: string[];
  evidenceSummary: string | null;
  levels: ScienceLevel[];
}

export interface Source {
  sourceId: string;
  name: string;
  type: string;
  url: string | null;
  publisher: string | null;
  license: string | null;
  licenseStatus: string | null;
  evidenceCeiling: string | null;
  restriction: string | null;
}

export interface ScienceAnchor {
  anchorType: string;
  plotId?: string;
  geographic?: { longitude: number; latitude: number; elevationM: number; epsg: string };
  coordinateStatus: string;
  verticalDatum?: string;
  limitation?: string;
}

export interface SiteNote {
  siteId: string;
  name: string;
  tier: string;
  coordinateStatus: string;
  evidenceLevel: string;
  anchor: ScienceAnchor;
  habitats: unknown[];
  cameras: unknown[];
  objects: unknown[];
  samples: string[];
  routes: string[];
  claimIds: string[];
  mustNotClaim: string[];
  knownUnknowns: string[];
}

export interface ScienceBundle {
  claims: Claim[];
  samples: Sample[];
  routes: ScienceRoute[];
  sources: Source[];
  sites: SiteNote[];
  dataVersion: string;
  ok: boolean;
}

const EMPTY: ScienceBundle = {
  claims: [],
  samples: [],
  routes: [],
  sources: [],
  sites: [],
  dataVersion: 'UNKNOWN',
  ok: false
};

let cached: ScienceBundle | null = null;

async function j<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadScience(): Promise<ScienceBundle> {
  if (cached) return cached;
  const [claims, samples, routes, sources, sites] = await Promise.all([
    j<{ claims: Claim[]; dataVersion: string }>('/data/science/claims.json'),
    j<{ samples: Sample[] }>('/data/science/samples.json'),
    j<{ routes: ScienceRoute[]; dataVersion: string }>('/data/science/routes.json'),
    j<{ sources: Source[] }>('/data/science/sources.json'),
    j<{ sites: SiteNote[] }>('/data/science/site-notes.json')
  ]);
  const ok = Boolean(claims && samples && routes);
  cached = {
    claims: claims?.claims ?? [],
    samples: samples?.samples ?? [],
    routes: routes?.routes ?? [],
    sources: sources?.sources ?? [],
    sites: sites?.sites ?? [],
    dataVersion: routes?.dataVersion ?? 'UNKNOWN',
    ok
  };
  return cached;
}

export function cachedScience(): ScienceBundle {
  return cached ?? EMPTY;
}

export function claimsFor(sci: ScienceBundle, opts: { siteId?: string | null; routeId?: string | null; levelId?: string | null }): Claim[] {
  const { siteId, routeId, levelId } = opts;
  const exact = levelId
    ? sci.claims.filter((c) => c.levelIds.includes(levelId) || c.routeIds.includes(routeId ?? ''))
    : [];
  if (exact.length > 0) return exact;
  if (routeId) {
    const byRoute = sci.claims.filter((c) => c.routeIds.includes(routeId));
    if (byRoute.length > 0) return byRoute;
  }
  if (siteId) return sci.claims.filter((c) => c.siteIds.includes(siteId));
  return sci.claims.filter((c) => c.siteIds.length === 0);
}

export function samplesFor(sci: ScienceBundle, opts: { siteId?: string | null; levelId?: string | null }): Sample[] {
  const { siteId, levelId } = opts;
  if (levelId) {
    const byLevel = sci.samples.filter((s) => s.levelIds.includes(levelId));
    if (byLevel.length > 0) return byLevel;
  }
  if (siteId) return sci.samples.filter((s) => s.siteId === siteId);
  return sci.samples;
}

export function sourceById(sci: ScienceBundle, id: string | null): Source | undefined {
  if (!id) return undefined;
  return sci.sources.find((s) => s.sourceId === id);
}

export function routeFromScience(sci: ScienceBundle, routeId: string | null): ScienceRoute | undefined {
  if (!routeId) return undefined;
  return sci.routes.find((r) => r.routeId === routeId);
}

export function levelFromScience(sci: ScienceBundle, levelId: string | null): ScienceLevel | undefined {
  if (!levelId) return undefined;
  for (const r of sci.routes) {
    const l = r.levels.find((x) => x.levelId === levelId);
    if (l) return l;
  }
  return undefined;
}
