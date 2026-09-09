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
