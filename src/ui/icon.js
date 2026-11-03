// src/ui/icon.js — 아이콘 한 벌(SVG 스프라이트)을 단추에 붙이는 작은 도우미 (ui 계층)
//
// 신설 파일이다(2026-11-03, RM-18). 그전에는 단추 글자 앞에 그때 떠오른 이모지나 유니코드 기호(✨ 📁 ▶ ⤢ ▮)를 붙였다.
// 같은 줄에 컬러 그림과 흑백 기호가 섞였고, OS 마다 모양 · 크기가 달랐고, 글자색 · 테마를 따르지 않았다.
//
// 이제 그림은 `index.html` 맨 앞의 숨은 `<svg id="icon-sprite">` 한 덩어리에서만 온다(개발 원칙 U-19).
//   · 단추는 `[svg.icon > use#i-이름]` + `[span.lbl 글자]` 두 칸이다. 글자가 주인이고 아이콘은 돕기만 한다.
//   · 상태에 따라 글자가 바뀌는 자리(마이크 켜기/끄기 · 재생/멈춤)는 **글자 칸만** 간다 — `textContent` 로 단추를
//     통째로 바꾸면 아이콘이 지워진다. 그래서 `setLabel` · `iconLabel` 만 쓴다.
//   · 글자 없이 아이콘만 있는 단추는 `aria-label` · `title` 을 반드시 단다 — 화면 읽기 프로그램이 읽을 이름이다.
//   · 스타일시트의 `::before` · `::after` 는 `<use>` 를 부를 수 없다. `installIconMasks` 가 스프라이트에서 `--icon-이름`
//     마스크를 만들어 `:root` 에 단다 — 경로를 CSS 에 두 번 적지 않는다.
//
// ⚠ 이 파일은 document 를 만지지만 전역을 잡지 않는다 — 요소의 ownerDocument 를 쓰고, 없으면 인자로 받는다(시험이 가짜를 넘긴다).

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 스프라이트의 symbol id 앞붙이. `#i-play` 처럼 부른다. */
export const ICON_PREFIX = 'i-';
/** 마스크 그림의 칠 — index.html 의 `.icon` 규칙과 같은 값(선 굵기 2 · 둥근 끝). 마스크라 색은 모양만 정한다. */
export const MASK_PAINT = Object.freeze({
  // 원칙-예외(U-16): 마스크 그림의 칠이다 — 화면 색이 아니라 「어디가 보이나」만 정한다. 실제 색은 background-color: currentColor
  fill: 'none', stroke: 'black', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
});
/** 단추의 글자 칸 클래스. */
export const LABEL_CLASS = 'lbl';

/** 글자를 마크업에 넣을 때 쓰는 최소 이스케이프. */
// @complexity time=O(n) space=O(n) cc=1
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 템플릿(innerHTML)용 아이콘 마크업. 이름이 비면 빈 글자.
 * @param {string} name 스프라이트 이름(`play` · `x` …)
 * @returns {string}
 */
// @complexity time=O(1) space=O(1) cc=2
export function iconHtml(name) {
  if (!name) return '';
  return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#${ICON_PREFIX}${esc(name)}"></use></svg>`;
}

/**
 * 템플릿용 「아이콘 + 글자 칸」. 글자가 비면 아이콘만(그때는 부르는 쪽이 aria-label 을 단다).
 * @param {string} name
 * @param {string} [text]
 * @returns {string}
 */
// @complexity time=O(n) space=O(n) cc=2
export function iconLabelHtml(name, text = '') {
  return iconHtml(name) + (text ? `<span class="${LABEL_CLASS}">${esc(text)}</span>` : '');
}

/**
 * 아이콘 요소 하나(svg > use). `aria-hidden` — 이름은 글자 칸이나 aria-label 이 말한다.
 * @param {Document} doc
 * @param {string} name
 * @returns {Element}
 */
// @complexity time=O(1) space=O(1) cc=2
export function iconEl(doc, name) {
  const make = (tag) => (doc.createElementNS ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag));
  const svg = make('svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset ? (svg.dataset.icon = name) : svg.setAttribute('data-icon', name);
  const use = make('use');
  use.setAttribute('href', `#${ICON_PREFIX}${name}`);
  svg.appendChild(use);
  return svg;
}

/** 요소의 자식 가운데 아이콘(svg.icon) · 글자 칸(span.lbl). */
// ⚠ class 는 속성으로 먼저 읽는다 — svg 의 className 은 글자가 아니라 SVGAnimatedString 이다. 속성이 비면 className(글자일 때만).
// @complexity time=O(c) space=O(1) cc=7
function parts(el) {
  let icon = null; let label = null;
  for (const c of Array.from(el.children || [])) {
    const cls = (typeof c.getAttribute === 'function' && c.getAttribute('class')) || (typeof c.className === 'string' ? c.className : '');
    if (!icon && /(?:^|\s)icon(?:\s|$)/.test(cls)) icon = c;
    else if (!label && /(?:^|\s)lbl(?:\s|$)/.test(cls)) label = c;
  }
  return { icon, label };
}

/** 아이콘 요소가 가리키는 이름. */
// @complexity time=O(1) space=O(1) cc=3
function iconNameOf(svg) {
  if (!svg) return '';
  if (svg.dataset && svg.dataset.icon) return svg.dataset.icon;
  const use = svg.firstChild || (svg.children && svg.children[0]);
  const href = use && typeof use.getAttribute === 'function' ? use.getAttribute('href') || '' : '';
  return href.replace(`#${ICON_PREFIX}`, '');
}

/**
 * 요소를 「아이콘 + 글자 칸」으로 맞춘다. **여러 번 불러도 같은 결과**다 — 이미 같은 아이콘 · 글자 칸이 있으면 글자만 간다.
 * 그래서 다시 그리는 뷰(엄지 바 · 영상 패널)가 그릴 때마다 불러도 노드가 갈리지 않는다(누르는 순간 사라지지 않는다).
 * 글자가 비면 아이콘만 남긴다 — 그때는 부르는 쪽이 `aria-label` · `title` 을 단다.
 * @param {Element} el 보통 button
 * @param {string} name 스프라이트 이름. 비면 글자만
 * @param {string} [text]
 * @param {Document} [doc]
 * @returns {Element} el
 */
// @complexity time=O(c) space=O(1) cc=6
export function iconLabel(el, name, text = '', doc = el.ownerDocument || globalThis.document) {
  const { icon, label } = parts(el);
  const iconOk = name ? (icon && iconNameOf(icon) === name) : !icon;
  const labelOk = text ? Boolean(label) : !label;
  if (iconOk && labelOk) {
    if (label && label.textContent !== text) label.textContent = text;
    return el;
  }
  const kids = [];
  if (name) kids.push(iconOk && icon ? icon : iconEl(doc, name));
  if (text) {
    const span = label || doc.createElement('span');
    span.className = LABEL_CLASS;
    span.textContent = text;
    kids.push(span);
  }
  if (typeof el.replaceChildren === 'function') el.replaceChildren(...kids);
  else {
    el.textContent = '';
    for (const k of kids) el.appendChild(k);
  }
  return el;
}

/**
 * 글자 칸만 간다 — 아이콘은 그대로 둔다. 글자 칸이 없는 요소(옛 마크업)면 글자 칸을 하나 만든다.
 * @param {Element} el
 * @param {string} text
 * @param {Document} [doc]
 * @returns {Element} el
 */
// @complexity time=O(c) space=O(1) cc=3
export function setLabel(el, text, doc = el.ownerDocument || globalThis.document) {
  const { icon, label } = parts(el);
  if (label) { if (label.textContent !== text) label.textContent = text; return el; }
  return iconLabel(el, icon ? iconNameOf(icon) : '', text, doc);
}

/**
 * 요소의 글자 칸 글자(없으면 textContent). 시험과 상태 판정이 쓴다.
 * @param {Element} el
 * @returns {string}
 */
// @complexity time=O(c) space=O(1) cc=2
export function labelOf(el) {
  const { label } = parts(el);
  return label ? label.textContent : (el.textContent || '');
}

/**
 * 글자 없이 아이콘만 있는 단추. 이름(aria-label · title)이 없으면 던진다 — 읽을 이름이 없는 단추를 만들지 않는다.
 * @param {Element} el
 * @param {string} name
 * @param {string} accessibleName
 * @param {Document} [doc]
 * @returns {Element} el
 */
// @complexity time=O(1) space=O(1) cc=2
export function iconOnly(el, name, accessibleName, doc = el.ownerDocument || globalThis.document) {
  if (!accessibleName) throw new Error(`아이콘만 있는 단추(${name})에 이름(aria-label)이 없다`);
  iconLabel(el, name, '', doc);
  el.setAttribute('aria-label', accessibleName);
  if (!el.title) el.title = accessibleName;
  return el;
}

/**
 * 스프라이트의 symbol 하나 → CSS 마스크로 쓸 data URI. 색은 마스크라 상관없다(모양만 쓴다).
 * @param {string} inner symbol 안의 마크업
 * @param {Record<string, string>} attrs viewBox 와 칠(MASK_PAINT). 안쪽의 currentColor 는 검정으로 그려진다
 * @returns {string} `url("data:image/svg+xml,…")`
 */
// @complexity time=O(n) space=O(n) cc=2
export function maskUrl(inner, attrs) {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const svg = `<svg xmlns="${SVG_NS}"${a}>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * 스프라이트의 symbol 마다 `--icon-이름` 을 `:root` 에 단다 — 스타일시트의 `::before` · `::after` 가 `mask` 로 쓴다.
 * 부팅 때 한 번 부른다. 스프라이트가 없으면 0.
 * @param {Document} doc
 * @returns {number} 단 변수 수
 */
// @complexity time=O(s) space=O(s) cc=3
export function installIconMasks(doc) {
  const sprite = doc.getElementById('icon-sprite');
  if (!sprite) return 0;
  let n = 0;
  for (const sym of Array.from(sprite.querySelectorAll('symbol'))) {
    const id = sym.id || '';
    if (!id.startsWith(ICON_PREFIX)) continue;
    // 칠은 스타일시트의 .icon 이 주므로 symbol 에 없다 — 마스크 그림에는 같은 값을 여기서 적는다(색은 마스크라 상관없다)
    const attrs = { ...MASK_PAINT };
    for (const at of Array.from(sym.attributes)) if (at.name !== 'id') attrs[at.name] = at.value;
    doc.documentElement.style.setProperty(`--icon-${id.slice(ICON_PREFIX.length)}`, maskUrl(sym.innerHTML, attrs));
    n += 1;
  }
  return n;
}
