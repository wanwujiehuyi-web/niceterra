import * as THREE from 'three';

/**
 * Terrain surface for v2.
 *
 * V1 lesson: a single stretched PBR texture reads as plastic at every distance,
 * and pure vertex colour reads as flat paint. This material keeps the authored
 * vertex hue and multiplies it by three detail scales sampled in world space
 * (metres), so grass, gravel and moss stay readable from 0.5 m to 100 m.
 */

export interface GroundTextures {
  turf: THREE.Texture;
  gravel: THREE.Texture;
  moss: THREE.Texture;
}

export interface GroundMaterialOptions {
  textures: GroundTextures;
  /** Height (metres) of the water surface, used for the wet band near the creek. */
  waterY: (z: number) => number;
  channelDistance: (x: number, z: number) => number;
}

const VERT_PARS = /* glsl */ `
attribute float aBank;
varying float vBank;
varying vec3 vGroundPos;
varying vec3 vGroundNormalW;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vGroundPos;
varying float vBank;
varying vec3 vGroundNormalW;
uniform sampler2D uTurf;
uniform sampler2D uGravel;
uniform sampler2D uMoss;
uniform float uWaterYRef;
`;

const FRAG_COLOR = /* glsl */ `
// Luminance-only detail so three textures never multiply into darkness:
// V1 multiplied albedos and lost 60% of the energy, which read as olive paint.
vec3 gp = vGroundPos;
float gLumTurf = dot(texture2D(uTurf, gp.xz * 0.24).rgb, vec3(0.299, 0.587, 0.114));
float gLumMoss = dot(texture2D(uMoss, gp.xz * 1.90).rgb, vec3(0.299, 0.587, 0.114));
float gLumGravel = dot(texture2D(uGravel, gp.xz * 0.045).rgb, vec3(0.299, 0.587, 0.114));
float gLum = gLumTurf * 0.50 + gLumMoss * 0.30 + gLumGravel * 0.20;
float gGain = clamp(gLum / 0.40, 0.60, 1.45);
float gSlope = 1.0 - clamp(vGroundNormalW.y, 0.0, 1.0);
vec3 gTurfTint = vec3(0.80, 1.06, 0.66);
vec3 gStoneTint = vec3(1.00, 0.98, 0.94);
float gTurfMask = smoothstep(2.3, 4.6, vBank) * clamp(1.0 - gSlope * 1.6, 0.0, 1.0);
vec3 gTint = mix(gStoneTint, gTurfTint, gTurfMask);
diffuseColor.rgb *= mix(1.0, gGain, 0.85) * gTint;
float gWet = 1.0 - smoothstep(0.0, 0.85, abs(vGroundPos.y - uWaterYRef));
diffuseColor.rgb *= 1.0 - 0.30 * gWet;
`;

export function createGroundMaterial(opts: GroundMaterialOptions): THREE.MeshStandardMaterial {
  const { textures } = opts;
  for (const tex of [textures.turf, textures.gravel, textures.moss]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }
  const uniforms = {
    uTurf: { value: textures.turf },
    uGravel: { value: textures.gravel },
    uMoss: { value: textures.moss },
    uWaterYRef: { value: 0 }
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.45
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n' +
          'vBank = aBank;\n' +
          'vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
          'vGroundNormalW = normalize(mat3(modelMatrix) * objectNormal);'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  material.customProgramCacheKey = () => 'v2-ground-v1';
  (material as THREE.MeshStandardMaterial & { userData: Record<string, unknown> }).userData.setWaterY = (y: number): void => {
    uniforms.uWaterYRef.value = y;
  };
  return material;
}
