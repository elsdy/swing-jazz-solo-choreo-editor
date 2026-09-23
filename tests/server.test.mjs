// tests/server.test.mjs — server.py 의 클립 API 를 실제로 띄워 검사한다. 의존성 0(node 의 fetch + python3).
//
// 임시 폴더를 보관 루트로 주고 --port 0 으로 띄운 뒤 stdout 의 포트를 읽는다. python3 이 없으면 건너뛴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
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

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** 서버를 띄우고 {base, root, stop} 을 준다. extraArgs 로 --ffmpeg 같은 인자를 더한다. */
async function startServer(extraArgs = []) {
  // macOS 의 /var 는 /private/var 의 심볼릭 링크다. 서버는 resolve 한 경로를 돌려주므로 여기서도 맞춘다.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'choreo-clips-')));
  const config = path.join(root, 'config.json');
  // ⚠ `--models` 를 반드시 준다. 안 주면 저장소의 `models/` 로 떨어져서, 개발자가 실제로 모델을 받아 둔
  //   기계에서는 "아직 아무것도 없다" 를 전제한 검사가 깨진다(2026-09-12 에 실제로 그랬다).
  const child = spawn('python3', ['server.py', '--port', '0', '--root', root, '--config', config,
    '--models', path.join(root, 'models'), '--quiet', ...extraArgs], { cwd: REPO });
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
      if (req.url === '/api/tags') {           // 판별용: Ollama 는 여기서 모델 목록을 준다
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'fake' }] }));
        return;
      }
      const body = JSON.parse(buf || '{}');
      seen.push({ url: req.url, body });
      // 스키마가 붙어 오면 그 스키마에 맞는 답을 낸다. 이름 맞추기(NAME_SCHEMA)와 안무표
      // 만들기(PLAN_SCHEMA)를 `properties.names` 로 가른다.
      const wantsNames = body.format && body.format.properties && body.format.properties.names;
      const content = wantsNames
        ? JSON.stringify({ names: [
            { heard: '킥볼체인지', name: 'Kick Ball Change', category: 'step', isNew: false, sure: true },
            { heard: '뭔지모를말', name: '뭔지모를말', category: '', isNew: true, sure: false }
          ] })
        : body.format
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
      // 제공자를 '로컬(Ollama)' 로 골랐어도 주소가 OpenAI 호환이면 서버가 알아낸다. 없는 모델 이름은 목록의 첫 것으로.
      await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ provider: 'ollama', baseUrl: lm.base, model: 'llama3.1', apiKey: 'lm-token' }) });
      const ok3 = await (await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: JSON.stringify({ text: '찰스턴', context: ctx }) })).json();
      assert.equal(ok3.prompt, '다듬음');
      const last = lm.seen[lm.seen.length - 1];
      assert.equal(last.url, '/v1/chat/completions', 'Ollama 가 아니라 OpenAI 호환 경로로 갔다');
      assert.equal(last.body.model, 'a-model', '설정의 llama3.1 은 그 서버에 없어 목록의 첫 모델을 썼다');
      const lst = await (await fetch(`${s.base}/api/llm/models`)).json();
      assert.deepEqual(lst.models, ['a-model', 'b-model']);
    } finally {
      lm.srv.close();
    }

    assert.equal((await fetch(`${s.base}/api/llm/refine`, { method: 'POST', body: '{"text":""}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/llm/compose`, { method: 'POST', body: '{}' })).status, 400);

    // ── 말로 들은 것 → 동작 이름 (2026-09-22) ──
    await fetch(`${s.base}/api/llm/config`, { method: 'PUT', body: JSON.stringify({ provider: 'ollama', baseUrl: ol.base, model: 'fake' }) });
    const named = await (await fetch(`${s.base}/api/llm/name`, {
      method: 'POST',
      body: JSON.stringify({ texts: ['킥볼체인지', '뭔지모를말'], context: ctx })
    })).json();
    assert.equal(named.ok, true);
    assert.equal(named.names.length, 2, '들어온 개수만큼 나온다');
    assert.equal(named.names[0].name, 'Kick Ball Change', '한글로 적힌 영어가 원어로 돌아온다');
    assert.equal(named.names[1].sure, false, '모르겠다고 한 것은 그대로 전해진다');

    // ⚠ 답이 빠진 줄은 **버리지 않고 들은 말 그대로**로 채운다. 한 줄이 비면 그 블록만 이름이
    //   사라져서, 사용자는 무엇이 빠졌는지 알 수 없다.
    const partial = await (await fetch(`${s.base}/api/llm/name`, {
      method: 'POST',
      body: JSON.stringify({ texts: ['킥볼체인지', '답이없는말'], context: ctx })
    })).json();
    assert.equal(partial.names.length, 2);
    assert.equal(partial.names[1].name, '답이없는말');
    assert.equal(partial.names[1].sure, false);

    assert.equal((await fetch(`${s.base}/api/llm/name`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/llm/name`, { method: 'POST', body: '{"texts":[]}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/llm/name`, { method: 'POST', body: '{"texts":["  "]}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/nope`, { method: 'POST', body: '{}' })).status, 404);
  } finally {
    ol.srv.close();
    s.stop();
  }
});

test('server.py: 자르기는 ffmpeg 이 없으면 501 이고 health 가 그 사실을 알린다, 인자 검증은 그 전에 한다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer(['--ffmpeg', '/nonexistent/ffmpeg']);
  try {
    const health = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(health.ffmpeg, false, '--ffmpeg 가 틀리면 PATH 로 슬쩍 떨어지지 않는다');
    const up = await (await fetch(`${s.base}/api/clips?project=p&name=a.mp4`, { method: 'PUT', body: new Uint8Array(10) })).json();
    const post = (body) => fetch(`${s.base}/api/clips/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ path: up.path, inSec: 'x', outSec: 2 })).status, 400);
    assert.equal((await post({ path: up.path, inSec: 2, outSec: 1 })).status, 400);
    assert.equal((await post({ path: up.path, inSec: 1, outSec: 1.05 })).status, 400, '0.1초보다 짧은 구간');
    assert.equal((await post({ path: 'video-clip/p/nope.mp4', inSec: 0, outSec: 1 })).status, 404);
    assert.equal((await post({ path: '../server.py', inSec: 0, outSec: 1 })).status, 404, '루트 밖');
    const res = await post({ path: up.path, inSec: 0, outSec: 1 });
    assert.equal(res.status, 501);
    assert.match((await res.json()).error, /ffmpeg/);
    assert.equal((await fetch(`${s.base}/api/clips/trim`, { method: 'POST', body: 'nope' })).status, 400);
  } finally {
    s.stop();
  }
});

test('server.py: ffmpeg 이 있으면 In~Out 을 다시 인코딩한 MP4 가 같은 폴더에 생기고 원본은 남는다', { skip: (!hasPython && 'python3 없음') || (!hasFfmpeg && 'ffmpeg 없음') }, async () => {
  const s = await startServer();
  try {
    assert.equal((await (await fetch(`${s.base}/api/health`)).json()).ffmpeg, true);
    // 3초짜리 테스트 영상(소리 없음)을 ffmpeg 으로 만들어 올린다.
    const gen = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=64x64:rate=10',
      '-pix_fmt', 'yuv420p', path.join(s.root, 'src.mp4')]);
    assert.equal(gen.status, 0, String(gen.stderr));
    const bytes = readFileSync(path.join(s.root, 'src.mp4'));
    const up = await (await fetch(`${s.base}/api/clips?project=p&name=take.mp4`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'video/mp4' } })).json();
    const res = await fetch(`${s.base}/api/clips/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: up.path, inSec: 0.5, outSec: 2 }) });
    const cut = await res.json();
    assert.equal(res.status, 201, JSON.stringify(cut));
    assert.equal(cut.name, 'take [0m00.5s-0m02.0s].mp4');
    assert.equal(cut.path, 'video-clip/p/take [0m00.5s-0m02.0s].mp4');
    assert.equal(cut.url, '/clips/' + cut.path);
    assert.equal(cut.durationSec, 1.5);
    assert.ok(cut.size > 0);
    assert.deepEqual(readdirSync(path.join(s.root, 'video-clip', 'p')).sort(), ['take [0m00.5s-0m02.0s].mp4', 'take.mp4'], '원본은 그대로');
    // 길이가 실제로 1.5초 안팎이다(ffprobe 가 있으면 확인한다).
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(s.root, cut.path)]);
    if (probe.status === 0) {
      const dur = Number(String(probe.stdout).trim());
      assert.ok(Math.abs(dur - 1.5) < 0.25, `길이 ${dur}`);
    }
    // 잘라 낸 파일도 Range 로 스트리밍된다.
    const part = await fetch(`${s.base}${cut.url}`, { headers: { Range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    // 같은 구간을 다시 자르면 덮어쓰지 않고 (2) 다.
    const again = await (await fetch(`${s.base}/api/clips/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: up.path, inSec: 0.5, outSec: 2 }) })).json();
    assert.equal(again.name, 'take [0m00.5s-0m02.0s] (2).mp4');
  } finally {
    s.stop();
  }
});

test('server.py: 자세 분석 모델의 보관 위치를 설정으로 바꾸고 상태를 알려 준다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    // 기본은 아무것도 안 받아 둔 상태다. 기능이 꺼져 있을 뿐 오류가 아니다.
    const health = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(health.pose, false);
    const st0 = await (await fetch(`${s.base}/api/models`)).json();
    assert.equal(st0.dir, path.join(s.root, 'models'), '검사는 임시 폴더만 본다 — 개발자 기계의 설치 상태에 기대지 않는다');
    assert.equal(st0.ready, false);
    assert.equal(st0.poseModel, 'full');
    assert.ok(st0.missingBytes > 15 * 1024 * 1024, '받아야 할 용량을 미리 알려 준다');
    assert.equal(st0.files.filter(f => f.needed).length, 4, '런타임 3 + 고른 크기의 자세 모델 1');
    assert.equal(st0.files.every(f => !f.present), true);

    // 보관 위치 바꾸기 — 없는 폴더는 만든다.
    const dir = path.join(s.root, '어디에든', 'models');
    const st1 = await (await fetch(`${s.base}/api/models/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir })
    })).json();
    assert.equal(st1.dir, dir);
    assert.ok(existsSync(dir), '없는 폴더를 만든다');
    // 서버를 다시 켜도 유지되도록 설정 파일에 남는다.
    assert.equal(JSON.parse(readFileSync(s.config, 'utf8')).modelsDir, dir);

    // 모델 크기를 바꾸면 필요한 파일이 달라진다.
    const st2 = await (await fetch(`${s.base}/api/models/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ poseModel: 'lite' })
    })).json();
    assert.equal(st2.poseModel, 'lite');
    assert.deepEqual(st2.files.filter(f => f.needed && f.group === 'model').map(f => f.name), ['pose_landmarker_lite.task']);
    assert.ok(st2.missingBytes < st0.missingBytes, 'lite 는 full 보다 적게 받는다');

    // 잘못된 입력은 400 이고 설정은 그대로다.
    for (const body of ['{"poseModel":"nope"}', '{"dir":"   "}', 'not json']) {
      assert.equal((await fetch(`${s.base}/api/models/config`, { method: 'PUT', body })).status, 400, body);
    }
    assert.equal((await (await fetch(`${s.base}/api/models`)).json()).poseModel, 'lite');

    // 파일을 손으로 놓아 두면 있음으로 보이고 내줄 수 있다. 받기는 이미 있으면 다시 받지 않는다.
    const target = path.join(dir, 'pose_landmarker_lite.task');
    writeFileSync(target, Buffer.alloc(1234, 7));
    const st3 = await (await fetch(`${s.base}/api/models`)).json();
    const one = st3.files.find(f => f.name === 'pose_landmarker_lite.task');
    assert.equal(one.present, true);
    assert.equal(one.bytes, 1234);
    const got = await fetch(`${s.base}/models/pose_landmarker_lite.task`);
    assert.equal(got.status, 200);
    assert.equal((await got.arrayBuffer()).byteLength, 1234);
    const again = await (await fetch(`${s.base}/api/models/fetch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'pose-lite' })
    })).json();
    assert.equal(again.cached, true, '이미 있는 파일은 인터넷을 다시 건드리지 않는다');
    assert.equal(again.bytes, 1234);

    // 모르는 키와 잘못된 본문.
    assert.equal((await fetch(`${s.base}/api/models/fetch`, { method: 'POST', body: '{"key":"nope"}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/models/fetch`, { method: 'POST', body: 'x' })).status, 400);

    // 보관 폴더 밖으로는 못 나간다.
    assert.equal(await rawStatus(s.base, '/models/../server.py'), 404);
    assert.equal(await rawStatus(s.base, '/models/%2E%2E/%2E%2E/etc/passwd'), 404);
    assert.equal(await rawStatus(s.base, '/models/nope.task'), 404);

    // 폴더 고르기: 쓸 수 있는지와 추천 위치를 알려 준다.
    // ⚠ `/api/models/choose` 는 **실제 대화상자를 띄우므로** 테스트에서 부르지 않는다 — 사람이 고를 때까지
    //   끝나지 않아 테스트가 멈춘다. 창을 띄우는 부분은 손으로 확인하고, 여기서는 그 주변만 본다.
    const st4 = await (await fetch(`${s.base}/api/models`)).json();
    assert.equal(typeof st4.canChoose, 'boolean');
    assert.ok(Array.isArray(st4.suggestions) && st4.suggestions.length >= 2, '추천 위치가 있어야 한다');
    for (const item of st4.suggestions) {
      assert.equal(typeof item.label, 'string');
      assert.ok(path.isAbsolute(item.dir), `추천 경로가 절대 경로가 아니다: ${item.dir}`);
      assert.equal(typeof item.note, 'string');
    }
    assert.ok(st4.suggestions.some(x => x.dir.endsWith(`${path.sep}models`)), '저장소 안 위치가 추천에 있어야 한다');

    // 런타임과 모델이 다 있으면 준비됨이 되고 health 도 그렇게 말한다.
    for (const name of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm']) {
      const p = path.join(dir, name);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, 'x');
    }
    assert.equal((await (await fetch(`${s.base}/api/models`)).json()).ready, true);
    assert.equal((await (await fetch(`${s.base}/api/health`)).json()).pose, true);
  } finally {
    s.stop();
  }
});

test('server.py: 안무표는 projects 폴더에 덮어쓰기로 쌓이고, 지우면 파일까지 없어진다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    const put = (name, body) => fetch(`${s.base}/api/projects?name=${encodeURIComponent(name)}`,
      { method: 'PUT', body: JSON.stringify(body) });

    // 한글·공백 이름이 그대로 파일 이름이 된다(확장자는 서버가 붙인다).
    let res = await put('9월 공연 안무', { version: 1, fileName: '9월 공연 안무' });
    assert.equal(res.status, 201);
    const saved = await res.json();
    assert.equal(saved.name, '9월 공연 안무.json');
    assert.equal(saved.dir, path.join(s.root, 'projects'));
    assert.ok(existsSync(path.join(s.root, 'projects', '9월 공연 안무.json')));

    // ⚠ 클립과 반대로 **덮어쓴다** — 같은 안무를 여러 번 저장하는 것이 정상이라, ' (2)' 가 붙으면
    //   목록이 같은 이름으로 가득 찬다.
    res = await put('9월 공연 안무', { version: 2, fileName: '9월 공연 안무' });
    assert.equal(res.status, 201);
    // 2026-09-22 부터 .history 점 폴더가 옆에 생긴다 — 목록에 보이는 것은 여전히 하나다.
    assert.deepEqual(readdirSync(path.join(s.root, 'projects')).filter((n) => !n.startsWith('.')), ['9월 공연 안무.json']);
    const back = await (await fetch(`${s.base}/api/projects/${encodeURIComponent('9월 공연 안무')}`)).json();
    assert.equal(back.version, 2, '덮어쓰지 않고 옛 내용이 남았다');

    // JSON 이 아닌 본문은 받아 두지 않는다 — 받아 두면 다음에 여는 쪽에서 터진다.
    res = await fetch(`${s.base}/api/projects?name=깨진것`, { method: 'PUT', body: '{not json' });
    assert.equal(res.status, 400);
    assert.ok(!existsSync(path.join(s.root, 'projects', '깨진것.json')));

    // 폴더 밖으로 나가려는 이름은 한 조각으로 접힌다(safe_segment).
    res = await put('../탈출', { version: 1 });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).name, '_탈출.json', '구분자가 접히지 않았다');
    assert.ok(!existsSync(path.join(s.root, '탈출.json')), '보관 폴더 밖에 파일이 생겼다');

    // 목록은 최근에 고친 것이 앞이고, 이것이 앱의 최근 프로젝트 목록의 주인이다.
    await put('3월 워크샵', { version: 1 });
    const list = await (await fetch(`${s.base}/api/projects`)).json();
    assert.equal(list.projects[0].name, '3월 워크샵.json');
    assert.equal(list.projects.length, 3);

    // 삭제는 목록이 아니라 **파일**을 지운다 — 목록의 주인이 폴더라 파일이 남으면 도로 나타난다.
    res = await fetch(`${s.base}/api/projects?name=${encodeURIComponent('3월 워크샵')}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.ok(!existsSync(path.join(s.root, 'projects', '3월 워크샵.json')));
    const after = await (await fetch(`${s.base}/api/projects`)).json();
    assert.deepEqual(after.projects.map(p => p.name).sort(), ['9월 공연 안무.json', '_탈출.json']);

    // 두 번 눌러도 성공이다(멱등) — 두 번째만 빨개지는 것을 막는다.
    res = await fetch(`${s.base}/api/projects?name=${encodeURIComponent('3월 워크샵')}`, { method: 'DELETE' });
    assert.equal(res.status, 200);

    // 없는 것을 읽으면 404, 이름이 없으면 400.
    assert.equal((await fetch(`${s.base}/api/projects/없는것`)).status, 404);
    assert.equal((await fetch(`${s.base}/api/projects?name=`, { method: 'DELETE' })).status, 400);
  } finally { s.stop(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 안무표 파일의 안전망 (2026-09-22) — 로드맵 「기둥 D」 첫 항목
//
// 그전에는 같은 이름을 제자리에서 덮어쓰고(write_bytes) 삭제는 unlink 였다. 실측으로 이름 붙은
// 안무가 저장본 없이 작업 문서 한 칸에만 살아 있던 날, 결정을 기다리지 않고 먼저 넣기로 했다.
// 지키는 것 넷 — 반쪽 파일이 서지 않는다 · 덮어쓰기 전 판이 남는다 · 삭제는 휴지통이다 ·
// 복구는 무엇도 지우지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

test('server.py: 덮어쓰기 전 판이 .history 에 남고, 삭제는 휴지통이며, 복구는 아무것도 지우지 않는다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    const dir = path.join(s.root, 'projects');
    const put = (name, body) => fetch(`${s.base}/api/projects?name=${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) });
    const names = (folder) => (existsSync(folder) ? readdirSync(folder).filter((n) => n.endsWith('.json')).sort() : []);

    // ① 첫 저장에는 직전 판이 없다.
    let r = await (await put('공연', { version: 1, tag: 'a' })).json();
    assert.equal(r.history, null, '처음 쓰는 파일에는 남길 직전 판이 없다');
    assert.deepEqual(names(dir), ['공연.json']);
    assert.ok(!readdirSync(dir).some((n) => n.includes('.tmp-')), '임시 파일이 남았다 — os.replace 뒤에 지워져야 한다');

    // ② 덮어쓰면 옛 내용이 .history/공연.<시각>.json 으로 남고, 본체는 새 내용이다.
    r = await (await put('공연', { version: 1, tag: 'b' })).json();
    assert.ok(r.history && r.history.startsWith('공연.') && r.history.endsWith('.json'), `이력 파일 이름이 꼴에 안 맞다: ${r.history}`);
    const hist = path.join(dir, '.history');
    assert.deepEqual(names(hist), [r.history]);
    assert.equal(JSON.parse(readFileSync(path.join(hist, r.history), 'utf8')).tag, 'a', '이력에는 **덮어쓰기 전** 내용이 있어야 한다');
    assert.equal((await (await fetch(`${s.base}/api/projects/공연`)).json()).tag, 'b');

    // ③ 이력 목록 API — 최근이 앞. 점으로 시작하는 경로라 어떤 안무표 이름과도 겹치지 않는다.
    await put('공연', { version: 1, tag: 'c' });
    const hl = await (await fetch(`${s.base}/api/projects/.history?name=공연`)).json();
    assert.equal(hl.ok, true);
    assert.equal(hl.items.length, 2);
    assert.ok(hl.items.every((it) => it.name === '공연' && /^\d{8}-\d{6}(-\d+)?$/.test(it.stamp)), JSON.stringify(hl.items));
    assert.equal(hl.items[0].mtime >= hl.items[1].mtime, true, '최근이 앞이어야 한다');
    // ⚠ 목록(GET /api/projects)에는 점 폴더가 안 보인다.
    const list = await (await fetch(`${s.base}/api/projects`)).json();
    assert.deepEqual(list.projects.map((p) => p.name), ['공연.json']);

    // ④ 작업 문서(`_` 로 시작)는 1.2초마다 덮어쓰므로 저장마다 남기면 초당 한 장이다 — 10분에 한 번만.
    await put('_작업중', { version: 1, n: 1 });
    const d1 = await (await put('_작업중', { version: 1, n: 2 })).json();
    assert.ok(d1.history, '첫 덮어쓰기는 남긴다');
    const d2 = await (await put('_작업중', { version: 1, n: 3 })).json();
    assert.equal(d2.history, null, '10분 안의 두 번째 덮어쓰기는 남기지 않는다');
    assert.equal(names(hist).filter((n) => n.startsWith('_작업중.')).length, 1);

    // ④-2 **이름 붙은 파일도 자동 담기(auto=1)면 같은 규칙이다**(2026-09-22). 묶인 파일에 1.2초마다
    //     들어오므로, 사람이 누른 저장과 같게 남기면 이력 20장이 24초에 다 찬다.
    await fetch(`${s.base}/api/projects?name=${encodeURIComponent('묶인것')}&auto=1`, { method: 'PUT', body: '{"version":1,"n":1}' });
    const a1 = await (await fetch(`${s.base}/api/projects?name=${encodeURIComponent('묶인것')}&auto=1`, { method: 'PUT', body: '{"version":1,"n":2}' })).json();
    assert.ok(a1.history, '첫 덮어쓰기는 남긴다');
    const a2 = await (await fetch(`${s.base}/api/projects?name=${encodeURIComponent('묶인것')}&auto=1`, { method: 'PUT', body: '{"version":1,"n":3}' })).json();
    assert.equal(a2.history, null, '10분 안의 자동 담기는 남기지 않는다');
    // 반면 **사람이 누른 저장**(auto 없음)은 매번 남긴다 — 그것이 「여기」라고 표시한 자리다.
    const m1 = await (await put('묶인것', { version: 1, n: 4 })).json();
    assert.ok(m1.history, '사람이 누른 저장은 바로 앞이 자동 담기였어도 남긴다');
    assert.equal(names(hist).filter((n) => n.startsWith('묶인것.')).length, 2);

    // ⑤ 삭제는 파일을 .trash/ 로 옮긴다. 목록에서는 사라지고, 휴지통 목록에는 보인다.
    const del = await (await fetch(`${s.base}/api/projects?name=공연`, { method: 'DELETE' })).json();
    assert.ok(del.trashed && del.trashed.startsWith('공연.'), `휴지통 파일 이름: ${del.trashed}`);
    assert.ok(!existsSync(path.join(dir, '공연.json')), '본체가 남아 있으면 목록에 도로 나타난다');
    const trash = path.join(dir, '.trash');
    assert.deepEqual(names(trash), [del.trashed]);
    const tl = await (await fetch(`${s.base}/api/projects/.trash`)).json();
    assert.equal(tl.items.length, 1);
    assert.equal(tl.items[0].name, '공연');
    assert.equal(tl.items[0].file, del.trashed);
    // 없는 것을 지워도 성공(멱등)이고 휴지통에 아무것도 더해지지 않는다.
    const del2 = await (await fetch(`${s.base}/api/projects?name=공연`, { method: 'DELETE' })).json();
    assert.equal(del2.ok, true);
    assert.equal(del2.trashed, null);
    assert.deepEqual(names(trash), [del.trashed]);

    // ⑥ 휴지통에서 복구 — 파일이 제자리로 **옮겨** 오고 휴지통은 빈다.
    let rs = await (await fetch(`${s.base}/api/projects/restore`, { method: 'POST', body: JSON.stringify({ from: 'trash', file: del.trashed }) })).json();
    assert.equal(rs.ok, true);
    assert.equal(rs.name, '공연.json');
    assert.equal((await (await fetch(`${s.base}/api/projects/공연`)).json()).tag, 'c');
    assert.deepEqual(names(trash), []);

    // ⑦ 이력에서 복구 — 이력은 **복사**라 그대로 남고, 덮이는 지금 파일은 먼저 이력에 남는다(복구가 무엇도 지우지 않는다).
    const before = names(hist).length;
    const oldest = hl.items[hl.items.length - 1];
    rs = await (await fetch(`${s.base}/api/projects/restore`, { method: 'POST', body: JSON.stringify({ from: 'history', file: oldest.file }) })).json();
    assert.equal(rs.ok, true);
    assert.equal((await (await fetch(`${s.base}/api/projects/공연`)).json()).tag, 'a', '가장 오래된 판(a)으로 돌아와야 한다');
    assert.equal(names(hist).length, before + 1, '덮인 판(c)이 이력에 하나 더 남아야 한다');
    assert.ok(existsSync(path.join(hist, oldest.file)), '이력 원본은 그대로 남는다');

    // ⑦-2 **더 새 것을 덮지 않는다**(2026-09-22). 읽을 때 받은 표식을 쓸 때 되돌려주고, 그 사이에
    //     다른 곳에서 바뀌었으면 409 로 거절한다 — 두 탭·두 기기가 서로를 말없이 지우던 자리다.
    const head = await fetch(`${s.base}/api/projects/${encodeURIComponent('공연')}`);
    const ns = head.headers.get('X-Choreo-Mtime-Ns');
    assert.ok(ns && /^\d+$/.test(ns), `읽기 응답에 판의 표식이 없다: ${ns}`);
    // 같은 표식이면 쓴다.
    const okWrite = await fetch(`${s.base}/api/projects?name=${encodeURIComponent('공연')}&ifMtimeNs=${ns}`, { method: 'PUT', body: '{"version":1,"tag":"mine"}' });
    assert.equal(okWrite.status, 201);
    const ns2 = (await okWrite.json()).mtimeNs;
    assert.ok(ns2 && String(ns2) !== ns, '쓰고 나면 표식이 새로워져야 한다');
    // ⚠⚠ **표식은 문자열이어야 한다.** 나노초는 1.79e18 이라 JS 의 안전 정수(9.0e15)를 넘는다 —
    //   숫자로 보내면 `JSON.parse` 가 끝자리를 깎고, 그 값을 되돌려받은 서버가 「다르다」고 답해
    //   **혼자서도 충돌한다**(브라우저에서 실측으로 그랬고, 담기가 통째로 멈췄다).
    //   아래 왕복 한 줄이 그것을 잡는 자리다 — 위의 `!==` 만으로는 둘 다 같은 만큼 깎여서 안 걸린다.
    assert.equal(typeof ns2, 'string', `표식이 숫자로 왔다(끝자리가 깎인다): ${ns2}`);
    const again = await fetch(`${s.base}/api/projects?name=${encodeURIComponent('공연')}&ifMtimeNs=${ns2}`, { method: 'PUT', body: '{"version":1,"tag":"round-trip"}' });
    assert.equal(again.status, 201, '방금 받은 표식으로 다시 쓰지 못했다 — 자기 자신과 충돌한다');
    // 헤더와 본문이 같은 글자여야 한다(읽기는 헤더로, 쓰기는 본문으로 표식을 준다).
    const both = await fetch(`${s.base}/api/projects/${encodeURIComponent('공연')}`);
    assert.equal(both.headers.get('X-Choreo-Mtime-Ns'), String((await again.json()).mtimeNs));
    // 옛 표식으로 쓰면 거절하고 지금 표식을 알려 준다. **파일은 그대로다.**
    const stale = await fetch(`${s.base}/api/projects?name=${encodeURIComponent('공연')}&ifMtimeNs=${ns}`, { method: 'PUT', body: '{"version":1,"tag":"덮으면 안 된다"}' });
    assert.equal(stale.status, 409);
    const info = await stale.json();
    assert.equal(info.mtimeNs, both.headers.get('X-Choreo-Mtime-Ns'), '거절하면서 지금 판의 표식을 알려 줘야 한다');
    assert.equal((await (await fetch(`${s.base}/api/projects/${encodeURIComponent('공연')}`)).json()).tag, 'round-trip', '거절했는데 파일이 바뀌었다');
    // 표식을 안 보내면 조건 없이 쓴다(사람이 누른 저장이 이 길이다).
    assert.equal((await put('공연', { version: 1, tag: 'forced' })).status, 201);
    // 파일이 없으면 표식이 있어도 그냥 쓴다 — 누가 지웠다고 내 작업까지 버릴 까닭은 없다.
    assert.equal((await fetch(`${s.base}/api/projects?name=${encodeURIComponent('아예 없던 것')}&ifMtimeNs=${ns}`, { method: 'PUT', body: '{"version":1}' })).status, 201);

    // ⑧ 잘못된 요청은 400/404 이고, 폴더 밖 이름은 접힌다.
    assert.equal((await fetch(`${s.base}/api/projects/restore`, { method: 'POST', body: '{"from":"nope","file":"x.json"}' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/projects/restore`, { method: 'POST', body: '{"from":"trash","file":"없는것.json"}' })).status, 404);
    assert.equal((await fetch(`${s.base}/api/projects/restore`, { method: 'POST', body: '{"from":"trash","file":"../../탈출.json"}' })).status, 404);
    assert.equal((await fetch(`${s.base}/api/projects/.history?name=`)).status, 400);
  } finally { s.stop(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 보관 자리는 저장소 밖이다 (2026-09-13)
//
// 저장소는 코드의 자리이고 안무표·영상은 잃으면 복구 못 하는 사용자의 것이라 수명이 다르다.
// 여기서 지키는 것은 셋이다 — **데이터·설정·캐시가 서로 다른 자리**일 것, XDG 환경 변수를
// 따를 것, 그리고 **옛 자리에 쌓인 것이 있으면 말없이 옮기지 않을** 것.
// ─────────────────────────────────────────────────────────────────────────────

/** server.py 를 모듈로 읽어 한 줄을 물어본다(서버를 띄우지 않는다). */
function askPython(expr, env = {}) {
  const res = spawnSync('python3', ['-c', `import server; print(${expr})`],
    { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

test('server.py: 데이터·설정·캐시가 저장소 밖의 서로 다른 자리다', { skip: !hasPython && 'python3 없음' }, () => {
  const [data, config, cache] = askPython(
    "'\\n'.join(str(f()) for f in (server.data_home, server.config_home, server.cache_home))"
  ).split('\n');

  for (const dir of [data, config, cache]) {
    assert.ok(!dir.startsWith(REPO + path.sep), `저장소 안이다: ${dir}`);
  }
  // ⚠ 설정에는 LLM 키가 평문으로 있다. 안무 폴더는 통째로 건네거나 올리는 것이라 같이 두면 안 된다.
  assert.notEqual(data, config, '설정이 데이터와 같은 자리다 — 키가 따라간다');
  assert.notEqual(data, cache);
});

test('server.py: XDG 환경 변수를 따른다', { skip: !hasPython && 'python3 없음' }, () => {
  const fake = path.join(tmpdir(), 'choreo-xdg-데이터');
  const got = askPython('server.data_home()', { XDG_DATA_HOME: fake });
  assert.equal(got, path.join(fake, 'choreo'));
});

test('server.py: 옛 자리에 쌓인 것이 있으면 그 자리를 계속 쓴다', { skip: !hasPython && 'python3 없음' }, () => {
  // 이 저장소에는 실제로 옛 폴더가 남아 있을 수도, 없을 수도 있다. 둘 중 어느 쪽이든
  // **규칙이 같은지**만 본다 — 폴더가 있으면 저장소, 없으면 밖.
  const root = askPython('server.default_data_root()');
  const legacyHas = askPython(
    "server._has_anything(server.REPO_DIR / 'video-clip') or server._has_anything(server.REPO_DIR / 'projects')"
  ) === 'True';
  if (legacyHas) assert.equal(root, REPO, '쌓인 것이 있는데 새 자리를 가리킨다 — 사라진 것처럼 보인다');
  else assert.ok(!root.startsWith(REPO + path.sep) && root !== REPO, '빈 저장소인데 안쪽을 가리킨다');
});

test('server.py: 저장장치 목록은 지금 루트를 표시하고 남은 자리를 함께 준다', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    const data = await (await fetch(`${s.base}/api/volumes`)).json();
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.volumes) && data.volumes.length, '고를 것이 하나도 없다');

    // 지금 쓰는 자리는 언제나 목록에 있고, 하나만 current 다 — 없으면 화면이 아무것도 못 고른다.
    const current = data.volumes.filter(v => v.current);
    assert.equal(current.length, 1);
    assert.equal(current[0].path, s.root);

    for (const v of data.volumes) {
      assert.equal(typeof v.path, 'string');
      assert.equal(typeof v.label, 'string');
      assert.equal(typeof v.writable, 'boolean');
      // 남은 자리는 모를 수 있다(null). 있으면 양수여야 화면이 크기를 적는다.
      assert.ok(v.freeBytes === null || v.freeBytes >= 0, `freeBytes 가 이상하다: ${v.freeBytes}`);
    }
    // 홈은 어느 기계에나 있다.
    assert.ok(data.volumes.some(v => v.kind === 'home'), '홈 폴더가 목록에 없다');
  } finally { s.stop(); }
});

test('server.py: 설정 하나를 바꿔도 나머지가 떨어지지 않는다(Config.replace)', { skip: !hasPython && 'python3 없음' }, async () => {
  const s = await startServer();
  try {
    const cfgOf = () => fetch(`${s.base}/api/config`, { cache: 'no-store' }).then(r => r.json());
    const put = (path, body) => fetch(`${s.base}${path}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // 세 값을 서로 다르게 세워 둔다.
    await put('/api/config', { root: s.root, subdir: '영상모음', projectsSubdir: '안무표모음' });
    await put('/api/models/config', { dir: path.join(s.root, 'm1'), poseModel: 'heavy' });

    // 보관 루트만 바꾼다 — 모델과 안무표 폴더가 따라 떨어지면 안 된다.
    await put('/api/config', { root: path.join(s.root, 'sub') });
    let cfg = await cfgOf();
    assert.equal(cfg.subdir, '영상모음');
    assert.equal(cfg.projectsSubdir, '안무표모음');
    let models = await (await fetch(`${s.base}/api/models`)).json();
    assert.equal(models.poseModel, 'heavy', '루트를 바꿨더니 모델 설정이 기본값으로 돌아갔다');
    assert.equal(models.dir, path.join(s.root, 'm1'));

    // 거꾸로 모델만 바꾼다 — 안무표 하위 폴더가 떨어지던 자리다(2026-09-13 에 찾음).
    await put('/api/models/config', { dir: path.join(s.root, 'm2'), poseModel: 'lite' });
    cfg = await cfgOf();
    assert.equal(cfg.projectsSubdir, '안무표모음', '모델을 바꿨더니 안무표 폴더가 기본값으로 돌아갔다');
    assert.equal(cfg.subdir, '영상모음');
    models = await (await fetch(`${s.base}/api/models`)).json();
    assert.equal(models.poseModel, 'lite');
  } finally { s.stop(); }
});

test('server.py: /admin 은 로컬호스트에서만 열리고, 밖에서는 까닭을 말하며 거절한다', { skip: !hasPython && 'python3 없음' }, async () => {
  // 주소 판정 자체는 파이썬 쪽에서 직접 잰다 — 테스트가 다른 기계인 척할 수는 없다.
  const probe = spawnSync('python3', ['-c',
    'import sys; sys.path.insert(0, ".."); import server; '
    + 'print(",".join(str(server.is_loopback(a)) for a in '
    + '["127.0.0.1", "::1", "::ffff:127.0.0.1", "192.168.50.7", "100.86.195.60", "1.127.0.0", ""]))'
  ], { cwd: path.join(REPO, 'tests'), encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), 'True,True,True,False,False,False,False',
    '로컬호스트 판정이 헐겁거나 너무 빡빡하다');

  const s = await startServer();
  try {
    // 테스트는 127.0.0.1 로 붙으므로 열려야 한다.
    const res = await fetch(`${s.base}/admin`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /서버 설정/, '관리 화면이 아니라 다른 것이 왔다');
    // ⚠ 이 화면은 앱의 모듈을 쓰지 않는다 — 앱이 깨져도, 앱을 안 열었어도 떠야 한다.
    assert.ok(!/src\/app\/main\.js/.test(html), '관리 화면이 앱 모듈을 불러오고 있다');
    // ⚠ 이 화면이 소유하는 것은 보관 위치 하나다 — 모델·LLM 은 앱의 `⚙ 설정` 이 갖는다.
    assert.ok(!/id="llmKey"/.test(html), '관리 화면에 LLM 키 칸이 남아 있다');
    assert.ok(!/id="poseModel"/.test(html), '관리 화면에 모델 고르개가 남아 있다');

    // 보관 현황은 서버가 세어 준다(관리 화면이 여러 API 를 긁어모으지 않게).
    const usage = await (await fetch(`${s.base}/api/storage`)).json();
    assert.equal(usage.ok, true);
    for (const key of ['clips', 'projects', 'models']) {
      assert.equal(typeof usage[key].count, 'number');
      assert.equal(typeof usage[key].bytes, 'number');
    }
    assert.equal(usage.root, s.root);
  } finally { s.stop(); }
});
