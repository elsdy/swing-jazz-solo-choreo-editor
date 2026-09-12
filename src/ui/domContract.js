// src/ui/domContract.js — 셀렉터·클래스명·dataset 키 상수 (ui 계층의 공유 리프)
//
// 원본 index.html 에 흩어진 문자열 리터럴 40여 곳(2392-2560 · 3295-3446 · 3728-3930 · 5129-5205)을 모았다.
// 렌더가 만든 것을 컨트롤러가 closest() 로 되읽는 **암묵 계약**을 명시 API 로 만든 파일이다.
//
// ⚠ 이 파일은 아무것도 import 하지 않는다. 그리고 input/** 이 import 할 수 있는 유일한 ui 파일이다
//    (tools/check-arch.mjs 의 SAME_RANK_EXCEPTIONS).
//
// ⚠⚠ **값을 절대 바꾸지 마라.** 여기 있는 문자열은 index.html 의 CSS(7-1212)와 마크업(1214-1381)이
//     쓰는 것과 같은 문자열이고, CSS 는 이번 리팩터에서 한 줄도 바뀌지 않는다.
//     클래스명 하나만 달라져도 화면이 조용히 깨진다(에러가 나지 않는다).

// ─────────────────────────────────────────────────────────────────────────────
// CLS — 클래스명. 값은 CSS 셀렉터와 글자 단위로 같다.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Readonly<Record<string, string>>} */
export const CLS = Object.freeze({
  // ── 보드 골격 (buildBoardSkeleton 3295-3328) ──
  boardHeader: 'board-header',
  corner: 'corner',
  headerCells: 'header-cells',
  noteHeader: 'note-header',
  boardRow: 'board-row',
  rowLabel: 'row-label',
  track: 'track',
  trackSpacer: 'track-spacer',
  cellOverlay: 'cell-overlay',
  noteCell: 'note-cell',

  // ── 배치 블록 (createPlacementEl 3420-3444) ──
  placement: 'placement',
  tooltip: 'tooltip',
  moveHandle: 'move-handle',
  label: 'label',
  resizeHandle: 'resize-handle',

  // ── 배치 블록의 상태 클래스 ──
  isRoutine: 'is-routine',    // 3423 — 루틴 블록
  isPending: 'is-pending',    // 이름을 아직 안 붙인 블록(받아 적기, 2026-09-12). 점선 테두리에 `?`
  isSelected: 'is-selected',  // 3424 · 2463 · 4537 — 선택. ⚠ 메인 보드에만 붙는다
  isDragging: 'is-dragging',  // 3425 · 3746 · 3893
  isResizing: 'is-resizing',  // 3746 — is-dragging 과 **함께** 붙고 따로 떨어진다(3771)
  isPlaying: 'is-playing',    // 재생 위치가 지나가는 중인 블록. ⚠ ui/playhead 의 rAF 루프만 붙였다 뗀다(채널 B)

  // ── 트랙의 상태 클래스 ──
  dropHover: 'drop-hover',    // 2399 · 3864 · 3982
  drawHover: 'draw-hover',    // ⚠ CSS(384)에만 있고 JS 에서 붙이는 곳이 0곳이다 — 죽은 클래스

  // ── 보드 위 비영속 오버레이 (ui/overlays) ──
  previewBlock: 'preview-block',              // 3914 · 3810
  resizePreviewBlock: 'resize-preview-block', // 3810 — preview-block 과 **함께** 붙는다
  snapIndicator: 'snap-indicator',            // 3909
  floatingTooltip: 'floating-tooltip',        // 2777 — ⚠ CSS 규칙이 없다(전부 인라인 스타일)
  resizeCountBadge: 'resize-count-badge',     // 2783
  ghostDrag: 'ghost-drag',                    // 3842 · 3938 — 터치 드래그 고스트
  moveChip: 'move-chip',                      // 3075 · 3938 — 고스트는 'ghost-drag move-chip'

  // ── 팔레트 (renderPalette 3055-3181) ──
  moveCard: 'move-card',
  paletteActive: 'palette-active',  // 3066 — 활성 동작 카드
  moveMeta: 'move-meta',
  moveName: 'move-name',
  moveActions: 'move-actions',
  categoryShell: 'category-shell',
  categorySelect: 'category-select',
  categoryDot: 'category-dot',
  starBtn: 'star-btn',
  iconBtn: 'icon-btn',
  editBtn: 'edit-btn',
  active: 'active',   // ★ 버튼과 정렬 버튼이 공유하는 활성 표시

  // ── 동작 컨텍스트 메뉴 (openMoveContextMenu 3247-3286) ──
  contextMenu: 'context-menu',
  contextMenuTitle: 'context-menu-title',

  // ── 빠른 배치 팝업 (quickPicker) ──
  quickPopup: 'quick-popup',
  quickPopupHeader: 'quick-popup-header',
  quickPopupTitle: 'quick-popup-title',
  quickPopupItem: 'quick-popup-item',
  quickPopupDivider: 'quick-popup-divider',
  kbActive: 'kb-active',              // 1878 · 2134 — 키보드 커서
  newAction: 'new-action',            // ⚠ CSS(947)에만 있고 JS 에서 붙이는 곳이 0곳이다 — 죽은 클래스
  quickBtnActive: 'quick-btn-active', // 1683 · 4842 — '+ 빠른 배치' 토글 버튼

  // ── 루틴 ──
  routineCard: 'routine-card',
  routineChip: 'routine-chip',
  routineActions: 'routine-actions',
  routineNameText: 'routine-name-text',
  routineMetaText: 'routine-meta-text',
  isEditing: 'is-editing',                    // 4702 — 편집 중인 루틴 카드
  routineActionPopup: 'routine-action-popup', // 1728
  rapTitle: 'rap-title',                      // 1732
  routineEditorPanel: 'routine-editor-panel',
  reToolbar: 're-toolbar',
  reCloseBtn: 're-close-btn',

  // ── 저장 목록 ──
  savedList: 'saved-list',
  savedItem: 'saved-item',
  sortModeBtn: 'sort-mode-btn',
  sortDirBtn: 'sort-dir-btn',

  // ── 링크바 (renderLinksBar 5129-5215) ──
  linksBar: 'links-bar',
  linkRow: 'link-row',
  linkBadge: 'link-badge',
  linkTitleChip: 'link-title-chip',
  linkTitleFetching: 'link-title-fetching',
  linkOpenBtn: 'link-open-btn',
  linkDelBtn: 'link-del-btn',
  linkLabelInput: 'link-label-input',
  linkAddBtn: 'link-add-btn',
  linkResetBtn: 'link-reset-btn',
  ytUrlGroup: 'yt-url-group',
  badgeYt: 'yt',
  badgeClickup: 'clickup',
  badgeCustom: 'custom',

  // ── 셸/레이아웃 (마크업 1214-1381 · init 1545-1662) ──
  app: 'app',
  sidebar: 'sidebar',
  sidebarScroll: 'sidebar-scroll',
  panel: 'panel',
  panelHeader: 'panel-header',
  workspace: 'workspace',
  boardsContainer: 'boards-container',
  mainBoardArea: 'main-board-area',
  boardWrap: 'board-wrap',
  board: 'board',
  resizeDivider: 'resize-divider',
  scrollLocks: 'scroll-locks',
  scrollLockBtn: 'scroll-lock-btn',
  lockIcon: 'lock-icon',
  locked: 'locked',
  toolbar: 'toolbar',
  topActions: 'top-actions',
  sizePill: 'size-pill',
  sizePillLabel: 'size-pill-label',
  legend: 'legend',
  paletteList: 'palette-list',
  fileInput: 'file-input',

  // ── 영상 패널 · 재생 헤드 (2026-09 신설) ──
  // ⚠ 값은 index.html 의 새 CSS 블록과 글자 단위로 같다. 기존 값처럼 바꾸지 마라.
  videoPanel: 'video-panel',
  videoStatus: 'video-status',
  isCollapsed: 'is-collapsed',   // .video-panel.is-collapsed — 본문을 접는다(헤더만 남는다)
  isError: 'is-error',           // .video-status.is-error — 재생기 오류 문구
  playhead: 'playhead',          // 재생 헤드. z-index 6 = .snap-indicator 와 동급

  // ── 공통 유틸 클래스 (마크업과 JS 가 함께 쓴다) ──
  row: 'row', wrap: 'wrap', stack: 'stack', section: 'section', softCard: 'soft-card',
  compactGrid: 'compact-grid', ghost: 'ghost', accent: 'accent', danger: 'danger',
  primary: 'primary', special: 'special', warn: 'warn', muted: 'muted', helper: 'helper',
});

// ─────────────────────────────────────────────────────────────────────────────
// SEL — querySelector/closest 에 그대로 넘기는 셀렉터.
// 원본에 **복합 셀렉터**로 적혀 있던 것은 쪼개지 않고 문자열 그대로 옮겼다(순서 포함).
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Readonly<Record<string, string|((groupId: string) => string)>>} */
export const SEL = Object.freeze({
  // ── 보드 히트테스트 ──
  track: '.track',                 // closest 12곳(2395·2404·2412·2609·2619·2631·2647·2668·2688·2729·2744·3789 …)
  placement: '.placement',         // 1529 · 2439 · 2468 · 2533 · 2586 · 2591 · 3382
  moveHandle: '.move-handle',      // 2477 · 2490 · 2523
  resizeHandle: '.resize-handle',  // 2498 · 2514
  /**
   * ⚠ 원본 2608·2621·2690·2727 이 한 덩어리로 쓰는 복합 셀렉터. **순서까지 그대로**다.
   * 그리기 시작 전에 "블록/핸들 위면 그만둔다"를 한 번에 판정한다.
   */
  placementOrHandles: '.placement, .resize-handle, .move-handle',
  /** ⚠ 팔레트 카드의 dblclick/dragstart 가드(3068·3080). 카드 안의 폼 요소를 걸러낸다. */
  selectOrButton: 'select, button',

  // ── 보드 내부 조회 ──
  trackSpacer: '.track-spacer',    // 3376
  noteCell: '.note-cell',          // 3352
  tooltip: '.tooltip',             // 2798
  placementDragging: '.placement.is-dragging',   // 3897
  placementResizing: '.placement.is-resizing',   // 3771
  trackDropHover: '.track.drop-hover',           // 3928

  // ── 오버레이 정리용 속성 셀렉터. ⚠ 값 '1' 까지 포함한 문자열이다 ──
  previewNodes: '[data-preview="1"]',              // 3924
  resizePreviewNodes: '[data-resize-preview="1"]', // 3825

  // ── 문서 전역 ──
  floatingTooltip: '.floating-tooltip',  // 3348 — renderRows 말미의 강제 숨김
  contextMenu: '.context-menu',          // 2300 — 바깥 클릭 판정
  app: '.app',                           // 1600
  sidebar: '.sidebar',                   // 1601
  sidebarScroll: '.sidebar-scroll',      // 1546
  viewportMeta: 'meta[name="viewport"]', // 1668 — focusout 줌 리셋

  // ── 링크바 ──
  linkTitleChips: '.link-title-chip, .link-title-fetching', // 5134 — 복합, 순서 그대로
  linkOpenBtn: '.link-open-btn',                            // 5136 · 5157

  // ── 목록 행의 버튼 (innerHTML 로 만든 뒤 순서 구조분해) ──
  buttons: 'button',  // 4272 · 4294 · 4320

  /**
   * 한 그룹의 모든 배치 세그먼트. **CSS.escape 를 쓰는 쪽**(원본 3731 · 3745 · 3893).
   * @param {string} groupId
   * @returns {string}
   */
  placementsOfGroup(groupId) {
    return `.placement[data-group-id="${cssEscapeLocal(groupId)}"]`;
  },

  /**
   * 같은 것을 **CSS.escape 없이** 만드는 쪽(원본 2462 · 4536).
   * ⚠ 원본의 비대칭을 그대로 남긴다. 따옴표 안의 속성값이라 두 형태가 같은 노드에 매칭되지만,
   *   호출부가 어느 줄에서 왔는지 잃지 않도록 두 함수를 나눠 둔다.
   * @param {string} groupId
   * @returns {string}
   */
  placementsOfGroupRaw(groupId) {
    return `.placement[data-group-id="${groupId}"]`;
  },
});

/**
 * SEL.placementsOfGroup 전용 CSS.escape. domContract 는 import 가 0개여야 하므로
 * ui/widgets.cssEscape 를 쓰지 않고 같은 내용을 여기 한 번 더 둔다.
 * @param {string} value
 * @returns {string}
 */
function cssEscapeLocal(value) {
  const text = String(value);
  return (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(text) : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA — dataset 키(카멜)와 그에 대응하는 HTML 속성명(케밥).
// el.dataset[DATA.groupId] 와 `[${DATA.groupIdAttr}=…]` 는 같은 것을 가리킨다.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Readonly<Record<string, string>>} */
export const DATA = Object.freeze({
  // 트랙의 행 번호. ⚠ dataset 이라 **문자열**이다 — 읽는 쪽이 Number() 한다(2440 · 2620 …).
  row: 'row',
  rowAttr: 'data-row',

  // 배치 블록이 자기 그룹을 밝히는 키(3426). 컨트롤러가 closest 로 되읽는 유일한 식별자.
  groupId: 'groupId',
  groupIdAttr: 'data-group-id',

  // 배치 이름(3427). 플로팅 툴팁이 .tooltip 이 없을 때의 폴백으로 읽는다(2799).
  name: 'name',
  nameAttr: 'data-name',

  // 루틴 블록만 갖는 키(3428). 일반 동작 배치에는 **아예 없다**.
  routineId: 'routineId',
  routineIdAttr: 'data-routine-id',

  // 겹침 행의 레이어 수(3379). CSS 가 [data-layers] 로 구분선을 그린다.
  // ⚠ 0 이 아니라 **키 자체를 delete** 해서 끈다(3380).
  layers: 'layers',
  layersAttr: 'data-layers',

  // 스크롤 잠금(1552-1572). CSS 가 [data-locked="1"] 로 반응한다. 값은 '0' | '1'.
  locked: 'locked',
  lockedAttr: 'data-locked',

  // 비영속 오버레이 표식. 값은 언제나 문자열 '1'(FLAG_ON).
  preview: 'preview',
  previewAttr: 'data-preview',
  resizePreview: 'resizePreview',
  resizePreviewAttr: 'data-resize-preview',

  // .boards-container 가 켜고 끄는 두 표식(2026-09 신설). 값은 'on' | 'off'.
  //   [data-routine="on"] → 영상 패널을 숨긴다(루틴 편집기와 동시 개방 금지)
  //   [data-video="on"]   → 좁은 화면에서 보드 컨테이너를 세로로 세운다(영상이 위로 올라간다)
  // ⚠ 둘 다 ui/videoPanel.js 가 store 에서 재도출해 쓴다. 다른 곳에서 만지지 마라.
  routineOpen: 'routine',
  routineOpenAttr: 'data-routine',
  videoOpen: 'video',
  videoOpenAttr: 'data-video',
  /** 위 두 표식의 값. dataset 은 문자열이라 불리언을 쓸 수 없다(FLAG_ON 의 '1' 과는 다른 어휘다). */
  ON: 'on',
  OFF: 'off',

  // confirmOnce 의 2단계 확인 상태(1701). 값 '1', 끌 때는 delete.
  pendingConfirm: 'pendingConfirm',
  pendingConfirmAttr: 'data-pending-confirm',

  /** 위 표식 dataset 들의 "켜짐" 값. 원본이 전부 문자열 '1' 을 쓴다. */
  FLAG_ON: '1',
});
