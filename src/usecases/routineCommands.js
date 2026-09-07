// src/usecases/routineCommands.js — 루틴 커맨드 + 편집기 세션 (usecases 계층)
//
// 원본 index.html 의 createRoutine(4504-4517) · createRoutineFromSelection(4541-4615) ·
// deleteRoutine(4617-4627) · toggleRoutineFavorite(4629-4637) · syncCurrentRoutine(4643-4673) ·
// renameRoutine(4675-4689) · openRoutineEditor(4783-4860)의 상태부 · applyReBoardSizeFromInput(4862-4877) ·
// closeRoutineEditor(4879-4886)에서 **상태 전이 부분만** 옮겼다.
// 패널 표시/숨김·body 스크롤 잠금·입력창 값·퀵피커 정리는 ui/routineEditorView 의 몫이다(Dirty.routineEditor).

import {
  NONE, mergeDirty, boardOf, BOARD_MAIN, BOARD_ROUTINE
} from './store.js';
import {
  ROUTINE_COLORS, nextColor, defaultRoutineName, newRoutine,
  buildFromSelection, redistributeBlocks,
  renameRoutine as renameRoutineDomain, removeRoutine
} from '../domain/routines.js';
import { clampToGrid } from '../domain/grid.js';
import { cloneJsonValue } from '../domain/project/snapshot.js';

/**
 * 이 파일의 커맨드가 받는 협력자. 전부 주입이다 — 브라우저 전역을 직접 만지지 않는다.
 * @typedef {Object} RoutineDeps
 * @property {ReturnType<import('./store.js').createStore>} store
 * @property {{ uid: () => string }} env                       uid 생성기(원본 uid 1696)
 * @property {{ promptText: (msg: string, def?: string) => string|null, alert: (msg: string) => void }} dialogs
 * @property {{ saveRoutineFavorites: (ids: Iterable<string>) => unknown }} storage
 *   ⚠ deleteRoutine 은 이걸 **부르지 않는다**(원본 4624 가 저장하지 않는 결함을 그대로 보존).
 * @property {(boardId: 'main'|'routine') => import('./store.js').Dirty|void} [commitHistory]
 *   원본 saveHistory(2863) / saveHistoryRe(2904). ⚠ 'routine' 쪽 배선은 **반드시 마지막에**
 *   syncFromEditor 를 부른 Dirty 를 합쳐 돌려줘야 한다(원본 2912). 아래 setRoutineSize 주석 참조.
 * @property {(boardId: 'main'|'routine') => import('./store.js').Dirty|void} [resetHistory]
 *   원본 4804-4805·4817(편집기를 열 때 히스토리를 최초 스냅샷 하나로 초기화).
 */

/** 원본 saveHistory()/updateHistoryButtons() 한 쌍. 주입이 없으면 버튼 갱신만 표시한다. */
function commitBoardHistory(deps, boardId) {
  const extra = typeof deps.commitHistory === 'function' ? deps.commitHistory(boardId) : null;
  return mergeDirty({ history: true }, extra);
}

/**
 * 다음 루틴 색을 뽑고 세션 카운터를 앞으로 민다(원본 nextRoutineColor 4498-4502).
 * ⚠ 카운터는 저장되지 않는다 — 새로고침하면 다시 0부터다(보존 대상 결함).
 */
function takeRoutineColor(store) {
  const [color, nextIdx] = nextColor(ROUTINE_COLORS, store.get().session.routineColorIdx);
  store.patch('session', { routineColorIdx: nextIdx });
  return color;
}

/**
 * 빈 루틴을 만들고 곧바로 편집기를 연다(createRoutine 4504-4517).
 * ⚠ 원본은 객체 리터럴 안에서 `id: uid()` → `color: nextRoutineColor()` 순으로 평가하지만
 *   nextRoutineColor 는 uid 를 쓰지 않으므로 여기서 색을 먼저 뽑아도 id 소비 순서가 같다.
 * @see index.html:4504
 * @param {RoutineDeps} deps
 * @returns {import('./store.js').Dirty}
 */
export function createRoutine(deps) {
  const { store, env } = deps;
  const name = defaultRoutineName(store.get().routines.length);   // 4505
  const color = takeRoutineColor(store);                          // 4511
  const routine = newRoutine({ name, rows: 4, cols: 8, placements: [], color }, env); // 4506-4512
  store.update(s => ({ routines: [...s.routines, routine] }));     // 4513

  let dirty = { routineList: true };                              // 4514
  dirty = mergeDirty(dirty, commitBoardHistory(deps, BOARD_MAIN)); // 4515
  return mergeDirty(dirty, openEditor(deps, routine.id));          // 4516
}

/**
 * 안무표에서 선택한 그룹들을 루틴으로 편성한다(createRoutineFromSelection 4541-4615).
 *
 * ⚠ 색 소비 시점: 원본은 편성할 그룹이 하나도 없으면 4561 에서 되돌아가 nextRoutineColor(4605)에
 *   **닿지 않는다**. 그래서 여기서도 buildFromSelection 이 null 이 아닐 때만 색을 뽑는다 —
 *   먼저 뽑으면 실패한 편성이 색 순서를 한 칸 밀어 다음 루틴 색이 달라진다.
 *   색은 routine 객체의 마지막 키라 나중에 덮어써도 키 순서와 JSON 바이트가 같다.
 * @see index.html:4541
 * @param {RoutineDeps} deps
 * @returns {import('./store.js').Dirty}
 */
export function createFromSelection(deps) {
  const { store, env } = deps;
  const state = store.get();
  if (!state.selection.size) return NONE;                         // 4542
  const main = boardOf(state, BOARD_MAIN);

  const built = buildFromSelection({
    selectedGroupIds: state.selection,
    placements: main.placements,
    cols: main.cols,                                              // 4565 안무표와 동일한 열 수
    name: defaultRoutineName(state.routines.length),              // 4599
    color: null
  }, env);
  if (!built) return NONE;                                        // 4561

  const routine = { ...built.routine, color: takeRoutineColor(store) }; // 4605
  store.update(s => ({
    routines: [...s.routines, routine],                           // 4607
    selection: new Set()                                          // 4610 clearSelection
  }));

  // clearSelection(4531-4539) = 선택 집합 비우기 + .is-selected 제거 + 툴바 버튼 갱신
  let dirty = { selection: true, toolbar: true, routineList: true }; // 4610·4612
  dirty = mergeDirty(dirty, commitBoardHistory(deps, BOARD_MAIN));   // 4613
  return mergeDirty(dirty, openEditor(deps, routine.id));            // 4614
}

/**
 * 루틴 이름 변경(renameRoutine 4675-4689). prompt 취소·빈 이름은 조용히 무동작(원본 4679-4681).
 * ⚠ 편집 중인 루틴일 때만 편집기 제목/부제를 다시 그린다(4686 syncReBoardSizeUI).
 * ⚠ renderRows 는 **언제나** 불린다(4687) — 그 루틴의 배치가 하나도 없으면 빈 배열로 불린다.
 *   그래서 boards 항목을 만들지 않고 넘기면 안 된다(rows: [] 가 정답).
 * @see index.html:4675
 * @param {RoutineDeps} deps
 * @param {string} routineId
 * @returns {import('./store.js').Dirty}
 */
export function renameRoutine(deps, routineId) {
  const { store, dialogs } = deps;
  const state = store.get();
  const routine = state.routines.find(r => r.id === routineId);
  if (!routine) return NONE;                                      // 4677
  const next = dialogs.promptText('루틴 이름', routine.name);      // 4678
  if (next == null) return NONE;                                  // 4679

  const main = boardOf(state, BOARD_MAIN);
  const res = renameRoutineDomain(state.routines, main.placements, routineId, next);
  if (!res.ok) return NONE;                                       // 4681 빈 이름
  store.update({ routines: res.routines });                       // 4682
  store.setBoard(BOARD_MAIN, { placements: res.placements });     // 4684

  let dirty = { routineList: true };                              // 4685
  if (store.get().session.editingRoutineId === routineId) {
    dirty = mergeDirty(dirty, { routineEditor: true });            // 4686
  }
  dirty = mergeDirty(dirty, { boards: { [BOARD_MAIN]: { rows: res.affectedRows } } }); // 4687
  return mergeDirty(dirty, commitBoardHistory(deps, BOARD_MAIN));  // 4688
}

/**
 * 루틴 삭제(deleteRoutine 4617-4627).
 *
 * ⚠ 보존해야 하는 결함: `favoriteRoutineIds.delete(routineId)`(4624) 뒤에 saveRoutineFavorites() 가
 *   **없다**. 그래서 삭제한 루틴의 id 가 localStorage 의 choreo_fav_routines 에 남고, 같은 id 의
 *   루틴을 부분 채우기로 다시 들여오면 즐겨찾기가 되살아난다. 고치지 말 것.
 * ⚠ 편집 중이면 closeEditor 를 **먼저** 부른다(4618) — 그 안의 syncFromEditor 가 메인 보드 배치를
 *   먼저 갱신하고, 그 갱신된 배치에서 루틴 블록이 지워진다. 순서를 바꾸면 지워지는 행이 달라진다.
 * @see index.html:4617
 * @param {RoutineDeps} deps
 * @param {string} routineId
 * @returns {import('./store.js').Dirty}
 */
export function deleteRoutine(deps, routineId) {
  const { store } = deps;
  let dirty = NONE;
  if (store.get().session.editingRoutineId === routineId) {
    dirty = mergeDirty(dirty, closeEditor(deps));                 // 4618
  }

  const state = store.get();
  const main = boardOf(state, BOARD_MAIN);
  const res = removeRoutine(state.routines, main.placements, routineId); // 4620-4623
  store.setBoard(BOARD_MAIN, { placements: res.placements });
  store.update({ routines: res.routines });
  if (res.affectedRows.length) {
    dirty = mergeDirty(dirty, { boards: { [BOARD_MAIN]: { rows: res.affectedRows } } }); // 4622
  }

  const routineIds = new Set(state.favorites.routineIds);
  routineIds.delete(routineId);                                   // 4624 (저장 호출 없음 — 위 ⚠ 참조)
  store.patch('favorites', { routineIds });

  dirty = mergeDirty(dirty, { routineList: true });                // 4625
  return mergeDirty(dirty, commitBoardHistory(deps, BOARD_MAIN));  // 4626
}

/**
 * 루틴 즐겨찾기 토글(toggleRoutineFavorite 4629-4637). 여기서는 저장한다(4635).
 * ⚠ 히스토리에 남기지 않는다 — 즐겨찾기는 undo 스냅샷 밖이다.
 * @see index.html:4629
 * @param {RoutineDeps} deps
 * @param {string} routineId
 * @returns {import('./store.js').Dirty}
 */
export function toggleFavorite(deps, routineId) {
  const { store, storage } = deps;
  const routineIds = new Set(store.get().favorites.routineIds);
  if (routineIds.has(routineId)) routineIds.delete(routineId);     // 4631
  else routineIds.add(routineId);                                  // 4633
  store.patch('favorites', { routineIds });
  storage.saveRoutineFavorites([...routineIds]);                   // 4635 saveRoutineFavorites
  return { routineList: true };                                    // 4636
}

/**
 * 루틴 편집기를 연다(openRoutineEditor 4783-4860)의 **상태부**.
 *
 * ⚠ 같은 루틴이 이미 열려 있으면 상태를 초기화하지 않고 패널만 다시 보인다(4788-4792).
 *   초기화까지 하면 편집 중이던 내용과 편집기 undo 스택이 날아간다.
 * ⚠ rowRefs.clear()(4799)·boardSig=''(4802)·reQuickPickerEl=null(4806)은 ui/boardView·ui/quickPicker,
 *   drag/resize=null(4800)은 input/dragSession·pointerSession 의 몫이라 여기 없다.
 * ⚠ reState.activePaletteMove=null(4801)은 session.activePaletteMove.routine 로 옮겼다 —
 *   이 자리 말고는 아무 데서도 값이 들어가지 않는다(보존 대상 결함: 루틴 보드 draw-to-place 는 죽은 코드).
 * @see index.html:4783
 * @param {RoutineDeps} deps
 * @param {string} routineId
 * @returns {import('./store.js').Dirty}
 */
export function openEditor(deps, routineId) {
  const { store } = deps;
  const state = store.get();
  const routine = state.routines.find(r => r.id === routineId);
  if (!routine) return NONE;                                       // 4785

  // 이미 같은 루틴이 열려 있으면 포커스만(패널 표시 + 오버레이 모드 스크롤 잠금)
  if (state.session.editingRoutineId === routineId) {
    return { routineEditor: true };                                // 4789-4791
  }

  store.setBoard(BOARD_ROUTINE, {
    rows: routine.rows,                                            // 4796
    cols: routine.cols,                                            // 4797
    placements: cloneJsonValue(routine.placements)                 // 4798 깊은 복제
  });
  store.patch('session', {
    editingRoutineId: routineId,                                   // 4795
    activePaletteMove: { ...state.session.activePaletteMove, [BOARD_ROUTINE]: null },  // 4801
    quickPlaceMode: { ...state.session.quickPlaceMode, [BOARD_ROUTINE]: false }        // 4803
  });

  // syncReBoardSizeUI(4811) + 패널 표시 + 퀵 배치 버튼 초기화(4825-4826) = routineEditor
  let dirty = {
    routineEditor: true,
    boards: { [BOARD_ROUTINE]: { rows: 'all', skeleton: true } },   // 4814 renderBoard(true, reCtx)
    routineList: true                                              // 4821
  };
  // 4804-4805·4817-4818: 편집기 히스토리를 최초 스냅샷 하나로 초기화
  const reset = typeof deps.resetHistory === 'function' ? deps.resetHistory(BOARD_ROUTINE) : null;
  return mergeDirty(dirty, mergeDirty({ history: true }, reset));
}

/**
 * 루틴 편집기를 닫는다(closeRoutineEditor 4879-4886)의 상태부.
 * ⚠ syncFromEditor 가 **먼저**다(4880) — editingRoutineId 를 비운 뒤에 부르면 아무것도 반영되지 않는다.
 * @see index.html:4879
 * @param {RoutineDeps} deps
 * @returns {import('./store.js').Dirty}
 */
export function closeEditor(deps) {
  const dirty = syncFromEditor(deps);                              // 4880
  deps.store.patch('session', { editingRoutineId: null });         // 4884
  // closeReQuickPicker(4881) · 패널 숨김(4882) · body.overflow 복구(4883) = routineEditor
  return mergeDirty(dirty, { routineEditor: true, routineList: true }); // 4885
}

/**
 * 편집기의 보드 내용을 루틴에 커밋하고, 메인 보드의 루틴 블록을 새 카운트로 재분산한다
 * (syncCurrentRoutine 4643-4673).
 *
 * ⚠ 호출부가 **5곳**이다. 훅 하나로 만들면 편집기 Undo/Redo 가 메인 보드에 반영되지 않는다:
 *     saveHistoryRe(2912) · undoRe(2923) · redoRe(2935) · applyReBoardSizeFromInput(4875) · closeRoutineEditor(4880)
 *   이 중 앞의 셋은 usecases/historyCommands 가, 뒤의 둘은 이 파일이 부른다. 그래서 이 커맨드는
 *   인자가 없고 어디서 불려도 같게 동작한다(현재 편집 중인 루틴을 store 에서 스스로 찾는다).
 * ⚠ 4875 와 2912 때문에 보드 크기를 바꾸면 이 커맨드가 **두 번** 불린다. uid 를 두 번 소비하는
 *   원본 그대로이므로 한 번으로 줄이지 말 것 — 배치 id 가 달라진다.
 * ⚠ 반환 Dirty 에 boards.routine 은 없다. 원본은 여기서 루틴 보드를 다시 그리지 않는다
 *   (편집기 보드 렌더는 부르는 쪽인 undoRe/redoRe/applyReBoardSizeFromInput 이 이미 했다).
 * ⚠ 재분산이 없으면(그 루틴을 참조하는 메인 배치가 0개) renderRows 자체가 불리지 않는다(4653) —
 *   boards 항목을 만들지 않는다.
 * ⚠ redistributeBlocks 가 만드는 배치에는 subRow 키가 없다(보존 대상 결함 #1). 여기서 채우지 말 것.
 * @see index.html:4643
 * @param {RoutineDeps} deps
 * @returns {import('./store.js').Dirty}
 */
export function syncFromEditor(deps) {
  const { store, env } = deps;
  const state = store.get();
  const routineId = state.session.editingRoutineId;
  if (!routineId) return NONE;                                     // 4644
  const routine = state.routines.find(r => r.id === routineId);
  if (!routine) return NONE;                                       // 4646

  const editor = boardOf(state, BOARD_ROUTINE);
  // 스프레드가 먼저라 키 순서는 id,name,rows,cols,placements,isFavorite,color 그대로다
  const nextRoutine = {
    ...routine,
    rows: editor.rows,                                             // 4647
    cols: editor.cols,                                             // 4648
    placements: cloneJsonValue(editor.placements)                  // 4649 깊은 복제
  };
  store.update({ routines: state.routines.map(r => (r.id === routineId ? nextRoutine : r)) });

  const dirty = { routineList: true };                             // 4650
  const main = boardOf(store.get(), BOARD_MAIN);
  const res = redistributeBlocks(main.placements, nextRoutine, main, env); // 4652-4671
  if (!res.changed) return dirty;                                  // 4653
  store.setBoard(BOARD_MAIN, { placements: res.placements });
  return mergeDirty(dirty, { boards: { [BOARD_MAIN]: { rows: res.affectedRows } } }); // 4672
}

/**
 * 루틴 편집기 보드 크기 변경(applyReBoardSizeFromInput 4862-4877).
 *
 * ⚠ 행 초과 배치는 **숨길 뿐 지우지 않는다**(4867-4872) — 행을 다시 늘리면 되살아난다.
 *   메인 보드(applyBoardSizeFromInput 2955)와 정반대 규칙이라 overflowRows:'keep' 로 못박는다.
 * ⚠ 마지막 두 줄의 순서가 관찰 동작이다: syncFromEditor(4875) → commitHistory('routine')(4876).
 *   그리고 원본 saveHistoryRe(2912)가 그 안에서 syncCurrentRoutine 을 **한 번 더** 부른다.
 *   commitHistory('routine') 배선이 syncFromEditor 를 부르지 않으면 편집기 Undo/Redo 가 메인 보드에
 *   반영되지 않고, 부르면 여기서 두 번 불리는 원본 동작이 그대로 재현된다.
 * @see index.html:4862
 * @param {RoutineDeps} deps
 * @param {{ rows: number, cols: number }} size  입력창에서 parseInt 한 날값(클램프는 여기서 한다)
 * @returns {import('./store.js').Dirty}
 */
export function setRoutineSize(deps, size) {
  const { store } = deps;
  const cols = Math.max(1, size.cols);                             // 4863
  const rows = Math.max(1, size.rows);                             // 4864
  const board = store.board(BOARD_ROUTINE);
  const placements = clampToGrid(board.placements, { rows, cols }, { overflowRows: 'keep' }); // 4869-4872
  store.setBoard(BOARD_ROUTINE, { rows, cols, placements });       // 4865-4866

  // syncReBoardSizeUI(4873) = routineEditor / renderBoard(true, reCtx)(4874) = 루틴 보드 골격+전 행
  let dirty = {
    routineEditor: true,
    boards: { [BOARD_ROUTINE]: { rows: 'all', skeleton: true } }
  };
  dirty = mergeDirty(dirty, syncFromEditor(deps));                 // 4875
  return mergeDirty(dirty, commitBoardHistory(deps, BOARD_ROUTINE)); // 4876
}
