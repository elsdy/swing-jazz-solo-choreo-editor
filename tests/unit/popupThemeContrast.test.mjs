// tests/unit/popupThemeContrast.test.mjs — 블록 팝업 제목이 테마마다 바탕 위에서 읽히는가(RM-56, 2026-11-04)
//
// 솜사탕(밝은 테마)에서 블록을 탭해 여는 팝업(.routine-action-popup)의 제목 줄(.rap-title)이
// rgba(var(--white-rgb), 0.55) 로 박혀 있어 흰→분홍 바탕(--t-pop) 위에서 빈 띠로 보였다(1:1).
// themeContrast.test.mjs(RM-43)는 토큰끼리만 잰다 — 여기서는 **실제 규칙**을 읽는다: 테마마다 팝업 제목의 color 와
// 팝업의 background 를 index.html 의 규칙에서 골라(기본 규칙 위에 `:root[data-theme]` 덮개가 이긴다), 토큰을 풀고,
// 반투명 글자는 바탕 위에 섞고, 그러데이션 바탕은 첫 색(밝은 끝)으로 잰다.
//
// ⚠ 한계: 그러데이션의 다른 끝(솜사탕 #fdf1f8)은 첫 색보다 대비가 조금 낮다 — 첫 색만 잰다는 것을 알고 둔다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** WCAG 본문 글자 기준. 팝업 제목은 작은 글자(--fs-1)라 큰 글자 기준(3:1)을 쓰지 않는다. */
const BODY = 4.5;
const POPUP = '.routine-action-popup';
const TITLE = '.routine-action-popup .rap-title';

// ── CSS 글자 읽기 ───────────────────────────────────────────────────────────

/** `<style>` 원문을 이어 붙이고 주석을 걷는다. */
// @complexity time=O(n) space=O(n) cc=1
function styleText(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 규칙 몸통의 선언을 { 이름: 값 } 으로 — 괄호 안의 `;` 은 없다고 본다. */
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

/** 중괄호가 한 겹인 규칙 전부 — [{ selectors: [...], decls: {...} }]. */
// @complexity time=O(n) space=O(n) cc=1
function rules(html) {
  return [...styleText(html).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    decls: declarations(m[2]),
  }));
}

/** 테마마다의 토큰 표 — 기본 `:root` 위에 그 테마의 값을 얹는다. */
// @complexity time=O(n) space=O(n) cc=4
function themeTokens(html) {
  const base = {};
  const themed = {};
  for (const m of styleText(html).matchAll(/(?:^|[}\s;])(:root(?:\[data-theme="([\w-]+)"\])?)\s*\{([^{}]*)\}/g)) {
    const decls = declarations(m[3]);
    if (m[2]) themed[m[2]] = { ...(themed[m[2]] || {}), ...decls };
    else Object.assign(base, decls);
  }
  const out = { basic: { ...base } };
  for (const [id, decls] of Object.entries(themed)) out[id] = { ...base, ...decls };
  return out;
}

/**
 * 테마 하나에서 선택자 `sel` 의 속성 `prop` 이 무엇으로 정해지나 — 기본 규칙(`sel`) 위에 테마 덮개
 * (`:root[data-theme] sel` · `:root[data-theme="<id>"] sel`)가 이긴다(더 구체적이다). 같은 급이면 뒤 규칙이 이긴다.
 */
// @complexity time=O(r·s) space=O(1) cc=8
function ruleValue(all, sel, prop, theme) {
  let best = null;
  let rank = -1;
  for (const r of all) {
    if (r.decls[prop] == null) continue;
    for (const s of r.selectors) {
      let k = -1;
      if (s === sel) k = 0;
      else if (theme !== 'basic' && s === `:root[data-theme] ${sel}`) k = 1;
      else if (theme !== 'basic' && s === `:root[data-theme="${theme}"] ${sel}`) k = 2;
      if (k >= rank && k >= 0) { rank = k; best = r.decls[prop]; }
    }
  }
  return best;
}

/** `#rgb` · `#rrggbb` → [r, g, b]. */
// @complexity time=O(1) space=O(1) cc=2
function hexRgb(hex) {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
  const n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * CSS 색 값을 [r, g, b] 로 푼다 — `var(--x[, 대체])` 는 따라가고, `rgba(var(--x-rgb), a)` · `rgba(r, g, b, a)` 는
 * `under`(그 밑의 바탕 색) 위에 섞고, 그러데이션은 첫 색을 쓴다. 못 풀면 null.
 */
// @complexity time=O(d) space=O(d) cc=11
function resolveColor(tokens, value, under = null, depth = 0) {
  if (value == null || depth > 8) return null;
  const v = value.trim();
  const ref = v.match(/^var\((--[\w-]+)(?:\s*,[\s\S]*)?\)$/);
  if (ref) return resolveColor(tokens, tokens[ref[1]], under, depth + 1);
  if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) return hexRgb(v);
  const grad = v.match(/^linear-gradient\(\s*(?:[\d.]+deg\s*,\s*)?((?:rgba?\([^)]*\))|#[0-9a-fA-F]{3,6})/);
  if (grad) return resolveColor(tokens, grad[1], under, depth + 1);
  const rgba = v.match(/^rgba?\(\s*(var\((--[\w-]+)\)|[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (!rgba) return null;
  const chan = (rgba[2] ? tokens[rgba[2]] : rgba[1])?.split(',').map(Number);
  if (!chan || chan.length !== 3 || chan.some(Number.isNaN)) return null;
  const a = rgba[3] == null ? 1 : Number(rgba[3]);
  if (a >= 0.9 || !under) return chan; // 거의 불투명한 바탕(0.97)은 그 색으로 본다
  return chan.map((c, i) => c * a + under[i] * (1 - a));
}

/** WCAG 상대 휘도. */
// @complexity time=O(1) space=O(1) cc=2
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 두 색의 대비율(1 ~ 21). */
// @complexity time=O(1) space=O(1) cc=1
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 테마마다 팝업 제목 글자와 팝업 바탕의 대비 — { 테마: { color, background, ratio } }. 못 풀면 ratio 는 NaN. */
// @complexity time=O(t·r·s) space=O(t) cc=3
function titleContrast(html) {
  const all = rules(html);
  const out = {};
  for (const [theme, tokens] of Object.entries(themeTokens(html))) {
    const background = ruleValue(all, POPUP, 'background', theme);
    const color = ruleValue(all, TITLE, 'color', theme);
    const bg = resolveColor(tokens, background);
    const fg = bg && resolveColor(tokens, color, bg);
    out[theme] = { color, background, ratio: fg ? +contrast(fg, bg).toFixed(2) : NaN };
  }
  return out;
}

/** 팝업 제목을 고르는 규칙의 color · border 값에 박힌 밝은 색(--white-rgb · #fff · white)이 있으면 돌려준다. */
// @complexity time=O(r·s) space=O(r) cc=5
function pinnedWhite(html) {
  const bad = [];
  for (const r of rules(html)) {
    if (!r.selectors.some((s) => s.endsWith('.rap-title'))) continue;
    for (const [prop, value] of Object.entries(r.decls)) {
      if (!/^(?:color|border(?:-[\w-]+)?)$/.test(prop)) continue;
      if (/--white-rgb|#fff\b|#ffffff\b|\bwhite\b/i.test(value)) bad.push(`${prop}: ${value}`);
    }
  }
  return bad;
}

// ── 시험 ───────────────────────────────────────────────────────────────────

test('[RM-56 요구 0] 테마마다 팝업 제목 글자 토큰과 팝업 바탕 첫 색의 대비가 4.5 이상', () => {
  const got = titleContrast(HTML);
  for (const id of ['basic', 'neon', 'rose', 'candy']) assert.ok(got[id], `테마를 못 읽었다: ${id}`);
  // 솜사탕 — 밝은 바탕(--t-pop 첫 색 #ffffff) 위의 제목.
  assert.ok(got.candy.ratio >= BODY, `솜사탕 팝업 제목 대비 ${got.candy.ratio} < ${BODY}: ${JSON.stringify(got.candy)}`);

  // 견본 — 보고된 그때처럼 흰 글자로 돌아가면 붉어진다(1:1).
  const broken = HTML.replace('</style>', `:root[data-theme] ${TITLE} { color: rgba(var(--white-rgb), 0.55); }\n</style>`);
  assert.ok(titleContrast(broken).candy.ratio < 1.5);
});

test('[RM-56 요구 1] 팝업 제목 구분선이 테마 토큰을 쓴다', () => {
  const all = rules(HTML);
  for (const theme of ['basic', 'candy']) {
    const line = [ruleValue(all, TITLE, 'border-bottom', theme), ruleValue(all, TITLE, 'border-bottom-color', theme)]
      .filter(Boolean).join(' | ');
    assert.ok(line, `${theme}: 구분선을 정한 규칙이 없다`);
  }
  // 테마일 때 이기는 구분선 색은 테마 빛(--t-glow) 또는 글자(--text-rgb) 계열이다.
  const themed = ruleValue(all, TITLE, 'border-bottom-color', 'candy') ?? ruleValue(all, TITLE, 'border-bottom', 'candy');
  assert.match(themed, /var\(--(?:t-glow|text-rgb)\)/);
  const basic = ruleValue(all, TITLE, 'border-bottom', 'basic');
  assert.match(basic, /var\(--text-rgb\)/);
});

test('[RM-56 요구 2] 어두운 테마의 제목 토큰도 바탕과 대비가 있다', () => {
  const got = titleContrast(HTML);
  for (const id of ['basic', 'neon', 'rose']) {
    assert.ok(got[id].ratio >= BODY, `${id} 팝업 제목 대비 ${got[id].ratio} < ${BODY}: ${JSON.stringify(got[id])}`);
  }
});

test('[RM-56 요구 3] 팝업 제목 규칙에 white-rgb 글자색이 없다', () => {
  assert.deepEqual(pinnedWhite(HTML), []);
  // 견본 — 기본 규칙이 다시 흰색으로 박히면 붉어진다.
  const broken = HTML.replace('</style>', `${TITLE} { border-bottom: 1px solid #fff; }\n</style>`);
  assert.deepEqual(pinnedWhite(broken), ['border-bottom: 1px solid #fff']);
});
