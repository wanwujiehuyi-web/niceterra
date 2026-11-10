
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'D:/niceterra/deploy/app/assets';
const DST = 'D:/niceterra/nt2/public/assets/v2';

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) return null;
  let off = 12, json = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len;
  }
  return json;
}

const mat4 = {
  ident: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  mul(a, b) {
    const o = new Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  trs(t, q, s) {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const [sx, sy, sz] = s;
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1
    ];
  },
  apply(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
    ];
  }
};

function bboxOf(json) {
  const acc = json.accessors || [];
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const visit = (idx, parent) => {
    const n = nodes[idx];
    if (!n) return;
    let local = parent;
    if (n.matrix) local = mat4.mul(parent, n.matrix);
    else if (n.translation || n.rotation || n.scale) {
      local = mat4.mul(parent, mat4.trs(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]));
    }
    if (n.mesh !== undefined) {
      for (const p of meshes[n.mesh].primitives || []) {
        const pos = p.attributes && p.attributes.POSITION !== undefined ? acc[p.attributes.POSITION] : null;
        const idxAcc = p.indices !== undefined ? acc[p.indices] : null;
        tris += Math.floor((idxAcc ? idxAcc.count : (pos ? pos.count : 0)) / 3);
        if (pos && pos.min && pos.max) {
          for (let i = 0; i < 8; i++) {
            const c = [i & 1 ? pos.max[0] : pos.min[0], i & 2 ? pos.max[1] : pos.min[1], i & 4 ? pos.max[2] : pos.min[2]];
            const w = mat4.apply(local, c);
            for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
          }
        }
      }
    }
    for (const c of n.children || []) visit(c, local);
  };
  for (const s of json.scenes || []) for (const r of s.nodes || []) visit(r, mat4.ident());
  if (!Number.isFinite(min[0])) return { tris, size: null };
  return { tris, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], min, max };
}

const roleFor = (rel) => {
  const n = rel.toLowerCase();
  if (n.startsWith('r10/')) return 'hero-prop (aholo Lux3D)';
  if (n.startsWith('r7/')) return 'plot species (R7 Gongga plot)';
  if (/diatom|biofilm|redstone|chloroplast|cell|pollen|grain|lattice|atom|molecule/.test(n)) return 'micro-layer';
  if (/soil|gravel|mycelium|lichen|moss|sprig|aggregate|macro-|embedded/.test(n)) return 'ground-detail';
  if (/spruce|fir|pine|larch|birch|abies|betula|sorbus|maple|oak|tree|snag|log/.test(n)) return 'tree/flora-prop';
  if (/grass|turf|sedge|reed|flower|alpenrose|cushion|fern|shrub|bush|moss-cushion|willow/.test(n)) return 'foliage-card-or-clump';
  if (/ibex|hare|deer|fox|squirrel|owl|woodpecker|duck|heron|otter|frog|trout|marmot|panda|yak|sheep|bird|raptor|goat/.test(n)) return 'fauna';
  if (/rock|boulder|cliff|serac|glacier|stone|scree|granite/.test(n)) return 'rock/geology-prop';
  if (/tent|bridge|cabin|bench|hut|fence/.test(n)) return 'human-prop';
  return 'other';
};

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.toLowerCase().endsWith('.glb')) files.push(p);
  }
};
walk(SRC);
files.sort();

fs.mkdirSync(DST, { recursive: true });
const manifest = [];
let copied = 0, bytes = 0;
for (const p of files) {
  const rel = p.slice(SRC.length + 1).replace(/\\/g, '/');
  const out = path.join(DST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!fs.existsSync(out) || fs.statSync(out).size !== fs.statSync(p).size) {
    fs.copyFileSync(p, out);
    copied++;
  }
  const buf = fs.readFileSync(out);
  bytes += buf.length;
  const json = parseGLB(buf);
  const info = json ? bboxOf(json) : { tris: 0, size: null };
  const imgs = (json && json.images ? json.images : []).map((im) => {
    const bv = im.bufferView !== undefined ? json.bufferViews[im.bufferView] : null;
    return { mime: im.mimeType || '', bytes: bv ? bv.byteLength : 0 };
  });
  manifest.push({
    path: rel,
    role: roleFor(rel),
    bytes: buf.length,
    tris: info.tris,
    sizeM: info.size ? info.size.map((v) => Number(v.toFixed(2))) : null,
    generator: json && json.asset ? json.asset.generator : '',
    skins: json && json.skins ? json.skins.length : 0,
    anims: json && json.animations ? json.animations.length : 0,
    images: imgs.length,
    imageKB: Math.round(imgs.reduce((s, i) => s + i.bytes, 0) / 1024)
  });
}
manifest.sort((a, b) => b.bytes - a.bytes);
fs.writeFileSync(path.join(DST, 'MANIFEST.json'), JSON.stringify({ generated: new Date().toISOString(), source: SRC, count: manifest.length, totalMB: +(bytes / 1048576).toFixed(1), assets: manifest }, null, 1));

const byRole = {};
for (const m of manifest) (byRole[m.role] = byRole[m.role] || []).push(m);
const lines = ['# v2 asset library', '', 'Source: ' + SRC + ' (V1 optimised set)', 'Destination: ' + DST, 'Count: ' + manifest.length + ' GLB, ' + (bytes / 1048576).toFixed(1) + ' MB', ''];
for (const role of Object.keys(byRole).sort()) {
  const list = byRole[role];
  lines.push('## ' + role + ' (' + list.length + ', ' + (list.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(1) + ' MB)');
  lines.push('');
  lines.push('| path | MB | tris | size m | gen |');
  lines.push('|---|---|---|---|---|');
  for (const m of list) lines.push('| ' + m.path + ' | ' + (m.bytes / 1048576).toFixed(2) + ' | ' + m.tris + ' | ' + (m.sizeM ? m.sizeM.join(' x ') : '?') + ' | ' + (m.generator || '').slice(0, 28) + ' |');
  lines.push('');
}
fs.writeFileSync('D:/niceterra/docs/ASSET_LIBRARY.md', lines.join('\n'));
console.log(JSON.stringify({ files: files.length, copied, totalMB: +(bytes / 1048576).toFixed(1), roles: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, v.length])) }, null, 1));
console.log('BIGGEST');
for (const m of manifest.slice(0, 12)) console.log((m.bytes / 1048576).toFixed(2), m.role.slice(0, 22), m.path);
