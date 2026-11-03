// tests/unit/themeContrast.test.mjs — 테마마다 글자 토큰과 바탕 토큰의 대비(RM-43, 2026-11-03)
//
// 솜사탕(밝은 테마)에서 서랍 제목 · 영상 파일 이름 알약이 밝은 분홍 위 밝은 회색(#dbe4ef, 1.19:1)이라 안 보였다.
// 박힌 색은 RM-17(#63)이 토큰으로 걷었지만, 토큰 **값**이 무너지는 것은 U-16 검사기(박힌 색 금지)가 못 잡는다.
// 그래서 여기서 index.html 의 `:root` · `:root[data-theme="…"]` 블록을 글자로 읽어 테마마다 WCAG 대비율을 잰다.
//
// ⚠ 다시 쓰는 꼴: 밝은 테마의 다른 글자 자리(RM-56 · RM-59 의 블록 팝업 제목 같은 것)는 `CONTRAST_PAIRS` 에
//   한 줄을 더하고, 그 자리의 색이 토큰을 쓰는지는 `TOKEN_TEXT_SPOTS` 에 한 줄을 더한다.
// ⚠ 한계: 토큰끼리의 대비만 잰다. 반투명 겹침(rgba) · 그러데이션(--t-*) 위의 실제 글자는 브라우저에서 눈으로 본다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** WCAG 기준 — 본문 글자 4.5:1, 보조 글자(큰 글자 · 흐린 안내) 3:1. */
const BODY = 4.5;
const SUB = 3;

/**
 * 잴 짝 — { fg: 글자 토큰, on: 바탕 토큰들, min: 기준, themedOnly: 테마 블록에만 있는 토큰이면 true }.
 * 새 글자 자리를 지키려면 여기 한 줄을 더한다.
 */
const CONTRAST_PAIRS = [
  { fg: '--text', on: ['--bg', '--bg-2', '--surface'], min: BODY },
  { fg: '--muted', on: ['--bg', '--bg-2', '--surface'], min: SUB },
  { fg: '--t-ink', on: ['--bg', '--bg-2'], min: BODY, themedOnly: true },
  { fg: '--t-dim', on: ['--bg', '--bg-2'], min: SUB, themedOnly: true },
];

/** 글자색이 토큰이어야 하는 자리 — { selector: index.html 의 규칙 선택자(그대로), why }. */
const TOKEN_TEXT_SPOTS = [
  { selector: '.drawer > summary', why: '서랍 제목 넷(파일 · 루틴 목록 · 카테고리 관리 · 목록에 없는 동작 만들기)' },
  { selector: '.video-file-name', why: '영상 칸 파일 이름 알약' },
];

// ── CSS 글자 읽기 ───────────────────────────────────────────────────────────

/** `<style>` 원문을 이어 붙이고 주석을 걷는다. */
// @complexity time=O(n) space=O(n) cc=1
function styleText(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 규칙 몸통의 선언을 { 이름: 값 } 으로. 괄호 안의 `;` 은 없다고 본다(토큰 블록 · 글자 규칙에 그런 값이 없다). */
// @complexity time=O(n) space=O(n) cc=3
function declarations(body) {
  const out = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return out;
}

/**
 * 테마마다의 토큰 표 — { basic: {…}, neon: {…}, … }. 테마 블록은 기본 `:root` 위에 덮이므로(캐스케이드)
 * 기본 값을 깔고 그 테마의 값을 얹는다. `@media` 안의 `:root`(격자 치수만 바꾼다)도 기본에 섞이지만 색과 무관하다.
 */
// @complexity time=O(n) space=O(n) cc=4
function themeTokens(html) {
  const css = styleText(html);
  const base = {};
  const themed = {};
  for (const m of css.matchAll(/(?:^|[}\s;])(:root(?:\[data-theme="([\w-]+)"\])?)\s*\{([^{}]*)\}/g)) {
    const decls = declarations(m[3]);
    if (m[2]) themed[m[2]] = { ...(themed[m[2]] || {}), ...decls };
    else Object.assign(base, decls);
  }
  const out = { basic: { ...base } };
  for (const [id, decls] of Object.entries(themed)) out[id] = { ...base, ...decls };
  return { themes: out, themedIds: Object.keys(themed) };
}

/** 토큰 값을 #rrggbb 로 — `var(--x)` 는 따라가고, 한 색이 아닌 값(그러데이션 · 반투명)은 null. */
// @complexity time=O(d) space=O(d) cc=6
function resolveHex(tokens, name, seen = new Set()) {
  const raw = tokens[name];
  if (raw == null || seen.has(name)) return null;
  seen.add(name);
  const ref = raw.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolveHex(tokens, ref[1], seen);
  const hex = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!hex) return null;
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  return `#${h.toLowerCase()}`;
}

/** WCAG 상대 휘도. */
// @complexity time=O(1) space=O(1) cc=2
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 두 색의 대비율(1 ~ 21). */
// @complexity time=O(1) space=O(1) cc=1
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 테마마다 CONTRAST_PAIRS 를 재서 기준 아래인 짝을 돌려준다 — [{ theme, fg, on, ratio, min }].
 * 토큰을 색으로 못 풀면(없거나 그러데이션) 그것도 실패로 센다 — 조용히 넘기면 시험이 아무것도 안 재게 된다.
 */
// @complexity time=O(t·p·b) space=O(t·p·b) cc=7
function contrastFailures(html, pairs = CONTRAST_PAIRS) {
  const { themes, themedIds } = themeTokens(html);
  const fails = [];
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const p of pairs) {
      if (p.themedOnly && !themedIds.includes(theme)) continue;
      const fg = resolveHex(tokens, p.fg);
      for (const on of p.on) {
        const bg = resolveHex(tokens, on);
        if (!fg || !bg) { fails.push({ theme, fg: p.fg, on, ratio: NaN, min: p.min }); continue; }
        const ratio = contrast(fg, bg);
        if (ratio < p.min) fails.push({ theme, fg: `${p.fg} ${fg}`, on: `${on} ${bg}`, ratio: +ratio.toFixed(2), min: p.min });
      }
    }
  }
  return fails;
}

/**
 * TOKEN_TEXT_SPOTS 의 자리마다, 그 선택자로 끝나는 규칙(테마 덮개 `:root[data-theme] .drawer > summary` 포함)의
 * `color` 가 글자 토큰(var(--text) · var(--muted) · var(--t-ink) · var(--t-dim))인지 본다 — 어긴 것을 돌려준다.
 * 자리마다 색을 정한 규칙이 하나도 없어도 실패다(선택자가 바뀌면 시험이 헛돌지 않게).
 */
// @complexity time=O(r·s) space=O(r) cc=6
function hardcodedTextSpots(html, spots = TOKEN_TEXT_SPOTS) {
  const css = styleText(html);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    color: declarations(m[2]).color,
  }));
  const bad = [];
  for (const spot of spots) {
    const hits = rules.filter((r) => r.color && r.selectors.some((s) => s === spot.selector || s.endsWith(` ${spot.selector}`)));
    if (hits.length === 0) bad.push({ selector: spot.selector, color: '(색을 정한 규칙 없음)' });
    for (const r of hits) {
      if (!/^var\(--(?:text|muted|t-ink|t-dim)\)$/.test(r.color)) bad.push({ selector: spot.selector, color: r.color });
    }
  }
  return bad;
}

// ── 시험 ───────────────────────────────────────────────────────────────────

test('[RM-43 요구 2] 테마마다 글자 토큰과 바탕 토큰의 대비가 기준을 넘는다', () => {
  const { themes } = themeTokens(HTML);
  // 읽기가 헛돌지 않는지 — 네 테마가 모두 잡히고, 솜사탕의 글자 토큰이 짙은 색으로 읽힌다.
  for (const id of ['basic', 'neon', 'rose', 'candy']) assert.ok(themes[id], `테마 블록을 못 읽었다: ${id}`);
  assert.equal(resolveHex(themes.candy, '--text'), '#452f52');

  assert.deepEqual(contrastFailures(HTML), [], '대비가 기준 아래인 짝이 있다');

  // 견본 — 보고된 그때처럼 솜사탕 글자가 밝은 회색이면 붉어진다(1.19:1).
  const broken = HTML.replace(/(:root\[data-theme="candy"\]\s*\{[\s\S]*?--text:\s*)#452f52/, '$1#dbe4ef');
  assert.notEqual(broken, HTML, '견본을 만들지 못했다 — 솜사탕 블록의 --text 꼴이 바뀌었나');
  const fails = contrastFailures(broken);
  assert.ok(fails.some((f) => f.theme === 'candy' && f.fg.startsWith('--text') && f.ratio < 1.5), JSON.stringify(fails));

  // 견본 — 보조 글자를 바탕에 너무 가깝게 옅히면 3:1 에서 붉어진다.
  const faint = HTML.replace(/(:root\[data-theme="candy"\]\s*\{[\s\S]*?--muted:\s*)#8b7aa1/, '$1#d8cfe3');
  assert.ok(contrastFailures(faint).some((f) => f.theme === 'candy' && f.fg.startsWith('--muted')));
});

test('[RM-43 요구 3] 서랍 제목과 파일 이름 알약은 글자 토큰을 쓴다', () => {
  assert.deepEqual(hardcodedTextSpots(HTML), [], '글자색이 박힌 값이다');

  // 견본 — RM-17 전처럼 서랍 제목에 어두운 테마용 밝은 색을 박으면 붉어진다.
  const pinned = HTML.replace(/(\.drawer > summary \{[^}]*?color:\s*)var\(--text\)/, '$1#dbe4ef');
  assert.notEqual(pinned, HTML, '견본을 만들지 못했다 — .drawer > summary 규칙의 꼴이 바뀌었나');
  assert.deepEqual(hardcodedTextSpots(pinned), [{ selector: '.drawer > summary', color: '#dbe4ef' }]);

  // 견본 — 테마 덮개가 박힌 색으로 덮어도 붉어진다.
  const themed = HTML.replace('</style>', ':root[data-theme] .video-file-name { color: #fff; }\n</style>');
  assert.deepEqual(hardcodedTextSpots(themed), [{ selector: '.video-file-name', color: '#fff' }]);
});
