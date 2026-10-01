// tests/unit/pendingKept.test.mjs — 받아 적기의 `?` 블록은 옮기고 늘이고 복사해도 `?` 다 (2026-10-01)
//
// 이동 · 복사 · 늘이기가 첫 세그먼트에서 옮겨 적는 meta 에 `pending` 이 빠져 있어, 이름을 아직 정하지 않은
// 블록을 끌어 옮기기만 해도 이름도 `?` 표시도 없는 빈 블록이 됐다. 키보드 이동(RM-13)이 같은 이동 길을 타므로
// 화살표 한 번에 표시가 사라졌다. docs/BUG_REPORTS.md 「이름 없는 블록을 옮기면 물음표 표시가 사라짐」.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../../src/domain/boardOps.js';

function boardWithPending() {
  let n = 0;
  const ids = () => `id${n++}`;
  const board = { rows: 4, cols: 8, hasIntroRow: true, placements: [] };
  const placed = ops.place(board, { move: { name: '', category: 'step', pending: true }, startRow: 1, startIndex: 0, totalCount: 2 }, ids);
  return { board: { ...board, placements: placed.placements }, groupId: placed.placements[0].groupId, ids };
}

test('`?` 블록을 옮겨도 pending 이 남는다', () => {
  const { board, groupId, ids } = boardWithPending();
  const moved = ops.moveGroup(board, { groupId, targetRow: 1, targetStartIndex: 3 }, ids);
  assert.equal(moved.placements.every(p => p.pending === true), true, '옮긴 블록에서 `?` 가 빠졌다');
});

test('`?` 블록을 늘여도 pending 이 남는다', () => {
  const { board, groupId, ids } = boardWithPending();
  const resized = ops.resizeGroup(board, { groupId, newCount: 4 }, ids);
  assert.equal(resized.placements.every(p => p.pending === true), true);
});

test('`?` 블록을 복사하면 복사본도 `?` 다', () => {
  const { board, groupId, ids } = boardWithPending();
  const copied = ops.copyGroup(board, { groupId, targetRow: 2, targetStartIndex: 0 }, ids);
  assert.equal(copied.placements.length, 2);
  assert.equal(copied.placements.every(p => p.pending === true), true);
});

test('이름 있는 블록에는 pending 키가 생기지 않는다 — 저장 바이트가 그대로다', () => {
  let n = 0;
  const ids = () => `id${n++}`;
  const board = { rows: 4, cols: 8, hasIntroRow: true, placements: [] };
  const placed = ops.place(board, { move: { name: 'Swing Out', category: 'step' }, startRow: 1, startIndex: 0, totalCount: 2 }, ids);
  const groupId = placed.placements[0].groupId;
  const moved = ops.moveGroup({ ...board, placements: placed.placements }, { groupId, targetRow: 1, targetStartIndex: 3 }, ids);
  assert.equal(moved.placements.some(p => 'pending' in p), false);
});
