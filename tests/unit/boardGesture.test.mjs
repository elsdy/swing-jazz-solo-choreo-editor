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

test('마우스 그리기: 동작을 고르지 않았으면 움직이고 떼도 아무 일이 없다', () => {
  const s = G.initialGestureState();
  assert.deepEqual(G.mouseDown(s, mouse(2, 3), env()).effects, []);
  assert.deepEqual(G.mouseMove(s, at(2, 3), env()).effects, []);
  assert.deepEqual(G.mouseUp(s, at(2, 3), env()).effects, []);
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

// ── 더블탭 지우기 ───────────────────────────────────────────────────────────

const tap = (now, groupId = 'g1', routineGuarded = false) => ({ now, groupId, routineGuarded });

test('더블탭: 300ms 안에 같은 블록을 두 번 누르면 지우고 커밋한 뒤 탭 기억을 비운다', () => {
  const first = G.placementTap(G.initialGestureState(), tap(1000));
  assert.deepEqual(first.effects, []);
  const second = G.placementTap(first.state, tap(1299));
  assert.deepEqual(second.effects, [{ kind: 'preventDefault' }, { kind: 'remove', groupId: 'g1' }, { kind: 'commit' }]);
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

test('더블탭: 루틴 블록의 탭은 기본 동작을 막지 않고 지우지 않으며 탭 기억을 비운다 — 세 번째 탭도 더블탭이 아니다 (RM-11)', () => {
  const s1 = G.placementTap(G.initialGestureState(), tap(1000, 'r1', true));
  assert.deepEqual(s1.effects, []);
  const second = G.placementTap(s1.state, tap(1100, 'r1', true));
  assert.deepEqual(second.effects, []);                        // 옛 동작: [preventDefault] — 그래서 팝업이 안 떴다
  assert.deepEqual(second.state.tap, { time: 0, groupId: null });
  const third = G.placementTap(second.state, tap(1250, 'r1', true));
  assert.deepEqual(third.effects, []);
  // 루틴 블록을 누른 뒤 동작 블록을 두 번 누르면 그것은 평소대로 더블탭이다
  const n1 = G.placementTap(third.state, tap(1300, 'g1', false)).state;
  assert.deepEqual(kinds(G.placementTap(n1, tap(1400, 'g1', false))), ['preventDefault', 'remove', 'commit']);
});

// ── 포인터 종류로 전이 고르기 (RM-11) ────────────────────────────────────────

test('포인터 종류: touch 만 손가락이고 mouse · pen · 빈 값은 마우스다', () => {
  assert.equal(G.pointerKind('touch'), 'touch');
  for (const t of ['mouse', 'pen', '', undefined, null]) assert.equal(G.pointerKind(t), 'mouse');
});

test('포인터 종류로 고른 전이가 옛 리스너 차례 그대로다 — 마우스는 한 함수씩, 손가락은 그리기 뒤에 빠른 배치', () => {
  const m = G.transitionsFor('mouse');
  assert.deepEqual([m.down, m.move, m.up, m.cancel], [[G.mouseDown], [G.mouseMove], [G.mouseUp], [G.mouseCancel]]);
  const f = G.transitionsFor('touch');
  assert.deepEqual([f.down, f.move, f.up, f.cancel], [
    [G.touchDrawStart, G.quickTouchStart], [G.touchDrawMove, G.quickTouchMove],
    [G.touchDrawEnd, G.quickTouchEnd], [G.touchDrawCancel, G.quickTouchCancel],
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
