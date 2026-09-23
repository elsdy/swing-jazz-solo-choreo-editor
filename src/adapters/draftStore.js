// src/adapters/draftStore.js — 작업 중인 문서를 담아 두는 자리 (adapters 계층)
//
// 신설 파일이다(2026-09-20). 앱은 지금까지 **끄면 잊었다** — `프로젝트 저장` 을 누르지 않고
// 새로고침하면 안무표도, 고른 영상도, 찍어 둔 박자와 마커도 사라졌다. 영상을 보며 받아 적는
// 일은 길게 이어지므로 그 사이의 새로고침 한 번이 그날의 일을 지웠다.
//
// 담는 자리는 둘이고 **서버가 있으면 서버가 이긴다.**
//   서버   `/api/projects` 의 한 칸. 폰과 PC 가 같은 서버를 보면 이어서 편집한다.
//   브라우저 localStorage 한 칸. 정적 호스팅으로 열었을 때의 자리다.
//
// ── 어느 칸에 담나 — 「묶인 파일」 (2026-09-22) ─────────────────────────────────
//
// 2026-09-22 까지는 무슨 일을 하든 `_작업중` 한 칸이었다. 그래서 이름을 붙이고 며칠을 작업해도
// 보관 폴더에는 저장본이 없었고(실측으로 그랬다), 사용자는 자동 담기를 보고 「저장됐다」고 여겼다.
// 이제 **한 번 저장하거나 폴더에서 열면 그 파일에 묶이고**, 그 뒤의 자동 담기는 그 파일로 간다.
//
//   묶이지 않음 → `_작업중`(제목 없는 새 문서). 최근 목록에 오르지 않는다.
//   묶임       → `<그 이름>.json`. 최근 목록에 서고, 서버가 덮어쓰기 전 판을 .history 에 남긴다.
//
// ⚠ **이름칸을 고쳐도 묶인 자리는 옮기지 않는다.** 담기는 1.2초마다 도는데 타이핑 중간에 이름이
//   바뀌면 `해`·`해피`·`해피핏` 같은 파일이 줄줄이 생긴다. 이름을 바꿔 옮기는 것은 사람이
//   `프로젝트 저장` 을 한 번 누르는 일이다(「다른 이름으로 저장」과 같은 뜻이고, 옛 이름의 파일은 남는다).
// ⚠ **자동 담기는 `auto` 로 보낸다.** 서버가 그것으로 이력을 얼마나 자주 남길지 정한다 —
//   1.2초마다 남기면 이력 20장이 24초에 다 찬다.
//
// ⚠ 자동 담기는 그래도 「저장」과 다르다 — 사람이 「여기」라고 표시한 자리는 아니다. 그 표시가
//   서버 이력(.history)의 촘촘함을 가른다.
//
// ── 더 새 것을 덮지 않는다 (2026-09-22) ────────────────────────────────────────
//
// 묶인 파일은 두 탭·두 기기가 동시에 볼 수 있다(그러라고 만든 설계다). 그때 담기가 1.2초마다
// 서로를 덮으면 둘 다 조용히 일을 잃는다. 그래서 **읽거나 쓸 때마다 그 판의 표식(mtimeNs)을
// 들고 있다가 다음 쓰기에 같이 보낸다.** 지금 파일이 그것과 다르면 서버가 409 로 거절한다.
//
// ⚠ 거절당하면 **담기를 멈추고 `onConflict` 로 알린다.** 조용히 다시 시도하면 결국 덮어쓰게 되고,
//   그건 이 장치를 둔 뜻이 없다. 그 판본은 브라우저 칸에 떨어뜨려 두므로 잃는 것은 없다.
// ⚠ **쓰기는 한 줄로 세운다.** 앞의 쓰기가 아직 안 끝났는데 다음 것이 같은 표식으로 나가면
//   자기 자신과 충돌한다 — 표식은 앞의 응답으로만 새로워지기 때문이다.
// ⚠ 던지지 않는다. 담는 데 실패해도 편집은 계속돼야 한다 — 쿼터 초과·서버 꺼짐은 흔하고,
//   그때 화면이 멈추면 담기가 편집을 방해하는 것이 된다. 실패는 false 로만 알린다.
// ⚠ 모양은 **프로젝트 파일과 같다**(usecases/projectCommands.draftSnapshot). 여기서는 바이트를
//   옮기기만 하고 무엇이 들었는지 모른다.

/** 서버 쪽 이름. 앞의 `_` 는 사용자가 지은 이름과 섞이지 않게 하는 표식이다(보관 폴더의 `_미지정` 과 같은 결). */
export const DRAFT_NAME = '_작업중';

/** 브라우저 쪽 키. ports/storage.js 의 7키와 달리 **작업 문서 한 벌**이라 따로 둔다. */
export const DRAFT_KEY = 'choreo_draft';

/**
 * 지금 묶여 있는 파일 이름을 담는 키(2026-09-22). 값이 없으면 `_작업중` 이다.
 * ⚠ 이것도 ports/storage.js 의 계약 밖이다 — 안무표가 아니라 **이 브라우저가 지금 무슨 파일을
 *   보고 있나** 이고, 프로젝트 파일에 들어가지 않는다.
 */
export const BOUND_KEY = 'choreo_draft_bound';

/**
 * @typedef {Object} DraftStore
 * @property {'server'|'browser'} kind 지금 어디에 담고 있는가
 * @property {(payload: unknown) => Promise<boolean>} save 담는다. 실패해도 던지지 않는다
 * @property {() => Promise<any|null>} load 담아 둔 것. 없거나 깨졌으면 null
 * @property {() => Promise<boolean>} clear 비운다
 * @property {(name: string) => void} bind 이 이름의 파일에 묶는다(저장했거나 폴더에서 열었을 때)
 * @property {() => string} bound 묶인 이름. 없으면 빈 문자열
 * @property {() => void} unbind 묶임을 푼다(새 문서로 돌아간다)
 * @property {() => string} target 지금 담는 칸의 이름 — 묶였으면 그 이름, 아니면 `_작업중`
 */

/**
 * 담는 자리를 만든다.
 *
 * @param {{
 *   getServer?: () => ({ save(name, payload, opts): Promise<any>, read(name): Promise<any>, readWithMeta?(name): Promise<any>, remove(name): Promise<any> } | null),
 *   storage?: Storage,
 *   onConflict?: (info: {name: string}) => void
 * }} [options]
 *   getServer: **게터다.** 서버가 있는지는 probe 가 끝나야 정해지는데 이 함수는 그 전에 불린다 —
 *   값으로 받으면 서버가 있어도 영영 브라우저에 담는다.
 *   onConflict: 다른 곳에서 그 파일이 바뀌어 담기를 멈췄다. 화면이 그 사실을 말해야 한다.
 * @returns {DraftStore}
 */
export function createDraftStore(options = {}) {
  const { getServer = () => null, storage = safeLocalStorage(), onConflict = () => {} } = options;

  /** 내가 아는 그 파일의 판. 읽기·쓰기의 응답으로만 새로워진다. */
  let seenNs = '';
  /** 다른 곳에서 바뀌어 담기를 멈췄는가. 한 번 멈추면 새로고침 전까지 다시 담지 않는다. */
  let stopped = false;
  /** 쓰기를 한 줄로 세우는 꼬리. 겹쳐 나가면 자기 자신과 충돌한다. */
  let chain = Promise.resolve();

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

  /** 묶인 이름. 저장소를 못 쓰면 빈 문자열이다(그때는 언제나 `_작업중`). */
  function readBound() {
    if (!storage) return '';
    try {
      return String(storage.getItem(BOUND_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  /** 한 번의 쓰기. 위 `chain` 이 이것을 한 줄로 세운다. */
  async function writeOnce(payload) {
    const srv = server();
    if (!srv) return browser.save(payload);
    // 이미 멈췄으면 서버를 건드리지 않는다 — 덮어쓰지 않겠다고 정한 뒤의 재시도는 그 결정을 무른다.
    if (stopped) return browser.save(payload);
    const name = readBound() || DRAFT_NAME;
    try {
      // ⚠ `auto` 를 실어 보낸다 — 서버가 이력을 10분에 한 번만 남기는 근거다.
      const res = await srv.save(name, payload, { auto: true, ifMtimeNs: seenNs || null });
      if (res && res.conflict) {
        stopped = true;
        seenNs = '';
        onConflict({ name });
        return browser.save(payload);        // 내 판본은 브라우저 칸에 남긴다 — 잃는 것은 없다
      }
      if (!res) return browser.save(payload);
      seenNs = String(res.mtimeNs || '');
      return true;
    } catch {
      // 서버가 도중에 꺼져도 그날의 일은 남아야 한다 — 브라우저로 떨어진다.
      return browser.save(payload);
    }
  }

  return {
    get kind() { return server() ? 'server' : 'browser'; },

    bound: readBound,
    target() { return readBound() || DRAFT_NAME; },
    /** 다른 곳에서 바뀌어 담기를 멈췄는가. */
    stopped: () => stopped,

    bind(name) {
      const safe = String(name || '').trim();
      // 다른 파일로 옮겨 가면 아는 판도 옛것이다. 그대로 두면 새 파일에 남의 표식을 들이민다.
      seenNs = '';
      if (!storage) return;
      try {
        if (safe && safe !== DRAFT_NAME) storage.setItem(BOUND_KEY, safe);
        else storage.removeItem(BOUND_KEY);
      } catch {
        // 못 담아도 편집은 계속된다 — 그때는 이 세션이 `_작업중` 을 쓴다
      }
    },

    unbind() {
      if (!storage) return;
      try {
        storage.removeItem(BOUND_KEY);
      } catch { /* 위와 같다 */ }
    },

    save(payload) {
      // ⚠ 한 줄로 세운다. 겹쳐 나가면 같은 표식으로 두 번 쓰게 되어 자기 자신과 충돌한다.
      chain = chain.then(() => writeOnce(payload), () => writeOnce(payload));
      return chain;
    },

    /**
     * ⚠ 서버가 있어도 **브라우저를 폴백으로 본다.** 서버 없이 쓰다가 서버를 켠 첫날,
     *   담아 둔 것이 브라우저에만 있는데 서버만 보면 그날의 일이 사라진 것처럼 보인다.
     * ⚠ **묶여 있으면 `_작업중` 으로 떨어지지 않는다.** 묶인 파일이 없어졌을 때(지웠거나 폴더를
     *   바꿨을 때) 옛 `_작업중` 을 대신 되살리면 **다른 문서**가 열린다 — 그건 잃은 것보다 나쁘다.
     *   브라우저 칸은 같은 문서의 사본이라 폴백으로 맞다.
     */
    async load() {
      const srv = server();
      if (srv) {
        try {
          const name = readBound() || DRAFT_NAME;
          // 읽으면서 **그 판의 표식**을 받아 둔다 — 다음 쓰기가 그것으로 「내가 읽은 그 판인가」를 묻는다.
          const got = srv.readWithMeta ? await srv.readWithMeta(name) : { data: await srv.read(name), mtimeNs: '' };
          if (got && got.data && typeof got.data === 'object') {
            seenNs = String(got.mtimeNs || '');
            return got.data;
          }
        } catch {
          // 아래 폴백으로 떨어진다
        }
      }
      return browser.load();
    },

    /**
     * 비운다. **묶인 파일은 지우지 않는다** — 그것은 사용자가 이름을 붙인 안무표이고, 지우는 길은
     * 최근 목록의 `삭제`(휴지통) 하나다. 여기서는 묶임을 풀고 이름 없는 칸만 비운다.
     */
    async clear() {
      const srv = server();
      seenNs = '';
      stopped = false;
      this.unbind();
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
