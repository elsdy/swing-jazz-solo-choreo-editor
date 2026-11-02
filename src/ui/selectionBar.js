// src/ui/selectionBar.js — 고른 블록에 할 수 있는 일을 안무표 위 한 줄에 모은다 (ui 계층, RM-14 · 2026-11-02)
//
// 그전에는 고른 것에 할 일이 흩어져 있었다 — 도구 모음의 `루틴으로 편성 (N)`, 영상 패널의 `고른 블록 반복`,
// 글쇠로만 되는 지우기(Delete) · 복사(Ctrl+C) · 복제(Ctrl+D). 무엇이 되는지 화면에서 보이지 않았다.
//
// ⚠ 단추의 글자 · 툴팁은 **명령 등록부**(domain/commands)에서 읽는다 — 여기서 라벨을 적지 않는다. 그래야 글쇠를 바꾼 사람의
//   툴팁 · 명령 팔레트 · 단축키 일람이 이 바와 같다.
// ⚠ 누름은 여기서 걸지 않는다. 단추마다 `data-command` 를 달면 input/controls 의 bindCommandButtons 가 문서에 한 번 건
//   리스너가 runCommand 로 보낸다 — 키보드 · 팔레트와 같은 실행 표(app/main 의 COMMAND_RUNNERS)를 탄다(원칙 D-14).
// ⚠ 보일지는 `hidden` 속성으로 정한다. 끌 때는 속성을 없앤다(U-11).

import { commandFace } from './commandButtons.js';

/** 바에 놓는 명령 — 차례가 화면의 차례다. */
export const SELECTION_BAR_COMMANDS = Object.freeze([
  'deleteSelection', 'duplicate', 'copySelection', 'practiceSelection', 'routineFromSelection',
]);

/**
 * 고른 개수에서 바에 그릴 것. 순수 함수 — 시험이 DOM 없이 부른다.
 * @param {number} count 지금 고른 블록 수
 * @param {{ canRun?: (id:string) => boolean, face?: (id:string) => {label:string, title:string} }} [opts]
 * @returns {{ visible: boolean, countLabel: string, buttons: {id:string, label:string, title:string, disabled:boolean}[] }}
 */
// @complexity time=O(c) space=O(c) cc=2
export function selectionBarModel(count, opts = {}) {
  const { canRun = () => true, face = commandFace } = opts;
  if (!count) return { visible: false, countLabel: '', buttons: [] };
  return {
    visible: true,
    countLabel: `${count}개 고름`,
    buttons: SELECTION_BAR_COMMANDS.map(id => ({ id, ...face(id), disabled: !canRun(id) })),
  };
}

/**
 * 선택 액션 바를 만든다. `render()` 는 렌더 라우팅의 selection 갈래가 부른다.
 * @param {{
 *   store: { selection: Set<string> },
 *   elements?: Record<string, HTMLElement|null>,
 *   keysOf?: (id:string) => string[]|undefined,
 *   canRun?: (id:string) => boolean,
 *   doc?: Document,
 * }} deps
 * @returns {{ render(): void }}
 */
// @complexity time=O(1) space=O(1) cc=2
export function createSelectionBar(deps) {
  const { store, elements = {}, keysOf = () => undefined, canRun = () => true, doc = document } = deps;
  const bar = 'selectionBar' in elements ? elements.selectionBar : doc.getElementById('selectionBar');

  /** 지금 선택으로 바를 다시 그린다. 고른 것이 없으면 숨긴다. */
  // @complexity time=O(c) space=O(c) cc=4
  function render() {
    if (!bar) return;
    const model = selectionBarModel(store.selection.size, { canRun, face: (id) => commandFace(id, keysOf) });
    if (!model.visible) { bar.setAttribute('hidden', ''); bar.replaceChildren(); return; }
    bar.removeAttribute('hidden');
    const count = doc.createElement('span');
    count.className = 'selection-bar-count';
    count.textContent = model.countLabel;
    const buttons = model.buttons.map(b => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.dataset.command = b.id;
      btn.dataset.board = 'main';
      btn.textContent = b.label;
      btn.title = b.title;
      btn.disabled = b.disabled;
      return btn;
    });
    bar.replaceChildren(count, ...buttons);
  }

  return { render };
}
