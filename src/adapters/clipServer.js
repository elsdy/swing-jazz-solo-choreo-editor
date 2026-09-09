// src/adapters/clipServer.js — server.py 의 클립 보관 API 클라이언트 (adapters 계층)
//
// 신설 파일이다. `python3 server.py` 로 띄운 로컬 서버가 있으면 업로드한 영상을 서버가 `<root>/<subdir>/<프로젝트>/<파일>`
// 에 저장하고, 재생은 `/clips/<path>` URL 로 스트리밍한다(Range 지원이라 <video> 탐색이 된다).
//
// ⚠ 서버가 없으면(정적 호스팅·`python3 -m http.server`) `probe()` 가 null 이고, app/main 은 브라우저 폴더 방식
//   (adapters/clipLibrary)으로 떨어진다. 그래서 여기의 어떤 함수도 던지지 않는다 — 실패는 null/false 다.
// ⚠ 경로(`<subdir>/<프로젝트>/<파일>`)의 모양은 브라우저 폴더 방식과 같다(server.py 가 domain/clips.js 와 같은
//   규칙을 쓴다). 프로젝트 파일의 `media.source.path` 가 두 방식 사이에서 그대로 통한다.

/** @typedef {{root:string, subdir:string, dir:string}} ClipServerConfig */

function defaultFetch() {
  return typeof fetch === 'function' ? (...a) => fetch(...a) : null;
}

/**
 * @param {{fetchImpl?: typeof fetch|null, base?: string}} [options] 테스트가 가짜 fetch 를 준다
 * @returns {{
 *   probe: () => Promise<ClipServerConfig|null>,
 *   getConfig: () => Promise<ClipServerConfig|null>,
 *   setConfig: (next: {root?: string, subdir?: string}) => Promise<ClipServerConfig|null>,
 *   upload: (file: Blob & {name?: string}, projectName: string, fileName?: string) => Promise<{path:string, url:string}|null>,
 *   exists: (path: string) => Promise<boolean>,
 *   urlFor: (path: string) => string,
 *   list: (projectName: string) => Promise<{path:string, name:string, size:number}[]>
 * }}
 */
export function createClipServer(options = {}) {
  const doFetch = options.fetchImpl === undefined ? defaultFetch() : options.fetchImpl;
  const base = (options.base || '').replace(/\/$/, '');

  async function json(method, path, body, headers = {}) {
    if (!doFetch) return null;
    try {
      const res = await doFetch(base + path, { method, body, headers, cache: 'no-store' });
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const encodePath = (path) => String(path || '').split('/').map(encodeURIComponent).join('/');

  return {
    /** 서버가 있고 클립 API 를 아는가. 정적 서버는 /api/health 에 404 나 index.html 을 준다 → null. */
    async probe() {
      const data = await json('GET', '/api/health');
      return data && data.ok === true && data.mode === 'server' ? { root: data.root, subdir: data.subdir, dir: data.dir } : null;
    },

    async getConfig() {
      const data = await json('GET', '/api/config');
      return data && typeof data.root === 'string' ? data : null;
    },

    async setConfig(next) {
      const data = await json('PUT', '/api/config', JSON.stringify(next || {}), { 'Content-Type': 'application/json' });
      return data && typeof data.root === 'string' ? data : null;
    },

    /**
     * 파일을 올린다. 본문이 파일 바이트 그대로라 multipart 가 필요 없다.
     * @returns {Promise<{path:string, url:string}|null>}
     */
    async upload(file, projectName, fileName) {
      const name = fileName || (file && file.name) || 'clip';
      const q = `?project=${encodeURIComponent(projectName || '')}&name=${encodeURIComponent(name)}`;
      const data = await json('PUT', `/api/clips${q}`, file, { 'Content-Type': (file && file.type) || 'application/octet-stream' });
      return data && data.ok === true && typeof data.path === 'string' ? { path: data.path, url: data.url } : null;
    },

    async exists(path) {
      const data = await json('GET', `/api/clips/${encodePath(path)}`);
      return !!(data && data.ok === true);
    },

    /** 재생용 URL. 프로젝트 파일에는 path 만 저장되고 URL 은 여기서만 만든다. */
    urlFor(path) {
      return `${base}/clips/${encodePath(path)}`;
    },

    async list(projectName) {
      const data = await json('GET', `/api/clips?project=${encodeURIComponent(projectName || '')}`);
      return data && Array.isArray(data.clips) ? data.clips : [];
    }
  };
}
