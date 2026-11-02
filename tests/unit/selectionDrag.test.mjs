// tests/unit/selectionDrag.test.mjs — 고른 블록 하나의 손잡이를 끌면 묶음 전체가 함께 가는가 (RM-14, 2026-11-02)
//
// 실제 input/boardController 에 가짜 보드 요소(리스너만 모은다) · 가짜 overlays · 가짜 hitTest 를 주고, store · boardCommands ·
// historyCommands · dragSession 은 진짜를 쓴다. 손잡이 dragstart → 트랙 drop 을 직접 쏘아 바깥에서 보이는 값만 본다 —
// 블록이 어디로 갔나, 히스토리가 몇 칸 늘었나, 되돌리기 한 번에 어디로 돌아오나.
// 가짜 hitTest 는 drop 의 clientX 를 그대로 칸 번호로 읽는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as Board from '../../src/usecases/boardCommands.js';
import * as History from '../../src/usecases/historyCommands.js';
import { createDragSession } from '../../src/input/dragSession.js';
import { createBoardController } from '../../src/input/boardController.js';
import { SEL, DATA } from '../../src/ui/domContract.js';
import { groupSpan } from '../../src/domain/selection.js';

const seg = (groupId, row, startIndex, length) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0 });
function ids() { let n = 0; return { uid: () => `n${++n}` }; }

/** a(1행 0..1) · b(1행 3..4) · c(1행 6..7) 를 놓고 a · c 를 고른 보드와 그 위의 컨트롤러. */
function setup() {
  const store = createStore();
  store.setBoard(BOARD_MAIN, { placements: [seg('a', 1, 0, 2), seg('b', 1, 3, 2), seg('c', 1, 6, 2)] });
  Board.selectOnly(store, { boardId: BOARD_MAIN, groupId: 'a' });
  Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: 'c' });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);                                  // 처음 자리가 첫 단계
  const listeners = {};
  const el = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
  const marked = [];
  const previews = [];
  const overlays = new Proxy({
    markDraggingGroup: (_b, id) => marked.push(id),
    updateBundlePreview: (_b, items, label) => previews.push({ items, label }),
  }, { get: (t, k) => t[k] || (() => {}) });
  const commands = {
    moveGroup: (args) => Board.moveGroupTo(store, { boardId: BOARD_MAIN, ...args }, { ids: ids() }),
    copyGroup: (args) => Board.copyGroupTo(store, { boardId: BOARD_MAIN, ...args }, { ids: ids() }),
    moveSelection: (args) => Board.moveSelectionBy(store, { boardId: BOARD_MAIN, ...args }, { ids: ids() }),
    commitHistory: () => History.commit(hist, BOARD_MAIN),
  };
  createBoardController({
    el, boardId: BOARD_MAIN, store, commands, render: () => {}, overlays,
    hitTest: { cellIndexAt: (_track, x) => x, hitTest: () => ({ inBoard: false, track: null, row: null, col: null }) },
    dragSession: createDragSession(), pointerSession: { isActive: () => false }, touchDrag: {}, quickPicker: {},
    doc: { addEventListener() {} },
  });
  const fire = (type, ev) => { for (const fn of listeners[type] || []) fn(ev); };
  /** groupId 블록의 손잡이를 잡아 (row, col) 칸에 놓는다. */
  const dragDrop = (groupId, row, col, { altKey = false } = {}) => {
    const placementEl = { dataset: { [DATA.groupId]: groupId } };
    const handle = { closest: (sel) => (sel === SEL.placement ? placementEl : null) };
    fire('dragstart', { altKey, target: { closest: (sel) => (sel === SEL.moveHandle ? handle : null) },
      dataTransfer: { setData() {}, effectAllowed: '' } });
    const track = { dataset: { [DATA.row]: String(row) }, classList: { add() {}, remove() {} } };
    const target = { closest: (sel) => (sel === SEL.track ? track : null) };
    fire('dragover', { target, clientX: col, preventDefault() {} });
    fire('drop', { target, clientX: col, preventDefault() {} });
  };
  const start = (id) => groupSpan(store.board(BOARD_MAIN), id).start;
  const cells = () => store.board(BOARD_MAIN).placements.map(p => `${p.groupId}@${p.row}:${p.startIndex}+${p.length}`).sort();
  return { store, hist, dragDrop, start, cells, marked, previews };
}

test('고른 블록 하나의 손잡이를 끌어 놓으면 묶음 전체가 간격을 지켜 옮겨지고, 하나라도 표 밖이면 아무것도 옮기지 않으며, 되돌리기 한 번에 모두 제자리로 온다', () => {
  // ① 함께 간다 — a 를 2행 1칸으로 끌면 거리 9. c 도 9 만큼 가서 2행 끝 → 3행 앞으로 이어진다.
  {
    const t = setup();
    const before = { a: t.start('a'), b: t.start('b'), c: t.start('c') };
    const steps = t.hist.stack(BOARD_MAIN).past.length;
    t.dragDrop('a', 2, 1);
    assert.deepEqual(t.marked.sort(), ['a', 'c'], '끄는 동안 묶음 전체가 끌리는 표시를 받는다');
    assert.equal(t.previews.at(-1).label, '2개 함께', '프리뷰가 묶음 전체의 놓일 자리를 그린다');
    assert.deepEqual(t.previews.at(-1).items.map(i => [i.row, i.startIndex, i.count]).sort(), [[2, 1, 2], [2, 7, 2]]);
    assert.equal(t.start('a') - before.a, 9);
    assert.equal(t.start('c') - before.c, 9);
    assert.equal(t.start('c') - t.start('a'), before.c - before.a, '서로의 간격이 그대로다');
    assert.equal(t.start('b'), before.b, '고르지 않은 b 는 그대로다');
    assert.equal(t.hist.stack(BOARD_MAIN).past.length, steps + 1, '끌어 놓기 한 번 = 히스토리 한 칸');
    History.undo(t.hist, BOARD_MAIN);
    assert.deepEqual({ a: t.start('a'), b: t.start('b'), c: t.start('c') }, before, '되돌리기 한 번에 a · c 가 둘 다 제자리');
  }
  // ② 하나라도 표 밖이면 아무것도 — a 를 8행 1칸(거리 57)으로 끌면 c 가 표 끝을 넘는다.
  {
    const t = setup();
    const cellsBefore = t.cells();
    const steps = t.hist.stack(BOARD_MAIN).past.length;
    t.dragDrop('a', 8, 1);
    assert.deepEqual(t.cells(), cellsBefore, 'a 도 c 도 움직이지 않는다');
    assert.equal(t.hist.stack(BOARD_MAIN).past.length, steps, '히스토리에 한 칸도 늘지 않았다');
    assert.equal(t.previews.length, 0, '못 가는 자리에는 묶음 프리뷰를 그리지 않는다');
  }
  // ③ 고르지 않은 블록은 지금처럼 그 하나만 간다.
  {
    const t = setup();
    t.dragDrop('b', 3, 2);
    assert.equal(t.start('a'), 0);
    assert.equal(t.start('c'), 6);
    assert.equal(t.start('b'), 18);
  }
});
