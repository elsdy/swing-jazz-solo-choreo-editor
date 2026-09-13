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
//   붙으면 목록이 같은 이름으로 가득 찬다.
// ⚠ 서버가 없으면(정적 호스팅) 어떤 함수도 던지지 않고 null·빈 배열·false 를 돌려준다 —
//   호출부는 그때 지금까지처럼 다운로드와 localStorage 로 떨어진다. clipServer 와 같은 규약이다.

/** @typedef {{name:string, size:number, mtime:number}} ProjectEntry */

function defaultFetch() {
  return typeof fetch === 'function' ? (...a) => fetch(...a) : null;
}

/**
 * @param {{fetchImpl?: typeof fetch|null, base?: string}} [options] 테스트가 가짜 fetch 를 준다
 * @returns {{
 *   save: (name: string, payload: unknown) => Promise<{name:string, size:number, dir:string}|null>,
 *   list: () => Promise<ProjectEntry[]>,
 *   read: (name: string) => Promise<any|null>,
 *   dirOf: () => Promise<string>
 * }}
 */
export function createProjectServer(options = {}) {
  const doFetch = options.fetchImpl === undefined ? defaultFetch() : options.fetchImpl;
  const base = (options.base || '').replace(/\/$/, '');

  /** 이름을 쿼리에 안전하게 싣는다. 한글·공백이 그대로 들어가면 요청 줄이 깨진다(실측). */
  const q = (name) => encodeURIComponent(String(name == null ? '' : name));

  /** 던지지 않는 JSON 호출. 서버가 없거나 오류면 null. */
  async function call(method, path, body) {
    if (!doFetch) return null;
    try {
      const res = await doFetch(base + path, {
        method,
        body,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        cache: 'no-store'
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  return {
    /**
     * 안무표 하나를 보관 폴더에 쓴다. **같은 이름은 덮어쓴다.**
     * @param {string} name 확장자 없는 프로젝트 이름
     * @param {unknown} payload buildProjectFile 의 결과
     * @returns {Promise<{name:string, size:number, dir:string}|null>} 서버가 없으면 null
     */
    async save(name, payload) {
      if (!String(name || '').trim()) return null;
      const data = await call('PUT', `/api/projects?name=${q(name)}`, JSON.stringify(payload, null, 2));
      return data && data.ok ? { name: data.name, size: data.size, dir: data.dir } : null;
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
      const safe = String(name || '').trim();
      if (!safe) return null;
      return call('GET', `/api/projects/${q(safe)}`);
    },

    /** 지금 보관 폴더의 실제 경로. 설정 화면이 「어디에 쌓이는지」를 보여 줄 때 쓴다. */
    async dirOf() {
      const data = await call('GET', '/api/projects');
      return (data && data.dir) || '';
    }
  };
}
