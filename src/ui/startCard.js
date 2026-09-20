// src/ui/startCard.js — 시작하는 세 길과 빈 안무표 안내 (ui 계층)
//
// 신설 파일이다(2026-09-20). 화면에 기능을 더하지 않는다 — **흩어진 입구를 한자리에 모은다.**
// 안무표를 채우는 길은 셋인데(직접 놓기 · 말로 채우기 · 영상에서 받아 적기) 그 입구가
// 사이드바 중간 · 앱바 오른쪽 끝 · 캔버스 바 다섯째 버튼으로 흩어져 있었다. 왼쪽에서 오른쪽,
// 위에서 아래로 훑으면 셋 중 하나도 걸리지 않아서, 처음 켠 사람이 어디부터 누를지 알 수 없었다.
//
// ⚠ 이 뷰는 **상태를 만들지 않는다.** 접힘 여부는 이 모듈의 지역 변수 하나이고 파일에도
//   store 에도 들어가지 않는다 — 곡의 일부가 아니라 이번 세션의 화면 상태다(Undo 대상이 아니다).
// ⚠ 세 버튼이 하는 일은 기존 진입점과 **같은 커맨드**여야 한다. 여기서만 되는 일이 생기면
//   길이 넷이 되고, 이 파일이 고치려던 문제가 그대로 돌아온다.

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   onCompose: () => void,
 *   onVideo: () => void,
 *   hasPlacements: () => boolean
 * }} options
 *   onCompose: `✨ 말로 채우기` 창을 연다(ui/composeView 의 open).
 *   onVideo:   영상 패널을 연다(usecases/videoCommands.openPanel → render).
 *   hasPlacements: 메인 안무표에 놓인 블록이 하나라도 있는가.
 * @returns {{ sync(): void }}
 */
export function createStartCard(options) {
  const { elements = {}, onCompose, onVideo, hasPlacements } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const card = byId('startCard');
  const body = byId('startCardBody');
  const toggle = byId('startCardToggle');
  const composeBtn = byId('startComposeBtn');
  const videoBtn = byId('startVideoBtn');
  const manualBtn = byId('startManualBtn');
  const empty = byId('boardEmpty');

  /**
   * 사용자가 손으로 정한 접힘 상태. `null` 이면 아직 안 정했다는 뜻이고, 그때는
   * "안무표가 비었으면 펴고 채워졌으면 접는다"가 답이 된다. 한 번 손을 대면 그 뜻을 따른다 —
   * 채우는 중에 카드가 제멋대로 펴지면 그것이 더 거슬린다.
   * @type {boolean|null}
   */
  let openedByUser = null;

  /** 지금 펴져 있어야 하는가. */
  function shouldOpen() {
    return openedByUser === null ? !hasPlacements() : openedByUser;
  }

  function applyOpen() {
    const on = shouldOpen();
    if (body) body.hidden = !on;
    if (toggle) {
      toggle.textContent = on ? '▾' : '▸';
      toggle.setAttribute('aria-expanded', String(on));
      toggle.title = on ? '접기' : '펴기';
    }
  }

  /** 안무표가 비었는가에 따라 카드와 안내를 함께 맞춘다. app/render 가 보드 렌더 뒤에 부른다. */
  function sync() {
    if (empty) empty.hidden = hasPlacements();
    applyOpen();
  }

  if (toggle) {
    toggle.onclick = () => { openedByUser = !shouldOpen(); applyOpen(); };
  }
  if (composeBtn) composeBtn.onclick = () => { onCompose(); };
  // ⚠ 패널을 여는 것만으로는 부족하다. 넓은 화면(1041px 이상)은 **이미 열고 시작하므로**
  //   openPanel 이 아무것도 바꾸지 않고, 그러면 눌러도 화면이 그대로여서 "안 눌린다"가 된다.
  //   영상에서 시작하는 첫 걸음인 `① 영상 고르기` 의 파일 열기 버튼까지 데려다 놓는다.
  if (videoBtn) {
    videoBtn.onclick = () => {
      onVideo();
      focusStep('videoFileBtn');
    };
  }
  // `직접 놓기` 는 커맨드가 없다 — 할 일은 "아래를 보라"고 시선을 옮기는 것뿐이다.
  // 카드를 접어 동작 목록을 위로 끌어올리고 검색칸에 커서를 둔다.
  if (manualBtn) {
    manualBtn.onclick = () => {
      openedByUser = false;
      applyOpen();
      focusStep('paletteSearch');
    };
  }

  /**
   * 다음에 손이 갈 자리로 시선과 커서를 옮긴다. 세 버튼이 공통으로 쓰는 유일한 DOM 조작이다.
   * ⚠ 'nearest' 다. 'center' 로 하면 그 칸이 든 스크롤 상자가 아니라 창 전체가 움직이는
   *   브라우저가 있어, 안무표가 화면 밖으로 밀려난다.
   * @param {string} id
   */
  function focusStep(id) {
    const el = byId(id);
    if (!el) return;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    if (el.focus) el.focus();
  }

  // 카드 자체는 언제나 있다(비었을 때만 뜨는 것은 안내 쪽이다) — 첫 상태만 맞춰 둔다.
  if (card) sync();

  return { sync };
}
