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

/**
 * 테마 길 띠의 CSS 크기와 domain/flowTrack 의 셈이 같은 수를 쓰는가(RM-58). 띠 높이 · 마디 지름 · 이름 여백은
 * CSS 에, 마디가 띠 안에 든다는 보장은 domain 에 있다 — 한쪽만 바뀌면 이름이 띠(`overflow:hidden`) 밖으로 잘린다.
 */
test('[RM-58 요구 1] 테마 길 띠의 CSS 크기와 flowTrack 의 마디 셈이 맞는다', async () => {
  const { flowTrack, FLOW_NODE_R, FLOW_LABEL_H } = await import('../../src/domain/flowTrack.js');
  const CSS = readFileSync(join(ROOT, 'index.html'), 'utf8');
  /** `선택자 { … }` 한 덩이의 `속성: 값` 을 읽는다 — 같은 선택자가 여럿이면 뒤의 것이 이긴다(CSS 와 같다). */
  const prop = (selector, name) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let val = null;
    for (const m of CSS.matchAll(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
      const hit = m[1].match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`));
      if (hit) val = hit[1].trim();
    }
    assert.ok(val, `index.html 에 \`${selector} { ${name} }\` 가 없다`);
    return val;
  };
  const band = parseFloat(prop(':root[data-theme] .flow-steps', 'height'));
  const icon = parseFloat(prop(':root[data-theme] .flow-step .flow-icon', 'height'));
  const gap = parseFloat(prop(':root[data-theme] .flow-step .flow-name', 'margin-top'));
  assert.equal(icon, FLOW_NODE_R * 2, `테마 마디 지름(${icon}px)이 flowTrack 의 FLOW_NODE_R×2(${FLOW_NODE_R * 2}) 와 다르다`);
  assert.ok(gap < FLOW_LABEL_H, `이름 여백(${gap}px)이 FLOW_LABEL_H(${FLOW_LABEL_H}) 안에 들어야 한다`);
  // 띠의 실제 폭은 창마다 다르다 — 넓은 판(1068)과 좁은 띠(600)에서 잰다.
  for (const width of [1068, 600]) {
    for (let count = 2; count <= 6; count++) {
      const t = flowTrack({ width, height: band, count });
      for (const p of t.points) {
        assert.ok(p.y - FLOW_NODE_R >= 0 && p.y + FLOW_NODE_R + FLOW_LABEL_H <= band,
          `띠 ${band}px · 폭 ${width} · 마디 ${count}: 마디(y=${p.y})나 그 아래 이름이 띠 밖으로 나간다`);
      }
    }
  }
});

// ── RM-54 — 펼친 도구의 `?` 는 맨 위 오른쪽에 겹쳐 두고, 첫 조작 줄은 그 자리를 비운다 ──────────────────
// `.vtool-help` 는 `?` 의 높이만큼 음수 아래 여백을 써서 본문 첫 줄과 같은 높이에 겹쳐 선다(RM-20 — 본문이 한 줄
// 밀리지 않게). 짝이 없으면 폰 폭(360~430px)에서 첫 줄 단추가 오른쪽 끝까지 차 `?` 밑으로 파고든다 — 60 경우 중
// 12 경우에서 「Out 으로」 · 「이 마디에 맵핑」 · 「분석 지우기」를 덮었다(2026-11-03 헤드리스 Chrome 으로 잼).
// 실제 겹침 픽셀은 node 로 못 잰다 — 여기서는 「음수 여백 ↔ 첫 줄의 비운 자리」 짝과 그 짝이 셋 다에 닿는지를 잰다.

/** 미디어 블록을 걷어 낸 CSS — 모든 폭에 걸리는 규칙만. */
// @complexity time=O(n·m) space=O(n) cc=3
function cssOutsideMedia(css) {
  let out = css;
  for (const m of css.matchAll(/@media[^{]*\{/g)) {
    for (const b of mediaBlocks(css, m[0].replace(/^@media\s*/, '').replace(/\s*\{$/, ''))) out = out.replace(b, '');
  }
  return out;
}

/** 블록 안 규칙 중 선택자 목록에 `sel` 이 그대로 든 것의 `prop` 값들(뒤의 것이 이긴다 — 마지막이 실제 값). */
// @complexity time=O(n) space=O(n) cc=4
function declsFor(block, sel, prop) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const out = [];
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map(norm).includes(norm(sel))) continue;
    const v = m[2].match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
    if (v) out.push(v[1].trim());
  }
  return out;
}

const HELP_SEL = '.vtool-help';
const FIRST_ROW_SEL = '.vtool-help + .vstep-body > :first-child > .video-field:first-child';
const ALL_WIDTHS = cssOutsideMedia(CSS_TEXT);

test('[RM-54 요구 0] 펼친 도구의 첫 줄은 ? 자리를 비워 둔다', () => {
  const qWidth = parseFloat(declsFor(ALL_WIDTHS, '.help-q', 'width').at(-1));
  assert.ok(qWidth > 0, '`.help-q` 의 width 를 읽지 못했다');
  const mb = parseFloat(declsFor(ALL_WIDTHS, HELP_SEL, 'margin-bottom').at(-1) ?? '0');
  if (mb >= 0) return;   // 겹쳐 두지 않으면 짝도 필요 없다(요구 1 이 따로 붉어진다).
  // 짝 — 모든 폭에 걸리는 첫 줄의 오른쪽 여백이 `?` 폭 이상이다.
  const pad = declsFor(ALL_WIDTHS, FIRST_ROW_SEL, 'padding-right').at(-1);
  assert.ok(pad, `\`${HELP_SEL}\` 가 음수 아래 여백(${mb}px)으로 겹쳐 서는데, 첫 조작 줄(\`${FIRST_ROW_SEL}\`)에 오른쪽 여백 짝이 없다`);
  assert.ok(parseFloat(pad) >= qWidth, `첫 줄의 오른쪽 여백(${pad})이 \`?\` 폭(${qWidth}px)보다 좁다`);
  // 미디어 블록이 그 여백을 0 으로 되돌리지 않는다(어느 폭에서나 비운다).
  for (const m of CSS_TEXT.matchAll(/@media([^{]*)\{/g)) {
    for (const b of mediaBlocks(CSS_TEXT, m[1].trim())) {
      for (const v of declsFor(b, FIRST_ROW_SEL, 'padding-right')) {
        assert.ok(parseFloat(v) >= qWidth, `@media ${m[1].trim()} 에서 첫 줄 오른쪽 여백(${v})이 \`?\` 폭보다 좁다`);
      }
    }
  }
  // 짝 선택자가 도구 셋의 실제 첫 조작 줄에 닿는다 — `?` 바로 뒤 본문 → 그 첫 자식 → 그 첫 자식이 `.video-field`.
  // 자르기 · 마커는 `.video-cut`, 분석은 `.video-pose-section` 이 사이에 선다. 첫 줄이 바뀌면 여기서 붉어진다.
  for (const t of toolTabs) {
    const slice = HTML.slice(t.start, t.end);
    const help = slice.match(/<div class="vtool-help">[\s\S]*?<\/div>/);
    assert.ok(help, `${t.summary} 에 .vtool-help 가 없다`);
    const tags = [...slice.slice(help.index + help[0].length).matchAll(/<([a-z]+)\b([^>]*)>/g)].slice(0, 3);
    assert.match(tags[0]?.[0] ?? '', /^<div class="vstep-body">$/, `${t.summary}: \`?\` 바로 뒤가 .vstep-body 가 아니다`);
    assert.match(tags[2]?.[2] ?? '', /\bclass="video-field\b/, `${t.summary}: 본문 첫 자식의 첫 자식이 .video-field 가 아니다 — ${tags[2]?.[0]}`);
  }
});

test('[RM-54 요구 1] 도구 ? 는 맨 위 오른쪽에 겹쳐 둔다', () => {
  assert.equal(declsFor(ALL_WIDTHS, HELP_SEL, 'justify-content').at(-1), 'flex-end', '`.vtool-help` 는 오른쪽(flex-end)에 붙는다');
  // 본문을 한 줄 밀지 않는다 — 음수 아래 여백이 `?` 높이를 그대로 지운다.
  const qHeight = parseFloat(declsFor(ALL_WIDTHS, '.help-q', 'height').at(-1));
  const mb = parseFloat(declsFor(ALL_WIDTHS, HELP_SEL, 'margin-bottom').at(-1) ?? '0');
  assert.equal(mb, -qHeight, `\`.vtool-help\` 의 아래 여백(${mb}px)이 \`?\` 높이(${qHeight}px)를 지우지 않는다 — 본문이 밀린다`);
  // 어느 폭에서도 그 겹쳐 두기를 끄지 않는다(좁은 폭만 끄는 길은 고르지 않았다 — 계획서 결정).
  for (const m of CSS_TEXT.matchAll(/@media([^{]*)\{/g)) {
    for (const b of mediaBlocks(CSS_TEXT, m[1].trim())) {
      assert.deepEqual(declsFor(b, HELP_SEL, 'margin-bottom'), [], `@media ${m[1].trim()} 가 \`.vtool-help\` 의 아래 여백을 바꾼다`);
    }
  }
});

test('[RM-54 요구 2] 도구마다 ? 가 하나씩 설명서 절을 가리킨다', () => {
  const helps = toolTabs.map((t) => {
    const slice = HTML.slice(t.start, t.end);
    const qs = [...slice.matchAll(/<div class="vtool-help">\s*<button class="help-q"[^>]*\bdata-help="([^"]+)"/g)];
    assert.equal(qs.length, 1, `${t.summary} 에 .vtool-help 안의 \`?\` 가 하나여야 한다 — ${qs.length}개`);
    assert.equal([...slice.matchAll(/class="help-q"/g)].length, 1, `${t.summary} 안의 \`?\` 는 하나뿐이어야 한다`);
    return qs[0][1];
  });
  assert.deepEqual(helps, ['video-trim', 'video-markers', 'video-pose']);
});

// ── RM-55 — 기본 테마 띠의 차례 줄 단추가 패널 밖으로 밀림 ─────────────────────────────────────
// 기본 테마(테마 없음)에는 `<html data-theme>` 가 없어 `.flow-steps{position:relative;overflow:hidden}` ·
// `.flow-track{position:absolute}` 가 걸리지 않는다. 그런데 drawFlowTrack 이 길 SVG 를 흐름 속에 넣고 단추에
// 인라인 left/top 을 달아, 1440 폭 띠에서 ①②③ 오른 끝이 515/1132/1742 로 패널(1429) 밖에 나가고 nav 가
// 435~533px 로 컸다(2026-11-03 실측). 배치는 node 로 못 재니 CSS 글과 JS 글의 짝을 잰다.

const PANEL_JS = readFileSync(join(ROOT, 'src/ui/videoPanel.js'), 'utf8');
const MAIN_JS = readFileSync(join(ROOT, 'src/app/main.js'), 'utf8');

/** `function <name>(` 의 몸통 글(중괄호 짝을 세어 닫는 자리까지). */
// @complexity time=O(n) space=O(n) cc=4
function fnBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} 함수가 있어야 한다`);
  let i = src.indexOf('{', src.indexOf(')', at)), depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

test('[RM-55 요구 1] 기본 테마에서는 길 SVG 가 자리를 차지하지 않는다', () => {
  // 테마 밖(모든 폭)에서 숨기고, 테마 아래 규칙만 다시 보인다.
  assert.deepEqual(declsFor(ALL_WIDTHS, '.flow-track', 'display').at(-1), 'none',
    '테마 밖의 `.flow-track` 은 display:none 이어야 한다 — 흐름 속에 놓인 SVG 가 줄 높이를 키운다');
  assert.equal(declsFor(ALL_WIDTHS, ':root[data-theme] .flow-track', 'display').at(-1), 'block',
    '`:root[data-theme] .flow-track` 은 길을 다시 보여야 한다');
  // 띠 미디어 블록이 테마 밖 `.flow-track` 을 다시 켜지 않는다.
  for (const m of CSS_TEXT.matchAll(/@media([^{]*)\{/g)) {
    for (const b of mediaBlocks(CSS_TEXT, m[1].trim())) {
      assert.deepEqual(declsFor(b, '.flow-track', 'display'), [], `@media ${m[1].trim()} 가 테마 밖 \`.flow-track\` 을 다시 켠다`);
    }
  }
});

test('[RM-55 요구 1] 기본 테마의 길 그리기는 SVG 를 걷고 단추의 인라인 자리를 비운다', () => {
  const body = fnBody(PANEL_JS, 'drawFlowTrack');
  const themeAt = body.indexOf("hasAttribute('data-theme')");
  const measureAt = body.indexOf('getBoundingClientRect');
  assert.ok(themeAt >= 0 && measureAt >= 0, '테마 확인과 재기가 모두 있어야 한다');
  assert.ok(themeAt < measureAt, '테마 확인이 재기(getBoundingClientRect)보다 앞서야 한다 — 기본 테마는 잴 일이 없다');
  const branch = body.slice(themeAt, measureAt);
  assert.match(branch, /\.remove\(\)/, '기본 테마 갈래가 길 SVG 를 걷어야 한다');
  assert.match(branch, /style\.left\s*=\s*''/, '기본 테마 갈래가 단추의 인라인 left 를 비워야 한다(인라인이 CSS 를 이긴다)');
  assert.match(branch, /style\.top\s*=\s*''/, '기본 테마 갈래가 단추의 인라인 top 을 비워야 한다');
  // 테마를 바꾸면 차례 줄을 다시 그린다 — candy → basic 에 옛 좌표가 남지 않게.
  const setTheme = MAIN_JS.match(/setTheme:\s*\(id\)\s*=>\s*\{([^\n]*)\}/);
  assert.ok(setTheme, 'main.js 의 setTheme 이 있어야 한다');
  assert.match(setTheme[1], /views\.video\?\.redrawFlow\(\)/, 'setTheme 이 테마를 바른 뒤 차례 줄을 다시 그려야 한다');
});
