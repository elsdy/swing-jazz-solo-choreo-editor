// tests/unit/splitMerge.test.mjs — 블록 자르기 · 합치기 (RM-16, 2026-11-02)
//
// 두 층을 본다.
//   ① 전이(domain/boardOps.splitGroup · mergeGroups · mergePartner) — 카운트 합이 그대로이고 이름 · 분류 · 층이 남는다
//   ② 커맨드(usecases/boardCommands.splitGroupAt · splitAtPlayhead · mergeWithNeighbor) — 초 ↔ 카운트 변환과 선택 정리
// 앞의 세 시험 이름은 계획서(docs/roadmap/plans/RM-16.md)의 「요구 ↔ 시험」 표 1~3 과 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../../src/domain/boardOps.js';
import * as Board from '../../src/usecases/boardCommands.js';
import { createStore, BOARD_MAIN, NONE } from '../../src/usecases/store.js';
import { setTempo } from '../../src/usecases/videoCommands.js';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0, ...extra });
const board = (placements, rows = 4) => ({ rows, cols: 8, hasIntroRow: true, placements });
function ids() { let n = 0; return () => `n${++n}`; }
const countOf = (pl, g) => pl.filter(p => p.groupId === g).reduce((n, p) => n + p.length, 0);
const groupsIn = (pl) => [...new Set(pl.map(p => p.groupId))];
const shape = (pl, g) => pl.filter(p => p.groupId === g).sort((a, b) => a.row - b.row).map(p => [p.row, p.startIndex, p.length, p.subRow]);

// ── ① 전이 ────────────────────────────────────────────────────────────────────

test('splitGroup: 카운트 자리에서 그룹을 둘로 나누고 이름·분류를 두 조각에 남긴다', () => {
  // 「스윙아웃」 6카운트가 1행 7~8 + 2행 1~4 에 걸쳐 있다 — 밑층의 「턴」 과 겹쳐 층 1 이다. 앞 3카운트에서 자른다.
  const b = board([
    seg('a', 1, 6, 2, { name: '스윙아웃', category: 'basic', subRow: 1 }), seg('a', 2, 0, 4, { name: '스윙아웃', category: 'basic', subRow: 1 }),
    seg('t', 1, 6, 2, { name: '턴' }), seg('t', 2, 0, 4, { name: '턴' }),
  ]);
  const r = ops.splitGroup(b, { groupId: 'a', frontCount: 3 }, ids());
  const [front, back] = r.groupIds;
  assert.equal(front, 'a', '앞 조각은 원래 번호를 지킨다 — 고른 상태가 남는다');
  assert.notEqual(back, 'a', '뒤 조각은 새 번호');
  assert.equal(countOf(r.placements, front) + countOf(r.placements, back), 6, '카운트 합이 원래와 같다');
  assert.deepEqual(shape(r.placements, front), [[1, 6, 2, 1], [2, 0, 1, 1]]);
  assert.deepEqual(shape(r.placements, back), [[2, 1, 3, 1]]);
  for (const p of r.placements.filter(p => p.groupId !== 't')) { assert.equal(p.name, '스윙아웃'); assert.equal(p.category, 'basic'); }
  assert.deepEqual(r.renderRows, [1, 2]);
  assert.deepEqual(b.placements.map(p => p.id), ['a-1-6', 'a-2-0', 't-1-6', 't-2-0'], '입력 배열은 그대로다');
  // 끝에서 자르면 조각이 비거나 전부다 — 아무 일도 없다
  for (const frontCount of [0, 6, 7, -1, NaN]) assert.equal(ops.splitGroup(b, { groupId: 'a', frontCount }, ids()).renderRows, null, `frontCount=${frontCount}`);
  assert.equal(ops.splitGroup(b, { groupId: '없음', frontCount: 1 }, ids()).renderRows, null);
  // 받아 적기가 만든 `?` 블록도 자르면 둘 다 `?` 다
  const q = ops.splitGroup(board([seg('q', 1, 0, 4, { name: '', pending: true })]), { groupId: 'q', frontCount: 1 }, ids());
  assert.ok(q.placements.every(p => p.pending === true && p.name === ''));
  // 루틴 블록은 자르지 않는다
  assert.equal(ops.splitGroup(board([seg('r', 1, 0, 8, { type: 'routine', routineId: 'rt' })]), { groupId: 'r', frontCount: 4 }, ids()).renderRows, null);
});

test('splitGroupAt: 템포가 없으면 넘긴 카운트 번호로 자른다', () => {
  const run = (args) => {
    const store = createStore();
    store.setBoard(BOARD_MAIN, { placements: [seg('a', 1, 6, 2), seg('a', 2, 0, 4)] });
    const dirty = Board.splitGroupAt(store, { boardId: BOARD_MAIN, groupId: 'a', ...args }, { ids: ids() });
    return { dirty, pl: store.get().boards[BOARD_MAIN].placements };
  };
  // 「4번째 카운트에서」 = 앞 3카운트 — 초를 넘긴 것과 같은 결과
  const byCount = run({ countInGroup: 4 });
  assert.deepEqual(byCount.dirty, { boards: { main: { rows: [1, 2] } } });
  assert.deepEqual(shape(byCount.pl, 'a'), [[1, 6, 2, 0], [2, 0, 1, 0]]);
  assert.equal(groupsIn(byCount.pl).length, 2);
  // 템포가 없는데 초로 부르면 자르지 않고 까닭을 말한다
  const bySec = run({ sec: 3 });
  assert.equal(bySec.dirty.notify?.kind, 'status');
  assert.match(bySec.dirty.notify.message, /박자가 없어/);
  assert.equal(groupsIn(bySec.pl).length, 1, '자르지 않았다');
  // 1번째 · 길이 밖은 NONE — 팝업은 2..길이 만 보인다
  assert.equal(run({ countInGroup: 1 }).dirty, NONE);
  assert.equal(run({ countInGroup: 7 }).dirty, NONE);
  assert.equal(run({}).dirty, NONE);
});

test('mergeGroups: 붙어 있는 같은 이름·같은 층 두 그룹만 하나로 합친다', () => {
  const x = (g, row, s, len, extra = {}) => seg(g, row, s, len, { name: '스윙아웃', ...extra });
  // a(1행 1~4) 와 b(1행 5~8 + 2행 1~2) 가 붙어 있다
  const b = board([x('a', 1, 0, 4), x('b', 1, 4, 4), x('b', 2, 0, 2), x('far', 3, 0, 2), x('lane', 1, 4, 2, { subRow: 1 }), seg('other', 2, 2, 2)]);
  assert.equal(ops.mergePartner(b.placements, 8, 'a'), 'b', '바로 뒤에 붙은 짝');
  assert.equal(ops.mergePartner(b.placements, 8, 'b'), 'a', '뒤에 없으면 바로 앞');
  assert.equal(ops.mergePartner(b.placements, 8, 'far'), null, '떨어져 있다');
  assert.equal(ops.mergePartner(b.placements, 8, 'lane'), null, '층이 다르다');
  assert.equal(ops.mergePartner(b.placements, 8, 'other'), null, '이름이 다르다');
  const r = ops.mergeGroups(b, { groupId: 'b', withGroupId: 'a' }, ids());
  assert.equal(r.groupId, 'a', '앞 것의 번호가 남는다');
  assert.deepEqual(r.selectionRemoved, ['b']);
  assert.equal(countOf(r.placements, 'a'), 10, '카운트가 합이다');
  assert.deepEqual(shape(r.placements, 'a'), [[1, 0, 8, 0], [2, 0, 2, 0]]);
  assert.ok(!groupsIn(r.placements).includes('b'));
  assert.equal(groupsIn(r.placements).length, 4);
  assert.deepEqual(r.renderRows, [1, 2]);
  // 짝이 아닌 것을 넘기면 그대로 둔다
  for (const withGroupId of ['far', 'lane', 'other', 'a', '없음', null]) {
    assert.equal(ops.mergeGroups(b, { groupId: 'a', withGroupId }, ids()).renderRows, null, `with=${withGroupId}`);
  }
  // 이름 없는 ? 블록끼리도 합친다 — 받아 적기가 둘로 끊은 한 동작
  const q = board([seg('q1', 1, 0, 2, { name: '', pending: true }), seg('q2', 1, 2, 3, { name: '', pending: true }), seg('named', 1, 5, 1, { name: '' })]);
  assert.equal(ops.mergePartner(q.placements, 8, 'q1'), 'q2');
  assert.equal(ops.mergePartner(q.placements, 8, 'named'), null, '이름이 빈 것과 ? 는 다르다');
  const qr = ops.mergeGroups(q, { groupId: 'q1', withGroupId: 'q2' }, ids());
  assert.equal(countOf(qr.placements, 'q1'), 5);
  assert.ok(qr.placements.filter(p => p.groupId === 'q1').every(p => p.pending === true));
  // 루틴 블록은 짝이 되지 않는다
  const rt = board([seg('r1', 1, 0, 4, { type: 'routine', routineId: 'rt' }), seg('r2', 1, 4, 4, { type: 'routine', routineId: 'rt', name: 'r1' })]);
  assert.equal(ops.mergePartner(rt.placements, 8, 'r1'), null);
});

// ── ② 커맨드 ──────────────────────────────────────────────────────────────────

/** 120bpm · 1박 = 1카운트 · 0초 = 카운트 0(= 1행 1카운트의 앞 경계). 카운트 n 의 경계는 n/2 초다. */
const TEMPO = { bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 0, points: [] };
function storeWithTempo(placements) {
  const store = createStore();
  store.setBoard(BOARD_MAIN, { placements });
  setTempo(store, { tempo: TEMPO });
  return store;
}

test('splitAtPlayhead: 재생 헤드 초를 카운트 경계로 붙여 걸친 블록을 층마다 자르고, 빈 칸이면 알린다', () => {
  // a: 1행 1~4(카운트 0..3) · b: 1행 3~6(카운트 2..5, 층 1) · c: 2행(카운트 8..9)
  const store = storeWithTempo([seg('a', 1, 0, 4), seg('b', 1, 2, 4, { subRow: 1 }), seg('c', 2, 0, 2)]);
  // 카운트 3 의 경계는 1.5초 — 반 칸(0.2초) 늦게 눌러도 그 경계로 붙는다
  const dirty = Board.splitAtPlayhead(store, { boardId: BOARD_MAIN, sec: 1.7 }, { ids: ids() });
  assert.deepEqual(dirty.boards, { main: { rows: [1] } });
  const pl = store.get().boards[BOARD_MAIN].placements;
  assert.equal(groupsIn(pl).length, 5, 'a 와 b 가 각각 둘로 — c 는 그대로');
  assert.deepEqual(shape(pl, 'a'), [[1, 0, 3, 0]]);
  assert.deepEqual(shape(pl, 'b'), [[1, 2, 1, 1]]);
  assert.equal(countOf(pl, 'c'), 2);
  // 블록의 첫 카운트(경계 0)나 빈 칸(카운트 7)에서는 자를 것이 없다
  for (const sec of [0, 3.5]) {
    const d = Board.splitAtPlayhead(store, { boardId: BOARD_MAIN, sec }, { ids: ids() });
    assert.equal(d.boards, undefined);
    assert.match(d.notify.message, /걸친 블록이 없습니다/);
  }
  // 박자가 없으면 자르지 않는다
  const bare = createStore();
  bare.setBoard(BOARD_MAIN, { placements: [seg('a', 1, 0, 4)] });
  assert.match(Board.splitAtPlayhead(bare, { boardId: BOARD_MAIN, sec: 1 }, { ids: ids() }).notify.message, /박자가 없어/);
  // 팝업의 「여기서 자르기」도 같은 변환이다 — 재생 헤드가 그 블록 밖이면 NONE(카운트 고르기로 떨어진다)
  const one = storeWithTempo([seg('a', 1, 0, 4), seg('c', 2, 0, 2)]);
  assert.equal(Board.splitGroupAt(one, { boardId: BOARD_MAIN, groupId: 'c', sec: 1.5 }, { ids: ids() }), NONE);
  assert.deepEqual(Board.splitGroupAt(one, { boardId: BOARD_MAIN, groupId: 'a', sec: 1.5 }, { ids: ids() }), { boards: { main: { rows: [1] } } });
});

test('mergeWithNeighbor: 합쳐 사라진 그룹은 고른 목록에서 빠지고, 짝이 없으면 알림만 뜬다 (D-16)', () => {
  const store = createStore();
  store.setBoard(BOARD_MAIN, { placements: [seg('a', 1, 0, 4, { name: 'x' }), seg('b', 1, 4, 2, { name: 'x' }), seg('z', 3, 0, 1)] });
  Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: 'a' });
  Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: 'b' });
  assert.equal(Board.mergePartnerOf(store, { boardId: BOARD_MAIN, groupId: 'a' }), 'b');
  const dirty = Board.mergeWithNeighbor(store, { boardId: BOARD_MAIN, groupId: 'a' }, { ids: ids() });
  assert.deepEqual(dirty, { boards: { main: { rows: [1] } }, selection: true, toolbar: true });
  assert.deepEqual([...store.get().selection], ['a'], 'b 는 사라졌으니 고른 목록에서도 빠진다');
  assert.equal(countOf(store.get().boards[BOARD_MAIN].placements, 'a'), 6);
  const none = Board.mergeWithNeighbor(store, { boardId: BOARD_MAIN, groupId: 'z' }, { ids: ids() });
  assert.equal(none.boards, undefined);
  assert.match(none.notify.message, /옆에 붙은/);
  assert.equal(Board.mergePartnerOf(store, { boardId: BOARD_MAIN, groupId: 'z' }), null);
});
