// tests/unit/draftStoreIdb.test.mjs — 작업 문서 자동 담기의 브라우저 칸을 IndexedDB 로 (RM-33)
//
// draftStore 는 바이트만 옮긴다. 브라우저 칸이 localStorage 한 키에서 **주입받은 칸**(idbSnapshots 의 current)으로
// 바뀌어도 서버가 이기고 브라우저 칸은 읽기 폴백이라는 규칙은 그대로다 — 그것을 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDraftStore, DRAFT_KEY, DRAFT_NAME, BOUND_KEY } from '../../src/adapters/draftStore.js';
import { createIdbSnapshots, draftSlotOf } from '../../src/adapters/idbSnapshots.js';
import { createFakeIndexedDb } from './fakeIndexedDb.mjs';

function fakeStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function fakeServer() {
  const box = { files: new Map(), calls: [] };
  return {
    box,
    async save(name, payload, opts) { box.calls.push(['save', name, opts && opts.auto ? 'auto' : '']); box.files.set(name, payload); return { name, mtimeNs: '1' }; },
    async read(name) { box.calls.push(['read', name]); return box.files.has(name) ? box.files.get(name) : null; },
    async remove(name) { box.calls.push(['remove', name]); box.files.delete(name); return true; }
  };
}

test('서버가 없으면 작업 문서를 IndexedDB 칸에 담고 되읽는다', async () => {
  const { indexedDB, box } = createFakeIndexedDb();
  const storage = fakeStorage();
  const snaps = createIdbSnapshots({ win: { indexedDB }, storage });
  const srv = fakeServer();
  let serverOn = false;
  const draft = createDraftStore({ getServer: () => (serverOn ? srv : null), storage, browserSlot: draftSlotOf(snaps) });

  // ① 서버가 없다 — IndexedDB 칸에 담기고, localStorage 의 옛 키(choreo_draft)에는 **아무것도 쓰지 않는다**.
  assert.equal(draft.kind, 'browser');
  assert.equal(await draft.save({ placements: [{ a: 1 }] }), true);
  assert.equal(storage.getItem(DRAFT_KEY), null, '옛 localStorage 키에 쓰지 않는다');
  assert.deepEqual((await snaps.loadCurrent()).doc, { placements: [{ a: 1 }] });
  assert.deepEqual(await draft.load(), { placements: [{ a: 1 }] }, '같은 칸에서 되읽는다');

  // ② 새로 만든 draftStore(새로고침)도 같은 칸을 본다 — 되살리기의 길.
  const again = createDraftStore({ getServer: () => null, storage, browserSlot: draftSlotOf(createIdbSnapshots({ win: { indexedDB }, storage })) });
  assert.deepEqual(await again.load(), { placements: [{ a: 1 }] });

  // ③ 묶임 키는 작은 설정이라 localStorage 에 그대로 남는다 — 부팅 때 동기로 읽혀야 한다.
  draft.bind('해피핏');
  assert.equal(storage.getItem(BOUND_KEY), '해피핏');
  assert.equal(draft.target(), '해피핏');

  // ④ 서버가 켜지면 서버가 이긴다 — 브라우저 칸은 건드리지 않는다.
  serverOn = true;
  assert.equal(draft.kind, 'server');
  assert.equal(await draft.save({ placements: [{ a: 2 }] }), true);
  assert.deepEqual(srv.box.calls.at(-1), ['save', '해피핏', 'auto']);
  assert.deepEqual((await snaps.loadCurrent()).doc, { placements: [{ a: 1 }] }, '서버가 받았으면 브라우저 칸은 그대로다');
  assert.deepEqual(await draft.load(), { placements: [{ a: 2 }] }, '읽기는 서버가 이긴다');

  // ⑤ 서버에 없으면 브라우저 칸이 **읽기의 폴백**이다.
  srv.box.files.clear();
  assert.deepEqual(await draft.load(), { placements: [{ a: 1 }] });

  // ⑥ 서버가 도중에 꺼지면 브라우저 칸으로 떨어진다.
  const dead = { async save() { throw new Error('ECONNREFUSED'); }, async read() { throw new Error('x'); }, async remove() { throw new Error('x'); } };
  const falling = createDraftStore({ getServer: () => dead, storage, browserSlot: draftSlotOf(snaps) });
  assert.equal(await falling.save({ placements: [{ a: 3 }] }), true);
  assert.deepEqual((await snaps.loadCurrent()).doc, { placements: [{ a: 3 }] });

  // ⑦ 칸이 쿼터로 거부해도 던지지 않고 false 다 — 담기가 편집을 멈추면 안 된다.
  serverOn = false;
  box.quota = true;
  assert.equal(await draft.save({ placements: [{ a: 4 }] }), false);
  assert.deepEqual(await draft.load(), { placements: [{ a: 3 }] }, '실패한 쓰기는 앞의 것을 지우지 않는다');
  box.quota = false;

  // ⑧ 칸 자체가 던져도 받는다.
  const throwing = createDraftStore({ getServer: () => null, storage, browserSlot: { save() { throw new Error('x'); }, load() { throw new Error('x'); }, clear() { throw new Error('x'); } } });
  assert.equal(await throwing.save({}), false);
  assert.equal(await throwing.load(), null);
  assert.equal(await throwing.clear(), false);

  // ⑨ clear 는 브라우저 칸을 비우고 묶임을 풀되, 묶였던 파일은 지우지 않는다.
  serverOn = true;
  srv.box.files.set('해피핏', { placements: [] });
  assert.equal(await draft.clear(), true);
  assert.equal(await snaps.loadCurrent(), null, 'IndexedDB 칸이 비었다');
  assert.equal(draft.bound(), '');
  assert.ok(srv.box.files.has('해피핏'), '묶였던 파일은 남는다');
  assert.deepEqual(srv.box.calls.at(-1), ['remove', DRAFT_NAME]);

  // ⑩ browserSlot 을 안 주면 지금까지처럼 localStorage 한 키다(정적 경로에서 IndexedDB 가 없을 때의 길은 idbSnapshots 가 안에서 떨어진다).
  const plain = createDraftStore({ getServer: () => null, storage });
  assert.equal(await plain.save({ p: 1 }), true);
  assert.equal(storage.getItem(DRAFT_KEY), '{"p":1}');
});
