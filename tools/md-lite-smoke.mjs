/**
 * MD-lite behavioural smoke (MOL-01..04 precursor, SSR, no GPU).
 *
 * Proves, without a browser:
 *  - every MaterialClass in the spec maps to a structure with real atoms/bonds (MOL-01 data side);
 *  - update() actually moves atoms when running and does NOT move them when paused (MOL-02);
 *  - vibration amplitude grows with temperature (physics: A ∝ √T);
 *  - structures carry sources (MOL-04) and the time-scale disclaimer is exported for UI (MOL-03).
 *
 * Run: node tools/md-lite-smoke.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import { createServer } from 'vite';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error'
});

const md = await server.ssrLoadModule('src/micro/md-lite.ts');
const {
  MdLite,
  structureForMaterial,
  AMPLITUDE_EXAGGERATION,
  ELEMENTS
} = md;

const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok, evidence });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' — ' + evidence);
};

/* MOL-01: every material class (except UNKNOWN) yields a structure with atoms+bonds */
const classes = ['silicate-rock', 'water-liquid', 'water-ice', 'cellulose-plant', 'silica-opal', 'clay-soil', 'UNKNOWN'];
let mol01ok = true;
const details = [];
for (const cls of classes) {
  const s = structureForMaterial(cls);
  if (cls === 'UNKNOWN') {
    if (s !== null) mol01ok = false;
    details.push('UNKNOWN→null');
    continue;
  }
  if (!s || s.atoms.length < 4 || s.bonds.length < 3) mol01ok = false;
  details.push(cls + ': atoms=' + (s ? s.atoms.length : 0) + ' bonds=' + (s ? s.bonds.length : 0));
}
check('MOL-01', mol01ok, details.join(' | '));

/* MOL-04: every structure has at least one source and a declared dynamics mode */
{
  const bad = classes
    .filter((c) => c !== 'UNKNOWN')
    .map((c) => structureForMaterial(c))
    .filter((s) => !s.sources || s.sources.length === 0 || !['lattice', 'liquid', 'chain'].includes(s.dynamics));
  check('MOL-04', bad.length === 0, 'structures without sources/dynamics: ' + bad.length);
}

/* helper: read first atom position from the Si/O instanced mesh matrix */
function atomPos(sys, idx) {
  const mesh = sys.group.children.find((c) => c.isInstancedMesh && c.name.startsWith('md-atoms'));
  const arr = mesh.instanceMatrix.array;
  return [arr[idx * 16 + 12], arr[idx * 16 + 13], arr[idx * 16 + 14]];
}

/* MOL-02: motion when running, frozen when paused (lattice + liquid) */
for (const cls of ['silicate-rock', 'water-liquid']) {
  const sys = new MdLite(structureForMaterial(cls), { temperatureK: 298, speed: 1 }, 1, 99);
  const before = atomPos(sys, 0);
  for (let i = 0; i < 30; i++) sys.update(1 / 60);
  const after = atomPos(sys, 0);
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  sys.pause();
  const frozen0 = atomPos(sys, 0);
  for (let i = 0; i < 30; i++) sys.update(1 / 60);
  const frozen1 = atomPos(sys, 0);
  const drift = Math.hypot(frozen1[0] - frozen0[0], frozen1[1] - frozen0[1], frozen1[2] - frozen0[2]);
  const ok = moved > 1e-6 && drift === 0;
  check('MOL-02:' + cls, ok, 'moved=' + moved.toExponential(2) + ' nm, pausedDrift=' + drift);
  sys.dispose();
}

/* physics: amplitude ∝ √T — atom excursion at 1192 K should be ~2× that at 298 K */
{
  const excursion = (T) => {
    const sys = new MdLite(structureForMaterial('silicate-rock'), { temperatureK: T, speed: 1 }, 1, 5);
    const p0 = atomPos(sys, 0);
    let maxD = 0;
    for (let i = 0; i < 600; i++) {
      sys.update(1 / 60);
      const p = atomPos(sys, 0);
      maxD = Math.max(maxD, Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]));
    }
    sys.dispose();
    return maxD;
  };
  const e298 = excursion(298);
  const e1192 = excursion(1192);
  const ratio = e1192 / e298;
  const ok = ratio > 1.6 && ratio < 2.4; // √(1192/298) = 2.0 ± 20%
  check('PHYS-SQRT-T', ok, 'excursion298=' + e298.toExponential(2) + ' excursion1192=' + e1192.toExponential(2) + ' ratio=' + ratio.toFixed(2) + ' (expect ~2.0)');
}

/* MOL-03 data side: exaggeration factor is exported and > 1 (must be declared in UI) */
check('MOL-03', typeof AMPLITUDE_EXAGGERATION === 'number' && AMPLITUDE_EXAGGERATION > 1,
  'AMPLITUDE_EXAGGERATION=' + AMPLITUDE_EXAGGERATION + '（须随层元数据声明）');

/* element table sanity: CPK colours + radii for all used elements */
{
  const used = new Set();
  for (const c of classes) {
    const s = structureForMaterial(c);
    if (s) s.atoms.forEach((a) => used.add(a.element));
  }
  const missing = [...used].filter((e) => !ELEMENTS[e]);
  check('ELEMENTS', missing.length === 0, 'used=' + [...used].join(',') + ' missing=' + missing.join(','));
}

await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? 'ALL PASS (' + results.length + ')' : 'FAILED ' + failed + '/' + results.length);
process.exit(failed === 0 ? 0 : 1);
