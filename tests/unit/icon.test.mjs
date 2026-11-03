// tests/unit/icon.test.mjs — 아이콘 한 벌(SVG 스프라이트)과 단추 도우미(ui/icon) (RM-18, 2026-11-03)
//
// 그림은 index.html 맨 앞의 숨은 `<svg id="icon-sprite">` 한 덩어리에서만 온다. 여기서는 ① 그 덩어리의 모양이
// 고른지 ② 도우미가 「아이콘 + 글자 칸」을 만들고 글자 칸만 가는지 ③ 아이콘만 든 단추가 이름을 갖는지
// ④ 스타일시트 · 단계 머리가 같은 한 벌을 쓰는지를 잰다. 앞의 다섯 시험 이름은 계획서
// (docs/roadmap/plans/RM-18.md)의 「요구 ↔ 시험」 표 1 · 3 · 4 · 5 · 6 과 같아야 한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ICON_PREFIX, LABEL_CLASS, iconEl, iconHtml, iconLabel, iconLabelHtml, iconOnly, installIconMasks, labelOf, maskUrl, setLabel,
} from '../../src/ui/icon.js';
import { COMMANDS } from '../../src/domain/commands.js';
import { LABEL_PICTO_RE } from '../../tools/check-principles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** 스프라이트 덩어리와 그 안의 symbol 들. */
const SPRITE = (HTML.match(/<svg id="icon-sprite"[\s\S]*?<\/svg>/) || [''])[0];
const SYMBOLS = [...SPRITE.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)].map(m => ({
  attrs: m[1],
  id: (m[1].match(/\bid="([^"]+)"/) || [])[1] || '',
  body: m[2],
}));
const NAMES = new Set(SYMBOLS.map(s => s.id.slice(ICON_PREFIX.length)));

/** src/ 아래 .js 전부(경로 → 원문). */
function srcFiles() {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) out[p.slice(ROOT.length + 1)] = readFileSync(p, 'utf8');
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}
const SRC = srcFiles();

/** 스타일시트들 — index.html 의 <style> 과 뷰가 들고 있는 CSS 템플릿(docsHub 등). */
const STYLES = [
  ...[...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => ({ file: 'index.html', css: m[1] })),
  ...Object.entries(SRC).flatMap(([file, text]) => [...text.matchAll(/const\s+[A-Z_]*(?:CSS|STYLE)[A-Z_]*\s*=\s*`([\s\S]*?)`;/g)].map(m => ({ file, css: m[1] }))),
];

/**
 * 아주 작은 가짜 문서 — 도우미가 쓰는 것만(createElement(NS) · setAttribute · appendChild · replaceChildren · dataset).
 * @returns {Document}
 */
function fakeDoc() {
  const make = (tag) => {
    const attrs = {};
    const el = {
      tag, children: [], dataset: {}, className: '', title: '', _text: '',
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
      appendChild(c) { el.children.push(c); return c; },
      replaceChildren(...kids) { el.children = kids; },
      get textContent() { return el._text || el.children.map(c => c.textContent).join(''); },
      set textContent(v) { el._text = v; el.children = []; },
    };
    return el;
  };
  return { createElement: make, createElementNS: (_ns, tag) => make(tag) };
}

// ── 요구 ↔ 시험 1 · 3 · 4 · 5 · 6 ─────────────────────────────────────────────

test('스프라이트의 symbol 은 모두 같은 viewBox 이고 색은 currentColor 뿐이다', () => {
  assert.ok(SPRITE, 'index.html 에 <svg id="icon-sprite"> 가 있다');
  const bodyOpen = HTML.indexOf('>', HTML.indexOf('<body', HTML.indexOf('</head>'))) + 1;
  const between = HTML.slice(bodyOpen, HTML.indexOf('<svg id="icon-sprite"')).replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(between.trim(), '', '스프라이트는 body 맨 앞이다(어느 단추보다 먼저 — 사이에는 주석뿐)');
  assert.ok(SYMBOLS.length >= 40, `symbol 이 ${SYMBOLS.length}개뿐이다 — 읽는 법이 낡았나`);
  for (const s of SYMBOLS) {
    assert.match(s.id, /^i-[a-z][a-z0-9-]*$/, `symbol id ${s.id}`);
    assert.match(s.attrs, /\bviewBox="0 0 24 24"/, `${s.id} 의 viewBox`);
    // 칠과 선 굵기는 스타일시트의 .icon 이 한 번 준다 — symbol 이 고정 색 · 굵기를 들면 테마를 따르지 않는다
    for (const m of (s.attrs + s.body).matchAll(/\b(fill|stroke)="([^"]*)"/g)) {
      assert.ok(['none', 'currentColor'].includes(m[2]), `${s.id} 의 ${m[1]}="${m[2]}" — 색은 currentColor 뿐이다`);
    }
    assert.doesNotMatch(s.attrs + s.body, /stroke-width=|style=/, `${s.id} — 굵기 · 스타일은 .icon 이 준다`);
  }
  assert.equal(NAMES.size, SYMBOLS.length, '같은 이름의 symbol 이 둘이다');
  const rule = (HTML.match(/\n\s*\.icon \{([^}]*)\}/) || [])[1] || '';
  assert.match(rule, /stroke:\s*currentColor/, '.icon 의 선 색은 글자색');
  assert.match(rule, /stroke-width:\s*2\b/, '.icon 의 선 굵기는 한 값');
  assert.match(rule, /width:\s*1\.15em/, '높이는 글자를 따른다(em)');

  // 부르는 이름이 모두 스프라이트에 있다 — 마크업의 use · 등록부의 icon 열 · JS 도우미에 글자로 넘긴 이름
  const used = new Map();
  const note = (name, where) => { if (!used.has(name)) used.set(name, where); };
  for (const m of HTML.matchAll(/<use href="#i-([\w-]+)"/g)) note(m[1], 'index.html');
  for (const c of COMMANDS) if (c.icon) note(c.icon, `commands.${c.id}`);
  for (const [file, text] of Object.entries(SRC)) {
    for (const m of text.matchAll(/\bicon(?:Label|Only|Html|LabelHtml|El)\(\s*(?:[\w.]+,\s*)?'([\w-]+)'/g)) note(m[1], file);
    for (const m of text.matchAll(/\bicon:\s*'([\w-]+)'/g)) note(m[1], file);
  }
  assert.ok(used.size >= 30, `부르는 이름이 ${used.size}개뿐이다 — 읽는 법이 낡았나`);
  for (const [name, where] of used) assert.ok(NAMES.has(name), `${where} 가 부르는 「${name}」 이 스프라이트에 없다`);
});

test('iconLabel 은 svg use 와 글자 span 을 만든다', () => {
  const doc = fakeDoc();
  const btn = doc.createElement('button');
  iconLabel(btn, 'play', '재생', doc);
  assert.equal(btn.children.length, 2, '아이콘 하나 + 글자 칸 하나');
  const [svg, span] = btn.children;
  assert.equal(svg.tag, 'svg');
  assert.equal(svg.getAttribute('class'), 'icon');
  assert.equal(svg.getAttribute('aria-hidden'), 'true', '이름은 글자 칸이 말한다 — 그림은 읽히지 않는다');
  assert.equal(svg.getAttribute('focusable'), 'false');
  assert.equal(svg.children[0].tag, 'use');
  assert.equal(svg.children[0].getAttribute('href'), '#i-play');
  assert.equal(span.className, LABEL_CLASS);
  assert.equal(span.textContent, '재생');
  assert.equal(labelOf(btn), '재생');

  // 여러 번 불러도 같다 — 다시 그리는 뷰가 그릴 때마다 불러도 노드가 갈리지 않는다(누르는 순간 사라지지 않는다)
  iconLabel(btn, 'play', '재생', doc);
  assert.equal(btn.children[0], svg);
  assert.equal(btn.children[1], span);
  // 아이콘이 바뀌면 그림만 새로, 글자 칸은 그대로 쓴다
  iconLabel(btn, 'pause', '멈춤', doc);
  assert.equal(btn.children[0].children[0].getAttribute('href'), '#i-pause');
  assert.equal(btn.children[1], span);
  assert.equal(span.textContent, '멈춤');

  // 템플릿용 마크업도 같은 꼴이다
  assert.equal(iconLabelHtml('x', '닫기'),
    '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-x"></use></svg><span class="lbl">닫기</span>');
  assert.equal(iconHtml(''), '');
  assert.equal(iconLabelHtml('x', '<b>'), iconHtml('x') + '<span class="lbl">&lt;b&gt;</span>', '글자는 이스케이프한다');
  assert.equal(iconEl(doc, 'x').dataset.icon, 'x');
});

test('setLabel 은 글자 칸만 갈고 아이콘을 남긴다', () => {
  const doc = fakeDoc();
  const btn = doc.createElement('button');
  iconLabel(btn, 'mic', '마이크 켜기', doc);
  const svg = btn.children[0];
  setLabel(btn, '마이크 끄기', doc);
  setLabel(btn, '마이크 켜기', doc);
  assert.equal(btn.children.length, 2);
  assert.equal(btn.children[0], svg, '아이콘은 그대로 하나다');
  assert.equal(btn.children.filter(c => c.tag === 'svg').length, 1);
  assert.equal(labelOf(btn), '마이크 켜기');

  // 글자 칸이 없던 요소(아이콘만)에 글자를 주면 글자 칸이 생기고 아이콘은 남는다
  const only = doc.createElement('button');
  iconLabel(only, 'x', '', doc);
  setLabel(only, '닫기', doc);
  assert.equal(only.children[0].dataset.icon, 'x');
  assert.equal(labelOf(only), '닫기');
});

test('글자 없는 아이콘 버튼은 aria-label 을 가진다', () => {
  // ① 마크업 — 글자 칸 없이 아이콘만 든 단추
  let seen = 0;
  for (const m of HTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const inner = m[2];
    if (!/<svg class="icon"/.test(inner)) continue;
    const text = inner.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim();
    if (text) continue;
    seen += 1;
    const name = (m[1].match(/\baria-label="([^"]*)"/) || [])[1] || '';
    const id = (m[1].match(/\bid="([^"]*)"/) || [])[1] || m[1].slice(0, 60);
    assert.ok(name.trim(), `아이콘만 든 단추 ${id} 에 aria-label 이 없다`);
  }
  assert.ok(seen >= 8, `아이콘만 든 단추가 ${seen}개뿐이다 — 읽는 법이 낡았나`);

  // ② JS 템플릿 — `<button …>${iconHtml(…)}</button>` 꼴
  for (const [file, text] of Object.entries(SRC)) {
    for (const m of text.matchAll(/<button\b([^>]*)>\$\{iconHtml\([^)]*\)\}<\/button>/g)) {
      assert.match(m[1], /\baria-label="[^"]+"/, `${file} — 아이콘만 든 템플릿 단추에 aria-label 이 없다`);
    }
  }

  // ③ 도우미 — 이름 없이는 만들지 않는다
  const doc = fakeDoc();
  const del = doc.createElement('button');
  iconOnly(del, 'x', '이 마커 지우기', doc);
  assert.equal(del.getAttribute('aria-label'), '이 마커 지우기');
  assert.equal(del.title, '이 마커 지우기', '툴팁이 비었으면 같은 이름');
  assert.equal(del.children.length, 1);
  const titled = doc.createElement('button');
  titled.title = '이 영상을 목록에서 빼기(찍어 둔 박자·마커도 함께 사라집니다)';
  iconOnly(titled, 'x', '목록에서 빼기', doc);
  assert.equal(titled.title, '이 영상을 목록에서 빼기(찍어 둔 박자·마커도 함께 사라집니다)', '이미 있는 툴팁은 덮지 않는다');
  assert.throws(() => iconOnly(doc.createElement('button'), 'x', '', doc), /aria-label/);
});

test('스타일시트 content 와 단계 머리 data-icon 에 이모지가 없다', () => {
  const pict = /[←-⇿⌀-⏿■-➿⤀-⧿⬀-⯿\u{1F000}-\u{1FAFF}]/u;
  let contents = 0; let masks = 0;
  for (const { file, css } of STYLES) {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of flat.matchAll(/\bcontent:\s*([^;}]*)/g)) {
      contents += 1;
      assert.doesNotMatch(m[1], pict, `${file} — content: ${m[1].trim()} 에 그림 글자가 있다(마스크 아이콘으로)`);
    }
    for (const m of flat.matchAll(/var\(--icon-([\w-]+)\)/g)) {
      masks += 1;
      assert.ok(NAMES.has(m[1]), `${file} — --icon-${m[1]} 가 스프라이트에 없다(installIconMasks 가 만들지 않는다)`);
    }
  }
  assert.ok(contents >= 5 && masks >= 8, `content ${contents}개 · 마스크 ${masks}개 — 읽는 법이 낡았나`);
  // 마스크를 칠하는 규칙이 하나 있다 — ::before/::after 가 --mask 를 받아 글자색으로 칠한다
  assert.match(HTML, /mask:\s*var\(--mask,\s*linear-gradient\(transparent, transparent\)\)\s*center\s*\/\s*contain\s*no-repeat/);

  // 단계 머리 data-icon 은 스프라이트 이름이다(글자가 아니다)
  const icons = [...HTML.matchAll(/\bdata-icon="([^"]*)"/g)].map(m => m[1]);
  assert.ok(icons.length >= 6, `data-icon 이 ${icons.length}개뿐이다`);
  for (const name of icons) {
    assert.doesNotMatch(name, pict, `data-icon="${name}" 에 그림 글자가 있다`);
    assert.ok(NAMES.has(name), `data-icon="${name}" 가 스프라이트에 없다`);
  }
});

// ── 표 밖 ─────────────────────────────────────────────────────────────────────

test('installIconMasks — symbol 마다 --icon-이름 마스크를 :root 에 단다', () => {
  const set = new Map();
  const syms = [
    { id: 'i-play', innerHTML: '<path d="M6 4l14 8-14 8z"/>', attributes: [{ name: 'id', value: 'i-play' }, { name: 'viewBox', value: '0 0 24 24' }] },
    { id: 'other', innerHTML: '', attributes: [] },
  ];
  const doc = {
    getElementById: (id) => (id === 'icon-sprite' ? { querySelectorAll: () => syms } : null),
    documentElement: { style: { setProperty: (k, v) => set.set(k, v) } },
  };
  assert.equal(installIconMasks(doc), 1, 'i- 로 시작하는 것만');
  const url = set.get('--icon-play');
  assert.ok(url.startsWith('url("data:image/svg+xml,'));
  const svg = decodeURIComponent(url.slice('url("data:image/svg+xml,'.length, -2));
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke-width="2"/, '마스크도 .icon 과 같은 굵기');
  assert.match(svg, /<path d="M6 4l14 8-14 8z"\/>/);
  assert.equal(installIconMasks({ getElementById: () => null }), 0, '스프라이트가 없으면 아무것도 안 한다');
  assert.equal(maskUrl('', { a: '"' }).includes('%26quot%3B'), true, '속성 값은 이스케이프한다');
});

test('등록부의 button 글자는 그림 글자로 시작하지 않는다 — 그림은 icon 열이다', () => {
  for (const c of COMMANDS) {
    if (c.button) assert.doesNotMatch(c.button, LABEL_PICTO_RE, `${c.id} 의 button`);
    if (c.icon) assert.ok(NAMES.has(c.icon), `${c.id} 의 icon 「${c.icon}」 이 스프라이트에 없다`);
  }
  assert.ok(COMMANDS.filter(c => c.icon).length >= 8, 'icon 열이 비었다');
});

// 회귀(2026-11-03, RM-18 브라우저 확인): installIconMasks 가 돌기 전(부팅 중)에는 --icon-이름 이 없다. 마스크에 물러설 자리가
// 없으면 mask 가 none 이 되어 ::before 가 글자색 네모(■)로 잠깐 보였다 — 마스크를 쓰는 자리는 모두 투명 그림으로 물러선다.
test('스타일시트 마스크는 아이콘 변수가 없을 때 투명으로 물러선다', () => {
  const sheets = { 'index.html': HTML, ...SRC };
  let seen = 0;
  for (const [file, text] of Object.entries(sheets)) {
    for (const m of text.matchAll(/(?<![\w-])(?:-webkit-)?mask(?:-image)?\s*:\s*var\((--[\w-]+)([^;]*)/g)) {
      if (/-image/.test(m[0])) continue; // open 일 때 그림만 바꾸는 줄은 바탕 규칙의 물러섬을 따른다
      seen += 1;
      assert.match(m[2], /^\s*,\s*linear-gradient\(transparent/, `${file}: ${m[0].slice(0, 60)} — 물러설 투명 그림이 없다`);
    }
  }
  assert.ok(seen >= 4, `마스크 규칙을 ${seen}개 읽었다 — 꼴이 바뀌어 0 이 되면 시험이 빈손이 된다`);
});
