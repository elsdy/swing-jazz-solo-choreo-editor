// src/adapters/media/clockPlayer.js — 영상 없이 박자로 도는 가상 재생기 (adapters 계층, RM-22 · 2026-10-01)
//
// 영상이 없어도 박자(BPM)만 있으면 안무표 위에서 재생 헤드와 카운트 소리를 돌린다 — 「영상 없이 표만으로
// 연습」이 이 재생기의 일이다. MediaPlayer 계약을 그대로 채우므로 재생 헤드 · 구간 반복 · 배속 · 카운트 소리는
// 이것이 가짜인지 모른다(app/main 의 enforceLoop 도, ui/playhead 도 그대로 쓴다).
//
// 시계는 performance.now() 하나다. 「지금 몇 초인가」는 (마지막으로 맞춘 영상 시각) + (그 뒤 흐른 벽시계 × 배속)이다.
// 박자는 모른다 — 이 재생기는 초만 낸다(ports/media.js 의 단방향 규칙). 끝은 호출부가 getDurationSec 로 알려 준다
// (안무표 끝). 끝에 닿으면 'ended' 로 멈춘다.

import { assertMediaPlayer } from '../../ports/media.js';

/** 표본 간격. 다른 재생기와 같은 10Hz — 계약의 「재생 중 ≥10Hz」. */
const CLOCK_SAMPLE_INTERVAL_MS = 100;

/**
 * 가상 재생기의 능력. 탐색은 정확하고(오차 0) 배속은 다른 재생기와 **같은 목록**이다 —
 * 조작 줄 하나가 세 재생기를 똑같이 다룬다.
 */
export const CLOCK_CAPABILITIES = Object.freeze({
  canSeek: true,
  seekToleranceSec: 0,
  rates: Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]),
  isLive: false,
  needsUserGesture: false
});

function defaultTimers() {
  const hasPerf = typeof performance !== 'undefined' && typeof performance.now === 'function';
  return {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    now: hasPerf ? () => performance.now() : () => Date.now()
  };
}

/**
 * @param {{
 *   container?: any,                          시계 얼굴(「영상 없이 박자로」)을 넣을 엘리먼트. 없으면 그리지 않는다
 *   doc?: object|null,                        createElement 를 가진 것
 *   timers?: {setInterval:Function, clearInterval:Function, now:()=>number},
 *   getDurationSec?: () => number|null,       끝(초). 모르면 null — 그때는 멈추지 않는다
 *   startSec?: number                         처음 자리(초). 기본 0
 * }} [options]
 * @returns {import('../../ports/media.js').MediaPlayer}
 */
export function createClockPlayer(options = {}) {
  const timers = options.timers || defaultTimers();
  const doc = options.doc === undefined ? (typeof document === 'undefined' ? null : document) : options.doc;
  const container = options.container == null ? null : options.container;
  const getDurationSec = typeof options.getDurationSec === 'function' ? options.getDurationSec : () => null;

  let baseSec = Number.isFinite(options.startSec) ? options.startSec : 0;
  let baseMs = timers.now();
  let rate = 1;
  let playState = 'unstarted';
  let destroyed = false;
  let pollId = null;
  /** @type {import('../../ports/media.js').TimeSample|null} */
  let sample = null;
  let face = null;

  const timeListeners = new Set();
  const stateListeners = new Set();

  const playing = () => playState === 'playing';
  const duration = () => {
    const d = Number(getDurationSec());
    return Number.isFinite(d) && d > 0 ? d : null;
  };

  /** 지금 영상 시각. 재생 중이면 벽시계를 배속만큼 흘린다. */
  function nowSec() {
    if (!playing()) return baseSec;
    return baseSec + ((timers.now() - baseMs) / 1000) * rate;
  }

  /** 지금 자리를 기준점으로 접는다 — 배속·상태가 바뀌기 직전에 부른다(그 전까지 흐른 것을 잃지 않게). */
  function rebase() {
    baseSec = nowSec();
    baseMs = timers.now();
  }

  function snapshotState() {
    return { load: destroyed ? 'idle' : 'ready', play: playState, error: null };
  }

  function notifyState() {
    const s = snapshotState();
    for (const cb of [...stateListeners]) { try { cb(s); } catch { /* 구독자 예외가 시계를 멈추면 안 된다 */ } }
  }

  function emitSample() {
    sample = { sec: nowSec(), atMs: timers.now(), rate, playing: playing() };
    for (const cb of [...timeListeners]) { try { cb(sample); } catch { /* 위와 같다 */ } }
    renderFace();
    return sample;
  }

  function tick() {
    if (destroyed) return;
    const end = duration();
    if (end !== null && nowSec() >= end) {
      baseSec = end;
      baseMs = timers.now();
      setPlayState('ended');
      return;
    }
    emitSample();
  }

  function setPlayState(next) {
    playState = next;
    if (playing()) {
      if (pollId === null) pollId = timers.setInterval(tick, CLOCK_SAMPLE_INTERVAL_MS);
    } else if (pollId !== null) {
      timers.clearInterval(pollId);
      pollId = null;
    }
    emitSample();          // 계약: 상태 변화 직후 1회
    notifyState();
  }

  /** 시계 얼굴. 영상 칸이 검은 채로 비어 있으면 고장으로 보이므로 「영상 없이」 와 지금 시각을 적는다. */
  function renderFace() {
    if (!container || !doc || typeof doc.createElement !== 'function') return;
    if (!face) {
      face = doc.createElement('div');
      face.className = 'video-clock';
      const title = doc.createElement('div');
      title.className = 'video-clock-title';
      title.textContent = '♪ 영상 없이 박자로 재생';
      const time = doc.createElement('div');
      time.className = 'video-clock-time';
      face.appendChild(title);
      face.appendChild(time);
      if (typeof container.appendChild === 'function') container.appendChild(face);
    }
    const sec = sample ? sample.sec : baseSec;
    const sign = sec < 0 ? '-' : '';
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs - m * 60;
    const time = face.lastChild;
    if (time) time.textContent = `${sign}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}${rate !== 1 ? ` · ${rate}×` : ''}`;
  }

  const player = {
    kind: 'clock',
    capabilities: CLOCK_CAPABILITIES,

    getState: snapshotState,

    getDuration() {
      return duration();
    },

    getTimeSample() {
      return sample;
    },

    /** 실을 것이 없다 — 언제나 준비돼 있다. */
    load() {
      if (!destroyed) { emitSample(); notifyState(); }
      return Promise.resolve();
    },

    /** @returns {Promise<import('../../ports/media.js').PlayResult>} 절대 reject 하지 않는다. */
    play() {
      if (destroyed) return Promise.resolve('error');
      const end = duration();
      if (playState === 'ended' || (end !== null && baseSec >= end)) baseSec = 0;   // 끝에서 다시 누르면 처음부터
      baseMs = timers.now();
      if (!playing()) setPlayState('playing');
      return Promise.resolve('started');
    },

    pause() {
      if (destroyed || !playing()) return;
      rebase();
      setPlayState('paused');
    },

    /** 탐색은 정확하다 — 요청한 자리에 그대로 선다(끝을 넘으면 끝). */
    seek(sec) {
      const want = Number(sec);
      if (destroyed || !Number.isFinite(want)) return Promise.resolve(nowSec());
      const end = duration();
      baseSec = end !== null ? Math.min(want, end) : want;
      baseMs = timers.now();
      if (playState === 'ended') playState = 'paused';
      emitSample();        // 계약: seek 직후 1회 — **동기로** 쏜다(enforceLoop 가 되감은 자리를 곧바로 본다)
      return Promise.resolve(baseSec);
    },

    setRate(next) {
      const r = Number(next);
      if (destroyed || !CLOCK_CAPABILITIES.rates.includes(r) || r === rate) return;
      rebase();
      rate = r;
      emitSample();
    },

    setMuted() {},

    onTime(cb) {
      timeListeners.add(cb);
      try { cb(sample || { sec: nowSec(), atMs: timers.now(), rate, playing: playing() }); } catch { /* 구독 즉시 1회 */ }
      return () => timeListeners.delete(cb);
    },

    onState(cb) {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },

    /** 멱등. 컨테이너를 비운 채 남긴다. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (pollId !== null) { timers.clearInterval(pollId); pollId = null; }
      timeListeners.clear();
      stateListeners.clear();
      if (face && face.parentNode) face.parentNode.removeChild(face);
      face = null;
    }
  };

  renderFace();          // 누르기 전에도 칸이 「영상 없이」 라고 말한다
    return assertMediaPlayer(player, 'ClockPlayer');
}
