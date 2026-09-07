// src/input/touchDrag.js — 보드 위 배치의 터치 이동 제스처
//
// 원본 index.html 의 startTouchPlacementMove(3836-3853) · moveTouchPlacementGhost(3855-3869) ·
// finishTouchPlacementMove(3871-3890) 세 함수를 그대로 옮겼다.
// 고스트 DOM 은 ui/overlays 가 그리고(주입), 여기는 제스처 판정과 커맨드 호출만 한다.
//
// ⚠ 원본 3881 의 `ctx === mainCtx ? saveHistory() : saveHistoryRe()` 는
//    boardId 에 묶인 commands.commitHistory() 하나로 대칭화된다.
// ⚠ unmarkDraggingGroups 가 이 흐름에서 **세 번** 불린다 —
//    시작(3876) · movePlacementGroup 안(3665, 커맨드의 deps.unmarkDragging) · ctx.drag=null 뒤(3885).
//    줄이지 마라. 마지막 renderRows(allRows)(3889)도 그대로 남긴다.

import { CLS } from '../ui/domContract.js';
import { getGroup, groupCount } from '../domain/placements.js';
import { resolvePlacementColor } from '../domain/categories.js';

/**
 * 보드 하나의 터치 이동 세션을 만든다. boardController 가 touchstart/touchmove/touchend 에서 부른다.
 *
 * @param {Object} deps
 * @param {HTMLElement} deps.el          보드 루트(원본 ctx.el)
 * @param {'main'|'routine'} deps.boardId
 * @param {Object} deps.store            store 인스턴스(읽기 전용)
 * @param {Object} deps.commands         boardId 가 묶인 커맨드 파사드
 *   moveGroup({ groupId, targetRow, targetStartIndex }) -> Dirty
 *   commitHistory() -> Dirty|void
 * @param {(dirty: object) => void} deps.render
 * @param {Object} deps.overlays         ui/overlays 인스턴스(두 보드 공유 — 메서드가 boardId 를 받는다)
 *   showPlacementGhost({ text, background }) / movePlacementGhost(x, y) / removePlacementGhost()
 *   markDraggingGroup(boardId, groupId) / unmarkDraggingGroups(boardId)
 *   updatePreview(boardId, row, startIndex, count) / clearPreview(boardId) / clearTrackHighlights(boardId)
 * @param {Object} deps.hitTest          input/hitTest 모듈 네임스페이스(hitTest(x,y,opts) · cellIndexAt)
 * @param {Object} deps.dragSession      input/dragSession 인스턴스(begin/current/update/end)
 * @returns {{ start(groupId: string, x: number, y: number): void,
 *             moveGhost(x: number, y: number): void,
 *             finish(cancelled?: boolean): void }}
 */
export function createPlacementTouchDrag(deps) {
  const { el, boardId, store, commands, render, overlays, hitTest, dragSession, doc = document } = deps;

  /** 원본 `document.elementFromPoint(x, y)?.closest('.track')` + `ctx.el.contains` 판정. */
  const hitAt = (x, y) => hitTest.hitTest(x, y, { doc, boardEl: el, board: board(), boardId });

  const board = () => store.board(boardId);
  const apply = (dirty) => { if (dirty) render(dirty); };

  /**
   * 원본 updatePreview(row, startIndex, undefined, ctx)(3900-3906)의 카운트 결정부.
   * ⚠ boardController 에도 같은 5줄이 있다 — 원본은 updatePreview 하나를 공유했지만
   *   input/** 끼리는 서로 import 하지 않는 것이 이 PR 의 계층 규칙이라 각자 갖는다.
   */
  function updatePreviewFromDrag(row, startIndex) {
    const drag = dragSession.current(boardId);
    if (!drag) { overlays.clearPreview(boardId); return; }
    const count = drag.type === 'palette'
      ? store.get().session.defaultCount
      : groupCount(board().placements, drag.groupId);
    overlays.updatePreview(boardId, row, startIndex, count);
  }

  /**
   * 터치 이동 시작. 원본 startTouchPlacementMove(3836-3853).
   * @param {string} groupId
   * @param {number} x
   * @param {number} y
   */
  function start(groupId, x, y) {
    const group = getGroup(board().placements, groupId);
    if (!group.length) return;
    dragSession.begin('placement-move', { groupId, isTouchDragging: true, lastX: x, lastY: y }, { boards: [boardId] });
    overlays.markDraggingGroup(boardId, groupId);
    // 고스트 색은 **끌고 있는 블록과 같은 색**이어야 한다. 원본은 루틴일 때 고정 '#6366f1' 을
    // 썼는데, 그때는 안무표의 루틴 블록도 전부 같은 남보라라 우연히 맞았다. 2026-09-07 에
    // 블록이 루틴 색으로 그려지게 되면서 그 상수는 손을 대는 순간 색이 바뀌는 원인이 됐다.
    // resolvePlacementColor 의 `base`(그러데이션이 아닌 단색)를 쓰면 두 자리가 같은 값을 쓴다.
    const background = resolvePlacementColor(group[0], {
      categories: store.categories,
      routines: store.routines || [],
    }).base;
    overlays.showPlacementGhost({
      text: `${group[0].name} ${groupCount(board().placements, groupId)}c`,
      background
    });
    moveGhost(x, y);
  }

  /**
   * 고스트 이동 + 드롭 대상 하이라이트 + 프리뷰. 원본 moveTouchPlacementGhost(3855-3869).
   * @param {number} x
   * @param {number} y
   */
  function moveGhost(x, y) {
    if (!dragSession.current(boardId)) return;
    dragSession.update({ lastX: x, lastY: y });   // 3857-3858
    overlays.movePlacementGhost(x, y);
    overlays.clearTrackHighlights(boardId);
    const hit = hitAt(x, y);
    if (hit.inBoard) {
      hit.track.classList.add(CLS.dropHover);
      updatePreviewFromDrag(hit.row, hit.col);
    } else {
      overlays.clearPreview(boardId);
    }
  }

  /**
   * 터치 이동 종료. 원본 finishTouchPlacementMove(3871-3890).
   * @param {boolean} [cancelled=false] touchcancel 이면 true — 이동을 적용하지 않는다.
   */
  function finish(cancelled = false) {
    const drag = dragSession.current(boardId);
    overlays.clearTrackHighlights(boardId);
    overlays.clearPreview(boardId);
    overlays.removePlacementGhost();
    overlays.unmarkDraggingGroups(boardId);
    if (!cancelled && drag) {
      const hit = hitAt(drag.lastX, drag.lastY);
      if (hit.inBoard) {
        apply(commands.moveGroup({
          groupId: drag.groupId,
          targetRow: hit.row,
          targetStartIndex: hit.col
        }));
        apply(commands.commitHistory());   // 3881 `ctx === mainCtx ? saveHistory() : saveHistoryRe()`
      }
    }
    dragSession.end();
    overlays.unmarkDraggingGroups(boardId);   // 3885 — 두 번째 호출(원본 그대로)
    // 3886-3889: 취소든 성공이든 보드 전체를 다시 그린다.
    render({ boards: { [boardId]: { rows: 'all' } } });
  }

  return { start, moveGhost, finish };
}
