// tests/unit/keyboardEdit.test.mjs — 키보드 편집: 화살표 · Delete · 복사 · 붙여넣기 · 복제 · 모두 고르기 (RM-13)
//
// 세 층을 본다.
//   ① 자리 계산(domain/keyboardEdit) — 한 칸 · 한 행 · 한 마디, 표 끝에서 **잘리기 전에** 멈춘다
//   ② 커맨드(usecases/boardCommands) — 끌기와 같은 옮기기 · 복사 규칙을 탄다, 고른 목록이 맞게 바뀐다
//   ③ 글쇠(input/controls.bindHotkeys) — 입력칸 · 재생기에서 비키고, 고른 것이 없으면 기본 동작을 막지 않는다

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN, BOARD_ROUTINE } from '../../src/usecases/store.js';
import * as Board from '../../src/usecases/boardCommands.js';
import { cellAfter, clipOf, nudgeDelta, pastePlan, planNudge, shiftedStart } from '../../src/domain/keyboardEdit.js';
import * as ops from '../../src/domain/boardOps.js';
import { commandForKey, normalizeHotkeys, checkKey } from '../../src/domain/hotkeys.js';
import { bindHotkeys } from '../../src/input/controls.js';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0, ...extra });

/** 메인 보드 8x8(intro 행 0 + 1..8). */
const board = (placements) => ({ rows: 8, cols: 8, hasIntroRow: true, placements });

function ids() {
  let n = 0;
  return () => `n${++n}`;
}

/** 블록을 놓고 고른 store. */
function storeWith(placements, selected = []) {
  const store = createStore();
  store.setBoard(BOARD_MAIN, { placements });
  for (const groupId of selected) Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId });
  return store;
}
const startOf = (store, groupId) => {
  const first = store.get().boards[BOARD_MAIN].placements.filter(p => p.groupId === groupId)
    .sort((a, b) => a.row - b.row || a.startIndex - b.startIndex)[0];
  return first ? [first.row, first.startIndex] : null;
};
const countOf = (store, groupId) => store.get().boards[BOARD_MAIN].placements
  .filter(p => p.groupId === groupId).reduce((n, p) => n + p.length, 0);

// ── ① 자리 계산 ────────────────────────────────────────────────────────────────

test('한 칸 · 한 행 · 한 마디의 거리', () => {
  assert.equal(nudgeDelta('left', 8), -1);
  assert.equal(nudgeDelta('right', 8), 1);
  assert.equal(nudgeDelta('up', 6), -6, '↑/↓ 는 행의 칸 수만큼 — 같은 박자 자리의 윗 행');
  assert.equal(nudgeDelta('down', 6), 6);
  assert.equal(nudgeDelta('barLeft', 6), -8, 'Shift+← 는 행 폭과 무관하게 8카운트');
  assert.equal(nudgeDelta('barRight', 6), 8);
  assert.equal(nudgeDelta('엉뚱한', 8), 0);
});

test('한 칸 뒤로가 행 끝에서 다음 행 처음으로 넘어간다', () => {
  const b = board([seg('a', 1, 7, 1)]);
  assert.deepEqual(shiftedStart(b, 'a', 1), { row: 2, startIndex: 0 });
  assert.deepEqual(shiftedStart(board([seg('a', 2, 0, 1)]), 'a', -1), { row: 1, startIndex: 7 });
});

test('메인 보드는 intro 행(0)까지 갈 수 있고 그 앞에서 멈춘다', () => {
  assert.deepEqual(shiftedStart(board([seg('a', 1, 0, 2)]), 'a', -1), { row: 0, startIndex: 7 });
  assert.equal(shiftedStart(board([seg('a', 0, 0, 2)]), 'a', -1), null, 'intro 행 처음에서 더 앞은 없다');
  // 루틴 보드에는 intro 행이 없다
  assert.equal(shiftedStart({ rows: 4, cols: 8, hasIntroRow: false, placements: [seg('a', 1, 0, 2)] }, 'a', -1), null);
});

test('표 끝에서는 길이를 자르기 전에 멈춘다 — 끌기와 다른 유일한 점', () => {
  // 길이 3 블록이 마지막 행 5칸에서 시작 → 끝 칸(7)까지 꽉 찬다
  const b = board([seg('a', 8, 5, 3)]);
  assert.equal(shiftedStart(b, 'a', 1), null, '한 칸 더 가면 잘린다 — 움직이지 않아야 한다');
  assert.deepEqual(shiftedStart(b, 'a', -1), { row: 8, startIndex: 4 });
  assert.equal(shiftedStart(board([seg('a', 8, 0, 2)]), 'a', 8), null, '마지막 행에서 아랫 마디는 없다');
});

test('고른 묶음은 하나라도 못 가면 아무것도 옮기지 않는다', () => {
  const b = board([seg('a', 1, 0, 1), seg('b', 8, 7, 1)]);
  assert.equal(planNudge(b, ['a', 'b'], 1), null);
  const plan = planNudge(board([seg('a', 1, 0, 1), seg('b', 1, 4, 1)]), ['a', 'b'], 1);
  assert.deepEqual(plan.map(p => p.groupId), ['b', 'a'], '오른쪽으로 갈 때는 오른쪽 것부터');
});

test('붙일 자리는 고른 것 가운데 가장 늦게 끝나는 것의 바로 다음 칸', () => {
  const b = board([seg('a', 1, 0, 2), seg('b', 1, 4, 3)]);
  assert.deepEqual(cellAfter(b, ['a', 'b']), { row: 1, startIndex: 7 });
  assert.deepEqual(cellAfter(board([seg('a', 1, 6, 2)]), ['a']), { row: 2, startIndex: 0 }, '행 끝이면 다음 행 처음');
  assert.equal(cellAfter(board([seg('a', 8, 6, 2)]), ['a']), null, '표 끝이면 붙일 자리가 없다');
});

test('담은 묶음은 이름 · 길이 · 서로의 간격을 지키고 자리 · id 는 담지 않는다', () => {
  const b = board([seg('b', 1, 4, 2), seg('a', 1, 0, 1), seg('p', 2, 0, 1, { name: '', pending: true }),
    seg('r', 3, 0, 2, { type: 'routine', routineId: 'R1' })]);
  const clip = clipOf(b, ['b', 'a', 'p', 'r']);
  assert.deepEqual(clip.map(c => [c.name, c.count, c.offset]), [['a', 1, 0], ['b', 2, 4], ['', 1, 8], ['r', 2, 16]]);
  assert.equal(clip[2].pending, true, '`?` 블록은 `?` 로 담긴다');
  assert.equal(clip[3].routineId, 'R1', '루틴 블록은 루틴으로 담긴다');
  assert.equal('row' in clip[0] || 'groupId' in clip[0], false);
  const plan = pastePlan(b, clip, { row: 8, startIndex: 0 });
  assert.deepEqual(plan.map(p => p.block.name), ['a', 'b'], '표 밖으로 나가는 블록은 빼고 앞쪽은 붙인다');
});

test('붙여넣기는 copyGroup 과 같은 규칙이다 — 같은 자리에 같은 층으로 쌓인다', () => {
  const b = board([seg('a', 1, 0, 2), seg('x', 2, 0, 3)]);
  const viaCopy = ops.copyGroup(b, { groupId: 'a', targetRow: 2, targetStartIndex: 1 }, ids());
  const viaPaste = ops.pasteBlock(b, { block: clipOf(b, ['a'])[0], targetRow: 2, targetStartIndex: 1 }, ids());
  const strip = r => r.placements.map(({ id, groupId, ...rest }) => rest);
  assert.deepEqual(strip(viaPaste), strip(viaCopy));
  assert.deepEqual(viaPaste.renderRows, viaCopy.renderRows);
  assert.ok(viaPaste.groupId, '붙인 그룹의 id 를 돌려준다 — 고른 것으로 바꾸는 데 쓴다');
});

// ── ② 커맨드 ───────────────────────────────────────────────────────────────────

test('화살표 한 번은 고른 블록 하나를 한 칸 옮긴다 — 다른 블록은 그대로', () => {
  const store = storeWith([seg('a', 1, 0, 2), seg('b', 3, 0, 2)], ['a']);
  const dirty = Board.nudgeSelection(store, { boardId: BOARD_MAIN, delta: 1 }, { ids: ids() });
  assert.deepEqual(startOf(store, 'a'), [1, 1]);
  assert.deepEqual(startOf(store, 'b'), [3, 0]);
  assert.ok(dirty.boards, '다시 그릴 행을 알린다');
  assert.deepEqual([...store.get().selection], ['a'], '옮긴 뒤에도 고른 채다 — 계속 누를 수 있다');
});

test('옮기다 겹치면 끌기처럼 아래 층으로 쌓이고, 비켜나면 층이 위로 당겨진다', () => {
  const store = storeWith([seg('a', 1, 0, 2), seg('b', 1, 3, 2)], ['a']);
  Board.nudgeSelection(store, { boardId: BOARD_MAIN, delta: 2 }, { ids: ids() });   // a: 2..3 — b(3..4)와 겹친다
  const lanes = () => Object.fromEntries(store.get().boards[BOARD_MAIN].placements.map(p => [p.groupId, p.subRow]));
  assert.notEqual(lanes().a, lanes().b, '겹쳤는데 같은 층이다');
  Board.nudgeSelection(store, { boardId: BOARD_MAIN, delta: -2 }, { ids: ids() });
  assert.deepEqual(lanes(), { a: 0, b: 0 }, '겹침이 사라졌는데 층이 그대로다(D-1)');
});

test('표 끝에서는 움직이지도 자르지도 않고 까닭을 알린다', () => {
  const store = storeWith([seg('a', 8, 5, 3)], ['a']);
  const dirty = Board.nudgeSelection(store, { boardId: BOARD_MAIN, delta: 1 }, { ids: ids() });
  assert.deepEqual(startOf(store, 'a'), [8, 5]);
  assert.equal(countOf(store, 'a'), 3, '길이가 잘렸다');
  assert.equal(dirty.boards, undefined, '바뀐 것이 없으니 되돌리기 단계도 없어야 한다');
  assert.equal(dirty.notify.kind, 'status');
});

test('고른 것이 없으면 다섯 다 아무 일도 하지 않는다', () => {
  const store = storeWith([seg('a', 1, 0, 2)]);
  assert.equal(Object.keys(Board.nudgeSelection(store, { boardId: BOARD_MAIN, delta: 1 }, { ids: ids() })).length, 0);
  assert.equal(Object.keys(Board.removeSelection(store, { boardId: BOARD_MAIN })).length, 0);
  assert.deepEqual(Board.copySelection(store, { boardId: BOARD_MAIN }), []);
  assert.equal(Board.pasteAnchor(store, { boardId: BOARD_MAIN }), null);
  assert.equal(store.get().boards[BOARD_MAIN].placements.length, 1);
});

test('루틴 보드에는 고르기가 없다 — 메인에서 고른 블록을 루틴 글쇠가 건드리지 않는다', () => {
  const store = storeWith([seg('a', 1, 0, 2)], ['a']);
  store.setBoard(BOARD_ROUTINE, { placements: [{ ...seg('a', 1, 0, 2) }] });
  Board.removeSelection(store, { boardId: BOARD_ROUTINE });
  Board.nudgeSelection(store, { boardId: BOARD_ROUTINE, delta: 1 }, { ids: ids() });
  assert.equal(store.get().boards[BOARD_ROUTINE].placements.length, 1);
  assert.equal(store.get().boards[BOARD_MAIN].placements.length, 1, '루틴 편집 중의 Delete 가 메인 블록을 지웠다');
  assert.equal(Object.keys(Board.selectAll(store, { boardId: BOARD_ROUTINE })).length, 0);
});

test('Delete 는 고른 블록을 모두 지우고 고른 목록을 비운다', () => {
  const store = storeWith([seg('a', 1, 0, 2), seg('b', 2, 0, 2), seg('c', 3, 0, 2)], ['a', 'c']);
  const dirty = Board.removeSelection(store, { boardId: BOARD_MAIN });
  assert.deepEqual(store.get().boards[BOARD_MAIN].placements.map(p => p.groupId), ['b']);
  assert.equal(store.get().selection.size, 0);
  assert.equal(dirty.toolbar, true, '「루틴으로 편성 (2)」가 남는다');
});

test('복사 → 다른 블록 고르고 붙여넣기 → 그 뒤에 붙고 붙인 것이 고른 것이 된다', () => {
  const store = storeWith([seg('a', 1, 0, 2), seg('b', 3, 0, 4)], ['a']);
  const clip = Board.copySelection(store, { boardId: BOARD_MAIN });
  Board.clearSelection(store);
  Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: 'b' });
  const at = Board.pasteAnchor(store, { boardId: BOARD_MAIN });
  assert.deepEqual(at, { row: 3, startIndex: 4 });
  const gen = ids();   // ⚠ 한 생성기를 끝까지 쓴다 — 새로 만들면 두 번째 붙여넣기의 groupId 가 첫 번째와 겹친다
  Board.pasteClip(store, { boardId: BOARD_MAIN, clip, at }, { ids: gen });
  const [picked] = [...store.get().selection];
  assert.equal(store.get().selection.size, 1);
  assert.notEqual(picked, 'b');
  assert.deepEqual(startOf(store, picked), [3, 4]);
  assert.equal(countOf(store, picked), 2);
  // 한 번 더 붙이면 방금 붙인 것 뒤에 붙는다
  Board.pasteClip(store, { boardId: BOARD_MAIN, clip, at: Board.pasteAnchor(store, { boardId: BOARD_MAIN }) }, { ids: gen });
  const [again] = [...store.get().selection];
  assert.deepEqual(startOf(store, again), [3, 6]);
});

test('원본을 지운 뒤에도 붙일 수 있다 — 담는 것은 값이다', () => {
  const store = storeWith([seg('a', 1, 0, 2)], ['a']);
  const clip = Board.copySelection(store, { boardId: BOARD_MAIN });
  Board.removeSelection(store, { boardId: BOARD_MAIN });
  Board.pasteClip(store, { boardId: BOARD_MAIN, clip, at: Board.pasteAnchor(store, { boardId: BOARD_MAIN, fallback: { row: 2, startIndex: 3 } }) }, { ids: ids() });
  const [p] = store.get().boards[BOARD_MAIN].placements;
  assert.deepEqual([p.name, p.row, p.startIndex, p.length], ['a', 2, 3, 2], '고른 것이 없으면 마지막으로 누른 빈 칸에 붙는다');
});

test('묶음의 뒤쪽이 표 밖으로 나가 빠지면 몇 개가 빠졌는지 알린다', () => {
  const store = storeWith([seg('a', 1, 0, 1), seg('b', 5, 0, 1)], ['a', 'b']);
  const clip = Board.copySelection(store, { boardId: BOARD_MAIN });
  const dirty = Board.pasteClip(store, { boardId: BOARD_MAIN, clip, at: { row: 7, startIndex: 5 } }, { ids: ids() });
  assert.equal(store.get().boards[BOARD_MAIN].placements.length, 3, '앞쪽 하나는 붙는다');
  assert.match(dirty.notify.message, /1개는 붙이지 않았습니다/);
});

test('붙일 자리가 없으면 아무것도 놓지 않고 까닭을 알린다', () => {
  const store = storeWith([]);
  const dirty = Board.pasteClip(store, { boardId: BOARD_MAIN, clip: [{ name: 'a', category: 'basic', count: 1, offset: 0 }], at: null }, { ids: ids() });
  assert.equal(store.get().boards[BOARD_MAIN].placements.length, 0);
  assert.equal(dirty.notify.kind, 'status');
});

test('모두 고르기는 메인 보드의 블록을 전부 고른다', () => {
  const store = storeWith([seg('a', 1, 0, 2), seg('b', 2, 0, 3), seg('b', 3, 0, 1)]);
  const dirty = Board.selectAll(store, { boardId: BOARD_MAIN });
  assert.deepEqual([...store.get().selection].sort(), ['a', 'b']);
  assert.equal(dirty.toolbar, true);
  assert.equal(Object.keys(Board.selectAll(storeWith([]), { boardId: BOARD_MAIN })).length, 0, '블록이 없으면 무동작');
});

// ── ③ 글쇠 ─────────────────────────────────────────────────────────────────────

test('편집 글쇠는 등록부에서 찾고, 입력칸 안에서는 하나도 듣지 않는다', () => {
  const map = normalizeHotkeys(null);
  const cases = { ArrowLeft: 'nudgeLeft', ArrowRight: 'nudgeRight', ArrowUp: 'nudgeUp', ArrowDown: 'nudgeDown',
    'Shift+ArrowLeft': 'nudgeBarLeft', 'Shift+ArrowRight': 'nudgeBarRight', Delete: 'deleteSelection', Backspace: 'deleteSelection',
    'Ctrl+C': 'copySelection', 'Cmd+C': 'copySelection', 'Ctrl+V': 'paste', 'Cmd+V': 'paste', 'Ctrl+D': 'duplicate', 'Cmd+D': 'duplicate',
    'Ctrl+A': 'selectAll', 'Cmd+A': 'selectAll', 'Ctrl+S': 'saveProject', 'Cmd+S': 'saveProject' };
  for (const [key, id] of Object.entries(cases)) {
    assert.equal(commandForKey(map, key)?.id, id, key);
    if (id !== 'saveProject') assert.equal(commandForKey(map, key, true), null, `입력칸 안의 ${key} 는 글자 편집이다`);
  }
  assert.equal(commandForKey(map, 'Ctrl+S', true).id, 'saveProject', '이름칸에서 이름을 고치다 바로 저장한다');
  assert.equal(checkKey('ArrowLeft').ok, false, '화살표는 다른 명령에 줄 수 없다');
});

function fakeDoc() {
  const doc = { listener: null, addEventListener(type, fn) { if (type === 'keydown') doc.listener = fn; } };
  return doc;
}
function press(doc, key, init = {}) {
  let prevented = false;
  doc.listener({ key, ctrlKey: !!init.ctrl, metaKey: false, shiftKey: !!init.shift, altKey: false,
    target: init.target || { tagName: 'BODY' }, preventDefault: () => { prevented = true; } });
  return prevented;
}

test('고른 것이 없으면 화살표 · Ctrl+C 의 기본 동작(스크롤 · 글자 복사)을 막지 않는다', () => {
  const doc = fakeDoc();
  const calls = [];
  bindHotkeys({ doc, runCommand: (id) => { calls.push(id); return false; } });
  assert.equal(press(doc, 'ArrowDown'), false);
  assert.equal(press(doc, 'c', { ctrl: true }), false);
  assert.deepEqual(calls, ['nudgeDown', 'copySelection']);
});

test('재생기가 포커스를 쥐면 화살표는 재생기의 것이다', () => {
  const doc = fakeDoc();
  const calls = [];
  bindHotkeys({ doc, runCommand: (id) => { calls.push(id); return true; } });
  assert.equal(press(doc, 'ArrowLeft', { target: { tagName: 'VIDEO' } }), false, '되감기를 막았다');
  press(doc, 'ArrowRight', { shift: true, target: { tagName: 'AUDIO' } });
  assert.deepEqual(calls, []);
  assert.equal(press(doc, 'ArrowLeft'), true, '재생기 밖에서는 우리 것이다');
});
