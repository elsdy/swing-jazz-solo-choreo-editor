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
//     ④ 재앵커  ⑤ 템포 지우기  ⑥ 마커 추가·삭제·박자 반영  ⑦ 잘라내기 결과 적용(applyTrim)
//   패널 열기/접기/따라가기·탭 한 번 한 번·In/Out 찍기·구간 반복에는 걸지 않는다 — 화면 상태이지 안무가 아니다.

import { CLS, DATA } from './domContract.js';
import { confirmOnce } from './widgets.js';
import { cellOf, clamp, linearOf, rowIndices } from '../domain/grid.js';
import { bpmFromTaps, driftCounts, isTempoUsable, normalizeTempo, tapSpread } from '../domain/tempo.js';
import { driftReport } from '../domain/captureDrift.js';
import { isStacked } from './layout.js';
import { flowTrack } from '../domain/flowTrack.js';
import { openCount } from '../domain/stepTodos.js';
import { markersAt, normalizeMarkers } from '../domain/markers.js';
import { activeClipOf, clipCoverage, normalizeMedia } from '../domain/project/media.js';

/** 메인 보드의 store 상 id. usecases/store.BOARD_MAIN 과 같은 문자열이다(ui 는 usecases 를 import 하지 않는다). */
const BOARD_MAIN = 'main';

/** 두 점 앵커에 필요한 점의 개수. usecases/videoCommands.TEMPO_POINTS_NEEDED 와 같은 값이다. */
const POINTS_NEEDED = 2;

/** 첫 점을 찍은 뒤 두 번째 후보로 밀어 주는 행 간격. 멀리 떨어질수록 클릭 오차가 bpm 에 덜 남는다. */
const SECOND_POINT_ROW_GAP = 4;

/** session.video 가 없을 때의 기본값(옛 스냅샷 복원 뒤에도 안전하도록). */
const DEFAULT_PANEL = Object.freeze({ open: false, collapsed: false, follow: true, tempoPoints: [], taps: [], inSec: null, outSec: null, loop: false, captureSec: null });

/** 잘라내기가 안 되는 이유 → 안내 문구. 어댑터·서버는 코드/사실만 주고 문구는 여기서 만든다. */
const TRIM_TEXT = Object.freeze({
  'no-inout': 'In 과 Out 을 먼저 찍으세요. 잘라 낸 구간은 새 파일이 되고 원본은 그대로 남습니다.',
  'not-file': '잘라내기는 영상 파일에만 됩니다 — 유튜브 영상은 `📁 영상 파일 열기` 로 받아 온 파일이어야 합니다.',
  'no-server': '로컬 서버(server.py)가 없어 잘라낼 수 없습니다. `python3 server.py` 로 열면 됩니다.',
  'no-ffmpeg': '서버에 ffmpeg 이 없습니다. 설치하고(`brew install ffmpeg`) 서버를 다시 켜면 잘라낼 수 있습니다.',
  'not-stored': '이 파일은 아직 보관 폴더에 없습니다. 보관이 끝나면(파일명 옆 경로가 생기면) 잘라낼 수 있습니다.',
  'busy': '잘라내는 중… 구간 길이에 따라 수십 초가 걸릴 수 있습니다. 끝나면 새 클립으로 바뀝니다.',
  'ready': '이 구간만 남긴 새 클립(MP4)을 만들고 그 클립으로 갈아 끼웁니다. 박자 설정과 마커도 새 시간축으로 따라갑니다.'
});

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

/** 소스가 없을 때의 안내. 링크바와 파일 버튼을 가리킨다 — 유튜브 주소 입력창은 여기 만들지 않기 때문이다. */
const NO_SOURCE_TEXT = '위 링크바의 `YouTube URL 입력...` 칸에 주소를 넣거나 `📁 영상 파일 열기` 로 내 컴퓨터의 영상을 고르면 여기에 뜹니다.';

/**
 * 파일 소스는 저장됐는데 이 세션에서 아직 안 골랐을 때의 안내.
 * 브라우저는 파일 경로를 기억하지 못하므로 다시 열면 같은 파일을 다시 골라야 한다 — 오류가 아니라 안내다.
 * @param {string} name
 * @returns {string}
 */
const REPICK_TEXT = (name) => `이 안무표는 영상 파일 \`${name}\` 을 쓰던 것입니다. 브라우저는 파일 위치를 기억하지 못하므로 \`📁 영상 파일 열기\` 로 같은 파일을 다시 골라 주세요.`;

/**
 * 보관 폴더에 복사해 둔 파일인데 아직 이 세션에서 못 읽었을 때의 안내. 권한만 다시 받으면 되므로 버튼을 가리킨다.
 * @param {string} path
 * @returns {string}
 */
const LIB_TEXT = (path) => `보관 폴더의 \`${path}\` 을 쓰던 안무표입니다. \`📂 보관 폴더에서 불러오기\` 를 누르면 다시 읽어 옵니다(브라우저가 폴더 사용 허가를 물으면 허용하세요).`;

/** 보관 폴더에서 읽으려 했는데 파일이 없을 때. 옮겼거나 지웠거나 다른 컴퓨터다. */
const LIB_MISSING_TEXT = (path) => `보관 폴더에 \`${path}\` 이 없습니다. 파일을 옮겼거나 다른 컴퓨터라면 \`📁 영상 파일 열기\` 로 다시 고르세요(고르면 다시 보관됩니다).`;

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

/**
 * 선형 카운트 구간 [from, to) → 안무표의 말. 같은 행이면 `8x3의 1~8카운트`, 아니면 `8x3의 1카운트 ~ 8x4의 8카운트`.
 * @param {number} from
 * @param {number} to 배타적
 * @param {number} cols
 * @returns {string}
 */
export function formatRange(from, to, cols) {
  const a = cellOf(from, cols);
  const b = cellOf(to - 1, cols);
  const label = (row) => (row === 0 ? 'intro' : `${cols}x${row}`);
  if (a.row === b.row) {
    return a.index === b.index ? `${label(a.row)}의 ${a.index + 1}카운트` : `${label(a.row)}의 ${a.index + 1}~${b.index + 1}카운트`;
  }
  return `${label(a.row)}의 ${a.index + 1}카운트 ~ ${label(b.row)}의 ${b.index + 1}카운트`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} VideoPanelDeps
 * @property {any} store createStore 인스턴스. `media` · `session.video` · `session.editingRoutineId` ·
 *   `links.youtubeTitle` · `board('main')` 를 **읽기만** 한다
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {() => void} [commitHistory] app/main 이 `() => render(commitHistory('main'))` 로 넘긴다.
 *   없으면 커밋을 건너뛴다(테스트용)
 * @property {() => string} getSourceUrl 지금 실제로 쓰는 영상 URL(없으면 빈 문자열). 파일 소스면 빈 문자열이다
 * @property {() => ({kind:'youtube', url:string}|{kind:'file', name:string}|null)} [getSource]
 *   확정된 소스 참조(store.media.source). 파일이면 이름만 있다. 기본은 store 에서 직접 읽는다
 * @property {() => boolean} [getFileLoaded] 파일 소스에 대해 **이 세션에서 실제 파일이 골라져 있는가**.
 *   저장 파일에서 연 직후에는 이름만 있고 파일이 없다 — 그때 "다시 골라 달라"고 안내한다
 * @property {(file: File) => void} [onFileChosen] 사용자가 파일을 골랐다. blob URL 을 만들고 소스를
 *   확정하는 것은 어댑터를 아는 자리(app/main)의 몫이라 여기서 하지 않는다
 * @property {() => void} [onOpenFromLibrary] `📂 보관 폴더에서 불러오기`. 클릭 콜스택 안에서 권한을 묻는다
 * @property {() => 'idle'|'missing'} [getLibraryState] 마지막 보관 폴더 읽기 시도의 결과. 'missing' 이면 파일이 없었다
 * @property {() => {load:string, play:string, error:{code:string,message:string}|null}} getPlayerState
 *   MediaPlayer.getState() 를 감싼 게터
 * @property {() => number} getCurrentSec 보간된 현재 미디어 시각(초). 앵커·탭이 쓰는 **유일한 시계**다
 * @property {() => number|null} [getDurationSec] 영상 전체 길이(초). 모르면 null(라이브·아직 안 실림).
 *   받아 적기를 열 때 안무표를 영상 길이만큼 늘리는 데 쓴다 — 재생기는 어댑터라 여기서 만지지 않는다
 * @property {() => void} [onTogglePlay] `P`. 재생과 일시정지를 번갈아 한다 — 재생기는 어댑터라
 *   여기서 만지지 않는다. 키 입력은 사용자 제스처라 needsUserGesture 재생기에서도 통한다
 * @property {(shown: boolean) => void} [onSync] 렌더가 끝날 때마다 "패널이 실제로 화면에 있는가"로 불린다.
 *   호출부는 이것으로 재생기를 준비하거나 멈춘다 — **멱등이어야 한다**(매 렌더 불린다).
 *   ⚠ 값이 바뀔 때만 부르면 안 된다: 패널이 열린 채로 URL 만 바뀌는 경로(링크바 change)가
 *     통째로 새고, 새 영상이 영영 실리지 않는다.
 *   ⚠ 거짓일 때 호출부는 **반드시 player.pause()** 를 불러야 한다 — display:none 인 iframe 도
 *     오디오는 계속 나온다. 어댑터를 아는 자리의 몫이라 여기서 하지 않는다
 * @property {() => string} [getPlayerKind] 지금 재생기의 kind('youtube' | 'file' | 'null').
 *   URL 은 있는데 'null' 이면 **알아보지 못한 주소**라는 뜻이라 문구가 달라진다
 * @property {(sec: number, opts?: {play?: boolean}) => void} [onSeek] 영상을 그 시각으로 옮긴다(play 면 재생까지).
 *   `In 으로`·`Out 으로`·마커의 ▶ 가 쓴다. 어댑터를 아는 자리의 몫이라 여기서 player 를 만지지 않는다
 * @property {() => 'server'|'folder'|'browser'} [getStorageMode] 고른 영상 파일이 어디에 복사되는가 —
 *   서버가 받아 두는가(`server`), 브라우저에 지정한 폴더인가(`folder`), 아무 데도 아닌가(`browser`)
 * @property {() => 'unavailable'|'off'|'on'} [getPipState] 화면 속 화면을 지금 쓸 수 있는가.
 *   'unavailable' 이면 버튼을 아예 감춘다 — 눌러도 안 되는 버튼을 두지 않는다
 * @property {() => void} [onTogglePip] `⧉ PiP`. ⚠ **클릭 콜스택 안에서** 재생기까지 닿아야 켜진다
 * @property {() => 'ready'|'busy'|'no-inout'|'not-file'|'no-server'|'no-ffmpeg'|'not-stored'} [getTrimState]
 *   잘라내기를 지금 할 수 있는가, 안 되면 왜인가. In/Out 유무는 뷰가 스스로 보므로 호출부는 나머지만 답해도 된다
 * @property {() => string} [getTrimError] 마지막 잘라내기 실패 이유(서버 문구). 비어 있으면 실패가 없었다
 * @property {(range: {inSec:number, outSec:number}) => void} [onTrim] `✂ 잘라서 새 클립으로`. 서버에 자르기를 시키고
 *   끝나면 applyTrim 커맨드로 소스를 갈아 끼우는 것까지 호출부(app/main)의 몫이다
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
 *   clearTempo: () => any,
 *   clearFileSource?: () => any,
 *   addTempoPoint?: (args: {count:number, sec:number}) => any,
 *   clearTempoMap?: () => any,
 *   setInPoint?: (args: {sec:number}) => any,
 *   setOutPoint?: (args: {sec:number}) => any,
 *   setInOut?: (args: {inSec:number, outSec:number}) => any,
 *   clearInOut?: () => any,
 *   setLoop?: (args?: {loop?: boolean}) => any,
 *   addMarker?: (args: {fromCount:number, toCount:number, label?:string}) => any,
 *   removeMarker?: (args: {id:string}) => any,
 *   clearMarkers?: () => any,
 *   applyMarkerToTempo?: (args: {id:string}) => any
 * }} commands app/main 이 videoCommands 를 store 에 묶어 넘긴다
 * @property {{
 *   available: () => boolean,
 *   wanted: () => boolean,
 *   listening: () => boolean,
 *   error: () => string,
 *   toggle: () => boolean,
 *   heard: () => {heard:string, name:string, needsLlm:boolean}|null
 * }} [voice] 마이크로 이름 붙이기(2026-09-22). app/main 이 adapters/speechInput 을 묶어 넘긴다.
 *   ⚠ 없거나 `available()` 이 거짓이면 이 줄을 **감춘다** — 눌러도 안 되는 버튼을 두지 않는다.
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * 영상 패널 뷰를 만든다. 팩토리 안에서 자기 입력(툴바의 `▶ 영상 패널` 버튼 + 패널 안의 컨트롤)을
 * 한 번 바인딩한다 — routineEditorView·linksBarView 와 같은 규약이다.
 *
 * @param {VideoPanelDeps} deps
 * @returns {{ render(): void, renderStatus(): void, renderPip(): void, syncSelection(): void, playerHost(): HTMLElement|null }}
 */
export function createVideoPanel(deps) {
  const {
    store,
    render,
    commitHistory = () => {},
    getSourceUrl,
    getSource = () => activeClipOf(store.media).source,
    getFileLoaded = () => false,
    onFileChosen = () => {},
    onOpenFromLibrary = () => {},
    getLibraryState = () => 'idle',
    getPlayerState,
    getPlayerKind = () => 'null',
    getCurrentSec,
    getDurationSec = () => null,
    onTogglePlay = () => {},
    onSeek = () => {},
    getStorageMode = () => 'browser',
    voice = null,
    getPipState = () => 'unavailable',
    // "어떤 버튼 다음에 어떤 버튼"을 세는 자리(2026-09-21). ⚠ 이 뷰는 **세어 달라고 말하기만** 한다 —
    // 표가 어디 담기는지도, 무엇을 짚어 줄지도 모른다(app/main 이 domain/flowStats 와 잇는다).
    flow = { note: () => {}, suggest: () => null },
    onTogglePip = () => {},
    getTrimState = () => 'no-server',
    getTrimError = () => '',
    onTrim = () => {},
    onSync = () => {},
    // 영상 이름 바꾸기에 쓴다(원본 renameMove 와 같은 idiom). 넓히지 않으려고 promptText 하나만 받는다.
    dialogs = { promptText: (title, value) => window.prompt(title, value) },
    commands,
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const boardsContainer = byId('boardsContainer');
  const panel = byId('videoPanel');
  const openBtn = byId('videoPanelBtn');          // 안무표 툴바의 진입점
  const followBtn = byId('videoFollowBtn');
  const collapseBtn = byId('videoCollapseBtn');
  const pipBtn = byId('videoPipBtn');
  const frameSlot = byId('videoFrameSlot');
  const bodyEl = byId('videoBody');
  const flowSteps = byId('videoFlowSteps');
  const floatBtn = byId('videoFloatBtn');
  const floatBar = byId('videoFloatBar');
  const floatDockBtn = byId('videoFloatDockBtn');
  const closeBtn = byId('videoCloseBtn');
  const titleChip = byId('videoTitleChip');
  const frame = byId('videoFrame');
  const statusEl = byId('videoStatus');
  const fileInput = byId('videoFileInput');
  const fileBtn = byId('videoFileBtn');
  const fileName = byId('videoFileName');
  const fileClearBtn = byId('videoFileClearBtn');
  const fileLibBtn = byId('videoFileLibBtn');
  const bpmText = byId('videoBpmText');
  const anchorRow = byId('videoAnchorRow');
  const anchorCount = byId('videoAnchorCount');
  const markBtn = byId('videoMarkBtn');
  const markCancelBtn = byId('videoMarkCancelBtn');
  const markHelp = byId('videoMarkHelp');
  const tapBtn = byId('videoTapBtn');
  const tapHelp = byId('videoTapHelp');
  const tapCommitBtn = byId('videoTapCommitBtn');
  const tapClearBtn = byId('videoTapClearBtn');
  const bpmInput = byId('videoBpmInput');
  const bpcInput = byId('videoBeatsPerCount');
  const reanchorBtn = byId('videoReanchorBtn');
  const tempoClearBtn = byId('videoTempoClearBtn');
  const pointBtn = byId('videoPointBtn');
  const pointSelBtn = byId('videoPointSelBtn');
  const pointClearBtn = byId('videoPointClearBtn');
  const pointHelp = byId('videoPointHelp');
  const inBtn = byId('videoInBtn');
  const outBtn = byId('videoOutBtn');
  const inGoBtn = byId('videoInGoBtn');
  const outGoBtn = byId('videoOutGoBtn');
  const loopBtn = byId('videoLoopBtn');
  const inOutClearBtn = byId('videoInOutClearBtn');
  const inOutText = byId('videoInOutText');
  const captureBtn = byId('videoCaptureBtn');
  const rewindBtn = byId('videoRewindBtn');
  const captureCancelBtn = byId('videoCaptureCancelBtn');
  const captureSkipBtn = byId('videoCaptureSkipBtn');
  const shiftBackBtn = byId('videoShiftBackBtn');
  const shiftFwdBtn = byId('videoShiftFwdBtn');
  const shiftHelp = byId('videoShiftHelp');
  const pipSideBtn = byId('videoPipSideBtn');
  const markerBlocksBtn = byId('videoMarkerBlocksBtn');
  const nameSelBtn = byId('videoNameSelBtn');
  const captureHelp = byId('videoCaptureHelp');
  const voiceField = byId('videoVoiceField');
  const voiceBtn = byId('videoVoiceBtn');
  const voiceNow = byId('videoVoiceNow');
  const voiceHelp = byId('videoVoiceHelp');
  const trimBtn = byId('videoTrimBtn');
  const trimHelp = byId('videoTrimHelp');
  const markerSelBtn = byId('videoMarkerSelBtn');
  const markerRowBtn = byId('videoMarkerRowBtn');
  const markerClearBtn = byId('videoMarkerClearBtn');
  const markerHelp = byId('videoMarkerHelp');
  const markerList = byId('videoMarkerList');
  const clipList = byId('videoClipList');
  const clipHelp = byId('videoClipHelp');

  /** 마지막으로 세운 행 선택지의 `${cols}x${rows}`. 같으면 다시 만들지 않는다(선택·포커스 보존). */
  let rowOptionsSig = null;
  /** 이 세션에서 패널을 한 번이라도 열었는가. 좁은 화면의 '첫 열기는 접힌 채로' 판정에 쓴다. */
  /** 마지막 보정점 추가가 거부됐는가(앞뒤 점과 순서가 맞지 않음). 다음 성공이나 지우기가 지운다. */
  let pointRejected = false;
  /** 마지막 `박자에 반영` 이 거부된 마커 id. 다음 성공이나 마커 변경이 지운다. */
  let markerRejectedId = '';
  /** 띄운 창의 `position: fixed` 기준점(floatOrigin). 창 크기가 바뀌면 버린다. */
  let floatOriginCache = null;
  /** 창이 지금 무엇 때문에 떠 있는가 — `'float'`(⤢ 크게) · `'pip'`(받아 적는 중) · `null`(제자리). */
  let detachMode = null;

  // ── store 읽기 (얇은 접근자) ──────────────────────────────────────────────

  /** 휘발성 화면 상태. usecases/videoCommands.panelState 와 같은 기본값을 쓴다. */
  const panelState = () => store.get().session.video || DEFAULT_PANEL;
  /** 확정된 Tempo. 손상된 값·없는 값은 normalizeTempo 가 흡수한다(bpm 0 = 미설정). */
  /** 지금 보고 있는 영상. 박자·마커는 **영상마다 따로**다(2026-09-12) — 목록은 clips() 가 준다. */
  const clip = () => activeClipOf(store.media);
  /** 이 안무에 달린 영상 전부. */
  const clips = () => normalizeMedia(store.media);
  const tempo = () => normalizeTempo(clip().tempo);
  const markers = () => normalizeMarkers(clip().markers);
  const mainBoard = () => store.board(BOARD_MAIN);
  /** In·Out 이 둘 다 있고 순서가 맞으면 그 구간, 아니면 null. usecases/videoCommands.inOutRange 와 같은 규칙이다. */
  const inOutRange = () => {
    const p = panelState();
    return Number.isFinite(p.inSec) && Number.isFinite(p.outSec) && p.outSec > p.inSec ? { inSec: p.inSec, outSec: p.outSec } : null;
  };

  /** 지금 고른 것 가운데 **이름 없는** 블록이 몇 그룹인가. `고른 블록에 이름 붙이기` 의 활성 판정. */
  const pendingSelected = () => {
    const placements = mainBoard().placements;
    return [...(store.selection || [])].filter(gid => placements.some(p => p.groupId === gid && p.pending)).length;
  };

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

  /**
   * 안무표에서 **정확히 한 그룹**이 선택돼 있으면 그 그룹의 시작 선형 카운트, 아니면 null.
   * 루틴처럼 여러 세그먼트로 된 그룹은 가장 앞 세그먼트의 시작이다(domain/tempo.groupToSpan 과 같은 규칙).
   * @returns {number|null}
   */
  function selectedStartCount() {
    const sel = store.selection;
    if (!sel || sel.size !== 1) return null;
    const [groupId] = [...sel];
    const board = mainBoard();
    let min = null;
    for (const p of board.placements) {
      if (p.groupId !== groupId) continue;
      const start = linearOf(p.row, p.startIndex, board.cols);
      if (min === null || start < min) min = start;
    }
    return min;
  }

  /**
   * 안무표에서 선택된 그룹들이 덮는 선형 카운트 구간 [from, to) 과 이름들. 선택이 없으면 null.
   * 여러 그룹이면 가장 앞 시작 ~ 가장 뒤 끝이다(사이의 빈틈은 그냥 포함한다 — domain/tempo.groupToSpan 과 같은 규칙).
   * @returns {{from:number, to:number, names:string[]}|null}
   */
  function selectedRange() {
    const sel = store.selection;
    if (!sel || sel.size === 0) return null;
    const board = mainBoard();
    let from = null;
    let to = null;
    const names = [];
    for (const p of board.placements) {
      if (!sel.has(p.groupId)) continue;
      const start = linearOf(p.row, p.startIndex, board.cols);
      const end = start + p.length;
      if (from === null || start < from) from = start;
      if (to === null || end > to) to = end;
      if (!names.includes(p.name)) names.push(p.name);
    }
    return from === null ? null : { from, to, names };
  }

  /** `여기가 [행]` 칸이 가리키는 마디 전체의 선형 카운트 구간 [from, to). */
  function anchorRowRange() {
    const board = mainBoard();
    const row = Number(anchorRow && anchorRow.value);
    const safeRow = Number.isFinite(row) ? row : 1;
    const from = linearOf(safeRow, 0, board.cols);
    return { from, to: from + board.cols, row: safeRow };
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
    const source = getSource();
    const isFile = !!source && source.kind === 'file';
    // 제목 칩: 유튜브면 링크바가 이미 조회해 둔 제목(두 번 조회하지 않는다), 파일이면 파일명이다.
    const title = isFile ? source.name : ((store.links && store.links.youtubeTitle) || '');
    if (titleChip) {
      titleChip.hidden = !title;
      titleChip.textContent = title;
      titleChip.title = title;
    }
    // 파일 줄: 이름 칩과 놓기 버튼은 파일 소스일 때만 보인다.
    const inLibrary = isFile && !!source.path;
    if (fileName) {
      fileName.hidden = !isFile;
      fileName.textContent = isFile ? source.name : '';
      // 보관 폴더에 있는 파일은 툴팁에 경로를 보여 준다 — 어디 복사됐는지가 곧 이 기능의 약속이다.
      fileName.title = inLibrary ? source.path : (isFile ? source.name : '');
    }
    if (fileClearBtn) fileClearBtn.hidden = !isFile;
    if (fileLibBtn) fileLibBtn.hidden = !(inLibrary && !getFileLoaded());
    if (fileBtn) fileBtn.textContent = isFile ? '📁 다른 파일 열기' : '📁 영상 파일 열기';

    if (!statusEl) return;
    if (isFile && !getFileLoaded()) {
      // 저장 파일에서 연 직후. 이름은 아는데 파일이 없다 — 오류가 아니라 안내다.
      statusEl.textContent = inLibrary
        ? (getLibraryState() === 'missing' ? LIB_MISSING_TEXT(source.path) : LIB_TEXT(source.path))
        : REPICK_TEXT(source.name);
      statusEl.classList.remove(CLS.isError);
      return;
    }
    const url = getSourceUrl();
    if (!url && !isFile) {
      statusEl.textContent = NO_SOURCE_TEXT;
      statusEl.classList.remove(CLS.isError);
      return;
    }
    // 주소는 있는데 널 재생기다 = 유튜브 주소로 알아보지 못했다. 오류가 아니라 안내다.
    if (!isFile && getPlayerKind() === 'null') {
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
  /**
   * 탭 줄 아래 한 줄. **BPM 숫자가 아니라 "표 끝에서 몇 카운트"로 말한다** — 0.2% 차이는 숫자로는
   * 작아 보이지만 52마디 끝에서는 재생 헤드가 한 칸 가까이 밀린다. 사람이 고를 수 있는 단위로 옮긴다.
   *
   * ⚠ 탭의 불확실도는 간격의 흔들림을 탭 수로 나눈 것이다(평균의 표준오차 ≈ 흔들림/√(n-1)).
   *   그래서 탭을 더 두드릴수록 이 수가 줄고, 언제 그만 두드려도 되는지가 화면에 보인다.
   * @param {number[]} taps
   * @param {{bpm:number}} t 지금 확정된 템포
   * @param {{rows:number, cols:number}} board
   * @returns {string}
   */
  function tapHelpText(taps, t, board) {
    const totalCounts = Math.max(1, board.rows * board.cols);
    if (taps.length < 2) {
      return '박자에 맞춰 네 번 이상 두드리세요. 재생 중이면 영상 시계로, 멈춰 있으면 지금 시각으로 잽니다.';
    }
    const bpm = bpmFromTaps(taps, 1);
    if (bpm === null) return '두드린 간격을 읽지 못했습니다 — `탭 지우기` 로 다시 시작하세요.';

    const parts = [`탭 ${taps.length}번 → ${formatBpm(bpm)} BPM`];
    const spread = tapSpread(taps);
    if (spread !== null) {
      const stdErr = spread / Math.sqrt(Math.max(1, taps.length - 1));
      const own = driftCounts(bpm * (1 + stdErr), bpm, totalCounts);
      parts.push(`흔들림 ±${(spread * 100).toFixed(1)}%`);
      if (own !== null) parts.push(`이대로면 표 끝에서 ±${own.toFixed(1)}카운트`);
    }
    // 이미 정해 둔 값이 있으면 **둘의 차이**를 같은 단위로 말한다 — 그것이 하이브리드의 판단 근거다.
    if (isTempoUsable(t)) {
      const gap = driftCounts(bpm, t.bpm, totalCounts);
      if (gap !== null) {
        parts.push(gap < 0.5
          ? `지금 값(${formatBpm(t.bpm)})과 표 끝에서 ${gap.toFixed(1)}카운트 차이 — 바꿀 것 없습니다`
          : `지금 값(${formatBpm(t.bpm)})과 표 끝에서 ${gap.toFixed(1)}카운트 차이`);
      }
    } else {
      parts.push('두 점 맞추기(위)가 훨씬 정확합니다 — 멀리 떨어진 두 지점일수록 좋습니다');
    }
    return parts.join(' · ');
  }

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

    // 탭 템포. 재생 중이면 미디어 시계로, 멈춰 있으면 지금 시각으로 잰다(tapClockSec).
    const taps = p.taps || [];
    if (tapBtn) tapBtn.textContent = taps.length ? `탭 (${taps.length})` : '탭';
    if (tapCommitBtn) tapCommitBtn.disabled = taps.length < 2;
    if (tapClearBtn) tapClearBtn.disabled = taps.length === 0;
    if (tapHelp) tapHelp.textContent = tapHelpText(taps, t, board);

    // 직접 입력 — ⚠ 타이핑 중에는 되쓰지 않는다(커서가 끝으로 튀고 입력이 잘린다).
    if (bpmInput && document.activeElement !== bpmInput) bpmInput.value = ready ? formatBpm(t.bpm) : '';
    if (bpcInput && document.activeElement !== bpcInput) bpcInput.value = String(t.beatsPerCount);
    if (reanchorBtn) reanchorBtn.disabled = !ready;
    if (tempoClearBtn) tempoClearBtn.disabled = !ready;

    // 보정점. "지금 몇 개가 어디에 찍혀 있는지"를 화면이 말한다 — 안 보이는 보정은 없는 보정이다.
    const pts = t.points || [];
    const selStart = selectedStartCount();
    if (pointBtn) pointBtn.disabled = !ready;
    if (pointSelBtn) pointSelBtn.disabled = !ready || selStart === null;
    if (pointClearBtn) pointClearBtn.disabled = pts.length === 0;
    if (pointHelp) {
      if (pointRejected) {
        pointHelp.textContent = '앞뒤 보정점과 순서가 맞지 않아 넣지 않았습니다 — 앞 카운트는 앞 시각에, 뒤 카운트는 뒤 시각에 와야 합니다.';
      } else if (!ready) {
        pointHelp.textContent = 'BPM 을 먼저 정한 뒤, 템포가 흔들리는 대목마다 보정점을 찍으면 그 사이가 저절로 맞습니다.';
      } else if (pts.length === 0) {
        pointHelp.textContent = '보정점 없음 — 세로선이 실제 동작보다 앞서거나 뒤처지는 대목에서 그 카운트(또는 선택한 블록)가 시작하는 순간에 누르세요.';
      } else {
        const shown = pts.slice(0, 6).map(pt => `${formatCell(pt.count, board.cols)} = ${formatClock(pt.sec)}`).join(' · ');
        pointHelp.textContent = `보정점 ${pts.length}개: ${shown}${pts.length > 6 ? ' · …' : ''}`;
      }
    }
  }

  /**
   * 받아 적기 구획(2026-09-12). 버튼 하나가 두 뜻을 번갈아 가진다 — 시작을 안 찍었으면 `● 여기서 시작`,
   * 찍었으면 `■ 여기서 끝`. 두 버튼으로 나누면 눈이 영상을 떠나 어느 쪽을 누를지 고르게 된다.
   *
   * ⚠ 진행 중 표시는 store 의 captureSec 에서 재도출한다(뷰가 따로 기억하지 않는다) — 패널을 접었다
   *   펴거나 다른 렌더가 끼어들어도 표시가 어긋나지 않는다.
   */
  function renderCapture() {
    const start = panelState().captureSec;
    const running = Number.isFinite(start);
    const ready = isTempoUsable(tempo());
    // ── 받아 적기는 두 걸음: 처음으로 → 끊기 (2026-09-22) ──────────────────────
    // **`끊기` 하나가 처음부터 끝까지 맡는다.** 처음 누른 자리가 1카운트이고, 그 뒤로는 경계다.
    // ⚠⚠ 한때 첫 타를 `● 여기가 1카운트` 라는 다른 버튼으로 갈라 두었다(2026-09-21). 손이 하는
    //    일은 첫 타든 열째 타든 **같은 한 번의 누름**(`K`)인데 버튼만 둘이라, "지금은 어느 쪽인가"를
    //    도로 읽게 만들었다 — 가르지 않는 편이 낫다.
    // ⚠ 라벨도 바뀌지 않는다. 한 자리에서 글자가 오락가락하면 그것도 읽어야 하는 일이 된다.
    //   지금 받는 중인지는 **안내 줄**(captureHelp)이 시각까지 들어 말해 준다.
    if (captureBtn) {
      captureBtn.disabled = !ready;
    }
    if (captureSkipBtn) captureSkipBtn.disabled = !ready;
    if (captureCancelBtn) captureCancelBtn.disabled = !running;
    // 받는 중에만 붙는 꼬리 문장 — 오른쪽 위 배지와 **같은 판정**을 말로 푼다(2026-09-22).
    // ⚠ 배지는 짧게(`· 영상이 더 느림 ≈126`), 여기는 **무엇을 하면 되는지**까지 적는다.
    //   같은 사실을 두 번 적는 것이 아니라, 눈길이 닿는 자리마다 필요한 만큼만 적는 것이다.
    function driftSentence() {
      const t = tempo();
      const report = driftReport(panelState().captureDrift, t.bpm);
      if (report.state === 'fast' || report.state === 'slow') {
        const dir = report.state === 'fast' ? '빠릅니다' : '느립니다';
        const est = report.bpmEstimate ? ` 끊은 자리로 다시 재면 약 ${formatBpm(report.bpmEstimate)} BPM 입니다 —` : '';
        return ` ⚠ 끊은 자리가 갈수록 밀립니다: 영상이 지금 BPM(${formatBpm(t.bpm)})보다 ${dir}.${est}`
          + ' 지금 받는 것을 끝내고 `② 박자 맞추기` 에서 고치면 그다음부터 맞습니다(여기서 저절로 바꾸지는 않습니다).';
      }
      if (report.state === 'lag') {
        const dir = report.mean > 0 ? '늦게' : '일찍';
        return ` 끊은 자리가 고르게 ${dir} 찍힙니다(평균 ${Math.abs(report.mean).toFixed(2)}카운트).`
          + ' 박자가 아니라 손이라서, 다 받은 뒤 아래 `표 전체 옮기기` 한 번이면 됩니다.';
      }
      return '';
    }

    // 표 전체 옮기기는 박자와 무관하다 — 놓인 블록이 있으면 쓸 수 있다.
    const hasBlocks = typeof commands.canShiftAll === 'function' ? commands.canShiftAll() : false;
    if (shiftBackBtn) shiftBackBtn.disabled = !hasBlocks;
    if (shiftFwdBtn) shiftFwdBtn.disabled = !hasBlocks;
    if (markerBlocksBtn) markerBlocksBtn.disabled = markers().length === 0;
    const pending = pendingSelected();
    if (nameSelBtn) {
      nameSelBtn.disabled = pending === 0;
      nameSelBtn.textContent = pending > 1 ? `고른 블록 ${pending}개에 이름 붙이기` : '고른 블록에 이름 붙이기';
    }
    if (captureHelp) {
      if (!ready) {
        captureHelp.textContent = '먼저 `② 박자 맞추기` 에서 BPM 을 정하세요 — 영상의 초를 안무표의 카운트로 바꾸는 데 박자가 필요합니다.';
      } else if (running) {
        captureHelp.textContent = `${formatClock(start)} 부터 받는 중 — 동작이 바뀌는 자리마다 \`B\` 나 \`K\`. `
          + '안무가 아닌 대목은 `N` 으로 건너뛰고, 스페이스로 재생을 멈췄다 이어 갑니다. 다 되면 `Esc` 나 `■ 그만`.'
          + driftSentence();
      } else {
        captureHelp.textContent = '`⏮ 처음으로` 로 되감고, 안무가 시작하는 순간 `▮ 끊기`(`K` 나 `B`)를 누르세요 — '
          + '**처음 누른 자리가 1카운트**입니다. 그 뒤로는 동작이 바뀌는 자리마다 한 번씩 누르면 그 사이가 이름 없는 블록(`?`)으로 놓입니다. '
          + '누른 자리는 **두 카운트 격자**(1·3·5·7박)에 붙습니다 — 한 카운트 어긋난 자리에서 시작하는 동작은 없으므로 손의 오차는 여기서 걸러집니다. '
          + '한 동작의 끝이 곧 다음 동작의 시작이라 두 번 누를 필요가 없습니다. 이름은 나중에 붙입니다. 스페이스로 재생을 멈췄다 이어 갑니다.';
      }
      captureHelp.classList.toggle(CLS.isError, false);
    }
    renderVoice(ready, running);
  }

  /**
   * 마이크 줄 (2026-09-22). 세 가지를 말한다 — 켜져 있나 · 지금 듣고 있나 · 지금 붙을 이름은 무엇인가.
   *
   * ⚠ 「켜져 있다」와 「듣고 있다」는 다르다. 크롬은 조용하면 스스로 멈추고 우리가 다시 켠다.
   *   그 틈을 `wait` 로 드러낸다 — 안 듣는 줄 모르고 말하는 것이 이 기능의 가장 나쁜 실패다.
   * ⚠ 받아 적는 중이 아니면 마이크를 켤 수 없다. 붙일 구간이 없기 때문이다.
   */
  function renderVoice(ready, running) {
    const usable = Boolean(voice && voice.available());
    if (voiceField) voiceField.hidden = !usable;
    if (voiceHelp) voiceHelp.hidden = !usable;
    if (!usable) return;

    const wanted = voice.wanted();
    const listening = voice.listening();
    const heard = voice.heard ? voice.heard() : null;

    if (voiceBtn) {
      voiceBtn.disabled = !ready || (!running && !wanted);
      voiceBtn.textContent = wanted ? '🎤 마이크 끄기' : '🎤 마이크 켜기';
      voiceBtn.dataset.listening = wanted ? (listening ? 'on' : 'wait') : 'off';
    }
    if (voiceNow) {
      voiceNow.hidden = !heard;
      if (heard) {
        voiceNow.textContent = heard.name === heard.heard ? heard.name : `${heard.name} ← “${heard.heard}”`;
        voiceNow.dataset.sure = heard.needsLlm ? 'no' : 'yes';
      }
    }
    if (voiceHelp) {
      const err = voice.error();
      voiceHelp.classList.toggle(CLS.isError, Boolean(err));
      if (err) {
        voiceHelp.textContent = err;
      } else if (!ready) {
        voiceHelp.textContent = '박자를 먼저 정해야 합니다 — 붙일 구간이 있어야 이름을 받을 수 있습니다.';
      } else if (!wanted) {
        voiceHelp.textContent = '받아 적는 동안 동작 이름을 말하면 **그때 열려 있던 구간**에 붙습니다. '
          + '`▮ 끊기` 로 구간을 연 뒤 영상을 보면서 말하세요. 잘못 들었으면 그 구간 안에서 한 번 더 말하면 나중 것이 이깁니다. '
          + '⚠ 크롬은 음성을 **구글 서버로 보내** 인식합니다(끌 수 없습니다).';
      } else if (!listening) {
        voiceHelp.textContent = '⏸ 잠깐 멈췄습니다 — 다시 켜는 중입니다. 지금 말한 것은 놓칠 수 있습니다.';
      } else if (heard) {
        voiceHelp.textContent = heard.needsLlm
          ? `“${heard.heard}” 로 붙습니다. 동작 목록에서 못 찾아서, 놓인 뒤 LLM 이 정식 이름으로 고쳐 끼웁니다.`
          : `\`${heard.name}\` 으로 붙습니다 — 동작 목록에 있는 이름입니다.`;
      } else {
        voiceHelp.textContent = '🎤 듣고 있습니다. 이 구간의 동작 이름을 말하세요.';
      }
    }
  }

  /**
   * 이 영상이 어디에 남아 있는가. **파일을 연 사람에게만 뜻이 있다** — 유튜브는 주소가 곧 원본이다.
   * `path` 가 있으면 어딘가에 복사가 끝난 것이고, 없으면 이 기기의 고른 파일에만 기대고 있다.
   * @param {{kind?:string, path?:string}|null} source
   * @returns {string} 빈 문자열이면 줄에 아무것도 붙이지 않는다
   */
  function storageOf(source) {
    if (!source || source.kind !== 'file') return '';
    if (!source.path) return '이 기기에만';
    return getStorageMode() === 'server' ? '서버에 보관됨' : '보관 폴더에 있음';
  }

  /**
   * 영상 목록(2026-09-12). 한 줄이 영상 하나고, 그 영상이 안무표의 어디를 덮는지를 막대로 보여 준다.
   *
   * ⚠ 커버리지는 **마커가 말한다.** 마커가 없으면 0% 막대가 아니라 `마커 없음` 이다 — 영상을 올리고
   *   아직 안 찍었을 뿐일 수 있고, 0% 막대는 "이 영상은 아무 데도 안 맞는다"는 거짓말이 된다.
   * ⚠ 전체 카운트는 메인 보드에서 읽는다. 안무표 크기를 바꾸면 막대 비율도 함께 달라진다.
   */
  function renderClips() {
    if (!clipList) return;
    const { clips: list, activeId } = clips();
    const board = mainBoard();
    const total = Math.max(1, (board.rows + (board.hasIntroRow ? 1 : 0)) * board.cols);
    if (clipHelp) {
      clipHelp.textContent = list.length === 0
        ? '영상을 고르면 여기 쌓입니다. 같은 안무를 여러 번 찍었으면 영상마다 박자와 마커가 따로 삽니다.'
        : `영상 ${list.length}개 — 줄을 누르면 그 영상으로 갈아탑니다(박자·마커가 함께 바뀝니다).`;
    }
    clipList.innerHTML = '';
    for (const c of list) {
      const li = document.createElement('li');
      li.className = 'video-clip' + (c.id === activeId ? ' is-active' : '');
      li.dataset.clipId = c.id;

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'video-clip-pick';
      pick.dataset.act = 'pick';
      pick.textContent = c.id === activeId ? '◉' : '○';
      pick.title = c.id === activeId ? '지금 보고 있는 영상' : '이 영상으로 갈아타기';

      const main = document.createElement('div');
      main.className = 'video-clip-main';
      const name = document.createElement('div');
      name.className = 'video-clip-name';
      name.textContent = c.name;
      const sub = document.createElement('div');
      sub.className = 'video-clip-sub';
      const cov = clipCoverage(c);
      const src = c.source ? (c.source.kind === 'file' ? c.source.name : '유튜브') : '소스 없음';
      // 보관 상태를 줄에 적는다(2026-09-13). 그전에는 서버가 파일을 받아 두고도 화면이 아무 말을
      // 하지 않아, 올린 사람이 "저장이 안 됐나" 하고 같은 파일을 또 골랐다.
      const keep = storageOf(c.source);
      sub.textContent = [src, keep, cov
        ? `${formatRange(cov.fromCount, cov.toCount - 1, board.cols)} · 마커 ${cov.markers}개`
        : '마커 없음'].filter(Boolean).join(' · ');
      sub.title = sub.textContent;
      main.append(name, sub);
      if (cov) {
        const bar = document.createElement('div');
        bar.className = 'video-clip-bar';
        const fill = document.createElement('span');
        const from = clamp(cov.fromCount, 0, total);
        const to = clamp(cov.toCount, 0, total);
        fill.style.left = `${(from / total) * 100}%`;
        fill.style.width = `${Math.max(2, ((to - from) / total) * 100)}%`;
        bar.appendChild(fill);
        main.appendChild(bar);
      }

      const acts = document.createElement('div');
      acts.className = 'video-clip-acts';
      const ren = document.createElement('button');
      ren.type = 'button'; ren.className = CLS.ghost;
      ren.textContent = '✎'; ren.title = '이름 바꾸기';
      ren.onclick = () => {
        if (!commands.renameClip) return;
        const next = dialogs.promptText('이 영상의 이름', c.name);
        if (next == null) return;
        render(commands.renameClip({ id: c.id, name: next }));
        commitHistory();
      };
      const del = document.createElement('button');
      del.type = 'button'; del.className = CLS.ghost;
      del.textContent = '✕'; del.title = '이 영상을 목록에서 빼기(찍어 둔 박자·마커도 함께 사라집니다)';
      // ⚠ 되돌리는 길이 Undo 하나뿐이라 2단계 확인을 받는다(이 저장소의 confirmOnce 관습).
      del.onclick = () => confirmOnce(del, '✕', () => {
        if (!commands.removeClip) return;
        render(commands.removeClip({ id: c.id }));
        commitHistory();
      });
      acts.append(ren, del);

      // 줄 아무 데나 눌러도 갈아탄다 — 작은 ○ 만 과녁이면 손가락으로 못 맞힌다.
      const pickIt = () => {
        if (!commands.selectClip) return;
        render(commands.selectClip({ id: c.id }));
      };
      pick.onclick = pickIt;
      main.onclick = pickIt;

      li.append(pick, main, acts);
      clipList.appendChild(li);
    }
  }

  // ── 띄운 창의 자리와 크기 ──────────────────────────────────────────────────
  //
  // ⚠ 값은 **인라인 스타일**로만 쓴다. CSS 의 기본 자리(오른쪽 아래·min(56vw,1100px))는 그대로 두고,
  //   사용자가 옮기거나 크기를 바꾼 뒤에만 덮어쓴다 — 그래야 처음 띄울 때 화면 크기를 따라간다.
  // ⚠ 창이 화면 밖으로 나가지 않게 가둔다. 끌다 놓친 창을 되찾을 길이 없으면 새로고침밖에 없다.

  /** 영상이 아무리 커도 이보다 작지는 않다 — 이만큼도 못 주는 창이면 띠 자체가 무의미하다. */
  const BAND_MIN_H = 200;
  /**
   * 띠 아래에 **반드시 남겨 둘** 안무표의 세로(px). 캔버스 바(약 60)와 서너 줄이 들어갈 만큼이다.
   * ⚠ 영상 크기는 이 수를 뺀 나머지로 정한다 — 그래서 창이 크면 영상이 크고, 작으면 안무표가 먼저다.
   *   고정 비율(0.38vh)로 두면 큰 창에서는 좌우가 남고 작은 창에서는 표가 두 줄만 남았다(2026-09-21).
   */
  const BOARD_MIN_H = 260;
  /** 띠와 안무표 사이, 그리고 띠 위쪽의 틈(px). */
  const BAND_GAP = 8;
  /**
   * 띠 바로 아래 붙는 조작 줄(`#thumbBar`)의 높이(px).
   * ⚠ CSS 의 `body[data-videoband="on"] .thumb-bar { height: … }` 와 **같은 수**다. 재서 쓰지 않는다 —
   *   그 줄의 버튼은 ui/thumbBar 가 이 함수 **뒤에** 그리므로, 첫 렌더에 재면 빈 줄의 높이가 나와
   *   안무표가 그만큼 덜 밀리고 첫 마디가 줄 밑에 깔린다. 한쪽을 고치면 다른 쪽도 고친다.
   */
  const BAND_DOCK_H = 44;

  /** 화면 크기에 맞춘 `⤢ 크게` 의 기본 폭. 큰 모니터에서 너무 커지지 않게 위를 막는다. */
  function defaultFloatWidth() {
    return Math.round(Math.max(420, Math.min(window.innerWidth * 0.56, 1100)));
  }

  /**
   * 기록에 쓰는 단계 이름. 마크업 순서가 곧 이름이라 라벨을 고쳐도 기록이 끊기지 않는다.
   * @param {number} i 0-based
   */
  const stepId = (i) => `step${i + 1}`;

  /** 눕힌 띠의 단계들(①~⑥). `.vsub`(고급)은 자식이 아니라 손자라 걸리지 않는다. */
  const STEP_SEL = '.video-body > .vstep';
  const stepEls = () => [...document.querySelectorAll(STEP_SEL)];

  /**
   * 띠에 들어설 때 열어 둘 단계 — **아직 안 끝난 첫 단계**다. 영상이 없으면 ①, 박자가 없으면 ②,
   * 둘 다 됐으면 ③(받아 적기). 차례대로 하는 일이라 "다음에 무엇을 하나"의 답이 곧 이것이다.
   *
   * ⚠ **들어설 때 한 번만** 정한다. 렌더마다 다시 정하면 사용자가 연 단계가 자꾸 닫힌다.
   * @returns {number} 0-based
   */
  function firstUnfinishedStep() {
    if (!clip().source) return 0;
    if (!isTempoUsable(tempo())) return 1;
    return 2;
  }

  /** 그 하나만 연다. 띠에서는 여러 단계가 동시에 펼쳐지면 안무표가 화면 밖으로 밀려난다. */
  function openOnlyStep(idx) {
    stepEls().forEach((el, i) => { el.open = i === idx; });
    renderFlowSteps();
  }

  /**
   * 단계 이름을 버튼에 앉힐 만큼 줄인다 — `③ 받아 적기 — 보면서 표에 놓기` → `받아 적기`.
   *
   * 떼는 것이 둘이다.
   *  · `— …` 뒤의 설명 — 여섯을 한 줄에 놓아야 한다(펼치면 본문이 그대로 말해 준다).
   *  · 앞머리의 **동그라미 숫자**(①~⑨) — 아이콘이 이미 그 자리에 있고, 번호는 왼쪽에서
   *    오른쪽으로 이어진 줄이 이미 말한다. 아이콘·번호·✓·이름이 한 칸에 겹치면 넷 다 안 읽힌다.
   * @param {Element} el `<details class="vstep">`
   * @returns {string}
   */
  function stepLabel(el) {
    const raw = (el.querySelector('summary')?.textContent || '').trim();
    const head = raw.split('—')[0].trim() || raw;
    // U+2460~2473 = ① ~ ⑳. 마크업의 `<summary>` 는 번호를 그대로 둔다(패널에서는 차례가 글자다).
    return head.replace(/^[\u2460-\u2473]\s*/, '').trim() || head;
  }

  /**
   * 그 단계가 이미 끝났는가. ①은 영상이, ②는 박자가, ③은 놓인 블록이 있으면 끝이다.
   * ④~⑥은 있으면 좋은 것이지 차례가 아니라 **끝났다고 말하지 않는다**(거짓 완료 표시가 된다).
   * @param {number} idx
   * @returns {boolean}
   */
  function stepDone(idx) {
    if (idx === 0) return Boolean(clip().source);
    if (idx === 1) return isTempoUsable(tempo());
    if (idx === 2) return mainBoard().placements.length > 0;
    return false;
  }

  /**
   * 작업 차례를 **화살표로 이은 버튼 줄**로 그린다(2026-09-21). 눕힌 띠에서만 보인다.
   *
   * ⚠ 이름과 순서의 주인은 마크업의 `<details class="vstep">` 들이다 — 여기서 목록을 손으로 적지
   *   않는다. 단계를 하나 더하면 `<details>` 만 더하면 이 줄이 저절로 늘어난다(개발 원칙 R-8).
   * ⚠ 엄지 바와 같은 규약으로 **버튼을 갈아 끼우지 않는다.** 누르는 순간 엘리먼트가 사라지면 그
   *   클릭이 허공에 떨어진다. 같은 자리면 라벨·상태만 고친다.
   */
  function renderFlowSteps() {
    if (!flowSteps || detachMode !== 'band') return;
    const els = stepEls();
    const btns = reconcileFlowChildren(els.length);
    // 지금까지의 버릇이 짚어 주는 다음 자리. **없으면 아무 표식도 붙지 않는다** —
    // 표본이 모자랄 때 우연히 한 번 누른 길을 `다음` 이라고 내세우지 않는다(domain/flowStats).
    const suggested = flow.suggest();
    els.forEach((el, i) => {
      const btn = btns[i];
      if (!btn) return;
      const done = stepDone(i);
      // 아이콘의 주인은 **마크업의 `data-icon`** 이다(이름과 같다) — 여기에 목록을 적지 않는다.
      const icon = btn.querySelector('.flow-icon');
      const nameEl = btn.querySelector('.flow-name');
      if (icon) icon.textContent = el.dataset.icon || '·';
      // ⚠ `✓` 를 이름 앞에 붙이지 않는다 — 끝난 것은 **색**이 말한다(data-state="done").
      //   아이콘·✓·번호·이름 넷을 한 칸에 욱여넣으면 넷 다 안 읽힌다.
      if (nameEl) nameEl.textContent = stepLabel(el);
      btn.dataset.state = el.open ? 'now' : (done ? 'done' : 'todo');
      // ⚠ 표식일 뿐이다. 버튼의 **자리도 순서도 크기도 바뀌지 않는다** — 손에 익은 과녁이
      //   통계 때문에 옮겨 다니면 그것은 적응이 아니라 과녁이 흔들리는 것이다.
      if (!el.open && suggested === stepId(i)) btn.dataset.next = '1';
      else delete btn.dataset.next;
      // 남은 할 일 수. **0 이면 표식을 지운다** — 0 이라고 적힌 배지는 아무 말도 하지 않으면서
      // 자리만 차지한다(CSS 는 이 값이 있을 때만 배지를 그린다).
      const open = openCount(store.get().stepTodos, stepId(i));
      if (open > 0) btn.dataset.todo = String(open);
      else delete btn.dataset.todo;
      btn.setAttribute('aria-expanded', String(Boolean(el.open)));
      // ⚠ onclick 대입이다(addEventListener 가 아니다) — 다시 그릴 때마다 붙이면 한 번 누른 것이
      //   두 번 돌아간다. 여는 일 자체는 `toggle` 리스너가 나머지를 닫아 준다.
      // ⚠ **사람이 누른 것만** 센다. openOnlyStep 이 프로그램으로 여는 것은 차례가 아니다.
      btn.onclick = () => { el.open = true; flow.note(stepId(i)); };
    });
    drawFlowTrack(els.length);
    renderStepTodos();
  }

  /**
   * 단계마다 **그 단계에서 할 일**을 적어 둔다(2026-09-21). 적는 자리가 그 일을 할 자리와 같아서,
   * 나중에 그 단계를 열면 거기 있다.
   *
   * ⚠ 마크업에 목록을 만들지 않는다 — 단계가 늘면 여섯 벌을 손으로 베껴야 한다. 여기서 각
   *   `.vstep-body` 에 한 번 붙이고 그 뒤로는 내용만 고친다.
   * ⚠ **열린 단계만** 그린다. 닫힌 `<details>` 안은 어차피 안 보이고, 여섯 벌을 매번 그리면
   *   받아 적는 동안 블록 하나마다 도는 렌더가 그만큼 무거워진다.
   * ⚠ 입력 중에는 커밋하지 않는다. 확정(Enter·`+ 추가`)에서만 히스토리에 넣는다 — 글자마다
   *   커밋하면 되돌리기 한 번이 한 글자를 지운다.
   */
  function renderStepTodos() {
    stepEls().forEach((el, i) => {
      if (!el.open) return;
      const body = el.querySelector('.vstep-body');
      if (!body) return;
      let box = body.querySelector('.step-todo');
      if (!box) {
        box = document.createElement('div');
        box.className = 'step-todo';
        box.innerHTML = '<div class="step-todo-head"></div><div class="step-todo-list"></div>'
          + '<div class="step-todo-add"><input type="text" placeholder="여기서 할 일을 적어 둡니다 — Enter" maxlength="120" />'
          + '<button type="button" class="ghost accent">+ 추가</button></div>';
        body.appendChild(box);
        const input = box.querySelector('input');
        const addBtn = box.querySelector('button');
        const submit = () => {
          const text = input.value.trim();
          if (!text) return;
          input.value = '';
          applyCommitting({ ...commands.addStepTodo({ stepId: stepId(i), text }), committed: true });
          renderStepTodos();
        };
        addBtn.onclick = submit;
        // ⚠ keydown 이다. `change` 로 받으면 Enter 와 포커스 이동이 같은 뜻이 되어, 다른 칸으로
        //   옮기기만 해도 할 일이 하나 생긴다.
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      }
      const list = (store.get().stepTodos || {})[stepId(i)] || [];
      const head = box.querySelector('.step-todo-head');
      const open = list.filter(t => !t.done).length;
      head.textContent = list.length
        ? `할 일 ${open}개 남음 · 모두 ${list.length}개`
        : '할 일 — 지금 멈추지 않고 적어 두었다가 나중에 처리합니다';
      const listEl = box.querySelector('.step-todo-list');
      listEl.textContent = '';
      for (const todo of list) {
        const row = document.createElement('div');
        row.className = 'step-todo-row' + (todo.done ? ' is-done' : '');
        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'step-todo-check';
        check.textContent = todo.done ? '☑' : '☐';
        check.title = todo.done ? '아직 안 한 것으로' : '했다고 표시';
        check.onclick = () => {
          applyCommitting({ ...commands.toggleStepTodo({ stepId: stepId(i), id: todo.id }), committed: true });
          renderStepTodos();
        };
        const text = document.createElement('span');
        text.className = 'step-todo-text';
        text.textContent = todo.text;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'step-todo-del';
        del.textContent = '✕';
        del.title = '이 할 일을 지웁니다';
        del.onclick = () => {
          applyCommitting({ ...commands.removeStepTodo({ stepId: stepId(i), id: todo.id }), committed: true });
          renderStepTodos();
        };
        row.append(check, text, del);
        listEl.appendChild(row);
      }
    });
  }

  /**
   * 줄에 필요한 만큼 버튼과 화살표를 맞춰 두고 **버튼만** 돌려준다.
   *
   * ⚠⚠ **자리(index)로 찾지 않는다.** 길 SVG 가 이 줄의 **첫 자식**으로 들어오기 때문에
   *   `children[i * 2]` 는 한 칸씩 밀려 화살표를 가리킨다 — 2026-09-21 에 실제로 그랬고, 그래서
   *   길을 그린 뒤의 렌더는 상태·배지를 엉뚱한 요소에 썼다(화면은 옛 값 그대로였다).
   *   클래스로 찾으면 앞에 무엇이 더 붙어도 흔들리지 않는다.
   * ⚠ 버튼을 갈아 끼우지 않는다 — 누르는 순간 사라지면 그 클릭이 허공에 떨어진다(엄지 바와 같은 규약).
   * @param {number} count 단계 수
   * @returns {HTMLElement[]} 차례대로의 단계 버튼
   */
  function reconcileFlowChildren(count) {
    const isTrack = (n) => n.classList && n.classList.contains('flow-track');
    let nodes = [...flowSteps.children].filter(n => !isTrack(n));
    const want = Math.max(0, count * 2 - 1);   // 버튼 n 개 + 화살표 n-1 개
    while (nodes.length > want) nodes.pop().remove();
    while (nodes.length < want) {
      const i = nodes.length;
      let el;
      if (i % 2 === 0) {
        // ⚠ 아이콘과 이름을 **따로** 담는다. 한 덩이 글자로 두면 테마가 아이콘만 발광하는 마디로
        //   키울 수가 없다(테마가 그렇게 한다).
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'flow-step';
        const ic = document.createElement('span');
        ic.className = 'flow-icon';
        ic.setAttribute('aria-hidden', 'true');
        const nm = document.createElement('span');
        nm.className = 'flow-name';
        el.append(ic, nm);
      } else {
        el = document.createElement('span');
        el.className = 'flow-arrow';
        el.setAttribute('aria-hidden', 'true');
        el.textContent = '→';
      }
      flowSteps.appendChild(el);
      nodes.push(el);
    }
    return nodes.filter((_, i) => i % 2 === 0);
  }

  /**
   * 버튼 뒤에 **길**을 그린다(2026-09-21). 사용자가 건네준 `boot-flow.html` 의 길을 이 띠의 크기로
   * 옮긴 것이다 — 스플라인 길 · 원근 리본 · 흐르는 입자.
   *
   * ⚠ 좌표는 domain/flowTrack 이 만든다. 여기서는 **재서 넘기고 그려 넣기만** 한다.
   * ⚠ SVG 는 `aria-hidden` 이다. 누를 수 있는 것은 여전히 버튼이고, 길은 그 버튼들이 어떤 차례로
   *   이어지는지를 **보여 주기만** 한다(원본도 같은 구조였다 — 장식 SVG + 진짜 button).
   * ⚠ 폭이 바뀌면 다시 그린다. 값을 캐시하지 않는다 — 한 번 그린 길이 창 크기를 따라오지 않으면
   *   마디가 버튼과 어긋나고, 그 어긋남은 화면에서 바로 보인다.
   */
  function drawFlowTrack(count) {
    if (!flowSteps) return;
    let svg = flowSteps.querySelector('.flow-track');
    const rect = flowSteps.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const track = flowTrack({ width: w, height: h, count });
    if (!track) { if (svg) svg.remove(); return; }

    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'flow-track');
      svg.setAttribute('aria-hidden', 'true');
      // ⚠ **맨 앞에** 둔다. 뒤에 붙이면 버튼 위를 덮어 클릭이 SVG 에 먹힌다.
      flowSteps.insertBefore(svg, flowSteps.firstChild);
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    // ⚠ 층을 쌓는 차례가 곧 빛이다(원본과 같다): 안개 → 아스팔트 → 발광 → 색선 → 흰 심 → 입자.
    svg.innerHTML =
      `<path class="ft-haze" d="${track.center}" />`
      + `<path class="ft-road" d="${track.ribbon}" />`
      + `<path class="ft-glow" d="${track.center}" />`
      + `<path class="ft-line" d="${track.center}" />`
      + `<path class="ft-core" d="${track.center}" />`
      + `<path class="ft-spark" d="${track.center}" />`;

    // 버튼을 마디 자리로 옮긴다. 라벨은 버튼 안에 있으므로 함께 따라간다.
    const btns = [...flowSteps.querySelectorAll('.flow-step')];
    btns.forEach((btn, i) => {
      const pt = track.points[i];
      if (!pt) return;
      btn.style.left = `${Math.round(pt.x)}px`;
      btn.style.top = `${Math.round(pt.y)}px`;
    });
  }

  /**
   * 영상이 앉는 **띠**의 자리. 영상 칸(`.video-panel`)은 이때 오른쪽 세로 칸이 아니라 **눕혀진
   * 가로 띠**다(CSS 의 `body[data-videoband="on"] .boards-container` 주석). 그 칸을 재서 위쪽에
   * 영상을 놓고, 같은 값만큼 칸의 `padding-top` 을 줘 아래 내용(단계 칩)이 영상 밑에서 시작하게 한다.
   *
   * ⚠ 자리를 기억하지 않는다. 끌 수 없는 것이 이 띠의 요점이다(자리를 정해 두면 가릴 일이 없다).
   * ⚠ 미는 일과 놓는 일이 **한 함수 안에** 있어야 한다. 둘이 갈리면 높이를 바꿀 때 한쪽만 고쳐져
   *   단계가 영상에 덮이거나 빈 띠만큼 아래가 내려앉는다.
   * ⚠ `padding-top` 은 rect 의 top·width 를 바꾸지 않는다 — 그래서 재고 쓰는 순서가 엉키지 않는다.
   */
  function placeBand() {
    const strip = panel;
    if (!strip) return;
    const r = strip.getBoundingClientRect();

    // ── 창을 재서 영상 크기를 정한다 ───────────────────────────────────────────
    // 가로로는 띠의 폭까지, 세로로는 **남는 만큼**. 둘 중 먼저 걸리는 쪽이 크기를 정한다.
    // ⚠ 머리줄과 단계 칸은 **실측**한다. 둘 다 띠의 padding-top 과 무관하므로 재는 순서가 엉키지
    //   않는다(그 패딩은 이 함수가 마지막에 쓴다).
    const head = strip.querySelector('.video-head');
    const chromeH = (head ? head.getBoundingClientRect().height : 0)
      + (bodyEl ? bodyEl.getBoundingClientRect().height : 0);
    const roomH = window.innerHeight - r.top - chromeH - BAND_DOCK_H - BAND_GAP * 3 - BOARD_MIN_H;
    const widthCap = Math.max(240, r.width - BAND_GAP * 2);
    const h0 = Math.max(BAND_MIN_H, Math.min(roomH, widthCap * 9 / 16));
    const w = Math.round(Math.min(h0 * 16 / 9, widthCap));
    const h = Math.round(w * 9 / 16);
    frame.style.width = `${w}px`;
    setFloatViewportPos(r.left + Math.max(0, (r.width - w) / 2), r.top + BAND_GAP, w);
    strip.style.paddingTop = `${h + BAND_DOCK_H + BAND_GAP * 2}px`;

    // 영상 관련 조작은 **영상 바로 밑에** 모인다(2026-09-21). 그전에는 오른쪽 패널의 `③ 받아 적기`
    // 안에 있어서, 띠를 보면서 누르려면 눈과 손이 화면을 가로질러야 했다.
    // ⚠ 버튼을 여기서 만들지 않는다 — 폰의 엄지 바와 **같은 줄, 같은 뷰**(ui/thumbBar)다. 자리만 옮긴다.
    // ⚠ 좌표는 프레임의 **실측 박스**에서 가져온다. 이 줄은 <body> 바로 아래라 포함 블록이 뷰포트인데,
    //   프레임의 인라인 left/top 은 제 포함 블록 기준이라 그 값을 그대로 쓰면 어긋난다.
    const dock = document.getElementById('thumbBar');
    if (dock) {
      const box = frame.getBoundingClientRect();
      dock.style.left = `${Math.round(box.left)}px`;
      dock.style.top = `${Math.round(box.bottom)}px`;
      dock.style.width = `${Math.round(box.width)}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
    }
  }

  /**
   * 창이 지금 무엇 때문에 떠 있는가를 다시 정하고, 그 자리에 놓는다. **렌더와 리사이즈가 함께 부른다.**
   *
   * ⚠ **띠는 영상이 실려 있으면 바로 선다**(2026-09-21). 그전에는 `받아 적기 시작` 을 눌러야
   *   떠서, 패널을 열어 놓고도 "상단에 크게" 가 안 된다는 말을 들었다 — 받아 적기는 영상을 보는
   *   여러 일 중 하나일 뿐이고, 박자를 맞추거나 마커를 찍을 때도 영상은 크게 보여야 한다.
   *   ⚠ 소스가 없으면 서지 않는다. 빈 검은 띠가 안무표를 400px 밀어내는 것이 가장 나쁘다.
   * ⚠ **띠는 넓은 화면에만** 있다. 좁은 화면에서는 CSS 가 정한 오른쪽 위 작은 창 그대로다 —
   *   거기서는 안무표 위에 띠를 얹을 세로가 없다. 넓은 화면에서 적어 둔 인라인 좌표가 폰 폭에
   *   남아 있으면 그 배치를 망가뜨리므로, 모드가 아니면 **지운다**.
   * ⚠ `data-videofloat`·`data-videoband` 를 **먼저** 쓰고 그다음에 잰다. 이 표식이 작업 영역의
   *   backdrop-filter 를 끄고, 그 filter 가 곧 `position: fixed` 의 기준점이다 — 순서가 뒤집히면
   *   낡은 기준점으로 잰다(창이 화면 밖으로 날아간다).
   * @returns {'float'|'band'|null}
   */
  function syncDetached() {
    const p = panelState();
    const live = p.open && !store.session.editingRoutineId && !p.collapsed;
    const mode = !live ? null
      : p.floating ? 'float'
      : (clip().source && !isStacked()) ? 'band'
      : null;

    document.body.dataset.videofloat = mode === 'float' ? 'on' : 'off';
    document.body.dataset.videoband = mode === 'band' ? 'on' : 'off';
    if (mode !== detachMode) {
      const entering = mode === 'band' && detachMode !== 'band';
      detachMode = mode;
      floatOriginCache = null;     // 기준점이 바뀌었다(위 ⚠)
      // 띠에 들어서는 순간에만 단계를 정리한다(위 firstUnfinishedStep 의 ⚠).
      if (entering) openOnlyStep(firstUnfinishedStep());
    }
    if (mode === 'band') placeBand();
    else if (mode === 'float') placeFloat(p);
    else clearFloat();
    return mode;
  }

  /**
   * `position: fixed` 의 기준점(뷰포트 좌표). 보통은 (0,0) 이라고 생각하지만 **이 앱에서는 아니다.**
   *
   * ⚠⚠ 조상에 `transform`·`filter`·`backdrop-filter` 가 있으면 그 조상이 fixed 의 기준(포함 블록)이
   *   된다. 이 앱은 `.panel` 에 `backdrop-filter: blur(10px)` 이 있고 `.workspace` 가 `.panel` 이라,
   *   `left: 260px` 를 줬는데 화면에서는 601px 에 섰다(실측 341·69px 어긋남). 이 사실을 모르고
   *   뷰포트 좌표를 그대로 쓰면 창이 손끝을 따라오지 않고 비스듬히 달아난다.
   *
   * 재는 방법은 하나뿐이다 — **0,0 에 놓고 어디에 서는지 본다.** 조상 체인을 뒤져 어떤 속성이
   * 포함 블록을 만드는지 맞히려 들면 CSS 가 하나 늘 때마다 틀린다.
   * @returns {{x:number, y:number}}
   */
  function floatOrigin() {
    if (floatOriginCache) return floatOriginCache;
    const keep = ['left', 'top', 'right', 'bottom'].map(k => [k, frame.style[k]]);
    frame.style.left = '0px'; frame.style.top = '0px';
    frame.style.right = 'auto'; frame.style.bottom = 'auto';
    const r = frame.getBoundingClientRect();
    for (const [k, v] of keep) frame.style[k] = v;
    floatOriginCache = { x: r.left, y: r.top };
    return floatOriginCache;
  }

  /**
   * `⤢ 크게` 로 띄운 창을 기억된 자리·크기에 놓는다(한 번도 옮긴 적이 없으면 오른쪽 아래).
   * @param {any} p 패널 상태
   */
  function placeFloat(p) {
    if (!frame) return;
    const w = Number.isFinite(p.floatW) ? p.floatW : defaultFloatWidth();
    frame.style.width = `${w}px`;
    if (!Number.isFinite(p.floatX) || !Number.isFinite(p.floatY)) {
      // 처음 띄울 때는 오른쪽 아래 — 안무표의 왼쪽 위(마디 번호·앞 카운트)를 가리지 않는다.
      // ⚠ right/bottom 은 포함 블록 기준이라 기준점 보정이 필요 없다(어느 쪽 끝에서 재든 같은 모서리).
      frame.style.left = '';
      frame.style.top = '';
      frame.style.right = '18px';
      frame.style.bottom = '18px';
      return;
    }
    setFloatViewportPos(p.floatX, p.floatY, w);
  }

  /** 뷰포트 좌표 (x,y) 에 창의 왼쪽 위를 놓는다. 화면 밖으로 나가지 않게 가둔 뒤 기준점만큼 뺀다. */
  function setFloatViewportPos(x, y, width) {
    const w = width || frame.getBoundingClientRect().width;
    const h = w * 9 / 16;
    const vx = clamp(x, 8, Math.max(8, window.innerWidth - w - 8));
    const vy = clamp(y, 8, Math.max(8, window.innerHeight - h - 8));
    const o = floatOrigin();
    frame.style.left = `${Math.round(vx - o.x)}px`;
    frame.style.top = `${Math.round(vy - o.y)}px`;
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
  }

  /** 제자리로 되돌린다. ⚠ **띠가 밀어 둔 안무표도 함께 되돌린다** — 안 그러면 빈 띠만큼 표가 내려앉는다. */
  function clearFloat() {
    if (!frame) return;
    floatOriginCache = null;
    for (const k of ['width', 'left', 'top', 'right', 'bottom']) frame.style.removeProperty(k);
    if (panel) panel.style.removeProperty('padding-top');
    const dock = document.getElementById('thumbBar');
    if (dock) for (const k of ['left', 'top', 'right', 'bottom', 'width']) dock.style.removeProperty(k);
  }

  /** 구간 자르기·마커 구획. In/Out 은 화면 상태, 마커는 media 에서 읽는다. */
  function renderCut() {
    const board = mainBoard();
    const p = panelState();
    const range = inOutRange();
    const hasIn = Number.isFinite(p.inSec);
    const hasOut = Number.isFinite(p.outSec);

    if (inGoBtn) inGoBtn.disabled = !hasIn;
    if (outGoBtn) outGoBtn.disabled = !hasOut;
    if (inOutClearBtn) inOutClearBtn.disabled = !hasIn && !hasOut;
    if (loopBtn) {
      // 켜져 있어도 구간이 없으면 켜진 것으로 보이지 않게 한다 — 잘라낸 뒤·In/Out 을 지운 뒤에 "반복 중"으로 보이면 거짓말이다.
      loopBtn.className = p.loop && range ? CLS.quickBtnActive : CLS.ghost;
      loopBtn.disabled = !range;
    }
    if (inOutText) {
      if (!hasIn && !hasOut) {
        inOutText.textContent = '영상을 보다가 구간의 시작에서 `[ In 지금 여기`, 끝에서 `Out ] 지금 여기` 를 누르세요. 재생 중이든 멈춘 채든 지금 시각이 찍힙니다.';
      } else if (range) {
        inOutText.textContent = `In ${formatClock(range.inSec)} · Out ${formatClock(range.outSec)} · 길이 ${(range.outSec - range.inSec).toFixed(1)}초`
          + (p.loop ? ' · 구간 반복 중' : '');
      } else {
        inOutText.textContent = hasIn ? `In ${formatClock(p.inSec)} — 이제 구간의 끝에서 Out 을 찍으세요.` : `Out ${formatClock(p.outSec)} — 이제 구간의 시작에서 In 을 찍으세요.`;
      }
    }

    // 잘라내기 — 할 수 있는가, 안 되면 왜인가.
    const state = range ? getTrimState() : 'no-inout';
    if (trimBtn) {
      trimBtn.disabled = state !== 'ready';
      trimBtn.textContent = state === 'busy' ? '✂ 잘라내는 중…' : '✂ 잘라서 새 클립으로';
    }
    if (trimHelp) {
      const err = getTrimError();
      trimHelp.textContent = err && state !== 'busy' ? `잘라내기 실패: ${err}` : (TRIM_TEXT[state] || TRIM_TEXT.ready);
      trimHelp.classList.toggle(CLS.isError, !!err && state !== 'busy');
    }

    // 마커 — 만들기 버튼과 목록.
    const sel = selectedRange();
    const list = markers();
    if (markerSelBtn) markerSelBtn.disabled = !range || !sel;
    if (markerRowBtn) markerRowBtn.disabled = !range;
    if (markerClearBtn) markerClearBtn.disabled = list.length === 0;
    if (markerHelp) {
      if (markerRejectedId) {
        markerHelp.textContent = '이 마커의 양 끝이 앞뒤 보정점과 순서가 맞지 않아 박자에 넣지 않았습니다 — 앞 카운트는 앞 시각에, 뒤 카운트는 뒤 시각에 와야 합니다.';
      } else if (!range) {
        markerHelp.textContent = 'In~Out 을 찍은 뒤, 안무표에서 그 구간에 해당하는 블록을 선택하고 `선택한 블록에 맵핑` 을 누르면 영상 구간과 안무표 구간이 짝지어집니다.';
      } else if (sel) {
        markerHelp.textContent = `선택: ${formatRange(sel.from, sel.to, board.cols)} (${sel.names.slice(0, 4).join(' · ')}${sel.names.length > 4 ? ' …' : ''}) ← In~Out 을 여기에 맵핑합니다.`;
      } else {
        const r = anchorRowRange();
        markerHelp.textContent = `블록을 선택하지 않았습니다 — \`이 마디에 맵핑\` 은 위 칸의 ${formatRange(r.from, r.to, board.cols)} 전체에 맵핑합니다.`;
      }
    }
    if (markerList) {
      markerList.innerHTML = '';
      const now = getCurrentSec();
      const current = new Set(markersAt(list, now).map(m => m.id));
      for (const m of list) {
        const li = document.createElement('li');
        li.className = 'video-marker' + (current.has(m.id) ? ' is-current' : '');
        li.dataset.markerId = m.id;

        const play = document.createElement('button');
        play.type = 'button';
        play.className = CLS.ghost;
        play.textContent = '▶';
        play.title = '이 구간을 In/Out 으로 삼고 그 시작에서 재생합니다';
        play.onclick = () => {
          if (commands.setInOut) render(commands.setInOut({ inSec: m.inSec, outSec: m.outSec }));
          onSeek(m.inSec, { play: true });
        };

        const label = document.createElement('span');
        label.className = 'video-marker-label';
        label.textContent = m.label || formatRange(m.fromCount, m.toCount, board.cols);
        label.title = label.textContent;

        const rangeEl = document.createElement('span');
        rangeEl.className = 'video-marker-range';
        rangeEl.textContent = `${formatRange(m.fromCount, m.toCount, board.cols)} ↔ ${formatClock(m.inSec)}–${formatClock(m.outSec)}`;

        const tempoBtn = document.createElement('button');
        tempoBtn.type = 'button';
        tempoBtn.className = CLS.ghost;
        tempoBtn.textContent = '박자에 반영';
        tempoBtn.title = isTempoUsable(tempo())
          ? '이 마커의 양 끝을 보정점으로 넣어 세로선이 이 구간에서 딱 맞게 합니다'
          : 'BPM 이 아직 없으므로 이 마커의 양 끝을 두 지점으로 삼아 BPM 과 시작 지점을 정합니다';
        tempoBtn.onclick = () => {
          if (!commands.applyMarkerToTempo) return;
          const { rejected, ...dirty } = commands.applyMarkerToTempo({ id: m.id }) || {};
          markerRejectedId = rejected ? m.id : '';
          if (rejected) { renderCut(); return; }
          render(dirty);
          commitHistory();
        };

        const del = document.createElement('button');
        del.type = 'button';
        del.className = CLS.ghost;
        del.textContent = '✕';
        del.title = '이 마커를 지웁니다';
        del.onclick = () => {
          if (!commands.removeMarker) return;
          markerRejectedId = '';
          render(commands.removeMarker({ id: m.id }));
          commitHistory();
        };

        li.append(play, label, rangeEl, tempoBtn, del);
        markerList.appendChild(li);
      }
    }
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
    // ⚠ 차례가 있다 — 띄우기 판정이 먼저다. renderPip 이 빈 자리의 글귀를 쓸 때 detachMode 를 읽는다.
    const mode = syncDetached();
    renderPip();
    if (collapseBtn) collapseBtn.textContent = p.collapsed ? '펼치기' : '접기';

    // ── 패널 밖으로 띄우기(2026-09-13, 받아 적기까지 넓힘 2026-09-20) ──
    // ⚠ 상태는 <body> 의 data-videofloat · data-videoband 이고 CSS 가 그것만 읽는다.
    //   DOM 을 옮기지 않는다 — .video-frame 은 제자리에 있고 position:fixed 로만 떠 있다(iframe 리로드 방지).
    // ⚠ 패널이 닫히거나 접히면 띄운 창도 내린다. 안 그러면 패널을 닫았는데 영상만 화면에 남는다.
    if (floatBtn) {
      // ⚠ className 을 통째로 쓰지 않는다. 이 버튼은 마크업에서 `only-wide` 를 달고 있고(좁은 화면에서
      //   숨기는 장치), 통째로 덮으면 그 클래스가 날아가 **폰에서 `⤢ 크게` 가 보인다** — 화면보다 큰
      //   창을 띄우는 버튼이 폰에 뜬 채로 2026-09-13 까지 있었다. 상태 클래스만 토글한다.
      floatBtn.classList.toggle(CLS.quickBtnActive, mode === 'float');
      floatBtn.classList.toggle(CLS.ghost, mode !== 'float');
      floatBtn.textContent = mode === 'float' ? '⤡ 제자리로' : '⤢ 크게';
    }

    renderFlowSteps();
    renderStatus();
    renderClips();
    renderTempo();
    renderCapture();
    renderCut();

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

  /**
   * `⧉ PiP` 버튼. **쓸 수 없으면 아예 감춘다** — 눌러도 안 되는 버튼은 없느니만 못하다.
   * 재생기가 iframe(YouTube)이거나 영상이 아직 안 실렸으면 'unavailable' 이다.
   * OS 쪽에서 창을 닫아도 상태가 따라오도록 app/main 이 재생기의 상태 변화에서 다시 부른다.
   */
  function renderPip() {
    const state = getPipState();
    // ⚠ 버튼이 없어도 <body> 표시는 해야 한다 — 영상 칸을 접는 CSS 가 이것만 읽는다.
    document.body.dataset.videopip = state === 'on' ? 'on' : 'off';
    // 빈 자리의 글귀는 어디로 갔는지에 따라 다르다. 띄운 창과 PiP 는 되돌리는 방법이 서로 다르다.
    if (frameSlot && state === 'on') {
      frameSlot.innerHTML = '영상은 <b>PiP 창</b>으로 빼 두었습니다 — <b>⧉ PiP 끄기</b> 로 되돌립니다';
    } else if (frameSlot) {
      // ⚠ detachMode 는 syncDetached 가 **이 함수보다 먼저** 정해 둔 값이다(render 의 차례를 보라).
      frameSlot.innerHTML = detachMode === 'band'
        ? '영상은 <b>안무표 바로 위</b>에 크게 떠 있습니다 — 위 <b>채우기</b> 줄의 <b>▶ 영상으로 채우기</b> 로 접습니다'
        : '영상은 큰 창으로 띄워 두었습니다 — 창의 <b>⤡ 제자리로</b> 로 되돌립니다';
    }
    if (!pipBtn) return;
    pipBtn.hidden = state === 'unavailable';
    pipBtn.className = state === 'on' ? CLS.quickBtnActive : CLS.ghost;
    pipBtn.textContent = state === 'on' ? '⧉ PiP 끄기' : '⧉ PiP';
  }

  if (pipBtn) pipBtn.onclick = () => { onTogglePip(); };

  if (openBtn) {
    openBtn.onclick = () => {
      // 2026-09-13 — 좁은 화면에서 처음 열 때 접던 것을 없앴다. 세로를 아끼려던 것인데,
      // 접힌 패널은 헤더만 남아 `① 영상 고르기` 의 `📁 영상 파일 열기` 가 통째로 사라졌다 —
      // 폰에서는 "파일을 여는 버튼이 아예 없는 앱"이 됐다. 접기는 손으로 누르면 된다.
      render(commands.togglePanel());
    };
  }
  if (closeBtn) closeBtn.onclick = () => render(commands.closePanel());
  if (collapseBtn) collapseBtn.onclick = () => render(commands.setCollapsed());
  if (followBtn) followBtn.onclick = () => render(commands.setFollow());

  // 파일 고르기. 버튼이 숨은 <input type=file> 을 대신 누른다 — 파일 입력은 스타일이 안 먹는다.
  if (fileBtn && fileInput) fileBtn.onclick = () => fileInput.click();
  if (fileInput) {
    fileInput.onchange = () => {
      const file = fileInput.files && fileInput.files[0];
      // 같은 파일을 다시 고를 수 있게 값을 비운다 — 비우지 않으면 change 가 두 번째엔 안 온다.
      fileInput.value = '';
      if (file) onFileChosen(file);
    };
  }
  if (fileClearBtn && commands.clearFileSource) fileClearBtn.onclick = () => render(commands.clearFileSource());
  // ★ 여기서 권한을 묻는다 — 클릭 콜스택 안이어야 브라우저가 대화상자를 연다.
  if (fileLibBtn) fileLibBtn.onclick = () => onOpenFromLibrary();

  if (markBtn) {
    markBtn.onclick = () => {
      // 두 번째 점이 확정되는 순간에만 committed 가 온다 — 히스토리는 그때 한 번이다.
      const done = applyCommitting(commands.markTempoPoint({ count: readAnchorLinear(), sec: getCurrentSec() }));
      if (!done) advanceAnchorRow();
    };
  }
  if (markCancelBtn) markCancelBtn.onclick = () => render(commands.clearTempoPoints());

  /**
   * 보정점 하나를 넣고 결과를 화면에 알린다. 거부되면(`rejected`) 안내만 바꾸고 아무것도 바꾸지 않는다.
   * @param {number} count
   */
  function addPoint(count) {
    if (!commands.addTempoPoint) return;
    const { rejected, ...dirty } = commands.addTempoPoint({ count, sec: getCurrentSec() }) || {};
    pointRejected = !!rejected;
    if (rejected) { renderTempo(); return; }
    render(dirty);
    commitHistory();
  }
  if (pointBtn) pointBtn.onclick = () => addPoint(readAnchorLinear());
  if (pointSelBtn) {
    pointSelBtn.onclick = () => {
      const start = selectedStartCount();
      if (start !== null) addPoint(start);
    };
  }
  if (pointClearBtn && commands.clearTempoMap) {
    pointClearBtn.onclick = () => {
      pointRejected = false;
      render(commands.clearTempoMap());
      commitHistory();
    };
  }

  /**
   * 탭 하나의 시각.
   *
   * ⚠ **재생 중에는 미디어 시각이다.** bpm 은 "미디어 1분에 몇 박"이라 배속을 걸어도 값이 맞고,
   *   markTempoPoint 와 같은 시계를 써야 두 경로가 어긋나지 않는다.
   * ⚠ **멈춰 있으면 지금 시각이다**(2026-09-21). 미디어 시계는 멈춘 영상에서 한 값에 붙박여
   *   모든 탭이 같은 시각이 되고, `bpmFromTaps` 가 null 을 돌려줘 **두드려도 아무 일이 없었다.**
   *   탭은 "얼마나 빠른가"만 답하므로 간격만 맞으면 되고, 멈춘 채로 머릿속 박자를 두드리는 것도
   *   쓸모가 있다(영상을 틀기 전에 값을 잡아 두는 길).
   * ⚠ 두 시계는 값의 자릿수가 아예 다르다 — 재생/정지를 오가며 두드리면 `tapTempo` 의
   *   "간격이 너무 벌어졌으면 처음부터"(TAP_RESET_SEC) 규칙이 알아서 series 를 끊는다.
   */
  const tapClockSec = () => {
    const st = getPlayerState() || {};
    return st.play === 'playing' ? getCurrentSec() : performance.now() / 1000;
  };
  // ⏮ 처음으로 — 영상을 0초로 **되감고 바로 재생한다**(2026-09-21).
  // ⚠ 되감기만 하고 멈춰 있으면 누른 사람이 곧바로 재생을 한 번 더 눌러야 한다. 이 버튼을 누르는
  //   까닭은 "처음부터 보면서 받아 적겠다" 하나뿐이라, 그 두 번째 누름은 언제나 따라온다.
  // ⚠ 재생은 **사용자 제스처 콜스택 안**이라야 브라우저가 허락한다 — 클릭 핸들러에서 곧바로
  //   부르고 await 로 한 박자 늦추지 않는다(`스페이스` 의 onTogglePlay 와 같은 규약).
  // ⚠ 받는 중이어도 그만두지 않는다. 그만두는 버튼은 `■ 그만` 이고, 한 버튼이 두 일을 하면
  //   둘 다 예측이 안 된다.
  if (rewindBtn) rewindBtn.onclick = () => { onSeek(0, { play: true }); renderCapture(); };
  if (tapBtn) tapBtn.onclick = () => render(commands.tapTempo({ atSec: tapClockSec() }));
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

  // ── In / Out · 잘라내기 · 마커 ────────────────────────────────────────────
  // In/Out·반복은 화면 상태라 커밋하지 않는다. 마커와 잘라내기는 안무의 일부라 커밋한다(호출부 규약).
  if (inBtn && commands.setInPoint) inBtn.onclick = () => render(commands.setInPoint({ sec: getCurrentSec() }));
  if (outBtn && commands.setOutPoint) outBtn.onclick = () => render(commands.setOutPoint({ sec: getCurrentSec() }));
  if (inGoBtn) inGoBtn.onclick = () => { const p = panelState(); if (Number.isFinite(p.inSec)) onSeek(p.inSec); };
  if (outGoBtn) outGoBtn.onclick = () => { const p = panelState(); if (Number.isFinite(p.outSec)) onSeek(p.outSec); };
  if (loopBtn && commands.setLoop) loopBtn.onclick = () => render(commands.setLoop());
  if (inOutClearBtn && commands.clearInOut) inOutClearBtn.onclick = () => render(commands.clearInOut());
  if (trimBtn) {
    trimBtn.onclick = () => {
      const range = inOutRange();
      if (!range || getTrimState() !== 'ready') return;
      onTrim(range);
    };
  }

  /**
   * 마커 하나를 만들고 커밋한다. 라벨은 선택한 블록 이름들(또는 마디 이름)이라 목록에서 "무엇에 붙었나"가 바로 읽힌다.
   * @param {{from:number, to:number}} range 카운트 구간
   * @param {string} label
   */
  function addMarker(range, label) {
    if (!commands.addMarker) return;
    markerRejectedId = '';
    const dirty = commands.addMarker({ fromCount: range.from, toCount: range.to, label });
    render(dirty);
    commitHistory();
  }
  if (markerSelBtn) {
    markerSelBtn.onclick = () => {
      const sel = selectedRange();
      if (sel) addMarker(sel, sel.names.join(' · '));
    };
  }
  if (markerRowBtn) {
    markerRowBtn.onclick = () => {
      const r = anchorRowRange();
      addMarker(r, r.row === 0 ? 'intro' : `${mainBoard().cols}x${r.row} 마디`);
    };
  }
  if (markerClearBtn && commands.clearMarkers) {
    markerClearBtn.onclick = () => {
      markerRejectedId = '';
      render(commands.clearMarkers());
      commitHistory();
    };
  }

  // 띠에서는 단계가 **하나만** 열린다. 여섯이 다 펼쳐지면 띠 하나가 1300px 이 되어 안무표가
  // 화면 밖으로 밀려난다(2026-09-21 에 실제로 그랬다).
  // ⚠ `toggle` 은 **버블하지 않는다** — document 에서 들으려면 캡처 단계여야 한다.
  // ⚠ 아래에서 다른 단계를 닫으면 그 닫힘도 toggle 을 부른다. `el.open` 이 참일 때만 도므로 멈춘다.
  document.addEventListener('toggle', (e) => {
    if (detachMode !== 'band') return;
    const el = e.target;
    if (!el || typeof el.matches !== 'function' || !el.matches(STEP_SEL) || !el.open) return;
    for (const other of stepEls()) if (other !== el) other.open = false;
    renderFlowSteps();
  }, true);

  // ── 띄우기 조작 ───────────────────────────────────────────────────────────
  if (floatBtn && commands.setFloating) floatBtn.onclick = () => render(commands.setFloating());
  // ⚠ 브라우저 창 크기가 바뀌면 포함 블록의 자리도 바뀐다 — 기준점을 버리고 다시 잰다.
  //   그리고 **다시 놓는다**: 1040px 을 넘나들면 받아 적기 창이 떴다 사라지고, 넓은 화면에서 적어 둔
  //   인라인 좌표가 폰 폭에 남아 있으면 오른쪽 위 작은 창이 엉뚱한 자리에 선다.
  window.addEventListener('resize', () => { floatOriginCache = null; syncDetached(); });
  if (floatDockBtn && commands.setFloating) {
    floatDockBtn.onclick = (e) => { e.stopPropagation(); render(commands.setFloating({ floating: false })); };
  }

  // 막대를 잡아 끈다. ⚠ 끄는 **동안에는 store 를 건드리지 않는다**(초당 수십 번 렌더가 된다) —
  //   인라인 스타일만 직접 쓰고, 놓는 순간 한 번만 커맨드로 확정한다(재생 헤드의 채널 B 와 같은 규약).
  if (floatBar && frame) {
    let drag = null;
    floatBar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = frame.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
      floatBar.classList.add('is-dragging');
      floatBar.setPointerCapture(e.pointerId);
    });
    floatBar.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // ⚠ 손끝은 뷰포트 좌표다. 창은 포함 블록 좌표로 선다 — 변환은 setFloatViewportPos 한 곳에서만.
      setFloatViewportPos(e.clientX - drag.dx, e.clientY - drag.dy, drag.w);
    });
    const endDrag = (e) => {
      if (!drag) return;
      drag = null;
      floatBar.classList.remove('is-dragging');
      if (e && e.pointerId != null && floatBar.hasPointerCapture(e.pointerId)) floatBar.releasePointerCapture(e.pointerId);
      const r = frame.getBoundingClientRect();
      if (commands.setFloatBox) render(commands.setFloatBox({ x: r.left, y: r.top, w: r.width }));
      onSync(true);   // 오버레이·재생 헤드가 자리를 다시 재게 한다
    };
    floatBar.addEventListener('pointerup', endDrag);
    floatBar.addEventListener('pointercancel', endDrag);

    // 모서리 리사이즈(CSS resize)는 이벤트가 없다 — 크기가 바뀌면 ResizeObserver 가 알려 준다.
    if (typeof ResizeObserver === 'function') {
      let last = 0;
      const ro = new ResizeObserver(() => {
        if (detachMode !== 'float') return;
        const w = Math.round(frame.getBoundingClientRect().width);
        if (!w || Math.abs(w - last) < 2) return;
        last = w;
        // ⚠ 모서리로 바꾼 폭을 **적어 둔다.** 안 적으면 다음 렌더의 placeFloat 가 기억된 값으로
        //   되돌려서, 렌더가 한 번 돌 때마다 창이 손에서 튕겨 나간다.
        //   같은 값을 도로 쓰는 것이라 크기가 다시 바뀌지 않는다(이 콜백이 되돌아오지 않는다).
        if (commands.setFloatBox) render(commands.setFloatBox({ w }));
        onSync(true);
      });
      ro.observe(frame);
    }
  }

  // ── 받아 적기 ─────────────────────────────────────────────────────────────
  // ⚠ 커밋은 **블록이 실제로 놓인 때만** 한다. 시작을 찍은 것은 화면 상태이고(안무가 아직 안 바뀌었다),
  //   거기에 커밋하면 Undo 한 번이 아무것도 되돌리지 않는 빈 칸이 된다.

  /** "바뀐 것이 없다" 를 알아보는 값. usecases/store 의 NONE 은 키가 없는 객체다. */
  const NONE_DIRTY_EMPTY = (d) => !d || Object.keys(d).length === 0;

  /** 커맨드가 얹어 보내는 알림용 키(started·placed·skipped·needsTempo)를 뗀다 — Dirty 의 키가 아니다. */
  function strip(result) {
    const { started, placed, skipped, needsTempo, ...dirty } = result || {};
    return dirty;
  }

  /**
   * 받아 적기 키를 한 번 눌렀다(버튼도 단축키도 여기로 온다).
   * @returns {boolean} 블록이 놓였는가
   */
  function captureToggle() {
    if (!commands.captureToggle) return false;
    // ⚠ 영상 길이를 **함께** 넘긴다(2026-09-20). 받아 적기를 여는 순간 커맨드가 이 길이로
    //   안무표를 늘려 두므로, 받는 동안 재생 위치가 표 끝에 닿아도 그 뒤가 이미 있다.
    const { started, placed, needsTempo, grew, capped, ...dirty } =
      commands.captureToggle({ sec: getCurrentSec(), durationSec: getDurationSec() }) || {};
    render(dirty);
    renderCapture();
    if (grew) noteGrew(grew, capped);
    if (needsTempo) return false;
    // ⚠ 늘린 것도 되돌릴 거리다 — 블록을 못 놓았어도 마디가 늘었으면 커밋한다.
    if (placed || grew) commitHistory();
    return !!placed;
  }

  /**
   * 안무표가 저절로 늘어났다는 것을 한 줄로 알린다(2026-09-20).
   * ⚠ `alert` 를 쓰지 않는다 — 받아 적는 중에 창이 뜨면 영상에서 눈이 떠나고 박자를 놓친다.
   *   `③ 받아 적기` 의 안내 줄에 적고, 다음 렌더가 원래 문구로 되돌린다.
   * @param {number} rows 늘린 뒤의 마디 수
   * @param {boolean} [capped] 상한에 걸려 거기까지만 늘렸는가
   */
  function noteGrew(rows, capped) {
    if (!captureHelp) return;
    captureHelp.textContent = capped
      ? `안무표를 ${rows}마디까지 늘렸습니다 — 더 늘리지 않습니다. 박자가 실제와 맞는지 \`② 박자 맞추기\` 에서 확인하세요.`
      : `영상 길이에 맞춰 안무표를 ${rows}마디로 늘렸습니다. ` + captureHelp.textContent;
  }

  // ⚠ 한 커맨드다. 처음 누르면 열고(그 시각이 1카운트), 그 뒤로는 경계를 찍는다 — 그 판정은
  //   usecases/captureCommands 안에 있고 화면은 그것을 흉내 내지 않는다.
  if (captureBtn) captureBtn.onclick = () => captureToggle();
  if (voiceBtn) {
    voiceBtn.onclick = () => {
      if (!voice) return;
      voice.toggle();
      renderCapture();
    };
  }
  if (captureSkipBtn && commands.captureSkip) {
    captureSkipBtn.onclick = () => { render(strip(commands.captureSkip({ sec: getCurrentSec() }))); renderCapture(); };
  }

  /**
   * 표 전체를 한 카운트 옮긴다(2026-09-20). 한 번 누름이 Undo 한 단계다.
   * ⚠ 격자 밖으로 나가는 블록이 하나라도 있으면 커맨드가 아무것도 옮기지 않고 `blocked` 를 준다 —
   *   반만 옮기면 표 끝이나 인트로 앞의 동작이 소리 없이 사라진다. 그 사실을 한 줄로 적는다.
   * @param {number} delta
   */
  function shiftAll(delta) {
    if (typeof commands.shiftAll !== 'function') return;
    const { moved, blocked, ...dirty } = commands.shiftAll({ delta }) || {};
    render(dirty);
    renderCapture();
    if (shiftHelp) {
      shiftHelp.textContent = blocked
        ? (delta < 0
          ? '더 당길 수 없습니다 — 인트로 마디 앞으로 나가는 블록이 있습니다.'
          : '더 밀 수 없습니다 — 표 끝을 넘는 블록이 있습니다. 안무표 크기를 늘린 뒤 다시 누르세요.')
        : (moved ? `표 전체를 ${delta < 0 ? '한 카운트 앞으로 당겼습니다' : '한 카운트 뒤로 밀었습니다'}.` : '');
    }
    if (moved) commitHistory();
  }

  // 받아 적는 동안 뜬 작은 영상 창을 반대쪽 구석으로 보낸다(2026-09-20).
  // ⚠ 화면 상태라 store 에 넣지 않는다 — 스크롤 락·시트와 같은 결이고 저장하거나 Undo 할 값이 아니다.
  //   자리는 <body data-pipside> 하나이고 CSS 가 그것만 읽는다.
  if (pipSideBtn) {
    pipSideBtn.onclick = () => {
      const body = pipSideBtn.ownerDocument.body;
      body.dataset.pipside = body.dataset.pipside === 'left' ? 'right' : 'left';
    };
  }

  if (shiftBackBtn) shiftBackBtn.onclick = () => shiftAll(-1);
  if (shiftFwdBtn) shiftFwdBtn.onclick = () => shiftAll(1);
  if (nameSelBtn && commands.nameSelected) {
    nameSelBtn.onclick = () => {
      const { named, ...dirty } = commands.nameSelected() || {};
      render(dirty);
      renderCapture();
      if (named) commitHistory();
    };
  }
  if (captureCancelBtn && commands.stopCapture) {
    captureCancelBtn.onclick = () => { render(commands.stopCapture()); renderCapture(); };
  }
  if (markerBlocksBtn && commands.markersToBlocks) {
    markerBlocksBtn.onclick = () => {
      const { placed, ...dirty } = commands.markersToBlocks() || {};
      render(dirty);
      if (placed) commitHistory();
    };
  }

  return {
    render: renderPanel,
    renderStatus,
    /**
     * 영상이 지금 패널 밖 어디에 나가 있는가 — `'band'`(안무표 위 띠) · `'float'`(⤢ 크게) · `null`.
     * ⚠ 엄지 바가 "영상 밑에 붙은 상태인가"를 이것으로 판정한다. 값은 이 뷰의 render 가 정하고,
     *   app/render 는 **영상 패널을 엄지 바보다 먼저** 그린다(그래서 한 프레임 늦지 않는다).
     */
    detachMode: () => detachMode,
    /** 잘라내기 상태(대기·진행·실패)가 바뀌었다 — 구획만 다시 그린다(store 를 거치지 않는 값이다). */
    renderCut,
    /**
     * 받아 적기 한 번(단축키 B). 패널이 닫혀 있거나 박자가 없으면 아무것도 하지 않는다 —
     * 판정을 여기 두는 이유는 input 계층이 재생 시각을 모르기 때문이다.
     * @returns {boolean} 블록이 놓였는가
     */
    captureToggle: () => (panelState().open ? captureToggle() : false),
    /** 마이크 켜고 끄기. 엄지 바가 같은 것을 부른다 — 폰에는 이 줄이 화면 밖이다. */
    voiceToggle: () => {
      if (!voice || !voice.available()) return false;
      const on = voice.toggle();
      renderCapture();
      return on;
    },
    voiceState: () => (voice && voice.available()
      ? { available: true, wanted: voice.wanted(), listening: voice.listening() }
      : { available: false, wanted: false, listening: false }),
    /** 마이크 상태만 다시 그린다. 어댑터가 스스로 멈췄다 켜질 때마다 불린다(초당 몇 번). */
    syncVoice: () => { renderCapture(); },
    /**
     * `스페이스` — 재생과 일시정지를 번갈아 한다. 패널이 닫혀 있으면 아무것도 하지 않는다
     * (닫힌 패널의 영상은 소리만 나는 유령이 된다).
     *
     * ⚠ **`⧉ PiP` 로 빼 두었으면 패널이 닫혀 있어도 듣는다**(2026-09-20). 그때 영상은 브라우저
     *   바깥 창에 **보이고 있으므로** 유령이 아니다 — 보이는 것을 세우지 못하는 쪽이 이상하다.
     * ⚠ 그래도 **PiP 창에 포커스가 있으면 이 글쇠는 오지 않는다.** 그 창은 브라우저 바깥이라
     *   키 입력이 페이지에 아예 닿지 않는다(앱이 고칠 수 있는 자리가 아니다). 페이지를 한 번
     *   누르고 나면 그때부터 듣는다.
     * @returns {boolean} 실제로 눌렀는가
     */
    togglePlay: () => {
      if (!panelState().open && getPipState() !== 'on') return false;
      onTogglePlay();
      return true;
    },
    /**
     * 탭 한 번. **영상 바로 밑 조작 줄이 같은 것을 부른다**(2026-09-21) — 박자를 잡는 일은
     * 영상을 보면서 하는 일이라 ② 를 펼쳐 두지 않아도 닿아야 한다.
     * @returns {boolean} 언제나 참(눌린 것 자체가 결과다)
     */
    tap: () => {
      if (!panelState().open) return false;
      render(commands.tapTempo({ atSec: tapClockSec() }));
      return true;
    },
    /** 지금까지 두드린 횟수. 조작 줄이 `탭 (3)` 을 그리는 데 쓴다. */
    tapCount: () => (panelState().taps || []).length,
    /**
     * 두드린 것으로 지금 계산되는 BPM. 아직 둘 미만이면 `null`.
     * ⚠ 조작 줄이 **두드리는 자리 바로 옆에** 이 수를 적는다 — 값이 안 보이면 몇 번을 더 쳐야
     *   할지, 지금 값이 맞는지 알 길이 없어서 결국 ② 를 펼쳐 봐야 했다(2026-09-21).
     */
    tapBpm: () => bpmFromTaps(panelState().taps || [], 1),
    /** ⏮ 영상을 맨 처음으로 되감고 재생한다. 조작 줄이 같은 것을 부른다(받아 적기의 첫 차례다). */
    rewind: () => {
      if (!panelState().open) return false;
      onSeek(0, { play: true });
      return true;
    },
    /** `N` — 여기까지는 안무가 아니다. 패널이 닫혀 있으면 아무 일도 하지 않는다. */
    captureSkip: () => {
      if (!panelState().open || !commands.captureSkip) return false;
      const res = commands.captureSkip({ sec: getCurrentSec() }) || {};
      render(strip(res));
      renderCapture();
      return Boolean(res.started || res.skipped);
    },
    /** `Esc` — 받아 적기를 끝낸다. **받는 중일 때만 참**을 돌려준다(그래야 Esc 의 옛 뜻이 산다). */
    stopCapture: () => {
      if (!panelState().open || !commands.stopCapture) return false;
      const dirty = commands.stopCapture();
      if (NONE_DIRTY_EMPTY(dirty)) return false;
      render(dirty);
      renderCapture();
      return true;
    },
    /** 선택이 바뀌었다 — `선택한 블록이 여기서 시작`·`선택한 블록에 맵핑` 의 활성 여부만 다시 잰다(패널이 닫혀 있으면 값만 바뀌고 안 보인다). */
    syncSelection: () => { renderTempo(); renderCapture(); renderCut(); },
    /**
     * 메인 보드의 배치가 바뀌었다 — `③ 받아 적기` 의 버튼 활성만 다시 잰다(2026-09-20).
     * `표 전체 옮기기` 는 놓인 블록이 있어야 눌리는데, 블록이 놓이는 것은 선택이 바뀌는 것과
     * 다른 사건이라 syncSelection 으로는 안 온다. 패널 전체를 다시 그리지 않는다 — 구획만이다.
     */
    syncCapture: () => { renderCapture(); },
    /** YT.Player 가 iframe 으로 갈아치울 자리. app/main 이 여기에 컨테이너를 만든다. */
    renderPip,
    playerHost: () => frame
  };
}
