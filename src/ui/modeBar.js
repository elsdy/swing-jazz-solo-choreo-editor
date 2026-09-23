// src/ui/modeBar.js — 앱바 아래 `채우기` 줄 (ui 계층)
//
// 2026-09-21 에 ui/startCard.js(사이드바의 `어떻게 채울까` 카드)를 대신해 들어왔다. 카드가 하던
// 일은 그대로이고 자리만 바뀌었다 — 사이드바 한 칸이 아니라 **화면을 가로지르는 한 줄**이다.
//
// 왜 옮겼나: 안무표를 채우는 입구 넷이 층이 다른 세 자리에 흩어져 있었다. `✨ 말로 채우기` 는
// 앱바(앱 수준), `+ 빠른 배치` · `▶ 영상으로 채우기` · `🎵 프레이즈` 는 캔버스 바(이 안무표의
// 표시 설정), 같은 셋이 사이드바 카드(넣을 것의 목록)에도 또 있었다. 같은 층의 지시어가 층을
// 건너 흩어지면 "다음에 무엇을 누르나"가 화면에서 안 읽힌다. 이제 위에서 아래로
// **앱 → 무엇으로 채울까 → 안무표 자체** 세 층이다.
//
// ⚠ **여기에만 있는 기능은 없다.** 줄 위의 버튼은 전부 이미 있던 진입점이고, 이 파일이 손대는
//   것은 `✋ 직접 놓기` 하나뿐이다 — 그것도 커맨드가 아니라 "아래를 보라"는 시선 이동이다.
// ⚠ 줄의 나머지(말로 채우기 · 프레이즈)는 app/main 이 슬롯에 **붙인다.** 여기서 만들지 마라.

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   hasPlacements: () => boolean
 * }} options
 * @returns {{ sync(): void }}
 */
export function createModeBar(options) {
  const { elements = {}, hasPlacements } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const manualBtn = byId('modeManualBtn');
  const empty = byId('boardEmpty');

  /**
   * 다음에 손이 갈 자리로 시선과 커서를 옮긴다.
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

  // `직접 놓기` 는 커맨드가 없다 — 할 일은 "동작 목록을 보라"고 시선을 옮기는 것뿐이다.
  if (manualBtn) manualBtn.onclick = () => focusStep('paletteSearch');

  /** 빈 안무표 안내를 맞춘다. app/render 가 보드 렌더 뒤에 부른다. */
  function sync() {
    if (empty) empty.hidden = hasPlacements();
  }

  sync();
  return { sync };
}
