// src/ui/docsHub.js — 앱 안에서 프로젝트 문서를 읽는 화면.
//
// 저장소를 열지 않아도 문서가 읽히게 하는 것이 목적이다. 상단 `문서` 버튼 → 갈래별 목록 옆단 → 본문.
// 목록의 주인은 docsRegistry.js 하나이고, 이 파일은 그것만 읽는다(화면 코드에 문서 목록을 손으로 적지 않는다).
//
// 이 파일이 스스로 하는 일: 자기 DOM 과 자기 <style> 을 만들어 붙인다.
// → index.html 의 마크업·CSS 를 건드리지 않는다(골든·셀렉터 계약 보호).

import { DOCS, DOC_GROUPS, DEFAULT_DOC_ID, docsByGroup, resolveDoc, idForFileName } from './docsRegistry.js';

const STYLE_ID = 'docs-hub-style';
const CSS = `
.docs-overlay { position: fixed; inset: 0; z-index: 6000; display: none;
  background: rgba(6,10,20,0.72); backdrop-filter: blur(3px); }
.docs-overlay[data-open="1"] { display: block; }
.docs-shell { position: absolute; inset: 3vh 3vw; display: grid;
  grid-template-columns: 264px 1fr; grid-template-rows: auto 1fr;
  background: #0f1729; border: 1px solid rgba(148,163,184,0.22); border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45); overflow: hidden; }
.docs-head { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid rgba(148,163,184,0.16); }
.docs-head h2 { margin: 0; font-size: 14px; font-weight: 800; color: #e5e7eb; }
.docs-head .docs-sub { font-size: 11px; color: #94a3b8; }
.docs-head .docs-spacer { flex: 1; }
.docs-side { border-right: 1px solid rgba(148,163,184,0.16); overflow-y: auto;
  padding: 10px 8px 24px; min-height: 0; }
.docs-group { margin-bottom: 12px; }
.docs-group > .docs-group-label { font-size: 10px; font-weight: 800; letter-spacing: .04em;
  color: #7c8aa3; padding: 4px 8px; text-transform: none; }
.docs-item { display: block; width: 100%; text-align: left; border: 0; cursor: pointer;
  background: transparent; color: #cbd5e1; font-size: 12px; padding: 6px 8px;
  border-radius: 7px; line-height: 1.35; }
.docs-item:hover { background: rgba(148,163,184,0.10); transform: none; }
.docs-item[aria-current="true"] { background: rgba(34,197,94,0.16); color: #eafff1; font-weight: 700; }
.docs-item .docs-item-desc { display: block; font-size: 10px; color: #7c8aa3; font-weight: 400; margin-top: 1px; }
.docs-item[aria-current="true"] .docs-item-desc { color: #a7d8bb; }
.docs-toc { margin: 2px 0 10px 6px; padding-left: 6px; border-left: 1px solid rgba(148,163,184,0.18); }
.docs-toc-row { display: flex; align-items: flex-start; gap: 2px; }
.docs-toc-twisty { flex: 0 0 auto; width: 14px; border: 0; background: transparent; cursor: pointer;
  color: #64748b; font-size: 9px; line-height: 18px; padding: 0; }
.docs-toc-twisty[hidden] { visibility: hidden; display: block; }
.docs-toc-link { flex: 1; display: block; text-align: left; border: 0; background: transparent;
  cursor: pointer; color: #9fb0c6; font-size: 11px; padding: 2px 6px; border-radius: 5px;
  line-height: 1.35; border-left: 2px solid transparent; }
.docs-toc-link:hover { color: #e2e8f0; transform: none; }
.docs-toc-link[data-lv="2"] { font-size: 10.5px; color: #8496ae; padding-left: 12px; }
/* 읽는 위치는 테두리로 표시한다 — 배경색은 '고른 문서'가 이미 쓰고 있다 */
.docs-toc-link[data-active="1"] { border-left-color: #22c55e; color: #eafff1; }
.docs-toc-children[hidden] { display: none; }
.docs-body { overflow-y: auto; padding: 18px 28px 60vh; min-height: 0; color: #dbe4ef;
  font-size: 13px; line-height: 1.72; }
.docs-body :is(h1,h2,h3,h4) { scroll-margin-top: 16px; color: #f1f5f9; line-height: 1.35; }
.docs-body h1 { font-size: 21px; margin: 4px 0 14px; }
.docs-body h2 { font-size: 16px; margin: 26px 0 8px; padding-bottom: 5px;
  border-bottom: 1px solid rgba(148,163,184,0.16); }
.docs-body h3 { font-size: 13.5px; margin: 18px 0 6px; }
.docs-body h4 { font-size: 12.5px; margin: 14px 0 4px; color: #cbd5e1; }
.docs-body p { margin: 8px 0; }
.docs-body ul, .docs-body ol { margin: 8px 0; padding-left: 20px; }
.docs-body li { margin: 3px 0; }
.docs-body li > ul, .docs-body li > ol { margin: 2px 0; }
.docs-body code { background: rgba(148,163,184,0.14); padding: 1px 5px; border-radius: 4px;
  font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.docs-body pre { background: #0b1220; border: 1px solid rgba(148,163,184,0.16); border-radius: 8px;
  padding: 10px 12px; overflow-x: auto; margin: 10px 0; }
.docs-body pre code { background: none; padding: 0; font-size: 11.5px; line-height: 1.6; }
.docs-body blockquote { margin: 10px 0; padding: 2px 12px; border-left: 3px solid rgba(148,163,184,0.3);
  color: #a8b6c9; }
.docs-body hr { border: 0; border-top: 1px solid rgba(148,163,184,0.16); margin: 18px 0; }
.docs-body a { color: #7dd3fc; text-decoration: none; }
.docs-body a:hover { text-decoration: underline; }
.docs-table-wrap { overflow-x: auto; margin: 10px 0; }
.docs-body table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
.docs-body th, .docs-body td { border: 1px solid rgba(148,163,184,0.18); padding: 5px 9px;
  text-align: left; vertical-align: top; }
.docs-body th { background: rgba(148,163,184,0.10); font-weight: 700; color: #e2e8f0; }
.docs-body strong { color: #f8fafc; }
.docs-note { margin: 0 0 14px; padding: 8px 11px; border-radius: 8px; font-size: 12px;
  background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.3); color: #fcd9a0; }
.docs-crumb { font-size: 10px; color: #64748b; margin-top: 40px; padding-top: 10px;
  border-top: 1px solid rgba(148,163,184,0.12); }
@media (max-width: 900px) {
  .docs-shell { inset: 0; border-radius: 0; grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; }
  .docs-side { max-height: 34vh; border-right: 0; border-bottom: 1px solid rgba(148,163,184,0.16); }
  .docs-body { padding: 14px 16px 60vh; }
}
`;

// ── 마크다운 ────────────────────────────────────────────────────────────────
// 뷰어가 지원하는 문법: #~#### 제목 · 문단 · - 목록(중첩 1단) · 1. 목록 · 표 ·
// ``` 코드블록 · > 인용 · --- 구분선 · **굵게** · *기울임* · `코드` · [링크](대상)
// 원시 HTML 은 렌더하지 않고 글자로 이스케이프한다. 유일한 예외가 `<a id="x"></a>` 로,
// 제목 바로 앞에 오면 그 제목의 짧은 앵커로 쓴다(PRINCIPLES.md 의 R-1/D-2 링크).

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** GitHub 규칙에 가깝게: 소문자화, 구두점 제거, 공백→하이픈. 한글은 살린다. */
function slugify(text) {
  return String(text).trim().toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N} \-_]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function inline(md) {
  let s = escapeHtml(md);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const safe = /^(https?:|mailto:|#|[\w./-]+\.md(#|$)|[\w./-]+\.html(#|$))/i.test(href);
    if (!safe) return text;
    const ext = /^https?:/i.test(href);
    const attrs = ext ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(href)}" data-href="${escapeHtml(href)}"${attrs}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return s;
}

const ANCHOR_LINE = /^\s*<a\s+(?:id|name)=["']([^"']+)["']\s*>\s*<\/a>\s*$/i;
const SHORT_CODE = /^([A-Z]{1,3}-\d{1,3})\b/;

/**
 * 마크다운을 HTML 로. 제목 목록도 함께 돌려준다(옆단 목차용).
 * @returns {{ html: string, headings: {id:string, text:string, level:number}[] }}
 */
export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const used = new Set();
  let pendingAnchor = null;
  let i = 0;

  const uniq = (base) => {
    let id = base || 'section';
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  };

  const closeParagraph = (buf) => {
    if (buf.length) { out.push(`<p>${inline(buf.join(' '))}</p>`); buf.length = 0; }
  };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // 코드블록
    const fence = line.match(/^\s*```+\s*([\w-]*)\s*$/);
    if (fence) {
      closeParagraph(para);
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // 명시적 앵커 — 다음 제목이 가져간다
    const anchorHit = line.match(ANCHOR_LINE);
    if (anchorHit) { closeParagraph(para); pendingAnchor = anchorHit[1]; i++; continue; }

    // 제목
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeParagraph(para);
      const level = h[1].length;
      const text = h[2].trim().replace(/\s*#+\s*$/, '');
      const plain = text.replace(/[*`]/g, '');
      const short = plain.match(SHORT_CODE);
      const primary = pendingAnchor || (short ? short[1].toLowerCase() : slugify(plain));
      const id = uniq(primary);
      // 짧은 코드 제목은 전체 슬러그로도 닿게 해 둔다
      const extra = !pendingAnchor && short ? ` <span id="${escapeHtml(uniq(slugify(plain)))}"></span>` : '';
      pendingAnchor = null;
      headings.push({ id, text: plain, level });
      out.push(`<h${level} id="${escapeHtml(id)}">${inline(text)}${extra}</h${level}>`);
      i++;
      continue;
    }

    // 구분선
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      closeParagraph(para); out.push('<hr />'); i++; continue;
    }

    // 표
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      closeParagraph(para);
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<div class="docs-table-wrap"><table><thead><tr>'
        + head.map(c => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    // 목록 (중첩 1단까지)
    if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
      closeParagraph(para);
      const block = [];
      while (i < lines.length && (/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        block.push(lines[i++]);
      }
      out.push(renderList(block));
      continue;
    }

    // 인용
    if (/^\s*>\s?/.test(line)) {
      closeParagraph(para);
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quote.join('\n')).html}</blockquote>`);
      continue;
    }

    if (!line.trim()) { closeParagraph(para); i++; continue; }
    para.push(line.trim());
    i++;
  }
  closeParagraph(para);
  return { html: out.join('\n'), headings };
}

function renderList(block) {
  const items = [];
  for (const raw of block) {
    const m = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (m) items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), text: m[3] });
    else if (items.length) items[items.length - 1].text += ' ' + raw.trim();
  }
  if (!items.length) return '';
  const base = Math.min(...items.map(it => it.indent));
  const tag = items[0].ordered ? 'ol' : 'ul';
  const parts = [`<${tag}>`];
  let open = false;
  let childTag = 'ul';
  for (const it of items) {
    if (it.indent > base) {
      if (!open) { childTag = it.ordered ? 'ol' : 'ul'; parts.push(`<${childTag}>`); open = true; }
      parts.push(`<li>${inline(it.text)}</li>`);
    } else {
      if (open) { parts.push(`</${childTag}>`); open = false; }
      parts.push(`<li>${inline(it.text)}</li>`);
    }
  }
  if (open) parts.push(`</${childTag}>`);
  parts.push(`</${tag}>`);
  // 하위 목록은 바로 앞 li 안으로 들어가야 의미가 맞다
  return parts.join('').replace(/<\/li>(<(?:ul|ol)>)/g, '$1').replace(/(<\/(?:ul|ol)>)/g, '$1</li>')
    .replace(new RegExp(`(</(?:ul|ol)></li>)</${tag}>$`), `$1</${tag}>`);
}

// ── 옆단 목차: 깊이는 절대값이 아니라 상대값으로 잡는다 ──────────────────────
// 문서마다 # 을 쓰는 방식이 다르다. 첫 h1(문서 제목)을 뺀 나머지 중 가장 얕은 것이 1단이다.
export function buildToc(headings) {
  const rest = headings.filter((h, idx) => !(idx === 0 && h.level === 1));
  if (!rest.length) return [];
  const top = Math.min(...rest.map(h => h.level));
  const tree = [];
  for (const h of rest) {
    if (h.level === top) tree.push({ ...h, children: [] });
    else if (h.level === top + 1 && tree.length) tree[tree.length - 1].children.push(h);
    // top+2 보다 깊은 제목은 옆단에 올리지 않는다 — 목차가 본문만큼 길어진다
  }
  return tree;
}

// ── 화면 ────────────────────────────────────────────────────────────────────

/**
 * 문서 허브를 만든다. 상단 진입점 버튼을 `container` 안에 넣고, 본문 오버레이는 body 에 붙인다.
 * @param {{ container: HTMLElement, doc?: Document, fetchImpl?: typeof fetch }} deps
 */
export function createDocsHub({ container, doc = document, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const openBtn = doc.createElement('button');
  openBtn.id = 'docsOpenBtn';
  openBtn.className = 'ghost';
  openBtn.type = 'button';
  openBtn.textContent = '문서';
  openBtn.title = '프로젝트 문서를 앱 안에서 읽는다';
  if (container) container.appendChild(openBtn);

  const overlay = doc.createElement('div');
  overlay.className = 'docs-overlay';
  overlay.innerHTML = `
    <div class="docs-shell" role="dialog" aria-modal="true" aria-label="프로젝트 문서">
      <div class="docs-head">
        <h2>문서</h2>
        <span class="docs-sub">저장소를 열지 않고 여기서 읽는다</span>
        <span class="docs-spacer"></span>
        <button class="ghost" data-act="close" type="button">✕ 닫기</button>
      </div>
      <nav class="docs-side"></nav>
      <article class="docs-body" tabindex="-1"></article>
    </div>`;
  doc.body.appendChild(overlay);

  const sideEl = overlay.querySelector('.docs-side');
  const bodyEl = overlay.querySelector('.docs-body');

  let currentId = null;
  let toc = [];
  let activeAnchor = null;
  let expanded = new Set();
  let rafPending = false;
  const cache = new Map();

  function isOpen() { return overlay.dataset.open === '1'; }

  function syncUrl(docId, anchor) {
    try {
      const url = new URL(doc.defaultView.location.href);
      url.searchParams.set('doc', docId);
      url.hash = anchor ? '#' + anchor : '';
      doc.defaultView.history.replaceState(null, '', url);
    } catch { /* 주소를 못 바꿔도 읽기에는 지장이 없다 */ }
  }

  function clearUrl() {
    try {
      const url = new URL(doc.defaultView.location.href);
      url.searchParams.delete('doc');
      url.hash = '';
      doc.defaultView.history.replaceState(null, '', url);
    } catch { /* 무시 */ }
  }

  function renderSide() {
    const groups = docsByGroup();
    const frag = doc.createDocumentFragment();
    for (const g of groups) {
      if (!g.docs.length) continue;
      const box = doc.createElement('div');
      box.className = 'docs-group';
      const label = doc.createElement('div');
      label.className = 'docs-group-label';
      label.textContent = g.label;
      box.appendChild(label);
      for (const d of g.docs) {
        const btn = doc.createElement('button');
        btn.className = 'docs-item';
        btn.type = 'button';
        btn.dataset.docId = d.id;
        btn.setAttribute('aria-current', String(d.id === currentId));
        btn.innerHTML = `${escapeHtml(d.title)}<span class="docs-item-desc">${escapeHtml(d.desc)}</span>`;
        box.appendChild(btn);
        if (d.id === currentId) box.appendChild(renderToc());
      }
      frag.appendChild(box);
    }
    sideEl.replaceChildren(frag);
  }

  // 목차만 다시 그린다 — 문서 목록까지 다시 그리면 스크롤 도중 옆단이 튄다
  function renderToc() {
    const wrap = doc.createElement('div');
    wrap.className = 'docs-toc';
    for (const node of toc) {
      const row = doc.createElement('div');
      row.className = 'docs-toc-row';
      const twisty = doc.createElement('button');
      twisty.className = 'docs-toc-twisty';
      twisty.type = 'button';
      twisty.dataset.twisty = node.id;
      twisty.textContent = expanded.has(node.id) ? '▾' : '▸';
      twisty.hidden = node.children.length === 0;
      const link = doc.createElement('button');
      link.className = 'docs-toc-link';
      link.type = 'button';
      link.dataset.anchor = node.id;
      link.dataset.lv = '1';
      link.textContent = node.text;
      if (node.id === activeAnchor) link.dataset.active = '1';
      row.append(twisty, link);
      wrap.appendChild(row);

      if (node.children.length) {
        const kids = doc.createElement('div');
        kids.className = 'docs-toc-children';
        kids.hidden = !expanded.has(node.id);
        for (const c of node.children) {
          const cl = doc.createElement('button');
          cl.className = 'docs-toc-link';
          cl.type = 'button';
          cl.dataset.anchor = c.id;
          cl.dataset.lv = '2';
          cl.textContent = c.text;
          if (c.id === activeAnchor) cl.dataset.active = '1';
          kids.appendChild(cl);
        }
        wrap.appendChild(kids);
      }
    }
    return wrap;
  }

  function refreshToc() {
    const old = sideEl.querySelector('.docs-toc');
    if (old) old.replaceWith(renderToc());
  }

  async function load(docId, anchor) {
    const entry = resolveDoc(docId);
    if (!entry) return;
    currentId = entry.id;
    activeAnchor = null;
    expanded = new Set();

    let text = cache.get(entry.id);
    if (text === undefined) {
      bodyEl.innerHTML = '<p class="docs-note">문서를 불러오는 중…</p>';
      try {
        const res = await doFetch(entry.path, { cache: 'no-cache' });
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
        cache.set(entry.id, text);
      } catch (err) {
        const local = doc.defaultView.location.protocol === 'file:';
        bodyEl.innerHTML = `<div class="docs-note">${escapeHtml(entry.path)} 를 불러오지 못했다`
          + (local
            ? ' — 이 페이지를 <code>file://</code> 로 열었다. 문서는 서버로 열어야 읽힌다: 저장소 폴더에서 <code>python3 -m http.server 8000</code> 을 실행하고 <code>http://localhost:8000</code> 으로 접속한다.'
            : ` (${escapeHtml(String(err.message))}).`)
          + '</div>';
        toc = [];
        renderSide();
        return;
      }
    }

    const { html, headings } = renderMarkdown(text);
    bodyEl.innerHTML = html
      + `<div class="docs-crumb">${escapeHtml(entry.path)} · 이 문서는 저장소 파일 그대로다</div>`;
    toc = buildToc(headings);
    renderSide();
    bodyEl.scrollTop = 0;
    if (anchor) scrollToAnchor(anchor);
    else updateActiveHeading();
    syncUrl(entry.id, anchor || '');
  }

  function scrollToAnchor(anchor) {
    const target = bodyEl.querySelector(`[id="${CSS_escape(anchor)}"]`);
    if (!target) return;
    bodyEl.scrollTop = target.offsetTop - bodyEl.offsetTop - 8;
    activeAnchor = headingIdAt(target);
    expandFor(activeAnchor);
    refreshToc();
  }

  function CSS_escape(v) {
    return (doc.defaultView.CSS && doc.defaultView.CSS.escape)
      ? doc.defaultView.CSS.escape(v)
      : String(v).replace(/["\\]/g, '\\$&');
  }

  function headingIdAt(el) {
    const h = el.closest('h1,h2,h3,h4') || el;
    return h.id || el.id;
  }

  function expandFor(anchorId) {
    for (const node of toc) {
      if (node.id === anchorId || node.children.some(c => c.id === anchorId)) expanded = new Set([node.id]);
    }
  }

  // 읽는 위치 = 화면 위쪽 경계를 지난 마지막 제목
  function updateActiveHeading() {
    const hs = [...bodyEl.querySelectorAll('h1[id],h2[id],h3[id],h4[id]')];
    if (!hs.length) return;
    const line = bodyEl.scrollTop + 12;
    let found = hs[0].id;
    for (const h of hs) {
      if (h.offsetTop - bodyEl.offsetTop <= line) found = h.id;
      else break;
    }
    if (found === activeAnchor) return;
    activeAnchor = found;
    expandFor(found);
    refreshToc();
  }

  bodyEl.addEventListener('scroll', () => {
    if (rafPending) return;
    rafPending = true;
    doc.defaultView.requestAnimationFrame(() => { rafPending = false; updateActiveHeading(); });
  });

  sideEl.addEventListener('click', (e) => {
    const twisty = e.target.closest('[data-twisty]');
    if (twisty) {
      const id = twisty.dataset.twisty;
      if (expanded.has(id)) expanded.delete(id); else expanded = new Set([id]);
      refreshToc();
      return;
    }
    const anchor = e.target.closest('[data-anchor]');
    if (anchor) { scrollToAnchor(anchor.dataset.anchor); syncUrl(currentId, anchor.dataset.anchor); return; }
    const item = e.target.closest('[data-doc-id]');
    if (item) load(item.dataset.docId);
  });

  // 문서끼리 거는 링크: 파일 이름으로 등록부 id 를 찾아 넘어간다
  bodyEl.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-href]');
    if (!a) return;
    const href = a.dataset.href;
    if (/^https?:/i.test(href)) return;
    e.preventDefault();
    if (href.startsWith('#')) { scrollToAnchor(href.slice(1)); syncUrl(currentId, href.slice(1)); return; }
    const [file, hash] = href.split('#');
    const id = idForFileName(file);
    if (id) load(id, hash || '');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-act="close"]')) close();
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
  }, true);

  function open(docId, anchor) {
    overlay.dataset.open = '1';
    const id = docId || currentId || pickFromUrl() || DEFAULT_DOC_ID;
    if (id !== currentId || !bodyEl.childElementCount) load(id, anchor || pickAnchorFromUrl());
    else if (anchor) scrollToAnchor(anchor);
    bodyEl.focus({ preventScroll: true });
  }
  function close() { overlay.dataset.open = '0'; clearUrl(); }

  function pickFromUrl() {
    try {
      const v = new URL(doc.defaultView.location.href).searchParams.get('doc');
      return v && resolveDoc(v) ? v : null;
    } catch { return null; }
  }
  function pickAnchorFromUrl() {
    try { return (doc.defaultView.location.hash || '').replace(/^#/, ''); } catch { return ''; }
  }

  openBtn.addEventListener('click', () => open());

  // ?doc=<id> 로 들어오면 바로 그 문서를 편다
  const fromUrl = pickFromUrl();
  if (fromUrl) open(fromUrl, pickAnchorFromUrl());

  return { open, close, isOpen, element: overlay, button: openBtn, docs: DOCS, groups: DOC_GROUPS };
}
