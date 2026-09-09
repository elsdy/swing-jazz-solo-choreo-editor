// src/adapters/media/filePlayer.js — 로컬 영상 파일을 <video> 로 재생하는 MediaPlayer (adapters 계층)
//
// 신규 파일이다. 원본 index.html 에 대응물이 없다 — 오늘까지 이 앱의 재생기는 YouTube 하나였다.
// ports/media.js 의 MediaPlayer 계약을 **전부** 채운다 — 마지막 줄의 assertMediaPlayer 가 그 증거다.
//
// ⚠ 이 어댑터는 파일을 고르지도, blob URL 을 만들지도 않는다. `URL.createObjectURL` 은 만든 쪽이
//   revoke 까지 책임져야 하므로 app/main 이 한다. 여기 들어오는 것은 이미 만들어진 `{kind:'file', url}` 뿐이다.
//   그래서 node 에서 fake document 하나로 전 경로를 검사할 수 있다.
//
// ⚠ <video> 의 timeupdate 는 4Hz 다 — 재생 헤드를 그리기엔 너무 성기다(docs/PORTS.md). 계약의 "재생 중 ≥10Hz"
//   는 YouTube 어댑터와 같은 방식으로 지킨다: **100ms 표본 + 소비자의 projectTime 보간**. timeupdate 도
//   듣되 표본을 뜨는 계기로만 쓴다(값은 언제나 video.currentTime 에서 읽는다).
//
// ⚠ seekToleranceSec 은 0.05 다. <video> 는 정확한 시각에 착지하므로(키프레임 스냅이 없다) YouTube 의
//   0.5 보다 10배 정확하다 — 180bpm 에서도 1카운트(0.333s) 안에 든다. 유스케이스는 이 값으로 프리롤을 줄인다.
//
// ⚠ 실패는 예외가 아니라 상태다. <video> 의 `error` 이벤트는 MediaError.code 로 오고, 그것을 포트의
//   MediaErrorCode 5종으로 접는다. **여기서는 한국어 문구를 만들지 않는다**(ports/media.js 계약).

import { assertMediaPlayer } from '../../ports/media.js';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 표본 간격. timeupdate(4Hz)가 성겨서 재생 중에는 이 간격으로 따로 뜬다(YT 와 같은 전략). */
export const FILE_SAMPLE_INTERVAL_MS = 100;

/**
 * 로컬 <video> 재생기의 능력. **불변**이다.
 * needsUserGesture: 소리 있는 영상의 첫 play() 는 사용자 제스처 안에서만 허용된다(자동재생 정책).
 * @type {Readonly<import('../../ports/media.js').MediaCapabilities>}
 */
export const FILE_CAPABILITIES = Object.freeze({
  canSeek: true,
  seekToleranceSec: 0.05,
  rates: Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]),
  isLive: false,
  needsUserGesture: true
});

/**
 * MediaError.code → 포트의 MediaErrorCode.
 * 1 = 사용자가 중단(ABORTED) · 2 = 네트워크 · 3 = 디코드 실패 · 4 = 소스를 지원하지 않음.
 */
const ERROR_CODE_OF = Object.freeze({
  1: 'unknown', 2: 'network', 3: 'unsupported', 4: 'unsupported'
});

/** 이 어댑터가 <video> 에 거는 이벤트 전부. destroy 가 같은 목록으로 뗀다. */
const VIDEO_EVENTS = Object.freeze([
  'loadedmetadata', 'error', 'play', 'playing', 'pause', 'ended', 'waiting', 'seeked', 'timeupdate', 'ratechange'
]);

// ─────────────────────────────────────────────────────────────────────────────
// 바깥세상 기본값 — node(단위 테스트)에서도 로드만은 되어야 하므로 전부 옵셔널이다
// ─────────────────────────────────────────────────────────────────────────────

function defaultDoc() {
  return typeof document === 'undefined' ? null : document;
}

function defaultTimers() {
  const hasPerf = typeof performance !== 'undefined' && typeof performance.now === 'function';
  return {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    now: hasPerf ? () => performance.now() : () => Date.now()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 재생기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * <video> 를 MediaPlayer 계약으로 감싼다.
 *
 * ★ 생성 시점에는 DOM 을 건드리지 않는다. <video> 는 첫 load(source) 에서 컨테이너 안에 만든다 —
 *   덕분에 node 에서 `assertMediaPlayer(createFilePlayer())` 한 줄로 계약을 검사할 수 있다.
 *
 * @param {{
 *   container?: any,       <video> 를 넣을 엘리먼트. YT 와 달리 갈아치우지 않고 **안에** 넣는다
 *   doc?: object|null,     createElement 를 가진 것. 테스트가 가짜를 준다
 *   timers?: {setInterval:Function, clearInterval:Function, now:()=>number},
 *   sampleIntervalMs?: number
 * }} [options]
 * @returns {import('../../ports/media.js').MediaPlayer}
 */
export function createFilePlayer(options = {}) {
  const container = options.container == null ? null : options.container;
  const doc = options.doc === undefined ? defaultDoc() : options.doc;
  const timers = options.timers || defaultTimers();
  const sampleIntervalMs = Number.isFinite(options.sampleIntervalMs) ? options.sampleIntervalMs : FILE_SAMPLE_INTERVAL_MS;

  /** @type {any} <video> 엘리먼트. 없으면 아직 안 만들었거나 destroy 된 것이다. */
  let video = null;
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
  /** 준비 전에 들어온 마지막 의도 **하나**(계약: 마지막 의도 1개만 큐잉). */
  let pending = null;
  /** load() 가 resolve 할 때 부른다. 준비(loadedmetadata)나 오류에서 끝난다. */
  let settleLoad = null;

  const timeListeners = new Set();
  const stateListeners = new Set();

  // ── 상태 통지 ──────────────────────────────────────────────────────────────

  function snapshotState() {
    return { load: loadState, play: playState, error };
  }

  function notifyState() {
    const s = snapshotState();
    for (const cb of [...stateListeners]) { try { cb(s); } catch { /* 구독자 예외가 재생을 죽이면 안 된다 */ } }
  }

  function finishLoad() {
    const done = settleLoad;
    settleLoad = null;
    if (done) done();
  }

  function setError(code, message) {
    loadState = 'error';
    error = { code, message: String(message || code) };
    stopPolling();
    notifyState();
    finishLoad();
  }

  // ── 표본 ──────────────────────────────────────────────────────────────────

  function readCurrentTime() {
    const sec = video ? Number(video.currentTime) : NaN;
    if (Number.isFinite(sec)) return sec;
    return sample ? sample.sec : 0;
  }

  /** 표본을 하나 떠서 구독자에게 보낸다. seek·상태 변화·구독 즉시·폴링·timeupdate 마다 불린다. */
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

  function setPlayState(next) {
    playState = next;
    if (playState === 'playing') startPolling(); else stopPolling();
    emitSample();        // 계약: 상태 변화 직후 1회
    notifyState();
  }

  // ── <video> 이벤트 ────────────────────────────────────────────────────────

  /** 준비되었을 때 큐에 남은 의도 하나를 적용한다. */
  function flushPending() {
    const intent = pending;
    pending = null;
    if (!intent) return;
    if (intent.kind === 'play') player.play();
    else if (intent.kind === 'seek') player.seek(intent.sec);
  }

  function handleEvent(ev) {
    if (destroyed || !video) return;
    switch (ev && ev.type) {
      case 'loadedmetadata':
        loadState = 'ready';
        error = null;
        playState = 'unstarted';
        notifyState();
        emitSample();
        flushPending();
        finishLoad();
        break;
      case 'error': {
        const mediaErr = video.error;
        const code = ERROR_CODE_OF[String(mediaErr && mediaErr.code)] || 'unknown';
        setError(code, mediaErr && mediaErr.message ? mediaErr.message : `MediaError ${mediaErr && mediaErr.code}`);
        break;
      }
      case 'play':
      case 'playing':
        setPlayState('playing');
        break;
      case 'waiting':
        setPlayState('buffering');
        break;
      case 'pause':
        setPlayState(video.ended ? 'ended' : 'paused');
        break;
      case 'ended':
        setPlayState('ended');
        break;
      case 'ratechange': {
        const r = Number(video.playbackRate);
        if (Number.isFinite(r) && r > 0) rate = r;
        emitSample();
        break;
      }
      case 'seeked':
      case 'timeupdate':
        emitSample();
        break;
      default:
        break;
    }
  }

  // ── 생성/교체 ─────────────────────────────────────────────────────────────

  function clearContainer() {
    if (container && typeof container === 'object' && 'innerHTML' in container) {
      try { container.innerHTML = ''; } catch { /* 이미 떨어져 나간 노드 */ }
    }
  }

  function destroyVideo() {
    if (!video) return;
    for (const type of VIDEO_EVENTS) {
      try { video.removeEventListener(type, handleEvent); } catch { /* 가짜 엘리먼트 */ }
    }
    try { video.pause(); } catch { /* 무시 */ }
    // src 를 비워야 브라우저가 디코더와 파일 핸들을 놓는다. blob URL 의 revoke 는 만든 쪽(app/main)이 한다.
    try { video.removeAttribute('src'); video.load(); } catch { /* 무시 */ }
    video = null;
    clearContainer();
  }

  /** <video> 를 컨테이너 안에 만든다. 이미 있으면 그대로 쓴다(같은 kind 는 재생성하지 않는다 — 계약). */
  function ensureVideo() {
    if (video) return video;
    if (!doc || typeof doc.createElement !== 'function' || !container) return null;
    const el = doc.createElement('video');
    el.controls = true;
    el.playsInline = true;
    el.preload = 'metadata';
    for (const type of VIDEO_EVENTS) el.addEventListener(type, handleEvent);
    clearContainer();
    if (typeof container.appendChild === 'function') container.appendChild(el);
    video = el;
    return el;
  }

  // ── MediaPlayer ───────────────────────────────────────────────────────────

  const player = {
    kind: 'file',
    capabilities: FILE_CAPABILITIES,

    getState() {
      return snapshotState();
    },

    /** @returns {number|null} NaN·0·Infinity 는 "모른다"다 — null 로 접는다. */
    getDuration() {
      const d = video ? Number(video.duration) : NaN;
      return Number.isFinite(d) && d > 0 ? d : null;
    },

    getTimeSample() {
      return sample;
    },

    /**
     * 소스 교체. **준비 완료(loadedmetadata)에 resolve** 하고, 실패해도 던지지 않는다(상태로 알린다).
     * @param {import('../../ports/media.js').MediaSource|null} next
     * @returns {Promise<void>}
     */
    load(next) {
      if (destroyed) return Promise.resolve();
      finishLoad();                              // 앞선 load 가 아직 기다리고 있으면 낡은 것이다 — 풀어 준다

      if (next == null) {                        // 소스 비우기 = 정상 경로다(오류가 아니다)
        source = null;
        destroyVideo();
        stopPolling();
        loadState = 'idle';
        playState = 'unstarted';
        error = null;
        sample = null;
        pending = null;
        notifyState();
        return Promise.resolve();
      }
      if (next.kind !== 'file' || !next.url) {
        source = next;
        setError('unsupported', `unsupported source: ${next.kind}`);
        return Promise.resolve();
      }

      source = next;
      const el = ensureVideo();
      if (!el) {
        setError('unsupported', 'no container');
        return Promise.resolve();
      }
      loadState = 'loading';
      playState = 'unstarted';
      error = null;
      sample = null;
      notifyState();

      return new Promise((resolve) => {
        settleLoad = resolve;
        try {
          el.src = next.url;
          if (typeof el.load === 'function') el.load();
        } catch (e) {
          setError('unknown', String(e && e.message ? e.message : e));
        }
      });
    },

    /**
     * ★ 절대 reject 하지 않는다. `<video>.play()` 의 NotAllowedError(자동재생 차단)는 'blocked' 로 접는다.
     * @returns {Promise<import('../../ports/media.js').PlayResult>}
     */
    play() {
      if (destroyed || source == null) return Promise.resolve('no-source');
      if (loadState === 'error') return Promise.resolve('error');
      if (loadState !== 'ready' || !video) {
        pending = { kind: 'play' };
        return Promise.resolve('not-ready');
      }
      if (playState === 'playing') return Promise.resolve('started');

      let result;
      try { result = video.play(); } catch (e) { return Promise.resolve(classifyPlayError(e)); }
      if (!result || typeof result.then !== 'function') {
        // 옛 브라우저(또는 가짜 엘리먼트)는 Promise 를 안 준다 — 이벤트가 상태를 바꾼다.
        return Promise.resolve('started');
      }
      return result.then(() => 'started', (e) => classifyPlayError(e));
    },

    pause() {
      if (destroyed || !video) return;
      try { video.pause(); } catch { /* 무시 */ }
    },

    /**
     * ★ 실제 착지 시각을 돌려준다. <video> 는 요청한 시각에 그대로 착지하므로 요청값과 같고,
     *   차이의 상한이 capabilities.seekToleranceSec(0.05) 다.
     * @param {number} sec
     * @returns {Promise<number>}
     */
    seek(sec) {
      const want = Number(sec);
      if (!Number.isFinite(want)) return Promise.resolve(sample ? sample.sec : 0);
      if (destroyed || source == null) return Promise.resolve(want);
      if (loadState !== 'ready' || !video) {
        pending = { kind: 'seek', sec: want };   // 준비되면 적용한다(던지지 않는다)
        return Promise.resolve(want);
      }
      const duration = player.getDuration();
      const target = Math.max(0, duration ? Math.min(want, duration) : want);
      try { video.currentTime = target; } catch { /* 아직 seekable 이 아니다 */ }
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
      if (video) { try { video.playbackRate = r; } catch { /* 무시 */ } }
      emitSample();
    },

    setMuted(muted) {
      if (destroyed || !video) return;
      video.muted = !!muted;
    },

    /**
     * 시각 표본 구독 — 재생 중 100ms 표본(+ 소비자 보간) · seek/상태변화 직후 1회 · **구독 즉시 1회**.
     * @param {(s: import('../../ports/media.js').TimeSample) => void} cb
     * @returns {() => void}
     */
    onTime(cb) {
      if (typeof cb !== 'function') return () => {};
      timeListeners.add(cb);
      if (sample) { try { cb(sample); } catch { /* 무시 */ } }
      else if (video) emitSample();
      return () => { timeListeners.delete(cb); };
    },

    onState(cb) {
      if (typeof cb !== 'function') return () => {};
      stateListeners.add(cb);
      return () => { stateListeners.delete(cb); };
    },

    /** ★ 멱등. 타이머·구독·<video> 를 전부 걷고 컨테이너를 **비운 채로** 남긴다. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPolling();
      finishLoad();
      destroyVideo();
      timeListeners.clear();
      stateListeners.clear();
      pending = null;
      sample = null;
      source = null;
      loadState = 'idle';
      playState = 'unstarted';
      error = null;
    }
  };

  /** play() 의 거부 → PlayResult. 자동재생 차단은 'blocked', 그 밖은 'error'(상태도 오류로 바꾸지 않는다). */
  function classifyPlayError(e) {
    const name = e && e.name;
    return name === 'NotAllowedError' ? 'blocked' : 'error';
  }

  // 포트 계약의 자기검증. 멤버가 하나라도 빠지면 여기서 즉시 TypeError 로 드러난다.
  return assertMediaPlayer(player, 'filePlayer');
}
