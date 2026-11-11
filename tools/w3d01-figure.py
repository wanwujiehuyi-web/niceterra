# W3D-01 比对图：海螺沟卫星影像（Esri World Imagery）vs nt2 谷地俯视
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

# 中文字体：用系统微软雅黑
fm.fontManager.addfont('C:/Windows/Fonts/msyh.ttc')
plt.rcParams['font.family'] = 'Microsoft YaHei'
plt.rcParams['axes.unicode_minus'] = False
from PIL import Image

sat = Image.open('reports/s2/hailuogou-rot.png').crop((30, 60, 560, 1260))
ours = Image.open('reports/s2/valley-topdown-scene.png')
# 注：用 v2 截图（构图周正）；DEBRIS/MORAINE 已在其后按卫星影像调深，见 pass15
ours = ours

fig, (a1, a2) = plt.subplots(1, 2, figsize=(14, 13), dpi=110, facecolor='#101810')

a1.imshow(sat)
a1.set_title('实测卫星影像（Esri World Imagery z15，转正为流向往下）', color='w', fontsize=13)
a1.axis('off')
# 卫星图标注（坐标按裁剪后 530x1200）
ann1 = [
    ('粒雪盆/积累区', 120, 120, 150, 60),
    ('冰瀑（密集裂隙带）', 210, 380, 300, 300),
    ('表碛冰舌（越往下越灰）', 200, 700, 310, 620),
    ('冰舌末端/冰前', 180, 1010, 280, 950),
    ('东侧谷壁·森林', 430, 500, 380, 450),
]
for text, x, y, tx, ty in ann1:
    a1.annotate(text, xy=(x, y), xytext=(tx, ty), color='#ffe9b0', fontsize=11,
                arrowprops=dict(arrowstyle='->', color='#ffe9b0', lw=1.4))

a2.imshow(ours)
a2.set_title('nt2 谷地俯视（CAM-T 机位，程序化 L3/L4 复原）', color='w', fontsize=13)
a2.axis('off')
# 我们的图 856x872：上=冰瀑，中=表碛冰舌，下=冰前河道
ann2 = [
    ('冰瀑与裂隙', 430, 130, 620, 90),
    ('表碛冰舌', 430, 380, 640, 330),
    ('侧碛/终碛', 430, 520, 660, 520),
    ('森林坡面', 150, 480, 60, 420),
    ('冰前河道', 430, 790, 650, 740),
]
for text, x, y, tx, ty in ann2:
    a2.annotate(text, xy=(x, y), xytext=(tx, ty), color='#bfe3ff', fontsize=11,
                arrowprops=dict(arrowstyle='->', color='#bfe3ff', lw=1.4))

fig.suptitle('W3D-01 形态学比对：海螺沟冰川谷 · 六要素序列一致性核查', color='w', fontsize=15)
fig.tight_layout()
fig.savefig('reports/s2/W3D-01-comparison.png', facecolor=fig.get_facecolor(), bbox_inches='tight')
print('saved reports/s2/W3D-01-comparison.png')
