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
//
// 2026-11-02(RM-26): 빈 안무표 안내의 `예제 열기` 와, 아직 쓸 수 없는 입구를 흐리게 두고 까닭을 적는 일이
// 더해졌다. 막힘의 판정(entryStates)은 **이미 있는 상태**(서버 유무 · LLM 설정)를 읽기만 한다 — 새 판정을 짓지 않는다.

/**
 * 서버 · LLM 상태에서 채우기 줄 입구 넷의 막힘 여부와 까닭 한 줄을 정한다. 순수 함수 — app/main 이
 * clipServer.probe() 와 llm.getConfig() 의 결과를 넣고, 돌려받은 표를 setEntryStates 에 준다.
 *
 * @param {{ server: boolean, llm: {available?: boolean}|null }} status
 *   server — 로컬 서버(server.py)가 응답했나. llm — /api/llm/config 의 답(서버가 없으면 null).
 * @returns {Record<'compose'|'video'|'quickPlace'|'manual', {blocked: boolean, reason: string}>}
 */
// @complexity time=O(1) space=O(1) cc=3
export function entryStates(status) {
  const { server = false, llm = null } = status || {};
  const open = { blocked: false, reason: '' };
  let compose = open;
  if (!server) compose = { blocked: true, reason: '✨ 말로 채우기 는 로컬 서버가 있어야 됩니다 — python3 server.py 로 열면 켜집니다.' };
  else if (!llm || !llm.available) compose = { blocked: true, reason: '✨ 말로 채우기 는 LLM 키가 있어야 됩니다 — ⚙ 설정 의 「말로 채우기 — LLM」에서 넣습니다.' };
  return { compose, video: open, quickPlace: open, manual: open };
}

/** 입구 이름 → 버튼 id. `✨ 말로 채우기` 는 composeView 가 슬롯에 붙이는 버튼이라 id 로만 찾는다. */
const ENTRY_BUTTONS = Object.freeze({
  compose: 'composeOpenBtn', video: 'videoPanelBtn', quickPlace: 'quickPlaceBtn', manual: 'modeManualBtn'
});

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   hasPlacements: () => boolean,
 *   openExample?: (btn: HTMLElement) => void
 * }} options
 *   openExample — `예제 열기` 를 눌렀다. 비었으면 바로 열고 내용이 있으면 확인(confirmOnce)을 거치는 것은
 *   호출부(app/main)의 몫이다 — 여는 길 · 되돌리기 바닥을 아는 쪽이 거기다.
 * @returns {{ sync(): void, setEntryStates(states: ReturnType<typeof entryStates>): void, setExampleReady(ready: boolean): void }}
 */
// @complexity time=O(1) space=O(1) cc=6
export function createModeBar(options) {
  const { elements = {}, hasPlacements, openExample = null } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const manualBtn = byId('modeManualBtn');
  const empty = byId('boardEmpty');
  // `예제 열기` 는 두 자리다 — 빈 안무표 안내(비었을 때만 보인다)와 파일 메뉴(내용이 있어도 연다 → 확인을 거친다).
  const exampleBtns = [byId('openExampleBtn'), byId('openExampleMenuBtn')].filter(Boolean);
  const note = byId('modeBarNote');

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

  if (openExample) for (const b of exampleBtns) b.onclick = () => openExample(b);

  /** 빈 안무표 안내를 맞춘다. app/render 가 보드 렌더 뒤에 부른다. */
  function sync() {
    if (empty) empty.hidden = hasPlacements();
  }

  /**
   * 막힌 입구를 흐리게 두고 까닭을 적는다. 버튼을 끄지는 않는다 — 눌러도 그 화면이 같은 까닭을 말하고,
   * 끄면 「왜 안 눌리나」가 보이지 않는다.
   * @param {ReturnType<typeof entryStates>} states
   */
  // @complexity time=O(1) space=O(1) cc=4
  function setEntryStates(states) {
    const reasons = [];
    for (const [name, id] of Object.entries(ENTRY_BUTTONS)) {
      const btn = byId(id);
      const st = states && states[name];
      if (!btn || !st) continue;
      if (st.blocked) { btn.dataset.blocked = '1'; btn.title = st.reason; reasons.push(st.reason); }
      else { delete btn.dataset.blocked; }
    }
    if (note) {
      note.hidden = reasons.length === 0;
      note.textContent = reasons.join(' ');
    }
  }

  /**
   * `예제 열기` 를 누를 수 있게 한다. 부팅의 「작업 중 문서 되살리기」가 끝나기 전에 예제를 열면 되살릴 것을
   * 예제가 이기므로, 호출부가 그 뒤에 켠다.
   * @param {boolean} ready
   */
  function setExampleReady(ready) {
    for (const b of exampleBtns) b.disabled = !ready;
  }

  sync();
  return { sync, setEntryStates, setExampleReady };
}
