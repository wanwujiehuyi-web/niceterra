import * as THREE from 'three';

export interface RendererBundle {
  renderer: THREE.WebGLRenderer;
  dispose: () => void;
}

/** Creates the v2 renderer: WebGL2, ACES filmic tonemapping, sRGB output, PCF shadows. */
export function createRenderer(host: HTMLElement): RendererBundle {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  return {
    renderer,
    dispose: () => {
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
