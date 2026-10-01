// tests/unit/gestureMath.test.mjs — 제스처 산술: 끌기·늘이기 카운트, 히트 판정, 더블탭·임계 (RM-08, 2026-10-01)
//
// 이 산술은 2026-09 재구성 때 domain 으로 떨어져 나왔지만 시험이 없었다. 원본 다섯 곳의 끌기 카운트가
// 하한·행 넘김이 서로 다르다는 것(gestureMath.resolveDragCount 의 표)을 여기서 값으로 굳힌다.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOUBLE_TAP_MS, QUICK_DRAG_THRESHOLD_PX, LONGPRESS_MOVE_THRESHOLD_PX,
  resolveDragCount, resolveResizeCount, isDoubleTap, exceedsThreshold,
  resolveHitCell, dragPreviewCount, resizeHitKind,
} from '../../src/domain/gestureMath.js';

const BOARD = { rows: 8, cols: 8 };   // 마지막 행 인덱스 8

// ── 끌기 카운트 ─────────────────────────────────────────────────────────────

test('끌기 카운트: 행을 넘겨 세고, 시작보다 앞이면 1, 하한은 부르는 쪽이 정한다', () => {
  const c = (endRow, endCol, lowerBound = 1) =>
    resolveDragCount({ startRow: 2, startIndex: 3, endRow, endCol, board: BOARD, lowerBound });
  assert.equal(c(2, 5), 3);
  assert.equal(c(3, 1), 7);
  assert.equal(c(1, 7), 1);
  assert.equal(c(2, 3), 1);
  assert.equal(c(2, 3, 4), 4);   // 놓을 때(마우스 커밋)의 하한 = 기본 카운트
});

test('끌기 카운트: 마지막 행 너머를 가리키면 시작 자리에서 보드 끝까지의 칸에서 자른다', () => {
  assert.equal(resolveDragCount({ startRow: 7, startIndex: 4, endRow: 12, endCol: 7, board: BOARD, lowerBound: 1 }), 12);
});

test('끌기 카운트: 터치 그리기(crossRow:false)는 끝 행을 보지 않고 자르지도 않는다', () => {
  const base = { startRow: 8, startIndex: 6, board: BOARD, lowerBound: 1, crossRow: false };
  assert.equal(resolveDragCount({ ...base, endRow: 3, endCol: 7 }), 2);
  // 보드에 남은 칸은 2인데 그대로 5 를 돌려준다 — 놓는 커맨드가 뒤늦게 자른다(지금 동작).
  assert.equal(resolveDragCount({ ...base, endRow: 8, endCol: 10 }), 5);
});

// ── 늘이기 카운트 ───────────────────────────────────────────────────────────

const RESIZE = { originRow: 2, originStartIndex: 3, originalCount: 4, startX: 100 };

test('늘이기 카운트: 보드 안이면 행을 넘겨 세고 1..남은 칸으로 묶는다', () => {
  assert.equal(resolveResizeCount(RESIZE, { kind: 'cross', endRow: 3, endCol: 1 }, BOARD), 7);
  assert.equal(resolveResizeCount(RESIZE, { kind: 'cross', endRow: 1, endCol: 0 }, BOARD), 1);
});

test('늘이기 카운트: 보드 밖이면 시작 행 안에서만 세고, 그 하한은 기본 카운트가 아니라 1이다', () => {
  assert.equal(resolveResizeCount(RESIZE, { kind: 'sameRow', endCol: 7 }, BOARD), 5);
  assert.equal(resolveResizeCount(RESIZE, { kind: 'sameRow', endCol: 0 }, BOARD), 1);
});

test('늘이기 카운트: 트랙이 없으면 이동거리 ÷ 칸 폭을 반올림해 더한다', () => {
  assert.equal(resolveResizeCount(RESIZE, { kind: 'step', clientX: 100 + 76 * 2.4, stepWidth: 76 }, BOARD), 6);
  assert.equal(resolveResizeCount(RESIZE, { kind: 'step', clientX: 100 + 76 * 2.5, stepWidth: 76 }, BOARD), 7);
  assert.equal(resolveResizeCount(RESIZE, { kind: 'step', clientX: -1000, stepWidth: 76 }, BOARD), 1);
  assert.equal(resolveResizeCount(RESIZE, { kind: 'step', clientX: 99999, stepWidth: 76 }, BOARD), 6 * 8 + 5);
});

test('늘이기 갈래: 보드 안이 먼저, 그다음 시작 트랙, 둘 다 없을 때만 이동거리', () => {
  assert.equal(resizeHitKind(true, true), 'cross');
  assert.equal(resizeHitKind(true, false), 'cross');
  assert.equal(resizeHitKind(false, true), 'sameRow');
  assert.equal(resizeHitKind(false, false), 'step');
});

// ── 히트 판정 ───────────────────────────────────────────────────────────────

const RECT = { left: 40, width: 80 };   // 칸 폭 10

test('히트 판정: 보드 안이면 트랙의 행(문자열)을 숫자로, 칸은 사각형 안의 비율로 센다', () => {
  assert.deepEqual(resolveHitCell({ inBoard: true, trackRow: '3', fallbackRow: 9, rect: RECT, clientX: 65, board: BOARD }),
    { row: 3, col: 2 });
});

test('히트 판정: 보드 밖이면 앵커 행을 쓰고, 칸은 앵커 트랙 사각형의 양 끝으로 묶인다', () => {
  assert.deepEqual(resolveHitCell({ inBoard: false, trackRow: null, fallbackRow: 5, rect: RECT, clientX: 9999, board: BOARD }),
    { row: 5, col: 7 });
  assert.deepEqual(resolveHitCell({ inBoard: false, trackRow: null, fallbackRow: 5, rect: RECT, clientX: -50, board: BOARD }),
    { row: 5, col: 0 });
});

test('히트 판정: 잴 트랙이나 보드 값이 없으면 칸은 0 이 아니라 null 이다', () => {
  assert.deepEqual(resolveHitCell({ inBoard: false, trackRow: null, fallbackRow: null, rect: null, clientX: 50, board: BOARD }),
    { row: null, col: null });
  assert.equal(resolveHitCell({ inBoard: true, trackRow: '1', fallbackRow: null, rect: RECT, clientX: 50, board: null }).col, null);
});

test('히트 판정: 폭이 0 인 트랙은 칸이 NaN 이다(숨긴 트랙 — docs/deviations.md 「방어 없는 접근」, 지금 동작)', () => {
  const r = resolveHitCell({ inBoard: true, trackRow: '1', fallbackRow: null, rect: { left: 0, width: 0 }, clientX: 10, board: BOARD });
  assert.ok(Number.isNaN(r.col));
});

// ── 드래그 프리뷰 카운트 ─────────────────────────────────────────────────────

test('드래그 프리뷰: 드래그가 없으면 null(호출부가 프리뷰를 지운다), 팔레트는 지금 기본 카운트, 블록 이동은 그룹 길이', () => {
  const placements = [
    { groupId: 'g1', length: 3 }, { groupId: 'g1', length: 2 }, { groupId: 'g2', length: 8 },
  ];
  assert.equal(dragPreviewCount(null, 4, placements), null);
  assert.equal(dragPreviewCount({ type: 'palette', previewCount: 2 }, 4, placements), 4);
  assert.equal(dragPreviewCount({ type: 'placement-move', groupId: 'g1' }, 4, placements), 5);
});

// ── 더블탭 · 이동 임계 ───────────────────────────────────────────────────────

test('더블탭: 300ms 미만이고 같은 그룹일 때만', () => {
  assert.equal(DOUBLE_TAP_MS, 300);
  assert.equal(isDoubleTap(1299, 1000, 'g', 'g'), true);
  assert.equal(isDoubleTap(1300, 1000, 'g', 'g'), false);
  assert.equal(isDoubleTap(1100, 1000, 'g', 'h'), false);
  // 앱을 막 연 첫 탭: 지난 탭 시각 0 · 그룹 null 이면 더블탭이 아니다
  assert.equal(isDoubleTap(150, 0, 'g', null), false);
});

test('이동 임계: 어느 한 축이라도 임계를 **넘어야** 한다(같으면 아직 탭)', () => {
  assert.equal(QUICK_DRAG_THRESHOLD_PX, 12);
  assert.equal(LONGPRESS_MOVE_THRESHOLD_PX, 8);
  assert.equal(exceedsThreshold(12, -12, 12), false);
  assert.equal(exceedsThreshold(-13, 0, 12), true);
  assert.equal(exceedsThreshold(0, 9, 8), true);
});
