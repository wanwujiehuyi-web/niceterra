import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
await b.goto("http://127.0.0.1:5388/?autostart=1&quality=low&tour=0");
// LOAD-05 证据：12s 后慢网操作应出现（WARP 下核心层必然超过 12s）
await new Promise(r => setTimeout(r, 16000));
const slow = await b.eval(`(() => {
  const box = document.getElementById('slow-actions');
  return JSON.stringify({ visible: box && !box.hidden, text: box?.querySelector('.slow-why')?.textContent ?? '' });
})()`);
console.log('SLOW-ACTIONS', slow);
await b.shot('reports/v3/acceptance/load-05-slow-actions.png');
// 等核心层就绪后做 A11Y-06 放大对比
await b.waitFor("(() => { try { return window.__nt.stats().triangles > 0; } catch { return false; } })()", 600000);
await new Promise(r => setTimeout(r, 1500));
await b.shot('reports/v3/acceptance/a11y-06-font-100.png');
await b.eval("document.documentElement.style.fontSize = '200%'");
await new Promise(r => setTimeout(r, 2500));
await b.shot('reports/v3/acceptance/a11y-06-font-200.png');
console.log('FONT200', await b.eval(`(() => {
  const ids = ['btn-prev','btn-next','btn-exit','btn-far','toggle-sites'];
  const rows = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { rows.push(id + ':MISSING'); continue; }
    const r = el.getBoundingClientRect();
    rows.push(id + ':' + Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) + ' inView=' + (r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0));
  }
  let clipped = 0;
  document.querySelectorAll('button').forEach(el => { if (el.scrollWidth > el.clientWidth + 2) clipped++; });
  rows.push('textClipped=' + clipped);
  return JSON.stringify(rows);
})()`));
await b.close();
