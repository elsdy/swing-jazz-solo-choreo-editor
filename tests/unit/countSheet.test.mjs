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
import { readFileSync } from 'node:fs';

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
      const owners = [...html.matchAll(new RegExp(`class="([^"]*\\b${cls}\\b[^"]*)"`, 'g'))].map(m => m[1].split(/\s+/));
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
