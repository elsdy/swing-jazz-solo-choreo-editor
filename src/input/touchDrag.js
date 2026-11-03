// src/input/touchDrag.js — 보드 위 배치의 터치 이동 제스처
//
// 원본 index.html 의 startTouchPlacementMove(3836-3853) · moveTouchPlacementGhost(3855-3869) ·
// finishTouchPlacementMove(3871-3890) 세 함수를 그대로 옮겼다.
// 고스트 DOM 은 ui/overlays 가 그리고(주입), 여기는 제스처 판정과 커맨드 호출만 한다.
//
// ⚠ 원본 3881 의 `ctx === mainCtx ? saveHistory() : saveHistoryRe()` 는
//    boardId 에 묶인 commands.commitHistory() 하나로 대칭화된다.
// ⚠ 잡은 칸(RM-57): 길게 누른 칸이 블록 시작에서 몇째 칸인지(grab)를 start 에서 재어 세션에 담고, 미리보기(moveGhost)와
//    놓기(finish)가 포인터 밑 칸에서 그만큼 뺀 자리를 쓴다(gestureMath.grabbedStart) — 마우스 몸통 끌기와 같은 규칙이다.
// ⚠ 묶음(RM-48): 고른 블록(둘 이상)을 길게 눌러 끌면 start 가 묶음을 받아 세션에 담는다. 그러면 미리보기는 묶음 전체의 놓일
//    자리(「n개 함께」)이고, 놓기는 화살표와 같은 moveSelection(planNudge — 하나라도 못 가면 아무것도 안 옮김)이며 옮겼을 때만
//    커밋한다 — 마우스 묶음 끌기(input/boardController 의 moveBundle)와 같은 셈(domain/selection.bundleDragPlan)이다.
// ⚠ unmarkDraggingGroups 가 이 흐름에서 **세 번** 불린다 —
//    시작(3876) · movePlacementGroup 안(3665, 커맨드의 deps.unmarkDragging) · ctx.drag=null 뒤(3885).
//    줄이지 마라. 마지막 renderRows(allRows)(3889)도 그대로 남긴다.

import { CLS } from '../ui/domContract.js';
import { getGroup, groupCount } from '../domain/placements.js';
import { dragPreviewCount, grabOffset, grabbedStart } from '../domain/gestureMath.js';
import { groupSpan, bundleDragPlan } from '../domain/selection.js';
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
 *   moveSelection({ delta }) -> Dirty      고른 묶음을 같은 거리로(RM-48 — 묶음을 끌 때만 부른다)
 *   commitHistory() -> Dirty|void
 * @param {(dirty: object) => void} deps.render
 * @param {Object} deps.overlays         ui/overlays 인스턴스(두 보드 공유 — 메서드가 boardId 를 받는다)
 *   showPlacementGhost({ text, background }) / movePlacementGhost(x, y) / removePlacementGhost()
 *   markDraggingGroup(boardId, groupId) / unmarkDraggingGroups(boardId)
 *   updatePreview(boardId, row, startIndex, count) / clearPreview(boardId) / clearTrackHighlights(boardId)
 *   updateBundlePreview(boardId, items, label)   묶음 끌기의 블록마다 놓일 자리(RM-48)
 * @param {Object} deps.hitTest          input/hitTest 모듈 네임스페이스(hitTest(x,y,opts) · cellIndexAt)
 * @param {Object} deps.dragSession      input/dragSession 인스턴스(begin/current/update/end)
 * @returns {{ start(groupId: string, x: number, y: number, bundle?: string[]|null): void,
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
   * 카운트 산술은 domain/gestureMath.dragPreviewCount 한 자리에 있다 — boardController 와 같은 것을 부른다
   * (input/** 끼리는 import 하지 않으므로 두 벌이던 것을 도메인으로 내렸다, RM-08).
   */
  // @complexity time=O(k·p) space=O(k) cc=4
  function updatePreviewFromDrag(row, startIndex) {
    const drag = dragSession.current(boardId);
    if (drag?.bundle) {   // RM-48 — 묶음 전체의 놓일 자리. 하나라도 못 가면(놓아도 안 옮겨지면) 프리뷰를 지운다
      const plan = bundleDragPlan(board(), drag.groupId, drag.bundle, row, startIndex);
      if (plan?.steps) overlays.updateBundlePreview(boardId, plan.steps, plan.label);
      else overlays.clearPreview(boardId);
      return;
    }
    const count = dragPreviewCount(drag, store.get().session.defaultCount, board().placements);
    if (count == null) { overlays.clearPreview(boardId); return; }
    overlays.updatePreview(boardId, row, startIndex, count);
  }

  /**
   * 터치 이동 시작. 원본 startTouchPlacementMove(3836-3853).
   * @param {string} groupId
   * @param {number} x
   * @param {number} y
   * @param {string[]|null} [bundle]  고른 묶음(둘 이상, 끄는 블록 포함) — 있으면 묶음 전체를 옮긴다(RM-48)
   */
  // @complexity time=O(p+k) space=O(p) cc=4
  function start(groupId, x, y, bundle = null) {
    const group = getGroup(board().placements, groupId);
    if (!group.length) return;
    // RM-57 — 고스트를 띄우기 전에 누른 칸을 잰다. 블록 요소는 그 행의 조각만 덮으므로 선형 위치 − 블록 시작으로 센다.
    const grab = grabOffset(hitAt(x, y), groupSpan(board(), groupId)?.start ?? null, board().cols);
    dragSession.begin('placement-move', { groupId, isTouchDragging: true, lastX: x, lastY: y, grab, bundle: bundle || null }, { boards: [boardId] });
    for (const id of bundle || [groupId]) overlays.markDraggingGroup(boardId, id);
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
  // @complexity time=O(p) space=O(1) cc=3
  function moveGhost(x, y) {
    const drag = dragSession.current(boardId);
    if (!drag) return;
    dragSession.update({ lastX: x, lastY: y });   // 3857-3858
    overlays.movePlacementGhost(x, y);
    overlays.clearTrackHighlights(boardId);
    const hit = hitAt(x, y);
    if (hit.inBoard) {
      hit.track.classList.add(CLS.dropHover);
      const at = grabbedStart(hit, drag.grab, board());   // RM-57 — 놓일 자리와 같은 시작(미리보기 = 결과)
      updatePreviewFromDrag(at.row, at.startIndex);
    } else {
      overlays.clearPreview(boardId);
    }
  }

  /**
   * 터치 이동 종료. 원본 finishTouchPlacementMove(3871-3890).
   * @param {boolean} [cancelled=false] touchcancel 이면 true — 이동을 적용하지 않는다.
   */
  // @complexity time=O(k·p) space=O(k) cc=7
  function finish(cancelled = false) {
    const drag = dragSession.current(boardId);
    overlays.clearTrackHighlights(boardId);
    overlays.clearPreview(boardId);
    overlays.removePlacementGhost();
    overlays.unmarkDraggingGroups(boardId);
    if (!cancelled && drag) {
      const hit = hitAt(drag.lastX, drag.lastY);
      if (hit.inBoard) {
        const at = grabbedStart(hit, drag.grab, board());   // RM-57 — 잡은 칸만큼 앞이 블록의 시작
        if (drag.bundle) {
          // RM-48 — 묶음은 옮겼을 때만 한 번 커밋한다. 막혔거나(표 밖) 제자리면 히스토리에 한 칸도 늘지 않는다.
          const delta = bundleDragPlan(board(), drag.groupId, drag.bundle, at.row, at.startIndex)?.delta;
          const dirty = delta ? commands.moveSelection({ delta }) : null;
          apply(dirty);
          if (dirty?.boards) apply(commands.commitHistory());
        } else {
          apply(commands.moveGroup({
            groupId: drag.groupId,
            targetRow: at.row,
            targetStartIndex: at.startIndex
          }));
          apply(commands.commitHistory());   // 3881 `ctx === mainCtx ? saveHistory() : saveHistoryRe()`
        }
      }
    }
    dragSession.end();
    overlays.unmarkDraggingGroups(boardId);   // 3885 — 두 번째 호출(원본 그대로)
    // 3886-3889: 취소든 성공이든 보드 전체를 다시 그린다.
    render({ boards: { [boardId]: { rows: 'all' } } });
  }

  return { start, moveGhost, finish };
}
