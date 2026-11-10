/** Capture canonical views with a real browser, waiting for the right tier. */
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.NT_BASE || 'http://127.0.0.1:5388';
const OUT = 'reports/v3/shots';
mkdirSync(OUT, { recursive: true });

const tierReady = (id) => "(() => { try { const s = window.__nt.stats(); return s.tier === " + JSON.stringify(id) + " && s.triangles > 0 && document.getElementById('app').dataset.phase === 'interactive'; } catch { return false; } })()";

const views = [
  { name: '01-poster', url: BASE + '/', wait: "(() => { const el = document.querySelector('#poster-stages'); return !!el && el.children.length >= 6; })()", settle: 600 },
  { name: '02-valley', url: BASE + '/?autostart=1', wait: tierReady('valley') },
  { name: '03-stream-site', url: BASE + '/?autostart=1&site=SITE-HLG-STREAM-01', wait: tierReady('site-stream') },
  { name: '04-micro-wet-rock', url: BASE + '/?autostart=1&route=HLG-STREAM-BIOFILM-01&level=wet-rock', wait: tierReady('micro-A') },
  { name: '05-farview', url: BASE + '/?autostart=1&view=far', wait: tierReady('far') },
  { name: '06-forest-site', url: BASE + '/?autostart=1&site=SITE-HLG-FOREST-01', wait: tierReady('site-forest') }
];

const b = await launch({ width: 1440, height: 1000, dpr: 1 });
const out = [];
for (const v of views) {
  b.errors.length = 0;
  const t0 = Date.now();
  let status = 'PASS';
  let stats = null;
  try {
    await b.goto(v.url);
    await b.waitFor(v.wait, 120000, 250);
    if (v.settle) await new Promise((r) => setTimeout(r, v.settle));
    await new Promise((r) => setTimeout(r, 800));
    stats = await b.eval("(() => { try { const s = window.__nt.stats(); return JSON.stringify({ tier: s.tier, tris: s.triangles, calls: s.drawCalls, anchors: window.__nt.anchors().length, phase: document.getElementById('app').dataset.phase }); } catch (e) { return 'no __nt: ' + e.message; } })()");
    await b.shot(OUT + '/' + v.name + '.png');
  } catch (e) {
    status = 'FAIL: ' + e.message;
    await b.shot(OUT + '/' + v.name + '.png').catch(() => {});
  }
  out.push({ view: v.name, status, ms: Date.now() - t0, stats, errors: b.errors.slice(0, 3) });
  console.log(JSON.stringify(out[out.length - 1]));
}
await b.close();
const failed = out.filter((o) => o.status !== 'PASS').length;
console.log(failed === 0 ? 'CAPTURE PASS ' + out.length + '/' + out.length : 'CAPTURE FAIL ' + failed);
process.exit(failed === 0 ? 0 : 1);
