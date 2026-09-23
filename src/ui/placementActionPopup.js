// src/ui/placementActionPopup.js — 안무 블록을 눌렀을 때 뜨는 동작 팝업 (ui 계층)
//
// 2026-09-21 신설. 터치 폭에서 블록으로 할 수 있는 일을 **한자리에 세워** 고르게 한다.
//
// 왜: 그전에 블록으로 하는 일이 셋이었는데 셋 다 손가락에게 불친절했다 —
//   · 고르기   = 한 번 탭 (보이지 않는 규칙)
//   · 지우기   = **두 번 탭** (정확히 두 번 치기가 어렵고, 첫 탭이 고르기라 화면이 먼저 바뀐다)
//   · 이름 정하기 = 고른 뒤 나타나는 20px 짜리 `✎` (손끝보다 작다)
// 이제 한 번 탭하면 이 팝업이 뜨고 셋이 나란히 보인다. 무엇을 할 수 있는지가 화면에 적힌다.
//
// ⚠⚠ **마우스 폭에서는 이것이 뜨지 않는다.** 거기서는 한 번 클릭이 고르기, 두 번이 지우기로
//   이미 손에 익었고 과녁도 충분하다. 띄우는 판정은 input/boardController 가 주입받은
//   `isTouchLayout()` 로 하고(우클릭은 예외로 언제나 연다), 이 파일은 **띄우라면 띄울 뿐**이다.
// ⚠ 자리 잡는 규칙은 **형제인 routineActionPopup 과 같은 것**을 쓴다(상수 크기로 동기 계산).
//   ui/popup.js 의 positionPopup 은 ≤1040 에서 화면 꼭대기로 보내 버려, 누른 블록 옆이 아니라
//   엉뚱한 데에 뜬다 — 그쪽 파일의 ⚠⚠ 주석이 그 까닭을 적어 두었다.
// ⚠ 지우기에 확인 단계를 두지 않는다. 형제 팝업과 같고, 블록 삭제는 `되돌리기` 한 번이면 돌아온다.
//   (되돌릴 수 없는 일에만 confirmOnce 를 쓴다 — 저장소 관습.)

import { CLS } from './domContract.js';
import { bindOutsideClose } from './popup.js';

/** 자리 잡기에 쓰는 가정 크기. 형제 팝업과 같은 방식이라 실제로 재지 않는다. */
const POPUP_W = 160;
const POPUP_H = 132;
/** 화면 가장자리 여백. */
const EDGE_GAP = 8;
/** 누른 자리보다 조금 아래에 띄운다 — 손가락이 팝업의 첫 줄을 덮지 않게. */
const CURSOR_DROP = 10;

/**
 * @typedef {object} PlacementActionPopupDeps
 * @property {{
 *   toggleSelection: (groupId: string) => any,
 *   removeGroup: (groupId: string) => any,
 *   openPicker: (groupId: string, clientX: number, clientY: number) => void
 * }} commands
 *   ⚠ removeGroup 은 **삭제와 히스토리 커밋 둘 다**여야 한다(형제 팝업과 같은 규약).
 * @property {(groupId: string) => boolean} isSelected 지금 고른 블록인가
 * @property {(dirty: any) => void} render presenter
 */

/**
 * @param {PlacementActionPopupDeps} deps
 * @returns {{ open(placement: any, clientX: number, clientY: number): void, close(): void, current(): HTMLElement|null }}
 */
export function createPlacementActionPopup(deps) {
  const { commands, isSelected, render } = deps;

  /** @type {HTMLElement|null} */
  let popupEl = null;

  /** 두 번 불러도 안전하다. */
  function close() {
    if (popupEl) { popupEl.remove(); popupEl = null; }
  }

  /**
   * @param {{ name?: string, groupId: string, pending?: boolean }} placement 눌린 블록
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} [count] 그룹 전체 카운트. 제목에만 쓴다
   */
  function open(placement, clientX, clientY, count) {
    close();
    const groupId = placement.groupId;
    const popup = document.createElement('div');
    // ⚠ 형제 팝업과 **같은 클래스**다. 생김새가 같아야 하는 같은 종류의 창이고, 규칙을 두 벌로
    //   두면 한쪽만 고쳐진다. 다른 점은 안에 든 줄뿐이다.
    popup.className = CLS.routineActionPopup;
    popupEl = popup;

    const title = document.createElement('div');
    title.className = CLS.rapTitle;
    const name = placement.pending || !placement.name ? '이름 없는 블록' : placement.name;
    title.textContent = Number.isFinite(count) ? `${name} ${count}c` : name;
    popup.appendChild(title);

    /** 줄 하나. 누르면 **먼저 닫고** 그다음에 일한다(형제 팝업과 같은 순서). */
    const row = (label, run, cls) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (cls) btn.className = cls;
      btn.textContent = label;
      btn.addEventListener('click', () => { close(); run(); });
      popup.appendChild(btn);
      return btn;
    };

    // ⚠ 차례가 뜻을 만든다: 가장 자주 하는 일이 맨 위, 되돌리기 어려운 일이 맨 아래다.
    row('✎ 동작 정하기', () => commands.openPicker(groupId, clientX, clientY));
    row(isSelected(groupId) ? '☑ 선택 풀기' : '☐ 선택하기', () => render(commands.toggleSelection(groupId)));
    row('× 지우기', () => render(commands.removeGroup(groupId)), CLS.danger);

    document.body.appendChild(popup);

    const x = Math.max(EDGE_GAP, Math.min(clientX, window.innerWidth - POPUP_W - EDGE_GAP));
    const y = Math.max(EDGE_GAP, Math.min(clientY + CURSOR_DROP, window.innerHeight - POPUP_H - EDGE_GAP));
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    // ⚠ 게터를 넘긴다 — 팝업이 갈릴 수 있으므로 매번 최신 것을 봐야 한다(형제 팝업과 같다).
    bindOutsideClose(() => popupEl, close);
  }

  return { open, close, current: () => popupEl };
}
