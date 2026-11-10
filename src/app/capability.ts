/**
 * Capability detection. The app must never claim to be interactive before the
 * renderer has actually produced a frame (DESIGN_V2 §22 loading state machine).
 */

export interface Capability {
  webgl2: boolean;
  webgl1: boolean;
  ok: boolean;
  vendor: string;
  renderer: string;
  maxTextureSize: number;
  dpr: number;
  reducedMotion: boolean;
  software: boolean;
  reason: string;
}

interface DebugInfo {
  UNMASKED_VENDOR_WEBGL?: number;
  UNMASKED_RENDERER_WEBGL?: number;
  VENDOR?: number;
  RENDERER?: number;
}

/** Detects WebGL2 + GPU identity without creating the product renderer. */
export function detectCapability(): Capability {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const result: Capability = {
    webgl2: false,
    webgl1: false,
    ok: false,
    vendor: 'UNKNOWN',
    renderer: 'UNKNOWN',
    maxTextureSize: 0,
    dpr,
    reducedMotion,
    software: false,
    reason: ''
  };
  try {
    const canvas = document.createElement('canvas');
    const probe = (name: 'webgl2' | 'webgl'): WebGLRenderingContext | WebGL2RenderingContext | null => {
      try {
        return canvas.getContext(name, { powerPreference: 'high-performance' }) as
          | WebGLRenderingContext
          | WebGL2RenderingContext
          | null;
      } catch {
        return null;
      }
    };
    const gl2 = probe('webgl2');
    const gl = (gl2 ?? probe('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    result.webgl2 = !!gl2;
    result.webgl1 = !!gl;
    if (!gl) {
      result.reason = 'no-webgl';
      return result;
    }
    result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as DebugInfo | null;
    if (ext) {
      result.vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL ?? ext.VENDOR ?? 0) ?? 'UNKNOWN');
      result.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL ?? ext.RENDERER ?? 0) ?? 'UNKNOWN');
    } else {
      result.vendor = String(gl.getParameter(gl.VENDOR) ?? 'UNKNOWN');
      result.renderer = String(gl.getParameter(gl.RENDERER) ?? 'UNKNOWN');
    }
    result.software = /basic render|swiftshader|software|llvmpipe|warp/i.test(result.renderer);
    result.ok = result.webgl2;
    if (!result.webgl2) result.reason = 'no-webgl2';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (err) {
    result.reason = 'probe-failed: ' + String((err as Error).message).slice(0, 80);
  }
  return result;
}

export function capabilitySummary(cap: Capability): string {
  const backend = cap.software ? '软件光栅化（帧率不作性能证据）' : '硬件加速';
  return cap.webgl2
    ? 'WebGL2 · ' + backend + ' · ' + cap.renderer.slice(0, 74)
    : 'WebGL2 不可用（' + (cap.reason || 'unknown') + '）';
}
