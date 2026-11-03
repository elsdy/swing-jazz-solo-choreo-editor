// tests/unit/inlinePrompt.test.mjs — 블록 위 이름 입력(ui/inlinePrompt.askName)의 자모 다시 묶기 (RM-50)
//
// 가짜 문서 위에서 askName 을 열고 input · keydown · blur 를 손으로 보내, **값이 언제 바뀌고 언제 그대로인지**만 본다.
// 첫 시험 이름은 계획서 「요구 ↔ 시험」 표 3 과 같다.
// ⚠ 실제 입력기가 첫 글쇠를 조합 없이 맺는 길은 여기서 흉내 내지 않는다 — 그 길은 실기로 잰다(BUG_REPORTS).

import test from 'node:test';
import assert from 'node:assert/strict';
import { askName } from '../../src/ui/inlinePrompt.js';

/** askName 이 쓰는 만큼만 있는 가짜 문서. 입력은 doc.input 으로 꺼낸다. */
function fakeDoc() {
  const make = (tag) => {
    const el = {
      tag, children: [], listeners: {}, style: {}, attrs: {}, className: '', textContent: '', parent: null,
      value: '', selectionStart: 0, selectionEnd: 0,
      set innerHTML(_) { el.children = []; },
      append(...cs) { for (const c of cs) el.appendChild(c); },
      appendChild(c) { c.parent = el; el.children.push(c); return c; },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); el.parent = null; },
      setAttribute(k, v) { el.attrs[k] = v; },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      fire(type, ev = {}) { for (const fn of el.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...ev }); },
      focus() {}, select() { el.selectionStart = 0; el.selectionEnd = el.value.length; },
      setSelectionRange(a, b) { el.selectionStart = a; el.selectionEnd = b; },
    };
    if (tag === 'input') doc.input = el;
    return el;
  };
  const doc = { createElement: make, hasFocus: () => true, defaultView: { innerWidth: 1200, innerHeight: 800 } };
  doc.body = make('body');
  return doc;
}

/** 사람이 친 것처럼 — 값을 바꾸고 커서를 끝에 둔 뒤 input 을 보낸다. */
const type = (input, value, isComposing = false) => {
  input.value = value;
  input.selectionStart = input.selectionEnd = value.length;
  input.fire('input', { isComposing });
};

test('[RM-50 요구 2] 한글 낱자로 연 입력만 맺힌 뒤 자모를 다시 조합한다', async () => {
  // ① 깃발을 켠 입력 — 맺힌 input 에서 흩어진 자모를 묶고 커서를 끝에 둔다
  let doc = fakeDoc();
  let answer = askName({ title: '이 블록의 이름', value: '', jamoRejoin: true, doc });
  let input = doc.input;
  type(input, 'ㅅ');
  assert.equal(input.value, 'ㅅ', '홀로 선 자음은 그대로');
  type(input, 'ㅅㅡ');
  assert.equal(input.value, '스', '맺힌 뒤 묶는다');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 1], '커서는 끝');
  // 조합 중(isComposing)에는 값을 건드리지 않는다 — 입력기의 것이다
  type(input, '스ㅇ', true);
  assert.equal(input.value, '스ㅇ', '조합 중에는 그대로');
  type(input, '스위', true);
  type(input, '스윙', true);
  assert.equal(input.value, '스윙');
  // compositionend 뒤 input 이 오지 않는(Safari) 꼴 — 닫을 때 한 번 더 거친다
  input.value = 'ㅊㅏㄹ스턴';
  input.fire('keydown', { key: 'Enter', isComposing: false });
  assert.deepEqual(await answer, { value: '찰스턴', via: 'enter' });

  // Tab · blur 로 닫아도 묶은 값이다
  doc = fakeDoc();
  answer = askName({ title: 't', jamoRejoin: true, doc });
  doc.input.value = 'ㅎㅏㄴ';
  doc.input.fire('keydown', { key: 'Tab', shiftKey: false, isComposing: false });
  assert.deepEqual(await answer, { value: '한', via: 'tab' });
  doc = fakeDoc();
  answer = askName({ title: 't', jamoRejoin: true, doc });
  doc.input.value = 'ㅎㅏㄴ';
  doc.input.fire('blur');
  assert.deepEqual(await answer, { value: '한', via: 'blur' });

  // 커서가 가운데 있으면 끝에서 잰 자리를 지킨다
  doc = fakeDoc();
  answer = askName({ title: 't', jamoRejoin: true, doc });
  input = doc.input;
  input.value = 'ㅎㅏㄴ Out';
  input.selectionStart = input.selectionEnd = 3;   // ㄴ 바로 뒤
  input.fire('input', { isComposing: false });
  assert.equal(input.value, '한 Out');
  assert.equal(input.selectionEnd, 1, '한 바로 뒤');
  input.fire('keydown', { key: 'Escape', isComposing: false });
  assert.deepEqual(await answer, { value: null, via: 'escape' });

  // 추천을 고르면 목록의 이름 그대로다 — 묶지 않는다
  doc = fakeDoc();
  answer = askName({ title: 't', jamoRejoin: true, doc, suggest: () => [{ name: 'ㅋㅋ 스텝' }] });
  type(doc.input, 'ㅋ');
  doc.input.fire('keydown', { key: 'ArrowDown', isComposing: false });
  doc.input.fire('keydown', { key: 'Enter', isComposing: false });
  assert.deepEqual(await answer, { value: 'ㅋㅋ 스텝', via: 'enter' });

  // 조합 중이라 값이 「ㅅㅡ윙」으로 남아 있어도 추천은 묶은 글자로 찾는다 — 값은 그대로
  doc = fakeDoc();
  const asked = [];
  answer = askName({ title: 't', jamoRejoin: true, doc, suggest: (q) => { asked.push(q); return q === '스윙' ? [{ name: '스윙 아웃' }] : []; } });
  type(doc.input, 'ㅅㅡ윙', true);
  assert.equal(doc.input.value, 'ㅅㅡ윙', '조합 중에는 값을 건드리지 않는다');
  assert.equal(asked.at(-1), '스윙', '추천 질의는 묶은 글자');
  doc.input.fire('keydown', { key: 'ArrowDown', isComposing: false });
  doc.input.fire('keydown', { key: 'Enter', isComposing: false });
  assert.deepEqual(await answer, { value: '스윙 아웃', via: 'enter' });

  // ② 깃발이 없는 입력(Enter · F2 · 영문 첫 자로 연 것) — 지금과 같다, 값을 건드리지 않는다
  const plainAsked = [];
  doc = fakeDoc();
  answer = askName({ title: 't', value: 'S', doc, suggest: (q) => { plainAsked.push(q); return []; } });
  type(doc.input, 'Sㅅㅡ');
  assert.equal(doc.input.value, 'Sㅅㅡ', '깃발이 없으면 그대로');
  assert.equal(plainAsked.at(-1), 'Sㅅㅡ', '깃발이 없으면 추천 질의도 적은 그대로');
  doc.input.fire('keydown', { key: 'Enter', isComposing: false });
  assert.deepEqual(await answer, { value: 'Sㅅㅡ', via: 'enter' });
  doc = fakeDoc();
  answer = askName({ title: 't', doc });
  doc.input.value = 'ㅎㅏㄴ';
  doc.input.fire('blur');
  assert.deepEqual(await answer, { value: 'ㅎㅏㄴ', via: 'blur' }, '깃발이 없으면 닫을 때도 그대로');

  // 조합 중의 Enter 는 글자를 맺는 것이다 — 닫지 않는다(지금 동작)
  doc = fakeDoc();
  answer = askName({ title: 't', jamoRejoin: true, doc });
  doc.input.value = 'ㅎㅏ';
  doc.input.fire('keydown', { key: 'Enter', isComposing: true });
  assert.equal(doc.input.value, 'ㅎㅏ', '조합 중 Enter 에는 값도 그대로');
  assert.ok(doc.body.children.length === 1, '아직 열려 있다');
  doc.input.fire('keydown', { key: 'Enter', isComposing: false });
  assert.deepEqual(await answer, { value: '하', via: 'enter' });
});
