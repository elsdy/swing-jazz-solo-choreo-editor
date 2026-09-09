// src/adapters/llmServer.js — server.py 의 LLM 중계 API 클라이언트 (adapters 계층)
//
// 신설 파일이다. 브라우저는 LLM 을 직접 부르지 않는다 — API 키가 브라우저에 가면 안 되고, 로컬 LLM(ollama)은
// CORS 때문에 브라우저에서 못 부른다. 서버가 세 제공자(anthropic · openai · ollama)를 한 모양으로 감싼다.
//
// ⚠ 어떤 함수도 던지지 않는다. 실패는 {ok:false, error:'…'} 다 — 서버가 없거나(정적 호스팅) 키가 없는 것은
//   정상 경로이고, 뷰가 그 문구를 그대로 보여 준다.

function defaultFetch() {
  return typeof fetch === 'function' ? (...a) => fetch(...a) : null;
}

/** @typedef {{provider:string, model:string, baseUrl:string, hasKey:boolean, keyFromEnv:boolean, available:boolean}} LlmConfig */

/**
 * @param {{fetchImpl?: typeof fetch|null, base?: string}} [options]
 * @returns {{
 *   getConfig: () => Promise<LlmConfig|null>,
 *   setConfig: (next: {provider?:string, model?:string, baseUrl?:string, apiKey?:string}) => Promise<LlmConfig|null>,
 *   refine: (text: string, context: object) => Promise<{ok:true, prompt:string}|{ok:false, error:string}>,
 *   compose: (prompt: string, context: object) => Promise<{ok:true, plan:object}|{ok:false, error:string}>
 * }}
 */
export function createLlmServer(options = {}) {
  const doFetch = options.fetchImpl === undefined ? defaultFetch() : options.fetchImpl;
  const base = (options.base || '').replace(/\/$/, '');

  async function call(method, path, body) {
    if (!doFetch) return { ok: false, status: 0, data: null, error: '이 환경에서는 서버를 부를 수 없습니다.' };
    try {
      const res = await doFetch(base + path, {
        method, cache: 'no-store',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        return { ok: false, status: res.status, data, error: res.status === 404 ? '로컬 서버(server.py)가 없습니다. python3 server.py 로 열어야 이 기능을 쓸 수 있습니다.' : String(msg) };
      }
      return { ok: true, status: res.status, data, error: '' };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: `서버에 연결하지 못했습니다: ${e && e.message ? e.message : e}` };
    }
  }

  return {
    async getConfig() {
      const r = await call('GET', '/api/llm/config');
      return r.ok && r.data && typeof r.data.provider === 'string' ? r.data : null;
    },
    async setConfig(next) {
      const r = await call('PUT', '/api/llm/config', next || {});
      return r.ok && r.data && typeof r.data.provider === 'string' ? r.data : null;
    },
    async refine(text, context) {
      const r = await call('POST', '/api/llm/refine', { text, context });
      return r.ok && r.data && typeof r.data.prompt === 'string' ? { ok: true, prompt: r.data.prompt } : { ok: false, error: r.error || '다듬기에 실패했습니다.' };
    },
    async compose(prompt, context) {
      const r = await call('POST', '/api/llm/compose', { prompt, context });
      return r.ok && r.data && r.data.plan ? { ok: true, plan: r.data.plan } : { ok: false, error: r.error || '안무표 만들기에 실패했습니다.' };
    }
  };
}
