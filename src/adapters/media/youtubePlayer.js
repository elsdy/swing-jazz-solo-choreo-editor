// src/adapters/media/youtubePlayer.js — YouTube IFrame API 재생기 (adapters 계층)
//
// 신규 파일이다. 원본 index.html 에는 재생기가 없고 window.open 3곳(5150·5162·5192)이 전부였다.
// ports/media.js 의 MediaPlayer 계약을 **전부** 채운다 — 마지막 줄의 assertMediaPlayer 가 그 증거다.
//
// ⚠ 이것이 이 앱의 두 번째 외부 네트워크 의존이자 **첫 외부 스크립트 의존**이다
//   (첫 번째는 adapters/youtubeOembed.js 의 fetch). 그래서 실패를 예외가 아니라 상태로 다룬다:
//   스크립트가 차단되거나(사내망·확장프로그램·오프라인) 영원히 안 오면 load() 는 던지지 않고
//   getState() 가 `{load:'error', error:{code:'network'}}` 를 돌려주며, 뷰가 그 코드를 보고
//   한국어 안내를 만든다. **여기서는 한국어 문구를 만들지 않는다**(ports/media.js 계약).
//
// ⚠ YouTube 에는 timeupdate 같은 시간 이벤트가 **아예 없다**. getCurrentTime() 폴링뿐이다.
//   그래서 onTime 의 "재생 중 ≥10Hz" 보장은 표본을 10Hz 로 뜨는 것이 아니라
//   **250ms 표본 + 소비자의 projectTime 보간**으로 만족시킨다(docs/PORTS.md 의 계약 해설).
//   표본을 10Hz 로 뜨면 iframe 경계를 넘는 호출이 초당 10번이라 저가 기기에서 눈에 띄게 버벅인다.
//   보간은 배속까지 정확히 반영하므로(projectTime 이 rate 를 곱한다) 화면은 오히려 60fps 로 매끄럽다.
//
// ⚠ seekToleranceSec 은 0.5 다. YT 의 seekTo 는 키프레임에 착지한다 — 180bpm 에서 1카운트가
//   0.333초이므로 "정확한 카운트로 점프"는 원리적으로 불가능하고, 유스케이스가 이 값을 보고
//   목표보다 앞을 겨냥해 탐색한 뒤 재생으로 통과시킨다. 숨기지 말고 밝히는 것이 계약이다.

import { assertMediaPlayer } from '../../ports/media.js';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** IFrame API 스크립트. 문서에 **딱 한 번만** 들어간다(loadYouTubeApi 가 window 단위로 기억한다). */
export const YT_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

/** 스크립트가 이 시간 안에 안 오면 차단으로 본다. onerror 를 안 주고 조용히 죽는 차단기가 있다. */
export const YT_API_TIMEOUT_MS = 10000;

/** 표본 간격. 계약의 10Hz 는 이 표본을 projectTime 으로 보간해서 만족시킨다(위 상단 주석). */
export const YT_SAMPLE_INTERVAL_MS = 250;

/** playVideo() 뒤 이만큼 기다려도 playing 이 안 되면 'blocked' 로 접는다. */
export const YT_PLAY_CONFIRM_MS = 1200;

/**
 * YouTube 재생기의 능력. **불변**이다.
 * needsUserGesture: 모바일 사파리·크롬은 첫 재생을 사용자 제스처 콜스택 안에서만 허용한다.
 * @type {Readonly<import('../../ports/media.js').MediaCapabilities>}
 */
export const YT_CAPABILITIES = Object.freeze({
  canSeek: true,
  seekToleranceSec: 0.5,
  rates: Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]),
  isLive: false,
  needsUserGesture: true
});

/** YT.PlayerState 숫자 → 포트의 PlayState. 5(cued)는 아직 시작 전이므로 unstarted 다. */
const PLAY_STATE_OF = Object.freeze({
  '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'unstarted'
});

/**
 * YT 오류 코드 → 포트의 MediaErrorCode 5종.
 * 2 = 잘못된 파라미터(videoId 가 이상하다) · 5 = HTML5 플레이어 오류 ·
 * 100 = 없거나 비공개 · 101/150 = 임베드 금지(퍼블리셔가 막았다. 사용자가 할 수 있는 게 없다).
 */
const ERROR_CODE_OF = Object.freeze({
  2: 'unsupported', 5: 'unknown', 100: 'not-found', 101: 'not-embeddable', 150: 'not-embeddable'
});

// ─────────────────────────────────────────────────────────────────────────────
// 바깥세상 기본값 — node(단위 테스트)에서도 로드만은 되어야 하므로 전부 옵셔널이다
// ─────────────────────────────────────────────────────────────────────────────

/** 브라우저면 window, 아니면 null. 모듈 로드 시점에 읽지 않는다(테스트가 주입할 수 있게). */
function defaultWin() {
  return typeof window === 'undefined' ? null : window;
}

/** 브라우저면 document, 아니면 null. */
function defaultDoc() {
  return typeof document === 'undefined' ? null : document;
}

/**
 * 타이머와 시계. 주입 가능한 이유는 테스트 때문만이 아니다 — 표본의 atMs 가
 * performance.now() 기준이어야 projectTime 의 뺄셈이 맞는다(ports/media.js 의 TimeSample).
 */
function defaultTimers() {
  const hasPerf = typeof performance !== 'undefined' && typeof performance.now === 'function';
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    now: hasPerf ? () => performance.now() : () => Date.now()
  };
}

/** 남의 객체(YT.Player)의 메서드를 부른다. 없거나 던지면 undefined — iframe 은 언제든 죽을 수 있다. */
function safeCall(obj, name, ...args) {
  if (!obj || typeof obj[name] !== 'function') return undefined;
  try { return obj[name](...args); } catch { return undefined; }
}

// ─────────────────────────────────────────────────────────────────────────────
// API 스크립트 로더 — window 하나당 정확히 한 번
// ─────────────────────────────────────────────────────────────────────────────

/**
 * window 별 로드 약속. **재시도하지 않는다** — 한 번 차단된 스크립트는 새로고침 전까지 계속 차단된다.
 * @type {WeakMap<object, Promise<{ok:true, YT:any}|{ok:false, code:string, message:string}>>}
 */
const apiPromises = new WeakMap();

/**
 * YT IFrame API 를 필요할 때 **한 번만** 로드한다.
 *
 * ★ 절대 reject 하지 않는다. 실패도 값이다 — `{ok:false, code:'network'}`.
 *   여기서 던지면 load() 를 부른 모든 자리가 try/catch 를 들어야 하고, 그 중 하나만 빠뜨려도
 *   미처리 거부가 콘솔에 새어 나간다.
 *
 * ⚠ 전역 콜백 `onYouTubeIframeAPIReady` 는 YT 가 이름으로 부르는 자리라 우리가 고를 수 없다.
 *   이미 누가 걸어 두었으면 **덮지 않고 이어서 부른다**(우리가 남의 앱을 깨지 않기 위해).
 *
 * @param {{win?: object|null, doc?: object|null, timers?: object}} [env]
 * @returns {Promise<{ok:true, YT:any}|{ok:false, code:'network'|'unsupported', message:string}>}
 */
export function loadYouTubeApi(env = {}) {
  const win = env.win === undefined ? defaultWin() : env.win;
  const doc = env.doc === undefined ? defaultDoc() : env.doc;
  const timers = env.timers || defaultTimers();

  if (!win || !doc) {
    return Promise.resolve({ ok: false, code: 'unsupported', message: 'no window/document' });
  }
  // 이미 붙어 있으면(다른 스크립트가 먼저 넣었거나 우리가 먼저 넣었거나) 그대로 쓴다.
  if (win.YT && typeof win.YT.Player === 'function') {
    return Promise.resolve({ ok: true, YT: win.YT });
  }
  const cached = apiPromises.get(win);
  if (cached) return cached;

  const promise = new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) timers.clearTimeout(timeoutId);
      // 실패는 기억하지 않는다면 매 클릭마다 <script> 가 하나씩 쌓인다. 기억한 채로 둔다.
      resolve(result);
    };

    const prevReady = typeof win.onYouTubeIframeAPIReady === 'function' ? win.onYouTubeIframeAPIReady : null;
    win.onYouTubeIframeAPIReady = function onReady() {
      if (prevReady) { try { prevReady(); } catch { /* 남의 콜백이 던져도 우리는 계속한다 */ } }
      finish(win.YT && typeof win.YT.Player === 'function'
        ? { ok: true, YT: win.YT }
        : { ok: false, code: 'network', message: 'YT.Player missing after ready' });
    };

    let tag;
    try {
      tag = doc.createElement('script');
      tag.src = YT_IFRAME_API_SRC;
      tag.async = true;
      tag.onerror = () => finish({ ok: false, code: 'network', message: 'iframe_api load failed' });
      const first = doc.getElementsByTagName('script')[0];
      if (first && first.parentNode) first.parentNode.insertBefore(tag, first);
      else if (doc.head) doc.head.appendChild(tag);
      else finish({ ok: false, code: 'unsupported', message: 'no insertion point' });
    } catch (e) {
      finish({ ok: false, code: 'network', message: String(e && e.message ? e.message : e) });
    }

    // ⚠ 조용한 차단 대비. 광고 차단기·기업 프록시는 onerror 없이 요청을 삼키기도 한다.
    timeoutId = timers.setTimeout(
      () => finish({ ok: false, code: 'network', message: 'iframe_api timeout' }),
      YT_API_TIMEOUT_MS
    );
  });

  apiPromises.set(win, promise);
  return promise;
}

/** 테스트용. window 별 로드 기억을 지운다(운영 경로에서는 부르지 않는다). */
export function forgetYouTubeApi(win) {
  if (win) apiPromises.delete(win);
}

// ─────────────────────────────────────────────────────────────────────────────
// 재생기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * YouTube IFrame API 를 MediaPlayer 계약으로 감싼다.
 *
 * ★ 생성 시점에는 DOM 도 네트워크도 건드리지 않는다. 스크립트는 첫 load(source) 에서 붙는다 —
 *   패널을 한 번도 안 연 사용자가 유튜브에 요청을 보내면 안 되고, 그 덕에 node 에서
 *   `assertMediaPlayer(createYouTubePlayer())` 한 줄로 계약을 검사할 수 있다.
 *
 * @param {{
 *   container?: any,             YT.Player 가 iframe 으로 갈아치울 엘리먼트(또는 그 id)
 *   win?: object|null, doc?: object|null,
 *   timers?: {setTimeout:Function, clearTimeout:Function, setInterval:Function, clearInterval:Function, now:()=>number},
 *   loadApi?: (env:object) => Promise<any>,   테스트 주입점. 기본은 위의 loadYouTubeApi
 *   sampleIntervalMs?: number,
 *   playConfirmMs?: number,
 *   playerVars?: object|null     기본 위에 덧씌운다. origin/enablejsapi 는 여기서 정한다
 * }} [options]
 * @returns {import('../../ports/media.js').MediaPlayer}
 */
export function createYouTubePlayer(options = {}) {
  const container = options.container == null ? null : options.container;
  const win = options.win === undefined ? defaultWin() : options.win;
  const doc = options.doc === undefined ? defaultDoc() : options.doc;
  const timers = options.timers || defaultTimers();
  const loadApi = typeof options.loadApi === 'function' ? options.loadApi : loadYouTubeApi;
  const sampleIntervalMs = Number.isFinite(options.sampleIntervalMs) ? options.sampleIntervalMs : YT_SAMPLE_INTERVAL_MS;
  const playConfirmMs = Number.isFinite(options.playConfirmMs) ? options.playConfirmMs : YT_PLAY_CONFIRM_MS;

  /** @type {any} YT.Player 인스턴스. 없으면 아직 안 만들었거나 destroy 된 것이다. */
  let yt = null;
  /** @type {import('../../ports/media.js').MediaSource|null} */
  let source = null;
  let loadState = 'idle';
  let playState = 'unstarted';
  /** @type {{code:string, message:string}|null} */
  let error = null;
  /** @type {import('../../ports/media.js').TimeSample|null} */
  let sample = null;
  let rate = 1;
  let destroyed = false;
  let pollId = null;
  /**
   * 준비 전에 들어온 마지막 의도 **하나**. 계약이 "마지막 의도 1개만 큐잉"이라 배열이 아니다 —
   * 사용자가 로딩 중에 이리저리 눌렀다면 마지막으로 원한 것 하나만 이뤄 주는 게 맞다.
   * @type {{kind:'play'}|{kind:'seek', sec:number}|null}
   */
  let pending = null;

  const timeListeners = new Set();
  const stateListeners = new Set();
  /** 상태 변화를 한 번만 기다리는 대기자들(play() 의 'blocked' 합성이 쓴다). */
  const stateWaiters = new Set();

  // ── 상태 통지 ──────────────────────────────────────────────────────────────

  function snapshotState() {
    return { load: loadState, play: playState, error };
  }

  function notifyState() {
    const s = snapshotState();
    for (const waiter of [...stateWaiters]) waiter(s);
    for (const cb of [...stateListeners]) { try { cb(s); } catch { /* 구독자 예외가 재생을 죽이면 안 된다 */ } }
  }

  function setError(code, message) {
    loadState = 'error';
    error = { code, message: String(message || code) };
    stopPolling();
    notifyState();
  }

  // ── 표본 ──────────────────────────────────────────────────────────────────

  /** yt 에서 현재 시각을 읽는다. 못 읽으면 마지막 표본의 값, 그것도 없으면 0. */
  function readCurrentTime() {
    const sec = safeCall(yt, 'getCurrentTime');
    if (Number.isFinite(sec)) return sec;
    return sample ? sample.sec : 0;
  }

  /**
   * 표본을 하나 떠서 구독자에게 보낸다. seek 직후·상태 변화 직후·구독 즉시·폴링마다 불린다.
   * @returns {import('../../ports/media.js').TimeSample}
   */
  function emitSample() {
    sample = {
      sec: readCurrentTime(),
      atMs: timers.now(),
      rate,
      playing: playState === 'playing'
    };
    for (const cb of [...timeListeners]) { try { cb(sample); } catch { /* 위와 같다 */ } }
    return sample;
  }

  function startPolling() {
    if (pollId !== null || destroyed) return;
    pollId = timers.setInterval(() => { if (!destroyed) emitSample(); }, sampleIntervalMs);
  }

  function stopPolling() {
    if (pollId === null) return;
    timers.clearInterval(pollId);
    pollId = null;
  }

  // ── YT 이벤트 ─────────────────────────────────────────────────────────────

  function handleStateChange(ev) {
    if (destroyed) return;
    // ⚠ YT 이벤트는 `yt = new YT.Player(...)` 대입보다 **먼저** 올 수 있다(onReady 가 그렇다).
    //   그때 yt 가 null 이면 getCurrentTime 도 flushPending 도 조용히 헛돈다. target 으로 먼저 붙인다.
    if (!yt && ev && ev.target) yt = ev.target;
    const next = PLAY_STATE_OF[String(ev && ev.data)];
    if (next) playState = next;
    // 배속은 상태가 바뀔 때 다시 읽는다 — 사용자가 YT 자체 UI 로 바꿀 수 있기 때문이다.
    const r = safeCall(yt, 'getPlaybackRate');
    if (Number.isFinite(r) && r > 0) rate = r;
    if (playState === 'playing') startPolling(); else stopPolling();
    emitSample();        // 계약: 상태 변화 직후 1회
    notifyState();
  }

  function handleError(ev) {
    if (destroyed) return;
    const code = ERROR_CODE_OF[String(ev && ev.data)] || 'unknown';
    setError(code, `YT error ${ev && ev.data}`);
  }

  /** 준비되었을 때 큐에 남은 의도 하나를 적용한다. */
  function flushPending() {
    const intent = pending;
    pending = null;
    if (!intent) return;
    if (intent.kind === 'play') player.play();
    else if (intent.kind === 'seek') player.seek(intent.sec);
  }

  function markReady() {
    loadState = 'ready';
    error = null;
    const r = safeCall(yt, 'getPlaybackRate');
    if (Number.isFinite(r) && r > 0) rate = r;
    notifyState();
    emitSample();
    flushPending();
  }

  // ── 생성/교체 ─────────────────────────────────────────────────────────────

  /** 컨테이너를 비운다. destroy 의 계약("컨테이너를 비운 채 남긴다")과 재생성이 함께 쓴다. */
  function clearContainer() {
    if (container && typeof container === 'object' && 'innerHTML' in container) {
      try { container.innerHTML = ''; } catch { /* 이미 떨어져 나간 노드 */ }
    }
  }

  function destroyYt() {
    if (!yt) return;
    safeCall(yt, 'destroy');
    yt = null;
    clearContainer();
  }

  /**
   * YT.Player 를 새로 만든다. onReady 에서 resolve 한다.
   * ⚠ enablejsapi 와 origin 이 둘 다 있어야 API 가 붙는다. file:// 의 origin 은 'null' 이라
   *   애초에 동작하지 않는다 — docs/PORTS.md 가 정적 서버를 전제로 못박은 이유다.
   */
  function createPlayer(YT, src) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      const origin = win && win.location && win.location.origin ? win.location.origin : undefined;
      try {
        const created = new YT.Player(container, {
          videoId: src.videoId,
          playerVars: {
            enablejsapi: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            ...(origin ? { origin } : {}),
            ...(Number.isFinite(src.startSec) && src.startSec > 0 ? { start: Math.floor(src.startSec) } : {}),
            ...(options.playerVars || {})
          },
          events: {
            onReady: (ev) => {
              if (!yt && ev && ev.target) yt = ev.target;   // 위 handleStateChange 의 주석과 같은 이유
              if (!destroyed) markReady();
              done();
            },
            onStateChange: handleStateChange,
            onError: (ev) => { handleError(ev); done(); }
          }
        });
        if (!yt) yt = created;
      } catch (e) {
        setError('unknown', String(e && e.message ? e.message : e));
        done();
      }
    });
  }

  // ── MediaPlayer ───────────────────────────────────────────────────────────

  const player = {
    kind: 'youtube',
    capabilities: YT_CAPABILITIES,

    getState() {
      return snapshotState();
    },

    /** @returns {number|null} 0 이나 NaN 은 "모른다"이지 "0초짜리"가 아니다 — null 로 접는다. */
    getDuration() {
      const d = safeCall(yt, 'getDuration');
      return Number.isFinite(d) && d > 0 ? d : null;
    },

    getTimeSample() {
      return sample;
    },

    /**
     * 소스 교체. **준비 완료에 resolve** 하고, 실패해도 던지지 않는다(상태로 알린다).
     * ⚠ 이미 플레이어가 있으면 재생성하지 않고 cueVideoById 로 소스만 바꾼다 — iframe 을 다시
     *   만들면 로딩이 눈에 보이게 끊기고, 부모가 바뀌는 것도 아닌데 재생 컨텍스트가 날아간다.
     * @param {import('../../ports/media.js').MediaSource|null} next
     * @returns {Promise<void>}
     */
    async load(next) {
      if (destroyed) return;

      if (next == null) {                       // 소스 비우기 = 정상 경로다(오류가 아니다)
        source = null;
        destroyYt();
        stopPolling();
        loadState = 'idle';
        playState = 'unstarted';
        error = null;
        sample = null;
        pending = null;
        notifyState();
        return;
      }
      if (next.kind !== 'youtube' || !next.videoId) {
        source = next;
        setError('unsupported', `unsupported source: ${next.kind}`);
        return;
      }

      source = next;
      loadState = 'loading';
      error = null;
      notifyState();

      const api = await loadApi({ win, doc, timers });
      if (destroyed) return;
      if (!api || api.ok !== true) {
        setError(api && api.code ? api.code : 'network', api && api.message ? api.message : 'api load failed');
        return;
      }
      // 로딩 중에 다시 load() 가 불려 소스가 바뀌었으면 이 호출은 낡았다 — 조용히 물러난다.
      if (source !== next) return;

      if (yt) {
        // 같은 kind 이므로 재생성 없이 소스만 교체한다(계약).
        safeCall(yt, 'cueVideoById', {
          videoId: next.videoId,
          startSeconds: Number.isFinite(next.startSec) ? next.startSec : 0
        });
        playState = 'unstarted';
        markReady();
        return;
      }
      if (!container) {
        setError('unsupported', 'no container');
        return;
      }
      await createPlayer(api.YT, next);
    },

    /**
     * ★ 절대 reject 하지 않는다. 자동재생 차단은 예외가 아니라 'blocked' 라는 **결과**다.
     * YT 의 playVideo() 는 차단당해도 조용히 아무 일도 하지 않으므로, 상태 변화를 잠시 기다렸다가
     * 안 오면 'blocked' 를 합성한다(<video> 쪽의 NotAllowedError 와 같은 자리에 접힌다).
     * @returns {Promise<import('../../ports/media.js').PlayResult>}
     */
    play() {
      if (destroyed || source == null) return Promise.resolve('no-source');
      if (loadState === 'error') return Promise.resolve('error');
      if (loadState !== 'ready' || !yt) {
        pending = { kind: 'play' };
        return Promise.resolve('not-ready');
      }
      if (playState === 'playing') return Promise.resolve('started');

      return new Promise((resolve) => {
        let settled = false;
        let timeoutId = null;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          stateWaiters.delete(waiter);
          if (timeoutId !== null) timers.clearTimeout(timeoutId);
          resolve(result);
        };
        const waiter = (s) => {
          if (s.load === 'error') finish('error');
          else if (s.play === 'playing' || s.play === 'buffering') finish('started');
        };
        // ⚠ 대기자를 **playVideo 보다 먼저** 등록한다. 상태 변화가 동기로 오는 구현(테스트 스텁,
        //   그리고 이미 버퍼링된 영상)에서는 나중에 등록하면 그 한 번을 통째로 놓쳐 항상 'blocked' 가 된다.
        stateWaiters.add(waiter);
        timeoutId = timers.setTimeout(() => finish('blocked'), playConfirmMs);
        safeCall(yt, 'playVideo');
        waiter(snapshotState());
      });
    },

    pause() {
      if (destroyed) return;
      safeCall(yt, 'pauseVideo');
    },

    /**
     * ★ **실제 착지 시각**을 돌려준다. YT 는 키프레임에 스냅하므로 요청과 다를 수 있고,
     * 그 차이의 상한이 capabilities.seekToleranceSec(0.5) 다.
     * @param {number} sec
     * @param {{scrubbing?: boolean}} [opts] scrubbing:true 는 저비용 미리보기(allowSeekAhead=false)
     * @returns {Promise<number>}
     */
    seek(sec, opts = {}) {
      const want = Number(sec);
      if (!Number.isFinite(want)) return Promise.resolve(sample ? sample.sec : 0);
      if (destroyed || source == null) return Promise.resolve(want);
      if (loadState !== 'ready' || !yt) {
        pending = { kind: 'seek', sec: want };   // 준비되면 적용한다(던지지 않는다)
        return Promise.resolve(want);
      }
      safeCall(yt, 'seekTo', want, !opts.scrubbing);
      const landed = readCurrentTime();
      emitSample();                              // 계약: seek 직후 1회
      return Promise.resolve(landed);
    },

    /** capabilities.rates 밖의 값은 무시한다. ⚠ 배속은 카운트 매핑을 바꾸지 않는다(보간에만 들어간다). */
    setRate(next) {
      if (destroyed) return;
      const r = Number(next);
      if (!Number.isFinite(r) || r <= 0) return;
      rate = r;
      safeCall(yt, 'setPlaybackRate', r);
      emitSample();
    },

    setMuted(muted) {
      if (destroyed) return;
      safeCall(yt, muted ? 'mute' : 'unMute');
    },

    /**
     * 시각 표본 구독. 계약 3가지를 여기서 지킨다 —
     * 재생 중 250ms 표본(+ 소비자 보간) · seek/상태변화 직후 1회 · **구독 즉시 1회**.
     * @param {(s: import('../../ports/media.js').TimeSample) => void} cb
     * @returns {() => void} 해제 함수
     */
    onTime(cb) {
      if (typeof cb !== 'function') return () => {};
      timeListeners.add(cb);
      // 구독 즉시 1회. 표본이 아직 없고 플레이어도 없으면 보낼 값이 없다(널 재생기와 같은 예외).
      if (sample) { try { cb(sample); } catch { /* 무시 */ } }
      else if (yt) emitSample();
      return () => { timeListeners.delete(cb); };
    },

    /**
     * @param {(s: {load:string, play:string, error:object|null}) => void} cb
     * @returns {() => void}
     */
    onState(cb) {
      if (typeof cb !== 'function') return () => {};
      stateListeners.add(cb);
      return () => { stateListeners.delete(cb); };
    },

    /** ★ 멱등. 타이머·구독·iframe 을 전부 걷고 컨테이너를 **비운 채로** 남긴다. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPolling();
      destroyYt();
      timeListeners.clear();
      stateListeners.clear();
      stateWaiters.clear();
      pending = null;
      sample = null;
      source = null;
      loadState = 'idle';
      playState = 'unstarted';
      error = null;
    }
  };

  // 포트 계약의 자기검증. 멤버가 하나라도 빠지면 여기서 즉시 TypeError 로 드러난다.
  return assertMediaPlayer(player, 'youtubePlayer');
}
