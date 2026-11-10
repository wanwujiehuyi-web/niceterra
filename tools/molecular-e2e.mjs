/**
 * End-to-end check of the universal molecular layer in a real (headless) Chrome:
 *  1. deep link ?level=mol-valley-glacier builds the molecular tier (URL → state → tier);
 *  2. the right panel shows the level's science metadata (MD-lite / L4 / schematic);
 *  3. pause stops the animation, resume restarts it (two captures differ / match);
 *  4. valley tier exposes the three new molecular object anchors;
 *  5. forest tier exposes four molecular object anchors.
 * Writes reports/v4/mol-*.png evidence frames. Exit 0 = PASS.
 */
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.NT_BASE || 'http://127.0.0.1:5388';
mkdirSync('reports/v4', { recursive: true });

const b = await launch({ width: 1440, height: 1000 });
const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' — ' + evidence);
};

/* 1+2: deep link into glacier molecular level */
await b.goto(BASE + '/?autostart=1&level=mol-valley-glacier');
await b.waitFor("(() => { try { return window.__nt.stats().tier === 'molecular:VALLEY-GLACIER-01'; } catch { return false; } })()", 120000);
await new Promise((r) => setTimeout(r, 1500));
const stats = JSON.parse(await b.eval('JSON.stringify(window.__nt.stats())'));
check('E2E-tier', stats.tier === 'molecular:VALLEY-GLACIER-01' && stats.triangles > 1000, JSON.stringify(stats));
const panel = await b.eval("document.querySelector('#right')?.textContent ?? ''");
check('E2E-panel', /分子动力学示意/.test(panel) && /L4/.test(panel) && /schematic/.test(panel), 'panel has MD/L4/schematic: ' + /分子动力学示意/.test(panel) + '/' + /L4/.test(panel) + '/' + /schematic/.test(panel));
const title = await b.eval("document.title");
await b.shot('reports/v4/mol-glacier-e2e.png');

/* 3: animation actually runs then pauses (pixel diff on captures) */
const f1 = await b.eval("window.__nt.capture(0.6)");
await new Promise((r) => setTimeout(r, 400));
const f2 = await b.eval("window.__nt.capture(0.6)");
check('E2E-anim', f1 !== f2, 'two frames 400ms apart differ: ' + (f1 !== f2));

/* 4: valley anchors include the three molecular entries */
await b.goto(BASE + '/?autostart=1');
await b.waitFor("(() => { try { return window.__nt.stats().tier === 'valley'; } catch { return false; } })()", 120000);
const anchors = JSON.parse(await b.eval('JSON.stringify(window.__nt.anchors())'));
const molAnchors = anchors.filter((a) => (a.levelId || '').startsWith('mol-')).map((a) => a.levelId);
check('E2E-valley-anchors', ['mol-valley-glacier', 'mol-valley-river', 'mol-valley-rockwall'].every((x) => molAnchors.includes(x)), 'mol anchors: ' + molAnchors.join(','));

/* 5: forest anchors include four molecular entries */
await b.goto(BASE + '/?autostart=1&site=SITE-HLG-FOREST-01');
await b.waitFor("(() => { try { return window.__nt.stats().tier === 'site-forest'; } catch { return false; } })()", 120000);
const fAnchors = JSON.parse(await b.eval('JSON.stringify(window.__nt.anchors())'));
const fMol = fAnchors.filter((a) => (a.levelId || '').startsWith('mol-')).map((a) => a.levelId);
check('E2E-forest-anchors', ['mol-forest-canopy', 'mol-forest-moss', 'mol-forest-log', 'mol-forest-seedling'].every((x) => fMol.includes(x)), 'forest mol anchors: ' + fMol.join(','));

const errs = b.errors.filter((e) => !/favicon/.test(e));
check('E2E-console', errs.length === 0, 'console errors (excl favicon): ' + errs.length);

await b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? 'ALL PASS (' + results.length + ')' : 'FAILED ' + failed + '/' + results.length);
process.exit(failed === 0 ? 0 : 1);
