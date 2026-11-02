// tests/unit/mobileZoom.test.mjs — 폰 확대 차단 걷기(RM-27 요구 7, 개발 원칙 U-10)
//
// 실제 index.html 과 src/ui/layout.js 를 읽어 잰다. 확대를 막던 세 조치(viewport 의 user-scalable=no ·
// maximum-scale=1, focusout 때 viewport 다시 박기 + scrollTo(0, 0))가 사라지고, 그 대신 좁은 화면의 입력칸
// 글자가 16px 로 되살아났는지, 잠금 중 핀치 차단은 그대로인지.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankJs } from '../../tools/lib/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const layout = readFileSync(join(ROOT, 'src/ui/layout.js'), 'utf8');

/** `@media (max-width: 1040px) { … }` 블록 본문 전부(여럿이다). */
function mediaBlocks(text, query) {
  const out = [];
  let at = 0;
  while ((at = text.indexOf(query, at)) >= 0) {
    const open = text.indexOf('{', at);
    let depth = 0; let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    out.push(text.slice(open + 1, j));
    at = j;
  }
  return out;
}

test('좁은 화면의 input · select · textarea 는 16px 이상이고 viewport 는 확대를 막지 않는다', () => {
  // ① viewport 메타
  const meta = html.match(/<meta\b[^>]*name="viewport"[^>]*>/);
  assert.ok(meta, 'viewport 메타가 없다');
  assert.doesNotMatch(meta[0], /maximum-scale/);
  assert.doesNotMatch(meta[0], /user-scalable\s*=\s*(no|0)/);
  assert.match(meta[0], /width=device-width/);

  // ② 1040px 이하 블록 안에서 input · select · textarea 를 함께 잡는 규칙이 16px 이상
  const css = html.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = mediaBlocks(css, '@media (max-width: 1040px)')
    .flatMap(b => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
    .map(m => ({ sel: m[1].split(',').map(x => x.trim()), body: m[2] }));
  const hit = rules.find(r => ['input', 'select', 'textarea'].every(t => r.sel.includes(t)));
  assert.ok(hit, '1040px 이하 블록에 input, select, textarea 규칙이 없다');
  const px = Number((hit.body.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/) || [])[1]);
  assert.ok(px >= 16, `입력칸 글자가 ${px}px 이다 — iOS 는 16px 미만이면 저절로 확대한다`);
  // 옛 주석(「maximum-scale=1 로 iOS 줌 방지 처리됨」)이 돌아오지 않았다
  assert.doesNotMatch(html, /별도 font-size 강제 불필요/);

  // ③ focusout 이 viewport 를 다시 박거나 맨 위로 굴리지 않는다(주석은 이력이라 지운 원문에서 잰다)
  const code = blankJs(layout);
  assert.doesNotMatch(layout.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'), /'focusout'/);
  assert.doesNotMatch(code, /scrollTo\(\s*0\s*,\s*0\s*\)/);
  assert.doesNotMatch(layout.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'), /user-scalable/);

  // ④ 잠금 중 핀치 차단은 남는다
  assert.match(html, /\.board-wrap\[data-locked="1"\]\s*\{\s*touch-action:\s*none;/);
  assert.match(html, /\.sidebar-scroll\[data-locked="1"\]\s*\{\s*touch-action:\s*none;/);
  assert.match(layout, /on\(doc, 'gesturestart', onGesture/);
  assert.match(layout, /on\(doc, 'touchmove', \(e\) => \{/);
});
