// tests/unit/selectionReset.test.mjs — 블록을 통째로 갈아엎는 세 동작 뒤에 고른 목록이 비는가 (RM-03)
//
// 블록 두 개를 고른 채 「전체 초기화(링크 포함)」·「전체 불러오기」·「안무표만 비우기」를 누르면 블록은 사라지는데
// 고른 목록은 남아, 도구 모음이 눌러도 아무 일 없는 「루틴으로 편성 (2)」를 계속 보였다.
// 골든(배치 알고리즘 기록)은 선택 상태를 담지 않아 이 결함이 되살아나도 붉어지지 않는다 — 이 파일이 유일한 안전망이다.
//
// ⚠ 「다시 그려라」(Dirty.selection)만 보지 말고 **실제 목록**(store.selection)을 본다. 「안무표만 비우기」는 알리기만 하고
//   목록은 비우지 않아, 다시 그려도 (2) 가 그대로였다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as Board from '../../src/usecases/boardCommands.js';
import * as Project from '../../src/usecases/projectCommands.js';

function env() {
  let n = 0;
  return { nowIso: () => '2026-10-01T00:00:00.000Z', uid: () => 'id' + (++n), now: () => 0 };
}
const deps = store => ({
  store, env: env(), dialogs: { alert: () => {} },
  storage: { saveRoutineFavorites() {}, saveLinks() {}, saveRecents() {} }
});

/** 블록 둘(g1 · g2)을 놓고 둘 다 고른 store */
function twoSelected() {
  const store = createStore();
  store.setBoard(BOARD_MAIN, {
    placements: [
      { id: 'p1', groupId: 'g1', name: 'Swing Out', category: 'basic', row: 0, startIndex: 0, length: 2, subRow: 0 },
      { id: 'p2', groupId: 'g2', name: 'Circle', category: 'basic', row: 1, startIndex: 0, length: 2, subRow: 0 }
    ]
  });
  Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: 'g1' });
  Board.toggleSelection(store, { boardId: BOARD_MAIN, groupId: 'g2' });
  assert.equal(store.get().selection.size, 2, '준비: 둘 다 골랐다');
  return store;
}

/** 다른 안무 파일 하나 — 블록 한 개(g9) */
const OTHER = {
  rows: 4, cols: 8, moveLibrary: [{ id: 'm9', name: 'Tuck Turn', category: 'basic' }],
  placements: [{ id: 'q1', groupId: 'g9', name: 'Tuck Turn', category: 'basic', row: 0, startIndex: 0, length: 2, subRow: 0 }]
};

function assertCleared(store, dirty, what) {
  assert.equal(store.get().selection.size, 0, `${what}: 고른 목록이 남았다 — 「루틴으로 편성 (2)」가 계속 뜬다`);
  assert.equal(dirty.selection, true, `${what}: 선택 표시를 다시 그리라고 알리지 않는다`);
  assert.equal(dirty.toolbar, true, `${what}: 도구 모음을 다시 그리라고 알리지 않는다 — 버튼이 사라지지 않는다`);
}

test('전체 초기화(링크 포함) 뒤 고른 목록이 빈다', () => {
  const store = twoSelected();
  assertCleared(store, Board.clearBoard(store, { saveLinks() {} }), '전체 초기화');
});

test('안무표만 비우기 뒤 고른 목록이 빈다', () => {
  const store = twoSelected();
  assertCleared(store, Board.clearPlacements(store), '안무표만 비우기');
});

test('파일에서 전체 불러오기 뒤 고른 목록이 빈다', () => {
  const store = twoSelected();
  const dirty = Project.loadProjectFromFile(deps(store), { data: structuredClone(OTHER), fileName: '다른 안무.json' });
  assertCleared(store, dirty, '파일에서 전체 불러오기');
});

test('최근 목록에서 전체 불러오기 뒤 고른 목록이 빈다', () => {
  const store = twoSelected();
  assertCleared(store, Project.loadProjectFromRecent(deps(store), structuredClone(OTHER)), '최근 목록에서 전체 불러오기');
});

test('형식이 틀린 불러오기는 아무것도 바꾸지 않는다 — 선택도 남는다', () => {
  const store = twoSelected();
  const alerts = [];
  const d = { ...deps(store), dialogs: { alert: m => alerts.push(m) } };
  Project.loadProjectFromRecent(d, { placements: [] });              // moveLibrary 가 없다 → normalizeProject 가 거절
  assert.deepEqual(alerts, ['잘못된 프로젝트 파일 형식입니다.'], '준비: 형식 거절 길을 탔다');
  assert.equal(store.get().selection.size, 2);
});

test('대조군: 부분 불러오기(병합)는 고른 목록을 지우지 않는다 — 고른 블록이 그대로 남는다', () => {
  const store = twoSelected();
  Project.mergeProjectFromFile(deps(store), { data: structuredClone(OTHER), fileName: '다른 안무.json' });
  assert.deepEqual([...store.get().selection].sort(), ['g1', 'g2']);
  const groups = new Set(store.get().boards[BOARD_MAIN].placements.map(p => p.groupId));
  assert.ok(groups.has('g1') && groups.has('g2'), '병합 뒤에도 고른 블록이 남아 있어야 대조가 된다');
});
