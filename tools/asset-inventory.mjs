
import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'D:/niceterra/deploy/app/assets',
  'D:/niceterra/Matter_Explorer_Handoff/source/public/assets'
];

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) return null;
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json = null;
  let binLen = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4E4F534A) {
      json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    } else if (type === 0x004E4942) {
      binLen += len;
    }
    off += 8 + len;
  }
  if (!json) return null;
  let tris = 0;
  let prims = 0;
  const acc = json.accessors || [];
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      prims++;
      const mode = p.mode === undefined ? 4 : p.mode;
      if (mode !== 4) { tris += 1; continue; }
      const idx = p.indices !== undefined ? acc[p.indices] : null;
      const pos = p.attributes && p.attributes.POSITION !== undefined ? acc[p.attributes.POSITION] : null;
      tris += Math.floor((idx ? idx.count : (pos ? pos.count : 0)) / 3);
    }
  }
  const images = (json.images || []).map((im) => {
    const bv = im.bufferView !== undefined ? json.bufferViews[im.bufferView] : null;
    return { mime: im.mimeType || 'png', bytes: bv ? bv.byteLength : 0, name: im.name || '' };
  });
  const nodes = (json.nodes || []).length;
  const skins = (json.skins || []).length;
  const anims = (json.animations || []).length;
  return { meshes: (json.meshes || []).length, prims, tris, nodes, skins, anims, images, binLen, total, generator: (json.asset && json.asset.generator) || '' };
}

const rows = [];
for (const root of roots) {
  const exists = fs.existsSync(root);
  console.log('scan', root, exists ? '' : '(missing)');
  if (!exists) continue;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.glb')) {
        const st = fs.statSync(p);
        let info = null;
        try { info = parseGLB(fs.readFileSync(p)); } catch (err) { info = { error: String(err) }; }
        rows.push({ root, rel: p.slice(root.length + 1), name: e.name, bytes: st.size, mtime: st.mtimeMs, info });
      }
    }
  };
  walk(root);
}
const deploy = rows.filter((r) => r.root.includes('deploy'));
console.log('total glb', rows.length, 'deploy', deploy.length);
const sorted = deploy.sort((a, b) => b.bytes - a.bytes);
console.log('deploy total MB', (deploy.reduce((s, r) => s + r.bytes, 0) / 1048576).toFixed(1));
for (const r of sorted.slice(0, 25)) console.log((r.bytes / 1048576).toFixed(2).padStart(7), String(r.info && r.info.tris).padStart(8), String(r.info && r.info.meshes).padStart(3), r.rel);
fs.writeFileSync('D:/niceterra/reports/v2/asset-inventory.json', JSON.stringify(rows.map((r) => ({ root: r.root.slice(0, 24), rel: r.rel, bytes: r.bytes, mtime: r.mtime, info: r.info && r.info.error ? { error: r.info.error } : { tris: r.info.tris, meshes: r.info.meshes, prims: r.info.prims, images: r.info.images.length, imgBytes: r.info.images.reduce((s, i) => s + i.bytes, 0), skins: r.info.skins, anims: r.info.anims, generator: r.info.generator } })), null, 0));
console.log('wrote inventory');
