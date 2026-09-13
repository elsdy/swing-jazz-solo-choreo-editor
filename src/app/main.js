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
import * as VideoCmd from '../usecases/videoCommands.js';
import * as CaptureCmd from '../usecases/captureCommands.js';
import * as PoseCmd from '../usecases/poseCommands.js';

import * as Grid from '../domain/grid.js';
import { normalizeLinks } from '../domain/links.js';
import { groupToSpan, secondsPerCount } from '../domain/tempo.js';

import { STORAGE_KEYS } from '../ports/storage.js';
import { projectTime } from '../ports/media.js';
import { browserEnv, browserDialogs, browserFileIO, debounce, longPress } from '../adapters/browser.js';
import {
  createRecentList, createFavoritesRepo, loadLocalMeta, loadLinksRaw, saveLinksRaw
} from '../adapters/localStore.js';
import { fetchTitle } from '../adapters/youtubeOembed.js';
import { mediaSourceFromUrl, pickPlayer, pickPlayerKind } from '../adapters/media/pickPlayer.js';

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
import { createSettingsView } from '../ui/settingsView.js';
import { createClipLibrary } from '../adapters/clipLibrary.js';
import { createClipServer } from '../adapters/clipServer.js';
import { createProjectServer } from '../adapters/projectServer.js';
import { createModelServer } from '../adapters/modelServer.js';
import { createLlmServer } from '../adapters/llmServer.js';
import { createComposeView } from '../ui/composeView.js';
import * as PlanCmd from '../usecases/planCommands.js';
import { loadClipSetting, saveClipSetting } from '../adapters/localStore.js';
import { clipDirParts } from '../domain/clips.js';
import { createVideoPanel } from '../ui/videoPanel.js';
import { createPoseView } from '../ui/poseView.js';
import { createPoseOverlay } from '../ui/poseOverlay.js';
import { createMediapipePose } from '../adapters/pose/mediapipePose.js';
import { buildTracks, framesOfTrack, pickSubjectAt } from '../domain/poseTracks.js';
import { createPlayhead } from '../ui/playhead.js';
import { SEL, DATA } from '../ui/domContract.js';
import { confirmOnce } from '../ui/widgets.js';
import { readCellW } from '../ui/cssVars.js';
import { initLayout, isStacked, syncCellSize } from '../ui/layout.js';

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

/**
 * 보관 폴더의 목록을 최근 프로젝트 목록으로 삼는다(2026-09-13).
 *
 * **폴더가 주인이다** — 브라우저에 안무표 내용을 이고 있던 것이 용량 한계에 부딪히던 문제를 여기서
 * 끝낸다(버그 기록: 최근 10개의 payload 전체를 localStorage 에 넣으면서 예외 처리가 없다).
 * ⚠ 서버가 없으면 **아무것도 하지 않는다** — 지금까지의 localStorage 목록이 그대로 보인다.
 * ⚠ 항목에 `data` 를 넣지 않는다. 열 때 이름으로 읽어 온다(openFromFolder).
 */
function refreshProjectFolder() {
  return projectServer.list().then((items) => {
    if (!items.length) return;
    store.patch('recents', {
      projects: items.map(it => ({
        fileName: it.name.replace(/\.json$/i, ''),
        savedAt: new Date(it.mtime * 1000).toISOString(),
        data: null
      }))
    });
    render({ savedLists: ['projects'] });
  });
}

/**
 * 최근 목록의 한 줄을 연다. 브라우저에 내용이 있으면 그대로, 폴더에서 온 것이면 읽어 와서.
 * @param {any} data 항목이 들고 있는 내용(폴더에서 온 것이면 null)
 * @param {{fileName?:string}} item 항목 전체
 * @param {(deps:any, payload:any) => any} run 실제 커맨드
 * @returns {any} 동기로 열었으면 Dirty, 읽어 와야 하면 undefined(렌더는 여기서 한다)
 */
function openFromFolder(data, item, run) {
  if (data) return run(projectDeps, data);
  const name = item && item.fileName;
  if (!name) return undefined;
  projectServer.read(name).then((payload) => {
    if (payload) render(run(projectDeps, payload));
    else browserDialogs.alert(`보관 폴더에서 '${name}' 을 읽지 못했습니다.`);
  });
  return undefined;
}

views.savedLists = createSavedListsView({
  store,
  render,
  setProjectFileName,                                   // 안 넘기면 '이름 복사'가 조용히 죽는다
  commands: {
    // ⚠ 보관 폴더에서 온 항목은 `data` 가 없다 — 이름으로 읽어 와서 연다. 읽기는 비동기라
    //   **여기서 render 를 부르고 undefined 를 돌려준다**(render 는 falsy 를 조용히 넘긴다).
    loadProjectFromRecent: (data, item) => openFromFolder(data, item, ProjectCmd.loadProjectFromRecent),
    mergeProjectFromRecent: (data, item) => openFromFolder(data, item, ProjectCmd.mergeProjectFromRecent),
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
  // 2026-09 — 링크바의 YouTube 칸이 그대로 영상 소스다(새 입력창을 만들지 않는다).
  // ⚠ 확정(change · ✕)에만 불린다. 반환 Dirty 를 그려야 패널이 새 소스를 싣는다.
  onYoutubeUrlCommit: (rawUrl) => render(VideoCmd.setSource(store, { url: rawUrl })),
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
    // 받아 적기 단축키 `B`. ⚠ 늦게 묶는다 — bindControls 가 views.video 보다 먼저 돌기 때문에
    //   여기서 views.video 를 바로 읽으면 undefined 다. 키를 누르는 시점에는 이미 만들어져 있다.
    captureToggle: () => Boolean(views.video && views.video.captureToggle()),
    captureSkip: () => Boolean(views.video && views.video.captureSkip()),
    stopCapture: () => Boolean(views.video && views.video.stopCapture()),
    commitHistory,
    undo,
    redo,
    // ⚠ 다운로드는 유스케이스가 그대로 한다(정적 호스팅에서도 저장이 되어야 한다). 보관 폴더 쓰기는
    //   **여기서** 한다 — 비동기이고 어댑터를 아는 자리가 app/main 뿐이기 때문이다(clipServer 와 같은 규약).
    saveProject: (options) => {
      const dirty = ProjectCmd.saveProject(projectDeps, options);
      const fileName = (store.get().recents.projects[0] || {}).fileName;
      const payload = (store.get().recents.projects[0] || {}).data;
      if (fileName && payload) {
        projectServer.save(fileName, payload).then((saved) => { if (saved) refreshProjectFolder(); });
      }
      return dirty;
    },
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
// 16. 영상 패널 — 재생기(어댑터) · 패널 뷰 · 재생 헤드 (2026-09 신설)
//
// ⚠ **어댑터를 아는 자리는 여기 하나다.** 뷰는 MediaPlayer 계약만 보고, 유스케이스는 초만 받는다.
// ⚠ 재생기는 **패널이 실제로 보이는 순간에** 만든다. 한 번도 안 연 사용자에게 유튜브 요청이
//   나가면 안 된다(createYouTubePlayer 는 생성만으로는 DOM·네트워크를 건드리지 않고,
//   첫 load(source) 에서 <script> 가 붙는다).
// ⚠ kind 가 같으면 pickPlayer 를 **다시 부르지 않는다** — load() 만 불러야 iframe 이 재로드되지 않는다.
// ⚠ 재생 위치·재생 상태는 store 에 넣지 않는다. 시각은 어댑터의 표본을 rAF 에서 보간해 쓴다(채널 B).
// ─────────────────────────────────────────────────────────────────────────────

const videoFrameEl = byId('videoFrame');
/** 자세 오버레이 캔버스. 재생기를 갈아 끼워도 이것만은 프레임 안에 남는다. */
const videoPoseCanvasEl = byId('videoPoseCanvas');

/**
 * 지금 실제로 쓰는 영상 URL(유튜브). 링크바가 원본이고 `media.source` 는 그 확정 사본이다.
 * ⚠ 폴백이 있는 이유: 이 기능 이전에 저장한 프로젝트 파일에는 media 블록이 아예 없다.
 *   그런 파일을 열면 링크바에는 주소가 있는데 media.source 는 null 이므로, 그때는 링크바를 읽는다.
 * ⚠ 파일 소스면 빈 문자열이다 — 파일에는 URL 이 없다(아래 localFile 이 그 실물이다).
 */
function videoSourceUrl() {
  const source = VideoCmd.mediaState(store).source;
  if (source && source.kind === 'file') return '';
  return source ? source.url : (store.links.youtubeUrl || '');
}

/**
 * 이 세션에서 실제로 고른 로컬 영상 파일. **store 에 들어가지 않는다** — blob URL 은 이 실행에서만 살고,
 * 파일 객체는 직렬화할 수 없다. store 에는 파일명만 남는다(usecases/videoCommands.setFileSource).
 * ⚠ blob URL 은 만든 쪽이 revoke 한다. 갈아 끼울 때 앞의 것을 놓지 않으면 파일 크기만큼 메모리가 샌다.
 * @type {{name: string, url: string}|null}
 */
let localFile = null;

/** 저장된 파일 소스와 이 세션에서 고른 파일이 같은가. 다시 열었을 때는 이름만 있고 파일이 없다. */
function localFileLoaded() {
  const source = VideoCmd.mediaState(store).source;
  return !!(source && source.kind === 'file' && localFile && localFile.name === source.name);
}

/** 파일 소스가 실제로 재생 가능한가 — 이 세션에서 고른 파일이거나, 서버가 그 경로를 가지고 있거나. */
function fileSourceReady() {
  const source = VideoCmd.mediaState(store).source;
  if (!source || source.kind !== 'file') return false;
  return localFileLoaded() || !!(clipServerConfig && source.path && serverClipOk === source.path);
}

/**
 * 재생기에 실을 MediaSource. store 의 소스 참조(파일명/URL)를 이 세션의 실물(blob URL/videoId)로 바꾼다.
 * 파일 소스인데 아직 안 골랐으면 null — 소스 없음과 같이 널 재생기로 간다(패널은 "다시 골라 달라"고 안내한다).
 * @returns {import('../ports/media.js').MediaSource|null}
 */
function currentMediaSource() {
  const source = VideoCmd.mediaState(store).source;
  if (source && source.kind === 'file') {
    if (localFileLoaded()) return { kind: 'file', url: localFile.url, name: localFile.name };
    // 서버 모드: 보관 경로가 있으면 서버가 스트리밍한다(Range 지원). 파일을 다시 고를 필요가 없다.
    if (clipServerConfig && source.path && serverClipOk === source.path) {
      return { kind: 'file', url: clipServer.urlFor(source.path), name: source.name };
    }
    return null;
  }
  return mediaSourceFromUrl(videoSourceUrl());
}

/** 재생기에 실을 것이 있는가. 재생 헤드는 이것이 거짓이면 그리지 않는다. */
const hasMediaSource = () => currentMediaSource() != null;

/** 소스 없음 = 널 재생기. 덕분에 아래 어느 줄에도 `player?.` 가 생기지 않는다. */
let player = pickPlayer(null, {});
let playerKind = 'null';
/** 마지막으로 load() 에 넘긴 소스의 식별자(videoId 나 blob URL). 같으면 다시 싣지 않는다(iframe 재로드 방지). */
let loadedVideoKey = '';
/** 길이는 상태가 바뀔 때만 다시 읽는다 — getDuration 폴링은 iframe 경계를 넘는다. */
let videoDurationSec = null;
let unsubscribeVideoState = () => {};
let unsubscribeVideoTime = () => {};

/**
 * In~Out 구간 반복. 표본이 Out 을 넘으면 In 으로 되감는다 — 뜻(loop·inSec·outSec)은 store 의 화면 상태이고
 * 실행은 어댑터를 아는 이 자리의 몫이다. 표본은 재생 중 100ms 마다 오므로 최대 0.1초 넘어간 뒤 돌아온다.
 * ⚠ seek 은 표본을 동기로 다시 쏘지만 그때는 sec 이 In 이라 이 조건에 다시 걸리지 않는다(재귀 없음).
 * @param {import('../ports/media.js').TimeSample} sample
 */
function enforceLoop(sample) {
  if (!sample || !sample.playing) return;
  const p = VideoCmd.panelState(store);
  if (!p.loop || !Number.isFinite(p.inSec) || !Number.isFinite(p.outSec) || !(p.outSec > p.inSec)) return;
  if (sample.sec >= p.outSec) player.seek(p.inSec);
}

/** 소스 하나를 "같은 것을 또 싣지 않기" 위한 문자열로 접는다. */
function mediaSourceKey(source) {
  if (!source) return '';
  return source.kind === 'file' ? `file:${source.url}` : `yt:${source.videoId}:${source.startSec || 0}`;
}

/** 지금 소스에 맞는 재생기를 준비한다. 멱등이며, 바뀐 것이 없으면 아무 일도 하지 않는다. */
function ensurePlayer() {
  const source = currentMediaSource();
  const kind = pickPlayerKind(source);

  if (kind !== playerKind) {
    unsubscribeVideoState();
    unsubscribeVideoTime();
    player.destroy();
    // ⚠ YT.Player 는 넘겨받은 <div> 를 <iframe> 으로 **갈아치운다** — 새로 만들 때마다 빈 자리를
    //   다시 마련해야 한다(먼젓번 컨테이너는 이미 사라졌다). 파일 재생기는 그 안에 <video> 를 넣는다.
    // ⚠ innerHTML 로 비우면 **자세 오버레이 캔버스까지 지워진다**(index.html 이 프레임 안에 두었다).
    //   재생기가 남긴 것만 걷어내고 캔버스는 남긴다 — YT 는 host <div> 를 <iframe> 으로 갈아치우므로
    //   "우리가 만든 host" 를 기억해 두는 것으로는 부족하고, 캔버스가 아닌 것을 전부 걷는 편이 확실하다.
    for (const child of [...videoFrameEl.children]) {
      if (child !== videoPoseCanvasEl) child.remove();
    }
    const host = document.createElement('div');
    videoFrameEl.appendChild(host);
    // preload:'auto' — 로컬 파일·로컬 서버가 소스라 대역폭이 아깝지 않고, 끝까지 미리 받아 두어야 In/Out 탐색과
    // 구간 반복이 끊기지 않는다("영상을 통째로 불러온다"). 유튜브 어댑터는 이 옵션을 모른 채 무시한다.
    player = pickPlayer(source, { container: host, preload: 'auto' });
    playerKind = kind;
    loadedVideoKey = '';
    // 재생 상태는 도메인이 아니라 store 를 거치지 않는다 — 문구만 직접 다시 그린다.
    unsubscribeVideoState = player.onState(() => {
      videoDurationSec = player.getDuration();
      views.video?.renderStatus();
    });
    unsubscribeVideoTime = player.onTime(enforceLoop);
  }

  const key = mediaSourceKey(source);
  if (key !== loadedVideoKey) {
    // ⚠ 영상이 바뀌면 옛 관절은 거짓이 된다 — 다른 영상 위에 남의 자세를 그리게 된다.
    if (loadedVideoKey && poseFrames.length) dropPoseAnalysis();
    loadedVideoKey = key;
    player.load(source);
  }
}

/**
 * 영상 보관 — 두 가지 길이 있고 시작할 때 서버를 한 번 찔러 보고 고른다.
 *   서버 모드   `python3 server.py` 가 떠 있으면 업로드는 서버가 `<root>/<subdir>/<프로젝트>/` 에 저장하고
 *              재생은 `/clips/<path>` 스트리밍이다. 설정의 폴더는 서버의 것이다.
 *   브라우저 모드 정적 호스팅이면 File System Access API 로 사용자가 고른 폴더에 복사한다(크롬 계열).
 * 두 길의 path 모양이 같아서 프로젝트 파일은 어느 쪽에서 열어도 통한다.
 */
const clipLibrary = createClipLibrary();
const clipServer = createClipServer();
// 프로젝트 파일 보관(2026-09-13). 영상과 같은 root 아래 형제 폴더(<root>/projects/)를 쓴다.
// ⚠ 서버가 없으면 모든 함수가 null·빈 배열이다 — 그때는 지금까지처럼 다운로드와 localStorage 로 돈다.
const projectServer = createProjectServer();
/** 서버가 있으면 그 설정, 없으면 null. probe 가 끝나기 전에는 null 이라 브라우저 모드처럼 군다. */
let clipServerConfig = null;
/** 서버에 있다고 확인한 경로. 소스가 바뀌면 다시 확인한다. */
let serverClipOk = '';
/** 서버에 없다고 확인한 경로. 패널이 "없다"고 말하는 근거다. */
let serverClipMissing = '';
/** 마지막 보관 폴더 읽기 시도의 결과. 패널이 "파일이 없다"와 "권한만 다시 받으면 된다"를 구분해 말한다. */
let libraryState = 'idle';

/** 실물 파일을 이 세션의 소스로 붙인다. blob URL 은 여기서만 만들고, 앞의 것은 놓는다. */
function attachLocalFile(file) {
  if (localFile) URL.revokeObjectURL(localFile.url);
  localFile = { name: file.name, url: URL.createObjectURL(file) };
}

/** 지금 프로젝트 이름(파일 이름 칸). 보관 폴더 아래 프로젝트별 하위 폴더 이름이 된다. */
const projectNameForClips = () => (byId('fileNameInput')?.value || '').trim();

/**
 * 사용자가 영상 파일을 골랐다. 보관 폴더가 지정돼 있으면 거기 복사하고 그 상대 경로까지 소스에 남긴다.
 * 복사는 비동기라 먼저 blob 으로 바로 띄우고(기다리게 하지 않는다), 복사가 끝나면 path 만 덧붙인다.
 * ⚠ 여기가 URL.createObjectURL 을 부르는 자리다 — 만든 곳이 revoke 까지 책임진다.
 * @param {File} file
 */
function chooseLocalFile(file) {
  if (!file) return;
  attachLocalFile(file);
  libraryState = 'idle';
  trimError = '';
  // 같은 이름을 다시 골라도(다시 열었을 때가 그렇다) 소스는 그대로라 NONE 이 온다 — 그래도 재생기는 새 blob 을 실어야 한다.
  render(VideoCmd.setFileSource(store, { name: file.name }));
  views.video?.render();

  // 보관 — 서버가 있으면 서버로 올리고, 아니면 브라우저 폴더에 복사한다. 어느 쪽이든 끝나면 path 만 덧붙인다.
  const stillCurrent = () => {
    const cur = VideoCmd.mediaState(store).source;
    return !!(cur && cur.kind === 'file' && cur.name === file.name && localFile && localFile.name === file.name);
  };
  const attachPath = (path) => {
    if (!stillCurrent()) return;                 // 그 사이 사용자가 다른 소스로 바꿨으면 낡은 결과다
    serverClipOk = clipServerConfig ? path : serverClipOk;
    render(VideoCmd.setFileSource(store, { name: file.name, path }));
    commitHistoryAndRender();
  };
  if (clipServerConfig) {
    clipServer.upload(file, projectNameForClips(), file.name).then((saved) => { if (saved) attachPath(saved.path); });
    return;
  }
  // 브라우저 모드. 권한은 조용히 확인만 한다(파일 선택 대화상자가 닫힌 뒤라 제스처가 끝났을 수 있다).
  clipLibrary.ensurePermission(false).then(async (ok) => {
    if (!ok) return;
    const { subdir } = loadClipSetting();
    let saved;
    try {
      saved = await clipLibrary.saveClip(file, clipDirParts(subdir, projectNameForClips()), file.name);
    } catch {
      return;                                    // 복사 실패는 조용히 — blob 으로는 이미 재생 중이다
    }
    attachPath(saved.path);
  });
}

/** 파일 경로를 덧붙인 것도 되돌릴 수 있게 히스토리를 한 단계 남긴다. */
function commitHistoryAndRender() {
  render(commitHistory(BOARD_MAIN));
}

/**
 * 보관 폴더에서 저장된 경로의 파일을 읽어 소스로 붙인다.
 * @param {boolean} interactive 참이면 권한을 묻는다(클릭 콜스택 안에서만 의미가 있다)
 */
async function openFromLibrary(interactive) {
  const source = VideoCmd.mediaState(store).source;
  if (!source || source.kind !== 'file' || !source.path) return;
  if (fileSourceReady()) return;
  if (clipServerConfig) {
    // 서버 모드: 있는지 물어보고, 있으면 URL 로 바로 싣는다(파일을 내려받지 않는다).
    const ok = await clipServer.exists(source.path);
    const now = VideoCmd.mediaState(store).source;
    if (!now || now.kind !== 'file' || now.path !== source.path) return;
    if (ok) { serverClipOk = source.path; serverClipMissing = ''; libraryState = 'idle'; }
    else { serverClipMissing = source.path; libraryState = 'missing'; }
    views.video?.render();
    return;
  }
  if (!(await clipLibrary.ensurePermission(interactive))) return;
  const file = await clipLibrary.openClip(source.path);
  // 그 사이 소스가 바뀌었으면 낡은 결과다.
  const now = VideoCmd.mediaState(store).source;
  if (!now || now.kind !== 'file' || now.path !== source.path) return;
  if (!file) {
    libraryState = 'missing';
    views.video?.renderStatus();
    return;
  }
  libraryState = 'idle';
  attachLocalFile(new File([file], source.name, { type: file.type }));
  views.video?.render();
}

/** 소스에 보관 경로가 있고 아직 못 읽었으면 조용히 시도한다. 권한이 이미 있으면 대화상자 없이 붙는다. */
let libraryAutoTriedFor = '';
function tryLibraryQuietly() {
  const source = VideoCmd.mediaState(store).source;
  const key = source && source.kind === 'file' && source.path ? source.path : '';
  if (!key || fileSourceReady() || key === libraryAutoTriedFor) return;
  libraryAutoTriedFor = key;
  openFromLibrary(false);
}

/** 잘라내기 진행 상태. store 를 거치지 않는 값이라(안무가 아니다) 패널의 renderCut 이 게터로 읽는다. */
let trimBusy = false;
/** 마지막 잘라내기 실패 이유(서버 문구). 다음 시도나 소스 변경이 지운다. */
let trimError = '';

/**
 * 지금 잘라낼 수 있는가, 안 되면 왜인가. In/Out 유무는 패널이 스스로 본다.
 * @returns {'ready'|'busy'|'not-file'|'no-server'|'no-ffmpeg'|'not-stored'}
 */
function trimState() {
  if (trimBusy) return 'busy';
  const source = VideoCmd.mediaState(store).source;
  if (!source || source.kind !== 'file') return 'not-file';
  if (!clipServerConfig) return 'no-server';
  if (!clipServerConfig.ffmpeg) return 'no-ffmpeg';
  if (!source.path || (serverClipOk !== source.path && !localFileLoaded())) return 'not-stored';
  return 'ready';
}

/**
 * In~Out 을 잘라 다시 인코딩한 새 클립을 서버에 만들게 하고, 끝나면 그 클립으로 소스를 갈아 끼운다.
 * 원본은 서버에 그대로 남는다. 템포·마커의 시각은 applyTrim 커맨드가 In 만큼 당긴다.
 * ⚠ 기다리는 동안 사용자가 다른 소스로 바꿨으면 결과를 버린다(낡은 결과). 파일은 이미 만들어졌으니 보관 폴더에는 남는다.
 * @param {{inSec:number, outSec:number}} range
 */
async function trimCurrentClip(range) {
  const source = VideoCmd.mediaState(store).source;
  if (trimState() !== 'ready' || !source || !source.path) return;
  trimBusy = true;
  trimError = '';
  views.video?.renderCut();
  player.pause();
  const res = await clipServer.trim(source.path, range.inSec, range.outSec);
  trimBusy = false;
  const now = VideoCmd.mediaState(store).source;
  if (!now || now.kind !== 'file' || now.path !== source.path) { views.video?.renderCut(); return; }
  if (!res.ok) {
    trimError = res.error || '알 수 없는 오류';
    views.video?.renderCut();
    return;
  }
  serverClipOk = res.path;
  serverClipMissing = '';
  libraryState = 'idle';
  render(VideoCmd.applyTrim(store, { name: res.name, path: res.path, inSec: range.inSec, outSec: range.outSec }));
  commitHistoryAndRender();
}

/**
 * 영상을 그 시각으로 옮긴다(play 면 재생까지). `In 으로`·`Out 으로`·마커의 ▶ 가 쓴다.
 * ⚠ play() 는 클릭 콜스택 안에서 불러야 한다(needsUserGesture) — 그래서 seek 을 기다리지 않는다.
 * @param {number} sec
 * @param {{play?: boolean}} [opts]
 */
function seekVideoTo(sec, opts = {}) {
  player.seek(Math.max(0, sec));
  if (opts.play) player.play();
}

// 서버가 있는지 한 번 본다. 있으면 설정과 패널이 서버 모드로 다시 그려진다(패널이 열려 있으면 경로도 확인한다).
clipServer.probe().then((cfg) => {
  clipServerConfig = cfg;
  if (!cfg) return;
  libraryAutoTriedFor = '';
  views.settings?.render();
  views.video?.render();
  // 서버가 있으면 **보관 폴더가 최근 프로젝트 목록의 주인**이다(2026-09-13).
  // ⚠ 여기서만 부른다 — 매 렌더마다 폴더를 읽으면 목록이 스크롤 중에 다시 그려진다.
  refreshProjectFolder();
});

/** 보간된 현재 미디어 시각(초). 표본은 캐시된 값이라 매 프레임 불러도 iframe 경계를 넘지 않는다. */
const currentVideoSec = () => projectTime(player.getTimeSample(), performance.now(), videoDurationSec);

const playhead = createPlayhead({
  scrollRoot: byId('mainBoardWrap'),
  getTrack: (row) => boardViews[BOARD_MAIN].rowRefs.get(row)?.track || null,
  getCols: () => store.board(BOARD_MAIN).cols,
  getTempo: () => VideoCmd.mediaState(store).tempo,
  // ⚠ 템포가 준비되지 않았으면 **아예 그리지 않는다**. bpm 0 에서 그리면 거짓 위치가 선다.
  isActive: () => VideoCmd.isTempoReady(store) && hasMediaSource(),
  isFollowing: () => VideoCmd.panelState(store).follow,
  getCurrentSec: currentVideoSec,
  // 재생 위치가 지나가는 블록을 켠다. 칸이 바뀔 때만 불리므로 여기서 필터링해도 싸다.
  getPlacementsInRow: (row) => store.board(BOARD_MAIN).placements.filter(p => p.row === row)
});

// 렌더러가 보드를 다시 그린 뒤 헤드 캐시를 버리게 한다. 헤드를 그리는 것은 여전히 rAF 루프뿐이다.
views.playhead = { invalidate: () => playhead.invalidate() };

// ─────────────────────────────────────────────────────────────────────────────
// 16-b. 자세 분석 (2026-09-12)
//
// ⚠ **관절점은 store 에 넣지 않는다.** 30초를 12fps 로 보면 프레임 360장이라 숫자 수만 개다 —
//   undo 스냅샷이 그만큼 불어나고 되돌릴 값도 아니다. 여기 모듈 변수로 들고, store 에는 요약만 간다
//   (usecases/poseCommands.js 경계 ①). 재생 위치를 store 에 안 넣는 것과 같은 이유다.
// ⚠ 그리는 것은 rAF 오버레이의 몫이다(채널 B). 이 자리는 "돌리고 결과를 들고 있는" 일만 한다.
// ⚠ 유튜브에는 안 된다 — iframe 안의 픽셀을 읽을 수 없다. 자르기와 같은 조건이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 초당 몇 장을 볼 것인가. 가동 범위에는 10~15면 충분하고, 높일수록 그만큼 오래 걸린다. */
const POSE_FPS = 12;

/** 분석 결과. **store 밖**이다(위 주석). */
let poseFrames = [];
/** 누가 누구인지 이어 붙인 것. 앵커가 바뀔 때마다 다시 만든다. */
let poseTracks = null;
/** 추정기는 처음 쓸 때 만든다 — 한 번도 안 쓰는 사람에게 11MB 를 올리지 않는다. */
let poseEstimator = null;
let poseRunning = false;

/** 지금 프레임 안에 있는 `<video>`. 유튜브면 iframe 이라 null 이다. */
const videoElement = () => videoFrameEl.querySelector('video');

function ensurePoseEstimator() {
  if (!poseEstimator) poseEstimator = createMediapipePose({ baseUrl: '/models', numPoses: 2 });
  return poseEstimator;
}

/**
 * 지금 분석할 수 있는가, 없으면 왜인가. 문구는 ui/poseView.js 가 만든다.
 * @returns {'ready'|'busy'|'no-server'|'no-model'|'not-file'|'not-loaded'}
 */
function poseReadiness() {
  if (poseRunning) return 'busy';
  if (!clipServerConfig) return 'no-server';
  if (!clipServerConfig.pose) return 'no-model';
  const source = VideoCmd.mediaState(store).source;
  if (!source || source.kind !== 'file') return 'not-file';
  if (!fileSourceReady() || !videoElement()) return 'not-loaded';
  return 'ready';
}

/** 앵커에서 궤적을 다시 잇는다. 한 사람뿐이면 앵커 없이도 저절로 선다(domain/poseTracks.autoAnchors). */
function rebuildPoseTracks() {
  poseTracks = buildTracks(poseFrames, PoseCmd.poseState(store).anchors);
  return poseTracks;
}

/**
 * 그 시각에 가장 가까운 분석 프레임. 오버레이가 매 프레임 부르므로 이분 탐색이다.
 * @param {number} sec
 * @returns {{sec:number, subjects:Array, activeIndex:number}|null}
 */
function poseFrameAt(sec) {
  if (!poseFrames.length) return null;
  let lo = 0, hi = poseFrames.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (poseFrames[m].sec < sec) lo = m + 1; else hi = m;
  }
  let i = lo;
  if (i > 0 && Math.abs(poseFrames[i - 1].sec - sec) < Math.abs(poseFrames[i].sec - sec)) i -= 1;
  const activeId = PoseCmd.poseState(store).activeId;
  const map = (poseTracks && poseTracks.byFrame[i]) || {};
  const activeIndex = activeId && map[activeId] !== undefined ? map[activeId] : -1;
  return { sec: poseFrames[i].sec, subjects: poseFrames[i].subjects, activeIndex };
}

/** 분석 결과를 버린다. 소스가 바뀌면 옛 관절을 새 영상 위에 그리게 되므로 반드시 함께 지운다. */
function dropPoseAnalysis() {
  poseFrames = [];
  poseTracks = null;
  const dirty = PoseCmd.clearAnalysis(store);
  poseOverlay.invalidate();
  return dirty;
}

/**
 * In~Out 구간(없으면 영상 전체)에서 관절을 찾는다.
 * ⚠ `<video>` 를 시각으로 탐색하며 한 장씩 보므로 **탭이 보이는 동안에만** 된다 — 브라우저는 보이지 않는
 *   탭의 영상을 디코드하지 않는다. 배경 탭에서 누르면 프레임이 0장으로 끝난다.
 */
async function runPoseAnalysis() {
  const video = videoElement();
  if (!video || poseReadiness() !== 'ready') return;
  const range = VideoCmd.inOutRange(store);
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : videoDurationSec;
  const fromSec = range ? range.inSec : 0;
  const toSec = range ? range.outSec : (Number.isFinite(duration) ? duration : 0);
  if (!(toSec > fromSec)) {
    // 길이를 모르는 것과 In~Out 이 뒤집힌 것은 사용자가 할 일이 다르다.
    render(PoseCmd.failAnalysis(store, {
      error: !Number.isFinite(duration) || duration <= 0
        ? '영상 길이를 아직 모릅니다. 이 탭이 화면에 보이는 상태에서 영상이 뜬 뒤 다시 누르세요.'
        : '분석할 구간이 없습니다. In~Out 을 다시 찍어 보세요.'
    }));
    return;
  }

  poseRunning = true;
  poseFrames = [];
  poseTracks = null;
  render(PoseCmd.startAnalysis(store, { fromSec, toSec }));

  const estimator = ensurePoseEstimator();
  const loaded = await estimator.load();
  if (!loaded.ok) {
    poseRunning = false;
    render(PoseCmd.failAnalysis(store, { error: loaded.error }));
    return;
  }
  const res = await estimator.analyze(video, {
    fromSec, toSec, fps: POSE_FPS, maxSubjects: 2,
    onProgress: (done, total) => render(PoseCmd.setProgress(store, { done, total }))
  });
  poseRunning = false;
  if (!res.ok) {
    render(PoseCmd.failAnalysis(store, { error: res.error }));
    return;
  }
  if (!res.frames.length) {
    render(PoseCmd.failAnalysis(store, { error: '프레임을 한 장도 읽지 못했습니다. 이 탭이 화면에 보이는 상태에서 다시 눌러 보세요.' }));
    return;
  }
  poseFrames = res.frames;
  const tracks = rebuildPoseTracks();
  let maxSubjects = 0;
  for (const f of poseFrames) if (f.subjects.length > maxSubjects) maxSubjects = f.subjects.length;
  render(PoseCmd.finishAnalysis(store, {
    frames: poseFrames.length, maxSubjects,
    trackIds: tracks.ids, ambiguous: tracks.ambiguous.length, lost: tracks.lost.length
  }));
  poseOverlay.invalidate();
}

/** 영상 위를 눌렀다 — 그 자리의 사람을 지금 보는 궤적의 앵커로 삼는다. */
function onPosePick(sec, point) {
  const found = poseFrameAt(sec);
  if (!found || found.subjects.length === 0) return;
  const index = pickSubjectAt({ sec: found.sec, subjects: found.subjects }, point);
  if (index === null) return;
  render(PoseCmd.addAnchor(store, { sec: found.sec, subject: index }));
  rebuildPoseTracks();
  views.pose?.render();
  poseOverlay.invalidate();
}

const poseOverlay = createPoseOverlay({
  canvas: videoPoseCanvasEl,
  frame: videoFrameEl,
  getVideoSize: () => {
    const v = videoElement();
    return v ? { w: v.videoWidth || 0, h: v.videoHeight || 0 } : { w: 0, h: 0 };
  },
  getCurrentSec: currentVideoSec,
  isActive: () => VideoCmd.panelState(store).open && PoseCmd.hasOverlay(store),
  getFrameAt: poseFrameAt,
  getShowMesh: () => PoseCmd.poseState(store).showMesh,
  onPick: onPosePick
});

views.pose = createPoseView({
  store,
  render,
  getReadiness: poseReadiness,
  onRun: runPoseAnalysis,
  onChange: () => { rebuildPoseTracks(); poseOverlay.invalidate(); },
  commands: {
    clearAnalysis: () => dropPoseAnalysis(),
    setActiveTrack: (args) => PoseCmd.setActiveTrack(store, args),
    addTrack: () => PoseCmd.addTrack(store),
    clearAnchors: () => PoseCmd.clearAnchors(store),
    setMesh: (args) => PoseCmd.setMesh(store, args)
  }
});

views.video = createVideoPanel({
  store,
  render,
  commitHistory: () => render(commitHistory(BOARD_MAIN)),
  getSourceUrl: videoSourceUrl,
  getSource: () => VideoCmd.mediaState(store).source,
  getFileLoaded: fileSourceReady,
  onFileChosen: chooseLocalFile,
  onOpenFromLibrary: () => openFromLibrary(true),
  getLibraryState: () => libraryState,
  getPlayerState: () => player.getState(),
  getPlayerKind: () => player.kind,
  getCurrentSec: currentVideoSec,
  onSeek: seekVideoTo,
  getTrimState: trimState,
  getTrimError: () => trimError,
  onTrim: trimCurrentClip,
  dialogs: browserDialogs,
  // ⚠ 매 렌더 불린다(패널이 열린 채 URL 만 바뀌는 경로가 있다). 아래 셋은 전부 멱등이다.
  onSync: (shown) => {
    if (shown) {
      tryLibraryQuietly();
      ensurePlayer();
      playhead.start();
      poseOverlay.start();
    } else {
      poseOverlay.stop();
      // ⚠ 반드시 멈춘다 — display:none 인 iframe 도 오디오는 계속 나온다(패널 닫기·루틴 편집기 열기).
      player.pause();
      playhead.stop();
    }
    // 패널이 안무표를 좁혔거나 넓혔다. 순서가 중요하다 — 셀 폭을 **먼저** 다시 재고, 그 결과를
    // 재생 헤드가 다음 프레임에 다시 읽게 한다(채널 B). 반대로 하면 헤드가 옛 칸 폭에 선다.
    // ⚠ 이 재측정을 videoCommands 의 Dirty 로 올리면 안 된다 — app/render 는 layout 을 맨 먼저
    //   처리하는데 패널의 hidden 은 그 뒤에 뒤집혀서, 바뀌기 전 폭을 재게 된다.
    views.layout?.syncCellSize();
    playhead.invalidate();
    poseOverlay.invalidate();
  },
  commands: {
    togglePanel: () => VideoCmd.togglePanel(store),
    closePanel: () => VideoCmd.closePanel(store),
    setCollapsed: (args) => VideoCmd.setCollapsed(store, args),
    // 큰 창으로 띄우기(2026-09-13). 자리·폭은 끌기를 **놓는 순간** 한 번만 들어온다.
    setFloating: (args) => VideoCmd.setFloating(store, args),
    setFloatBox: (args) => VideoCmd.setFloatBox(store, args),
    setFollow: (args) => VideoCmd.setFollow(store, args),
    markTempoPoint: (args) => VideoCmd.markTempoPoint(store, args),
    clearTempoPoints: () => VideoCmd.clearTempoPoints(store),
    tapTempo: (args) => VideoCmd.tapTempo(store, args),
    commitTaps: (args) => VideoCmd.commitTaps(store, args),
    clearTaps: () => VideoCmd.clearTaps(store),
    setTempo: (args) => VideoCmd.setTempo(store, args),
    setBeatsPerCount: (args) => VideoCmd.setBeatsPerCount(store, args),
    reanchorTo: (args) => VideoCmd.reanchorTo(store, args),
    clearTempo: () => VideoCmd.clearTempo(store),
    clearFileSource: () => VideoCmd.clearFileSource(store),
    addTempoPoint: (args) => VideoCmd.addTempoPoint(store, args),
    clearTempoMap: () => VideoCmd.clearTempoMap(store),
    setInPoint: (args) => VideoCmd.setInPoint(store, args),
    setOutPoint: (args) => VideoCmd.setOutPoint(store, args),
    setInOut: (args) => VideoCmd.setInOut(store, args),
    clearInOut: () => VideoCmd.clearInOut(store),
    setLoop: (args) => VideoCmd.setLoop(store, args),
    addMarker: (args) => VideoCmd.addMarker(store, args),
    removeMarker: (args) => VideoCmd.removeMarker(store, args),
    clearMarkers: () => VideoCmd.clearMarkers(store),
    applyMarkerToTempo: (args) => VideoCmd.applyMarkerToTempo(store, args),
    // 영상 목록(2026-09-12). 같은 안무를 여러 번 찍으면 영상이 여러 개 달린다.
    selectClip: (args) => VideoCmd.selectClip(store, args),
    renameClip: (args) => VideoCmd.renameClip(store, args),
    removeClip: (args) => VideoCmd.removeClip(store, args),
    // 받아 적기(2026-09-12). 메인 보드에만 놓는다 — 루틴 편집기와 영상 패널은 동시에 열리지 않는다.
    captureToggle: (args) => CaptureCmd.captureToggle(store, args, { ids: browserEnv }),
    // 연속 받아 적기(2026-09-13): 경계 찍기 · 건너뛰기 · 그만
    captureSkip: (args) => CaptureCmd.captureSkip(store, args),
    stopCapture: () => CaptureCmd.stopCapture(store),
    markersToBlocks: () => CaptureCmd.markersToBlocks(store, {}, { ids: browserEnv }),
    nameSelected: () => CaptureCmd.nameSelected(store, {}, { dialogs: browserDialogs })
  }
});

/**
 * 배치 시작 카운트로 영상을 옮기고 그 자리에서 재생한다.
 *
 * ⚠ YouTube 의 착지 오차는 0.5초라(capabilities.seekToleranceSec) 180bpm 에서 1카운트보다 크다 —
 *   "정확한 카운트로 점프"는 원리적으로 불가능하다. 대신 착지가 부정확할 뿐 **진행 자체는 정확**하므로,
 *   프리롤(`ceil(tolerance / spc) + 2` 카운트)만큼 앞을 겨냥해 탐색한 뒤 재생으로 통과시킨다
 *   (docs/PORTS.md '탐색은 정확하지 않다').
 * ⚠ 그래서 여기서 재생까지 한다. 멈춘 채 탐색만 하면 표본이 갱신되지 않아(폴링은 재생 중에만 돈다)
 *   재생 헤드가 옛 자리에 남는다. "누른 곳을 들려준다"가 이 조작의 뜻이기도 하다.
 * ⚠ play() 는 **클릭 콜스택 안에서** 불러야 한다(capabilities.needsUserGesture) — await 뒤로
 *   미루면 브라우저가 차단한다. 그래서 seek 을 기다리지 않고 곧바로 부른다.
 */
function seekToSpanStart(startSec) {
  const tempo = VideoCmd.mediaState(store).tempo;
  const tolerance = player.capabilities.seekToleranceSec;
  const spc = secondsPerCount(tempo);
  const preRoll = (Number.isFinite(tolerance) && spc > 0) ? (Math.ceil(tolerance / spc) + 2) * spc : 0;
  player.seek(Math.max(0, startSec - preRoll));
  player.play();
}

// 배치를 누르면 그 시각으로 영상이 이동한다.
// ⚠ **영상 패널이 열려 있을 때만** 동작한다 — 닫혀 있으면 첫 두 줄에서 물러나므로 선택 동작이
//   오늘과 한 글자도 다르지 않다. boardController 의 click 리스너와 같은 엘리먼트에 따로 붙으므로
//   그쪽의 stopPropagation 은 이 핸들러를 막지 않는다(stopImmediatePropagation 이 아니다).
boardEl.addEventListener('click', (e) => {
  if (!VideoCmd.panelState(store).open) return;
  if (!VideoCmd.isTempoReady(store)) return;
  if (e.target.closest(SEL.moveHandle) || e.target.closest(SEL.resizeHandle)) return;
  const placementEl = e.target.closest(SEL.placement);
  if (!placementEl) return;
  const groupId = placementEl.dataset[DATA.groupId];
  const board = store.board(BOARD_MAIN);
  const segments = board.placements.filter(p => p.groupId === groupId);
  const span = groupToSpan(segments, board.cols, VideoCmd.mediaState(store).tempo);
  if (!span) return;
  seekToSpanStart(span.startSec);
});

// 넓은 화면에서는 **열고 시작한다**(2026-09-12).
//
// 안무표를 채우는 길은 둘이고(docs/EDITING_FLOWS.md '방향은 둘뿐이다') 그중 하나가 영상에서
// 시작하는 길이다 — 영상을 보며 받아 적고, 마커를 찍고, 박자를 맞춘다. 패널을 닫아 두면 그 길의
// 입구가 화면에 아예 없어서, 도구가 "표를 먼저 적는 길" 하나만 있는 것처럼 보인다.
//
// ⚠ 좁은 화면(≤1040, 사이드바가 시트로 내려가는 폭)에서는 닫고 시작한다. 거기서는 패널이 안무표
//   **위로** 쌓여 세로를 절반 가까이 가져가므로, 열어 두는 것이 곧 안무표를 가리는 것이 된다.
// ⚠ 이 값은 여전히 휘발성이다 — 닫아 두어도 저장되지 않고 다음에 열면 다시 열려 있다. 켜고 끄는
//   기억을 남기면 "한 번 닫으면 그 길이 다시 안 보인다"가 되어 애초의 까닭을 스스로 무너뜨린다.
if (!isStacked()) VideoCmd.openPanel(store);
// 첫 동기화. 닫혀 있으면 패널은 hidden 그대로이고 재생기는 만들어지지 않는다.
views.video.render();
// ⚠ 자세 구획도 여기서 한 번 그린다. Dirty 라우팅을 타지 않는 첫 렌더라, 빠뜨리면 `인물` 줄이
//   분석 전에도 떠 있고 버튼의 잠김 상태가 마크업 그대로 남는다.
views.pose.render();
// ⚠ 여기서 격자 폭을 **다시** 잰다. 13절의 syncCellSize 는 보드를 그리기 전이라 잴 것이 없었고
//   (scrollWidth 0), 그 뒤 이 자리에서 패널이 열려 안무표에 남는 폭이 또 달라졌다.
//   이 한 줄이 없으면 처음 뜬 화면에서만 표가 가로로 넘친 채 남는다.
views.layout.syncCellSize();

// ─────────────────────────────────────────────────────────────────────────────
// 17. 문서 허브 — 상단 액션 줄에 '문서' 버튼을 붙인다
// ─────────────────────────────────────────────────────────────────────────────

createDocsHub({ container: document.querySelector('.top-actions') });

// ─────────────────────────────────────────────────────────────────────────────
// 18. 설정 — 영상 보관 폴더. 어댑터(clipLibrary·localStore)를 아는 자리는 여기다.
// ─────────────────────────────────────────────────────────────────────────────

const llmServer = createLlmServer();
// 자세 분석 모델은 **받아 두는 것까지만** 여기서 다룬다. 실제로 관절점을 뽑는 추정기는 아직 없다
// (ports/pose.js 계약과 domain/pose·rom·poseTracks 만 있다) — 설정에서 위치를 정해 두면 그것이 붙을 자리다.
const modelServer = createModelServer();

views.settings = createSettingsView({
  container: document.querySelector('.top-actions'),
  getClipSetting: loadClipSetting,
  saveClipSetting,
  clips: clipLibrary,
  llm: llmServer,
  models: modelServer,
  // 서버 모드면 설정은 서버의 것이다 — 폴더 선택 대신 경로 입력이고, 서버의 .clipserver.json 에 남는다.
  server: {
    isActive: () => !!clipServerConfig,
    getConfig: () => clipServer.getConfig(),
    setConfig: async (next) => {
      const cfg = await clipServer.setConfig(next);
      if (cfg) clipServerConfig = cfg;
      return cfg;
    }
  },
  getProjectName: projectNameForClips,
  previewDirParts: clipDirParts,
  // 폴더를 새로 지정했으면 지금 소스가 보관 경로를 가진 경우 곧바로 읽어 본다.
  onChange: () => { libraryAutoTriedFor = ''; serverClipOk = ''; views.video?.render(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. 말로 채우기 — 음성/텍스트 → LLM 다듬기 → 스키마 → 배치. LLM 은 서버가 부른다(키는 서버에만).
// ─────────────────────────────────────────────────────────────────────────────

createComposeView({
  container: document.querySelector('.top-actions'),
  llm: llmServer,
  getContext: () => {
    const st = store.get();
    const board = store.board(BOARD_MAIN);
    return {
      cols: board.cols, rows: board.rows,
      moves: st.library.map(m => m.name),
      categories: Object.fromEntries(Object.entries(st.categories).map(([k, v]) => [k, v.label]))
    };
  },
  previewPlan: (plan) => PlanCmd.previewPlan(store, plan),
  applyPlan: (plan, args) => PlanCmd.applyPlan(paletteCtx, plan, args),
  render,
  commitHistory: () => render(commitHistory(BOARD_MAIN)),
  getCols: () => store.board(BOARD_MAIN).cols,
  hasPlacements: () => store.board(BOARD_MAIN).placements.length > 0
});
