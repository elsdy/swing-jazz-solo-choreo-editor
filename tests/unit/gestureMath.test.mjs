// tests/unit/gestureMath.test.mjs — 제스처 산술: 끌기·늘이기 카운트, 히트 판정, 더블탭·임계 (RM-08, 2026-10-01)
//
// 이 산술은 2026-09 재구성 때 domain 으로 떨어져 나왔지만 시험이 없었다. 원본 다섯 곳의 끌기 카운트가
// 하한·행 넘김이 서로 다르다는 것(gestureMath.resolveDragCount 의 표)을 여기서 값으로 굳힌다.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOUBLE_TAP_MS, QUICK_DRAG_THRESHOLD_PX, LONGPRESS_MOVE_THRESHOLD_PX,
  resolveDragCount, resolveResizeCount, isDoubleTap, exceedsThreshold,
  resolveHitCell, dragPreviewCount, resizeHitKind, rectCellRange, MARQUEE_THRESHOLD_PX, resizeBlocked,
  EDGE_GRAB_PX, BODY_DRAG_THRESHOLD_PX, resolveGrabZone, grabEdgeWidth, resolveTrimStart,
} from '../../src/domain/gestureMath.js';
import { readFileSync } from 'node:fs';

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

test('끌기 카운트: 한 행 안에서만 세던 옛 터치 길은 없다 — 같은 입력이 행을 보고 보드 끝에서 잘린다 (RM-11)', () => {
  const base = { startRow: 8, startIndex: 6, board: BOARD, lowerBound: 1 };
  assert.equal(resolveDragCount({ ...base, endRow: 3, endCol: 7 }), 1);   // 옛 crossRow:false 는 2
  assert.equal(resolveDragCount({ ...base, endRow: 8, endCol: 10 }), 2);  // 옛 길은 5 를 그대로 냈다
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

test('네모 범위: 두 꼭지점을 어느 쪽으로 끌어도 행 · 칸을 작은 것부터로 정규화하고, 못 잰 칸이 있으면 null (RM-14 마퀴)', () => {
  assert.deepEqual(rectCellRange({ row: 3, col: 1 }, { row: 2, col: 5 }), { rowFrom: 2, rowTo: 3, colFrom: 1, colTo: 5 });
  assert.deepEqual(rectCellRange({ row: 2, col: 4 }, { row: 2, col: 4 }), { rowFrom: 2, rowTo: 2, colFrom: 4, colTo: 4 });
  assert.equal(rectCellRange({ row: 2, col: null }, { row: 2, col: 4 }), null);
  assert.equal(rectCellRange(null, { row: 2, col: 4 }), null);
  assert.equal(MARQUEE_THRESHOLD_PX, 4);
});

// ── 늘이기 가드 (RM-11 동작 ④) ───────────────────────────────────────────────

test('늘이기 가드: 메인 보드의 루틴 블록은 마우스·손가락 모두 같은 답 — 포인터 종류를 묻지 않는다', () => {
  assert.equal(resizeBlocked({ isRoutine: true, allowsRoutineBlocks: true }), true);    // 메인 보드의 루틴 블록
  assert.equal(resizeBlocked({ isRoutine: false, allowsRoutineBlocks: true }), false);  // 메인 보드의 동작 블록
  assert.equal(resizeBlocked({ isRoutine: true, allowsRoutineBlocks: false }), false);  // 루틴 보드(루틴 블록이 없다)
  assert.equal(resizeBlocked.length, 1);   // 인자 하나 — pointerType 갈래가 다시 생기지 않게
});

// ── 블록을 잡는 자리 · 시작점 트리밍 (RM-12, 2026-11-03) ──────────────────────────────────────

test('잡은 자리: 가장자리 폭 안이면 왼쪽·오른쪽, 그 사이는 몸통, 블록이 가장자리 두 배보다 좁으면 몸통을 남긴다', () => {
  // 넓은 블록(200px) — 가장자리는 EDGE_GRAB_PX(14) 그대로
  assert.equal(EDGE_GRAB_PX, 14);
  assert.equal(resolveGrabZone(0, 200), 'left');
  assert.equal(resolveGrabZone(13.9, 200), 'left');
  assert.equal(resolveGrabZone(14, 200), 'body');
  assert.equal(resolveGrabZone(100, 200), 'body');
  assert.equal(resolveGrabZone(185.9, 200), 'body');
  assert.equal(resolveGrabZone(186, 200), 'right');
  assert.equal(resolveGrabZone(199, 200), 'right');
  // 블록 바깥으로 넓힌 손가락 과녁(index.html 의 ::before)을 짚어도 그 쪽 가장자리다
  assert.equal(resolveGrabZone(-8, 200), 'left');
  assert.equal(resolveGrabZone(208, 200), 'right');
  // 1카운트 블록(50px) — 가장자리가 폭의 1/4(12.5px)로 줄어 가운데 절반이 몸통으로 남는다
  assert.equal(grabEdgeWidth(50), 12.5);
  assert.deepEqual([0, 12, 13, 25, 37, 38, 49].map(x => resolveGrabZone(x, 50)), ['left', 'left', 'body', 'body', 'body', 'right', 'right']);
  // 가장자리 두 배(28px)보다 좁아도 몸통이 남는다 — 20px 블록은 5px 씩
  assert.deepEqual([4, 5, 10, 14, 15].map(x => resolveGrabZone(x, 20)), ['left', 'body', 'body', 'body', 'right']);
  // 몸통 끌기 임계는 마우스의 작은 떨림보다 크고 손가락 길게 누르기 허용(8px)보다 작다
  assert.ok(BODY_DRAG_THRESHOLD_PX > 0 && BODY_DRAG_THRESHOLD_PX < LONGPRESS_MOVE_THRESHOLD_PX);
});

test('잡은 자리: 화면이 그리는 손잡이 폭(index.html 의 --edge-grab · 블록 폭 25%)이 계산의 가장자리 폭과 같다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const token = html.match(/--edge-grab:\s*(\d+)px/);
  assert.ok(token, ':root 에 --edge-grab 이 있다');
  assert.equal(Number(token[1]), EDGE_GRAB_PX, '--edge-grab 과 EDGE_GRAB_PX 가 어긋나면 보이는 손잡이와 잡히는 자리가 다르다');
  assert.match(html, /width:\s*min\(var\(--edge-grab\),\s*25%\)/, '손잡이 폭도 grabEdgeWidth 처럼 블록 폭의 1/4 에서 멈춘다');
});

test('시작점 트리밍: 포인터 밑 칸이 새 시작이고 끝 칸은 그대로, 끝을 넘지 못하고 보드 앞 끝에서 멈춘다', () => {
  // 블록 r2 [3..5] = 선형 11..13
  const trim = { originStart: 11, originEnd: 13, startX: 100 };
  assert.deepEqual(resolveTrimStart(trim, { kind: 'cross', row: 2, col: 1 }, BOARD, -8), { start: 9, count: 5 });
  assert.deepEqual(resolveTrimStart(trim, { kind: 'sameRow', row: 2, col: 5 }, BOARD, -8), { start: 13, count: 1 });
  assert.deepEqual(resolveTrimStart(trim, { kind: 'cross', row: 3, col: 7 }, BOARD, -8), { start: 13, count: 1 }, '끝을 넘으면 1카운트');
  assert.deepEqual(resolveTrimStart(trim, { kind: 'cross', row: 1, col: 0 }, BOARD, -8), { start: 0, count: 14 }, '행을 넘겨 센다');
  assert.deepEqual(resolveTrimStart({ originStart: 1, originEnd: 2, startX: 0 }, { kind: 'cross', row: 0, col: 0 }, BOARD, 0),
    { start: 0, count: 3 }, '인트로 행이 없는 보드는 1행 첫 칸(0)에서 멈춘다');
  // 잴 트랙이 없으면 이동거리 ÷ 칸 폭을 반올림해 시작에 더한다
  assert.deepEqual(resolveTrimStart(trim, { kind: 'step', clientX: 100 - 58 * 2, stepWidth: 58 }, BOARD, -8), { start: 9, count: 5 });
  assert.deepEqual(resolveTrimStart(trim, { kind: 'step', clientX: 100 + 58 * 9, stepWidth: 58 }, BOARD, -8), { start: 13, count: 1 });
});
