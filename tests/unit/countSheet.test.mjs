// tests/unit/countSheet.test.mjs — 카운트 시트 내보내기 (RM-21)
//
// 세 층을 본다.
//   ① 글(domain/countSheet) — 마디 하나가 한 줄, 머리는 cellLabel 의 행 부분과 같다. 읽기는 안무 계획 꼴로 바꿔 normalizePlan 을 지난다.
//      안무표 → 글 → 안무표 왕복에서 겹친 층 · 마디를 넘는 블록 · intro · 빈 칸이 그대로다
//   ② 읽기 전용 HTML(domain/sheetHtml) — 한 파일, 바깥 참조 없음, 이스케이프, 유튜브 마커 링크
//   ③ 유스케이스(usecases/sheetCommands) — 주입한 fileIO 만 부른다
//
// 시험 이름은 계획서(docs/roadmap/plans/RM-21.md)의 요구 ↔ 시험 표와 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCountSheet, parseCountSheet, rowBody } from '../../src/domain/countSheet.js';
import { buildSheetHtml, escapeHtml, clock } from '../../src/domain/sheetHtml.js';
import { cellLabel, normalizePlan, rowLabel } from '../../src/domain/choreoPlan.js';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import { createAndPlace } from '../../src/usecases/paletteCommands.js';
import { counterEnv } from '../../src/ports/env.js';
import * as Sheet from '../../src/usecases/sheetCommands.js';
import { readFileSync, readdirSync } from 'node:fs';

const seg = (groupId, row, startIndex, length, extra = {}) =>
  ({ id: `${groupId}-${row}-${startIndex}`, groupId, name: groupId, category: 'step', row, startIndex, length, subRow: 0, ...extra });

/** 8x4 메인 보드(intro 행 0 + 1..4). */
const board = (placements, rows = 4) => ({ rows, cols: 8, hasIntroRow: true, placements });

const LIB = [
  { id: 'm1', name: 'Swing Out', category: 'step' },
  { id: 'm2', name: 'Kick Ball Change', category: 'step' },
  { id: 'm3', name: 'Shim Sham', category: 'step' },
  { id: 'm4', name: 'Clap', category: 'jump' },
];
const CATS = { step: { label: '스텝', color: '#86efac' }, jump: { label: '점프', color: '#fca5a5' } };

/** 겹친 두 층 · 마디를 넘는 블록 · intro · 빈 칸이 다 든 견본. */
const SAMPLE = board([
  seg('Swing Out', 0, 4, 4),                                  // intro 뒤쪽 4칸
  seg('Swing Out', 1, 0, 4, { id: 'so-1', groupId: 'g1' }),   // 8x1 1~4
  seg('Kick Ball Change', 1, 4, 4, { groupId: 'g2' }),        // 8x1 5~8
  seg('Shim Sham', 2, 2, 6, { groupId: 'g3' }),               // 8x2 3~8 → 8x3 1~2 (마디를 넘는다)
  seg('Shim Sham', 3, 0, 2, { groupId: 'g3' }),
  seg('Clap', 2, 4, 2, { groupId: 'g4', subRow: 1, category: 'jump' }), // 8x2 5~6 겹친 1층
  seg('Clap', 3, 6, 1, { groupId: 'g5', category: 'jump' }),  // 8x3 7 — 뒤 한 칸이 빈다
  // 8x4 는 빈 행
]);

// ── ① 글 ──────────────────────────────────────────────────────────────────────

test('countSheet: 마디 하나를 한 줄로 — 행 라벨은 cellLabel 과 같은 intro · 8xN 이다', () => {
  const text = writeCountSheet(SAMPLE);
  assert.deepEqual(text.split('\n'), [
    'intro · 5 Swing Out',
    '8x1 · 1 Swing Out · 5 Kick Ball Change',
    '8x2 · 3 Shim Sham [8] / 5 Clap [2]',   // 8카운트 — 8x3 의 1~2 까지 이어진다
    '8x3 · 7 Clap [1]',
    '8x4 · -',
  ]);
  // 줄 머리는 미리보기 표의 cellLabel(row, 0, cols) 의 앞부분이다
  text.split('\n').forEach((line, row) => {
    const head = line.split(' · ')[0];
    assert.equal(head, rowLabel(row, 8));
    assert.ok(cellLabel(row, 0, 8).startsWith(`${head} · `), `${head} 가 cellLabel 과 다르다`);
  });
  // 로드맵 예시 그대로 — 다음 동작까지 꽉 차면 길이를 적지 않는다
  assert.equal(rowBody({ cols: 8 }, [{ start: 0, length: 4, lane: 0, name: 'Swing Out' }, { start: 4, length: 4, lane: 0, name: 'Kick Ball Change' }]),
    '1 Swing Out · 5 Kick Ball Change');
  // 제목은 첫 줄 · 이름 없는 블록은 ? · 루틴은 ▶ · 0층이 비고 1층만 있으면 - 로 자리를 둔다
  const odd = board([seg('?', 1, 0, 2, { pending: true, name: '' }), seg('Basic', 1, 2, 2, { type: 'routine', routineId: 'r1', subRow: 1 })], 1);
  assert.deepEqual(writeCountSheet(odd, { title: '링디합' }).split('\n'), ['링디합', 'intro · -', '8x1 · 1 ? [2] / 3 ▶ Basic [2]']);
  // 이름 속의 문법 글자(· / [ ])는 한 칸으로 눌린다
  assert.equal(writeCountSheet(board([seg('A · B / C [2]', 1, 0, 8)], 1)).split('\n')[1], '8x1 · 1 A B C 2');
});

test('countSheet: 읽은 글은 normalizePlan 을 지나 없는 이름은 newMoves, 이상한 줄은 dropped 로 간다', () => {
  const text = [
    '내 안무',
    'intro · -',
    '8x1 · 1 swing out · 5 Kick Ball Change',   // 느슨한 이름(대소문자)
    '8x2 · 1 Suzie Q [4] · 7 Clap',             // 목록에 없는 이름 → 새 동작
    '여기는 설명 줄',                             // 머리 없음 → 버림
    '8x3 · Boogie Back · 3 ▶ Basic / 5 ?',      // 카운트 없음 → 버림 · 루틴 머리는 뗀다 · ? 는 버림
    '',
  ].join('\n');
  const parsed = parseCountSheet(text);
  assert.equal(parsed.title, '내 안무');
  assert.equal(parsed.cols, 8);
  assert.equal(parsed.rows, 3);
  assert.deepEqual(parsed.moves, [
    { bar: 1, count: 1, length: 4, name: 'swing out', lane: 0 },
    { bar: 1, count: 5, length: 4, name: 'Kick Ball Change', lane: 0 },
    { bar: 2, count: 1, length: 4, name: 'Suzie Q', lane: 0 },
    { bar: 2, count: 7, length: 2, name: 'Clap', lane: 0 },
    { bar: 3, count: 3, length: 6, name: 'Basic', lane: 0 },
  ]);
  assert.deepEqual(parsed.dropped.map(d => d.line), ['여기는 설명 줄', 'Boogie Back', '5 ?']);
  assert.ok(parsed.dropped.every(d => d.reason), '버린 줄마다 이유가 있다');

  // 그대로 normalizePlan 을 지난다 — 플랜 꼴(bar · count · length · name)이라 새 길이 없다
  const plan = normalizePlan({ title: parsed.title, moves: parsed.moves }, { cols: parsed.cols, rows: parsed.rows, library: LIB, categories: CATS });
  assert.equal(plan.title, '내 안무');
  assert.equal(plan.items[0].name, 'Swing Out', '느슨하게 맞춘 이름은 목록의 표기로');
  assert.equal(plan.items[0].moveId, 'm1');
  assert.deepEqual(plan.newMoves, ['Suzie Q', 'Basic']);
  assert.deepEqual(plan.dropped, []);
  assert.deepEqual(plan.items.map(i => [i.row, i.index, i.length]), [[1, 0, 4], [1, 4, 4], [2, 0, 4], [2, 6, 2], [3, 2, 6]]);

  // intro 줄만 있으면 cols 는 기본 8(또는 options.cols)
  assert.equal(parseCountSheet('intro · 1 Clap').cols, 8);
  assert.equal(parseCountSheet('intro · 1 Clap', { cols: 6 }).moves[0].length, 6);
  assert.deepEqual(parseCountSheet('').moves, []);
});

test('countSheet: 안무표 → 글 → 안무표 왕복 — 겹친 두 층 · 마디를 넘는 블록 · intro · 빈 칸이 그대로', () => {
  const text = writeCountSheet(SAMPLE);
  const parsed = parseCountSheet(text);
  assert.equal(parsed.rows, 4, '빈 8x4 행도 행 수에 든다');
  const plan = normalizePlan({ moves: parsed.moves }, { cols: parsed.cols, rows: parsed.rows, library: LIB, categories: CATS });
  assert.deepEqual(plan.dropped, []);
  assert.deepEqual(plan.newMoves, []);

  // 「말로 채우기」와 같은 길로 빈 보드에 놓는다 — 겹침 · 층 · 마디 넘김 규칙은 boardOps.place 의 것이다
  const store = createStore({ ids: counterEnv() });
  store.setBoard(BOARD_MAIN, { rows: plan.rowsNeeded, placements: [] });
  const ctx = { store, ids: counterEnv(), dialogs: {}, storage: {} };
  store.update({ library: LIB.map(m => ({ ...m })) });
  for (const it of plan.items) createAndPlace(ctx, BOARD_MAIN, it.name, it.category, it.row, it.index, it.length);

  const key = (p) => `${p.row}:${p.startIndex}:${p.length}:${p.name}:${p.subRow || 0}`;
  const got = store.board(BOARD_MAIN).placements.map(key).sort();
  const want = SAMPLE.placements.map(key).sort();
  assert.deepEqual(got, want);
  // 겹친 두 층의 차례: 같은 자리에서 Shim Sham 이 0층, Clap 이 1층이다
  const row2 = store.board(BOARD_MAIN).placements.filter(p => p.row === 2);
  assert.equal(row2.find(p => p.name === 'Shim Sham').subRow, 0);
  assert.equal(row2.find(p => p.name === 'Clap').subRow, 1);
  // 마디를 넘는 블록은 한 그룹 두 세그먼트로 돌아온다
  const shim = store.board(BOARD_MAIN).placements.filter(p => p.name === 'Shim Sham');
  assert.equal(new Set(shim.map(p => p.groupId)).size, 1);
  assert.deepEqual(shim.map(p => [p.row, p.startIndex, p.length]).sort(), [[2, 2, 6], [3, 0, 2]]);
  // 다시 쓰면 같은 글이다
  assert.equal(writeCountSheet(store.board(BOARD_MAIN)), text);
});

// ── ② 읽기 전용 HTML ───────────────────────────────────────────────────────────

test('sheetHtml: 한 파일 안에 다 있고 import · fetch · script src · link href 가 없다', () => {
  const html = buildSheetHtml({ title: '링디합', board: SAMPLE, categories: CATS, generatedOn: '2026-11-02' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<style>[\s\S]+<\/style>/, '스타일이 안에 있다');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\bimport\b\s*[({'"]/);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /\ssrc=/i);
  // 미리 그린 표와 텍스트 시트가 다 들어 있다
  assert.match(html, /<table class="sheet">/);
  assert.match(html, /<th class="label">intro<\/th>/);
  assert.match(html, /<th class="label" rowspan="2">8x2<\/th>/, '겹친 행은 층 수만큼 rowspan');
  assert.match(html, /<td class="block" colspan="6"[^>]*>Shim Sham<\/td>/, '마디 안의 길이만큼 colspan');
  assert.match(html, /<td class="block cont" colspan="2"[^>]*>↳ Shim Sham<\/td>/, '넘어온 세그먼트는 이어짐 표시');
  assert.match(html, /<td class="block" colspan="2" style="background:#fca5a5"[^>]*>Clap<\/td>/, '카테고리 색');
  assert.match(html, /<pre>링디합\nintro · 5 Swing Out\n8x1 · 1 Swing Out · 5 Kick Ball Change\n/);
  assert.match(html, /만든 날 2026-11-02/);
  assert.match(html, /블록 6개/);
});

test('sheetHtml: 제목 · 동작 이름의 <script> · 따옴표 · & 를 이스케이프한다', () => {
  const evil = '<script>alert(1)</script>';
  const html = buildSheetHtml({
    title: `${evil} "A" & B`,
    board: board([seg(`${evil} 'x' & "y"`, 1, 0, 4, { category: '<b>' })], 1),
    categories: { '<b>': { label: '<b>', color: 'red;background:url(x)' } },
    video: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=abc', markers: [{ inSec: 1, outSec: 2, fromCount: 8, toCount: 10, label: `<img src=x onerror=alert(1)>` }] }
  });
  assert.doesNotMatch(html, /<script/i, '날 태그가 남지 않는다');
  assert.doesNotMatch(html, /<img/i, '마커 이름표도');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, '글자로만 남는다');
  assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;A&quot; &amp; B<\/title>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &#39;x&#39; &amp; &quot;y&quot;<\/td>/);
  assert.match(html, /title="&lt;b&gt;"/, '속성 값도');
  assert.match(html, /style="background:#e5e7eb"/, '색이 #rrggbb 꼴이 아니면 기본 색');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('sheetHtml: 유튜브 영상이면 마커마다 t= 시각 링크, 로컬 영상이면 링크 없이 이름 · 시각만', () => {
  const markers = [
    { id: 'a', inSec: 83.7, outSec: 97.2, fromCount: 8, toCount: 16, label: '첫 코러스' },
    { id: 'b', inSec: 130, outSec: 140, fromCount: 24, toCount: 32, label: '' },
  ];
  const yt = buildSheetHtml({ board: SAMPLE, video: { kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ?t=10', markers } });
  assert.match(yt, /<a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=83" target="_blank" rel="noopener">1:23 ~ 1:37<\/a> 첫 코러스 <span class="muted">8x1 · 1 ~ 8x1 · 8<\/span>/, '정수 초 t= 링크');
  assert.match(yt, /&t=130" target="_blank" rel="noopener">2:10 ~ 2:20<\/a> 8x3 · 1 ~ 8x3 · 8<\/li>/, '이름표가 없으면 구간이 이름이다');
  assert.equal((yt.match(/<a href="https:\/\/www\.youtube\.com\/watch\?v=/g) || []).length, 2, '마커 하나에 링크 하나');

  const local = buildSheetHtml({ board: SAMPLE, video: { kind: 'file', name: 'take1.mp4', markers } });
  assert.doesNotMatch(local, /<a /, '로컬 영상에는 링크가 없다');
  assert.match(local, /take1\.mp4 <span class="muted">\(내 컴퓨터의 영상 파일/);
  assert.match(local, /<span class="time">1:23 ~ 1:37<\/span> 첫 코러스/);

  assert.doesNotMatch(buildSheetHtml({ board: SAMPLE }), /<section class="video">/, '영상이 없으면 절이 없다');
  assert.match(buildSheetHtml({ board: SAMPLE, video: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=x', markers: [] } }), /마커가 없다/);
  assert.equal(clock(83.7), '1:23');
  assert.equal(clock(-3), '0:00');
});

// ── ③ 유스케이스 ──────────────────────────────────────────────────────────────

test('sheetCommands: 내보내기는 주입한 fileIO 의 copyText · downloadText 만 부르고 DOM 을 만지지 않는다', async () => {
  const store = createStore({ ids: counterEnv() });
  store.setBoard(BOARD_MAIN, { rows: 4, placements: SAMPLE.placements });
  store.update({ categories: CATS });
  const calls = [];
  const files = new Proxy({}, {
    get: (_, name) => (...args) => { calls.push([name, ...args]); return name === 'copyText'; }
  });
  const deps = { store, files, env: { localDate: () => '2026-11-02' } };
  assert.equal(typeof globalThis.document, 'undefined', '이 시험은 DOM 없이 돈다');

  // 복사 — 글은 이름칸의 이름을 첫 줄에 둔다
  const copied = await Sheet.copySheetText(deps, { fileName: ' 링디합 ' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'copyText');
  assert.equal(calls[0][1], ['링디합', ...writeCountSheet(SAMPLE).split('\n')].join('\n'));
  assert.equal(copied.notify.kind, 'status');
  assert.match(copied.notify.message, /6줄/);

  // HTML 내려받기 — 파일 이름은 <이름>-sheet.html, mime 은 text/html, 내용은 buildSheetHtml 그대로
  calls.length = 0;
  const d = Sheet.downloadSheetHtml(deps, { fileName: '링디합..' });
  assert.deepEqual(calls.map(c => [c[0], c[2], c[3]]), [['downloadText', '링디합-sheet.html', 'text/html']]);
  assert.equal(calls[0][1], Sheet.sheetHtml(deps, { title: '링디합' }));
  assert.match(calls[0][1], /<h1>링디합<\/h1>/);
  assert.match(calls[0][1], /만든 날 2026-11-02/);
  assert.match(d.notify.message, /링디합-sheet\.html/);
  assert.equal(Sheet.sheetFileName(''), '안무표', '이름이 비면 기본 이름');

  // 인쇄 — print 만 부른다. 빈 안무표는 부르지 않고 알림만
  calls.length = 0;
  assert.deepEqual(Sheet.printSheet(deps), {});
  assert.deepEqual(calls, [['print']]);
  calls.length = 0;
  store.setBoard(BOARD_MAIN, { placements: [] });
  assert.match(Sheet.printSheet(deps).notify.message, /비어 있습니다/);
  assert.deepEqual(calls, []);

  // 클립보드가 막히면 오류 알림이고 던지지 않는다
  const blocked = { ...deps, files: { copyText: async () => { throw new Error('denied'); } } };
  assert.equal((await Sheet.copySheetText(blocked, {})).notify.kind, 'error');
  const refused = { ...deps, files: { copyText: () => false } };
  assert.equal((await Sheet.copySheetText(refused, {})).notify.kind, 'error');

  // 영상 요약 — 활성 클립의 종류 · 주소 · 마커
  store.update({ media: { activeId: 'c1', clips: [{ id: 'c1', name: 'take', source: { kind: 'youtube', url: 'https://youtu.be/abc' }, markers: [{ inSec: 1, outSec: 2, fromCount: 0, toCount: 8, label: '' }] }] } });
  const video = Sheet.sheetVideo(store.get());
  assert.equal(video.kind, 'youtube');
  assert.equal(video.url, 'https://youtu.be/abc');
  assert.deepEqual(video.markers.map(m => [m.inSec, m.outSec, m.fromCount, m.toCount]), [[1, 2, 0, 8]], '정규화된 마커(id 가 채워진다)');
  store.update({ media: { activeId: 'c2', clips: [{ id: 'c2', name: 'take1.mp4', source: { kind: 'file', name: 'take1.mp4' }, markers: [] }] } });
  assert.deepEqual(Sheet.sheetVideo(store.get()), { kind: 'file', name: 'take1.mp4', markers: [] });
});

// 브라우저 시험에서 찾은 결함(RM-21): 사이드바는 `panel sidebar` 인데, 인쇄 블록의 「보이게」 규칙에 `.panel` 이 있어
// 같은 무게의 뒤 규칙이 `.sidebar { display: none }` 을 이겨 동작 목록이 종이에 나왔다.
// @complexity time=O(n) space=O(n) cc=4
function printRevivesHidden(html) {
  const block = (html.match(/@media print \{([\s\S]*?)\n {4}\}/) || [])[1] || '';
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, ''), body: m[2] }));
  const classesOf = (sel) => new Set(sel.split(',').map(x => x.trim()).filter(x => /^\.[\w-]+$/.test(x)).map(x => x.slice(1)));
  const hiddenIdx = rules.findIndex(r => /display:\s*none/.test(r.body) && classesOf(r.sel).has('sidebar'));
  const hidden = classesOf(rules[hiddenIdx].sel);
  const revived = [];
  for (const r of rules.slice(hiddenIdx + 1)) {
    if (!/display:\s*block/.test(r.body)) continue;
    for (const cls of classesOf(r.sel)) {
      // 클래스 낱말이 꼭 그것인 요소만 — 정규식의 \b 는 `-` 를 경계로 봐서 `board` 가 `board-empty` 에도 걸렸다(RM-46)
      const owners = [...html.matchAll(new RegExp(`class="([^"]*\\b${cls}\\b[^"]*)"`, 'g'))].map(m => m[1].split(/\s+/)).filter(list => list.includes(cls));
      if (owners.some(list => list.some(c => hidden.has(c)))) revived.push(cls);
    }
  }
  return revived;
}

test('print: 인쇄 블록의 「보이게」 규칙이 숨긴 사이드바 · 영상 칸을 같은 무게로 되살리지 않는다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.deepEqual(printRevivesHidden(html), []);
  // 고치기 전 꼴을 넣으면 붉어진다 — 검사기가 실제로 그 결함을 잡는지
  const before = html.replace('      .workspace, .boards-container,', '      .panel, .workspace, .boards-container,');
  assert.notEqual(before, html);
  assert.deepEqual(printRevivesHidden(before), ['panel']);
});

// RM-44: 처음 안내 말풍선(.coachmark)은 ui/coachmarks.js 가 따로 넣는 스타일이라 RM-21 의 숨김 목록에서 빠졌다 —
// 말풍선이 열린 채 인쇄하면 position:fixed 라 Chrome 에서 모든 쪽에 찍혔다(headless Chrome 인쇄 매체로 재현).
/** 인쇄 블록의 규칙을 { sel, body } 로 읽는다. printRevivesHidden 과 같은 꼴로 블록을 자른다. */
// @complexity time=O(n) space=O(n) cc=1
function printRules(html) {
  const block = (html.match(/@media print \{([\s\S]*?)\n {4}\}/) || [])[1] || '';
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] }));
}
/** 인쇄 블록에서 display:none 을 받는 클래스 모음 — 숨김 규칙이 여럿이면 모두 합친다. */
// @complexity time=O(n) space=O(n) cc=2
function printHiddenClasses(html) {
  const hidden = new Set();
  for (const r of printRules(html)) {
    if (!/display:\s*none/.test(r.body)) continue;
    for (const x of r.sel.split(',').map(s => s.trim())) if (/^\.[\w-]+$/.test(x)) hidden.add(x.slice(1));
  }
  return hidden;
}

test('print: 인쇄 블록이 처음 안내 말풍선(.coachmark)을 숨긴다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(printHiddenClasses(html).has('coachmark'), '인쇄 숨김 목록에 .coachmark 가 없다 — 말풍선이 종이에 찍힌다');
  // 고치기 전 꼴(목록에서 뺀 것)을 넣으면 붉어진다 — 검사기가 실제로 그 결함을 잡는지
  const before = html.replace(/,\s*\.coachmark(?=[\s,{])/, '');
  assert.notEqual(before, html);
  assert.equal(printHiddenClasses(before).has('coachmark'), false);
});

test('print: 인쇄 블록이 안내 대상 강조([data-coach]) 애니메이션 · 그림자를 걷는다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const rule = printRules(html).find(r => r.sel.split(',').some(s => /^\[data-coach(="1")?\]$/.test(s.trim())));
  assert.ok(rule, '인쇄 블록에 [data-coach] 규칙이 없다 — 대상의 숨 쉬는 강조가 종이에 찍힌다');
  // coachmarks.js 의 <style> 이 index.html 의 인쇄 규칙보다 뒤에 들어오므로 !important 가 있어야 이긴다
  assert.match(rule.body, /animation:\s*none\s*!important/);
  assert.match(rule.body, /box-shadow:\s*none\s*!important/);
});

// ── RM-45: 인쇄 격자 너비가 화면 칸 너비를 따랐다 ────────────────────────────────────────────────
// 칸 너비 --cellW 는 JS(ui/layout)가 그때 화면 폭으로 재어 html 에 적은 px 라, 인쇄에서도 그 값을 물려받았다 —
// 폰 폭 390(37px)에서는 격자가 종이의 절반 남짓만 쓰고, 2560(168px)에서는 7·8카운트가 종이 밖으로 나갔다
// (headless Chrome 의 인쇄 매체로 재현: 칸 오른끝 348 · 1436px, 종이 718px). 아래 시험은 인쇄 블록의 식을
// 화면 값 몇 벌로 **셈해** 격자 합이 늘 종이 폭인지 본다. 이름은 계획서(docs/roadmap/plans/RM-45.md)의 표와 같다.

const PX_PER_MM = 96 / 25.4;
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,|\))/;

/** 선언 몸통을 { 속성: 값 } 으로 — 주석과 !important 는 걷는다. 괄호 안의 `;` 는 없다고 본다(인쇄 블록이 그렇다). */
// @complexity time=O(n) space=O(n) cc=2
function declsOf(body) {
  const out = {};
  for (const d of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).replace(/!\s*important/, '').trim();
  }
  return out;
}

/** 값 안의 var() 를 env 로 바꾼다 — 물러섬(var(--a, 물러섬))과 겹친 var() 를 안쪽부터 푼다. */
// @complexity time=O(n^2) space=O(n) cc=6
function substVars(value, env) {
  let s = value;
  for (let guard = 0; guard < 50; guard++) {
    const at = s.search(VAR_RE);
    if (at < 0) return s;
    let depth = 0, end = at + 3, comma = -1;
    for (; end < s.length; end++) {
      if (s[end] === '(') depth++;
      else if (s[end] === ')') { depth--; if (depth === 0) break; }
      else if (s[end] === ',' && depth === 1 && comma < 0) comma = end;
    }
    const name = s.slice(at + 4, comma < 0 ? end : comma).trim();
    const fallback = comma < 0 ? null : s.slice(comma + 1, end).trim();
    const got = env[name] != null ? env[name] : fallback;
    if (got == null) throw new Error(`${name} 가 정해지지 않았다`);
    s = s.slice(0, at) + got + s.slice(end + 1);
  }
  throw new Error('var() 를 다 풀지 못했다');
}

/** CSS 길이 식(calc · min · max · px · mm · 맨 수)을 px 로 셈한다. */
// @complexity time=O(n) space=O(n) cc=2
function cssPx(value, env) {
  const js = substVars(value, env)
    .replace(/\bcalc\(/g, '(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(')
    .replace(/(\d*\.?\d+)mm\b/g, (_, n) => `(${n}*${PX_PER_MM})`).replace(/(\d*\.?\d+)px\b/g, '($1)');
  if (/[^\d\s.+\-*/(),Mathinmax]/.test(js)) throw new Error(`셈할 수 없는 글자: ${js}`);
  return Function(`return (${js});`)();
}

/** 인쇄 블록에서 셀렉터가 꼭 그것인 규칙의 선언. */
// @complexity time=O(n) space=O(n) cc=1
const printDecls = (html, sel) => Object.assign({}, ...printRules(html).filter(r => r.sel === sel).map(r => declsOf(r.body)));

/** @page 의 종이 폭(mm) — A4 · 여백 하나짜리만 읽는다. */
// @complexity time=O(1) space=O(1) cc=2
function pageContentMm(html) {
  const page = printDecls(html, '@page');
  const sheet = { A4: 210, A5: 148, A3: 297 }[page.size];
  const margin = parseFloat(page.margin);
  return sheet && Number.isFinite(margin) ? sheet - 2 * margin : null;
}

/** createBoardView 로 cols 칸 보드를 가짜 DOM 에 세우고, 보드에 적힌 변수 · 머리 줄의 격자 틀을 돌려준다. */
// @complexity time=O(r*c) space=O(r*c) cc=1
async function buildBoard(cols) {
  const make = () => {
    const props = {};
    const el = {
      className: '', textContent: '', innerHTML: '', dataset: {}, children: [],
      style: { setProperty(k, v) { props[k] = String(v); }, getPropertyValue: (k) => props[k] ?? '' },
      append(...kids) { el.children.push(...kids); }, appendChild(c) { el.children.push(c); return c; },
    };
    return el;
  };
  const had = 'document' in globalThis;
  globalThis.document = { createElement: make };
  try {
    const { createBoardView } = await import('../../src/ui/boardView.js');
    const el = make();
    createBoardView({ el, boardId: 'main' }).rebuild({ rows: 2, cols, hasIntroRow: false });
    return { cols: el.style.getPropertyValue('--cols'), headerTemplate: el.children[0].style.gridTemplateColumns };
  } finally {
    if (!had) delete globalThis.document;
  }
}

/** 화면 값 env(html · .board-wrap 인라인)로 인쇄의 머리 줄 격자 합(px)을 셈한다 — 행 라벨 + 칸 × cols + 비고 + 틈 둘. */
// @complexity time=O(n) space=O(n) cc=2
function printGridPx(html, headerTemplate, cols, screen) {
  const wrapDecl = printDecls(html, '.board-wrap');
  const boardDecl = printDecls(html, '.board-wrap .board');
  const wrap = { ...screen };
  for (const [k, v] of Object.entries(wrapDecl)) if (k.startsWith('--')) wrap[k] = v;
  const board = { ...wrap, '--cols': String(cols) };
  for (const [k, v] of Object.entries(boardDecl)) if (k.startsWith('--')) board[k] = `${cssPx(v, { ...wrap, '--cols': String(cols) })}px`;
  // 머리 줄의 세 칸 — boardView 가 적은 틀을 최상위 빈칸에서 자른다
  const parts = []; let depth = 0, cur = '';
  for (const ch of headerTemplate) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  const gap = cssPx(printDecls(html, '.board-header, .board-row').gap, board);
  return parts.reduce((sum, p) => sum + cssPx(p, board), 0) + gap * (parts.length - 1);
}

const SCREENS = [
  { name: '폰 390', '--cellW': '37px', '--rowLabelW': '48px', '--noteW': '0px', '--noteCol': '0px' },
  { name: '1280', '--cellW': '76px', '--rowLabelW': '88px', '--noteW': '120px' },
  { name: '2560', '--cellW': '168px', '--rowLabelW': '88px', '--noteW': '280px' },
];

test('print: 인쇄 블록이 칸 너비를 종이 너비 · 칸 수로 다시 정한다 [RM-45 요구 0]', async () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const paperMm = pageContentMm(html);
  assert.equal(paperMm, 190, '@page 가 A4 · 여백 10mm 로 못박혀 있다');
  assert.equal(cssPx(printDecls(html, '.board-wrap')['--printW'], {}), 190 * PX_PER_MM, '칸 너비 식의 종이 폭이 @page 와 짝이다');
  const { headerTemplate } = await buildBoard(8);
  const sums = SCREENS.map(s => printGridPx(html, headerTemplate, 8, s));
  for (const [i, sum] of sums.entries()) assert.ok(Math.abs(sum - paperMm * PX_PER_MM) < 0.01, `${SCREENS[i].name}: 격자 합 ${sum.toFixed(2)}px 가 종이 폭 ${(paperMm * PX_PER_MM).toFixed(2)}px 와 같다`);
  // 고치기 전 꼴(칸 너비 식이 없어 화면 --cellW 를 물려받는다)을 넣으면 화면마다 합이 달라 붉어진다
  const before = html.replace(/\n\s*--cellW: calc\(\(var\(--printW\)[^;]*;/, '');
  assert.notEqual(before, html);
  const beforeSums = SCREENS.map(s => printGridPx(before, headerTemplate, 8, s));
  assert.ok(beforeSums.some(sum => Math.abs(sum - paperMm * PX_PER_MM) > 1), `고치기 전에는 종이 폭과 다르다: ${beforeSums.map(Math.round)}`);
});

test('print: 넓은 화면 칸 너비여도 인쇄 격자 합이 종이 폭을 넘지 않는다 [RM-45 요구 1]', async () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const paperPx = 190 * PX_PER_MM;
  const { headerTemplate } = await buildBoard(8);
  const wide = { '--cellW': '168px', '--rowLabelW': '88px', '--noteW': '280px' };
  for (const screen of [wide, { ...wide, '--noteCol': '0px' }]) {
    const sum = printGridPx(html, headerTemplate, 8, screen);
    assert.ok(sum <= paperPx + 0.01, `격자 합 ${sum.toFixed(1)}px ≤ 종이 ${paperPx.toFixed(1)}px (비고 ${screen['--noteCol'] ? '숨김' : '있음'})`);
  }
  // 비고 열은 종이의 25% 안으로 준다 — 화면의 280px(≈74mm) 비고가 칸을 누르지 않는다
  const wrap = { ...wide, ...Object.fromEntries(Object.entries(printDecls(html, '.board-wrap')).filter(([k]) => k.startsWith('--'))) };
  assert.ok(cssPx(wrap['--printNoteW'], wrap) <= paperPx * 0.25 + 0.01, '인쇄 비고 폭은 종이의 25% 이하');
  assert.equal(cssPx(wrap['--printNoteW'], { ...wrap, '--noteCol': '0px' }), 0, '비고를 숨긴 표는 비고 폭이 0');
  assert.match(printDecls(html, '.note-cell')['white-space'] || '', /normal/, '줄어든 비고 칸에서 긴 비고는 줄을 바꾼다');
});

test('print: 인쇄 칸 너비는 .board-wrap 에서만 덮고 :root 인라인 --cellW 를 건드리지 않는다 [RM-45 요구 2]', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const setters = printRules(html).filter(r => '--cellW' in declsOf(r.body));
  assert.ok(setters.length > 0, '인쇄 블록에 --cellW 를 다시 정하는 규칙이 있다');
  for (const r of setters) {
    for (const sel of r.sel.split(',').map(s => s.trim())) {
      assert.match(sel, /^\.board-wrap\b/, `${sel}: 격자 감싸개 안에서만 덮는다`);
      assert.doesNotMatch(sel, /:root|\bhtml\b|\bbody\b/, `${sel}: 화면 값을 쥔 html 을 덮지 않는다`);
    }
    assert.doesNotMatch(r.body, /--cellW[^;]*!\s*important/, '!important 로 인라인 값과 다투지 않는다');
  }
  // 인쇄 앞뒤에서 화면 칸 너비를 다시 쓰지 않는다 — 인쇄 창을 닫으면 화면이 그대로다
  const dir = new URL('../../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.js'));
  const hits = files.filter(f => /\b(?:before|after)print\b/.test(readFileSync(new URL(f, dir), 'utf8')));
  for (const f of hits) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /setGridVars|setProperty\(\s*['"]--cellW/, `${f}: 인쇄 앞뒤에 --cellW 를 쓰지 않는다`);
});

test('print: 보드가 칸 수를 --cols 로 내놓는다 [RM-45 요구 3]', async () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(printDecls(html, '.board-wrap .board')['--cellW'], /var\(--cols\b/, '인쇄 식이 칸 수를 var(--cols) 로 읽는다');
  for (const cols of [6, 8, 12]) {
    const { cols: written, headerTemplate } = await buildBoard(cols);
    assert.equal(written, String(cols), `${cols}칸 보드가 --cols 를 적는다`);
    const sum = printGridPx(html, headerTemplate, cols, SCREENS[2]);
    assert.ok(Math.abs(sum - 190 * PX_PER_MM) < 0.01, `${cols}칸: 격자 합 ${sum.toFixed(2)}px 가 종이 폭과 같다`);
  }
});

// ── RM-46: Safari 인쇄에서 행 중간에 쪽이 넘어갔다 ──────────────────────────────────────────────
// .board 가 격자(display:grid)면 WebKit 은 격자 항목(.board-row)의 break-inside: avoid 를 따르지 않는다 — 40마디 표를
// WebKit 인쇄 작업(WKWebView · NSPrintOperation)으로 찍으면 넓은 판 · 폰 폭 모두 쪽마다 끝 행이 둘로 갈렸다(Chrome 은 지켰다).
// 쪽 나눔 자체는 인쇄 엔진이 정해 node 로 잴 수 없으므로, 아래 시험은 고친 규칙(블록 흐름 · 행 사이 margin)이 인쇄 블록에 있는지 본다.

/** 블록 흐름에서 위아래로 맞닿은 두 margin 은 겹친다 — 큰 쪽 하나만 남는다(둘 다 0 이상일 때). */
// @complexity time=O(1) space=O(1) cc=1
const collapsed = (bottom, top) => Math.max(bottom, top);

/** 화면 규칙 `.board { … }`(인쇄 블록 밖, 들여쓰기 4칸)의 선언. */
// @complexity time=O(n) space=O(n) cc=1
const screenBoardDecls = (html) => declsOf((html.match(/\n {4}\.board \{([^}]*)\}/) || [])[1] || '');

test('print: [RM-46 요구 0] 인쇄에서 .board 는 블록으로 흐르고 행은 쪽 중간에서 끊기지 않는다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const boardRule = printRules(html).find(r => r.sel === '.board');
  assert.ok(boardRule, '인쇄 블록에 .board 규칙이 있다');
  assert.match(boardRule.body, /display:\s*block\s*!important/, '.board 가 인쇄에서 블록으로 흐른다(화면의 display:grid 를 이긴다)');
  const rows = printDecls(html, '.board-header, .board-row');
  assert.equal(rows['break-inside'], 'avoid', '머리 줄 · 행은 쪽 중간에서 끊기지 않는다');
  assert.equal(rows['page-break-inside'], 'avoid', '옛 이름도 함께 둔다');
  // 고치기 전 꼴(display:block 이 없어 격자로 남는다)을 넣으면 붉어진다 — 검사가 실제로 그 결함을 잡는지
  const before = html.replace(/(\n {6}\.board \{ )display: block !important; /, '$1');
  assert.notEqual(before, html);
  assert.doesNotMatch(printRules(before).find(r => r.sel === '.board').body, /display:\s*block/);
});

test('print: [RM-46 요구 1] 블록으로 흐른 행 사이 간격을 margin 으로 둔다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  // @complexity time=O(n) space=O(n) cc=1
  const spacing = (src) => {
    const env = { ...screenBoardDecls(src), ...printDecls(src, '.board-wrap') };
    const px = (v) => (v == null ? 0 : cssPx(v, env));
    const rows = printDecls(src, '.board-header, .board-row');
    const start = printDecls(src, '.board-row[data-chorus-start], .board-row[data-part-start]');
    const gridGap = px(rows.gap);
    return {
      gridGap,
      plain: px(rows['margin-bottom']),
      // 격자였을 때: 틈 + 화면의 숨(margin-top: var(--sectionGap)) / 블록일 때: 앞 행의 margin-bottom 과 이 행의 margin-top 이 겹친다
      gridStart: gridGap + px(env['--sectionGap']),
      blockStart: collapsed(px(rows['margin-bottom']), px(start['margin-top'] ?? env['--sectionGap'])),
    };
  };
  const now = spacing(html);
  assert.equal(now.gridGap, 4, '행 사이 틈은 --printGap(4px)이다');
  assert.equal(now.plain, now.gridGap, '보통 행 사이: margin-bottom 이 격자 때의 틈과 같다');
  assert.equal(now.blockStart, now.gridStart, `코러스 · 파트가 바뀌는 행 위: 겹친 margin(${now.blockStart}px)이 격자 때의 틈 + 숨(${now.gridStart}px)과 같다`);
  assert.doesNotMatch(printRules(html).find(r => r.sel === '.board').body, /\bgap:/, '블록이 된 .board 에는 쓰이지 않는 gap 을 두지 않는다');
  // 고치기 전 꼴 둘 — margin-bottom 이 없으면 행이 붙고, 숨을 보태지 않으면 겹쳐서 4px 가 사라진다
  const noMargin = html.replace(/ margin-bottom: var\(--printGap\) !important;/, '');
  assert.notEqual(noMargin, html);
  assert.equal(spacing(noMargin).plain, 0);
  const noStart = html.replace(/\n {6}\.board-row\[data-chorus-start\], \.board-row\[data-part-start\] \{[^}]*\}/, '');
  assert.notEqual(noStart, html);
  assert.notEqual(spacing(noStart).blockStart, spacing(noStart).gridStart);
});

// ── RM-47: 비고 열이 Chrome 인쇄엔 빠지고 Safari 인쇄엔 찍혔다 ──────────────────────────────────────
// Chrome 은 인쇄할 때 미디어 폭을 종이 쪽 너비(A4 · 여백 10mm 면 약 718px)로 잰다. 그래서 1040px 아래 블록의 「비고는 부를 때만」
// 규칙(body[data-notes="off"] — 넓은 화면에는 토글이 없어 늘 off 다)이 종이에 먹어 비고 열이 접혔고, WebKit 은 화면 폭으로 재서
// 넓은 화면에서는 찍었다. headless Chrome printToPDF 와 WebKit 인쇄 작업으로 같은 12마디 표를 화면 1280 에서 찍으면 비고가
// Chrome 0줄 · WebKit 34줄이었다. 미디어 폭을 어떻게 재는지는 node 로 잴 수 없으므로, 아래 시험은 숨김 규칙이 화면 전용인지 본다.

/**
 * index.html 의 <style> 을 괄호 짝으로 걸어, 규칙마다 셀렉터 · 본문 · 그 규칙을 감싼 @media 조건들을 돌려준다.
 * 주석은 먼저 걷는다(주석 속 괄호 · 따옴표가 짝을 흐리지 않게).
 * @returns {{sel:string, body:string, media:string[]}[]}
 */
// @complexity time=O(n) space=O(n) cc=7
function cssRulesWithMedia(html) {
  const css = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const rules = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push({ prelude: css.slice(start, i).trim(), at: i + 1 });
      start = i + 1;
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && !open.prelude.startsWith('@')) {
        const media = stack.filter(s => s.prelude.startsWith('@media')).map(s => s.prelude.replace(/^@media\s*/, ''));
        rules.push({ sel: open.prelude, body: css.slice(open.at, i), media });
      }
      start = i + 1;
    } else if (ch === ';' && !(stack.length && !stack[stack.length - 1].prelude.startsWith('@'))) {
      start = i + 1; // 선언 블록 밖의 한 줄 at 규칙(@import 같은 것) 다음 — 선언 안의 ; 는 셀렉터의 시작이 아니다
    }
  }
  return rules;
}

/** 비고를 접는 규칙(body[data-notes="off"] 로 시작하는 셀렉터 · --noteCol 0 이나 display:none) 모음. */
// @complexity time=O(n) space=O(n) cc=2
const notesOffRules = (html) => cssRulesWithMedia(html)
  .filter(r => /body\[data-notes="off"\]/.test(r.sel) && (/--noteCol:\s*0(px)?\s*;/.test(r.body) || /display:\s*none/.test(r.body)));

/** 인쇄에도 먹는 비고 접기 규칙의 셀렉터 — 감싼 @media 어디에도 `screen` 이 없으면 종이에 먹는다. 빈 목록이 맞는 꼴이다. */
// @complexity time=O(n) space=O(n) cc=2
function printNotesScreenOnly(html) {
  return notesOffRules(html)
    .filter(r => !r.media.some(m => /(^|[\s,(])(only\s+)?screen\b/.test(m) && !/\bnot\s+screen\b/.test(m)))
    .map(r => r.sel.replace(/\s+/g, ' '));
}

/** 고치기 전 꼴 — 비고 접기 규칙을 감싼 @media screen { … } 을 걷는다(안의 규칙은 그대로 둔다). */
// @complexity time=O(n) space=O(n) cc=1
const unwrapNotesScreen = (html) => html.replace(/\n {6}@media screen \{\n((?: {8}[^\n]*\n)+) {6}\}/, (_, inner) => '\n' + inner.replace(/^ {2}/gm, '').replace(/\n$/, ''));

test('print: [RM-47 요구 0] 비고 숨김 규칙은 화면 전용이라 인쇄에는 먹지 않는다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const rules = notesOffRules(html);
  assert.equal(rules.length, 2, `비고 접기 규칙은 둘(--noteCol 0 · 머리 칸 · 비고 칸 숨김)이다: ${rules.map(r => r.sel)}`);
  assert.deepEqual(printNotesScreenOnly(html), [], '인쇄에도 먹는 비고 접기 규칙이 없다 — Chrome 이 종이 폭을 좁은 화면으로 읽어도 비고 열이 찍힌다');
  // 인쇄 블록은 비고를 따로 숨기지 않고, 비고 폭을 0 으로 못박지도 않는다
  for (const r of printRules(html)) {
    const sels = r.sel.split(',').map(s => s.trim());
    if (sels.some(s => /\.note-(header|cell)$/.test(s))) assert.doesNotMatch(r.body, /display:\s*none/, `인쇄 블록의 ${r.sel} 가 비고를 숨긴다`);
    assert.doesNotMatch(r.body, /--noteCol:\s*0(px)?\s*[;!]/, `인쇄 블록의 ${r.sel} 가 비고 폭을 0 으로 둔다`);
  }
  // 고치기 전 꼴(@media screen 묶음이 없다)을 넣으면 붉어진다 — 검사가 실제로 그 결함을 잡는지
  const before = unwrapNotesScreen(html);
  assert.notEqual(before, html);
  assert.equal(notesOffRules(before).length, 2, '걷어도 규칙 둘은 그대로 남는다');
  assert.deepEqual(printNotesScreenOnly(before), [
    'body[data-notes="off"] .board-wrap',
    'body[data-notes="off"] .note-header, body[data-notes="off"] .note-cell',
  ]);
});

test('print: [RM-47 요구 1] 좁은 화면의 비고 토글 규칙은 그대로 남는다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const rules = notesOffRules(html);
  const wrap = rules.find(r => r.sel === 'body[data-notes="off"] .board-wrap');
  const cells = rules.find(r => r.sel.replace(/\s+/g, ' ') === 'body[data-notes="off"] .note-header, body[data-notes="off"] .note-cell');
  assert.ok(wrap, '비고 열 폭을 접는 규칙이 셀렉터 글자 그대로 있다');
  assert.ok(cells, '비고 머리 칸 · 비고 칸을 숨기는 규칙이 셀렉터 글자 그대로 있다');
  assert.match(wrap.body, /--noteCol:\s*0px/, '격자가 읽는 --noteCol 을 0 으로 둔다(--noteW 는 덮지 않는다)');
  assert.doesNotMatch(wrap.body, /--noteW/, 'ui/cssVars 가 렌더마다 쓰는 --noteW 를 덮지 않는다');
  assert.match(cells.body, /display:\s*none/);
  for (const r of [wrap, cells]) {
    assert.ok(r.media.includes('(max-width: 1040px)'), `${r.sel}: 1040px 아래 블록 안에 있다 — 넓은 화면은 비고가 늘 보인다(${r.media})`);
    assert.ok(r.media.includes('screen'), `${r.sel}: 화면 전용으로 묶였다(${r.media})`);
  }
  // 켜는 쪽(📝 단추가 켜짐 색을 받는 규칙)도 그대로 있다
  assert.ok(cssRulesWithMedia(html).some(r => /body\[data-notes="on"\] #notesToggleBtn/.test(r.sel) && r.media.includes('(max-width: 1040px)')), '📝 비고 단추의 켜짐 표시 규칙');
});

test('print: [RM-47 요구 0] 인쇄 비고 폭은 화면에서 잰 폭과 상관없이 종이의 25% 다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const paperPx = 190 * PX_PER_MM;
  // @complexity time=O(n) space=O(n) cc=1
  const noteW = (src, screen) => {
    const wrap = { ...screen, ...Object.fromEntries(Object.entries(printDecls(src, '.board-wrap')).filter(([k]) => k.startsWith('--'))) };
    return cssPx(wrap['--printNoteW'], wrap);
  };
  // 좁은 화면은 비고가 접힌 채 재서 --noteW 가 하한값 60px(ui/cssVars.setNoteWidth)다 — 넓은 화면은 내용대로 잰다
  for (const measured of ['60px', '203px', '280px']) {
    assert.ok(Math.abs(noteW(html, { '--noteW': measured }) - paperPx * 0.25) < 0.01, `화면에서 잰 비고 ${measured}: 종이의 25%`);
  }
  // 고치기 전 꼴(화면에서 잰 --noteW 를 그대로 쓴다)을 넣으면 좁은 화면의 60px 가 종이에 찍힌다
  const before = html.replace('--printNoteW: min(var(--noteCol, calc(var(--printW) * 0.25))', '--printNoteW: min(var(--noteCol, var(--noteW))');
  assert.notEqual(before, html);
  assert.equal(noteW(before, { '--noteW': '60px' }), 60);
});
