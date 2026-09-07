// src/ui/cssVars.js — --cellW / --cellH / --rowLabelW / --noteW 의 유일한 소유자 (ui 계층)
//
// 원본 index.html 의 getCellHPx(3340-3342) · updateMobileCellSize 의 setProperty/removeProperty(2248-2265) ·
// adjustNoteColumnWidth(3351-3359) · applyResizePreview 의 --cellW 직독(3798)을 옮겼다.
//
// ⚠ 이 파일은 아무것도 import 하지 않는다. **셀 크기 산술은 여기 없다** —
//   그건 domain/grid.computeCellWidth 의 몫이고, 둘을 잇는 것은 ui/layout.js 다.
//   여기 있는 것은 "계산된 값을 어느 요소의 어느 변수에 쓰는가" 뿐이다.
//
// ⚠ CSS 기본값(index.html:18-21) — :root { --cellW:76px; --rowLabelW:88px; --noteW:280px; --cellH:52px }
//   그리고 좁은 화면 미디어쿼리(769)가 --cellH 를 48px 로 덮는다.

/** 모바일 분기에서 쓰는 고정값. 원본 2260·2264 의 리터럴이다. */
export const MOBILE_ROW_LABEL_W = 48;
/** 모바일 분기의 행 높이. 원본 2264 가 문자열 '40px' 를 그대로 쓴다. */
export const MOBILE_CELL_H = 40;

// ─────────────────────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 현재 행 높이(px). 원본 getCellHPx 그대로다.
 *
 * ⚠ `parseInt` 이고 폴백이 **52** 다. 아래 readCellW 는 `parseFloat` 이고 폴백이 **68** 이다 —
 *   두 함수의 비대칭은 원문 그대로이니 맞추지 마라(폴백 68 은 CSS 기본값 76px 과도 어긋나 있다).
 * ⚠ 원본은 renderRow 안에서 배치 개수만큼 이 함수를 불렀다(3374 + createPlacementEl 3432).
 *   호출부는 한 행에 **한 번** 읽어 내려 넘기면 되고, 값은 같다(같은 프레임 안에서 변하지 않는다).
 *
 * @see index.html:3340
 * @param {Element} [root] 기본값은 document.documentElement — 원본이 읽던 요소다
 * @returns {number}
 */
export function readCellH(root = document.documentElement) {
  return parseInt(getComputedStyle(root).getPropertyValue('--cellH')) || 52;
}

/**
 * 현재 셀 너비(px). 리사이즈 프리뷰의 3단 폴백 중 마지막 단계(트랙을 못 찾았을 때)가 쓴다.
 * ⚠ `parseFloat` · 폴백 **68**. 위 readCellH 와 다른 것이 원문이다.
 *
 * @see index.html:3798
 * @param {Element} [root] 기본값은 document.documentElement
 * @returns {number}
 */
export function readCellW(root = document.documentElement) {
  return parseFloat(getComputedStyle(root).getPropertyValue('--cellW')) || 68;
}

// ─────────────────────────────────────────────────────────────────────────────
// 격자 변수 쓰기/지우기 — updateMobileCellSize(2247-2266)의 DOM 부분
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 격자 변수를 쓴다. 원본 모바일 분기(2262-2264)의 세 줄이다.
 *
 * ⚠ 쓰는 **순서**도 원문 그대로 cellW → rowLabelW → cellH 다.
 * ⚠ 넘기지 않은 키는 건드리지 않는다(지우지도 않는다).
 * ⚠ 숫자를 넘기면 'px' 를 붙이고 문자열은 그대로 쓴다. 원본은 cellW·rowLabelW 를 `+ 'px'` 로,
 *   cellH 를 리터럴 '40px' 로 만들었다 — 두 형태가 같은 결과를 낸다.
 *
 * @see index.html:2262
 * @param {HTMLElement} root 변수를 쓸 요소. 원본은 언제나 document.documentElement 다
 * @param {{ cellW?: number|string, rowLabelW?: number|string, cellH?: number|string }} vars
 * @returns {void}
 */
export function setGridVars(root, vars = {}) {
  if (vars.cellW != null) root.style.setProperty('--cellW', px(vars.cellW));
  if (vars.rowLabelW != null) root.style.setProperty('--rowLabelW', px(vars.rowLabelW));
  if (vars.cellH != null) root.style.setProperty('--cellH', px(vars.cellH));
}

/**
 * 격자 변수를 지워 CSS 기본값으로 되돌린다. 원본 데스크톱 분기(2250-2251)다.
 *
 * ⚠⚠ **보존 대상 결함(FINAL-architecture #12).** 원본은 `--cellW` 와 `--rowLabelW` 만 지우고
 *   `--cellH` 는 **지우지 않는다**. 그래서 좁은 화면에서 40px 를 한 번 쓴 뒤 창을 넓히면
 *   행 높이가 40px 로 남는다(리로드해야 52px 로 돌아온다).
 *   `resetCellH: true`(= FINAL-architecture 의 RESET_CELLH_ON_DESKTOP 플래그)로 고칠 수 있게만 열어 두고
 *   **기본값은 false** 다 — 이번 PR 에서 켜지 마라.
 *
 * @see index.html:2249
 * @param {HTMLElement} root
 * @param {{ resetCellH?: boolean }} [options]
 * @returns {void}
 */
export function clearGridVars(root, options = {}) {
  const { resetCellH = false } = options;
  root.style.removeProperty('--cellW');
  root.style.removeProperty('--rowLabelW');
  if (resetCellH) root.style.removeProperty('--cellH');
}

// ─────────────────────────────────────────────────────────────────────────────
// 비고 칸 폭 — adjustNoteColumnWidth(3351-3359)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 비고 칸 내용에 맞춰 `--noteW` 를 다시 잰다.
 *
 * ⚠⚠ **`--noteW` 는 보드마다 다른 요소에 쓰인다.** 원본 3354 의 `ctx.noteRoot` 는
 *   메인 보드가 `#mainBoardWrap`(1479), 루틴 편집 보드가 `#reBoardWrap`(1495)이고
 *   둘 다 없을 때만 document.documentElement 로 떨어진다. 그래서 첫 인자가 noteRoot 다 —
 *   실수로 documentElement 를 넘기면 한 보드의 측정이 다른 보드의 폭을 덮어쓴다.
 *
 * ⚠ 측정 절차도 원문 그대로 세 단계다: `--noteW` 를 0px 로 쓰고 → 각 칸의 scrollWidth 를 재고 →
 *   `max(60, maxW + 16)` 을 다시 쓴다. 0px 를 먼저 쓰지 않으면 이전 폭이 하한이 되어 칸이 줄지 않는다
 *   (강제 리플로가 두 번 나는 것도 원문 그대로다).
 * ⚠ 칸이 하나도 없으면 **아무것도 쓰지 않고** 그대로 돌아간다(원본 3353의 조기 반환).
 *   그래서 셀렉션은 호출부(ui/boardView)가 하고 여기는 이미 모은 목록을 받는다 —
 *   이 파일이 domContract 를 import 하지 않게 하려는 이유이기도 하다.
 *
 * @see index.html:3351
 * @param {HTMLElement|null|undefined} noteRoot 변수를 쓸 요소(보드별 wrap). 없으면 documentElement
 * @param {ArrayLike<HTMLElement>} noteCells 그 보드의 `.note-cell` 전부 (boardView 가 모은다)
 * @returns {number|null} 실제로 쓴 px 값. 칸이 없어 건너뛰었으면 null
 */
export function setNoteWidth(noteRoot, noteCells) {
  const cells = noteCells ? Array.from(noteCells) : [];
  if (!cells.length) return null;
  const root = noteRoot || document.documentElement;
  root.style.setProperty('--noteW', '0px');
  let maxW = 0;
  cells.forEach(cell => { maxW = Math.max(maxW, cell.scrollWidth); });
  const width = Math.max(60, maxW + 16);
  root.style.setProperty('--noteW', `${width}px`);
  return width;
}

/**
 * 숫자면 'px' 를 붙이고 문자열이면 그대로 둔다.
 * @param {number|string} value
 * @returns {string}
 */
function px(value) {
  return typeof value === 'number' ? `${value}px` : String(value);
}
