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

import { resolveDragCount, isDoubleTap, exceedsThreshold, QUICK_DRAG_THRESHOLD_PX } from './gestureMath.js';

/**
 * @typedef {object} GestureEnv  지금 세션 값과 측정 함수. 리스너가 이벤트마다 새로 만든다.
 * @property {boolean} quickPlaceMode
 * @property {{moveId:string}|null} activeMove  팔레트에서 고른 동작
 * @property {number} defaultCount
 * @property {{rows:number, cols:number}} board
 * @property {(track:any, clientX:number) => number} [colAt]  그 트랙 안의 칸
 * @property {(anchor:{track:any,row:number}, x:number, y:number) => {endRow:number, endCol:number}} [endAt]
 *           포인터 밑의 끝 칸(보드 밖이면 앵커 트랙·행으로 되돌아간다)
 * @property {(x:number, y:number) => {inBoard:boolean, track:any, row:number|null, col:number|null}} [hitAt]
 */

/** @returns {{draw:null, quickDraw:null, quickTouch:null, tap:{time:number, groupId:string|null}}} */
export function initialGestureState() {
  return { draw: null, quickDraw: null, quickTouch: null, tap: { time: 0, groupId: null } };
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
 * 보드 위 mousedown — 빠른 배치 끌기 또는 그리기 시작(원본 2606-2627).
 * ⚠ 빠른 배치가 먼저 이긴다. 다만 동작을 골라 둔 상태(activeMove)거나 이미 그리는 중이면 그리기로 간다.
 * @param {object} state
 * @param {{x:number, y:number, track:any, row:number|null, onPlacement:boolean}} ev
 *        track 은 e.target 이 든 트랙(없으면 null), onPlacement 는 블록·손잡이 위인가
 * @param {GestureEnv} env
 */
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
  if (!env.activeMove || !ev.track || ev.onPlacement) return same(state);
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
export function mouseUp(state, ev, env) {
  const q = state.quickDraw;
  if (q && env.quickPlaceMode) {
    return {
      state: { ...state, quickDraw: null },
      effects: [{ kind: 'openPicker', row: q.row, startIndex: q.startIndex, clientX: q.clientX, clientY: q.clientY, count: q.count }],
    };
  }
  if (q) return { state: { ...state, quickDraw: null }, effects: [{ kind: 'clearPreview' }] };
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
 * 터치 그리기 이동(원본 2698-2703). ⚠ 시작 트랙 **한 행 안에서만** 센다 — 행을 넘지 않는다.
 * @param {object} state
 * @param {{x:number, y:number}} ev
 * @param {GestureEnv} env
 */
export function touchDrawMove(state, ev, env) {
  const d = state.draw;
  if (!d || !env.activeMove) return same(state);
  const endIndex = env.colAt(d.track, ev.x);
  return { state, effects: [preview(d.row, d.startIndex, drawPreviewCount(d.startIndex, endIndex))] };
}

/**
 * 터치 그리기 끝(원본 2705-2715). ⚠ 행 넘김도 끝에서 자르기도 없다(crossRow:false).
 * @param {object} state
 * @param {{x:number, y:number}} ev  changedTouches[0] 의 좌표
 * @param {GestureEnv} env
 */
export function touchDrawEnd(state, ev, env) {
  const d = state.draw;
  if (!d || !env.activeMove) return same(state);
  const endIndex = env.colAt(d.track, ev.x);
  const count = resolveDragCount({
    startRow: d.row, startIndex: d.startIndex, endRow: d.row, endCol: endIndex,
    board: env.board, lowerBound: env.defaultCount, crossRow: false,
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
 * 블록 위 touchstart 의 더블탭 지우기(원본 2532-2548). 손잡이·`✎`·팝업 폭 가드는 리스너가 먼저 본다.
 *
 * ⚠ 루틴 가드(routineGuarded)는 preventDefault **뒤에** 온다. 그 조기 반환은 지난 탭을 되돌리지 않아
 *   세 번째 탭도 다시 더블탭으로 잡힌다 — 오늘 동작이다(docs/deviations.md).
 *
 * @param {object} state
 * @param {{now:number, groupId:string, routineGuarded:boolean}} ev
 */
export function placementTap(state, ev) {
  const { time, groupId: lastGroupId } = state.tap;
  if (!isDoubleTap(ev.now, time, ev.groupId, lastGroupId)) {
    return { state: { ...state, tap: { time: ev.now, groupId: ev.groupId } }, effects: [] };
  }
  if (ev.routineGuarded) return { state, effects: [{ kind: 'preventDefault' }] };
  return {
    state: { ...state, tap: { time: 0, groupId: null } },
    effects: [{ kind: 'preventDefault' }, { kind: 'remove', groupId: ev.groupId }, { kind: 'commit' }],
  };
}
