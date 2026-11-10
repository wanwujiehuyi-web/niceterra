import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
await b.goto('http://127.0.0.1:5388/?autostart=1&site=SITE-HLG-FOREST-01&quality=high');
await new Promise(r => setTimeout(r, 25000));
const st = await b.eval("(() => { try { return JSON.stringify({ phase: document.getElementById('app').dataset.phase, tier: window.__nt ? window.__nt.stats().tier : 'none', tris: window.__nt ? window.__nt.stats().triangles : 0, toast: document.getElementById('toast').textContent, poster: document.querySelector('#poster').hidden }); } catch (e) { return 'ERR ' + e.message; } })()");
console.log('STATE', st);
console.log('ERRORS', JSON.stringify(b.errors.slice(0, 5)));
await b.shot('reports/v3/shots/plot-debug.png').catch(() => {});
await b.close();
