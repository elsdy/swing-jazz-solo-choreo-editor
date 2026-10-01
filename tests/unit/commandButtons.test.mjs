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
