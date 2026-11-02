// tests/unit/supportMatrix.test.mjs — 지원 매트릭스(RM-27): 표의 모양 · 탐지 · 「안 되는 것」 목록 · 알림 판정 · 문서 대조
//
// 앞의 다섯 시험 이름은 계획서(docs/roadmap/plans/RM-27.md)의 「요구 ↔ 시험」 표 1 · 2 · 3 · 5 · 6 과 같아야 한다.
// 표의 주인은 src/domain/supportMatrix.js 하나다 — 문서(docs/SUPPORT.md)의 표는 그것을 옮긴 것이라 칸마다 대조한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONDITIONS, ENVIRONMENTS, FEATURES, SYMBOLS,
  environmentLines, featureStatus, fingerprintOf, matrixTableLines,
  shouldNotify, unsupportedFeatures, unsupportedMessage, validateMatrix
} from '../../src/domain/supportMatrix.js';
import { detectCapabilities } from '../../src/adapters/capabilities.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 가짜 브라우저 전역. 기능을 고르는 대로 켠다. */
function fakeWin({ folder = false, speech = false, ua = 'Mozilla/5.0 (Macintosh) Chrome/130' } = {}) {
  const win = { navigator: { userAgent: ua } };
  if (folder) { win.showDirectoryPicker = async () => ({}); win.indexedDB = {}; }
  if (speech) win.webkitSpeechRecognition = function () {};
  return win;
}

const SERVER_ALL = { ffmpeg: true, pose: true };

// ── 요구 ↔ 시험 1 · 2 · 3 · 5 · 6 ───────────────────────────────────────────

test('표의 기능마다 조건과 알려진 환경 칸이 모두 ○·△·✕ 중 하나로 채워져 있다', () => {
  assert.deepEqual(validateMatrix(), []);
  assert.ok(FEATURES.length >= 8, `기능 행이 ${FEATURES.length}개뿐이다`);
  assert.ok(ENVIRONMENTS.length >= 6, `환경 열이 ${ENVIRONMENTS.length}개뿐이다`);
  const syms = new Set(Object.values(SYMBOLS));
  assert.deepEqual([...syms], ['○', '△', '✕']);
  for (const f of FEATURES) {
    for (const e of ENVIRONMENTS) assert.ok(syms.has(f.known[e.id]), `${f.id} × ${e.id}`);
    for (const c of f.needs) assert.ok(CONDITIONS.some(x => x.id === c), `${f.id} 의 조건 ${c}`);
  }
  // 조건마다 긴 까닭과 짧은 까닭이 다 있다 — 설정 절과 토스트가 각각 쓴다
  for (const c of CONDITIONS) assert.ok(c.missing && c.short && c.label, c.id);

  // 검사기는 일부러 망가뜨린 표에서 붉어진다(조용히 빈 배열을 돌려주는 것이 가장 나쁜 고장)
  const bad = [
    { id: 'a', label: 'A', needs: ['nope'], known: Object.fromEntries(ENVIRONMENTS.map(e => [e.id, '○'])) },
    { id: 'a', label: 'B', needs: [], known: { ...Object.fromEntries(ENVIRONMENTS.map(e => [e.id, '○'])), [ENVIRONMENTS[0].id]: '?' } },
    { id: 'c', label: 'C', needs: [], known: {} }
  ];
  const problems = validateMatrix(bad);
  assert.match(problems.join('\n'), /모르는 조건 nope/);
  assert.match(problems.join('\n'), /기능 id 가 두 번/);
  assert.match(problems.join('\n'), /기호 \? 를 모른다/);
  assert.match(problems.join('\n'), new RegExp(`c: ${ENVIRONMENTS[0].id} 칸이 비었다`));
});

test('탐지는 가짜 window 의 기능 유무만 보고 사용자 에이전트 문자열은 읽지 않는다', () => {
  // 기능이 있고 없음에 따라 값이 갈린다
  const full = detectCapabilities({ win: fakeWin({ folder: true, speech: true }), serverConfig: SERVER_ALL, poseDelegate: 'GPU' });
  assert.deepEqual(full, { server: true, ffmpeg: true, model: true, folder: true, speech: true, gpu: true });

  const bare = detectCapabilities({ win: fakeWin(), serverConfig: null, poseDelegate: '' });
  assert.deepEqual(bare, { server: false, ffmpeg: false, model: false, folder: false, speech: false, gpu: null });

  // 서버는 있는데 ffmpeg · 모델이 없고, 자세 분석은 CPU 로 섰다
  const cpu = detectCapabilities({ win: fakeWin({ speech: true }), serverConfig: { ffmpeg: false, pose: false }, poseDelegate: 'CPU' });
  assert.deepEqual(cpu, { server: true, ffmpeg: false, model: false, folder: false, speech: true, gpu: false });
  // 폴더 고르기는 showDirectoryPicker 와 indexedDB 가 **둘 다** 있어야 한다(clipLibrary 와 같은 규칙)
  const half = { showDirectoryPicker: async () => ({}), navigator: { userAgent: 'x' } };
  assert.equal(detectCapabilities({ win: half, serverConfig: null }).folder, false);
  // 표준 이름의 SpeechRecognition 도 음성 인식이다
  assert.equal(detectCapabilities({ win: { SpeechRecognition: function () {} }, serverConfig: null }).speech, true);
  // window 가 없으면(노드) 브라우저 능력은 전부 거짓이고 던지지 않는다
  assert.equal(detectCapabilities({ win: null, serverConfig: SERVER_ALL }).folder, false);

  // 사용자 에이전트 문자열을 아무렇게나 바꿔도 결과가 같다
  for (const ua of ['Safari/605.1.15 Version/17', 'Firefox/130', 'Edg/130', '']) {
    const w = fakeWin({ folder: true, speech: true, ua });
    assert.deepEqual(detectCapabilities({ win: w, serverConfig: SERVER_ALL, poseDelegate: 'GPU' }), full, ua);
  }
  // 그리고 탐지 **코드**에 그 글자가 아예 없다(주석은 「읽지 않는다」고 말해도 된다)
  const src = readFileSync(join(ROOT, 'src/adapters/capabilities.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /userAgent|navigator\.platform|vendor/);
});

test('서버 없음 · 폴더 고르기 없음 · 음성 없음이면 안 되는 것 목록에 그 기능과 까닭이 담긴다', () => {
  const byId = (list) => Object.fromEntries(list.map(l => [l.id, l]));

  // 다 되면 빈 목록
  const all = { server: true, ffmpeg: true, model: true, folder: true, speech: true, gpu: true };
  assert.deepEqual(unsupportedFeatures(all), []);
  assert.equal(unsupportedMessage([]), '');

  // 정적으로 열었고 사파리 같은 브라우저(폴더 · 음성 없음)
  const bare = { server: false, ffmpeg: false, model: false, folder: false, speech: false, gpu: null };
  const missing = byId(unsupportedFeatures(bare));
  assert.ok(!missing.edit, '편집은 어디서나 된다');
  for (const id of ['clip-server', 'projects', 'llm', 'trim', 'pose', 'pose-gpu']) {
    assert.ok(missing[id], `${id} 가 안 되는 것에 없다`);
    // ⚠ 서버가 없으면 서버 쪽 조건은 「서버 없음」 하나로 묶인다 — ffmpeg · 모델을 따로 세지 않는다
    assert.deepEqual(missing[id].missing, ['server'], id);
    assert.deepEqual(missing[id].reasons, [CONDITIONS.find(c => c.id === 'server').missing]);
  }
  assert.deepEqual(missing['clip-folder'].missing, ['folder']);
  assert.deepEqual(missing.speech.missing, ['speech']);
  assert.match(missing.speech.reasons[0], /음성 인식/);
  assert.match(missing['clip-folder'].reasons[0], /폴더 고르기/);

  // 서버는 있는데 ffmpeg 만 없다 → 자르기만 안 된다
  const noFfmpeg = { ...all, ffmpeg: false };
  assert.deepEqual(Object.keys(byId(unsupportedFeatures(noFfmpeg))), ['trim']);
  assert.deepEqual(featureStatus(FEATURES.find(f => f.id === 'trim'), noFfmpeg).missing, ['ffmpeg']);

  // GPU 를 아직 모르면 안 되는 것이 아니라 「모름」이다 — 켤 때 모델을 띄우지 않는다
  const lines = Object.fromEntries(environmentLines({ ...all, gpu: null }).map(l => [l.id, l.status]));
  assert.equal(lines['pose-gpu'], 'unknown');
  assert.equal(lines.pose, 'ok');
  assert.ok(!byId(unsupportedFeatures({ ...all, gpu: null }))['pose-gpu']);
  // CPU 로 섰으면 GPU 가속만 안 되고 자세 분석은 된다
  const cpu = byId(unsupportedFeatures({ ...all, gpu: false }));
  assert.deepEqual(Object.keys(cpu), ['pose-gpu']);
  assert.match(cpu['pose-gpu'].reasons[0], /CPU/);

  // 토스트 문구 — 이름 셋까지와 「등 N가지」, 짧은 까닭을 한 번씩
  const msg = unsupportedMessage(unsupportedFeatures(bare));
  assert.match(msg, /등 8가지가 안 됩니다/);
  assert.match(msg, /서버 없음 · 폴더 고르기 없음 · 음성 인식 없음/);
  assert.equal((msg.match(/서버 없음/g) || []).length, 1);
  assert.match(unsupportedMessage(unsupportedFeatures(noFfmpeg)), /^이 환경에서는 영상 자르기 · 내보내기가 안 됩니다\(ffmpeg 없음\)/);
});

test('환경 지문이 지난번과 같으면 알리지 않고 바뀌었거나 처음이면 한 번 알린다', () => {
  const caps = { server: false, ffmpeg: false, model: false, folder: true, speech: true, gpu: null };
  const fp = fingerprintOf(caps);
  assert.equal(fp, 'ffmpeg=0 folder=1 model=0 server=0 speech=1');
  // 늦게 아는 것(gpu — 모델을 띄워야 안다)은 알아도 몰라도 지문에 들어가지 않는다 — 켤 때마다 달라질 값이 지문에 들면 매번 새 환경으로 보인다
  assert.equal(fingerprintOf({ ...caps, gpu: true }), fp);
  assert.equal(fingerprintOf({ ...caps, gpu: false }), fp);
  // 키 순서가 달라도 같은 지문
  assert.equal(fingerprintOf({ speech: true, folder: true, server: false, model: false, ffmpeg: false }), fp);

  const q = (over) => shouldNotify({ enabled: true, fingerprint: fp, lastFingerprint: '', anyUnsupported: true, ...over });
  assert.equal(q({}), true, '처음이면 알린다');
  assert.equal(q({ lastFingerprint: fp }), false, '같은 환경이면 조용하다');
  assert.equal(q({ lastFingerprint: fingerprintOf({ ...caps, server: true }) }), true, '서버가 생기고 없어지면 다시 알린다');
  assert.equal(q({ enabled: false }), false, '설정에서 끄면 안 알린다');
  assert.equal(q({ anyUnsupported: false }), false, '안 되는 것이 없으면 알릴 것이 없다');
});

test('SUPPORT.md 의 표가 코드 표와 칸마다 같다', () => {
  const md = readFileSync(join(ROOT, 'docs/SUPPORT.md'), 'utf8');
  const rows = md.split('\n').filter(l => /^\|/.test(l));
  const headAt = rows.findIndex(l => l.startsWith('| 기능 |'));
  assert.ok(headAt >= 0, 'SUPPORT.md 에 `| 기능 |` 로 시작하는 표가 없다');
  const cells = (l) => l.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').split(/\s*\|\s*/);
  const head = cells(rows[headAt]);
  assert.deepEqual(head, ['기능', '필요한 것', ...ENVIRONMENTS.map(e => e.label)], '머리줄의 열이 환경 표와 다르다');

  const body = [];
  for (let i = headAt + 2; i < rows.length && /^\|/.test(rows[i]); i++) body.push(cells(rows[i]));
  assert.deepEqual(body.map(r => r[0]), FEATURES.map(f => f.label), '기능 행의 이름 · 순서가 코드 표와 다르다');

  for (const f of FEATURES) {
    const row = body.find(r => r[0] === f.label);
    const needs = f.needs.length ? f.needs.map(id => CONDITIONS.find(c => c.id === id).label).join(' · ') : '—';
    assert.equal(row[1], needs, `${f.id} 의 필요한 것`);
    ENVIRONMENTS.forEach((e, k) => assert.equal(row[2 + k], f.known[e.id], `${f.id} × ${e.label}`));
  }
  // 문서의 표 줄은 코드가 만든 줄과 글자까지 같다 — 어긋나면 matrixTableLines() 의 출력으로 다시 옮긴다
  const expected = matrixTableLines();
  assert.deepEqual(rows.slice(headAt, headAt + expected.length), expected);
});

// ── 표 밖에서 덧댄 것 ───────────────────────────────────────────────────────

test('지원 범위 문서가 등록부에 있고 설정 화면이 같은 기호를 쓴다', async () => {
  const { DOCS } = await import('../../src/ui/docsRegistry.js');
  const entry = DOCS.find(d => d.path === 'docs/SUPPORT.md');
  assert.ok(entry, 'docs/SUPPORT.md 가 docsRegistry 에 없다');
  assert.equal(entry.title, '지원 범위');
  const view = readFileSync(join(ROOT, 'src/ui/settingsView.js'), 'utf8');
  assert.match(view, /from '\.\.\/domain\/supportMatrix\.js'/);
  assert.match(view, /data-cat="env"/);
});
