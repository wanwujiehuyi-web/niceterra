/**
 * A11Y-10 可见控件交互审计（v2）。
 * 用 CDP Input.dispatchKeyEvent 发送**真实 Tab**（浏览器信任事件），
 * 让 :focus-visible 按真实键盘路径生效，逐站记录焦点样式。
 * 核对：真实动作 / 键盘可达 / 焦点可见 / disabled 语义 / 触控尺寸。
 * 输出 reports/v3/acceptance/a11y-10-audit.{json,md}
 */
import { launch } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:5388';
const b = await launch({ width: 1440, height: 1000 });
await b.goto(BASE + '/?autostart=1&quality=low&tour=0');
await b.waitFor("(() => { try { return window.__nt.stats().triangles > 0; } catch { return false; } })()", 600000);
await new Promise((r) => setTimeout(r, 2000));

// 静态属性盘点
const controls = await b.eval(`(() => {
  const sel = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="switch"], [tabindex], summary';
  const rows = [];
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
    rows.push({
      tag: el.tagName.toLowerCase(), id: el.id || null,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      role: el.getAttribute('role'), w: Math.round(r.width), h: Math.round(r.height),
      disabled, cursor: cs.cursor,
      interactive: /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName) || el.tabIndex >= 0 || !!el.getAttribute('role'),
    });
  }
  return rows;
})()`);

// 真实 Tab 遍历：焦点序列 + 每站焦点样式
const tabStops = [];
for (let i = 0; i < 40; i++) {
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await new Promise((r) => setTimeout(r, 60));
  const stop = await b.eval(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return {
      i: ${i}, tag: el.tagName.toLowerCase(), id: el.id || null,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30),
      outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow !== 'none',
      focusVisible: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
    };
  })()`);
  if (!stop) break;
  tabStops.push(stop);
}

const noFocusStyle = tabStops.filter((t) => !t.focusVisible);
const nonInteractive = controls.filter((c) => !c.interactive);
const small = controls.filter((c) => !c.disabled && (c.w < 44 || c.h < 44));
const disabledWithSemantics = controls.filter((c) => c.disabled && c.cursor === 'not-allowed');

mkdirSync('reports/v3/acceptance', { recursive: true });
writeFileSync('reports/v3/acceptance/a11y-10-audit.json', JSON.stringify({ at: new Date().toISOString(), controls, tabStops }, null, 2));

const ok = nonInteractive.length === 0 && noFocusStyle.length === 0;
const md = [
  '# A11Y-10 可见控件交互审计',
  '',
  `时间 ${new Date().toISOString()} · 视口 1440×1000 · 方法：CDP 真实 Tab 键遍历`,
  '',
  `控件总数 ${controls.length} · 全部有真实动作语义：${nonInteractive.length === 0 ? '是' : '否'} · Tab 可达站点 ${tabStops.length} · 焦点样式缺失 ${noFocusStyle.length}`,
  '',
  `**结论：${ok ? 'PASS' : 'FAIL'}**`,
  '',
  '## Tab 焦点序列（真实键盘路径）',
  '',
  ...tabStops.map((t) => `${t.i}. \`<${t.tag}${t.id ? '#' + t.id : ''}>\` "${t.text}" — outline ${t.outlineWidth}/${t.outlineStyle}${t.boxShadow ? ' +shadow' : ''}`),
  '',
  '## 不合格明细',
  '',
  ...(nonInteractive.length ? nonInteractive.map((c) => `- 无动作语义：\`<${c.tag}#${c.id ?? ''}>\` "${c.text}"`) : []),
  ...(noFocusStyle.length ? noFocusStyle.map((t) => `- 焦点样式缺失：\`<${t.tag}${t.id ? '#' + t.id : ''}>\` "${t.text}"`) : []),
  ...(nonInteractive.length + noFocusStyle.length === 0 ? ['（无）'] : []),
  '',
  '## disabled 语义与触控尺寸（记录项）',
  '',
  `- disabled 且 cursor=not-allowed：${disabledWithSemantics.length} 个（${disabledWithSemantics.map((c) => c.id).join('、') || '无'}）——禁用态不可聚焦为正确语义`,
  ...(small.length ? small.map((s) => `- 触控 <44px：\`<${s.tag}${s.id ? '#' + s.id : ''}>\` "${s.text}" ${s.w}×${s.h}（记录，A11Y-01/04 另验）`) : ['- 触控尺寸全部 ≥44px']),
  '',
].join('\n');
writeFileSync('reports/v3/acceptance/a11y-10-audit.md', md);
console.log('A11Y-10 controls=' + controls.length, 'tabStops=' + tabStops.length, 'noFocusStyle=' + noFocusStyle.length, 'nonInteractive=' + nonInteractive.length, 'small=' + small.length, ok ? 'PASS' : 'FAIL');
await b.close();
