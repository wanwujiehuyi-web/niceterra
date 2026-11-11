# PERF-09 发布包清单

生成：2026-11-11T12:59:31.767Z · git HEAD `20cad7d1`

| 部分 | 根目录 | 文件数 | 体积 |
|---|---|---|---|
| code | `dist` | 301 | 332.2 MB |
| data | `public/data` | 13 | 0.5 MB |
| tests | `tools` | 28 | 0.1 MB |
| evidence | `reports` | 119 | 55.3 MB |

各部分说明：
- **code**（`dist`）：dist/ 静态发布包（vite build，含 three r187 打包 JS/CSS、draco 解码器、GLB/DEM/纹理资产拷贝）
- **data**（`public/data`）：科学数据与 DEM 源（public/data 为运行时数据源，已随构建拷入 dist/data）
- **tests**（`tools`）：验收/冒烟/取证工具链（Node 脚本，CDP 驱动真实 Chrome）
- **evidence**（`reports`）：照片对照、卫星比对、签核材料、验收报告与截图证据

完整性：≤5MB 文件附 sha256（reports 段 ≤3MB）；大文件（GLB/截图）以大小+mtime 核对。

## 已知问题（验收 NOT_RUN 原文照录）

- **W3D-01**：需要与同日 DEM 卫星影像做山脊/群峰遮挡比对；本轮无参考影像
- **W3D-04**：森林群落结构差异需人工目视签核
- **W3D-05**：林木分布均匀性需目视/统计签核
- **W3D-06**：溪流水下河床与泡沫组织需目视签核
- **W3D-07**：湿岩湿线与粗糙度需目视签核
- **W3D-08**：冰退迹地路线关系需目视签核
- **LOAD-03**：换层时长需在目标硬件上测；本机软光栅下不具代表性（点击瞬间 phase=loading-next-level）
- **PERF-06**：首内容时间在软光栅下无意义；海报为纯 DOM，无 JS 依赖（build 4.22 kB HTML）
- **LOAD-09**：后台/锁屏暂停已接 visibilitychange，CDP 无法模拟真实锁屏
- **PERF-02**：无中端真机
- **PERF-10**：由外部复核者判定，不能自评

## 科学边界

程序化图层 L4（雪/冰/表碛/林线/天气档位）非实测；DEM 为 SRTM30m 区域参考 L3；Aholo AI 资产已声明非实测证据；显微层坐标不伪造（UNKNOWN 合法）。
