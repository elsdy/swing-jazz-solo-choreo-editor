// src/ui/routineEditorView.js — 루틴 편집 패널의 표시/숨김 + 툴바 8컨트롤 (ui 계층)
//
// 원본 index.html 의 updateReHistoryButtons(2893-2898) · syncReBoardSizeUI(2944-2950) ·
// openRoutineEditor 의 DOM 부(4783-4786 · 4806-4861) · applyReBoardSizeFromInput 의 입력 읽기(4862-4864) ·
// closeRoutineEditor 의 DOM 부(4879 · 4881-4883) · routineEditorPanel(1459)을 옮겼다.
//
// ⚠⚠ Dirty.routineEditor 하나가 다음 다섯을 **전부** 대표한다(2단계 계약):
//     ① 패널 표시/숨김(4789 · 4809 · 4882)
//     ② body.overflow 잠금/복구(4790 · 4810 · 4883) — 오버레이 모드일 때만 잠근다
//     ③ syncReBoardSizeUI(4811 · 4873 · 2944-2950)
//     ④ '+ 빠른 배치' 버튼 초기화(4825-4826)
//     ⑤ 퀵피커 정리(4881)
//   그래서 sync() 는 store 만 보고 이 다섯을 재도출한다. 커맨드가 무엇이었는지는 알 필요가 없다.
//
// ⚠ 원본은 열 때마다 on* 핸들러를 다시 대입했다(4827-4860). 여기서는 팩토리에서 **한 번만** 건다.
//   addEventListener 가 아니라 on* 속성이었으므로 여러 번 대입해도 리스너가 쌓이지 않았고,
//   패널이 열리기 전에는 display:none 이라 눌릴 수 없다 — 관찰 동작이 같다.
//   대신 핸들러가 routineId 를 클로저로 잡을 수 없으므로 store.session.editingRoutineId 를 클릭 시점에 읽는다.
//
// ⚠ '오버레이 모드인가' 판정은 ui/layout.isRoutineOverlayMode 하나뿐이다(원본 4779-4781 의 matchMedia).
//   같은 ui 계층이라 import 하되, 테스트가 화면 폭을 흉내 낼 수 있도록 deps 로 덮어쓸 수 있게 뒀다.

import { CLS } from './domContract.js';
import { isRoutineOverlayMode as layoutIsRoutineOverlayMode } from './layout.js';

/** 루틴 편집기 보드의 store 상 id. usecases/store.BOARD_ROUTINE 과 같은 문자열이다(ui 는 usecases 를 import 하지 않는다). */
const BOARD_ROUTINE = 'routine';

/** 컨트롤 dec/inc 의 상·하한. 원본 4854-4857. */
const COLS_MIN = 1, COLS_MAX = 64, ROWS_MIN = 1, ROWS_MAX = 32;
/** 입력이 비었을 때의 폴백 문자열. 원본 4854-4857 · 4863-4864. */
const COLS_FALLBACK = '8', ROWS_FALLBACK = '4';

/**
 * @typedef {object} RoutineEditorDeps
 * @property {any} store createStore 인스턴스. session.editingRoutineId · session.quickPlaceMode.routine ·
 *   board('routine') · routines 를 읽는다.
 * @property {{
 *   undo: () => any,
 *   redo: () => any,
 *   clear: () => any,
 *   close: () => any,
 *   rename: (routineId: string) => any,
 *   toggleQuickPlace: () => any,
 *   setSize: (size: { rows: number, cols: number }) => any
 * }} commands app/main 이 묶어 넘긴다. ⚠ undo/redo/clear 는 **이미 합성돼 있어야 한다**(아래 계약 참조).
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {(boardId: string) => boolean} canUndo historyCommands.canUndo 를 감싼 것
 * @property {(boardId: string) => boolean} canRedo historyCommands.canRedo 를 감싼 것
 * @property {() => boolean} [isRoutineOverlayMode] 기본값은 ui/layout.isRoutineOverlayMode(원본 4779-4781)
 * @property {() => void} [closeQuickPicker] 루틴 퀵피커 닫기(원본 closeReQuickPicker 4776-4779)
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입(기본은 id 로 찾는다)
 */

/**
 * 루틴 편집 패널 뷰를 만든다.
 *
 * @param {RoutineEditorDeps} deps
 * @returns {{ sync(): void, syncHistory(): void }}
 */
export function createRoutineEditorView(deps) {
  const {
    store,
    commands,
    render,
    canUndo,
    canRedo,
    isRoutineOverlayMode = layoutIsRoutineOverlayMode,
    closeQuickPicker = () => {},
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const panel = byId('routineEditorPanel');   // 1459
  const reTitle = byId('reTitle');
  const reSubtitle = byId('reSubtitle');
  const reColsInput = byId('reColsInput');
  const reRowsInput = byId('reRowsInput');
  const reColsDec = byId('reColsDec');
  const reColsInc = byId('reColsInc');
  const reRowsDec = byId('reRowsDec');
  const reRowsInc = byId('reRowsInc');
  const reQuickPlaceBtn = byId('reQuickPlaceBtn');
  const reUndoBtn = byId('reUndoBtn');
  const reRedoBtn = byId('reRedoBtn');
  const reClearBtn = byId('reClearBtn');
  const closeBtn = byId('closeRoutineEditorBtn');

  // ── 바인딩 (원본 4827-4860 을 한 번만) ────────────────────────────────────

  /** 원본 applyReBoardSizeFromInput(4862-4864)의 입력 읽기. ⚠ Math.max(1,·) 클램프는 커맨드가 한다. */
  function applySizeFromInput() {
    const cols = parseInt(reColsInput.value || COLS_FALLBACK, 10);   // 4863
    const rows = parseInt(reRowsInput.value || ROWS_FALLBACK, 10);   // 4864
    render(commands.setSize({ rows, cols }));
  }

  if (reUndoBtn) reUndoBtn.onclick = () => render(commands.undo());   // 4828
  if (reRedoBtn) reRedoBtn.onclick = () => render(commands.redo());   // 4829
  // ⚠ 4830-4835 에는 confirmOnce 가 없다 — '초기화'는 한 번 누르면 바로 비운다.
  if (reClearBtn) reClearBtn.onclick = () => render(commands.clear());
  if (closeBtn) closeBtn.onclick = () => render(commands.close());     // 4836
  if (reTitle) reTitle.ondblclick = () => {                            // 4837
    const routineId = store.session.editingRoutineId;
    if (routineId) render(commands.rename(routineId));
  };

  // 4839-4850 — 버튼 클래스는 여기서 만지지 않는다. 커맨드가 store.session.quickPlaceMode.routine 을
  // 뒤집고 Dirty.routineEditor 를 돌려주면 sync() 가 클래스를 재도출한다.
  if (reQuickPlaceBtn) reQuickPlaceBtn.onclick = () => render(commands.toggleQuickPlace());

  if (reColsInput) reColsInput.onchange = applySizeFromInput;          // 4854
  if (reRowsInput) reRowsInput.onchange = applySizeFromInput;          // 4855
  if (reColsDec) reColsDec.onclick = () => {                           // 4856
    reColsInput.value = Math.max(COLS_MIN, parseInt(reColsInput.value || COLS_FALLBACK, 10) - 1);
    applySizeFromInput();
  };
  if (reColsInc) reColsInc.onclick = () => {                           // 4857
    reColsInput.value = Math.min(COLS_MAX, parseInt(reColsInput.value || COLS_FALLBACK, 10) + 1);
    applySizeFromInput();
  };
  if (reRowsDec) reRowsDec.onclick = () => {                           // 4858
    reRowsInput.value = Math.max(ROWS_MIN, parseInt(reRowsInput.value || ROWS_FALLBACK, 10) - 1);
    applySizeFromInput();
  };
  if (reRowsInc) reRowsInc.onclick = () => {                           // 4859
    reRowsInput.value = Math.min(ROWS_MAX, parseInt(reRowsInput.value || ROWS_FALLBACK, 10) + 1);
    applySizeFromInput();
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  /** 원본 syncReBoardSizeUI(2944-2950). */
  function syncBoardSizeUI() {
    const board = store.board(BOARD_ROUTINE);
    if (reColsInput) reColsInput.value = board.cols;                   // 2945
    if (reRowsInput) reRowsInput.value = board.rows;                   // 2946
    const routine = store.routines.find(r => r.id === store.session.editingRoutineId);  // 2947
    if (reTitle) reTitle.textContent = routine ? routine.name : '루틴 편집';             // 2948
    if (reSubtitle) reSubtitle.textContent = `${board.cols}박자 × ${board.rows}행`;      // 2949
  }

  /**
   * '+ 빠른 배치' 버튼. 원본은 두 자리에서 만졌다:
   *   열 때(4825-4826)  : className = 'ghost' · textContent = '+ 빠른 배치'
   *   토글(4841-4848)   : classList add/remove 로 'quick-btn-active' ↔ 'ghost'
   * 둘 다 결과 클래스는 정확히 하나이므로 store 값에서 재도출한다.
   */
  function syncQuickPlaceBtn() {
    if (!reQuickPlaceBtn) return;
    const on = !!store.session.quickPlaceMode[BOARD_ROUTINE];
    reQuickPlaceBtn.className = on ? CLS.quickBtnActive : CLS.ghost;
    reQuickPlaceBtn.textContent = '+ 빠른 배치';                        // 4826
  }

  /** Dirty.routineEditor 의 적용점. 위 ①~⑤ 를 store 에서 재도출한다. */
  function sync() {
    const editingId = store.session.editingRoutineId;

    if (!editingId) {
      // closeRoutineEditor(4879-4885)의 DOM 부
      closeQuickPicker();                                             // 4881
      if (panel) panel.style.display = 'none';                         // 4882
      document.body.style.overflow = '';                              // 4883
      // ⚠ 원본은 닫을 때 syncReBoardSizeUI 를 부르지 않는다(제목이 옛 루틴 이름 그대로 남는다).
      //   패널이 숨겨져 보이지 않고 다음에 열 때 다시 맞춰지므로 여기서도 부르지 않는다.
      return;
    }

    if (panel) panel.style.display = 'flex';                           // 4789 · 4809
    // ⚠ 오버레이 모드가 아니면 body.overflow 를 **건드리지 않는다**(원본에 else 가 없다).
    if (isRoutineOverlayMode()) document.body.style.overflow = 'hidden';  // 4790 · 4810
    syncBoardSizeUI();                                                 // 4811
    syncQuickPlaceBtn();                                               // 4825-4826
  }

  /** 원본 updateReHistoryButtons(2893-2898). ⚠ null 가드는 원문 그대로다(2896-2897). */
  function syncHistory() {
    if (reUndoBtn) reUndoBtn.disabled = !canUndo(BOARD_ROUTINE);
    if (reRedoBtn) reRedoBtn.disabled = !canRedo(BOARD_ROUTINE);
  }

  return { sync, syncHistory };
}
