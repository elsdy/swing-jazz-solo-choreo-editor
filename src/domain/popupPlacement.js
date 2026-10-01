// src/domain/popupPlacement.js — 떠 있는 창을 어디에 놓을지 정하는 산술 (RM-08, 2026-10-01)
//
// 팝업 넷이 저마다 다른 식으로 자리를 잡는다. 식을 화면 코드에서 떼어 여기 모았을 뿐 **합치지 않았다**.
// 넷은 일부러 다르다 — 합치면 폰에서 누른 블록 옆에 뜨던 창이 화면 꼭대기로 날아간다(ui/routineActionPopup 머리말).
//
//   함수                        누가 부르나                   크기         커서와의 거리   가장자리 막기
//   ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   placeCursorPopup            ui/popup.positionPopup        잰다(rAF 뒤)  +12, 넘치면 반대편   왼·위 8 / 폭 ≤1040 은 위 가운데
//   placePlacementActionPopup   ui/placementActionPopup       160×132 가정  아래 10             네 변 모두 8
//   placeRoutineActionPopup     ui/routineActionPopup         140×100 가정  아래 6              오른·아래만 8 — 왼·위는 막지 않는다
//   placeContextMenu            ui/paletteView 동작 메뉴      잰다(동기)    커서 그 자리        네 변 모두 12
//
// 크기를 재는 일(getBoundingClientRect)과 '0px' 로 먼저 못박고 한 프레임 기다리는 순서는 화면 쪽에 남는다.
// 여기는 잰 값과 창 크기를 받아 숫자만 돌려준다. 단위(px)를 붙이는 것도 화면 쪽이다.

/** 폭이 이 값 이하면 커서 팝업이 커서를 버리고 화면 위 가운데에 뜬다. 원본 1788 의 `W <= 1040`. */
export const POPUP_MOBILE_MAX_WIDTH = 1040;

/**
 * 커서 옆 팝업(빠른 배치 팝업 등). 원본 positionPopup(1781-1806)의 산술.
 *
 * ⚠ 폭 ≤1040 은 clientX/clientY 를 **쓰지 않는다** — 위 가운데 고정이고 maxHeight 까지 건다.
 *   그 밖의 폭에는 maxHeight 가 없다(null). 호출부는 null 이면 스타일을 건드리지 않는다.
 * ⚠ 데스크톱은 +12 에서 시작해 넘치면 커서 반대편으로 뒤집고, 마지막에 왼·위만 8 로 막는다.
 *   오른·아래는 뒤집은 뒤 다시 막지 않는다 — 창보다 큰 팝업은 오른쪽·아래로 넘친다.
 *
 * @param {{clientX:number, clientY:number, width:number, height:number, viewW:number, viewH:number}} a
 * @returns {{left:number, top:number, maxHeight:number|null}}
 */
export function placeCursorPopup({ clientX, clientY, width, height, viewW, viewH }) {
  if (viewW <= POPUP_MOBILE_MAX_WIDTH) {
    const popW = Math.min(width, viewW - 24);
    return { left: Math.max(12, (viewW - popW) / 2), top: 12, maxHeight: Math.min(viewH * 0.55, 420) };
  }
  let left = clientX + 12;
  let top = clientY + 12;
  if (left + width > viewW - 12) left = clientX - width - 12;
  if (top + height > viewH - 12) top = clientY - height - 12;
  return { left: Math.max(8, left), top: Math.max(8, top), maxHeight: null };
}

/** 블록 동작 팝업의 가정 크기와 여백(2026-09-21). 재지 않는다. */
export const PLACEMENT_ACTION_POPUP = Object.freeze({ width: 160, height: 132, gap: 8, drop: 10 });

/**
 * 블록 동작 팝업(터치 폭에서 블록을 탭하면 뜨는 것). 네 변을 모두 막는다.
 * @param {{clientX:number, clientY:number, viewW:number, viewH:number}} a
 * @returns {{left:number, top:number}}
 */
export function placePlacementActionPopup({ clientX, clientY, viewW, viewH }) {
  const { width, height, gap, drop } = PLACEMENT_ACTION_POPUP;
  return {
    left: Math.max(gap, Math.min(clientX, viewW - width - gap)),
    top: Math.max(gap, Math.min(clientY + drop, viewH - height - gap)),
  };
}

/** 루틴 블록 팝업의 가정 크기와 여백(원본 1759-1761). 재지 않는다. */
export const ROUTINE_ACTION_POPUP = Object.freeze({ width: 140, height: 100, gap: 8, drop: 6 });

/**
 * 루틴 블록 팝업. 원본 showRoutineActionPopup(1758-1763)의 산술.
 *
 * ⚠ 오른쪽·아래로 넘치는 것만 막는다. **왼쪽·위는 막지 않는다** — 창이 140+8 보다 좁으면 left 가
 *   음수가 되어 팝업이 화면 왼쪽 밖으로 나간다. 형제인 블록 동작 팝업은 막는다. 오늘 동작이라 그대로 둔다
 *   (docs/deviations.md 「터치와 마우스의 불일치」).
 *
 * @param {{clientX:number, clientY:number, viewW:number, viewH:number}} a
 * @returns {{left:number, top:number}}
 */
export function placeRoutineActionPopup({ clientX, clientY, viewW, viewH }) {
  const { width, height, gap, drop } = ROUTINE_ACTION_POPUP;
  return {
    left: Math.min(clientX, viewW - width - gap),
    top: Math.min(clientY + drop, viewH - height - gap),
  };
}

/**
 * 동작 목록의 동작 메뉴(우클릭·롱프레스). 커서 자리에 그대로 두고 네 변을 12 로 막는다.
 * ⚠ 창보다 큰 메뉴는 왼·위 12 가 이긴다(바깥 Math.max 가 나중이다).
 * @param {{x:number, y:number, width:number, height:number, viewW:number, viewH:number}} a
 * @returns {{left:number, top:number}}
 */
export function placeContextMenu({ x, y, width, height, viewW, viewH }) {
  return {
    left: Math.max(12, Math.min(x, viewW - width - 12)),
    top: Math.max(12, Math.min(y, viewH - height - 12)),
  };
}
