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
 *   listModels: () => Promise<{models:string[], details:{id:string,label:string,state:string}[], error:string}>,
 *   refine: (text: string, context: object) => Promise<{ok:true, prompt:string}|{ok:false, error:string}>,
 *   compose: (prompt: string, context: object) => Promise<{ok:true, plan:object}|{ok:false, error:string}>,
 *   name: (texts: string[], context: object) => Promise<{ok:true, names:{heard:string,name:string,category:string,isNew:boolean,sure:boolean}[]}|{ok:false, error:string}>
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
    /** 제공자가 가진 모델 이름들. 못 받으면 빈 목록과 이유 문구. */
    async listModels() {
      const r = await call('GET', '/api/llm/models');
      if (!r.ok || !r.data) return { models: [], details: [], error: r.error };
      const models = Array.isArray(r.data.models) ? r.data.models : [];
      const details = Array.isArray(r.data.details) ? r.data.details : models.map(id => ({ id, label: id, state: '' }));
      return { models, details, error: String(r.data.error || '') };
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
    },
    /**
     * 마이크로 들은 거친 말들 → 동작 목록의 정식 이름 (2026-09-22).
     * ⚠ **여럿을 한 번에** 묻는다. 받아 적는 중에는 한 마디마다 왕복할 겨를이 없고, 열 마디를
     *   한 번에 물으면 왕복 한 번 값으로 끝난다.
     */
    async name(texts, context) {
      const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').trim()).filter(Boolean);
      if (!list.length) return { ok: true, names: [] };
      const r = await call('POST', '/api/llm/name', { texts: list, context });
      return r.ok && r.data && Array.isArray(r.data.names)
        ? { ok: true, names: r.data.names }
        : { ok: false, error: r.error || '동작 이름을 맞추지 못했습니다.' };
    }
  };
}
