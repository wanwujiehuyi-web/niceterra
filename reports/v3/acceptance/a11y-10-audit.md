# A11Y-10 可见控件交互审计

时间 2026-11-11T10:51:47.500Z · 视口 1440×1000 · 方法：CDP 真实 Tab 键遍历

控件总数 21 · 全部有真实动作语义：是 · Tab 可达站点 14 · 焦点样式缺失 0

**结论：PASS**

## Tab 焦点序列（真实键盘路径）

0. `<button>` "尺度旅程" — outline 2px/solid +shadow
1. `<button>` "自由探索" — outline 2px/solid
2. `<button>` "假设实验" — outline 2px/solid
3. `<button#btn-far>` "贡嘎远景" — outline 2px/solid
4. `<button#toggle-sites>` "样区" — outline 2px/solid
5. `<button#toggle-panel>` "档案" — outline 2px/solid
6. `<button>` "峨眉冷杉成熟林森林样区 · PLANNED" — outline 2px/solid
7. `<button>` "林溪与湿石溪流样区 · PLANNED" — outline 2px/solid
8. `<button>` "冰舌与表碛冰舌样区 · PLANNED" — outline 2px/solid
9. `<button>` "冰川退缩迹地迹地样区 · PLANNED" — outline 2px/solid
10. `<button>` "A湿溪石—生物膜—硅藻—生物硅10 层 · PLANNED" — outline 2px/solid
11. `<button>` "B冰退之后—土壤—根际—磷过程7 层 · PLANNED" — outline 2px/solid
12. `<button>` "C苔藓—叶细胞—叶绿体—光合膜5 层 · PLANNED" — outline 2px/solid
13. `<button>` "D冰表碎屑—微生物群落4 层 · PLANNED" — outline 2px/solid

## 不合格明细

（无）

## disabled 语义与触控尺寸（记录项）

- disabled 且 cursor=not-allowed：2 个（btn-prev、btn-exit）——禁用态不可聚焦为正确语义
- 触控 <44px：`<button>` "尺度旅程" 80×36（记录，A11Y-01/04 另验）
- 触控 <44px：`<button>` "自由探索" 80×36（记录，A11Y-01/04 另验）
- 触控 <44px：`<button>` "假设实验" 80×36（记录，A11Y-01/04 另验）
