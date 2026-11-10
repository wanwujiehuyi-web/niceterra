# AGENTS.md — nt2（海螺沟旗舰世界）

## 先读
1. `D:/niceterra/docs/WORK_BASELINE_V2.md`（唯一基线）
2. `D:/niceterra/docs/REBUILD_PLAN.md`、`docs/spec/DESIGN_V2.txt`（30 章）
3. `D:/niceterra/docs/ASSET_LIBRARY.md`（194 GLB 真实尺寸）

## 铁律
- 只做海螺沟 + 贡嘎远景。雅家埂红石、橘色藻、非本地动物固定刷新点**不得**进入场景/路线/预加载/网络请求。
- 坐标状态区分 PUBLIC_COORDINATE / DESIGN_ONLY / UNKNOWN / HISTORICAL_SAMPLE / DATED_GEOMETRY / PARENT_RELATIVE；显微对象不得伪造经纬度。
- 证据等级 L1–L5 必须逐层显示；AI/生成图不得作为实测证据；UNKNOWN 是有效状态。
- 微观层必须独立几何或数据视图 + 视场 + 成像 + 颜色声明 + 母体 + 样本状态 + 限制。
- 主操作固定底部；触控 ≥44px；正文 ≥16px；状态不只靠颜色；减少动态效果可用。
- 加载海报先行；只有真实可枚举任务才显示计数；WebGL 失败可读可重试；换层失败保留当前层。
- 不提交 key；不打印 key；不把参考图当产品截图。

## 工程
- 工程根 `D:/niceterra/nt2`；dev `npx vite --host 127.0.0.1 --port <自有端口> --strictPort`（sandbox 下必须显式 127.0.0.1）。node_modules 已装（含 vite EPERM patch）。
- 资产：`public/assets/v2/*.glb`，加载用 `src/core/gltf.ts` 的 `loadGLB` + `fitObject`（GLB 内部单位不是米）。
- 取证：playwright 在本沙箱不可用；用 omni_* 托管浏览器。**所有 omni_* 调用必须显式传自己的 target**，拍完关标签。WARP 软渲染，帧率不作性能证据。
- 报告格式：文件/命令/退出码/证据路径/PASS-FAIL-NOT_RUN/科学边界/付费 taskId+credits/会话成本。
