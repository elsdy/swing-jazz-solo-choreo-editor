// src/ui/videoPanel.js — 안무표 옆의 영상 패널 (ui 계층)
//
// 신규 파일이다. 원본 index.html 에 대응물이 없다 — 오늘 영상은 링크바의 URL 문자열 하나뿐이고
// 재생기도 템포도 없었다. 그래서 "옮겨 온 줄"이 없는 대신, 지켜야 하는 경계가 넷이다.
//
// ⚠ 경계 ① — **켜야 보이는 기능이다.** 기본은 닫힘(store.session.video.open === false)이고,
//   닫힌 화면은 이 기능이 들어오기 전과 한 픽셀도 다르지 않아야 한다. 그래서 이 뷰는
//   패널을 숨길 때 마크업의 `hidden` 을 되돌려 놓기만 하고, 다른 어떤 요소도 건드리지 않는다.
//
// ⚠ 경계 ② — **재생 위치는 이 뷰가 그리지 않는다.** 재생 헤드는 ui/playhead.js 의 rAF 루프가
//   자기 엘리먼트의 transform 만 직접 쓰는 휘발성 채널이다(docs/PORTS.md 채널 B).
//   여기서 그리면 초당 60회 전체 재렌더가 된다.
//
// ⚠ 경계 ③ — **URL 입력창을 만들지 않는다.** 링크바의 `YouTube URL 입력...` 칸이 그대로 소스다.
//   상태를 두 곳에 두지 않는다(docs/PORTS.md '삽입 지점').
//
// ⚠ 경계 ④ — **어댑터를 모른다.** 재생기는 MediaPlayer 계약으로만 들어오고(getPlayerState /
//   getCurrentSec), 오류 코드 5종을 한국어 문구로 바꾸는 것은 **뷰의 몫**이다(어댑터는 문구를
//   만들지 않는다). 유스케이스도 시계를 읽을 수 없으므로 시각(초)은 언제나 이 뷰가 넣는다.
//
// ⚠ 히스토리 커밋 지점(linkCommands·linksBarView 와 같은 저장소 규약 — 커맨드는 히스토리를 쌓지 않는다):
//     ① 두 점 앵커가 완성된 순간(markTempoPoint 가 committed 를 돌려줄 때)
//     ② 탭 템포 확정(commitTaps)  ③ BPM·박 직접 입력의 change(blur/Enter)
//     ④ 재앵커  ⑤ 템포 지우기
//   패널 열기/접기/따라가기·탭 한 번 한 번에는 걸지 않는다 — 화면 상태이지 안무가 아니다.

import { CLS, DATA } from './domContract.js';
import { isStacked as layoutIsStacked } from './layout.js';
import { cellOf, clamp, linearOf, rowIndices } from '../domain/grid.js';
import { isTempoUsable, normalizeTempo } from '../domain/tempo.js';

/** 메인 보드의 store 상 id. usecases/store.BOARD_MAIN 과 같은 문자열이다(ui 는 usecases 를 import 하지 않는다). */
const BOARD_MAIN = 'main';

/** 두 점 앵커에 필요한 점의 개수. usecases/videoCommands.TEMPO_POINTS_NEEDED 와 같은 값이다. */
const POINTS_NEEDED = 2;

/** 첫 점을 찍은 뒤 두 번째 후보로 밀어 주는 행 간격. 멀리 떨어질수록 클릭 오차가 bpm 에 덜 남는다. */
const SECOND_POINT_ROW_GAP = 4;

/** session.video 가 없을 때의 기본값(옛 스냅샷 복원 뒤에도 안전하도록). */
const DEFAULT_PANEL = Object.freeze({ open: false, collapsed: false, follow: true, tempoPoints: [], taps: [] });

/**
 * 재생기 오류 코드 → 한국어 문구. **어댑터는 문구를 만들지 않는다** — 코드만 준다.
 * 'network' 는 IFrame API 스크립트가 막힌 경우이고(광고 차단기·사내망·오프라인),
 * 'not-embeddable' 은 퍼블리셔가 막은 것이라 사용자가 할 수 있는 게 없다.
 * @type {Readonly<Record<string, string>>}
 */
const ERROR_TEXT = Object.freeze({
  'not-found': '영상을 찾을 수 없습니다. 링크바의 주소를 확인하세요.',
  'not-embeddable': '이 영상은 외부 재생이 막혀 있습니다. 링크바의 ↗ 버튼으로 유튜브에서 여세요.',
  'network': '유튜브 재생 스크립트를 불러오지 못했습니다. 광고 차단기·사내망·오프라인 상태를 확인하세요.',
  'unsupported': '지원하지 않는 영상 주소입니다.',
  'unknown': '영상을 재생할 수 없습니다.'
});

/** 소스가 없을 때의 안내. 링크바를 가리킨다 — 여기에 입력창을 만들지 않기 때문이다. */
const NO_SOURCE_TEXT = '위 링크바의 `YouTube URL 입력...` 칸에 주소를 넣으면 여기에 영상이 뜹니다.';

// ─────────────────────────────────────────────────────────────────────────────
// 표시용 순수 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 초 → `m:ss.s`. 음수(앵커 이전, intro 구간)도 부호를 붙여 그대로 보여 준다.
 * @param {number} sec
 * @returns {string}
 */
export function formatClock(sec) {
  if (!Number.isFinite(sec)) return '-';
  const sign = sec < 0 ? '-' : '';
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  return `${sign}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/**
 * 선형 카운트 → 안무표가 쓰는 말. 행 라벨은 보드와 **같은 문자열**이어야 한다(intro / `8x3`).
 * @param {number} linear
 * @param {number} cols
 * @returns {string}
 */
export function formatCell(linear, cols) {
  const { row, index } = cellOf(linear, cols);
  const label = row === 0 ? 'intro' : `${cols}x${row}`;
  return `${label}의 ${index + 1}카운트`;
}

/** bpm 을 소수 한 자리까지만. 정수면 소수점을 붙이지 않는다. */
function formatBpm(bpm) {
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} VideoPanelDeps
 * @property {any} store createStore 인스턴스. `media` · `session.video` · `session.editingRoutineId` ·
 *   `links.youtubeTitle` · `board('main')` 를 **읽기만** 한다
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {() => void} [commitHistory] app/main 이 `() => render(commitHistory('main'))` 로 넘긴다.
 *   없으면 커밋을 건너뛴다(테스트용)
 * @property {() => string} getSourceUrl 지금 실제로 쓰는 영상 URL(없으면 빈 문자열)
 * @property {() => {load:string, play:string, error:{code:string,message:string}|null}} getPlayerState
 *   MediaPlayer.getState() 를 감싼 게터
 * @property {() => number} getCurrentSec 보간된 현재 미디어 시각(초). 앵커·탭이 쓰는 **유일한 시계**다
 * @property {(shown: boolean) => void} [onSync] 렌더가 끝날 때마다 "패널이 실제로 화면에 있는가"로 불린다.
 *   호출부는 이것으로 재생기를 준비하거나 멈춘다 — **멱등이어야 한다**(매 렌더 불린다).
 *   ⚠ 값이 바뀔 때만 부르면 안 된다: 패널이 열린 채로 URL 만 바뀌는 경로(링크바 change)가
 *     통째로 새고, 새 영상이 영영 실리지 않는다.
 *   ⚠ 거짓일 때 호출부는 **반드시 player.pause()** 를 불러야 한다 — display:none 인 iframe 도
 *     오디오는 계속 나온다. 어댑터를 아는 자리의 몫이라 여기서 하지 않는다
 * @property {() => string} [getPlayerKind] 지금 재생기의 kind('youtube' | 'null').
 *   URL 은 있는데 'null' 이면 **알아보지 못한 주소**라는 뜻이라 문구가 달라진다
 * @property {{
 *   togglePanel: () => any, closePanel: () => any,
 *   setCollapsed: (args?: {collapsed?: boolean}) => any,
 *   setFollow: (args?: {follow?: boolean}) => any,
 *   markTempoPoint: (args: {count:number, sec:number}) => any,
 *   clearTempoPoints: () => any,
 *   tapTempo: (args: {atSec:number}) => any,
 *   commitTaps: (args?: {beatsPerTap?: number}) => any,
 *   clearTaps: () => any,
 *   setTempo: (args: {tempo: object}) => any,
 *   setBeatsPerCount: (args: {beatsPerCount:number}) => any,
 *   reanchorTo: (args: {count:number, sec:number}) => any,
 *   clearTempo: () => any
 * }} commands app/main 이 videoCommands 를 store 에 묶어 넘긴다
 * @property {() => boolean} [isStacked] 좁은 화면인가. 기본값은 ui/layout.isStacked
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * 영상 패널 뷰를 만든다. 팩토리 안에서 자기 입력(툴바의 `▶ 영상 패널` 버튼 + 패널 안의 컨트롤)을
 * 한 번 바인딩한다 — routineEditorView·linksBarView 와 같은 규약이다.
 *
 * @param {VideoPanelDeps} deps
 * @returns {{ render(): void, renderStatus(): void, playerHost(): HTMLElement|null }}
 */
export function createVideoPanel(deps) {
  const {
    store,
    render,
    commitHistory = () => {},
    getSourceUrl,
    getPlayerState,
    getPlayerKind = () => 'null',
    getCurrentSec,
    onSync = () => {},
    commands,
    isStacked = layoutIsStacked,
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const boardsContainer = byId('boardsContainer');
  const panel = byId('videoPanel');
  const openBtn = byId('videoPanelBtn');          // 안무표 툴바의 진입점
  const followBtn = byId('videoFollowBtn');
  const collapseBtn = byId('videoCollapseBtn');
  const closeBtn = byId('videoCloseBtn');
  const titleChip = byId('videoTitleChip');
  const frame = byId('videoFrame');
  const statusEl = byId('videoStatus');
  const bpmText = byId('videoBpmText');
  const anchorRow = byId('videoAnchorRow');
  const anchorCount = byId('videoAnchorCount');
  const markBtn = byId('videoMarkBtn');
  const markCancelBtn = byId('videoMarkCancelBtn');
  const markHelp = byId('videoMarkHelp');
  const tapBtn = byId('videoTapBtn');
  const tapCommitBtn = byId('videoTapCommitBtn');
  const tapClearBtn = byId('videoTapClearBtn');
  const bpmInput = byId('videoBpmInput');
  const bpcInput = byId('videoBeatsPerCount');
  const reanchorBtn = byId('videoReanchorBtn');
  const tempoClearBtn = byId('videoTempoClearBtn');

  /** 마지막으로 세운 행 선택지의 `${cols}x${rows}`. 같으면 다시 만들지 않는다(선택·포커스 보존). */
  let rowOptionsSig = null;
  /** 이 세션에서 패널을 한 번이라도 열었는가. 좁은 화면의 '첫 열기는 접힌 채로' 판정에 쓴다. */
  let openedOnce = false;

  // ── store 읽기 (얇은 접근자) ──────────────────────────────────────────────

  /** 휘발성 화면 상태. usecases/videoCommands.panelState 와 같은 기본값을 쓴다. */
  const panelState = () => store.get().session.video || DEFAULT_PANEL;
  /** 확정된 Tempo. 손상된 값·없는 값은 normalizeTempo 가 흡수한다(bpm 0 = 미설정). */
  const tempo = () => normalizeTempo(store.media && store.media.tempo);
  const mainBoard = () => store.board(BOARD_MAIN);

  // ── 앵커 입력 읽기/쓰기 ───────────────────────────────────────────────────

  /**
   * 행 선택 + 카운트 입력 → **선형 카운트**. 유스케이스에는 언제나 이 값 하나로 들어간다
   * (intro 행 row 0 은 음수 카운트로 분기 없이 떨어진다 — domain/grid.linearOf).
   * @returns {number}
   */
  function readAnchorLinear() {
    const board = mainBoard();
    const row = Number(anchorRow && anchorRow.value);
    const count = Number(anchorCount && anchorCount.value);
    const safeRow = Number.isFinite(row) ? row : 1;
    const index = clamp(Number.isFinite(count) ? count : 1, 1, board.cols) - 1;
    return linearOf(safeRow, index, board.cols);
  }

  /** 첫 점을 찍은 뒤 두 번째 후보를 멀리 민다. 마지막 행을 넘지 않는다. */
  function advanceAnchorRow() {
    if (!anchorRow) return;
    const board = mainBoard();
    const row = Number(anchorRow.value);
    if (!Number.isFinite(row)) return;
    const next = Math.min(board.rows, row + SECOND_POINT_ROW_GAP);
    if (next !== row) anchorRow.value = String(next);
  }

  /** 행 선택지를 보드와 맞춘다. 라벨은 보드의 행 라벨과 **같은 문자열**이다(intro / `8x3`). */
  function syncRowOptions() {
    if (!anchorRow) return;
    const board = mainBoard();
    const sig = `${board.cols}x${board.rows}`;
    if (sig === rowOptionsSig) return;
    const keep = anchorRow.value;
    anchorRow.innerHTML = '';
    for (const row of rowIndices(board)) {
      const opt = document.createElement('option');
      opt.value = String(row);
      opt.textContent = row === 0 ? 'intro' : `${board.cols}x${row}`;
      anchorRow.appendChild(opt);
    }
    // 보드가 줄어 사라진 행을 고르고 있었으면 첫 마디로 되돌린다.
    anchorRow.value = [...anchorRow.options].some(o => o.value === keep) ? keep : '1';
    rowOptionsSig = sig;
    if (anchorCount) anchorCount.max = String(board.cols);
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  /**
   * 재생기 상태 문구 + 제목 칩. **store 를 거치지 않는 값**이라(재생 상태는 도메인이 아니다)
   * app/main 이 player.onState 에서 이 함수를 직접 부른다.
   * ⚠ 제목이 여기 함께 있는 이유: 제목은 링크바가 700ms 디바운스 뒤에 비동기로 채우므로
   *   Dirty 를 타지 않는다. 재생기 상태 변화(loading → ready)에 얹어 따라오게 한다.
   */
  function renderStatus() {
    // 제목은 링크바가 이미 조회해 둔 것을 그대로 쓴다(두 번 조회하지 않는다).
    const title = (store.links && store.links.youtubeTitle) || '';
    if (titleChip) {
      titleChip.hidden = !title;
      titleChip.textContent = title;
      titleChip.title = title;
    }

    if (!statusEl) return;
    const url = getSourceUrl();
    if (!url) {
      statusEl.textContent = NO_SOURCE_TEXT;
      statusEl.classList.remove(CLS.isError);
      return;
    }
    // 주소는 있는데 널 재생기다 = 유튜브 주소로 알아보지 못했다. 오류가 아니라 안내다.
    if (getPlayerKind() === 'null') {
      statusEl.textContent = '유튜브 주소로 알아보지 못했습니다. 링크바의 주소를 확인하세요.';
      statusEl.classList.remove(CLS.isError);
      return;
    }
    const state = getPlayerState() || {};
    if (state.load === 'error') {
      const code = state.error && state.error.code;
      statusEl.textContent = ERROR_TEXT[code] || ERROR_TEXT.unknown;
      statusEl.classList.add(CLS.isError);
      return;
    }
    statusEl.classList.remove(CLS.isError);
    // 준비가 끝났으면 아무 말도 하지 않는다 — 화면에 영상이 떠 있는 것이 곧 상태다.
    statusEl.textContent = state.load === 'ready' ? '' : '영상을 불러오는 중…';
  }

  /** 템포 구획 전체. "지금 무엇이 정해졌는지"를 화면이 말하게 하는 것이 이 함수의 목적이다. */
  function renderTempo() {
    const board = mainBoard();
    const t = tempo();
    const ready = isTempoUsable(t);
    const p = panelState();

    syncRowOptions();

    if (bpmText) {
      bpmText.textContent = ready
        ? `BPM ${formatBpm(t.bpm)} · 1카운트 = ${t.beatsPerCount}박 · 기준 ${formatCell(t.anchorCount, board.cols)} = ${formatClock(t.anchorSec)}`
        : 'BPM 미설정 — 아직 재생 위치를 안무표에 표시할 수 없습니다.';
    }

    // 두 점 앵커의 진행 상태. 사용자가 "두 번 찍어야 한다"를 모르면 이 기능을 못 쓴다.
    if (markHelp) {
      const points = p.tempoPoints || [];
      if (points.length === 0) {
        markHelp.textContent = ready
          ? '박자가 딱 떨어지는 순간에 두 지점을 다시 찍으면 BPM 을 새로 잽니다. 두 지점은 멀수록 정확합니다.'
          : '영상을 재생하다가 박자가 딱 떨어지는 순간에 `지금 여기` 를 누릅니다. 두 번 찍으면 BPM 과 시작 지점이 함께 정해집니다 — 두 지점은 멀수록 정확합니다.';
      } else {
        const first = points[points.length - 1];
        markHelp.textContent =
          `${points.length}/${POINTS_NEEDED} — 첫 지점 ${formatCell(first.count, board.cols)} = ${formatClock(first.sec)}. `
          + '이제 한참 뒤의 카운트를 골라 한 번 더 누르세요.';
      }
    }
    if (markCancelBtn) markCancelBtn.disabled = (p.tempoPoints || []).length === 0;

    // 탭 템포. 시각은 미디어 시계라 멈춘 영상에서는 간격이 벌어지지 않는다 — 그 사실을 라벨로 말한다.
    const taps = p.taps || [];
    if (tapBtn) tapBtn.textContent = taps.length ? `탭 (${taps.length})` : '탭';
    if (tapCommitBtn) tapCommitBtn.disabled = taps.length < 2;
    if (tapClearBtn) tapClearBtn.disabled = taps.length === 0;

    // 직접 입력 — ⚠ 타이핑 중에는 되쓰지 않는다(커서가 끝으로 튀고 입력이 잘린다).
    if (bpmInput && document.activeElement !== bpmInput) bpmInput.value = ready ? formatBpm(t.bpm) : '';
    if (bpcInput && document.activeElement !== bpcInput) bpcInput.value = String(t.beatsPerCount);
    if (reanchorBtn) reanchorBtn.disabled = !ready;
    if (tempoClearBtn) tempoClearBtn.disabled = !ready;
  }

  /** Dirty.video 의 적용점. store 만 보고 패널의 모든 표시를 재도출한다. */
  function renderPanel() {
    const p = panelState();
    // 루틴 편집기와 동시에 열지 않는다 — CSS 가 실제로 가리는 조건과 **같은 식**이어야 한다.
    const routineOpen = !!store.session.editingRoutineId;
    const shown = p.open && !routineOpen;

    if (boardsContainer) {
      boardsContainer.dataset[DATA.routineOpen] = routineOpen ? DATA.ON : DATA.OFF;
      boardsContainer.dataset[DATA.videoOpen] = shown ? DATA.ON : DATA.OFF;
    }
    if (panel) {
      panel.hidden = !p.open;
      panel.classList.toggle(CLS.isCollapsed, !!p.collapsed);
    }
    // 툴바 진입점의 활성 표시. '+ 빠른 배치' 와 같은 규칙이라 store 값에서 재도출한다.
    if (openBtn) openBtn.className = p.open ? CLS.quickBtnActive : CLS.ghost;
    if (followBtn) followBtn.className = p.follow ? CLS.quickBtnActive : CLS.ghost;
    if (collapseBtn) collapseBtn.textContent = p.collapsed ? '펼치기' : '접기';

    renderStatus();
    renderTempo();

    // ⚠ **매번** 부른다. 값이 바뀔 때만 부르면 "패널이 열린 채로 URL 만 바뀌는" 경로가 통째로
    //   새어 새 영상이 영영 실리지 않는다. 호출부의 구현은 멱등이어야 한다.
    onSync(shown);
  }

  // ── 바인딩 ───────────────────────────────────────────────────────────────
  // ⚠ 커맨드가 돌려주는 Dirty 를 그대로 presenter 에 넘긴다. 단 `committed` 는 Dirty 의 키가
  //   아니므로(assertDirty 가 dev 모드에서 던진다) 떼어 내고 히스토리 커밋 신호로만 쓴다.

  /**
   * 확정 커맨드 하나를 실행한다: Dirty 는 그리고, `committed` 면 히스토리를 커밋한다.
   * @param {any} result 커맨드의 반환값
   * @returns {boolean} 히스토리를 커밋했는가
   */
  function applyCommitting(result) {
    const { committed, ...dirty } = result || {};
    render(dirty);
    if (committed) commitHistory();
    return !!committed;
  }

  if (openBtn) {
    openBtn.onclick = () => {
      const wasOpen = panelState().open;
      render(commands.togglePanel());
      // 좁은 화면은 세로 예산이 빡빡하다 — 처음 열 때는 헤더만 남긴다(펼치기는 한 번 누르면 된다).
      if (!wasOpen && !openedOnce && isStacked()) render(commands.setCollapsed({ collapsed: true }));
      if (!wasOpen) openedOnce = true;
    };
  }
  if (closeBtn) closeBtn.onclick = () => render(commands.closePanel());
  if (collapseBtn) collapseBtn.onclick = () => render(commands.setCollapsed());
  if (followBtn) followBtn.onclick = () => render(commands.setFollow());

  if (markBtn) {
    markBtn.onclick = () => {
      // 두 번째 점이 확정되는 순간에만 committed 가 온다 — 히스토리는 그때 한 번이다.
      const done = applyCommitting(commands.markTempoPoint({ count: readAnchorLinear(), sec: getCurrentSec() }));
      if (!done) advanceAnchorRow();
    };
  }
  if (markCancelBtn) markCancelBtn.onclick = () => render(commands.clearTempoPoints());

  // ⚠ 탭의 시각은 **미디어 시각**이다. bpm 은 "미디어 1분에 몇 박"이라 배속을 걸어도 값이 맞고,
  //   markTempoPoint 와 같은 시계를 써야 두 경로가 어긋나지 않는다.
  if (tapBtn) tapBtn.onclick = () => render(commands.tapTempo({ atSec: getCurrentSec() }));
  if (tapCommitBtn) tapCommitBtn.onclick = () => applyCommitting(commands.commitTaps());
  if (tapClearBtn) tapClearBtn.onclick = () => render(commands.clearTaps());

  if (bpmInput) {
    // ⚠ change(blur/Enter)에만 건다. input 에 걸면 글자마다 undo 단계가 쌓인다(링크바와 같은 규칙).
    bpmInput.onchange = () => {
      const bpm = Number(bpmInput.value);
      if (!Number.isFinite(bpm)) return;
      // 빈 칸(=0)은 '미설정'이고 20..400 클램프는 normalizeTempo 안에서 일어난다.
      render(commands.setTempo({ tempo: { bpm } }));
      commitHistory();
    };
  }
  if (bpcInput) {
    bpcInput.onchange = () => {
      const beatsPerCount = Number(bpcInput.value);
      if (!Number.isFinite(beatsPerCount)) return;
      render(commands.setBeatsPerCount({ beatsPerCount }));
      commitHistory();
    };
  }
  if (reanchorBtn) {
    // bpm 은 그대로 두고 앵커만 옮긴다 — 곡 중간에서 어긋난 싱크를 한 번에 되맞추는 경로다.
    reanchorBtn.onclick = () => {
      render(commands.reanchorTo({ count: readAnchorLinear(), sec: getCurrentSec() }));
      commitHistory();
    };
  }
  if (tempoClearBtn) {
    tempoClearBtn.onclick = () => {
      render(commands.clearTempo());
      commitHistory();
    };
  }

  return {
    render: renderPanel,
    renderStatus,
    /** YT.Player 가 iframe 으로 갈아치울 자리. app/main 이 여기에 컨테이너를 만든다. */
    playerHost: () => frame
  };
}
