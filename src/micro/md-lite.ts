import * as THREE from 'three';

/**
 * MD-lite — 分子层运动引擎（L4 机制示意）。
 *
 * 科学契约（docs/MOLECULAR_LAYER_SPEC.md）：
 * - 结构真实：键长/键角取实验值（O–H 0.0958 nm、H–O–H 104.45°、Si–O 0.161 nm、
 *   O–Si–O 109.47°、纤维二糖重复距离 1.038 nm）。
 * - 运动有据：晶格谐振（A ∝ √(k_B·T/k)）、液体 Langevin 扩散（D = k_B·T/6πηr）、
 *   链段摆动；不是卡通抖动。
 * - 尺度诚实：内部单位 nm；振幅与时间尺度按 AMPLITUDE_EXAGGERATION / 视觉速率夸大，
 *   夸大倍数必须随层元数据对外声明。动画速率不代表真实时间尺度（键振动 ~10^13 Hz）。
 * - 颜色声明：CPK 元素配色 = schematic，非光学颜色、非荧光。
 */

/* ---------------------------------- 元素表（CPK 配色，半径 nm） ---------------------------------- */

export type ElementSymbol = 'H' | 'C' | 'N' | 'O' | 'Mg' | 'Al' | 'Si' | 'P';

interface ElementInfo {
  /** CPK 配色（示意色，schematic） */
  color: number;
  /** 共价半径 nm（用于球半径与成键判定） */
  radius: number;
}

export const ELEMENTS: Record<ElementSymbol, ElementInfo> = {
  H:  { color: 0xf2f2f2, radius: 0.025 },
  C:  { color: 0x4a4a4a, radius: 0.070 },
  N:  { color: 0x3050f8, radius: 0.065 },
  O:  { color: 0xff0d0d, radius: 0.060 },
  Mg: { color: 0x8aff00, radius: 0.150 },
  Al: { color: 0xbfa6a6, radius: 0.118 },
  Si: { color: 0xf0c8a0, radius: 0.111 },
  P:  { color: 0xff8000, radius: 0.098 }
};

/* ---------------------------------- 结构定义 ---------------------------------- */

export type MdDynamics = 'lattice' | 'liquid' | 'chain';

export interface MdAtomDef {
  element: ElementSymbol;
  /** nm */
  pos: [number, number, number];
}

export interface MdBondDef {
  a: number;
  b: number;
  /** hbond 仅 liquid 模式下按距离动态闪现 */
  kind: 'covalent' | 'hbond';
}

export interface MdStructure {
  id: string;
  nameZh: string;
  formula: string;
  atoms: MdAtomDef[];
  bonds: MdBondDef[];
  dynamics: MdDynamics;
  /** 结构说明（写入层元数据 geometrySource） */
  note: string;
  sources: string[];
}

/* ---------------------------------- 参数 ---------------------------------- */

export interface MdParams {
  temperatureK: number;
  /** 视觉速率倍率（声明：不代表真实时间尺度） */
  speed: number;
  paused: boolean;
}

export const DEFAULT_PARAMS: MdParams = { temperatureK: 298, speed: 1, paused: false };

/** 振幅夸大倍数（对外声明用）：真实 298 K 键振动振幅 ~0.005 nm，屏幕不可见 */
export const AMPLITUDE_EXAGGERATION = 12;

/** 物理常数（计算记录用，运动按简化模型参数化） */
export const PHYS = {
  kB_J_per_K: 1.380649e-23,
  note: 'lattice: A ∝ √(T/298K)；liquid: Langevin，D = k_B·T/6πηr（η 取 298K 水 0.89 mPa·s）'
};

/* ---------------------------------- 随机数（可复现） ---------------------------------- */

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 近似标准正态（Box–Muller） */
function randn(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------------------------------- 引擎 ---------------------------------- */

interface AtomState {
  element: ElementSymbol;
  home: THREE.Vector3;      // 平衡位 nm
  pos: THREE.Vector3;       // 当前位 nm
  vel: THREE.Vector3;       // liquid 模式速度 nm/s（视觉尺度）
  vibAxis: THREE.Vector3;   // lattice/chain 振动方向
  vibFreq: number;          // rad/s（视觉尺度）
  vibPhase: number;
  molId: number;            // 所属分子（liquid 氢键判定用）
}

export class MdLite {
  readonly group = new THREE.Group();
  readonly structure: MdStructure;
  private params: MdParams;
  private atoms: AtomState[] = [];
  private covalentBonds: MdBondDef[] = [];
  private sphereMeshes: Partial<Record<ElementSymbol, THREE.InstancedMesh>> = {};
  private sphereIndex: Partial<Record<ElementSymbol, number[]>> = {};
  private bondMesh: THREE.InstancedMesh | null = null;
  private hbondMesh: THREE.InstancedMesh | null = null;
  private time = 0;
  private rng: () => number;
  private disposed = false;

  /** nm → 场景单位 的缩放（由调用方定，例如 1 场景单位 = 1 nm 时传 1） */
  constructor(structure: MdStructure, params?: Partial<MdParams>, worldScale = 1, seed = 42) {
    this.structure = structure;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.rng = makeRng(seed);
    this.group.name = `md-lite:${structure.id}`;
    this.group.scale.setScalar(worldScale);

    const rng = this.rng;
    structure.atoms.forEach((def, i) => {
      const axis = new THREE.Vector3(randn(rng), randn(rng), randn(rng)).normalize();
      this.atoms.push({
        element: def.element,
        home: new THREE.Vector3(...def.pos),
        pos: new THREE.Vector3(...def.pos),
        vel: new THREE.Vector3(),
        vibAxis: axis,
        // 视觉频率：键振动 ~2–6 rad/s（声明：真实 ~10^13 Hz，此处为可观察速率）
        vibFreq: 2 + 4 * rng(),
        vibPhase: rng() * Math.PI * 2,
        molId: def.element === 'H' || def.element === 'O' ? Math.floor(i / 3) : i
      });
    });
    this.covalentBonds = structure.bonds.filter((b) => b.kind === 'covalent');
    this.buildMeshes();
  }

  private buildMeshes(): void {
    const byElement = new Map<ElementSymbol, number[]>();
    this.atoms.forEach((a, i) => {
      const list = byElement.get(a.element) ?? [];
      list.push(i);
      byElement.set(a.element, list);
    });
    const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
    for (const [el, idxList] of byElement) {
      const info = ELEMENTS[el];
      const mat = new THREE.MeshStandardMaterial({
        color: info.color,
        roughness: 0.35,
        metalness: 0.05
      });
      const mesh = new THREE.InstancedMesh(sphereGeo, mat, idxList.length);
      mesh.name = `md-atoms:${el}`;
      this.sphereMeshes[el] = mesh;
      this.sphereIndex[el] = idxList;
      this.group.add(mesh);
    }
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const bondMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6 });
    this.bondMesh = new THREE.InstancedMesh(cylGeo, bondMat, Math.max(1, this.covalentBonds.length));
    this.bondMesh.name = 'md-bonds:covalent';
    this.group.add(this.bondMesh);
    if (this.structure.dynamics === 'liquid') {
      const hbMat = new THREE.MeshStandardMaterial({
        color: 0x7fb4ff,
        roughness: 0.4,
        transparent: true,
        opacity: 0.55
      });
      this.hbondMesh = new THREE.InstancedMesh(cylGeo, hbMat, this.atoms.length * 2);
      this.hbondMesh.name = 'md-bonds:hbond-dynamic';
      this.group.add(this.hbondMesh);
    }
    this.updateInstances();
  }

  /* ---------------- 动力学 ---------------- */

  /** 谐振振幅（nm，屏幕值，已含夸大）：A = 0.005 nm × √(T/298) × AMPLITUDE_EXAGGERATION */
  private vibrationAmplitude(): number {
    return 0.005 * Math.sqrt(this.params.temperatureK / 298) * AMPLITUDE_EXAGGERATION;
  }

  private step(dt: number): void {
    const mode = this.structure.dynamics;
    const A = this.vibrationAmplitude();
    const t = this.time;
    if (mode === 'liquid') {
      // Langevin：v += (-γv + σ·N(0,1))dt；γ、σ 按视觉尺度参数化，T 越高 σ 越大。
      const gamma = 1.6;
      const sigma = 0.22 * Math.sqrt(this.params.temperatureK / 298);
      const rng = this.rng;
      for (const a of this.atoms) {
        a.vel.x += (-gamma * a.vel.x + sigma * randn(rng)) * dt;
        a.vel.y += (-gamma * a.vel.y + sigma * randn(rng)) * dt;
        a.vel.z += (-gamma * a.vel.z + sigma * randn(rng)) * dt;
        a.pos.addScaledVector(a.vel, dt);
        // 软边界：以平衡位为中心的谐振势垒，防止簇散开（声明：周期性近似为局域约束）
        const disp = a.pos.clone().sub(a.home);
        const r = disp.length();
        if (r > 0.45) a.pos.copy(a.home).addScaledVector(disp.normalize(), 0.45);
        // 分子内键伸缩叠加在 O/H 上
        const stretch = A * 0.4 * Math.sin(a.vibFreq * t + a.vibPhase);
        a.pos.addScaledVector(a.vibAxis, stretch * dt);
      }
    } else {
      // lattice / chain：绕平衡位谐振；chain 额外给低频大振幅摆动（链段运动）
      for (const a of this.atoms) {
        const amp = mode === 'chain' ? A * 1.6 : A;
        const w = mode === 'chain' ? a.vibFreq * 0.55 : a.vibFreq;
        const d = amp * Math.sin(w * t + a.vibPhase);
        a.pos.copy(a.home).addScaledVector(a.vibAxis, d);
      }
    }
  }

  /* ---------------- 实例矩阵 ---------------- */

  private updateInstances(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (const el of Object.keys(this.sphereMeshes) as ElementSymbol[]) {
      const mesh = this.sphereMeshes[el]!;
      const idxList = this.sphereIndex[el]!;
      idxList.forEach((atomIdx, i) => {
        const a = this.atoms[atomIdx];
        const r = ELEMENTS[a.element].radius * 1.15; // 视觉半径略大于共价半径，声明见 colorNote
        s.setScalar(r);
        m.compose(a.pos, q.identity(), s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.bondMesh) {
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      this.covalentBonds.forEach((b, i) => {
        const pa = this.atoms[b.a].pos;
        const pb = this.atoms[b.b].pos;
        dir.subVectors(pb, pa);
        const len = Math.max(dir.length(), 1e-6);
        q.setFromUnitVectors(up, dir.normalize());
        s.set(0.018, len, 0.018); // 键柱半径 0.018 nm（视觉约定）
        m.compose(pa.clone().add(pb).multiplyScalar(0.5), q, s);
        this.bondMesh!.setMatrixAt(i, m);
      });
      this.bondMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.hbondMesh) this.updateHbonds();
  }

  /** 氢键动态闪现：O···O 距离 < 0.30 nm 时显示（0.28 nm 为液态水氢键典型值附近） */
  private updateHbonds(): void {
    const mesh = this.hbondMesh!;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const oxygens = this.atoms
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.element === 'O');
    let count = 0;
    for (let x = 0; x < oxygens.length; x++) {
      for (let y = x + 1; y < oxygens.length; y++) {
        const A = oxygens[x];
        const B = oxygens[y];
        if (A.a.molId === B.a.molId) continue;
        dir.subVectors(B.a.pos, A.a.pos);
        const d = dir.length();
        if (d < 0.3 && count < mesh.count) {
          q.setFromUnitVectors(up, dir.normalize());
          s.set(0.008, d, 0.008);
          m.compose(A.a.pos.clone().add(B.a.pos).multiplyScalar(0.5), q, s);
          mesh.setMatrixAt(count++, m);
        }
      }
    }
    // 其余实例压到零尺寸隐藏
    s.setScalar(0);
    for (let i = count; i < mesh.count; i++) {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(), q.identity(), s));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- 公共 API ---------------- */

  update(dt: number): void {
    if (this.disposed || this.params.paused) return;
    const stepDt = Math.min(dt, 0.05) * this.params.speed;
    this.time += stepDt;
    this.step(stepDt);
    this.updateInstances();
  }

  pause(): void {
    this.params.paused = true;
  }
  resume(): void {
    this.params.paused = false;
  }
  isPaused(): boolean {
    return this.params.paused;
  }
  /** 只改运动参数，不改科学数据（MOLECULAR_LAYER_SPEC §3） */
  setTemperature(kelvin: number): void {
    this.params.temperatureK = Math.max(1, kelvin);
  }
  get temperatureK(): number {
    return this.params.temperatureK;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of Object.values(this.sphereMeshes)) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of [this.bondMesh, this.hbondMesh]) {
      if (mesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.group.clear();
  }
}

/* ---------------------------------- 真实结构库 ---------------------------------- */

const DEG = Math.PI / 180;

/** 向水分子簇加一个 H2O：O 在原点局部系，O–H 0.0958 nm，H–O–H 104.45° */
function addWater(
  atoms: MdAtomDef[],
  bonds: MdBondDef[],
  center: [number, number, number],
  rotY: number,
  rotX: number
): void {
  const rOH = 0.0958;
  const half = (104.45 / 2) * DEG;
  const oIdx = atoms.length;
  atoms.push({ element: 'O', pos: center });
  const rot = new THREE.Euler(rotX, rotY, 0);
  for (const sign of [1, -1]) {
    const local = new THREE.Vector3(
      sign * rOH * Math.sin(half),
      rOH * Math.cos(half),
      0
    ).applyEuler(rot);
    atoms.push({
      element: 'H',
      pos: [center[0] + local.x, center[1] + local.y, center[2] + local.z]
    });
    bonds.push({ a: oIdx, b: atoms.length - 1, kind: 'covalent' });
  }
}

/** 液态水簇：12 个 H2O，质心间距 ~0.3 nm（液态水最近邻 O···O ≈ 0.28–0.30 nm） */
export function waterCluster(): MdStructure {
  const atoms: MdAtomDef[] = [];
  const bonds: MdBondDef[] = [];
  const rng = makeRng(7);
  // 近面心堆叠的 12 个位置，间距 0.3 nm，含抖动模拟液态无序
  const spots: [number, number, number][] = [
    [0, 0, 0], [0.3, 0, 0], [0, 0.3, 0], [0, 0, 0.3],
    [0.3, 0.3, 0], [0.3, 0, 0.3], [0, 0.3, 0.3], [0.3, 0.3, 0.3],
    [0.15, 0.15, -0.26], [0.15, -0.26, 0.15], [-0.26, 0.15, 0.15], [0.45, 0.15, 0.15]
  ];
  for (const [x, y, z] of spots) {
    const j = () => (rng() - 0.5) * 0.04;
    addWater(atoms, bonds, [x + j(), y + j(), z + j()], rng() * Math.PI * 2, rng() * Math.PI);
  }
  return {
    id: 'water-liquid-cluster',
    nameZh: '液态水簇（氢键网络）',
    formula: 'H₂O × 12',
    atoms,
    bonds,
    dynamics: 'liquid',
    note:
      '12 个 H2O 分子，分子内几何取实验值（O–H 0.0958 nm、∠HOH 104.45°）；' +
      'O···O 初始间距 ~0.30 nm（液态水最近邻典型值）。Langevin 扩散 + 氢键（O···O < 0.30 nm）动态闪现。',
    sources: ['SRC-WATER-GEOMETRY（实验键长键角，通用物理化学数据）']
  };
}

/** 冰 Ih 小晶片：六元环椅式构型的氧晶格（H 简化放置，声明 Bernal–Fowler 简化） */
export function iceIh(): MdStructure {
  const atoms: MdAtomDef[] = [];
  const bonds: MdBondDef[] = [];
  const a = 0.276; // O···O 最近邻 nm（冰 Ih 0.276 nm）
  // 两个六元环（椅式），共享一条边
  const ring = (cx: number, cz: number): number[] => {
    const idx: number[] = [];
    for (let k = 0; k < 6; k++) {
      const ang = k * 60 * DEG;
      const y = (k % 2 === 0 ? 1 : -1) * 0.05; // 椅式起伏
      idx.push(atoms.length);
      atoms.push({ element: 'O', pos: [cx + a * Math.cos(ang), y, cz + a * Math.sin(ang)] });
    }
    for (let k = 0; k < 6; k++) {
      bonds.push({ a: idx[k], b: idx[(k + 1) % 6], kind: 'covalent' }); // 氢键有序化简化
    }
    return idx;
  };
  ring(0, 0);
  ring(1.5 * a, (Math.sqrt(3) / 2) * a);
  // H：每个 O 沿两条键方向放 2 个 H（rOH 0.0984 nm，冰 Ih 实验值），未满足冰规则处声明简化
  const oCount = atoms.length;
  for (let i = 0; i < oCount; i++) {
    const o = atoms[i];
    const neighbors = bonds
      .filter((b) => b.a === i || b.b === i)
      .map((b) => (b.a === i ? b.b : b.a));
    for (let h = 0; h < 2 && h < neighbors.length; h++) {
      const n = atoms[neighbors[h]];
      const dir = new THREE.Vector3(n.pos[0] - o.pos[0], n.pos[1] - o.pos[1], n.pos[2] - o.pos[2])
        .normalize()
        .multiplyScalar(0.0984);
      atoms.push({ element: 'H', pos: [o.pos[0] + dir.x, o.pos[1] + dir.y, o.pos[2] + dir.z] });
    }
  }
  return {
    id: 'ice-ih-fragment',
    nameZh: '冰 Ih 晶格片段',
    formula: 'H₂O（冰 Ih）',
    atoms,
    bonds,
    dynamics: 'lattice',
    note:
      '冰 Ih 六元环椅式氧晶格（O···O 0.276 nm）；H 位置按 Bernal–Fowler 冰规则简化放置，' +
      '无序质子未完整建模。晶格谐振（声子式，不离位）。',
    sources: ['SRC-ICE-IH（冰 Ih 晶体学通用数据）']
  };
}

/** 石英片段：4 个 SiO4 四面体角共享网络（Si–O 0.161 nm，O–Si–O 109.47°） */
export function quartzFragment(): MdStructure {
  const atoms: MdAtomDef[] = [];
  const bonds: MdBondDef[] = [];
  const rSiO = 0.161;
  // 四面体顶点方向（109.47°）
  const tetra: [number, number, number][] = [
    [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]
  ].map(([x, y, z]) => {
    const v = new THREE.Vector3(x, y, z).normalize().multiplyScalar(rSiO);
    return [v.x, v.y, v.z];
  });
  // 2×2 Si 网格，相邻 Si 共享角顶氧（桥氧）
  const siGrid: [number, number, number][] = [
    [0, 0, 0], [0.31, 0, 0], [0, 0, 0.31], [0.31, 0, 0.31]
  ];
  const sharedO = new Map<string, number>();
  for (const siPos of siGrid) {
    const siIdx = atoms.length;
    atoms.push({ element: 'Si', pos: siPos });
    for (const t of tetra) {
      const ox = siPos[0] + t[0];
      const oy = siPos[1] + t[1];
      const oz = siPos[2] + t[2];
      // 桥氧去重（容差 0.05 nm），模拟角共享
      let oIdx = -1;
      for (const [key, idx] of sharedO) {
        const p = key.split(',').map(Number);
        if (Math.hypot(p[0] - ox, p[1] - oy, p[2] - oz) < 0.05) {
          oIdx = idx;
          break;
        }
      }
      if (oIdx < 0) {
        oIdx = atoms.length;
        atoms.push({ element: 'O', pos: [ox, oy, oz] });
        sharedO.set(`${ox},${oy},${oz}`, oIdx);
      }
      bonds.push({ a: siIdx, b: oIdx, kind: 'covalent' });
    }
  }
  return {
    id: 'quartz-fragment',
    nameZh: '石英 SiO₄ 四面体网络',
    formula: 'SiO₂',
    atoms,
    bonds,
    dynamics: 'lattice',
    note:
      '4 个 SiO4 四面体角共享片段（Si–O 0.161 nm、O–Si–O 109.47°）；为局部结构模型，' +
      '非完整 α-石英晶胞。晶格谐振。',
    sources: ['SRC-QUARTZ-GEOMETRY（硅氧四面体通用晶体学数据）']
  };
}

/** 纤维素 Iβ 链段：2 个纤维二糖单元（重复距离 1.038 nm），吡喃环简化为椅式六元环 */
export function celluloseChain(): MdStructure {
  const atoms: MdAtomDef[] = [];
  const bonds: MdBondDef[] = [];
  const repeat = 1.038 / 2; // 每个葡萄糖残基沿链轴 0.519 nm
  const ringR = 0.14; // 吡喃环半径（示意，C–C 0.154 / C–O 0.143 nm 量级）
  const residues = 4; // 2 个纤维二糖 = 4 个葡萄糖残基
  let prevO4 = -1;
  for (let r = 0; r < residues; r++) {
    const cx = r * repeat;
    const flip = r % 2 === 1 ? Math.PI : 0; // β-1,4 连接相邻残基翻转 180°
    const ringIdx: number[] = [];
    for (let k = 0; k < 5; k++) {
      const ang = k * 72 * DEG + flip;
      ringIdx.push(atoms.length);
      atoms.push({
        element: 'C',
        pos: [cx, ringR * Math.cos(ang), ringR * Math.sin(ang) * (flip ? -1 : 1)]
      });
    }
    // 环氧 O5
    const o5 = atoms.length;
    atoms.push({ element: 'O', pos: [cx, ringR * Math.cos(5 * 72 * DEG + flip) * 0.9, 0] });
    for (let k = 0; k < 5; k++) bonds.push({ a: ringIdx[k], b: ringIdx[(k + 1) % 5], kind: 'covalent' });
    bonds.push({ a: ringIdx[4], b: o5, kind: 'covalent' });
    bonds.push({ a: o5, b: ringIdx[0], kind: 'covalent' });
    // 羟甲基 CH2OH（C6 位，示意）
    const c6 = atoms.length;
    atoms.push({ element: 'C', pos: [cx, ringR * 1.5, 0.1 * (flip ? -1 : 1)] });
    bonds.push({ a: ringIdx[1], b: c6, kind: 'covalent' });
    const o6 = atoms.length;
    atoms.push({ element: 'O', pos: [cx, ringR * 2.0, 0.12 * (flip ? -1 : 1)] });
    bonds.push({ a: c6, b: o6, kind: 'covalent' });
    // β-1,4 糖苷键：C1（ringIdx[0] 侧）— O — C4'（上一残基）
    if (prevO4 >= 0) {
      const gl = atoms.length;
      atoms.push({ element: 'O', pos: [cx - repeat / 2, 0, 0] });
      bonds.push({ a: prevO4, b: gl, kind: 'covalent' });
      bonds.push({ a: gl, b: ringIdx[0], kind: 'covalent' });
    }
    prevO4 = ringIdx[3]; // C4 位近似
  }
  return {
    id: 'cellulose-chain',
    nameZh: '纤维素 Iβ 链段',
    formula: '(C₆H₁₀O₅)ₙ',
    atoms,
    bonds,
    dynamics: 'chain',
    note:
      '4 个 β-D-葡萄糖残基（2 个纤维二糖重复单元，残基间距 0.519 nm、重复 1.038 nm），' +
      'β-1,4 糖苷键相邻残基翻转 180°；吡喃环椅式与取代基为示意简化（H 省略）。' +
      '链段摆动 + 键伸缩。',
    sources: ['SRC-CELLULOSE-IBETA（纤维素 Iβ 晶体结构通用数据）']
  };
}

/** 高岭石 1:1 层片段（土壤/表碛粘土矿物代表）：SiO4 四面体层 + AlO2(OH)4 八面体层 */
export function kaoliniteFragment(): MdStructure {
  const atoms: MdAtomDef[] = [];
  const bonds: MdBondDef[] = [];
  const rSiO = 0.161;
  const tetra: [number, number, number][] = [
    [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]
  ].map(([x, y, z]) => {
    const v = new THREE.Vector3(x, y, z).normalize().multiplyScalar(rSiO);
    return [v.x, v.y, v.z];
  });
  // 四面体层（2 Si）
  for (const base of [[0, 0, 0], [0.31, 0, 0]] as [number, number, number][]) {
    const si = atoms.length;
    atoms.push({ element: 'Si', pos: base });
    for (const t of tetra) {
      const o = atoms.length;
      atoms.push({ element: 'O', pos: [base[0] + t[0], base[1] + t[1], base[2] + t[2]] });
      bonds.push({ a: si, b: o, kind: 'covalent' });
    }
  }
  // 八面体层（Al + 6 配位 O/OH，Al–O ~0.19 nm）
  const al = atoms.length;
  atoms.push({ element: 'Al', pos: [0.155, 0.28, 0] });
  const rAlO = 0.19;
  for (let k = 0; k < 6; k++) {
    const ang = k * 60 * DEG;
    const o = atoms.length;
    atoms.push({ element: 'O', pos: [0.155 + rAlO * Math.cos(ang), 0.28, rAlO * Math.sin(ang)] });
    bonds.push({ a: al, b: o, kind: 'covalent' });
    // 4 个 OH 的 H（高岭石 Al2Si2O5(OH)4）
    if (k % 2 === 0) {
      const op = atoms[o].pos;
      atoms.push({ element: 'H', pos: [op[0], op[1] + 0.097, op[2]] });
      bonds.push({ a: o, b: atoms.length - 1, kind: 'covalent' });
    }
  }
  return {
    id: 'kaolinite-fragment',
    nameZh: '高岭石 1:1 层片段',
    formula: 'Al₂Si₂O₅(OH)₄',
    atoms,
    bonds,
    dynamics: 'lattice',
    note:
      'SiO4 四面体层 + AlO2(OH)4 八面体层的局部片段（Al–O ~0.19 nm）；' +
      '层间氢键与堆垛未完整建模。晶格谐振。',
    sources: ['SRC-KAOLINITE（高岭石晶体结构通用数据）']
  };
}

/** 按材料分类给出分子结构（MOLECULAR_LAYER_SPEC §2） */
export type MaterialClass =
  | 'silicate-rock'
  | 'water-liquid'
  | 'water-ice'
  | 'cellulose-plant'
  | 'silica-opal'
  | 'clay-soil'
  | 'UNKNOWN';

export function structureForMaterial(cls: MaterialClass): MdStructure | null {
  switch (cls) {
    case 'water-liquid':
      return waterCluster();
    case 'water-ice':
      return iceIh();
    case 'silicate-rock':
      return quartzFragment();
    case 'cellulose-plant':
      return celluloseChain();
    case 'silica-opal': {
      // opal-A 与水石英同为 SiO2 网络，差异在短程有序度；用石英片段 + 说明
      const q = quartzFragment();
      return {
        ...q,
        id: 'opal-a-fragment',
        nameZh: 'opal-A 非晶质硅氧网络（硅藻壳）',
        formula: 'SiO₂·nH₂O',
        note:
          'opal-A 为短程有序的非晶质 SiO2·nH2O；此处用 SiO4 四面体片段示意局部键合环境，' +
          '长程无序与结构水未完整建模。',
        sources: ['SRC-OPAL-A（非晶质二氧化硅通用数据）']
      };
    }
    case 'clay-soil':
      return kaoliniteFragment();
    default:
      return null;
  }
}
