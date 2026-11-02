// tests/unit/historyView.test.mjs — 파일 서랍의 「지난 판」(src/ui/historyView.js, RM-25)
//
// DOM 은 작은 가짜로 쥔다 — 이 뷰가 쓰는 것은 createElement · appendChild · innerHTML · textContent · hidden ·
// dataset · onclick 뿐이다. 시각 표기와 크기 표기는 순수 함수라 지금 시각을 넣어 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryView, whenLabel, sizeLabel, KIND_LABEL } from '../../src/ui/historyView.js';

function fakeEl(tag) {
  const el = {
    tag, children: [], hidden: false, className: '', textContent: '', _html: '', dataset: {}, disabled: false, onclick: null,
    appendChild(c) { el.children.push(c); return c; },
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = v; if (v === '') el.children = []; }
  };
  return el;
}
const fakeDoc = () => ({ createElement: fakeEl, getElementById: () => null });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 2026-11-02 14:30 (로컬) — 시험의 「지금」. */
const NOW = new Date(2026, 10, 2, 14, 30).getTime();

test('whenLabel: 파일 이름의 시각을 오늘 · 어제 · n일 전 · 월-일 · 연-월-일로 읽는다, 꼴이 아니면 빈 문자열', () => {
  assert.equal(whenLabel('20261102-142000', NOW), '오늘 14:20');
  assert.equal(whenLabel('20261102-000100-2', NOW), '오늘 00:01', '같은 초의 -2 꼬리도 읽는다');
  assert.equal(whenLabel('20261101-235900', NOW), '어제 23:59');
  assert.equal(whenLabel('20261030-091500', NOW), '3일 전 09:15');
  assert.equal(whenLabel('20261013-142000', NOW), '10-13 14:20');
  assert.equal(whenLabel('20251013-142000', NOW), '2025-10-13 14:20');
  assert.equal(whenLabel('', NOW), '');
  assert.equal(whenLabel('abc', NOW), '');
});

test('sizeLabel: B · KB · MB', () => {
  assert.equal(sizeLabel(0), '0 B');
  assert.equal(sizeLabel(900), '900 B');
  assert.equal(sizeLabel(12 * 1024 + 100), '12 KB');
  assert.equal(sizeLabel(2.5 * 1024 * 1024), '2.5 MB');
  assert.equal(sizeLabel(undefined), '0 B');
});

function setup({ items = [], bound = '공연', restore = async () => true } = {}) {
  const root = fakeEl('div'); root.hidden = true;
  const asked = [];
  let listImpl = async (name) => { asked.push(name); return items; };
  const state = { bound };
  const view = createHistoryView({
    listHistory: (name) => listImpl(name),
    boundName: () => state.bound,
    restore,
    now: () => NOW,
    elements: { savedHistory: root },
    doc: fakeDoc()
  });
  return { root, view, asked, state, setList: (fn) => { listImpl = fn; } };
}

const ITEMS = [
  { file: '공연.20261102-142000.auto.json', name: '공연', stamp: '20261102-142000', kind: 'auto', size: 3 * 1024, mtime: 1 },
  { file: '공연.20261101-090000.json', name: '공연', stamp: '20261101-090000', kind: 'manual', size: 2 * 1024, mtime: 0 },
  { file: '공연.20261013-120000.json', name: '공연', stamp: '20261013-120000', size: 1 * 1024, mtime: 0 }   // kind 없는 옛 항목
];

test('historyView: 묶인 이름으로 목록을 부르고, 줄마다 시각 · 종류 · 크기와 `되살리기` 를 둔다 — 최근 것부터, 머리말이 되살림의 길을 알린다', async () => {
  const { root, view, asked } = setup({ items: ITEMS });
  await view.render();
  assert.deepEqual(asked, ['공연']);
  assert.equal(root.hidden, false);
  const [head, ...rows] = root.children;
  assert.equal(head.textContent, '지난 판 · 3개 — 되살리면 지금 판도 이력에 한 장 남습니다');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.dataset.kind), ['auto', 'manual', 'manual'], 'kind 없는 옛 항목은 손 저장이다');
  assert.match(rows[0].children[0].innerHTML, /오늘 14:20/);
  assert.match(rows[0].children[0].innerHTML, new RegExp(`${KIND_LABEL.auto} · 3 KB`));
  assert.match(rows[1].children[0].innerHTML, /어제 09:00/);
  assert.match(rows[1].children[0].innerHTML, new RegExp(`${KIND_LABEL.manual} · 2 KB`));
  assert.match(rows[2].children[0].innerHTML, /10-13 12:00/);
  assert.ok(rows.every((r) => r.children[1].textContent === '되살리기'));
});

test('historyView: 묶인 파일이 없거나 이력이 비면 통째로 감춘다 — 서버 없이 열면 목록이 빈 배열이라 같은 길이다', async () => {
  const empty = setup({ items: [] });
  await empty.view.render();
  assert.equal(empty.root.hidden, true);
  assert.deepEqual(empty.asked, ['공연'], '이름이 있으면 한 번은 묻는다');

  const unbound = setup({ items: ITEMS, bound: '' });
  await unbound.view.render();
  assert.equal(unbound.root.hidden, true);
  assert.deepEqual(unbound.asked, [], '묶인 파일이 없으면 서버를 두드리지 않는다');

  // 있다가 풀리면(새 문서) 다시 감춘다.
  const s = setup({ items: ITEMS });
  await s.view.render();
  assert.equal(s.root.hidden, false);
  s.state.bound = '';
  await s.view.render();
  assert.equal(s.root.hidden, true);
  assert.equal(s.root.children.length, 0);
});

test('historyView: 늦게 온 옛 목록 응답은 버린다 — 순번이 밀렸거나 그 사이 다른 파일로 옮겨 갔으면', async () => {
  const s = setup({ items: ITEMS });
  let releaseSlow;
  const slow = new Promise((r) => { releaseSlow = r; });
  s.setList(async (name) => { s.asked.push(name); await slow; return ITEMS; });
  const first = s.view.render();                     // 느린 응답
  s.setList(async (name) => { s.asked.push(name); return [ITEMS[1]]; });
  await s.view.render();                             // 더 새 render — 한 줄짜리
  assert.equal(s.root.children.length, 2, '머리말 + 한 줄');
  releaseSlow();
  await first;
  assert.equal(s.root.children.length, 2, '옛 응답(세 줄)이 새 화면을 덮었다');

  // 이름이 바뀐 사이에 온 응답도 남의 것이다.
  const t = setup({ items: ITEMS });
  let release2;
  const slow2 = new Promise((r) => { release2 = r; });
  t.setList(async (name) => { t.asked.push(name); await slow2; return ITEMS; });
  const pending = t.view.render();
  t.state.bound = '다른것';
  release2();
  await pending;
  assert.equal(t.root.hidden, true, '묶인 이름이 바뀌었는데 옛 이름의 목록을 그렸다');
});

test('historyView: `되살리기` 를 누르면 묻지 않고 그 파일로 restore 를 부르고, 끝나면 목록을 다시 그린다 — 실패하면 버튼을 되돌린다', async () => {
  const restored = [];
  let ok = true;
  const s = setup({ items: ITEMS, restore: async (file) => { restored.push(file); return ok; } });
  await s.view.render();
  const btn = s.root.children[2].children[1];        // 어제 09:00 · 손 저장
  const click = btn.onclick();
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, '되살리는 중…');
  await click;
  await tick();
  assert.deepEqual(restored, ['공연.20261101-090000.json']);
  assert.equal(s.asked.length, 2, '되살린 뒤 목록을 다시 불러야 한다(이력이 한 장 늘었다)');

  ok = false;
  const btn2 = s.root.children[1].children[1];
  await btn2.onclick();
  await tick();
  assert.equal(btn2.disabled, false, '실패하면 다시 누를 수 있어야 한다');
  assert.equal(btn2.textContent, '되살리기');
});
