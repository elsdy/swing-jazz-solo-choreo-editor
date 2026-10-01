// tests/unit/checkDocs.test.mjs — 문서 검사의 ⑤ 라벨 인용 대조(tools/lib/doc-labels.mjs)의 자기 시험
//
// 검사기의 가장 나쁜 고장은 **조용히 아무것도 안 잡는 것**이다. 그래서 일부러 없는 라벨을 인용한 조각을 넣어
// 붉어지는지, 런타임에 조립되는 라벨(숫자 · 이름이 끼는 것)은 통과하는지, 라벨이 아닌 인용은 건너뛰는지를 본다.
// 마지막 둘은 지금 저장소 그대로를 대조한다 — 계기였던 옛 라벨(`동작 팔레트`)이 실제 화면 코드에 대고 붉어지는지.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDocLabels, collectScreenTexts, contains, docQuotes, labelPieces, loadScreenFiles, normalize,
} from '../../tools/lib/doc-labels.mjs';
import { scanJs, HOLE } from '../../tools/lib/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCREEN = {
  'index.html': `<!doctype html><html><head><style>/* 옛 이름: 동작 팔레트 */ .x{}</style></head><body>
    <!-- 예전에는 「어떻게 채울까」 카드였다 -->
    <h2>동작 목록</h2>
    <input placeholder="프로젝트 파일 이름" />
    <button title="이름 바꾸기 · 저장">▾</button>
    <h3><span class="badge">1</span>말하거나 적는다</h3>
  </body></html>`,
  'src/ui/toolbarView.js': `
    // 주석 속 옛 라벨: 정리 모드
    btn.textContent = \`루틴으로 편성 (\${count})\`;
    title.textContent = \`8x\${rows} 안무 테이블\`;
    help.textContent = \`\${n}/\${max} — 첫 지점 \${formatCell(c)} = \${clock}.\`;
    label.textContent = \`동작 \${name}\`;
  `,
  'server.py': `
# 주석 속 옛 라벨: 서버 보관 루트
def page():
    return '<h1>서버 설정은 서버 앞에서만 엽니다</h1>'
`,
};
const doc = (...quotes) => ({ 'docs/FEATURES.md': quotes.map(q => `- \`${q}\` 를 누른다`).join('\n') });
const missesOf = (docs, files = SCREEN, notLabels = []) => checkDocLabels(docs, files, notLabels).misses.map(m => m.quote);

test('없는 라벨을 인용하면 붉어진다 — 줄 번호와 인용을 함께 낸다', () => {
  const r = checkDocLabels({ 'docs/TUTORIAL.md': '첫 줄\n둘째 줄에 `부분 불러오기` 가 있다' }, SCREEN, []);
  assert.equal(r.misses.length, 1);
  assert.deepEqual({ doc: r.misses[0].doc, line: r.misses[0].line, quote: r.misses[0].quote },
    { doc: 'docs/TUTORIAL.md', line: 2, quote: '부분 불러오기' });
});

test('있는 라벨은 통과한다 — 태그 사이 글자 · placeholder · title · 이모지 차이', () => {
  assert.deepEqual(missesOf(doc('동작 목록', '프로젝트 파일 이름', '이름 바꾸기 · 저장', '▸ 동작 목록', '1 말하거나 적는다')), []);
});

test('주석에 남은 옛 라벨은 「있다」로 치지 않는다 — HTML 주석 · CSS 주석 · JS 주석 · 파이썬 주석', () => {
  assert.deepEqual(missesOf(doc('어떻게 채울까', '동작 팔레트', '정리 모드', '서버 보관 루트')),
    ['어떻게 채울까', '동작 팔레트', '정리 모드', '서버 보관 루트']);
});

test('런타임에 조립되는 라벨 — 숫자 · 행 이름 · 그때그때 값이 낀 템플릿과 맞는다', () => {
  assert.deepEqual(missesOf(doc('루틴으로 편성 (3)', '8x12 안무 테이블', '1/2 — 첫 지점 8x1의 1카운트 = 0:12.3')), []);
});

test('템플릿 구멍이 낱말을 통째로 먹으면 통과시키지 않는다 — `동작 ${이름}` 이 `동작 팔레트` 를 덮지 않는다', () => {
  assert.equal(contains(normalize(`동작 ${HOLE}`), normalize('동작 팔레트')), false);
  assert.equal(contains(normalize(`${HOLE} 첫 지점 ${HOLE}`), normalize('첫 지점 없는 말')), false);
  assert.equal(contains(normalize(`${HOLE} 첫 지점 ${HOLE}`), normalize('1/2 첫 지점 8x1의 1카운트')), true);
});

test('라벨이 아닌 인용은 대조하지 않는다 — 한글 없는 것 · 경로 · 파일 이름 · 명령 · 문서의 자리표', () => {
  for (const q of ['Undo', 'python3 server.py', 'video-clip/데모/take.mp4', '이름 (2).mp4', 'python3 server.py --models ~/모델폴더', '<이름>-moves.json']) {
    assert.deepEqual(labelPieces(q), [], q);
  }
  // 자리표에서 끊은 나머지는 대조한다
  assert.deepEqual(labelPieces('여기가 [8x1] 의 [1] 카운트'), ['여기가 ', ' 의 ', ' 카운트']);
  assert.deepEqual(missesOf(doc('Undo', '<서버 루트>/projects/<이름>.json')), []);
});

test('코드블록 안의 백틱은 인용으로 치지 않는다', () => {
  const md = '앞 `동작 목록`\n```\n`부분 불러오기`\n```\n뒤';
  assert.deepEqual(docQuotes(md).map(q => q.quote), ['동작 목록']);
});

test('라벨 아님 목록 — 이유가 비었거나 더는 인용되지 않는 항목은 따로 낸다', () => {
  const r = checkDocLabels(doc('9/01 첫 시도'), SCREEN, [
    { quote: '9/01 첫 시도', why: '사용자가 적는 이름의 예' },
    { quote: '해피', why: '' },
    { quote: '옛 예시', why: '이제 문서에 없다' },
  ]);
  assert.deepEqual(r.misses, []);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.badExclusions, ['해피']);
  assert.deepEqual(r.unusedExclusions, ['옛 예시']);
});

test('js-text: 문자열 속 글자를 모으고 템플릿 구멍은 HOLE 로 남긴다 — 주석과 정규식은 문자열이 아니다', () => {
  const src = "// '주석'\nconst a = '하나'; const r = /'둘'/; const t = `셋 ${x ? '넷' : ''} 다섯`;";
  const texts = scanJs(src).strings.map(s => s.text);
  assert.deepEqual(texts, ['하나', '넷', '', `셋 ${HOLE} 다섯`]);
});

test('지금 저장소: 두 문서의 라벨 인용이 모두 화면에 있고, 계기였던 옛 라벨은 붉어진다', () => {
  const files = loadScreenFiles(ROOT);
  assert.ok(collectScreenTexts(files).length > 500, '화면 글자를 거의 못 모았다 — 읽는 법이 낡았다');
  assert.deepEqual(missesOf(doc('동작 팔레트', '어떻게 채울까', '서버 보관 루트', '프로젝트 저장 / 불러오기'), files),
    ['동작 팔레트', '어떻게 채울까', '서버 보관 루트', '프로젝트 저장 / 불러오기']);
});

test('지금 저장소: node tools/check-docs.mjs 가 통과한다', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-docs.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /라벨 인용 \d+개 대조/);
});
