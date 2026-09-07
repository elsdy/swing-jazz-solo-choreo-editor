// src/ui/popup.js — 팝업 공통 부품 (ui 계층)
//
// 원본 index.html 의 positionPopup(1781-1806) · qDivider(1829-1833) · qLabel(1835-1840) ·
// 바깥 클릭 닫기 등록 2곳(1815-1827 · 4906-4915)을 옮겼다.
//
// ⚠ ui/routineActionPopup 은 이 파일을 쓰지 않는다. 원본 showRoutineActionPopup(1758-1763)은
//   rAF 없이 동기로 `min(clientX, W-148)` / `min(clientY+6, H-108)` 에 놓고 모바일 분기가 아예 없다.
//   positionPopup 으로 통합하면 폰에서 탭한 블록 옆에 뜨던 팝업이 화면 꼭대기로 날아가고 한 프레임 깜빡인다.
//
// ⚠ 이 파일은 아무것도 import 하지 않는다(매니페스트는 ./widgets.js 의존을 적었지만 실제로 쓸 일이 없다 —
//   qLabel 은 textContent 라 escapeHtml 이 필요 없다).

// ─────────────────────────────────────────────────────────────────────────────
// 배치
// ─────────────────────────────────────────────────────────────────────────────

/** 모바일(=사이드바가 위로 접히는) 분기의 기준 너비. 원본 1788 의 `W <= 1040`. */
export const POPUP_MOBILE_MAX_WIDTH = 1040;

/**
 * 팝업을 커서 옆(데스크톱) 또는 화면 상단 중앙(모바일)에 놓는다.
 *
 * ⚠⚠ **순서가 관찰 동작이다.** 먼저 left/top 을 '0px' 로 못박아 레이아웃을 만들고,
 *   `requestAnimationFrame` 한 프레임 뒤에 getBoundingClientRect 로 크기를 재서 최종 위치를 쓴다.
 *   rAF 를 빼고 동기로 재면 크기가 0 이라 팝업이 왼쪽 위에 붙는다.
 *   반대로 '0px' 초기화를 빼면 이전 위치가 남아 한 프레임 동안 엉뚱한 곳에 보인다.
 *
 * ⚠ 모바일 분기(W ≤ 1040)는 clientX/clientY 를 **아예 쓰지 않는다** — 화면 상단 중앙 고정이고
 *   `maxHeight` 까지 건다(`min(H*0.55, 420)`). 데스크톱 분기에는 maxHeight 를 걸지 않는다.
 * ⚠ 데스크톱은 커서에서 +12px 로 시작해 오른쪽/아래로 넘치면 커서 반대편으로 뒤집고,
 *   마지막에 `Math.max(8, …)` 로 왼쪽/위 가장자리를 막는다. 세 단계 모두 원문 그대로다.
 *
 * @see index.html:1781
 * @param {HTMLElement} popup 이미 document.body 에 붙어 있어야 한다(크기를 재야 하므로)
 * @param {number} clientX
 * @param {number} clientY
 * @returns {void}
 */
export function positionPopup(popup, clientX, clientY) {
  popup.style.left = '0px';
  popup.style.top = '0px';
  // allow layout so getBoundingClientRect has dimensions
  requestAnimationFrame(() => {
    const rect = popup.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    const isMobile = W <= POPUP_MOBILE_MAX_WIDTH;

    if (isMobile) {
      // 모바일: 사이드바 영역(상단) 중앙에 표시
      const popW = Math.min(rect.width, W - 24);
      const left = Math.max(12, (W - popW) / 2);
      popup.style.left = `${left}px`;
      popup.style.top = '12px';
      popup.style.maxHeight = `${Math.min(H * 0.55, 420)}px`;
    } else {
      let left = clientX + 12;
      let top  = clientY + 12;
      if (left + rect.width  > W - 12) left = clientX - rect.width  - 12;
      if (top  + rect.height > H - 12) top  = clientY - rect.height - 12;
      popup.style.left = `${Math.max(8, left)}px`;
      popup.style.top  = `${Math.max(8, top)}px`;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 팝업 안의 작은 조각
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팝업 안의 가로 구분선.
 * @see index.html:1829
 * @returns {HTMLDivElement}
 */
export function qDivider() {
  const d = document.createElement('div');
  d.className = 'quick-popup-divider';
  return d;
}

/**
 * 팝업 안의 작은 제목 줄. ⚠ textContent 라 이스케이프가 필요 없다(escapeHtml 을 덧붙이면 문자가 새어 보인다).
 * @see index.html:1835
 * @param {string} text
 * @returns {HTMLDivElement}
 */
export function qLabel(text) {
  const l = document.createElement('div');
  l.className = 'quick-popup-title';
  l.textContent = text;
  return l;
}

// ─────────────────────────────────────────────────────────────────────────────
// 바깥 클릭으로 닫기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팝업 바깥을 눌렀을 때 닫는 리스너를 document 에 건다. 원본 1815-1827 · 4906-4915 의 두 벌이 하나다.
 *
 * ⚠⚠ 옮길 때 지켜야 하는 것 넷:
 *   1. `setTimeout(…, 0)` 으로 **다음 틱에** 등록한다. 지금 처리 중인 클릭이 곧바로 자기를 닫는 것을 막는 장치다.
 *   2. 이벤트는 `pointerdown` 이다(click 이 아니다). document 에 붙고 캡처가 아니다.
 *   3. 팝업 요소는 **호출 시점에 캡처하지 않고 getEl() 로 매번 다시 읽는다.**
 *      원본이 클로저 밖의 모듈 변수 `quickPickerEl` / `reQuickPickerEl` 를 읽는 것과 같아야 한다 —
 *      값을 캡처하면 팝업이 화면을 바꿔 끼울 때(화면1→화면2) 옛 요소를 보게 된다.
 *   4. **리스너는 자기가 실제로 닫았을 때만 해제된다**(원본 1822). getEl() 이 null 이면
 *      — 다른 경로로 이미 닫힌 경우 — 리스너가 document 에 영원히 남는다. 오늘의 누수를 그대로 옮긴 것이니
 *      finally 나 once:true 로 '고치지' 마라. 팝업을 여닫을 때마다 죽은 리스너가 한 개씩 쌓인다.
 *
 * @see index.html:1815
 * @param {() => (HTMLElement|null|undefined)} getEl 지금 열려 있는 팝업 요소를 돌려주는 게터
 * @param {() => void} onOutside 바깥을 눌렀을 때 할 일(대개 close 함수)
 * @returns {void}
 */
export function bindOutsideClose(getEl, onOutside) {
  setTimeout(() => {
    function outsideClose(e) {
      const el = getEl();
      if (el && !el.contains(e.target)) {
        onOutside();
        document.removeEventListener('pointerdown', outsideClose);
      }
    }
    document.addEventListener('pointerdown', outsideClose);
  }, 0);
}
