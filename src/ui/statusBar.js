// src/ui/statusBar.js — 창 맨 아래 한 줄의 상태줄 (ui 계층, RM-19)
//
// 받는 중 · 듣는 중 · 루틴 편집 중 · 담기 자리 · 되돌릴 수 있음이 영상 배지 · 패널 안내 줄 · 엄지 바 ·
// 파일 메뉴에 흩어져 있었다. 「지금 저장됐나」 · 「지금 듣고 있나」를 알려면 눈이 화면을 돌아다녀야 했다.
// 이제 그 상태가 **한 자리**에 선다 — 창 맨 아래 한 줄, 폰에서는 엄지 바 바로 위.
//
// ⚠ 판정을 새로 하지 않는다. 받는 중은 captureSec, 듣는 중은 음성 어댑터의 상태, 담기 자리는 파일 메뉴가
//   쓰던 담기 판정, 되돌릴 수 있음은 히스토리를 그대로 읽는다 — getState 가 그것을 모아 준다.
// ⚠ 같은 판정을 쓰는 다른 자리(파일 메뉴의 「어디에 담기는가」 · 엄지 바의 `🎤 듣는 중`)는 여기의
//   순수 함수(saveTargetState · voiceLabel)를 **import 해서** 쓴다. 두 곳이 따로 말하면 둘이 어긋나는 날이 온다.
// ⚠ 상태줄은 보드 렌더에 묶이지 않는다. app/render 가 video · history · routineEditor 가 더러울 때만
//   render() 를 부르고, 음성 상태 · 담기 판정이 바뀌면 조립부가 render() 를 직접 부른다 — 받아 적는 중
//   초마다 보드를 다시 그리면 터치 끌기가 끊긴다.
// ⚠ RM-04 의 「참고(status)」 급 알림은 토스트가 아니라 이 줄의 오른쪽에 잠깐 선다(show). 막음 · 토스트
//   급은 그대로 toastView 다 — 갈래는 app/noticeRouter 가 정한다.

import { commandById } from '../domain/commands.js';

/** 참고 급 알림이 상태줄에 떠 있는 시간(ms). 토스트(3.2초)보다 조금 길다 — 한 줄이라 눈에 덜 띈다. */
export const STATUS_NOTICE_MS = 5000;

/**
 * @typedef {{ bound?: string, kind?: 'server'|'browser', blocked?: boolean, reason?: string, failed?: boolean }} SaveTarget
 *   파일 메뉴가 쓰던 담기 판정 그대로 — 묶인 파일 이름 · 담는 자리 · 멈췄는가 · 멈춘 까닭 · 담기가 실패하고 있는가(RM-33).
 * @typedef {{ available?: boolean, wanted?: boolean, listening?: boolean }} VoiceState
 * @typedef {{ id: string, text: string, tone?: 'warn'|'on'|'muted' }} StatusPart
 */

/**
 * 담기 자리의 판정 — 파일 메뉴 · 상태줄이 **같은 함수**로 가른다.
 *   stop-conflict  다른 탭·기기에서 바뀌어 덮어쓰지 않았다(막힘)
 *   stop-future    더 새 판의 앱이 담은 것이라 열지 못했다(막힘)
 *   stop-failed    담으려 했지만 이 브라우저가 받지 않았다 — 쿼터 초과 · 저장소 막힘(RM-33)
 *   browser        서버가 없어 이 브라우저에만 담긴다
 *   bound          보관 폴더의 그 파일에 담기는 중
 *   draft          아직 임시 칸(`_작업중`)
 * @param {SaveTarget|null|undefined} target
 * @returns {{ state: 'stop-conflict'|'stop-future'|'stop-failed'|'browser'|'bound'|'draft', bound: string }}
 */
// @complexity time=O(1) space=O(1) cc=6
export function saveTargetState(target) {
  const { bound = '', kind = 'browser', blocked = false, reason = '', failed = false } = target || {};
  if (blocked) return { state: reason === 'conflict' ? 'stop-conflict' : 'stop-future', bound };
  if (failed) return { state: 'stop-failed', bound };
  if (kind !== 'server') return { state: 'browser', bound };
  if (bound) return { state: 'bound', bound };
  return { state: 'draft', bound };
}

/**
 * 마이크 버튼 · 엄지 바 · 상태줄이 함께 쓰는 「듣는 중」 라벨. 켜지 않았으면 빈 문자열.
 * ⚠ 「켜져 있다」와 「듣고 있다」는 다르다 — 크롬은 조용하면 스스로 멈추고 우리가 다시 켠다. 그 틈이 `🎤 …` 다.
 * @param {VoiceState|null|undefined} voice
 * @returns {string}
 */
// @complexity time=O(1) space=O(1) cc=4
export function voiceLabel(voice) {
  if (!voice || !voice.available || !voice.wanted) return '';
  return voice.listening ? '🎤 듣는 중' : '🎤 …';
}

/**
 * 상태줄에 세울 조각들. **순서가 곧 중요도다** — 막힌 담기가 가장 앞이고(멈춘 줄 모르고 한 시간을 더
 * 작업하는 것이 가장 나쁜 실패다), 그다음 지금 하는 일(받는 중 · 듣는 중 · 루틴 편집 중), 담기 자리,
 * 되돌릴 수 있음 차례다.
 * @param {{
 *   capture?: { startSec: number|null },
 *   voice?: VoiceState,
 *   routine?: { editing: boolean },
 *   save?: SaveTarget,
 *   history?: { canUndo: boolean }
 * }} state
 * @param {{ formatClock?: (sec: number) => string }} [deps]
 * @returns {StatusPart[]}
 */
// @complexity time=O(1) space=O(1) cc=14
export function statusParts(state, deps = {}) {
  const fmt = deps.formatClock || ((sec) => `${sec}초`);
  const parts = [];
  const save = saveTargetState(state.save);
  if (save.state === 'stop-conflict') {
    parts.push({ id: 'save', text: `⚠ 담기 멈춤 — \`${save.bound || '작업 문서'}\` 이 다른 탭이나 기기에서 바뀌었습니다`, tone: 'warn' });
  } else if (save.state === 'stop-future') {
    parts.push({ id: 'save', text: `⚠ 담기 멈춤 — \`${save.bound || '작업 문서'}\` 는 더 새 판의 앱이 담은 것입니다`, tone: 'warn' });
  } else if (save.state === 'stop-failed') {
    parts.push({ id: 'save', text: '⚠ 담기 실패 — 이 브라우저에 담지 못하고 있습니다', tone: 'warn' });
  }

  const start = state.capture ? state.capture.startSec : null;
  if (Number.isFinite(start)) parts.push({ id: 'capture', text: `● ${fmt(start)} 부터 받는 중`, tone: 'on' });

  const mic = voiceLabel(state.voice);
  if (mic) parts.push({ id: 'voice', text: mic, tone: mic === '🎤 듣는 중' ? 'on' : 'warn' });

  if (state.routine && state.routine.editing) parts.push({ id: 'routine', text: '루틴 편집 중', tone: 'on' });

  if (save.state === 'bound') parts.push({ id: 'save', text: `보관 폴더의 \`${save.bound}.json\` 에 담김`, tone: 'muted' });
  else if (save.state === 'draft') parts.push({ id: 'save', text: `임시 칸에 담김 — \`${commandById('saveProject').button}\` 로 이름을 붙이면 그 파일로`, tone: 'muted' });
  else if (save.state === 'browser') parts.push({ id: 'save', text: '이 브라우저에만 담김', tone: 'muted' });

  if (state.history && state.history.canUndo) parts.push({ id: 'undo', text: '되돌릴 수 있음 (Ctrl+Z)', tone: 'muted' });
  return parts;
}

/**
 * 상태줄 뷰. 마크업의 `#statusBar` 안에 조각(`#statusBarParts`)과 참고 알림(`#statusBarNotice`)을 적는다.
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   getState: () => Parameters<typeof statusParts>[0],
 *   formatClock?: (sec: number) => string,
 *   doc?: Document,
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout
 * }} options
 * @returns {{ render(): void, show(n: { message: string }): void, parts(): StatusPart[] }}
 */
// @complexity time=O(p) space=O(p) cc=12
export function createStatusBar(options) {
  const { elements = {}, getState, formatClock } = options;
  const doc = options.doc || (typeof document === 'undefined' ? null : document);
  const later = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.clearTimeout || ((id) => clearTimeout(id));
  const byId = (id) => (id in elements ? elements[id] : (doc ? doc.getElementById(id) : null));

  const root = byId('statusBar');
  const partsEl = byId('statusBarParts');
  const noticeEl = byId('statusBarNotice');
  let noticeTimer = null;
  let lastSig = '';

  /** 지금 세울 조각(순수 계산). 시험과 render 가 같은 것을 본다. */
  function parts() {
    return statusParts(getState() || {}, { formatClock });
  }

  /**
   * 다시 그린다. 조각이 글자 하나 안 바뀌었으면 DOM 을 건드리지 않는다 — 음성 어댑터가 초당 몇 번 부른다.
   * ⚠ 조각 하나가 `<span>` 하나다. 통째 문자열로 적지 않는 까닭은 조각마다 색(tone)이 다르기 때문이다.
   */
  function render() {
    if (!partsEl) return;
    const list = parts();
    const sig = list.map(p => `${p.id}:${p.tone || ''}:${p.text}`).join('\u0001');
    if (sig === lastSig) return;
    lastSig = sig;
    partsEl.textContent = '';
    for (const p of list) {
      const span = doc.createElement('span');
      span.className = 'status-part';
      span.dataset.part = p.id;
      if (p.tone) span.dataset.tone = p.tone;
      span.textContent = p.text;
      partsEl.appendChild(span);
    }
    if (root) root.dataset.warn = list.some(p => p.tone === 'warn') ? 'on' : 'off';
  }

  /**
   * 참고 급 알림 한 줄. 몇 초 뒤 저절로 비워진다. 같은 말이 연달아 오면 시간만 늘어난다.
   * @param {{ message: string }} n
   */
  function show(n) {
    if (!noticeEl || !n || !n.message) return;
    noticeEl.textContent = n.message;
    noticeEl.hidden = false;
    if (noticeTimer) cancel(noticeTimer);
    noticeTimer = later(() => {
      noticeTimer = null;
      noticeEl.textContent = '';
      noticeEl.hidden = true;
    }, STATUS_NOTICE_MS);
  }

  render();
  return { render, show, parts };
}
