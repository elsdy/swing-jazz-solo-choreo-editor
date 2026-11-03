// tests/unit/boardGesture.test.mjs — 보드 위 그리기·빠른 배치·더블탭의 전이 (RM-08, 2026-10-01)
//
// domain/boardGesture 의 전이 함수를 가짜 격자 위에서 돌린다. 시험은 **바깥에서 보이는 값**만 본다 —
// 프리뷰가 몇 칸인가, 몇 칸이 놓이는가, 팝업이 어느 칸·어느 좌표에 뜨는가. RM-11(포인터 이벤트 통일)·
// RM-12(몸통 끌기)가 이 층을 다시 짤 때 이 기대값이 "지금 동작"의 기록이다.
//
// 가짜 격자: 8x8 보드(마지막 행 인덱스 8), 칸 폭 10px, 행 높이 40px. 화면 (x, y) → 칸 floor(x/10), 행 floor(y/40).
// 보드 밖(y ≥ 360 또는 x ≥ 80)이면 hitAt 은 inBoard=false 이고, endAt 은 앵커 행으로 되돌아간다
// (input/hitTest 의 fallbackTrack/fallbackRow 와 같은 규칙).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as G from '../../src/domain/boardGesture.js';

const BOARD = { rows: 8, cols: 8 };
const CELL_W = 10;
const ROW_H = 40;
const colOf = (x) => Math.max(0, Math.min(BOARD.cols - 1, Math.floor(x / CELL_W)));
const inBoard = (x, y) => x >= 0 && x < BOARD.cols * CELL_W && y >= 0 && y < (BOARD.rows + 1) * ROW_H;
const track = (row) => ({ row });

function env(over = {}) {
  return {
    quickPlaceMode: false,
    activeMove: null,
    marquee: true,
    defaultCount: 4,
    board: BOARD,
    colAt: (_track, x) => colOf(x),
    endAt: (anchor, x, y) => inBoard(x, y)
      ? { endRow: Math.floor(y / ROW_H), endCol: colOf(x) }
      : { endRow: anchor.row, endCol: colOf(x) },
    hitAt: (x, y) => inBoard(x, y)
      ? { inBoard: true, track: track(Math.floor(y / ROW_H)), row: Math.floor(y / ROW_H), col: colOf(x) }
      : { inBoard: false, track: null, row: null, col: null },
    ...over,
  };
}
/** 화면 (row, col) 칸 가운데의 좌표. */
const at = (row, col) => ({ x: col * CELL_W + 5, y: row * ROW_H + 20 });
const mouse = (row, col, extra = {}) => ({ ...at(row, col), track: track(row), row, onPlacement: false, ...extra });
const kinds = (r) => r.effects.map(fx => fx.kind);
const previewOf = (r) => r.effects.find(fx => fx.kind === 'preview');

/** 전이 함수 여럿을 차례로 돌린다. 마지막 결과를 돌려준다. */
function run(steps, e) {
  let state = G.initialGestureState();
  let last = null;
  for (const [fn, ev] of steps) { last = fn(state, ev, e); state = last.state; }
  return last;
}

const DRAW = env({ activeMove: { moveId: 'm1' } });
const QUICK = env({ quickPlaceMode: true });

// ── 마우스 그리기 ───────────────────────────────────────────────────────────

test('마우스 그리기: 누르면 한 칸 프리뷰, 다음 행까지 끌면 행을 넘겨 센다, 떼면 그만큼 놓고 커밋한다', () => {
  const down = G.mouseDown(G.initialGestureState(), mouse(2, 3), DRAW);
  assert.deepEqual(kinds(down), ['preventDefault', 'preview']);
  assert.deepEqual(previewOf(down), { kind: 'preview', row: 2, startIndex: 3, count: 1 });

  const move = G.mouseMove(down.state, at(3, 1), DRAW);
  // 2행 3..7 (5칸) + 3행 0..1 (2칸)
  assert.equal(previewOf(move).count, 7);

  const up = G.mouseUp(move.state, at(3, 1), DRAW);
  assert.deepEqual(up.effects, [
    { kind: 'place', moveId: 'm1', startRow: 2, startIndex: 3, totalCount: 7 },
    { kind: 'commit' },
    { kind: 'clearPreview' },
  ]);
  assert.equal(up.state.draw, null);
});

test('마우스 그리기: 한 칸 프리뷰를 보고 떼면 기본 카운트만큼 놓인다(프리뷰 하한 1 · 놓을 때 하한 기본 카운트)', () => {
  const r = run([[G.mouseDown, mouse(1, 0)], [G.mouseMove, at(1, 0)]], DRAW);
  assert.equal(previewOf(r).count, 1);
  const up = G.mouseUp(r.state, at(1, 0), DRAW);
  assert.equal(up.effects[0].totalCount, 4);
});

test('마우스 그리기: 보드 밖으로 끌어도 시작 행 기준으로 센다', () => {
  const r = run([[G.mouseDown, mouse(2, 3)], [G.mouseMove, { x: 55, y: 900 }]], DRAW);
  assert.equal(previewOf(r).count, 3);   // 2행 3..5
});

test('마우스 그리기: 시작보다 앞으로 끌면 1칸 프리뷰다', () => {
  const r = run([[G.mouseDown, mouse(4, 5)], [G.mouseMove, at(2, 0)]], DRAW);
  assert.equal(previewOf(r).count, 1);
});

test('마우스 그리기: 블록 위나 트랙 밖을 누르면 아무 일도 없다', () => {
  for (const ev of [mouse(2, 3, { onPlacement: true }), { ...at(2, 3), track: null, row: null, onPlacement: false }]) {
    const r = G.mouseDown(G.initialGestureState(), ev, DRAW);
    assert.deepEqual(r.effects, []);
    assert.equal(r.state.draw, null);
  }
});

test('마우스 그리기: 동작을 고르지 않았으면 그리지 않는다 — 끌지 않고 떼면 아무 일이 없다(네모 고르기 후보만, RM-14)', () => {
  const down = G.mouseDown(G.initialGestureState(), mouse(2, 3), env());
  assert.deepEqual(kinds(down), ['preventDefault']);
  assert.equal(down.state.draw, null);
  // 임계(4px) 안의 떨림은 네모를 만들지 않는다.
  const jitter = G.mouseMove(down.state, { x: at(2, 3).x + 2, y: at(2, 3).y + 1 }, env());
  assert.deepEqual(jitter.effects, []);
  const up = G.mouseUp(jitter.state, at(2, 3), env());
  assert.deepEqual(up.effects, []);
  assert.equal(up.state.marquee, null);
  // 블록 위 누름 · 트랙 밖 누름은 네모를 시작하지 않는다.
  assert.deepEqual(G.mouseDown(G.initialGestureState(), mouse(2, 3, { onPlacement: true }), env()).effects, []);
  assert.deepEqual(G.mouseDown(G.initialGestureState(), { ...at(2, 3), track: null, row: null, onPlacement: false }, env()).effects, []);
  // 고르기를 허락하지 않는 보드(루틴 편성 보드)는 네모도 시작하지 않는다 — 옛 동작 그대로.
  assert.deepEqual(G.mouseDown(G.initialGestureState(), mouse(2, 3), env({ marquee: false })).effects, []);
});

test('마퀴: 빈 칸에서 끌면 점선 네모만 그리고 행은 다시 그리지 않다가, 떼면 행을 넘어 네모에 한 조각이라도 닿은 그룹을 모두 고른다', async () => {
  const { groupsInRect } = await import('../../src/domain/selection.js');
  const r1 = run([[G.mouseDown, mouse(2, 5)], [G.mouseMove, at(2, 7)]], env());
  assert.deepEqual(r1.effects, [{ kind: 'marquee', rect: { rowFrom: 2, rowTo: 2, colFrom: 5, colTo: 7 } }]);
  // 다음 행으로, 그리고 시작보다 왼쪽으로 — 네모는 정규화되어 자란다.
  const r2 = G.mouseMove(r1.state, at(3, 1), env());
  assert.deepEqual(r2.effects, [{ kind: 'marquee', rect: { rowFrom: 2, rowTo: 3, colFrom: 1, colTo: 5 } }]);
  // 끄는 동안 나온 효과는 점선 네모뿐 — 프리뷰 · 놓기 · 커밋 · 선택 바꾸기가 없다.
  for (const fx of [...r1.effects, ...r2.effects]) assert.equal(fx.kind, 'marquee');
  const up = G.mouseUp(r2.state, at(3, 1), env());
  assert.deepEqual(up.effects, [
    { kind: 'selectRect', rect: { rowFrom: 2, rowTo: 3, colFrom: 1, colTo: 5 } },
    { kind: 'clearMarquee' },
  ]);
  assert.equal(up.state.marquee, null);
  // 그 네모(2~3행 · 1~5칸)로 고르면: 2행 7칸 → 3행 0~1칸으로 행을 넘는 그룹은 3행 1칸 한 조각만 닿아도 통째로,
  // 아래층(subRow 1) 블록도, 3행 4~7칸 블록(4칸이 닿음)도 들어가고, 2행 6칸만 덮는 블록은 빠진다.
  const board = { cols: 8, placements: [
    { groupId: 'far', row: 2, startIndex: 6, length: 1 },
    { groupId: 'wrap', row: 2, startIndex: 7, length: 1 }, { groupId: 'wrap', row: 3, startIndex: 0, length: 2 },
    { groupId: 'low', row: 2, startIndex: 1, length: 1, subRow: 1 },
    { groupId: 'tail', row: 3, startIndex: 4, length: 4 },
  ] };
  assert.deepEqual(groupsInRect(board, up.effects[0].rect), ['low', 'wrap', 'tail']);
});

// ── 마우스 빠른 배치 ─────────────────────────────────────────────────────────

test('빠른 배치: 동작을 고르지 않았으면 빠른 배치가 이기고 기본 카운트 프리뷰로 시작한다', () => {
  const r = G.mouseDown(G.initialGestureState(), mouse(2, 3), QUICK);
  assert.equal(r.state.draw, null);
  assert.ok(r.state.quickDraw);
  assert.deepEqual(previewOf(r), { kind: 'preview', row: 2, startIndex: 3, count: 4 });
});

test('빠른 배치: 모드가 켜져 있어도 동작을 골라 두었으면 그리기가 이긴다', () => {
  const r = G.mouseDown(G.initialGestureState(), mouse(2, 3), env({ quickPlaceMode: true, activeMove: { moveId: 'm1' } }));
  assert.equal(r.state.quickDraw, null);
  assert.ok(r.state.draw);
});

test('빠른 배치: 끈 만큼 세고, 떼면 프리뷰를 지우지 않고 마지막 커서 자리에 팝업을 연다', () => {
  const r = run([[G.mouseDown, mouse(2, 3)], [G.mouseMove, at(2, 6)]], QUICK);
  assert.equal(previewOf(r).count, 4);
  const up = G.mouseUp(r.state, { x: 999, y: 999 }, QUICK);
  assert.deepEqual(up.effects, [
    { kind: 'openPicker', row: 2, startIndex: 3, ...((p) => ({ clientX: p.x, clientY: p.y }))(at(2, 6)), count: 4 },
  ]);
  assert.equal(up.state.quickDraw, null);
});

test('빠른 배치: 끌지 않고 떼면 누른 자리에 기본 카운트로 팝업을 연다', () => {
  const r = G.mouseDown(G.initialGestureState(), mouse(5, 1), QUICK);
  const up = G.mouseUp(r.state, at(5, 1), QUICK);
  assert.equal(up.effects[0].count, 4);
  assert.equal(up.effects[0].startIndex, 1);
});

test('빠른 배치: 끄는 도중 모드가 꺼지면 떼어도 팝업 없이 프리뷰만 지운다', () => {
  const r = G.mouseDown(G.initialGestureState(), mouse(2, 3), QUICK);
  const up = G.mouseUp(r.state, at(2, 3), env());
  assert.deepEqual(kinds(up), ['clearPreview']);
  assert.equal(up.state.quickDraw, null);
});

test('빠른 배치: 끝 행에서 보드 밖 아래로 끌어도 그 행의 남은 칸을 넘지 않는다', () => {
  // 8행(마지막) 6칸에서 시작 — 남은 칸 2. 보드 밖 아래로 끌면 시작 행 기준이라 끝 칸 7 → 2칸.
  const r = run([[G.mouseDown, mouse(8, 6)], [G.mouseMove, { x: 75, y: 9999 }]], QUICK);
  assert.equal(previewOf(r).count, 2);
});

// ── 터치 그리기 ─────────────────────────────────────────────────────────────

test('터치 그리기: 손가락 밑 칸에서 시작해 한 칸 프리뷰, 기본 동작은 막지 않고 버블만 멈춘다', () => {
  const r = G.touchDrawStart(G.initialGestureState(), { ...at(2, 3), onPlacement: false }, DRAW);
  assert.deepEqual(kinds(r), ['stopPropagation', 'preview']);
  assert.equal(previewOf(r).count, 1);
});

test('터치 그리기: 다른 행으로 끌면 마우스처럼 행을 넘겨 센다 (RM-11 — 옛 「시작 행 안에서만」을 고쳤다)', () => {
  const r = run([
    [G.touchDrawStart, { ...at(2, 3), onPlacement: false }],
    [G.touchDrawMove, at(5, 1)],   // 2행 3..7(5) + 3·4행(16) + 5행 0..1(2)
  ], DRAW);
  assert.equal(previewOf(r).count, 23);
  const m = run([
    [G.mouseDown, mouse(2, 3)],
    [G.mouseMove, at(5, 1)],
  ], DRAW);
  assert.equal(previewOf(m).count, previewOf(r).count);   // 손가락과 마우스가 같은 답
  const back = G.touchDrawMove(r.state, at(1, 7), DRAW);
  assert.equal(previewOf(back).count, 1);  // 시작보다 앞이면 프리뷰 하한 1
});

test('터치 그리기: 떼면 행을 넘겨 센 만큼(하한 기본 카운트) 놓고, 보드 끝에서 자른다', () => {
  const s = G.touchDrawStart(G.initialGestureState(), { ...at(2, 3), onPlacement: false }, DRAW).state;
  assert.equal(G.touchDrawEnd(s, at(2, 7), DRAW).effects[0].totalCount, 5);
  assert.equal(G.touchDrawEnd(s, at(3, 1), DRAW).effects[0].totalCount, 7);
  assert.equal(G.touchDrawEnd(s, at(2, 3), DRAW).effects[0].totalCount, 4);
  assert.deepEqual(kinds(G.touchDrawEnd(s, at(2, 7), DRAW)), ['place', 'commit', 'clearPreview']);
  // 마지막 행 너머를 가리키면 시작 자리에서 보드 끝까지(7행 4..7 + 8행 = 12칸)에서 자른다
  const far = env({ activeMove: { moveId: 'm1' }, endAt: () => ({ endRow: 12, endCol: 7 }) });
  const s7 = G.touchDrawStart(G.initialGestureState(), { ...at(7, 4), onPlacement: false }, far).state;
  assert.equal(G.touchDrawEnd(s7, at(8, 7), far).effects[0].totalCount, 12);
  assert.equal(previewOf(G.touchDrawMove(s7, at(8, 7), far)).count, 12);
});

test('터치 그리기: 보드 밖이나 블록 위에서 시작하면 아무 일도 없다', () => {
  const s = G.initialGestureState();
  assert.deepEqual(G.touchDrawStart(s, { x: 5, y: 9999, onPlacement: false }, DRAW).effects, []);
  assert.deepEqual(G.touchDrawStart(s, { ...at(2, 3), onPlacement: true }, DRAW).effects, []);
});

test('터치 그리기: 취소는 동작 선택과 상관없이 그리던 것을 지운다', () => {
  const s = G.touchDrawStart(G.initialGestureState(), { ...at(2, 3), onPlacement: false }, DRAW).state;
  const r = G.touchDrawCancel(s, null, env());
  assert.deepEqual(kinds(r), ['clearPreview']);
  assert.equal(r.state.draw, null);
  assert.deepEqual(G.touchDrawCancel(G.initialGestureState(), null, env()).effects, []);
});

// ── 손가락 빠른 배치 ─────────────────────────────────────────────────────────

test('손가락 빠른 배치: 같은 touchstart 에서 그리기가 먼저 시작했으면 빠른 배치는 비킨다', () => {
  const both = env({ quickPlaceMode: true, activeMove: { moveId: 'm1' } });
  const r = run([
    [G.touchDrawStart, { ...at(2, 3), onPlacement: false }],
    [G.quickTouchStart, { ...at(2, 3), onPlacement: false }],
  ], both);
  assert.ok(r.state.draw);
  assert.equal(r.state.quickTouch, null);
});

test('손가락 빠른 배치: 12px 안에서 떼면 탭 — 뗀 자리 칸에 기본 카운트로, 프리뷰를 지운 뒤 팝업을 연다', () => {
  const p = at(3, 2);
  const r = run([
    [G.quickTouchStart, { ...p, onPlacement: false }],
    [G.quickTouchMove, { x: p.x + 12, y: p.y }],   // 정확히 12px 은 아직 탭이다
  ], QUICK);
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.quickTouch.isDrag, false);
  const end = G.quickTouchEnd(r.state, { x: p.x + 12, y: p.y }, QUICK);
  assert.deepEqual(end.effects, [
    { kind: 'clearPreview' },
    { kind: 'openPicker', row: 3, startIndex: 3, clientX: p.x + 12, clientY: p.y, count: 4 },
  ]);
});

test('손가락 빠른 배치: 12px 을 넘으면 끌기 — 행을 넘겨 세고, 떼면 시작 칸·끈 카운트·마지막 손가락 자리로 연다', () => {
  const p = at(2, 6);
  const r = run([
    [G.quickTouchStart, { ...p, onPlacement: false }],
    [G.quickTouchMove, at(3, 1)],
  ], QUICK);
  assert.equal(r.state.quickTouch.isDrag, true);
  assert.equal(previewOf(r).count, 4);   // 2행 6..7 + 3행 0..1
  const end = G.quickTouchEnd(r.state, { x: 1, y: 1 }, QUICK);
  assert.deepEqual(end.effects[1], { kind: 'openPicker', row: 2, startIndex: 6, ...((q) => ({ clientX: q.x, clientY: q.y }))(at(3, 1)), count: 4 });
});

test('손가락 빠른 배치: 한 번 끌기가 되면 제자리로 돌아와도 끌기다(탭으로 되돌아가지 않는다)', () => {
  const p = at(2, 2);
  const r = run([
    [G.quickTouchStart, { ...p, onPlacement: false }],
    [G.quickTouchMove, { x: p.x, y: p.y + 30 }],
    [G.quickTouchMove, { x: p.x, y: p.y }],
  ], QUICK);
  assert.equal(r.state.quickTouch.isDrag, true);
  assert.equal(previewOf(r).count, 1);
});

test('손가락 빠른 배치: 취소는 프리뷰를 지우고 상태를 비운다', () => {
  const s = G.quickTouchStart(G.initialGestureState(), { ...at(2, 2), onPlacement: false }, QUICK).state;
  const r = G.quickTouchCancel(s, null, QUICK);
  assert.deepEqual(kinds(r), ['clearPreview']);
  assert.equal(r.state.quickTouch, null);
});

// ── 더블탭 — 동작 고르기 창 (RM-12, 2026-11-03 전에는 지우기였다) ─────────────────────────

const tap = (now, groupId = 'g1', routineGuarded = false) => ({ now, groupId, routineGuarded, x: 33, y: 44 });

test('더블탭: 300ms 안에 같은 블록을 두 번 누르면 동작 고르기 창을 열고 지우지 않는다', () => {
  const first = G.placementTap(G.initialGestureState(), tap(1000));
  assert.deepEqual(first.effects, []);
  const second = G.placementTap(first.state, tap(1299));
  // 옛 기대: [preventDefault, remove g1, commit] — 확인 없이 지웠다(RM-12 의 의도한 동작 변경)
  assert.deepEqual(second.effects, [
    { kind: 'preventDefault' }, { kind: 'openGroupPicker', groupId: 'g1', clientX: 33, clientY: 44 },
  ]);
  assert.ok(!kinds(second).includes('remove') && !kinds(second).includes('commit'), '지우지도 커밋하지도 않는다');
  assert.deepEqual(second.state.tap, { time: 0, groupId: null });
});

test('더블탭: 정확히 300ms 이거나 다른 블록이면 더블탭이 아니고, 그 탭이 새 첫 탭이 된다', () => {
  const s = G.placementTap(G.initialGestureState(), tap(1000)).state;
  const late = G.placementTap(s, tap(1300));
  assert.deepEqual(late.effects, []);
  assert.deepEqual(late.state.tap, { time: 1300, groupId: 'g1' });
  const other = G.placementTap(s, tap(1100, 'g2'));
  assert.deepEqual(other.effects, []);
  assert.deepEqual(other.state.tap, { time: 1100, groupId: 'g2' });
});

test('더블탭: 루틴 블록의 탭은 기본 동작을 막지 않고 창을 열지 않으며 탭 기억을 비운다 — 세 번째 탭도 더블탭이 아니다 (RM-11 · RM-12)', () => {
  const s1 = G.placementTap(G.initialGestureState(), tap(1000, 'r1', true));
  assert.deepEqual(s1.effects, []);
  const second = G.placementTap(s1.state, tap(1100, 'r1', true));
  assert.deepEqual(second.effects, []);                        // 옛 동작: [preventDefault] — 그래서 팝업이 안 떴다
  assert.deepEqual(second.state.tap, { time: 0, groupId: null });
  const third = G.placementTap(second.state, tap(1250, 'r1', true));
  assert.deepEqual(third.effects, []);
  // 루틴 블록을 누른 뒤 동작 블록을 두 번 누르면 그것은 평소대로 더블탭이다
  const n1 = G.placementTap(third.state, tap(1300, 'g1', false)).state;
  assert.deepEqual(kinds(G.placementTap(n1, tap(1400, 'g1', false))), ['preventDefault', 'openGroupPicker']);
});

// ── 블록을 잡는 자리 — 가장자리 트리밍 · 몸통 끌기 (RM-12) ────────────────────────────────

const down = (zone, extra = {}) => ({ ...at(1, 2), groupId: 'g1', zone, routineGuarded: false, altKey: false, pointerType: 'mouse', bundle: null, ...extra });

test('가장자리 끌기: 왼쪽은 시작점, 오른쪽은 길이 트리밍을 그 블록 · 누른 x 로 시작한다 — 마우스든 손가락이든', () => {
  for (const pointerType of ['mouse', 'touch']) {
    for (const edge of ['left', 'right']) {
      const r = G.placementDown(G.initialGestureState(), down(edge, { pointerType }));
      assert.deepEqual(r.effects, [{ kind: 'preventDefault' }, { kind: 'startTrim', edge, groupId: 'g1', clientX: at(1, 2).x }]);
      assert.equal(r.state.body, null, '트리밍은 몸통 끌기 후보를 남기지 않는다');
    }
  }
});

test('가장자리 끌기: 메인 보드의 루틴 블록은 왼쪽·오른쪽 모두 트리밍을 시작하지 않는다', () => {
  for (const edge of ['left', 'right']) {
    for (const pointerType of ['mouse', 'touch']) {
      const r = G.placementDown(G.initialGestureState(), down(edge, { routineGuarded: true, pointerType }));
      assert.ok(!kinds(r).includes('startTrim'), `${pointerType} ${edge}`);
    }
    // 대신 몸통처럼 다룬다 — 마우스로 끌면 옮긴다(루틴 블록은 지금도 옮겨진다)
    const m = G.placementDown(G.initialGestureState(), down(edge, { routineGuarded: true }));
    assert.equal(m.state.body?.groupId, 'g1');
  }
});

test('몸통 끌기: 임계 전에 떼면 고르기, 넘기면 옮기기 프리뷰, 떼면 옮기고 커밋한다, Alt면 복사', () => {
  const E = env();
  const p0 = at(1, 2);
  // ① 임계(4px) 전에 떼면 할 일이 없다 — 뒤따르는 click 이 지금처럼 고른다(삼키지 않는다)
  {
    const r = run([
      [G.placementDown, down('body')],
      [G.bodyMove, { x: p0.x + 3, y: p0.y }],
      [G.bodyUp, { x: p0.x + 3, y: p0.y }],
    ], E);
    assert.deepEqual(r.effects, []);
    assert.equal(r.state.body, null);
  }
  // ② 넘기면 옮기기가 한 번 시작되고 포인터 밑 칸에 프리뷰, 보드 밖이면 프리뷰를 지운다. 떼면 끝내고 옮기고 커밋하고 click 을 삼킨다
  {
    let s = G.placementDown(G.initialGestureState(), down('body')).state;
    const m1 = G.bodyMove(s, at(3, 5), E); s = m1.state;
    assert.deepEqual(m1.effects, [
      { kind: 'beginMove', groupId: 'g1', copy: false, bundle: null }, { kind: 'movePreview', row: 3, startIndex: 5 },
    ]);
    const m2 = G.bodyMove(s, { x: 999, y: 20 }, E); s = m2.state;
    assert.deepEqual(m2.effects, [{ kind: 'clearPreview' }], '한 번 시작된 옮기기는 다시 시작하지 않는다');
    const m3 = G.bodyMove(s, at(4, 6), E); s = m3.state;
    assert.deepEqual(m3.effects, [{ kind: 'movePreview', row: 4, startIndex: 6 }]);
    const up = G.bodyUp(s, at(4, 6), E);
    assert.deepEqual(up.effects, [
      { kind: 'endMove' }, { kind: 'move', groupId: 'g1', row: 4, startIndex: 6 }, { kind: 'commit' }, { kind: 'swallowClick' },
    ]);
    assert.equal(up.state.body, null);
  }
  // ③ Alt 를 누른 채 누르면 복사다 — Alt 는 누른 순간에만 읽고, 복사는 묶음이 아니라 그 블록 하나다
  {
    const r = run([
      [G.placementDown, down('body', { altKey: true, bundle: ['g1', 'g2'] })],
      [G.bodyMove, at(2, 0)],
      [G.bodyUp, at(2, 0)],
    ], E);
    assert.deepEqual(kinds(r), ['endMove', 'copy', 'commit', 'swallowClick']);
    assert.deepEqual(r.effects[1], { kind: 'copy', groupId: 'g1', row: 2, startIndex: 0 });
  }
  // ④ 고른 묶음이면 묶음째 옮긴다(커밋은 옮겼을 때만 — 호출부가 정한다)
  {
    const r = run([
      [G.placementDown, down('body', { bundle: ['g1', 'g2'] })],
      [G.bodyMove, at(2, 0)],
      [G.bodyUp, at(2, 0)],
    ], E);
    assert.deepEqual(r.effects, [
      { kind: 'endMove' }, { kind: 'moveBundle', groupId: 'g1', row: 2, startIndex: 0, bundle: ['g1', 'g2'] }, { kind: 'swallowClick' },
    ]);
  }
  // ⑤ 보드 밖에서 떼면 놓지 않고 끝낸다 · 끌다가 취소되면 끝내기만 한다
  {
    const out = run([[G.placementDown, down('body')], [G.bodyMove, at(3, 5)], [G.bodyUp, { x: 999, y: 20 }]], E);
    assert.deepEqual(kinds(out), ['endMove', 'swallowClick']);
    const cancel = run([[G.placementDown, down('body')], [G.bodyMove, at(3, 5)], [G.bodyCancel, null]], E);
    assert.deepEqual(kinds(cancel), ['endMove']);
    const idle = run([[G.placementDown, down('body')], [G.bodyCancel, null]], E);
    assert.deepEqual(kinds(idle), []);
  }
});

test('몸통 끌기: 손가락의 몸통 누름은 아무것도 시작하지 않는다 — 굴리면 화면 넘기기, 길게 눌러야 옮기기', () => {
  const r = G.placementDown(G.initialGestureState(), down('body', { pointerType: 'touch' }));
  assert.deepEqual(r.effects, [], '기본 동작(스크롤)을 막지 않는다');
  assert.equal(r.state.body, null);
  assert.deepEqual(G.bodyMove(r.state, at(5, 5), env()).effects, []);
});

// ── 포인터 종류로 전이 고르기 (RM-11) ────────────────────────────────────────

test('포인터 종류: touch 만 손가락이고 mouse · pen · 빈 값은 마우스다', () => {
  assert.equal(G.pointerKind('touch'), 'touch');
  for (const t of ['mouse', 'pen', '', undefined, null]) assert.equal(G.pointerKind(t), 'mouse');
});

test('포인터 종류로 고른 전이가 옛 리스너 차례 그대로다 — 마우스는 한 함수씩, 손가락은 그리기 뒤에 빠른 배치, 맨 뒤에 네모(RM-48)', () => {
  const m = G.transitionsFor('mouse');
  assert.deepEqual([m.down, m.move, m.up, m.cancel], [[G.mouseDown], [G.mouseMove], [G.mouseUp], [G.mouseCancel]]);
  const f = G.transitionsFor('touch');
  // 손가락 네모(RM-48)의 시작은 길게 누르기 시계가 부르므로 down 에는 없다 — move · up · cancel 의 맨 뒤에만 선다.
  assert.deepEqual([f.down, f.move, f.up, f.cancel], [
    [G.touchDrawStart, G.quickTouchStart], [G.touchDrawMove, G.quickTouchMove, G.touchMarqueeMove],
    [G.touchDrawEnd, G.quickTouchEnd, G.touchMarqueeEnd], [G.touchDrawCancel, G.quickTouchCancel, G.touchMarqueeCancel],
  ]);
  assert.deepEqual(G.transitionsFor('pen'), m);
});

test('포인터 한 벌로 돌려도 마우스 그리기 · 손가락 그리기가 같은 할 일을 돌려준다(구조 커밋의 등가)', () => {
  // 모든 전이가 같은 ev 모양 {x, y, track, row, onPlacement} 을 받는다 — 손가락 전이는 track·row 를 읽지 않는다.
  const ev = (row, col) => mouse(row, col);
  const run2 = (type, evs) => {
    const T = G.transitionsFor(type);
    let state = G.initialGestureState(); const out = [];
    for (const [phase, e] of evs) for (const fn of T[phase]) { const r = fn(state, e, DRAW); state = r.state; out.push(...r.effects); }
    return out;
  };
  const viaMouse = run2('mouse', [['down', ev(2, 3)], ['move', ev(2, 6)], ['up', ev(2, 6)]]);
  const direct = [G.mouseDown, G.mouseMove, G.mouseUp].reduce((acc, fn, i) => {
    const r = fn(acc.state, [ev(2, 3), ev(2, 6), ev(2, 6)][i], DRAW); return { state: r.state, fx: [...acc.fx, ...r.effects] };
  }, { state: G.initialGestureState(), fx: [] }).fx;
  assert.deepEqual(viaMouse, direct);
  const viaFinger = run2('touch', [['down', ev(2, 3)], ['move', ev(2, 6)], ['up', ev(2, 6)]]);
  assert.deepEqual(viaFinger, [
    { kind: 'stopPropagation' }, { kind: 'preview', row: 2, startIndex: 3, count: 1 },
    { kind: 'preview', row: 2, startIndex: 3, count: 4 },
    { kind: 'place', moveId: 'm1', startRow: 2, startIndex: 3, totalCount: 4 }, { kind: 'commit' }, { kind: 'clearPreview' },
  ]);
});

test('마우스 포인터의 취소는 그리기 · 빠른 배치 끌기를 지우고, 아무것도 없으면 아무 일도 없다', () => {
  const d = G.mouseDown(G.initialGestureState(), mouse(2, 3), DRAW);
  const r = G.mouseCancel(d.state, null, DRAW);
  assert.deepEqual(kinds(r), ['clearPreview']);
  assert.equal(r.state.draw, null);
  const q = G.mouseDown(G.initialGestureState(), mouse(2, 3), QUICK);
  assert.equal(G.mouseCancel(q.state, null, QUICK).state.quickDraw, null);
  assert.deepEqual(G.mouseCancel(G.initialGestureState(), null, env()).effects, []);
});

// ── 블록 탭의 갈래 (RM-11 동작 커밋 ①) ──────────────────────────────────────

test('탭 팝업 갈래: 창 폭이 아니라 pointerType 으로 — 넓은 폭의 touch 는 팝업, 좁은 폭의 mouse 는 선택 토글', () => {
  // 창 폭은 인자에 없다 — 넓은 태블릿의 손가락도, 좁힌 데스크톱 창의 마우스도 종류로만 갈린다.
  assert.equal(G.placementTapRoute({ pointerType: 'touch', isRoutine: false, hasActionPopup: true }), 'action-popup');
  assert.equal(G.placementTapRoute({ pointerType: 'mouse', isRoutine: false, hasActionPopup: true }), 'toggle');
  assert.equal(G.placementTapRoute({ pointerType: 'pen', isRoutine: false, hasActionPopup: true }), 'toggle');
  // 팝업이 없는 보드(루틴 편집)는 손가락도 토글이고, 루틴 블록은 종류와 상관없이 루틴 팝업이다.
  assert.equal(G.placementTapRoute({ pointerType: 'touch', isRoutine: false, hasActionPopup: false }), 'toggle');
  assert.equal(G.placementTapRoute({ pointerType: 'touch', isRoutine: true, hasActionPopup: true }), 'routine-popup');
  assert.equal(G.placementTapRoute({ pointerType: 'mouse', isRoutine: true, hasActionPopup: false }), 'routine-popup');
});

// ── 전이 함수의 성질 ─────────────────────────────────────────────────────────

test('전이 함수는 들어온 상태를 고치지 않는다(새 상태를 돌려준다)', () => {
  const s0 = G.initialGestureState();
  const frozen = JSON.stringify(s0);
  const r = G.mouseDown(s0, mouse(2, 3), QUICK);
  G.mouseMove(r.state, at(3, 3), QUICK);
  assert.equal(JSON.stringify(s0), frozen);
  const before = JSON.stringify(r.state);
  G.mouseMove(r.state, at(3, 3), QUICK);
  assert.equal(JSON.stringify(r.state), before);
});

// ── 손가락 그리기 중 스크롤 막기 (RM-11 동작 ③) ───────────────────────────────
// 포인터 이벤트는 브라우저가 스크롤을 시작하면 pointercancel 로 그리기를 빼앗는다. 그리고 touch-action 은
// 누르는 순간(pointerdown 전)에 정해지므로, 그 보드가 그리기를 받을 상태일 때 **미리** 트랙에 걸어 둔다.

test('손가락 그리기 무장: 동작을 골랐거나 빠른 배치가 켜진 보드만 트랙의 스크롤을 막는다', () => {
  assert.equal(G.touchDrawArmed({ activeMove: null, quickPlaceMode: false }), false);
  assert.equal(G.touchDrawArmed({ activeMove: { moveId: 'm1' }, quickPlaceMode: false }), true);
  assert.equal(G.touchDrawArmed({ activeMove: null, quickPlaceMode: true }), true);
  assert.equal(G.touchDrawArmed({}), false);
});

test('손가락 그리기 무장: 무장한 보드의 트랙은 CSS 가 touch-action: none 이다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.board\[data-touch-draw="1"\] \.track\s*\{[^}]*touch-action:\s*none/);
});

// ── 행 라벨 메뉴 (RM-16, 2026-11-02) ─────────────────────────────────────────

test('행 라벨 우클릭·길게 누르기: 몸통 행이면 그 행 번호로 마디 메뉴를 열고, 인트로 행·라벨 밖이면 아무 일도 없다', () => {
  const s = G.initialGestureState();
  const e = env();
  const r = G.rowLabelPress(s, { row: 3, x: 12, y: 130 }, e);
  assert.deepEqual(r.effects, [
    { kind: 'preventDefault' },
    { kind: 'openRowMenu', row: 3, clientX: 12, clientY: 130, first: false, last: false },
  ]);
  assert.equal(r.state, s, '상태는 바꾸지 않는다');
  assert.equal(G.rowLabelPress(s, { row: 1, x: 0, y: 0 }, e).effects[1].first, true, '맨 위 행');
  assert.equal(G.rowLabelPress(s, { row: 8, x: 0, y: 0 }, e).effects[1].last, true, '맨 아래 행');
  for (const row of [0, 9, null, undefined, NaN, 2.5]) {
    assert.deepEqual(G.rowLabelPress(s, { row, x: 0, y: 0 }, e).effects, [], `row=${row} — 브라우저 메뉴를 막지도 않는다`);
  }
});

// ── 몸통 끌기의 잡은 칸 (RM-57) ─────────────────────────────────────────────────────────────
// 블록 몸통의 k번째 칸을 잡고 끌면 놓은 칸이 아니라 놓은 칸 − k 가 블록의 시작이다. 잡은 칸(grab)은 입력 계층이
// 누를 때 재어(gestureMath.grabOffset) placementDown 의 ev.grab 으로 넘긴다. 옛 왼쪽 이동 손잡이는 늘 0번 칸을 잡아
// 이 셈이 없어도 드러나지 않았다.

test('[RM-57 요구 0] 몸통 끌기: 잡은 칸 오프셋만큼 뺀 자리로 옮기고 · 복사하고 · 묶음을 옮긴다', () => {
  const E = env();
  const grabbed = (extra) => run([
    [G.placementDown, down('body', { grab: 2, ...extra })],
    [G.bodyMove, at(4, 6)],
    [G.bodyUp, at(4, 6)],
  ], E);
  const move = grabbed({});
  assert.deepEqual(move.effects.find(fx => fx.kind === 'move'), { kind: 'move', groupId: 'g1', row: 4, startIndex: 4 });
  const copy = grabbed({ altKey: true });
  assert.deepEqual(copy.effects.find(fx => fx.kind === 'copy'), { kind: 'copy', groupId: 'g1', row: 4, startIndex: 4 });
  const bundle = grabbed({ bundle: ['g1', 'g2'] });
  assert.deepEqual(bundle.effects.find(fx => fx.kind === 'moveBundle'),
    { kind: 'moveBundle', groupId: 'g1', row: 4, startIndex: 4, bundle: ['g1', 'g2'] });
  // 놓은 칸보다 잡은 칸이 크면 앞 행 끝으로 넘어간다(Q117 가 — 선형으로 뺀다)
  const wrap = run([[G.placementDown, down('body', { grab: 3 })], [G.bodyMove, at(4, 1)], [G.bodyUp, at(4, 1)]], E);
  assert.deepEqual(wrap.effects.find(fx => fx.kind === 'move'), { kind: 'move', groupId: 'g1', row: 3, startIndex: 6 });
  // 0번 칸을 잡으면(grab 이 없거나 0) 지금과 같다 — 놓은 칸이 시작이다
  for (const grab of [0, undefined]) {
    const r = run([[G.placementDown, down('body', { grab })], [G.bodyMove, at(4, 6)], [G.bodyUp, at(4, 6)]], E);
    assert.deepEqual(r.effects.find(fx => fx.kind === 'move'), { kind: 'move', groupId: 'g1', row: 4, startIndex: 6 }, `grab=${grab}`);
  }
});

test('[RM-57 요구 1] 몸통 끌기: 미리보기도 잡은 칸만큼 앞에 그린다', () => {
  const E = env();
  let s = G.placementDown(G.initialGestureState(), down('body', { grab: 2 })).state;
  for (const [row, col] of [[3, 5], [4, 6], [5, 1]]) {
    const m = G.bodyMove(s, at(row, col), E); s = m.state;
    const preview = m.effects.find(fx => fx.kind === 'movePreview');
    const up = G.bodyUp(s, at(row, col), E);
    const move = up.effects.find(fx => fx.kind === 'move');
    assert.deepEqual({ row: preview.row, startIndex: preview.startIndex }, { row: move.row, startIndex: move.startIndex },
      `(${row}, ${col}) — 미리보기 = 결과`);
  }
  const m = G.bodyMove(G.placementDown(G.initialGestureState(), down('body', { grab: 2 })).state, at(3, 5), E);
  assert.deepEqual(m.effects.find(fx => fx.kind === 'movePreview'), { kind: 'movePreview', row: 3, startIndex: 3 });
});

test('[RM-57 요구 5] 몸통 3번째 칸을 잡고 위 행으로 곧게 옮기면 시작 칸이 그대로다', () => {
  // 행 3 칸 0 에서 시작하는 8카운트 블록을 칸 2(3번째 칸)에서 잡아 바로 위 빈 행(2)의 같은 칸에 놓는다
  const r = run([
    [G.placementDown, { ...down('body'), ...at(3, 2), grab: 2 }],
    [G.bodyMove, at(2, 2)],
    [G.bodyUp, at(2, 2)],
  ], env());
  assert.deepEqual(r.effects.find(fx => fx.kind === 'move'), { kind: 'move', groupId: 'g1', row: 2, startIndex: 0 },
    '고치기 전에는 놓은 칸(2)이 시작이 되어 블록이 다음 마디로 넘쳤다');
});

// ── 손가락 네모 고르기 (RM-48) ─────────────────────────────────────────────
// 손가락의 빈 칸 끌기는 화면 넘기기라 누르자마자 네모가 될 수 없다 — 빈 칸을 길게 눌러야 시작한다(Q115). 시작은 입력 계층의
// 길게 누르기 시계가 touchMarqueeStart 를 부르고, 그 뒤의 이동 · 뗌 · 취소는 손가락 전이 표(transitionsFor('touch'))가 돌린다.

/** 손가락 전이 표의 한 단계(move · up · cancel)를 차례대로 돌린다 — 리스너가 하는 그대로. */
function fingerPhase(state, phase, ev, e) {
  const fx = [];
  for (const fn of G.transitionsFor('touch')[phase]) { const r = fn(state, ev, e); state = r.state; fx.push(...r.effects); }
  return { state, effects: fx };
}

test('[RM-48 요구 0] 손가락 네모: 길게 눌러 시작하면 점선 네모를 그리고, 떼면 네모 안 그룹을 고르고 네모를 지운다', () => {
  // 2행 5칸의 빈 칸을 길게 눌렀다 — 누른 한 칸을 점선 네모로 바로 보인다(이제 네모 고르기다).
  const s0 = G.touchMarqueeStart(G.initialGestureState(), { ...at(2, 5), onPlacement: false }, env());
  assert.deepEqual(s0.effects, [{ kind: 'marquee', rect: { rowFrom: 2, rowTo: 2, colFrom: 5, colTo: 5 } }]);
  assert.ok(s0.state.marquee, '네모 상태가 생겼다');
  // 끌면 손가락 밑 끝 칸까지 네모가 자란다 — 다음 행 · 시작보다 왼쪽이어도 정규화된다. 마우스 네모와 같은 rectCellRange 다.
  const m1 = fingerPhase(s0.state, 'move', at(3, 1), env());
  assert.deepEqual(m1.effects, [{ kind: 'marquee', rect: { rowFrom: 2, rowTo: 3, colFrom: 1, colTo: 5 } }]);
  // 보드 밖으로 끌면 시작 행으로 되돌아간 끝 칸을 쓴다(endAt 의 앵커 규칙)
  const m2 = fingerPhase(m1.state, 'move', { x: 3 * CELL_W + 5, y: 9999 }, env());
  assert.deepEqual(m2.effects, [{ kind: 'marquee', rect: { rowFrom: 2, rowTo: 2, colFrom: 3, colTo: 5 } }]);
  const m3 = fingerPhase(m2.state, 'move', at(3, 1), env());
  // 끄는 동안의 할 일은 점선 네모뿐 — 프리뷰 · 놓기 · 커밋 · 선택 바꾸기가 없다(그리기 · 빠른 배치 전이는 아무것도 내지 않는다).
  for (const fx of [...m1.effects, ...m2.effects, ...m3.effects]) assert.equal(fx.kind, 'marquee');
  // 떼면 네모 안을 고르고(selectRect) 그다음 네모를 지운다 — 이 차례로.
  const up = fingerPhase(m3.state, 'up', at(3, 1), env());
  assert.deepEqual(up.effects, [
    { kind: 'selectRect', rect: { rowFrom: 2, rowTo: 3, colFrom: 1, colTo: 5 } },
    { kind: 'clearMarquee' },
  ]);
  assert.equal(up.state.marquee, null);
});

test('[RM-48 요구 1] 손가락 네모: 동작을 골랐거나 빠른 배치면 시작하지 않고, 길게 누르지 않은 손가락 이동은 아무 할 일도 내지 않는다', () => {
  const blank = { ...at(2, 5), onPlacement: false };
  const init = G.initialGestureState();
  // 동작을 고른 보드 · 빠른 배치 보드 — 그 손가락 끌기는 그리기 · 빠른 배치의 것이다. 상태도 할 일도 그대로다.
  for (const e of [DRAW, QUICK]) {
    const r = G.touchMarqueeStart(init, blank, e);
    assert.equal(r.state, init, '상태를 바꾸지 않는다');
    assert.deepEqual(r.effects, []);
  }
  // 손가락 그리기가 이미 돌고 있으면(같은 누름의 down 이 그리기를 시작했다) 길게 누르기가 와도 빼앗지 않는다.
  const drawing = G.touchDrawStart(init, blank, DRAW).state;
  assert.equal(G.touchMarqueeStart(drawing, blank, env()).state, drawing);
  // 블록 위 · 보드 밖의 길게 누르기도 네모가 아니다(블록은 몸통 옮기기의 몫).
  assert.deepEqual(G.touchMarqueeStart(init, { ...blank, onPlacement: true }, env()).effects, []);
  assert.deepEqual(G.touchMarqueeStart(init, { x: 5, y: 9999, onPlacement: false }, env()).effects, []);
  // 길게 누르지 않은 손가락 이동(화면 넘기기) — 네모 전이는 아무 할 일도 내지 않는다.
  assert.deepEqual(G.touchMarqueeMove(init, at(3, 1), env()), { state: init, effects: [] });
  assert.deepEqual(fingerPhase(init, 'move', at(3, 1), env()).effects, []);
  // 마우스가 그리던 네모(finger 없음)는 손가락 전이가 건드리지 않는다.
  const mouseM = G.mouseDown(init, mouse(2, 5), env()).state;
  assert.deepEqual(G.touchMarqueeMove(mouseM, at(3, 1), env()).effects, []);
  assert.deepEqual(G.touchMarqueeEnd(mouseM).effects, []);
});

test('[RM-48 요구 2] 손가락 네모: 취소는 네모만 지우고 고르지 않으며, 끌기 전에 떼면 아무 할 일도 없다', () => {
  const s0 = G.touchMarqueeStart(G.initialGestureState(), { ...at(2, 5), onPlacement: false }, env()).state;
  const dragged = fingerPhase(s0, 'move', at(4, 2), env()).state;
  // 브라우저가 포인터를 빼앗았다(pointercancel) — 네모만 지우고 고르지 않는다.
  const c = fingerPhase(dragged, 'cancel', null, env());
  assert.deepEqual(c.effects, [{ kind: 'clearMarquee' }]);
  assert.equal(c.state.marquee, null);
  // 길게 누르고 끌지 않고 뗐다(rect 가 없다) — 누른 칸 표시만 지우고 고르지 않는다.
  const still = G.touchMarqueeEnd(s0);
  assert.deepEqual(still.effects, [{ kind: 'clearMarquee' }]);
  assert.ok(!still.effects.some(fx => fx.kind === 'selectRect'), 'rect 가 없으면 selectRect 를 내지 않는다');
  // 길게 누르기 전에(네모가 시작되기 전에) 뗐다 — 아무 할 일도 없다. 취소도 마찬가지다.
  const init = G.initialGestureState();
  assert.deepEqual(G.touchMarqueeEnd(init), { state: init, effects: [] });
  assert.deepEqual(G.touchMarqueeCancel(init), { state: init, effects: [] });
  assert.deepEqual(fingerPhase(init, 'up', at(2, 5), env()).effects, []);
});

test('[RM-48 요구 4] 손가락 네모: 고르기를 허락하지 않는 보드(env.marquee 거짓)에서는 시작하지 않는다', () => {
  const init = G.initialGestureState();
  const r = G.touchMarqueeStart(init, { ...at(2, 5), onPlacement: false }, env({ marquee: false }));
  assert.equal(r.state, init);
  assert.deepEqual(r.effects, []);
});
