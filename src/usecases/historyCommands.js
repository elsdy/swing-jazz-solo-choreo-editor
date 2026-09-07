// src/usecases/historyCommands.js — undo/redo 스택 1벌 × 인스턴스 2개 (usecases 계층)
//
// 원본 index.html 의 snapshotState·restoreSnapshot·saveHistory·undo·redo(2833-2886)와
// 그 루틴 편집기 복제본 snapshotStateRe·saveHistoryRe·undoRe·redoRe(2900-2936)를 HistoryStack
// 한 벌로 합쳤다. 두 벌의 유일한 차이인 **스냅샷 필드 집합**(메인 6필드 / 루틴 3필드)만
// SNAPSHOT_SPEC[boardId] 로 갈린다. 렌더 호출 7종이 있던 자리에는 Dirty 를 돌려준다.

import { UNDO_FIELDS, ROUTINE_UNDO_FIELDS } from '../domain/project/schema.js';
import { snapshotMain, snapshotRoutine, applySnapshot } from '../domain/project/snapshot.js';
import { normalize as normalizeCategories } from '../domain/categories.js';
import { DEFAULT_CATEGORIES } from '../domain/defaults.js';
import { BOARD_MAIN, BOARD_ROUTINE, BOARD_IDS, boardOf, NONE } from './store.js';

// ─────────────────────────────────────────────────────────────────────────────
// 보드별 스냅샷 규격
//
// ⚠ 필드 목록은 domain/project/schema.js 소유다. 여기서 새로 만들거나 순서를 바꾸지 마라 —
//   중복 스냅샷 판정이 JSON 문자열 비교(2864)라서 키 순서가 곧 undo 깊이이고 저장 바이트다.
// ⚠ limit 100 은 원본 2869·2908 의 `if (length > 100) shift()` 그대로다.
// ─────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_SPEC = Object.freeze({
  [BOARD_MAIN]: Object.freeze({
    kind: 'main',            // applySnapshot 의 kind 인자 (= BOARD_POLICY.snapshotKind)
    fields: UNDO_FIELDS,     // ['rows','cols','placements','moveLibrary','categories','routines']
    limit: 100               // 2869
  }),
  [BOARD_ROUTINE]: Object.freeze({
    kind: 'routine',
    fields: ROUTINE_UNDO_FIELDS, // ['rows','cols','placements']
    limit: 100                   // 2908
  })
});

// ─────────────────────────────────────────────────────────────────────────────
// store ↔ 스냅샷 평평한 뷰
//
// store 는 boards.main / library / categories / routines 로 쪼개져 있고 snapshot.js 는 원본
// state 처럼 평평한 객체를 기대한다. 그 사이를 잇는 유일한 자리가 여기다(STAGE1 계약).
// ─────────────────────────────────────────────────────────────────────────────

/** snapshotState(2834-2839)가 보던 그대로의 평평한 뷰. 키 순서는 snapshotMain 이 UNDO_FIELDS 로 고정한다. */
function mainSnapshotView(state) {
  const board = boardOf(state, BOARD_MAIN);
  return {
    rows: board.rows,
    cols: board.cols,
    placements: board.placements,
    moveLibrary: state.library,
    categories: state.categories,
    routines: state.routines
  };
}

/** snapshotStateRe(2901)가 보던 그대로. BoardDoc 의 hasIntroRow 는 ROUTINE_UNDO_FIELDS 밖이라 무시된다. */
function routineSnapshotView(state) {
  return boardOf(state, BOARD_ROUTINE);
}

/** 지금 상태의 스냅샷 문자열. */
function takeSnapshot(state, boardId) {
  return boardId === BOARD_MAIN
    ? snapshotMain(mainSnapshotView(state))
    : snapshotRoutine(routineSnapshotView(state));
}

// ─────────────────────────────────────────────────────────────────────────────
// 복원 — restoreSnapshot(2844-2861) / undoRe·redoRe 의 상태 대입부
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 메인 스냅샷을 store 에 되돌린다. restoreSnapshot(2845-2851).
 * ⚠ applySnapshot 에 categories.normalize 와 DEFAULT_CATEGORIES 를 반드시 넘긴다(1단계 요구).
 * ⚠ 패치에 'routines' 키가 없으면 기존 routines 를 **건드리지 않는다**(2850, 보존 대상 결함).
 */
function restoreMain(store, snapshot) {
  const patch = applySnapshot(snapshot, {
    kind: SNAPSHOT_SPEC[BOARD_MAIN].kind,
    normalizeCategories,
    defaultCategories: DEFAULT_CATEGORIES
  });
  store.setBoard(BOARD_MAIN, {
    rows: patch.rows,
    cols: patch.cols,
    placements: patch.placements
  });
  const top = {
    library: patch.moveLibrary,   // state.moveLibrary (2848)
    categories: patch.categories, // 2849
    selection: new Set()          // state.selectedGroupIds.clear() (2851)
  };
  if ('routines' in patch) top.routines = patch.routines; // 2850
  store.update(top);
}

/**
 * 루틴 편집기 스냅샷을 store 에 되돌린다. undoRe(2917-2918) / redoRe(2930-2931).
 * ⚠ kind:'routine' 은 기본값 사슬(||8, ||[])이 없다 — 여기서 기본값을 채우면 동작이 바뀐다.
 */
function restoreRoutine(store, snapshot) {
  const patch = applySnapshot(snapshot, { kind: SNAPSHOT_SPEC[BOARD_ROUTINE].kind });
  store.setBoard(BOARD_ROUTINE, {
    rows: patch.rows,
    cols: patch.cols,
    placements: patch.placements
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 복원 후 Dirty — 원본이 그 자리에서 부르던 렌더 함수 목록을 그대로 옮긴 것
// ─────────────────────────────────────────────────────────────────────────────

/**
 * restoreSnapshot(2851-2860)의 렌더 7종:
 *   updateCreateRoutineFromSelectionBtn(2852) → selection + toolbar
 *   syncBoardSizeUI(2853)                     → toolbar(boardColsInput·boardTitle) + layout(updateMobileCellSize 2943)
 *   renderCategoryOptions(2854)               → categorySelect (presenter 가 manager 도 함께 그린다 = 원본 2967 사슬)
 *   renderLegend(2855) / renderPalette(2856)  → legend / palette
 *   renderBoard(true)(2857)                   → boards.main { skeleton, rows:'all' }
 *   renderRoutineList(2858)                   → routineList
 *   updateHistoryButtons(2859)                → history
 */
function mainRestoreDirty() {
  return {
    layout: true,
    boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } },
    selection: true,
    palette: true,
    legend: true,
    categorySelect: true,
    routineList: true,
    toolbar: true,
    history: true
  };
}

/**
 * undoRe(2919-2922) / redoRe(2932-2935)의 렌더:
 *   syncReBoardSizeUI → routineEditor · renderBoard(true, reCtx) → boards.routine · updateReHistoryButtons → history
 * ⚠ syncCurrentRoutine(2923·2936)은 여기 없다 — routineCommands.syncFromEditor 를 호출부가 부른다(아래 주석 참조).
 * ⚠ layout 을 켜지 않는다: syncReBoardSizeUI(2944-2950)는 updateMobileCellSize 를 부르지 않는다(원본 비대칭).
 */
function routineRestoreDirty() {
  return {
    boards: { [BOARD_ROUTINE]: { skeleton: true, rows: 'all' } },
    routineEditor: true,
    history: true
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HistoryStack — 원본의 state.history/state.future(1409-1410)와 reState 쪽(1437-1438)이 하나로
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 스냅샷 문자열 스택 한 벌. past[past.length-1] 이 "지금"이고, undo 는 그 앞칸으로 되돌린다.
 * ⚠ 필드 이름을 `history` 로 두지 않는다 — tools/check-arch.mjs 가 순수 계층에서 전역 `history`
 *   사용을 금지하기 때문이며, 이름을 바꿔도 동작은 같다.
 */
class HistoryStack {
  /** @param {'main'|'routine'} boardId */
  constructor(boardId) {
    const spec = SNAPSHOT_SPEC[boardId];
    if (!spec) throw new TypeError(`알 수 없는 보드 '${boardId}'`);
    this.boardId = boardId;
    this.spec = spec;
    this.past = [];    // state.history (1409) / reState.history (1437)
    this.future = [];  // state.future  (1410) / reState.future  (1438)
  }

  /** undoBtn.disabled = past.length <= 1 (2890) 의 반대. */
  canUndo() { return this.past.length > 1; }

  /** redoBtn.disabled = future.length === 0 (2891) 의 반대. */
  canRedo() { return this.future.length > 0; }

  /** 중복이면 false. saveHistory(2864-2868) / saveHistoryRe(2906-2910)의 판정 그대로. */
  push(snapshot) {
    if (this.past[this.past.length - 1] === snapshot) return false;
    this.past.push(snapshot);
    if (this.past.length > this.spec.limit) this.past.shift(); // 2869 / 2908
    this.future = [];                                          // 2871 / 2909
    return true;
  }

  /** 되돌릴 스냅샷 문자열. 없으면 null(원본의 조기 반환). */
  stepBack() {
    if (!this.canUndo()) return null;          // 2876 / 2916
    this.future.push(this.past.pop());         // 2877 / 2917
    return this.past[this.past.length - 1];    // 2878 / 2918
  }

  /** 다시 적용할 스냅샷 문자열. 없으면 null. */
  stepForward() {
    if (!this.canRedo()) return null;          // 2882 / 2927
    const snapshot = this.future.pop();        // 2883 / 2928
    this.past.push(snapshot);                  // 2884 / 2929
    return snapshot;
  }

  /** 스택을 스냅샷 하나로 초기화한다. openRoutineEditor(4804-4805·4817) 의 자리. */
  reset(snapshot) {
    this.past = [snapshot];
    this.future = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 API — 전부 (hist, boardId) 를 받는다.
//
// ⚠ 원본에서 리사이즈 확정(3766)과 터치 이동 확정(3881)만 주입된 saveHistoryFn 을 무시하고
//   `ctx === mainCtx ? saveHistory() : saveHistoryRe()` 로 갈라졌다. commit(hist, boardId) 하나가
//   그 비대칭을 없앤다 — 호출부는 자기 boardId 만 넘기면 된다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 히스토리 한 벌(메인·루틴 두 스택)을 만든다.
 * @param {object} store  usecases/store.js 의 createStore(...) 결과
 * @returns {{ store: object, stacks: Record<string, HistoryStack>, stack: (boardId:string)=>HistoryStack }}
 */
export function createHistory(store) {
  if (!store) throw new TypeError('createHistory(store): store 가 필요하다');
  const stacks = {};
  for (const boardId of BOARD_IDS) stacks[boardId] = new HistoryStack(boardId);
  return {
    store,
    stacks,
    stack(boardId) {
      const found = stacks[boardId];
      if (!found) throw new TypeError(`알 수 없는 보드 '${boardId}'`);
      return found;
    }
  };
}

/**
 * 지금 상태를 스냅샷으로 적재한다. saveHistory(2863-2873) / saveHistoryRe(2904-2913).
 *
 * ⚠ 중복이어도 Dirty 는 { history:true } 다 — 원본이 중복 분기에서도 updateHistoryButtons() 를
 *   부르고 나가기 때문이다(2866).
 * ⚠ boardId==='routine' 일 때 원본 saveHistoryRe 는 마지막에 syncCurrentRoutine()(2912)을 부른다.
 *   그것은 routineCommands.syncFromEditor(store) 의 몫이고 **호출부가 명시적으로** 부른 뒤
 *   두 Dirty 를 mergeDirty 로 합쳐야 한다(훅 하나로 숨기면 편집기 undo 가 메인 보드에 반영되지 않는다).
 *
 * @param {object} hist  createHistory(...) 결과
 * @param {'main'|'routine'} boardId
 * @returns {object} Dirty
 */
export function commit(hist, boardId) {
  const stack = hist.stack(boardId);
  stack.push(takeSnapshot(hist.store.get(), boardId));
  return { history: true };
}

/**
 * 한 칸 되돌린다. undo(2875-2879) / undoRe(2915-2924).
 * 되돌릴 것이 없으면 아무 일도 하지 않고 NONE 을 돌려준다(원본의 조기 반환 — 버튼 갱신조차 없다).
 * @returns {object} Dirty
 */
export function undo(hist, boardId) {
  const stack = hist.stack(boardId);
  const snapshot = stack.stepBack();
  if (snapshot === null) return NONE;
  return applyRestore(hist.store, boardId, snapshot);
}

/**
 * 한 칸 다시 적용한다. redo(2881-2886) / redoRe(2926-2936).
 * @returns {object} Dirty
 */
export function redo(hist, boardId) {
  const stack = hist.stack(boardId);
  const snapshot = stack.stepForward();
  if (snapshot === null) return NONE;
  return applyRestore(hist.store, boardId, snapshot);
}

/** undo/redo 가 공유하는 복원부. */
function applyRestore(store, boardId, snapshot) {
  if (boardId === BOARD_MAIN) {
    restoreMain(store, snapshot);
    return mainRestoreDirty();
  }
  restoreRoutine(store, snapshot);
  return routineRestoreDirty();
}

/**
 * 스택을 지금 상태 하나로 초기화한다. openRoutineEditor 의
 * `reState.history = []; reState.future = [];`(4804-4805) → `reState.history = [snapshotStateRe()]`(4817)
 * → `updateReHistoryButtons()`(4818) 세 줄에 해당한다.
 * @returns {object} Dirty
 */
export function reset(hist, boardId) {
  hist.stack(boardId).reset(takeSnapshot(hist.store.get(), boardId));
  return { history: true };
}

/** undoBtn.disabled 의 반대(2890 / 2896). */
export function canUndo(hist, boardId) {
  return hist.stack(boardId).canUndo();
}

/** redoBtn.disabled 의 반대(2891 / 2897). */
export function canRedo(hist, boardId) {
  return hist.stack(boardId).canRedo();
}
