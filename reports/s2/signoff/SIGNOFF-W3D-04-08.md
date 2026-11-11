# W3D-04~08 目视签核材料包

日期：2026-11-11 · 基线提交：a8554ed（验收 v17 = 41 PASS / 0 FAIL / 21 NOT_RUN）
渲染环境：WARP 软渲染（帧率不作性能证据），`quality=high&tour=0`，1440×1000
科学边界：所有植被/表碛/雪冰图层为程序化 L4 制作档位；地形为 SRTM 30m 公开 DEM（L3 区域参考）；AI 生成资产（Aholo）已声明非实测证据。

## 条目与证据对照

| 条目 | 签核问题 | 证据图 | 目视结论（待胡逸确认） |
|---|---|---|---|
| W3D-04 | 森林群落结构差异 | `our-forest2.png`（峨眉冷杉成熟林样区，公开样地 GGFZH01 PUBLIC_COORDINATE） | 可见：25–38m 主干分级、冠层缺口（林窗锚点）、苔藓垫/倒木腐朽阶段锚点；不是"一张树贴图复制"。群落差异通过锚点+分层结构表达 |
| W3D-05 | 林木分布均匀性 | `our-valley-B4.png`（谷地 B 机位谷壁全景）+ `our-forest2.png` | 谷壁林带密度梯度（林线 3640m 过渡）、团块噪声分布，无等距同形网格感；样区内株距有聚集与空缺 |
| W3D-06 | 溪流水下河床与泡沫组织 | `our-stream-water2.png`（林溪与湿石样区 water 机位） | 乳白冰融水（悬移质"冰川粉"质感）+ 半浸湿石（Aholo 6380597 湿石 4 块）+ 阶梯河床；迎水面锚点（流速与湿线）就位 |
| W3D-07 | 湿岩湿线与粗糙度 | `our-stream-water2.png` + `our-valley-C5.png`（冰瀑脚特写，含 Aholo 碎冰堆 6369583） | 溪中湿石水面交接有湿线变暗+高光变化；冰瀑脚碎冰堆与冰塔组合成立 |
| W3D-08 | 冰退迹地路线关系 | `our-valley-A5.png`（A 机位：前景碛垄→冰瀑主体→谷壁夹景）+ `our-farview9.png`（贡嘎远景：冰舌走廊与群峰关系） | 远景层冰舌走廊轴线（DESIGN_ONLY 声明）+ 谷地层退缩迹地序列的空间对应可读取；侧碛/终碛为示意位置（L4 已声明） |

## 各图取证参数

| 图 | URL 参数 | 三角形 | 说明 |
|---|---|---|---|
| our-valley-A5 | `?autostart=1&quality=high&tour=0` pose=A | ~95万 | 谷地主构图（G0 重构后） |
| our-valley-B4 | 同上 pose=B | ~95万 | 谷壁林带 |
| our-valley-C5 | 同上 pose=C | ~95万 | 冰瀑脚特写 |
| our-forest2 | `?autostart=1&site=SITE-HLG-FOREST-01&quality=high&tour=0` | 77.5万 | 森林样区 |
| our-stream-water2 | `?autostart=1&site=SITE-HLG-STREAM-01&quality=high&tour=0` water 机位 | — | 溪流样区 |
| our-farview9 | `?autostart=1&view=far&tier=far&quality=high&tour=0` | 20.9万（LOD 修复后 L0 原生 75m） | 贡嘎远景 A 机位 |

## 已知保留项（不阻塞签核，已排期）

- CAM-C（谷底回望）构图对山壁：其注记本就要求 W3D-02 通视验证后再定机位，随 W3D-02 处理。
- 贡嘎 C4 证据图（谷底视角双面渲染验证）见 `.cache/photo-cmp/our-farview-C4.png`。
- 卫星视角与地面照片视角的表碛明度差已在 W3D-01 声明。
