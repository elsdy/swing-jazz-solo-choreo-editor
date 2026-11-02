// tests/unit/checkDocs.test.mjs — 문서 검사의 ⑤ 라벨 인용 대조(tools/docLabels.mjs)의 자기 시험
//
// 검사기의 가장 나쁜 고장은 **조용히 아무것도 안 잡는 것**이다. 그래서 일부러 없는 라벨을 인용한 조각을 넣어
// 붉어지는지, 런타임에 조립되는 라벨은 통과하는지, 라벨이 아닌 인용은 건너뛰는지를 본다.
// 앞의 여섯 시험은 계획서(docs/roadmap/plans/RM-06.md)의 「요구 ↔ 시험」 표 1~6 이고, 이름이 표와 같아야 한다
// (표 7 은 문서 문장이라 시험이 없다). 그 뒤는 표 밖에서 덧댄 것이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LABEL_DOCS, NOT_LABELS, checkDocLabels, collectScreenTexts, contains, docQuotes, formatMiss, labelTableTexts, normalize, notALabel,
} from '../../tools/docLabels.mjs';
import { LABELS } from '../../src/domain/strings.js';
import { COMMANDS } from '../../src/domain/commands.js';
import { scanJs, HOLE } from '../../tools/lib/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCREEN = {
  'index.html': `<!doctype html><html><head><style>/* 옛 이름: 동작 팔레트 */ .x{}</style></head><body>
    <!-- 예전에는 「어떻게 채울까」 카드였다 -->
    <h2 class="panel-title">동작 목록</h2>
    <input placeholder="프로젝트 파일 이름" />
    <button title="이름 바꾸기 · 저장" aria-label="파일 메뉴">▾</button>
    <h3><span class="badge">1</span>말하거나 적는다</h3>
    <button id="pip">⧉ PiP</button>
  </body></html>`,
  'src/ui/toolbarView.js': `
    // 주석 속 옛 라벨: 정리 모드
    btn.textContent = \`루틴으로 편성 (\${count})\`;
    title.textContent = \`8x\${rows} 안무 테이블\`;
    help.textContent = \`\${n}/\${max} — 첫 지점 \${formatCell(c)} = \${clock}.\`;
    label.textContent = \`동작 \${name}\`;
    badge.textContent = \`\${bpm} BPM\`;
  `,
  'server.py': `
# 주석 속 옛 라벨: 서버 보관 루트
def page():
    return '<h1>서버 설정은 서버 앞에서만 엽니다</h1>'
`,
};
const doc = (...quotes) => ({ 'docs/FEATURES.md': quotes.map(q => `- \`${q}\` 를 누른다`).join('\n') });
const missesOf = (docs, files = SCREEN, notLabels = []) => checkDocLabels(docs, files, notLabels).misses.map(m => m.quote);

/** 지금 저장소의 화면 쪽 원문 — tools/check-docs.mjs 가 읽는 것과 같은 묶음. */
function repoScreenFiles() {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files[relative(ROOT, p).replaceAll('\\', '/')] = readFileSync(p, 'utf8');
    }
  };
  walk(join(ROOT, 'src'));
  for (const f of ['index.html', 'admin.html', 'server.py']) files[f] = readFileSync(join(ROOT, f), 'utf8');
  return files;
}
const repoDocs = () => Object.fromEntries(LABEL_DOCS.map(f => [f, readFileSync(join(ROOT, f), 'utf8')]));

// ── 「요구 ↔ 시험」 표 1~6 ───────────────────────────────────────────────────

test('백틱 인용을 줄 번호와 함께 뽑고 코드블록 안은 뺀다', () => {
  const md = '첫 줄 `동작 목록`\n```\n`부분 불러오기`\n```\n셋째 `Undo` 와 ``이중 `백틱` 인용``';
  assert.deepEqual(docQuotes(md), [
    { quote: '동작 목록', line: 1 },
    { quote: 'Undo', line: 5 },
    { quote: '이중 `백틱` 인용', line: 5 },
  ]);
});

test('index.html 태그 글자·속성 값과 JS 문자열을 화면 글자로 모은다', () => {
  const { texts, raw } = collectScreenTexts(SCREEN);
  const has = (s) => texts.some(t => t.includes(normalize(s)));
  for (const s of ['동작 목록', '프로젝트 파일 이름', '이름 바꾸기 저장', '파일 메뉴', '말하거나 적는다', '서버 설정은 서버 앞에서만 엽니다']) {
    assert.ok(has(s), `「${s}」 를 못 모았다`);
  }
  assert.ok(texts.includes(`루틴으로 편성 ${HOLE}`), 'textContent 템플릿을 구멍째 모으지 못했다');
  assert.ok(raw.includes('▾'), '기호뿐인 단추 글자를 정규화 전 글자에 남기지 못했다');
  // 태그 이름 · 속성 이름 · 속성 값의 클래스는 글자로 섞이지 않는다
  for (const word of ['placeholder', 'aria', 'button', 'panel title', 'badge', 'h2']) {
    assert.ok(!texts.some(t => new RegExp(`(^| )${word}( |$)`).test(t)), `「${word}」 가 화면 글자로 섞였다`);
  }
});

test('명령·경로·주소·키 이름 인용은 대조하지 않는다', () => {
  for (const q of ['python3', 'http://localhost:8000', 'index.html', 'Enter', '8x1', 'python3 server.py --models ~/모델폴더',
    'video-clip/데모/take.mp4', 'Ctrl/Cmd+Z', 'ANTHROPIC_API_KEY', 'PUT /api/config']) {
    assert.ok(notALabel(q), `\`${q}\` 를 라벨로 봤다`);
  }
  for (const q of ['동작 목록', 'Undo', '⧉ PiP', '175.1 BPM']) assert.equal(notALabel(q), null, `\`${q}\` 를 라벨 아님으로 걸렀다`);
  assert.deepEqual(missesOf(doc('python3', 'http://localhost:8000', 'index.html', 'Enter', '8x1')), []);
  // 제외 목록은 항목마다 이유가 있다
  for (const n of NOT_LABELS) assert.ok(n.why && n.why.trim(), `NOT_LABELS '${n.quote}' 에 이유가 없다`);
});

test('숫자가 끼는 라벨을 템플릿 틀과 맞춘다', () => {
  assert.equal(contains(normalize(`루틴으로 편성 (${HOLE})`), normalize('루틴으로 편성 (3)')), true);
  assert.deepEqual(missesOf(doc('루틴으로 편성 (3)', '8x12 안무 테이블', '175.1 BPM', '1/2 — 첫 지점 8x1의 1카운트 = 0:12.3')), []);
  // 이모지 · 앞뒤 공백 · 말줄임표 차이
  assert.deepEqual(missesOf(doc('PiP', ' ⧉ PiP ', '▸ 동작 목록', '동작 목록…', '1 말하거나 적는다', '▾')), []);
});

test('화면에 없는 라벨 인용은 줄과 후보를 찍고 실패한다', () => {
  const r = checkDocLabels({ 'docs/TUTORIAL.md': '첫 줄\n둘째 줄에 `동작 팔레트` 가 있다' }, SCREEN, []);
  assert.equal(r.misses.length, 1);
  const line = formatMiss(r.misses[0]);
  assert.match(line, /^docs\/TUTORIAL\.md:2 — `동작 팔레트`/);
  assert.match(line, /`동작 목록`/, `후보에 동작 목록이 없다: ${line}`);
  // 명령줄에서도 같은 판정이다 — 저장소 그대로면 종료 코드 0(아래 표 6), 붉은 줄이 생기면 1
});

test('지금 두 문서의 라벨 인용이 모두 화면에 있다', () => {
  const r = checkDocLabels(repoDocs(), repoScreenFiles());
  assert.deepEqual(r.misses.map(formatMiss), []);
  assert.deepEqual(r.badExclusions, []);
  assert.deepEqual(r.unusedExclusions, []);
  assert.ok(r.checked > 500, `대조한 인용이 ${r.checked}개뿐이다 — 읽는 법이 낡았다`);
  const cli = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-docs.mjs')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /라벨 인용 불일치 0 · 라벨 아님 \d+개/);
});

// ── RM-10 「요구 ↔ 시험」 표 7 ─────────────────────────────────────────────

test('라벨 인용을 문자열 표와 명령 등록부에서 먼저 찾고, 표 밖에서만 찾은 것은 따로 센다', () => {
  const tables = labelTableTexts({ 'block.remove': '× 지우기', 'video.inout.range': 'In {in} · Out {out}' }, [{ label: '되돌리기', button: 'Undo', hint: '방금 한 일을 하나' }]);
  assert.deepEqual(tables, ['× 지우기', `In ${HOLE} · Out ${HOLE}`, '되돌리기', 'Undo', '방금 한 일을 하나'], '표의 구멍은 HOLE, 등록부는 라벨 · 단추 · 툴팁 · 설명');

  // 표 출처와 긁은 출처가 갈라져 온다 — 합친 것(texts · raw)은 옛 호출부 그대로
  const r = collectScreenTexts(SCREEN, tables);
  assert.ok(r.table.texts.includes(normalize('× 지우기')) && !r.scraped.texts.includes(normalize('× 지우기')));
  assert.ok(r.scraped.texts.includes(normalize('동작 목록')) && !r.table.texts.includes(normalize('동작 목록')));
  assert.ok(r.texts.includes(normalize('× 지우기')) && r.texts.includes(normalize('동작 목록')));
  assert.equal(r.table.raw, tables.join('\n'));

  // 표에 있는 인용은 표 출처로, 긁은 글자에서만 찾은 것은 따로, 어디에도 없으면 실패
  const c = checkDocLabels(doc('× 지우기', 'Undo', 'In 0:12.3 · Out 0:45.0', '동작 목록', '프로젝트 파일 이름', '동작 팔레트'), SCREEN, [], tables);
  assert.deepEqual(c.misses.map(m => m.quote), ['동작 팔레트']);
  assert.equal(c.fromTable, 3);
  assert.equal(c.scrapedOnly, 2);
  assert.equal(c.checked, 6);
  // 표를 주지 않으면 전부 긁은 쪽이다
  const none = checkDocLabels(doc('동작 목록'), SCREEN, []);
  assert.deepEqual([none.fromTable, none.scrapedOnly], [0, 1]);

  // 지금 저장소 — 표 · 등록부에서 찾는 인용이 실제로 있고, 보고 줄에 두 수가 난다
  const real = checkDocLabels(repoDocs(), repoScreenFiles(), NOT_LABELS, labelTableTexts(LABELS, COMMANDS));
  assert.deepEqual(real.misses, []);
  assert.ok(real.fromTable >= 30, `표 · 등록부에서 찾은 인용이 ${real.fromTable}개뿐이다`);
  assert.equal(real.fromTable + real.scrapedOnly, real.checked);
  const cli = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-docs.mjs')], { encoding: 'utf8' });
  assert.match(cli.stdout, new RegExp(`문자열 표·명령 등록부에서 ${real.fromTable}개, 표 밖 화면 글자에서만 ${real.scrapedOnly}개`));
});

// ── 표 밖에서 덧댄 것 ───────────────────────────────────────────────────────

test('주석에 남은 옛 라벨은 「있다」로 치지 않는다 — HTML 주석 · CSS 주석 · JS 주석 · 파이썬 주석', () => {
  assert.deepEqual(missesOf(doc('어떻게 채울까', '동작 팔레트', '정리 모드', '서버 보관 루트')),
    ['어떻게 채울까', '동작 팔레트', '정리 모드', '서버 보관 루트']);
});

test('템플릿 구멍이 낱말을 통째로 먹으면 통과시키지 않는다 — `동작 ${이름}` 이 `동작 팔레트` 를 덮지 않는다', () => {
  assert.equal(contains(normalize(`동작 ${HOLE}`), normalize('동작 팔레트')), false);
  assert.equal(contains(normalize(`${HOLE} 첫 지점 ${HOLE}`), normalize('첫 지점 없는 말')), false);
  assert.equal(contains(normalize(`${HOLE} 첫 지점 ${HOLE}`), normalize('1/2 첫 지점 8x1의 1카운트')), true);
});

test('두 글자 이하 인용은 낱말 경계로만 맞춘다', () => {
  assert.equal(contains(normalize('this is it'), 'hi'), false);
  assert.equal(contains(normalize('해제'), '해'), false);
  assert.equal(contains(normalize(`${HOLE}번`), normalize('1번')), true);
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
  assert.deepEqual(scanJs(src).strings.map(s => s.text), ['하나', '넷', '', `셋 ${HOLE} 다섯`]);
});

test('지금 저장소: 계기였던 옛 라벨과 없어진 단추는 붉어진다', () => {
  assert.deepEqual(missesOf(doc('동작 팔레트', '어떻게 채울까', '서버 보관 루트', '프로젝트 저장 / 불러오기', '☰'), repoScreenFiles()),
    ['동작 팔레트', '어떻게 채울까', '서버 보관 루트', '프로젝트 저장 / 불러오기', '☰']);
});

test('지금 저장소: 파일 메뉴의 저장 안내와 튜토리얼 · 기능 설명서의 저장 · 복구 대목이 「파일 서랍의 지난 판」을 가리키고 .history 폴더를 뒤지라는 옛 말은 없다', () => {
  // RM-25(2026-11-02). 되돌릴 길이 화면에 생겼는데 안내가 「폴더에 남습니다」로 남으면 폴더를 뒤지라는 말이 된다.
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  // ① 파일 메뉴의 saveNote 문장 — 화면 글자(JS 문자열)로 읽는다. RM-10 부터 글자는 문자열 표(`file.note.bound`)에 산다.
  const strings = scanJs(read('src/domain/strings.js')).strings.map(s => s.text);
  const note = strings.find(t => t.includes('자동으로 담기고 있습니다'));
  assert.ok(note, '저장 안내 문장을 못 찾았다');
  assert.ok(note.includes('지난 판'), `저장 안내가 지난 판을 가리키지 않는다: ${note}`);
  assert.ok(!strings.some(t => /\.history 에 남습니다/.test(t)), '옛 말(「폴더의 .history 에 남습니다」)이 남았다');
  // ② 두 문서의 저장 · 복구 대목 — 새 라벨을 백틱으로 인용한다(그래서 위 「라벨 인용이 모두 화면에 있다」가 화면까지 잰다).
  for (const docPath of LABEL_DOCS) {
    const quotes = docQuotes(read(docPath)).map(q => q.quote);
    assert.ok(quotes.includes('지난 판'), `${docPath} 가 \`지난 판\` 을 인용하지 않는다`);
    assert.ok(quotes.includes('되살리기'), `${docPath} 가 \`되살리기\` 를 인용하지 않는다`);
    // ③ .history 폴더를 직접 뒤지라는 문장이 없다.
    const text = read(docPath);
    for (const old of [/폴더에서 직접 꺼낸다/, /고르는 자리는 아직 없/, /`\.history\/?` ?에 남으므로/]) {
      assert.ok(!old.test(text), `${docPath} 에 옛 말이 남았다: ${old}`);
    }
  }
});

test('RM-16 새 라벨이 기능 설명서와 튜토리얼에 백틱으로 적혀 있고 화면 글자와 맞는다', () => {
  const labels = ['여기서 자르기', '옆과 합치기', '위에 한 마디 끼우기', '이 마디 지우기', '이 마디 복제', '위로 옮기기', '아래로 옮기기'];
  const docs = repoDocs();
  for (const file of ['docs/FEATURES.md', 'docs/TUTORIAL.md']) {
    const quotes = new Set(docQuotes(docs[file]).map(q => q.quote));
    for (const label of labels) assert.ok(quotes.has(label), `${file} 에 \`${label}\` 인용이 없다`);
  }
  const { texts } = collectScreenTexts(repoScreenFiles());
  for (const label of labels) assert.ok(texts.some(t => contains(t, normalize(label))), `화면 글자에 「${label}」 이 없다`);
  assert.deepEqual(checkDocLabels(repoDocs(), repoScreenFiles()).misses.map(formatMiss), []);
});

// ── RM-26: 도움말 `?` 표와 문서 갈래 ───────────────────────────────────────────
// 이름은 계획서(docs/roadmap/plans/RM-26.md)의 「요구 ↔ 시험」 표 6 · 7 · 8 과 같다.

import { renderMarkdown } from '../../src/ui/docsHub.js';
import { DOCS, DOC_GROUPS, resolveDoc } from '../../src/ui/docsRegistry.js';
import { HELP_LINKS, missingHelpAnchors, unmatchedHelpKeys } from '../../src/ui/helpLinks.js';

/** 등록부의 문서마다 뷰어가 만드는 id 집합 — check-docs 의 anchorsOf 와 같은 셈. */
function repoAnchors() {
  const m = new Map();
  for (const d of DOCS) {
    const { html } = renderMarkdown(readFileSync(join(ROOT, d.path), 'utf8'));
    m.set(d.id, new Set([...html.matchAll(/id="([^"]+)"/g)].map(x => x[1])));
  }
  return m;
}

test('도움말 ? 표의 문서 id 와 앵커가 모두 실제 문서에 있다', () => {
  assert.ok(HELP_LINKS.length >= 8, '영상 단계 · 파일 메뉴 · 팝업의 `?` 가 표에 있어야 한다');
  for (const l of HELP_LINKS) assert.ok(['tutorial', 'features'].includes(l.doc), `${l.key}: 도움말은 튜토리얼이나 기능 설명서로 간다`);
  assert.deepEqual(missingHelpAnchors(HELP_LINKS, repoAnchors(), resolveDoc), []);
});

test('허공을 가리키는 ? 앵커는 줄과 함께 붉어진다', () => {
  const bad = [
    { key: 'ok', doc: 'tutorial', anchor: '첫-실행', what: '' },
    { key: 'gone', doc: 'tutorial', anchor: '없어진-절', what: '' },
    { key: 'nodoc', doc: 'nowhere', anchor: 'x', what: '' },
  ];
  const problems = missingHelpAnchors(bad, repoAnchors(), resolveDoc);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /'gone'.*#없어진-절/);
  assert.match(problems[1], /'nodoc'.*nowhere/);
  // 화면의 키와 표도 서로 맞춘다 — 표에 없는 키, 쓰이지 않는 줄이 둘 다 찍힌다
  const keys = unmatchedHelpKeys([{ key: 'a' }, { key: 'b' }], ['a', 'c']);
  assert.deepEqual(keys.length, 2);
  assert.ok(keys.some(p => p.includes('"c"')) && keys.some(p => p.includes("'b'")));
});

test('문서 갈래는 도움말과 개발 둘이고 튜토리얼 · 기능 · 바뀐 것은 도움말이다', () => {
  assert.deepEqual(DOC_GROUPS.map(g => [g.id, g.label]), [['help', '도움말'], ['dev', '개발']]);
  assert.equal(DOC_GROUPS.find(g => g.id === 'dev').hidden, true, '개발 갈래는 평소에 접혀 있다');
  const groupOf = (id) => DOCS.find(d => d.id === id)?.group;
  for (const id of ['tutorial', 'features', 'history']) assert.equal(groupOf(id), 'help', `${id} 는 도움말`);
  for (const id of ['principles', 'bugs', 'architecture']) assert.equal(groupOf(id), 'dev', `${id} 는 개발`);
  assert.ok(resolveDoc('principles'), '숨긴 갈래의 문서도 링크 · 주소로는 열린다');
});
