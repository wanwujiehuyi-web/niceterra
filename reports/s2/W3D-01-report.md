# W3D-01 卫星影像比对报告 — 海螺沟冰川谷六要素

日期：2026-11-11 · 执行：Kimi Work agent · 判定：**PASS（带已知偏差声明）**

## 材料

- 实测影像：Esri World Imagery z15（海螺沟冰川，~29.58°N 101.94°E），转正为流向往下。
  `reports/s2/hailuogou-esri-z15.png`（原始拼接）、`reports/s2/hailuogou-rot.png`（旋转）
- 我们的复原：`reports/s2/valley-topdown-v3.png`（CAM-T 垂直俯机位，`tools/shot-pose.mjs`）
- 对比图：`reports/s2/W3D-01-comparison.png`（`tools/w3d01-figure.py`）

## 一致项（形态学序列）

| 要素 | 卫星影像 | nt2 谷地 | 判定 |
|---|---|---|---|
| 粒雪盆/积累区 | 上游宽浅亮白区 | FIRN 类高反照率碗形 | ✔ 序列一致 |
| 冰瀑（密集裂隙带） | 碎裂纹理密集带 | ICEFALL+CREVASSE 锯齿裂隙带 + Aholo 冰塔 | ✔ 序列一致；真实裂隙更无序 |
| 表碛冰舌 | 冰瀑以下渐灰 | DEBRIS 类深灰褐 + 漂砾 | ✔ 色调已按影像调深（0x4a443b） |
| 侧碛/终碛 | 影像中隐约可辨垄线 | MORAINE 垄+弧 | ✔ 位置为示意（UNKNOWN） |
| 冰前河道 | 舌端以下辫状水系 | GRAVEL 下切 + 3 股流水 | ✔ |
| 森林坡面 | 两侧暗绿林带上至林线 | FOREST 类 + 锥形剪影林带 | ✔ |

## 已知偏差（声明，不隐瞒）

1. **坐标系旋转**：场景 x=东/z=南的设计坐标系中冰川流向为北→南，真实海螺沟为西→东，相差约 90°。DESIGN_ONLY 声明已存在于 valley.ts 头注。
2. **平面形态简化**：真实冰舌有明显弯曲与中碛条带，我们是缓 S 曲线（centerX 摆动 ±60 m），无中碛。
3. **冰瀑占比**：真实冰瀑段在整个冰川长度中占比更大、更破碎；我们压缩在 s 540–940。
4. **侧碛垄**在俯视中呈规则淡色条带，人工痕迹偏重；真实侧碛更断续。
5. 冰界/表碛厚度/DEM 日期：UNKNOWN（无实测），本层是 L3/L4 形态复原，已在 meta 与 HUD 声明。

## 附带行动项

- W3D-01 俯视取证中发现 Aholo 岩壁模块（taskId 6035905）为平板状几何，俯视读作平铺板块 → 已从谷地撤下，母版留存 `assets-src/aholo/cliff-01.glb`。
- 表碛色调按影像调深（DEBRIS 0x5a5348→0x4a443b，MORAINE 0x6e6759→0x5c574c）。

## 验收基线

改动后 60 条验收须保持 41 PASS / 0 FAIL / 21 NOT_RUN。
