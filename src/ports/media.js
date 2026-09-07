// src/ports/media.js — 재생기(MediaPlayer)와 외부 시퀀스 엔진의 계약. import 0개.
//
// 신규 파일이다. 오늘 index.html 의 대응물은 window.open 3곳(5150·5162·5192)과
// fetchYoutubeTitle(5090) 뿐이라 옮겨 온 로직이 없다 — 여기 있는 것은 계약과, 그 계약을
// 스스로 검사하는 assertMediaPlayer, 그리고 불량 엔진을 흡수하는 방어 코드다.
// 설계 근거: scratchpad/design/spec-동영상 §2·§4. mediaPlayer/sequenceEngine 두 파일을 하나로 합친 이유는
// normalizeEngineSession 이 isMediaPlayer 를 써야 하는데 ports 는 서로도 import 할 수 없기 때문이다.

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 앱은 엔진에 row·index·groupId·placement·bpm·moveLibrary·routines 를 절대 넘기지 않는다.
//   주고받는 것은 {startSec, endSec, label} 뿐이고 label 조차 우리가 만든 표시용 문자열이다.
//   이 단방향성 덕분에 엔진 교체가 어댑터 1개 교체로 끝난다.
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{kind:'youtube', videoId:string, startSec?:number}
 *          | {kind:'file', url:string, name?:string}} MediaSource */

/** @typedef {'idle'|'loading'|'ready'|'error'} LoadState */
/** @typedef {'unstarted'|'buffering'|'playing'|'paused'|'ended'} PlayState */
/** @typedef {'not-found'|'not-embeddable'|'network'|'unsupported'|'unknown'} MediaErrorCode */
/** @typedef {'started'|'blocked'|'not-ready'|'no-source'|'error'} PlayResult */

/**
 * @typedef {Object} TimeSample
 * @property {number} sec    미디어 시각(초)
 * @property {number} atMs   이 표본을 뜬 순간. performance.now() 기준
 * @property {number} rate   재생 배속
 * @property {boolean} playing
 */

/**
 * @typedef {Object} MediaCapabilities
 * @property {boolean} canSeek
 * @property {number} seekToleranceSec
 *   ★ 필수 필드. 이 안에 착지하면 성공으로 본다. YT ≈ 0.5, 로컬 파일 ≈ 0.05.
 *   180bpm 에서 1카운트 = 0.333s < 0.5s 이므로 "정확한 카운트로 점프"는 YouTube 에서 원리적으로 불가능하다.
 *   usecase 가 preRollCounts = ceil(tolerance / spc) + 2 만큼 앞을 겨냥해 seek 한 뒤 재생으로 통과한다.
 * @property {number[]|null} rates 배속 불가면 null
 * @property {boolean} isLive
 * @property {boolean} needsUserGesture 첫 play() 를 클릭 핸들러 콜스택 안에서 불러야 하는가
 */

/**
 * @typedef {Object} MediaPlayer
 * @property {'youtube'|'file'|'null'|'engine'} kind
 * @property {MediaCapabilities} capabilities 불변(Object.freeze)
 * @property {() => {load:LoadState, play:PlayState, error:{code:MediaErrorCode,message:string}|null}} getState
 * @property {() => number|null} getDuration 모르면 null(0 이 아니다 — 라이브는 길이가 없다)
 * @property {() => TimeSample|null} getTimeSample
 * @property {(source: MediaSource|null) => Promise<void>} load
 *   ★ "준비 완료"에 resolve 한다. 준비 전에 온 seek/play 는 던지지 않고 어댑터가 마지막 의도 1개만
 *   큐잉해 두었다가 준비 시 적용한다. kind 가 같으면 재생성 없이 소스만 교체(YT iframe 재로드 회피)
 * @property {() => Promise<PlayResult>} play
 *   ★ 절대 reject 하지 않는다. 자동재생 차단은 예외가 아니라 'blocked' 라는 정상 결과다
 *   (<video>.play() 는 NotAllowedError 로 reject 하고 YT playVideo() 는 조용히 실패한다 — 어댑터가 흡수)
 * @property {() => void} pause
 * @property {(sec: number, opts?: {scrubbing?: boolean}) => Promise<number>} seek
 *   ★ 실제 착지 시각을 돌려준다. "요청 ≠ 결과"를 타입으로 인정하는 자리다.
 *   scrubbing:true 는 저비용 미리보기, false 는 확정
 * @property {(rate: number) => void} setRate capabilities.rates 가 null 이면 no-op
 * @property {(muted: boolean) => void} setMuted
 * @property {(cb: (s: TimeSample) => void) => (() => void)} onTime
 *   ★ 소비자의 폴링을 금지한다. 어댑터가 재생 중 ≥10Hz + seek/상태변화 직후 1회 + 구독 즉시 1회를 보장하고,
 *   뷰는 projectTime 으로 rAF 보간한다(YT 는 시간 이벤트가 아예 없고 <video>.timeupdate 는 4Hz 라 성기다)
 * @property {(cb: (s: unknown) => void) => (() => void)} onState
 * @property {() => void} destroy 멱등. container 를 비운 채 남긴다
 */

/** MediaPlayer 가 반드시 가져야 하는 멤버 전부. assertMediaPlayer 의 유일한 판정 근거다. */
export const MEDIA_PLAYER_MEMBERS = Object.freeze([
  'kind', 'capabilities', 'getState', 'getDuration', 'getTimeSample', 'load', 'play', 'pause',
  'seek', 'setRate', 'setMuted', 'onTime', 'onState', 'destroy'
]);

/**
 * 낯선 구현(특히 외부 엔진이 준 플레이어)이 계약을 지키는지 확인한다.
 * kind/capabilities 는 값이면 되고 나머지는 함수여야 한다.
 * @param {any} player
 * @param {string} [label='MediaPlayer']
 * @returns {any} 통과하면 받은 것을 그대로 돌려준다(체이닝용)
 * @throws {TypeError} 빠진 멤버 이름을 전부 나열한다
 */
export function assertMediaPlayer(player, label = 'MediaPlayer') {
  const missing = MEDIA_PLAYER_MEMBERS.filter(k =>
    (k === 'kind' || k === 'capabilities') ? player?.[k] == null : typeof player?.[k] !== 'function');
  if (missing.length) throw new TypeError(`${label} 계약 위반: ${missing.join(', ')}`);
  return player;
}

/**
 * assertMediaPlayer 의 불리언판. 준수 수준 판정에 쓴다.
 * @param {any} player
 * @returns {boolean}
 */
export function isMediaPlayer(player) {
  try { assertMediaPlayer(player); return true; } catch { return false; }
}

/**
 * 표본 사이를 보간한다. 이 포트의 DTO 에만 관한 계산이라 여기 둔다(순수 — 시계를 읽지 않고 인자로 받는다).
 * 배속은 매핑이 아니라 보간에만 들어간다: 포트가 주는 sec 은 언제나 미디어 시각이고
 * 배속은 그 시각이 흐르는 속도만 바꾼다.
 * @param {TimeSample|null|undefined} sample
 * @param {number} nowMs performance.now() 로 읽은 현재 시각. 호출부가 넣는다
 * @param {number|null} [durationSec=null] 알면 넘긴다 — 끝을 넘어가지 않게 막는다
 * @returns {number}
 */
export function projectTime(sample, nowMs, durationSec = null) {
  if (!sample) return 0;
  if (!sample.playing) return sample.sec;
  const t = sample.sec + ((nowMs - sample.atMs) / 1000) * (sample.rate || 1);
  return durationSec == null ? t : Math.min(t, durationSec);
}

// ─────────────────────────────────────────────────────────────────────────────
// SequenceEngine — 준수 수준 0/1/2 로 "엔진이 가정을 안 지킬 때"를 정상 경로로 만든다
//
//  0 데이터 전용 : 구간 배열 import/export 만. 여기가 바닥이다
//  1 임베드      : + mount/destroy/onChange. 안무표 옆 탭에서 엔진 UI 를 그대로 쓴다
//  2 동기 재생   : + getPlayer() 가 MediaPlayer 계약을 만족. 엔진 재생에 재생 헤드가 따라간다
// 못 지키면 한 단계 강등할 뿐 예외가 아니다.
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{ id:string, startSec:number, endSec:number, label?:string, meta?:unknown }} ClipSegment */

/**
 * @typedef {Object} SequenceEngineAdapter
 * @property {string} id 'seqedit' 등. 저장 blob(media.engine)의 네임스페이스가 된다
 * @property {() => {level: 0|1|2, name: string}} describe 뷰는 이 수준에 따라 UI 를 줄인다
 * @property {(container: unknown, init: {source: MediaSource|null, segments: ClipSegment[], state: unknown|null}) => Promise<RawEngineSession>} [mount]
 * @property {(state: unknown, segments: ClipSegment[]) => unknown} [importSegments] 수준 0 경로
 */

/**
 * 엔진이 "대충" 준 것. 전부 optional 이고, 무엇 하나 있으리라 가정하지 않는다.
 * @typedef {Object} RawEngineSession
 * @property {() => unknown[]} [getSegments]
 * @property {(s: ClipSegment[]) => void} [setSegments]
 * @property {(sec: number) => void} [syncTime]
 * @property {() => unknown} [getPlayer]
 * @property {() => unknown} [getState]
 * @property {(cb: (payload: unknown) => void) => unknown} [onChange]
 * @property {() => void} [destroy]
 */

/**
 * normalizeEngineSession 을 통과한 뒤. 전부 required 라 호출부에 분기가 생기지 않는다.
 * @typedef {Object} EngineSession
 * @property {0|1|2} level
 * @property {() => ClipSegment[]} getSegments
 * @property {(s: ClipSegment[]) => void} setSegments
 * @property {(sec: number) => void} syncTime
 * @property {() => MediaPlayer|null} getPlayer
 * @property {() => unknown|null} getState
 * @property {(cb: (s: ClipSegment[]) => void) => (() => void)} onChange
 * @property {() => void} destroy
 */

/**
 * 던질 수 있는 남의 메서드를 부른다. 없거나 던지면 undefined.
 * ⚠ 함수만 떼어 받지 않고 (객체, 이름)으로 받는 이유는 엔진이 this 를 쓰는 메서드로 구현했을 때
 *   떼어 부르면 조용히 터지기 때문이다.
 */
function safeCall(obj, name, ...args) {
  if (!obj || typeof obj[name] !== 'function') return undefined;
  try { return obj[name](...args); } catch { return undefined; }
}

/** JSON 왕복으로 직렬화 가능한 값만 남긴다. 순환 참조·함수·심볼이 섞여 있으면 null. */
function toJsonSafe(value) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : JSON.parse(text);
  } catch { return null; }
}

/**
 * 쓰레기 흡수: 숫자 아님(문자열 시각)·NaN·역전·영길이·중복 id 를 전부 걸러 정상 구간만 남긴다.
 * 결과의 모든 항목은 endSec > startSec 이고 id 가 서로 다르다.
 * ⚠ 순서는 정렬하지 않는다 — 엔진이 준 순서가 의미를 가질 수 있다.
 * @param {unknown} list 배열이 아니면 빈 배열
 * @returns {ClipSegment[]}
 */
export function normalizeClipSegments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (!raw || typeof raw !== 'object') continue;
    let startSec = Number(raw.startSec);
    let endSec = Number(raw.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    if (endSec < startSec) { const t = startSec; startSec = endSec; endSec = t; }
    if (!(endSec > startSec)) continue;
    let id = raw.id === undefined || raw.id === null ? '' : String(raw.id);
    if (!id) id = `seg${i}`;
    if (seen.has(id)) id = `${id}#${i}`;
    seen.add(id);
    /** @type {ClipSegment} */
    const seg = { id, startSec, endSec };
    if (raw.label !== undefined && raw.label !== null) seg.label = String(raw.label);
    if (raw.meta !== undefined) seg.meta = raw.meta;
    out.push(seg);
  }
  return out;
}

/**
 * 엔진이 준 러프한 세션을 EngineSession 으로 감싼다. 이 함수가 이 파일의 존재 이유다.
 * ★ guard 로 감싸는 이유가 핵심이다 — 엔진이 던진 예외가 안무표를 죽이면 안 된다.
 *   외부에서 통째로 들고 오는 코드에 대해 우리가 유일하게 통제할 수 있는 지점이 이 래퍼다.
 * @param {RawEngineSession|null|undefined} raw
 * @param {{onError?: (e: unknown) => void, wrap?: (fn: Function) => Function}} [options]
 *   wrap 은 onChange 콜백을 감쌀 스케줄러다. 기본은 그대로 부르기 —
 *   ⚠ 디바운스는 타이머라 포트에 둘 수 없다. 필요하면 어댑터가 wrap 으로 주입한다.
 * @returns {EngineSession}
 */
export function normalizeEngineSession(raw, options = {}) {
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const wrap = typeof options.wrap === 'function' ? options.wrap : (fn => fn);
  const guard = (fn, fallback) => (...args) => {
    try { return fn(...args); } catch (e) { onError(e); return fallback; }
  };

  // 엔진이 구간을 못 주게 되어도 "마지막으로 본 값"을 계속 돌려준다.
  let cached = normalizeClipSegments(safeCall(raw, 'getSegments'));

  const level = isMediaPlayer(safeCall(raw, 'getPlayer')) ? 2
    : typeof raw?.destroy === 'function' ? 1
      : 0;

  return {
    level,
    getSegments: () => cached,
    setSegments: typeof raw?.setSegments === 'function'
      ? guard(s => raw.setSegments(normalizeClipSegments(s)), undefined)
      : () => {},                                   // 단방향 엔진도 허용한다
    syncTime: typeof raw?.syncTime === 'function'
      ? guard(sec => raw.syncTime(sec), undefined)
      : () => {},
    getPlayer: () => { const p = safeCall(raw, 'getPlayer'); return isMediaPlayer(p) ? p : null; },
    getState: typeof raw?.getState === 'function'
      ? guard(() => toJsonSafe(raw.getState()), null)
      : () => null,
    onChange(cb) {                                  // 없으면 영원히 안 부르는 구독을 돌려준다
      if (typeof raw?.onChange !== 'function') return () => {};
      const handler = wrap(payload => {
        // 배열을 그대로 주는 엔진과 {segments:[...]} 로 감싸 주는 엔진을 둘 다 흡수한다
        cached = normalizeClipSegments(Array.isArray(payload) ? payload : payload?.segments);
        cb(cached);
      });
      const un = guard(() => raw.onChange(handler), undefined)();
      return typeof un === 'function' ? guard(un, undefined) : () => {};  // 해제 함수를 안 주는 엔진도 허용
    },
    destroy: guard(() => { raw?.destroy?.(); }, undefined)
  };
}
