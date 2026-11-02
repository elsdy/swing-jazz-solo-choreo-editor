// tests/unit/inlineNaming.test.mjs — 블록 위 이름 입력과 Tab 으로 다음 ? (RM-15)
//
// 세 층의 순수한 부분을 본다 — 화면(askName)은 DOM 이라 브라우저에서 손으로 본다.
//   ① 이름 추리기(domain/moveMatch.suggestMoves) — 포함 검색 · 즐겨찾기 먼저 · 빈 질의는 동작 고르기 창의 차례
//   ② 다음 ? 찾기(domain/placements.adjacentPendingGroupId) — 저장 차례가 아니라 표 위 차례(행 → 칸)
//   ③ 한 블록에 이름 붙이기(usecases/captureCommands.nameGroupTo) — 목록에 있으면 카테고리까지, 없으면 이름만

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchMoves, suggestMoves } from '../../src/domain/moveMatch.js';
import { adjacentPendingGroupId, isPending, pendingGroupIds } from '../../src/domain/placements.js';
import { createStore, BOARD_MAIN, NONE } from '../../src/usecases/store.js';
import * as CaptureCmd from '../../src/usecases/captureCommands.js';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'basic', row, startIndex, length, subRow: 0, ...extra });
const pending = (groupId, row, startIndex, length) => ({ ...seg(groupId, row, startIndex, length), name: '', pending: true });

const LIB = [
  { id: 'm1', name: 'Shim Sham', category: 'routine' },
  { id: 'm2', name: 'Kick Ball Change', category: 'basic' },
  { id: 'm3', name: '찰스턴', category: 'basic' },
  { id: 'm4', name: 'Boogie Back', category: 'jazz' },
  { id: 'm5', name: 'boogie forward', category: 'jazz' },
  { id: 'm6', name: 'Suzie Q', category: 'jazz' },
];

test('suggestMoves: 포함 검색이고 즐겨찾기가 먼저다', () => {
  const favs = new Set(['boogie forward', '찰스턴']);
  // 대소문자 없이 품는 것만 — 목록 차례 그대로. 즐겨찾기가 앞에 선다.
  assert.deepEqual(suggestMoves(LIB, 'boo', favs).map(m => m.name), ['boogie forward', 'Boogie Back']);
  assert.deepEqual(suggestMoves(LIB, 'BOOGIE', new Set()).map(m => m.name), ['Boogie Back', 'boogie forward'], '즐겨찾기가 없으면 목록 차례다');
  assert.deepEqual(suggestMoves(LIB, 'ㅊ', favs), [], '품지 않으면 비어 있다 — 초성 · 닮은 꼴로 끌어오지 않는다');
  assert.deepEqual(suggestMoves(LIB, '  찰 ', favs).map(m => m.name), ['찰스턴'], '앞뒤 빈칸은 뗀다');
  // 빈 질의는 동작 고르기 창의 첫 화면과 같은 차례 — 즐겨찾기(목록 차례) → 나머지(목록 차례)
  assert.deepEqual(suggestMoves(LIB, '', favs).map(m => m.name),
    ['찰스턴', 'boogie forward', 'Shim Sham', 'Kick Ball Change', 'Boogie Back', 'Suzie Q']);
  assert.deepEqual(suggestMoves(LIB, '', ['찰스턴']).map(m => m.name)[0], '찰스턴', '배열로 준 즐겨찾기도 받는다');
  // 동작 고르기 창이 글자를 쳤을 때 쓰는 규칙은 즐겨찾기를 올리지 않는다(구조 커밋 — 동작 그대로).
  assert.deepEqual(matchMoves(LIB, 'boo').map(m => m.name), ['Boogie Back', 'boogie forward']);
  assert.equal(matchMoves(LIB, '').length, LIB.length);
  assert.deepEqual(suggestMoves(null, 'x', null), [], '목록이 없으면 빈 배열');
});

test('adjacentPendingGroupId: 저장 차례가 아니라 표 위 차례로 다음·앞 ? 를 준다', () => {
  // 저장 차례는 c · a · b · n(이름 있음) · d 인데 표 위 차례는 a(1행) → b(2행 0칸) → c(2행 4칸) → d(3행 6칸, 4행에 걸침)
  const placements = [
    pending('c', 2, 4, 2),
    pending('a', 1, 0, 4),
    pending('b', 2, 0, 2),
    seg('n', 3, 0, 4),
    pending('d', 3, 6, 4), pending('d', 4, 0, 2),   // 마디에 걸친 그룹 — 한 번만 나온다
  ];
  assert.deepEqual(pendingGroupIds(placements), ['c', 'a', 'b', 'd'], '저장 차례는 그대로다(2단계의 목록)');
  assert.equal(adjacentPendingGroupId(placements, 'a', 'next'), 'b');
  assert.equal(adjacentPendingGroupId(placements, 'b', 'next'), 'c');
  assert.equal(adjacentPendingGroupId(placements, 'c', 'next'), 'd');
  assert.equal(adjacentPendingGroupId(placements, 'd', 'next'), null, '끝이면 null');
  assert.equal(adjacentPendingGroupId(placements, 'd', 'prev'), 'c');
  assert.equal(adjacentPendingGroupId(placements, 'a', 'prev'), null);
  // 이름 있는 블록에서도 그 자리 기준으로 센다 — Tab 은 이름을 붙인 **뒤에** 다음을 찾는다
  assert.equal(adjacentPendingGroupId(placements, 'n', 'next'), 'd');
  assert.equal(adjacentPendingGroupId(placements, 'n', 'prev'), 'c');
  // 지금 그룹이 없으면 맨 앞 · 맨 뒤
  assert.equal(adjacentPendingGroupId(placements, null, 'next'), 'a');
  assert.equal(adjacentPendingGroupId(placements, 'zzz', 'prev'), 'd');
  assert.equal(adjacentPendingGroupId([seg('n', 1, 0, 2)], 'n', 'next'), null, '? 가 없으면 null');
  assert.equal(adjacentPendingGroupId(placements, 'a'), 'b', '방향 기본값은 다음');
});

/** 동작 목록 · 블록을 둔 store. */
function storeWith(placements) {
  const store = createStore();
  store.update({ library: LIB.map(m => ({ ...m })) });
  store.setBoard(BOARD_MAIN, { placements });
  return store;
}
const groupOf = (store, gid) => store.board(BOARD_MAIN).placements.filter(p => p.groupId === gid);

test('nameGroupTo: 목록에 있는 이름은 카테고리까지, 없는 이름은 이름만 붙이고 목록은 그대로다', () => {
  const store = storeWith([pending('a', 1, 0, 4), pending('b', 2, 0, 2), pending('b', 2, 2, 2)]);
  const before = store.get().library.length;

  // 목록에 있는 이름 — 띄어쓰기 · 대소문자가 달라도 그 동작의 표기와 카테고리로 붙는다
  const out = CaptureCmd.nameGroupTo(store, { boardId: BOARD_MAIN, groupId: 'a', label: 'kick ball change' });
  assert.equal(out.named, 1);
  assert.deepEqual(out.boards[BOARD_MAIN].rows, [1]);
  assert.deepEqual(groupOf(store, 'a').map(p => [p.name, p.category, isPending(p)]), [['Kick Ball Change', 'basic', false]]);

  // 목록에 없는 이름 — 이름만 붙고 카테고리는 그대로, 동작 목록은 늘지 않는다(결정 사항)
  const out2 = CaptureCmd.nameGroupTo(store, { groupId: 'b', label: '  새 동작  ' });
  assert.equal(out2.named, 1);
  assert.deepEqual(out2.boards[BOARD_MAIN].rows, [2], '두 조각이 같은 행이면 행은 한 번');
  assert.deepEqual(groupOf(store, 'b').map(p => [p.name, p.category, p.pending]), [['새 동작', 'basic', undefined], ['새 동작', 'basic', undefined]]);
  assert.equal(store.get().library.length, before, '동작 목록에 넣지 않는다');
  assert.equal(CaptureCmd.pendingCount(store), 0);
});

test('nameGroupTo: 붙였으면 named 를 돌려주고, 빈 이름·null 은 아무것도 바꾸지 않는다', () => {
  const store = storeWith([pending('a', 1, 0, 4), seg('r', 2, 0, 4, { type: 'routine', routineId: 'rt1' })]);
  const snapshot = store.board(BOARD_MAIN).placements;
  assert.equal(CaptureCmd.nameGroupTo(store, { groupId: 'a', label: null }), NONE, '취소(null)');
  assert.equal(CaptureCmd.nameGroupTo(store, { groupId: 'a', label: '   ' }), NONE, '빈 이름');
  assert.equal(CaptureCmd.nameGroupTo(store, { groupId: 'a' }), NONE, '이름을 안 줌');
  assert.equal(CaptureCmd.nameGroupTo(store, { groupId: 'zzz', label: '찰스턴' }), NONE, '없는 그룹');
  assert.equal(CaptureCmd.nameGroupTo(store, { groupId: 'r', label: '찰스턴' }), NONE, '루틴 블록은 건드리지 않는다');
  assert.equal(store.board(BOARD_MAIN).placements, snapshot, '배치 배열이 그대로다');
  assert.equal(CaptureCmd.pendingCount(store), 1);

  const out = CaptureCmd.nameGroupTo(store, { groupId: 'a', label: '찰스턴' });
  assert.equal(out.named, 1, '호출부가 이것을 보고 되돌리기 한 단계를 쌓는다');
  // 이름 있는 블록도 갈아 끼운다(✎ 와 같다)
  const again = CaptureCmd.nameGroupTo(store, { groupId: 'a', label: 'Shim Sham' });
  assert.equal(again.named, 1);
  assert.deepEqual(groupOf(store, 'a').map(p => [p.name, p.category]), [['Shim Sham', 'routine']]);
});

test('nameSelected: 여럿에 붙일 때도 목록에 있는 이름이면 그 동작의 표기 · 카테고리다', () => {
  const store = storeWith([pending('a', 1, 0, 4), pending('b', 2, 0, 2), seg('n', 3, 0, 2)]);
  store.update({ selection: new Set(['a', 'b', 'n']) });
  const out = CaptureCmd.nameSelected(store, { label: 'suzie q' });
  assert.equal(out.named, 2);
  assert.deepEqual(store.board(BOARD_MAIN).placements.map(p => [p.groupId, p.name, p.category]),
    [['a', 'Suzie Q', 'jazz'], ['b', 'Suzie Q', 'jazz'], ['n', 'n', 'basic']],
    '이름 없는 것만 바뀌고 표기는 목록의 것이다');
  store.update({ selection: new Set(['n']) });
  assert.equal(CaptureCmd.nameSelected(store, { label: 'x' }), NONE, '이름 있는 것만 골랐으면 아무 일도 없다');
});
