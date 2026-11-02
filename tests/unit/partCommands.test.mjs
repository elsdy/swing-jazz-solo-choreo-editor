// tests/unit/partCommands.test.mjs — 파트를 긋고 · 옮기고 · 한 번 더 놓고 · 마디 편집을 따라가는가 (usecases/partCommands, RM-23)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as Parts from '../../src/usecases/partCommands.js';
import * as BoardCmd from '../../src/usecases/boardCommands.js';
import * as History from '../../src/usecases/historyCommands.js';

function ids() {
  let n = 0;
  return { uid: () => 'n' + (++n) };
}

/** 마디 6개 · 8칸. 1마디 Swing Out(1~2마디에 걸친 12카운트), 2마디 Tuck, 3마디 Lindy Circle, 5마디 Charleston */
function seeded() {
  const store = createStore();
  const p = (id, groupId, name, row, startIndex, length) => ({ id, groupId, name, category: 'lindy', row, startIndex, length, subRow: 0 });
  store.setBoard(BOARD_MAIN, {
    rows: 6, cols: 8,
    placements: [
      p('a1', 'gA', 'Swing Out', 1, 0, 8), p('a2', 'gA', 'Swing Out', 2, 0, 4),
      p('b1', 'gB', 'Tuck', 2, 4, 4),
      p('c1', 'gC', 'Lindy Circle', 3, 0, 8),
      p('d1', 'gD', 'Charleston', 5, 0, 8)
    ]
  });
  return store;
}

/** 그룹마다 [첫 마디, 시작 칸, 카운트 합] — 블록이 어디에 몇 카운트로 있나 */
function blocks(store) {
  const out = {};
  for (const p of store.board(BOARD_MAIN).placements) {
    const cur = out[p.groupId] || { name: p.name, row: p.row, startIndex: p.startIndex, total: 0 };
    if (p.row < cur.row || (p.row === cur.row && p.startIndex < cur.startIndex)) Object.assign(cur, { row: p.row, startIndex: p.startIndex });
    cur.total += p.length;
    out[p.groupId] = cur;
  }
  return out;
}
const spans = store => Parts.partsState(store).map(p => [p.name, p.startRow, p.endRow]);

test('partCommands: 긋기 · 이름/색 바꾸기 · 지우기, 겹치는 긋기는 거절한다', () => {
  const store = seeded();
  assert.deepEqual(Parts.addPart(store, { name: 'A파트', startRow: 1, endRow: 2 }), { parts: true });
  assert.deepEqual(spans(store), [['A파트', 1, 2]]);
  const clash = Parts.addPart(store, { name: '겹침', startRow: 2, endRow: 3 });
  assert.match(clash.notify.message, /겹칩니다/);
  assert.deepEqual(spans(store), [['A파트', 1, 2]], '겹치는 긋기는 아무것도 바꾸지 않는다');
  assert.ok(Parts.addPart(store, { name: '', startRow: 3, endRow: 3 }).notify, '이름이 없으면 알림만');
  assert.ok(Parts.addPart(store, { name: '넘침', startRow: 5, endRow: 9 }).notify, '안무표 밖이면 알림만');

  assert.deepEqual(Parts.updatePart(store, { startRow: 1, name: 'A', color: '#a78bfa' }), { parts: true });
  assert.deepEqual(Parts.partOf(store, 2), { name: 'A', startRow: 1, endRow: 2, color: '#a78bfa' });
  assert.deepEqual(Parts.updatePart(store, { startRow: 1, name: 'A' }), {}, '같은 값이면 무동작');

  const draft = Parts.draftPart(store, 3);
  assert.equal(draft.startRow, 3);
  assert.equal(draft.endRow, 6);
  assert.notEqual(draft.color, '#a78bfa', '아직 안 쓴 색을 고른다');
  assert.equal(Parts.draftPart(store, 2), null, '이미 파트 안이면 긋지 않는다');

  assert.deepEqual(Parts.removePart(store, { startRow: 1 }), { parts: true });
  assert.deepEqual(spans(store), []);
  assert.equal(store.board(BOARD_MAIN).placements.length, 5, '파트를 지워도 블록은 그대로다');
});

test('partCommands: 파트를 통째로 옮기면 블록과 범위가 함께 가고 되돌리기 한 번에 돌아온다', () => {
  const store = seeded();
  Parts.addPart(store, { name: 'A파트', startRow: 1, endRow: 2 });
  Parts.addPart(store, { name: 'B파트', startRow: 3, endRow: 4 });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);
  const before = { blocks: blocks(store), parts: spans(store) };

  const dirty = Parts.movePart(store, { startRow: 1, dir: 1 }, { ids: ids() });   // A 를 B 뒤로
  History.commit(hist, BOARD_MAIN);
  assert.equal(dirty.parts, true);
  assert.deepEqual(dirty.boards, { [BOARD_MAIN]: { rows: 'all' } });
  assert.deepEqual(spans(store), [['B파트', 1, 2], ['A파트', 3, 4]], '파트 범위가 함께 간다');
  const after = blocks(store);
  assert.deepEqual([after.gA.row, after.gA.startIndex, after.gA.total], [3, 0, 12], '두 마디에 걸친 Swing Out 이 끊기지 않고 함께 간다');
  assert.deepEqual([after.gB.row, after.gB.startIndex], [4, 4]);
  assert.deepEqual([after.gC.row, after.gC.startIndex], [1, 0], 'B파트의 블록은 앞으로 당겨진다');
  assert.deepEqual([after.gD.row], [5], '파트 밖 블록은 그대로');
  assert.equal(Object.keys(after).length, 4, '블록이 끊기거나 사라지지 않는다');

  History.undo(hist, BOARD_MAIN);
  assert.deepEqual(blocks(store), before.blocks, 'Undo 한 번에 블록이 돌아온다');
  assert.deepEqual(spans(store), before.parts, 'Undo 한 번에 파트 범위도 돌아온다');

  // 더 갈 데가 없으면 알림만
  assert.match(Parts.movePart(store, { startRow: 1, dir: -1 }, { ids: ids() }).notify.message, /맨 위/);
});

test('partCommands: 한 번 더는 독립된 복사본을 바로 뒤에 만든다', () => {
  const store = seeded();
  Parts.addPart(store, { name: 'A파트', startRow: 1, endRow: 2, color: '#38bdf8' });
  Parts.addPart(store, { name: '브레이크', startRow: 5, endRow: 5 });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);

  const dirty = Parts.repeatPart(store, { startRow: 1 }, { ids: ids() });
  History.commit(hist, BOARD_MAIN);
  assert.equal(dirty.parts, true);
  assert.equal(dirty.boards[BOARD_MAIN].skeleton, true, '마디 수가 바뀌어 골격부터 다시 세운다');
  assert.equal(store.board(BOARD_MAIN).rows, 8);
  assert.deepEqual(spans(store), [['A파트', 1, 2], ['A파트', 3, 4], ['브레이크', 7, 7]], '새 파트가 뒤에 그어지고 뒤 파트는 밀린다');
  assert.equal(Parts.partOf(store, 3).color, '#38bdf8', '같은 색');

  const b = blocks(store);
  const copies = Object.entries(b).filter(([gid]) => !['gA', 'gB', 'gC', 'gD'].includes(gid));
  assert.equal(copies.length, 2, 'Swing Out · Tuck 이 새 그룹 번호로 한 벌 더');
  const swing = copies.find(([, v]) => v.name === 'Swing Out')[1];
  assert.deepEqual([swing.row, swing.startIndex, swing.total], [3, 0, 12], '두 마디에 걸친 블록도 통째로 복사된다');
  const ownIds = new Set(store.board(BOARD_MAIN).placements.filter(p => p.row >= 3 && p.row <= 4).map(p => p.id));
  for (const p of store.board(BOARD_MAIN).placements.filter(p => p.row <= 2)) assert.ok(!ownIds.has(p.id), '조각 id 도 새것');
  assert.deepEqual([b.gC.row, b.gD.row], [5, 7], '뒤의 블록은 두 마디 밀린다');

  // 독립 — 원본을 고쳐도 사본은 그대로다
  const copyId = copies.find(([, v]) => v.name === 'Swing Out')[0];
  store.setBoard(BOARD_MAIN, { placements: store.board(BOARD_MAIN).placements.map(p => (p.groupId === 'gA' ? { ...p, name: '바꿨다' } : p)) });
  assert.ok(store.board(BOARD_MAIN).placements.filter(p => p.groupId === copyId).every(p => p.name === 'Swing Out'));

  History.undo(hist, BOARD_MAIN);   // 이름 바꾼 것은 커밋 안 했다 — 한 번 더 이전으로
  assert.equal(store.board(BOARD_MAIN).rows, 6, 'Undo 한 번에 마디 수가 돌아온다');
  assert.deepEqual(spans(store), [['A파트', 1, 2], ['브레이크', 5, 5]]);
});

test('partCommands: 마디 메뉴의 끼우기 · 지우기 · 복제 · 마디 수 줄이기가 파트 범위를 같은 단계에 민다', () => {
  const store = seeded();
  Parts.addPart(store, { name: 'A파트', startRow: 2, endRow: 3 });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);

  const ins = BoardCmd.insertRowAt(store, { boardId: BOARD_MAIN, row: 3 }, { ids: ids() });
  History.commit(hist, BOARD_MAIN);
  assert.equal(ins.parts, true);
  assert.deepEqual(spans(store), [['A파트', 2, 4]], '파트 안에 끼우면 는다');
  History.undo(hist, BOARD_MAIN);
  assert.deepEqual(spans(store), [['A파트', 2, 3]], 'Undo 한 번에 블록과 함께 돌아온다');
  assert.equal(store.board(BOARD_MAIN).rows, 6);

  BoardCmd.deleteRowAt(store, { boardId: BOARD_MAIN, row: 1 }, { ids: ids() });
  assert.deepEqual(spans(store), [['A파트', 1, 2]], '앞 마디를 지우면 당겨진다');
  BoardCmd.duplicateRowAt(store, { boardId: BOARD_MAIN, row: 2 }, { ids: ids() });
  assert.deepEqual(spans(store), [['A파트', 1, 3]], '파트 끝 마디를 복제하면 는다');
  BoardCmd.setBoardRows(store, { boardId: BOARD_MAIN, rows: 2 });
  assert.deepEqual(spans(store), [['A파트', 1, 2]], '마디 수를 줄이면 잘린다');

  // 파트가 없으면 Dirty 에 parts 가 새지 않는다(골든이 이 Dirty 를 재생한다)
  const plain = seeded();
  assert.equal('parts' in BoardCmd.insertRowAt(plain, { boardId: BOARD_MAIN, row: 2 }, { ids: ids() }), false);
});

test('partCommands: 접기는 저장 · 되돌리기에 들지 않고, 옮기면 접힘이 파트를 따라간다', () => {
  const store = seeded();
  Parts.addPart(store, { name: 'A파트', startRow: 1, endRow: 2 });
  Parts.addPart(store, { name: 'B파트', startRow: 3, endRow: 4 });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);
  assert.deepEqual(Parts.togglePartFold(store, { startRow: 1 }), { parts: true });
  assert.deepEqual([...Parts.foldedStarts(store)], [1]);
  History.commit(hist, BOARD_MAIN);
  assert.equal(History.canUndo(hist, BOARD_MAIN), false, '접기는 되돌리기 단계를 쌓지 않는다');
  assert.equal('partFolds' in store.get(), false, '접힘은 문서가 아니라 session 에 산다');

  Parts.movePart(store, { startRow: 1, dir: 1 }, { ids: ids() });
  assert.deepEqual([...Parts.foldedStarts(store)], [3], '접힌 A파트가 옮겨 간 자리에서도 접혀 있다');
  Parts.removePart(store, { startRow: 3 });
  assert.deepEqual([...Parts.foldedStarts(store)], [], '지운 파트의 접힘은 사라진다');
  assert.deepEqual(Parts.togglePartFold(store, { startRow: 9 }), {}, '없는 파트는 무동작');
});
