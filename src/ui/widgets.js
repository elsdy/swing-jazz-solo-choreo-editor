// src/ui/widgets.js — 여러 뷰가 함께 쓰는 작은 UI 조각 (ui 계층)
//
// 원본 index.html 의 escapeHtml(2268-2276) · confirmOnce(1700-1714) ·
// makeInlineStarBtn(1984-1997) · 손으로 재구현한 ★ 버튼 3벌(3022-3039 · 3146-3159 · 4726-4731) ·
// CSS.escape 사용/미사용 4곳(2462 · 3745 · 3893 · 4536)을 옮겼다.
//
// ⚠ confirmOnce 는 **포트가 아니다.** btn.dataset·btn.textContent·setTimeout 을 직접 만지는 UI 위젯이고
//   호출부 8곳(2361 · 3013 · 3135 · 3279 · 4277 · 4303 · 4331 · 4747)이 전부 뷰다.
//   adapters/browser.browserDialogs.confirm 으로 바꾸지 마라 — 오늘 window.confirm 호출은 0곳이고,
//   확인 UX 는 버튼 라벨을 2초간 '정말요?' 로 바꾸는 방식이다(모달이 뜨지 않는다).
//
// ⚠ 이 파일은 아무것도 import 하지 않는다. ui 계층이므로 타이머·DOM 을 써도 된다
//   (tools/check-arch.mjs 의 순수성 검사는 domain/ports/usecases 에만 걸린다).

// ─────────────────────────────────────────────────────────────────────────────
// 이스케이프
// ─────────────────────────────────────────────────────────────────────────────

/**
 * innerHTML 에 넣을 문자열을 이스케이프한다.
 * ⚠ 치환 표와 **순서**가 원문 그대로다. `&` 를 먼저 바꾸지 않으면 이중 이스케이프가 난다.
 * ⚠ `'` 는 `&#39;`(숫자 참조)다 — `&apos;` 로 바꾸면 저장 파일이 아니라 화면 문자열이 달라진다.
 * @see index.html:2268
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 셀렉터 안에 넣을 값을 이스케이프한다. CSS.escape 가 없는 환경(테스트용 DOM 스텁)에서는 원문 그대로.
 *
 * ⚠ 원본은 같은 셀렉터를 만드는 4곳 중 **2곳만**(3745 · 3893) CSS.escape 를 썼고
 *   나머지 2곳(2462 · 4536)은 쓰지 않았다. 이 비대칭은 ui/domContract 의
 *   SEL.placementsOfGroup / SEL.placementsOfGroupRaw 두 함수로 보존돼 있다.
 *   groupId 는 uid() 가 만든 base36 문자열이고 따옴표 안의 속성값이라 두 형태가 같은 노드에 매칭된다.
 * @see index.html:3745
 * @param {unknown} value
 * @returns {string}
 */
export function cssEscape(value) {
  const text = String(value);
  return (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(text) : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// confirmOnce — 버튼 라벨을 2초간 '정말요?' 로 바꾸는 2단계 확인
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 같은 버튼을 2초 안에 두 번 누르면 fn 을 실행한다. 모달을 띄우지 않는다.
 *
 * 동작(원문 그대로):
 *   1차 클릭 → `btn.dataset.pendingConfirm = '1'`, `btn.textContent = '정말요?'`,
 *              2000ms 뒤 라벨을 label 로 되돌리고 dataset 을 지우는 타이머를 `btn._confirmTimer` 에 건다.
 *   2차 클릭 → 타이머를 지우고 dataset 을 지우고 라벨을 label 로 되돌린 **뒤** fn() 을 부른다.
 *
 * ⚠ 보존해야 하는 것들:
 *   - 타이머 핸들을 버튼 객체의 `_confirmTimer` 필드에 담는다(원문 1710). WeakMap 으로 바꾸지 마라 —
 *     호출부가 같은 버튼을 다시 만들 때의 동작(새 버튼 = 새 필드 = 확인 상태 없음)이 여기서 나온다.
 *   - `delete btn.dataset.pendingConfirm` 이지 `= '0'` 이 아니다. CSS 가 보진 않지만 속성 자체가 사라진다.
 *   - fn() 은 라벨 복원 **뒤에** 불린다. fn 이 목록을 다시 그려 버튼을 없애도 문제가 없는 순서다.
 *   - 2초는 상수다(원문 1713).
 *
 * 호출부 8곳: 2361(전체 초기화) · 3013(카테고리 삭제) · 3135(동작 삭제) · 3279(컨텍스트 메뉴 삭제) ·
 *            4277 · 4303 · 4331(저장 목록 삭제 3벌) · 4747(루틴 삭제)
 *
 * @see index.html:1700
 * @param {HTMLElement & { _confirmTimer?: ReturnType<typeof setTimeout> }} btn 라벨을 바꿀 버튼 자신
 * @param {string} label 되돌릴 원래 라벨 ('×' · '삭제' · '전체 초기화')
 * @param {() => void} fn 2차 클릭에서 실행할 일
 * @returns {void}
 */
export function confirmOnce(btn, label, fn) {
  if (btn.dataset.pendingConfirm === '1') {
    clearTimeout(btn._confirmTimer);
    delete btn.dataset.pendingConfirm;
    btn.textContent = label;
    fn();
    return;
  }
  btn.dataset.pendingConfirm = '1';
  btn.textContent = '정말요?';
  btn._confirmTimer = setTimeout(() => {
    delete btn.dataset.pendingConfirm;
    btn.textContent = label;
  }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 즐겨찾기 토글 버튼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인라인 ★ 버튼. 원본에 같은 버튼이 4벌 있었다(1984 를 두고도 3022 · 3146 · 4726 이 손으로 재구현).
 * 네 벌의 **차이가 옵션 3개**로 남아 있으니 호출부는 아래 표대로 정확히 넘겨라.
 *
 * | 호출부 | title | stopPropagation | toggleClass | 갱신 방식 |
 * |---|---|---|---|---|
 * | 퀵피커 항목 1984-1997 | (없음) | true | true | 팝업을 다시 그리지 않고 자기 클래스만 토글 |
 * | 카테고리 관리 3022-3039 | '즐겨찾기 (빠른 배치에 표시)' | **false** | **false** | renderCategoryOptions 재렌더 |
 * | 팔레트 카드 3146-3159 | '즐겨찾기 (빠른 배치에 표시)' | **false** | **false** | renderPalette 재렌더 |
 * | 루틴 카드 4726-4731 | '즐겨찾기' | true | **false** | toggleRoutineFavorite 재렌더 |
 *
 * ⚠ 기본값은 **퀵피커 판**(1984)이다 — 원본 함수의 동작을 기본으로 둔 것이다.
 * ⚠ 실행 순서도 원문 그대로: `nowFav` 계산 → `onToggle(nowFav)` → 클래스 토글.
 *   onToggle 이 목록을 다시 그려 이 버튼이 떨어져 나가도 마지막 토글은 무해하다(분리된 노드).
 * ⚠ 클래스 문자열은 `'star-btn' + (isActive() ? ' active' : '')` 다 — 공백 포함, 순서 포함.
 *
 * @see index.html:1984
 * @param {() => boolean} isActive 지금 즐겨찾기인지. **클릭 시점에 다시 불린다**(값을 캡처하지 않는다)
 * @param {(nowFav: boolean) => void} onToggle 새 상태를 받아 실제 전이를 수행
 * @param {{ title?: string|null, stopPropagation?: boolean, toggleClass?: boolean }} [options]
 * @returns {HTMLButtonElement}
 */
export function makeInlineStarBtn(isActive, onToggle, options = {}) {
  const { title = null, stopPropagation = true, toggleClass = true } = options;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'star-btn' + (isActive() ? ' active' : '');
  btn.textContent = '★';
  if (title != null) btn.title = title;
  btn.addEventListener('click', (e) => {
    if (stopPropagation) e.stopPropagation();
    const nowFav = !isActive();
    onToggle(nowFav);
    if (toggleClass) btn.classList.toggle('active', nowFav);
  });
  return btn;
}
