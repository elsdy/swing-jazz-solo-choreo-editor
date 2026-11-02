// tests/unit/selection.test.mjs — 고르기 규칙(domain/selection)과 그 위의 보드 명령 (RM-14, 2026-11-02)
//
// 두 층을 본다.
//   ① 순수 규칙 — 범위 · 네모 · 클릭의 뜻 · 사라진 블록 걸러 내기 (domain/selection)
//   ② 명령(usecases/boardCommands) — 그것만 · 더하기/빼기 · 범위 · 네모가 store.selection 과 앵커를 어떻게 바꾸나
//
// 가짜 격자: 메인 보드 8x8(intro 행 0 + 1..8). 세그먼트는 { groupId, row, startIndex, length, subRow }.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupSpan, groupsInRect, presentAnchor, presentOnly, rangeBetween, selectionAfterClick,
} from '../../src/domain/selection.js';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0, ...extra });
const board = (placements) => ({ rows: 8, cols: 8, hasIntroRow: true, placements });

/**
 * 시간 순서로 a(1행 0..1) · b(1행 4..5) · under(1행 4..5 **아래층**) · span(2행 6..7 + 3행 0..1, 두 행에 걸침) · c(4행 2..3) · d(6행 0..1).
 */
const BOARD = board([
  seg('a', 1, 0, 2),
  seg('b', 1, 4, 2),
  seg('under', 1, 4, 2, { subRow: 1 }),
  seg('span', 2, 6, 2), seg('span', 3, 0, 2),
  seg('c', 4, 2, 2),
  seg('d', 6, 0, 2),
]);

// ── ① 순수 규칙 ─────────────────────────────────────────────────────────────

test('범위 고르기: 앵커부터 누른 블록까지 시간 순서로, 아래층 · 여러 행 그룹도 통째로', () => {
  // a → c : a · b · 아래층 under · 두 행에 걸친 span · c. d 는 뒤라 빠진다
  assert.deepEqual(rangeBetween(BOARD, 'a', 'c'), ['a', 'b', 'under', 'span', 'c']);
  // 앞 · 뒤 어느 쪽을 눌러도 같은 범위
  assert.deepEqual(rangeBetween(BOARD, 'c', 'a'), rangeBetween(BOARD, 'a', 'c'));
  // 두 행에 걸친 그룹은 id 하나로 한 번만 들어간다
  assert.equal(rangeBetween(BOARD, 'b', 'span').filter(id => id === 'span').length, 1);
  assert.deepEqual(rangeBetween(BOARD, 'b', 'span'), ['b', 'under', 'span']);
  // 같은 블록을 두 번 누르면 그것 하나
  assert.deepEqual(rangeBetween(BOARD, 'c', 'c'), ['c']);
  // 앵커가 없거나(처음 Shift+클릭) 사라졌으면 누른 것 하나
  assert.deepEqual(rangeBetween(BOARD, null, 'c'), ['c']);
  assert.deepEqual(rangeBetween(BOARD, 'ghost', 'c'), ['c']);
  // 누른 것이 없으면 앵커 하나, 둘 다 없으면 빈 배열
  assert.deepEqual(rangeBetween(BOARD, 'a', 'ghost'), ['a']);
  assert.deepEqual(rangeBetween(BOARD, null, 'ghost'), []);
  // 구간은 선형 카운트다 — intro 행(0)에서 시작해도 센다
  const withIntro = board([seg('i', 0, 6, 2), seg('a', 1, 0, 2), seg('b', 1, 4, 2)]);
  assert.deepEqual(rangeBetween(withIntro, 'b', 'i'), ['i', 'a', 'b']);
  assert.deepEqual(groupSpan(withIntro, 'i'), { start: -2, end: 0 });
  assert.equal(groupSpan(withIntro, 'ghost'), null);
});

test('네모 고르기: 행을 넘은 네모에 한 조각이라도 닿은 그룹은 통째로, 닿지 않은 것은 빠진다', () => {
  // 1행 3칸 ~ 2행 7칸: b · under(1행 4..5) · span 의 2행 조각(6..7) → span 통째로. a(0..1) · c · d 는 밖
  assert.deepEqual(groupsInRect(BOARD, { rowFrom: 1, rowTo: 2, colFrom: 3, colTo: 7 }), ['b', 'under', 'span']);
  // 3행 0칸 한 칸만 — span 의 둘째 조각에 닿는다
  assert.deepEqual(groupsInRect(BOARD, { rowFrom: 3, rowTo: 3, colFrom: 0, colTo: 0 }), ['span']);
  // 블록 가장자리 바로 옆 칸은 닿지 않은 것
  assert.deepEqual(groupsInRect(BOARD, { rowFrom: 1, rowTo: 1, colFrom: 2, colTo: 3 }), []);
  assert.deepEqual(groupsInRect(BOARD, { rowFrom: 5, rowTo: 5, colFrom: 0, colTo: 7 }), []);
  assert.deepEqual(groupsInRect(BOARD, null), []);
  // 전부 덮으면 시간 순서로 전부
  assert.deepEqual(groupsInRect(BOARD, { rowFrom: 0, rowTo: 8, colFrom: 0, colTo: 7 }), ['a', 'b', 'under', 'span', 'c', 'd']);
});

test('클릭의 뜻(순수): 그것만 · 더하기/빼기 · 범위 — 셋 다 누른 블록이 앵커가 된다', () => {
  const cur = { selection: new Set(['a', 'd']), anchor: 'a' };
  const only = selectionAfterClick(BOARD, cur, 'c', 'only');
  assert.deepEqual([...only.selection], ['c']);
  assert.equal(only.anchor, 'c');

  const add = selectionAfterClick(BOARD, cur, 'c', 'toggle');
  assert.deepEqual([...add.selection].sort(), ['a', 'c', 'd']);
  assert.equal(add.anchor, 'c');
  const remove = selectionAfterClick(BOARD, cur, 'd', 'toggle');
  assert.deepEqual([...remove.selection], ['a']);
  assert.equal(remove.anchor, 'd', '뺀 블록도 앵커다 — 다음 Shift+클릭이 거기서 센다');

  const range = selectionAfterClick(BOARD, cur, 'c', 'range');
  assert.deepEqual([...range.selection].sort(), ['a', 'b', 'c', 'd', 'span', 'under'], '지금 고른 d 는 남고 a~c 범위가 더해진다');
  assert.equal(range.anchor, 'c');
  // 들어온 집합은 건드리지 않는다
  assert.deepEqual([...cur.selection], ['a', 'd']);
});

test('사라진 블록 걸러 내기: 없는 그룹은 선택과 앵커에서 빠진다', () => {
  assert.deepEqual(presentOnly(BOARD, ['d', 'ghost', 'a']), ['d', 'a']);
  assert.deepEqual(presentOnly(BOARD, new Set()), []);
  assert.equal(presentAnchor(BOARD, 'c'), 'c');
  assert.equal(presentAnchor(BOARD, 'ghost'), null);
  assert.equal(presentAnchor(BOARD, null), null);
});
