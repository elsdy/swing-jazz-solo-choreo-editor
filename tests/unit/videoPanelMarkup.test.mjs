// tests/unit/videoPanelMarkup.test.mjs — 영상 패널 마크업의 뼈대 (RM-20)
//
// index.html 을 **글로** 읽는다(DOM 없는 node). 영상 패널이 「차례 ①②③」과 「도구 탭」으로 갈려 있는지,
// 단계 열쇠(step1~6)가 마크업에 박혀 있는지, 유튜브 주소 칸이 `① 영상 고르기` 안 한 곳뿐인지,
// `② 박자 맞추기` 의 첫 경로가 탭 줄인지, 안내 문구가 가리키는 단계 이름이 실제로 화면에 있는지를 잰다.
// 계획서 docs/roadmap/plans/RM-20.md 의 요구 ↔ 시험 표가 이 이름들을 약속했다 — 이름을 바꾸면 표도 바꾼다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanJs } from '../../tools/lib/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 주석을 같은 길이의 공백으로 지운 마크업 — 주석 속 `<details>` 글자가 짝을 흐트리지 않게. 줄 번호 · 자리는 그대로다. */
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

const CIRCLED = /^[①-⑳]/;   // ① ~ ⑳

/** 여는 태그부터 짝 닫는 태그까지의 범위 [start, end). 같은 이름의 태그가 안에 겹쳐도 센다. */
function elementRange(html, openTagRe, tagName) {
  const open = html.match(openTagRe);
  assert.ok(open, `마크업에 ${openTagRe} 가 없다`);
  const start = open.index;
  const re = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html));) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  throw new Error(`<${tagName}> 가 닫히지 않는다`);
}

/** 영상 패널 몸통(`#videoBody`) 안의 `<details>` 전부 — 깊이 · summary · 속성 · 범위. */
function detailsIn(html, range) {
  const slice = html.slice(range.start, range.end);
  const out = [];
  const stack = [];
  // summary 안에는 설명서로 가는 `?` 단추(RM-26)가 들 수 있다 — 태그를 걷어 글자만 본다.
  const re = /<details\b([^>]*)>|<\/details>|<summary>([\s\S]*?)<\/summary>/g;
  for (let m; (m = re.exec(slice));) {
    if (m[0].startsWith('<details')) {
      const d = { attrs: m[1], depth: stack.length, summary: '', start: range.start + m.index, end: -1 };
      stack.push(d);
      out.push(d);
    } else if (m[0].startsWith('</details')) {
      const d = stack.pop();
      d.end = range.start + m.index + m[0].length;
    } else {
      const top = stack[stack.length - 1];
      if (top && !top.summary) top.summary = m[2].replace(/<[^>]*>[^<]*<\/[^>]*>|<[^>]*>/g, '').trim();
    }
  }
  assert.equal(stack.length, 0, '<details> 가 닫히지 않았다');
  return out;
}

const body = elementRange(HTML, /<div class="video-body" id="videoBody">/, 'div');
const tools = elementRange(HTML, /<section class="video-tools" id="videoTools"[^>]*>/, 'section');
const all = detailsIn(HTML, body);
const inside = (d, r) => d.start >= r.start && d.end <= r.end;
/** 차례 — 패널 몸통 직속(깊이 0)이고 도구 칸 밖인 `<details>`. */
const steps = all.filter(d => d.depth === 0 && !inside(d, tools));
/** 도구 탭 — 도구 칸 안의 깊이 0 `<details>`. */
const toolTabs = all.filter(d => d.depth === 0 && inside(d, tools));
const dataStep = (d) => (d.attrs.match(/data-step="([^"]+)"/) || [])[1];
const idIndex = (id) => {
  const re = new RegExp(`\\bid="${id}"`, 'g');
  const hits = [...HTML.matchAll(re)].map(m => m.index);
  return hits;
};
const within = (idx, r) => idx >= r.start && idx < r.end;

test('차례는 ①②③ 셋이고 도구 탭은 번호 없이 셋이다', () => {
  assert.equal(steps.length, 3, `차례 <details> 가 셋이어야 한다 — ${steps.map(s => s.summary).join(' · ')}`);
  ['①', '②', '③'].forEach((n, i) => assert.ok(steps[i].summary.startsWith(n), `${i + 1}번째 차례는 ${n} 로 시작해야 한다: ${steps[i].summary}`));
  assert.equal(toolTabs.length, 3, `도구 탭이 셋이어야 한다 — ${toolTabs.map(s => s.summary).join(' · ')}`);
  for (const t of toolTabs) assert.ok(!CIRCLED.test(t.summary), `도구 탭 머리에 번호가 없어야 한다: ${t.summary}`);
  // 도구 탭은 번호도 ✓ 도 없다 — 완료 표시는 차례 셋만 받는다(videoPanel.stepDone).
  for (const t of toolTabs) assert.ok(!/✓/.test(t.summary), `도구 탭 머리에 ✓ 가 없어야 한다: ${t.summary}`);
  // 도구 탭은 처음에 접혀 있다 — 필요할 때 여는 연장이라 한 번에 하나만 펼친다.
  for (const t of toolTabs) assert.ok(!/\bopen\b/.test(t.attrs), `도구 탭은 처음에 접혀 있어야 한다: ${t.summary}`);
});

test('유튜브 주소 칸은 ① 안에 하나뿐이고 링크 줄에는 없다', () => {
  const linksBar = elementRange(HTML, /<div class="links-bar" id="linksBar">/, 'div');
  const first = steps[0];
  for (const id of ['youtubeUrlInput', 'ytUrlGroup', 'ytResetBtn', 'youtubeLinkRow']) {
    const hits = idIndex(id);
    assert.equal(hits.length, 1, `#${id} 는 마크업에 한 번만 있어야 한다(${hits.length}번)`);
    assert.ok(within(hits[0], first), `#${id} 는 \`${first.summary}\` 안에 있어야 한다`);
    assert.ok(!within(hits[0], linksBar), `#${id} 는 링크 줄(#linksBar) 안에 있으면 안 된다`);
  }
  // ① 의 맨 위 — 파일 열기보다 앞선다.
  assert.ok(idIndex('ytUrlGroup')[0] < idIndex('videoFileBtn')[0], '유튜브 주소 칸은 `📁 영상 파일 열기` 보다 위에 있어야 한다');
  // 링크 줄에는 ClickUp 과 직접 더한 링크만 남는다.
  for (const id of ['clickupUrlInput', 'clickupResetBtn', 'customLinksContainer', 'addCustomLinkBtn']) {
    assert.ok(within(idIndex(id)[0], linksBar), `#${id} 는 링크 줄에 남아 있어야 한다`);
  }
});

test('② 의 첫 경로는 탭 줄이고 앵커·직접 입력·보정점은 접힌 칸 안에 있다', () => {
  const tempo = steps[1];
  const sub = all.find(d => d.depth === 1 && inside(d, tempo) && /세로선이 어긋날 때/.test(d.summary));
  assert.ok(sub, '`② 박자 맞추기` 안에 「세로선이 어긋날 때」 접힌 칸이 있어야 한다');
  assert.ok(!/\bopen\b/.test(sub.attrs), '「세로선이 어긋날 때」 는 접힌 채로 시작한다');
  const tap = idIndex('videoTapBtn')[0];
  assert.ok(within(tap, tempo) && tap < sub.start, '`탭` 버튼은 접힌 칸보다 먼저, ② 바로 안에 있어야 한다');
  for (const id of ['videoAnchorRow', 'videoMarkBtn', 'videoBpmInput', 'videoBeatsPerCount', 'videoPointBtn', 'videoPointSelBtn']) {
    assert.ok(within(idIndex(id)[0], sub), `#${id} 는 「세로선이 어긋날 때」 안에 있어야 한다`);
  }
});

test('도구 탭은 step4~6 열쇠를 마크업에 적어 둔다', () => {
  assert.deepEqual(steps.map(dataStep), ['step1', 'step2', 'step3']);
  assert.deepEqual(toolTabs.map(dataStep), ['step4', 'step5', 'step6']);
  // 열쇠는 하나씩만 — 같은 열쇠가 둘이면 기록 · 할 일이 어디로 갈지 모른다.
  const keys = all.map(dataStep).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, `data-step 이 겹친다: ${keys.join(' · ')}`);
  // 차례 · 도구 모두 할 일 상자가 붙을 `.vstep-body` 를 가진다.
  for (const d of [...steps, ...toolTabs]) {
    assert.ok(HTML.slice(d.start, d.end).includes('class="vstep-body"'), `${d.summary} 에 .vstep-body 가 있어야 한다`);
  }
});

test('마커 탭은 앵커 칸이 접혀도 마디를 고를 수 있다', () => {
  const marker = toolTabs.find(t => dataStep(t) === 'step5');
  assert.ok(marker && /마커/.test(marker.summary), 'step5 는 마커 탭이어야 한다');
  const rowBtn = idIndex('videoMarkerRowBtn')[0];
  const rowPick = idIndex('videoMarkerRow');
  assert.equal(rowPick.length, 1, '#videoMarkerRow 마디 고르기 칸이 한 번 있어야 한다');
  assert.ok(within(rowBtn, marker) && within(rowPick[0], marker), '마디 고르기 칸과 `이 마디에 맵핑` 이 같은 마커 탭 안에 있어야 한다');
  assert.ok(rowPick[0] < rowBtn, '마디 고르기 칸이 `이 마디에 맵핑` 보다 앞에 있어야 한다');
  // ② 의 앵커 칸(`여기가`)에 기대지 않는다.
  assert.ok(!within(idIndex('videoAnchorRow')[0], marker));
});

test('안내 문구가 가리키는 단계 이름이 마크업에 있다', () => {
  const heads = [...steps, ...toolTabs].map(d => d.summary);
  const dir = join(ROOT, 'src', 'ui');
  const misses = [];
  // 제 번호 줄을 따로 가진 화면 — 거기의 ①②③ 은 영상 패널의 단계가 아니다.
  //   coachmarks.js(RM-26): 처음 켠 사람에게 보이는 말풍선 세 장의 차례(① 채우기 줄 → ② 동작 목록 → ③ 영상).
  const OWN_SEQUENCES = new Set(['coachmarks.js']);
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js') && !OWN_SEQUENCES.has(n))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const s of scanJs(src).strings) {
      // 문자열 속 「① 이름」 꼴 — 백틱 인용이든 맨글이든. 뒤에 조사 · 문장이 이어질 수 있다.
      for (const m of s.text.matchAll(/[①-⑳]\s*[^`'"\n]*/g)) {
        const quoted = m[0].replace(/[`'"].*$/, '').trim();
        if (quoted.length < 3) continue;
        const ok = heads.some(h => quoted.startsWith(h) || h.startsWith(quoted));
        if (!ok) misses.push(`src/ui/${f}: ${quoted}`);
      }
    }
  }
  assert.deepEqual(misses, [], `단계 이름 인용이 화면의 summary 와 맞지 않는다:\n  ${misses.join('\n  ')}`);
});

// ── RM-61 — 테마 띠의 흐름 길 띠는 본문 스크롤 칸 맨 위에 선다 ─────────────────────────────────
// 테마 길 띠(.flow-steps)는 104px 이고 본문(.video-body)은 띠일 때 26vh 로 끊겨 안에서 굴린다. 길 띠가 연습 줄
// (.video-practice) 밑에 서면 1440×723 에서 스크롤 칸 바닥(634)에 걸려 아래 30px 와 마디 이름(646~660)이 잘렸다.
// 고침은 띠일 때의 CSS order 만이다 — 마크업을 옮기면 영상 iframe 이 다시 읽혀 재생이 처음으로 돌아간다.
// 브라우저 배치는 node 로 못 재니 index.html 의 CSS **글**을 읽어 order 를 잰다.

/** CSS 주석을 같은 길이의 공백으로 지운 원문 — 주석 속 `{` · `}` 가 짝을 흐트리지 않게. */
const CSS_TEXT = readFileSync(join(ROOT, 'index.html'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** `@media <조건> {` 블록들의 안쪽 글. 괄호 짝을 세어 닫는 자리까지. */
// @complexity time=O(n) space=O(n) cc=5
function mediaBlocks(css, cond) {
  const out = [];
  const head = new RegExp(`@media\\s*${cond.replace(/[()]/g, '\\$&').replace(/\s+/g, '\\s*')}\\s*\\{`, 'g');
  for (let m; (m = head.exec(css));) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

/** 블록 안 규칙 중 선택자 목록에 `sel` 이 **그대로** 든 것의 `order` 값들(없으면 빈 배열). */
// @complexity time=O(n) space=O(n) cc=4
function ordersFor(block, sel) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const out = [];
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map(norm);
    if (!sels.includes(norm(sel))) continue;
    const o = m[2].match(/(?:^|;|\s)order\s*:\s*(-?\d+)/);
    if (o) out.push(Number(o[1]));
  }
  return out;
}

const BAND = 'body[data-videoband="on"]';
const THEME_BAND = `:root[data-theme] ${BAND}`;

test('[RM-61 요구 1] 테마 띠에서 흐름 길 띠가 연습 줄보다 먼저 선다', () => {
  const wide = mediaBlocks(CSS_TEXT, '(min-width: 1041px)').join('\n');
  const flow = ordersFor(wide, `${THEME_BAND} .flow-steps`);
  assert.equal(flow.length, 1, `넓은 화면 블록에 「${THEME_BAND} .flow-steps」 의 order 가 하나 있어야 한다 — ${flow.length}개`);
  // 연습 줄의 order — 테마 규칙이 있으면 그것, 없으면 띠 규칙, 그것도 없으면 flex 기본값 0.
  const practice = ordersFor(wide, `${THEME_BAND} .video-practice`).at(-1)
    ?? ordersFor(wide, `${BAND} .video-practice`).at(-1) ?? 0;
  assert.ok(flow[0] < practice, `테마 띠의 길 띠 order(${flow[0]})가 연습 줄 order(${practice})보다 작아야 한다`);
  // 열린 차례 카드 · 도구 칸 · 상태줄보다도 앞이다 — 길 띠가 스크롤 칸 맨 위에 통째로 남는다.
  for (const other of ['.video-body > .vstep[open]', '.video-tools', '.video-status']) {
    const o = ordersFor(wide, `${BAND} ${other}`).at(-1) ?? 0;
    assert.ok(flow[0] < o, `길 띠 order(${flow[0]})가 ${other} order(${o})보다 작아야 한다`);
  }
  // 마크업은 옮기지 않는다 — 길 띠와 영상 프레임이 같은 #videoBody 안에 그대로 있다.
  for (const id of ['videoFlowSteps', 'videoFrame', 'videoPractice']) {
    const hits = idIndex(id);
    assert.equal(hits.length, 1, `#${id} 가 하나여야 한다`);
    assert.ok(within(hits[0], body), `#${id} 는 #videoBody 안에 있어야 한다`);
  }
  assert.ok(idIndex('videoPractice')[0] < idIndex('videoFlowSteps')[0],
    '마크업 차례(연습 줄 → 길 띠)는 그대로다 — 자리는 CSS order 만 바꾼다');
});

test('[RM-61 요구 2] 길 띠를 올리는 order 는 테마를 켠 넓은 띠에만 걸린다', () => {
  // 테마 없는 띠 규칙 · 좁은 화면에는 길 띠를 앞으로 당기는 order 가 없다(기본 테마의 차례 줄은 RM-55 의 몫).
  const wide = mediaBlocks(CSS_TEXT, '(min-width: 1041px)').join('\n');
  const plain = ordersFor(wide, `${BAND} .flow-steps`);
  assert.ok(plain.every(o => o >= 0), `테마 없는 띠의 길 띠 order 는 음수가 아니어야 한다 — ${plain.join(',')}`);
  const narrow = mediaBlocks(CSS_TEXT, '(max-width: 1040px)').join('\n');
  for (const sel of [`${THEME_BAND} .flow-steps`, `:root[data-theme] .flow-steps`, `${BAND} .flow-steps`]) {
    assert.deepEqual(ordersFor(narrow, sel), [], `좁은 화면에는 「${sel}」 의 order 가 없어야 한다`);
  }
  // 미디어 밖(모든 폭)에서 테마 길 띠의 order 를 바꾸지 않는다 — 띄운 창 · 좁은 화면의 배치를 건드리지 않게.
  let outside = CSS_TEXT;
  for (const cond of ['(min-width: 1041px)', '(max-width: 1040px)']) {
    for (const b of mediaBlocks(CSS_TEXT, cond)) outside = outside.replace(b, '');
  }
  assert.deepEqual(ordersFor(outside, `:root[data-theme] .flow-steps`), [], '미디어 밖 테마 길 띠 규칙에는 order 가 없어야 한다');
  assert.deepEqual(ordersFor(outside, `${THEME_BAND} .flow-steps`), [], '테마 띠의 길 띠 order 는 넓은 화면 블록 안에만 둔다');
});
