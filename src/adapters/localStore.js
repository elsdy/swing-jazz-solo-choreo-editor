// src/adapters/localStore.js — localStorage 7키의 유일한 창구 (adapters 계층)
//
// 원본 index.html 의 loadLocalMeta(4194-4225) · saveFavorites(4227-4230) ·
// saveRoutineFavorites(4639-4641) · saveLinks/loadLinks(5100-5116) ·
// localStorage 호출 21곳 전부(setItem 14: 4043·4054·4064·4228·4229·4279·4305·4333·4399·4418·4444·4472·4640·5101 /
// getItem 7: 4196·4201·4206·4211·4216·4221·5110) ·
// 최근목록 삽입/dedupe/절단 7벌(4042·4053·4063·4398·4417·4443·4471)과 제거 3벌(4278·4304·4332)을 옮겼다.
//
// ⚠ 오늘 동작을 그대로 보존한다:
//   · set 은 try/catch 로 감싸지 않는다. 쿼터 초과(choreo_saved_files 는 payload 10개를 통째로 품는다)는
//     오늘처럼 호출부로 그대로 던져진다 — 임포트 경로(4399·4418·4444·4472)에서는 그 예외가
//     같은 try 안이라 alert 로, 저장 경로(4043·4054·4064)에서는 미처리 예외로 나타난다.
//   · get 의 파싱 실패는 빈 값으로 조용히 덮는다(오늘의 catch 6벌 + loadLinks 의 catch).
//   · 그래서 이번 PR 에서는 아무도 StorageError 를 던지지 않는다. 정의만 있는 상태가 정답이다.

import { STORAGE_KEYS } from '../ports/storage.js';

/** @typedef {{ fileName: string, savedAt: string, data: unknown }} RecentEntry */

// ─────────────────────────────────────────────────────────────────────────────
// localKv — 키-값 창구. 문자열 리터럴 키는 여기서도 쓰지 않는다(STORAGE_KEYS 만).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * localStorage 위의 동기 KvStore.
 * ⚠ ports/storage.js 의 KvStore typedef 는 Promise 반환이지만 여기서는 동기다.
 *   원본은 `state.x = …; localStorage.setItem(…); render…()` 를 한 틱 안에서 수행하고,
 *   임포트 경로는 그 setItem 예외를 **같은 try** 로 잡아 alert 를 띄운다(4399·4418·4444).
 *   await 로 바꾸면 렌더 순서가 밀리고 예외가 미처리 거부(unhandled rejection)로 새어 나간다.
 *   IndexedDB 로 옮길 때 이 파일만 Promise 판으로 갈아 끼우고 호출부를 함께 고친다.
 */
export const localKv = {
  /**
   * 원문 문자열 그대로. 없으면 null.
   * @param {string} key
   * @returns {string|null}
   */
  getRaw(key) {
    return localStorage.getItem(key);
  },

  /**
   * JSON 으로 읽는다. 키가 없거나 JSON 이 깨졌으면 fallback 을 돌려준다
   * (원본 loadLocalMeta 의 try/catch 6벌과 loadLinks 의 catch 가 하던 일 — 조용히 덮는다).
   * @see index.html:4194
   * @template T
   * @param {string} key
   * @param {T} fallback
   * @returns {unknown|T}
   */
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
    } catch {
      return fallback;
    }
  },

  /**
   * JSON 으로 쓴다. ⚠ try/catch 를 두지 않는다 — 쿼터 초과를 오늘처럼 호출부로 던진다.
   * @param {string} key
   * @param {unknown} value
   * @returns {void}
   */
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  /**
   * @param {string} key
   * @returns {void}
   */
  remove(key) {
    localStorage.removeItem(key);
  },

  /** @returns {string[]} 이 앱이 쓰는 7키 중 실제로 존재하는 것만 */
  keys() {
    return Object.values(STORAGE_KEYS).filter(k => localStorage.getItem(k) !== null);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RecentList — 최근 목록 3벌(프로젝트 10 / 동작목록 3 / 카테고리 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 최근 목록 한 벌. 원본에 6번 복제된 한 줄
 *   `[entry, ...list.filter(f => f.fileName !== fileName)].slice(0, limit)`
 * 이 여기 하나가 된다. ⚠ dedupe 키는 id 가 아니라 **fileName** 이고, 새 항목은 항상 맨 앞이다.
 * @see index.html:4042 프로젝트(10)
 * @see index.html:4053 동작목록(3)
 * @see index.html:4063 카테고리(3)
 * @param {string} key STORAGE_KEYS 의 값
 * @param {number} limit
 */
export function createRecentList(key, limit) {
  return {
    key,
    limit,

    /**
     * 저장된 목록. 없거나 깨졌으면 빈 배열(원본 loadLocalMeta 의 catch).
     * @returns {RecentEntry[]}
     */
    load() {
      const value = localKv.get(key, []);
      return Array.isArray(value) ? value : [];
    },

    /**
     * 목록을 통째로 쓴다. ⚠ 던진다(try/catch 없음).
     * ⚠ 호출부는 **원본 순서**를 지켜라 — 먼저 상태에 대입하고 그 다음 save 다(4042→4043).
     *   반대로 하면 쿼터 초과 때 오늘은 남아 있던 메모리 상태가 사라진다.
     * @param {RecentEntry[]} list
     * @returns {void}
     */
    save(list) {
      localKv.set(key, list);
    },

    /**
     * 순수 계산: 맨 앞 삽입 + fileName 중복 제거 + 상한 절단.
     * @param {RecentEntry[]} list
     * @param {RecentEntry} entry
     * @returns {RecentEntry[]} 새 배열
     */
    insert(list, entry) {
      return [entry, ...list.filter(f => f.fileName !== entry.fileName)].slice(0, limit);
    },

    /**
     * 순수 계산: fileName 으로 제거(원본 삭제 버튼 4278·4304·4332).
     * ⚠ 상한 절단을 하지 않는다 — 원본도 삭제 경로에서는 slice 를 부르지 않는다.
     * @param {RecentEntry[]} list
     * @param {string} fileName
     * @returns {RecentEntry[]} 새 배열
     */
    remove(list, fileName) {
      return list.filter(f => f.fileName !== fileName);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 즐겨찾기 3종 — Set 직렬화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 즐겨찾기 저장소. ⚠ moveNames 는 동작 id 가 아니라 **이름**을 키로 쓴다(원본 1411·3061).
 * 이름을 바꾸면 즐겨찾기가 풀리는 관찰 동작이 여기서 나온다.
 * @see index.html:4227 saveFavorites — 동작·카테고리 두 키를 **함께** 쓴다
 * @see index.html:4639 saveRoutineFavorites — 루틴 키만 쓴다
 */
export function createFavoritesRepo() {
  const readSet = (key) => {
    const value = localKv.get(key, []);
    return new Set(Array.isArray(value) ? value : []);
  };
  return {
    /** @returns {{ moveNames: Set<string>, categories: Set<string>, routineIds: Set<string> }} */
    load() {
      return {
        moveNames: readSet(STORAGE_KEYS.favMoves),
        categories: readSet(STORAGE_KEYS.favCategories),
        routineIds: readSet(STORAGE_KEYS.favRoutines)
      };
    },

    /**
     * 원본 saveFavorites(4227-4230). 동작과 카테고리를 한 번에 쓴다 — 나누면 호출 횟수가 달라진다.
     * @param {{ moveNames: Iterable<string>, categories: Iterable<string> }} favorites
     * @returns {void}
     */
    save(favorites) {
      localKv.set(STORAGE_KEYS.favMoves, [...favorites.moveNames]);
      localKv.set(STORAGE_KEYS.favCategories, [...favorites.categories]);
    },

    /**
     * 원본 saveRoutineFavorites(4639-4641).
     * ⚠ deleteRoutine(4617-4627)은 favoriteRoutineIds 에서 지우고도 이걸 부르지 않는다
     *   (deviations-found.jsonl #19) — 호출부가 그 누락을 그대로 재현해야 한다.
     * @param {{ routineIds: Iterable<string> }} favorites
     * @returns {void}
     */
    saveRoutines(favorites) {
      localKv.set(STORAGE_KEYS.favRoutines, [...favorites.routineIds]);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 링크 I/O — 정규화는 domain/links.js 몫이라 여기서는 원문만 오간다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * choreo_links 원문. 파싱 실패나 부재는 `{}` 다 — 호출부가 그것을 그대로
 * `links.normalizeLinks(raw)` 에 넣으면 원본 loadLinks(5108-5116)의 catch 와 결과가 같다.
 * ⚠ **옵션 없이** 부를 것. `{ normalizeCustomItems: true }` 를 주면 저장된 커스텀 링크의 id 가
 *   새로 발급돼 동작이 바뀐다(그 옵션은 프로젝트 파일 경로 applyLinksData 전용이다).
 * @see index.html:5108
 * @returns {object}
 */
export function loadLinksRaw() {
  const value = localKv.get(STORAGE_KEYS.links, {});
  return value && typeof value === 'object' ? value : {};
}

/**
 * choreo_links 쓰기. 넘길 값은 `links.serializeLinks(state.links)` 결과여야 키 순서가 원본과 같다.
 * @see index.html:5100
 * @param {object} serialized
 * @returns {void}
 */
export function saveLinksRaw(serialized) {
  localKv.set(STORAGE_KEYS.links, serialized);
}

// ─────────────────────────────────────────────────────────────────────────────
// 부팅 시 한 번 — 최근목록 3종 + 즐겨찾기 3종
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 원본 loadLocalMeta(4194-4225)를 store 의 구획 이름으로 옮긴 것.
 * 읽는 순서(파일→동작→카테고리→즐겨찾기 동작→카테고리→루틴)까지 원본과 같다.
 * 반환 모양이 store 의 `recents` / `favorites` 구획과 1:1 이라 app/main 은
 * `store.patch('recents', meta.recents)` · `store.patch('favorites', meta.favorites)` 로 받는다.
 * @see index.html:4194
 * @returns {{
 *   recents: { projects: object[], moves: object[], categories: object[] },
 *   favorites: { moveNames: Set<string>, categories: Set<string>, routineIds: Set<string> }
 * }}
 */
export function loadLocalMeta() {
  const projects = createRecentList(STORAGE_KEYS.savedFiles, 10);
  const moves = createRecentList(STORAGE_KEYS.savedMoves, 3);
  const categories = createRecentList(STORAGE_KEYS.savedCategories, 3);
  return {
    recents: {
      projects: projects.load(),
      moves: moves.load(),
      categories: categories.load()
    },
    favorites: createFavoritesRepo().load()
  };
}
