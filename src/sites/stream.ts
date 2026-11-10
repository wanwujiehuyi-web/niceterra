/**
 * SITE-HLG-STREAM-01 — 林溪与湿石 (Hailuogou flagship site, DESIGN_ONLY).
 *
 * The creek follows the design line STREAM-HLG-01 from the design package:
 * (42,-60)→(36,-38)→(32,-24)→(30,-16)→(28,0)→(34,22)→(40,44)→(44,60) in site ENU metres.
 * Render space is x = east, z = -north, so the polyline is shared through shared.ts.
 * DESIGN_ONLY: the real stream segment is not selected; the geographic anchor of this site is
 * UNKNOWN and this water body is not a surveyed channel.
 *
 * Water quality is the product requirement: a transparent surface that shows the bed, whitewater
 * only where flow interacts with obstacles/steps (contact foam against stones, not random dots),
 * a continuous capillary wet line instead of a black painted band, and one consistent flow
 * direction used by the surface waves, foam streaks, contact rings and the sample-frame normal.
 *
 * ROCK-HLG-01 is the flagship parent object of route A. Its local point is ENU (30, -16, water
 * + 0.12), sampleStatus PLANNED. A clickable sample frame sits on the rock surface and returns its
 * PARENT_RELATIVE position + surface normal; no latitude/longitude is invented for it.
 */

import * as THREE from 'three';
import { SkySystem } from '../core/sky';
import type { ModuleMeta, WorldModule } from '../scene/types';
import type { TierAnchor, TierCameraPose, TierOptions, TierStats, WorldTier } from '../world/tier';
import {
  ASSETS,
  TEX,
  type HeightFn,
  STREAM_RENDER_POINTS,
  SiteResources,
  commitInstances,
  createWind,
  crossCardGeometry,
  fbm2,
  horizontalCardGeometry,
  instantiateAsset,
  loadTexture,
  makeFoamTexture,
  makeMossyRockGeometry,
  makeRng,
  makeSampleFrameTexture,
  nearestStream,
  slopeInfo,
  streamChannelDepth,
  type Rng
} from './shared';

const SITE_ID = 'SITE-HLG-STREAM-01';
const ROUTE_ID = 'HLG-STREAM-BIOFILM-01';
const ROCK_ID = 'ROCK-HLG-01';
const SEED = 20261110;
const UP = new THREE.Vector3(0, 1, 0);

export interface SampleFrame {
  objectId: string;
  sampleStatus: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface StreamStats extends TierStats {
  triangles: number;
  stations: number;
  waterLengthM: number;
  meanWidthM: number;
  cascades: number;
  foamRings: number;
  emergentStones: number;
  footStones: number;
  bankStones: number;
  plants: number;
  rockSampleStatus: string;
}

export interface StreamTier extends WorldTier {
  meta: ModuleMeta;
  rockAnchor: THREE.Object3D;
  getSampleFrame: () => SampleFrame;
  stats: StreamStats;
}

export interface StreamSiteModule extends WorldModule {
  meta: ModuleMeta;
  rockAnchor: THREE.Object3D;
  getSampleFrame: () => SampleFrame;
  stats: StreamStats;
}

interface StreamAnchor extends TierAnchor {
  coordinateStatus?: string;
}

interface Station {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  s: number;
  halfWidth: number;
  bankY: number;
  bedY: number;
  depth: number;
  waterY: number;
  cascade: number;
}

/** DESIGN_ONLY creek DEM: broad valley + incised design channel + riffle/pool relief. */
export function streamDesignHeight(x: number, z: number): number {
  const s = nearestStream(x, z);
  const base = 30 - 0.1 * z + 0.03 * x;
  const macro = (fbm2(x * 0.02, z * 0.02, 4, 77) - 0.5) * 3.6;
  const meso = (fbm2(x * 0.07, z * 0.07, 3, 79) - 0.5) * 0.8;
  const valley = -0.7 * Math.exp(-Math.pow(s.dist / 9.5, 2));
  return base + macro + meso + valley - streamChannelDepth(s.dist);
}

function sampleStations(heightAt: HeightFn, low: boolean, rng: Rng): Station[] {
  const pts = STREAM_RENDER_POINTS;
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segLengths.push(len);
    total += len;
  }
  const step = low ? 2.4 : 1.15;
  const count = Math.max(24, Math.round(total / step));
  const stations: Station[] = [];
  for (let n = 0; n <= count; n++) {
    const s = (n / count) * total;
    let acc = 0;
    let seg = 0;
    while (seg < segLengths.length - 1 && acc + segLengths[seg] < s) {
      acc += segLengths[seg];
      seg++;
    }
    const local = Math.min(1, Math.max(0, (s - acc) / (segLengths[seg] || 1)));
    const ax = pts[seg][0];
    const az = pts[seg][1];
    const bx = pts[seg + 1][0];
    const bz = pts[seg + 1][1];
    const x = ax + (bx - ax) * local;
    const z = az + (bz - az) * local;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    stations.push({
      x,
      z,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      s,
      halfWidth: 1.55 + 0.5 * fbm2(s * 0.05, 3.1, 3, 91) + 0.22 * Math.sin(s * 0.31),
      bankY: heightAt(x, z),
      bedY: heightAt(x, z),
      depth: 0.18 + 0.22 * fbm2(s * 0.13, 7.7, 3, 93),
      waterY: 0,
      cascade: 0
    });
  }
  // water surface: bed + depth, then enforced monotonic toward node 8 (the design DEM rises toward
  // node 8), never below the bed. Pools stay deep because the floor follows the previous level.
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    st.bedY = heightAt(st.x, st.z);
    const raw = st.bedY + st.depth;
    st.waterY = i === 0 ? raw : Math.max(raw, stations[i - 1].waterY + 0.004);
  }
  for (const st of stations) {
    const lx = st.x + st.nx * (st.halfWidth + 2.4);
    const lz = st.z + st.nz * (st.halfWidth + 2.4);
    const rx = st.x - st.nx * (st.halfWidth + 2.4);
    const rz = st.z - st.nz * (st.halfWidth + 2.4);
    st.bankY = Math.max(heightAt(lx, lz), heightAt(rx, rz));
    if (st.bankY < st.waterY + 0.12) st.bankY = st.waterY + 0.12;
  }
  for (let i = 1; i < stations.length; i++) {
    const drop = stations[i].waterY - stations[i - 1].waterY;
    const ds = Math.max(0.5, stations[i].s - stations[i - 1].s);
    const grade = drop / ds;
    const c = THREE.MathUtils.clamp((grade - 0.07) / 0.16, 0, 1);
    stations[i].cascade = Math.max(stations[i].cascade, c);
    stations[i - 1].cascade = Math.max(stations[i - 1].cascade, c * 0.75);
    if (c > 0.35 && rng.next() < 0.5) stations[i].depth *= 0.85;
  }
  return stations;
}

interface Emergent {
  x: number;
  z: number;
  y: number;
  radius: number;
}

interface CoreBuild {
  group: THREE.Group;
  meta: ModuleMeta;
  rockAnchor: THREE.Object3D;
  getSampleFrame: () => SampleFrame;
  stats: StreamStats;
  anchors: StreamAnchor[];
  poses: Record<string, TierCameraPose>;
  update: (dt: number, camera: THREE.Camera) => void;
  setQuality: (low: boolean) => void;
  dispose: () => void;
}

const WATER_VERTEX = `attribute float aDepth;
attribute float aFoam;
attribute vec2 aFlow;
attribute float aShore;
varying vec3 vWorld;
varying float vDepth;
varying float vFoam;
varying vec2 vFlow;
varying float vShore;
void main() {
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
  vWorld = world;
  vDepth = aDepth;
  vFoam = aFoam;
  vFlow = aFlow;
  vShore = aShore;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const WATER_FRAGMENT = `uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoamColor;

varying vec3 vWorld;
varying float vDepth;
varying float vFoam;
varying vec2 vFlow;
varying float vShore;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 flow = normalize(vec3(vFlow.x, 0.0, vFlow.y));
  float along = dot(vWorld, flow);
  float across = vWorld.x * flow.z - vWorld.z * flow.x;
  float t = uTime;

  // two wave trains advected downstream + fine chop
  float w1 = sin(along * 2.2 - t * 1.5 + across * 0.9);
  float w2 = sin(along * 4.9 - t * 2.35 - across * 1.6);
  float chop = (vnoise(vec2(along * 3.1 - t * 1.2, across * 3.4)) - 0.5);
  float chop2 = (vnoise(vec2(along * 7.4 - t * 2.1, across * 8.2)) - 0.5);
  vec3 n = normalize(vec3(
    flow.x * (0.11 * w1 + 0.055 * w2) + 0.075 * chop + 0.04 * chop2,
    1.0,
    flow.z * (0.11 * w1 + 0.055 * w2) + 0.075 * chop + 0.04 * chop2
  ));

  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
  vec3 reflected = reflect(-viewDir, n);
  vec3 skyCol = mix(uHorizon, uZenith, clamp(reflected.y, 0.0, 1.0));
  float spec = pow(max(dot(n, normalize(uSunDir)), 0.0), 140.0) * 2.6;

  float depthMix = smoothstep(0.03, 0.42, vDepth);
  vec3 water = mix(uShallow, uDeep, depthMix);
  water = mix(water, skyCol * 0.5, clamp(fresnel * 0.42, 0.0, 0.46));

  // whitewater only where the build marked an interaction: contact with stones, steps, riffles
  float fnA = fbm(vec2(along * 3.2 - t * 0.95, across * 3.8));
  float fnB = fbm(vec2(along * 6.9 - t * 1.7, across * 6.1));
  float foamMask = smoothstep(0.35, 0.95, vFoam);
  float foam = foamMask * smoothstep(0.42, 0.74, fnA * 0.9 + fnB * 0.45);
  float speck = foamMask * smoothstep(0.68, 0.95, fnB) * 0.65;

  vec3 col = water + skyCol * fresnel * 0.08 + vec3(spec);
  col = mix(col, uFoamColor, clamp(foam + speck, 0.0, 0.88));
  float alpha = mix(0.22, 0.64, depthMix);
  alpha = mix(alpha, 0.94, clamp(foam + speck, 0.0, 1.0));
  alpha *= mix(0.5, 1.0, smoothstep(0.0, 0.6, 1.0 - vShore));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;


async function buildCore(opts: {
  lowQuality: boolean;
  heightAt: HeightFn;
  onProgress?: (done: number, total: number, label: string) => void;
}): Promise<CoreBuild> {
  const low = opts.lowQuality;
  const heightAt = opts.heightAt;
  const progress = opts.onProgress ?? (() => {});
  const rng = makeRng(SEED + 3);
  const res = new SiteResources();
  const wind = createWind();
  const group = new THREE.Group();
  group.name = 'site-hlg-stream-01';
  const stats: StreamStats = {
    assetsLoaded: 0,
    assetsFailed: 0,
    log: [],
    triangles: 0,
    stations: 0,
    waterLengthM: 0,
    meanWidthM: 0,
    cascades: 0,
    foamRings: 0,
    emergentStones: 0,
    footStones: 0,
    bankStones: 0,
    plants: 0,
    rockSampleStatus: 'PLANNED'
  };

  const stations = sampleStations(heightAt, low, rng);
  stats.stations = stations.length;
  stats.waterLengthM = stations[stations.length - 1].s;
  stats.meanWidthM = (stations.reduce((sum, s) => sum + s.halfWidth, 0) / stations.length) * 2;
  const flowX = -stations[0].tx;
  const flowZ = -stations[0].tz;

  progress(1, 6, '设计溪线 STREAM-HLG-01 断面');

  // ---------------------------------------------------------------- ground: banks + bed
  const cols = [-3.2, -2.2, -1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.2, 3.2];
  const rows = stations.length;
  const colsCount = cols.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bedColor = new THREE.Color(0xa89e88);
  const wetColor = new THREE.Color(0x746f60);
  const sandColor = new THREE.Color(0xc9bb9a);
  const mossBank = new THREE.Color(0x7f9a58);
  const tmp = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    const st = stations[r];
    for (let c = 0; c < colsCount; c++) {
      const u = cols[c];
      const d = u * st.halfWidth;
      const px = st.x + st.nx * d;
      const pz = st.z + st.nz * d;
      let py: number;
      if (Math.abs(u) <= 1) {
        py = st.bedY + (st.waterY - st.bedY) * Math.pow(Math.abs(u), 1.7);
      } else {
        const outer = heightAt(px, pz);
        const t = THREE.MathUtils.smoothstep(Math.abs(u), 1, 2.7);
        py = THREE.MathUtils.lerp(st.waterY - 0.03, outer, t);
      }
      positions.push(px, py, pz);
      uvs.push(px / 1.7, st.s / 1.7);
      const wet = py < st.waterY + 0.05;
      const moisture = THREE.MathUtils.clamp(1 - Math.abs(u) * 0.55 + (fbm2(px * 0.3, pz * 0.3, 2, 97) - 0.5) * 0.4, 0, 1);
      tmp.copy(bedColor).lerp(sandColor, moisture * 0.35);
      if (wet) tmp.lerp(wetColor, 0.55 + moisture * 0.3);
      if (Math.abs(u) > 1.05) tmp.lerp(mossBank, Math.max(0, moisture - 0.35) * 0.9);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < colsCount - 1; c++) {
      const a = r * colsCount + c;
      indices.push(a, a + 1, a + colsCount);
      indices.push(a + 1, a + colsCount + 1, a + colsCount);
    }
  }
  const bankGeo = new THREE.BufferGeometry();
  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bankGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  bankGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bankGeo.setIndex(indices);
  bankGeo.computeVertexNormals();
  res.geometry(bankGeo);
  const [bedAlbedo, bedNormal, bedRough] = await Promise.all([
    loadTexture(TEX.riverbedAlbedo),
    loadTexture(TEX.riverbedNormal, { srgb: false }),
    loadTexture(TEX.riverbedRough, { srgb: false })
  ]);
  res.texture(bedAlbedo);
  res.texture(bedNormal);
  res.texture(bedRough);
  const bankMat = res.material(
    new THREE.MeshStandardMaterial({
      map: bedAlbedo,
      normalMap: bedNormal,
      roughnessMap: bedRough,
      color: new THREE.Color(1.45, 1.4, 1.24),
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.6
    })
  );
  const bankMesh = new THREE.Mesh(bankGeo, bankMat);
  bankMesh.receiveShadow = true;
  bankMesh.castShadow = false;
  bankMesh.name = 'stream-bed-banks';
  group.add(bankMesh);

  // Surrounding DESIGN_ONLY valley surface so the creek corridor is embedded in terrain, not
  // floating in an empty world. Outside the bank strip this is the same design DEM the water
  // model samples; it is not a measured hillside.
  {
    const groundTex = await Promise.all([
      loadTexture(TEX.groundColor, { repeat: [34, 34] }),
      loadTexture(TEX.groundNormal, { srgb: false, repeat: [34, 34] }),
      loadTexture(TEX.groundRough, { srgb: false, repeat: [34, 34] })
    ]);
    for (const t of groundTex) res.texture(t);
    const groundSegs = low ? 54 : 104;
    const groundSize = 170;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, groundSegs, groundSegs);
    groundGeo.rotateX(-Math.PI / 2);
    const gp = groundGeo.attributes.position as THREE.BufferAttribute;
    const gc = new Float32Array(gp.count * 3);
    const mossC = new THREE.Color(0x9dbd66);
    const soilC = new THREE.Color(0xa8926a);
    const gravelC = new THREE.Color(0xb9b2a4);
    const wetC = new THREE.Color(0x6d6a58);
    const gtmp = new THREE.Color();
    for (let i = 0; i < gp.count; i++) {
      const px = gp.getX(i);
      const pz = gp.getZ(i) + 2;
      const py = heightAt(px, pz);
      gp.setX(i, px);
      gp.setZ(i, pz);
      gp.setY(i, py);
      const s = nearestStream(px, pz);
      const slope = slopeInfo(heightAt, px, pz).slope;
      const moist = THREE.MathUtils.clamp(0.35 + 0.55 * Math.exp(-Math.pow(s.dist / 18, 2)) + (fbm2(px * 0.05, pz * 0.05, 3, 101) - 0.5) * 0.7, 0, 1);
      gtmp.copy(soilC).lerp(mossC, moist * 0.85);
      gtmp.lerp(gravelC, THREE.MathUtils.clamp((0.55 - moist) * 1.4, 0, 1) * 0.6);
      gtmp.lerp(wetC, THREE.MathUtils.clamp(1 - s.dist / 7, 0, 1) * 0.55);
      gtmp.lerp(gravelC, THREE.MathUtils.clamp((slope - 0.75) * 1.2, 0, 1));
      gc[i * 3] = gtmp.r;
      gc[i * 3 + 1] = gtmp.g;
      gc[i * 3 + 2] = gtmp.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    groundGeo.computeVertexNormals();
    // cut the creek corridor out of this coarse valley plane so the fine bank/water ribbon is
    // visible (the coarse grid would otherwise float over the incised channel).
    {
      const idx = groundGeo.index;
      if (idx) {
        const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
        const kept: number[] = [];
        for (let t = 0; t < idx.count; t += 3) {
          const a = idx.getX(t);
          const b = idx.getX(t + 1);
          const c = idx.getX(t + 2);
          const cx = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3;
          const cz = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;
          if (nearestStream(cx, cz).dist < 4.6) continue;
          kept.push(a, b, c);
        }
        groundGeo.setIndex(kept);
        groundGeo.computeVertexNormals();
      }
    }
    res.geometry(groundGeo);
    const groundMaterial = res.material(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(1.3, 1.24, 1.12),
        map: groundTex[0],
        normalMap: groundTex[1],
        roughnessMap: groundTex[2],
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.4
      })
    );
    const valleyGround = new THREE.Mesh(groundGeo, groundMaterial);
    valleyGround.receiveShadow = true;
    valleyGround.name = 'stream-valley-ground';
    group.add(valleyGround);
  }

  // wet line: continuous capillary band just above the water line (not a black painted strip)
  const wetPositions: number[] = [];
  const wetColors: number[] = [];
  const wetIndices: number[] = [];
  const wetHeights = [0.02, 0.05, 0.11, 0.2];
  const wetAlphas = [0.55, 0.42, 0.22, 0.06];
  for (let r = 0; r < rows; r++) {
    const st = stations[r];
    for (let side = 0; side < 2; side++) {
      const dir = side === 0 ? -1 : 1;
      for (let w = 0; w < wetHeights.length; w++) {
        const px = st.x + st.nx * dir * (st.halfWidth * 0.97);
        const pz = st.z + st.nz * dir * (st.halfWidth * 0.97);
        const py = st.waterY + wetHeights[w];
        wetPositions.push(px, py, pz);
        const shade = 0.16 + w * 0.05;
        wetColors.push(shade, shade * 1.02, shade * 0.9, wetAlphas[w]);
      }
    }
  }
  const wetStride = 2 * wetHeights.length;
  for (let r = 0; r < rows - 1; r++) {
    for (let side = 0; side < 2; side++) {
      for (let w = 0; w < wetHeights.length - 1; w++) {
        const a = r * wetStride + side * wetHeights.length + w;
        const b = (r + 1) * wetStride + side * wetHeights.length + w;
        wetIndices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const wetGeo = new THREE.BufferGeometry();
  wetGeo.setAttribute('position', new THREE.Float32BufferAttribute(wetPositions, 3));
  wetGeo.setAttribute('color', new THREE.Float32BufferAttribute(wetColors, 4));
  wetGeo.setIndex(wetIndices);
  wetGeo.computeVertexNormals();
  res.geometry(wetGeo);
  const wetMat = res.material(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      roughness: 0.12,
      metalness: 0.05,
      envMapIntensity: 1.1,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  const wetLine = new THREE.Mesh(wetGeo, wetMat);
  wetLine.name = 'stream-wet-line';
  wetLine.renderOrder = 1;
  group.add(wetLine);

  progress(2, 6, '河床、湿线与水下砾石');

  // ---------------------------------------------------------------- stones
  const [graniteAlbedo, graniteNormal] = await Promise.all([
    loadTexture(TEX.graniteAlbedo, { repeat: [1.4, 1.4] }),
    loadTexture(TEX.graniteNormal, { srgb: false })
  ]);
  res.texture(graniteAlbedo);
  res.texture(graniteNormal);
  const stoneMat = res.material(
    new THREE.MeshStandardMaterial({
      map: graniteAlbedo,
      normalMap: graniteNormal,
      vertexColors: true,
      roughness: 0.78,
      metalness: 0,
      envMapIntensity: 0.7
    })
  );
  const stoneGeo = makeMossyRockGeometry(SEED + 17, low ? 0 : 1, 0.45);
  res.geometry(stoneGeo);
  const stoneMatrices: THREE.Matrix4[] = [];
  const stoneColors: THREE.Color[] = [];
  const footCount = low ? 45 : 130;
  for (let i = 0; i < footCount; i++) {
    const st = stations[rng.int(0, rows - 1)];
    const u = rng.range(-0.88, 0.88);
    const px = st.x + st.nx * u * st.halfWidth;
    const pz = st.z + st.nz * u * st.halfWidth;
    const radius = rng.range(0.06, 0.24);
    const py = st.bedY + (st.waterY - st.bedY) * Math.pow(Math.abs(u), 1.7) + radius * 0.35;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 0.5), rng.range(0, 6.28), rng.range(0, 0.5), 'YXZ'));
    stoneMatrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        q,
        new THREE.Vector3(radius * rng.range(0.9, 1.5), radius * rng.range(0.55, 0.9), radius * rng.range(0.9, 1.5))
      )
    );
    stoneColors.push(new THREE.Color(0x7d7668).multiplyScalar(rng.range(0.62, 1.1)));
  }
  stats.footStones = stoneMatrices.length;

  const emergent: Emergent[] = [];
  const emergentCount = low ? 5 : 14;
  for (let i = 0; i < emergentCount; i++) {
    const st = stations[rng.int(2, rows - 3)];
    const u = rng.range(-0.72, 0.72);
    const px = st.x + st.nx * u * st.halfWidth;
    const pz = st.z + st.nz * u * st.halfWidth;
    const radius = rng.range(0.22, 0.52);
    const py = st.waterY - radius * 0.25;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.2, 0.2), rng.range(0, 6.28), rng.range(-0.2, 0.2), 'YXZ'));
    stoneMatrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        q,
        new THREE.Vector3(radius * rng.range(1.0, 1.5), radius * rng.range(0.7, 1.0), radius * rng.range(1.0, 1.5))
      )
    );
    stoneColors.push(new THREE.Color(0x8b8476).multiplyScalar(rng.range(0.75, 1.15)));
    emergent.push({ x: px, z: pz, y: st.waterY, radius });
  }
  stats.emergentStones = emergent.length;

  const bankStoneCount = low ? 12 : 34;
  for (let i = 0; i < bankStoneCount; i++) {
    const st = stations[rng.int(0, rows - 1)];
    const side = rng.next() < 0.5 ? -1 : 1;
    const dist = st.halfWidth + rng.range(0.4, 3.4);
    const px = st.x + st.nx * side * dist;
    const pz = st.z + st.nz * side * dist;
    const radius = rng.range(0.25, 1.05);
    const py = heightAt(px, pz) + radius * 0.2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), rng.range(0, 6.28), rng.range(-0.15, 0.15), 'YXZ'));
    stoneMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(radius, radius * rng.range(0.55, 0.85), radius)));
    stoneColors.push(new THREE.Color(0x76705f).multiplyScalar(rng.range(0.7, 1.15)));
  }
  stats.bankStones = bankStoneCount;
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneMatrices.length);
  commitInstances(stones, stoneMatrices, stoneColors);
  stones.castShadow = !low;
  stones.receiveShadow = true;
  stones.name = 'stream-stones';
  group.add(stones);

  progress(3, 6, '湿石母体 ROCK-HLG-01');

  // ---------------------------------------------------------------- ROCK-HLG-01 (flagship parent)
  const rockStationIndex = (() => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rows; i++) {
      const d = Math.hypot(stations[i].x - 30, stations[i].z - 16);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  })();
  const rockStation = stations[rockStationIndex];
  const rockWaterY = rockStation.waterY;
  const rockSampleY = rockWaterY + 0.12;
  const upstream = new THREE.Vector3(rockStation.tx, 0, rockStation.tz).normalize();
  const rockGroup = new THREE.Group();
  rockGroup.name = 'rock-hlg-01';
  rockGroup.position.set(30, 0, 16);
  group.add(rockGroup);
  const framePosition = new THREE.Vector3(30 + upstream.x * 0.55, rockSampleY, 16 + upstream.z * 0.55);
  const frameNormal = upstream.clone().multiplyScalar(-0.75).add(new THREE.Vector3(0, 0.65, 0)).normalize();
  try {
    const glb = await instantiateAsset(ASSETS.biofilmRock, {
      targetLongest: 1.7,
      groundY: 0,
      yaw: 0.8,
      castShadow: false,
      receiveShadow: true
    });
    const box = new THREE.Box3().setFromObject(glb.object);
    glb.object.position.y = rockWaterY + 0.42 - box.max.y;
    rockGroup.add(glb.object);
    rockGroup.updateMatrixWorld(true);
    stats.assetsLoaded++;
    stats.log.push('OK r7-biofilm-rock (ROCK-HLG-01) tris=' + glb.triangles);
  } catch (err) {
    stats.assetsFailed++;
    stats.log.push('FAIL r7-biofilm-rock ' + String((err as Error).message).slice(0, 80));
    const fallbackGeo = makeMossyRockGeometry(SEED + 31, low ? 1 : 2, 0.5);
    res.geometry(fallbackGeo);
    const fallback = new THREE.Mesh(fallbackGeo, stoneMat);
    fallback.scale.set(0.9, 0.55, 0.8);
    fallback.position.y = rockWaterY + 0.05;
    rockGroup.add(fallback);
  }

  // sample frame on the upstream face: raycast onto the parent mesh so the annotation sits on the
  // actual surface (PARENT_RELATIVE, no invented latitude/longitude)
  {
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3(30 + upstream.x * 3.0, rockSampleY, 16 + upstream.z * 3.0);
    raycaster.set(origin, upstream.clone().multiplyScalar(-1));
    raycaster.far = 6;
    rockGroup.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(rockGroup, true);
    if (hits.length > 0) {
      const hit = hits[0];
      framePosition.copy(hit.point);
      if (hit.face) {
        const normalMatrix = new THREE.Matrix3();
        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        frameNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
      }
    }
  }
  const frameTex = makeSampleFrameTexture();
  res.texture(frameTex);
  const frameGeo = new THREE.PlaneGeometry(0.12, 0.12);
  res.geometry(frameGeo);
  const frameMat = res.material(
    new THREE.MeshBasicMaterial({ map: frameTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.95 })
  );
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.name = 'sample-frame-rock-hlg-01';
  frameMesh.position.copy(framePosition).addScaledVector(frameNormal, 0.004);
  frameMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frameNormal);
  frameMesh.renderOrder = 4;
  frameMesh.userData = {
    objectId: ROCK_ID,
    sampleStatus: 'PLANNED',
    position: framePosition.toArray(),
    normal: frameNormal.toArray()
  };
  group.add(frameMesh);
  const ringGeo = new THREE.TorusGeometry(0.075, 0.0016, 5, low ? 32 : 64);
  res.geometry(ringGeo);
  const ringMat = res.material(new THREE.MeshBasicMaterial({ color: 0x8ef0ff, transparent: true, opacity: 0.7, depthWrite: false }));
  const sampleRing = new THREE.Mesh(ringGeo, ringMat);
  sampleRing.position.copy(framePosition).addScaledVector(frameNormal, 0.002);
  sampleRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frameNormal);
  sampleRing.renderOrder = 4;
  group.add(sampleRing);
  const rockAnchor = rockGroup;

  progress(4, 6, '水面、白水与流场');

  // ---------------------------------------------------------------- water surface
  const foamTexture = makeFoamTexture(SEED + 47);
  res.texture(foamTexture);
  const foamTextures: THREE.Texture[] = [];
  const foamRings: THREE.Mesh[] = [];
  const ringGeoBase = new THREE.RingGeometry(0.55, 1.35, low ? 18 : 30, 1);
  res.geometry(ringGeoBase);
  const makeFoamRing = (x: number, y: number, z: number, radius: number, opacity: number): void => {
    const tex = foamTexture.clone();
    tex.needsUpdate = true;
    res.texture(tex);
    const mat = res.material(
      new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
    );
    const ring = new THREE.Mesh(ringGeoBase, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.015, z);
    ring.scale.setScalar(radius);
    ring.renderOrder = 3;
    ring.name = 'foam-contact';
    group.add(ring);
    foamRings.push(ring);
    foamTextures.push(tex);
  };
  for (const e of emergent) makeFoamRing(e.x, e.y, e.z, e.radius * 0.7, 0.5);
  makeFoamRing(30, rockWaterY, 16, 0.34, 0.5);
  stats.foamRings = foamRings.length;

  const waterCols = low ? 7 : 9;
  const waterPositions: number[] = [];
  const waterDepths: number[] = [];
  const waterFoam: number[] = [];
  const waterShore: number[] = [];
  const waterFlow: number[] = [];
  const waterIndices: number[] = [];
  let cascadeCount = 0;
  for (let i = 1; i < rows; i++) if (stations[i].cascade > 0.5) cascadeCount++;
  stats.cascades = cascadeCount;
  for (let r = 0; r < rows; r++) {
    const st = stations[r];
    for (let c = 0; c < waterCols; c++) {
      const u = -1 + (2 * c) / (waterCols - 1);
      const px = st.x + st.nx * u * st.halfWidth;
      const pz = st.z + st.nz * u * st.halfWidth;
      const py = st.waterY + 0.012 * (1 - u * u);
      waterPositions.push(px, py, pz);
      const depth = st.depth * (1 - Math.pow(Math.abs(u), 1.7));
      waterDepths.push(depth);
      waterShore.push(Math.abs(u));
      waterFlow.push(flowX, flowZ);
      let foam = 0;
      if (depth < 0.16) foam += (0.16 - depth) * 2.4;
      foam += Math.max(0, Math.abs(u) - 0.76) * 0.9;
      if (st.cascade > 0.25) foam += st.cascade * 0.95;
      for (let k = Math.max(0, r - 2); k <= Math.min(rows - 1, r + 2); k++) {
        if (stations[k].cascade > 0.45) foam += 0.35;
      }
      for (const e of emergent) {
        const d = Math.hypot(px - e.x, pz - e.z);
        if (d < e.radius * 2.4) foam += (1 - d / (e.radius * 2.4)) * 0.95;
      }
      const dRock = Math.hypot(px - 30, pz - 16);
      if (dRock < 1.7) foam += (1 - dRock / 1.7) * 0.95;
      waterFoam.push(THREE.MathUtils.clamp(foam, 0, 1.2));
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < waterCols - 1; c++) {
      const a = r * waterCols + c;
      waterIndices.push(a, a + 1, a + waterCols);
      waterIndices.push(a + 1, a + waterCols + 1, a + waterCols);
    }
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
  waterGeo.setAttribute('aDepth', new THREE.Float32BufferAttribute(waterDepths, 1));
  waterGeo.setAttribute('aFoam', new THREE.Float32BufferAttribute(waterFoam, 1));
  waterGeo.setAttribute('aShore', new THREE.Float32BufferAttribute(waterShore, 1));
  waterGeo.setAttribute('aFlow', new THREE.Float32BufferAttribute(waterFlow, 2));
  waterGeo.setIndex(waterIndices);
  waterGeo.computeBoundingSphere();
  res.geometry(waterGeo);
  const waterUniforms = {
    uTime: { value: 0 } as THREE.IUniform<number>,
    uSunDir: { value: new THREE.Vector3(-0.62, 0.58, 0.52).normalize() },
    uHorizon: { value: new THREE.Color(0xa9bfcd) },
    uZenith: { value: new THREE.Color(0x2f7ada) },
    uShallow: { value: new THREE.Color(0xb9c6a6) },
    uDeep: { value: new THREE.Color(0x4c6d70) },
    uFoamColor: { value: new THREE.Color(0xf2f5f2) }
  };
  const waterMat = res.material(
    new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'stream-water';
  water.renderOrder = 2;
  group.add(water);

  progress(5, 6, '河岸植被与倒木');

  // ---------------------------------------------------------------- riparian plants + deadwood
  const [fernTex, grassTex, mossTex, barkTex, broadleafTex, branchTex] = await Promise.all([
    loadTexture(TEX.fern),
    loadTexture(TEX.grass),
    loadTexture(TEX.mossCard),
    loadTexture(TEX.bark, { repeat: [2, 3] }),
    loadTexture(TEX.graniteAlbedo),
    loadTexture(TEX.branchA)
  ]);
  for (const t of [fernTex, grassTex, mossTex, barkTex, broadleafTex, branchTex]) res.texture(t);
  const plantGroup = new THREE.Group();
  plantGroup.name = 'stream-riparian-plants';
  group.add(plantGroup);
  const plantGeo = crossCardGeometry(2, 0.3);
  res.geometry(plantGeo);
  const plantSpecs = [
    { tex: fernTex, count: low ? 120 : 520, scale: [0.6, 1.35], color: new THREE.Color(0xd9e6c9), amp: 0.075 },
    { tex: grassTex, count: low ? 90 : 380, scale: [0.28, 0.6], color: new THREE.Color(0xe4e9c6), amp: 0.1 },
    { tex: mossTex, count: low ? 140 : 650, scale: [0.25, 0.65], color: new THREE.Color(0xd7e6bd), amp: 0.018 },
    { tex: broadleafTex, count: low ? 50 : 190, scale: [0.32, 0.75], color: new THREE.Color(0xdde7c8), amp: 0.06 }
  ];
  for (const spec of plantSpecs) {
    const mat = res.material(
      (() => {
        const m = new THREE.MeshStandardMaterial({
          map: spec.tex,
          color: 0xffffff,
          roughness: 0.92,
          metalness: 0,
          side: THREE.DoubleSide,
          alphaTest: 0.34,
          alphaToCoverage: true
        });
        m.envMapIntensity = 0.45;
        return m;
      })()
    );
    wind.apply(mat, 'blade', spec.amp, 1.25);
    const mats: THREE.Matrix4[] = [];
    const plantCols: THREE.Color[] = [];
    let tries = 0;
    while (mats.length < spec.count && tries < spec.count * 40) {
      tries++;
      const st = stations[rng.int(0, rows - 1)];
      const side = rng.next() < 0.5 ? -1 : 1;
      const dist = st.halfWidth + rng.range(0.15, 5.2);
      const px = st.x + st.nx * side * dist;
      const pz = st.z + st.nz * side * dist;
      if (slopeInfo(heightAt, px, pz).slope > 1.5) continue;
      const py = heightAt(px, pz);
      if (py < st.waterY + 0.02) continue;
      const scale = rng.range(spec.scale[0], spec.scale[1]);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), rng.range(-0.1, 0.1), 'YXZ'));
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, py - 0.02, pz), q, new THREE.Vector3(scale * 1.1, scale, scale * 1.1)));
      plantCols.push(spec.color.clone().multiplyScalar(rng.range(0.75, 1.15)));
    }
    const mesh = new THREE.InstancedMesh(plantGeo, mat, Math.max(1, mats.length));
    commitInstances(mesh, mats, plantCols);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'stream-plants';
    plantGroup.add(mesh);
    stats.plants += mats.length;
  }

  // forest backdrop on the banks: a few DESIGN_ONLY conifers for scale and valley context
  {
    const coniferTrunkGeo = new THREE.CylinderGeometry(0.38, 1, 1, low ? 5 : 7, 1, false);
    coniferTrunkGeo.translate(0, 0.5, 0);
    res.geometry(coniferTrunkGeo);
    const coniferTrunkMat = res.material(
      new THREE.MeshStandardMaterial({ map: barkTex, color: 0xe6dfd1, roughness: 0.95, metalness: 0 })
    );
    const coniferCardGeo = horizontalCardGeometry();
    res.geometry(coniferCardGeo);
    const coniferCardMat = res.material(
      (() => {
        const m = new THREE.MeshStandardMaterial({
          map: branchTex,
          color: 0xffffff,
          roughness: 0.86,
          metalness: 0,
          side: THREE.DoubleSide,
          alphaTest: 0.42,
          alphaToCoverage: true
        });
        m.envMapIntensity = 0.5;
        return m;
      })()
    );
    wind.apply(coniferCardMat, 'branch', 0.075, 1.05);
    const tMats: THREE.Matrix4[] = [];
    const tCols: THREE.Color[] = [];
    const cMats: THREE.Matrix4[] = [];
    const cCols: THREE.Color[] = [];
    const treeCount = low ? 9 : 22;
    let placedTrees = 0;
    let guard = 0;
    while (placedTrees < treeCount && guard < 400) {
      guard++;
      const st = stations[rng.int(0, rows - 1)];
      const side = rng.next() < 0.5 ? -1 : 1;
      const dist = st.halfWidth + rng.range(6, 24);
      const px = st.x + st.nx * side * dist;
      const pz = st.z + st.nz * side * dist;
      if (Math.abs(px) > 80 || Math.abs(pz) > 80) continue;
      if (slopeInfo(heightAt, px, pz).slope > 1.15) continue;
      const py = heightAt(px, pz);
      const height = rng.range(11, 21);
      const radius = 0.24 + height * 0.011;
      const yaw = rng.range(0, 6.28);
      tMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, py - 0.15, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')), new THREE.Vector3(radius, height, radius)));
      tCols.push(new THREE.Color(1, 1, 1).multiplyScalar(rng.range(0.55, 0.9)));
      const whorls = rng.int(7, 11);
      for (let w = 0; w < whorls; w++) {
        const u = w / Math.max(1, whorls - 1);
        const rel = 0.28 + u * 0.66;
        const len = height * 0.16 * Math.pow(1 - rel, 0.6) * rng.range(2.1, 3.0);
        const count = Math.max(3, Math.round(6 - u * 2));
        for (let b = 0; b < count; b++) {
          const angle = yaw + (b / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, -0.5 + rng.range(-0.1, 0.1), 'YXZ'));
          cMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, py + height * rel, pz), q, new THREE.Vector3(len, 1, len * 0.7)));
          cCols.push(new THREE.Color(1, 1, 1).multiplyScalar(rng.range(0.8, 1.12)));
        }
      }
      placedTrees++;
    }
    if (tMats.length > 0) {
      const trunks = new THREE.InstancedMesh(coniferTrunkGeo, coniferTrunkMat, tMats.length);
      commitInstances(trunks, tMats, tCols);
      trunks.castShadow = !low;
      trunks.receiveShadow = true;
      trunks.name = 'stream-conifers-trunks';
      group.add(trunks);
      const cards = new THREE.InstancedMesh(coniferCardGeo, coniferCardMat, cMats.length);
      commitInstances(cards, cMats, cCols);
      cards.castShadow = !low;
      cards.receiveShadow = true;
      cards.name = 'stream-conifers-cards';
      group.add(cards);
    }
  }

  const logMat = res.material(new THREE.MeshStandardMaterial({ map: barkTex, color: 0x6f685c, roughness: 0.96, metalness: 0 }));
  for (let i = 0; i < 2; i++) {
    const st = stations[rng.int(6, rows - 6)];
    const side = i === 0 ? 1 : -1;
    const dist = st.halfWidth + rng.range(1.3, 2.4);
    const px = st.x + st.nx * side * dist;
    const pz = st.z + st.nz * side * dist;
    const len = rng.range(3.4, 6.2);
    const rad = rng.range(0.22, 0.36);
    const geo = new THREE.CylinderGeometry(rad * 0.8, rad, len, low ? 6 : 9, 1, false);
    res.geometry(geo);
    const log = new THREE.Mesh(geo, logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rng.range(0, 6.28);
    log.position.set(px, heightAt(px, pz) + rad * 0.8, pz);
    log.castShadow = !low;
    log.receiveShadow = true;
    plantGroup.add(log);
  }

  // ---------------------------------------------------------------- anchors + poses
  const samplePosition = framePosition.clone();
  const sampleNormal = frameNormal.clone();
  const getSampleFrame = (): SampleFrame => ({
    objectId: ROCK_ID,
    sampleStatus: 'PLANNED',
    position: samplePosition.clone(),
    normal: sampleNormal.clone()
  });

  let cascadeIndex = rockStationIndex;
  let cascadeScore = 0;
  for (let i = 0; i < rows; i++) {
    if (stations[i].cascade > cascadeScore) {
      cascadeScore = stations[i].cascade;
      cascadeIndex = i;
    }
  }
  const cascadeStation = stations[cascadeIndex];
  let barIndex = 0;
  let barScore = -1;
  for (let i = 2; i < rows - 2; i++) {
    const a = stations[i - 2];
    const b = stations[i + 2];
    const turn = a.tx * b.tz - a.tz * b.tx;
    if (Math.abs(turn) > barScore) {
      barScore = Math.abs(turn);
      barIndex = i;
    }
  }
  const barStation = stations[barIndex];
  const barSide =
    barStation.tx * stations[Math.min(rows - 1, barIndex + 2)].tz - barStation.tz * stations[Math.min(rows - 1, barIndex + 2)].tx > 0
      ? -1
      : 1;
  const barX = barStation.x + barStation.nx * barSide * (barStation.halfWidth + 2.6);
  const barZ = barStation.z + barStation.nz * barSide * (barStation.halfWidth + 2.6);

  const anchors: StreamAnchor[] = [
    {
      id: 'anchor-stream-rock',
      label: '湿溪石 ROCK-HLG-01 · 采样框（拟观察）',
      kind: 'sample',
      position: samplePosition.clone(),
      siteId: SITE_ID,
      routeId: ROUTE_ID,
      levelId: 'wet-rock',
      coordinateStatus: 'PLANNED'
    },
    {
      id: 'anchor-stream-cascade',
      label: '阶梯跌水 · 设计河床',
      kind: 'object',
      position: new THREE.Vector3(cascadeStation.x, cascadeStation.waterY + 0.1, cascadeStation.z),
      siteId: SITE_ID,
      routeId: ROUTE_ID,
      coordinateStatus: 'DESIGN_ONLY'
    },
    {
      id: 'anchor-stream-face',
      label: '迎水面 · 流速与湿线',
      kind: 'object',
      position: samplePosition.clone().addScaledVector(upstream, 0.55),
      siteId: SITE_ID,
      routeId: ROUTE_ID,
      coordinateStatus: 'DESIGN_ONLY'
    },
    {
      id: 'anchor-stream-bar',
      label: '边滩 · 砾石与砂',
      kind: 'object',
      position: new THREE.Vector3(barX, heightAt(barX, barZ) + 0.3, barZ),
      siteId: SITE_ID,
      routeId: ROUTE_ID,
      coordinateStatus: 'DESIGN_ONLY'
    }
  ];

  const camBPos = new THREE.Vector3(24, heightAt(24, 34) + 0.75, 34);
  const camBTarget = new THREE.Vector3(0, heightAt(0, -20) + 4, -20);
  const rockPosePos = samplePosition.clone().addScaledVector(upstream, 0.72).addScaledVector(UP, 0.3);
  const waterLowStation = stations[Math.min(rows - 1, Math.max(0, Math.round(rows * 0.42)))];
  const poses: Record<string, TierCameraPose> = {
    A: {
      position: [44, heightAt(44, 40) + 6.5, 40],
      target: [31, rockStation.waterY + 4, 2]
    },
    B: { position: [camBPos.x, camBPos.y, camBPos.z], target: [camBTarget.x, camBTarget.y, camBTarget.z] },
    C: { position: [rockPosePos.x, rockPosePos.y, rockPosePos.z], target: [samplePosition.x, samplePosition.y, samplePosition.z] },
    water: {
      position: [
        waterLowStation.x + waterLowStation.tx * 4.2 + waterLowStation.nx * 0.55,
        waterLowStation.waterY + 0.55,
        waterLowStation.z + waterLowStation.tz * 4.2 + waterLowStation.nz * 0.55
      ],
      target: [
        waterLowStation.x - waterLowStation.tx * 7.5,
        waterLowStation.waterY + 0.06,
        waterLowStation.z - waterLowStation.tz * 7.5
      ]
    },
    cascade: {
      position: [
        cascadeStation.x + cascadeStation.tx * 5.0 + cascadeStation.nx * 0.9,
        cascadeStation.waterY + 1.05,
        cascadeStation.z + cascadeStation.tz * 5.0 + cascadeStation.nz * 0.9
      ],
      target: [
        cascadeStation.x - cascadeStation.tx * 1.2,
        cascadeStation.waterY + 0.05,
        cascadeStation.z - cascadeStation.tz * 1.2
      ]
    }
  };

  let tris = 0;
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const count = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
    tris += (count / 3) * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1);
  });
  stats.triangles = Math.round(tris);

  const meta: ModuleMeta = {
    assetId: SITE_ID,
    geometrySource:
      'DESIGN_ONLY procedural creek along design line STREAM-HLG-01 (node coordinates from the design package, not surveyed); ROCK-HLG-01 parent mesh from /assets/v2 r7-biofilm-rock (generated asset, design proxy, not photogrammetry)',
    geometryDate: '2026-11-10',
    coordinateStatus: 'DESIGN_ONLY',
    evidenceLevel: 'L4',
    license: 'CC BY-SA 4.0 (reference imagery) / project asset library',
    placeholder: true
  };

  const detailToggle: THREE.Object3D[] = [plantGroup];
  const setQuality = (nextLow: boolean): void => {
    for (const obj of detailToggle) obj.visible = !nextLow;
    stones.castShadow = !nextLow;
  };

  const elapsedUniform = waterUniforms.uTime;
  const update = (dt: number, _camera: THREE.Camera): void => {
    wind.update(dt);
    elapsedUniform.value += dt;
    const t = elapsedUniform.value;
    for (let i = 0; i < foamTextures.length; i++) {
      const tex = foamTextures[i];
      tex.offset.set((t * 0.045 * flowX + t * 0.012) % 1, (t * 0.06 + i * 0.11) % 1);
    }
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    group.clear();
    res.dispose();
  };

  return { group, meta, rockAnchor, getSampleFrame, stats, anchors, poses, update, setQuality, dispose };
}

/** Builds the stream site module for a host scene that owns lighting (no lights/sky added here). */
export async function buildStreamSite(opts: {
  lowQuality?: boolean;
  heightAt: HeightFn;
  onProgress?: (done: number, total: number, label: string) => void;
}): Promise<StreamSiteModule> {
  const core = await buildCore({ lowQuality: opts.lowQuality === true, heightAt: opts.heightAt, onProgress: opts.onProgress });
  return {
    group: core.group,
    meta: core.meta,
    rockAnchor: core.rockAnchor,
    getSampleFrame: core.getSampleFrame,
    stats: core.stats,
    update: (dt, _elapsed, camera) => core.update(dt, camera),
    setQuality: core.setQuality,
    dispose: core.dispose
  };
}

/** Builds the stream world tier: own DESIGN_ONLY DEM, sky, sun + shadow map, poses and anchors. */
export async function createStreamTier(opts: TierOptions): Promise<StreamTier> {
  const low = opts.lowQuality;
  const progress = opts.onProgress ?? (() => {});
  const core = await buildCore({ lowQuality: low, heightAt: streamDesignHeight, onProgress: progress });
  const group = core.group;

  const sunDir = new THREE.Vector3(-0.62, 0.58, 0.52).normalize();
  const sky = new SkySystem({ sunDir, lowQuality: low });
  sky.setCoverage(0.62);
  group.add(sky.group);
  const sun = new THREE.DirectionalLight(0xfff2dc, 3.4);
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.target.position.set(32, 22, 0);
  sun.castShadow = true;
  const shadowSize = low ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  group.add(sun);
  group.add(sun.target);
  group.add(new THREE.HemisphereLight(0xd2e4f4, 0x7d7562, 1.25));
  group.add(new THREE.AmbientLight(0x83917c, 0.34));
  const fill = new THREE.DirectionalLight(0xb6d0e6, 0.7);
  fill.position.set(46, 18, 38);
  group.add(fill);

  const update = (dt: number, camera: THREE.PerspectiveCamera): void => {
    sky.update(dt, camera);
    core.update(dt, camera);
  };
  const dispose = (): void => {
    core.group.remove(sky.group);
    sky.dispose();
    core.dispose();
  };

  progress(6, 6, '林溪样区就绪');
  return {
    id: 'site-stream',
    group,
    poses: core.poses,
    defaultPose: 'B',
    anchors: core.anchors,
    stats: core.stats,
    meta: core.meta,
    rockAnchor: core.rockAnchor,
    getSampleFrame: core.getSampleFrame,
    update,
    setQuality: core.setQuality,
    dispose
  };
}
