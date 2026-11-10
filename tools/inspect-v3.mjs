// inspect v3 GLBs independently of the optimizer: tris / bytes / metre bbox / texture maps
// usage: node tools/inspect-v3.mjs [dir=public/assets/v3] [outJson=../../reports/v3/inspect-v3.json]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'public/assets/v3';
const outJson = process.argv[3] || 'D:/niceterra/reports/v3/inspect-v3.json';

function mat4Identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mat4Mul(a, b) { // column-major, returns a*b
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k*4 + r] * b[c*4 + k];
    o[c*4 + r] = s;
  }
  return o;
}
function mat4FromTRS(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x*x2, xy = x*y2, xz = x*z2, yy = y*y2, yz = y*z2, zz = z*z2, wx = w*x2, wy = w*y2, wz = w*z2;
  const m = [
    (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
    (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
    (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  return m;
}
function xform(m, p) {
  const [x, y, z] = p;
  return [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
}

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  let off = 12, json = null, binLen = 0, binOff = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8'));
    else if (type === 0x004e4942) { binLen += len; binOff = off + 8; }
    off += 8 + len;
  }
  if (!json) throw new Error('no json chunk');
  return { json, binLen, binOff };
}

function normDivisor(componentType) {
  switch (componentType) {
    case 5120: return 127;   // BYTE normalized
    case 5121: return 255;   // UNSIGNED_BYTE normalized
    case 5122: return 32767; // SHORT normalized
    case 5123: return 65535; // UNSIGNED_SHORT normalized
    default: return 1;
  }
}

function inspect(file) {
  const buf = fs.readFileSync(file);
  const { json } = parseGLB(buf);
  const acc = json.accessors || [];
  let tris = 0, prims = 0;
  const names = (json.meshes || []).map((m) => m.name || '');
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      prims++;
      const mode = p.mode === undefined ? 4 : p.mode;
      const idx = p.indices !== undefined ? acc[p.indices] : null;
      const pos = p.attributes && p.attributes.POSITION !== undefined ? acc[p.attributes.POSITION] : null;
      if (mode !== 4) { tris += 1; continue; }
      tris += Math.floor((idx ? idx.count : pos ? pos.count : 0) / 3);
    }
  }
  const nodeMatrix = (n) => {
    if (n.matrix) return n.matrix.slice();
    return mat4FromTRS(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]);
  };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const walk = (ni, parent) => {
    const n = (json.nodes || [])[ni] || {};
    const world = mat4Mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of (json.meshes[n.mesh].primitives || [])) {
        const a = acc[p.attributes.POSITION];
        if (!a || !a.min || !a.max) continue;
        const norm = a.normalized ? normDivisor(a.componentType) : 1;
        const [x0,y0,z0] = a.min.map((v) => v / norm), [x1,y1,z1] = a.max.map((v) => v / norm);
        for (const c of [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0],[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]]) {
          const w = xform(world, c);
          for (let i = 0; i < 3; i++) { if (w[i] < min[i]) min[i] = w[i]; if (w[i] > max[i]) max[i] = w[i]; }
        }
      }
    }
    for (const ch of n.children || []) walk(ch, world);
  };
  for (const s of json.scenes || []) for (const ni of s.nodes || []) walk(ni, mat4Identity());
  const size = [max[0]-min[0], max[1]-min[1], max[2]-min[2]];
  if (!isFinite(size[0])) size.fill(0);
  const images = (json.images || []).map((im) => {
    const bv = im.bufferView !== undefined ? json.bufferViews[im.bufferView] : null;
    return { mime: im.mimeType || 'png', bytes: bv ? bv.byteLength : 0 };
  });
  const materials = (json.materials || []).map((m) => ({
    name: m.name || '',
    baseColorTexture: !!(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture),
    metallicRoughness: !!(m.pbrMetallicRoughness && m.pbrMetallicRoughness.metallicRoughnessTexture),
    normalTexture: !!m.normalTexture,
    roughness: m.pbrMetallicRoughness ? m.pbrMetallicRoughness.roughnessFactor : undefined,
    metallic: m.pbrMetallicRoughness ? m.pbrMetallicRoughness.metallicFactor : undefined,
  }));
  const ext = json.extensionsUsed || [];
  return {
    bytes: buf.length, tris, prims, meshes: (json.meshes || []).length, meshNames: names,
    nodes: (json.nodes || []).length, materials, images,
    imagesKB: Math.round(images.reduce((s, i) => s + i.bytes, 0) / 1024),
    bboxMin: min.map((v) => +v.toFixed(4)), bboxMax: max.map((v) => +v.toFixed(4)),
    bboxSizeM: size.map((v) => +v.toFixed(4)), longestM: +Math.max(...size).toFixed(4),
    extensions: ext, generator: (json.asset && json.asset.generator) || '',
  };
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort() : [];
const rows = [];
let totalBytes = 0, totalTris = 0;
for (const f of files) {
  const p = path.join(dir, f);
  try {
    const info = inspect(p);
    rows.push({ file: f, ...info });
    totalBytes += info.bytes; totalTris += info.tris;
  } catch (e) {
    rows.push({ file: f, error: String(e && e.message || e) });
  }
}
for (const r of rows) {
  if (r.error) { console.log(String(r.file).padEnd(34), 'ERROR', r.error); continue; }
  const mb = (r.bytes / 1048576).toFixed(2);
  console.log(String(r.file).padEnd(34), mb.padStart(6) + ' MB', String(r.tris).padStart(8) + ' tri', 'bbox ' + r.bboxSizeM.join(' x ') + ' m', 'img ' + r.images.length + '/' + r.imagesKB + 'KB', 'maps=' + r.materials.map((m) => [m.baseColorTexture ? 'bc' : '', m.metallicRoughness ? 'mr' : '', m.normalTexture ? 'n' : ''].filter(Boolean).join('+')).join(','));
}
console.log('TOTAL', (totalBytes / 1048576).toFixed(2), 'MB', totalTris, 'tris', rows.length, 'files');
if (outJson) {
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify({ generated: new Date().toISOString(), dir, count: rows.length, totalMB: +(totalBytes / 1048576).toFixed(2), totalTris, assets: rows }, null, 2) + '\n');
  console.log('wrote', outJson);
}
