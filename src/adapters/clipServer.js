// src/adapters/clipServer.js — server.py 의 클립 보관 API 클라이언트 (adapters 계층)
//
// 신설 파일이다. `python3 server.py` 로 띄운 로컬 서버가 있으면 업로드한 영상을 서버가 `<root>/<subdir>/<프로젝트>/<파일>`
// 에 저장하고, 재생은 `/clips/<path>` URL 로 스트리밍한다(Range 지원이라 <video> 탐색이 된다).
//
// ⚠ 서버가 없으면(정적 호스팅·`python3 -m http.server`) `probe()` 가 null 이고, app/main 은 브라우저 폴더 방식
//   (adapters/clipLibrary)으로 떨어진다. 그래서 여기의 어떤 함수도 던지지 않는다 — 실패는 null/false 다.
// ⚠ 경로(`<subdir>/<프로젝트>/<파일>`)의 모양은 브라우저 폴더 방식과 같다(server.py 가 domain/clips.js 와 같은
//   규칙을 쓴다). 프로젝트 파일의 `media.source.path` 가 두 방식 사이에서 그대로 통한다.

/** @typedef {{root:string, subdir:string, dir:string, ffmpeg:boolean, pose:boolean}} ClipServerConfig
 *  ffmpeg: 서버가 자르기를 할 수 있는가 · pose: 자세 분석 모델을 받아 두었는가 */

/** @typedef {{ok:true, path:string, name:string, url:string, durationSec:number}|{ok:false, error:string}} TrimResult */

function defaultFetch() {
  return typeof fetch === 'function' ? (...a) => fetch(...a) : null;
}

/**
 * @param {{fetchImpl?: typeof fetch|null, base?: string}} [options] 테스트가 가짜 fetch 를 준다
 * @returns {{
 *   probe: () => Promise<ClipServerConfig|null>,
 *   trim: (path: string, inSec: number, outSec: number) => Promise<TrimResult>,
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
      return data && data.ok === true && data.mode === 'server'
        ? { root: data.root, subdir: data.subdir, dir: data.dir, ffmpeg: data.ffmpeg === true, pose: data.pose === true }
        : null;
    },

    /**
     * 보관된 클립을 [inSec, outSec) 로 잘라 다시 인코딩한 새 클립을 만든다. 서버가 ffmpeg 을 돌리므로 수십 초가
     * 걸릴 수 있다 — 호출부는 그동안 "잘라내는 중" 을 보여 준다. 원본 파일은 서버에 그대로 남는다.
     * ⚠ 이 함수만은 실패 이유를 돌려준다(`{ok:false, error}`) — ffmpeg 이 없는 것과 인코딩이 실패한 것은 사용자가
     *   할 일이 다르다. 문구는 서버가 만든 그대로고(한국어), 여기서 새 문구를 만들지 않는다.
     * @returns {Promise<TrimResult>}
     */
    async trim(path, inSec, outSec) {
      if (!doFetch) return { ok: false, error: 'no fetch' };
      try {
        const res = await doFetch(`${base}/api/clips/trim`, {
          method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, inSec, outSec })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok === true && typeof data.path === 'string') {
          return { ok: true, path: data.path, name: data.name, url: data.url, durationSec: Number(data.durationSec) || (outSec - inSec) };
        }
        return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
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
