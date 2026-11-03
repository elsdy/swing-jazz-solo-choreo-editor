// src/ui/resizeSettle.js — 창 크기가 바뀐 뒤 영상 띠를 다시 재는 두 도움 함수 (ui 계층, RM-66 · 2026-11-03)
//
// 1600x1500 에서 1200x820 으로 창을 한 번 줄이면 띠 밑 조작 줄이 515px 로 남고, resize 를 한 번 더
// 받아야 356px(처음부터 그 크기로 연 값)이 됐다. 재현으로 짚은 원인은 띠가 **제가 지난번에 쓴
// padding-top 에 눌린 단계 칸 높이를 잰 것**이다 — 띠 칸의 높이가 묶여 있어 옛 padding 656px 에 단계 칸이
// 16px 로 눌렸고, 남는 높이를 크게 잡았다(docs/BUG_REPORTS.md 의 RM-66).
//
//   - measureBandChrome — 잴 때마다 제 inline padding-top 을 먼저 비운다. 그러면 몇 번째로 재든
//     처음 연 것과 같은 값이 된다(놓는 일이 제 앞선 결과에 기대지 않는다).
//   - settleOnResize — 띠 놓기를 resize 의 **다른 듣개가 다 돈 뒤** 한 틀에 한 번으로 미룬다(판의 결정).
//     main.js 의 듣개 등록 차례라는 숨은 약속에 기대지 않게 하고, 몰린 resize 를 한 번으로 줄인다.
//     ⚠ resize 듣개 안에서 건 requestAnimationFrame 은 **같은 틀**의 그리기 전에 돈다(resize 는 틀 갱신의
//       앞 단계다) — 옛 자리가 한 틀 보이지 않는다.
//
// ⚠ 브라우저 전역은 인자로만 받는다 — 모듈 머리에서 window 를 읽지 않으므로 node 시험에서도 불러온다.

/**
 * 띠 칸(`.video-panel`) 안에서 영상 **밑**에 오는 것(머리줄·단계 칸)의 높이 합. 재기 전에 칸의
 * inline padding-top 을 비운다 — 그 값은 이 뒤에 placeBand 가 새로 쓴다.
 * @param {{style: {paddingTop: string}}} strip 띠 칸
 * @param {Array<{getBoundingClientRect: () => {height:number}}|null|undefined>} parts 잴 칸들(없으면 0)
 * @returns {number}
 */
// @complexity time=O(k) space=O(1) cc=3
export function measureBandChrome(strip, parts) {
  strip.style.paddingTop = '';
  let h = 0;
  for (const el of parts) if (el) h += el.getBoundingClientRect().height;
  return h;
}

/**
 * 창의 resize 마다 `now` 를 곧바로 부르고, `later` 는 다음 틀(requestAnimationFrame)로 미룬다.
 * 이미 틀이 걸려 있으면 다시 걸지 않는다 — 한 틀에 몰린 resize 는 `later` 를 한 번만 부른다.
 * @param {{addEventListener: Function, removeEventListener: Function, requestAnimationFrame: (fn: Function) => any}} win
 * @param {{now?: () => void, later: () => void}} hooks
 * @returns {() => void} 듣기를 거두는 함수(걸린 틀도 놓지 않게 된다)
 */
// @complexity time=O(1) space=O(1) cc=4
export function settleOnResize(win, { now, later }) {
  let queued = false;
  let live = true;
  const run = () => { queued = false; if (live) later(); };
  const onResize = () => {
    if (now) now();
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(run);
  };
  win.addEventListener('resize', onResize);
  return () => { live = false; win.removeEventListener('resize', onResize); };
}
