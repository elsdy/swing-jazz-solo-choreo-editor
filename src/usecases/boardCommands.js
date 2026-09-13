// src/usecases/boardCommands.js — 보드 전이 + 보드 크기 + 선택 (usecases 계층)
//
// 원본 index.html 의 drop/dblclick/더블탭/마우스업/터치엔드 확정 핸들러 본문(2419-2432 · 2467-2474 ·
// 2533-2549 · 2667-2683 · 2705-2712), applyBoardSizeFromInput(2952-2962), applyReBoardSizeFromInput
// (4862-4877), finalizeResize(3828-3834), clearBoard(4481-4492), reClearBtn(4830-4835),
// 선택 토글(2453-2465), clearSelection(4531-4539), 빠른 배치 토글 2벌(1679-1694 · 4838-4849),
// defaultCount 핸들러(2371-2378)에서 **상태 전이 부분만** 옮겼다.
// DOM 조회도 렌더 호출도 한 줄 없다 — 무엇을 다시 그릴지는 Dirty 로 돌려준다.

import * as boardOps from '../domain/boardOps.js';
import { clamp, clampToGrid, totalCellsFrom } from '../domain/grid.js';
import { getGroup, groupCount } from '../domain/placements.js';
import { BOARD_MAIN, BOARD_ROUTINE, NONE, boardOf, mergeDirty } from './store.js';
import { clearLinks } from './linkCommands.js';
import { clearMedia } from './videoCommands.js';

// ─────────────────────────────────────────────────────────────────────────────
// 공통 규약
//
// 시그니처는 전부 (store, args, deps) => Dirty 다.
//   store : usecases/store.js 의 createStore(...) 결과
//   args  : { boardId, ... }  — boardId 는 'main' | 'routine'
//   deps  : 주입 포트. 필요한 커맨드만 받는다.
//             ids             : uid 생성기 ( ()=>string 또는 {uid} ) — 배치를 새로 만드는 5개 커맨드
//             unmarkDragging  : () => void — ui/overlays 의 unmarkDraggingGroups(원본 3665, moveGroupTo 전용)
//             saveLinks       : (links) => void — 원본 saveLinks(5100-5106) 전체 (clearBoard 전용)
//             closeQuickPicker: () => void — 원본 closeQuickPicker/closeReQuickPicker (빠른배치 끌 때)
//
// ⚠ **히스토리는 여기서 커밋하지 않는다.** 원본에서 saveHistory()/saveHistoryRe() 는 전이 함수 바깥
//   (drop 핸들러 2421·2428·2431, dblclick 2473, clearBoard 4491, applyBoardSizeFromInput 2961 …)에
//   있었고, 새 구조에서도 호출부가 historyCommands.commit(hist, boardId) 를 부른 뒤 두 Dirty 를
//   mergeDirty 로 합친다. 커맨드가 히스토리를 알면 usecases 끼리 얽혀 골든 재생이 어려워진다.
//
// ⚠ renderRows 3상태 그대로 옮긴다(STAGE1 계약): number[] → 그대로, 'all' → 'all',
//   **null → boards 항목 자체를 만들지 않는다(NONE)**. changedRows 는 렌더에 쓰지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

/** boardOps 결과를 store 에 적용하고 boards Dirty 로 바꾼다. renderRows===null 이면 무동작. */
function applyBoardResult(store, boardId, result) {
  if (result.renderRows === null) return null;              // 조기 반환 — 원본은 렌더도 부르지 않았다
  store.setBoard(boardId, { placements: result.placements });
  return { boards: { [boardId]: { rows: result.renderRows } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 배치 전이 6개
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팔레트 동작 하나를 놓는다. placeMove(3578-3605) 호출부 전부(drop 2420 · 그리기 확정 2677·2710 ·
 * 퀵피커 1901·1910·1933·4947·4948·4961 · 빠른 동작 생성 2238)의 상태 전이부.
 *
 * ⚠ 동작 조회는 여기가 한다(원본 3579 의 state.moveLibrary.find). 못 찾으면 null 을 그대로 넘겨
 *   boardOps.place 가 원본과 같은 무동작(renderRows:null)을 내게 한다 — 호출 자체를 건너뛰지 않는다.
 * ⚠ 라이브러리는 루틴 보드에서도 **메인의 것 하나**다(원본 reCtx 경로도 state.moveLibrary 를 본다).
 *
 * @param {object} store
 * @param {{ boardId:'main'|'routine', moveId:string, startRow:number, startIndex:number, totalCount:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
export function placeMoveAt(store, args, deps = {}) {
  const { boardId, moveId, startRow, startIndex, totalCount } = args;
  const state = store.get();
  const move = state.library.find(m => m.id === moveId) || null;   // 3579
  const result = boardOps.place(
    boardOf(state, boardId),
    { move, startRow, startIndex, totalCount },
    deps.ids
  );
  return applyBoardResult(store, boardId, result) || NONE;
}

/**
 * 동작 목록을 거치지 않고 블록 하나를 놓는다(2026-09-12, 받아 적기). 원본에 대응물이 없다.
 *
 * placeMoveAt 과 유일하게 다른 점은 **무엇을 놓을지가 id 가 아니라 값으로 들어온다**는 것이다.
 * 그래서 이름이 없어도 놓을 수 있고(`pending: true`), 그것이 "이름을 먼저 정해야 한다"는 순서를 푸는
 * 지점이다 — docs/EDITING_FLOWS.md 의 막히는 곳 ②.
 *
 * ⚠ 이름을 준 경우에도 동작 목록에 **등록하지 않는다.** 등록은 사람이 이름을 확정하는 순간의 일이고
 *   (2단계), 여기서 슬쩍 등록하면 받아 적는 동안 목록이 오타로 채워진다.
 * ⚠ 카테고리가 없거나 모르는 값이면 첫 카테고리로 떨어뜨린다 — normalizePlacements 와 같은 규칙이다.
 *
 * @param {object} store
 * @param {{ boardId?:'main'|'routine', name?:string, category?:string,
 *           startRow:number, startIndex:number, totalCount:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
export function placeBlockAt(store, args, deps = {}) {
  const { boardId = BOARD_MAIN, startRow, startIndex, totalCount } = args;
  const state = store.get();
  const name = String(args.name == null ? '' : args.name).trim();
  const category = state.categories[args.category] ? args.category : Object.keys(state.categories)[0];
  const result = boardOps.place(
    boardOf(state, boardId),
    { move: { name, category, pending: !name }, startRow, startIndex, totalCount },
    deps.ids
  );
  return applyBoardResult(store, boardId, result) || NONE;
}

/**
 * 루틴 블록 하나를 보드에 놓는다. placeRoutineOnBoard(3607-3634) — 원본 호출부는 drop 하나(2430)뿐이고
 * 거기서 `ctx === mainCtx` 를 확인한다. 그 판정은 input/boardInput 이 BOARD_POLICY.allowsRoutineBlocks
 * 로 하고, 여기서는 다시 막지 않는다(이중 판정이 되면 원본과 분기 지점이 달라진다).
 *
 * @param {{ boardId?:'main'|'routine', routineId:string, startRow:number, startIndex:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
export function placeRoutineAt(store, args, deps = {}) {
  const { boardId = BOARD_MAIN, routineId, startRow, startIndex } = args;
  const state = store.get();
  const routine = state.routines.find(r => r.id === routineId) || null;  // 3608
  const result = boardOps.placeRoutineBlock(
    boardOf(state, boardId),
    { routine, startRow, startIndex },
    deps.ids
  );
  return applyBoardResult(store, boardId, result) || NONE;
}

/**
 * 그룹을 옮긴다. movePlacementGroup(3636-3671).
 *
 * ⚠ 원본 3665 는 repack **뒤**·renderRows **앞**에 unmarkDraggingGroups(ctx) 를 부른다. DOM 조작이라
 *   도메인에서 뺐고 여기서도 직접 하지 않는다 — 주입된 deps.unmarkDragging 을 store 갱신 직후에
 *   호출해 그 순서를 정확히 재현한다(Dirty 적용은 이 함수가 반환한 뒤이므로 렌더는 그 다음이다).
 *
 * @param {{ boardId:'main'|'routine', groupId:string, targetRow:number, targetStartIndex:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string}, unmarkDragging?:()=>void }} deps
 * @returns {object} Dirty
 */
export function moveGroupTo(store, args, deps = {}) {
  const { boardId, groupId, targetRow, targetStartIndex } = args;
  const result = boardOps.moveGroup(
    boardOf(store.get(), boardId),
    { groupId, targetRow, targetStartIndex },
    deps.ids
  );
  const dirty = applyBoardResult(store, boardId, result);
  if (!dirty) return NONE;
  if (typeof deps.unmarkDragging === 'function') deps.unmarkDragging();  // 3665
  return dirty;
}

/**
 * 그룹을 복사한다. copyPlacementGroup(3673-3704).
 * ⚠ 이동과 달리 unmarkDraggingGroups 도 repack 도 없다(COPY_POLICY 의 보존 대상 결함).
 *
 * @param {{ boardId:'main'|'routine', groupId:string, targetRow:number, targetStartIndex:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
export function copyGroupTo(store, args, deps = {}) {
  const { boardId, groupId, targetRow, targetStartIndex } = args;
  const result = boardOps.copyGroup(
    boardOf(store.get(), boardId),
    { groupId, targetRow, targetStartIndex },
    deps.ids
  );
  return applyBoardResult(store, boardId, result) || NONE;
}

/**
 * 리사이즈를 확정한다. finalizeResize(3828-3834) + rebuildGroup(3706-3726).
 *
 * ⚠ 카운트 결정(제스처 → 숫자)은 domain/gestureMath.resolveResizeCount 가 하고 input 이 부른다.
 *   여기서는 원본 3832 와 같은 **호출부 클램프**만 한다 — boardOps.resizeGroup 은 RESIZE_POLICY.clamp
 *   가 false 라 스스로 자르지 않는다.
 * ⚠ 원본 3832 의 `r.previewCount || r.originalCount` 폴백을 newCount 가 falsy 일 때로 재현한다.
 *   originalCount 는 startResize(3736)가 잰 groupCount 와 같다(리사이즈는 그룹을 옮기지 않는다).
 * ⚠ 클램프 기준점 (originRow, originStartIndex) 는 startResize(3735)가 getGroup(groupId)[0] 에서
 *   가져온 값이므로 지금 그룹의 첫 세그먼트와 같다.
 *
 * @param {{ boardId:'main'|'routine', groupId:string, newCount:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
export function resizeGroupTo(store, args, deps = {}) {
  const { boardId, groupId, newCount } = args;
  const board = boardOf(store.get(), boardId);
  const first = getGroup(board.placements, groupId)[0];
  if (!first) return NONE;                                              // rebuildGroup 3708
  const maxTotal = totalCellsFrom(first.row, first.startIndex, board);  // 3831
  const raw = newCount || groupCount(board.placements, groupId);        // 3832 의 `||` 폴백
  const finalCount = clamp(raw, 1, maxTotal);                           // 3832
  const result = boardOps.resizeGroup(board, { groupId, newCount: finalCount }, deps.ids);
  return applyBoardResult(store, boardId, result) || NONE;
}

/**
 * 그룹을 삭제한다. removePlacementGroup(3567-3576).
 *
 * ⚠ 원본 3570-3572 는 메인 보드일 때 selectedGroupIds 에서도 지우고
 *   updateCreateRoutineFromSelectionBtn() 을 부른다. 이것을 빠뜨리면
 *   '배치 2개 선택 → 하나 삭제 → 툴바가 계속 「루틴으로 편성 (2)」' 회귀가 난다.
 *   → 선택 정리는 이 커맨드가 하고 Dirty 에 { selection, toolbar } 를 함께 싣는다.
 * ⚠ 그룹이 없어도 renderRows 는 [] 이지 null 이 아니다(골든 remove-03) — NONE 으로 뭉개지 않는다.
 * ⚠ 툴바 갱신은 **조건 없이** 실린다(원본도 그룹이 선택돼 있었는지 보지 않는다).
 *
 * @param {{ boardId:'main'|'routine', groupId:string }} args
 * @returns {object} Dirty
 */
export function removeGroup(store, args) {
  const { boardId, groupId } = args;
  const result = boardOps.removeGroup(boardOf(store.get(), boardId), { groupId });
  const dirty = applyBoardResult(store, boardId, result);
  if (!dirty) return NONE;
  if (!store.policy(boardId).allowsSelection) return dirty;             // ctx !== mainCtx (3570)
  const next = new Set(store.get().selection);
  for (const removed of result.selectionRemoved) next.delete(removed);  // 3571
  store.update({ selection: next });
  return { ...dirty, selection: true, toolbar: true };                  // 3572
}

// ─────────────────────────────────────────────────────────────────────────────
// 보드 크기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 보드별 크기 변경 후의 UI 동기화 — 두 원본 함수의 **비대칭을 그대로** 표로 만든 것.
 *   메인 syncBoardSizeUI(2940-2943) : boardColsInput.value + boardTitle + updateMobileCellSize()
 *   루틴 syncReBoardSizeUI(2944-2950): reColsInput/reRowsInput/reTitle/reSubtitle 뿐
 * ⚠ 루틴에 layout 을 켜지 않는 것이 원본이다. updateMobileCellSize 는 state.cols(메인)만 읽으므로
 *   루틴 크기 변경으로 부를 이유가 없고, 원본도 부르지 않는다.
 */
const BOARD_SIZE_DIRTY = Object.freeze({
  [BOARD_MAIN]: Object.freeze({ layout: true, toolbar: true }),
  [BOARD_ROUTINE]: Object.freeze({ routineEditor: true })
});

/**
 * 보드 크기를 바꾸고 격자 밖 배치를 정리한다.
 *   메인 applyBoardSizeFromInput(2952-2962) — rows 만 바뀐다(입력 id 는 boardColsInput 이지만 값은 행 수다)
 *   루틴 applyReBoardSizeFromInput(4862-4877) — rows·cols 둘 다
 *
 * ⚠⚠ 행 초과 배치의 처분이 **정반대**다. BOARD_POLICY.overflowRows 가 그 표다.
 *     메인 'drop' : `p.row <= rows && p.startIndex < cols` 로 **삭제**한다(2956).
 *     루틴 'keep' : 열 초과만 자르고 행 초과는 **남긴다**(행을 늘리면 복원된다, 4869-4874).
 * ⚠ layout 을 boards 보다 먼저 적용해야 한다(CSS 변수 → 골격 순서). presenter 가 그 순서를 지킨다.
 * ⚠ 루틴 쪽은 호출부가 뒤이어 routineCommands.syncFromEditor(4875)와 히스토리 커밋(4876)을 불러야
 *   원본과 같다.
 *
 * @param {{ boardId:'main'|'routine', rows?:number, cols?:number }} args  없는 값은 그대로 둔다
 * @returns {object} Dirty
 */
export function setBoardRows(store, args) {
  const { boardId, rows, cols } = args;
  const board = boardOf(store.get(), boardId);
  const nextRows = rows === undefined ? board.rows : Math.max(1, rows);  // 2953 / 4863-4864
  const nextCols = cols === undefined ? board.cols : Math.max(1, cols);
  const nextBoard = { rows: nextRows, cols: nextCols };
  const placements = clampToGrid(
    board.placements,
    nextBoard,
    { overflowRows: store.policy(boardId).overflowRows }                 // 2956 / 4871
  );
  store.setBoard(boardId, { ...nextBoard, placements });
  return {
    ...BOARD_SIZE_DIRTY[boardId],
    boards: { [boardId]: { skeleton: true, rows: 'all' } }               // renderBoard(true) 2960 / 4876
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 보드 비우기 — 메인과 루틴은 **별개 커맨드**다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 메인 보드를 비운다. clearBoard(4481-4492).
 *
 * ⚠ 메인만 링크 4필드를 함께 지우고 saveLinks() 를 부른다(PR#17). 링크는 undo 스냅샷 밖이므로
 *   되돌리면 배치는 살아나도 링크는 살아나지 않는다 — 보존 대상 결함(00-DELTA #6)이다.
 * ⚠ 링크 초기화는 **여기서 다시 구현하지 않고** linkCommands.clearLinks 에 위임한다
 *   (linkCommands 파일 주석이 못박은 소유권). 두 벌로 두면 원본 renderLinksBar(4488)가 지우던
 *   제목 조회 스피너(session.youtubeTitleFetch)가 여기 경로에서만 남는다 —
 *   '전체 초기화' 뒤에도 '제목 불러오는 중…' 이 붙어 있는 회귀가 그것이다.
 * ⚠ 2026-09 영상 블록도 같은 이유로 videoCommands.clearMedia 에 위임한다. 링크바의 주소를
 *   비우면서 `media.source` 를 남기면 **같은 사실이 두 곳에서 갈라진다** — 링크바는 비었는데
 *   패널은 옛 영상을 계속 싣고, 다음 저장이 사용자가 지운 주소를 파일에 다시 쓴다.
 *   영상을 한 번도 안 쓴 사용자에게는 clearMedia 가 NONE 이라 Dirty 가 예전과 똑같다.
 * ⚠ 저장 포트의 모양도 한 벌로 맞춘다: 오늘 프로젝트/링크 경로가 모두
 *   `storage.saveLinks(serializeLinks(links))` 로 부르므로 여기도 같은 자리를 쓴다.
 *   예전 시그니처(deps.saveLinks)도 계속 받아 app/main 배선이 어느 쪽이든 동작한다.
 * ⚠ renderRows 에 넘기는 행 목록은 **중복을 제거하지 않은** placements.map(p => p.row) 그대로다(4482).
 * ⚠ selectedGroupIds 는 건드리지 않는다 — 원본도 그렇다(아래 deviations 기록 참조).
 * ⚠ saveHistory(4491)는 여기서 부르지 않는다 — 이 파일의 공통 규약대로 호출부가
 *   historyCommands.commit(hist, 'main') 을 부른 뒤 두 Dirty 를 mergeDirty 로 합친다.
 *
 * @param {{ saveLinks?:(links:object)=>void, storage?:{saveLinks?:(links:object)=>void} }} deps
 *   원본 saveLinks(5100-5106) 전체에 해당
 * @returns {object} Dirty
 */
export function clearBoard(store, deps = {}) {
  const board = boardOf(store.get(), BOARD_MAIN);
  const rows = board.placements.map(p => p.row);            // 4482 ⚠ Set 없음
  store.setBoard(BOARD_MAIN, { placements: [] });           // 4483
  const saveLinks = deps.storage?.saveLinks ?? deps.saveLinks;
  const linksDirty = clearLinks({ store, storage: { saveLinks } });  // 4484-4489
  return mergeDirty(
    mergeDirty(
      { boards: { [BOARD_MAIN]: { rows } } },               // 4490
      linksDirty                                            // 4488 renderLinksBar()
    ),
    clearMedia(store)                                       // 2026-09 — 링크를 비우면 영상도 비운다
  );
}

/**
 * 루틴 편집 보드를 비운다. reClearBtn 인라인 핸들러(4830-4835).
 * ⚠ 링크를 건드리지 않는다 — clearBoard 와의 차이가 이것뿐이라 한 함수로 합치면 동작이 바뀐다.
 * ⚠ 호출부가 뒤이어 히스토리 커밋(4834)을 불러야 하고, 그 커밋이 syncFromEditor 를 동반한다.
 * @returns {object} Dirty
 */
export function clearRoutineBoard(store) {
  const board = boardOf(store.get(), BOARD_ROUTINE);
  const rows = board.placements.map(p => p.row);            // 4831 ⚠ Set 없음
  store.setBoard(BOARD_ROUTINE, { placements: [] });        // 4832
  return { boards: { [BOARD_ROUTINE]: { rows } } };         // 4833
}

// ─────────────────────────────────────────────────────────────────────────────
// 선택 — selectionCommands.js 라는 파일을 따로 만들지 않는다.
// removeGroup 이 선택 집합을 정리해야 하므로(3570) 소유자가 여기여야 한다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배치 클릭 선택 토글. 보드 click 핸들러(2453-2465)의 도메인 부분.
 * ⚠ 루틴 배치는 여기 오지 않는다(2447-2452 가 팝업으로 가로챈다) — 그 판정은 input 의 몫이다.
 * ⚠ 선택 표시는 행 재렌더가 아니라 클래스 토글이다 → Dirty 는 boards 가 아니라 selection 이다
 *   (다시 그리면 드래그·툴팁·포커스 동작이 바뀐다).
 * @param {{ boardId:'main'|'routine', groupId:string }} args
 * @returns {object} Dirty
 */
export function toggleSelection(store, args) {
  const { boardId, groupId } = args;
  if (!store.policy(boardId).allowsSelection) return NONE;   // 2446 `if (ctx !== mainCtx) return;`
  const next = new Set(store.get().selection);
  if (next.has(groupId)) next.delete(groupId); else next.add(groupId);  // 2457-2461
  store.update({ selection: next });
  return { selection: true, toolbar: true };                 // 2463-2465
}

/**
 * 선택을 모두 해제한다. clearSelection(4534-4539).
 * ⚠ 비어 있으면 아무 일도 하지 않는다 — 원본의 조기 반환(4535)이라 Dirty 도 NONE 이다.
 * @returns {object} Dirty
 */
export function clearSelection(store) {
  if (!store.get().selection.size) return NONE;              // 4535
  store.update({ selection: new Set() });                    // 4537
  return { selection: true, toolbar: true };                 // 4538-4539
}

// ─────────────────────────────────────────────────────────────────────────────
// 세션 토글
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 빠른 배치 모드 토글. 메인 quickPlaceBtn(1679-1694) / 루틴 reQuickPlaceBtn(4838-4849).
 *
 * ⚠ 두 벌의 차이는 **정확히 두 가지**다.
 *   1) 켤 때 메인만 renderPalette() 를 부른다(1687). 루틴판에는 없다 — renderPalette(3066)가 읽는
 *      activePaletteMove 는 메인 것 하나뿐이라 루틴 쪽을 비워도 팔레트 표시가 달라지지 않는다.
 *   2) 버튼이 둘이라 갱신 대상이 다르다(toolbar ↔ routineEditor).
 * ⚠ 끌 때의 퀵피커 닫기는 DOM 이라 주입받는다(closeQuickPicker / closeReQuickPicker).
 * ⚠ 모드는 보드마다 독립이다 — 하나로 합치면 메인에서 켠 채 루틴 편집기를 열었을 때
 *   루틴 보드가 빈 칸 클릭에 반응한다.
 *
 * @param {{ boardId:'main'|'routine' }} args
 * @param {{ closeQuickPicker?:()=>void }} deps
 * @returns {object} Dirty
 */
export function toggleQuickPlaceMode(store, args, deps = {}) {
  const { boardId } = args;
  const session = store.get().session;
  const on = !session.quickPlaceMode[boardId];               // 1681 / 4839
  store.patch('session', {
    quickPlaceMode: { ...session.quickPlaceMode, [boardId]: on },
    // 켤 때만 그 보드의 활성 팔레트 동작을 해제한다(1686 / 4843)
    activePaletteMove: on
      ? { ...session.activePaletteMove, [boardId]: null }
      : session.activePaletteMove
  });
  if (!on && typeof deps.closeQuickPicker === 'function') deps.closeQuickPicker();  // 1692 / 4847
  const dirty = boardId === BOARD_MAIN ? { toolbar: true } : { routineEditor: true };
  if (on && boardId === BOARD_MAIN) dirty.palette = true;   // 1687 renderPalette() — 메인 전용
  return dirty;
}

/**
 * 기본 카운트를 바꾼다. defaultCountInput change(2371-2375)와 ∓ 버튼(2376-2377).
 *
 * ⚠ 원본의 판정은 `if (v >= 1)` 하나다. NaN 은 false 로 떨어져 값이 바뀌지 않고, 입력칸만
 *   현재 값으로 되돌아간다(2374). Dirty 를 항상 { toolbar:true } 로 두면 세 진입점이 모두 재현된다
 *   — 유효할 때는 입력칸이 이미 같은 값이라 화면이 그대로이고, 무효할 때는 되돌아간다.
 * ⚠ 상한(64)은 ∓ 버튼 핸들러의 것이라 input 계층에 남는다. change 경로에는 상한이 없다(원본 그대로).
 *
 * @param {{ value:number }} args
 * @returns {object} Dirty
 */
export function setDefaultCount(store, args) {
  const { value } = args;
  if (value >= 1) store.patch('session', { defaultCount: value });  // 2373
  return { toolbar: true };                                         // 2374 의 되돌리기 포함
}
