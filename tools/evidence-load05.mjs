import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
// LOAD-05 证据：CDP 网络节流 500kbps / 300ms 延迟，模拟慢网
await b.send('Network.enable');
await b.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 62500, uploadThroughput: 31250 });
const t0 = Date.now();
await b.goto("http://127.0.0.1:5388/?autostart=1&quality=low&tour=0");
const ok = await b.waitFor("(() => { const box = document.getElementById('slow-actions'); return !!(box && !box.hidden); })()", 300000, 500);
const tShow = ((Date.now() - t0) / 1000).toFixed(1);
console.log('slow-actions visible:', ok, 'after', tShow + 's');
console.log('text:', await b.eval("document.querySelector('#slow-actions .slow-why')?.textContent ?? ''"));
await b.shot('reports/v3/acceptance/load-05-slow-actions.png');
// 点击「只看科学档案」验证静态降级动作真实有效
await b.eval("document.getElementById('btn-archive-only')?.click()");
await new Promise(r => setTimeout(r, 1200));
console.log('after archive click:', await b.eval(`JSON.stringify({ phase: document.getElementById('app').dataset.phase, staticCards: document.querySelectorAll('#static-mode .card').length, posterHidden: document.getElementById('poster').hidden })`));
await b.shot('reports/v3/acceptance/load-05-archive-only.png');
console.log('network timeline: throttled at 500kbps/300ms; slow-actions at +' + tShow + 's');
await b.close();
