/**
 * Universal molecular layer smoke (SSR, no GPU): every registered object must
 * build a tier, animate (MOL-02), and dispose cleanly. Exit 0 = PASS.
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

const m = await server.ssrLoadModule('src/micro/molecular.ts');
const { MOLECULAR_OBJECTS, createMolecularTier, findMolecularObject } = m;

let failed = 0;
console.log('registered objects:', MOLECULAR_OBJECTS.length);
for (const o of MOLECULAR_OBJECTS) {
  try {
    const tier = createMolecularTier({ objectId: o.objectId });
    for (let i = 0; i < 10; i++) tier.update(1 / 60, null);
    let tris = 0;
    tier.group.traverse((x) => {
      if (x.isMesh) {
        const g = x.geometry;
        const n = g.getIndex() ? g.getIndex().count : g.getAttribute('position').count;
        tris += Math.floor(n / 3) * (x.isInstancedMesh ? x.count : 1);
      }
    });
    const found = findMolecularObject(o.levelId);
    const ok = tris > 100 && found && found.objectId === o.objectId && tier.poses[tier.defaultPose];
    console.log((ok ? 'PASS ' : 'FAIL ') + o.levelId + ' tris=' + tris + ' tier=' + tier.id);
    if (!ok) failed++;
    tier.dispose();
  } catch (err) {
    console.log('FAIL ' + o.levelId + ' ' + (err && err.message));
    failed++;
  }
}
// unknown ids must throw (honest failure, not silent fallback)
try {
  createMolecularTier({ objectId: 'NOPE-01' });
  console.log('FAIL unknown-object did not throw');
  failed++;
} catch {
  console.log('PASS unknown-object throws');
}
await server.close();
console.log(failed === 0 ? 'ALL PASS' : 'FAILED ' + failed);
process.exit(failed === 0 ? 0 : 1);
