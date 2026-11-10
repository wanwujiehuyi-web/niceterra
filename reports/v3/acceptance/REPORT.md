# 验收测试结果（60 条）

生成时间 2026-11-10T13:34:21.322Z

| 结果 | 数量 |
|---|---|
| PASS | 41 |
| FAIL | 0 |
| NOT_RUN | 21 |

## 明细

| 用例 | 结果 | 证据 |
|---|---|---|
| SCI-01 | PASS | 代码 0 处；运行时数据 0 处（设计包 spec 的“排除清单”本身保留，属正确记录） |
| SCI-02 | PASS | 数据同时含 PUBLIC_COORDINATE 与 DESIGN_ONLY；瓦片/样地分列 |
| SCI-03 | PASS | 样区锚点 = UNKNOWN（诚实未知），溪线节点 = DESIGN_ONLY；未宣称穿过 GGFZH01 |
| SCI-04 | PASS | 湿溪石样本 = PLANNED，mustNotClaim 含“不形成名录” |
| SCI-05 | PASS | 坐标状态种类 = PUBLIC_COORDINATE/UNKNOWN/DATED_GEOMETRY/HISTORICAL_SAMPLE；UI 逐条显示状态与来源 |
| SCI-06 | PASS | samples 逐条保留 exposureYear 与 samplingYear（不合并成“年龄”） |
| SCI-07 | PASS | 25 层均有 imaging 与 colorStatus；面板逐层显示 |
| SCI-08 | PASS | dataView 层 = chronosequence,gene-evidence,debris-transect,community-data；UI 标注“数据视图” |
| SCI-09 | PASS | 缺数据处渲染 UNKNOWN（面板与证据页均有） |
| W3D-01 | NOT_RUN | 需要与同日 DEM 卫星影像做山脊/群峰遮挡比对；本轮无参考影像 |
| W3D-02 | PASS | CAM-HLG-C 视线分析已离线实跑：GGFZH01→主峰 visible=false（1348 m 处 4048 m 山脊遮挡），改用谷地导览机位 |
| W3D-03 | PASS | 谷地六要素（粒雪盆/冰瀑/表碛冰舌/侧碛/冰前河道/森林坡面）在 valley.ts 中分别建模 |
| W3D-04 | NOT_RUN | 森林群落结构差异需人工目视签核 |
| W3D-05 | NOT_RUN | 林木分布均匀性需目视/统计签核 |
| W3D-06 | NOT_RUN | 溪流水下河床与泡沫组织需目视签核 |
| W3D-07 | NOT_RUN | 湿岩湿线与粗糙度需目视签核 |
| W3D-08 | NOT_RUN | 冰退迹地路线关系需目视签核 |
| W3D-09 | NOT_RUN | 天气图层分离需产品决定后实现 |
| W3D-10 | NOT_RUN | 动物与过程动画未实现 |
| LOAD-01 | PASS | 海报可见且进入前没有 canvas 黑画布 |
| UX-01 | PASS | 首屏 2 个按钮，其中主操作 1 个 |
| LOAD-02 | PASS | 阶段数 6，无假百分比：✓读取地点与科学档案 / ✓检测图形能力 / ·准备海螺沟地点海报 |
| PERF-07 | NOT_RUN | 进入三维 6615 ms（SwiftShader 软光栅，不能作为产品性能结论；目标桌面 5 s/手机 8 s） |
| A11Y-01 | PASS | {"top":[0,0,1440,56],"left":[0,56,248,872],"scene":[248,56,856,872],"right":[1104,56,336,872],"bottom":[0,928,1440,72],"vw":1440,"vh":1000} |
| A11Y-04 | PASS | 桌面控制件均 ≥44px |
| A11Y-07 | PASS | 右栏底色 rgb(28, 58, 19)（不随雪/林背景变化） |
| UX-02 | PASS | 样区→路线→层 三步可达，URL = ?site=SITE-HLG-STREAM-01&route=HLG-STREAM-BIOFILM-01&level=wet-rock |
| UX-03 | PASS | 选中同步耗时 23.2 ms，面板标题 湿溪石 |
| A11Y-08 | PASS | 选中湿溪石后证据芯片文本 = L2本地文献复原 |
| UX-04 | PASS | URL=?autostart=1&route=HLG-STREAM-BIOFILM-01&level=valve-detail / 标题=壳面局部 / 证据=L4机制示意 |
| UX-05 | PASS | 刷新后回到 壳面局部 |
| UX-07 | PASS | back=?site=SITE-HLG-STREAM-01&route=HLG-STREAM-BIOFILM-01&level=wet-rock forward=?autostart=1&route=HLG-STREAM-BIOFILM-01&level=valve-detail |
| UX-09 | PASS | 连点 3 次，构建次数增加 0 |
| UX-08 | PASS | 退出后 tier=valley，退到谷地按钮禁用=true，状态 海螺沟 · 谷地 |
| UX-10 | PASS | 聚焦描边 3px，可聚焦按钮 20 个 |
| LOAD-03 | NOT_RUN | 换层时长需在目标硬件上测；本机软光栅下不具代表性（点击瞬间 phase=loading-next-level） |
| LOAD-04 | PASS | 换层中当前层保留：tier=valley phase=loading-next-level |
| LOAD-07 | PASS | 拦截 /assets/v2/* 后：interactive |
| LOAD-06 | PASS | 静态档案卡片 5 张 + 重试按钮 |
| LOAD-08 | PASS | loseContext -> phase=context-lost |
| A11Y-09 | PASS | 减少动态效果时换层动画 = none |
| PERF-08 | PASS | 档案显示数据版本与资产版本 |
| PERF-06 | NOT_RUN | 首内容时间在软光栅下无意义；海报为纯 DOM，无 JS 依赖（build 4.22 kB HTML） |
| A11Y-02 | PASS | 1280x720: [["btn-prev",112,44,true],["btn-next",144,44,true],["btn-exit",118,44,true]] |
| A11Y-02b | PASS | 1920x1080 主按钮可见 |
| A11Y-03 | PASS | 4K/DPR2: CSS 3256,2032 backing 3256,2032 |
| PERF-05 | PASS | 3840x2160 截图 + 元数据 sidecar: D:\niceterra\nt2\reports\v3\shots\10-4k-valley.png |
| SCI-10 | PASS | L5 卡片=true，改动材质 0 个，claims 基线仍 25 条（未改写） |
| LOAD-10 | PASS | 预载状态 {"id":"micro-A","state":"prefetched","cacheSize":1}（缓存上限 2） |
| UX-06 | PASS | 新会话分享链接恢复到「完整硅藻壳 · 路线 A」，页签 证据，URL 保留 level=diatom-frustule |
| A11Y-04b | PASS | 390x844: [["btn-prev",110,44,true],["btn-next",133,44,true],["btn-exit",110,44,true],["toggle-sites",50,50,true],["toggle-panel",50,50,true]] |
| A11Y-05 | PASS | 抽屉 opened: left=true right=true |
| LOAD-05 | NOT_RUN | 慢网轻量模式未实现（当前仅静态降级） |
| LOAD-09 | NOT_RUN | 后台/锁屏暂停已接 visibilitychange，CDP 无法模拟真实锁屏 |
| A11Y-06 | NOT_RUN | 系统字号放大：当前布局为 px，不随系统字号缩放（已知缺口） |
| A11Y-10 | NOT_RUN | 本轮未覆盖 |
| PERF-01 | NOT_RUN | 软光栅渲染，帧率不可作为证据 |
| PERF-02 | NOT_RUN | 无中端真机 |
| PERF-03 | NOT_RUN | 视图切换/内存增长需真实 GPU 与长时间采样 |
| PERF-04 | NOT_RUN | 20 分钟长跑需真实 GPU |
| PERF-09 | NOT_RUN | 发布包清单在打包后生成（dist + reports） |
| PERF-10 | NOT_RUN | 由外部复核者判定，不能自评 |