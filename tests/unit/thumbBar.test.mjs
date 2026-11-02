// tests/unit/thumbBar.test.mjs — 엄지 줄의 `+ 빠른 배치` 가 켜짐을 보이는가 (RM-36)
//
// 폰 폭에서는 캔버스 바의 `+ 빠른 배치` 가 숨고 엄지 줄의 것만 보인다. 엄지 줄이 늘 흐린 모양이면
// 눌러 켜도 토글로 보이지 않는다 — 캔버스 바(ui/toolbarView)와 같은 활성 클래스를 입는지 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbBar } from '../../src/ui/thumbBar.js';
import { CLS } from '../../src/ui/domContract.js';

/** 엄지 줄이 쓰는 만큼만 흉내 낸 DOM — children · createElement · 속성 · remove. */
function fakeDom() {
  const body = { dataset: {} };
  const doc = { body, createElement: () => makeEl() };
  const bar = makeEl();
  bar.ownerDocument = doc;
  bar.appendChild = (el) => {
    const i = bar.children.indexOf(el);
    if (i >= 0) bar.children.splice(i, 1);
    bar.children.push(el);
    el.remove = () => { const j = bar.children.indexOf(el); if (j >= 0) bar.children.splice(j, 1); };
  };
  function makeEl() {
    const attrs = {};
    return {
      children: [], dataset: {}, className: '', textContent: '', title: '', disabled: false, hidden: false,
      setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      // 단추 안의 아이콘 · 글자 칸(ui/icon.iconLabel, RM-18)
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren(...kids) { this.children = kids; },
      remove() {}
    };
  }
  return { bar };
}

function setup(state) {
  const { bar } = fakeDom();
  let st = { panelOpen: false, capturing: false, canCapture: false, sheetOpen: false, ...state };
  const calls = [];
  const view = createThumbBar({
    elements: { thumbBar: bar },
    getState: () => st,
    actions: {
      openPanel() {}, togglePlay() {}, capture() {}, rewind() {}, skip() {}, stop() {}, toggleSheet() {},
      quickPlace: () => calls.push('quickPlace')
    },
    face: (id) => ({ label: id, title: id })
  });
  const quick = () => bar.children.find(b => b.dataset.act === 'quick');
  return { bar, view, quick, calls, set: (next) => { st = { ...st, ...next }; } };
}

test('빠른 배치가 켜지면 quick 버튼이 quick-btn-active 를 입고 꺼지면 ghost 로 돌아간다', () => {
  const { view, quick, set, calls } = setup({ quickPlaceOn: false });
  assert.ok(quick(), '영상이 닫힌 상태에 `빠른 배치` 가 있다');
  assert.equal(quick().className, CLS.ghost);
  set({ quickPlaceOn: true });
  view.render();
  assert.equal(quick().className, CLS.quickBtnActive);
  set({ quickPlaceOn: false });
  view.render();
  assert.equal(quick().className, CLS.ghost);
  // 누름은 늘 같은 명령 하나다 — 켜짐은 버튼이 아니라 store 가 쥔다.
  quick().onclick();
  assert.deepEqual(calls, ['quickPlace']);
});

test('빠른 배치 버튼은 켜짐을 aria-pressed 로 알린다', () => {
  const { bar, view, quick, set } = setup({ quickPlaceOn: false });
  assert.equal(quick().getAttribute('aria-pressed'), 'false');
  set({ quickPlaceOn: true });
  view.render();
  assert.equal(quick().getAttribute('aria-pressed'), 'true');
  // 토글이 아닌 버튼에는 달지 않는다.
  for (const b of bar.children.filter(b => b.dataset.act !== 'quick')) {
    assert.equal(b.getAttribute('aria-pressed'), null, b.dataset.act);
  }
});

test('켜짐이 바뀌어도 quick 버튼은 같은 엘리먼트로 남는다', () => {
  const { view, quick, set } = setup({ quickPlaceOn: false });
  const btn = quick();
  set({ quickPlaceOn: true });
  view.render();
  assert.equal(quick(), btn, '버튼을 갈아 끼우지 않고 그 자리를 고쳐 쓴다');
  set({ quickPlaceOn: false });
  view.render();
  assert.equal(quick(), btn);
});
