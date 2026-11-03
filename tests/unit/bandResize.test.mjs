// tests/unit/bandResize.test.mjs — 창을 줄이면 영상 띠가 한 번 늦게 줄어들던 것 (RM-66, 2026-11-03)
//
// 1600x1500 에서 1200x820 으로 한 번 줄이면 띠 밑 조작 줄이 515px 로 남고, resize 를 한 번 더 받아야
// 356px(처음부터 그 크기로 연 값)이 됐다. 재현으로 짚은 원인은 듣개 차례가 아니라 **placeBand 가 제가
// 지난번에 쓴 padding-top 에 눌린 단계 칸 높이를 잰 것**이다(옛 padding 656px 에 단계 칸이 16px 로 눌려
// 남는 높이를 크게 잡았다). 그래서 시험은 둘로 간다.
//   - 원인: 띠 칸의 머리줄·단계 칸은 제 inline padding-top 을 비운 뒤에 잰다(measureBandChrome).
//   - 판의 결정(요구 1~3): 띠 놓기는 resize 의 다른 듣개가 다 돈 뒤 한 틀에 한 번(settleOnResize).

import test from 'node:test';
import assert from 'node:assert/strict';

import { measureBandChrome, settleOnResize } from '../../src/ui/resizeSettle.js';

/** addEventListener · requestAnimationFrame 만 있는 가짜 창. 틀은 flush() 로 흘린다. */
function fakeWin() {
  const listeners = [];
  let frames = [];
  return {
    addEventListener(type, fn) { if (type === 'resize') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    resize() { for (const fn of [...listeners]) fn({ type: 'resize' }); },
    flush() { const run = frames; frames = []; for (const fn of run) fn(0); },
    get pending() { return frames.length; },
  };
}

test('[RM-66 원인] 띠 칸은 제 옛 padding-top 을 비운 뒤 머리줄·단계 칸을 잰다', () => {
  // 띠 칸의 높이가 묶여 있어서, 옛 padding 이 크면 단계 칸이 눌린다(실측: 656px 에 16px, 비우면 213px).
  const strip = { style: { paddingTop: '656px' } };
  const head = { getBoundingClientRect: () => ({ height: 45 }) };
  const body = { getBoundingClientRect: () => ({ height: strip.style.paddingTop ? 16 : 213 }) };
  assert.equal(measureBandChrome(strip, [head, body]), 45 + 213);
  assert.equal(strip.style.paddingTop, '', '비운 채로 둔다 — 새 값은 placeBand 가 이어서 쓴다');
});

test('[RM-66 원인] 없는 칸(null)은 0 으로 센다', () => {
  const strip = { style: { paddingTop: '' } };
  assert.equal(measureBandChrome(strip, [null, undefined]), 0);
});

test('[RM-66 요구 1] resize 뒤 띠 놓기는 같은 resize 의 다른 듣개보다 뒤에 돈다', () => {
  for (const settleFirst of [true, false]) {
    const win = fakeWin();
    const calls = [];
    const cellSize = () => calls.push('cellSize');
    if (!settleFirst) win.addEventListener('resize', cellSize);
    settleOnResize(win, { later: () => calls.push('place') });
    if (settleFirst) win.addEventListener('resize', cellSize);
    win.resize();
    win.flush();
    assert.deepEqual(calls, ['cellSize', 'place'], `띠 듣개를 ${settleFirst ? '먼저' : '나중에'} 달아도`);
  }
});

test('[RM-66 요구 2] 한 틀 안의 resize 여러 번은 띠를 한 번만 놓는다', () => {
  const win = fakeWin();
  let placed = 0;
  settleOnResize(win, { later: () => { placed += 1; } });
  win.resize(); win.resize(); win.resize();
  assert.equal(win.pending, 1, '틀은 하나만 건다');
  win.flush();
  assert.equal(placed, 1);
  // 틀이 흐른 뒤의 resize 는 다시 건다.
  win.resize();
  win.flush();
  assert.equal(placed, 2);
});

test('[RM-66 요구 3] resize 는 기준점 캐시를 곧바로 버리고 놓기는 미룬다', () => {
  const win = fakeWin();
  const calls = [];
  settleOnResize(win, { now: () => calls.push('now'), later: () => calls.push('later') });
  win.resize();
  assert.deepEqual(calls, ['now'], '놓기는 아직');
  win.resize();
  assert.deepEqual(calls, ['now', 'now'], '버리기는 resize 마다');
  win.flush();
  assert.deepEqual(calls, ['now', 'now', 'later']);
});

test('[RM-66] 되돌리기를 부르면 resize 를 더 듣지 않고 걸린 틀도 놓지 않는다', () => {
  const win = fakeWin();
  let placed = 0;
  const stop = settleOnResize(win, { later: () => { placed += 1; } });
  win.resize();
  stop();
  win.flush();
  win.resize();
  win.flush();
  assert.equal(placed, 0);
});

test('[RM-66 × RM-63] 조작 줄 다시 그리기는 띠를 놓은 뒤(onSettled)에 걸리고, main.js 가 resize 를 따로 듣지 않는다', async () => {
  // 띠 놓기를 다음 틀로 미루자, main.js 가 따로 들은 resize 의 thumb.render 가 놓기 **앞에** 돌아 옛 폭으로
  // 접힘을 골랐다 — 한 번 줄이면 `⏮ 처음으로` 가 접히지 않고 잘렸다(브라우저: 칸 68px 에 글자 77px).
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../../src/app/main.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../../src/ui/videoPanel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /addEventListener\(\s*'resize'[^)]*\)\s*=>\s*\{\s*views\.thumb\?\.render\(\)/,
    'main.js 의 resize 듣개가 조작 줄을 그리면 띠보다 먼저 돈다');
  assert.match(main, /onSettled:\s*\(\)\s*=>\s*\{\s*views\.thumb\?\.render\(\);?\s*\}/, '띠를 놓은 뒤에 다시 그린다');
  assert.match(panel, /later:\s*\(\)\s*=>\s*\{\s*syncDetached\(\);\s*onSettled\(\);\s*\}/, '놓기 다음에 onSettled');
});
