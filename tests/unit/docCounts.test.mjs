// tests/unit/docCounts.test.mjs — 문서 검사 ⑦ 시험 수 한 자리(tools/docCounts.mjs)의 자기 시험
//
// 세 시험은 계획서(docs/roadmap/plans/RM-64.md)의 「요구 ↔ 시험」 표 1 · 3 · 4 이고, 이름이 표와 같아야 한다
// (표 2 · 5 는 문서 문장 · 실제 수라 시험이 없다).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNT_DOCS, COUNT_HOME, checkTestCounts, findTestCounts, formatCount } from '../../tools/docCounts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

test('[RM-64 요구 0] 지금 README 의 명령 블록에는 시험 수가 없다', () => {
  assert.ok(COUNT_DOCS.includes('README.md'));
  assert.deepEqual(findTestCounts(read('README.md')), []);
});

test('[RM-64 요구 2] 지금 ARCHITECTURE 의 명령 블록에는 시험 수가 없다', () => {
  assert.ok(COUNT_DOCS.includes('docs/ARCHITECTURE.md'));
  const text = read('docs/ARCHITECTURE.md');
  // 코드 블록 밖의 제목 「안전망 — 골든 150개」는 이력을 말하는 문장이라 잡지 않는다 — 그 제목이 있어도 빈 목록이다.
  assert.match(text, /^## 안전망 — 골든 \d+개/m);
  assert.deepEqual(findTestCounts(text), []);
});

test('[RM-64 요구 3] 코드 블록의 node 명령 주석에 N개가 있으면 줄과 함께 잡고 블록 밖 · 다른 명령은 넘긴다', () => {
  const md = [
    '# 제목',                                                  // 1
    '',                                                        // 2
    '단위 테스트 622개는 블록 밖 문장이다.',                     // 3
    '',                                                        // 4
    '```',                                                     // 5
    "node --test 'tests/**/*.test.mjs' # 단위 테스트 622개",    // 6 ← 잡는다
    'node tests/run.mjs                # 격자 알고리즘 골든',    // 7 수 없음
    'python3 server.py                 # 시험 22개',            // 8 node 아님
    'node tools/check-docs.mjs         # 문서 검사',            // 9 수 없음
    '  node tests/run.mjs # 골든 173 개',                       // 10 ← 잡는다(들여쓰기 · 띄어 쓴 개)
    '```',                                                     // 11
    '',                                                        // 12
    'node tests/run.mjs # 골든 173개 — 블록 밖',                 // 13 블록 밖
    '~~~',                                                     // 14
    'node x.mjs # 원칙 아홉',                                   // 15 숫자가 아니다
    '~~~',                                                     // 16
  ].join('\n');
  assert.deepEqual(findTestCounts(md), [
    { line: 6, text: "node --test 'tests/**/*.test.mjs' # 단위 테스트 622개" },
    { line: 10, text: 'node tests/run.mjs # 골든 173 개' },
  ]);

  // 여러 문서: 수의 자리(CLAUDE.md)는 건너뛰고, 나머지는 파일:줄로 찍는다.
  const hits = checkTestCounts({ [COUNT_HOME]: md, 'README.md': md, 'docs/ARCHITECTURE.md': '```\nnode a # 1개\n```' });
  assert.deepEqual(hits.map(h => `${h.file}:${h.line}`), ['README.md:6', 'README.md:10', 'docs/ARCHITECTURE.md:2']);
  assert.ok(!COUNT_DOCS.includes(COUNT_HOME));
  assert.match(formatCount(hits[0]), /^README\.md:6: .*CLAUDE\.md/);
});
