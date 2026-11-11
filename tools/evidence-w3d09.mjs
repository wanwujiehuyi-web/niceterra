import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
await b.goto("http://127.0.0.1:5388/?autostart=1&view=far&tier=far&quality=low&tour=0");
await b.waitFor("(() => { try { return window.__nt.stats().tier === 'far' && window.__nt.stats().triangles > 0; } catch { return false; } })()", 600000);
await new Promise(r => setTimeout(r, 2000));
// 季节控制应已出现在右栏
const seg = await b.eval(`(() => {
  const btns = [...document.querySelectorAll('[data-season]')].map(x => ({ d: x.dataset.season, t: x.textContent, pressed: x.getAttribute('aria-pressed') }));
  return JSON.stringify(btns);
})()`);
console.log('season buttons:', seg);
await b.shot('reports/v3/acceptance/w3d-09-season-control.png');
// 切到隆冬档：雪线 3450，山体应明显更白
await b.eval(`[...document.querySelectorAll('[data-season]')].find(x => x.dataset.season === '2026-02-01')?.click()`);
await new Promise(r => setTimeout(r, 4000));
const pressed = await b.eval(`[...document.querySelectorAll('[data-season]')].find(x => x.dataset.season === '2026-02-01')?.getAttribute('aria-pressed')`);
console.log('winter pressed:', pressed);
await b.shot('reports/v3/acceptance/w3d-09-season-winter.png');
await b.close();
