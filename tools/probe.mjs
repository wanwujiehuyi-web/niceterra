import { launch } from './cdp.mjs';
const b = await launch({ width: 800, height: 600 });
try {
  await b.goto(process.argv[2]);
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const st = await b.eval("(() => { try { return JSON.stringify(window.__nt ? window.__nt.stats() : {nt:null}); } catch(e){ return JSON.stringify({err:String(e)}); } })()");
    console.log('t+' + (i+1)*10 + 's', st.slice(0, 300));
    const s = JSON.parse(st);
    if (s.tier === 'site-stream' && s.triangles > 0) break;
  }
  console.log('ERRORS:', JSON.stringify(b.errors.slice(0, 10)));
} finally { await b.close(); }
