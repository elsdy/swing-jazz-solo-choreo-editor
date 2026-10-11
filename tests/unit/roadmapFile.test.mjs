// tests/unit/roadmapFile.test.mjs — 로드맵의 두 자리가 같은 말을 하는지
//
// 항목은 두 곳에 산다. docs/ROADMAP.md 는 **무엇을 왜**(사람이 읽는 계획), docs/roadmap/ROADMAP.json 은
// **어디까지 왔는지**(로드맵 보드가 읽는 추적 — 스키마 roadmap-board/1). 번호·칸·규모·선행이 두 곳에서
// 어긋나면 보드가 문서와 다른 차례를 셈한다. 사람이 눈으로 맞추면 반드시 빠뜨리므로 여기서 대조한다.
//
// 상태(끝낸 걸음·PR·차례)는 JSON 에만 있다 — 문서에 적지 않는다.
//
// 판 파일이 원본이다(2026-10-11, B949). 보드의 판은 항목을 더하고 지우며 JSON 만 main 에 올린다 — 두 쪽이
// 같아야 한다고 재면 판이 고칠 때마다 main 이 붉어졌다. 그래서 문서 ⊆ 판 파일로 잰다: 문서의 번호는 판에 있어야
// 하고, 둘 다에 있으면 칸·규모·선행이 같아야 한다. 판에만 있는 항목은 계획서가 있을 때만 문서에 없어도 된다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

const inBody = new Set([...mdText.matchAll(/^- \*\*(RM-\d+) · /gm)].map(m => m[1]));
const hasPlan = it => Boolean(it.plan) || existsSync(new URL(`docs/roadmap/plans/${it.id}.md`, ROOT));

/** 문서(추적 표 rows · 세 칸 inBody)와 판 파일(items)의 어긋남을 말로 돌려준다 — 빈 배열이면 맞다. */
function mismatches({ rows, inBody, items, hasPlan }) {
  const out = [];
  const inTable = new Set(rows.map(r => r.id));
  for (const id of inTable) if (!inBody.has(id)) out.push(`${id} 는 추적 표에만 있고 세 칸에 없다`);
  for (const id of inBody) if (!inTable.has(id)) out.push(`${id} 는 세 칸에만 있고 추적 표에 없다`);
  for (const id of new Set([...inTable, ...inBody])) {
    if (!items.has(id)) out.push(`${id} 는 문서에 있는데 판 파일에 없다 — 판에서 지웠으면 문서에서도 걷는다`);
  }
  for (const r of rows) {
    const it = items.get(r.id);
    if (!it) continue;
    if (it.lane !== r.lane) out.push(`${r.id} 의 칸: 판 ${it.lane} · 문서 ${r.lane}`);
    if (it.size !== r.size) out.push(`${r.id} 의 규모: 판 ${it.size} · 문서 ${r.size}`);
    if ([...it.after].sort().join() !== [...r.after].sort().join()) out.push(`${r.id} 의 선행: 판 ${it.after} · 문서 ${r.after}`);
  }
  for (const it of items.values()) {
    if (!inTable.has(it.id) && !hasPlan(it)) out.push(`${it.id} 는 판 파일에만 있고 계획서도 없다 — 문서에 적거나 계획서를 둔다`);
  }
  return out;
}

test('로드맵 파일은 factoriel/1(옛 이름 roadmap-board/1)이고, 보드가 쓰는 꼴(두 칸 들여쓰기 · 한글 그대로)이다', () => {
  // 보드가 이름을 바꿨다(factoriel, B917) — 판을 다시 쓰면 새 이름이 적힌다. 옛 이름도 보드가 그대로 읽는다
  assert.ok(['factoriel/1', 'roadmap-board/1'].includes(doc.schema), `스키마 이름이 보드의 것이 아니다: ${doc.schema}`);
  assert.equal(doc.stages.at(-1).key, 'merged');
  // 처음부터 쓰기 꼴로 두어야 보드가 걸음 하나를 적을 때 diff 가 한 줄이다
  assert.equal(jsonText, JSON.stringify(doc, null, 2) + '\n');
});

test('추적 표와 로드맵 파일의 항목이 같다 — 번호·칸·규모·선행', () => {
  assert.ok(rows.length >= 30, `추적 표에서 읽은 줄이 ${rows.length}개뿐이다 — 표의 꼴이 바뀌었나`);
  assert.deepEqual(mismatches({ rows, inBody: new Set(rows.map(r => r.id)), items, hasPlan }), []);
});

test('문서의 세 칸에 있는 항목이 로드맵 파일에도 있다', () => {
  assert.ok(inBody.size >= 30, `세 칸에서 읽은 항목이 ${inBody.size}개뿐이다 — 항목 줄의 꼴이 바뀌었나`);
  assert.deepEqual(mismatches({ rows, inBody, items, hasPlan }), []);
});

test('판에서만 더한 항목은 계획서가 있으면 문서에 없어도 된다', () => {
  const row = (id, lane = 'next', size = 'S', after = []) => ({ id, lane, size, after });
  const item = (id, extra = {}) => [id, { id, lane: 'next', size: 'S', after: [], ...extra }];
  const plan = it => Boolean(it.plan);
  const docRows = [row('RM-01'), row('RM-02', 'then', 'M', ['RM-01'])];
  const body = new Set(['RM-01', 'RM-02']);
  const base = [item('RM-01'), item('RM-02', { lane: 'then', size: 'M', after: ['RM-01'] })];

  // 판이 계획서와 함께 RM-03 을 더했다 — 문서는 그대로여도 통과
  const added = new Map([...base, item('RM-03', { plan: 'docs/roadmap/plans/RM-03.md' })]);
  assert.deepEqual(mismatches({ rows: docRows, inBody: body, items: added, hasPlan: plan }), []);

  // 계획서도 없이 판에만 있으면 붉다
  const bare = new Map([...base, item('RM-03')]);
  assert.match(mismatches({ rows: docRows, inBody: body, items: bare, hasPlan: plan }).join('\n'), /RM-03 는 판 파일에만 있고 계획서도 없다/);

  // 판에서 지운 번호가 문서에 남아 있으면 붉다
  const removed = new Map([base[0]]);
  assert.match(mismatches({ rows: docRows, inBody: body, items: removed, hasPlan: plan }).join('\n'), /RM-02 는 문서에 있는데 판 파일에 없다/);

  // 둘 다에 있는데 칸 · 규모 · 선행이 다르면 붉다
  const drift = new Map([base[0], item('RM-02', { lane: 'later', size: 'L', after: [] })]);
  const msg = mismatches({ rows: docRows, inBody: body, items: drift, hasPlan: plan }).join('\n');
  assert.match(msg, /RM-02 의 칸/);
  assert.match(msg, /RM-02 의 규모/);
  assert.match(msg, /RM-02 의 선행/);

  // 추적 표와 세 칸이 서로 다른 번호를 들면 붉다
  assert.match(mismatches({ rows: docRows, inBody: new Set(['RM-01']), items: added, hasPlan: plan }).join('\n'), /RM-02 는 추적 표에만 있고 세 칸에 없다/);
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
