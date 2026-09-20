// src/adapters/draftStore.js — 작업 중인 문서를 담아 두는 자리 (adapters 계층)
//
// 신설 파일이다(2026-09-20). 앱은 지금까지 **끄면 잊었다** — `프로젝트 저장` 을 누르지 않고
// 새로고침하면 안무표도, 고른 영상도, 찍어 둔 박자와 마커도 사라졌다. 영상을 보며 받아 적는
// 일은 길게 이어지므로 그 사이의 새로고침 한 번이 그날의 일을 지웠다.
//
// 담는 자리는 둘이고 **서버가 있으면 서버가 이긴다.**
//   서버   `/api/projects` 에 정해진 이름 한 칸. 폰과 PC 가 같은 서버를 보면 이어서 편집한다.
//   브라우저 localStorage 한 칸. 정적 호스팅으로 열었을 때의 자리다.
//
// ⚠ **이것은 「저장」이 아니다.** 사용자가 이름을 붙여 저장한 파일과 자리가 다르고, 최근 목록에도
//   오르지 않는다. 지웠다 되살리는 것은 언제나 이 한 칸뿐이라 이력이 없다.
// ⚠ 던지지 않는다. 담는 데 실패해도 편집은 계속돼야 한다 — 쿼터 초과·서버 꺼짐은 흔하고,
//   그때 화면이 멈추면 담기가 편집을 방해하는 것이 된다. 실패는 false 로만 알린다.
// ⚠ 모양은 **프로젝트 파일과 같다**(usecases/projectCommands.draftSnapshot). 여기서는 바이트를
//   옮기기만 하고 무엇이 들었는지 모른다.

/** 서버 쪽 이름. 앞의 `_` 는 사용자가 지은 이름과 섞이지 않게 하는 표식이다(보관 폴더의 `_미지정` 과 같은 결). */
export const DRAFT_NAME = '_작업중';

/** 브라우저 쪽 키. ports/storage.js 의 7키와 달리 **작업 문서 한 벌**이라 따로 둔다. */
export const DRAFT_KEY = 'choreo_draft';

/**
 * @typedef {Object} DraftStore
 * @property {'server'|'browser'} kind 지금 어디에 담고 있는가
 * @property {(payload: unknown) => Promise<boolean>} save 담는다. 실패해도 던지지 않는다
 * @property {() => Promise<any|null>} load 담아 둔 것. 없거나 깨졌으면 null
 * @property {() => Promise<boolean>} clear 비운다
 */

/**
 * 담는 자리를 만든다.
 *
 * @param {{
 *   getServer?: () => ({ save(name: string, payload: unknown): Promise<any>, read(name: string): Promise<any>, remove(name: string): Promise<any> } | null),
 *   storage?: Storage
 * }} [options]
 *   getServer: **게터다.** 서버가 있는지는 probe 가 끝나야 정해지는데 이 함수는 그 전에 불린다 —
 *   값으로 받으면 서버가 있어도 영영 브라우저에 담는다.
 * @returns {DraftStore}
 */
export function createDraftStore(options = {}) {
  const { getServer = () => null, storage = safeLocalStorage() } = options;

  const server = () => {
    try {
      return getServer() || null;
    } catch {
      return null;
    }
  };

  /** 브라우저 한 칸. 서버가 없을 때의 자리이고, 서버가 있어도 **읽기의 폴백**이다. */
  const browser = {
    save(payload) {
      if (!storage) return false;
      try {
        storage.setItem(DRAFT_KEY, JSON.stringify(payload));
        return true;
      } catch {
        // 쿼터 초과가 가장 흔하다. 담기를 포기할 뿐 편집은 계속된다.
        return false;
      }
    },
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    },
    clear() {
      if (!storage) return false;
      try {
        storage.removeItem(DRAFT_KEY);
        return true;
      } catch {
        return false;
      }
    }
  };

  return {
    get kind() { return server() ? 'server' : 'browser'; },

    async save(payload) {
      const srv = server();
      if (!srv) return browser.save(payload);
      try {
        return Boolean(await srv.save(DRAFT_NAME, payload));
      } catch {
        // 서버가 도중에 꺼져도 그날의 일은 남아야 한다 — 브라우저로 떨어진다.
        return browser.save(payload);
      }
    },

    /**
     * ⚠ 서버가 있어도 **브라우저를 폴백으로 본다.** 서버 없이 쓰다가 서버를 켠 첫날,
     *   담아 둔 것이 브라우저에만 있는데 서버만 보면 그날의 일이 사라진 것처럼 보인다.
     */
    async load() {
      const srv = server();
      if (srv) {
        try {
          const data = await srv.read(DRAFT_NAME);
          if (data && typeof data === 'object') return data;
        } catch {
          // 아래 폴백으로 떨어진다
        }
      }
      return browser.load();
    },

    async clear() {
      const srv = server();
      let ok = browser.clear();
      if (srv) {
        try {
          ok = Boolean(await srv.remove(DRAFT_NAME)) || ok;
        } catch {
          // 서버 쪽만 못 지웠다 — 브라우저 쪽은 지워졌다
        }
      }
      return ok;
    }
  };
}

/** 사파리 프라이빗·서드파티 차단에서는 localStorage 접근 자체가 던진다. */
function safeLocalStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 잦은 호출을 한 번으로 묶는다. 편집 한 번마다 서버를 두드리면 받아 적는 동안 초당 여러 번이 된다.
 *
 * ⚠ **마지막 것이 이긴다.** 앞의 호출이 담기고 있는 중이어도 기다리지 않고 다음 것을 예약한다 —
 *   담는 것은 언제나 「지금 상태 전부」라 중간 것을 빠뜨려도 결과가 같다.
 * ⚠ 타이머는 주입받는다(테스트가 시계를 쥘 수 있게). 기본은 setTimeout 이다.
 *
 * @param {(payload: unknown) => Promise<boolean>} save
 * @param {{ waitMs?: number, setTimer?: Function, clearTimer?: Function }} [options]
 * @returns {{ schedule(getPayload: () => unknown): void, flush(): Promise<boolean>, cancel(): void }}
 */
export function debounceSave(save, options = {}) {
  const {
    waitMs = 1200,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id)
  } = options;

  let timer = null;
  let pending = null;

  function run() {
    timer = null;
    const getPayload = pending;
    pending = null;
    if (!getPayload) return Promise.resolve(false);
    return save(getPayload());
  }

  return {
    schedule(getPayload) {
      pending = getPayload;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(run, waitMs);
    },
    /** 지금 당장 담는다(창을 닫기 직전 같은 때). 예약된 것이 없으면 아무 일도 하지 않는다. */
    flush() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      return run();
    },
    cancel() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      pending = null;
    }
  };
}
