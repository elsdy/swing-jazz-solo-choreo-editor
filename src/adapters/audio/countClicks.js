// src/adapters/audio/countClicks.js — 카운트 소리 (adapters 계층, RM-22 · 2026-10-01)
//
// Web Audio 로 짧은 「틱」을 정해진 벽시계 시각에 낸다. 언제 칠지는 domain/practice.planClicks 가 정하고
// (표본 + 박자만으로 계산한다), 이 어댑터는 그 시각(performance.now 기준 ms)을 소리 장치의 시계로 옮겨
// 예약하고, 「버려라」 하면 아직 안 난 예약을 모두 끈다.
//
// ⚠ 브라우저는 사용자가 누르기 전에는 소리를 막는다. unlock() 은 **누름의 콜스택 안에서** 불러야 한다 —
//   거기서 AudioContext 를 만들거나 깨운다. 그 밖에서 만들면 'suspended' 로 남아 소리가 영영 나지 않는다.
// ⚠ setTimeout 으로 소리를 내지 않는다. 타이머는 수십 ms 씩 밀려 박이 흔들린다 — 소리 장치의 시계로
//   미리 예약하는 것이 Web Audio 의 정석이다(그래서 planClicks 가 0.35초 앞을 내다본다).

/** 마디의 1 · 5 · 나머지 카운트의 높이(Hz). 1이 가장 높아 마디의 시작이 귀로 들린다. */
const PITCH = Object.freeze({ one: 1760, half: 1320, plain: 990 });
/** 한 번의 틱 길이(초). */
const CLICK_SEC = 0.05;
/** 음량. 영상 소리 위에 얹히므로 크지 않게. */
const GAIN = Object.freeze({ one: 0.35, half: 0.25, plain: 0.18 });

/**
 * @param {{win?: any, now?: () => number}} [options] 테스트가 가짜 AudioContext 와 시계를 넣는다
 * @returns {{
 *   available: () => boolean,
 *   unlock: () => boolean,
 *   schedule: (events: {atMs:number, accent:'one'|'half'|'plain'}[]) => number,
 *   cancel: () => void,
 *   close: () => void
 * }}
 */
export function createCountClicks(options = {}) {
  const win = options.win === undefined ? (typeof window === 'undefined' ? null : window) : options.win;
  const now = typeof options.now === 'function'
    ? options.now
    : (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  const Ctor = win ? (win.AudioContext || win.webkitAudioContext) : null;

  let ctx = null;
  /** 예약했지만 아직 끝나지 않은 소리. cancel 이 끈다. */
  const live = new Set();

  return {
    available: () => typeof Ctor === 'function',

    /** 누름 안에서 부른다. 소리를 낼 수 있게 되었으면 참. */
    unlock() {
      if (typeof Ctor !== 'function') return false;
      try {
        if (!ctx) ctx = new Ctor();
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
        return true;
      } catch { return false; }
    },

    /**
     * 틱들을 예약한다. 이미 지난 시각(20ms 넘게 늦은 것)은 버린다 — 늦게 치는 박은 틀린 박이다.
     * @returns {number} 실제로 예약한 수
     */
    schedule(events) {
      if (!ctx || !Array.isArray(events) || !events.length) return 0;
      const nowMs = now();
      const base = ctx.currentTime;
      let made = 0;
      for (const e of events) {
        const when = base + (e.atMs - nowMs) / 1000;
        if (!(when >= base - 0.02)) continue;
        const at = Math.max(base, when);
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = PITCH[e.accent] || PITCH.plain;
          const peak = GAIN[e.accent] || GAIN.plain;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(peak, at + 0.004);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_SEC);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(at);
          osc.stop(at + CLICK_SEC + 0.01);
          const entry = { osc, gain };
          live.add(entry);
          osc.onended = () => { live.delete(entry); try { gain.disconnect(); } catch { /* 이미 끊김 */ } };
          made++;
        } catch { /* 소리 하나가 실패해도 나머지는 낸다 */ }
      }
      return made;
    },

    /** 아직 안 난 예약을 모두 끈다(되감기·탐색·배속 바꿈·멈춤·소리 끔). */
    cancel() {
      for (const { osc, gain } of [...live]) {
        try { osc.onended = null; osc.stop(0); } catch { /* 이미 멈춤 */ }
        try { gain.disconnect(); } catch { /* 이미 끊김 */ }
      }
      live.clear();
    },

    close() {
      this.cancel();
      if (ctx && typeof ctx.close === 'function') { try { ctx.close(); } catch { /* 무시 */ } }
      ctx = null;
    }
  };
}
