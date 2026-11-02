// tests/unit/moduleSyntax.test.mjs — src/ 의 모든 ES 모듈이 브라우저가 읽을 수 있는 문법인가 (RM-20 에서 둠)
//
// ⚠ `node --check 파일.js` 로는 못 잰다. 이 저장소에는 package.json 이 없어(type 없음) node 가 모듈 꼴을 짐작하는데,
//   `export` 가 든 파일은 문법 오류가 있어도 종료 0 으로 지나간다(Node 25.2.1 실측 — 2026-11-02, 템플릿 문자열 안에 백틱을
//   넣어 practiceBar.js 가 깨졌는데 --check 는 초록, 브라우저는 앱 전체가 뜨지 않았다). 그래서 **실제로 불러 본다.**
// 불러 보는 동안 DOM 이 없어 던지는 ReferenceError(main.js 의 document 같은 것)는 문법과 무관하니 넘기고, SyntaxError 만 붉힌다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// @complexity time=O(n) space=O(n) cc=4
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('src/ 의 모든 모듈이 ES 모듈 문법으로 읽힌다', async () => {
  const bad = [];
  for (const f of jsFiles(join(ROOT, 'src'))) {
    try {
      await import(pathToFileURL(f).href);
    } catch (e) {
      if (e instanceof SyntaxError) bad.push(`${relative(ROOT, f)}: ${e.message}`);
    }
  }
  assert.deepEqual(bad, [], `문법이 깨진 모듈:\n  ${bad.join('\n  ')}`);
});
