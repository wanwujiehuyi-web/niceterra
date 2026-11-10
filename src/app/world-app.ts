/**
 * WorldApp owns the renderer, camera, resize and the tier lifecycle.
 * The shell (DOM) talks to this class only; tiers (valley / site / object /
 * micro) are swappable modules that render into one THREE.Group.
 *
 * Loading state is driven by main.ts; this class reports tier build progress so
 * the shell never shows a counter for a task that is not enumerable.
 */

import * as THREE from 'three';
import { createRenderer } from '../core/renderer';
import { SkySystem } from '../core/sky';
import type { TierAnchor, TierCameraPose, WorldTier } from '../world/tier';

export interface AnchorHit {
  id: string;
  label: string;
  kind: 'site' | 'object' | 'sample' | 'level';
  siteId?: string;
  routeId?: string;
  levelId?: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface WorldStats {
  fps: number;
  tier: string;
  assetsLoaded: number;
  assetsFailed: number;
  triangles: number;
  drawCalls: number;
}

export interface WorldAppOptions {
  host: HTMLElement;
  reducedMotion: boolean;
  onContextLost?: () => void;
}

export class WorldApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private host: HTMLElement;
  private reducedMotion: boolean;
  private tier: WorldTier | null = null;
  private poseBlend = 1;
  private fromPos = new THREE.Vector3();
  private fromTarget = new THREE.Vector3();
  private targetPos = new THREE.Vector3();
  private targetTarget = new THREE.Vector3();
  private lookAt = new THREE.Vector3(0, 1.2, -8);
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private frames = 0;
  private fpsAt = 0;
  private displayedFps = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  /** Fallback rig used only when a tier brings no lights of its own. */
  private fallbackRig: THREE.Group | null = null;
  private sky: SkySystem | null = null;
  private onContextLost?: () => void;

  constructor(opts: WorldAppOptions) {
    this.host = opts.host;
    this.reducedMotion = opts.reducedMotion;
    this.onContextLost = opts.onContextLost;

    const { renderer } = createRenderer(this.host);
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 4000);
    this.camera.position.set(0.15, 1.5, 14);
    this.camera.lookAt(this.lookAt);

    this.canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.stop();
      this.onContextLost?.();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /** Installs a tier built by loadTierFor() and starts rendering. */
  install(tier: WorldTier, opts: { immediate?: boolean; fadeMs?: number } = {}): void {
    if (this.disposed) {
      tier.dispose();
      return;
    }
    if (this.tier) {
      this.scene.remove(this.tier.group);
      this.tier.dispose();
    }
    this.tier = tier;
    this.scene.add(tier.group);
    this.ensureAtmosphere(tier);
    this.setPose(tier.defaultPose, opts.immediate ?? true);
    this.compile();
    this.start();
    // In-place 400 ms transition (DESIGN_V2 §14): the camera stays, only the
    // incoming tier fades up. Reduced motion skips the animation entirely.
    if (opts.fadeMs && !this.reducedMotion) {
      const fade = opts.fadeMs;
      this.host.classList.add('swapping');
      window.setTimeout(() => this.host.classList.remove('swapping'), fade + 20);
    }
  }

  /**
   * A MeshStandardMaterial tier with zero lights renders pure black, which is
   * what happened to the valley tier. Rather than let a missing rig ship as a
   * "dark scene", install a physically plausible fallback (high-altitude
   * hemisphere + a low warm sun) whenever the tier has no lights of its own.
   * Tiers that light themselves are left untouched.
   */
  private ensureAtmosphere(tier: WorldTier): void {
    let lights = 0;
    let hasSky = false;
    tier.group.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && m.isShaderMaterial && m.side === THREE.BackSide && m.depthTest === false) hasSky = true;
    });

    // Sky + image based lighting. The dome is pinned to the far plane, so it
    // works from a 2 km valley to a 140 km massif view.
    if (!this.sky) {
      this.sky = new SkySystem({ sunDir: new THREE.Vector3(0.42, 0.72, 0.55), lowQuality: false });
      this.sky.group.visible = !hasSky;
      this.scene.add(this.sky.group);
      try {
        this.scene.environment = this.sky.environment(this.renderer);
        this.scene.environmentIntensity = 0.55;
      } catch {
        /* PMREM can fail on weak drivers; the directional rig still lights the scene */
      }
    }
    if (this.sky) this.sky.group.visible = !hasSky;

    if (this.fallbackRig) {
      this.scene.remove(this.fallbackRig);
      this.fallbackRig = null;
    }
    if (lights === 0) {
      const rig = new THREE.Group();
      rig.name = 'fallback-lights';
      rig.add(new THREE.HemisphereLight(0xcfe2f5, 0x4a4636, 1.05));
      rig.add(new THREE.AmbientLight(0xa9bccd, 0.12));
      const sun = new THREE.DirectionalLight(0xffeed2, 1.85);
      sun.position.set(-0.55, 0.62, 0.55).multiplyScalar(1000);
      sun.castShadow = false;
      rig.add(sun);
      const fill = new THREE.DirectionalLight(0x9bb6d6, 0.35);
      fill.position.set(-0.6, 0.35, -0.7).multiplyScalar(1000);
      rig.add(fill);
      this.scene.add(rig);
      this.fallbackRig = rig;
    }

    if (!this.scene.background) {
      this.scene.background = new THREE.Color(0xb7cede);
    }
    // Aerial perspective: without it a 2 km procedural valley reads as flat
    // cut-outs because every ridge is equally saturated. Tiers with their own
    // fog keep it.
    if (!this.scene.fog) {
      this.scene.fog = new THREE.Fog(0xb9cfe2, 1200, 9000);
    }
  }

  get tierId(): string {
    return this.tier?.id ?? 'none';
  }

  /** Warms shaders so the first interactive frame does not hitch. */
  compile(): void {
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      /* compile is an optimisation; never fatal */
    }
  }

  setPose(id: string, immediate = false): void {
    if (!this.tier) return;
    const pose: TierCameraPose | undefined = this.tier.poses[id];
    if (!pose) return;
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.lookAt);
    this.targetPos.fromArray(pose.position);
    this.targetTarget.fromArray(pose.target);
    if (immediate || this.reducedMotion) {
      this.camera.position.copy(this.targetPos);
      this.lookAt.copy(this.targetTarget);
      this.camera.lookAt(this.lookAt);
      this.poseBlend = 1;
    } else {
      this.poseBlend = 0;
    }
  }

  setQuality(low: boolean): void {
    this.tier?.setQuality(low);
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
    this.resize();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.start();
    this.fpsAt = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.tier) {
      if (this.poseBlend < 1) {
        this.poseBlend = Math.min(1, this.poseBlend + dt * 2.2);
        const t = this.poseBlend * this.poseBlend * (3 - 2 * this.poseBlend);
        this.camera.position.lerpVectors(this.fromPos, this.targetPos, t);
        this.lookAt.lerpVectors(this.fromTarget, this.targetTarget, t);
        this.camera.lookAt(this.lookAt);
      }
      this.tier.update(dt, this.camera);
      this.sky?.update(dt, this.camera);
    }
    this.renderer.render(this.scene, this.camera);

    this.frames++;
    const now = performance.now();
    if (now - this.fpsAt >= 500) {
      this.displayedFps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
  }

  /** Projects tier anchors into CSS pixels for the hit targets. */
  anchors(): AnchorHit[] {
    if (!this.tier) return [];
    const rect = this.host.getBoundingClientRect();
    const v = new THREE.Vector3();
    const out: AnchorHit[] = [];
    for (const a of this.tier.anchors as TierAnchor[]) {
      v.copy(a.position).project(this.camera);
      out.push({
        id: a.id,
        label: a.label,
        kind: a.kind,
        siteId: a.siteId,
        routeId: a.routeId,
        levelId: a.levelId,
        x: Math.round(((v.x + 1) / 2) * rect.width),
        y: Math.round(((1 - v.y) / 2) * rect.height),
        visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15
      });
    }
    return out;
  }

  stats(): WorldStats {
    return {
      fps: this.displayedFps,
      tier: this.tier?.id ?? 'none',
      assetsLoaded: this.tier?.stats.assetsLoaded ?? 0,
      assetsFailed: this.tier?.stats.assetsFailed ?? 0,
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls
    };
  }

  /** JPEG capture used for evidence screenshots without a devtools protocol. */
  capture(quality = 0.92): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/jpeg', quality);
  }

  resize(): void {
    if (this.disposed) return;
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.tier) {
      this.scene.remove(this.tier.group);
      this.tier.dispose();
      this.tier = null;
    }
    if (this.sky) {
      this.scene.remove(this.sky.group);
      this.sky.dispose();
      this.sky = null;
    }
    this.renderer.dispose();
  }
}
