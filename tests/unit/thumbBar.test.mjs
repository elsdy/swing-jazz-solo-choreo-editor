// tests/unit/thumbBar.test.mjs — 엄지 줄의 `+ 빠른 배치` 가 켜짐을 보이는가 (RM-36) · 좁은 단추가 짧은 꼴로 접히는가 (RM-63)
//
// 폰 폭에서는 캔버스 바의 `+ 빠른 배치` 가 숨고 엄지 줄의 것만 보인다. 엄지 줄이 늘 흐린 모양이면
// 눌러 켜도 토글로 보이지 않는다 — 캔버스 바(ui/toolbarView)와 같은 활성 클래스를 입는지 잰다.
//
// RM-63: 1200px 창의 영상 띠 조작 줄에서 단추가 폭을 똑같이 나눠(flex 1 1 0) `⏮ 처음으로` 가 68px 에
// 「처...」 로 잘렸다. 가짜 DOM 은 글자 폭을 모르므로 `layout` 으로 단추마다 clientWidth · scrollWidth 를
// 준다 — 여기서 재는 것은 **판정 길**이고, 실제 글꼴 폭은 실물 측정(계획서 RM-63 의 요구 1)이 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbBar } from '../../src/ui/thumbBar.js';
import { CLS } from '../../src/ui/domContract.js';

/**
 * 엄지 줄이 쓰는 만큼만 흉내 낸 DOM — children · createElement · 속성 · remove.
 * `layout(el)` 이 { clientWidth, scrollWidth } 를 돌려주면 그 단추의 폭으로 쓴다(없으면 잴 수 없음 = undefined).
 */
function fakeDom(layout = () => ({})) {
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
    const el = {
      children: [], dataset: {}, className: '', textContent: '', title: '', disabled: false, hidden: false,
      setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      remove() {}
    };
    Object.defineProperty(el, 'clientWidth', { get: () => layout(el).clientWidth });
    Object.defineProperty(el, 'scrollWidth', { get: () => layout(el).scrollWidth });
    return el;
  }
  return { bar };
}

function setup(state, layout) {
  const { bar } = fakeDom(layout);
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
  const act = (id) => bar.children.find(b => b.dataset.act === id);
  return { bar, view, quick, act, calls, set: (next) => { st = { ...st, ...next }; } };
}

test('빠른 배치가 켜지면 quick 버튼이 quick-btn-active 를 입고 꺼지면 ghost 로 돌아간다', () => {
  const { view, quick, set, calls } = setup({ quickPlaceOn: false });
  assert.ok(quick(), '영상이 닫힌 상태에 `+ 빠른 배치` 가 있다');
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

// ── RM-63 좁은 단추는 재서 넘칠 때만 짧은 꼴로 접는다 ─────────────────────────

/** 글자 한 자에 14px — 1200px 창에서 잰 68px 칸에 `⏮ 처음으로`(7자, 98px)는 넘치고 `⏮`(1자)는 들어간다. */
const PX_PER_CHAR = 14;
/** 칸 폭이 `width` 인 단추 — 글자 폭은 지금 textContent 로 센다(실물처럼 접으면 줄어든다). */
const boxOf = (width) => (el) => ({ clientWidth: width(el), scrollWidth: [...el.textContent].length * PX_PER_CHAR });
const VIDEO_OPEN = { panelOpen: true, docked: true, canCapture: true };

test('[RM-63 요구 1] 접힌 단추는 전체 이름을 aria-label 과 title 로 갖는다', () => {
  const { act } = setup(VIDEO_OPEN, boxOf(() => 68));
  const rewind = act('rewind');
  assert.ok(rewind, '영상이 열린 상태에 `⏮ 처음으로` 가 있다');
  assert.equal(rewind.textContent, '⏮', '68px 칸에 넘치는 글자는 짧은 꼴로 접는다');
  assert.ok(rewind.scrollWidth <= rewind.clientWidth, '접은 뒤에는 넘치지 않는다');
  assert.equal(rewind.getAttribute('aria-label'), '⏮ 처음으로', '화면 읽기는 전체 이름을 읽는다');
  assert.ok(rewind.title, '툴팁이 비지 않았다');
  assert.match(rewind.title, /처음으로/, '툴팁에도 무엇인지가 남는다');
});

test('[RM-63 요구 2] 넘치지 않으면 전체 글자를 그대로 둔다', () => {
  // 넉넉한 칸
  const wide = setup(VIDEO_OPEN, boxOf(() => 200));
  assert.equal(wide.act('rewind').textContent, '⏮ 처음으로');
  assert.equal(wide.act('rewind').getAttribute('aria-label'), null, '접지 않았으면 aria-label 을 달지 않는다 — 글자가 곧 이름이다');
  // 잴 수 없는 칸(숨은 줄 · 붙기 전) — 접기는 잰 결과로만 고른다
  for (const width of [0, undefined]) {
    const { act } = setup(VIDEO_OPEN, (el) => ({ clientWidth: width, scrollWidth: width === 0 ? 0 : undefined }));
    assert.equal(act('rewind').textContent, '⏮ 처음으로', `폭이 ${width} 이면 접지 않는다`);
    assert.equal(act('rewind').getAttribute('aria-label'), null);
  }
});

test('[RM-63 요구 3] 주 동작과 짧은 꼴 없는 단추는 넘쳐도 접지 않는다', () => {
  // 모든 단추가 넘친다
  const { act, bar } = setup(VIDEO_OPEN, boxOf(() => 10));
  assert.equal(act('cut').dataset.main, '1');
  assert.equal(act('cut').textContent, 'capture', '주 동작은 글자를 지킨다 — 말줄임이 남더라도 접지 않는다');
  assert.equal(act('play').textContent, 'play', '짧은 꼴이 없는 단추는 그대로다');
  assert.equal(act('rewind').textContent, '⏮', '짧은 꼴이 있는 단추만 접힌다');
  for (const b of bar.children.filter(b => b.dataset.act !== 'rewind')) {
    assert.equal(b.getAttribute('aria-label'), null, `${b.dataset.act} 에는 aria-label 을 달지 않는다`);
  }
});

test('[RM-63 요구 4] 자리가 생기면 다시 그릴 때 전체 글자로 돌아온다', () => {
  let width = 68;
  const { act, view } = setup(VIDEO_OPEN, boxOf(() => width));
  const rewind = act('rewind');
  assert.equal(rewind.textContent, '⏮');
  width = 200; // 창을 넓혔거나 이웃 단추가 빠졌다
  view.render();
  assert.equal(act('rewind'), rewind, '같은 엘리먼트를 고쳐 쓴다 — 누르는 순간 갈아 끼우지 않는다');
  assert.equal(rewind.textContent, '⏮ 처음으로');
  assert.equal(rewind.getAttribute('aria-label'), null);
  width = 68; // 다시 좁아지면 다시 접는다
  view.render();
  assert.equal(rewind.textContent, '⏮');
  assert.equal(rewind.getAttribute('aria-label'), '⏮ 처음으로');
});
