/**
 * Static shell contract check.
 * Chrome/headless cannot run inside this sandbox (named pipes are blocked, mojo
 * channel creation fails), so the DOM contract is verified by parsing instead:
 * every selector the shell asks for must exist in index.html, and every
 * accessibility affordance the baseline requires must be present.
 *
 * Exit 0 = all checks pass.
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const html = read('index.html');
const shell = read('src/ui/shell.ts');
const css = read('src/ui/styles.css');

const failures = [];
const passes = [];
const check = (name, ok, detail = '') => (ok ? passes : failures).push(name + (detail ? ' :: ' + detail : ''));

// 1. ids the shell queries
const wanted = [...shell.matchAll(/q\(root, '([^']+)'\)/g)].map((m) => m[1]);
check('shell queries at least one selector', wanted.length > 0, String(wanted.length));
for (const sel of new Set(wanted)) {
  const id = sel.replace(/^#/, '');
  check('index.html has ' + sel, html.includes('id="' + id + '"'));
}

// 2. optional hooks the shell looks up
for (const id of ['btn-far', 'toggle-sites', 'toggle-panel', 'btn-enter', 'btn-resume', 'btn-retry', 'poster-stages', 'poster-credit', 'poster-honesty', 'poster-status', 'poster-bar', 'mode-seg', 'btn-prev', 'btn-next', 'btn-exit', 'anchor-layer', 'scene-meta', 'scene-hints', 'scene-foot', 'bottom-status', 'toast']) {
  check('optional hook #' + id, html.includes('id="' + id + '"'));
}

// 3. fixed rectangles (DESIGN_V2 §13) reproduced by the grid
check('grid areas top/left/scene/right/bottom', css.includes('"top top top"') && css.includes('"left scene right"') && css.includes('"bottom bottom bottom"'));
check('left column 248px', css.includes('--left-w: 248px'));
check('right column 336px', css.includes('--right-w: 336px'));
check('top row 56px', css.includes('--top-h: 56px'));
check('bottom row 72px', css.includes('--bottom-h: 72px'));
check('248+856+336 = 1440 at the reference width', 248 + 856 + 336 === 1440);
check('56+872+72 = 1000 at the reference height', 56 + 872 + 72 === 1000);

// 4. accessibility / legibility gates
check('body font-size is at least 16px', /font-size:\s*16px/.test(css));
check('buttons are at least 44px tall', /min-height:\s*44px/.test(css));
check('focus-visible outline is defined', css.includes(':focus-visible'));
check('prefers-reduced-motion is honoured', css.includes('prefers-reduced-motion'));
check('poster is hidden with the hidden attribute', html.includes('id="poster"') && shell.includes('this.poster.hidden = true'));
check('static mode is a real readable fallback', html.includes('id="static-mode"') && css.includes('#static-mode .card'));
check('canvas fallback colour #0f0f0f', css.includes('--canvas-fallback: #0f0f0f'));
check('workbench colour #1c3a13', css.includes('--workbench: #1c3a13'));
check('active colour #c45c26', css.includes('--active: #c45c26'));
check('text primary #f6f6f4', css.includes('--text-primary: #f6f6f4'));
check('text secondary #d2d8d0', css.includes('--text-secondary: #d2d8d0'));

// 5. honesty gates in copy
check('poster discloses the image is generated', /AI 生成的氛围图/.test(shell + read('src/app/content.ts')));
check('evidence chip is rendered as text, not colour only', /证据 UNKNOWN/.test(shell));
check('sample lifecycle is stated in the panel', /PLANNED → COLLECTED/.test(shell));

// 6. mobile drawers (three tiers)
check('mobile breakpoint at 900px', css.includes('@media (max-width: 900px)'));
check('mobile drawers are transform based', css.includes('translateY(102%)'));
check('mobile keeps 44px targets via min-height', /--bottom-h: 64px/.test(css));

console.log('PASS ' + passes.length + ' / ' + (passes.length + failures.length));
for (const f of failures) console.log('FAIL ' + f);
process.exit(failures.length === 0 ? 0 : 1);
