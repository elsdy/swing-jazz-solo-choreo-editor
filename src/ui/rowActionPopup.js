// src/ui/rowActionPopup.js — 행 라벨을 우클릭(터치는 길게 누르기)하면 뜨는 마디 메뉴 (ui 계층, 2026-11-02 RM-16)
//
// 마디 하나에 할 수 있는 다섯 가지를 한자리에 세운다 — `위에 한 마디 끼우기` · `이 마디 지우기` · `이 마디 복제` ·
// `위로 옮기기` · `아래로 옮기기`. 그전에는 가운데에 한 마디를 끼우려면 뒤의 블록을 하나씩 끌어 옮겨야 했다.
//
// ⚠ 생김새는 형제 팝업(routineActionPopup · placementActionPopup)과 **같은 클래스**다 — 같은 종류의 창이고,
//   자리 잡는 규칙도 같은 것(domain/popupPlacement.placePlacementActionPopup)을 쓴다.
// ⚠ 지우기만 `정말요?`(confirmOnce) 로 한 번 더 묻는다 — 마디 하나에 블록이 여럿이라 되돌리기 한 번으로 돌아오긴
//   해도 손이 미끄러져 지우는 일이 흔하다(계획서). 나머지는 바로 한다.
// ⚠ 커맨드는 **히스토리 커밋까지** 끝낸 Dirty 를 돌려줘야 한다(형제 팝업과 같은 규약). 여기서는 그리기만 한다.

import { CLS } from './domContract.js';
import { bindOutsideClose } from './popup.js';
import { confirmOnce } from './widgets.js';
import { placePlacementActionPopup } from '../domain/popupPlacement.js';

/** 메뉴의 줄 — 차례가 곧 화면의 차례다. 문서(기능 설명서 · 튜토리얼)가 이 글자를 인용한다. */
export const ROW_MENU = Object.freeze([
  { key: 'insertAbove', label: '위에 한 마디 끼우기' },
  { key: 'deleteRow', label: '이 마디 지우기', danger: true, confirm: true },
  { key: 'duplicateRow', label: '이 마디 복제' },
  { key: 'moveUp', label: '위로 옮기기', disabledWhen: 'first' },
  { key: 'moveDown', label: '아래로 옮기기', disabledWhen: 'last' },
]);

/**
 * @typedef {object} RowActionPopupDeps
 * @property {{
 *   insertAbove: (row: number) => any,
 *   deleteRow: (row: number) => any,
 *   duplicateRow: (row: number) => any,
 *   moveUp: (row: number) => any,
 *   moveDown: (row: number) => any
 * }} commands  행 번호를 받아 **커밋까지 끝낸** Dirty 를 돌려준다
 * @property {(dirty: any) => void} render presenter
 * @property {(row: number) => string} [labelOf] 제목에 쓸 행 이름(기본 `마디 N`)
 * @property {(row: number) => ({ label: string, run: (clientX: number, clientY: number) => void }|null)} [extraItem]
 *   맨 아래에 더할 한 줄(2026-11-03 RM-23 — `파트로 묶기…` · `파트 고치기…`). 다른 팝업을 여는 줄이라 Dirty 를 돌려주지 않는다
 */

/**
 * @param {RowActionPopupDeps} deps
 * @returns {{ open(target: {row:number, first?:boolean, last?:boolean}, clientX: number, clientY: number): void, close(): void, current(): HTMLElement|null }}
 */
// @complexity time=O(1) space=O(1) cc=1
export function createRowActionPopup(deps) {
  const { commands, render, labelOf = (row) => `마디 ${row}`, extraItem = null } = deps;

  /** @type {HTMLElement|null} */
  let popupEl = null;

  /** 두 번 불러도 안전하다. */
  // @complexity time=O(1) space=O(1) cc=2
  function close() {
    if (popupEl) { popupEl.remove(); popupEl = null; }
  }

  /**
   * @param {{row:number, first?:boolean, last?:boolean}} target 눌린 행. first · last 면 옮기기 한쪽이 꺼진다
   * @param {number} clientX
   * @param {number} clientY
   */
  // @complexity time=O(1) space=O(1) cc=10
  function open(target, clientX, clientY) {
    close();
    const { row, first = false, last = false } = target;
    const popup = document.createElement('div');
    popup.className = CLS.routineActionPopup;
    popupEl = popup;

    const title = document.createElement('div');
    title.className = CLS.rapTitle;
    title.textContent = labelOf(row);
    popup.appendChild(title);

    for (const item of ROW_MENU) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (item.danger) btn.className = CLS.danger;
      btn.textContent = item.label;
      if ((item.disabledWhen === 'first' && first) || (item.disabledWhen === 'last' && last)) btn.disabled = true;
      const run = () => { close(); render(commands[item.key](row)); };
      // 지우기는 두 번 — 첫 누름은 `정말요?` 로 바뀌고 2초 안의 둘째 누름이 지운다. 그동안 팝업은 열려 있다.
      btn.addEventListener('click', () => (item.confirm ? confirmOnce(btn, item.label, run) : run()));
      popup.appendChild(btn);
    }

    const extra = typeof extraItem === 'function' ? extraItem(row) : null;
    if (extra) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = extra.label;
      btn.addEventListener('click', () => { close(); extra.run(clientX, clientY); });
      popup.appendChild(btn);
    }

    document.body.appendChild(popup);

    const { left, top } = placePlacementActionPopup({
      clientX, clientY, viewW: window.innerWidth, viewH: window.innerHeight, height: popup.offsetHeight,
    });
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    bindOutsideClose(() => popupEl, close);
  }

  return { open, close, current: () => popupEl };
}
