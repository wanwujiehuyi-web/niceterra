# 真机性能实测（PERF-01 / 03 / 04 / 07）

- 日期：2026-11-11
- 机器：本机，**NVIDIA GeForce RTX 5070 Laptop GPU**（ANGLE D3D11，WebGL renderer 原文见 JSON）
- 浏览器：Chrome 156.0.8078.81，headed 窗口 1710×986 @ DPR 1.5（屏幕 1707×1067）
- 对象：生产构建（`npx vite build` → `vite preview`，http://127.0.0.1:5390）
- 驱动：`tools/perf-real.mjs`（headed Chrome + CDP；非 headless、非 SwiftShader、不做设备仿真）
- 采样器：`src/core/perf.ts`（`?perf=1` 启用；rAF 实计帧，每秒一桶；堆 5s 一采样）
- 原始数据：[perf-real-2026-11-11T1250.json](perf-real-2026-11-11T1250.json)
- 可视化证据：真机窗口截图（HUD 显示 fps/heap/phase），会话内 kimi-cu 采集

## 结果

| 用例 | 指标 | 实测 | 判定 |
|---|---|---|---|
| PERF-07 | 进入三维时长（含网络/构建，目标桌面 ≤5000ms） | **2931 ms**（复测 3926ms） | PASS |
| PERF-01 | 谷地帧率 60s（去 10s 预热） | median **180** / p5 179.98 / min 174 fps | PASS |
| PERF-01 | 远景帧率 60s | median **180** / p5 179.98 / min 179 fps | PASS |
| PERF-01 | 分子层（硅藻壳路线）60s | median **180** / p5 179.98 / min 179 fps | PASS |
| PERF-03 | 换层计时（5 轮：谷→林→谷→远→谷） | 437–2868 ms；逐轮加快（缓存命中） | PASS |
| PERF-03 | 内存增长（5 轮换层） | 堆恒定 20.7 MB，**无增长** | PASS |
| PERF-04 | 20 分钟长跑（每 2min 远/谷往返搅动） | median 180 / p5 179.96 / mean 178.13 fps（1192 个秒桶） | PASS |
| PERF-04 | 长跑内存 | 首 5 样 = 末 5 样 = 20.7 MB，斜率 **0 MB/min** | PASS |

控制台错误：0。

## 边界与声明

1. 三层帧率中位数均顶在显示器 180 Hz 上限（min ≥174），说明 GPU 余量充足而非"恰好 60"。
2. 长跑中瞬时低帧（最低单秒 1.27 fps）全部出现在每 2 分钟的远/谷往返重建瞬间，占比 <5%（p5 仍 179.96）；稳态不掉帧。
3. 堆采样精度 0.1 MB（performance.memory），20 分钟零增长；更长时间的泄漏排查需 24h 级任务，超出本次范围。
4. 单机构成性能证据的下限样本：RTX 5070 Laptop 为高端卡，**不代表中端机**（PERF-02 仍 NOT_RUN，需中端真机）。
5. 应用内页脚的"WARP 软渲染，非性能结论"是静态免责文案，不适用于本次真实 GPU 运行。
6. 测试期间用户桌面可能有其他活动，瞬时帧率波动包含环境噪声；以分布统计（median/p5）为准。
