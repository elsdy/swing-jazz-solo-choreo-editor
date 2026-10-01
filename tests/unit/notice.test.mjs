// tests/unit/notice.test.mjs — 알림 세 급(RM-04): 유스케이스는 급과 문구만 돌려주고, 대화상자를 부르지 않는다
//
// 실패가 사용자에게 닿는 길이 브라우저 alert 하나이던 때는 유스케이스가 dialogs.alert 를 직접 불렀다.
// 이제는 Dirty.notify 로 { kind, message } 를 돌려주고, 어디에 띄울지는 조립부가 정한다.
//   block  — 막는 오류(앱 안 모달)   toast — 알아야 할 실패(잠깐 떴다 사라짐)   status — 참고(상태줄 자리)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, assertDirty, mergeDirty, notice, NONE, BOARD_MAIN } from '../../src/usecases/store.js';
import { counterEnv } from '../../src/ports/env.js';
import * as Palette from '../../src/usecases/paletteCommands.js';
import * as Category from '../../src/usecases/categoryCommands.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as Routine from '../../src/usecases/routineCommands.js';

/** 부르면 던지는 대화상자 — 유스케이스가 아직 대화상자를 부르고 있으면 여기서 붉어진다. */
const NO_DIALOGS = {
  alert(m) { throw new Error(`dialogs.alert 를 불렀다: ${m}`); },
  promptText(m) { throw new Error(`dialogs.promptText 를 불렀다: ${m}`); },
  confirm(m) { throw new Error(`dialogs.confirm 을 불렀다: ${m}`); }
};

function projectDeps(store) {
  return {
    store,
    env: { ...counterEnv(), nowIso: () => '2026-10-01T00:00:00.000Z' },
    dialogs: NO_DIALOGS,
    files: { downloadJson() {} },
    storage: { saveRecents() {}, saveRoutineFavorites() {}, saveLinks() {} },
    commitHistory() {}
  };
}

test('알림 계약: 세 급만 받고, action 은 되돌리기 하나만 받는다', () => {
  for (const kind of ['block', 'toast', 'status']) assertDirty({ notify: notice(kind, '문구') });
  assert.throws(() => assertDirty({ notify: { kind: 'alert', message: '옛 급' } }), /block·toast·status/);
  assert.throws(() => assertDirty({ notify: { kind: 'toast' } }), /message/);
  assertDirty({ notify: notice('toast', '지웠습니다', { label: '되돌리기', command: 'undo', boardId: 'main' }) });
  assert.throws(() => assertDirty({ notify: notice('toast', 'x', { label: '다시', command: 'redo', boardId: 'main' }) }), /undo/);
  assert.throws(() => assertDirty({ notify: notice('toast', 'x', { label: '되돌리기', command: 'undo', boardId: 'side' }) }), /보드/);
});

test('알림 병합: 나중 것이 이기고, action 은 사본이다', () => {
  const action = { label: '되돌리기', command: 'undo', boardId: 'main' };
  const merged = mergeDirty({ notify: notice('status', '앞') }, { notify: notice('toast', '뒤', action) });
  assert.deepEqual(merged.notify, { kind: 'toast', message: '뒤', action });
  merged.notify.action.label = '바뀜';
  assert.equal(action.label, '되돌리기', '병합 결과를 고쳐도 원본이 흔들리지 않는다');
});

test('동작 이름 거부는 토스트로 돌아오고 아무것도 바꾸지 않는다', () => {
  const store = createStore({ ids: counterEnv() });
  const ctx = { store, dialogs: NO_DIALOGS, ids: counterEnv({ prefix: 'm' }) };
  const before = store.get().library.length;
  assert.deepEqual(Palette.addMove(ctx, '   ', 'step'), { notify: notice('toast', '동작 이름을 입력해 주세요.') });
  assert.equal(store.get().library.length, before);
});

test('마지막 카테고리 지우기는 토스트로 거부한다', () => {
  const store = createStore({ ids: counterEnv() });
  const ctx = { store, dialogs: NO_DIALOGS };
  const keys = Object.keys(store.get().categories);
  for (const key of keys.slice(1)) Category.removeCategory(ctx, key);
  assert.deepEqual(Category.removeCategory(ctx, keys[0]), { notify: notice('toast', '카테고리는 최소 1개 이상 있어야 합니다.') });
  assert.deepEqual(Object.keys(store.get().categories), [keys[0]]);
});

test('형식이 틀린 프로젝트는 막는 급, 병합 완료는 참고 급이다', () => {
  const store = createStore({ ids: counterEnv() });
  const deps = projectDeps(store);
  assert.deepEqual(Project.mergeProjectFromRecent(deps, { nope: true }), { notify: notice('block', '잘못된 프로젝트 파일 형식입니다.') });
  const merged = Project.mergeProjectFromRecent(deps, { placements: [] });
  assert.equal(merged.notify.kind, 'status');
  assert.match(merged.notify.message, /^병합 완료: 0개 그룹 배치됨/);
  assert.ok(merged.boards[BOARD_MAIN], '병합은 보드를 다시 그린다 — 알림은 그 뒤다');
});

test('동작 파일을 들이다 저장이 던지면 같은 문구의 토스트로 흡수한다', () => {
  const store = createStore({ ids: counterEnv() });
  const deps = { ...projectDeps(store), storage: { saveRecents() { throw new Error('쿼터'); }, saveRoutineFavorites() {}, saveLinks() {} } };
  const dirty = Project.loadMoveListFromFile(deps, { data: { moves: [] }, fileName: '동작.json' });
  assert.deepEqual(dirty.notify, notice('toast', '동작 파일을 읽을 수 없습니다.'));
  assert.notEqual(dirty, NONE);
});

// ── 이름은 묻지 않고 받는다(prompt 창 → 그 칸 위의 인라인 입력) ─────────────────────

test('동작 이름 바꾸기: 적은 값을 받고, null 은 취소, 빈 이름은 토스트로 거부한다', () => {
  const store = createStore({ ids: counterEnv() });
  const ctx = { store, dialogs: NO_DIALOGS, ids: counterEnv({ prefix: 'm' }) };
  const move = store.get().library[0];
  assert.deepEqual(Palette.renameMove(ctx, move.id, null), NONE, '취소');
  assert.deepEqual(Palette.renameMove(ctx, move.id, '   '), { notify: notice('toast', '이름을 비워둘 수 없습니다.') });
  const dirty = Palette.renameMove(ctx, move.id, '새 이름');
  assert.equal(dirty.palette, true);
  assert.equal(store.get().library[0].name, '새 이름');
});

test('카테고리 키 바꾸기: 없는 키는 토스트로 거부하고, 있는 키는 옮긴다', () => {
  const store = createStore({ ids: counterEnv() });
  const ctx = { store, dialogs: NO_DIALOGS, ids: counterEnv({ prefix: 'm' }) };
  const move = store.get().library[0];
  const other = Object.keys(store.get().categories).find(k => k !== move.category);
  assert.deepEqual(Palette.setMoveCategoryKey(ctx, move.id, ''), NONE, '빈 값은 취소(원본 3267)');
  assert.deepEqual(Palette.setMoveCategoryKey(ctx, move.id, '없는키'), { notify: notice('toast', '존재하는 카테고리 키를 입력해 주세요.') });
  Palette.setMoveCategoryKey(ctx, move.id, ` ${other} `);
  assert.equal(store.get().library[0].category, other, '앞뒤 공백은 걷는다(원본 3268)');
});

test('루틴 이름 바꾸기: 적은 값을 받고, null 은 취소다', () => {
  const store = createStore({ ids: counterEnv() });
  store.update({ routines: [{ id: 'r1', name: '옛 이름', rows: 1, cols: 8, placements: [] }] });
  const deps = { store, env: counterEnv(), dialogs: NO_DIALOGS, storage: { saveRoutineFavorites() {} }, commitHistory: () => NONE };
  assert.deepEqual(Routine.renameRoutine(deps, 'r1', null), NONE);
  Routine.renameRoutine(deps, 'r1', '새 루틴');
  assert.equal(store.get().routines[0].name, '새 루틴');
});
