/**
 * PERF 真机采样器：仅在 URL 带 ?perf=1 时启用，默认零开销。
 *
 * 用途：真机性能验收（PERF-01/03/04/07）。数据全部留在页面内
 * window.__ntPerf，由外部 CDP 驱动脚本定时读取；左上角 HUD 供肉眼
 * 与截图核对。不写网络、不写存储、不改任何渲染参数。
 *
 * 数据：
 *  - buckets：每秒一个 FPS 桶（rAF 实计帧数）
 *  - heap：每 5s 一次 JS 堆采样（performance.memory，Chrome 专有，不可得时为空）
 *  - marks：外部打点（换层计时等）
 */

export interface PerfBucket {
  /** 距采样开始的毫秒 */
  t: number;
  fps: number;
}

export interface PerfHeap {
  t: number;
  mb: number;
}

export interface PerfMark {
  name: string;
  t: number;
}

export interface NtPerf {
  startedAt: number;
  frames: number;
  fpsNow: number;
  heapNowMb: number | null;
  buckets: PerfBucket[];
  heap: PerfHeap[];
  marks: PerfMark[];
  /** 打点（换层计时等），t 为距采样开始毫秒 */
  mark: (name: string) => void;
  /** 清空 buckets/heap/marks，用于分段测量；frames 累计不清 */
  reset: () => void;
}

export function installPerfSampler(): void {
  if (!new URLSearchParams(location.search).has('perf')) return;

  const t0 = performance.now();
  const perf: NtPerf = {
    startedAt: t0,
    frames: 0,
    fpsNow: 0,
    heapNowMb: null,
    buckets: [],
    heap: [],
    marks: [],
    mark(name: string) {
      perf.marks.push({ name, t: Math.round(performance.now() - t0) });
    },
    reset() {
      perf.buckets.length = 0;
      perf.heap.length = 0;
      perf.marks.length = 0;
    }
  };
  window.__ntPerf = perf;

  // ---- FPS：rAF 实计 ----
  let bucketStart = t0;
  let bucketFrames = 0;
  const frame = (now: number): void => {
    perf.frames += 1;
    bucketFrames += 1;
    if (now - bucketStart >= 1000) {
      const fps = (bucketFrames * 1000) / (now - bucketStart);
      perf.fpsNow = Math.round(fps * 10) / 10;
      perf.buckets.push({ t: Math.round(now - t0), fps: Math.round(fps * 100) / 100 });
      bucketStart = now;
      bucketFrames = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- 堆：5s 一次（Chrome 专有 API，缺失则保持 null）----
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const sampleHeap = (): void => {
    if (!mem) return;
    const mb = Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
    perf.heapNowMb = mb;
    perf.heap.push({ t: Math.round(performance.now() - t0), mb });
  };
  sampleHeap();
  window.setInterval(sampleHeap, 5000);

  // ---- HUD：纯展示，pointer-events 关闭，不挡任何交互 ----
  const hud = document.createElement('div');
  hud.id = 'perf-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:9999;background:rgba(0,0,0,.72);' +
    'color:#7fff9e;font:12px/1.6 ui-monospace,Consolas,monospace;padding:6px 10px;' +
    'border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(hud);
  window.setInterval(() => {
    const phase = document.getElementById('app')?.dataset.phase ?? '?';
    hud.textContent =
      'PERF fps=' + perf.fpsNow +
      ' heap=' + (perf.heapNowMb == null ? 'n/a' : perf.heapNowMb + 'MB') +
      ' phase=' + phase;
  }, 500);
}
