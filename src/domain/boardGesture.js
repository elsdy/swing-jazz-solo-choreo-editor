// src/domain/boardGesture.js — 보드 위 그리기·빠른 배치·더블탭의 전이 함수 (RM-08, 2026-10-01)
//
// input/boardController 의 리스너 열둘이 하던 판단을 '(지금 상태, 이벤트) → (다음 상태, 할 일 목록)' 으로 옮겼다.
// 리스너는 이벤트를 값으로 바꿔 여기 넘기고, 돌려받은 할 일을 **차례대로** 실행할 뿐이다.
// 그래서 어느 분기가 먼저 이기는지(빠른 배치와 그리기, 마우스와 터치의 하한)가 node:test 로 붙잡힌다.
//
// 상태 한 벌은 보드 하나의 것이다(원본은 보드마다 클로저 상태를 따로 가졌다):
//   draw        팔레트 동작을 고른 채 끌어 그리는 중   { row, startIndex, track }
//   quickDraw   빠른 배치 모드의 마우스 끌기          { row, startIndex, track, count, clientX, clientY }
//   quickTouch  빠른 배치 모드의 손가락 끌기          { x, y, track, row, startIndex, count, isDrag, clientX?, clientY? }
//   tap         더블탭 판정의 지난 탭                 { time, groupId }
//   marquee     빈 칸에서 시작한 네모 고르기(RM-14)   { row, startIndex, track, x, y, rect|null }  — rect 가 생기면 끌기가 됐다
//   body        블록 몸통을 누른 마우스(RM-12)        { groupId, x, y, copy, bundle, dragging }    — 임계를 넘으면 dragging
//
// ⚠ track 은 DOM 요소지만 여기서는 **열어 보지 않는** 꼬리표다. 칸을 재야 할 때는 env 의 측정 함수에 되넘긴다.
//   측정(getBoundingClientRect·elementFromPoint)은 원본이 부르던 그 자리·그 순서에서만 불린다 —
//   그래서 측정을 미리 해 두지 않고 함수로 받는다.
//
// ⚠ 마우스와 터치는 **다른 규칙**이다(docs/deviations.md 「터치와 마우스의 불일치」). 통일하지 마라.
//   - 마우스 그리기: 행 넘김 O, 끝에서 자름 O, 프리뷰 하한 1 · 놓을 때 하한 기본 카운트
//   - 터치 그리기  : 시작 행 안에서만 센다, 자르지 않는다, 프리뷰 하한 1 · 놓을 때 하한 기본 카운트
//
// 할 일(effect)의 종류 — 리스너가 이 순서 그대로 실행한다:
//   { kind: 'preventDefault' } | { kind: 'stopPropagation' }
//   { kind: 'preview', row, startIndex, count } | { kind: 'clearPreview' }
//   { kind: 'place', moveId, startRow, startIndex, totalCount } | { kind: 'remove', groupId } | { kind: 'commit' }
//   { kind: 'openPicker', row, startIndex, clientX, clientY, count }
//   { kind: 'marquee', rect } | { kind: 'clearMarquee' } | { kind: 'selectRect', rect }   ← RM-14 네모 고르기(마우스만 — 터치는 RM-11 때)
//   { kind: 'startTrim', edge, groupId, clientX }                                            ← RM-12 가장자리 트리밍 시작
//   { kind: 'beginMove', groupId, copy, bundle } | { kind: 'movePreview', row, startIndex } | { kind: 'endMove' }
//   { kind: 'move' | 'copy' | 'moveBundle', groupId, row, startIndex } | { kind: 'swallowClick' }   ← RM-12 몸통 끌기
//   { kind: 'openGroupPicker', groupId, clientX, clientY }                                   ← RM-12 두 번 누르기 = 동작 고르기 창
//
// ⚠ 블록을 누른 자리의 주인(RM-12): 양쪽 가장자리(gestureMath.resolveGrabZone)는 트리밍, 몸통은 끌면 옮기기 · 떼면 클릭이다.
//   몸통 클릭(고르기 · 팝업)은 여전히 보드의 click 리스너가 한다 — 여기서는 「끌기가 됐으면 그 click 을 삼켜라」만 낸다.
//   손가락의 몸통 옮기기는 길게 누르기로 시작한다(계획서 결정) — 그 시계는 입력 계층의 longPress 가 잰다.
//
// ⚠ 빈 칸 끌기의 주인(Q86): 동작을 골랐거나(activeMove) 빠른 배치면 그리기, 아니면 네모 고르기다. 평소 빈 칸 끌기는 전에 아무 일도
//   하지 않았으므로 빼앗는 동작이 없다. 끄는 동안 행을 다시 그리지 않는다 — 점선 네모(overlays) 하나만 움직인다.

import {
  resolveDragCount, isDoubleTap, exceedsThreshold, rectCellRange,
  QUICK_DRAG_THRESHOLD_PX, MARQUEE_THRESHOLD_PX, BODY_DRAG_THRESHOLD_PX,
} from './gestureMath.js';

/**
 * @typedef {object} GestureEnv  지금 세션 값과 측정 함수. 리스너가 이벤트마다 새로 만든다.
 * @property {boolean} quickPlaceMode
 * @property {{moveId:string}|null} activeMove  팔레트에서 고른 동작
 * @property {number} defaultCount
 * @property {boolean} [marquee]  빈 칸 끌기로 네모 고르기를 할 보드인가(고르기를 허락하는 보드 — 메인. RM-14)
 * @property {{rows:number, cols:number}} board
 * @property {(track:any, clientX:number) => number} [colAt]  그 트랙 안의 칸
 * @property {(anchor:{track:any,row:number}, x:number, y:number) => {endRow:number, endCol:number}} [endAt]
 *           포인터 밑의 끝 칸(보드 밖이면 앵커 트랙·행으로 되돌아간다)
 * @property {(x:number, y:number) => {inBoard:boolean, track:any, row:number|null, col:number|null}} [hitAt]
 */

/**
 * 그 누름이 손가락인가 — 포인터 이벤트의 pointerType 으로 가른다(RM-11, 2026-11-02).
 * 'touch' 만 손가락 규칙이고 'mouse' · 'pen' · 빈 값(모르는 기기)은 마우스 규칙이다 — 펜은 끝이 뾰족해
 * 과녁이 마우스만큼 정확하고 hover 도 있어 마우스 쪽이 맞다.
 * ⚠ 창 폭으로 가르지 않는다. 폭은 배치(사이드바 접기 · 팝업 자리)의 일이고 ui/layout 의 몫이다.
 * @param {string|undefined|null} pointerType
 * @returns {'touch'|'mouse'}
 */
// @complexity time=O(1) space=O(1) cc=2
export function pointerKind(pointerType) {
  return pointerType === 'touch' ? 'touch' : 'mouse';
}

/**
 * 포인터 종류에 따라 각 단계(down · move · up · cancel)에서 돌릴 전이 함수를 **원본 리스너 차례대로** 돌려준다.
 * 리스너 한 벌(pointer*)이 이것을 읽어 옛 전이를 그대로 고른다 — 마우스는 그리기·빠른 배치 한 함수씩, 손가락은
 * 그리기(⑱~㉑)가 먼저 돌고 빠른 배치(㉒~㉕)가 그 뒤에 돈다(같은 touchstart 에 셋이 걸려 있던 차례).
 * 모든 전이는 같은 ev 모양 `{x, y, track, row, onPlacement}` 을 받고 필요한 것만 읽는다.
 * @param {string|undefined|null} pointerType
 * @returns {{down:Function[], move:Function[], up:Function[], cancel:Function[]}}
 */
// @complexity time=O(1) space=O(1) cc=2
export function transitionsFor(pointerType) {
  if (pointerKind(pointerType) === 'touch') {
    return {
      down: [touchDrawStart, quickTouchStart],
      move: [touchDrawMove, quickTouchMove],
      up: [touchDrawEnd, quickTouchEnd],
      cancel: [touchDrawCancel, quickTouchCancel],
    };
  }
  return { down: [mouseDown], move: [mouseMove], up: [mouseUp], cancel: [mouseCancel] };
}

/**
 * 블록을 한 번 눌렀을 때(click) 무엇을 하나 — 창 폭이 아니라 **그 누름의 pointerType** 으로 가른다(RM-11, 2026-11-02).
 * 2026-09-21 부터는 「팝업이 뜨는 폭(≤1040)」이었다 — 넓은 태블릿에서 손가락으로 눌러도 선택 토글이 되고, 좁힌 데스크톱 창에서
 * 마우스로 눌러도 팝업이 떴다. 이제 손가락이면 팝업, 마우스(펜)면 선택 토글이다 — 우클릭 길은 그대로 남는다.
 *   'routine-popup'  루틴 블록 — 종류와 상관없이 루틴 팝업(원본 2448)
 *   'action-popup'   손가락 · 블록 동작 팝업이 있는 보드
 *   'toggle'         그 밖 — 선택 토글(원본 2461)
 * @param {{pointerType:string|undefined, isRoutine:boolean, hasActionPopup:boolean}} ev
 * @returns {'routine-popup'|'action-popup'|'toggle'}
 */
// @complexity time=O(1) space=O(1) cc=3
export function placementTapRoute({ pointerType, isRoutine, hasActionPopup }) {
  if (isRoutine) return 'routine-popup';
  if (hasActionPopup && pointerKind(pointerType) === 'touch') return 'action-popup';
  return 'toggle';
}

/** @returns {{draw:null, quickDraw:null, quickTouch:null, tap:{time:number, groupId:string|null}, marquee:null, body:null}} */
export function initialGestureState() {
  return { draw: null, quickDraw: null, quickTouch: null, tap: { time: 0, groupId: null }, marquee: null, body: null };
}

const same = (state) => ({ state, effects: [] });
const preview = (row, startIndex, count) => ({ kind: 'preview', row, startIndex, count });

/**
 * 터치 그리기의 프리뷰 카운트. 원본 drawPreview(2601-2605) — 한 행 안에서 끝 칸까지 센다.
 * @param {number} startIndex
 * @param {number} endIndex
 * @returns {number}
 */
export function drawPreviewCount(startIndex, endIndex) {
  return Math.max(1, endIndex - startIndex + 1);
}

/**
 * 이 보드가 손가락 그리기를 받을 상태인가 — 그렇다면 트랙에서 손가락 끌기가 페이지 스크롤이 아니라 그리기다.
 * 포인터 이벤트는 브라우저가 스크롤을 시작하면 pointercancel 로 그리기를 빼앗고, touch-action 은 누르는 순간에
 * 정해지므로 리스너 안에서는 늦다. 그래서 렌더가 이 답을 보드에 미리 적어 두고 CSS 가 트랙의 스크롤을 막는다
 * (RM-11 동작 ③ — 옛 「손가락으로 그리는 동안 페이지가 함께 스크롤된다」를 고쳤다).
 * 동작을 고르지 않았고 빠른 배치도 꺼져 있으면 트랙 위에서도 손가락으로 스크롤한다.
 * @param {{activeMove?:object|null, quickPlaceMode?:boolean}} s
 * @returns {boolean}
 */
// @complexity time=O(1) space=O(1) cc=2
export function touchDrawArmed({ activeMove, quickPlaceMode }) {
  return !!activeMove || !!quickPlaceMode;
}

/**
 * 보드 위 mousedown — 빠른 배치 끌기 또는 그리기 시작(원본 2606-2627).
 * ⚠ 빠른 배치가 먼저 이긴다. 다만 동작을 골라 둔 상태(activeMove)거나 이미 그리는 중이면 그리기로 간다.
 * @param {object} state
 * @param {{x:number, y:number, track:any, row:number|null, onPlacement:boolean}} ev
 *        track 은 e.target 이 든 트랙(없으면 null), onPlacement 는 블록·손잡이 위인가
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=11
export function mouseDown(state, ev, env) {
  if (env.quickPlaceMode && !env.activeMove && !state.draw) {
    if (ev.onPlacement || !ev.track) return same(state);
    const startIndex = env.colAt(ev.track, ev.x);
    const quickDraw = { row: ev.row, startIndex, track: ev.track, count: env.defaultCount, clientX: ev.x, clientY: ev.y };
    return {
      state: { ...state, quickDraw },
      effects: [{ kind: 'preventDefault' }, preview(ev.row, startIndex, env.defaultCount)],
    };
  }
  if (!ev.track || ev.onPlacement) return same(state);
  if (!env.activeMove) {
    // 동작도 빠른 배치도 아닌 빈 칸 누름 — 네모 고르기 후보(RM-14). 임계를 넘기 전까지는 네모가 없고(rect:null),
    // 떼면 아무 할 일이 없다 — 그 click 은 보드의 「빈 곳 누름 = 선택 풀기」(input/controls) 길로 간다.
    if (env.quickPlaceMode || !env.marquee) return same(state);
    const startIndex = env.colAt(ev.track, ev.x);
    return {
      state: { ...state, marquee: { row: ev.row, startIndex, track: ev.track, x: ev.x, y: ev.y, rect: null } },
      effects: [{ kind: 'preventDefault' }],
    };
  }
  const startIndex = env.colAt(ev.track, ev.x);
  return {
    state: { ...state, draw: { row: ev.row, startIndex, track: ev.track } },
    effects: [{ kind: 'preventDefault' }, preview(ev.row, startIndex, drawPreviewCount(startIndex, startIndex))],
  };
}

/**
 * 보드 위 mousemove — 끌린 만큼 카운트를 다시 센다(원본 2629-2656). 프리뷰 하한은 1.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=9
export function mouseMove(state, ev, env) {
  const q = state.quickDraw;
  if (q) {
    const { endRow, endCol } = env.endAt(q, ev.x, ev.y);
    const count = resolveDragCount({ startRow: q.row, startIndex: q.startIndex, endRow, endCol, board: env.board, lowerBound: 1 });
    return {
      state: { ...state, quickDraw: { ...q, count, clientX: ev.x, clientY: ev.y } },
      effects: [preview(q.row, q.startIndex, count)],
    };
  }
  const m = state.marquee;
  if (m) {
    if (!m.rect && !exceedsThreshold(ev.x - m.x, ev.y - m.y, MARQUEE_THRESHOLD_PX)) return same(state);
    const { endRow, endCol } = env.endAt(m, ev.x, ev.y);
    const rect = rectCellRange({ row: m.row, col: m.startIndex }, { row: endRow, col: endCol }) || m.rect;
    if (!rect) return same(state);
    return { state: { ...state, marquee: { ...m, rect } }, effects: [{ kind: 'marquee', rect }] };
  }
  const d = state.draw;
  if (!d || !env.activeMove) return same(state);
  const { endRow, endCol } = env.endAt(d, ev.x, ev.y);
  const count = resolveDragCount({ startRow: d.row, startIndex: d.startIndex, endRow, endCol, board: env.board, lowerBound: 1 });
  return { state, effects: [preview(d.row, d.startIndex, count)] };
}

/**
 * document mouseup — 빠른 배치 팝업을 열거나 그린 것을 놓는다(원본 2658-2683).
 * ⚠ 빠른 배치는 프리뷰를 **지우지 않고** 팝업을 연다 — 팝업이 뜬 동안 어디 놓일지 보여 준다.
 * ⚠ 놓을 때의 하한은 기본 카운트다(프리뷰는 1). 한 칸짜리 프리뷰를 보고 떼도 기본 카운트만큼 놓인다.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=8
export function mouseUp(state, ev, env) {
  const q = state.quickDraw;
  if (q && env.quickPlaceMode) {
    return {
      state: { ...state, quickDraw: null },
      effects: [{ kind: 'openPicker', row: q.row, startIndex: q.startIndex, clientX: q.clientX, clientY: q.clientY, count: q.count }],
    };
  }
  if (q) return { state: { ...state, quickDraw: null }, effects: [{ kind: 'clearPreview' }] };
  const m = state.marquee;
  if (m) {
    // 네모가 생겼으면(임계를 넘었으면) 그 안의 그룹을 고르고 네모를 지운다. 안 생겼으면 그냥 누름 — 아무 할 일 없이 끝난다.
    const effects = m.rect ? [{ kind: 'selectRect', rect: m.rect }, { kind: 'clearMarquee' }] : [];
    return { state: { ...state, marquee: null }, effects };
  }
  const d = state.draw;
  if (!d || !env.activeMove) return same(state);
  const { endRow, endCol } = env.endAt(d, ev.x, ev.y);
  const count = resolveDragCount({
    startRow: d.row, startIndex: d.startIndex, endRow, endCol, board: env.board, lowerBound: env.defaultCount,
  });
  return {
    state: { ...state, draw: null },
    effects: [
      { kind: 'place', moveId: env.activeMove.moveId, startRow: d.row, startIndex: d.startIndex, totalCount: count },
      { kind: 'commit' },
      { kind: 'clearPreview' },
    ],
  };
}

/**
 * 마우스 포인터의 pointercancel — 그리던 것 · 빠른 배치 끌기를 지운다. 원본에는 없던 길이다(mouse 이벤트에는
 * cancel 이 없다). 브라우저가 포인터를 빼앗을 때(네이티브 드래그 시작 등)만 오며, 빈 트랙에서 시작한 그리기 중에는
 * 실제로 오지 않는다 — 와도 프리뷰만 지우고 아무것도 놓지 않는다.
 * @param {object} state
 */
// @complexity time=O(1) space=O(1) cc=4
export function mouseCancel(state) {
  if (!state.draw && !state.quickDraw && !state.marquee) return same(state);
  const effects = [];
  if (state.draw || state.quickDraw) effects.push({ kind: 'clearPreview' });
  if (state.marquee) effects.push({ kind: 'clearMarquee' });   // RM-14 — 네모를 그리던 중에 포인터를 빼앗기면 네모만 지우고 고르지 않는다
  return { state: { ...state, draw: null, quickDraw: null, marquee: null }, effects };
}

/**
 * 터치 그리기 시작(원본 2685-2696). 포인터 밑을 먼저 재고, 그다음에 블록 위인지 본다(원본 순서).
 * @param {object} state
 * @param {{x:number, y:number, onPlacement:boolean}} ev
 * @param {GestureEnv} env
 */
export function touchDrawStart(state, ev, env) {
  if (!env.activeMove) return same(state);
  const hit = env.hitAt(ev.x, ev.y);
  if (!hit.inBoard || ev.onPlacement) return same(state);
  return {
    state: { ...state, draw: { row: hit.row, startIndex: hit.col, track: hit.track } },
    effects: [{ kind: 'stopPropagation' }, preview(hit.row, hit.col, drawPreviewCount(hit.col, hit.col))],
  };
}

/**
 * 터치 그리기 이동(원본 2698-2703). 마우스 그리기(mouseMove)와 같은 셈이다 — 손가락 밑의 행·칸을 재어
 * 행을 넘겨 세고 보드 끝에서 자른다. 프리뷰 하한은 1.
 * RM-11(2026-11-02)이 옛 「시작 트랙 한 행 안에서만」(crossRow:false)을 고쳤다 — docs/deviations.md 「고쳐서 내보낸 것」.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=3
export function touchDrawMove(state, ev, env) {
  const d = state.draw;
  if (!d || !env.activeMove) return same(state);
  const { endRow, endCol } = env.endAt(d, ev.x, ev.y);
  const count = resolveDragCount({ startRow: d.row, startIndex: d.startIndex, endRow, endCol, board: env.board, lowerBound: 1 });
  return { state, effects: [preview(d.row, d.startIndex, count)] };
}

/**
 * 터치 그리기 끝(원본 2705-2715). 마우스 그리기 끝(mouseUp)과 같은 셈 — 행을 넘겨 세고 보드 끝에서 자르며,
 * 놓을 때의 하한은 기본 카운트다(RM-11 이 옛 crossRow:false 를 걷었다).
 * @param {object} state
 * @param {{x:number, y:number}} ev  그 포인터의 pointerup 좌표
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=3
export function touchDrawEnd(state, ev, env) {
  const d = state.draw;
  if (!d || !env.activeMove) return same(state);
  const { endRow, endCol } = env.endAt(d, ev.x, ev.y);
  const count = resolveDragCount({
    startRow: d.row, startIndex: d.startIndex, endRow, endCol, board: env.board, lowerBound: env.defaultCount,
  });
  return {
    state: { ...state, draw: null },
    effects: [
      { kind: 'place', moveId: env.activeMove.moveId, startRow: d.row, startIndex: d.startIndex, totalCount: count },
      { kind: 'commit' },
      { kind: 'clearPreview' },
    ],
  };
}

/**
 * 터치 그리기 취소(원본 2717-2721). ⚠ activeMove 를 보지 않는다 — 그리는 중이면 무조건 지운다.
 * @param {object} state
 */
export function touchDrawCancel(state) {
  if (!state.draw) return same(state);
  return { state: { ...state, draw: null }, effects: [{ kind: 'clearPreview' }] };
}

/**
 * 빠른 배치 손가락 시작(원본 2725-2737). 같은 touchstart 에서 그리기가 먼저 돌아 draw 가 생겼으면 비킨다.
 * ⚠ 블록 위인지를 **먼저** 보고 그다음에 포인터 밑을 잰다 — 그리기 시작과 순서가 반대다(원본 그대로).
 * @param {object} state
 * @param {{x:number, y:number, onPlacement:boolean}} ev
 * @param {GestureEnv} env
 */
export function quickTouchStart(state, ev, env) {
  if (!env.quickPlaceMode || env.activeMove || state.draw) return same(state);
  if (ev.onPlacement) return same(state);
  const hit = env.hitAt(ev.x, ev.y);
  if (!hit.inBoard) return same(state);
  return {
    state: {
      ...state,
      quickTouch: { x: ev.x, y: ev.y, track: hit.track, row: hit.row, startIndex: hit.col, count: env.defaultCount, isDrag: false },
    },
    effects: [preview(hit.row, hit.col, env.defaultCount)],
  };
}

/**
 * 빠른 배치 손가락 이동(원본 2739-2758). 12px 을 넘기 전까지는 탭이다 — 아무것도 하지 않는다.
 * 한 번 끌기가 되면 되돌아오지 않는다.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
export function quickTouchMove(state, ev, env) {
  const a = state.quickTouch;
  if (!env.quickPlaceMode || !a) return same(state);
  const isDrag = a.isDrag || exceedsThreshold(ev.x - a.x, ev.y - a.y, QUICK_DRAG_THRESHOLD_PX);
  if (!isDrag) return same(state);
  const { endRow, endCol } = env.endAt(a, ev.x, ev.y);
  const count = resolveDragCount({ startRow: a.row, startIndex: a.startIndex, endRow, endCol, board: env.board, lowerBound: 1 });
  return {
    state: { ...state, quickTouch: { ...a, isDrag: true, count, clientX: ev.x, clientY: ev.y } },
    effects: [preview(a.row, a.startIndex, count)],
  };
}

/**
 * 빠른 배치 손가락 뗌(원본 2760-2772). 탭이면 뗀 자리의 칸·기본 카운트, 끌기면 시작 칸·끈 카운트로 팝업을 연다.
 * ⚠ 마우스와 달리 프리뷰를 **지운 뒤** 팝업을 연다.
 * @param {object} state
 * @param {{x:number, y:number}} ev  changedTouches[0] 의 좌표
 * @param {GestureEnv} env
 */
export function quickTouchEnd(state, ev, env) {
  const a = state.quickTouch;
  if (!env.quickPlaceMode || !a) return same(state);
  const { row, startIndex, isDrag } = a;
  const count = isDrag ? a.count : env.defaultCount;
  const clientX = isDrag ? (a.clientX || ev.x) : ev.x;
  const clientY = isDrag ? (a.clientY || ev.y) : ev.y;
  const cellIdx = isDrag ? startIndex : env.colAt(a.track, ev.x);
  return {
    state: { ...state, quickTouch: null },
    effects: [{ kind: 'clearPreview' }, { kind: 'openPicker', row, startIndex: cellIdx, clientX, clientY, count }],
  };
}

/**
 * 빠른 배치 손가락 취소(원본 2774-2776).
 * @param {object} state
 */
export function quickTouchCancel(state) {
  if (!state.quickTouch) return same(state);
  return { state: { ...state, quickTouch: null }, effects: [{ kind: 'clearPreview' }] };
}

/**
 * 블록 위 손가락 pointerdown 의 두 번 탭(원본 2532-2548). 손잡이·`✎`·팝업 가드는 리스너가 먼저 본다.
 *
 * 두 번 탭하면 **지우지 않고 동작 고르기 창을 연다**(RM-12, 2026-11-03 — 의도한 동작 변경). 원본은 확인 없이 지웠다 —
 * 편집기를 써 본 손에 「몸통 두 번 누르기」는 열기 · 이름 정하기라 사고로 이어졌다. 지우기는 Delete · 팝업 · 루틴 팝업으로만.
 * 마우스의 더블클릭(dblclick)도 같은 할 일이다 — docs/deviations.md 「고쳐서 내보낸 것」.
 *
 * 루틴 가드(routineGuarded — 메인 보드의 루틴 블록)가 **맨 앞**이다: 그 탭은 기본 동작을 막지 않고 창을 열지 않으며
 * 탭 기억을 비운다. 원본은 가드가 preventDefault **뒤에** 와서 둘째 탭의 팝업이 막히고, 기억이 남아 셋째 탭도
 * 더블탭으로 잡혔다 — RM-11(2026-11-02)이 고쳤다(docs/deviations.md 「고쳐서 내보낸 것」).
 *
 * @param {object} state
 * @param {{now:number, groupId:string, routineGuarded:boolean, x?:number, y?:number}} ev
 */
// @complexity time=O(1) space=O(1) cc=3
export function placementTap(state, ev) {
  if (ev.routineGuarded) return { state: { ...state, tap: { time: 0, groupId: null } }, effects: [] };
  const { time, groupId: lastGroupId } = state.tap;
  if (!isDoubleTap(ev.now, time, ev.groupId, lastGroupId)) {
    return { state: { ...state, tap: { time: ev.now, groupId: ev.groupId } }, effects: [] };
  }
  return {
    state: { ...state, tap: { time: 0, groupId: null } },
    effects: [{ kind: 'preventDefault' }, { kind: 'openGroupPicker', groupId: ev.groupId, clientX: ev.x, clientY: ev.y }],
  };
}

// ── 블록을 누른 자리 — 가장자리 트리밍 · 몸통 끌기 (RM-12) ─────────────────────────────────────

/**
 * 블록 위 pointerdown — 누른 자리(zone)로 가른다(RM-12).
 *   가장자리('left' · 'right')  → 트리밍 시작. 메인 보드의 루틴 블록(routineGuarded)은 길이가 루틴의 것이라 양쪽 모두
 *                                 트리밍하지 않고 몸통처럼 다룬다 — 끌면 옮기고 누르면 루틴 팝업이다.
 *   몸통                         → 마우스면 끌기 후보(임계를 넘기 전까지는 클릭). 손가락은 아무것도 하지 않는다 —
 *                                 짚고 굴리면 화면 넘기기, 떼면 click(팝업), 길게 누르면 옮기기(입력 계층의 longPress).
 * ⚠ Alt(복사)는 **누른 순간**에 한 번 읽는다 — 원본 dragstart(2480)의 copyMode 와 같다. 끌다가 눌러도 복사가 아니다.
 * ⚠ bundle 은 호출부가 정한다(고른 블록이고 고른 것이 둘 이상이면 그 묶음). 복사면 묶음을 쓰지 않는다 — 지금처럼 그 블록 하나다.
 * @param {object} state
 * @param {{x:number, y:number, groupId:string, zone:'left'|'body'|'right', routineGuarded:boolean, altKey:boolean,
 *          pointerType:string, bundle?:string[]|null}} ev
 */
// @complexity time=O(1) space=O(1) cc=5
export function placementDown(state, ev) {
  if (ev.zone !== 'body' && !ev.routineGuarded) {
    return {
      state: { ...state, body: null },
      effects: [{ kind: 'preventDefault' }, { kind: 'startTrim', edge: ev.zone, groupId: ev.groupId, clientX: ev.x }],
    };
  }
  if (pointerKind(ev.pointerType) === 'touch') return { state: { ...state, body: null }, effects: [] };
  const copy = !!ev.altKey;
  const body = { groupId: ev.groupId, x: ev.x, y: ev.y, copy, bundle: copy ? null : (ev.bundle || null), dragging: false };
  return { state: { ...state, body }, effects: [{ kind: 'preventDefault' }] };
}

/**
 * 몸통을 누른 마우스의 pointermove(RM-12). 임계(BODY_DRAG_THRESHOLD_PX)를 넘기 전에는 아무 일도 없다 — 떼면 클릭이다.
 * 넘는 순간 옮기기가 시작되고(beginMove), 그 뒤로는 포인터 밑 칸에 놓일 자리를 그린다. 보드 밖이면 프리뷰를 지운다.
 * 한 번 끌기가 되면 되돌아오지 않는다.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=5
export function bodyMove(state, ev, env) {
  const b = state.body;
  if (!b) return same(state);
  if (!b.dragging && !exceedsThreshold(ev.x - b.x, ev.y - b.y, BODY_DRAG_THRESHOLD_PX)) return same(state);
  const effects = b.dragging ? [] : [{ kind: 'beginMove', groupId: b.groupId, copy: b.copy, bundle: b.bundle }];
  const hit = env.hitAt(ev.x, ev.y);
  effects.push(hit.inBoard ? { kind: 'movePreview', row: hit.row, startIndex: hit.col } : { kind: 'clearPreview' });
  return { state: { ...state, body: { ...b, dragging: true } }, effects };
}

/**
 * 몸통을 누른 마우스의 pointerup(RM-12 — document 에서 듣는다, 보드 밖에서 떼도 온다).
 * 끌기가 아니었으면 아무 할 일 없이 끝난다 — 뒤따르는 click 이 고르기(그냥 · Ctrl · Shift)나 루틴 팝업을 한다.
 * 끌기였으면 끝내고(endMove), 보드 안에서 뗐을 때만 옮기거나 복사하고 커밋한다. 묶음은 호출부가 거리를 재어 옮기고,
 * 옮겼을 때만 커밋한다(RM-14 와 같다). 마지막으로 뒤따르는 합성 click 을 한 번 삼킨다 — 놓은 블록의 선택이 뒤집히거나
 * 루틴 팝업이 뜨지 않게.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
// @complexity time=O(1) space=O(1) cc=6
export function bodyUp(state, ev, env) {
  const b = state.body;
  if (!b) return same(state);
  const next = { ...state, body: null };
  if (!b.dragging) return { state: next, effects: [] };
  const effects = [{ kind: 'endMove' }];
  const hit = env.hitAt(ev.x, ev.y);
  if (hit.inBoard) {
    const at = { groupId: b.groupId, row: hit.row, startIndex: hit.col };
    if (b.copy) effects.push({ kind: 'copy', ...at }, { kind: 'commit' });
    else if (b.bundle) effects.push({ kind: 'moveBundle', ...at, bundle: b.bundle });
    else effects.push({ kind: 'move', ...at }, { kind: 'commit' });
  }
  effects.push({ kind: 'swallowClick' });
  return { state: next, effects };
}

/**
 * 몸통 끌기 중의 pointercancel(RM-12) — 놓지 않고 끝낸다. 끌기 전이었으면 아무 일도 없다.
 * @param {object} state
 */
// @complexity time=O(1) space=O(1) cc=3
export function bodyCancel(state) {
  const b = state.body;
  if (!b) return same(state);
  return { state: { ...state, body: null }, effects: b.dragging ? [{ kind: 'endMove' }] : [] };
}

/**
 * 행 라벨의 우클릭 · 길게 누르기(2026-11-02, RM-16) — 마디 메뉴를 열지 판정한다.
 *
 * 몸통 행(1..rows)의 라벨에서만 연다. 인트로 행(0)은 마디가 아니라 끼우거나 지울 수 없으므로 메뉴가 없고,
 * 라벨이 아닌 곳(트랙 · 비고)은 블록 팝업과 브라우저 메뉴의 몫이다. 상태는 바꾸지 않는다.
 *
 * @param {object} state
 * @param {{row:number|null, x:number, y:number}} ev  라벨이 아니면 row 가 null
 * @param {{board:{rows:number}}} env
 */
// @complexity time=O(1) space=O(1) cc=4
export function rowLabelPress(state, ev, env) {
  const row = ev.row;
  if (!Number.isInteger(row) || row < 1 || row > env.board.rows) return { state, effects: [] };
  return {
    state,
    effects: [
      { kind: 'preventDefault' },
      { kind: 'openRowMenu', row, clientX: ev.x, clientY: ev.y, first: row === 1, last: row === env.board.rows },
    ],
  };
}
