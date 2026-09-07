// src/app/main.js — 진입점 + 조립 루트 (app 계층)
//
// index.html 의 <script type="module"> 가 가리키는 유일한 파일이다.
// 원본 init(1521-1690) 한 줄 한 줄에 대응하며, ui ↔ input 교차(설계서 §0)를 **주입으로 잇는
// 앱에서 유일한 자리**다. 여기 말고 어디에서도 ui 와 input 이 서로를 보지 않는다.
//
// ⚠ 지켜야 하는 순서 5가지 (틀리면 조용히 동작이 달라진다)
//  ① createStore({ ids: browserEnv }) 가 **가장 먼저**다. 원본은 DEFAULT_MOVES(1444)를 모듈 로드
//     시점에 만들며 uid 를 10번 먼저 소비한다 — id 소비 순서가 골든 결정성의 전제다.
//  ② dragSession·pointerSession·overlays 싱글턴은 **앱 전체에 하나씩**이다.
//     dragSession 을 두 개 만들면 팔레트 드래그가 루틴 보드에 안 떨어진다(원본 3084-3085 가
//     state.drag 와 reState.drag 에 **같은 객체**를 대입한다).
//  ③ touchDrag 를 boardController **보다 먼저** 만들어 넘긴다.
//  ④ 루틴 보드의 히스토리 커밋은 반드시 commit('routine') + routineCommands.syncFromEditor 다
//     (원본 saveHistoryRe 2912). 빠뜨리면 편집기 undo/redo 가 메인 보드에 반영되지 않는다.
//  ⑤ 루틴 보드의 boardController 는 **init 이 끝난 뒤** 만든다 — 원본 initRoutineEditorEvents
//     IIFE(4889)가 init() 이후에 평가되어 document mouseup 이 메인 것보다 나중에 붙는다.
//
// ⚠ bindHotkeys 를 따로 부르지 마라 — bindControls 가 부른다(두 번 부르면 undo 가 두 번 돈다).

import { createRenderer } from './render.js';

import { createStore, mergeDirty, NONE, BOARD_MAIN, BOARD_ROUTINE } from '../usecases/store.js';
import * as History from '../usecases/historyCommands.js';
import * as BoardCmd from '../usecases/boardCommands.js';
import * as PaletteCmd from '../usecases/paletteCommands.js';
import * as CategoryCmd from '../usecases/categoryCommands.js';
import * as RoutineCmd from '../usecases/routineCommands.js';
import * as ProjectCmd from '../usecases/projectCommands.js';
import * as LinkCmd from '../usecases/linkCommands.js';

import * as Grid from '../domain/grid.js';
import { normalizeLinks } from '../domain/links.js';

import { STORAGE_KEYS } from '../ports/storage.js';
import { browserEnv, browserDialogs, browserFileIO, debounce, longPress } from '../adapters/browser.js';
import {
  createRecentList, createFavoritesRepo, loadLocalMeta, loadLinksRaw, saveLinksRaw
} from '../adapters/localStore.js';
import { fetchTitle } from '../adapters/youtubeOembed.js';

import { createBoardView } from '../ui/boardView.js';
import { createOverlays, ensureOverlaySingletons } from '../ui/overlays.js';
import { createPaletteView } from '../ui/paletteView.js';
import { createCategoryView } from '../ui/categoryView.js';
import { createQuickPicker, ROUTINE_OPTIONS } from '../ui/quickPicker.js';
import { createToolbarView } from '../ui/toolbarView.js';
import { createSavedListsView } from '../ui/savedListsView.js';
import { createLinksBarView } from '../ui/linksBarView.js';
import { createRoutineListView } from '../ui/routineListView.js';
import { createRoutineEditorView } from '../ui/routineEditorView.js';
import { createRoutineActionPopup } from '../ui/routineActionPopup.js';
import { createDocsHub } from '../ui/docsHub.js';
import { confirmOnce } from '../ui/widgets.js';
import { readCellW } from '../ui/cssVars.js';
import { initLayout, syncCellSize } from '../ui/layout.js';

import { createDragSession } from '../input/dragSession.js';
import { createPointerSession } from '../input/pointerSession.js';
import { createPlacementTouchDrag } from '../input/touchDrag.js';
import { createBoardController } from '../input/boardController.js';
import { createPaletteInput } from '../input/paletteInput.js';
import { bindControls } from '../input/controls.js';
import * as hitTest from '../input/hitTest.js';

// ─────────────────────────────────────────────────────────────────────────────
// 0. DOM — 원본 1457-1516 의 const 22개
// ─────────────────────────────────────────────────────────────────────────────

const byId = (id) => document.getElementById(id);

const boardEl = byId('board');           // 1457
const reBoardEl = byId('reBoard');       // 1458

// 원본 2776-2785 는 툴팁·배지를 **모듈 로드 시점**에 body 에 붙인다(init 보다 먼저).
// 여기서 미리 확보해야 body 자식 순서가 원문과 같아진다.
ensureOverlaySingletons();

// ─────────────────────────────────────────────────────────────────────────────
// 1. store — ⚠ 가장 먼저. makeDefaultMoves 가 uid 를 10번 소비한다(원본 1444 + init 1522)
// ─────────────────────────────────────────────────────────────────────────────

const store = createStore({ ids: browserEnv });

// loadLocalMeta(1523) — 최근목록 3종 + 즐겨찾기 3종. 읽는 순서까지 원본과 같다.
const meta = loadLocalMeta();
store.patch('recents', meta.recents);
store.patch('favorites', meta.favorites);

// ─────────────────────────────────────────────────────────────────────────────
// 2. 어댑터 + storage 파사드
//
// ⚠ 유스케이스가 부르는 이름(saveRecents/saveRoutineFavorites/saveLinks/saveFavorites)과
//   어댑터가 내놓는 모양(RecentList.save · FavoritesRepo.saveRoutines({routineIds}))이 다르다.
//   **그 다리를 놓는 곳이 여기다.** 인자 모양을 그대로 이으면 터진다.
// ⚠ saveFavorites 는 palette·category 두 커맨드에 **같은 함수 인스턴스**를 넘긴다 —
//   원본 saveFavorites(4227-4230)가 choreo_fav_moves 와 choreo_fav_cats 두 키를 함께 쓴다.
// ─────────────────────────────────────────────────────────────────────────────

const recentLists = {
  projects: createRecentList(STORAGE_KEYS.savedFiles, ProjectCmd.RECENT_LIMITS.projects),
  moves: createRecentList(STORAGE_KEYS.savedMoves, ProjectCmd.RECENT_LIMITS.moves),
  categories: createRecentList(STORAGE_KEYS.savedCategories, ProjectCmd.RECENT_LIMITS.categories)
};
const favoritesRepo = createFavoritesRepo();

/** 원본 saveFavorites(4227-4230). 두 키를 함께 쓴다. */
const saveFavorites = (fav) => favoritesRepo.save(fav);

const storage = {
  saveRecents: (kind, list) => recentLists[kind].save(list),
  saveRoutineFavorites: (ids) => favoritesRepo.saveRoutines({ routineIds: ids }), // 4639-4641
  saveLinks: (serialized) => saveLinksRaw(serialized),                            // 5100-5106
  saveFavorites
};

// ⚠ 히스토리는 storage **뒤에** 만든다 — 메인 undo/redo 가 링크를 되돌린 뒤 saveLinks 로 되쓰기
//   때문이다(2026-09). linkCommands·projectCommands 와 **같은 storage 인스턴스**여야 `전체 초기화`가
//   쓴 값과 undo 가 되쓰는 값이 같은 키(choreo_links)에 간다. 만드는 시점은 순서 규칙 ①과 무관하다
//   (createHistory 는 uid 를 소비하지 않는다).
const hist = History.createHistory(store, { storage });

// ─────────────────────────────────────────────────────────────────────────────
// 3. presenter — views 는 아래에서 채우는 **가변 객체**다(뷰 ↔ render 순환을 여기서 끊는다)
// ─────────────────────────────────────────────────────────────────────────────

const flags = new URLSearchParams(window.location.search);
const views = { board: {} };
const render = createRenderer(store, views, {
  dev: flags.get('dev') === '1',
  paranoid: flags.get('render') === 'full'   // 이행 기간 안전장치. 기본 off = Dirty 그대로
});

/** alert 는 언제나 렌더 뒤다(app/render 의 마지막 단계). */
views.notify = (n) => browserDialogs.alert(n.message);

// ─────────────────────────────────────────────────────────────────────────────
// 4. 커맨드 ctx + 히스토리 커밋 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

const paletteCtx = { store, dialogs: browserDialogs, ids: browserEnv, storage: { saveFavorites } };
const categoryCtx = { store, dialogs: browserDialogs, storage: { saveFavorites } };
const linkCtx = { store, ids: browserEnv, storage };

/**
 * 원본 saveHistory(2863) / saveHistoryRe(2904).
 * ⚠ 루틴 쪽은 마지막에 syncCurrentRoutine(2912)이 붙는다 — 빠뜨리면 편집기 undo/redo 가
 *   메인 보드에 반영되지 않는다. 루틴 히스토리를 커밋하는 **모든** 경로가 이 함수를 쓴다.
 */
function commitHistory(boardId) {
  const dirty = History.commit(hist, boardId);
  if (boardId !== BOARD_ROUTINE) return dirty;
  return mergeDirty(dirty, RoutineCmd.syncFromEditor(routineDeps));
}

/** 원본 undo(2875) / undoRe(2915). 되돌릴 것이 없으면 NONE 이라 syncCurrentRoutine 도 없다(2916). */
function undo(boardId) {
  const dirty = History.undo(hist, boardId);
  if (dirty === NONE || boardId !== BOARD_ROUTINE) return dirty;
  return mergeDirty(dirty, RoutineCmd.syncFromEditor(routineDeps));   // 2923
}

/** 원본 redo(2881) / redoRe(2926). */
function redo(boardId) {
  const dirty = History.redo(hist, boardId);
  if (dirty === NONE || boardId !== BOARD_ROUTINE) return dirty;
  return mergeDirty(dirty, RoutineCmd.syncFromEditor(routineDeps));   // 2935
}

const canUndo = (boardId) => History.canUndo(hist, boardId);
const canRedo = (boardId) => History.canRedo(hist, boardId);

const routineDeps = {
  store,
  env: browserEnv,
  dialogs: browserDialogs,
  storage,
  commitHistory,
  resetHistory: (boardId) => History.reset(hist, boardId)   // 4804-4805·4817
};

/** 원본 4273 `fileNameInput.value = …`. saveProject 와 '이름 복사' 버튼이 같은 함수를 쓴다. */
const setProjectFileName = (fileName) => { byId('fileNameInput').value = fileName; };

const projectDeps = {
  store,
  env: browserEnv,               // ⚠ nowIso() 가 필요하다 — browserEnv 가 갖고 있다
  dialogs: browserDialogs,
  files: browserFileIO,
  storage,
  setProjectFileName,
  commitHistory
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. 보드 뷰 ×2 → 오버레이 ×2 → 오버레이 파사드
//
// ⚠ input/** 은 오버레이를 **앱 전체 하나**로 보고 보드에 매인 메서드의 첫 인자로 boardId 를
//   넘긴다. ui/overlays 는 보드마다 한 인스턴스이므로 여기서 그 다리를 놓는다.
// ⚠ updatePreview 의 카운트 규칙(원본 3906): 세그먼트는 totalCellsFrom 으로 **자르고**,
//   블록에 적는 숫자는 **자르지 않은 값**이다. 둘을 같게 만들면 표시가 달라진다.
// ─────────────────────────────────────────────────────────────────────────────

const boardViews = {
  [BOARD_MAIN]: createBoardView({
    el: boardEl,
    boardId: BOARD_MAIN,
    noteRoot: () => byId('mainBoardWrap'),          // 원본 1479 가 getter 다
    getViewDeps: () => store.viewDeps(BOARD_MAIN),
    getDrag: () => dragSession.current(BOARD_MAIN)  // viewDeps 에 drag 가 없다(3425 의 .is-dragging)
  }),
  [BOARD_ROUTINE]: createBoardView({
    el: reBoardEl,
    boardId: BOARD_ROUTINE,
    noteRoot: () => byId('reBoardWrap'),            // 원본 1495
    getViewDeps: () => store.viewDeps(BOARD_ROUTINE),
    getDrag: () => dragSession.current(BOARD_ROUTINE)
  })
};
views.board = boardViews;

const boardOverlays = {
  [BOARD_MAIN]: createOverlays({ el: boardEl, rowRefs: boardViews[BOARD_MAIN].rowRefs, boardId: BOARD_MAIN }),
  [BOARD_ROUTINE]: createOverlays({ el: reBoardEl, rowRefs: boardViews[BOARD_ROUTINE].rowRefs, boardId: BOARD_ROUTINE })
};
const ov = (boardId) => boardOverlays[boardId];

/** input/** 이 보는 오버레이. body 싱글턴(툴팁·배지·고스트)은 어느 인스턴스로 불러도 같다. */
const overlays = {
  clearPreview: (boardId) => ov(boardId).clearPreview(),
  updatePreview: (boardId, row, startIndex, count) => {
    const board = store.board(boardId);
    const capped = Math.min(count, Grid.totalCellsFrom(row, startIndex, board));   // 3906
    ov(boardId).showPreview(Grid.buildSegments(row, startIndex, capped, board), count);
  },
  clearTrackHighlights: (boardId) => ov(boardId).clearTrackHighlights(),
  markDraggingGroup: (boardId, groupId) => ov(boardId).markDraggingGroup(groupId),
  unmarkDraggingGroups: (boardId) => ov(boardId).unmarkDraggingGroups(),
  showFloatingTooltip: (placementEl) => ov(BOARD_MAIN).showFloatingTooltip(placementEl),
  hideFloatingTooltip: () => ov(BOARD_MAIN).hideFloatingTooltip(),
  // 리사이즈(input/pointerSession)
  showResizeCountBadge: (anchorEl, count) => ov(BOARD_MAIN).showResizeCountBadge(anchorEl, count),
  hideResizeCountBadge: () => ov(BOARD_MAIN).hideResizeCountBadge(),
  clearResizePreview: (boardId) => ov(boardId).clearResizePreview(),
  renderResizePreview: (boardId, segments, count) => ov(boardId).showResizePreview(segments, count),
  // 고스트 2벌 — 이름이 다르다(배치 이동 ↔ 팔레트 칩). 합치지 마라
  showPlacementGhost: (spec) => ov(BOARD_MAIN).showPlacementGhost(spec),
  movePlacementGhost: (x, y) => ov(BOARD_MAIN).movePlacementGhost(x, y),
  removePlacementGhost: () => ov(BOARD_MAIN).hidePlacementGhost(),
  showChipGhost: (spec) => ov(BOARD_MAIN).showPaletteGhost(spec),
  moveChipGhost: (x, y) => ov(BOARD_MAIN).movePaletteGhost(x, y),
  removeChipGhost: () => ov(BOARD_MAIN).hidePaletteGhost()
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. 제스처 세션 — 각각 앱 전체에 **하나**
// ─────────────────────────────────────────────────────────────────────────────

const dragSession = createDragSession();

const pointerSession = createPointerSession({
  getBoardEl: (boardId) => (boardId === BOARD_MAIN ? boardEl : reBoardEl),
  getBoard: (boardId) => store.board(boardId),
  getPlacements: (boardId) => store.board(boardId).placements,
  readCellW: () => readCellW(),           // input 은 ui/cssVars 를 import 할 수 없다
  overlays,
  // 원본 3766. ⚠ newCount 는 **미클램프 previewCount** — 상한 클램프는 커맨드가 한다(3832).
  commit: (boardId, groupId, newCount) => {
    render(BoardCmd.resizeGroupTo(store, { boardId, groupId, newCount }, { ids: browserEnv }));
    render(commitHistory(boardId));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 보드별 커맨드 파사드 — boardId 를 미리 묶는다(boardController · touchDrag 공용)
// ─────────────────────────────────────────────────────────────────────────────

function boardCommandsFor(boardId) {
  const ids = { ids: browserEnv };
  return {
    placeMove: (args) => BoardCmd.placeMoveAt(store, { boardId, ...args }, ids),
    placeRoutine: (args) => BoardCmd.placeRoutineAt(store, { boardId, ...args }, ids),
    moveGroup: (args) => BoardCmd.moveGroupTo(store, { boardId, ...args }, {
      ids: browserEnv,
      unmarkDragging: () => overlays.unmarkDraggingGroups(boardId)   // 3665
    }),
    copyGroup: (args) => BoardCmd.copyGroupTo(store, { boardId, ...args }, ids),
    removeGroup: (args) => BoardCmd.removeGroup(store, { boardId, ...args }),
    toggleSelection: (args) => BoardCmd.toggleSelection(store, { boardId, ...args }),
    commitHistory: () => commitHistory(boardId)
  };
}
const boardCommands = {
  [BOARD_MAIN]: boardCommandsFor(BOARD_MAIN),
  [BOARD_ROUTINE]: boardCommandsFor(BOARD_ROUTINE)
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. 빠른 배치 팝업 ×2 — 루틴판은 노브 4개가 전부 false(보존 대상 결함 #10)
// ─────────────────────────────────────────────────────────────────────────────

function quickPickerDeps(boardId) {
  return {
    store,
    ids: browserEnv,
    render,
    commit: (bid) => commitHistory(bid ?? boardId),       // 뷰는 opts.boardId 를 넘긴다(1903·2240)
    clearPreview: () => overlays.clearPreview(boardId),   // 1779 / 4776
    commands: {
      placeMove: (bid, moveId, row, cellIndex, count) =>
        BoardCmd.placeMoveAt(store, { boardId: bid, moveId, startRow: row, startIndex: cellIndex, totalCount: count }, { ids: browserEnv }),
      createAndPlace: (bid, name, categoryKey, row, cellIndex, count) =>
        PaletteCmd.createAndPlace(paletteCtx, bid, name, categoryKey, row, cellIndex, count),
      addCategory: (key, label, color) => CategoryCmd.addCategory(categoryCtx, key, label, color),
      toggleMoveFavorite: (moveName) => PaletteCmd.toggleMoveFavorite(paletteCtx, moveName),
      toggleCategoryFavorite: (key) => CategoryCmd.toggleCategoryFavorite(categoryCtx, key)
    }
  };
}
const quickPickers = {
  [BOARD_MAIN]: createQuickPicker(quickPickerDeps(BOARD_MAIN)),
  [BOARD_ROUTINE]: createQuickPicker(quickPickerDeps(BOARD_ROUTINE), ROUTINE_OPTIONS)
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. 패널 뷰들
//
// ⚠ paletteView 는 생성 즉시 document 에 메뉴 닫기 리스너 2개를 건다(원본 bindControls 2299-2304).
//   bindControls 보다 먼저 만들어야 등록 순서가 원문과 같다.
// ─────────────────────────────────────────────────────────────────────────────

const paletteView = createPaletteView({
  paletteListEl: byId('paletteList'),
  sortButtons: {
    alpha: byId('sortAlphaBtn'), added: byId('sortAddedBtn'),
    category: byId('sortCategoryBtn'), dir: byId('sortDirBtn')
  },
  store,
  render,
  commit: (boardId) => commitHistory(boardId),
  commands: {
    activatePaletteMove: (moveId) => PaletteCmd.activatePaletteMove(paletteCtx, moveId),
    setMoveCategory: (moveId, next) => PaletteCmd.setMoveCategory(paletteCtx, moveId, next),
    deleteMove: (moveId) => PaletteCmd.deleteMove(paletteCtx, moveId),
    toggleMoveFavorite: (moveName) => PaletteCmd.toggleMoveFavorite(paletteCtx, moveName), // ⚠ 이름
    renameMove: (moveId) => PaletteCmd.renameMove(paletteCtx, moveId),
    promptMoveCategory: (moveId) => PaletteCmd.promptMoveCategory(paletteCtx, moveId)
  },
  // 카드 입력 배선은 input/paletteInput 이 만들고 여기서 주입한다(설계서 §0 의 교차 해소).
  // ⚠ 뷰는 훅이 하나(attachCardInput)이고 input 은 둘(카드 · 이름)이다 — 그 다리도 여기다.
  attachCardInput: (card, move, parts) => {
    paletteInput.attachCardInput(card, move);
    paletteInput.attachNameTrigger(parts?.nameEl || card.querySelector('.move-name'), move.id);
  }
});
views.palette = paletteView;

views.category = createCategoryView({
  legendEl: byId('legend'),
  categoryManagerEl: byId('categoryManager'),
  newMoveCategoryEl: byId('newMoveCategory'),
  store,
  render,
  commit: (boardId) => commitHistory(boardId),
  dialogs: browserDialogs,
  commands: {
    previewColor: (key, color) => CategoryCmd.previewColor(categoryCtx, key, color),
    commitColor: () => CategoryCmd.commitColor(categoryCtx),          // ⚠ 인자 없이 부른다
    renameLabel: (key, rawLabel) => CategoryCmd.renameLabel(categoryCtx, key, rawLabel),
    removeCategory: (key) => CategoryCmd.removeCategory(categoryCtx, key),
    toggleCategoryFavorite: (key) => CategoryCmd.toggleCategoryFavorite(categoryCtx, key)
  }
});

views.toolbar = createToolbarView({ store, canUndo, canRedo });

views.savedLists = createSavedListsView({
  store,
  render,
  setProjectFileName,                                   // 안 넘기면 '이름 복사'가 조용히 죽는다
  commands: {
    loadProjectFromRecent: (data) => ProjectCmd.loadProjectFromRecent(projectDeps, data),
    mergeProjectFromRecent: (data) => ProjectCmd.mergeProjectFromRecent(projectDeps, data),
    loadMoveListFromRecent: (data) => ProjectCmd.loadMoveListFromRecent(projectDeps, data),
    loadCategoriesFromRecent: (data) => ProjectCmd.loadCategoriesFromRecent(projectDeps, data),
    removeRecent: (kind, fileName) => ProjectCmd.removeRecent(projectDeps, kind, fileName),
    setRecentSort: (mode) => ProjectCmd.setRecentSort(projectDeps, mode)
  }
});

views.linksBar = createLinksBarView({
  store,
  render,
  titleFetchState: () => LinkCmd.titleFetchState(store),  // 안 넘기면 스피너가 영영 안 뜬다
  // 2026-09 — 링크 편집의 커밋 지점(change·✕·추가·삭제)은 뷰가 소유한다. 커맨드는 히스토리를
  // 쌓지 않는다(usecases 규약). Dirty.history 는 Undo/Redo 버튼만 건드리므로 입력 중에도 안전하다.
  commitHistory: () => render(commitHistory(BOARD_MAIN)),
  debounce,
  fetchTitle,
  commands: {
    setYoutubeUrl: (rawUrl) => LinkCmd.setYoutubeUrl(linkCtx, rawUrl),
    resolveYoutubeTitle: (url, result) => LinkCmd.resolveYoutubeTitle(linkCtx, url, result),
    resetYoutube: () => LinkCmd.resetYoutube(linkCtx),
    setClickupUrl: (rawUrl) => LinkCmd.setClickupUrl(linkCtx, rawUrl),
    resetClickup: () => LinkCmd.resetClickup(linkCtx),
    addCustomLink: () => LinkCmd.addCustomLink(linkCtx),
    updateCustomLink: (id, fields) => LinkCmd.updateCustomLink(linkCtx, id, fields),
    removeCustomLink: (id) => LinkCmd.removeCustomLink(linkCtx, id)
  }
});

views.routineList = createRoutineListView({
  store,
  render,
  dragSession,                                       // ⚠ 같은 인스턴스
  onDragEnd: () => {                                 // 4712
    overlays.clearTrackHighlights(BOARD_MAIN);
    overlays.clearPreview(BOARD_MAIN);
  },
  commands: {
    toggleFavorite: (routineId) => RoutineCmd.toggleFavorite(routineDeps, routineId),
    renameRoutine: (routineId) => RoutineCmd.renameRoutine(routineDeps, routineId),
    openRoutineEditor: (routineId) => RoutineCmd.openEditor(routineDeps, routineId),
    deleteRoutine: (routineId) => RoutineCmd.deleteRoutine(routineDeps, routineId)
  }
});

views.routineEditor = createRoutineEditorView({
  store,
  render,
  canUndo,
  canRedo,
  closeQuickPicker: () => quickPickers[BOARD_ROUTINE].close(),   // 4881
  commands: {
    undo: () => undo(BOARD_ROUTINE),                             // 2916-2924 (syncCurrentRoutine 포함)
    redo: () => redo(BOARD_ROUTINE),                             // 2927-2936
    clear: () => mergeDirty(BoardCmd.clearRoutineBoard(store), commitHistory(BOARD_ROUTINE)), // 4830-4835
    close: () => RoutineCmd.closeEditor(routineDeps),
    rename: (routineId) => RoutineCmd.renameRoutine(routineDeps, routineId),
    // ⚠ 메인이 아니라 **루틴** 퀵피커의 close 다. 그대로 넘기면 첫 인자가 truthy 라 미리보기가 남는다.
    toggleQuickPlace: () => BoardCmd.toggleQuickPlaceMode(store, { boardId: BOARD_ROUTINE }, {
      closeQuickPicker: () => quickPickers[BOARD_ROUTINE].close()
    }),
    setSize: (size) => RoutineCmd.setRoutineSize(routineDeps, size)
  }
});

const routineActionPopup = createRoutineActionPopup({
  render,
  commands: {
    openRoutineEditor: (routineId) => RoutineCmd.openEditor(routineDeps, routineId),
    // 1751-1752 두 줄 전부. 히스토리 커밋을 빼면 루틴 블록 삭제만 Undo 가 안 된다.
    removeGroup: (groupId) => mergeDirty(
      BoardCmd.removeGroup(store, { boardId: BOARD_MAIN, groupId }),
      commitHistory(BOARD_MAIN)
    )
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. 팔레트 입력 — paletteView 의 attachCardInput 이 이것을 늦게 부른다(첫 렌더 시점)
// ─────────────────────────────────────────────────────────────────────────────

const paletteInput = createPaletteInput({
  store,
  render,
  mainBoardEl: boardEl,
  overlays,
  hitTest,
  dragSession,
  longPress,
  openMoveContextMenu: (moveId, x, y) => paletteView.openContextMenu(moveId, x, y),
  commands: {
    cancelActivePaletteMove: () => PaletteCmd.cancelActivePaletteMove(paletteCtx), // ⚠ 반환을 버린다
    renameMove: (moveId) => PaletteCmd.renameMove(paletteCtx, moveId),
    placeMoveOnMain: (args) => BoardCmd.placeMoveAt(store, { boardId: BOARD_MAIN, ...args }, { ids: browserEnv }),
    commitMainHistory: () => commitHistory(BOARD_MAIN)
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. 보드 컨트롤러 — ⚠ touchDrag 를 **먼저** 만들어 넘긴다
// ─────────────────────────────────────────────────────────────────────────────

function makeBoardController(boardId, extra = {}) {
  const el = boardId === BOARD_MAIN ? boardEl : reBoardEl;
  const commands = boardCommands[boardId];
  const touchDrag = createPlacementTouchDrag({
    el, boardId, store, commands, render, overlays, hitTest, dragSession
  });
  return createBoardController({
    el, boardId, store, commands, render, overlays, hitTest,
    dragSession, pointerSession, touchDrag,
    quickPicker: quickPickers[boardId],
    ...extra
  });
}

// 원본 1525 bindBoardDelegatedEvents(mainCtx)
makeBoardController(BOARD_MAIN, { routineActionPopup });

// ─────────────────────────────────────────────────────────────────────────────
// 12. bindControls (원본 1524) — ⚠ bindHotkeys 는 이 안에서 불린다
// ─────────────────────────────────────────────────────────────────────────────

// bindControls 가 쓰는 요소 묶음(input/controls.js 상단 JSDoc 의 키 목록 그대로).
// ⚠ 링크바(#youtubeUrlInput 등)는 여기 없다 — ui/linksBarView 가 통째로 소유한다.
const CONTROL_IDS = [
  'paletteSearch', 'sortAlphaBtn', 'sortAddedBtn', 'sortCategoryBtn', 'sortDirBtn',
  'addMoveBtn', 'newMoveName', 'newMoveCategory',
  'saveBtn', 'loadFileBtn', 'mergeFileBtn', 'saveMoveListBtn', 'loadMoveListBtn',
  'saveCategoriesBtn', 'loadCategoriesBtn', 'clearBtn',
  'fileLoader', 'mergeFileLoader', 'moveListLoader', 'categoryLoader',
  'fileNameInput', 'moveListFileNameInput', 'categoryFileNameInput',
  'boardColsInput', 'boardColsDec', 'boardColsInc',
  'defaultCountInput', 'defaultCountDec', 'defaultCountInc',
  'quickPlaceBtn', 'undoBtn', 'redoBtn', 'addRoutineBtn', 'createRoutineFromSelectionBtn'
];
const els = Object.fromEntries(CONTROL_IDS.map(id => [id, byId(id)]));
els.mainBoardEl = boardEl;   // 빈 영역 클릭 선택 해제(1527-1529)

bindControls({
  els,
  store,
  render,
  confirmOnce,
  fileIO: browserFileIO,
  dialogs: browserDialogs,
  commands: {
    setSearchQuery: (value) => PaletteCmd.setSearchQuery(paletteCtx, value),
    setSortMode: (mode) => PaletteCmd.setSortMode(paletteCtx, mode),
    setSortDir: (dir) => PaletteCmd.setSortDir(paletteCtx, dir),
    addMove: (rawName, category) => PaletteCmd.addMove(paletteCtx, rawName, category),
    cancelActivePaletteMove: () => PaletteCmd.cancelActivePaletteMove(paletteCtx),
    commitHistory,
    undo,
    redo,
    saveProject: (options) => ProjectCmd.saveProject(projectDeps, options),
    saveMoveList: (options) => ProjectCmd.saveMoveList(projectDeps, options),
    saveCategories: (options) => ProjectCmd.saveCategories(projectDeps, options),
    loadProjectFromFile: (input) => ProjectCmd.loadProjectFromFile(projectDeps, input),
    mergeProjectFromFile: (input) => ProjectCmd.mergeProjectFromFile(projectDeps, input),
    loadMoveListFromFile: (input) => ProjectCmd.loadMoveListFromFile(projectDeps, input),
    loadCategoriesFromFile: (input) => ProjectCmd.loadCategoriesFromFile(projectDeps, input),
    // ⚠ 링크 초기화까지 포함(4484-4490). saveLinks 는 storage 파사드의 것과 같은 함수다.
    clearBoard: () => BoardCmd.clearBoard(store, { storage }),
    setBoardRows: (args) => BoardCmd.setBoardRows(store, { boardId: BOARD_MAIN, ...args }),
    setDefaultCount: (value) => BoardCmd.setDefaultCount(store, { value }),
    toggleQuickPlace: (boardId) => BoardCmd.toggleQuickPlaceMode(store, { boardId }, {
      closeQuickPicker: () => quickPickers[boardId].close()   // 1692
    }),
    clearSelection: () => BoardCmd.clearSelection(store),
    createRoutine: () => RoutineCmd.createRoutine(routineDeps),
    createRoutineFromSelection: () => RoutineCmd.createFromSelection(routineDeps)
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. 첫 렌더 시퀀스 — 원본 init 1530-1540 과 한 줄씩 대응
// ─────────────────────────────────────────────────────────────────────────────

views.toolbar.render();                                   // 1530 syncBoardSizeUI 의 입력창·제목
// 1530 syncBoardSizeUI 안의 updateMobileCellSize(2943). ⚠ 보드 골격보다 **먼저** CSS 변수를 쓴다.
syncCellSize({
  cols: store.board(BOARD_MAIN).cols,
  boardEl,
  noteRoot: byId('mainBoardWrap')
});
views.category.renderOptions();                           // 1531 renderCategoryOptions
views.category.renderManager();                           //      → 2967 의 무조건 사슬
views.category.renderLegend();                            // 1532
views.palette.render();                                   // 1533
views.board[BOARD_MAIN].renderAll(true);                  // 1534 renderBoard(true)
views.savedLists.renderAll();                             // 1535-1537 renderSavedList ×3
views.routineList.render();                               // 1538

// 1539 initLinksBar → loadLinks() + renderLinksBar()
// ⚠ 커맨드가 아니라 store 직행이고 normalizeLinks 를 **옵션 없이** 부른다 —
//   옵션을 주면 저장된 커스텀 링크의 id 가 새로 발급돼 동작이 바뀐다.
store.patch('links', normalizeLinks(loadLinksRaw()));
views.linksBar.render();

render(commitHistory(BOARD_MAIN));                        // 1540 saveHistory()

// ─────────────────────────────────────────────────────────────────────────────
// 14. 셸 리스너 (원본 1542-1678) — ⚠ 첫 렌더가 끝난 **뒤**여야 document 리스너 순서가 같다
// ─────────────────────────────────────────────────────────────────────────────

views.layout = initLayout({ getCols: () => store.board(BOARD_MAIN).cols });

// ─────────────────────────────────────────────────────────────────────────────
// 15. 루틴 편집기 (원본 initRoutineEditorEvents IIFE 4889 — init 이후에 평가된다)
// ─────────────────────────────────────────────────────────────────────────────

makeBoardController(BOARD_ROUTINE);
views.routineEditor.sync();   // 패널은 마크업이 이미 display:none 이라 무동작이다(상태와 한 번 맞춘다)

// ─────────────────────────────────────────────────────────────────────────────
// 16. 문서 허브 — 상단 액션 줄에 '문서' 버튼을 붙인다
// ─────────────────────────────────────────────────────────────────────────────

createDocsHub({ container: document.querySelector('.top-actions') });
