// src/adapters/idbSnapshots.js — 정적 경로의 안무표 보관: IndexedDB 위의 SnapshotStore (adapters 계층)
//
// 신설 파일이다(RM-33, 2026-11-02). ports/storage.js 의 SnapshotStore 계약을 **처음으로** 채운다.
// 서버 없이 정적 파일로 연 앱이 안무표를 브라우저 안에 담는 자리를 localStorage 에서 여기로 옮긴다.
//
// 왜 옮기나 — 최근 프로젝트 목록(choreo_saved_files)은 항목마다 안무표 **전체**를 품고 10개까지 쌓였다.
// 영상 박자 · 마커 · 프레이즈가 붙은 안무표 몇 개면 5MB 안팎의 localStorage 가 차고, 그때 세 가지가
// 조용히 벌어졌다 — 저장 경로는 파일만 받아지고 목록에 없고, 불러오기 경로는 「올바른 파일이 아닙니다」로
// 뭉개지고, 자동 담기는 false 만 주고 멈춰 새로고침 한 번에 그날의 일을 잃었다.
//
// 칸은 셋이다.
//   `recents_meta`  이름 → { fileName, savedAt, pos }   목록을 그릴 때 **이것만** 읽는다
//   `recents_doc`   이름 → 안무표(프로젝트 파일 모양)     한 줄을 열 때 그 하나만 읽는다
//   `current`       'draft' → 작업 문서                   1.2초마다 담기는 자리(adapters/draftStore 의 브라우저 칸)
//
// ⚠ 키는 **fileName** 이다(원본의 dedupe 키 그대로, localStore.createRecentList 와 같다). projectId 는 쓰지 않는다.
// ⚠ 여는 법은 clipLibrary 의 openDb · withStore 를 본떴고 DB 이름은 따로 둔다 — 핸들 DB 를 올리면 거기 든 핸들이 날아간다.
// ⚠ IndexedDB 가 없거나(사파리 프라이빗 등) 열기가 실패하면 **같은 계약이 localStorage 위에서 돈다**(아래 localFallback).
//   호출부는 어느 쪽인지 모른다 — `mode()` 로만 알 수 있다.
// ⚠ 실패 계약: putRecent · deleteRecent · saveRecents 는 StorageError 로 **거부한다**(QUOTA_EXCEEDED · UNAVAILABLE).
//   saveCurrent 는 **false 로만** 알린다 — 자동 담기는 편집을 멈추면 안 된다(draftStore 의 규약과 같다).
//   읽기(listRecents · getRecent · loadCurrent)는 던지지 않는다 — 못 읽으면 빈 배열 · null.
// ⚠ IndexedDB 도 출처(주소 · 포트)마다 따로다. 포트가 바뀌면 사라져 보이는 것은 여기서 풀리지 않는다(RM-28).

import { STORAGE_KEYS, StorageError } from '../ports/storage.js';
import { DRAFT_KEY } from './draftStore.js';

const DB_NAME = 'choreo_snapshots';
const DB_VERSION = 1;
const META = 'recents_meta';
const DOC = 'recents_doc';
const CURRENT = 'current';
const CURRENT_KEY = 'draft';
/** 최근 프로젝트 상한. usecases/projectCommands.RECENT_LIMITS.projects 와 같은 값이다(어댑터는 유스케이스를 모른다). */
export const RECENT_LIMIT = 10;

function defaultWin() {
  return typeof window === 'undefined' ? null : window;
}

/** 사파리 프라이빗 · 서드파티 차단에서는 localStorage 접근 자체가 던진다. */
function safeLocalStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** DOMException 을 StorageError 로 바꾼다. 쿼터는 이름으로 알아본다(브라우저마다 code 가 다르다). */
// @complexity time=O(1) space=O(1) cc=4
function toStorageError(cause, what) {
  if (cause instanceof StorageError) return cause;
  const name = cause && cause.name ? String(cause.name) : '';
  const code = /quota/i.test(name) || /quota/i.test(String(cause && cause.message || '')) ? 'QUOTA_EXCEEDED' : 'UNAVAILABLE';
  return new StorageError(code, `${what} 저장 실패`, cause);
}

/** IndexedDB 를 연다. 없거나 못 열면 null — 그때 호출부가 localStorage 로 떨어진다. */
// @complexity time=O(1) space=O(1) cc=5
function openDb(win) {
  return new Promise((resolve) => {
    const idb = win && win.indexedDB;
    if (!idb) { resolve(null); return; }
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [META, DOC, CURRENT]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * 트랜잭션 하나를 돌린다. `fn(stores, done)` 이 요청을 걸고, 결과는 `done(value)` 로 넘긴다 —
 * 값은 **oncomplete 뒤에** 풀린다(쓰기가 실제로 끝난 뒤). 실패는 StorageError 로 거부한다.
 * ⚠ 요청의 onsuccess 안에서 같은 트랜잭션에 새 요청을 거는 꼴이라, 읽고-쓰기가 한 트랜잭션 안에서 끝난다.
 */
// @complexity time=O(1) space=O(1) cc=6
function runTx(db, mode, names, fn, what) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (cause) {
      reject(toStorageError(cause, what));
      return;
    }
    let out = null;
    let failed = null;
    const stores = Object.fromEntries(names.map(n => [n, tx.objectStore(n)]));
    tx.oncomplete = () => resolve(out);
    tx.onerror = (ev) => { failed = failed || (ev && ev.target && ev.target.error) || tx.error; };
    tx.onabort = () => reject(toStorageError(failed || tx.error || new Error('aborted'), what));
    try {
      fn(stores, (value) => { out = value; });
    } catch (cause) {
      reject(toStorageError(cause, what));
    }
  });
}

/** 요청 하나를 콜백으로 잇는다. 실패는 트랜잭션의 onerror/onabort 가 받는다. */
function on(req, next) {
  req.onsuccess = () => next(req.result === undefined ? null : req.result);
}

/** 목록 항목의 모양을 맞춘다 — 목록에는 내용이 없다. */
function metaOf(entry, pos) {
  return { fileName: String(entry.fileName), savedAt: String(entry.savedAt || ''), pos };
}

/** 목록에 실을 수 있는 항목인가 — 이름이 있어야 한다. */
function hasName(entry) {
  return Boolean(entry && typeof entry.fileName === 'string' && entry.fileName);
}

/** 내용을 들고 온 항목인가. 보관 폴더에서 온 항목(data: null)은 아니다. */
function carriesDoc(entry) {
  return entry && entry.data !== undefined && entry.data !== null && typeof entry.data === 'object';
}

/**
 * 목록 한 벌을 **한 트랜잭션**으로 맞춘다 — 이것이 쓰기의 중심이다.
 *   · 내용을 들고 온 항목: 내용과 목록 줄을 쓴다
 *   · 내용은 없지만 이미 담겨 있는 항목: 목록 줄(순서 · 시각)만 고친다
 *   · 내용도 없고 담긴 적도 없는 항목(보관 폴더에서 온 것): **건너뛴다** — 브라우저 칸에 빈 줄을 세우지 않는다
 *   · 목록에서 빠진 이름: 내용과 목록 줄을 지운다(상한 절단 · 삭제가 여기로 온다)
 */
// @complexity time=O(n) space=O(n) cc=9
function writeListTx(stores, done, list) {
  const metaStore = stores[META];
  const docStore = stores[DOC];
  on(docStore.getAllKeys(), (docKeys) => {
    on(metaStore.getAllKeys(), (metaKeys) => {
      const had = new Set([...(docKeys || []), ...(metaKeys || [])]);
      const kept = new Set();
      let pos = 0;
      for (const entry of list) {
        if (!hasName(entry) || kept.has(entry.fileName)) continue;
        if (carriesDoc(entry)) {
          docStore.put(entry.data, entry.fileName);
        } else if (!had.has(entry.fileName)) {
          continue;
        }
        kept.add(entry.fileName);
        metaStore.put(metaOf(entry, pos), entry.fileName);
        pos += 1;
      }
      for (const name of had) {
        if (kept.has(name)) continue;
        docStore.delete(name);
        metaStore.delete(name);
      }
      done([...kept]);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB 판
// ─────────────────────────────────────────────────────────────────────────────

// @complexity time=O(1) space=O(1) cc=1
function idbBacked(db) {
  const tx = (mode, names, fn, what) => runTx(db, mode, names, fn, what);
  return {
    mode: 'idb',

    // @complexity time=O(n log n) space=O(n) cc=2
    async listRecents() {
      try {
        const rows = await tx('readonly', [META], (s, done) => on(s[META].getAll(), (all) => done(all || [])), '목록');
        return rows
          .filter(r => r && typeof r.fileName === 'string')
          .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
          .map(r => ({ fileName: r.fileName, savedAt: r.savedAt || '' }));
      } catch {
        return [];
      }
    },

    async getRecent(fileName) {
      try {
        return await tx('readonly', [DOC], (s, done) => on(s[DOC].get(String(fileName)), done), '내용');
      } catch {
        return null;
      }
    },

    saveRecents(list) {
      const arr = Array.isArray(list) ? list.slice(0, RECENT_LIMIT) : [];
      return tx('readwrite', [META, DOC], (s, done) => writeListTx(s, done, arr), '최근 목록');
    },

    // @complexity time=O(n) space=O(n) cc=2
    putRecent(entry) {
      if (!hasName(entry)) return Promise.reject(new StorageError('CORRUPT', '이름 없는 항목'));
      return tx('readwrite', [META, DOC], (s, done) => {
        on(s[META].getAll(), (all) => {
          const others = (all || [])
            .filter(r => r && typeof r.fileName === 'string' && r.fileName !== entry.fileName)
            .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
          writeListTx(s, done, [entry, ...others].slice(0, RECENT_LIMIT));
        });
      }, '최근 목록');
    },

    deleteRecent(fileName) {
      const name = String(fileName);
      return tx('readwrite', [META, DOC], (s, done) => {
        s[META].delete(name);
        s[DOC].delete(name);
        done(undefined);
      }, '최근 목록');
    },

    async loadCurrent() {
      try {
        const row = await tx('readonly', [CURRENT], (s, done) => on(s[CURRENT].get(CURRENT_KEY), done), '작업 문서');
        return row && typeof row === 'object' && row.doc && typeof row.doc === 'object' ? row : null;
      } catch {
        return null;
      }
    },

    async saveCurrent(projectId, doc) {
      try {
        await tx('readwrite', [CURRENT], (s, done) => {
          s[CURRENT].put({ projectId: String(projectId || ''), doc, savedAt: typeof doc?.savedAt === 'string' ? doc.savedAt : '' }, CURRENT_KEY);
          done(true);
        }, '작업 문서');
        return true;
      } catch {
        return false;
      }
    },

    async clearCurrent() {
      try {
        await tx('readwrite', [CURRENT], (s, done) => { s[CURRENT].delete(CURRENT_KEY); done(true); }, '작업 문서');
        return true;
      } catch {
        return false;
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage 판 — IndexedDB 가 없을 때 같은 계약을 지금까지의 두 키 위에서 돌린다
// ─────────────────────────────────────────────────────────────────────────────

// @complexity time=O(1) space=O(1) cc=1
function localFallback(storage) {
  const readList = () => {
    try {
      const v = JSON.parse(storage.getItem(STORAGE_KEYS.savedFiles) || 'null');
      return Array.isArray(v) ? v.filter(hasName) : [];
    } catch {
      return [];
    }
  };
  const writeList = (list) => {
    try {
      storage.setItem(STORAGE_KEYS.savedFiles, JSON.stringify(list));
    } catch (cause) {
      throw toStorageError(cause, '최근 목록');
    }
  };
  // 내용이 없는 항목은 이미 담긴 내용을 잇고, 그것도 없으면(보관 폴더에서 온 것) 건너뛴다 — IndexedDB 판과 같은 규칙.
  // @complexity time=O(n·m) space=O(n) cc=5
  const mergeDocs = (list) => {
    const had = readList();
    const out = [];
    const seen = new Set();
    for (const entry of list) {
      if (!hasName(entry) || seen.has(entry.fileName)) continue;
      const data = carriesDoc(entry) ? entry.data : (had.find(h => h.fileName === entry.fileName) || {}).data;
      if (data === undefined || data === null) continue;
      seen.add(entry.fileName);
      out.push({ fileName: entry.fileName, savedAt: String(entry.savedAt || ''), data });
    }
    return out.slice(0, RECENT_LIMIT);
  };
  return {
    mode: 'local',
    async listRecents() {
      return readList().map(e => ({ fileName: e.fileName, savedAt: String(e.savedAt || '') }));
    },
    async getRecent(fileName) {
      const hit = readList().find(e => e.fileName === String(fileName));
      return hit && hit.data !== undefined ? hit.data : null;
    },
    async saveRecents(list) {
      const next = mergeDocs(Array.isArray(list) ? list : []);
      writeList(next);
      return next.map(e => e.fileName);
    },
    async putRecent(entry) {
      if (!hasName(entry)) throw new StorageError('CORRUPT', '이름 없는 항목');
      const others = readList().filter(e => e.fileName !== entry.fileName);
      const next = mergeDocs([entry, ...others]);
      writeList(next);
      return next.map(e => e.fileName);
    },
    async deleteRecent(fileName) {
      writeList(readList().filter(e => e.fileName !== String(fileName)));
    },
    async loadCurrent() {
      try {
        const raw = storage.getItem(DRAFT_KEY);
        const doc = raw ? JSON.parse(raw) : null;
        return doc && typeof doc === 'object' ? { projectId: '', doc, savedAt: typeof doc.savedAt === 'string' ? doc.savedAt : '' } : null;
      } catch {
        return null;
      }
    },
    async saveCurrent(_projectId, doc) {
      try {
        storage.setItem(DRAFT_KEY, JSON.stringify(doc));
        return true;
      } catch {
        return false;
      }
    },
    async clearCurrent() {
      try {
        storage.removeItem(DRAFT_KEY);
        return true;
      } catch {
        return false;
      }
    }
  };
}

/** 저장소를 아예 못 쓸 때 — 모든 읽기는 비고, 모든 쓰기는 UNAVAILABLE 이다. */
// @complexity time=O(1) space=O(1) cc=1
function unavailable() {
  const no = () => Promise.reject(new StorageError('UNAVAILABLE', '저장소를 쓸 수 없다'));
  return {
    mode: 'none',
    listRecents: async () => [],
    getRecent: async () => null,
    saveRecents: no,
    putRecent: no,
    deleteRecent: no,
    loadCurrent: async () => null,
    saveCurrent: async () => false,
    clearCurrent: async () => false
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 조립
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} IdbSnapshots  ports/storage.SnapshotStore + 이 앱이 더 쓰는 셋
 * @property {() => Promise<'idb'|'local'|'none'>} mode 어디 위에서 도는가(열어 본 뒤에 정해진다)
 * @property {() => Promise<{fileName:string, savedAt:string}[]>} listRecents 내용 없이 순서대로
 * @property {(fileName: string) => Promise<unknown|null>} getRecent 이름으로 내용 하나
 * @property {(list: {fileName:string, savedAt:string, data?:unknown}[]) => Promise<string[]>} saveRecents
 *   목록 한 벌을 그대로 맞춘다(상한 · 삭제 포함). 내용 없는 새 이름은 건너뛴다. StorageError 로 거부한다
 * @property {(entry: {fileName:string, savedAt:string, data:unknown}) => Promise<string[]>} putRecent 맨 앞에 넣고 상한 10
 * @property {(fileName: string) => Promise<void>} deleteRecent
 * @property {() => Promise<{projectId:string, doc:unknown, savedAt:string}|null>} loadCurrent 작업 문서
 * @property {(projectId: string, doc: unknown) => Promise<boolean>} saveCurrent 실패는 false — 던지지 않는다
 * @property {() => Promise<boolean>} clearCurrent
 * @property {() => Promise<{moved:boolean, cleared:boolean, reason?:string}>} migrateFromLocalStorage
 *   옛 localStorage 두 키(choreo_saved_files · choreo_draft)를 한 번 옮긴다. 다시 읽어 맞을 때만 옛 키를 비운다
 */

/**
 * @param {{ win?: object|null, storage?: Storage|null }} [options]
 *   win: 테스트가 가짜 window(indexedDB)를 준다. storage: 떨어질 localStorage(테스트는 가짜를 준다).
 * @returns {IdbSnapshots}
 */
// @complexity time=O(1) space=O(1) cc=3
export function createIdbSnapshots(options = {}) {
  const win = 'win' in options ? options.win : defaultWin();
  const storage = 'storage' in options ? options.storage : safeLocalStorage();

  /** 한 번만 연다. 실패하면 localStorage 로, 그것도 없으면 「못 씀」으로. */
  const backend = openDb(win).then((db) => {
    if (db) return idbBacked(db);
    return storage ? localFallback(storage) : unavailable();
  });

  const call = (name) => (...args) => backend.then(b => b[name](...args));

  /**
   * 옛 두 키를 IndexedDB 로 옮긴다. ⚠ 확인을 거쳐야 비운다 — 옮긴 것을 다시 읽어 **글자 단위로** 같을 때만.
   * IndexedDB 가 없으면(localStorage 판) 옮길 데가 없으니 아무것도 하지 않는다.
   */
  // @complexity time=O(n) space=O(n) cc=12
  async function migrateFromLocalStorage() {
    const b = await backend;
    if (b.mode !== 'idb' || !storage) return { moved: false, cleared: false, reason: b.mode };
    let legacyList = [];
    let legacyDraft = null;
    let hadList = false;
    let hadDraft = false;
    try {
      const rawList = storage.getItem(STORAGE_KEYS.savedFiles);
      hadList = rawList !== null;
      const parsed = rawList ? JSON.parse(rawList) : null;
      legacyList = Array.isArray(parsed) ? parsed.filter(e => hasName(e) && carriesDoc(e)) : [];
    } catch {
      legacyList = [];
    }
    try {
      const rawDraft = storage.getItem(DRAFT_KEY);
      hadDraft = rawDraft !== null;
      const parsed = rawDraft ? JSON.parse(rawDraft) : null;
      legacyDraft = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      legacyDraft = null;
    }
    if (!hadList && !hadDraft) return { moved: false, cleared: false, reason: 'nothing' };

    try {
      if (legacyList.length) {
        // 이미 담긴 것이 있으면 옛것을 **뒤에** 둔다 — 새 칸에 먼저 담긴 것이 더 새것이다.
        const existing = await b.listRecents();
        const taken = new Set(existing.map(e => e.fileName));
        await b.saveRecents([...existing, ...legacyList.filter(e => !taken.has(e.fileName))]);
      }
      if (legacyDraft) {
        const ok = await b.saveCurrent('', legacyDraft);
        if (!ok) return { moved: false, cleared: false, reason: 'draft-write-failed' };
      }
    } catch (cause) {
      return { moved: false, cleared: false, reason: cause && cause.code ? cause.code : 'write-failed' };
    }

    // 다시 읽어 맞나 — 하나라도 다르면 옛 키를 남긴다(잃는 것보다 두 벌이 낫다).
    for (const entry of legacyList) {
      const back = await b.getRecent(entry.fileName);
      if (JSON.stringify(back) !== JSON.stringify(entry.data)) return { moved: true, cleared: false, reason: 'verify-list' };
    }
    if (legacyDraft) {
      const back = await b.loadCurrent();
      if (!back || JSON.stringify(back.doc) !== JSON.stringify(legacyDraft)) return { moved: true, cleared: false, reason: 'verify-draft' };
    }
    try {
      storage.removeItem(STORAGE_KEYS.savedFiles);
      storage.removeItem(DRAFT_KEY);
    } catch {
      return { moved: true, cleared: false, reason: 'remove-failed' };
    }
    return { moved: true, cleared: true };
  }

  return {
    mode: () => backend.then(b => b.mode),
    listRecents: call('listRecents'),
    getRecent: call('getRecent'),
    saveRecents: call('saveRecents'),
    putRecent: call('putRecent'),
    deleteRecent: call('deleteRecent'),
    loadCurrent: call('loadCurrent'),
    saveCurrent: call('saveCurrent'),
    clearCurrent: call('clearCurrent'),
    migrateFromLocalStorage
  };
}

/**
 * draftStore 의 브라우저 칸으로 쓸 수 있는 모양(`{save, load, clear}`)으로 감싼다.
 * draftStore 는 안에 무엇이 들었는지 모르고 바이트만 옮기므로 작업 문서는 `doc` 그대로 오간다.
 * @param {IdbSnapshots} snaps
 */
// @complexity time=O(1) space=O(1) cc=1
export function draftSlotOf(snaps) {
  return {
    save: (payload) => snaps.saveCurrent('', payload),
    load: () => snaps.loadCurrent().then(row => (row ? row.doc : null)),
    clear: () => snaps.clearCurrent()
  };
}
