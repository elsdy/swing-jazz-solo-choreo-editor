// src/input/pointerSession.js — 동시에 하나만 존재하는 **리사이즈 세션**.
//
// 원본은 두 개를 함께 들고 있었다:
//   · `ctx.resize`      보드별 슬롯 (state.resize 1372 / reState.resize 1436)
//   · `activeResizeCtx` **전역 단일 슬롯** (1442) — document 에 붙은 mousemove/mouseup 이 이걸 본다
// 그리고 stopMouseResize(3761)가 무조건 `activeResizeCtx = null` 로 만든다. 그래서
// "메인과 루틴을 동시에 리사이즈할 수 없다" 가 이 앱의 불변식이다.
// ⚠ 그 불변식을 지키려고 여기서도 슬롯을 **하나만** 둔다. boardId 별 레지스트리로 바꾸지 마라.
//
// 리스너는 마우스·손가락 **한 길**이다(RM-11, 2026-11-02): start 가 **document** 에 pointermove/pointerup/pointercancel
// 을 건다(원본 3752-3753 의 mousemove/mouseup 자리). 원본은 터치만 보드 요소의 touchmove `{passive:false}` 가
// preventDefault 로 스크롤을 막으며 applyPreview 를 불렀는데, 포인터 이벤트의 preventDefault 는 스크롤을 못 막으므로
// 그 몫은 CSS `touch-action: none`(`.resize-handle`)이 맡고, 손가락은 pointerdown 과녁에 묵시적으로 붙잡혀
// 보드 밖으로 나가도 document 까지 온다. 그래서 보드 쪽 갈래가 없어졌다 — 늘이기 중의 move/up 은 전부 여기다.
//
// ⚠⚠ 901e1d1 — 프리뷰 중에는 **절대로 커밋하거나 다시 그리지 않는다.**
//   applyPreview 는 overlays 가 만든 점선 블록의 인라인 스타일만 만지고, rebuildGroup 은
//   제스처가 끝날 때(stop) 딱 한 번 부른다. 프리뷰 중 배치 요소를 지웠다 만들면
//   touchstart 타깃이 DOM 에서 떨어져 이후 모든 touchmove 가 사라진다.

import { SEL, CLS } from '../ui/domContract.js';
import { hitTest, cellIndexAt } from './hitTest.js';
import { resolveResizeCount, resizeHitKind, resolveTrimStart } from '../domain/gestureMath.js';
import { getGroup, groupCount } from '../domain/placements.js';
import { buildSegments, linearOf, cellOf, firstRowIndex } from '../domain/grid.js';

/**
 * 리사이즈 세션을 만든다. 앱 전체에 **인스턴스 하나만** 두고 두 보드가 공유한다.
 *
 * @param {object} deps
 * @param {Document} [deps.doc=document]
 * @param {(boardId: string) => HTMLElement} deps.getBoardEl 그 보드의 `.board`
 * @param {(boardId: string) => {rows:number, cols:number}} deps.getBoard 격자 값
 * @param {(boardId: string) => object[]} deps.getPlacements 그 보드의 배치 배열
 * @param {() => number} deps.readCellW `--cellW` 를 px 로 읽는다(ui/cssVars.readCellW 를 감싼 것).
 *        ⚠ input 은 ui/cssVars 를 import 할 수 없어 app/main.js 가 주입한다.
 * @param {object} deps.overlays 비영속 DOM 담당(ui/overlays). 아래 5개를 쓴다:
 *        showResizeCountBadge(el, count) / hideResizeCountBadge() /
 *        clearResizePreview(boardId) / renderResizePreview(boardId, segments, count) -> 첫 블록|null /
 *        unmarkDraggingGroups(boardId)
 * @param {(boardId: string, groupId: string, newCount: number, edge: 'left'|'right') => void} deps.commit
 *        제스처 종료 시 딱 한 번. app/main.js 가 edge 로 가른다 — 'right' 는
 *        `render(boardCommands.resizeGroupTo(store, {boardId, groupId, newCount}, {ids}))`, 'left'(RM-12 시작점 트리밍)는
 *        `boardCommands.trimGroupStartTo` 이고, 뒤에 `history.commit(boardId)` 를 붙인다(원본 3766 의 ctx===mainCtx 분기를 대칭화한 자리).
 *        ⚠ newCount 는 **미클램프 previewCount** 를 그대로 넘긴다 — 클램프는 커맨드가 한다.
 * @returns {{ start: (boardId:string, groupId:string, clientX:number, edge?:'left'|'right') => object|null,
 *             isActive: (boardId?: string) => boolean,
 *             applyPreview: (clientX:number, clientY:number) => void,
 *             stop: () => void, stopTouch: () => void,
 *             current: () => object|null }}
 */
export function createPointerSession(deps) {
  const {
    doc = document,
    getBoardEl,
    getBoard,
    getPlacements,
    readCellW,
    overlays,
    commit,
  } = deps;

  /**
   * 원본 `ctx.resize` + `activeResizeCtx` 를 합친 단일 슬롯. edge 는 잡은 가장자리 — 'right' 는 원본의 늘이기,
   * 'left' 는 RM-12 의 시작점 트리밍(originStart · originEnd 는 그때 쓰는 선형 카운트).
   * @type {null | { boardId:string, groupId:string, edge:'left'|'right', startX:number, originRow:number,
   *                 originStart:number, originEnd:number,
   *                 originStartIndex:number, originalCount:number, previewCount:number,
   *                 liveEl:HTMLElement|null, originTrack:HTMLElement|null,
   *                 name:string, originalWidth:string|null }}
   */
  let active = null;

  /**
   * 늘이기 중의 포인터 이동. document 에 걸린다(원본 3756-3759 의 mousemove — 이제 손가락도 같은 길이다).
   * @param {PointerEvent} e
   */
  // @complexity time=O(1) space=O(1) cc=2
  function onPointerMove(e) {
    if (!active) return; // 원본 `if (!activeResizeCtx?.resize) return;`
    applyPreview(e.clientX, e.clientY);
  }

  /**
   * 리사이즈 시작. 원본 startResize(3728-3754) 그대로 — RM-12 부터 잡은 가장자리(edge)를 받는다.
   * @param {string} boardId
   * @param {string} groupId
   * @param {number} clientX
   * @param {'left'|'right'} [edge='right']  'left' 면 끝 칸을 두고 시작점을 옮긴다
   * @returns {object|null} 만들어진 세션. 그룹이 없으면 null(원본의 조기 반환)
   */
  // @complexity time=O(p) space=O(k) cc=5
  function start(boardId, groupId, clientX, edge = 'right') {
    const placements = getPlacements(boardId);
    const first = getGroup(placements, groupId)[0];
    if (!first) return null;

    const el = getBoardEl(boardId);
    const placementEl = el.querySelector(SEL.placementsOfGroup(groupId));
    const originTrack = placementEl?.closest(SEL.track) || null;
    const cols = getBoard(boardId).cols;
    const originStart = linearOf(first.row, first.startIndex, cols);

    active = {
      boardId,
      groupId,
      edge: edge === 'left' ? 'left' : 'right',
      originStart,
      originEnd: originStart + groupCount(placements, groupId) - 1,
      startX: clientX,
      originRow: first.row,
      originStartIndex: first.startIndex,
      originalCount: groupCount(placements, groupId),
      previewCount: groupCount(placements, groupId),
      liveEl: placementEl || null,
      originTrack,
      name: first.name,
      originalWidth: placementEl ? placementEl.style.width : null,
    };

    // 그룹의 모든 세그먼트에 리사이즈 상태 표시 (⚠ is-dragging 과 is-resizing 을 함께 붙인다)
    el.querySelectorAll(SEL.placementsOfGroup(groupId)).forEach((node) => {
      node.classList.add(CLS.isDragging, CLS.isResizing);
    });
    if (active.liveEl) {
      overlays.showResizeCountBadge(active.liveEl, active.originalCount);
    }

    // document 레벨 포인터 이벤트 — 마우스·손가락 한 길(pointercancel 은 원본 touchcancel 처럼 stop 으로 간다)
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', stop);
    doc.addEventListener('pointercancel', stop);
    return active;
  }

  /**
   * 이 보드가 지금 리사이즈 중인가. 원본 보드 핸들러의 `activeResizeCtx === ctx && ctx.resize`
   * 가드(2553 · 2567 · 2577)에 대응한다.
   * @param {string} [boardId] 생략하면 "아무 보드든 리사이즈 중인가"
   * @returns {boolean}
   */
  function isActive(boardId) {
    if (!active) return false;
    return boardId === undefined ? true : active.boardId === boardId;
  }

  /**
   * 프리뷰 갱신. 원본 applyResizePreview(3783-3822)의 카운트 3단 폴백 + 프리뷰 그리기다.
   *
   *   ① 포인터 밑이 **이 보드 안의 트랙** → 행 넘김 카운트(calcCrossRowCount)
   *   ② 보드 밖이지만 originTrack 이 있다 → 시작 행 안에서만 센다
   *   ③ 둘 다 없다 → 시작 카운트 + (이동거리 / --cellW) 반올림
   * 세 갈래 모두 clamp(_, 1, maxTotal) — 하한이 1 이지 DEFAULT_COUNT 가 아니다.
   * 산술 자체는 domain/gestureMath.resolveResizeCount 가 소유한다.
   *
   * ⚠ ①/② 의 endCol 은 hitTest 의 앵커 폴백(measuredTrack)이 그대로 낸다 —
   *   원본이 각각 `pointerToCellIndex(endTrack, …)` 와 `pointerToCellIndex(r.originTrack, …)`
   *   으로 나눠 부르던 것과 같은 값이다.
   * ⚠ 여기서 커밋하지 않는다(901e1d1).
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {void}
   */
  // @complexity time=O(k) space=O(k) cc=6
  function applyPreview(clientX, clientY) {
    const r = active;
    if (!r) return;
    const board = getBoard(r.boardId);
    const hit = hitTest(clientX, clientY, {
      doc,
      boardEl: getBoardEl(r.boardId),
      board,
      boardId: r.boardId,
      fallbackTrack: r.originTrack,
      fallbackRow: r.originRow,
    });

    // 세 갈래의 우선순위는 domain/gestureMath.resizeHitKind 가 정한다. ⚠ --cellW 는 'step' 일 때만 잰다.
    const kind = resizeHitKind(hit.inBoard, !!r.originTrack);
    const spec = kind === 'cross' ? { kind, endRow: hit.row, endCol: hit.col }
      : kind === 'sameRow' ? { kind, endCol: hit.col }
      : { kind, clientX, stepWidth: readCellW() };
    // 왼쪽(시작점 트리밍)은 포인터 밑 칸이 새 시작이고 끝 칸은 그대로다 — 프리뷰도 그 자리부터 그린다.
    let from = { row: r.originRow, index: r.originStartIndex };
    let previewCount;
    if (r.edge === 'left') {
      const trimmed = resolveTrimStart(r, spec.kind === 'step' ? spec : { kind, row: hit.row, col: hit.col }, board,
        linearOf(firstRowIndex(board), 0, board.cols));
      previewCount = trimmed.count;
      from = cellOf(trimmed.start, board.cols);
    } else {
      previewCount = resolveResizeCount(r, spec, board);
    }
    r.previewCount = previewCount;

    // 점선 프리뷰 블록 표시 (리사이즈 결과 미리보기)
    overlays.clearResizePreview(r.boardId);
    const segments = buildSegments(from.row, from.index, previewCount, board);
    const firstBlock = overlays.renderResizePreview(r.boardId, segments, previewCount);
    // 카운트 배지를 프리뷰 블록 위에 표시
    if (firstBlock) overlays.showResizeCountBadge(firstBlock, previewCount);
  }

  /**
   * 리사이즈 종료. 원본 stopMouseResize(3761-3777) 의 **순서 그대로**다:
   * 프리뷰 제거 → 커밋 → 리스너 해제 → is-resizing 제거 → 슬롯 비우기 → is-dragging 제거 →
   * 배지 숨김 → 전역 슬롯 비우기.
   * @returns {void}
   */
  function stop() {
    const r = active;
    if (r) {
      overlays.clearResizePreview(r.boardId);
      finalize(r);
    }
    doc.removeEventListener('pointermove', onPointerMove);
    doc.removeEventListener('pointerup', stop);
    doc.removeEventListener('pointercancel', stop);
    if (r) {
      getBoardEl(r.boardId)
        .querySelectorAll(SEL.placementResizing)
        .forEach((node) => node.classList.remove(CLS.isResizing));
      active = null; // 원본 3772 `ctx.resize = null`
      overlays.unmarkDraggingGroups(r.boardId);
    }
    overlays.hideResizeCountBadge();
    active = null; // 원본 3776 `activeResizeCtx = null`
  }

  /**
   * 원본 finalizeResize(3828-3834). 상한 클램프는 하지 않는다 —
   * boardCommands.resizeGroupTo 가 원본 3832 와 같은 자리에서 한다(STAGE2 계약).
   * @param {object} r
   */
  function finalize(r) {
    commit(r.boardId, r.groupId, r.previewCount, r.edge);
  }

  return {
    start,
    isActive,
    applyPreview,
    stop,
    /** 원본 stopTouchResize(3779-3781)는 stopMouseResize 를 그대로 불렀다 — 이제 한 길이라 같은 함수다. */
    stopTouch: stop,
    /** 읽기 전용 진단용. 호출부가 이걸 고쳐 쓰지 않게 하라. */
    current: () => active,
  };
}
