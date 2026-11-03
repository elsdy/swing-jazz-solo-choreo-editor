// tests/unit/docsHubInline.test.mjs — 문서 창 렌더러의 인라인 처리가 글자를 한 번만 이스케이프하는지(RM-65)
//
// `inline` 은 줄 전체를 먼저 이스케이프한 뒤 백틱 속 글을 떼어 두었다가 되돌려 놓는다. 되돌릴 때 또 이스케이프하면
// 인라인 코드 속 < > " 가 &lt; &gt; &quot; 글자 그대로 보이고, 링크 href 의 & 는 &amp;amp; 가 된다.
// 시험 이름은 계획서(docs/roadmap/plans/RM-65.md)의 「요구 ↔ 시험」 표와 같아야 한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../../src/ui/docsHub.js';
import { DOCS } from '../../src/ui/docsRegistry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOUBLE = /&amp;(lt|gt|quot|#39|amp);/;

test('[RM-65 요구 0] 인라인 코드 속 꺾쇠 · 따옴표 · 앰퍼샌드는 한 번만 이스케이프된다', () => {
  const { html } = renderMarkdown('`<a href="x">&</a>` 와 `\'q\'`');
  assert.ok(html.includes('<code>&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;</code>'), html);
  assert.ok(html.includes('<code>&#39;q&#39;</code>'), html);
  assert.doesNotMatch(html, DOUBLE);
});

test('[RM-65 요구 1] 인라인 코드와 문단 속 원시 태그는 태그로 살아나지 않는다', () => {
  const { html } = renderMarkdown('앞 `<script>alert(1)</script>` 뒤 <b>x</b> 끝');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<b>/);
  assert.ok(html.includes('<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>'), html);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), html);
});

test('[RM-65 요구 2] 인라인 코드 안의 꾸밈 기호와 링크 문법은 글자로 남는다', () => {
  const { html } = renderMarkdown('보기: `**a** ~~b~~ *c* [d](e.md)`');
  const code = html.match(/<code>([\s\S]*?)<\/code>/);
  assert.ok(code, html);
  assert.equal(code[1], '**a** ~~b~~ *c* [d](e.md)');
  assert.doesNotMatch(html, /<strong>|<del>|<em>|<a /);
});

test('[RM-65 요구 3] 링크 주소의 앰퍼샌드는 한 번만 이스케이프된다', () => {
  const { html } = renderMarkdown('[x](https://a.b/?p=1&q=2)');
  assert.ok(html.includes('href="https://a.b/?p=1&amp;q=2"'), html);
  assert.ok(html.includes('data-href="https://a.b/?p=1&amp;q=2"'), html);
  assert.doesNotMatch(html, DOUBLE);
  // 안전하지 않은 주소는 여전히 링크가 되지 않는다
  assert.doesNotMatch(renderMarkdown('[x](javascript:alert(1))').html, /<a /);
});

// 문서가 개체 이름을 글자로 적은 자리(이 결함을 설명하는 버그 기록 · 원칙의 `&lt;` 같은 것)는 한 번 이스케이프하면
// 바르게 `&amp;lt;` 가 된다. 그래서 흔적 수를 0 이 아니라 **원문에 적힌 개체 글자의 수**와 맞춰 잰다 —
// 두 번 이스케이프하면 원문의 `<` 하나하나가 흔적을 더해 원문 쪽보다 많아진다(고치기 전 13개 문서 460곳).
const ENTITY_TEXT = /&(lt|gt|quot|#39|amp);/g;

test('[RM-65 요구 4] 지금 저장소의 등록 문서 전부에 이중 이스케이프 흔적이 없다', () => {
  const bad = [];
  for (const d of DOCS) {
    const md = readFileSync(join(ROOT, d.path), 'utf8');
    const { html } = renderMarkdown(md);
    const hits = html.match(new RegExp(DOUBLE.source, 'g')) || [];
    const literal = (md.match(ENTITY_TEXT) || []).length;
    if (hits.length !== literal) {
      bad.push(`${d.path}: 흔적 ${hits.length}건 · 원문의 개체 글자 ${literal}건 (${[...new Set(hits)].join(' ')})`);
    }
  }
  assert.deepEqual(bad, []);
});

test('[RM-65] 원문에 글자로 적은 개체 이름은 한 번만 이스케이프되어 그대로 보인다', () => {
  const { html } = renderMarkdown('글자 `&lt;` 와 맨글 &quot;');
  assert.ok(html.includes('<code>&amp;lt;</code>'), html);
  assert.ok(html.includes('맨글 &amp;quot;'), html);
  assert.doesNotMatch(html, /&amp;amp;/);
});
