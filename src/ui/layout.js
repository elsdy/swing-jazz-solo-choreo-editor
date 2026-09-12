// src/ui/layout.js — 셸(shell)의 부작용 전부.
//
// 원본 index.html 의 `init()` 안에 인라인으로 흩어져 있던 셸 코드를 한 파일로 모은 것이다:
//   · updateMobileCellSize (2247-2266)            → syncCellSize
//   · 스크롤 락 버튼 2개 + 핀치줌 차단 (1545-1595) → setScrollLock / isAnyLockActive
//   · initResizeDivider IIFE (1597-1662)           → 사이드바↔워크스페이스 비율 드래그
//   · focusout 뷰포트 줌 리셋 (1664-1678)
//   · isRoutineOverlayMode (4779-4781)
//
// ⚠ 이 파일은 store·commands·adapters 를 모르고, 오직 CSS 변수·dataset·클래스만 만진다.
//   보드의 셀 폭 **산술**은 domain/grid.computeCellWidth 가, CSS 변수 **쓰기**는 ui/cssVars 가 한다.
//
// ⚠ 브레이크포인트가 두 종류다 — 1040(스택 전환/루틴 오버레이)과 720(모바일 셀 크기).
//   그리고 같은 1040 을 원본이 두 가지 방식으로 읽는다(matchMedia vs innerWidth). 아래 주석 참조.

import { SEL, CLS, DATA } from './domContract.js';
import {
  setGridVars,
  clearGridVars,
  setNoteWidth,
  MOBILE_ROW_LABEL_W,
  MOBILE_CELL_H,
} from './cssVars.js';
import { computeCellWidth } from '../domain/grid.js';

/**
 * 이 앱의 브레이크포인트 2개.
 *  · stacked 1040 — 사이드바가 위로 접히는 폭. 리사이즈 디바이더(1606)·루틴 오버레이(4780)·팝업(1788)
 *  · compact  720 — 모바일 셀 크기를 쓰는 폭. updateMobileCellSize(2249)·디바이더 패딩(1631)
 */
export const BREAKPOINTS = Object.freeze({ stacked: 1040, compact: 720 });

/**
 * 사이드바가 위로 접히는 폭인가. 원본 initResizeDivider 의 isMobileLayout(1605-1607)이다.
 * ⚠ isRoutineOverlayMode 와 값은 같은 1040 이지만 **읽는 방법이 다르다**(innerWidth vs matchMedia).
 *   원본의 비대칭이라 통일하지 않는다.
 * @see index.html:1605
 * @param {Window} [win=window]
 * @returns {boolean}
 */
export function isStacked(win = window) {
  return win.innerWidth <= BREAKPOINTS.stacked;
}

/**
 * 모바일 셀 크기를 써야 하는 폭인가. 원본 2249 의 `window.innerWidth > 720` 의 반대다.
 * @see index.html:2249
 * @see index.html:1631
 * @param {Window} [win=window]
 * @returns {boolean}
 */
export function isCompact(win = window) {
  return win.innerWidth <= BREAKPOINTS.compact;
}

/**
 * 루틴 편집기가 전체화면 오버레이로 뜨는가. 원본 4779-4781 그대로 matchMedia 를 쓴다.
 * ⚠ isStacked 와 값(1040)은 같지만 읽는 방법이 다르다 — 원본의 비대칭을 보존한다.
 * @see index.html:4779
 * @param {Window} [win=window]
 * @returns {boolean}
 */
export function isRoutineOverlayMode(win = window) {
  return win.matchMedia(`(max-width: ${BREAKPOINTS.stacked}px)`).matches;
}

/**
 * 비고 칸 폭 재측정. 원본 adjustNoteColumnWidth(3351-3359)를 syncCellSize 가 부르는 자리다.
 * ⚠ 셀렉션(.note-cell 모으기)은 여기서, 실제 쓰기는 cssVars.setNoteWidth 가 한다.
 * @param {HTMLElement|null} boardEl 그 보드의 `.board` 요소
 * @param {HTMLElement|null} noteRoot `--noteW` 를 쓸 wrap 요소(#mainBoardWrap)
 * @returns {number|null}
 */
function applyNoteWidth(boardEl, noteRoot) {
  if (!boardEl) return null;
  return setNoteWidth(noteRoot, boardEl.querySelectorAll(SEL.noteCell));
}

/**
 * 화면 폭에 맞춰 격자 CSS 변수를 다시 쓴다. 원본 updateMobileCellSize(2247-2266) 그대로다.
 *
 * ⚠⚠ 보존 대상 결함 #12 — 데스크톱(>720px) 분기가 `--cellW`/`--rowLabelW` 만 지우고
 *   `--cellH` 는 **지우지 않는다**(clearGridVars 의 기본값 resetCellH:false). 좁은 화면에서
 *   40px 를 한 번 쓴 뒤 창을 넓히면 행 높이가 40px 로 남는다.
 * ⚠ 보존 대상 비대칭 #14 — 두 분기 모두 **메인 보드에 대해서만** 비고 칸 폭을 다시 잰다.
 *   원본 2253·2265 의 `adjustNoteColumnWidth()` 가 기본 인자 mainCtx 로 불리기 때문이다.
 *   루틴 편집 보드의 `--noteW` 는 여기서 건드리지 않는다.
 *
 * @see index.html:2247
 * @param {object} args
 * @param {Window} [args.win=window]
 * @param {HTMLElement} [args.root] CSS 변수를 쓸 요소. 원본은 언제나 documentElement 다
 * @param {number} args.cols 메인 보드의 칸 수(state.cols)
 * @param {HTMLElement|null} [args.boardEl] 메인 보드 `.board`
 * @param {HTMLElement|null} [args.noteRoot] 메인 보드 wrap(#mainBoardWrap)
 * @returns {void}
 */
export function syncCellSize({
  win = window,
  root = document.documentElement,
  cols,
  boardEl = null,
  noteRoot = null,
} = {}) {
  if (!isCompact(win)) {
    clearGridVars(root); // ⚠ --cellH 는 남는다(보존 결함 #12)
    applyNoteWidth(boardEl, noteRoot);
    return;
  }
  setGridVars(root, {
    cellW: computeCellWidth(win.innerWidth, cols),
    rowLabelW: MOBILE_ROW_LABEL_W,
    cellH: MOBILE_CELL_H,
  });
  applyNoteWidth(boardEl, noteRoot);
}

/**
 * 스크롤 락 토글. 원본 1551-1580 은 **세 곳에 같은 사실을 쓴다** —
 * `dataset.locked`(판정용), `style.overflow(Y)`(실제 효과), 버튼의 `.locked`(표시).
 * 셋을 여기 한 함수에 모아 **dataset 이 단일 진실**이 되게 했다(읽는 쪽은 isLocked 만 본다).
 *
 * ⚠ 쓰기 순서도 원문 그대로다: 요소별로 dataset → style, 마지막에 버튼 클래스.
 * ⚠ 보드 락은 메인 wrap 과 **루틴 편집기 wrap 에도 함께** 걸린다(PR #12). 루틴 wrap 은
 *   클릭 시점에 다시 찾는다 — els 가 함수인 이유다(원본 1565 도 클릭 안에서 getElementById 한다).
 *
 * @see index.html:1551
 * @param {{ els: (() => (HTMLElement|null|undefined)[]) | (HTMLElement|null|undefined)[],
 *           styleProp: 'overflow'|'overflowY',
 *           btn: HTMLElement|null }} target
 * @param {boolean} locked
 * @returns {void}
 */
export function setScrollLock(target, locked) {
  const flag = locked ? DATA.FLAG_ON : '0';
  const value = locked ? 'hidden' : '';
  const els = typeof target.els === 'function' ? target.els() : target.els;
  for (const el of els) {
    if (!el) continue;
    el.dataset[DATA.locked] = flag;
    el.style[target.styleProp] = value;
  }
  if (target.btn) target.btn.classList.toggle(CLS.locked, locked);
}

/**
 * 이 요소가 잠겨 있는가. dataset 이 단일 진실이다(원본 1552·1566·1583).
 * @param {HTMLElement|null|undefined} el
 * @returns {boolean}
 */
export function isLocked(el) {
  return el?.dataset?.[DATA.locked] === DATA.FLAG_ON;
}

/**
 * 셸 리스너를 전부 건다. 원본 init() 의 1542-1678 구간에 **한 줄씩 대응**한다.
 * ⚠ 등록 순서를 바꾸지 마라 — document 에 붙는 mousemove/touchmove/mouseup 의 순서가
 *   보드 컨트롤러·루틴 편집기의 같은 이벤트와 섞인다.
 *
 * 호출 위치: 원본 1542 의 `saveHistory()` 바로 다음(= 첫 렌더가 끝난 뒤).
 *
 * @param {object} deps
 * @param {Document} [deps.doc=document]
 * @param {Window} [deps.win=window]
 * @param {HTMLElement} [deps.root] CSS 변수를 쓸 요소
 * @param {() => number} deps.getCols 메인 보드의 cols 를 읽는다(store.board('main').cols)
 * @param {HTMLElement} [deps.boardEl] 메인 보드 `.board`
 * @param {HTMLElement} [deps.noteRoot] 메인 보드 wrap
 * @param {HTMLElement} [deps.sidebarScrollEl]
 * @param {HTMLElement} [deps.boardWrapEl]
 * @param {() => HTMLElement|null} [deps.getRoutineBoardWrapEl]
 * @param {HTMLElement} [deps.sidebarLockBtn]
 * @param {HTMLElement} [deps.boardLockBtn]
 * @param {HTMLElement} [deps.dividerEl]
 * @param {HTMLElement} [deps.appEl]
 * @param {HTMLElement} [deps.sidebarEl]
 * @returns {{ syncCellSize: () => void, setSidebarLock: (v:boolean)=>void,
 *             setBoardLock: (v:boolean)=>void, isAnyLockActive: () => boolean,
 *             isStacked: () => boolean, isCompact: () => boolean,
 *             isRoutineOverlayMode: () => boolean, destroy: () => void }}
 */
export function initLayout(deps = {}) {
  const {
    doc = document,
    win = window,
    root = doc.documentElement,
    getCols,
    boardEl = doc.getElementById('board'),
    noteRoot = doc.getElementById('mainBoardWrap'),
    sidebarScrollEl = doc.querySelector(SEL.sidebarScroll),
    boardWrapEl = doc.getElementById('mainBoardWrap'),
    getRoutineBoardWrapEl = () => doc.getElementById('reBoardWrap'),
    sidebarLockBtn = doc.getElementById('sidebarLockBtn'),
    boardLockBtn = doc.getElementById('boardLockBtn'),
    dividerEl = doc.getElementById('resizeDivider'),
    appEl = doc.querySelector(SEL.app),
    sidebarEl = doc.querySelector(SEL.sidebar),
    // 좁은 화면 전용 토글 4개(2026-09-12). 넓은 화면에서는 CSS 가 숨기므로 눌릴 일이 없다.
    appbarMoreBtn = doc.getElementById('appbarMoreBtn'),
    sidebarSheetBtn = doc.getElementById('sidebarSheetBtn'),
    sheetCloseBtn = doc.getElementById('sheetCloseBtn'),
    sheetBackdrop = doc.getElementById('sheetBackdrop'),
    linksToggleBtn = doc.getElementById('linksToggleBtn'),
    notesToggleBtn = doc.getElementById('notesToggleBtn'),
  } = deps;

  const teardown = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    teardown.push(() => target.removeEventListener(type, handler, options));
  };

  // ── 1542-1544: 첫 계산 + resize 추종 ──────────────────────────────────────
  const sync = () => syncCellSize({ win, root, cols: getCols(), boardEl, noteRoot });
  sync();
  on(win, 'resize', sync);

  // ── 1546-1580: 스크롤 락 버튼 2개 ─────────────────────────────────────────
  const sidebarLock = { els: () => [sidebarScrollEl], styleProp: 'overflowY', btn: sidebarLockBtn };
  const boardLock = {
    // ⚠ 루틴 편집기 보드도 함께 잠근다(PR #12). 클릭할 때마다 다시 찾는다.
    els: () => [boardWrapEl, getRoutineBoardWrapEl()],
    styleProp: 'overflow',
    btn: boardLockBtn,
  };
  on(sidebarLockBtn, 'click', () => setScrollLock(sidebarLock, !isLocked(sidebarScrollEl)));
  on(boardLockBtn, 'click', () => setScrollLock(boardLock, !isLocked(boardWrapEl)));

  // ── 1582-1595: 워크스페이스 락 시 핀치 줌 완전 차단 ──────────────────────
  // ⚠ 판정은 메인 wrap 만 본다(루틴 wrap 은 보지 않는다) — 원본 1583 그대로.
  const isAnyLockActive = () => isLocked(sidebarScrollEl) || isLocked(boardWrapEl);
  on(doc, 'touchmove', (e) => {
    if (isAnyLockActive() && e.touches.length >= 2) e.preventDefault();
  }, { passive: false });
  // iOS Safari gesturestart 이벤트로 줌 차단
  const onGesture = (e) => { if (isAnyLockActive()) e.preventDefault(); };
  on(doc, 'gesturestart', onGesture, { passive: false });
  on(doc, 'gesturechange', onGesture, { passive: false });

  // ── 1597-1662: 리사이즈 디바이더 (사이드바↔워크스페이스 비율) ───────────
  let dragging = false;
  let startY = 0;
  let startH = 0;

  const isMobileLayout = () => isStacked(win);
  const getPointerY = (e) => (e.touches ? e.touches[0].clientY : e.clientY);

  function onStart(e) {
    if (!isMobileLayout()) return;
    e.preventDefault();
    dragging = true;
    startY = getPointerY(e);
    startH = sidebarEl.getBoundingClientRect().height;
    dividerEl.classList.add(CLS.active);
    doc.body.style.cursor = 'row-resize';
    doc.body.style.userSelect = 'none';
    doc.body.style.webkitUserSelect = 'none';
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const dy = getPointerY(e) - startY;
    const vh = win.innerHeight;
    const padding = isCompact(win) ? 8 : 10;
    const minH = 60;
    const maxH = vh - padding * 2 - 14 - 60; // divider height + min workspace
    const newH = Math.max(minH, Math.min(maxH, startH + dy));
    appEl.style.setProperty('--sidebar-h', `${newH}px`);
    sync();
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    dividerEl.classList.remove(CLS.active);
    doc.body.style.cursor = '';
    doc.body.style.userSelect = '';
    doc.body.style.webkitUserSelect = '';
  }

  on(dividerEl, 'mousedown', onStart);
  on(dividerEl, 'touchstart', onStart, { passive: false });
  on(doc, 'mousemove', onMove);
  on(doc, 'touchmove', onMove, { passive: false });
  on(doc, 'mouseup', onEnd);
  on(doc, 'touchend', onEnd);

  // 데스크톱 전환 시 커스텀 높이 초기화 (⚠ resize 리스너가 두 번째로 붙는 자리다)
  on(win, 'resize', () => {
    if (!isMobileLayout()) appEl.style.removeProperty('--sidebar-h');
  });

  // ── 좁은 화면의 네 토글 (2026-09-12, 원본에 대응물 없음) ─────────────────
  //
  // 폰에서 안무표가 세로의 10% 밖에 못 쓰던 것을 고치면서 생겼다. 넷 다 **화면 상태**라
  // store 에 넣지 않는다 — 스크롤 락과 같은 성격이고, 저장하거나 Undo 할 값이 아니다.
  // 값은 <body> 의 data-* 하나로 두고 CSS 가 읽는다(마크업의 기본값이 전부 'off').
  //
  // ⚠ 넓은 화면에서는 이 버튼들이 `display:none` 이라 눌리지 않는다. 그래도 dataset 은
  //   남으므로, 폭을 넓혔다 줄여도 마지막 상태가 그대로 돌아온다.

  /** <body data-*> 한 칸을 뒤집고 버튼의 aria-expanded 를 맞춘다. */
  function toggleFlag(name, btn) {
    const next = doc.body.dataset[name] === 'on' ? 'off' : 'on';
    doc.body.dataset[name] = next;
    if (btn) btn.setAttribute('aria-expanded', String(next === 'on'));
    return next;
  }

  /** 시트를 닫는다(이미 닫혀 있으면 무동작). 배경 누르기·✕·Escape 가 함께 쓴다. */
  function closeSheet() {
    if (doc.body.dataset.sheet !== 'on') return;
    doc.body.dataset.sheet = 'off';
    if (sidebarSheetBtn) sidebarSheetBtn.setAttribute('aria-expanded', 'false');
  }

  if (appbarMoreBtn) on(appbarMoreBtn, 'click', () => toggleFlag('more', appbarMoreBtn));
  if (linksToggleBtn) on(linksToggleBtn, 'click', () => toggleFlag('links', linksToggleBtn));
  if (notesToggleBtn) {
    on(notesToggleBtn, 'click', () => {
      toggleFlag('notes', notesToggleBtn);
      sync();   // 비고 칸이 사라지면 셀 폭을 다시 잰다(가로 스크롤이 여기서 생겼다)
    });
  }
  if (sidebarSheetBtn) on(sidebarSheetBtn, 'click', () => toggleFlag('sheet', sidebarSheetBtn));
  // ⚠ 동작·루틴 카드를 고르면 시트를 닫는다. 고른 다음에 하는 일이 **격자를 쓸어 놓는 것**인데
  //   시트가 안무표를 덮고 있으면 그 자리가 안 보인다. 카드 안의 버튼·선택칸(별·삭제·카테고리)은
  //   고르는 조작이 아니므로 닫지 않는다.
  if (sidebarEl) {
    on(sidebarEl, 'click', (e) => {
      const card = e.target.closest(`.${CLS.moveCard}, .${CLS.routineCard}`);
      if (!card || e.target.closest('button, select, input')) return;
      closeSheet();
    });
  }
  if (sheetCloseBtn) on(sheetCloseBtn, 'click', closeSheet);
  if (sheetBackdrop) on(sheetBackdrop, 'click', closeSheet);
  on(doc, 'keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ── 1664-1678: 입력 완료 후 뷰포트 줌 리셋 (모바일 포커스 줌 복구) ───────
  // ⚠⚠ 알려진 결함이지만 그대로 옮긴다 — user-scalable=no 를 영구히 박고
  //    window.scrollTo(0,0) 으로 스크롤 위치를 강제로 날린다. deviations 참조.
  on(doc, 'focusout', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      // 약간의 딜레이 후 뷰포트를 강제 리셋
      win.setTimeout(() => {
        const vp = doc.querySelector(SEL.viewportMeta);
        if (vp) {
          vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }
        // 스크롤 위치 보정으로 줌 리셋 유도
        win.scrollTo(0, 0);
      }, 100);
    }
  });

  return {
    syncCellSize: sync,
    setSidebarLock: (locked) => setScrollLock(sidebarLock, locked),
    setBoardLock: (locked) => setScrollLock(boardLock, locked),
    isAnyLockActive,
    isStacked: () => isStacked(win),
    isCompact: () => isCompact(win),
    isRoutineOverlayMode: () => isRoutineOverlayMode(win),
    /** 좁은 화면의 동작 시트를 닫는다(넓은 화면에서는 아무 일도 없다). */
    closeSheet,
    // 원본에는 없는 추가분. 테스트가 리스너를 걷어낼 수 있게만 두었고 앱은 부르지 않는다.
    destroy() { teardown.splice(0).forEach(off => off()); },
  };
}
