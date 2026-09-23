// src/adapters/projectServer.js — server.py 의 프로젝트 파일 보관 API 클라이언트 (adapters 계층)
//
// 신설 파일이다(2026-09-13). 그전까지 `프로젝트 저장` 은 브라우저 다운로드 폴더로 떨어뜨리는 것이
// 전부였고, **앱은 그 파일이 어디 갔는지 몰랐다.** 그래서 최근 프로젝트 목록이 localStorage 한 칸에
// 안무표 열 개의 내용을 통째로 이고 있었다(용량이 차면 조용히 실패했다 — 버그 기록).
//
// 이제 서버가 있으면 `<root>/<projectsSubdir>/<이름>.json` 에 함께 쓰고, **목록은 그 폴더가 주인**이다.
// localStorage 에는 「마지막에 연 순서」만 남는다.
//
// ⚠ 영상 클립과 **다른 폴더**다. 안무표는 수 KB 이고 영상은 수십 MB 라 한 폴더에 섞으면 목록도
//   백업도 지저분해진다. 같은 root 아래 형제라 한 자리만 백업하면 둘 다 들어간다.
// ⚠ 클립과 달리 **덮어쓴다.** 같은 안무를 여러 번 저장하는 것이 정상이고, 저장할 때마다 " (2)" 가
//   붙으면 목록이 같은 이름으로 가득 찬다. 다만 2026-09-22 부터 서버가 덮어쓰기 전 판을 `.history/` 에
//   남기고 삭제는 `.trash/` 로 옮긴다 — 되돌릴 길이 생겼다(`trash`·`history`·`restore`).
// ⚠ 서버가 없으면(정적 호스팅) 어떤 함수도 던지지 않고 null·빈 배열·false 를 돌려준다 —
//   호출부는 그때 지금까지처럼 다운로드와 localStorage 로 떨어진다. clipServer 와 같은 규약이다.

/** @typedef {{name:string, size:number, mtime:number}} ProjectEntry */
/** 휴지통·이력의 한 항목. `file` 이 실제 파일 이름(`<이름>.<시각>.json`), `name` 이 안무표 이름이다. */
/** @typedef {{file:string, name:string, stamp:string, size:number, mtime:number}} StampedEntry */

function defaultFetch() {
  return typeof fetch === 'function' ? (...a) => fetch(...a) : null;
}

/**
 * @param {{fetchImpl?: typeof fetch|null, base?: string}} [options] 테스트가 가짜 fetch 를 준다
 * @returns {{
 *   save: (name: string, payload: unknown, opts?: {auto?: boolean, ifMtimeNs?: string|number|null})
 *     => Promise<{name:string, size:number, dir:string, mtimeNs:string}|{conflict:true, mtimeNs:string}|null>,
 *   list: () => Promise<ProjectEntry[]>,
 *   read: (name: string) => Promise<any|null>,
 *   readWithMeta: (name: string) => Promise<{data:any, mtimeNs:string}|null>,
 *   remove: (name: string) => Promise<boolean>,
 *   dirOf: () => Promise<string>,
 *   trash: () => Promise<StampedEntry[]>,
 *   history: (name: string) => Promise<StampedEntry[]>,
 *   restore: (file: string, from: 'trash'|'history') => Promise<{name:string}|null>
 * }}
 */
export function createProjectServer(options = {}) {
  const doFetch = options.fetchImpl === undefined ? defaultFetch() : options.fetchImpl;
  const base = (options.base || '').replace(/\/$/, '');

  /** 이름을 쿼리에 안전하게 싣는다. 한글·공백이 그대로 들어가면 요청 줄이 깨진다(실측). */
  const q = (name) => encodeURIComponent(String(name == null ? '' : name));

  /**
   * 던지지 않는 JSON 호출. 서버가 없거나 오류면 null.
   * ⚠ **응답 상태와 헤더까지 보려면 `raw` 를 쓴다.** 이 함수는 오류를 null 로 접으므로
   *   409(다른 곳에서 바뀜)와 「서버 없음」을 구별할 수 없다.
   */
  async function call(method, path, body) {
    const res = await raw(method, path, body);
    return res && res.ok ? res.data : null;
  }

  /**
   * 상태·헤더까지 돌려주는 호출. 던지지 않는다.
   * @returns {Promise<{ok:boolean, status:number, data:any, mtimeNs:string}|null>} 서버가 없으면 null
   */
  async function raw(method, path, body) {
    if (!doFetch) return null;
    try {
      const res = await doFetch(base + path, {
        method,
        body,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        cache: 'no-store'
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      const header = res.headers && res.headers.get ? res.headers.get('X-Choreo-Mtime-Ns') : null;
      return { ok: res.ok, status: res.status, data, mtimeNs: String((data && data.mtimeNs) || header || '') };
    } catch {
      return null;
    }
  }

  /**
   * 파일 하나와 **그 판의 표식**을 함께 읽는다. 표식은 다음 쓰기의 `ifMtimeNs` 가 된다.
   * ⚠ 클로저다(객체 메서드가 아니다) — `read` 가 이것을 부르므로 `this` 에 기대면
   *   `const { read } = projectServer` 로 꺼내 쓰는 순간 조용히 깨진다.
   * @param {string} name
   * @returns {Promise<{data:any, mtimeNs:string}|null>}
   */
  async function readWithMeta(name) {
    const safe = String(name || '').trim();
    if (!safe) return null;
    const res = await raw('GET', `/api/projects/${q(safe)}`);
    if (!res || !res.ok || !res.data) return null;
    return { data: res.data, mtimeNs: res.mtimeNs };
  }

  return {
    readWithMeta,

    /**
     * 안무표 하나를 보관 폴더에 쓴다. **같은 이름은 덮어쓴다.**
     * @param {string} name 확장자 없는 프로젝트 이름
     * @param {unknown} payload buildProjectFile 의 결과
     * @param {{auto?: boolean}} [opts] auto: 앱이 스스로 담은 것(1.2초마다). 서버가 이력을 10분에
     *   한 번만 남긴다 — 사람이 누른 저장과 자동 담기는 「여기라고 표시한 자리」의 뜻이 다르다.
     * @returns {Promise<{name:string, size:number, dir:string}|null>} 서버가 없으면 null
     */
    async save(name, payload, opts = {}) {
      if (!String(name || '').trim()) return null;
      const auto = opts.auto ? '&auto=1' : '';
      // ⚠ **아는 판을 함께 보낸다**(2026-09-22). 지금 파일이 그것과 다르면 서버가 409 로 거절한다 —
      //   두 탭·두 기기가 서로의 작업을 말없이 지우던 것을 막는 유일한 자리다.
      const seen = opts.ifMtimeNs ? `&ifMtimeNs=${encodeURIComponent(String(opts.ifMtimeNs))}` : '';
      const res = await raw('PUT', `/api/projects?name=${q(name)}${auto}${seen}`, JSON.stringify(payload, null, 2));
      if (!res) return null;
      if (res.status === 409) return { conflict: true, mtimeNs: res.mtimeNs };
      const data = res.ok ? res.data : null;
      return data && data.ok
        ? { name: data.name, size: data.size, dir: data.dir, mtimeNs: String(data.mtimeNs || '') }
        : null;
    },

    /**
     * 보관 폴더의 안무표 목록(최근에 고친 것이 앞). **최근 목록의 주인**이다.
     * @returns {Promise<ProjectEntry[]>} 서버가 없으면 빈 배열
     */
    async list() {
      const data = await call('GET', '/api/projects');
      return data && Array.isArray(data.projects) ? data.projects : [];
    },

    /**
     * 보관된 파일 하나를 읽는다.
     * @param {string} name `.json` 이 붙어 있어도 되고 없어도 된다
     * @returns {Promise<any|null>}
     */
    async read(name) {
      const got = await readWithMeta(name);
      return got ? got.data : null;
    },

    /**
     * 보관된 파일 하나를 **휴지통으로 옮긴다**(2026-09-22, 그전에는 영구 삭제였다).
     * 목록의 주인이 폴더라, 목록에서만 지우면 새로고침에 도로 나타나기 때문에 여기까지 간다.
     * @param {string} name
     * @returns {Promise<boolean>} 서버가 없거나 실패하면 false
     */
    async remove(name) {
      if (!String(name || '').trim()) return false;
      const data = await call('DELETE', `/api/projects?name=${q(name)}`);
      return Boolean(data && data.ok);
    },

    /** 휴지통 목록. 최근에 버린 것이 앞. 서버가 없으면 빈 배열. */
    async trash() {
      const data = await call('GET', '/api/projects/.trash');
      return data && Array.isArray(data.items) ? data.items : [];
    },

    /** 한 안무표의 직전 판 목록. 최근이 앞. 서버가 없으면 빈 배열. */
    async history(name) {
      if (!String(name || '').trim()) return [];
      const data = await call('GET', `/api/projects/.history?name=${q(name)}`);
      return data && Array.isArray(data.items) ? data.items : [];
    },

    /**
     * 휴지통·이력의 파일 하나를 제자리로 되살린다. **복구는 무엇도 지우지 않는다** — 그 이름의 파일이
     * 있으면 서버가 먼저 이력에 남긴다.
     * @param {string} file 목록 항목의 `file`
     * @param {'trash'|'history'} from
     * @returns {Promise<{name:string}|null>}
     */
    async restore(file, from) {
      if (!String(file || '').trim()) return null;
      const data = await call('POST', '/api/projects/restore', JSON.stringify({ file, from }));
      return data && data.ok ? { name: data.name } : null;
    },

    /** 지금 보관 폴더의 실제 경로. 설정 화면이 「어디에 쌓이는지」를 보여 줄 때 쓴다. */
    async dirOf() {
      const data = await call('GET', '/api/projects');
      return (data && data.dir) || '';
    }
  };
}
