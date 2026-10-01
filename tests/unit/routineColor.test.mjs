// tests/unit/routineColor.test.mjs — 루틴 색을 겹치지 않게 붙이고, 사용자가 바꿀 수 있는가 (RM-34)
//
// 원본은 몇 번째 색까지 썼는지를 세션 카운터에만 두어, 다시 열거나 불러오면 첫 색부터 다시 붙었다 —
// 여덟 색을 다 쓴 안무표에서도 새 루틴이 기존 루틴과 같은 색을 받았다. 이제 새 색은 지금 루틴들에서 셈한다.
// 골든(배치 알고리즘 기록)은 루틴 색을 다루지 않아 이 결함이 되살아나도 붉어지지 않는다 — 이 파일이 안전망이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as Routine from '../../src/usecases/routineCommands.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as History from '../../src/usecases/historyCommands.js';
import { ROUTINE_COLORS, pickRoutineColor, recolorRoutine } from '../../src/domain/routines.js';

function env() {
  let n = 0;
  return { nowIso: () => '2026-10-01T00:00:00.000Z', uid: () => 'id' + (++n), now: () => 0 };
}
function deps(store, hist) {
  return {
    store, env: env(), dialogs: { alert: () => {} },
    storage: { saveRoutineFavorites() {}, saveLinks() {}, saveRecents() {} },
    commitHistory: hist ? (boardId) => History.commit(hist, boardId) : undefined
  };
}
const colorsOf = store => store.get().routines.map(r => r.color);

// ── 도메인: 다음 색 고르기 ──

test('루틴이 없으면 첫 색, 쓰인 색은 건너뛰고 팔레트에서 앞선 빈 색을 고른다', () => {
  assert.equal(pickRoutineColor(ROUTINE_COLORS, []), ROUTINE_COLORS[0]);
  assert.equal(pickRoutineColor(ROUTINE_COLORS, [{ color: ROUTINE_COLORS[0] }, { color: ROUTINE_COLORS[2] }]), ROUTINE_COLORS[1]);
});

test('여덟 색을 다 쓰면 가장 적게 쓰인 색 가운데 앞선 것 — 고르게 겹친다', () => {
  const all = ROUTINE_COLORS.map(color => ({ color }));
  assert.equal(pickRoutineColor(ROUTINE_COLORS, all), ROUTINE_COLORS[0]);
  assert.equal(pickRoutineColor(ROUTINE_COLORS, [...all, { color: ROUTINE_COLORS[0] }]), ROUTINE_COLORS[1]);
});

test('팔레트 밖의 색 · 색 없는 루틴은 셈에 들지 않고, 대소문자는 가리지 않는다', () => {
  const routines = [{ color: '#6366F1' }, {}, { color: ROUTINE_COLORS[0].toUpperCase() }];
  assert.equal(pickRoutineColor(ROUTINE_COLORS, routines), ROUTINE_COLORS[1]);
});

// ── 도메인: 색 바꾸기 ──

test('색 바꾸기는 color 값만 갈아 끼우고 키 순서를 지킨다', () => {
  const routines = [{ id: 'r1', name: '루틴 1', rows: 1, cols: 8, placements: [], isFavorite: false, color: ROUTINE_COLORS[0] }];
  const placements = [{ id: 'p', routineId: 'r1', row: 3 }, { id: 'q', routineId: 'r1', row: 3 }, { id: 'x', row: 5 }];
  const res = recolorRoutine(routines, placements, 'r1', ROUTINE_COLORS[4]);
  assert.equal(res.ok, true);
  assert.equal(res.routines[0].color, ROUTINE_COLORS[4]);
  assert.deepEqual(Object.keys(res.routines[0]), Object.keys(routines[0]), '키 순서가 바뀌면 되돌리기 스냅샷의 서명이 달라진다(RM-07)');
  assert.deepEqual(res.affectedRows, [3], '그 루틴 블록이 놓인 행만 다시 그린다');
  assert.equal(routines[0].color, ROUTINE_COLORS[0], '입력을 바꾸지 않는다');
});

test('같은 색 · 팔레트 밖의 색 · 없는 루틴은 거절한다', () => {
  const routines = [{ id: 'r1', color: ROUTINE_COLORS[0] }];
  assert.equal(recolorRoutine(routines, [], 'r1', ROUTINE_COLORS[0]).reason, 'same');
  assert.equal(recolorRoutine(routines, [], 'r1', '#123456').reason, 'not-in-palette');
  assert.equal(recolorRoutine(routines, [], '없음', ROUTINE_COLORS[1]).reason, 'not-found');
});

// ── 유스케이스: 다시 열어도 겹치지 않는다 ──

test('저장했다 다시 연 안무표에서 새 루틴은 쓰이지 않은 색을 받는다', () => {
  const store = createStore();
  const d = deps(store);
  Routine.createRoutine(d); Routine.closeEditor(d);
  Routine.createRoutine(d); Routine.closeEditor(d);
  Routine.createRoutine(d); Routine.closeEditor(d);
  assert.deepEqual(colorsOf(store), ROUTINE_COLORS.slice(0, 3));

  const saved = JSON.parse(JSON.stringify(Project.draftSnapshot(d, { fileName: '안무' })));
  const reopened = createStore();
  Project.loadProjectFromFile(deps(reopened), { data: saved, fileName: '안무.json' });
  assert.deepEqual(colorsOf(reopened), ROUTINE_COLORS.slice(0, 3), '옛 루틴은 파일의 색 그대로 열린다');

  const d2 = deps(reopened);
  Routine.createRoutine(d2);
  assert.equal(colorsOf(reopened)[3], ROUTINE_COLORS[3], '예전에는 카운터가 0 으로 돌아가 첫 색을 받아 겹쳤다');
});

test('선택 편성이 실패해도 다음 색이 밀리지 않는다(빈 편성은 색을 소비하지 않는다)', () => {
  const store = createStore();
  const d = deps(store);
  store.update({ selection: new Set(['없는그룹']) });
  assert.deepEqual(Routine.createFromSelection(d), {}, '편성할 그룹이 없으면 무동작');
  Routine.createRoutine(d);
  assert.equal(colorsOf(store)[0], ROUTINE_COLORS[0]);
});

test('선택 편성도 쓰이지 않은 색을 받는다', () => {
  const store = createStore();
  const d = deps(store);
  Routine.createRoutine(d); Routine.closeEditor(d);
  store.setBoard(BOARD_MAIN, {
    placements: [{ id: 'p1', groupId: 'g1', name: 'Swing Out', category: 'step', row: 0, startIndex: 0, length: 2, subRow: 0 }]
  });
  store.update({ selection: new Set(['g1']) });
  Routine.createFromSelection(d);
  assert.deepEqual(colorsOf(store), ROUTINE_COLORS.slice(0, 2));
});

// ── 유스케이스: 색 바꾸기와 되돌리기 ──

test('루틴 색 바꾸기 — 목록과 블록 행을 다시 그리고 Undo 로 돌아온다', () => {
  const store = createStore();
  const hist = History.createHistory(store);
  const d = deps(store, hist);
  Routine.createRoutine(d); Routine.closeEditor(d);
  const id = store.get().routines[0].id;
  store.setBoard(BOARD_MAIN, {
    placements: [{ id: 'b1', groupId: 'g1', type: 'routine', routineId: id, name: '루틴 1', category: 'routine', row: 2, startIndex: 0, length: 4, subRow: 0 }]
  });
  History.commit(hist, BOARD_MAIN);

  const dirty = Routine.setRoutineColor(d, id, ROUTINE_COLORS[5]);
  assert.equal(store.get().routines[0].color, ROUTINE_COLORS[5]);
  assert.equal(dirty.routineList, true, '목록 칩을 다시 그린다');
  assert.deepEqual(dirty.boards?.[BOARD_MAIN]?.rows, [2], '그 루틴 블록이 놓인 행을 다시 그린다');
  assert.equal(dirty.history, true, '히스토리에 한 단계를 남긴다');

  History.undo(hist, BOARD_MAIN);
  assert.equal(store.get().routines[0].color, ROUTINE_COLORS[0], 'Undo 로 옛 색이 돌아온다');
});

test('같은 색을 고르면 무동작 — 히스토리를 쌓지 않는다', () => {
  const store = createStore();
  const hist = History.createHistory(store);
  const d = deps(store, hist);
  Routine.createRoutine(d); Routine.closeEditor(d);
  const id = store.get().routines[0].id;
  const depth = hist.stack(BOARD_MAIN).past.length;
  assert.deepEqual(Routine.setRoutineColor(d, id, ROUTINE_COLORS[0]), {});
  assert.equal(hist.stack(BOARD_MAIN).past.length, depth);
});

test('세션 카운터가 없다 — 색은 루틴 배열 말고 어디에도 기억되지 않는다', () => {
  assert.equal('routineColorIdx' in createStore().get().session, false);
});
