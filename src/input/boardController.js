// src/input/boardController.js — 보드 1개당 위임 이벤트 컨트롤러
//
// 원본 index.html 의 bindBoardDelegatedEvents(2389-2785) 전체를 그대로 옮겼다.
// 원본은 mainCtx(1521)와 reCtx(4856) 두 번 불려 보드마다 자기 클로저 상태
// (drawState / quickDrawState / quickTouchAnchor / lastTapTime / lastTapGroupId)를 따로 가졌고,
// document 레벨 mouseup 리스너도 보드마다 하나씩 총 2개가 붙었다. 인스턴스 2개가 그것을 재현한다.
//
// ⚠ 이 파일이 지켜야 하는 것들
//   1. 리스너 등록 **순서**와 등록 **대상**(el 인지 document 인지), passive/capture 플래그,
//      preventDefault 의 위치가 원본과 한 줄도 다르면 안 된다.
//   2. 마우스 경로와 터치 경로는 **다른 규칙**을 쓴다. 통일하지 마라.
//        - 마우스 그리기: 행 넘김 O, totalCellsFrom 클램프 O
//        - 터치 그리기(2709): 행 넘김 X, 클램프 X, drawState.track 한 행 안에서만 센다
//   3. 드래그 카운트의 **하한**이 곳마다 다르다. 프리뷰는 1, 커밋은 DEFAULT_COUNT 다.
//      → domain/gestureMath.resolveDragCount 에 lowerBound 로 넘긴다.
//   4. `ctx === mainCtx` 4곳(2429 drop · 2470 dblclick · 2503 mousedown(리사이즈) · 2539 touchstart(더블탭))은
//      생성 시 policy 로 사라진다. 2446(click)의 `ctx !== mainCtx` 는 policy.allowsSelection 이다.
//   5. 커맨드·협력자는 전부 **주입**받는다 — usecases 도, 형제 input 모듈도 import 하지 않는다.
//      import 하는 것은 domContract(같은 rank 3 의 유일한 예외)와 domain 순수 함수뿐이다.

import { SEL, CLS, DATA } from '../ui/domContract.js';
import { resolveDragCount, isDoubleTap, QUICK_DRAG_THRESHOLD_PX } from '../domain/gestureMath.js';
import { groupCount } from '../domain/placements.js';

/**
 * 보드 하나에 위임 리스너를 건다.
 *
 * @param {Object} deps
 * @param {HTMLElement} deps.el              보드 루트(`#board` / `#reBoard`). 원본 ctx.el.
 * @param {'main'|'routine'} deps.boardId
 * @param {Object} deps.store                app/main 이 만든 store 인스턴스(읽기 전용으로만 쓴다)
 * @param {Object} deps.commands             보드에 미리 묶인 커맨드 파사드(아래 표 참조)
 * @param {(dirty: object) => void} deps.render
 * @param {Object} deps.overlays             ui/overlays 인스턴스(두 보드 공유 — 메서드가 boardId 를 받는다)
 * @param {Object} deps.hitTest              input/hitTest 모듈 네임스페이스 그대로
 *   (`import * as hitTest from './hitTest.js'` — hitTest(x, y, opts) 와 cellIndexAt 만 쓴다)
 * @param {Object} deps.dragSession          input/dragSession 인스턴스(앱 전체에 하나)
 * @param {Object} deps.pointerSession       input/pointerSession 인스턴스(앱 전체에 하나)
 * @param {Object} deps.touchDrag            input/touchDrag 인스턴스(이 보드의 것)
 * @param {Object} deps.quickPicker          ui/quickPicker 인스턴스(이 보드의 것)
 * @param {Object} [deps.routineActionPopup] ui/routineActionPopup (메인 보드만 쓴다)
 * @param {Object} [deps.policy]             기본값 store.policy(boardId)
 * @param {Document} [deps.doc]              기본값 document (document mouseup 등록 대상)
 * @returns {{ boardId: string, el: HTMLElement }}
 *
 * commands 파사드(전부 이 보드의 boardId 가 이미 묶여 있어야 한다):
 *   placeMove({ moveId, startRow, startIndex, totalCount }) -> Dirty
 *   placeRoutine({ routineId, startRow, startIndex })       -> Dirty
 *   moveGroup({ groupId, targetRow, targetStartIndex })     -> Dirty
 *   copyGroup({ groupId, targetRow, targetStartIndex })     -> Dirty
 *   removeGroup({ groupId })                                -> Dirty
 *   toggleSelection({ groupId })                            -> Dirty
 *   commitHistory()                                         -> Dirty|void   (saveHistory / saveHistoryRe)
 */
export function createBoardController(deps) {
  const {
    el,
    boardId,
    store,
    commands,
    render,
    overlays,
    hitTest,
    dragSession,
    pointerSession,
    touchDrag,
    quickPicker,
    routineActionPopup = null,
    policy = store.policy(boardId),
    doc = document
  } = deps;

  // ── 상태 읽기 도우미 ────────────────────────────────────────────────────────
  // ⚠ store.update 는 매번 새 최상위 상태 객체를 만든다. 값을 캡처하지 말고 그때그때 읽어라.

  /** 원본 ctx.rows/cols/placements 에 해당하는 BoardDoc. */
  const board = () => store.board(boardId);
  /** 원본의 가변 모듈 전역 DEFAULT_COUNT(1384). */
  const defaultCount = () => store.get().session.defaultCount;
  /** 원본 ctx.quickPlaceMode. 보드별로 완전히 독립이다. */
  const quickPlaceMode = () => store.get().session.quickPlaceMode[boardId];
  /** 원본 ctx.activePaletteMove. 루틴 보드 쪽은 항상 null 이다(reState 에 null 만 대입된다). */
  const activePaletteMove = () => store.get().session.activePaletteMove[boardId];
  /** 원본 pointerToCellIndex(track, clientX, ctx). */
  const cellIndex = (track, clientX) => hitTest.cellIndexAt(track, clientX, board());
  /** 원본 ctx.drag. ⚠ boardId 를 넘겨야 "이 보드가 받아들이는 드래그"만 보인다(dragSession 계약). */
  const currentDrag = () => dragSession.current(boardId);
  /** 원본 `document.elementFromPoint(x, y)?.closest('.track')` + 보드 포함 판정 + 앵커 폴백. */
  const hitAt = (clientX, clientY, options = {}) =>
    hitTest.hitTest(clientX, clientY, { doc, boardEl: el, board: board(), boardId, ...options });

  /** Dirty 를 그린다. 커맨드가 NONE(={}) 이나 void 를 돌려줘도 안전하다. */
  const apply = (dirty) => { if (dirty) render(dirty); };
  /** 원본 _saveHistory() — saveHistory() 또는 saveHistoryRe(). */
  const commit = () => apply(commands.commitHistory());

  /**
   * 원본 updatePreview(row, startIndex, undefined, ctx)(3900-3906)의 카운트 결정부.
   * overrideCount 가 없을 때 ctx.drag 의 종류로 카운트를 정하던 부분만 여기로 올라왔다.
   * ⚠ drag 가 없으면 원본은 clearPreview() 를 부른 **뒤** 조기 반환한다(3901-3902).
   */
  function updatePreviewFromDrag(row, startIndex) {
    const drag = currentDrag();
    if (!drag) { overlays.clearPreview(boardId); return; }
    const count = drag.type === 'palette'
      ? defaultCount()
      : groupCount(board().placements, drag.groupId);
    overlays.updatePreview(boardId, row, startIndex, count);
  }

  // ── ① dragover (2394-2401) ─────────────────────────────────────────────────
  // ⚠ 여기만 elementFromPoint 가 아니라 e.target.closest 를 쓴다 — hitTest 로 바꾸지 마라.
  el.addEventListener('dragover', (e) => {
    const track = e.target.closest(SEL.track);
    if (!track) return;
    e.preventDefault();
    overlays.clearTrackHighlights(boardId);
    track.classList.add(CLS.dropHover);
    updatePreviewFromDrag(Number(track.dataset[DATA.row]), cellIndex(track, e.clientX));
  });

  // ── ② dragleave (2403-2409) ────────────────────────────────────────────────
  // ⚠ clearPreview 는 하지 않는다(원본에 없다).
  el.addEventListener('dragleave', (e) => {
    const track = e.target.closest(SEL.track);
    if (!track) return;
    const related = e.relatedTarget;
    if (related && track.contains(related)) return;
    track.classList.remove(CLS.dropHover);
  });

  // ── ③ drop (2411-2433) ─────────────────────────────────────────────────────
  el.addEventListener('drop', (e) => {
    const track = e.target.closest(SEL.track);
    if (!track) return;
    e.preventDefault();
    overlays.clearTrackHighlights(boardId);
    const row = Number(track.dataset[DATA.row]);
    const startIndex = cellIndex(track, e.clientX);
    overlays.clearPreview(boardId);
    const drag = currentDrag();
    if (drag?.type === 'palette') {
      apply(commands.placeMove({ moveId: drag.moveId, startRow: row, startIndex, totalCount: defaultCount() }));
      commit();
    } else if (drag?.type === 'placement-move') {
      if (drag.copyMode) {
        apply(commands.copyGroup({ groupId: drag.groupId, targetRow: row, targetStartIndex: startIndex }));
      } else {
        apply(commands.moveGroup({ groupId: drag.groupId, targetRow: row, targetStartIndex: startIndex }));
      }
      commit();
    } else if (drag?.type === 'routine' && policy.allowsRoutineBlocks) {   // 2429 `ctx === mainCtx`
      apply(commands.placeRoutine({ routineId: drag.routineId, startRow: row, startIndex }));
      commit();
    }
    // 2432 `ctx.drag = null` — 세션이 하나라 모든 보드에서 끝난다(dragSession 계약).
    dragSession.end();
  });

  // ── ④ click — 선택 토글 / 루틴 팝업 (2435-2465) ────────────────────────────
  el.addEventListener('click', (e) => {
    // 핸들 클릭은 무시 (드래그/리사이즈 용도)
    if (e.target.closest(SEL.moveHandle) || e.target.closest(SEL.resizeHandle)) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl) return;
    if (!policy.allowsSelection) return;   // 2446 `if (ctx !== mainCtx) return;`

    const groupId = placementEl.dataset[DATA.groupId];

    // 루틴 배치 단일 클릭 → 편집/삭제 팝업
    if (placementEl.classList.contains(CLS.isRoutine)) {
      const placement = board().placements.find(p => p.groupId === groupId);
      if (!placement) return;
      e.stopPropagation();
      routineActionPopup?.open(placement, e.clientX, e.clientY);
      return;
    }

    // 일반 배치 클릭 → 선택 토글
    // ⚠ 클래스 토글(2461-2463)은 Dirty.selection → boardView.setSelected 가 한다.
    //   행을 다시 그리는 것으로 대체하지 마라(드래그·툴팁·포커스가 끊긴다).
    e.stopPropagation();
    apply(commands.toggleSelection({ groupId }));
  });

  // ── ⑤ dblclick — 마우스 삭제 (2467-2474) ───────────────────────────────────
  el.addEventListener('dblclick', (e) => {
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl) return;
    // 2470: 루틴은 팝업으로 처리 (`ctx === mainCtx`)
    if (placementEl.classList.contains(CLS.isRoutine) && policy.allowsRoutineBlocks) return;
    const groupId = placementEl.dataset[DATA.groupId];
    apply(commands.removeGroup({ groupId }));
    commit();
  });

  // ── ⑥ dragstart — 블록 이동/복사 (2476-2487) ───────────────────────────────
  // ⚠ copyMode(e.altKey)는 dragstart 시점에 **한 번만** 캡처한다. drop 에서 다시 읽지 않는다.
  el.addEventListener('dragstart', (e) => {
    const moveHandle = e.target.closest(SEL.moveHandle);
    if (!moveHandle) return;
    const placementEl = moveHandle.closest(SEL.placement);
    if (!placementEl) return;
    const groupId = placementEl.dataset[DATA.groupId];
    const copyMode = e.altKey;
    dragSession.begin('placement-move', { groupId, copyMode }, { boards: [boardId] });
    e.dataTransfer.effectAllowed = copyMode ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', groupId);
    if (!copyMode) overlays.markDraggingGroup(boardId, groupId);
  });

  // ── ⑦ dragend (2489-2495) ──────────────────────────────────────────────────
  el.addEventListener('dragend', (e) => {
    if (!e.target.closest(SEL.moveHandle)) return;
    dragSession.end();
    overlays.clearTrackHighlights(boardId);
    overlays.clearPreview(boardId);
    overlays.unmarkDraggingGroups(boardId);
  });

  // ── ⑧ mousedown — 리사이즈 시작 (2497-2507) ────────────────────────────────
  el.addEventListener('mousedown', (e) => {
    const resizeHandle = e.target.closest(SEL.resizeHandle);
    if (resizeHandle) {
      e.preventDefault();
      const placementEl = resizeHandle.closest(SEL.placement);
      if (!placementEl) return;
      // 2503: 메인 보드의 루틴 블록은 리사이즈 금지 (`ctx === mainCtx`)
      if (placementEl.classList.contains(CLS.isRoutine) && policy.allowsRoutineBlocks) return;
      pointerSession.start(boardId, placementEl.dataset[DATA.groupId], e.clientX);
      return;
    }
  });

  // 모바일 더블탭 삭제를 위한 상태 (2509-2511)
  let lastTapTime = 0;
  let lastTapGroupId = null;

  // ── ⑨ touchstart — 핸들 + 더블탭 삭제 (2513-2549, passive:false) ───────────
  el.addEventListener('touchstart', (e) => {
    const resizeHandle = e.target.closest(SEL.resizeHandle);
    if (resizeHandle) {
      e.preventDefault();
      const placementEl = resizeHandle.closest(SEL.placement);
      if (!placementEl) return;
      // ⚠ 여기에는 is-routine 가드가 없다(마우스 경로 2503 에만 있다) — 원본 그대로 둔다.
      overlays.hideFloatingTooltip();
      pointerSession.start(boardId, placementEl.dataset[DATA.groupId], e.touches[0].clientX);
      return;
    }
    const moveHandle = e.target.closest(SEL.moveHandle);
    if (moveHandle) {
      e.preventDefault();
      const placementEl = moveHandle.closest(SEL.placement);
      if (!placementEl) return;
      overlays.showFloatingTooltip(placementEl);
      touchDrag.start(placementEl.dataset[DATA.groupId], e.touches[0].clientX, e.touches[0].clientY);
      return;
    }
    // 더블탭으로 배치 삭제 (move-handle, resize-handle 외 영역 터치 시)
    const placementEl = e.target.closest(SEL.placement);
    if (placementEl) {
      const groupId = placementEl.dataset[DATA.groupId];
      const now = Date.now();
      if (isDoubleTap(now, lastTapTime, groupId, lastTapGroupId)) {
        e.preventDefault();
        // ⚠ preventDefault 뒤에 루틴 가드가 온다(2539). 이 조기 반환은 lastTapTime 을
        //   되돌리지 않아 다음 탭이 다시 더블탭으로 잡힌다 — 원본 동작이다.
        if (placementEl.classList.contains(CLS.isRoutine) && policy.allowsRoutineBlocks) return;
        apply(commands.removeGroup({ groupId }));
        commit();
        lastTapTime = 0;
        lastTapGroupId = null;
      } else {
        lastTapTime = now;
        lastTapGroupId = groupId;
      }
    }
  }, { passive: false });

  // ── ⑩ touchmove — 리사이즈 / 블록 이동 (2551-2563, passive:false) ──────────
  el.addEventListener('touchmove', (e) => {
    // 리사이즈 처리 (보드 레벨에서 preventDefault 보장)
    if (pointerSession.isActive(boardId)) {
      e.preventDefault();
      const touch = e.touches[0];
      pointerSession.applyPreview(touch.clientX, touch.clientY);
      return;
    }
    const drag = currentDrag();
    if (drag?.type !== 'placement-move' || !drag.isTouchDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    touchDrag.moveGhost(touch.clientX, touch.clientY);
  }, { passive: false });

  // ── ⑪ touchend — 리사이즈 / 블록 이동 종료 (2565-2573) ─────────────────────
  el.addEventListener('touchend', () => {
    overlays.hideFloatingTooltip();
    if (pointerSession.isActive(boardId)) {
      pointerSession.stopTouch();
      return;
    }
    const drag = currentDrag();
    if (drag?.type !== 'placement-move' || !drag.isTouchDragging) return;
    touchDrag.finish(false);
  });

  // ── ⑫ touchcancel (2575-2583) ──────────────────────────────────────────────
  el.addEventListener('touchcancel', () => {
    overlays.hideFloatingTooltip();
    if (pointerSession.isActive(boardId)) {
      pointerSession.stopTouch();
      return;
    }
    const drag = currentDrag();
    if (drag?.type !== 'placement-move' || !drag.isTouchDragging) return;
    touchDrag.finish(true);
  });

  // ── ⑬⑭ mouseenter / mouseleave — 툴팁 (2585-2596, capture:true) ────────────
  // ⚠ mouseenter/mouseleave 는 버블링하지 않으므로 capture 로 보드에서 가로챈다.
  el.addEventListener('mouseenter', (e) => {
    const p = e.target.closest(SEL.placement);
    if (!p) return;
    overlays.showFloatingTooltip(p);
  }, true);
  el.addEventListener('mouseleave', (e) => {
    const p = e.target.closest(SEL.placement);
    if (!p) return;
    if (e.relatedTarget && p.contains(e.relatedTarget)) return;
    overlays.hideFloatingTooltip();
  }, true);

  // ── Click-to-activate + draw-to-place (2598-2605) ──────────────────────────
  let drawState = null;
  let quickDrawState = null;

  /**
   * 원본 drawPreview(2601-2605). **터치 그리기 경로에서만** 쓰인다 —
   * 마우스 경로는 calcCrossRowCount 를 직접 쓴다(하한·행 넘김 규칙이 다르다).
   */
  function drawPreview(row, startIndex, endIndex) {
    const count = Math.max(1, endIndex - startIndex + 1);
    overlays.updatePreview(boardId, row, startIndex, count);
  }

  // ── ⑮ mousedown — 그리기 / 빠른 배치 시작 (2606-2627) ──────────────────────
  el.addEventListener('mousedown', (e) => {
    if (quickPlaceMode() && !activePaletteMove() && !drawState) {
      if (e.target.closest(SEL.placementOrHandles)) return;
      const track = e.target.closest(SEL.track);
      if (!track) return;
      e.preventDefault();
      const row = Number(track.dataset[DATA.row]);
      const startIndex = cellIndex(track, e.clientX);
      quickDrawState = { row, startIndex, track, count: defaultCount(), clientX: e.clientX, clientY: e.clientY };
      overlays.updatePreview(boardId, row, startIndex, defaultCount());
      return;
    }
    if (!activePaletteMove()) return;
    const track = e.target.closest(SEL.track);
    if (!track) return;
    if (e.target.closest(SEL.placementOrHandles)) return;
    e.preventDefault();
    const row = Number(track.dataset[DATA.row]);
    const startIndex = cellIndex(track, e.clientX);
    drawState = { row, startIndex, track };
    drawPreview(row, startIndex, startIndex);
  });

  /**
   * 마우스 그리기 3곳(2631-2635 · 2647-2651 · 2668-2672)이 공유하는 끝점 해석.
   * ⚠ 보드 밖으로 끌면 앵커 트랙으로 되돌아간다 — "보드 밖에서도 카운트가 시작 행 기준"이라는
   *   관찰 동작이다. hitTest 의 fallbackTrack/fallbackRow 가 그 세 줄을 그대로 낸다.
   */
  function resolveEnd(anchor, clientX, clientY) {
    const hit = hitAt(clientX, clientY, { fallbackTrack: anchor.track, fallbackRow: anchor.row });
    return { endRow: hit.row, endCol: hit.col };
  }

  // ── ⑯ mousemove — 그리기 카운트 추적 (2629-2656) ───────────────────────────
  el.addEventListener('mousemove', (e) => {
    if (quickDrawState) {
      const { endRow, endCol } = resolveEnd(quickDrawState, e.clientX, e.clientY);
      const count = resolveDragCount({
        startRow: quickDrawState.row, startIndex: quickDrawState.startIndex,
        endRow, endCol, board: board(), lowerBound: 1            // 2636: 프리뷰 하한 1
      });
      quickDrawState.count = count;
      quickDrawState.clientX = e.clientX;
      quickDrawState.clientY = e.clientY;
      overlays.updatePreview(boardId, quickDrawState.row, quickDrawState.startIndex, count);
      return;
    }
    if (!drawState || !activePaletteMove()) return;
    const { endRow, endCol } = resolveEnd(drawState, e.clientX, e.clientY);
    const count = resolveDragCount({
      startRow: drawState.row, startIndex: drawState.startIndex,
      endRow, endCol, board: board(), lowerBound: 1              // 2653: 프리뷰 하한 1
    });
    overlays.updatePreview(boardId, drawState.row, drawState.startIndex, count);
  });

  // ── ⑰ document mouseup — 그리기 확정 (2658-2683) ───────────────────────────
  // ⚠ el 이 아니라 document 에 붙는다. 보드마다 1개씩 총 2개가 등록되는 것이 원본이다.
  doc.addEventListener('mouseup', (e) => {
    if (quickDrawState && quickPlaceMode()) {
      const { row, startIndex, count, clientX, clientY } = quickDrawState;
      quickDrawState = null;
      // ⚠ 프리뷰를 **지우지 않는다** — 팝업이 뜬 동안 어디에 놓일지 보여 주는 것이 원본이다.
      quickPicker.open(row, startIndex, clientX, clientY, count);
      return;
    }
    if (quickDrawState) { quickDrawState = null; overlays.clearPreview(boardId); return; }
    if (drawState && activePaletteMove()) {
      const { endRow, endCol } = resolveEnd(drawState, e.clientX, e.clientY);
      const count = resolveDragCount({
        startRow: drawState.row, startIndex: drawState.startIndex,
        endRow, endCol, board: board(), lowerBound: defaultCount()  // 2673: 커밋 하한 DEFAULT_COUNT
      });
      apply(commands.placeMove({
        moveId: activePaletteMove().moveId,
        startRow: drawState.row, startIndex: drawState.startIndex, totalCount: count
      }));
      commit();
      overlays.clearPreview(boardId);
      drawState = null;
    }
  });

  // ── ⑱⑲⑳㉑ 터치 그리기 (2685-2721) ⚠ touchstart·touchmove 만 passive:true ──
  el.addEventListener('touchstart', (e) => {
    if (!activePaletteMove()) return;
    const touch = e.touches[0];
    const hit = hitAt(touch.clientX, touch.clientY);
    if (!hit.inBoard) return;                       // 2689 `!track || !el.contains(track)`
    if (e.target.closest(SEL.placementOrHandles)) return;
    e.stopPropagation();
    drawState = { row: hit.row, startIndex: hit.col, track: hit.track };
    drawPreview(hit.row, hit.col, hit.col);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!drawState || !activePaletteMove()) return;
    const touch = e.touches[0];
    // ⚠ drawState.track **한 행 안에서만** 센다. 행 넘김 없음(마우스 경로와 다르다).
    const endIndex = cellIndex(drawState.track, touch.clientX);
    drawPreview(drawState.row, drawState.startIndex, endIndex);
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (!drawState || !activePaletteMove()) return;
    const touch = (e.changedTouches || e.touches)[0];
    const endIndex = cellIndex(drawState.track, touch.clientX);
    // 2709: crossRow:false — calcCrossRowCount 도 totalCellsFrom 클램프도 쓰지 않는다.
    const count = resolveDragCount({
      startRow: drawState.row, startIndex: drawState.startIndex,
      endRow: drawState.row, endCol: endIndex,
      board: board(), lowerBound: defaultCount(), crossRow: false
    });
    apply(commands.placeMove({
      moveId: activePaletteMove().moveId,
      startRow: drawState.row, startIndex: drawState.startIndex, totalCount: count
    }));
    commit();
    overlays.clearPreview(boardId);
    drawState = null;
  });

  el.addEventListener('touchcancel', () => {
    if (!drawState) return;
    overlays.clearPreview(boardId);
    drawState = null;
  });

  // ── ㉒㉓㉔㉕ 빠른 배치 모드 터치 드래그 (2723-2772) ────────────────────────
  // 빈 트랙 터치 드래그 → quickPicker (드래그로 카운트 선택)
  let quickTouchAnchor = null;

  el.addEventListener('touchstart', (e) => {
    if (!quickPlaceMode() || activePaletteMove() || drawState) return;
    if (e.target.closest(SEL.placementOrHandles)) return;
    const touch = e.touches[0];
    const hit = hitAt(touch.clientX, touch.clientY);
    if (!hit.inBoard) return;
    quickTouchAnchor = {
      x: touch.clientX, y: touch.clientY, track: hit.track, row: hit.row, startIndex: hit.col,
      count: defaultCount(), isDrag: false
    };
    overlays.updatePreview(boardId, hit.row, hit.col, defaultCount());
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!quickPlaceMode() || !quickTouchAnchor) return;
    const touch = e.touches[0];
    const dx = touch.clientX - quickTouchAnchor.x;
    const dy = touch.clientY - quickTouchAnchor.y;
    // 2740-2742: 12px 이동 임계로 탭/드래그 구분
    if (Math.abs(dx) > QUICK_DRAG_THRESHOLD_PX || Math.abs(dy) > QUICK_DRAG_THRESHOLD_PX) {
      quickTouchAnchor.isDrag = true;
    }
    if (!quickTouchAnchor.isDrag) return;
    const { endRow, endCol } = resolveEnd(quickTouchAnchor, touch.clientX, touch.clientY);
    const count = resolveDragCount({
      startRow: quickTouchAnchor.row, startIndex: quickTouchAnchor.startIndex,
      endRow, endCol, board: board(), lowerBound: 1              // 2753: 프리뷰 하한 1
    });
    quickTouchAnchor.count = count;
    quickTouchAnchor.clientX = touch.clientX;
    quickTouchAnchor.clientY = touch.clientY;
    overlays.updatePreview(boardId, quickTouchAnchor.row, quickTouchAnchor.startIndex, count);
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (!quickPlaceMode() || !quickTouchAnchor) return;
    const touch = (e.changedTouches || e.touches)[0];
    const { row, startIndex, isDrag } = quickTouchAnchor;
    const count = isDrag ? quickTouchAnchor.count : defaultCount();
    const cx = isDrag ? (quickTouchAnchor.clientX || touch.clientX) : touch.clientX;
    const cy = isDrag ? (quickTouchAnchor.clientY || touch.clientY) : touch.clientY;
    const cellIdx = isDrag ? startIndex : cellIndex(quickTouchAnchor.track, touch.clientX);
    quickTouchAnchor = null;
    // ⚠ 마우스 경로(2661-2665)와 달리 여기서는 프리뷰를 **지운 뒤** 팝업을 연다(2770).
    overlays.clearPreview(boardId);
    quickPicker.open(row, cellIdx, cx, cy, count);
  });

  el.addEventListener('touchcancel', () => {
    if (quickTouchAnchor) { quickTouchAnchor = null; overlays.clearPreview(boardId); }
  });

  return { boardId, el };
}
