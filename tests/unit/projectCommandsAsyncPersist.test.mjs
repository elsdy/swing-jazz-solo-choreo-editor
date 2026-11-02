// tests/unit/projectCommandsAsyncPersist.test.mjs — 비동기 저장의 실패가 형식 오류로 뭉개지지 않는다 (RM-33)
//
// 프로젝트 최근 목록의 저장(storage.saveRecents('projects', …))은 2026-11-02 부터 IndexedDB 라 Promise 를 돌려준다.
// 옛 localStorage 경로에서는 쿼터 초과가 동기로 던져져, 불러오기의 try 가 그것을 「올바른 프로젝트 파일이 아닙니다」로
// 잡았다 — 안무표는 이미 열렸는데 파일이 틀렸다고 말했다. 이제 거부는 돌려받은 쪽(app/main 의 storage 다리)이 받아
// recentsStoreFailedNotice 로 따로 알린다. 그것을 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, assertDirty, BOARD_MAIN } from '../../src/usecases/store.js';
import { counterEnv } from '../../src/ports/env.js';
import { StorageError } from '../../src/ports/storage.js';
import * as Project from '../../src/usecases/projectCommands.js';

const FILE_ERROR = '올바른 프로젝트 파일이 아닙니다.';

/** 거부하는 비동기 저장. 돌려준 Promise 를 모아 두고, 잡지 않으면 여기서 잡히지 않은 거부가 된다. */
function rejectingStorage(code = 'QUOTA_EXCEEDED') {
  const returned = [];
  return {
    returned,
    saveRecents(kind, list) {
      const p = Promise.reject(new StorageError(code, `${kind} 저장 실패`));
      returned.push({ kind, list, p });
      return p;
    },
    saveRoutineFavorites() {},
    saveLinks() {}
  };
}

function deps(store, storage) {
  return {
    store,
    env: { ...counterEnv(), nowIso: () => '2026-11-02T00:00:00.000Z' },
    files: { downloadJson() { deps.downloads += 1; } },
    storage,
    commitHistory() {}
  };
}
deps.downloads = 0;

function sampleFile() {
  return { fileName: '해피핏', savedAt: '2026-11-01T00:00:00.000Z', rows: 4, cols: 8, placements: [], moveLibrary: [], categories: {}, routines: [] };
}

test('비동기 저장이 거부돼도 불러오기는 열리고 「올바른 프로젝트 파일이 아닙니다」가 뜨지 않는다', async () => {
  const store = createStore({ ids: counterEnv() });
  const storage = rejectingStorage();
  const dirty = Project.loadProjectFromFile(deps(store, storage), { data: sampleFile(), fileName: '해피핏-project.json' });
  assertDirty(dirty);

  assert.notEqual(dirty.notify && dirty.notify.message, FILE_ERROR, '저장 실패가 형식 오류로 뭉개지면 안 된다');
  assert.equal(dirty.notify, undefined, '커맨드는 알리지 않는다 — 거부는 storage 다리가 받는다');
  assert.deepEqual(dirty.savedLists, ['projects'], '목록은 다시 그린다 — 메모리 목록에는 올라갔다');
  assert.equal(store.get().recents.projects[0].fileName, '해피핏-project', '확장자만 뗀 원래 파일 이름');
  assert.equal(store.board(BOARD_MAIN).rows, 4, '안무표는 열렸다');

  // 커맨드는 Promise 를 삼키지도 기다리지도 않는다 — 돌려받은 쪽이 그대로 받는다.
  assert.equal(storage.returned.length, 1);
  await assert.rejects(storage.returned[0].p, (err) => err instanceof StorageError && err.code === 'QUOTA_EXCEEDED');
});

test('부분 불러오기 · 저장 · 목록 삭제도 같은 길이다 — 동기로 돌아오고 거부는 바깥이 받는다', async () => {
  const store = createStore({ ids: counterEnv() });
  const storage = rejectingStorage('UNAVAILABLE');
  const d = deps(store, storage);

  const merged = Project.mergeProjectFromFile(d, { data: sampleFile(), fileName: '조각.json' });
  assert.notEqual(merged.notify.message, FILE_ERROR);
  assert.match(merged.notify.message, /^병합 완료/);

  const before = deps.downloads;
  const saved = Project.saveProject(d, { fileName: '저장본' });
  assert.equal(deps.downloads, before + 1, '파일은 먼저 받아진다');
  assert.deepEqual(saved.savedLists, ['projects']);
  assert.equal(store.get().recents.projects[0].data.fileName, '저장본', '메모리 목록의 첫 줄은 내용을 들고 있다 — 보관 폴더 쓰기가 그것을 읽는다');

  const removed = Project.removeRecent(d, 'projects', '저장본');
  assert.deepEqual(removed.savedLists, ['projects']);

  assert.equal(storage.returned.length, 3);
  for (const r of storage.returned) await assert.rejects(r.p, (err) => err.code === 'UNAVAILABLE');
});

test('동기 저장(동작 · 카테고리 목록)의 실패는 지금까지처럼 그 경로의 문구로 흡수된다', () => {
  const store = createStore({ ids: counterEnv() });
  const storage = { saveRecents() { return { ok: false, code: 'QUOTA_EXCEEDED' }; }, saveRoutineFavorites() {}, saveLinks() {} };
  const dirty = Project.loadMoveListFromFile(deps(store, storage), { data: { moves: [] }, fileName: '동작.json' });
  assert.equal(dirty.notify.message, '동작 파일을 읽을 수 없습니다.');
});

test('담기 실패의 알림은 무엇이 안 됐고 무엇은 됐는지 함께 말한다', () => {
  const quota = Project.recentsStoreFailedNotice(new StorageError('QUOTA_EXCEEDED', 'x'));
  assertDirty({ notify: quota });
  assert.equal(quota.kind, 'toast');
  assert.match(quota.message, /저장 공간이 가득 차/);
  assert.match(quota.message, /브라우저에 담지 못했습니다 — 파일은 받아졌고/);
  assert.notEqual(quota.message, FILE_ERROR);

  const other = Project.recentsStoreFailedNotice(new StorageError('UNAVAILABLE', 'x'));
  assert.match(other.message, /저장소를 쓸 수 없어/);
  assert.match(Project.recentsStoreFailedNotice(undefined).message, /저장소를 쓸 수 없어/);
});
