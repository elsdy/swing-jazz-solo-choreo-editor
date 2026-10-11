// tests/unit/roadmapFile.test.mjs — 로드맵의 두 자리가 같은 말을 하는지
//
// 항목은 두 곳에 산다. docs/ROADMAP.md 는 **무엇을 왜**(사람이 읽는 계획), docs/roadmap/ROADMAP.json 은
// **어디까지 왔는지**(로드맵 보드가 읽는 추적 — 스키마 roadmap-board/1). 번호·칸·규모·선행이 두 곳에서
// 어긋나면 보드가 문서와 다른 차례를 셈한다. 사람이 눈으로 맞추면 반드시 빠뜨리므로 여기서 대조한다.
//
// 상태(끝낸 걸음·PR·차례)는 JSON 에만 있다 — 문서에 적지 않는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown } from '../../src/ui/docsHub.js';

const ROOT = new URL('../../', import.meta.url);
const mdText = readFileSync(new URL('docs/ROADMAP.md', ROOT), 'utf8');
const jsonText = readFileSync(new URL('docs/roadmap/ROADMAP.json', ROOT), 'utf8');
const doc = JSON.parse(jsonText);

const LANE = { 다음: 'next', 그다음: 'then', 나중: 'later' };

// 추적 표 한 줄: | ID | 항목 | 칸 | 기둥 | 규모 | 선행 |
const rows = [...mdText.matchAll(/^\| (RM-\d+) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/gm)]
  .map(m => ({ id: m[1], lane: LANE[m[3]], size: m[5], after: (m[6].match(/RM-\d+/g) || []) }));

const items = new Map();
for (const t of doc.tracks) for (const it of t.items) items.set(it.id, { ...it, lane: t.id });

test('로드맵 파일은 factoriel/1(옛 이름 roadmap-board/1)이고, 보드가 쓰는 꼴(두 칸 들여쓰기 · 한글 그대로)이다', () => {
  // 보드가 이름을 바꿨다(factoriel, B917) — 판을 다시 쓰면 새 이름이 적힌다. 옛 이름도 보드가 그대로 읽는다
  assert.ok(['factoriel/1', 'roadmap-board/1'].includes(doc.schema), `스키마 이름이 보드의 것이 아니다: ${doc.schema}`);
  assert.equal(doc.stages.at(-1).key, 'merged');
  // 처음부터 쓰기 꼴로 두어야 보드가 걸음 하나를 적을 때 diff 가 한 줄이다
  assert.equal(jsonText, JSON.stringify(doc, null, 2) + '\n');
});

test('추적 표와 로드맵 파일의 항목이 같다 — 번호·칸·규모·선행', () => {
  assert.ok(rows.length >= 30, `추적 표에서 읽은 줄이 ${rows.length}개뿐이다 — 표의 꼴이 바뀌었나`);
  assert.deepEqual(rows.map(r => r.id).sort(), [...items.keys()].sort());
  for (const r of rows) {
    const it = items.get(r.id);
    assert.equal(it.lane, r.lane, `${r.id} 의 칸`);
    assert.equal(it.size, r.size, `${r.id} 의 규모`);
    assert.deepEqual([...it.after].sort(), [...r.after].sort(), `${r.id} 의 선행`);
  }
});

test('문서의 세 칸에 있는 항목이 로드맵 파일에도 있다', () => {
  const inBody = new Set([...mdText.matchAll(/^- \*\*(RM-\d+) · /gm)].map(m => m[1]));
  assert.deepEqual([...inBody].sort(), [...items.keys()].sort());
});

test('정하기를 미룬 것의 번호가 로드맵 파일의 질문과 맞고, 아직 답이 없다', () => {
  const qs = new Map(doc.questions.items.map(q => [q.id, q]));
  const deferred = mdText.slice(mdText.indexOf('## 정하기를 미룬 것'), mdText.indexOf('### 적응형 작업 차례'));
  const ids = [...deferred.matchAll(/^\| \*\*.+?\*\*\(.*?(Q\d+)\) \|/gm)].map(m => m[1]);
  assert.ok(ids.length >= 5, '정하기를 미룬 것 표에서 질문 번호를 읽지 못했다');
  for (const id of ids) {
    assert.ok(qs.has(id), `${id} 가 로드맵 파일의 questions 에 없다`);
    assert.equal(qs.get(id).answer, null, `${id} 는 문서에서 미룬 것인데 파일에는 답이 있다`);
  }
});

test('트랙이 가리키는 문서 앵커가 문서 뷰어에서 실제로 걸린다', () => {
  const { html } = renderMarkdown(mdText);
  const anchors = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  for (const t of doc.tracks) {
    const hash = decodeURIComponent(t.plan.split('#')[1] || '');
    assert.ok(anchors.has(hash), `${t.id} 의 plan 앵커 #${hash} 가 없다`);
  }
});
