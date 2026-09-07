// src/ui/overlays.js — 보드 위 "비영속" DOM 전부 (ui 계층)
//
// 원본 index.html 에서 옮긴 것:
//   floatingTip/_tooltipTarget/resizeCountBadge 싱글턴(2776-2785)
//   showResizeCountBadge(2787-2793) · hideResizeCountBadge(2794-2796)
//   showFloatingTooltip(2797-2807) · hideFloatingTooltip(2808-2812)
//   applyResizePreview 의 DOM 부(3803-3821) · clearResizePreview(3824-3826)
//   markDraggingGroup(3892-3894) · unmarkDraggingGroups(3896-3898)
//   startResize/stopMouseResize 의 is-resizing 부착·해제(3745-3747 · 3771)
//   updatePreview 의 DOM 부(3905-3920) · clearPreview(3923-3925) · clearTrackHighlights(3927-3929)
//   터치 고스트 2벌(3841-3852 · 3859-3860 / 3937-3941 · 3978-3979 · 3985-3988)
//
// ⚠⚠ **여기에는 카운트 결정 로직이 한 줄도 없다.** 세그먼트 배열과 표시할 숫자를 받아 그리는
//   순수 렌더러다. 카운트 계산은 domain/gestureMath 와 input/** 의 몫이다.
//
// ⚠⚠ **store 를 통과하지 않는다.** 드래그 중 60fps 로 움직이는 것을 상태 전이로 만들면
//   히스토리와 렌더가 오염되고, 커밋 901e1d1(리사이즈 중 DOM 재생성이 터치 시퀀스를 끊음)이 되살아난다.
//   커밋은 제스처가 끝날 때 딱 한 번 유스케이스로 들어간다.
//
// ⚠ 이 파일은 domContract 만 import 한다. rowRefs 는 ui/boardView 가 소유하므로 **주입**받는다.

import { SEL, CLS, DATA } from './domContract.js';

/** 배치 터치 이동 고스트의 엘리먼트 id. 원본 3843. */
const PLACEMENT_GHOST_ID = 'touchPlacementGhost';
/** 팔레트 칩 터치 드래그 고스트의 엘리먼트 id. 원본 3939. */
const PALETTE_GHOST_ID = 'touchGhost';

/** 플로팅 툴팁의 인라인 스타일. 원본 2778 의 cssText 를 **글자 그대로** 옮겼다. */
const FLOATING_TIP_CSS = 'display:none;position:fixed;background:rgba(0,0,0,.85);color:#fff;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;white-space:nowrap;z-index:9999;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3);';

// ─────────────────────────────────────────────────────────────────────────────
// body 포털 싱글턴 — 툴팁과 리사이즈 카운트 배지
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 원본에서 이 둘은 **모듈 로드 시** document.body 에 붙는 싱글턴이었다(2776-2785).
 * 두 보드가 같은 하나를 공유하므로 여기서도 앱 전체에 하나만 만든다.
 * ⚠ 이미 body 에 있으면 다시 만들지 않고 재사용한다 — createOverlays 를 두 번 불러도(메인/루틴)
 *   툴팁이 두 개가 되지 않는다.
 * @type {{ tip: HTMLElement, badge: HTMLElement, target: HTMLElement|null }|null}
 */
let bodySingletons = null;

/**
 * 툴팁·배지 싱글턴을 확보한다(없으면 만들어 body 에 붙인다).
 * @returns {{ tip: HTMLElement, badge: HTMLElement, target: HTMLElement|null }}
 */
export function ensureOverlaySingletons() {
  if (bodySingletons) return bodySingletons;
  let tip = document.querySelector(SEL.floatingTooltip);
  if (!tip) {
    tip = document.createElement('div');
    tip.className = CLS.floatingTooltip;
    // ⚠ .floating-tooltip 은 CSS 규칙이 아예 없다 — 스타일이 전부 이 한 줄이다(원본 2778).
    tip.style.cssText = FLOATING_TIP_CSS;
    document.body.appendChild(tip);
  }
  let badge = document.querySelector(`.${CLS.resizeCountBadge}`);
  if (!badge) {
    badge = document.createElement('div');
    badge.className = CLS.resizeCountBadge;
    document.body.appendChild(badge);
  }
  bodySingletons = { tip, badge, target: null };
  return bodySingletons;
}

/** 테스트용. 앱 코드에서는 부르지 마라. */
export function _resetOverlaySingletons() {
  bodySingletons = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 팩토리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 보드 1개분 오버레이 렌더러.
 *
 * @param {Object} options
 * @param {HTMLElement} options.el 보드 루트(#board / #reBoard). 원본 ctx.el
 * @param {Map<number, {track: HTMLElement}>|(() => Map<number, {track: HTMLElement}>)} options.rowRefs
 *   ui/boardView 인스턴스의 rowRefs. **app/main 이 주입한다**(overlays 는 boardView 를 import 하지 않는다).
 *   Map 은 rowRefs.clear() 로 재사용되므로 참조를 그대로 들고 있어도 안전하다.
 * @param {'main'|'routine'} [options.boardId]
 * @returns {ReturnType<typeof buildOverlays>}
 */
export function createOverlays(options) {
  const { el, rowRefs, boardId } = options || {};
  if (!el) throw new TypeError('createOverlays: el 이 필요하다');
  return buildOverlays(el, rowRefs, boardId);
}

/**
 * @param {HTMLElement} el
 * @param {Map|Function} rowRefsOrGetter
 * @param {string|undefined} boardId
 */
function buildOverlays(el, rowRefsOrGetter, boardId) {
  const refs = () => (typeof rowRefsOrGetter === 'function' ? rowRefsOrGetter() : rowRefsOrGetter) || new Map();

  // ───────────────────────────────────────────────────────────────────────────
  // 배치 프리뷰 — 드래그/그리기 중의 점선 블록과 스냅 표시
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 배치 프리뷰를 그린다. 원본 updatePreview(3900-3921)의 DOM 부분이다.
   *
   * ⚠ 원본은 **그리기 전에 언제나 먼저 지운다**(3901). 그래서 여기서도 clearPreview 로 시작한다.
   * ⚠ 카운트를 정할 수 없어 아무것도 그리지 않는 경우(원본 3902 의 조기 반환)에는
   *   이 함수 대신 `clearPreview()` 만 불러라 — 원본은 그리든 안 그리든 먼저 지운다.
   * ⚠ 첫 세그먼트에만 `${previewCount}c` 를 쓰고 나머지는 빈 문자열이다(3918).
   * ⚠ 한 세그먼트마다 노드가 **둘**이다: `.snap-indicator`(-1px)와 `.preview-block`(+4px/-8px).
   *   둘 다 `data-preview="1"` 이라 clearPreview 한 번에 사라진다.
   *
   * @see index.html:3900
   * @param {{row:number, startIndex:number, length:number}[]} segments domain/grid.buildSegments 의 결과
   * @param {number} previewCount 첫 블록에 적을 카운트
   * @returns {void}
   */
  function showPreview(segments, previewCount) {
    clearPreview();
    const rowRefs = refs();
    (segments || []).forEach((seg, index) => {
      const ref = rowRefs.get(seg.row);
      if (!ref) return;
      const snap = document.createElement('div');
      snap.className = CLS.snapIndicator;
      snap.dataset[DATA.preview] = DATA.FLAG_ON;
      snap.style.left = `calc(${seg.startIndex} * var(--cellW) - 1px)`;
      ref.track.appendChild(snap);
      const block = document.createElement('div');
      block.className = CLS.previewBlock;
      block.dataset[DATA.preview] = DATA.FLAG_ON;
      block.style.left = `calc(${seg.startIndex} * var(--cellW) + 4px)`;
      block.style.width = `calc(${seg.length} * var(--cellW) - 8px)`;
      block.textContent = index === 0 ? `${previewCount}c` : '';
      ref.track.appendChild(block);
    });
  }

  /**
   * 배치 프리뷰를 전부 지운다.
   * @see index.html:3923
   * @returns {void}
   */
  function clearPreview() {
    el.querySelectorAll(SEL.previewNodes).forEach(node => node.remove());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 리사이즈 프리뷰
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 리사이즈 프리뷰를 그리고 카운트 배지를 첫 블록 위에 띄운다.
   * 원본 applyResizePreview(3803-3821)의 DOM 부분이다.
   *
   * ⚠ 클래스가 **두 개**다: `'preview-block resize-preview-block'`(3810). 앞의 것이 모양,
   *   뒤의 것이 색·점선 차이를 준다. 하나만 붙이면 화면이 달라진다.
   * ⚠ 표식은 `data-resize-preview="1"` 이라 배치 프리뷰(`data-preview`)와 **따로** 지워진다.
   *   두 프리뷰가 동시에 떠 있을 수 있다는 뜻이고, 그게 오늘 동작이다.
   * ⚠ 배지는 첫 블록이 실제로 만들어졌을 때만 뜬다(3819) — 시작 행이 화면에 없으면 배지도 없다.
   *
   * @see index.html:3803
   * @param {{row:number, startIndex:number, length:number}[]} segments
   * @param {number} previewCount
   * @returns {HTMLElement|null} 첫 블록(배지를 붙인 곳). 만들지 못했으면 null
   */
  function showResizePreview(segments, previewCount) {
    clearResizePreview();
    const rowRefs = refs();
    let firstBlock = null;
    (segments || []).forEach((seg, index) => {
      const ref = rowRefs.get(seg.row);
      if (!ref) return;
      const block = document.createElement('div');
      block.className = `${CLS.previewBlock} ${CLS.resizePreviewBlock}`;
      block.dataset[DATA.resizePreview] = DATA.FLAG_ON;
      block.style.left = `calc(${seg.startIndex} * var(--cellW) + 4px)`;
      block.style.width = `calc(${seg.length} * var(--cellW) - 8px)`;
      block.textContent = index === 0 ? `${previewCount}c` : '';
      ref.track.appendChild(block);
      if (index === 0) firstBlock = block;
    });
    // 카운트 배지를 프리뷰 블록 위에 표시
    if (firstBlock) showResizeCountBadge(firstBlock, previewCount);
    return firstBlock;
  }

  /**
   * 리사이즈 프리뷰만 지운다(배치 프리뷰는 건드리지 않는다).
   * @see index.html:3824
   * @returns {void}
   */
  function clearResizePreview() {
    el.querySelectorAll(SEL.resizePreviewNodes).forEach(node => node.remove());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 리사이즈 카운트 배지 (body 포털 싱글턴)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 어떤 엘리먼트 위쪽 가운데에 `${count}c` 배지를 띄운다.
   * ⚠ 좌표는 `position:fixed` 기준이라 스크롤하면 어긋난다 — 원본 그대로다(재계산하지 않는다).
   * ⚠ 호출부는 둘이다: 리사이즈 시작 시 실제 배치 엘리먼트(3749), 이후에는 프리뷰 첫 블록(3820).
   * @see index.html:2787
   * @param {HTMLElement} anchorEl
   * @param {number} count
   * @returns {void}
   */
  function showResizeCountBadge(anchorEl, count) {
    const { badge } = ensureOverlaySingletons();
    badge.textContent = `${count}c`;
    badge.style.display = 'block';
    const rect = anchorEl.getBoundingClientRect();
    badge.style.left = Math.round(rect.left + rect.width / 2) + 'px';
    badge.style.top = Math.round(rect.top - 8) + 'px';
  }

  /**
   * @see index.html:2794
   * @returns {void}
   */
  function hideResizeCountBadge() {
    const { badge } = ensureOverlaySingletons();
    badge.style.display = 'none';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 플로팅 툴팁 (body 포털 싱글턴)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 배치 위에 이름+카운트 툴팁을 띄운다.
   *
   * ⚠ 문구는 배치 안의 `.tooltip` textContent 를 그대로 쓰고, 없으면 `data-name` 으로 떨어진다(2799).
   * ⚠ **순서가 이상하지만 그대로다**: target 을 먼저 대입하고(2800) 나서 body 에 붙어 있는지 검사한다(2801).
   *   그래서 떨어져 나간 노드를 넘기면 target 이 잠깐 그 노드였다가 hideFloatingTooltip 이 null 로 되돌린다.
   * ⚠ transform 은 show 에서 걸고 hide 에서 **빈 문자열로 되돌린다**(2810).
   *
   * @see index.html:2797
   * @param {HTMLElement} placementEl
   * @returns {void}
   */
  function showFloatingTooltip(placementEl) {
    const s = ensureOverlaySingletons();
    const tip = placementEl.querySelector(SEL.tooltip);
    s.tip.textContent = tip ? tip.textContent : (placementEl.dataset[DATA.name] || '');
    s.target = placementEl;
    if (!document.body.contains(s.target)) { hideFloatingTooltip(); return; }
    const rect = s.target.getBoundingClientRect();
    s.tip.style.display = 'block';
    s.tip.style.left = Math.round(rect.left + rect.width / 2) + 'px';
    s.tip.style.top = Math.round(rect.top - 8) + 'px';
    s.tip.style.transform = 'translate(-50%, -100%)';
  }

  /**
   * @see index.html:2808
   * @returns {void}
   */
  function hideFloatingTooltip() {
    const s = ensureOverlaySingletons();
    s.tip.style.display = 'none';
    s.tip.style.transform = '';
    s.target = null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 상태 클래스 — is-dragging / is-resizing / drop-hover
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 한 그룹의 모든 세그먼트에 `.is-dragging` 을 붙인다.
   * ⚠ 셀렉터는 **CSS.escape 를 쓰는 쪽**(SEL.placementsOfGroup)이다 — 원본 3893 이 그렇다.
   *   선택 표시(boardView.setSelected)는 쓰지 않는 쪽이다. 통일하지 마라.
   * @see index.html:3892
   * @param {string} groupId
   * @returns {void}
   */
  function markDraggingGroup(groupId) {
    el.querySelectorAll(SEL.placementsOfGroup(groupId)).forEach(node => node.classList.add(CLS.isDragging));
  }

  /**
   * `.is-dragging` 을 이 보드에서 전부 뗀다.
   * @see index.html:3896
   * @returns {void}
   */
  function unmarkDraggingGroups() {
    el.querySelectorAll(SEL.placementDragging).forEach(node => node.classList.remove(CLS.isDragging));
  }

  /**
   * 리사이즈 시작 표시. ⚠ `is-dragging` 과 `is-resizing` 을 **함께** 붙인다(원본 3745-3747).
   * 떼는 것은 따로다 — stopMouseResize 가 is-resizing 만 먼저 떼고(3771) 나중에
   * unmarkDraggingGroups 로 is-dragging 을 뗀다(3773).
   * @see index.html:3745
   * @param {string} groupId
   * @returns {void}
   */
  function markResizingGroup(groupId) {
    el.querySelectorAll(SEL.placementsOfGroup(groupId)).forEach(node => {
      node.classList.add(CLS.isDragging, CLS.isResizing);
    });
  }

  /**
   * `.is-resizing` 만 뗀다(`.is-dragging` 은 남는다).
   * @see index.html:3771
   * @returns {void}
   */
  function clearResizingMarks() {
    el.querySelectorAll(SEL.placementResizing).forEach(node => node.classList.remove(CLS.isResizing));
  }

  /**
   * 이 그룹의 첫 `.placement` 엘리먼트. 리사이즈 세션이 liveEl/originTrack 을 잡을 때 쓴다(원본 3731).
   * input/pointerSession 은 ui 를 import 할 수 없으므로 이 메서드를 주입받아 쓴다.
   * @see index.html:3731
   * @param {string} groupId
   * @returns {HTMLElement|null}
   */
  function findGroupEl(groupId) {
    return el.querySelector(SEL.placementsOfGroup(groupId));
  }

  /**
   * 트랙에 드롭 하이라이트를 켠다.
   * @see index.html:2399
   * @param {HTMLElement|null|undefined} track
   * @returns {void}
   */
  function highlightTrack(track) {
    if (track) track.classList.add(CLS.dropHover);
  }

  /**
   * 트랙 하나의 드롭 하이라이트를 끈다(dragleave 경로, 원본 2408).
   * @see index.html:2408
   * @param {HTMLElement|null|undefined} track
   * @returns {void}
   */
  function unhighlightTrack(track) {
    if (track) track.classList.remove(CLS.dropHover);
  }

  /**
   * 이 보드의 모든 드롭 하이라이트를 끈다.
   * @see index.html:3927
   * @returns {void}
   */
  function clearTrackHighlights() {
    el.querySelectorAll(SEL.trackDropHover).forEach(track => track.classList.remove(CLS.dropHover));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 터치 드래그 고스트 — ⚠ 2벌은 같은 것이 아니다
  // ───────────────────────────────────────────────────────────────────────────
  //
  // | | 배치 이동(3841-3852) | 팔레트 칩(3937-3941) |
  // |---|---|---|
  // | id            | touchPlacementGhost | touchGhost |
  // | className     | `ghost-drag`        | `ghost-drag move-chip` |
  // | 인라인 스타일 | padding/borderRadius/background/color/fontWeight/boxShadow 6개 | background 1개 |
  // | textContent   | `이름 Nc`           | (없음 — CSS 가 칩 모양을 준다) |
  // | 지울 때       | remove 만(3875)     | clearTrackHighlights + remove(3985-3987) |
  //
  // 만드는 절차(createElement → 스타일 → body.appendChild → 좌표 갱신)만 같아서 그 부분을
  // spawnGhost 하나로 모으고, **다른 것은 옵션으로 갈랐다.** 합치면 화면이 달라진다.

  /**
   * @param {string} id
   * @param {string} className
   * @param {Record<string,string>} styles
   * @param {string|null} text
   * @returns {HTMLElement}
   */
  function spawnGhost(id, className, styles, text) {
    const ghost = document.createElement('div');
    ghost.className = className;
    ghost.id = id;
    Object.entries(styles).forEach(([key, value]) => { ghost.style[key] = value; });
    if (text != null) ghost.textContent = text;
    document.body.appendChild(ghost);
    return ghost;
  }

  /**
   * 보드 위 배치를 터치로 들었을 때의 고스트. 원본 3841-3852.
   * ⚠ background 결정(domain/categories.resolvePlacementColor 의 `base`)은 **호출부가 한다** —
   *   여기는 domain/categories 를 import 하지 않는다.
   * ⚠ 만든 뒤 곧바로 movePlacementGhost(x, y) 로 좌표를 잡는다(3852).
   * @see index.html:3841
   * @param {{ x:number, y:number, background:string, text:string }} spec
   * @returns {HTMLElement}
   */
  function showPlacementGhost(spec) {
    const ghost = spawnGhost(PLACEMENT_GHOST_ID, CLS.ghostDrag, {
      padding: '8px 12px',
      borderRadius: '12px',
      background: spec.background,
      color: '#08111f',
      fontWeight: '900',
      boxShadow: '0 8px 18px rgba(0,0,0,0.2)',
    }, spec.text);
    movePlacementGhost(spec.x, spec.y);
    return ghost;
  }

  /**
   * 배치 고스트를 옮긴다. **고스트 좌표만** 바꾼다 —
   * 원본 moveTouchPlacementGhost(3855-3869)의 나머지(제스처 상태 갱신·트랙 판정·프리뷰)는
   * input/touchDrag 가 clearTrackHighlights / highlightTrack / showPreview / clearPreview 를 조합해 만든다.
   * @see index.html:3859
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  function movePlacementGhost(x, y) {
    const ghost = document.getElementById(PLACEMENT_GHOST_ID);
    if (ghost) { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; }
  }

  /**
   * 배치 고스트를 없앤다. ⚠ 하이라이트는 **지우지 않는다** — 원본 3873 이 clearTrackHighlights 를
   * 따로 먼저 부르기 때문이다(팔레트 쪽과 다르다).
   * @see index.html:3875
   * @returns {void}
   */
  function hidePlacementGhost() {
    document.getElementById(PLACEMENT_GHOST_ID)?.remove();
  }

  /**
   * 팔레트 칩을 길게 눌러 끌 때의 고스트. 원본 3937-3941.
   * ⚠ 클래스가 `'ghost-drag move-chip'` 이고 인라인 스타일은 background 하나뿐이다.
   *   나머지 모양은 CSS 의 `.move-chip` 이 준다 — 배치 고스트와 섞지 마라.
   * ⚠ 텍스트가 없다(빈 칩).
   * @see index.html:3937
   * @param {{ x:number, y:number, background:string }} spec
   * @returns {HTMLElement}
   */
  function showPaletteGhost(spec) {
    const ghost = spawnGhost(PALETTE_GHOST_ID, `${CLS.ghostDrag} ${CLS.moveChip}`, {
      background: spec.background,
    }, null);
    movePaletteGhost(spec.x, spec.y);
    return ghost;
  }

  /**
   * 팔레트 고스트를 옮긴다. **고스트 좌표만** 바꾼다(원본 3978-3979).
   * 원본 moveTouchGhost 의 나머지(clearTrackHighlights + 트랙 하이라이트)는 호출부가 조합한다 —
   * ⚠ 이쪽은 배치 고스트와 달리 **프리뷰를 그리지 않는다**(3980-3982 에 updatePreview 가 없다).
   * @see index.html:3978
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  function movePaletteGhost(x, y) {
    const ghost = document.getElementById(PALETTE_GHOST_ID);
    if (ghost) { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; }
  }

  /**
   * 팔레트 고스트를 없앤다. ⚠ 원본 clearTouchGhost(3985-3987)는 **하이라이트를 먼저 지우고**
   * 고스트를 없앤다 — 배치 고스트 쪽과 다른 점이니 순서까지 그대로 둔다.
   * @see index.html:3985
   * @returns {void}
   */
  function hidePaletteGhost() {
    clearTrackHighlights();
    document.getElementById(PALETTE_GHOST_ID)?.remove();
  }

  return {
    el,
    boardId,
    // 배치 프리뷰
    showPreview,
    clearPreview,
    // 리사이즈 프리뷰
    showResizePreview,
    clearResizePreview,
    // 배지 · 툴팁 (body 포털 싱글턴)
    showResizeCountBadge,
    hideResizeCountBadge,
    showFloatingTooltip,
    hideFloatingTooltip,
    // 상태 클래스
    markDraggingGroup,
    unmarkDraggingGroups,
    markResizingGroup,
    clearResizingMarks,
    findGroupEl,
    highlightTrack,
    unhighlightTrack,
    clearTrackHighlights,
    // 고스트 (2벌 — 합치지 않았다)
    showPlacementGhost,
    movePlacementGhost,
    hidePlacementGhost,
    showPaletteGhost,
    movePaletteGhost,
    hidePaletteGhost,
  };
}
