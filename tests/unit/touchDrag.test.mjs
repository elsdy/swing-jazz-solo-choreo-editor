// tests/unit/touchDrag.test.mjs — 손가락 블록 옮기기(길게 누르기 → 끌기 → 놓기)의 놓을 자리 (RM-57, 2026-11-03)
//
// input/touchDrag 는 DOM 을 직접 만지지 않는다 — 측정(hitTest) · 고스트(overlays) · 커맨드가 모두 주입이다.
// 그래서 가짜 격자 위에서 start → moveGhost → finish 를 돌려 「미리보기가 그린 자리」와 「놓은 자리」를 값으로 잰다.
//
// 가짜 격자: 8x8 보드(마지막 행 인덱스 8, 인트로 행 없음), 칸 폭 10px, 행 높이 40px.
// 화면 (x, y) → 칸 floor(x/10), 행 floor(y/40). 보드 밖(y ≥ 360 또는 x ≥ 80)이면 inBoard=false.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlacementTouchDrag } from '../../src/input/touchDrag.js';
import { createDragSession } from '../../src/input/dragSession.js';

const CELL_W = 10;
const ROW_H = 40;
const COLS = 8;
const at = (row, col) => ({ x: col * CELL_W + 5, y: row * ROW_H + 20 });

/** 블록 하나(g1)를 둔 보드와 가짜 협력자들. 부른 것을 calls 에 차례대로 적는다. */
function setup(placements) {
  const board = { rows: 8, cols: COLS, placements };
  const calls = [];
  const fakeTrack = (row) => ({ row, classList: { add() {} } });
  const hitTest = {
    hitTest: (x, y) => (x >= 0 && x < COLS * CELL_W && y >= 0 && y < 9 * ROW_H)
      ? { inBoard: true, track: fakeTrack(Math.floor(y / ROW_H)), row: Math.floor(y / ROW_H), col: Math.floor(x / CELL_W) }
      : { inBoard: false, track: null, row: null, col: null },
  };
  const overlays = {
    showPlacementGhost() {}, movePlacementGhost() {}, removePlacementGhost() {},
    markDraggingGroup() {}, unmarkDraggingGroups() {}, clearTrackHighlights() {},
    updatePreview: (boardId, row, startIndex, count) => calls.push({ kind: 'preview', row, startIndex, count }),
    clearPreview: () => calls.push({ kind: 'clearPreview' }),
  };
  const commands = {
    moveGroup: (args) => { calls.push({ kind: 'moveGroup', ...args }); return null; },
    commitHistory: () => { calls.push({ kind: 'commit' }); return null; },
  };
  const drag = createPlacementTouchDrag({
    el: {}, boardId: 'routine', doc: {},
    store: { board: () => board, get: () => ({ session: { defaultCount: 4 } }), categories: {}, routines: [] },
    commands, render: () => {}, overlays, hitTest, dragSession: createDragSession(),
  });
  return { drag, calls };
}

const block = (row, startIndex, length) => ({ id: `p${row}`, groupId: 'g1', row, startIndex, length, name: '스텝', category: 'basic' });

test('[RM-57 요구 2] 손가락 끌기: 길게 누른 칸 오프셋을 빼고 놓으며 미리보기도 같은 자리다', () => {
  // 행 3 칸 0 의 8카운트 블록을 3번째 칸(칸 2)에서 길게 눌러 바로 위 행(2)의 같은 칸으로 곧게 옮긴다
  {
    const { drag, calls } = setup([block(3, 0, 8)]);
    const p = at(3, 2), q = at(2, 2);
    drag.start('g1', p.x, p.y);
    drag.moveGhost(q.x, q.y);
    drag.finish(false);
    const previews = calls.filter(c => c.kind === 'preview');
    const move = calls.find(c => c.kind === 'moveGroup');
    assert.deepEqual(previews.at(-1), { kind: 'preview', row: 2, startIndex: 0, count: 8 }, '미리보기는 잡은 칸만큼 앞에');
    assert.deepEqual(move, { kind: 'moveGroup', groupId: 'g1', targetRow: 2, targetStartIndex: 0 }, '고치기 전에는 칸 2 였다');
    assert.deepEqual({ row: previews.at(-1).row, startIndex: previews.at(-1).startIndex },
      { row: move.targetRow, startIndex: move.targetStartIndex }, '미리보기 = 결과');
    assert.equal(calls.at(-1).kind, 'commit');
  }
  // 여러 행에 걸친 블록의 둘째 조각을 잡아도 블록 시작에서 선형으로 센다 — r3 [5..7] + r4 [0..4], r4 칸 1 을 잡으면 오프셋 4
  {
    const { drag, calls } = setup([block(3, 5, 3), { ...block(4, 0, 5), id: 'p4b' }]);
    const p = at(4, 1), q = at(6, 3);
    drag.start('g1', p.x, p.y);
    drag.moveGhost(q.x, q.y);
    drag.finish(false);
    assert.deepEqual(calls.filter(c => c.kind === 'preview').at(-1), { kind: 'preview', row: 5, startIndex: 7, count: 8 });
    assert.deepEqual(calls.find(c => c.kind === 'moveGroup'), { kind: 'moveGroup', groupId: 'g1', targetRow: 5, targetStartIndex: 7 });
  }
  // 0번 칸을 잡으면 지금과 같다 — 놓은 칸이 시작이다
  {
    const { drag, calls } = setup([block(3, 0, 8)]);
    const p = at(3, 0), q = at(5, 4);
    drag.start('g1', p.x, p.y);
    drag.moveGhost(q.x, q.y);
    drag.finish(false);
    assert.deepEqual(calls.find(c => c.kind === 'moveGroup'), { kind: 'moveGroup', groupId: 'g1', targetRow: 5, targetStartIndex: 4 });
  }
  // 보드 첫 칸보다 앞이면 첫 칸으로 자른다 — 인트로 행이 없는 보드는 (1, 0)
  {
    const { drag, calls } = setup([block(3, 0, 8)]);
    const p = at(3, 5), q = at(1, 2);
    drag.start('g1', p.x, p.y);
    drag.moveGhost(q.x, q.y);
    drag.finish(false);
    assert.deepEqual(calls.find(c => c.kind === 'moveGroup'), { kind: 'moveGroup', groupId: 'g1', targetRow: 1, targetStartIndex: 0 });
  }
  // 취소되면 놓지 않는다
  {
    const { drag, calls } = setup([block(3, 0, 8)]);
    const p = at(3, 2), q = at(2, 2);
    drag.start('g1', p.x, p.y);
    drag.moveGhost(q.x, q.y);
    drag.finish(true);
    assert.equal(calls.find(c => c.kind === 'moveGroup'), undefined);
  }
});
