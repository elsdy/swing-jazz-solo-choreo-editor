// tests/unit/rowEdit.test.mjs — 마디(행) 끼우기 · 지우기 · 복제 · 옮기기 (RM-16, 2026-11-02)
//
// 두 층을 본다.
//   ① 전이(domain/boardOps.insertRow · deleteRow · duplicateRow · moveRow) — 뒤의 배치가 한 마디씩 밀리거나 당겨지고
//      rows(마지막 행 번호)가 함께 바뀐다. 끼운 마디가 걸친 블록 한가운데를 지나면 블록을 그 자리에서 끊는다(계획서 결정)
//   ② 커맨드(usecases/boardCommands) — 되돌리기 한 단계, 사라진 블록은 고른 목록에서 빠진다(D-16), 마커는 그대로
// 시험 이름은 계획서(docs/roadmap/plans/RM-16.md)의 「요구 ↔ 시험」 표 5~9 와 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../../src/domain/boardOps.js';
import * as Board from '../../src/usecases/boardCommands.js';
import * as History from '../../src/usecases/historyCommands.js';
import { setTempo, addMarkerAt, mediaState } from '../../src/usecases/videoCommands.js';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0, ...extra });
const board = (placements, rows = 4) => ({ rows, cols: 8, hasIntroRow: true, placements });
function ids() { let n = 0; return () => `n${++n}`; }
const countOf = (pl, g) => pl.filter(p => p.groupId === g).reduce((n, p) => n + p.length, 0);
const groupsIn = (pl) => [...new Set(pl.map(p => p.groupId))];
const shape = (pl, g) => pl.filter(p => p.groupId === g).sort((a, b) => a.row - b.row).map(p => [p.row, p.startIndex, p.length, p.subRow]);
/** 보드의 배치를 「그룹@행:칸+길이」 로 — 자리 비교용. */
const dump = (pl) => pl.map(p => `${p.groupId}@${p.row}:${p.startIndex}+${p.length}`).sort();

// ── ① 전이 ────────────────────────────────────────────────────────────────────

test('insertRow: 끼운 행 뒤의 배치가 모두 한 행 밀리고 rows 가 하나 는다', () => {
  // 인트로 z · 1행 a · 2행 b(두 조각) · 3행 c. 2번 위에 끼운다.
  const b = board([seg('z', 0, 0, 2), seg('a', 1, 0, 4), seg('b', 2, 2, 6), seg('b', 3, 0, 2), seg('c', 4, 4, 4)]);
  const r = ops.insertRow(b, { row: 2 }, ids());
  assert.equal(r.rows, 5, '마지막 행 번호 +1');
  assert.equal(r.renderRows, 'all');
  assert.deepEqual(dump(r.placements.filter(p => ['z', 'a'].includes(p.groupId))), ['a@1:0+4', 'z@0:0+2'], '앞의 배치는 그대로');
  assert.deepEqual(shape(r.placements, 'b'), [[3, 2, 6, 0], [4, 0, 2, 0]], '뒤의 배치는 행 번호만 +1');
  assert.deepEqual(shape(r.placements, 'c'), [[5, 4, 4, 0]]);
  assert.deepEqual(r.cutIds, [], '경계에 걸친 블록이 없으니 끊긴 것도 없다');
  assert.equal(groupsIn(r.placements).length, 4);
  assert.equal(b.rows, 4, '입력 보드는 그대로');
  // 끼운 마디가 걸친 블록 한가운데를 지나가면 그 자리에서 둘로 끊는다 — 카운트 길이는 그대로
  const cross = ops.insertRow(board([seg('x', 1, 6, 2), seg('x', 2, 0, 4)]), { row: 2 }, ids());
  assert.deepEqual(cross.cutIds, ['x']);
  assert.equal(groupsIn(cross.placements).length, 2);
  assert.deepEqual(shape(cross.placements, 'x'), [[1, 6, 2, 0]], '앞 조각은 번호를 지킨다');
  const back = groupsIn(cross.placements).find(g => g !== 'x');
  assert.deepEqual(shape(cross.placements, back), [[3, 0, 4, 0]], '뒤 조각은 새 번호로 한 마디 밀린다');
  assert.equal(countOf(cross.placements, 'x') + countOf(cross.placements, back), 6);
  // 범위 밖
  for (const row of [0, 5, -1, 1.5, NaN]) assert.equal(ops.insertRow(b, { row }, ids()).renderRows, null, `row=${row}`);
});

test('deleteRow: 그 마디에만 있던 블록은 사라지고 이어지는 블록은 그 마디만큼 짧아진다', () => {
  // a: 1행 7~8 + 2행 전부 + 3행 1 (11카운트) · d: 2행에만 · c: 4행. 2번을 지운다.
  const b = board([seg('a', 1, 6, 2), seg('a', 2, 0, 8), seg('a', 3, 0, 1), seg('d', 2, 2, 2, { subRow: 1 }), seg('c', 4, 0, 2)]);
  const r = ops.deleteRow(b, { row: 2 }, ids());
  assert.equal(r.rows, 3);
  assert.deepEqual(r.selectionRemoved, ['d'], '그 마디에만 있던 블록');
  assert.ok(!groupsIn(r.placements).includes('d'));
  assert.equal(countOf(r.placements, 'a'), 3, '11 에서 2행 몫 8 이 빠졌다');
  assert.deepEqual(shape(r.placements, 'a'), [[1, 6, 2, 0], [2, 0, 1, 0]], '앞 조각 + 당겨진 뒤 조각이 한 그룹으로 이어진다');
  assert.deepEqual(shape(r.placements, 'c'), [[3, 0, 2, 0]], '뒤 배치는 -1');
  assert.equal(r.renderRows, 'all');
  // 지운 마디 뒤쪽으로만 이어지던 블록은 머리가 잘린다
  const tail = ops.deleteRow(board([seg('t', 2, 4, 4), seg('t', 3, 0, 3)]), { row: 2 }, ids());
  assert.deepEqual(shape(tail.placements, 't'), [[2, 0, 3, 0]]);
  // 인트로 행 · 범위 밖 · 마지막 남은 몸통 행은 지우지 않는다
  for (const row of [0, 5, -1, NaN]) assert.equal(ops.deleteRow(b, { row }, ids()).renderRows, null, `row=${row}`);
  assert.equal(ops.deleteRow(board([seg('a', 1, 0, 2)], 1), { row: 1 }, ids()).renderRows, null);
});

test('duplicateRow·moveRow: 복제는 새 그룹 번호로 아래에, 옮기기는 이웃 행과 맞바꾼다', () => {
  // 복제 — 1행에 q(1~2) 와 a(7~8 → 2행 1~4 로 이어짐). 1번을 복제한다.
  const b = board([seg('q', 1, 0, 2), seg('a', 1, 6, 2), seg('a', 2, 0, 4), seg('c', 3, 0, 2)]);
  const r = ops.duplicateRow(b, { row: 1 }, ids());
  assert.equal(r.rows, 5);
  assert.equal(r.copiedIds.length, 2, '1행에 있던 블록 둘이 복사됐다');
  for (const id of r.copiedIds) assert.ok(!['q', 'a', 'c'].includes(id), '복사본은 새 번호');
  const copies = r.copiedIds.map(id => shape(r.placements, id)).sort((x, y) => x[0][1] - y[0][1]);
  assert.deepEqual(copies, [[[2, 0, 2, 0]], [[2, 6, 2, 0]]], '2행에 같은 칸으로');
  assert.deepEqual(shape(r.placements, 'q'), [[1, 0, 2, 0]], '원본은 그대로');
  assert.deepEqual(shape(r.placements, 'a'), [[1, 6, 2, 0]], '걸친 블록은 1행 몫만 남고');
  const spilled = groupsIn(r.placements).find(g => !['q', 'a', 'c', ...r.copiedIds].includes(g));
  assert.deepEqual(shape(r.placements, spilled), [[3, 0, 4, 0]], '2행 몫은 새 번호로 한 마디 밀린다');
  assert.deepEqual(shape(r.placements, 'c'), [[4, 0, 2, 0]]);
  const names = r.copiedIds.map(id => r.placements.find(p => p.groupId === id).name).sort();
  assert.deepEqual(names, ['a', 'q'], '이름이 같다');
  assert.equal(ops.duplicateRow(b, { row: 0 }, ids()).renderRows, null, '인트로 행은 복제하지 않는다');

  // 옮기기 — 2행 w(1) · a(7~8 → 3행 1~4) · 3행 q(5~6). 2번을 아래로.
  const m = board([seg('w', 2, 0, 1), seg('a', 2, 6, 2), seg('a', 3, 0, 4), seg('q', 3, 4, 2), seg('e', 4, 0, 1)]);
  const mr = ops.moveRow(m, { row: 2, delta: 1 }, ids());
  assert.deepEqual(shape(mr.placements, 'w'), [[3, 0, 1, 0]]);
  assert.deepEqual(shape(mr.placements, 'q'), [[2, 4, 2, 0]], '두 행의 배치가 맞바뀐다');
  assert.deepEqual(shape(mr.placements, 'e'), [[4, 0, 1, 0]], '다른 행은 그대로');
  assert.deepEqual(mr.cutIds, ['a'], '두 행의 경계에 걸친 블록은 끊긴다');
  assert.deepEqual(shape(mr.placements, 'a'), [[3, 6, 2, 0]]);
  assert.deepEqual(mr.renderRows, [2, 3]);
  assert.equal(groupsIn(mr.placements).length, 5);
  // 층이 다시 채워진다 — 1행에서 겹쳐 층 1 이던 블록이 혼자 남는 행으로 가면 층 0 으로 올라온다
  const lanes = board([seg('p', 1, 0, 4), seg('r', 1, 0, 4, { subRow: 1 }), seg('s', 2, 4, 2)]);
  const lr = ops.moveRow(lanes, { row: 1, delta: 1 }, ids());
  assert.deepEqual(shape(lr.placements, 'r'), [[2, 0, 4, 1]], '여전히 p 와 겹치니 층 1');
  assert.deepEqual(shape(lr.placements, 's'), [[1, 4, 2, 0]]);
  // 위 끝 · 아래 끝 · 인트로와는 바꾸지 않는다
  assert.equal(ops.moveRow(m, { row: 1, delta: -1 }, ids()).renderRows, null);
  assert.equal(ops.moveRow(m, { row: 4, delta: 1 }, ids()).renderRows, null);
  assert.equal(ops.moveRow(m, { row: 2, delta: 0 }, ids()).renderRows, null);
});

test('인트로 행이 있는 보드: 끼우기·지우기가 0번 행을 기준으로 어긋나지 않는다', () => {
  // firstRowIndex 0 · rows(마지막 행 번호) 3 — 실제 행은 0..3 넷. 인트로의 z 는 어디서도 움직이지 않는다.
  const b = { rows: 3, cols: 8, hasIntroRow: true, placements: [seg('z', 0, 0, 2), seg('a', 1, 0, 2), seg('c', 3, 0, 2)] };
  const ins = ops.insertRow(b, { row: 1 }, ids());
  assert.equal(ins.rows, 4);
  assert.deepEqual(dump(ins.placements), ['a@2:0+2', 'c@4:0+2', 'z@0:0+2'], '1번 위에 끼우면 1번부터 밀리고 인트로는 그대로');
  const del = ops.deleteRow(b, { row: 3 }, ids());
  assert.equal(del.rows, 2);
  assert.deepEqual(dump(del.placements), ['a@1:0+2', 'z@0:0+2'], '마지막 행을 지우면 그 행의 블록만 사라진다');
  assert.deepEqual(del.selectionRemoved, ['c']);
  // 인트로 행은 끼우거나 지우거나 복제하거나 옮길 수 없다
  assert.equal(ops.insertRow(b, { row: 0 }, ids()).renderRows, null);
  assert.equal(ops.deleteRow(b, { row: 0 }, ids()).renderRows, null);
  assert.equal(ops.duplicateRow(b, { row: 0 }, ids()).renderRows, null);
  assert.equal(ops.moveRow(b, { row: 1, delta: -1 }, ids()).renderRows, null, '1번을 인트로와 바꾸지 않는다');
  // 인트로에서 1행으로 이어지는 블록 위에 1번을 끼우면 인트로 몫은 남고 1행 몫만 밀린다
  const span = ops.insertRow({ ...b, placements: [seg('s', 0, 6, 2), seg('s', 1, 0, 2)] }, { row: 1 }, ids());
  assert.deepEqual(shape(span.placements, 's'), [[0, 6, 2, 0]]);
  assert.deepEqual(span.cutIds, ['s']);
  // 루틴 보드(인트로 없음)에서도 같은 셈이다 — 1번이 첫 행
  const re = { rows: 2, cols: 4, hasIntroRow: false, placements: [seg('a', 1, 0, 2), seg('b', 2, 0, 2)] };
  assert.deepEqual(dump(ops.insertRow(re, { row: 1 }, ids()).placements), ['a@2:0+2', 'b@3:0+2']);
  assert.deepEqual(dump(ops.deleteRow(re, { row: 1 }, ids()).placements), ['b@1:0+2']);
});

// ── ② 커맨드 ──────────────────────────────────────────────────────────────────

function storeWith(placements, rows = 4) {
  const store = createStore();
  store.setBoard(BOARD_MAIN, { rows, placements });
  return store;
}

test('boardCommands: 마디 지우기 한 번이 되돌리기 한 단계이고 사라진 블록은 선택에서 빠진다', () => {
  const store = storeWith([seg('a', 1, 0, 4), seg('d', 2, 2, 2), seg('e', 2, 4, 2), seg('c', 3, 0, 2)]);
  for (const g of ['a', 'd', 'e']) Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: g });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);                                   // 시작 스냅샷
  const before = JSON.stringify(store.get().boards[BOARD_MAIN]);

  // 호출부(app/main)가 하는 그대로 — 커맨드 뒤 커밋 한 번
  const dirty = Board.deleteRowAt(store, { boardId: BOARD_MAIN, row: 2 }, { ids: ids() });
  History.commit(hist, BOARD_MAIN);
  assert.equal(dirty.boards.main.skeleton, true, '행 수가 바뀌니 골격부터 다시 세운다');
  assert.equal(dirty.boards.main.rows, 'all');
  assert.equal(dirty.layout, true, '칸 수 입력창 · 제목이 따라온다(setBoardRows 와 같은 Dirty)');
  assert.equal(dirty.selection, true);
  assert.equal(dirty.toolbar, true);
  assert.deepEqual([...store.get().selection], ['a'], 'd · e 는 사라졌으니 고른 목록에서 빠진다 (D-16)');
  assert.equal(store.get().boards[BOARD_MAIN].rows, 3);
  assert.deepEqual(dump(store.get().boards[BOARD_MAIN].placements), ['a@1:0+4', 'c@2:0+2']);
  assert.equal(hist.stack(BOARD_MAIN).canUndo(), true);

  History.undo(hist, BOARD_MAIN);
  assert.equal(JSON.stringify(store.get().boards[BOARD_MAIN]), before, '되돌리기 한 번에 배치 · rows 가 원래대로');
  assert.equal(hist.stack(BOARD_MAIN).canUndo(), false, '한 단계뿐이다');

  // 끼우기 · 복제 · 옮기기도 Dirty 만 돌려주고 커밋은 하지 않는다
  const ins = Board.insertRowAt(store, { boardId: BOARD_MAIN, row: 1 }, { ids: ids() });
  assert.equal(ins.boards.main.skeleton, true);
  assert.equal(store.get().boards[BOARD_MAIN].rows, 5);
  const dup = Board.duplicateRowAt(store, { boardId: BOARD_MAIN, row: 2 }, { ids: ids() });
  assert.equal(dup.boards.main.skeleton, true);
  assert.equal(store.get().boards[BOARD_MAIN].rows, 6);
  const mv = Board.moveRowBy(store, { boardId: BOARD_MAIN, row: 2, delta: 1 }, { ids: ids() });
  assert.deepEqual(mv, { boards: { main: { rows: [2, 3] } } });
  assert.equal(hist.stack(BOARD_MAIN).canUndo(), false, '커맨드는 히스토리를 쌓지 않는다 — 호출부의 몫');
  // 막히면 알림만
  assert.match(Board.moveRowBy(store, { boardId: BOARD_MAIN, row: 1, delta: -1 }, { ids: ids() }).notify.message, /맨 위/);
  assert.match(Board.moveRowBy(store, { boardId: BOARD_MAIN, row: 6, delta: 1 }, { ids: ids() }).notify.message, /맨 아래/);
  const last = storeWith([seg('a', 1, 0, 2)], 1);
  assert.match(Board.deleteRowAt(last, { boardId: BOARD_MAIN, row: 1 }, { ids: ids() }).notify.message, /마지막 남은 마디/);
  assert.equal(last.get().boards[BOARD_MAIN].rows, 1);
});

test('마디를 끼우거나 지워도 영상 마커 · 박자는 그대로이고, 옛 자리를 가리키는 마커 수를 알린다', () => {
  const store = storeWith([seg('a', 1, 0, 4), seg('c', 3, 0, 2)]);
  setTempo(store, { tempo: { bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 0 } });
  addMarkerAt(store, { inSec: 0, outSec: 2, fromCount: 0, toCount: 4, label: '앞' });     // 1행
  addMarkerAt(store, { inSec: 8, outSec: 9, fromCount: 16, toCount: 18, label: '뒤' });   // 3행
  const before = JSON.stringify(mediaState(store));
  const dirty = Board.insertRowAt(store, { boardId: BOARD_MAIN, row: 2 }, { ids: ids() });
  assert.equal(JSON.stringify(mediaState(store)), before, '마커 · 템포는 한 글자도 안 바뀐다');
  assert.equal(dirty.notify.kind, 'status');
  assert.match(dirty.notify.message, /마커 1개/);
  const del = Board.deleteRowAt(store, { boardId: BOARD_MAIN, row: 1 }, { ids: ids() });
  assert.match(del.notify.message, /마커 2개/);
  // 뒤를 가리키는 마커가 없으면 알림도 없다
  const quiet = Board.insertRowAt(store, { boardId: BOARD_MAIN, row: 4 }, { ids: ids() });
  assert.equal(quiet.notify, undefined);
});
