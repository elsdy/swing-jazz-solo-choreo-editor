// src/ui/routineActionPopup.js — 메인 보드의 루틴 블록을 눌렀을 때 뜨는 ✏편집 / ×삭제 팝업 (ui 계층)
//
// 원본 index.html 의 routineActionPopupEl(1719) · closeRoutineActionPopup(1721-1724) ·
// showRoutineActionPopup(1725-1774)을 옮겼다.
//
// ⚠⚠ **positionPopup(ui/popup.js)으로 통합하지 마라.** 두 팝업은 배치 규칙이 다르다.
//   - 여기(원본 1758-1763): `pw=140, ph=100` 을 상수로 두고 **동기로** 한 번에 계산한다.
//       x = min(clientX, innerWidth - 140 - 8)
//       y = min(clientY + 6, innerHeight - 100 - 8)
//     실제 크기를 재지 않고(rAF 없음) 모바일 분기도 없다 — 폰에서도 탭한 블록 바로 옆에 뜬다.
//   - positionPopup(원본 1781-1806): left/top 을 '0px' 로 못박고 requestAnimationFrame 한 프레임 뒤에
//     getBoundingClientRect 로 크기를 재며, 화면 폭 ≤1040px 이면 clientX/clientY 를 **무시**하고
//     화면 상단 중앙(top:12px)에 붙인다.
//   → 통합하면 폰에서 블록 옆에 뜨던 팝업이 화면 꼭대기로 날아가고, 한 프레임 깜빡인다.
//     둘 다 document.body 포털이라 골든 테스트가 이 회귀를 잡지 못한다.
//
// ⚠ 다만 '바깥 클릭으로 닫기'(원본 1766-1773)는 quickPicker 쪽(1815-1827)과 **글자 단위로 같은 코드**라
//   ui/popup.js 의 bindOutsideClose 를 그대로 쓴다. setTimeout 0 등록 · pointerdown · 비캡처 ·
//   '실제로 닫았을 때만 리스너 해제'(= 죽은 리스너가 쌓이는 오늘의 누수)까지 동일하다.

import { CLS } from './domContract.js';
import { bindOutsideClose } from './popup.js';

/** 팝업 배치에 쓰는 가정 크기. 실제로 재지 않는다(원본 1759). */
const POPUP_W = 140;
const POPUP_H = 100;
/** 화면 가장자리 여백(원본 1760-1761). */
const EDGE_GAP = 8;
/** 커서 아래로 내리는 양(원본 1761). */
const CURSOR_DROP = 6;

/**
 * @typedef {object} RoutineActionPopupDeps
 * @property {{
 *   openRoutineEditor: (routineId: string) => any,
 *   removeGroup: (groupId: string) => any
 * }} commands
 *   ⚠ removeGroup 은 원본 1753-1754 의 `removePlacementGroup(groupId, mainCtx); saveHistory();` 두 줄
 *     **전부**여야 한다. app/main 이
 *     `mergeDirty(boardCommands.removeGroup(store, { boardId: 'main', groupId }), historyCommands.commit(hist, 'main'))`
 *     로 묶어 넘긴다.
 * @property {(dirty: any) => void} render presenter(app/render.createRenderer)의 apply
 */

/**
 * 루틴 블록 액션 팝업을 만든다.
 *
 * @param {RoutineActionPopupDeps} deps
 * @returns {{ open(placement: any, clientX: number, clientY: number): void, close(): void, current(): HTMLElement|null }}
 */
export function createRoutineActionPopup(deps) {
  const { commands, render } = deps;

  /** 지금 떠 있는 팝업. 원본 1719 의 모듈 변수 routineActionPopupEl 이다. @type {HTMLElement|null} */
  let popupEl = null;

  /** 원본 closeRoutineActionPopup(1721-1724). 두 번 불러도 안전하다. */
  function close() {
    if (popupEl) { popupEl.remove(); popupEl = null; }
  }

  /**
   * 원본 showRoutineActionPopup(1725-1774).
   * ⚠ 만드는 순서(제목 → ✏편집 → ×삭제 → body 부착 → 위치 → 바깥클릭 등록)가 원문 그대로다.
   *
   * @param {{ name: string, groupId: string, routineId?: string }} placement 눌린 루틴 블록의 배치 값
   * @param {number} clientX
   * @param {number} clientY
   */
  function open(placement, clientX, clientY) {
    close();                                                        // 1726
    const popup = document.createElement('div');
    popup.className = CLS.routineActionPopup;                        // 1728
    popupEl = popup;                                                 // 1729

    const title = document.createElement('div');
    title.className = CLS.rapTitle;                                  // 1732
    title.textContent = placement.name;                              // 1733 — textContent 다(escapeHtml 아님)
    popup.appendChild(title);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✏ 편집';                                  // 1738
    editBtn.addEventListener('click', () => {
      close();                                                       // 1740 — 먼저 닫는다
      if (placement.routineId) render(commands.openRoutineEditor(placement.routineId));  // 1741
    });
    popup.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = CLS.danger;                                   // 1747
    delBtn.textContent = '× 삭제';                                   // 1748
    // ⚠ 여기에는 confirmOnce 가 없다(원본 1749-1753). 한 번 누르면 바로 지워진다 — 오늘 동작이다.
    delBtn.addEventListener('click', () => {
      close();                                                       // 1750
      render(commands.removeGroup(placement.groupId));               // 1751-1752
    });
    popup.appendChild(delBtn);

    document.body.appendChild(popup);                                // 1756

    // 팝업 위치 계산 — 크기를 재지 않고 상수 140×100 으로 화면 안쪽으로만 민다(1758-1763).
    const x = Math.min(clientX, window.innerWidth - POPUP_W - EDGE_GAP);
    const y = Math.min(clientY + CURSOR_DROP, window.innerHeight - POPUP_H - EDGE_GAP);
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    // 1766-1773. 게터를 넘겨야 한다 — 원본이 모듈 변수 routineActionPopupEl 을 매번 다시 읽는다.
    bindOutsideClose(() => popupEl, close);
  }

  return {
    open,
    close,
    /** 테스트·디버그용. 지금 떠 있는 팝업 요소(없으면 null). */
    current() { return popupEl; }
  };
}
