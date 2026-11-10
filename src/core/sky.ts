import * as THREE from 'three';

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(vec2(p.x * 0.3183099, p.y * 0.3678794) + 0.1);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
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
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCoverage;
uniform float uTime;
uniform float uHaze;
uniform float uSunIntensity;

const float PI = 3.14159265359;

${NOISE_GLSL}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);

  // Base sky gradient (tuned so the horizon is pale and the zenith saturated).
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.72)) * 1.06;

  // Sun: broad forward scatter + tight glow + small disc.
  float cosSun = clamp(dot(dir, uSunDir), -1.0, 1.0);
  float glow = pow(max(cosSun, 0.0), 7.0) * 0.16 + pow(max(cosSun, 0.0), 220.0) * 1.6;
  float disc = smoothstep(0.99965, 0.99992, cosSun) * 26.0;
  sky += uSunColor * (glow + disc) * uSunIntensity;

  // Cumulus deck, projected onto a flat plane one unit above the eye.
  vec2 plane = dir.xz / max(dir.y, 0.16);
  vec2 wind = vec2(uTime * 0.0045, uTime * 0.0018);
  vec2 q = plane * 1.05 * vec2(1.0, 1.28) + wind;
  vec2 warp = vec2(fbm(q * 0.75 + 3.1), fbm(q * 0.75 + 8.7)) - 0.5;
  q += warp * 0.55;

  float base = fbm(q * 1.05);
  float detail = fbm(q * 2.9 + 17.0);
  float n = clamp((base * 0.74 + detail * 0.36 - 0.135) / 0.23, 0.0, 1.0);

  float edge = 0.46 - uCoverage * 0.34;
  float cloud = smoothstep(edge, edge + 0.20, n);

  float toward = clamp((fbm((q + uSunDir.xz * 0.22) * 1.05) * 0.74 + detail * 0.36 - 0.135) / 0.23, 0.0, 1.0);
  float selfShadow = clamp(0.54 + (n * 0.23 + 0.135 - toward) * 9.0, 0.0, 1.0);

  vec3 cloudCol = mix(uCloudShade, uCloudLit, selfShadow);
  float sunGlow = pow(max(cosSun, 0.0), 6.0);
  cloudCol = mix(cloudCol, uCloudLit * 1.04, sunGlow * 0.5 * cloud);
  cloudCol *= 0.94 + detail * 0.16;

  float above = smoothstep(0.004, 0.030, dir.y);
  float deckFade = smoothstep(0.006, 0.075, dir.y);
  cloud *= above * deckFade * deckFade;

  vec3 col = mix(sky, cloudCol, cloud);

  // Horizon haze band.
  float band = exp(-max(h, 0.0) * 18.0);
  col = mix(col, uHorizon + vec3(0.02, 0.02, 0.01), band * 0.30 * uHaze);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyOptions {
  sunDir: THREE.Vector3;
  lowQuality?: boolean;
}

/**
 * v2 sky: single inverted sphere with a procedural atmosphere + cumulus deck.
 * Also generates the PMREM environment map used for image based lighting.
 */
export class SkySystem {
  readonly group = new THREE.Group();
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private coverageTarget: number;

  constructor(opts: SkyOptions) {
    const sunDir = opts.sunDir.clone().normalize();
    this.coverageTarget = 0.70;
    this.uniforms = {
      uSunDir: { value: sunDir },
      uZenith: { value: new THREE.Color(0x2f7ada) },
      uHorizon: { value: new THREE.Color(0xd2e2f0) },
      uSunColor: { value: new THREE.Color(0xfff3d6) },
      uCloudLit: { value: new THREE.Color(0xffffff) },
      uCloudShade: { value: new THREE.Color(0x8fa4bd) },
      uCoverage: { value: this.coverageTarget },
      uTime: { value: 0 },
      uHaze: { value: 1 },
      uSunIntensity: { value: 1 }
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true
    });

    const geometry = new THREE.SphereGeometry(1, opts.lowQuality ? 24 : 48, opts.lowQuality ? 16 : 32);
    this.dome = new THREE.Mesh(geometry, material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.scale.setScalar(1);
    this.group.add(this.dome);
  }

  /** Builds the environment map from a copy of the sky dome. */
  environment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const capture = new THREE.Scene();
    const copy = this.dome.clone();
    copy.scale.setScalar(12);
    capture.add(copy);
    const target = pmrem.fromScene(capture, 0.04);
    pmrem.dispose();
    copy.geometry.dispose();
    (copy.material as THREE.Material).dispose();
    return target.texture;
  }

  sunDirection(): THREE.Vector3 {
    return (this.uniforms.uSunDir.value as THREE.Vector3).clone();
  }

  setSun(dir: THREE.Vector3): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir).normalize();
  }

  setCoverage(value: number): void {
    this.coverageTarget = THREE.MathUtils.clamp(value, 0, 1);
    this.uniforms.uCoverage.value = this.coverageTarget;
  }

  horizonColor(): THREE.Color {
    return (this.uniforms.uHorizon.value as THREE.Color).clone();
  }

  /** Keeps the dome centred on the camera and advances cloud time. */
  update(dt: number, camera: THREE.Camera): void {
    this.uniforms.uTime.value = (this.uniforms.uTime.value as number) + dt;
    this.dome.position.copy(camera.position);
    const far = (camera as THREE.PerspectiveCamera).far ?? 20000;
    this.dome.scale.setScalar(Math.max(100, far * 0.9));
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
  }
}
