# 海螺沟 V2 · 交付报告（本轮）

生成时间：2026-11-10T12:25:15.483Z
工程：`D:/niceterra/nt2`
预览：`http://127.0.0.1:5388`（dev job `pwsh-23807e680fbd47b8`）

## 1. 这一轮完成的东西

| 层 | 状态 | 证据 |
|---|---|---|
| 海报首屏（DOM 优先，JS 未跑也能画） | 完成 | `reports/v3/shots/01-poster.png` |
| 谷地层 `valley`（冰舌/谷壁/冰碛/溪流） | 可运行 | `02-valley.png`，23,070 tris（软光栅低画质） |
| 样区层 `site-stream` / `site-forest` | 可运行 | `03-stream-site.png` / `06-forest-site.png` |
| 微观层 `micro-A`（路线 A 九层） | 可运行 | `04-micro-wet-rock.png`，9 个锚点 |
| 贡嘎远景 `far`（只读，不可步行） | 可运行 | `05-farview.png`，anchors=[] |
| 4K 证据截图 | 完成 | `10-4k-valley.png` + `10-4k-valley.json` |
| 移动端 390×844 | 完成 | `11-mobile-valley.png` |
| 60 条验收 | 41 PASS / 0 FAIL / 21 NOT_RUN | `reports/v3/acceptance/REPORT.md` |

## 2. 本轮修掉的真实缺陷

1. `src/ui/shell.ts` 用 `#app` 当 root 查 `#poster`（`#poster` 在 `#app` 外）→ 启动即「启动失败：shell: missing #poster」。改为 `document` 查 poster/toast。
2. `src/world/valley.ts` 地形索引 `(a,d,b,b,d,e)` 法线朝下 → FrontSide 剔除后整条谷地只剩山脊细条。改 `(a,b,d,b,e,d)`。
3. `valley` 没有任何光源（`MeshStandardMaterial` 全黑）→ `WorldApp.ensureAtmosphere()` 加 fallback 光照 rig。
4. `src/world/farview.ts` 片元着色器用 GLSL 保留字 `patch`（`ERROR: 0:219: 'patch' : Illegal use of reserved word`）→ 全部改 `patchNoise`。
5. `src/sites/stream.ts` 的 `WATER_VERTEX`/`WATER_FRAGMENT` 被截断（`TS1002: Unterminated string literal`）→ 改模板字符串，tsc 归零。
6. `src/app/state.ts` `patch(history:false)` 走 `syncUrl('none')`，URL 永不更新 → 改为 `syncUrl(history?'push':'replace')`。

## 3. 新增能力

- `src/world/terrain-material.ts`：三平面 PBR 地形材质（rockface / moss / riverbed + 法线 + 程序化噪声），按顶点色的植被/冰权重混合并去饱和。
- 假设实验（L5）：`applyHypothesis(deltaM)` 只改材质 `snowLineUniform`，科学数据零改动；面板给出 L5 卡片与滑块。
- 相邻层预载：`schedulePrefetch()` 空闲 1.4 s 后预载同路线下一层，缓存上限 2，`beforeunload` 清理。
- 取证链：`tools/cdp.mjs`（CDP，不依赖 playwright）→ `tools/capture.mjs` / `tools/shot.mjs` / `tools/acceptance.mjs`。

## 4. 复现命令

```bash
cd D:/niceterra/nt2
npx tsc --noEmit                 # 0
npx vite build                   # 0（JS 824 KB / gzip 230 KB）
node tools/check-shell.mjs       # PASS 55/55
node tools/smoke-tiers.mjs       # SMOKE PASS 8/8
node tools/capture.mjs           # CAPTURE PASS 6/6
node tools/acceptance.mjs        # 41 PASS / 0 FAIL / 21 NOT_RUN
```

## 5. 已知缺口（不粉饰）

- **写实度**：谷地仍是程序化几何 + 三平面纹理，前景空旷、缺少真实岩石与植被密度；尚未达到「写实到每一个角落」。
- **性能**：本机是 SwiftShader 软光栅，帧率一律 NOT_RUN；需要在真实 GPU 上跑 PERF-01/02/03/04。
- **人工签核**：W3D-01/04/05/06/07/08/09/10 需要目视比对。
- **未实现**：慢网轻量模式（LOAD-05）、系统字号缩放（A11Y-06，布局仍是 px）、天气图层（W3D-09）、动物与过程动画（W3D-10）。
- **未上线**：`niceterra.life` 仍是 V1 R11（`assets/main-CZ34b_WM.js`，commit 95e1833）；未通过 60 条与截图签核前不替换。
