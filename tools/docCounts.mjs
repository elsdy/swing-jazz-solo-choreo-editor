// tools/docCounts.mjs — 시험 수는 개발 지침(CLAUDE.md) 한 자리에만 둔다. 다른 문서에 다시 끼면 잡는다. 의존성 0.
//
// check-docs 의 일곱째 검사(⑦)가 파일을 읽어 이 모듈의 함수에 **글자만** 넘긴다 — 그래서 시험이 작은 조각으로
// 같은 함수를 부를 수 있다(tests/unit/docCounts.test.mjs, 계획서 docs/roadmap/plans/RM-64.md 의 「요구 ↔ 시험」 표).
//
// 왜: 단위 시험을 늘린 PR 들이 CLAUDE.md 의 수만 고치고 README 는 빠뜨렸다 — README 는 622개, CLAUDE.md 는 649개,
// ARCHITECTURE.md 첫머리는 그보다 더 옛 수(단위 66 · 골든 150)였다(2026-11-03, RM-64). 수를 여러 자리에 두면 고칠
// 자리가 여럿이라 반드시 하나가 묵는다. 그래서 수는 CLAUDE.md 에만 두고 다른 문서는 숫자 없이 그 자리를 가리킨다.
//
// 무엇을 잡나: 펜스 코드 블록(``` 또는 ~~~) 안에서 `node` 로 시작하는 명령 줄의 `#` 주석에 「숫자 + 개」가 있으면.
//   - 블록 밖 문장(「안전망 — 골든 150개」 같은 제목 · 본문)은 잡지 않는다 — 이력을 말하는 문장은 정상이다.
//   - node 가 아닌 줄(python3 · git …)은 잡지 않는다.
//   - CLAUDE.md(COUNT_HOME)는 수의 자리라 대상이 아니다.

/** 시험 수가 다시 끼면 안 되는 문서. 명령 블록에 시험 수를 적던 자리들이다. */
export const COUNT_DOCS = ['README.md', 'docs/ARCHITECTURE.md'];

/** 시험 수를 두는 한 자리. */
export const COUNT_HOME = 'CLAUDE.md';

const FENCE = /^\s*(```|~~~)/;
const NODE_LINE = /^\s*node\s/;
const COUNT = /\d+\s*개/;

/**
 * 마크다운 글에서 코드 블록 안 node 명령 줄의 주석에 적힌 시험 수를 찾는다.
 * @param {string} markdown
 * @returns {{ line: number, text: string }[]} line 은 1 부터
 */
// @complexity time=O(n) space=O(k) cc=6
export function findTestCounts(markdown) {
  const hits = [];
  let inFence = false;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (FENCE.test(text)) { inFence = !inFence; continue; }
    if (!inFence || !NODE_LINE.test(text)) continue;
    const hash = text.indexOf(' #');
    if (hash >= 0 && COUNT.test(text.slice(hash))) hits.push({ line: i + 1, text: text.trim() });
  }
  return hits;
}

/**
 * 여러 문서를 한꺼번에 본다. COUNT_HOME 은 건너뛴다.
 * @param {Record<string, string>} docs 경로 → 글
 * @returns {{ file: string, line: number, text: string }[]}
 */
// @complexity time=O(n) space=O(k) cc=3
export function checkTestCounts(docs) {
  const out = [];
  for (const [file, text] of Object.entries(docs)) {
    if (file === COUNT_HOME) continue;
    for (const h of findTestCounts(text)) out.push({ file, ...h });
  }
  return out;
}

/** check-docs 가 찍는 한 줄. */
// @complexity time=O(1) space=O(1) cc=1
export function formatCount(hit) {
  return `${hit.file}:${hit.line}: 명령 줄 주석에 시험 수가 있다 — 수는 ${COUNT_HOME} 한 자리에만 두고 여기서는 빼거나 그 자리를 가리킨다 → ${hit.text}`;
}
