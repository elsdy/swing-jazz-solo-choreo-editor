// src/adapters/modelServer.js — server.py 의 자세 분석 모델 API 클라이언트 (adapters 계층)
//
// 신설 파일이다(2026-09-11). 자세 추정에 쓸 모델 파일을 **어디에 받아 둘지**와 **받았는지**를 서버에 묻는다.
// clipServer.js · llmServer.js 와 같은 규약이다 — 던지지 않고, 실패는 null 이나 `{ok:false}` 다.
//
// ⚠ 이 어댑터는 모델을 **쓰지 않는다.** 받아 두고 위치를 아는 것까지가 전부이고, 실제로 관절점을 뽑는
//   추정기는 따로다(ports/pose.js 계약). 나눠 둔 이유는 "어디에 저장할지" 가 설정의 문제이고
//   "어떻게 계산할지" 는 재생·분석의 문제라, 한 파일에 두면 설정 화면이 모델을 로드하게 되기 때문이다.
//
// ⚠ 계산은 브라우저가 한다. 서버는 파일을 받아 두고 `/models/<이름>` 으로 내주기만 하므로,
//   이 기능 때문에 서버에 파이썬 패키지가 하나도 늘지 않는다.

/**
 * @typedef {Object} ModelFile
 * @property {string} key    'wasm' · 'pose-full' 처럼 받을 때 쓰는 이름
 * @property {string} name   보관 폴더 기준 상대 경로
 * @property {string} label  화면에 그대로 쓰는 한국어 이름
 * @property {'runtime'|'model'} group
 * @property {boolean} needed 지금 설정에서 있어야 하는가
 * @property {boolean} optional
 * @property {boolean} present 지금 있는가
 * @property {number} bytes  있으면 실제 크기, 없으면 0
 * @property {number} approx 받기 전에 보여 줄 대략 크기
 * @property {string} url    `/models/...`
 */

/**
 * @typedef {Object} ModelStatus
 * @property {string} dir 보관 폴더(서버의 절대 경로)
 * @property {'lite'|'full'|'heavy'} poseModel
 * @property {boolean} ready 필요한 파일이 전부 있는가
 * @property {number} missing 모자란 개수
 * @property {number} missingBytes 받아야 할 대략 용량
 * @property {string} version 못 박아 둔 MediaPipe 버전
 * @property {Record<string, number>} sizes 모델 크기별 대략 바이트
 * @property {boolean} canChoose 이 컴퓨터에서 폴더 고르기 창을 띄울 수 있는가
 * @property {Array<{label:string, dir:string, note:string}>} suggestions 추천 위치
 * @property {ModelFile[]} files
 */

function defaultFetch() {
  return typeof fetch === 'function' ? (...a) => fetch(...a) : null;
}

/**
 * @param {{fetchImpl?: typeof fetch|null, base?: string}} [options] 테스트가 가짜 fetch 를 준다
 * @returns {{
 *   getStatus: () => Promise<ModelStatus|null>,
 *   setConfig: (next: {dir?: string, poseModel?: string}) => Promise<ModelStatus|null>,
 *   fetchOne: (key: string) => Promise<{ok:true, key:string, bytes:number, cached:boolean}|{ok:false, error:string}>,
 *   chooseDir: () => Promise<{ok:true, status:ModelStatus}|{ok:false, canceled:boolean, error:string}>,
 *   urlFor: (name: string) => string
 * }}
 */
export function createModelServer(options = {}) {
  const doFetch = options.fetchImpl === undefined ? defaultFetch() : options.fetchImpl;
  const base = (options.base || '').replace(/\/$/, '');

  async function json(method, path, body) {
    if (!doFetch) return null;
    try {
      const res = await doFetch(base + path, {
        method, body,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        cache: 'no-store'
      });
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /** 응답이 진짜 상태인가. 서버가 없으면 정적 index.html 이 오므로 모양으로 가린다. */
  const asStatus = (data) => (data && typeof data.dir === 'string' && Array.isArray(data.files) ? data : null);

  return {
    async getStatus() {
      return asStatus(await json('GET', '/api/models'));
    },

    async setConfig(next) {
      return asStatus(await json('PUT', '/api/models/config', JSON.stringify(next || {})));
    },

    /**
     * 파일 하나를 받는다. **한 번에 하나씩**인 이유는 호출부가 진행률을 보여 줄 수 있게 하려는 것이다.
     * ⚠ 이 함수만은 실패 이유를 돌려준다 — 인터넷이 없는 것과 서버가 없는 것은 사용자가 할 일이 다르다.
     *   문구는 서버가 만든 한국어 그대로이고 여기서 새로 만들지 않는다.
     */
    async fetchOne(key) {
      if (!doFetch) return { ok: false, error: '브라우저에서 요청을 보낼 수 없습니다.' };
      try {
        const res = await doFetch(`${base}/api/models/fetch`, {
          method: 'POST', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok === true) {
          return { ok: true, key: data.key, bytes: Number(data.bytes) || 0, cached: !!data.cached };
        }
        return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },

    /**
     * 폴더 고르기 창을 띄운다. 서버가 **사용자 화면**에 네이티브 대화상자를 열고, 고른 폴더를 그 자리에서
     * 보관 위치로 삼는다(고르고 또 `적용` 을 누르게 하지 않는다).
     * ⚠ 사용자가 창을 열어 둔 채 있으면 이 약속은 **몇 분이고 기다린다** — 호출부는 그동안 버튼을 잠근다.
     * ⚠ 취소는 오류가 아니다(`canceled:true`). 창을 못 띄우는 환경은 오류다(문구가 온다).
     */
    async chooseDir() {
      if (!doFetch) return { ok: false, canceled: false, error: '브라우저에서 요청을 보낼 수 없습니다.' };
      try {
        const res = await doFetch(`${base}/api/models/choose`, { method: 'POST', cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok === true) return { ok: true, status: asStatus(data) };
        if (res.ok && data && data.canceled) return { ok: false, canceled: true, error: '' };
        return { ok: false, canceled: false, error: (data && data.error) || `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, canceled: false, error: String(e && e.message ? e.message : e) };
      }
    },

    /** 받아 둔 파일을 브라우저가 읽을 주소. 자세 추정기 어댑터가 이걸로 런타임과 모델을 가리킨다. */
    urlFor(name) {
      return `${base}/models/${String(name || '').split('/').map(encodeURIComponent).join('/')}`;
    }
  };
}
