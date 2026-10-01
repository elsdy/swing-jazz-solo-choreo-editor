// src/ui/commandButtons.js — `data-command` 버튼의 툴팁을 명령 등록부에서 받는다 (ui 계층)
//
// 신설 파일이다(2026-10-01, RM-09). 그전에는 툴팁을 마크업에 손으로 적었고, 단축키도 거기 글자로 박혀
// 있었다 — `(단축키 K 또는 B)`. 설정에서 글쇠를 바꾸면 툴팁이 거짓말이 됐고, 같은 명령의 버튼이 두 곳에
// 있으면 툴팁도 두 벌로 달라졌다(영상 패널의 `▮ 끊기` 와 엄지 바의 `▮ 끊기`).
//
// 이제 툴팁의 주인은 domain/commands 하나다. 이 파일은 그것을 화면에 옮겨 적을 뿐이다.
// ⚠ 버튼의 **글자**는 여기서 쓰지 않는다. 몇몇은 상태에 따라 글자가 바뀌고(`📁 다른 파일 열기`), 처음 그려질 때
//   마크업 글자가 이미 맞아야 깜빡이지 않는다 — 마크업 글자와 등록부의 `button` 이 같은지는 시험이 본다
//   (tests/unit/commandButtons.test.mjs).
// ⚠ 누름은 여기서 걸지 않는다 — input/controls 의 bindCommandButtons 가 문서에 한 번 건다.

import { commandById, commandTitle } from '../domain/commands.js';

/**
 * 문서 안의 `[data-command]` 전부에 툴팁을 단다. 글쇠를 바꾼 뒤에 다시 부른다.
 * @param {ParentNode} root 보통 document
 * @param {(id: string) => string[]|undefined} keysOf 지금 글쇠(사용자가 바꾼 것). 없으면 기본 글쇠
 * @returns {number} 단 버튼 수
 */
export function syncCommandTitles(root, keysOf = () => undefined) {
  let n = 0;
  for (const el of root.querySelectorAll('[data-command]')) {
    const cmd = commandById(el.dataset.command);
    if (!cmd) continue;
    el.title = commandTitle(cmd, keysOf(cmd.id));
    n += 1;
  }
  return n;
}

/**
 * 버튼을 JS 로 그리는 뷰(엄지 바)가 쓰는 짧은 도우미 — 등록부의 글자 · 툴팁.
 * @param {string} id
 * @param {(id: string) => string[]|undefined} [keysOf]
 * @returns {{ label: string, title: string }}
 */
export function commandFace(id, keysOf = () => undefined) {
  const cmd = commandById(id);
  if (!cmd) return { label: id, title: '' };
  return { label: cmd.button || cmd.label, title: commandTitle(cmd, keysOf(id)) };
}
