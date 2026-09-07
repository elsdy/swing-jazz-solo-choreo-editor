// src/ui/toolbarView.js — 메인 보드 위 툴바 (ui 계층)
//
// 원본 index.html 의 updateHistoryButtons(2888-2892) · syncBoardSizeUI(2938-2942) ·
// updateCreateRoutineFromSelectionBtn(4519-4529) · 툴바 요소 참조(1510-1514)를 옮겼다.
//
// 화면 구성(마크업 1315-1327): boardTitle · '안무표 크기' 알약 · '기본 카운트' 알약 ·
//   '+ 빠른 배치' · '루틴으로 편성 (N)' · Undo · Redo · '전체 초기화'.
//
// ⚠⚠ **#boardColsInput 은 이름과 달리 state.rows(행 수)를 담는다.** 원본 2939 가
//   `boardColsInput.value = state.rows` 이고 2953 이 그 값을 rows 로 되읽는다. 열(cols)은 8 고정이라
//   마크업에도 `8 x [입력]` 으로 적혀 있다(1320). id 는 마크업을 바꾸지 않기 위해 그대로 두고
//   변수명만 rowsInput 으로 정직하게 바꾼다.
//
// ⚠ syncBoardSizeUI 가 끝에서 updateMobileCellSize()(=CSS 변수 쓰기)를 부르던 순서
//   (변수 먼저 → 보드 골격 나중)는 이 파일이 아니라 presenter 의 layout 플래그가 보장한다.
//   setBoardRows 가 {layout, toolbar, boards} 를 함께 내고 presenter 가 layout 을 가장 먼저 적용한다.
//
// ⚠⚠ **이 파일은 리스너를 하나도 걸지 않는다.** 툴바 입력 8종(#boardColsInput change/keydown,
//   #boardColsDec/Inc, #defaultCountInput/Dec/Inc, #quickPlaceBtn, #undoBtn, #redoBtn,
//   #addRoutineBtn, #createRoutineFromSelectionBtn, #clearBtn)은 전부 input/controls.js 가 건다.
//   #clearBtn 의 confirmOnce 는 app/main 이 ui/widgets.confirmOnce 를 controls 에 **주입**해서
//   해결한다(input 은 ui 를 import 할 수 없다) — 여기서 다시 걸면 확인이 두 번 뜨고
//   clearBoard 가 두 번 돈다. 원본에도 리스너는 2360 한 곳뿐이다.

import { CLS } from './domContract.js';

/** 메인 보드의 store 상 id. usecases/store.BOARD_MAIN 과 같은 문자열이다(ui 는 usecases 를 import 하지 않는다). */
const BOARD_MAIN = 'main';

/**
 * @typedef {object} ToolbarDeps
 * @property {any} store createStore 인스턴스. board('main') · session.defaultCount ·
 *   session.quickPlaceMode.main · selection 을 읽는다.
 * @property {(boardId: string) => boolean} canUndo historyCommands.canUndo 를 감싼 것
 * @property {(boardId: string) => boolean} canRedo historyCommands.canRedo 를 감싼 것
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * 메인 툴바 뷰를 만든다.
 *
 * @param {ToolbarDeps} deps
 * @returns {{ render(): void, syncHistory(): void, syncSelection(): void }}
 */
export function createToolbarView(deps) {
  const { store, canUndo, canRedo, elements = {} } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const boardTitle = byId('boardTitle');                     // 1512
  /** ⚠ id 는 boardColsInput 이지만 담는 값은 **행 수**다(위 경고 참조). */
  const rowsInput = byId('boardColsInput');                  // 1510
  const defaultCountInput = byId('defaultCountInput');       // 1511
  const quickPlaceBtn = byId('quickPlaceBtn');
  const createRoutineFromSelectionBtn = byId('createRoutineFromSelectionBtn');
  const undoBtn = byId('undoBtn');                           // 1513
  const redoBtn = byId('redoBtn');                           // 1514

  // ── 바인딩 ───────────────────────────────────────────────────────────────
  // 없다. 이 뷰는 **읽고 그리기만** 한다(위 경고 참조).

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  /**
   * '루틴으로 편성 (N)' 버튼. 원본 updateCreateRoutineFromSelectionBtn(4519-4529).
   * ⚠ 선택이 0개면 display:'none' 으로 숨기기만 하고 **라벨은 되돌리지 않는다**(원본에 else 가 그뿐이다).
   */
  function syncSelection() {
    const btn = createRoutineFromSelectionBtn;
    if (!btn) return;                                        // 4521
    const count = store.selection.size;                      // 4522
    if (count >= 1) {                                        // 4523
      btn.style.display = '';                                // 4524
      btn.textContent = `루틴으로 편성 (${count})`;            // 4525
    } else {
      btn.style.display = 'none';                            // 4527
    }
  }

  /** 원본 updateHistoryButtons(2888-2892). 스택 길이를 세지 말고 canUndo/canRedo 를 쓴다. */
  function syncHistory() {
    if (undoBtn) undoBtn.disabled = !canUndo(BOARD_MAIN);    // 2889
    if (redoBtn) redoBtn.disabled = !canRedo(BOARD_MAIN);    // 2890
  }

  /** Dirty.toolbar 의 적용점. syncBoardSizeUI(2938-2941) + 기본 카운트 + 빠른 배치 + 선택 버튼. */
  function renderToolbar() {
    const board = store.board(BOARD_MAIN);
    if (rowsInput) rowsInput.value = board.rows;                                  // 2939
    if (boardTitle) boardTitle.textContent = `8x${board.rows} 안무 테이블`;         // 2940

    // ⚠ 2단계 계약: setDefaultCount 가 {toolbar:true} 만 돌려주므로 여기서 반드시 동기화해야
    //   원본 2374 의 '무효 입력 되돌리기'가 재현된다.
    if (defaultCountInput) defaultCountInput.value = store.session.defaultCount;

    // '+ 빠른 배치' 토글. 원본은 1683-1690 에서 classList 로 'ghost' ↔ 'quick-btn-active' 를
    // 맞바꿨다 — 결과 클래스가 항상 정확히 하나라 store 값에서 재도출할 수 있다.
    if (quickPlaceBtn) {
      const on = !!store.session.quickPlaceMode[BOARD_MAIN];
      quickPlaceBtn.className = on ? CLS.quickBtnActive : CLS.ghost;
    }

    syncSelection();
  }

  return { render: renderToolbar, syncHistory, syncSelection };
}
