// tests/unit/strings.test.mjs — 라벨 문자열 표와 용어집 (RM-10)
//
// 앞의 시험 넷은 계획서(docs/roadmap/plans/RM-10.md)의 「요구 ↔ 시험」 표 1 · 2 · 3 · 5 이고 이름이 표와 같아야 한다.
// 표의 글자는 마크업에도 남아 있다(처음 그릴 때 빈 단추가 뜨지 않게) — 둘이 어긋나면 여기서 붉어진다(원칙 D-14).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABELS, fill, str } from '../../src/domain/strings.js';
import { COMMANDS } from '../../src/domain/commands.js';
import { DOCS } from '../../src/ui/docsRegistry.js';
import { collectScreenTexts } from '../../tools/docLabels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const HTML = read('index.html');

/** src/ 의 JS 전부 — { 상대경로: 원문 }. */
function srcFiles() {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files[relative(ROOT, p).replaceAll('\\', '/')] = readFileSync(p, 'utf8');
    }
  };
  walk(join(ROOT, 'src'));
  return files;
}

/** 마크업에서 `data-label` 을 단 요소 — 키 · 안쪽 글자 · title · data-title. */
function labelledElements(html) {
  const out = [];
  for (const m of html.matchAll(/<(\w+)\b([^>]*\bdata-label="([^"]+)"[^>]*)>([^<]*)<\/\1>/g)) {
    out.push({
      tag: m[1],
      attrs: m[2],
      key: m[3],
      text: m[4].trim(),
      title: (m[2].match(/(?<![\w-])title="([^"]*)"/) || [])[1],   // data-title 의 꼬리가 아니라 title 속성
      titleKey: (m[2].match(/\bdata-title="([^"]*)"/) || [])[1],
    });
  }
  return out;
}

// ── 「요구 ↔ 시험」 표 1 · 2 · 3 · 5 ────────────────────────────────────────

test('용어집이 문서 등록표에 있고 명사·동사마다 뜻이 한 줄씩 있다', () => {
  const entry = DOCS.find(d => d.path === 'docs/GLOSSARY.md');
  assert.ok(entry, '용어집이 docsRegistry 의 DOCS 에 없다 — 저장소에만 있는 문서는 없는 문서다');
  assert.equal(entry.group, 'help');
  const md = read('docs/GLOSSARY.md');
  const nouns = ['안무표', '영상', '동작', '루틴', '구간', '마커', '마디', '카운트', '박자'];
  const verbs = ['지우기', '삭제', '비우기', '초기화', '내보내기', '저장'];
  const rows = new Map([...md.matchAll(/^\| \*\*([^*]+)\*\* \| (.+) \|$/gm)].map(m => [m[1], m[2].split(' | ')]));
  for (const word of [...nouns, ...verbs]) {
    const cells = rows.get(word);
    assert.ok(cells, `「${word}」 행이 용어집 표에 없다`);
    assert.equal(cells.length, 3, `「${word}」 행은 뜻 · 쓰는 자리 · 헷갈리는 말과의 차이 세 칸이다`);
    for (const c of cells) assert.ok(c.trim(), `「${word}」 행에 빈 칸이 있다`);
  }
  // 동사는 「명사」 표가 아니라 「동사」 표에 있다
  const verbPart = md.slice(md.indexOf('## 동사'), md.indexOf('## 라벨을 짓는 규칙'));
  for (const v of verbs) assert.match(verbPart, new RegExp(`^\\| \\*\\*${v}`, 'm'), `「${v}」 가 동사 표에 없다`);
});

test('문자열 표 — 키가 겹치지 않고 값이 빈칸이 아니며 import 가 없다', () => {
  const src = read('src/domain/strings.js');
  assert.doesNotMatch(src, /^\s*import\s/m, '문자열 표는 import 0개의 순수 데이터다');
  assert.doesNotMatch(src, /\b(?:document|window|localStorage|fetch|Date|Math\.random)\b/, '브라우저 전역을 쓰지 않는다');
  // 객체 리터럴의 겹친 키는 조용히 뒤의 것이 이긴다 — 원문에서 센다
  const keys = [...src.matchAll(/^\s+'([\w.]+)':/gm)].map(m => m[1]);
  const seen = new Set();
  for (const k of keys) {
    assert.ok(!seen.has(k), `키가 겹친다: ${k}`);
    seen.add(k);
  }
  assert.equal(keys.length, Object.keys(LABELS).length, '원문에서 읽은 키 수와 표의 키 수가 다르다 — 읽는 법이 낡았나');
  assert.ok(keys.length >= 40, `표가 ${keys.length}줄뿐이다`);
  for (const [k, v] of Object.entries(LABELS)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.trim(), `${k} 의 값이 빈칸이다`);
    assert.match(k, /^[a-z][\w]*(?:\.[\w]+)+$/, `${k} — 키는 갈래.대상(.title) 꼴이다`);
  }
  assert.ok(Object.isFrozen(LABELS));
  // 명령의 글자는 등록부가 주인이다 — 표에 같은 글자를 다시 적지 않는다
  const commandTexts = new Set(COMMANDS.flatMap(c => [c.label, c.button, c.title]).filter(Boolean));
  for (const [k, v] of Object.entries(LABELS)) assert.ok(!commandTexts.has(v), `${k} = 「${v}」 는 명령 등록부의 글자다 — 표에 다시 적지 않는다`);
});

test('마크업의 data-label 버튼 — 키가 표에 있고 글자가 표의 값과 같다', () => {
  const els = labelledElements(HTML);
  assert.ok(els.length >= 2, `data-label 요소가 ${els.length}개뿐이다 — 읽는 법이 낡았나`);
  for (const el of els) {
    assert.ok(el.key in LABELS, `data-label="${el.key}" 가 표에 없다`);
    assert.equal(el.text, LABELS[el.key], `${el.key} 의 마크업 글자가 표와 다르다 — 둘을 함께 고친다`);
    if (el.title !== undefined) {
      assert.ok(el.titleKey, `${el.key} 에 title 이 있는데 data-title 키가 없다`);
    }
    if (el.titleKey) {
      assert.ok(el.titleKey in LABELS, `data-title="${el.titleKey}" 가 표에 없다`);
      assert.equal(el.title, LABELS[el.titleKey], `${el.titleKey} 의 마크업 툴팁이 표와 다르다`);
    }
    assert.doesNotMatch(el.attrs, /\bdata-command=/, `${el.key} — 명령 단추에는 data-label 을 달지 않는다(글자의 주인은 등록부)`);
  }
  for (const key of ['video.in', 'video.out']) assert.ok(els.some(e => e.key === key), `${key} 단추가 마크업에 없다`);
});

test('용어집과 어긋나던 옛 라벨이 표·등록부·마크업에 남지 않는다', () => {
  const screen = collectScreenTexts({ ...srcFiles(), 'index.html': HTML });
  const old = ['[ In 지금 여기', 'Out ] 지금 여기', '× 삭제', 'Undo 로 되돌릴'];
  for (const label of old) assert.ok(!screen.raw.includes(label), `옛 라벨 「${label}」 이 화면 원문에 남아 있다`);
  for (const word of ['Undo', 'Redo']) assert.doesNotMatch(screen.raw, new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`, 'm'), `영어 「${word}」 가 화면 원문에 남아 있다`);
  for (const c of COMMANDS) {
    for (const text of [c.label, c.button, c.title].filter(Boolean)) {
      assert.ok(!/프로젝트 저장/.test(text), `${c.id} 의 글자에 「프로젝트 저장」 이 남아 있다`);
      assert.doesNotMatch(text, /\b(?:Undo|Redo)\b/, `${c.id} 의 글자에 영어가 남아 있다`);
    }
  }
  assert.doesNotMatch(HTML, />\s*프로젝트 저장\s*</, '마크업의 단추 글자 「프로젝트 저장」');
});

// ── 표 밖에서 덧댄 것 ───────────────────────────────────────────────────────

test('str · fill — 없는 키는 던지고, 구멍은 준 것만 채우며 안 준 구멍은 남긴다', () => {
  assert.equal(str('block.remove'), LABELS['block.remove']);
  assert.throws(() => str('없는.키'), /라벨 표에 없는 키: 없는\.키/);
  assert.equal(fill('video.inout.range', { in: '0:12.3', out: '0:45.0', len: '32.7' }), 'In 0:12.3 · Out 0:45.0 · 길이 32.7초');
  assert.equal(fill('routine.swatch.title', { n: 3 }), '색 3');
  assert.equal(fill('move.card.drag', {}), '{name} 드래그', '안 준 구멍은 그대로 — 무엇이 빠졌는지 화면에서 보이게');
  assert.equal(fill('block.remove'), LABELS['block.remove'], 'vars 가 없어도 던지지 않는다');
});

test('src 가 부르는 키(str · fill · data-label · data-title)가 모두 표에 있다 — 이름으로 잇는 배선은 표끼리 센다', () => {
  const used = new Map();
  for (const [path, text] of Object.entries(srcFiles())) {
    for (const m of text.matchAll(/\b(?:str|fill)\(\s*'([^']+)'/g)) used.set(m[1], path);
  }
  for (const el of labelledElements(HTML)) {
    used.set(el.key, 'index.html');
    if (el.titleKey) used.set(el.titleKey, 'index.html');
  }
  assert.ok(used.size >= 30, `부르는 자리가 ${used.size}곳뿐이다 — 읽는 법이 낡았나`);
  for (const [key, path] of used) assert.ok(key in LABELS, `${path} 가 부르는 키 '${key}' 가 표에 없다`);
  // 거꾸로 — 표에 있는데 아무도 부르지 않는 줄은 죽은 글자다
  const unused = Object.keys(LABELS).filter(k => !used.has(k));
  assert.deepEqual(unused, [], '아무도 부르지 않는 키 — 표에서 지우거나 부르는 자리를 둔다');
});

test('구멍이 있는 값은 fill 로, 없는 값은 str 로 부른다', () => {
  const src = Object.values(srcFiles()).join('\n');
  for (const [k, v] of Object.entries(LABELS)) {
    const holes = /\{\w+\}/.test(v);
    const viaStr = new RegExp(`\\bstr\\(\\s*'${k.replace(/\./g, '\\.')}'`).test(src);
    if (holes) assert.ok(!viaStr, `${k} 에는 구멍이 있는데 str 로 부른다 — fill 로 채운다`);
  }
});
