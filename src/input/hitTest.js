// src/input/hitTest.js — 화면 좌표 → { boardId, row, col }.
//
// 원본에 `document.elementFromPoint(...)?.closest('.track')` 가 **실측 12곳** 있다:
//   2631 · 2647 · 2668  (마우스 그리기 preview/commit)
//   2688 · 2729 · 2744  (터치 그리기 / 빠른 배치 앵커·드래그)
//   3788               (applyResizePreview)
//   3862 · 3878        (터치 배치 이동 고스트/커밋)
//   3951 · 3958        (팔레트 칩 터치 드래그)
//   3981               (moveTouchGhost 의 drop-hover)
// 전부 이 파일 하나를 거친다.
//
// ⚠ 좌표→칸 산술은 domain/grid.cellIndexFromRatio 가 소유한다. 여기서는 rect 측정만 한다.
// ⚠ dragover(2394-2400)는 `e.target.closest('.track')` 를 쓰는 **다른 메커니즘**이다.
//   포인터 밑이 아니라 이벤트 타깃을 보므로 여기로 통합하지 않는다.

import { SEL, DATA } from '../ui/domContract.js';
import { cellIndexFromRatio } from '../domain/grid.js';

/**
 * 트랙의 화면 사각형. `getBoundingClientRect` 를 부르는 곳을 이 한 줄로 좁힌다.
 * @see index.html:3448
 * @param {HTMLElement} track
 * @returns {DOMRect}
 */
export function measureTrack(track) {
  return track.getBoundingClientRect();
}

/**
 * 트랙 안의 clientX → 셀 인덱스. 원본 pointerToCellIndex(3447-3451) 다.
 * ⚠ 산술은 grid.cellIndexFromRatio 에 있다 — 여기서 다시 쓰지 마라.
 * @see index.html:3447
 * @param {HTMLElement} track
 * @param {number} clientX
 * @param {{ cols: number }} board
 * @returns {number}
 */
export function cellIndexAt(track, clientX, board) {
  return cellIndexFromRatio(clientX, measureTrack(track), board.cols);
}

/**
 * 포인터 밑의 트랙을 찾아 행·칸으로 바꾼다.
 *
 * 원본의 두 형태를 하나로 담았다.
 *
 * ① 보드 안인지만 보는 쪽 (2688 · 2729 · 3788 · 3862 · 3878 · 3951 · 3958 · 3981)
 *    ```js
 *    const t = document.elementFromPoint(x, y)?.closest('.track');
 *    if (t && ctx.el.contains(t)) { … }
 *    ```
 *    → `fallbackTrack` 없이 부르고 `inBoard` 만 본다.
 *
 * ② **앵커 트랙 폴백**을 가진 그리기 쪽 (2631-2635 · 2647-2651 · 2668-2671 · 2744-2747)
 *    ```js
 *    const inBoard   = endTrack && el.contains(endTrack);
 *    const endRow    = inBoard ? Number(endTrack.dataset.row) : drawState.row;
 *    const endTrackEl = (inBoard ? endTrack : null) || drawState.track;
 *    const endCol    = pointerToCellIndex(endTrackEl, x, ctx);
 *    ```
 *    → `{ fallbackTrack: drawState.track, fallbackRow: drawState.row }` 로 부르면
 *      `row`/`col` 이 위 세 줄과 정확히 같아진다.
 *    ⚠ 이 폴백이 "보드 밖으로 끌어도 카운트가 시작 행 기준" 이라는 관찰 동작이다. 빼지 마라.
 *
 * @see index.html:2631
 * @see index.html:2647
 * @see index.html:3788
 * @param {number} clientX
 * @param {number} clientY
 * @param {object} [options]
 * @param {Document} [options.doc=document]
 * @param {HTMLElement|null} [options.boardEl] 이 보드 안인지 판정할 요소(ctx.el)
 * @param {{cols:number, rows:number}|null} [options.board] 칸 계산에 쓸 보드 값
 * @param {string|null} [options.boardId] 그대로 되돌려 준다(호출부 편의)
 * @param {HTMLElement|null} [options.fallbackTrack] 보드 밖일 때 대신 잴 앵커 트랙
 * @param {number|null} [options.fallbackRow] 보드 밖일 때 쓸 행
 * @returns {{ boardId: string|null, track: HTMLElement|null, inBoard: boolean,
 *             measuredTrack: HTMLElement|null, row: number|null, col: number|null }}
 */
export function hitTest(clientX, clientY, options = {}) {
  const {
    doc = document,
    boardEl = null,
    board = null,
    boardId = null,
    fallbackTrack = null,
    fallbackRow = null,
  } = options;

  const track = doc.elementFromPoint(clientX, clientY)?.closest(SEL.track) || null;
  const inBoard = !!(track && boardEl && boardEl.contains(track));
  // 원본 `(inBoard ? endTrack : null) || drawState.track` — 보드 밖이면 앵커로 되돌아간다.
  const measuredTrack = (inBoard ? track : null) || fallbackTrack || null;
  // ⚠ track.dataset.row 는 문자열이라 Number() 가 필요하다(원본 2633 등).
  const row = inBoard ? Number(track.dataset[DATA.row]) : fallbackRow;
  const col = measuredTrack && board ? cellIndexAt(measuredTrack, clientX, board) : null;

  return { boardId, track, inBoard, measuredTrack, row, col };
}
