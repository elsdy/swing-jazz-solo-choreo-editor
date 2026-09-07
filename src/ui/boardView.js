// src/ui/boardView.js — 보드 1개당 인스턴스. rowRefs 를 여기 가둔다 (ui 계층)
//
// 원본 index.html 의 buildBoardSkeleton(3295-3327) · renderBoard(3329-3338) ·
// renderRows(3344-3349) · adjustNoteColumnWidth(3351-3359) · renderRow(3361-3384) ·
// 선택 표시 classList 조작(2461-2463 · 4534-4538)을 옮겼다.
//
// ⚠ `rowRefs` 는 오늘 state/reState 안에 있었지만(1408 · 1431) 직렬화 대상이 아니다.
//   여기 인스턴스 필드로 가둬 프로젝트 JSON·undo 스냅샷에서 축출한다.
//   대신 **입력 계층이 트랙 엘리먼트를 찾을 수 있어야 하므로** rowRefs 를 그대로 노출하고,
//   app/main 이 그것을 ui/overlays 와 input/** 에 주입한다.
//
// ⚠ 이 뷰는 **커맨드를 부르지 않는다.** 상태를 읽어 DOM 을 만들 뿐이다.
//   보드 크기 입력창·제목(syncBoardSizeUI 2938-2942)은 ui/toolbarView 의 몫이고
//   루틴 편집기 쪽(syncReBoardSizeUI 2944-2950)은 ui/routineEditorView 의 몫이다 — 여기 없다.

import { SEL, CLS, DATA } from './domContract.js';
import { createPlacementEl, renderRowNotes } from './placementView.js';
import { readCellH, setNoteWidth } from './cssVars.js';
import * as Grid from '../domain/grid.js';

/**
 * @typedef {Object} BoardViewOptions
 * @property {HTMLElement} el 보드 루트(#board 또는 #reBoard). 원본 ctx.el
 * @property {'main'|'routine'} boardId
 * @property {HTMLElement|(() => HTMLElement|null)|null} [noteRoot]
 *   `--noteW` 를 쓸 요소. ⚠ 보드마다 다르다 — 메인 #mainBoardWrap(1479) / 루틴 #reBoardWrap(1495).
 *   원본이 **게터**라 화면이 바뀌어도 그때그때 다시 찾는다. 함수를 넘기면 그 동작이 유지된다.
 * @property {() => any} [getViewDeps]
 *   인자 없이 render* 를 부를 때 쓸 store.viewDeps(boardId) 게터. app/main 이 넘긴다.
 * @property {() => any} [getDrag]
 *   input/dragSession 의 현재 드래그 게터. ⚠ store.viewDeps 에는 drag 가 없다(3425 의 `.is-dragging`).
 * @property {{ readCellH?: Function, setNoteWidth?: Function }} [cssVars]
 *   테스트용 주입구. 넘기지 않으면 ui/cssVars.js 의 것을 쓴다.
 */

/**
 * 보드 뷰 하나를 만든다.
 *
 * @param {BoardViewOptions} options
 * @returns {{
 *   el: HTMLElement, boardId: string, rowRefs: Map<number, {rowEl:HTMLElement,label:HTMLElement,track:HTMLElement,note:HTMLElement}>,
 *   renderAll(force?: boolean, deps?: any): void,
 *   rebuild(board?: any): void,
 *   renderRows(rows: number[]|'all', deps?: any): void,
 *   updateRows(rows: number[]|'all', deps?: any): void,
 *   renderRow(row: number, deps?: any): void,
 *   setSelected(ids: Iterable<string>|Set<string>): void,
 *   signature(): string|null
 * }}
 */
export function createBoardView(options) {
  const {
    el,
    boardId,
    noteRoot = null,
    getViewDeps = null,
    getDrag = null,
    cssVars = null,
  } = options || {};
  if (!el) throw new TypeError('createBoardView: el 이 필요하다');

  const readCellHFn = cssVars?.readCellH || readCellH;
  const setNoteWidthFn = cssVars?.setNoteWidth || setNoteWidth;

  /** 행 인덱스 → 그 행의 엘리먼트 묶음. 원본 ctx.rowRefs(1408 · 1431). */
  const rowRefs = new Map();
  /** 마지막으로 세운 골격의 `${cols}x${rows}`. 원본 ctx.boardSig. */
  let boardSig = null;

  // ───────────────────────────────────────────────────────────────────────────
  // deps 해석
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 렌더에 필요한 것을 모은다. 인자로 준 것이 우선이고, 없으면 주입된 게터에서 읽는다.
   * ⚠ drag 는 store.viewDeps 에 없다 — input/dragSession 이 소유하므로 따로 합친다.
   * @param {any} [deps]
   * @returns {any}
   */
  function resolveDeps(deps) {
    const base = deps || (getViewDeps ? getViewDeps() : null);
    if (!base || !base.board) throw new TypeError('boardView: viewDeps.board 가 필요하다');
    const drag = base.drag !== undefined ? base.drag : (getDrag ? getDrag() : null);
    return drag === base.drag ? base : { ...base, drag };
  }

  /** noteRoot 게터를 매번 다시 부른다(원본 1479·1495 가 getter 였다). */
  function resolveNoteRoot() {
    return typeof noteRoot === 'function' ? noteRoot() : noteRoot;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 골격
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 보드 골격을 통째로 다시 세운다. innerHTML 을 비우므로 **떠 있는 프리뷰·고스트가 사라진다** —
   * 드래그 중에는 부르지 마라(그래서 paranoid 렌더도 골격은 다시 세우지 않는다).
   *
   * ⚠ intro 행(row 0)은 메인 보드에만 있다. 원본 3324 의 `ctx === mainCtx` 가 board.hasIntroRow 다.
   * ⚠ 헤더/행의 `gridTemplateColumns` 인라인 문자열과 트랙의 `width` 는 CSS 변수를 그대로 쓴다 —
   *   여기 리터럴이 CSS(7-1212)와 짝이므로 한 글자도 바꾸지 마라.
   *
   * @see index.html:3295
   * @param {{rows:number, cols:number, hasIntroRow?:boolean}} board
   * @returns {void}
   */
  function buildBoardSkeleton(board) {
    const { cols, rows } = board;
    el.innerHTML = '';
    rowRefs.clear();
    const header = document.createElement('div');
    header.className = CLS.boardHeader;
    header.style.gridTemplateColumns = `var(--rowLabelW) calc(var(--cellW) * ${cols}) var(--noteW)`;
    header.innerHTML = `<div class="${CLS.corner}">마디</div><div class="${CLS.headerCells}" style="grid-template-columns:repeat(${cols}, var(--cellW));">${Array.from({ length: cols }, (_, i) => `<div>${i + 1}</div>`).join('')}</div><div class="${CLS.noteHeader}">비고</div>`;
    el.appendChild(header);

    function buildRow(row, labelText) {
      const rowEl = document.createElement('div');
      rowEl.className = CLS.boardRow;
      rowEl.style.gridTemplateColumns = `var(--rowLabelW) calc(var(--cellW) * ${cols}) var(--noteW)`;
      const label = document.createElement('div');
      label.className = CLS.rowLabel;
      label.textContent = labelText;
      const track = document.createElement('div');
      track.className = CLS.track;
      // ⚠ dataset 은 문자열이 된다 — 읽는 쪽(input)이 Number() 해야 한다.
      track.dataset[DATA.row] = row;
      track.style.width = `calc(var(--cellW) * ${cols})`;
      track.innerHTML = `<div class="${CLS.trackSpacer}"></div><div class="${CLS.cellOverlay}" style="grid-template-columns:repeat(${cols}, var(--cellW));">${'<div></div>'.repeat(cols)}</div>`;
      const note = document.createElement('div');
      note.className = CLS.noteCell;
      rowEl.append(label, track, note);
      el.appendChild(rowEl);
      rowRefs.set(row, { rowEl, label, track, note });
    }

    // intro row (row 0) — main board only
    if (Grid.firstRowIndex(board) === 0) buildRow(0, 'intro');
    for (let row = 1; row <= rows; row++) buildRow(row, `${cols}x${row}`);
    boardSig = Grid.boardSignature(board);
  }

  /**
   * 자가치유 가드. 원본 renderBoard(3330-3332)의 조건 두 개를 그대로 옮겼다.
   *
   * ⚠⚠ **두 조건 다 필요하다**: 시그니처(`${cols}x${rows}`)가 같아도 rowRefs 개수가 어긋나면
   *   그 행의 renderRow 가 `if (!ref) return` 으로 **에러 없이 조용히** 아무것도 안 그린다.
   *   Dirty 에 `skeleton` 을 빠뜨렸을 때의 침묵 실패를 막는 것이 이 가드의 존재 이유이므로
   *   renderRows 경로에서도 통과시킨다(FINAL-architecture 3-3 ①).
   *
   * @param {any} board
   * @param {boolean} force
   * @returns {void}
   */
  function ensureSkeleton(board, force = false) {
    const expectedSize = Grid.rowCount(board);   // 메인 rows+1 / 루틴 rows
    if (force || boardSig !== Grid.boardSignature(board) || rowRefs.size !== expectedSize) {
      buildBoardSkeleton(board);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 행 렌더
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 행 하나를 다시 그린다.
   *
   * ⚠⚠ **nuke-and-rebuild 다.** 그 행의 `.placement` 를 전량 제거하고 다시 만든다(3382-3383).
   *   부분 갱신으로 '최적화' 하지 마라 — 드래그 중 엘리먼트 동일성이 유지되면서
   *   `.is-dragging`/툴팁/포커스 동작이 달라진다.
   * ⚠ 시각적 subRow 는 데이터 subRow 를 **그대로** 쓴다(압축 없음). 하위 레이어 배치는 혼자 있어도
   *   항상 하단에 남는다 — 레이어 정체성 보존이 오늘의 규칙이다(3369-3371).
   * ⚠ track-spacer 높이 `(maxVisualSubRow+1) * cellH`, `data-layers` 는 `maxVisualSubRow > 0` 일 때만
   *   `String(maxVisualSubRow+1)` 로 붙이고 아니면 **delete** 한다(0 으로 끄지 않는다, 3380).
   *
   * @see index.html:3361
   * @param {number} row
   * @param {any} [deps] 없으면 getViewDeps() 로 읽는다
   * @returns {void}
   */
  function renderRow(row, deps) {
    const d = resolveDeps(deps);
    const board = d.board;
    const ref = rowRefs.get(row);
    if (!ref) return;
    ref.label.textContent = row === 0 ? 'intro' : `${board.cols}x${row}`;
    ref.note.innerHTML = renderRowNotes(row, d) || `<span class="${CLS.muted}">-</span>`;

    const placements = board.placements.filter(p => p.row === row && p.startIndex < board.cols);

    // 시각적 subRow = DATA subRow 그대로 사용 (압축 없음)
    const visualSubRows = new Map(placements.map(p => [p.id, p.subRow || 0]));
    const maxVisualSubRow = placements.reduce((m, p) => Math.max(m, p.subRow || 0), 0);

    // spacer 로 트랙 높이를 강제 확장 (absolute 자식은 grid 높이에 미기여)
    // ⚠ 원본은 배치마다 getComputedStyle 을 불렀다(3374 + 3432). 값은 같은 프레임 안에서 변하지 않으므로
    //   행마다 한 번 읽어 placementView 로 내려 넘긴다 — 화면 결과는 동일하다.
    const cellHPx = readCellHFn();
    const spacer = ref.track.querySelector(SEL.trackSpacer);
    if (spacer) spacer.style.height = `${(maxVisualSubRow + 1) * cellHPx}px`;
    // 레이어 구분선 표시 (충돌 행에만)
    if (maxVisualSubRow > 0) ref.track.dataset[DATA.layers] = String(maxVisualSubRow + 1);
    else delete ref.track.dataset[DATA.layers];

    const rowDeps = { ...d, cellH: cellHPx };
    [...ref.track.querySelectorAll(SEL.placement)].forEach(node => node.remove());
    placements.forEach(p => ref.track.appendChild(createPlacementEl(p, visualSubRows.get(p.id) || 0, rowDeps)));
  }

  /**
   * 여러 행을 다시 그린다. presenter 의 `boards[id].rows` 가 그대로 들어온다.
   *
   * ⚠ 중복 제거 후 `0 <= row <= board.rows` 로 거른다(3345). 범위 밖 행을 넘겨도 조용히 무시된다.
   * ⚠ 마지막 두 줄이 중요하다 — 비고 칸 폭 재측정과 **플로팅 툴팁 강제 숨김**(3348).
   *   툴팁은 body 포털이라 행을 다시 그려도 남아 있고, 가리키던 배치가 사라지면 허공에 뜬다.
   * ⚠ 'all' 을 받으면 grid.rowIndices 로 편다(메인 [0..rows] / 루틴 [1..rows]).
   *
   * @see index.html:3344
   * @param {number[]|'all'} rows
   * @param {any} [deps]
   * @returns {void}
   */
  function renderRows(rows, deps) {
    const d = resolveDeps(deps);
    const board = d.board;
    ensureSkeleton(board);   // 자가치유 (FINAL-architecture 3-3 ①)
    const list = rows === 'all' ? Grid.rowIndices(board) : (rows || []);
    const uniqueRows = [...new Set(list)].filter(row => row >= 0 && row <= board.rows);
    uniqueRows.forEach(row => renderRow(row, d));
    adjustNoteColumnWidth();
    document.querySelector(SEL.floatingTooltip)?.style.setProperty('display', 'none');
  }

  /**
   * 보드 전체를 그린다. 원본 renderBoard(3329-3338).
   * @see index.html:3329
   * @param {boolean} [force] true 면 골격부터 다시 세운다(원본 renderBoard(true))
   * @param {any} [deps]
   * @returns {void}
   */
  function renderAll(force = false, deps) {
    const d = resolveDeps(deps);
    ensureSkeleton(d.board, force);
    renderRows(Grid.rowIndices(d.board), d);
  }

  /**
   * 비고 칸 폭 재측정. `--noteW` 는 **보드마다 다른 요소**에 쓰인다(1479 / 1495).
   * ⚠ 칸이 하나도 없으면 아무것도 쓰지 않는다(cssVars.setNoteWidth 가 조기 반환).
   * @see index.html:3351
   * @returns {number|null}
   */
  function adjustNoteColumnWidth() {
    return setNoteWidthFn(resolveNoteRoot(), el.querySelectorAll(SEL.noteCell));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 선택 표시 — 행 재렌더 없이 클래스만 토글하는 채널
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `.is-selected` 를 store.selection 에 맞춘다. **행을 다시 그리지 않는다.**
   *
   * 원본 두 경로를 한 함수로 모았다:
   *   - 클릭 토글 2461-2463: 선택된 그룹의 모든 세그먼트에 `classList.toggle('is-selected', has)`
   *   - clearSelection 4534-4538: 선택이 풀린 그룹에서 `classList.remove('is-selected')`
   *
   * ⚠ 그룹 셀렉터는 **CSS.escape 를 쓰지 않는 쪽**(SEL.placementsOfGroupRaw)이다 — 원본 2462·4536 이 그렇다.
   *   리사이즈/드래그 표시(overlays)는 쓰는 쪽이다. 둘을 통일하지 마라(오늘의 비대칭).
   * ⚠ 해제는 캐시가 아니라 **DOM 이 진실**이다: 지금 `.is-selected` 인데 새 집합에 없는 것을 걷어낸다.
   *   그래야 재렌더·보드 교체로 캐시가 어긋나도 유령 선택이 남지 않는다.
   * ⚠ 루틴 편집 보드에는 애초에 `.is-selected` 가 붙지 않는다(policy.allowsSelection=false).
   *   그래도 이 함수를 부르는 것은 무해하다(붙은 게 없으니 아무 일도 없다).
   *
   * @see index.html:2461
   * @param {Iterable<string>|Set<string>|null|undefined} ids
   * @returns {void}
   */
  function setSelected(ids) {
    const next = ids instanceof Set ? ids : new Set(ids || []);
    // ① 빠진 것 제거
    el.querySelectorAll(SEL.placement).forEach(node => {
      const gid = node.dataset[DATA.groupId];
      if (!next.has(gid)) node.classList.remove(CLS.isSelected);
    });
    // ② 선택된 그룹의 모든 세그먼트에 부여
    next.forEach(gid => {
      el.querySelectorAll(SEL.placementsOfGroupRaw(gid)).forEach(node => {
        node.classList.toggle(CLS.isSelected, true);
      });
    });
  }

  return {
    el,
    boardId,
    rowRefs,
    renderAll,
    /** renderAll(true) 와 같은 뜻의 골격 재생성. presenter 의 `Dirty.boards[id].skeleton` 이 부른다. */
    rebuild(board) { ensureSkeleton(board || resolveDeps().board, true); },
    renderRows,
    /** presenter 가 쓰는 이름. renderRows 와 같은 함수다. */
    updateRows: renderRows,
    renderRow,
    setSelected,
    /** 지금 세워져 있는 골격의 시그니처(테스트·디버그용). */
    signature() { return boardSig; },
  };
}
