/**
 * Terrain surface for the valley tier.
 *
 * A vertex-coloured MeshStandardMaterial reads as painted clay at any real
 * distance, which is exactly what the first render looked like. This material
 * keeps the vertex colours (they carry the geomorphology classes) but modulates
 * them with triplanar PBR textures so the surface has grain at three scales:
 *   1. micro detail  -> rock / ground albedo, world-space, 4 repeats per metre
 *   2. macro variation -> low frequency noise to break texture tiling
 *   3. per-vertex class tint -> the geology/ecology classification
 * Cliff faces use the vertical projection; valley floor and moraine use the
 * top-down projection, blended by the world normal.
 */

import * as THREE from 'three';

export interface TerrainTextureSet {
  rock: THREE.Texture;
  ground: THREE.Texture;
  gravel: THREE.Texture;
  rockNormal: THREE.Texture;
  noise: THREE.Texture;
}

const BASE = '/textures/pbr/';

function load(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      BASE + url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => reject(new Error('texture failed: ' + url))
    );
  });
}

let cache: Promise<TerrainTextureSet> | null = null;

export function loadTerrainTextures(): Promise<TerrainTextureSet> {
  if (cache) return cache;
  cache = (async () => {
    const [rock, ground, gravel, rockNormal] = await Promise.all([
      load('rockface/albedo.jpg', true),
      load('moss/albedo.jpg', true),
      load('riverbed/albedo.jpg', true),
      load('rockface/normal.png', false)
    ]);
    // A tiny procedural noise texture keeps the macro layer free of network cost.
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    let seed = 1337;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const grid: number[] = [];
    for (let i = 0; i < 16 * 16; i++) grid.push(rnd());
    const at = (x: number, y: number): number => grid[(y & 15) * 16 + (x & 15)];
    const smooth = (t: number): number => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        let amp = 0.5;
        let freq = 1 / 32;
        for (let o = 0; o < 4; o++) {
          const fx = x * freq;
          const fy = y * freq;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = smooth(fx - x0);
          const ty = smooth(fy - y0);
          const a = at(x0, y0);
          const b = at(x0 + 1, y0);
          const c = at(x0, y0 + 1);
          const d = at(x0 + 1, y0 + 1);
          v += amp * (a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty);
          amp *= 0.5;
          freq *= 2;
        }
        const k = (y * size + x) * 4;
        const n = Math.min(255, Math.max(0, Math.round(v * 255)));
        data[k] = n;
        data[k + 1] = n;
        data[k + 2] = n;
        data[k + 3] = 255;
      }
    }
    const noise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    noise.wrapS = THREE.RepeatWrapping;
    noise.wrapT = THREE.RepeatWrapping;
    noise.needsUpdate = true;
    return { rock, ground, gravel, rockNormal, noise };
  })();
  return cache;
}

export interface TerrainMaterialOptions {
  textures: TerrainTextureSet;
  /** Texture repeats per metre for the micro layer. */
  microScale?: number;
  /** World size of the macro variation layer, in metres. */
  macroSize?: number;
}

export function createTerrainMaterial(opts: TerrainMaterialOptions): THREE.MeshStandardMaterial {
  const micro = opts.microScale ?? 0.28;
  const macroSize = opts.macroSize ?? 900;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.4
  });

  const uniforms = {
    uRock: { value: opts.textures.rock },
    uGround: { value: opts.textures.ground },
    uGravel: { value: opts.textures.gravel },
    uRockNormal: { value: opts.textures.rockNormal },
    uNoise: { value: opts.textures.noise },
    uMicro: { value: micro },
    uMacro: { value: 1 / macroSize },
    uSnowLine: { value: 4200 }
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;'
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        uniform sampler2D uRock;
        uniform sampler2D uGround;
        uniform sampler2D uGravel;
        uniform sampler2D uRockNormal;
        uniform sampler2D uNoise;
        uniform float uMicro;
        uniform float uMacro;
        uniform float uSnowLine;
        vec3 triplanar(sampler2D tex, vec3 p, vec3 w) {
          vec3 x = texture2D(tex, p.zy).rgb;
          vec3 y = texture2D(tex, p.xz).rgb;
          vec3 z = texture2D(tex, p.xy).rgb;
          return x * w.x + y * w.y + z * w.z;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 n = normalize(vWNrm);
          vec3 bw = pow(abs(n), vec3(3.0));
          bw /= max(bw.x + bw.y + bw.z, 1e-4);
          vec3 p = vWPos * uMicro;
          vec3 rockC = triplanar(uRock, p, bw);
          vec3 groundC = triplanar(uGround, p * 1.31, bw);
          vec3 gravelC = triplanar(uGravel, p * 1.73, bw);

          float macro = texture2D(uNoise, vWPos.xz * uMacro).r;
          float macro2 = texture2D(uNoise, vWPos.xz * uMacro * 4.7 + 0.37).r;

          // The vertex colour carries the geomorphology class, so the texture may
          // only supply grain. Blend textures by class, then desaturate them so a
          // green moss map can never tint an ice surface green.
          float green = clamp((vColor.g - max(vColor.r, vColor.b)) * 3.4, 0.0, 1.0);
          float bright = (vColor.r + vColor.g + vColor.b) / 3.0;
          float ice = clamp((bright - 0.45) * 2.2, 0.0, 1.0) * clamp(1.0 - green * 2.0, 0.0, 1.0);
          float steep = smoothstep(0.32, 0.66, 1.0 - n.y);

          vec3 surf = mix(rockC, groundC, green);
          surf = mix(surf, gravelC, (1.0 - green) * 0.45 * (1.0 - steep));
          surf = mix(surf, rockC, steep * 0.55);

          float lum = dot(surf, vec3(0.2126, 0.7152, 0.0722));
          surf = mix(surf, vec3(lum), mix(0.45, 0.88, ice));

          surf *= mix(0.78, 1.24, macro) * mix(0.92, 1.06, macro2);
          surf = mix(surf, vec3(0.97, 0.98, 0.99), ice * 0.55);

          diffuseColor.rgb *= surf;
        }`
      );
  };

  // Hypothesis mode moves this uniform only; the science data is never edited.
  mat.userData.snowLineUniform = uniforms.uSnowLine;
  mat.userData.baselineSnowLine = uniforms.uSnowLine.value;
  mat.customProgramCacheKey = () => 'terrain-triplanar-v1';
  return mat;
}

export function disposeTerrainMaterial(mat: THREE.Material): void {
  mat.dispose();
}
