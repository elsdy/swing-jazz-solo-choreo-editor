// tests/unit/hotkeyRouting.test.mjs — 단축키가 어느 보드로 가고, 입력칸에서 무엇을 듣지 않는가 (RM-13)
//
// 옛 결함 #11 둘(docs/deviations.md 「입력창 안의 Ctrl+Z 가 안무표를 되돌렸다」)을 고친 자리다.
//   1) 입력칸 안의 Ctrl+Z 는 글자를 되돌린다 — 안무표의 undo 로 새지 않는다
//   2) 루틴 편집기가 열려 있으면 단축키는 루틴 보드로 간다
// `bindHotkeys` 를 가짜 문서에 묶고 keydown 을 손으로 쏜다. 브라우저 없이 돈다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bindHotkeys } from '../../src/input/controls.js';

/** keydown 리스너 하나를 받아 두는 가짜 문서. */
function fakeDoc() {
  const doc = { listener: null, addEventListener(type, fn) { if (type === 'keydown') doc.listener = fn; } };
  return doc;
}

/** 글쇠 하나를 쏜다. 돌려준 값은 preventDefault 가 불렸는가. */
function press(doc, init) {
  let prevented = false;
  doc.listener({
    key: init.key, ctrlKey: !!init.ctrl, metaKey: !!init.meta, shiftKey: !!init.shift, altKey: false,
    target: init.target || { tagName: 'BODY' },
    preventDefault: () => { prevented = true; },
  });
  return prevented;
}

function bound(activeBoardId) {
  const doc = fakeDoc();
  const calls = [];
  bindHotkeys({ doc, activeBoardId, runCommand: (id, ctx) => { calls.push({ id, ...ctx }); return true; } });
  return { doc, calls };
}

test('입력칸 안의 Ctrl+Z 는 안무표로 가지 않는다 — 글자 되돌리기가 먹는다', () => {
  const { doc, calls } = bound(() => 'main');
  const prevented = press(doc, { key: 'z', ctrl: true, target: { tagName: 'INPUT' } });
  assert.equal(calls.length, 0, '이름칸의 Ctrl+Z 가 안무표를 되돌렸다');
  assert.equal(prevented, false, '브라우저의 글자 되돌리기를 막으면 안 된다');
  press(doc, { key: 'z', meta: true, shift: true, target: { tagName: 'TEXTAREA' } });
  press(doc, { key: 'y', ctrl: true, target: { tagName: 'DIV', isContentEditable: true } });
  assert.equal(calls.length, 0, '다시 하기도 입력칸에서는 듣지 않는다');
});

test('입력칸 밖의 Ctrl+Z 는 그대로 안무표를 되돌린다', () => {
  const { doc, calls } = bound(() => 'main');
  assert.equal(press(doc, { key: 'z', ctrl: true }), true);
  assert.deepEqual(calls, [{ id: 'undo', board: 'main', source: 'key' }]);
});

test('Escape 는 입력칸 안에서도 듣는다', () => {
  const { doc, calls } = bound(() => 'main');
  press(doc, { key: 'Escape', target: { tagName: 'INPUT' } });
  assert.deepEqual(calls.map(c => c.id), ['stop']);
});

test('루틴 편집기가 열려 있으면 단축키는 루틴 보드로 간다', () => {
  let active = 'routine';
  const { doc, calls } = bound(() => active);
  press(doc, { key: 'z', ctrl: true });
  press(doc, { key: 'y', ctrl: true });
  active = 'main';
  press(doc, { key: 'z', meta: true });
  assert.deepEqual(calls.map(c => `${c.id}@${c.board}`), ['undo@routine', 'redo@routine', 'undo@main'],
    '편집기가 열려 있는데 메인 보드가 되돌아갔다 — 활성 보드를 묻는 시점이 누를 때여야 한다');
});
