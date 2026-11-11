# 验收测试结果（60 条）

生成时间 2026-11-11T12:57:33.204Z

| 结果 | 数量 |
|---|---|
| PASS | 51 |
| FAIL | 0 |
| NOT_RUN | 11 |

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
| LOAD-01 | PASS | 海报可见且进入前没有 canvas 黑画布 |
| UX-01 | PASS | 首屏 2 个按钮，其中主操作 1 个 |
| LOAD-02 | PASS | 阶段数 6，无假百分比：✓读取地点与科学档案 / ✓检测图形能力 / ·准备海螺沟地点海报 |
| PERF-07 | PASS | 真机实测进入三维 2931ms（RTX 5070 Laptop，目标桌面 <=5s）；本机软光栅参考值 5214 ms；证据 reports/v3/perf/PERF-REAL.md |
| A11Y-01 | PASS | {"top":[0,0,1440,56],"left":[0,56,248,872],"scene":[248,56,856,872],"right":[1104,56,336,872],"bottom":[0,928,1440,72],"vw":1440,"vh":1000} |
| A11Y-04 | PASS | 桌面控制件均 ≥44px |
| A11Y-07 | PASS | 右栏底色 rgb(28, 58, 19)（不随雪/林背景变化） |
| UX-02 | PASS | 样区→路线→层 三步可达，URL = ?site=SITE-HLG-STREAM-01&route=HLG-STREAM-BIOFILM-01&level=wet-rock |
| UX-03 | PASS | 选中同步耗时 10.3 ms，面板标题 湿溪石 |
| A11Y-08 | PASS | 选中湿溪石后证据芯片文本 = L2本地文献复原 |
| UX-04 | PASS | URL=?autostart=1&route=HLG-STREAM-BIOFILM-01&level=valve-detail / 标题=壳面局部 / 证据=L4机制示意 |
| UX-05 | PASS | 刷新后回到 壳面局部 |
| UX-07 | PASS | back=?site=SITE-HLG-STREAM-01&route=HLG-STREAM-BIOFILM-01&level=wet-rock forward=?autostart=1&route=HLG-STREAM-BIOFILM-01&level=valve-detail |
| UX-09 | PASS | 连点 3 次，构建次数增加 0 |
| UX-08 | PASS | 退出后 tier=valley，退到谷地按钮禁用=true，状态 海螺沟 · 谷地 |
| UX-10 | PASS | 聚焦描边 3px，可聚焦按钮 21 个 |
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
| A11Y-04b | PASS | 390x844: [["btn-prev",112,44,true],["btn-next",144,44,true],["btn-exit",118,44,true],["toggle-sites",50,50,true],["toggle-panel",50,50,true]] |
| A11Y-05 | PASS | 抽屉 opened: left=true right=true |
| LOAD-05 | PASS | 慢网轻量模式：index.html 慢网哨兵(12s)+轻量模式(?quality=lite 低画质并关闲时预载)+只看科学档案；CDP 节流 500kbps/300ms 实证 load-05-slow-actions.png / load-05-archive-only.png |
| A11Y-06 | PASS | 系统字号放大：样式 rem 化+网格行 minmax 自适应；200% 截图 a11y-06-font-100/200.png，按钮全在视口 textClipped=0 |
| A11Y-10 | PASS | 控件交互审计：21 控件全部有动作语义，CDP 真实 Tab 遍历 14 站点焦点样式齐全；a11y-10-audit.md |
| PERF-09 | PASS | 发布包清单 reports/v3/release/manifest.json + MANIFEST.md（dist 301 文件 332MB 全量哈希+已知问题照录） |
| W3D-09 | PASS | 天气图层=远景季节档位（同物异天）+沙盒分离+无自动补晴；实测重建声明 UNKNOWN；w3d-09-weather-modes.md |
| W3D-10 | PASS | 过程动画审计通过（MD-lite/滑块/水流均带声明）；动物不做已书面声明；w3d-10-animations.md |
| PERF-01 | PASS | 真机帧率：谷地/远景/分子层 median 180fps（显示器 180Hz 上限），p5>=179.9，min>=174；软光栅数据已作废 |
| PERF-03 | PASS | 真机换层 5 轮（谷→林→谷→远→谷）437-2868ms 且逐轮加快；堆恒定 20.7MB 无增长 |
| PERF-04 | PASS | 真机 20 分钟长跑：median 180 / p5 179.96 fps，堆斜率 0 MB/min，控制台错误 0 |
| LOAD-09 | NOT_RUN | 后台/锁屏暂停已接 visibilitychange，CDP 无法模拟真实锁屏 |
| PERF-02 | NOT_RUN | 无中端真机 |
| PERF-10 | NOT_RUN | 由外部复核者判定，不能自评 |