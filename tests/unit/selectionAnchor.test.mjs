// tests/unit/selectionAnchor.test.mjs — 블록을 바꾸는 길 뒤에 선택과 Shift 범위 앵커가 유령을 가리키지 않는가 (RM-14, 2026-11-02)
//
// RM-03 의 selectionReset 은 「고른 목록」만 봤다. RM-14 가 앵커(selectionAnchor)를 더하면서 같은 길 넷을 다시 밟는다 —
// 밟을 때마다 store.selection 의 groupId 와 앵커 groupId 가 모두 boards.main.placements 에 있어야 한다(없으면 빈 목록과 null).
// 되돌리기는 블록을 놓고 앵커를 세운 뒤 undo 로 그 블록을 없애는 경우까지 재므로, 목록만 보던 키보드 Delete 시험이 놓친 앵커 남음을 잡는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as Board from '../../src/usecases/boardCommands.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as History from '../../src/usecases/historyCommands.js';

const seg = (groupId, row, startIndex, length) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0 });
function ids() { let n = 0; return () => `n${++n}`; }
function env() { let n = 0; return { nowIso: () => '2026-11-02T00:00:00.000Z', uid: () => 'id' + (++n), now: () => 0 }; }
const deps = store => ({ store, env: env(), dialogs: { alert: () => {} }, storage: { saveRoutineFavorites() {}, saveLinks() {}, saveRecents() {} } });

/** a(1행 0..1) · b(1행 4..5) · c(2행 0..1) 를 놓고 a 를 그냥 클릭, c 를 Shift+클릭한 store — 셋 다 골라지고 앵커는 c. */
function prepared() {
  const store = createStore();
  store.setBoard(BOARD_MAIN, { placements: [seg('a', 1, 0, 2), seg('b', 1, 4, 2), seg('c', 2, 0, 2)] });
  Board.selectOnly(store, { boardId: BOARD_MAIN, groupId: 'a' });
  Board.selectRange(store, { boardId: BOARD_MAIN, groupId: 'c' });
  assert.deepEqual([...store.get().selection].sort(), ['a', 'b', 'c'], '준비');
  assert.equal(store.get().selectionAnchor, 'c', '준비');
  return store;
}

/** 선택과 앵커가 모두 지금 보드에 있는 블록만 가리키는가. */
function assertConsistent(store, what) {
  const present = new Set(store.get().boards[BOARD_MAIN].placements.map(p => p.groupId));
  for (const id of store.get().selection) assert.ok(present.has(id), `${what}: 고른 목록이 없는 블록 ${id} 를 가리킨다`);
  const anchor = store.get().selectionAnchor;
  assert.ok(anchor === null || present.has(anchor), `${what}: 앵커가 없는 블록 ${anchor} 를 가리킨다`);
  if (!store.get().selection.size) assert.equal(anchor, null, `${what}: 고른 것이 없는데 앵커가 남았다`);
}

const OTHER = {
  rows: 4, cols: 8, moveLibrary: [{ id: 'm9', name: 'Tuck Turn', category: 'basic' }],
  placements: [{ id: 'q1', groupId: 'g9', name: 'Tuck Turn', category: 'basic', row: 0, startIndex: 0, length: 2, subRow: 0 }]
};

test('블록을 바꾸는 네 길(바의 지우기 · 묶음 이동 · 되돌리기 · 전체 불러오기) 뒤 고른 목록과 Shift 범위 앵커가 모두 지금 있는 블록을 가리킨다 (RM-14)', () => {
  // ① 바의 지우기 — 고른 묶음을 통째로 지운다(removeSelection = removeGroup 을 그룹마다)
  {
    const store = prepared();
    Board.removeSelection(store, { boardId: BOARD_MAIN });
    assert.equal(store.get().boards[BOARD_MAIN].placements.length, 0);
    assertConsistent(store, '바의 지우기');
    assert.equal(store.get().selectionAnchor, null);
  }
  // ①' 앵커인 블록 하나만 지우면 앵커만 풀리고 나머지 선택은 남는다
  {
    const store = prepared();
    Board.removeGroup(store, { boardId: BOARD_MAIN, groupId: 'c' });
    assert.deepEqual([...store.get().selection].sort(), ['a', 'b']);
    assert.equal(store.get().selectionAnchor, null, '지운 블록이 앵커였으면 앵커가 풀린다');
    assertConsistent(store, '앵커 블록 지우기');
  }
  // ② 묶음 이동 — 옮긴 뒤에도 같은 그룹 id 가 남아 선택 · 앵커가 그대로 유효하다
  {
    const store = prepared();
    const dirty = Board.moveSelectionBy(store, { boardId: BOARD_MAIN, delta: 8 }, { ids: ids() });
    assert.ok(dirty.boards, '옮겼다');
    assert.deepEqual([...store.get().selection].sort(), ['a', 'b', 'c']);
    assert.equal(store.get().selectionAnchor, 'c');
    assertConsistent(store, '묶음 이동');
  }
  // ③ 되돌리기 — 블록을 놓고 앵커를 세운 뒤 undo 로 그 블록이 사라진다
  {
    const store = createStore();
    const hist = History.createHistory(store);
    History.commit(hist, BOARD_MAIN);                                   // 빈 보드가 첫 단계
    store.setBoard(BOARD_MAIN, { placements: [seg('a', 1, 0, 2)] });
    History.commit(hist, BOARD_MAIN);
    Board.selectOnly(store, { boardId: BOARD_MAIN, groupId: 'a' });
    assert.equal(store.get().selectionAnchor, 'a', '준비');
    const dirty = History.undo(hist, BOARD_MAIN);
    assert.equal(store.get().boards[BOARD_MAIN].placements.length, 0, '되돌려 블록이 없다');
    assert.equal(dirty.selection, true);
    assertConsistent(store, '되돌리기');
    assert.equal(store.get().selectionAnchor, null);
  }
  // ④ 전체 불러오기 — 다른 안무표의 블록(g9)만 남는다
  {
    const store = prepared();
    Project.loadProjectFromRecent(deps(store), structuredClone(OTHER));
    assert.deepEqual(store.get().boards[BOARD_MAIN].placements.map(p => p.groupId), ['g9']);
    assertConsistent(store, '전체 불러오기');
    assert.equal(store.get().selectionAnchor, null);
  }
});

test('묶음 이동이 막히면(하나라도 표 밖) 선택 · 앵커 · 배치가 모두 그대로다', () => {
  const store = prepared();
  const before = JSON.stringify(store.get().boards[BOARD_MAIN].placements);
  const dirty = Board.moveSelectionBy(store, { boardId: BOARD_MAIN, delta: -16 }, { ids: ids() });   // a 가 intro 행 앞으로 나간다
  assert.equal(dirty.boards, undefined, '아무것도 옮기지 않았다');
  assert.ok(dirty.notify, '막힌 까닭을 알린다');
  assert.equal(JSON.stringify(store.get().boards[BOARD_MAIN].placements), before);
  assert.deepEqual([...store.get().selection].sort(), ['a', 'b', 'c']);
  assert.equal(store.get().selectionAnchor, 'c');
});
