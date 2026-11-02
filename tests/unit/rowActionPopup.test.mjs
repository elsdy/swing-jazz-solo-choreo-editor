// tests/unit/rowActionPopup.test.mjs — 행 라벨 메뉴(ui/rowActionPopup)와 블록 팝업의 새 줄 (RM-16, 2026-11-02)
//
// 가짜 DOM 위에서 팝업을 열어 **버튼 글자와 눌렀을 때 넘어간 값**만 본다. 자리 잡기(domain/popupPlacement)는
// 형제 팝업과 같은 함수라 여기서 다시 재지 않는다. 첫 시험 이름은 계획서 「요구 ↔ 시험」 표 4 와 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRowActionPopup, ROW_MENU } from '../../src/ui/rowActionPopup.js';
import { createPlacementActionPopup } from '../../src/ui/placementActionPopup.js';

/** 아주 작은 가짜 DOM — appendChild · 클릭 · 지우기 · querySelectorAll('button') 만 있다. */
function fakeDom() {
  const make = (tag) => {
    const el = {
      tag, children: [], listeners: {}, dataset: {}, style: {}, className: '', textContent: '', disabled: false, parent: null,
      appendChild(c) { c.parent = el; el.children.push(c); return c; },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); el.parent = null; },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      click() { for (const fn of el.listeners.click || []) fn({ target: el }); },
      contains(other) { return other === el || el.children.some(c => c.contains(other)); },
      querySelectorAll(sel) { return all(el).filter(n => n !== el && (sel === 'button' ? n.tag === 'button' : false)); },
    };
    return el;
  };
  const all = (el) => [el, ...el.children.flatMap(all)];
  const body = make('body');
  globalThis.document = { createElement: make, body, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  return { body, buttons: (root) => all(root).filter(n => n.tag === 'button') };
}

test('행 라벨 메뉴: 다섯 줄이 차례대로 보이고 누르면 그 행 번호로 명령을 부른다', () => {
  const dom = fakeDom();
  const called = [];
  const rendered = [];
  const cmd = (key) => (row) => { called.push([key, row]); return { boards: { main: { rows: 'all' } }, key }; };
  const popup = createRowActionPopup({
    render: (d) => rendered.push(d),
    labelOf: (row) => `8x${row}`,
    commands: { insertAbove: cmd('insertAbove'), deleteRow: cmd('deleteRow'), duplicateRow: cmd('duplicateRow'), moveUp: cmd('moveUp'), moveDown: cmd('moveDown') },
  });

  popup.open({ row: 3 }, 100, 200);
  const el = popup.current();
  assert.ok(el && dom.body.children.includes(el), 'body 에 붙는다');
  assert.equal(el.children[0].textContent, '8x3', '제목은 행 이름');
  const labels = dom.buttons(el).map(b => b.textContent);
  assert.deepEqual(labels, ['위에 한 마디 끼우기', '이 마디 지우기', '이 마디 복제', '위로 옮기기', '아래로 옮기기']);
  assert.deepEqual(ROW_MENU.map(m => m.label), labels, '문서가 인용하는 표와 화면이 같다');
  assert.equal(el.style.left, '100px');
  assert.equal(el.style.top, '210px', '누른 자리보다 10 아래 — 손가락이 첫 줄을 덮지 않게(형제 팝업과 같다)');

  // 끼우기 — 바로 실행하고 닫는다
  dom.buttons(el)[0].click();
  assert.deepEqual(called, [['insertAbove', 3]]);
  assert.equal(popup.current(), null, '누르면 닫힌다');
  assert.equal(rendered.at(-1).key, 'insertAbove', '커맨드가 돌려준 Dirty 를 그린다');

  // 지우기 — 첫 누름은 `정말요?`, 둘째 누름이 지운다
  popup.open({ row: 2 }, 0, 0);
  const del = dom.buttons(popup.current())[1];
  assert.equal(del.className, 'danger');
  del.click();
  assert.equal(del.textContent, '정말요?');
  assert.equal(popup.current() !== null, true, '묻는 동안 팝업은 열려 있다');
  assert.equal(called.length, 1, '아직 지우지 않았다');
  del.click();
  assert.deepEqual(called.at(-1), ['deleteRow', 2]);
  assert.equal(popup.current(), null);

  // 복제 · 옮기기 — 행 번호가 그대로 간다
  for (const [index, key] of [[2, 'duplicateRow'], [3, 'moveUp'], [4, 'moveDown']]) {
    popup.open({ row: 5 }, 0, 0);
    dom.buttons(popup.current())[index].click();
    assert.deepEqual(called.at(-1), [key, 5]);
  }

  // 맨 위 · 맨 아래에서는 그쪽 옮기기가 꺼진다
  popup.open({ row: 1, first: true }, 0, 0);
  assert.deepEqual(dom.buttons(popup.current()).map(b => b.disabled), [false, false, false, true, false]);
  popup.open({ row: 8, last: true }, 0, 0);
  assert.deepEqual(dom.buttons(popup.current()).map(b => b.disabled), [false, false, false, false, true]);
  popup.close();
  assert.equal(popup.current(), null);
});

test('블록 팝업: 「여기서 자르기」는 재생 헤드가 있으면 바로 자르고, 없으면 몇 번째 카운트인지 고르게 하며, 짝이 없으면 「옆과 합치기」 를 감춘다', () => {
  const dom = fakeDom();
  const called = [];
  const rendered = [];
  let headDirty = null;
  let partner = 'b';
  const popup = createPlacementActionPopup({
    render: (d) => rendered.push(d),
    isSelected: () => false,
    commands: {
      toggleSelection: () => ({}), removeGroup: () => ({}), openPicker: () => {}, copyAfter: () => ({}),
      splitAtPlayhead: (g) => { called.push(['head', g]); return headDirty; },
      splitAtCount: (g, n) => { called.push(['count', g, n]); return { boards: { main: { rows: [1] } } }; },
      mergePartner: () => partner,
      mergeWithNeighbor: (g) => { called.push(['merge', g]); return { boards: { main: { rows: [1] } } }; },
    },
  });
  const labelsOf = () => dom.buttons(popup.current()).map(b => b.textContent);

  popup.open({ groupId: 'a', name: '스윙아웃' }, 10, 10, 4);
  assert.deepEqual(labelsOf(), ['✎ 동작 정하기', '☐ 선택하기', '⧉ 뒤에 복사', '✂ 여기서 자르기', '⊕ 옆과 합치기', '× 지우기']);

  // 재생 헤드가 이 블록 밖(null) → 팝업이 닫히지 않고 2..4 단추로 바뀐다(RM-11 의 「⧉ 뒤에 복사」가 앞에 있어 자르기는 넷째 줄)
  dom.buttons(popup.current())[3].click();
  assert.deepEqual(called, [['head', 'a']]);
  assert.ok(popup.current(), '닫히지 않는다');
  assert.equal(popup.current().children[0].textContent, '몇 번째 카운트에서');
  assert.deepEqual(labelsOf(), ['2', '3', '4']);
  dom.buttons(popup.current())[1].click();
  assert.deepEqual(called.at(-1), ['count', 'a', 3]);
  assert.equal(popup.current(), null);
  assert.deepEqual(rendered.at(-1), { boards: { main: { rows: [1] } } });

  // 재생 헤드가 블록 안 → 바로 자르고 닫는다
  headDirty = { boards: { main: { rows: [2] } } };
  popup.open({ groupId: 'a' }, 10, 10, 4);
  dom.buttons(popup.current())[3].click();
  assert.equal(popup.current(), null);
  assert.deepEqual(rendered.at(-1), headDirty);

  // 합치기
  popup.open({ groupId: 'a' }, 10, 10, 4);
  dom.buttons(popup.current())[4].click();
  assert.deepEqual(called.at(-1), ['merge', 'a']);

  // 짝이 없으면 합치기 줄이 없고, 1카운트 블록은 자르기 줄이 없다
  partner = null;
  popup.open({ groupId: 'a' }, 10, 10, 4);
  assert.deepEqual(labelsOf(), ['✎ 동작 정하기', '☐ 선택하기', '⧉ 뒤에 복사', '✂ 여기서 자르기', '× 지우기']);
  popup.open({ groupId: 'a' }, 10, 10, 1);
  assert.deepEqual(labelsOf(), ['✎ 동작 정하기', '☐ 선택하기', '⧉ 뒤에 복사', '× 지우기']);
  popup.close();
});

test('RM-16: 다섯 줄 팝업은 잰 높이로 자리를 잡아 화면 아래로 넘치지 않는다', async () => {
  const { placePlacementActionPopup } = await import('../../src/domain/popupPlacement.js');
  // 브라우저에서 잰 값 — 8x4 행 라벨(clientY 572)을 723px 창에서 우클릭하면 181px 메뉴의 아래끝이 763 이었다
  const { top } = placePlacementActionPopup({ clientX: 400, clientY: 572, viewW: 1440, viewH: 723, height: 181 });
  assert.ok(top + 181 <= 723 - 8, `아래끝 ${top + 181} 이 창(723) 안이어야 한다`);
  // 높이를 주지 않으면 가정 높이(152 — RM-11 이 네 줄일 때 잰 값)로 막는다: 572+10+152 는 723-8 을 넘어 위로 당긴다
  assert.equal(placePlacementActionPopup({ clientX: 400, clientY: 572, viewW: 1440, viewH: 723 }).top, 723 - 8 - 152);
});
