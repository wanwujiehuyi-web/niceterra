/**
 * UI shell for the Hailuogou flagship world.
 * The DOM skeleton lives in index.html so the poster can paint before the
 * module bundle runs; this module only wires behaviour and renders the panels.
 *
 * A11y: every control is a real button, >=44px, and state is always carried by
 * text as well as colour (DESIGN_V2 §13, §21).
 */

import {
  ACTIONS,
  APP_META,
  EVIDENCE_LEVELS,
  MODES,
  POSTER,
  ROUTES,
  SITES,
  TABS,
  MESSAGES,
  routeById,
  siteById,
  type Mode,
  type TabId
} from '../app/content';
import { routeLabel, type AppState } from '../app/state';
import {
  cachedScience,
  claimsFor,
  levelFromScience,
  samplesFor,
  sourceById,
  type Claim,
  type Sample,
  type ScienceLevel
} from '../app/science';
import type { AnchorHit } from '../app/world-app';

export interface ShellHandlers {
  onEnter: () => void;
  onResume: () => void;
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onFar: () => void;
  onHypothesis: (snowLineDeltaM: number) => void;
  onSite: (siteId: string) => void;
  onRoute: (routeId: string) => void;
  onLevel: (levelId: string) => void;
  onTab: (tab: TabId) => void;
  onMode: (mode: Mode) => void;
  onAnchor: (anchor: AnchorHit) => void;
}

const TIER_LABEL: Record<string, string> = {
  valley: '谷地层 · 海螺沟谷底',
  site: '样区层',
  object: '母体层',
  micro: '微观层'
};

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function evChip(level: string | null | undefined): string {
  if (!level) return '<span class="chip unknown">证据 UNKNOWN</span>';
  const known = EVIDENCE_LEVELS.find((e) => e.id === level);
  return '<span class="chip ' + esc(level) + '"><b>' + esc(level) + '</b>' + (known ? esc(known.label) : '') + '</span>';
}

function statusChip(text: string, tone: 'ok' | 'warn' | 'unknown' = 'unknown'): string {
  return '<span class="badge ' + tone + '"><span class="dot"></span>' + esc(text) + '</span>';
}

function q<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error('shell: missing ' + sel);
  return el;
}

export class Shell {
  private root: HTMLElement;
  private handlers: ShellHandlers;
  private poster: HTMLElement;
  private stageList: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private bottom: HTMLElement;
  private scene: HTMLElement;
  private anchors: HTMLElement;
  private staticMode: HTMLElement;
  private toastEl: HTMLElement;
  private stageIndex = -1;
  private toastTimer = 0;
  private currentAnchors: AnchorHit[] = [];

  constructor(root: HTMLElement, handlers: ShellHandlers) {
    this.root = root;
    this.handlers = handlers;
    // The poster and the toast live outside #app on purpose: the poster must be
    // paintable before the app shell exists, and the toast must survive remounts.
    this.poster = q(document, '#poster');
    this.stageList = q(document, '#poster-stages');
    this.left = q(root, '#left');
    this.right = q(root, '#right');
    this.bottom = q(root, '#bottom');
    this.scene = q(root, '#scene');
    this.anchors = q(root, '#anchor-layer');
    this.staticMode = q(root, '#static-mode');
    this.toastEl = q(document, '#toast');
    this.renderPosterStages(0, 0, 0);
    this.bindPoster();
    this.bindBottom();
    this.bindMobile();
    root.querySelector('#btn-far')?.addEventListener('click', () => this.handlers.onFar());
  }

  /* ------------------------------------------------------------- poster */
  private bindPoster(): void {
    const enter = this.poster.querySelector<HTMLButtonElement>('#btn-enter');
    const resume = this.poster.querySelector<HTMLButtonElement>('#btn-resume');
    const retry = this.poster.querySelector<HTMLButtonElement>('#btn-retry');
    enter?.addEventListener('click', () => this.handlers.onEnter());
    resume?.addEventListener('click', () => this.handlers.onResume());
    retry?.addEventListener('click', () => this.handlers.onRetry());
    const last = (() => {
      try {
        const raw = localStorage.getItem('niceterra.session.v2');
        return raw ? (JSON.parse(raw) as { siteId?: string | null }) : null;
      } catch {
        return null;
      }
    })();
    if (resume) resume.hidden = !last?.siteId;
    if (this.poster.querySelector('#poster-credit')) {
      (this.poster.querySelector('#poster-credit') as HTMLElement).textContent = POSTER.credit;
    }
    if (this.poster.querySelector('#poster-honesty')) {
      (this.poster.querySelector('#poster-honesty') as HTMLElement).textContent = POSTER.honesty;
    }
  }

  /** Real, countable stages only: no fake progress. */
  renderPosterStages(index: number, done: number, total: number): void {
    this.stageIndex = index;
    const items = POSTER.stages
      .map((s, i) => {
        const state = i < index ? 'done' : i === index ? 'active' : 'todo';
        const mark = i < index ? '✓' : i === index ? '·' : String(i + 1);
        return '<li data-state="' + state + '"><span class="mark">' + mark + '</span><span>' + esc(s.label) + '</span></li>';
      })
      .join('');
    const counter = total > 0 ? '<li data-state="active"><span class="mark">·</span><span>已就绪 ' + done + ' / ' + total + '</span></li>' : '';
    this.stageList.innerHTML = items + counter;
  }

  showLoadingText(text: string): void {
    const el = this.poster.querySelector<HTMLElement>('#poster-status');
    if (el) el.textContent = text;
  }

  hidePoster(): void {
    this.poster.hidden = true;
    this.poster.setAttribute('aria-hidden', 'true');
  }

  showPoster(): void {
    this.poster.hidden = false;
    this.poster.removeAttribute('aria-hidden');
  }

  setProgress(p: number): void {
    const bar = this.poster.querySelector<HTMLElement>('#poster-bar i');
    if (bar) bar.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
  }

  /* ------------------------------------------------------------- static */
  setStaticMode(reason: string): void {
    this.root.dataset.static = 'true';
    this.staticMode.innerHTML =
      '<h2>静态探索</h2><p>' + esc(reason) + '</p>' +
      '<div class="card"><b>' + esc(APP_META.placeName) + ' · ' + esc(APP_META.placeSub) + '</b>' +
      '<small>唯一可探索地点。贡嘎山脉只是三维远景，不可步行。</small></div>' +
      SITES.map(
        (s) =>
          '<div class="card"><b>' + esc(s.name) + '</b><small>' + esc(s.oneLiner) + '</small>' +
          '<small>坐标：' + esc(s.coordinate) + ' · ' + esc(s.coordinateNote) + '</small></div>'
      ).join('') +
      '<p>' + esc(MESSAGES.webglFailed) + '</p>';
  }

  clearStaticMode(): void {
    delete this.root.dataset.static;
  }

  /* -------------------------------------------------------------- toast */
  toast(msg: string, ms = 3600): void {
    this.toastEl.textContent = msg;
    this.toastEl.dataset.show = 'true';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.dataset.show = 'false';
    }, ms);
  }

  /* ---------------------------------------------------------- bottom bar */
  private bindBottom(): void {
    this.bottom.querySelector('#btn-prev')?.addEventListener('click', () => this.handlers.onPrev());
    this.bottom.querySelector('#btn-next')?.addEventListener('click', () => this.handlers.onNext());
    this.bottom.querySelector('#btn-exit')?.addEventListener('click', () => this.handlers.onExit());
  }

  private bindMobile(): void {
    const leftToggle = this.root.querySelector<HTMLButtonElement>('#toggle-sites');
    const rightToggle = this.root.querySelector<HTMLButtonElement>('#toggle-panel');
    leftToggle?.addEventListener('click', () => {
      const open = this.left.dataset.open === 'true';
      this.left.dataset.open = String(!open);
      this.right.dataset.open = 'false';
    });
    rightToggle?.addEventListener('click', () => {
      const open = this.right.dataset.open === 'true';
      this.right.dataset.open = String(!open);
      this.left.dataset.open = 'false';
    });
  }

  /* --------------------------------------------------------------- left */
  private renderLeft(state: AppState): void {
    const site = siteById(state.siteId);
    const route = routeById(state.routeId);
    const sitesHtml = SITES.map(
      (s) =>
        '<button class="site" type="button" data-site="' + esc(s.siteId) + '" aria-current="' +
        (s.siteId === state.siteId ? 'true' : 'false') + '">' +
        '<b>' + esc(s.name) + '</b><small>' + esc(s.tier === 'forest' ? '森林样区' : s.tier === 'stream' ? '溪流样区' : s.tier === 'glacier' ? '冰舌样区' : '迹地样区') + ' · ' + esc(s.status) + '</small></button>'
    ).join('');

    const routesHtml = ROUTES.map(
      (r) =>
        '<button class="route" type="button" data-route="' + esc(r.routeId) + '" aria-current="' +
        (r.routeId === state.routeId ? 'true' : 'false') + '"><b><code>' + esc(r.code) + '</code>' + esc(r.name) + '</b>' +
        '<small>' + r.levels.length + ' 层 · ' + esc(r.status) + '</small></button>'
    ).join('');

    const levelsHtml = route
      ? '<ul class="level-list">' +
        route.levels
          .map(
            (l, i) =>
              '<li><button class="level" type="button" data-level="' + esc(l.levelId) + '" aria-current="' +
              (l.levelId === state.levelId ? 'true' : 'false') + '"><i>' + String(i + 1).padStart(2, '0') + '</i><span>' + esc(l.name) + '</span>' +
              (l.dataView ? '<em>数据视图</em>' : '') + '</button></li>'
          )
          .join('') +
        '</ul>'
      : '';

    this.left.innerHTML =
      '<div class="section-label">地点</div>' +
      '<div class="site" style="background:rgba(246,246,244,0.04);border-color:var(--line)"><b>' + esc(APP_META.placeName) + '</b><small>' + esc(APP_META.placeSub) + '</small><small>' + esc(APP_META.placeId) + '</small></div>' +
      '<div class="section-label">四个样区</div>' + sitesHtml +
      '<div class="section-label">四条路线' + (site ? ' · ' + esc(site.name) : '') + '</div>' + routesHtml +
      (route ? '<div class="section-label">' + esc(route.code) + ' 路线 · ' + route.levels.length + ' 层</div>' + levelsHtml : '');

    this.left.querySelectorAll<HTMLButtonElement>('[data-site]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onSite(b.dataset.site ?? ''));
    });
    this.left.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onRoute(b.dataset.route ?? ''));
    });
    this.left.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onLevel(b.dataset.level ?? ''));
    });
  }

  /* -------------------------------------------------------------- right */
  private renderRight(state: AppState): void {
    const sci = cachedScience();
    const tabsHtml = TABS.map(
      (t) =>
        '<button type="button" role="tab" data-tab="' + esc(t.id) + '" aria-selected="' +
        (t.id === state.tab ? 'true' : 'false') + '">' + esc(t.label) + '</button>'
    ).join('');
    const body = state.tab === 'evidence' ? this.evidencePanel(state) : state.tab === 'samples' ? this.samplesPanel(state) : this.summaryPanel(state);
    this.right.innerHTML =
      '<div class="tabs" role="tablist">' + tabsHtml + '</div>' +
      '<div class="panel" role="tabpanel">' + body +
      (sci.ok ? '' : '<div class="empty">' + esc(MESSAGES.specMissing) + '</div>') +
      '</div>';
    this.right.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onTab((b.dataset.tab as TabId) ?? 'summary'));
    });
    const hyp = this.right.querySelector<HTMLInputElement>('#hyp-snow');
    if (hyp) {
      const label = this.right.querySelector<HTMLElement>('#hyp-val');
      const apply = (): void => {
        if (label) label.textContent = hyp.value;
        this.handlers.onHypothesis(Number(hyp.value));
      };
      hyp.addEventListener('input', apply);
    }
  }

  private summaryPanel(state: AppState): string {
    const sci = cachedScience();
    const site = siteById(state.siteId);
    const route = routeById(state.routeId);
    const level: ScienceLevel | undefined = levelFromScience(sci, state.levelId);
    const levelLabel = route && state.levelId ? route.levels.find((l) => l.levelId === state.levelId)?.name ?? state.levelId : null;

    const parts: string[] = [];
    parts.push('<h2>' + esc(levelLabel ?? (site ? site.name : APP_META.placeName)) + '</h2>');
    parts.push('<p class="lede">' + esc(site ? site.oneLiner : POSTER.lead) + '</p>');

    if (level) {
      parts.push('<h3>本层事实</h3><dl>' +
        '<dt>视场</dt><dd>' + esc(level.fovLabel ?? level.view ?? 'UNKNOWN') + '</dd>' +
        '<dt>几何来源</dt><dd>' + esc(level.model ?? 'UNKNOWN') + '</dd>' +
        '<dt>成像方式</dt><dd>' + esc(level.imaging ?? 'UNKNOWN') + '</dd>' +
        '<dt>颜色声明</dt><dd>' + esc(level.colorStatus ?? 'UNKNOWN') + '</dd>' +
        '<dt>母体</dt><dd>' + esc(level.parentObjectId ?? 'UNKNOWN') + '</dd>' +
        '<dt>样本状态</dt><dd>' + esc(level.sampleStatus) + '</dd>' +
        '<dt>物理缩放</dt><dd>' + (level.physicalScale ? '连续' : '非连续（数据/机制视图）') + '</dd>' +
        '</dl>');
      parts.push('<h3>证据等级</h3><p>' + (level.evidenceLevels.length ? level.evidenceLevels.map(evChip).join(' ') : evChip(level.evidenceLevel)) + '</p>');
      if (level.evidenceNote) parts.push('<p>' + esc(level.evidenceNote) + '</p>');
      if (level.limitation) parts.push('<h3>限制</h3><p>' + esc(level.limitation) + '</p>');
    } else if (site) {
      parts.push('<h3>坐标与状态</h3><dl>' +
        '<dt>坐标</dt><dd>' + esc(site.coordinate) + '</dd>' +
        '<dt>状态</dt><dd>' + esc(site.coordinateNote) + '</dd>' +
        '</dl>');
      parts.push('<p>' + esc(site.oneLiner) + '</p>');
    }

    if (route) {
      parts.push('<h3>路线</h3><p>' + esc(route.summary) + '</p>');
      parts.push('<p>' + route.levels.length + ' 层：' + route.levels.map((l) => esc(l.name)).join(' → ') + '</p>');
    }

    if (state.mode === 'hypothesis') {
      parts.push(
        '<h3>假设实验 · L5</h3>' +
        '<div class="claim"><div class="head"><span class="chip L5"><b>L5</b>假设场景</span><code>HYPOTHESIS</code></div>' +
        '<p>只改变渲染参数，生成一份 L5 副本；科学基线（claims / levels / samples）不参与运算，也不会被改写。</p>' +
        '<label for="hyp-snow" style="display:block;font-size:14px;color:var(--text-secondary);margin:8px 0 4px">雪线上移 <b id="hyp-val">0</b> m</label>' +
        '<input id="hyp-snow" type="range" min="-200" max="600" step="100" value="0" style="width:100%;min-height:44px" />' +
        '<p class="limit">这不是气候预测，也不是实测趋势；只是让你看见「如果雪线更高，谷地会变成什么样」。</p></div>'
      );
    }

    parts.push('<h3>交互模式</h3><p>' +
      MODES.map((m) => (m.id === state.mode ? '<b>' + esc(m.label) + '</b>' : esc(m.label))).join(' · ') + '</p>' +
      '<p style="font-size:13px;color:var(--text-muted)">' + esc(MODES.find((m) => m.id === state.mode)?.hint ?? '') + '</p>');
    parts.push('<p style="font-size:12.5px;color:var(--text-muted)">数据版本 ' + esc(state.dataVersion) + ' · 资产版本 ' + esc(state.assetVersion) + '</p>');
    return parts.join('');
  }

  private evidencePanel(state: AppState): string {
    const sci = cachedScience();
    const list: Claim[] = claimsFor(sci, { siteId: state.siteId, routeId: state.routeId, levelId: state.levelId });
    if (list.length === 0) return '<h2>证据</h2><div class="empty">这一层还没有可发布的 claim。UNKNOWN 是有效状态：不编造证据。</div>';
    const html = list
      .map((c) => {
        const src = sourceById(sci, c.sourceId);
        const srcHtml = src
          ? (src.url ? '<a href="' + esc(src.url) + '" target="_blank" rel="noreferrer">' + esc(src.name) + '</a>' : esc(src.name)) +
            ' · ' + esc(src.licenseStatus ?? 'UNKNOWN')
          : '来源 UNKNOWN';
        return (
          '<article class="claim"><div class="head">' +
          (c.evidenceLevels.length ? c.evidenceLevels.map(evChip).join(' ') : evChip(c.evidenceLevel)) +
          '<code>' + esc(c.claimId) + '</code></div>' +
          '<p>' + esc(c.text) + '</p>' +
          '<p class="limit">限制：' + esc(c.limitation ?? 'UNKNOWN') + '</p>' +
          '<p class="note">复核：' + esc(c.reviewStatus ?? 'UNKNOWN') + ' · 坐标状态：' + esc(c.coordinateStatus ?? 'UNKNOWN') + ' · 来源：' + srcHtml + '</p>' +
          '</article>'
        );
      })
      .join('');
    return '<h2>证据</h2><p style="font-size:13px;color:var(--text-muted)">按层级过滤，共 ' + list.length + ' 条。生成资产与机制示意不会被写成实测。</p>' + html;
  }

  private samplesPanel(state: AppState): string {
    const sci = cachedScience();
    const list: Sample[] = samplesFor(sci, { siteId: state.siteId, levelId: state.levelId });
    if (list.length === 0) return '<h2>样本</h2><div class="empty">这一层没有登记样本。样本状态只有 PLANNED → COLLECTED → PROCESSED → IMAGED → IDENTIFIED → PUBLISHED。</div>';
    return '<h2>样本</h2>' + list
      .map((s) => {
        const tone = s.sampleStatus === 'PLANNED' ? 'unknown' : 'ok';
        return (
          '<article class="sample"><div class="head"><b>' + esc(s.sampleName) + '</b>' + statusChip(s.sampleStatus, tone) + '</div>' +
          '<small>母体：' + esc(s.parentObjectId ?? 'UNKNOWN') + ' · 坐标状态：' + esc(s.coordinateStatus) + '</small>' +
          '<small>' + esc(s.sampleStatusReason ?? '') + '</small>' +
          (s.mustNotClaim && s.mustNotClaim.length ? '<small>不得声称：' + s.mustNotClaim.map(esc).join('；') + '</small>' : '') +
          '</article>'
        );
      })
      .join('');
  }

  /* -------------------------------------------------------------- scene */
  setAnchors(list: AnchorHit[]): void {
    this.currentAnchors = list;
    const html = list
      .filter((a) => a.visible)
      .map(
        (a) =>
          '<button class="anchor" type="button" data-anchor="' + esc(a.id) + '" style="left:' + a.x + 'px;top:' + a.y + 'px">' +
          '<span class="ring"></span>' + esc(a.label) + '</button>'
      )
      .join('');
    this.anchors.innerHTML = html;
    this.anchors.querySelectorAll<HTMLButtonElement>('[data-anchor]').forEach((b) => {
      b.addEventListener('click', () => {
        const hit = this.currentAnchors.find((a) => a.id === b.dataset.anchor);
        if (hit) this.handlers.onAnchor(hit);
      });
    });
  }

  renderSceneMeta(state: AppState, extra: { tier: string; fps: number; triangles: number }): void {
    const meta = this.scene.querySelector<HTMLElement>('#scene-meta');
    const hint = this.scene.querySelector<HTMLElement>('#scene-hints');
    const foot = this.scene.querySelector<HTMLElement>('#scene-foot');
    if (meta) {
      meta.innerHTML =
        '<div class="title">' + esc(routeLabel(state)) + '</div>' +
        '<div class="sub">' + esc(state.tier !== 'valley' ? siteById(state.siteId)?.coordinateNote ?? APP_META.placeSub : APP_META.placeSub) + (state.levelId ? ' · ' + esc(state.levelId) : '') + '</div>';
    }
    if (hint) {
      hint.innerHTML =
        '<span class="chip">' + esc(TIER_LABEL[state.tier] ?? state.tier) + '</span>' +
        '<span class="chip"><b>' + esc(state.cameraId ?? 'UNKNOWN') + '</b> 设计机位</span>' +
        '<span class="chip unknown">DEM/几何日期 UNKNOWN</span>' +
        (state.compare !== 'off' ? '<span class="chip L3">对比 ' + esc(state.compare) + '</span>' : '');
    }
    if (foot) {
      foot.innerHTML =
        '<span>拖拽旋转 · 滚轮缩放 · 锚点可点</span>' +
        '<span>' + extra.fps + ' fps · ' + extra.triangles.toLocaleString('en-US') + ' 三角形（WARP 软渲染，非性能结论）</span>';
    }
  }

  setBottomState(state: AppState, enabled: { prev: boolean; next: boolean; exit: boolean }): void {
    const prev = this.bottom.querySelector<HTMLButtonElement>('#btn-prev');
    const next = this.bottom.querySelector<HTMLButtonElement>('#btn-next');
    const exit = this.bottom.querySelector<HTMLButtonElement>('#btn-exit');
    if (prev) {
      prev.disabled = !enabled.prev;
      prev.textContent = ACTIONS.prev;
    }
    if (next) {
      next.disabled = !enabled.next;
      next.textContent = ACTIONS.next;
    }
    if (exit) {
      exit.disabled = !enabled.exit;
      exit.textContent = ACTIONS.exit;
    }
    const status = this.bottom.querySelector<HTMLElement>('#bottom-status');
    if (status) status.textContent = routeLabel(state);
  }

  refresh(state: AppState): void {
    this.renderLeft(state);
    this.renderRight(state);
  }

  setMode(mode: Mode): void {
    const seg = this.root.querySelector<HTMLElement>('#mode-seg');
    if (!seg) return;
    seg.innerHTML = MODES.map(
      (m) => '<button type="button" data-mode="' + esc(m.id) + '" aria-pressed="' + (m.id === mode ? 'true' : 'false') + '">' + esc(m.label) + '</button>'
    ).join('');
    seg.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => this.handlers.onMode((b.dataset.mode as Mode) ?? 'journey'));
    });
  }

  stageIndexNow(): number {
    return this.stageIndex;
  }

  get sceneHost(): HTMLElement {
    return this.scene;
  }
}
