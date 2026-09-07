// src/ports/env.js — 바깥세상(난수·시계·대화상자)의 계약. import 0개.
//
// 원본 index.html 의 uid(1696-1698, Math.random+Date.now)와 prompt 3곳(3186·3266·4678)·
// alert 11곳의 반대편이다. domain/usecases 는 Date·Math.random 을 쓸 수 없으므로
// 이 포트를 통하지 않고는 id 도 시각도 만들 수 없고, 그 덕에 골든이 결정적이 된다.

/**
 * @typedef {Object} Env
 * @property {() => string} uid 새 식별자. 원본은 `Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4)`
 * @property {() => number} now 에폭 밀리초. 원본의 `Date.now()`
 */

/**
 * @typedef {Object} Dialogs
 * @property {(message: string, defaultValue?: string) => string|null} promptText
 *   취소하면 null. 원본 `prompt('동작 이름 변경', move.name)`(3186) 등 3곳의 계약면
 * @property {(message: string) => void} alert  원본 alert 11곳(3012·3189·3269·3993·4069·4179·4342·4402·4421·4447·4475)
 * @property {(message: string) => boolean} confirm
 *   ⚠ 오늘 index.html 에는 window.confirm 호출이 하나도 없다. 확인 UX 는 전부 confirmOnce(1700,
 *   버튼 라벨을 '정말요?'로 2초 바꾸는 UI 위젯)가 맡는다. 이 멤버는 앞으로를 위한 자리이며
 *   지금 어댑터를 붙일 때 confirmOnce 를 이걸로 바꾸면 동작이 바뀐다.
 */

/**
 * 결정적 Env. 테스트와 골든 리플레이가 쓴다 — 같은 조작이면 언제나 같은 id 와 같은 시각이 나온다.
 * @param {{prefix?: string, start?: number, now?: number, step?: number}} [options]
 *   prefix 접두어(기본 'id') / start 첫 일련번호(기본 1) / now 첫 시각(기본 0) / step 호출마다 늘릴 밀리초(기본 0)
 * @returns {Env}
 */
export function counterEnv(options = {}) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : 'id';
  let seq = Number.isFinite(options.start) ? options.start : 1;
  let clock = Number.isFinite(options.now) ? options.now : 0;
  const step = Number.isFinite(options.step) ? options.step : 0;
  return {
    uid() { return `${prefix}${seq++}`; },
    now() { const t = clock; clock += step; return t; }
  };
}

/** 값이 함수면 불러서, 아니면 그대로 쓴다. 시나리오형 답변을 허용하되 기본은 상수다. */
function answer(source, fallback, args) {
  if (typeof source === 'function') return source(...args);
  return source === undefined ? fallback : source;
}

/**
 * 아무것도 띄우지 않는 Dialogs. 기본 답은 "취소"(prompt→null, confirm→false)라
 * 테스트에서 실수로 대화상자를 타면 아무 일도 일어나지 않는다.
 * 주고받은 문구는 `calls` 에 순서대로 쌓이므로 단정에 쓸 수 있다.
 * @param {{promptValue?: any, confirmValue?: any}} [options] 값 또는 (message, defaultValue)=>값
 * @returns {Dialogs & { calls: {kind:'prompt'|'alert'|'confirm', message:string, defaultValue?:string}[] }}
 */
export function silentDialogs(options = {}) {
  const calls = [];
  return {
    calls,
    promptText(message, defaultValue = '') {
      calls.push({ kind: 'prompt', message, defaultValue });
      return answer(options.promptValue, null, [message, defaultValue]);
    },
    alert(message) {
      calls.push({ kind: 'alert', message });
    },
    confirm(message) {
      calls.push({ kind: 'confirm', message });
      return Boolean(answer(options.confirmValue, false, [message]));
    }
  };
}
