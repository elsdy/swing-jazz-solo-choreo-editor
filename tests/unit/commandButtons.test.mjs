// tests/unit/commandButtons.test.mjs — 명령 등록부와 화면의 버튼이 같은 말을 하는가 (RM-09)
//
// 버튼의 글자는 마크업에도 있다(처음 그려질 때 깜빡이지 않게). 그래서 등록부의 `button` 과 마크업 글자가 두 곳에
// 적힌다 — 둘이 어긋나면 이 시험이 붉어진다(원칙 D-14: 두 곳에 적히면 기계로 맞춰 센다).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, commandById } from '../../src/domain/commands.js';
import { commandFace, syncCommandTitles } from '../../src/ui/commandButtons.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** 마크업에서 `data-command` 를 단 버튼 — id · 보드 · 안쪽 글자 · title 속성. */
function commandButtons(html) {
  const out = [];
  for (const m of html.matchAll(/<button\b([^>]*\bdata-command="([\w-]+)"[^>]*)>([^<]*)<\/button>/g)) {
    out.push({
      attrs: m[1],
      id: m[2],
      board: (m[1].match(/data-board="(\w+)"/) || [])[1] || 'main',
      text: m[3].trim(),
      title: (m[1].match(/\btitle="([^"]*)"/) || [])[1],
    });
  }
  return out;
}

test('마크업의 data-command 버튼 — 등록부에 있고, 글자가 등록부의 button 과 같고, 툴팁을 손으로 적지 않는다', () => {
  const buttons = commandButtons(HTML);
  assert.ok(buttons.length >= 10, `읽은 버튼이 ${buttons.length}개뿐이다 — 읽는 법이 낡았나`);
  for (const b of buttons) {
    const cmd = commandById(b.id);
    assert.ok(cmd, `data-command="${b.id}" 가 등록부에 없다`);
    if (cmd.button) assert.equal(b.text, cmd.button, `${b.id} 버튼 글자가 등록부와 다르다`);
    // 툴팁은 syncCommandTitles 가 등록부에서 단다. 마크업에 적으면 글쇠를 바꾼 사람에게 거짓말이 된다.
    assert.equal(b.title, undefined, `${b.id} 버튼에 title 을 손으로 적었다 — 등록부의 title 로 옮긴다`);
    assert.ok(['main', 'routine'].includes(b.board), `${b.id} 의 data-board="${b.board}"`);
  }
  // 같은 일의 입구가 둘인 것은 두 보드에 하나씩이다 — 루틴 편집기의 Undo 는 루틴을 되돌린다.
  for (const id of ['undo', 'redo', 'quickPlace']) {
    assert.deepEqual(buttons.filter(b => b.id === id).map(b => b.board).sort(), ['main', 'routine'], id);
  }
});

test('syncCommandTitles — 등록부의 툴팁에 지금 글쇠를 싣고, 모르는 id 는 건드리지 않는다', () => {
  const el = (command) => ({ dataset: { command }, title: '옛 글' });
  const els = [el('capture'), el('undo'), el('videoPanel'), el('없는명령')];
  const root = { querySelectorAll: (sel) => (sel === '[data-command]' ? els : []) };

  assert.equal(syncCommandTitles(root), 3);
  assert.match(els[0].title, /1카운트.*\(B · K\)$/);
  assert.match(els[1].title, /\(Ctrl\+Z · Cmd\+Z\)$/);
  assert.equal(els[2].title, commandById('videoPanel').title, '글쇠 없는 명령은 괄호 없이');
  assert.equal(els[3].title, '옛 글');

  // 설정에서 글쇠를 바꾸면 툴팁이 따라온다 — 마크업의 `(단축키 K 또는 B)` 는 이걸 못 했다.
  syncCommandTitles(root, (id) => (id === 'capture' ? ['J'] : undefined));
  assert.match(els[0].title, /\(J\)$/);
  syncCommandTitles(root, (id) => (id === 'capture' ? [] : undefined));
  assert.doesNotMatch(els[0].title, /\(/, '글쇠를 비우면 괄호도 빠진다');
});

test('commandFace — 엄지 바가 쓰는 글자 · 툴팁이 영상 패널의 같은 버튼과 같다', () => {
  for (const id of ['capture', 'skip', 'stop', 'videoPanel', 'quickPlace']) {
    const cmd = commandById(id);
    const face = commandFace(id);
    assert.equal(face.label, cmd.button, id);
    assert.ok(face.title.startsWith(cmd.title || cmd.label), id);
  }
  assert.deepEqual(commandFace('없는명령'), { label: '없는명령', title: '' });
});

test('개명해도 명령 id 는 그대로 — undo · redo · saveProject', () => {
  // RM-10 이 단추 글자를 용어집대로 바꿨다. id 는 사용자가 바꾼 글쇠가 `{id: 글쇠[]}` 로 저장되는 이름이라 그대로다 —
  // 바뀌면 옛 설정이 말없이 기본값으로 돌아간다.
  const expect = { undo: '되돌리기', redo: '다시 하기', saveProject: '파일로 내보내기' };
  for (const [id, button] of Object.entries(expect)) {
    const cmd = commandById(id);
    assert.ok(cmd, `${id} 가 등록부에 없다`);
    assert.equal(cmd.button, button, `${id} 의 단추 글자`);
    assert.doesNotMatch(cmd.label + cmd.hint + (cmd.title || ''), /Undo|Redo|프로젝트 저장/, `${id} 의 글자에 옛 말이 남았다`);
  }
  assert.deepEqual(commandById('saveProject').keys, ['Ctrl+S', 'Cmd+S'], '글쇠도 그대로');
  assert.deepEqual(commandById('undo').keys, ['Ctrl+Z', 'Cmd+Z']);
  // 저장된 설정의 모양 그대로 — 옛 id 로 적힌 글쇠가 여전히 읽힌다
  const saved = { saveProject: ['Ctrl+Shift+S'] };
  assert.ok(COMMANDS.some(c => c.id in saved), '저장된 id 가 등록부에 없다');
});

test('등록부 — 버튼이 있는 명령은 툴팁 몸말이 있고, 줄마다 라벨 · 설명이 빈칸이 아니다', () => {
  for (const c of COMMANDS) {
    assert.ok(c.label && c.hint, `${c.id} 의 라벨 · 설명`);
  }
});

test('matchCommands — 라벨로 시작하는 것이 먼저, 설명 · 버튼 글자로도 찾고, 팔레트 자신은 빠진다', async () => {
  const { matchCommands } = await import('../../src/ui/commandPalette.js');
  const ids = (q) => matchCommands(q).map(c => c.id);
  assert.ok(!ids('').includes('palette'), '팔레트 안에 팔레트');
  assert.equal(ids('').length, COMMANDS.length - 1, '검색어가 없으면 전부');
  assert.equal(ids('되돌')[0], 'undo');
  assert.equal(ids('영상')[0], 'videoPanel', '라벨이 「영상」으로 시작하는 것이 앞');
  assert.ok(ids('영상').includes('videoFile'));
  assert.ok(ids('빠른배치').includes('quickPlace'), '띄어쓰기를 무시한다');
  assert.ok(ids('UNDO').includes('undo'), '대소문자를 무시한다(버튼 글자 · id)');
  assert.ok(ids('보관 위치').includes('openSettings'), '설명으로도 찾는다');
  assert.deepEqual(ids('없는말없는말'), []);
});

test('선택 액션 바 — 단추가 모두 등록부에 있고, 글자 · 툴팁이 등록부와 같고, 고른 것이 없으면 바가 숨는다', async () => {
  const { SELECTION_BAR_COMMANDS, selectionBarModel, createSelectionBar } = await import('../../src/ui/selectionBar.js');
  // 등록부 — 바의 명령은 모두 등록부에 있고 단추 글자가 있다. 계획서의 다섯(지우기 · 복제 · 복사 · 고른 블록 반복 · 루틴으로 편성).
  assert.deepEqual([...SELECTION_BAR_COMMANDS], ['deleteSelection', 'duplicate', 'copySelection', 'practiceSelection', 'routineFromSelection']);
  for (const id of SELECTION_BAR_COMMANDS) {
    const cmd = commandById(id);
    assert.ok(cmd, `${id} 가 등록부에 없다`);
    assert.ok(cmd.button, `${id} 에 단추 글자가 없다`);
  }
  // 모델 — 글자 · 툴팁은 등록부(commandFace)의 것, 할 수 있는지는 canRun 이 정한다.
  const model = selectionBarModel(3, { canRun: (id) => id !== 'practiceSelection' });
  assert.equal(model.visible, true);
  assert.equal(model.countLabel, '3개 고름');
  for (const b of model.buttons) {
    assert.equal(b.label, commandById(b.id).button, `${b.id} 글자`);
    assert.equal(b.title, commandFace(b.id).title, `${b.id} 툴팁`);
  }
  assert.deepEqual(model.buttons.filter(b => b.disabled).map(b => b.id), ['practiceSelection']);
  assert.deepEqual(selectionBarModel(0), { visible: false, countLabel: '', buttons: [] });

  // 화면 — 가짜 문서에 그려 본다. 단추는 data-command 를 달아 bindCommandButtons 의 길로 간다. 툴팁에 지금 글쇠가 실린다.
  const node = (tag) => ({
    tag, dataset: {}, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    replaceChildren(...kids) { this.children = kids; },
  });
  const bar = node('div');
  const doc = { createElement: node, getElementById: () => null };
  const store = { selection: new Set(['a', 'b']) };
  const view = createSelectionBar({ store, elements: { selectionBar: bar }, doc, keysOf: (id) => (id === 'duplicate' ? ['J'] : undefined) });
  view.render();
  assert.equal('hidden' in bar.attrs, false, '고른 것이 있으면 바가 보인다');
  assert.equal(bar.children[0].textContent, '2개 고름');
  const btns = bar.children.slice(1);
  assert.deepEqual(btns.map(b => b.dataset.command), [...SELECTION_BAR_COMMANDS]);
  for (const b of btns) {
    assert.equal(b.textContent, commandById(b.dataset.command).button);
    assert.equal(b.dataset.board, 'main');
  }
  assert.match(btns[1].title, /\(J\)$/, '바꾼 글쇠가 툴팁에 실린다');
  store.selection = new Set();
  view.render();
  assert.equal('hidden' in bar.attrs, true, '고른 것이 없으면 바가 숨는다');
  assert.equal(bar.children.length, 0);

  // 도구 모음의 「루틴으로 편성 (N)」 단추는 바로 옮겼다 — 마크업에 남지 않는다.
  assert.doesNotMatch(HTML, /createRoutineFromSelectionBtn/);
  assert.match(HTML, /id="selectionBar"[^>]*\bhidden\b/, '바는 처음에 숨어 있다');
});
