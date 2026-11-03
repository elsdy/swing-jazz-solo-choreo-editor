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
// 하고, 둘 다에 있으면 칸·규모·선행이 같아야 한다. 판에만 있는 항목은 계획서나 설명(what)이 있으면 문서에 없어도 된다 —
// 보드가 found 로 더한 버그 항목은 계획서 없이 설명만 갖는다(2026-11-02, RM-40). 문서가 「정하기를 미룬 것」에 둔 질문에
// 판이 답을 적은 것도 붉히지 않고 「문서에서 거둘 것」으로 알리기만 한다 — 판이 원본이라 답이 틀린 것이 아니라 문서 줄이 묵은 것이다.
// 트랙도 같다 — 보드가 더하는 출처 트랙(from-factoriel)은 plan 없이 설명만 가지니, plan 이 있는 트랙만 앵커를 재고 plan 도
// 설명도 없는 빈 트랙만 붉힌다(2026-11-03, RM-49).
//
// 규모는 문서의 두 자리 — 추적 표의 칸과 세 칸 항목 줄의 「(규모)」 — 에 적힌다. 판이 다시 다듬으며 규모만 바꿨을 때
// 표만 고치고 본문 괄호를 빠뜨리지 않게 두 자리 모두 판과 잰다(2026-10-20, RM-38).

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

// 세 칸 항목 줄: - **RM-nn · 이름** (규모) — … · 괄호 규모가 없는 줄은 번호만 읽는다(규모는 null)
const inBody = new Map([...mdText.matchAll(/^- \*\*(RM-\d+) · .*?\*\*(?: \((S|M|L|XL)\))?/gm)].map(m => [m[1], m[2] ?? null]));
/** 판에만 있는 항목이 어딘가 적힌 것인가 — 계획서(`plan` 필드 · 계획서 파일)나 비지 않은 설명(`what`). 이름만 있는 빈 항목은 거짓이다. */
// @complexity time=O(1) space=O(1) cc=4
const described = (it, planExists) => Boolean(it.plan) || planExists(it.id) || Boolean(it.what && it.what.trim());
const hasPlan = it => described(it, id => existsSync(new URL(`docs/roadmap/plans/${id}.md`, ROOT)));

/** 문서(추적 표 rows · 세 칸 inBody — 번호 → 본문 규모)와 판 파일(items)의 어긋남을 말로 돌려준다 — 빈 배열이면 맞다. */
// @complexity time=O(n) space=O(n) cc=19
function mismatches({ rows, inBody, items, hasPlan }) {
  const out = [];
  const inTable = new Set(rows.map(r => r.id));
  for (const id of inTable) if (!inBody.has(id)) out.push(`${id} 는 추적 표에만 있고 세 칸에 없다`);
  for (const id of inBody.keys()) if (!inTable.has(id)) out.push(`${id} 는 세 칸에만 있고 추적 표에 없다`);
  for (const id of new Set([...inTable, ...inBody.keys()])) {
    if (!items.has(id)) out.push(`${id} 는 문서에 있는데 판 파일에 없다 — 판에서 지웠으면 문서에서도 걷는다`);
  }
  for (const r of rows) {
    const it = items.get(r.id);
    if (!it) continue;
    if (it.lane !== r.lane) out.push(`${r.id} 의 칸: 판 ${it.lane} · 문서 ${r.lane}`);
    if (it.size !== r.size) out.push(`${r.id} 의 규모: 판 ${it.size} · 문서 ${r.size}`);
    if ([...it.after].sort().join() !== [...r.after].sort().join()) out.push(`${r.id} 의 선행: 판 ${it.after} · 문서 ${r.after}`);
  }
  for (const [id, size] of inBody) {
    const it = items.get(id);
    if (it && size && it.size !== size) out.push(`${id} 의 본문 규모: 판 ${it.size} · 문서 ${size}`);
  }
  for (const it of items.values()) {
    if (!inTable.has(it.id) && !hasPlan(it)) out.push(`${it.id} 는 판 파일에만 있고 계획서도 설명도 없다 — 문서에 적거나 계획서 · 설명을 둔다`);
  }
  return out;
}

/**
 * 판의 트랙(tracks)이 가리키는 문서 앵커가 문서 뷰어의 앵커 집합(anchors)에 있는지 잰다 — 어긋남 글 목록, 비면 맞다.
 * plan 이 있는 트랙만 앵커를 잰다. 보드가 더하는 출처 트랙(from-factoriel, B899)은 plan 없이 설명(what)만 갖는다 —
 * 원본(판)이 실제로 남기는 꼴이라 설명이 있으면 통과시키고, plan 도 설명도 없는 빈 트랙만 붉힌다(2026-11-03, RM-49).
 */
// @complexity time=O(t) space=O(t) cc=5
function trackAnchorMismatches({ tracks, anchors }) {
  const out = [];
  for (const t of tracks) {
    if (!t.plan) {
      if (!(t.what && t.what.trim())) out.push(`${t.id} 는 plan 도 설명도 없다 — 문서 앵커나 설명(what)을 둔다`);
      continue;
    }
    const hash = decodeURIComponent(t.plan.split('#')[1] || '');
    if (!anchors.has(hash)) out.push(`${t.id} 의 plan 앵커 #${hash} 가 없다`);
  }
  return out;
}

/**
 * 문서가 「정하기를 미룬 것」에 둔 질문 번호(ids)를 판의 questions(번호 → 질문)와 대조한다.
 * red 는 판에 없는 번호(붉힌다), stale 은 판이 답을 적은 번호(문서에서 거둘 것으로 알리기만 한다) — 판이 원본이다.
 */
// @complexity time=O(k) space=O(k) cc=4
function deferredMismatches({ ids, questions }) {
  const red = [];
  const stale = [];
  for (const id of ids) {
    const q = questions.get(id);
    if (!q) red.push(`${id} 가 로드맵 파일의 questions 에 없다`);
    else if (q.answer) stale.push(`${id} 는 문서에서 미룬 것인데 판이 답했다(「${q.answer}」) — 문서의 미룬 것 표에서 거두고 결정 기록에 적는다`);
  }
  return { red, stale };
}

test('로드맵 파일은 factoriel/1(옛 이름 roadmap-board/1)이고, 보드가 쓰는 꼴(두 칸 들여쓰기 · 한글 그대로)이다', () => {
  // 보드가 이름을 바꿨다(factoriel, B917) — 판을 다시 쓰면 새 이름이 적힌다. 옛 이름도 보드가 그대로 읽는다
  assert.ok(['factoriel/1', 'roadmap-board/1'].includes(doc.schema), `스키마 이름이 보드의 것이 아니다: ${doc.schema}`);
  assert.equal(doc.stages.at(-1).key, 'merged');
  // 처음부터 쓰기 꼴로 두어야 보드가 걸음 하나를 적을 때 diff 가 한 줄이다
  assert.equal(jsonText, JSON.stringify(doc, null, 2) + '\n');
});

test('[RM-40 요구 4] 추적 표와 로드맵 파일의 항목이 같다 — 번호·칸·규모·선행', () => {
  assert.ok(rows.length >= 30, `추적 표에서 읽은 줄이 ${rows.length}개뿐이다 — 표의 꼴이 바뀌었나`);
  assert.deepEqual(mismatches({ rows, inBody: new Map(rows.map(r => [r.id, null])), items, hasPlan }), []);
});

test('세 칸 항목 줄의 규모가 판과 같다', () => {
  const sized = [...inBody].filter(([, size]) => size);
  assert.ok(sized.length >= 30, `세 칸 항목 줄에서 읽은 괄호 규모가 ${sized.length}개뿐이다 — 항목 줄의 꼴이 바뀌었나`);
  const drift = mismatches({ rows: [], inBody: new Map(sized), items, hasPlan: () => true })
    .filter(m => m.includes('본문 규모'));
  assert.deepEqual(drift, []);
});

test('문서의 세 칸에 있는 항목이 로드맵 파일에도 있다', () => {
  assert.ok(inBody.size >= 30, `세 칸에서 읽은 항목이 ${inBody.size}개뿐이다 — 항목 줄의 꼴이 바뀌었나`);
  assert.deepEqual(mismatches({ rows, inBody, items, hasPlan }), []);
});

test('[RM-40 요구 1] 판에서만 더한 항목은 계획서가 있으면 문서에 없어도 된다', () => {
  const row = (id, lane = 'next', size = 'S', after = []) => ({ id, lane, size, after });
  const item = (id, extra = {}) => [id, { id, lane: 'next', size: 'S', after: [], ...extra }];
  const plan = it => described(it, () => false); // 계획서 파일은 없다고 친다 — plan 필드와 what 만 본다
  const docRows = [row('RM-01'), row('RM-02', 'then', 'M', ['RM-01'])];
  const body = new Map([['RM-01', 'S'], ['RM-02', 'M']]);
  const base = [item('RM-01'), item('RM-02', { lane: 'then', size: 'M', after: ['RM-01'] })];

  // 판이 계획서와 함께 RM-03 을 더했다 — 문서는 그대로여도 통과
  const added = new Map([...base, item('RM-03', { plan: 'docs/roadmap/plans/RM-03.md' })]);
  assert.deepEqual(mismatches({ rows: docRows, inBody: body, items: added, hasPlan: plan }), []);

  // 계획서 없이 설명(what)만 있어도 통과 — 보드가 found 로 더한 버그 항목의 꼴(RM-40)
  const found = new Map([...base, item('RM-03', { what: '푸시 훅이 막는다', kind: 'bug' })]);
  assert.deepEqual(mismatches({ rows: docRows, inBody: body, items: found, hasPlan: plan }), []);

  // 계획서도 설명도 없이 판에만 있으면 붉다 — 빈 설명도 없는 것이다
  for (const extra of [{}, { what: '' }, { what: '  ' }]) {
    const bare = new Map([...base, item('RM-03', extra)]);
    assert.match(mismatches({ rows: docRows, inBody: body, items: bare, hasPlan: plan }).join('\n'), /RM-03 는 판 파일에만 있고 계획서도 설명도 없다/);
  }

  // 판에서 지운 번호가 문서에 남아 있으면 붉다
  const removed = new Map([base[0]]);
  assert.match(mismatches({ rows: docRows, inBody: body, items: removed, hasPlan: plan }).join('\n'), /RM-02 는 문서에 있는데 판 파일에 없다/);

  // 둘 다에 있는데 칸 · 규모 · 선행이 다르면 붉다
  const drift = new Map([base[0], item('RM-02', { lane: 'later', size: 'L', after: [] })]);
  const msg = mismatches({ rows: docRows, inBody: body, items: drift, hasPlan: plan }).join('\n');
  assert.match(msg, /RM-02 의 칸/);
  assert.match(msg, /RM-02 의 규모/);
  assert.match(msg, /RM-02 의 선행/);
  assert.match(msg, /RM-02 의 본문 규모: 판 L · 문서 M/);

  // 추적 표는 판에 맞췄는데 본문 괄호를 빠뜨렸으면 붉다(RM-38)
  const tableOnly = new Map([base[0], item('RM-02', { lane: 'then', size: 'L', after: ['RM-01'] })]);
  const tableFixed = [row('RM-01'), row('RM-02', 'then', 'L', ['RM-01'])];
  assert.deepEqual(mismatches({ rows: tableFixed, inBody: body, items: tableOnly, hasPlan: plan }), ['RM-02 의 본문 규모: 판 L · 문서 M']);
  // 괄호 규모가 없는 줄은 본문 규모를 재지 않는다
  assert.deepEqual(mismatches({ rows: tableFixed, inBody: new Map([['RM-01', 'S'], ['RM-02', null]]), items: tableOnly, hasPlan: plan }), []);

  // 추적 표와 세 칸이 서로 다른 번호를 들면 붉다
  assert.match(mismatches({ rows: docRows, inBody: new Map([['RM-01', 'S']]), items: added, hasPlan: plan }).join('\n'), /RM-02 는 추적 표에만 있고 세 칸에 없다/);
});

test('[RM-40 요구 2] 미룬 질문에 판이 답했으면 거둘 것으로 알리되 붉히지 않는다', () => {
  const questions = new Map([
    ['Q1', { id: 'Q1', answer: null }],
    ['Q2', { id: 'Q2', answer: 'RM-11 첫 커밋을 졸업일로 한다' }],
    ['Q3', { id: 'Q3', answer: '' }],
  ]);
  const { red, stale } = deferredMismatches({ ids: ['Q1', 'Q2', 'Q3', 'Q9'], questions });
  // 판에 없는 번호만 붉다 — 문서가 판에 없는 질문을 들고 있다
  assert.deepEqual(red, ['Q9 가 로드맵 파일의 questions 에 없다']);
  // 답이 있는 번호는 알리기만 한다 — 답을 그대로 보여 결정 기록에 옮길 수 있게. 답이 비면 아직 미룬 것이다
  assert.equal(stale.length, 1);
  assert.match(stale[0], /^Q2 는 문서에서 미룬 것인데 판이 답했다\(「RM-11 첫 커밋을 졸업일로 한다」\) — 문서의 미룬 것 표에서 거두고 결정 기록에 적는다$/);
  // 모두 답이 없으면 둘 다 비어 있다
  assert.deepEqual(deferredMismatches({ ids: ['Q1'], questions }), { red: [], stale: [] });
});

test('[RM-40 요구 3] 정하기를 미룬 것의 번호가 로드맵 파일의 질문과 맞고, 판이 답한 것은 거둘 것으로 알린다', t => {
  const questions = new Map(doc.questions.items.map(q => [q.id, q]));
  const deferred = mdText.slice(mdText.indexOf('## 정하기를 미룬 것'), mdText.indexOf('### 적응형 작업 차례'));
  const ids = [...deferred.matchAll(/^\| \*\*.+?\*\*\(.*?(Q\d+)\) \|/gm)].map(m => m[1]);
  // 표의 줄 수와 읽은 번호 수가 같아야 한다 — 줄은 있는데 번호를 못 읽으면 표의 꼴이 바뀐 것이다(2026-11-02 세 줄을 결정 기록으로 옮겨 넷이 남았다)
  const tableRows = (deferred.match(/^\| \*\*/gm) || []).length;
  assert.ok(ids.length >= 1 && ids.length === tableRows, `정하기를 미룬 것 표 ${tableRows}줄에서 질문 번호를 ${ids.length}개 읽었다 — 표의 꼴이 바뀌었나`);
  const { red, stale } = deferredMismatches({ ids, questions });
  assert.deepEqual(red, []);
  // 판이 답한 미룬 질문은 문서 줄이 묵은 것이다 — 붉히지 않고 알린다. 문서를 다음에 손대는 PR 이 거둔다(docs/ROADMAP.md 「판 파일이 원본이다」)
  for (const line of stale) t.diagnostic(`문서에서 거둘 것: ${line}`);
});

test('[RM-49 요구 0] plan 없는 트랙은 설명이 있으면 앵커를 재지 않는다', () => {
  const anchors = new Set(['다음-곧-만들-것']);
  const run = tracks => trackAnchorMismatches({ tracks, anchors });
  // plan 없이 설명만 있는 출처 트랙 — 보드가 남기는 꼴(B899)이라 통과하고 던지지 않는다
  assert.deepEqual(run([{ id: 'from-factoriel', name: '🏭', what: 'factoriel 에서 올라온 버그' }]), []);
  // plan 도 설명도 없으면(없음 · 빈 글 · 공백) 읽히는 글로 붉다 — 던지지 않는다
  for (const what of [undefined, '', '   ']) {
    assert.deepEqual(run([{ id: 'empty', name: '빈', what }]), ['empty 는 plan 도 설명도 없다 — 문서 앵커나 설명(what)을 둔다']);
  }
  // plan 이 있으면 앵커를 잰다 — 있으면 통과, 없으면 지금처럼 붉다
  assert.deepEqual(run([{ id: 'next', plan: 'docs/ROADMAP.md#다음-곧-만들-것' }]), []);
  assert.deepEqual(run([{ id: 'gone', plan: 'docs/ROADMAP.md#없는-절', what: '설명이 있어도 plan 이 있으면 앵커를 잰다' }]), ['gone 의 plan 앵커 #없는-절 가 없다']);
  // 퍼센트 인코딩한 앵커도 풀어서 잰다
  assert.deepEqual(run([{ id: 'enc', plan: `docs/ROADMAP.md#${encodeURIComponent('다음-곧-만들-것')}` }]), []);
});

test('[RM-49 요구 3] 트랙이 가리키는 문서 앵커가 문서 뷰어에서 실제로 걸린다', () => {
  const { html } = renderMarkdown(mdText);
  const anchors = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual(trackAnchorMismatches({ tracks: doc.tracks, anchors }), []);
});

test('[RM-53 요구 1] 판의 출처 트랙(from-*)은 plan 없이 설명만으로 앵커 대조를 지난다', () => {
  const { html } = renderMarkdown(mdText);
  const anchors = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  // 보드가 실제로 남긴 출처 트랙을 잰다 — 하나도 없으면 아무것도 재지 않고 통과하므로 있는지부터 본다(보드가 이름을 바꾸면 붉다)
  const sources = doc.tracks.filter(t => t.id.startsWith('from-'));
  assert.ok(sources.length >= 1, '판에 from- 으로 시작하는 출처 트랙이 없다 — 보드가 트랙 이름을 바꿨나');
  for (const t of sources) {
    // 같은 TypeError(RM-49 · RM-53 — plan 없는 트랙에서 t.plan.split)가 또 나면 이 트랙 이름으로 붉다
    assert.deepEqual(trackAnchorMismatches({ tracks: [t], anchors }), [], `${t.id} 가 앵커 대조를 지나지 못한다`);
    // 설명까지 비면 붉다 — 빈 트랙을 통과시키지 않는다
    const bare = { ...t, what: '' };
    delete bare.plan;
    assert.deepEqual(trackAnchorMismatches({ tracks: [bare], anchors }), [`${t.id} 는 plan 도 설명도 없다 — 문서 앵커나 설명(what)을 둔다`]);
  }
});
