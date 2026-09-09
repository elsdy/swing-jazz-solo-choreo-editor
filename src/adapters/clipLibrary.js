// src/adapters/clipLibrary.js — 영상 보관 폴더: File System Access API + IndexedDB (adapters 계층)
//
// 신설 파일이다. ports/clips.js 의 ClipLibrary 계약을 채운다.
//
// 어떻게 동작하는가:
//   1. 사용자가 설정에서 `폴더 지정` 을 누르면 showDirectoryPicker 로 폴더를 고른다.
//   2. 그 **핸들**을 IndexedDB 에 남긴다(핸들은 structured clone 이 되지만 localStorage 에는 못 들어간다).
//   3. 업로드한 영상은 `<폴더>/<subdir>/<프로젝트>/<파일>` 로 복사하고, 프로젝트 파일에는 그 상대 경로만 남긴다.
//   4. 다음 실행에서 핸들을 다시 꺼내 권한을 확인하고(세션마다 다시 물을 수 있다) 경로로 파일을 읽는다.
//
// ⚠ 지원 브라우저는 크롬 계열뿐이다. `isSupported()` 가 거짓이면 다른 메서드는 전부 "없음"으로 답한다 —
//   던지지 않는다. 사파리·파이어폭스에서는 파일을 매번 다시 고르는 이전 동작 그대로다.
// ⚠ 권한 요청(requestPermission)은 **사용자 제스처 안에서만** 된다. 자동 복원 경로는 queryPermission 으로
//   조용히 확인만 하고, 없으면 패널의 `보관 폴더에서 불러오기` 버튼(클릭 = 제스처)이 묻는다.
// ⚠ 모든 실패는 null/false 다. 폴더가 지워졌거나, 파일이 옮겨졌거나, 권한이 거부된 것은 전부 정상 경로다.

import { numberedName, splitClipPath } from '../domain/clips.js';

const DB_NAME = 'choreo_clips';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY = 'folder';

function defaultWin() {
  return typeof window === 'undefined' ? null : window;
}

/** IndexedDB 를 연다. 없으면(사파리 프라이빗 등) null. */
function openDb(win) {
  return new Promise((resolve) => {
    const idb = win && win.indexedDB;
    if (!idb) { resolve(null); return; }
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** 트랜잭션 하나로 get/put/delete 를 한다. 실패는 전부 null/undefined 다. */
async function withStore(win, mode, fn) {
  const db = await openDb(win);
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let out = null;
      const req = fn(store);
      if (req) {
        req.onsuccess = () => { out = req.result === undefined ? null : req.result; };
        req.onerror = () => { out = null; };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* 무시 */ }
  }
}

/**
 * ClipLibrary 를 만든다. 생성만으로는 아무것도 하지 않는다(핸들은 첫 호출에서 꺼낸다).
 * @param {{win?: object|null}} [options] 테스트가 가짜 window(showDirectoryPicker·indexedDB)를 준다
 * @returns {import('../ports/clips.js').ClipLibrary}
 */
export function createClipLibrary(options = {}) {
  const win = options.win === undefined ? defaultWin() : options.win;

  /** @type {any} 이 세션에서 꺼내 둔 폴더 핸들. null 이면 아직 안 꺼냈거나 없다. */
  let handle = null;
  let handleLoaded = false;

  async function loadHandle() {
    if (handleLoaded) return handle;
    handleLoaded = true;
    handle = await withStore(win, 'readonly', (store) => store.get(KEY));
    return handle;
  }

  function isSupported() {
    return !!(win && typeof win.showDirectoryPicker === 'function' && win.indexedDB);
  }

  /**
   * @param {boolean} interactive
   * @returns {Promise<boolean>}
   */
  async function ensurePermission(interactive) {
    const h = await loadHandle();
    if (!h) return false;
    const opts = { mode: 'readwrite' };
    try {
      if (typeof h.queryPermission === 'function') {
        const q = await h.queryPermission(opts);
        if (q === 'granted') return true;
      }
      if (!interactive || typeof h.requestPermission !== 'function') return false;
      return (await h.requestPermission(opts)) === 'granted';
    } catch {
      return false;
    }
  }

  /** dirParts 를 따라 내려가며(없으면 만들며) 마지막 디렉터리 핸들을 준다. */
  async function descend(root, dirParts, create) {
    let dir = root;
    for (const part of dirParts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  async function exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch { return false; }
  }

  const library = {
    isSupported,

    async getFolder() {
      if (!isSupported()) return null;
      const h = await loadHandle();
      return h ? { name: String(h.name || '') } : null;
    },

    async pickFolder() {
      if (!isSupported()) return null;
      let picked;
      try {
        picked = await win.showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return null;                    // 취소(AbortError)도, 차단도 전부 "안 골랐다"다
      }
      if (!picked) return null;
      handle = picked;
      handleLoaded = true;
      await withStore(win, 'readwrite', (store) => store.put(picked, KEY));
      return { name: String(picked.name || '') };
    },

    async forgetFolder() {
      handle = null;
      handleLoaded = true;
      await withStore(win, 'readwrite', (store) => store.delete(KEY));
    },

    ensurePermission,

    async saveClip(file, dirParts, fileName) {
      const root = await loadHandle();
      if (!root || !(await ensurePermission(false))) throw new Error('no folder');
      const dir = await descend(root, dirParts, true);
      let name = fileName;
      for (let n = 2; await exists(dir, name); n++) name = numberedName(fileName, n);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      try {
        await writable.write(file);
      } finally {
        await writable.close();
      }
      return { path: [...dirParts, name].join('/') };
    },

    async openClip(path) {
      const root = await loadHandle();
      if (!root || !(await ensurePermission(false))) return null;
      const parts = splitClipPath(path);
      if (parts.length === 0) return null;
      try {
        const dir = await descend(root, parts.slice(0, -1), false);
        const fh = await dir.getFileHandle(parts[parts.length - 1]);
        return await fh.getFile();
      } catch {
        return null;
      }
    }
  };

  return library;
}
