import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
await b.goto("http://127.0.0.1:5388/?autostart=1&quality=low&tour=0");
await b.waitFor("(() => { try { return window.__nt.stats().triangles > 0; } catch { return false; } })()", 600000);
await new Promise(r => setTimeout(r, 2000));
await b.shot('reports/v3/acceptance/a11y-06-font-100.png');
await b.eval("document.documentElement.style.fontSize = '200%'");
await new Promise(r => setTimeout(r, 2500));
await b.shot('reports/v3/acceptance/a11y-06-font-200.png');
// 放大后核查：主要按钮是否仍在视口内且未被裁切
console.log(await b.eval(`(() => {
  const ids = ['btn-enter','btn-prev','btn-exit','btn-far','toggle-sites'];
  const vw = innerWidth, vh = innerHeight;
  const rows = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { rows.push(id + ': MISSING'); continue; }
    const r = el.getBoundingClientRect();
    rows.push(id + ': ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' @(' + Math.round(r.left) + ',' + Math.round(r.top) + ') inViewport=' + (r.right <= vw && r.bottom <= vh && r.left >= 0 && r.top >= 0));
  }
  // 通用裁切检查：任何按钮文本溢出按钮盒
  let clipped = 0;
  document.querySelectorAll('button').forEach(el => { if (el.scrollWidth > el.clientWidth + 2) clipped++; });
  rows.push('textClippedButtons=' + clipped);
  return JSON.stringify(rows, null, 1);
})()`));
await b.close();
