// tests/unit/pendingTray.test.mjs — `?` 정리함: 이름 없는 블록 몰아서 붙이기 (RM-24)
//
// 시험 이름은 계획서(docs/roadmap/plans/RM-24.md)의 「요구 ↔ 시험」 표와 같아야 한다. 화면(ui/pendingTray)의 DOM 과
// 마이크 끄기는 브라우저에서 손으로 본다 — 여기는 순수한 줄 세우기(domain/pendingQueue)와 명령(usecases/pendingTrayCommands)이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { paddedRange, pendingQueue, pendingRepeatGroups, repeatsOf } from '../../src/domain/pendingQueue.js';
import { createStore, BOARD_MAIN, NONE } from '../../src/usecases/store.js';
import * as TrayCmd from '../../src/usecases/pendingTrayCommands.js';
import * as VideoCmd from '../../src/usecases/videoCommands.js';
import * as History from '../../src/usecases/historyCommands.js';
import { counterEnv } from '../../src/ports/env.js';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'step', row, startIndex, length, subRow: 0, ...extra });
const pending = (groupId, row, startIndex, length) => ({ ...seg(groupId, row, startIndex, length), name: '', pending: true });

const LIB = [
  { id: 'm1', name: 'Kick Ball Change', category: 'jump' },
  { id: 'm2', name: '찰스턴', category: 'turn' },
];

/** 박자(120bpm · 1박 1카운트 · 0초가 0카운트)가 있는 store. placements 는 메인 보드에 놓는다. */
function trayStore(placements, { tempo = true } = {}) {
  const store = createStore({ ids: counterEnv() });
  store.update({ library: LIB.map(m => ({ ...m })) });
  store.setBoard(BOARD_MAIN, { placements });
  if (tempo) VideoCmd.setTempo(store, { tempo: { bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 0 } });
  return store;
}

const groupOf = (store, gid) => store.board(BOARD_MAIN).placements.filter(p => p.groupId === gid);
const isPendingGroup = (store, gid) => groupOf(store, gid).every(p => p.pending === true && p.name === '');

test('pendingQueue: 저장 차례가 아니라 표 위 차례로 세우고 자리·길이를 준다', () => {
  // 저장 차례는 c · a · n(이름 있음) · d · b 인데 표 위 차례는 a(1행 0칸) → b(2행 0칸) → c(2행 4칸) → d(3행 6칸, 4행에 걸침)
  const placements = [
    pending('c', 2, 4, 2),
    pending('a', 1, 0, 4),
    seg('n', 3, 0, 4),
    pending('d', 4, 0, 2), pending('d', 3, 6, 2),   // 마디에 걸친 그룹 — 저장은 뒤 조각이 먼저여도 한 줄, 첫 조각의 자리
    pending('b', 2, 0, 3),
  ];
  const q = pendingQueue(placements, 8);
  assert.deepEqual(q.map(r => r.groupId), ['a', 'b', 'c', 'd'], '행 → 칸 차례');
  assert.deepEqual(q.map(r => r.place), ['8x1·1', '8x2·1', '8x2·5', '8x3·7'], '자리는 행 라벨 · 1부터 센 칸');
  assert.deepEqual(q.map(r => r.count), [4, 3, 2, 4], '길이는 조각 길이의 합 — 마디에 걸친 d 는 2+2');
  assert.ok(!q.some(r => r.groupId === 'n'), '이름 있는 블록은 빠진다');
  assert.deepEqual([q[3].fromCount, q[3].toCount], [22, 26], '선형 카운트 — 3행 6칸은 (3-1)·8+6');
  assert.equal(pendingQueue([pending('i', 0, 2, 3)], 8)[0].place, 'intro·3', 'intro 행은 intro 로 적는다');
  assert.deepEqual(pendingQueue(null, 8), [], '배치가 없으면 빈 줄');

  // 되풀이 무리 — 길이와 마디 안 시작 칸이 같은 것끼리. 행은 달라도 된다.
  const rq = pendingQueue([pending('x', 1, 0, 4), pending('y', 2, 0, 4), pending('z', 3, 0, 2), pending('w', 4, 0, 4)], 8);
  assert.deepEqual(pendingRepeatGroups(rq), [['x', 'y', 'w'], ['z']]);
  assert.deepEqual(repeatsOf(rq, 'y'), ['x', 'w'], '자기 자신은 뺀다');
  assert.deepEqual(repeatsOf(rq, 'z'), []);
  assert.deepEqual(repeatsOf(rq, '없음'), []);
});

test('pickPending: 블록을 고르고 그 구간을 앞뒤 한 카운트 여유로 마디 반복한다', () => {
  const store = trayStore([pending('a', 1, 0, 4), pending('b', 2, 2, 3)]);
  VideoCmd.setInOut(store, { inSec: 30, outSec: 40 });                    // 사용자가 잡아 둔 In/Out
  TrayCmd.openTray(store);

  const res = TrayCmd.pickPending(store, { groupId: 'b' });
  assert.deepEqual([...store.get().selection], ['b'], '선택이 그 블록 하나가 된다');
  assert.equal(res.looped, true);
  assert.deepEqual(VideoCmd.panelState(store).practice, { fromCount: 9, toCount: 14 }, '2행 2칸 ~ 3칸 길이 → (10-1, 13+1)');
  assert.equal(VideoCmd.panelState(store).loop, true, '반복이 켜진다');
  assert.deepEqual(VideoCmd.inOutRange(store), { inSec: 30, outSec: 40 }, 'In/Out 은 건드리지 않는다');
  assert.equal(TrayCmd.trayState(store).groupId, 'b', '정리함이 지금 고른 줄을 안다');

  // 곡의 첫 카운트에서 시작하는 블록 — 앞 여유가 0 아래로 내려가지 않는다
  TrayCmd.pickPending(store, { groupId: 'a' });
  assert.deepEqual(VideoCmd.panelState(store).practice, { fromCount: 0, toCount: 5 });
  assert.deepEqual(paddedRange({ fromCount: -3, toCount: -1 }), { fromCount: -3, toCount: 0 }, 'intro 의 블록은 그 시작에서 멈춘다');
  assert.equal(TrayCmd.pickPending(store, { groupId: '없음' }), NONE, '줄에 없는 그룹이면 아무 일도 없다');
});

test('pickPending: 박자가 없으면 선택만 옮기고 반복은 잡지 않으며 재생 못 함을 알린다', () => {
  const store = trayStore([pending('a', 1, 0, 4)], { tempo: false });
  TrayCmd.openTray(store);
  const before = VideoCmd.panelState(store);
  const res = TrayCmd.pickPending(store, { groupId: 'a' });
  assert.deepEqual([...store.get().selection], ['a'], '선택은 옮긴다 — 이름 붙이기는 된다');
  assert.equal(res.noTempo, true, '재생 못 함 표시가 실린다');
  assert.ok(!res.looped);
  assert.equal(VideoCmd.panelState(store).practice, before.practice, '반복 구간은 그대로');
  assert.equal(VideoCmd.panelState(store).loop, before.loop, '반복 켜짐도 그대로');
});

test('namePending: 목록에 있는 이름은 갈래까지, 새 이름은 고른 갈래와 함께 동작 목록에 등록한다', () => {
  const store = trayStore([pending('a', 1, 0, 4), pending('b', 2, 2, 3), pending('c', 3, 4, 2)]);
  const ids = counterEnv({ prefix: 'n' });
  TrayCmd.openTray(store);
  assert.equal(TrayCmd.trayState(store).category, 'step', '처음 갈래는 갈래 목록의 첫 것');

  // ① 목록에 있는 이름 — 띄어쓰기 · 대소문자를 가리지 않고, 목록이 늘지 않으며 그 동작의 표기 · 갈래가 붙는다
  const known = TrayCmd.namePending(store, { groupId: 'a', label: 'kick ball change', category: 'fall' }, { ids });
  assert.equal(known.named, 1);
  assert.equal(store.get().library.length, LIB.length, '있는 이름이면 목록이 늘지 않는다');
  assert.ok(groupOf(store, 'a').every(p => p.name === 'Kick Ball Change' && p.category === 'jump' && !p.pending));

  // ② 새 이름 — 고른 갈래로 목록에 한 줄 늘고, 블록의 pending 이 사라진다
  const fresh = TrayCmd.namePending(store, { groupId: 'b', label: '스윙아웃', category: 'rotate' }, { ids });
  assert.equal(fresh.created, true);
  assert.equal(store.get().library.length, LIB.length + 1, '새 이름은 목록에 한 줄');
  const added = store.get().library.find(m => m.name === '스윙아웃');
  assert.equal(added.category, 'rotate', '줄에서 고른 갈래로 등록된다');
  assert.ok(groupOf(store, 'b').every(p => p.name === '스윙아웃' && p.category === 'rotate' && !('pending' in p)));

  // ③ 다음 줄의 기본 갈래는 지난번에 고른 것
  assert.equal(TrayCmd.trayState(store).category, 'rotate');
  TrayCmd.namePending(store, { groupId: 'c', label: '새동작' }, { ids });            // 갈래를 안 고르면 기본값
  assert.equal(store.get().library.find(m => m.name === '새동작').category, 'rotate');
  assert.equal(TrayCmd.namePending(store, { groupId: 'c', label: '  ' }, { ids }), NONE, '빈 이름은 아무 일도 없다');
});

test('무리의 머리 하나에 이름을 붙이면 같은 모양의 ? 전부가 그 이름이 되고, 되돌리기 한 번에 전부 ? 로 돌아온다', () => {
  // x · y · w 는 4카운트 · 마디 첫 칸(같은 모양), z 는 길이는 같고 시작 칸만 다르다
  const store = trayStore([pending('x', 1, 0, 4), pending('y', 2, 0, 4), pending('z', 3, 2, 4), pending('w', 4, 0, 4)]);
  const ids = counterEnv({ prefix: 'n' });
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);
  TrayCmd.openTray(store);

  const res = TrayCmd.namePending(store, { groupId: 'x', label: '찰스턴' }, { ids });
  History.commit(hist, BOARD_MAIN);
  assert.equal(res.named, 3);
  for (const gid of ['x', 'y', 'w']) {
    assert.ok(groupOf(store, gid).every(p => p.name === '찰스턴' && !p.pending), `${gid} 가 무리와 함께 이름을 받는다`);
  }
  assert.ok(isPendingGroup(store, 'z'), '시작 칸이 다른 ? 는 그대로 남는다');

  assert.notEqual(History.undo(hist, BOARD_MAIN), NONE);
  for (const gid of ['x', 'y', 'w']) assert.ok(isPendingGroup(store, gid), `되돌리기 한 번에 ${gid} 가 ? 로 돌아온다`);
  assert.equal(History.undo(hist, BOARD_MAIN), NONE, '단계는 하나였다 — 한 번 더 되돌릴 것이 없다');
});

test('namePending: 붙인 뒤 다음 ? 를 돌려주고 다 채우면 null 이다', () => {
  const store = trayStore([pending('a', 1, 0, 4), pending('b', 2, 2, 3), pending('c', 3, 4, 2)]);
  const ids = counterEnv({ prefix: 'n' });
  TrayCmd.openTray(store);
  const one = TrayCmd.namePending(store, { groupId: 'b', label: '찰스턴' }, { ids });
  assert.equal(one.next, 'c', '표 위 차례로 바로 다음 ?');
  const two = TrayCmd.namePending(store, { groupId: 'c', label: '찰스턴' }, { ids });
  assert.equal(two.next, 'a', '뒤에 없으면 맨 앞의 남은 ?');
  assert.ok(!two.done);
  const last = TrayCmd.namePending(store, { groupId: 'a', label: '찰스턴' }, { ids });
  assert.equal(last.next, null, '다 채우면 null');
  assert.equal(last.done, true, '「다 채움」 표시');
  assert.deepEqual(TrayCmd.trayQueue(store), [], '목록이 빈다');
});

test('closeTray: 열 때의 마디 반복 구간과 반복 켜짐을 되돌린다', () => {
  // ① 열기 전에 마디 반복이 잡혀 있었다 — 그 값으로 돌아간다
  const store = trayStore([pending('a', 1, 0, 4)]);
  VideoCmd.setPracticeRange(store, { fromCount: 16, toCount: 24 });
  VideoCmd.setLoop(store, { loop: false });
  TrayCmd.openTray(store);
  TrayCmd.pickPending(store, { groupId: 'a' });
  assert.deepEqual(VideoCmd.panelState(store).practice, { fromCount: 0, toCount: 5 });
  TrayCmd.closeTray(store);
  assert.deepEqual(VideoCmd.panelState(store).practice, { fromCount: 16, toCount: 24 }, '열 때의 구간');
  assert.equal(VideoCmd.panelState(store).loop, false, '열 때의 반복 켜짐');
  assert.equal(TrayCmd.trayState(store).open, false);
  assert.equal(TrayCmd.closeTray(store), NONE, '닫힌 것을 또 닫으면 아무 일도 없다');

  // ② 없었다 — 해제로 돌아간다
  const bare = trayStore([pending('a', 1, 0, 4)]);
  TrayCmd.openTray(bare);
  TrayCmd.pickPending(bare, { groupId: 'a' });
  TrayCmd.closeTray(bare);
  assert.equal(VideoCmd.panelState(bare).practice, null, '구간을 푼다');
  assert.equal(VideoCmd.panelState(bare).loop, false);
});
