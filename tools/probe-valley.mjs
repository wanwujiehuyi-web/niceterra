import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
await b.goto('http://127.0.0.1:5388/?autostart=1');
await b.waitFor("window.__nt && window.__nt.stats().tier === 'valley' && window.__nt.stats().triangles > 0", 90000);
await new Promise(r => setTimeout(r, 1500));
const info = await b.eval(`(() => {
  const app = window.__nt.app;
  const scene = app.scene;
  let lights = 0, meshes = 0, names = [];
  scene.traverse(o => { if (o.isLight) lights++; if (o.isMesh) { meshes++; if (names.length < 12) names.push(o.name || o.type); } });
  const cam = app.camera;
  const dir = new (window.__nt.camera.constructor === Object ? Object : Object)();
  const fwd = { x: 0, y: 0, z: 0 };
  const v = cam.getWorldDirection(new (Object.getPrototypeOf(cam.position).constructor)());
  return JSON.stringify({
    tier: window.__nt.stats(),
    camPos: [cam.position.x.toFixed(1), cam.position.y.toFixed(1), cam.position.z.toFixed(1)],
    camNear: cam.near, camFar: cam.far, fov: cam.fov,
    forward: [v.x.toFixed(2), v.y.toFixed(2), v.z.toFixed(2)],
    lights, meshes, names,
    poses: Object.keys(app.tierId ? {} : {}),
    calls: app.renderer.info.render.calls,
    tris: app.renderer.info.render.triangles,
    bg: scene.background ? (scene.background.isColor ? '#' + scene.background.getHexString() : scene.background.type) : 'none',
    fog: scene.fog ? scene.fog.type : 'none',
    dpr: window.devicePixelRatio,
    canvas: [app.canvas.width, app.canvas.height],
    phase: document.getElementById('app').dataset.phase
  });
})()`);
console.log(info);
const errs = b.errors.slice(0,6);
console.log('errors:', JSON.stringify(errs));
await b.close();
