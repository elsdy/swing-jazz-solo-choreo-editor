// tests/unit/idbSnapshots.test.mjs — 정적 경로의 안무표 보관(IndexedDB) 어댑터 (RM-33)
//
// 계획서의 요구 ↔ 시험 표가 약속한 이름을 그대로 쓴다. 가짜 IndexedDB 는 tests/unit/fakeIndexedDb.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdbSnapshots, draftSlotOf, RECENT_LIMIT } from '../../src/adapters/idbSnapshots.js';
import { StorageError, STORAGE_KEYS } from '../../src/ports/storage.js';
import { DRAFT_KEY } from '../../src/adapters/draftStore.js';
import { RECENT_LIMITS } from '../../src/usecases/projectCommands.js';
import { migrateProjectFile } from '../../src/domain/project/migrations.js';
import { createFakeIndexedDb } from './fakeIndexedDb.mjs';

/** localStorage 흉내. 쿼터 초과를 흉내 낼 수 있게 `fail` 을 둔다. */
function fakeStorage() {
  const map = new Map();
  return {
    fail: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (this.fail) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function doc(name, extra = {}) {
  return { version: 2, fileName: name, savedAt: `2026-11-02T00:00:0${String(extra.n ?? 0)}.000Z`, doc: { placements: [], rows: 4, cols: 8 }, ...extra };
}

function entry(name, n = 0) {
  return { fileName: name, savedAt: `2026-11-02T00:00:0${n}.000Z`, data: doc(name, { n }) };
}

test('목록은 내용 없이 이름과 저장 시각만 돌려준다', async () => {
  const { indexedDB } = createFakeIndexedDb();
  const snaps = createIdbSnapshots({ win: { indexedDB }, storage: fakeStorage() });
  assert.equal(await snaps.mode(), 'idb');
  assert.equal(RECENT_LIMIT, RECENT_LIMITS.projects, '어댑터의 상한은 유스케이스의 상한과 같은 값이어야 한다');

  // 12개를 넣는다 — 상한 10 이라 처음 둘이 밀려난다. 같은 이름을 다시 넣으면 맨 앞으로 오고 한 줄만 남는다.
  for (let i = 0; i < 12; i++) await snaps.putRecent(entry(`p${i}`, i % 10));
  await snaps.putRecent(entry('p5', 9));

  const list = await snaps.listRecents();
  assert.equal(list.length, 10, '상한 10');
  assert.deepEqual(list.map(e => e.fileName), ['p5', 'p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p4', 'p3', 'p2'], '새 항목이 맨 앞, 중복은 하나');
  for (const row of list) {
    assert.deepEqual(Object.keys(row).sort(), ['fileName', 'savedAt'], '목록 항목에 doc · data 가 없다');
    assert.equal(typeof row.savedAt, 'string');
  }
  assert.equal(list[0].savedAt, '2026-11-02T00:00:09.000Z', '다시 넣은 항목은 새 시각을 받는다');

  // 밀려난 항목의 내용은 지워졌다 — 목록 줄만 지우고 내용이 남으면 용량이 새어 나간다.
  assert.equal(await snaps.getRecent('p0'), null);
  assert.equal(await snaps.getRecent('p1'), null);

  // deleteRecent 는 목록과 내용을 함께 지운다.
  await snaps.deleteRecent('p11');
  assert.equal((await snaps.listRecents()).some(e => e.fileName === 'p11'), false);
  assert.equal(await snaps.getRecent('p11'), null);

  // saveRecents(목록 한 벌): 내용 없는 **새** 이름(보관 폴더에서 온 것)은 건너뛰고, 이미 담긴 것은 순서만 고친다.
  const kept = await snaps.saveRecents([
    { fileName: '폴더에만', savedAt: '2026-11-02T01:00:00.000Z', data: null },
    { fileName: 'p2', savedAt: '2026-11-02T01:00:01.000Z', data: null },
    entry('새것', 3)
  ]);
  assert.deepEqual(kept, ['p2', '새것']);
  assert.deepEqual((await snaps.listRecents()).map(e => e.fileName), ['p2', '새것'], '목록에서 빠진 이름은 지워진다');
  assert.deepEqual(await snaps.getRecent('p2'), doc('p2', { n: 2 }), '내용 없는 줄이라도 담겨 있던 내용은 그대로다');
});

test('getRecent 가 이름으로 내용을 읽고 마이그레이션을 거친다', async () => {
  const { indexedDB } = createFakeIndexedDb();
  const snaps = createIdbSnapshots({ win: { indexedDB }, storage: fakeStorage() });

  // v1 모양(평평한 최상위)으로 담아 둔 안무표 — 옛 앱이 남긴 것이다.
  const v1 = { fileName: '옛것', savedAt: '2026-01-01T00:00:00.000Z', rows: 4, cols: 8, placements: [], moveLibrary: [], categories: {}, routines: [] };
  await snaps.putRecent({ fileName: '옛것', savedAt: v1.savedAt, data: v1 });
  await snaps.putRecent(entry('새것', 1));

  const back = await snaps.getRecent('옛것');
  assert.deepEqual(back, v1, '넣은 것이 글자 그대로 돌아온다');
  // 내용은 날것이다 — 마이그레이션은 유스케이스의 readProjectData 가 **한 번** 태운다(이중 변환 없음). 그 길이 열린다.
  const migrated = migrateProjectFile(back, { now: () => '2026-11-02T00:00:00.000Z' });
  assert.equal(migrated.ok, true, '되읽은 v1 이 마이그레이션을 통과한다');
  assert.equal(migrated.value.doc.rows, 4);

  assert.deepEqual(await snaps.getRecent('새것'), doc('새것', { n: 1 }));
  assert.equal(await snaps.getRecent('없는 이름'), null, '없는 이름은 null — 던지지 않는다');

  // 넣은 객체를 나중에 고쳐도 담긴 것은 바뀌지 않는다(구조 복제).
  const e = entry('복제', 2);
  await snaps.putRecent(e);
  e.data.doc.rows = 99;
  assert.equal((await snaps.getRecent('복제')).doc.rows, 4);
});

test('localStorage 의 옛 목록과 초안을 옮기고 확인한 뒤에만 비운다', async () => {
  // ① 성공 — 옛 두 키가 옮겨지고 비워진다. 보관 폴더에서 온 줄(data: null)은 옮기지 않는다.
  {
    const { indexedDB } = createFakeIndexedDb();
    const storage = fakeStorage();
    const legacy = [entry('a', 1), { fileName: '폴더것', savedAt: '2026-11-02T00:00:00.000Z', data: null }, entry('b', 2)];
    storage.setItem(STORAGE_KEYS.savedFiles, JSON.stringify(legacy));
    storage.setItem(DRAFT_KEY, JSON.stringify(doc('_작업중', { n: 5 })));
    const snaps = createIdbSnapshots({ win: { indexedDB }, storage });

    const res = await snaps.migrateFromLocalStorage();
    assert.deepEqual(res, { moved: true, cleared: true });
    assert.deepEqual((await snaps.listRecents()).map(e => e.fileName), ['a', 'b']);
    assert.deepEqual(await snaps.getRecent('b'), doc('b', { n: 2 }));
    assert.deepEqual((await snaps.loadCurrent()).doc, doc('_작업중', { n: 5 }));
    assert.equal(storage.getItem(STORAGE_KEYS.savedFiles), null, '확인이 끝나 옛 목록 키를 비웠다');
    assert.equal(storage.getItem(DRAFT_KEY), null, '옛 초안 키도 비웠다');

    // 두 번째 부팅 — 옮길 것이 없으면 아무 일도 하지 않는다.
    assert.deepEqual(await snaps.migrateFromLocalStorage(), { moved: false, cleared: false, reason: 'nothing' });
  }

  // ② 쓰기가 실패하면(쿼터) 옛 키가 **남는다** — 옮기지 못한 것을 비우면 그것이 손실이다.
  {
    const { indexedDB, box } = createFakeIndexedDb();
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEYS.savedFiles, JSON.stringify([entry('a', 1)]));
    storage.setItem(DRAFT_KEY, JSON.stringify(doc('_작업중')));
    const snaps = createIdbSnapshots({ win: { indexedDB }, storage });
    box.quota = true;
    const res = await snaps.migrateFromLocalStorage();
    assert.equal(res.cleared, false);
    assert.equal(res.moved, false);
    assert.equal(res.reason, 'QUOTA_EXCEEDED');
    assert.notEqual(storage.getItem(STORAGE_KEYS.savedFiles), null, '옛 목록이 남아 있다');
    assert.notEqual(storage.getItem(DRAFT_KEY), null, '옛 초안이 남아 있다');
  }

  // ③ 다시 읽은 값이 다르면 옛 키가 남는다 — 내용 칸이 읽기에서 다른 것을 주는 꼴을 꾸민다.
  {
    const { indexedDB, box } = createFakeIndexedDb();
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEYS.savedFiles, JSON.stringify([entry('a', 1)]));
    const snaps = createIdbSnapshots({ win: { indexedDB }, storage });
    await snaps.mode();                                       // 열릴 때까지
    // 열린 뒤 내용 칸을 바꿔치기 — 되읽으면 다른 값이 온다.
    const db = box.databases.get('choreo_snapshots');
    const realGet = db.stores.get('recents_doc').get.bind(db.stores.get('recents_doc'));
    db.stores.get('recents_doc').get = (k) => { const v = realGet(k); return v ? { ...v, tampered: true } : v; };
    const res = await snaps.migrateFromLocalStorage();
    assert.deepEqual(res, { moved: true, cleared: false, reason: 'verify-list' });
    assert.notEqual(storage.getItem(STORAGE_KEYS.savedFiles), null, '다시 읽은 값이 달라 옛 키를 남겼다');
  }

  // ④ 초안만 있고 목록은 없어도 옮긴다.
  {
    const { indexedDB } = createFakeIndexedDb();
    const storage = fakeStorage();
    storage.setItem(DRAFT_KEY, JSON.stringify(doc('_작업중', { n: 7 })));
    const snaps = createIdbSnapshots({ win: { indexedDB }, storage });
    assert.deepEqual(await snaps.migrateFromLocalStorage(), { moved: true, cleared: true });
    assert.deepEqual((await snaps.loadCurrent()).doc, doc('_작업중', { n: 7 }));
    assert.equal(storage.getItem(DRAFT_KEY), null);
  }
});

test('쿼터 초과를 StorageError QUOTA_EXCEEDED 로 바꿔 던진다', async () => {
  const { indexedDB, box } = createFakeIndexedDb();
  const snaps = createIdbSnapshots({ win: { indexedDB }, storage: fakeStorage() });
  await snaps.putRecent(entry('멀쩡', 1));

  box.quota = true;
  // putRecent · saveRecents · 는 StorageError 로 거부된다.
  await assert.rejects(snaps.putRecent(entry('터짐', 2)), (err) => {
    assert.ok(err instanceof StorageError, 'StorageError 여야 한다');
    assert.equal(err.code, 'QUOTA_EXCEEDED');
    assert.ok(err.cause, '원래 예외를 cause 로 품는다');
    return true;
  });
  await assert.rejects(snaps.saveRecents([entry('터짐', 2)]), (err) => err instanceof StorageError && err.code === 'QUOTA_EXCEEDED');
  // saveCurrent 는 던지지 않고 false 다 — 자동 담기는 편집을 멈추면 안 된다.
  assert.equal(await snaps.saveCurrent('', doc('_작업중')), false);
  // 깨진 트랜잭션은 아무것도 남기지 않는다 — 앞서 담긴 것은 그대로다.
  assert.deepEqual((await snaps.listRecents()).map(e => e.fileName), ['멀쩡']);
  assert.equal(await snaps.getRecent('터짐'), null);

  box.quota = false;
  assert.deepEqual(await snaps.putRecent(entry('터짐', 2)), ['터짐', '멀쩡'], '자리가 나면 다시 담긴다');
  assert.equal(await snaps.saveCurrent('', doc('_작업중')), true);

  // draftSlotOf 는 draftStore 의 브라우저 칸 모양이다 — 실패도 false 로만.
  const slot = draftSlotOf(snaps);
  assert.equal(await slot.save(doc('x')), true);
  assert.deepEqual(await slot.load(), doc('x'));
  box.quota = true;
  assert.equal(await slot.save(doc('y')), false);
  assert.deepEqual(await slot.load(), doc('x'), '실패한 쓰기는 앞의 것을 건드리지 않는다');
  box.quota = false;
  assert.equal(await slot.clear(), true);
  assert.equal(await slot.load(), null);
});

test('indexedDB 가 없거나 열기가 실패하면 localStorage 로 떨어진다', async () => {
  // ① indexedDB 자체가 없다(win 에 없음) — 지금까지의 두 키 위에서 같은 계약이 돈다.
  {
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEYS.savedFiles, JSON.stringify([entry('옛', 1)]));
    const snaps = createIdbSnapshots({ win: {}, storage });
    assert.equal(await snaps.mode(), 'local');
    assert.deepEqual(await snaps.listRecents(), [{ fileName: '옛', savedAt: '2026-11-02T00:00:01.000Z' }]);
    assert.deepEqual(await snaps.putRecent(entry('새', 2)), ['새', '옛']);
    assert.deepEqual(await snaps.getRecent('새'), doc('새', { n: 2 }));
    const stored = JSON.parse(storage.getItem(STORAGE_KEYS.savedFiles));
    assert.deepEqual(stored.map(e => e.fileName), ['새', '옛'], '옛 키의 모양(fileName · savedAt · data)을 그대로 쓴다');
    assert.deepEqual(stored[1].data, doc('옛', { n: 1 }));
    // 폴더에서 온 줄은 여기서도 건너뛴다. 삭제도 같은 계약이다.
    await snaps.saveRecents([{ fileName: '폴더것', savedAt: 'x', data: null }, { fileName: '옛', savedAt: 'y', data: null }]);
    assert.deepEqual((await snaps.listRecents()).map(e => e.fileName), ['옛']);
    await snaps.deleteRecent('옛');
    assert.deepEqual(await snaps.listRecents(), []);
    // 작업 문서도 옛 키(choreo_draft)에 간다.
    assert.equal(await snaps.saveCurrent('', doc('d')), true);
    assert.deepEqual(JSON.parse(storage.getItem(DRAFT_KEY)), doc('d'));
    assert.deepEqual((await snaps.loadCurrent()).doc, doc('d'));
    assert.equal(await snaps.clearCurrent(), true);
    assert.equal(await snaps.loadCurrent(), null);
    // 옮길 데가 없으니 마이그레이션은 아무 일도 하지 않는다.
    assert.deepEqual(await snaps.migrateFromLocalStorage(), { moved: false, cleared: false, reason: 'local' });
    // localStorage 의 쿼터도 같은 StorageError 다.
    storage.fail = true;
    await assert.rejects(snaps.putRecent(entry('터짐')), (err) => err instanceof StorageError && err.code === 'QUOTA_EXCEEDED');
    assert.equal(await snaps.saveCurrent('', doc('d')), false);
  }

  // ② open 이 onerror 로 끝난다(사파리 프라이빗 등) — 역시 localStorage 다.
  {
    const { indexedDB } = createFakeIndexedDb({ failOpen: true });
    const storage = fakeStorage();
    const snaps = createIdbSnapshots({ win: { indexedDB }, storage });
    assert.equal(await snaps.mode(), 'local');
    await snaps.putRecent(entry('a'));
    assert.deepEqual((await snaps.listRecents()).map(e => e.fileName), ['a']);
    assert.ok(storage.getItem(STORAGE_KEYS.savedFiles));
  }

  // ③ 둘 다 없다 — 읽기는 비고 쓰기는 UNAVAILABLE 이지만 **던지는 것은 쓰기뿐**이고 saveCurrent 는 false 다.
  {
    const snaps = createIdbSnapshots({ win: null, storage: null });
    assert.equal(await snaps.mode(), 'none');
    assert.deepEqual(await snaps.listRecents(), []);
    assert.equal(await snaps.getRecent('x'), null);
    assert.equal(await snaps.loadCurrent(), null);
    assert.equal(await snaps.saveCurrent('', {}), false);
    await assert.rejects(snaps.putRecent(entry('a')), (err) => err instanceof StorageError && err.code === 'UNAVAILABLE');
  }
});
