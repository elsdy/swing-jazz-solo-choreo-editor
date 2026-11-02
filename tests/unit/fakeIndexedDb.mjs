// tests/unit/fakeIndexedDb.mjs — 의존성 없는 메모리 IndexedDB 흉내 (RM-33)
//
// `fake-indexeddb` 를 들이지 않는다(빌드 도구 · 의존성 0 원칙). adapters/idbSnapshots 가 실제로 쓰는
// 면만 갖춘다 — open(upgradeneeded · success · error · blocked) · objectStore · get/put/delete/getAll/getAllKeys/clear ·
// 트랜잭션의 complete/error/abort. 실제 브라우저와 같이 **요청의 콜백은 비동기로**, **complete 는 마지막 요청 뒤에**
// 온다 — 콜백 안에서 같은 트랜잭션에 새 요청을 걸면 트랜잭션이 살아 있어야 한다(어댑터가 그렇게 쓴다).
//
// 꾸며 낼 수 있는 실패:
//   · `failOpen: true`   — open 이 onerror 로 끝난다(사파리 프라이빗 등).
//   · `box.quota = true` — 그 뒤의 put 이 QuotaExceededError 로 실패하고 트랜잭션이 abort 된다.
//
// ⚠ 구조 복제(structuredClone)는 한다 — 넣은 객체를 고쳐도 담긴 것이 바뀌지 않는 실제 동작을 지킨다.

/**
 * @param {{ failOpen?: boolean }} [options]
 * @returns {{ indexedDB: object, box: { quota: boolean, databases: Map<string, object>, opened: number } }}
 */
// @complexity time=O(1) space=O(1) cc=2
export function createFakeIndexedDb(options = {}) {
  const box = { quota: false, databases: new Map(), opened: 0, failOpen: Boolean(options.failOpen) };
  const indexedDB = {
    // @complexity time=O(1) space=O(1) cc=4
    open(name, version = 1) {
      const req = makeRequest();
      box.opened += 1;
      queueMicrotask(() => {
        if (box.failOpen) { fail(req, new Error('open failed')); return; }
        let data = box.databases.get(name);
        const fresh = !data;
        if (fresh) { data = { name, version: 0, stores: new Map() }; box.databases.set(name, data); }
        const db = makeDb(data, box);
        req.result = db;
        if (data.version < version) {
          data.version = version;
          if (typeof req.onupgradeneeded === 'function') req.onupgradeneeded({ target: req });
        }
        queueMicrotask(() => { if (typeof req.onsuccess === 'function') req.onsuccess({ target: req }); });
      });
      return req;
    },
    // @complexity time=O(1) space=O(1) cc=1
    deleteDatabase(name) {
      const req = makeRequest();
      queueMicrotask(() => { box.databases.delete(name); req.result = undefined; if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    }
  };
  return { indexedDB, box };
}

function makeRequest() {
  return { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, readyState: 'pending' };
}

function fail(req, error) {
  req.error = error;
  req.readyState = 'done';
  if (typeof req.onerror === 'function') req.onerror({ target: req });
}

function quotaError() {
  return typeof DOMException === 'function'
    ? new DOMException('fake quota exceeded', 'QuotaExceededError')
    : Object.assign(new Error('fake quota exceeded'), { name: 'QuotaExceededError' });
}

// @complexity time=O(1) space=O(1) cc=3
function makeDb(data, box) {
  const names = () => [...data.stores.keys()];
  return {
    name: data.name,
    get version() { return data.version; },
    objectStoreNames: { contains: (n) => data.stores.has(n), get length() { return data.stores.size; }, item: (i) => names()[i] },
    createObjectStore(name) {
      if (!data.stores.has(name)) data.stores.set(name, new Map());
      return { name };
    },
    deleteObjectStore(name) { data.stores.delete(name); },
    // @complexity time=O(k) space=O(k) cc=3
    transaction(storeNames, mode = 'readonly') {
      const list = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const n of list) if (!data.stores.has(n)) throw new Error(`NotFoundError: store ${n}`);
      return makeTx(data, list, mode, box);
    },
    close() { /* 흉내에서는 할 일이 없다 */ }
  };
}

// @complexity time=O(1) space=O(1) cc=8
function makeTx(data, storeNames, mode, box) {
  const tx = { mode, oncomplete: null, onerror: null, onabort: null, error: null, _pending: 0, _done: false, _aborted: false };

  function settle() {
    if (tx._done) return;
    // 마지막 요청의 onsuccess 가 같은 트랜잭션에 새 요청을 걸 틈을 준다 — 실제 IndexedDB 의 자동 커밋과 같다.
    queueMicrotask(() => {
      if (tx._done || tx._pending > 0) return;
      tx._done = true;
      if (tx._aborted) { if (typeof tx.onabort === 'function') tx.onabort({ target: tx }); return; }
      if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx });
    });
  }

  function abort(error) {
    if (tx._done) return;
    tx._aborted = true;
    tx.error = error;
    // 아직 안 돈 요청은 돌지 않는다 — settle 이 abort 로 끝낸다.
    tx._pending = 0;
    settle();
  }

  // @complexity time=O(1) space=O(1) cc=5
  function run(work) {
    if (tx._done || tx._aborted) throw new Error('TransactionInactiveError');
    const req = makeRequest();
    tx._pending += 1;
    queueMicrotask(() => {
      if (tx._aborted) return;
      tx._pending -= 1;
      try {
        req.result = work();
        req.readyState = 'done';
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
        settle();
      } catch (error) {
        req.error = error;
        req.readyState = 'done';
        if (typeof req.onerror === 'function') req.onerror({ target: req });
        if (typeof tx.onerror === 'function') tx.onerror({ target: req });
        abort(error);
      }
    });
    return req;
  }

  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

  // @complexity time=O(1) space=O(1) cc=2
  tx.objectStore = (name) => {
    if (!storeNames.includes(name)) throw new Error(`NotFoundError: ${name} is not in this transaction`);
    const map = data.stores.get(name);
    const write = () => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); };
    return {
      name,
      get: (key) => run(() => (map.has(key) ? clone(map.get(key)) : undefined)),
      getAll: () => run(() => [...map.values()].map(clone)),
      getAllKeys: () => run(() => [...map.keys()]),
      count: () => run(() => map.size),
      put: (value, key) => run(() => {
        write();
        if (box.quota) throw quotaError();
        map.set(key, clone(value));
        return key;
      }),
      delete: (key) => run(() => { write(); map.delete(key); return undefined; }),
      clear: () => run(() => { write(); map.clear(); return undefined; })
    };
  };
  tx.abort = () => abort(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
  return tx;
}
