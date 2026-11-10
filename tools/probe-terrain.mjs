import { launch } from './cdp.mjs';
const b = await launch({ width: 1440, height: 1000 });
await b.goto('http://127.0.0.1:5388/?autostart=1');
await b.waitFor("window.__nt && window.__nt.stats().tier === 'valley'", 90000);
await new Promise(r => setTimeout(r, 1200));
const info = await b.eval(`(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => null);
  const app = window.__nt.app;
  const scene = app.scene;
  const terrain = scene.getObjectByName('VALLEY-TERRAIN');
  if (!terrain) return 'no terrain';
  terrain.updateMatrixWorld(true);
  const box = new (terrain.geometry.boundingBox ? Object : Object)();
  terrain.geometry.computeBoundingBox();
  const bb = terrain.geometry.boundingBox;
  const cam = app.camera;
  const out = {
    camPos: [cam.position.x.toFixed(1), cam.position.y.toFixed(1), cam.position.z.toFixed(1)],
    terrainBox: [[bb.min.x.toFixed(0), bb.min.y.toFixed(0), bb.min.z.toFixed(0)], [bb.max.x.toFixed(0), bb.max.y.toFixed(0), bb.max.z.toFixed(0)]],
    terrainScale: [terrain.scale.x, terrain.scale.y, terrain.scale.z],
    terrainPos: [terrain.position.x, terrain.position.y, terrain.position.z],
    visible: terrain.visible,
    matSide: terrain.material.side,
    vertexColors: terrain.material.vertexColors,
    opacity: terrain.material.opacity,
    transparent: terrain.material.transparent,
    vertexCount: terrain.geometry.attributes.position.count,
    indexCount: terrain.geometry.index ? terrain.geometry.index.count : null,
    colorsPresent: !!terrain.geometry.attributes.color
  };
  // sample the surface height near the camera by scanning vertices
  const pos = terrain.geometry.attributes.position;
  let best = null, bestD = Infinity;
  for (let i = 0; i < pos.count; i += 7) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = Math.abs(x - cam.position.x) + Math.abs(z - cam.position.z);
    if (d < bestD) { bestD = d; best = [x.toFixed(0), y.toFixed(0), z.toFixed(0)]; }
  }
  out.nearestVertex = best;
  out.nearestDist = bestD.toFixed(1);
  out.camHeightAboveNearest = (cam.position.y - Number(best[1])).toFixed(1);
  return JSON.stringify(out);
})()`);
console.log(info);
console.log('errors:', JSON.stringify(b.errors.slice(0,3)));
await b.close();
