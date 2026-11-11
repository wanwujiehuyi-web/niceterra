/**
 * PERF-09 发布包清单生成器。
 * 盘点 dist（代码+资产）、数据、测试工具、证据截图、日志、审核文档与已知问题，
 * 输出 reports/v3/release/manifest.json + MANIFEST.md。
 * 用法：node tools/release-manifest.mjs
 */
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve('.');
const OUT_DIR = path.join('reports', 'v3', 'release');

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, base));
    else out.push({ rel: path.relative(base, p).replace(/\\/g, '/'), size: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function inventory(dir, { hashUnder = 5 * 1024 * 1024 } = {}) {
  return walk(dir).map((f) => {
    const abs = path.join(dir, f.rel);
    const e = { path: f.rel, bytes: f.size, mtime: f.mtime };
    if (f.size <= hashUnder) e.sha256 = sha256(abs);
    return e;
  });
}

const sum = (files) => files.reduce((a, f) => a + (f.bytes ?? f.size ?? 0), 0);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

const sections = {};

sections.code = {
  note: 'dist/ 静态发布包（vite build，含 three r187 打包 JS/CSS、draco 解码器、GLB/DEM/纹理资产拷贝）',
  root: 'dist',
  files: inventory('dist'),
};
sections.data = {
  note: '科学数据与 DEM 源（public/data 为运行时数据源，已随构建拷入 dist/data）',
  root: 'public/data',
  files: inventory('public/data'),
};
sections.tests = {
  note: '验收/冒烟/取证工具链（Node 脚本，CDP 驱动真实 Chrome）',
  root: 'tools',
  files: inventory('tools'),
};
sections.evidence = {
  note: '照片对照、卫星比对、签核材料、验收报告与截图证据',
  root: 'reports',
  files: inventory('reports', { hashUnder: 3 * 1024 * 1024 }),
};

// 已知问题来自验收报告 NOT_RUN 行 + 签核报告保留项
const knownIssues = [];
const accPath = path.join('reports', 'v3', 'acceptance', 'REPORT.md');
if (existsSync(accPath)) {
  for (const line of readFileSync(accPath, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*([A-Z0-9-]+)\s*\|\s*NOT_RUN\s*\|\s*(.+)\|/);
    if (m) knownIssues.push({ id: m[1], note: m[2].trim() });
  }
}

const gitHead = (() => {
  try {
    return readFileSync(path.join('.git', 'refs', 'heads', 'master'), 'utf8').trim();
  } catch { return 'UNKNOWN'; }
})();

const manifest = {
  schema: 'niceterra.release-manifest.v1',
  item: 'PERF-09',
  generatedAt: new Date().toISOString(),
  gitHead,
  sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, {
    note: v.note, root: v.root, fileCount: v.files.length, totalBytes: sum(v.files), files: v.files,
  }])),
  knownIssues,
  scientificBoundary: '程序化图层 L4（雪/冰/表碛/林线/天气档位）非实测；DEM 为 SRTM30m 区域参考 L3；Aholo AI 资产已声明非实测证据；显微层坐标不伪造（UNKNOWN 合法）。',
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

const md = [
  '# PERF-09 发布包清单',
  '',
  `生成：${manifest.generatedAt} · git HEAD \`${gitHead.slice(0, 8)}\``,
  '',
  '| 部分 | 根目录 | 文件数 | 体积 |',
  '|---|---|---|---|',
  ...Object.entries(sections).map(([k, v]) => `| ${k} | \`${v.root}\` | ${v.files.length} | ${mb(sum(v.files))} |`),
  '',
  '各部分说明：',
  ...Object.entries(sections).map(([k, v]) => `- **${k}**（\`${v.root}\`）：${v.note}`),
  '',
  '完整性：≤5MB 文件附 sha256（reports 段 ≤3MB）；大文件（GLB/截图）以大小+mtime 核对。',
  '',
  '## 已知问题（验收 NOT_RUN 原文照录）',
  '',
  ...knownIssues.map((i) => `- **${i.id}**：${i.note}`),
  '',
  '## 科学边界',
  '',
  manifest.scientificBoundary,
  '',
].join('\n');
writeFileSync(path.join(OUT_DIR, 'MANIFEST.md'), md);
console.log('PERF-09 manifest:', path.join(OUT_DIR, 'manifest.json'));
for (const [k, v] of Object.entries(sections)) console.log(`  ${k}: ${v.files.length} files, ${mb(sum(v.files))}`);
console.log('  knownIssues:', knownIssues.length);
