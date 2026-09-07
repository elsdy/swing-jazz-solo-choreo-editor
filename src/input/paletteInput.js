// src/input/paletteInput.js — 팔레트 카드의 입력 일체
//
// 원본 index.html 에서 옮긴 것:
//   attachMoveMenuTrigger(3210-3245)        이름 더블클릭 / 우클릭 / 480ms 롱프레스(8px 이동 시 취소)
//   buildCard 의 dragstart·dragend(3079-3092)  HTML5 드래그 — 두 보드의 drag 에 **같은 객체**를 대입
//   attachTouchDragToPaletteChip(3931-3975)  180ms 롱프레스 터치 드래그(메인 보드에만 놓는다)
//   moveTouchGhost(3976-3984) / clearTouchGhost(3985-3988)  고스트 이동·정리(DOM 은 overlays)
//
// ⚠ ui/paletteView 는 이 파일을 import 하지 않는다 — app/main 이 attachCardInput/attachNameTrigger 를
//    카드 팩토리에 **주입**한다. 그것이 오늘의 ui→input 교차(설계서 §0)를 없애는 방법이다.
// ⚠ dragstart(3082)는 activePaletteMove 를 null 로 만들 뿐 renderPalette 를 부르지 않는다.
//    그래서 cancelActivePaletteMove 의 **반환 Dirty 를 버린다**. 그리지 마라 — 원본과 달라진다.
// ⚠ 팔레트 터치 드래그는 원본이 mainCtx/boardEl 을 하드코딩했다(3937·3956·3963). 루틴 보드에는
//    터치로 놓을 수 없다 — 보존 대상 결함 #9 다. 여기서 boardId 를 인자로 빼지 마라.

import { SEL, CLS } from '../ui/domContract.js';
import { categoryColor } from '../domain/categories.js';

/**
 * 팔레트 카드 입력 배선을 만든다.
 *
 * @param {Object} deps
 * @param {Object} deps.store             store 인스턴스(읽기 전용)
 * @param {Object} deps.commands          커맨드 파사드
 *   cancelActivePaletteMove() -> Dirty   ⚠ 반환값을 버리는 호출부가 있다
 *   renameMove(moveId) -> Dirty          (paletteCommands.renameMove)
 *   placeMoveOnMain({ moveId, startRow, startIndex, totalCount }) -> Dirty
 *   commitMainHistory() -> Dirty|void    (saveHistory)
 * @param {(dirty: object) => void} deps.render
 * @param {HTMLElement} deps.mainBoardEl  원본 boardEl — 터치 드롭 대상은 언제나 메인 보드다
 * @param {Object} deps.overlays          ui/overlays 인스턴스(두 보드 공유 — 메서드가 boardId 를 받는다)
 *   showChipGhost({ background }) / moveChipGhost(x, y) / removeChipGhost()  ← body 싱글턴이라 boardId 없음
 *   clearTrackHighlights(boardId) / clearPreview(boardId) / updatePreview(boardId, row, startIndex, count)
 * @param {Object} deps.hitTest           input/hitTest 모듈 네임스페이스(hitTest(x,y,opts) · cellIndexAt)
 * @param {Object} deps.dragSession       input/dragSession 인스턴스(begin/current/update/end/BOTH_BOARDS)
 * @param {Function} deps.longPress       adapters/browser.longPress (주입 — input 은 adapters 를 import 하지 않는다)
 * @param {(moveId: string, x: number, y: number) => void} deps.openMoveContextMenu  ui/paletteView 소유
 * @returns {{ attachCardInput(cardEl: HTMLElement, move: object): void,
 *             attachNameTrigger(nameEl: HTMLElement, moveId: string): void }}
 */
export function createPaletteInput(deps) {
  const {
    store, commands, render, mainBoardEl, overlays,
    hitTest, dragSession, longPress, openMoveContextMenu, doc = document
  } = deps;

  const mainBoard = () => store.board('main');
  /** 원본 `document.elementFromPoint(x, y)?.closest('.track')` + `boardEl.contains` 판정(3951·3958·3981). */
  const hitAt = (x, y) => hitTest.hitTest(x, y, { doc, boardEl: mainBoardEl, board: mainBoard(), boardId: 'main' });
  const defaultCount = () => store.get().session.defaultCount;
  const apply = (dirty) => { if (dirty) render(dirty); };
  /** 커맨드가 실제로 무언가를 바꿨는가(NONE 은 빈 객체다). 원본의 조기 반환 = 히스토리 미커밋. */
  const changed = (dirty) => !!dirty && Object.keys(dirty).length > 0;

  /**
   * 카드의 드래그 입력. 원본 buildCard 의 dragstart(3079-3088)·dragend(3089-3096) +
   * attachTouchDragToPaletteChip(3931-3975).
   *
   * ⚠ 호출 시점: ui/paletteView 가 card.draggable = true 를 세우고 click 리스너를 붙인 **직후**.
   *   원본의 리스너 등록 순서(click → dragstart → dragend → touch*)가 그대로 유지된다.
   *
   * @param {HTMLElement} cardEl  원본은 chip 이 아니라 **card** 를 넘긴다(3103).
   * @param {{id: string, name: string, category: string}} move
   */
  function attachCardInput(cardEl, move) {
    // ── HTML5 드래그 ────────────────────────────────────────────────────────
    cardEl.addEventListener('dragstart', (e) => {
      if (e.target.closest(SEL.selectOrButton)) { e.preventDefault(); return; }
      // 3082: 활성 동작만 조용히 해제한다. renderPalette 를 부르지 않으므로 Dirty 를 **버린다**.
      commands.cancelActivePaletteMove();
      // 3083-3085: state.drag 와 reState.drag 에 **같은 객체**를 대입 = 두 보드가 받아들이는 한 세션.
      dragSession.begin('palette', { moveId: move.id, previewCount: defaultCount() },
        { boards: dragSession.BOTH_BOARDS });
      e.dataTransfer.setData('text/plain', move.id);
      e.dataTransfer.effectAllowed = 'copy';
    });

    cardEl.addEventListener('dragend', () => {
      dragSession.end();
      // 3090-3095: 두 보드의 하이라이트·프리뷰를 **모두** 지운다.
      overlays.clearTrackHighlights('main');
      overlays.clearPreview('main');
      overlays.clearTrackHighlights('routine');
      overlays.clearPreview('routine');
    });

    // ── 터치 드래그(180ms 롱프레스) ─────────────────────────────────────────
    // ⚠ 이동 취소 없음(moveTolerancePx: null), touchstart 에서 이전 타이머를 지우지 않는다
    //   (resetOnStart: false) — 원본 3934 가 pressTimer 를 그냥 덮어쓴다.
    longPress(cardEl, {
      delayMs: 180,
      moveTolerancePx: null,
      resetOnStart: false,
      onLongPress: ({ x, y }) => {
        // ⚠ 3936 은 mainCtx.drag 에만 대입한다 — 루틴 보드는 이 드래그를 받지 않는다(보존 결함 #9).
        dragSession.begin('palette', {
          moveId: move.id, isTouchDragging: true,
          lastX: x, lastY: y, previewCount: defaultCount()
        }, { boards: ['main'] });
        overlays.showChipGhost({ background: categoryColor(store.categories, move.category) });
        moveTouchGhost(x, y);
      }
    });

    // ⚠ passive:false — 드래그 중 스크롤을 막는다(3947).
    cardEl.addEventListener('touchmove', (e) => {
      const drag = dragSession.current('main');
      if (!drag?.isTouchDragging || drag.type !== 'palette') return;
      e.preventDefault();
      const touch = e.touches[0];
      moveTouchGhost(touch.clientX, touch.clientY);
      const hit = hitAt(touch.clientX, touch.clientY);
      if (hit.inBoard) {
        // 원본 3953: updatePreview(row, cellIdx, undefined, mainCtx) → 팔레트 드래그라 카운트는 DEFAULT_COUNT.
        overlays.updatePreview('main', hit.row, hit.col, defaultCount());
      }
    }, { passive: false });

    // ⚠ longPress 어댑터가 자기 touchend 로 타이머를 먼저 해제하고(3957 의 clearTimeout 자리),
    //   그 다음 이 리스너가 드롭을 처리한다 — 등록 순서가 원본과 같다.
    cardEl.addEventListener('touchend', () => {
      const drag = dragSession.current('main');
      if (!drag?.isTouchDragging || drag.type !== 'palette') return;
      const hit = hitAt(drag.lastX, drag.lastY);
      if (hit.inBoard) {
        apply(commands.placeMoveOnMain({
          moveId: drag.moveId,
          startRow: hit.row,
          startIndex: hit.col,
          totalCount: defaultCount()
        }));
        apply(commands.commitMainHistory());
      }
      clearTouchGhost();
      overlays.clearPreview('main');
      dragSession.end();
    });

    // ⚠ 드래그가 시작되지 않았어도 무조건 정리한다(3971-3975 그대로).
    cardEl.addEventListener('touchcancel', () => {
      clearTouchGhost();
      overlays.clearPreview('main');
      dragSession.end();
    });
  }

  /** 원본 moveTouchGhost(3976-3984). ⚠ 여기서는 프리뷰를 건드리지 않는다(touchmove 가 따로 한다). */
  function moveTouchGhost(x, y) {
    if (dragSession.current('main')) dragSession.update({ lastX: x, lastY: y });   // 3977
    overlays.moveChipGhost(x, y);
    overlays.clearTrackHighlights('main');
    const hit = hitAt(x, y);
    if (hit.inBoard) hit.track.classList.add(CLS.dropHover);
  }

  /** 원본 clearTouchGhost(3985-3988). */
  function clearTouchGhost() {
    overlays.clearTrackHighlights('main');
    overlays.removeChipGhost();
  }

  /**
   * 동작 이름 요소의 메뉴 트리거. 원본 attachMoveMenuTrigger(3210-3245).
   * ⚠ 원본은 nameEl 에만 건다(3121). 카드 전체가 아니다.
   *
   * @param {HTMLElement} nameEl
   * @param {string} moveId
   */
  function attachNameTrigger(nameEl, moveId) {
    nameEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dirty = commands.renameMove(moveId);
      apply(dirty);
      // 3195: 취소·빈 이름이면 원본도 saveHistory 를 부르지 않는다(조기 반환).
      if (changed(dirty)) apply(commands.commitMainHistory());
    });

    nameEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMoveContextMenu(moveId, e.clientX, e.clientY);
    });

    // 480ms 롱프레스 + 8px 이동 시 취소 + touchstart 에서 이전 타이머 해제.
    longPress(nameEl, {
      delayMs: 480,
      moveTolerancePx: 8,
      resetOnStart: true,
      onLongPress: ({ x, y }) => openMoveContextMenu(moveId, x, y)
    });
  }

  return { attachCardInput, attachNameTrigger };
}
