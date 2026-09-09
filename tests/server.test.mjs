// tests/server.test.mjs — server.py 의 클립 API 를 실제로 띄워 검사한다. 의존성 0(node 의 fetch + python3).
//
// 임시 폴더를 보관 루트로 주고 --port 0 으로 띄운 뒤 stdout 의 포트를 읽는다. python3 이 없으면 건너뛴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

/** fetch 는 `%2E%2E` 를 URL 단계에서 접어 버린다. 경로를 **그대로** 보내려면 http.request 를 써야 한다. */
function rawStatus(base, rawPath) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasPython = spawnSync('python3', ['--version']).status === 0;

/** 서버를 띄우고 {base, root, stop} 을 준다. */
async function startServer() {
  // macOS 의 /var 는 /private/var 의 심볼릭 링크다. 서버는 resolve 한 경로를 돌려주므로 여기서도 맞춘다.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'choreo-clips-')));
  const config = path.join(root, 'config.json');
  const child = spawn('python3', ['server.py', '--port', '0', '--root', root, '--config', config, '--quiet'], { cwd: REPO });
  const base = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += String(d);
      const m = /http:\/\/[^/\s]+:(\d+)\//.exec(buf);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.stderr.on('data', (d) => { buf += String(d); });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${buf}`)));
    setTimeout(() => reject(new Error(`server did not start: ${buf}`)), 8000);
  });
  return {
    base, root, config,
    stop() { child.kill(); rmSync(root, { recursive: true, force: true }); }
  };
}

test('server.py: 정적 파일과 health, 설정 읽기·쓰기', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    const health = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.mode, 'server');
    assert.equal(health.subdir, 'video-clip');
    assert.equal(health.dir, path.join(s.root, 'video-clip'));
    assert.ok(existsSync(health.dir), '보관 폴더를 시작할 때 만든다');

    // 정적 파일은 그대로 나온다 — 옛 http.server 와 같다. 모듈은 text/javascript 다.
    const idx = await fetch(`${s.base}/index.html`);
    assert.equal(idx.status, 200);
    const mod = await fetch(`${s.base}/src/domain/clips.js`);
    assert.equal(mod.status, 200);
    assert.match(mod.headers.get('content-type') || '', /javascript/);

    // 설정 변경: 없는 폴더는 만들고 설정 파일에 남는다.
    const newRoot = path.join(s.root, 'elsewhere');
    const put = await fetch(`${s.base}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: newRoot, subdir: 'clips' }) });
    assert.equal(put.status, 200);
    const cfg = await put.json();
    assert.equal(cfg.dir, path.join(newRoot, 'clips'));
    assert.ok(existsSync(cfg.dir));
    assert.ok(existsSync(s.config), '설정 파일이 생긴다');
    const bad = await fetch(`${s.base}/api/config`, { method: 'PUT', body: '{"root": ""}' });
    assert.equal(bad.status, 400);
    const bad2 = await fetch(`${s.base}/api/config`, { method: 'PUT', body: 'not json' });
    assert.equal(bad2.status, 400);
  } finally {
    s.stop();
  }
});

test('server.py: 업로드는 <subdir>/<프로젝트>/<파일> 에 놓이고 겹치면 (2), Range 로 잘라 읽힌다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const q = `?project=${encodeURIComponent('내 안무.json')}&name=${encodeURIComponent('take/1:x.mp4')}`;
    const up = await fetch(`${s.base}/api/clips${q}`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'video/mp4' } });
    assert.equal(up.status, 201);
    const a = await up.json();
    assert.equal(a.path, 'video-clip/내 안무/take_1_x.mp4', '못 쓰는 글자는 _ 로, 확장자 .json 은 뗀다');
    assert.equal(a.url, '/clips/video-clip/내 안무/take_1_x.mp4');
    assert.equal(a.size, 1000);
    assert.ok(existsSync(path.join(s.root, 'video-clip', '내 안무', 'take_1_x.mp4')));

    const b = await (await fetch(`${s.base}/api/clips${q}`, { method: 'PUT', body: bytes })).json();
    assert.equal(b.path, 'video-clip/내 안무/take_1_x (2).mp4', '이미 있는 파일은 덮어쓰지 않는다');
    assert.deepEqual(readdirSync(path.join(s.root, 'video-clip', '내 안무')).sort(), ['take_1_x (2).mp4', 'take_1_x.mp4']);

    const empty = await fetch(`${s.base}/api/clips?project=x&name=y`, { method: 'PUT', body: '' });
    assert.equal(empty.status, 400);

    // 목록·존재 확인.
    const list = await (await fetch(`${s.base}/api/clips?project=${encodeURIComponent('내 안무')}`)).json();
    assert.deepEqual(list.clips.map(c => c.name).sort(), ['take_1_x (2).mp4', 'take_1_x.mp4']);
    assert.equal((await fetch(`${s.base}/api/clips/${encodeURIComponent('video-clip')}/${encodeURIComponent('내 안무')}/${encodeURIComponent('take_1_x.mp4')}`)).status, 200);
    assert.equal((await fetch(`${s.base}/api/clips/video-clip/nope/x.mp4`)).status, 404);

    // 통째로, 그리고 Range 로.
    const full = await fetch(`${s.base}${a.url}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal((await full.arrayBuffer()).byteLength, 1000);
    const part = await fetch(`${s.base}${a.url}`, { headers: { Range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
    assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.slice(10, 20)]);
    const tail = await fetch(`${s.base}${a.url}`, { headers: { Range: 'bytes=990-' } });
    assert.equal(tail.status, 206);
    assert.equal((await tail.arrayBuffer()).byteLength, 10);
    const over = await fetch(`${s.base}${a.url}`, { headers: { Range: 'bytes=5000-' } });
    assert.equal(over.status, 416);

    // 루트 밖으로는 못 나간다. 경로를 그대로 보내야 하므로 fetch 대신 http.request 다.
    assert.equal(await rawStatus(s.base, '/clips/../server.py'), 404);
    assert.equal(await rawStatus(s.base, '/clips/%2E%2E/%2E%2E/etc/passwd'), 404);
    assert.equal(await rawStatus(s.base, '/clips/video-clip/%EB%82%B4%20%EC%95%88%EB%AC%B4/../../../server.py'), 404);
    // 서버 자신의 설정 파일과 숨김 파일은 정적으로도 내주지 않는다.
    assert.equal(await rawStatus(s.base, '/.clipserver.json'), 404);
    assert.equal(await rawStatus(s.base, '/.git/HEAD'), 404);
  } finally {
    s.stop();
  }
});

/** ollama 흉내. /api/chat 을 받아 format 이 있으면 플랜 JSON 을, 없으면 다듬은 평문을 돌려준다. */
function fakeOllama() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => {
      const body = JSON.parse(buf || '{}');
      seen.push({ url: req.url, body });
      const content = body.format
        ? JSON.stringify({ title: '테스트', moves: [
            { bar: 1, count: 1, length: 8, name: 'Charleston', category: 'step', note: '' },
            { bar: 'x', count: 1, length: 1, name: 'bad', category: '', note: '' }
          ], notes: ['임의로 정함'] })
        : '8x1 1카운트부터 8카운트: Charleston';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}

/** LM Studio·llama.cpp 흉내(OpenAI 호환). requireToken 이면 Authorization 없는 요청에 401. */
function fakeOpenAiCompatible() {
  const seen = [];
  const state = { requireToken: false };
  const srv = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization || null, body: buf ? JSON.parse(buf) : null });
      if (state.requireToken && !req.headers.authorization) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'token required' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }));
      else res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '다듬음' } }] }));
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    srv, seen, base: `http://127.0.0.1:${srv.address().port}`,
    get requireToken() { return state.requireToken; }, set requireToken(v) { state.requireToken = v; }
  })));
}

test('server.py: LLM 설정은 키를 돌려주지 않고, 로컬 제공자로 다듬기·스키마 작성이 끝까지 돈다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  const ol = await fakeOllama();
  try {
    const cfg0 = await (await fetch(`${s.base}/api/llm/config`)).json();
    assert.equal(cfg0.provider, 'anthropic');
    assert.equal(cfg0.hasKey, false);
    assert.equal('apiKey' in cfg0, false, '키 값은 절대 나가지 않는다');

    // 키를 넣으면 hasKey 만 참이 되고 값은 여전히 안 나온다. 설정 파일에는 남는다.
    const put = await (await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ apiKey: 'sk-test-123' }) })).json();
    assert.equal(put.hasKey, true);
    assert.equal(put.keyFromEnv, false);
    assert.equal('apiKey' in put, false);
    const { readFileSync } = await import('node:fs');
    assert.match(readFileSync(s.config, 'utf8'), /sk-test-123/);

    // 키 없이 anthropic 을 부르면 502 와 문구.
    await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ apiKey: '' }) });
    const noKey = await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: JSON.stringify({ text: '찰스턴', context: {} }) });
    assert.equal(noKey.status, 502);
    assert.match((await noKey.json()).error, /ANTHROPIC_API_KEY/);

    // 제공자를 로컬(가짜 ollama)로 바꾸면 키 없이 된다. 제공자를 바꾸면 모델·주소는 기본값으로 시작한다.
    const sw = await (await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ provider: 'ollama', baseUrl: ol.base, model: 'fake' }) })).json();
    assert.equal(sw.provider, 'ollama');
    assert.equal(sw.available, true);
    assert.equal(sw.baseUrl, ol.base);
    assert.equal((await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ provider: 'nope' }) })).status, 400);

    const ctx = { cols: 8, rows: 8, moves: ['Charleston', 'Jazz Square'], categories: { step: 'step' } };
    const refined = await (await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: JSON.stringify({ text: '찰스턴 여덟 카운트', context: ctx }) })).json();
    assert.equal(refined.prompt, '8x1 1카운트부터 8카운트: Charleston');
    assert.match(ol.seen[0].body.messages[0].content, /Charleston, Jazz Square/, '동작 목록이 시스템 프롬프트에 들어간다');
    assert.equal(ol.seen[0].body.format, undefined, '다듬기는 평문이다');

    const composed = await (await fetch(`${s.base}/api/llm/compose`, { method: 'POST', body: JSON.stringify({ prompt: refined.prompt, context: ctx }) })).json();
    assert.equal(composed.ok, true);
    assert.equal(ol.seen[1].body.format.type, 'object', '스키마 작성은 format 에 스키마를 준다');
    assert.equal(composed.plan.title, '테스트');
    assert.equal(composed.plan.moves.length, 1, '숫자가 아닌 항목은 서버 검증이 버린다');
    assert.deepEqual(composed.plan.moves[0], { bar: 1, count: 1, length: 8, name: 'Charleston', category: 'step', note: '' });
    assert.equal(composed.plan.notes.length, 2, '버린 이유가 notes 에 남는다');

    // openai 호환 로컬 서버(LM Studio 등)는 키 없이도 available 이고, /v1/models 로 목록을 받는다.
    const lm = await fakeOpenAiCompatible();
    try {
      const oc = await (await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ provider: 'openai', baseUrl: lm.base, model: 'local-model' }) })).json();
      assert.equal(oc.available, true, '로컬 OpenAI 호환 서버는 키 없이 시도한다');
      const models = await (await fetch(`${s.base}/api/llm/models`)).json();
      assert.deepEqual(models.models, ['a-model', 'b-model']);
      const r2 = await (await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: JSON.stringify({ text: '찰스턴', context: ctx }) })).json();
      assert.equal(r2.prompt, '다듬음');
      assert.equal(lm.seen[lm.seen.length - 1].auth, null, '키가 없으면 Authorization 을 보내지 않는다');
      lm.requireToken = true;
      const denied = await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: JSON.stringify({ text: '찰스턴', context: ctx }) });
      assert.equal(denied.status, 502);
      assert.match((await denied.json()).error, /토큰/);
      await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ apiKey: 'lm-token' }) });
      const ok2 = await (await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: JSON.stringify({ text: '찰스턴', context: ctx }) })).json();
      assert.equal(ok2.prompt, '다듬음');
      assert.equal(lm.seen[lm.seen.length - 1].auth, 'Bearer lm-token');
    } finally {
      lm.srv.close();
    }

    assert.equal((await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: '{"text":""}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/llm/compose`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/nope`, { method: 'POST', body: '{}' })).status, 404);
  } finally {
    ol.srv.close();
    s.stop();
  }
});
