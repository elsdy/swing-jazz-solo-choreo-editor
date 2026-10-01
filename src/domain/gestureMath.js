// src/domain/gestureMath.js — 제스처 판정의 순수 부분 (DOM 측정값은 인자로 받는다)
//
// 원본 index.html 에 흩어져 있던 드래그 카운트 5곳(2636·2653·2673·2709·2750),
// 리사이즈 카운트 3단 폴백(3785-3801), 더블탭 300ms(2523·2540), 이동 임계 8px/12px(2726·3241)을 모았다.
// elementFromPoint · getBoundingClientRect · 현재 시각 조회는 여기 들어오지 않는다 — 호출부(input/*)의 몫이다.

import { calcCrossRowCount, totalCellsFrom, clamp, cellIndexFromRatio } from './grid.js';
import { groupCount } from './placements.js';

/** 더블탭 판정 간격(ms). @see index.html:2523 */
export const DOUBLE_TAP_MS = 300;
/** 빠른 배치 터치 드래그 판정 임계(px). @see index.html:2726 */
export const QUICK_DRAG_THRESHOLD_PX = 12;
/** 롱프레스 취소 이동 임계(px). @see index.html:3241 */
export const LONGPRESS_MOVE_THRESHOLD_PX = 8;

/**
 * 그리기/빠른배치 드래그의 카운트를 정한다.
 *
 * ⚠⚠ 원본 5벌은 같은 코드가 아니다. 하한(lowerBound)과 행 넘김 허용(crossRow)을 **인자로 받아**
 *    호출부가 정한다. 임의로 통일하면 1칸만 끌었을 때 놓이는 길이가 바뀐다.
 *
 *   원본                                     lowerBound      crossRow  비고
 *   ─────────────────────────────────────────────────────────────────────────────
 *   2636 mousemove 빠른배치 프리뷰            1               true
 *   2653 mousemove 그리기 프리뷰              1               true
 *   2673 문서레벨 mouseup 그리기 **커밋**     DEFAULT_COUNT   true      ← 하한이 다르다
 *   2709 터치 touchend 그리기 **커밋**        DEFAULT_COUNT   **false** ← calcCrossRowCount 를 아예 안 쓴다.
 *                                                                       한 행 안에서 endCol-startIndex+1 로만 센다.
 *                                                                       totalCellsFrom 클램프도 없다(원문 그대로).
 *   2750 터치 touchmove 빠른배치 프리뷰        1               true
 *
 * @see index.html:2636
 * @see index.html:2653
 * @see index.html:2673
 * @see index.html:2709
 * @see index.html:2750
 * @param {Object} args
 * @param {number} args.startRow
 * @param {number} args.startIndex
 * @param {number} args.endRow
 * @param {number} args.endCol
 * @param {{rows:number, cols:number}} args.board
 * @param {number} args.lowerBound          1 또는 DEFAULT_COUNT — 위 표 참조
 * @param {boolean} [args.crossRow=true]    false 면 2709 경로(단일 행, 클램프 없음)
 * @returns {number}
 */
export function resolveDragCount({ startRow, startIndex, endRow, endCol, board, lowerBound, crossRow = true }) {
  if (!crossRow) {
    // 2709: 행 넘김 없음 + totalCellsFrom 클램프 없음. placeMove 내부의 Math.min 이 뒤늦게 잘라 준다.
    return Math.max(lowerBound, endCol - startIndex + 1);
  }
  return Math.max(lowerBound, Math.min(
    calcCrossRowCount(startRow, startIndex, endRow, endCol, board),
    totalCellsFrom(startRow, startIndex, board)
  ));
}

/**
 * 리사이즈 프리뷰 카운트. applyResizePreview(3785-3801)의 3단 폴백을 그대로 옮겼다.
 * 어느 단계인지(hit.kind)는 호출부가 elementFromPoint 결과로 정한다.
 *
 *   'cross'   포인터가 보드 안의 트랙 위 → calcCrossRowCount (행 넘김 허용)
 *   'sameRow' 보드 밖이지만 originTrack 이 있음 → 시작 행 안에서만 센다
 *   'step'    둘 다 없음 → 시작 카운트 + 이동거리/셀폭 반올림
 * 세 갈래 모두 clamp(_, 1, maxTotal). ⚠ 하한이 1 이다 — DEFAULT_COUNT 가 아니다.
 *
 * @see index.html:3785
 * @param {{originRow:number, originStartIndex:number, originalCount:number, startX:number}} resize
 * @param {{kind:'cross', endRow:number, endCol:number}
 *        |{kind:'sameRow', endCol:number}
 *        |{kind:'step', clientX:number, stepWidth:number}} hit
 * @param {{rows:number, cols:number}} board
 * @returns {number}
 */
export function resolveResizeCount(resize, hit, board) {
  const maxTotal = totalCellsFrom(resize.originRow, resize.originStartIndex, board);
  if (hit.kind === 'cross') {
    return clamp(calcCrossRowCount(resize.originRow, resize.originStartIndex, hit.endRow, hit.endCol, board), 1, maxTotal);
  }
  if (hit.kind === 'sameRow') {
    return clamp(hit.endCol - resize.originStartIndex + 1, 1, maxTotal);
  }
  return clamp(resize.originalCount + Math.round((hit.clientX - resize.startX) / hit.stepWidth), 1, maxTotal);
}

/**
 * 더블탭 판정. 현재 시각은 인자로 받는다(도메인은 시계를 읽지 않는다).
 * 원본: `now - lastTapTime < 300 && lastTapGroupId === groupId`
 * @see index.html:2523
 * @param {number} now
 * @param {number} lastTapTime
 * @param {string|null} groupId
 * @param {string|null} lastTapGroupId
 * @param {number} [thresholdMs=DOUBLE_TAP_MS]
 * @returns {boolean}
 */
export function isDoubleTap(now, lastTapTime, groupId, lastTapGroupId, thresholdMs = DOUBLE_TAP_MS) {
  return now - lastTapTime < thresholdMs && lastTapGroupId === groupId;
}

/**
 * 포인터가 임계를 넘었는가. 두 원본 모두 `abs(dx) > t || abs(dy) > t` 형태다.
 * ⚠ 2726 은 dx/dy 를 이미 Math.abs 로 만들어 두고 비교했고, 3241 은 비교 시점에 abs 를 취한다.
 *   두 번 abs 를 해도 결과가 같으므로 하나로 합쳤다.
 * @see index.html:2726
 * @see index.html:3241
 * @param {number} dx
 * @param {number} dy
 * @param {number} threshold
 * @returns {boolean}
 */
export function exceedsThreshold(dx, dy, threshold) {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
}

/**
 * 포인터 밑의 트랙을 행·칸으로 바꾸는 산술. input/hitTest 가 요소를 찾고 사각형을 잰 **뒤에** 부른다(RM-08).
 *
 * ⚠ 보드 밖(inBoard=false)이면 행은 fallbackRow(앵커 행)이고, 칸은 호출부가 앵커 트랙을 잰 rect 로 센다.
 *   "보드 밖으로 끌어도 카운트가 시작 행 기준"이라는 관찰 동작이 이 두 줄이다.
 * ⚠ trackRow 는 dataset 의 **문자열**이라 Number() 를 거친다(원본 2633 등).
 * ⚠ 잴 트랙이 없거나(rect=null) 보드 값이 없으면 칸은 null 이다. 0 이 아니다.
 *
 * @param {object} a
 * @param {boolean} a.inBoard        포인터 밑 트랙이 이 보드 안인가
 * @param {string|number|null} a.trackRow  포인터 밑 트랙의 행(보드 안일 때만 읽는다)
 * @param {number|null} a.fallbackRow 보드 밖일 때 쓸 행
 * @param {{left:number, width:number}|null} a.rect  잰 트랙의 사각형(보드 안이면 그 트랙, 밖이면 앵커)
 * @param {number} a.clientX
 * @param {{cols:number}|null} a.board
 * @returns {{row:number|null, col:number|null}}
 */
export function resolveHitCell({ inBoard, trackRow, fallbackRow, rect, clientX, board }) {
  const row = inBoard ? Number(trackRow) : fallbackRow;
  const col = rect && board ? cellIndexFromRatio(clientX, rect, board.cols) : null;
  return { row, col };
}

/**
 * 끌고 있는 것을 놓으면 몇 칸이 되는지 — 드래그 프리뷰의 카운트. 원본 updatePreview(3900-3906)의 결정부.
 * input/boardController 와 input/touchDrag 에 같은 다섯 줄이 두 벌 있던 것을 한 자리로 모았다(RM-08).
 *
 * ⚠ 드래그가 없으면 null — 호출부는 그때 프리뷰를 **지운다**(원본이 clearPreview 뒤 조기 반환한다).
 * ⚠ 팔레트 드래그는 끌기 시작한 때의 previewCount 가 아니라 **지금의** 기본 카운트를 쓴다(원본 그대로).
 *
 * @param {{type:string, groupId?:string}|null} drag
 * @param {number} defaultCount
 * @param {object[]} placements  이 보드의 배치
 * @returns {number|null}
 */
export function dragPreviewCount(drag, defaultCount, placements) {
  if (!drag) return null;
  return drag.type === 'palette' ? defaultCount : groupCount(placements, drag.groupId);
}

/**
 * 리사이즈 프리뷰가 세 갈래 중 어디로 가는지(resolveResizeCount 의 hit.kind). 원본 3785-3801 의 if 순서다.
 * 보드 안이 먼저 이기고, 그다음이 시작 트랙, 둘 다 없을 때만 이동거리로 센다.
 * @param {boolean} inBoard
 * @param {boolean} hasOriginTrack
 * @returns {'cross'|'sameRow'|'step'}
 */
export function resizeHitKind(inBoard, hasOriginTrack) {
  if (inBoard) return 'cross';
  if (hasOriginTrack) return 'sameRow';
  return 'step';
}
