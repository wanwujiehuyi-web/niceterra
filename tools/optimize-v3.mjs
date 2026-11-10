// v3 asset pipeline: dedup -> prune -> weld -> textureCompress -> metre-scale bake -> quantize -> draco
// usage: node tools/optimize-v3.mjs <in.glb> <out.glb> <longestMetres> [texSize=1024] [draco=1]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, quantize, draco, getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('usage: node tools/optimize-v3.mjs <in.glb> <out.glb> <longestMetres> [texSize] [draco]');
  process.exit(2);
}
const [input, output, longestArg] = args;
const texSize = Number(args[3] || 1024);
const useDraco = args[4] === undefined ? true : args[4] !== '0';
const targetLongest = Number(longestArg);
if (!(targetLongest > 0)) { console.error('bad longestMetres', longestArg); process.exit(2); }

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

const srcBytes = fs.statSync(input).size;
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.listScenes()[0];

const before = getBounds(scene);
const sizeOf = (b) => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
const srcSize = sizeOf(before);
const srcLongest = Math.max(...srcSize);
const factor = targetLongest / srcLongest;

await doc.transform(dedup(), prune(), weld());

// bake uniform metre scale into scene root nodes (translation + scale), normals unaffected
for (const node of scene.listChildren()) {
  const s = node.getScale();
  node.setScale([s[0] * factor, s[1] * factor, s[2] * factor]);
  const t = node.getTranslation();
  if (t[0] || t[1] || t[2]) node.setTranslation([t[0] * factor, t[1] * factor, t[2] * factor]);
}

// texture: square resize + jpeg (Lux3D returns baseColor + metallicRoughness, no normal maps)
if (texSize > 0) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [texSize, texSize], quality: 88 })
  );
}

await doc.transform(quantize());
if (useDraco) await doc.transform(draco({ method: 'edgebreaker' }));

fs.mkdirSync(output.slice(0, output.lastIndexOf('/')) || '.', { recursive: true });
await io.write(output, doc);

const outBytes = fs.statSync(output).size;
const after = getBounds(scene);
const outSize = sizeOf(after);
let tris = 0;
let prims = 0;
let meshes = 0;
for (const mesh of root.listMeshes()) {
  meshes++;
  for (const prim of mesh.listPrimitives()) {
    prims++;
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    tris += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
  }
}
const materials = root.listMaterials().map((m) => ({
  name: m.getName(),
  baseColorTexture: !!m.getBaseColorTexture(),
  metallicRoughnessTexture: !!m.getMetallicRoughnessTexture(),
  normalTexture: !!m.getNormalTexture(),
}));
const images = root.listTextures().map((t) => ({ mime: t.getMimeType(), bytes: t.getSize() }));

const report = {
  input, output, srcBytes, outBytes, factor, targetLongest,
  srcLongest, srcSize, tris, meshes, prims,
  bboxMinAfter: after.min, bboxMaxAfter: after.max, bboxSizeM: outSize, longestM: Math.max(...outSize),
  materials, images, texSize, draco: useDraco,
};
console.log(JSON.stringify(report, null, 2));
