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

// ── 블록 위 이름 입력을 여는 글쇠 (RM-15) ─────────────────────────────────────

/** 고른 블록이 있는 채로 묶는다. */
function boundWithSelection(hasSelection = () => true) {
  const doc = fakeDoc();
  const calls = [];
  bindHotkeys({ doc, hasSelection, runCommand: (id, ctx) => { calls.push({ id, ...ctx }); return true; } });
  return { doc, calls };
}

test('블록을 고른 채 글자를 치면 이름 입력을 연다', () => {
  const { doc, calls } = boundWithSelection();
  assert.equal(press(doc, { key: 'j' }), true, '글자가 이름 입력으로 들어가므로 기본 동작을 막는다');
  assert.deepEqual(calls, [{ id: 'nameBlock', board: 'main', source: 'key', initial: 'j' }], '친 글자를 실어 부른다');
  press(doc, { key: 'J', shift: true });
  press(doc, { key: 'ㅈ' });
  press(doc, { key: '3' });
  assert.deepEqual(calls.slice(1).map(c => c.initial), ['J', 'ㅈ', '3'], 'Shift 글자 · 한글 자모 · 숫자도 글자다');
  // Enter · F2 로도 연다 — 글자 없이
  press(doc, { key: 'Enter' });
  press(doc, { key: 'F2' });
  assert.deepEqual(calls.slice(4), [
    { id: 'nameBlock', board: 'main', source: 'key' }, { id: 'nameBlock', board: 'main', source: 'key' }]);

  // 고른 블록이 없으면 글자는 아무 일도 하지 않는다
  const none = boundWithSelection(() => false);
  assert.equal(press(none.doc, { key: 'j' }), false);
  assert.equal(none.calls.length, 0, '고른 블록이 없는데 이름 입력을 열려 했다');
  // 입력칸 안의 글자는 그 칸의 것이다
  press(doc, { key: 's', target: { tagName: 'INPUT' } });
  press(doc, { key: 'Enter', target: { tagName: 'TEXTAREA' } });
  assert.equal(calls.length, 6, '입력칸 안에서 열렸다');
  // 조합 글쇠 · 조합 중 · 빈칸은 글자가 아니다
  press(doc, { key: 'x', ctrl: true });
  press(doc, { key: 'x', meta: true });
  doc.listener({ key: 'ㅎ', isComposing: true, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: 'BODY' }, preventDefault() {} });
  assert.equal(calls.length, 6);
  // 단추에 포커스가 있을 때의 Enter 는 단추를 누르는 것이다
  assert.equal(press(doc, { key: 'Enter', target: { tagName: 'BUTTON' } }), false);
  assert.equal(calls.length, 6, '단추의 Enter 를 이름 입력이 가로챘다');
});

test('받아 적기 글쇠 · S · ? 는 블록을 골라 두어도 이름 입력을 열지 않는다', () => {
  const { doc, calls } = boundWithSelection();
  for (const key of ['b', 'K', 'n', ' ', '?', 's']) press(doc, { key });
  assert.deepEqual(calls.map(c => c.id), ['capture', 'capture', 'skip', 'play', 'shortcuts', 'splitAtPlayhead'], '원래 명령이 그대로 이긴다 — 재생 헤드 자르기(S, RM-16)도');
  assert.equal(calls.some(c => c.id === 'nameBlock'), false);
  // 화살표 · Delete · Backspace 도 키보드 편집 그대로
  for (const key of ['ArrowLeft', 'Delete', 'Backspace']) press(doc, { key });
  assert.deepEqual(calls.slice(6).map(c => c.id), ['nudgeLeft', 'deleteSelection', 'deleteSelection']);
});
