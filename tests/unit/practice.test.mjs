// tests/unit/practice.test.mjs — 마디 반복 연습기(RM-22 · 2026-10-01)
//
//   ① domain/practice — 마디·블록 → 카운트 구간 → 초 구간, 배속 목록, 카운트 소리 계획
//   ② usecases/videoCommands — 반복의 주인(마디 반복 ↔ In/Out), 화면 상태만 바뀌는가
//   ③ adapters/media/clockPlayer — 영상 없는 박자 시계가 MediaPlayer 계약을 채우는가
//   ④ adapters/audio/countClicks — 예약 · 지난 시각 버리기 · 취소

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRACTICE_RATES, ratesFor, normalizeRate, normalizeCountRange, rowsToCountRange, placementsToCountRange,
  countRangeToSpan, countRangeLabel, countClicks, planClicks, EMPTY_CLICK_PLAN
} from '../../src/domain/practice.js';
import { DEFAULT_TEMPO, normalizeTempo, countToTime } from '../../src/domain/tempo.js';
import { createStore, NONE } from '../../src/usecases/store.js';
import * as VideoCmd from '../../src/usecases/videoCommands.js';
import { createClockPlayer } from '../../src/adapters/media/clockPlayer.js';
import { createCountClicks } from '../../src/adapters/audio/countClicks.js';
import { assertMediaPlayer } from '../../src/ports/media.js';

/** 120bpm · 1카운트 = 1박 → 0.5초. 8x1 의 1 = 0초. */
const T120 = normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 0 });

// ── ① domain ────────────────────────────────────────────────────────────────

test('practice: 배속은 두 재생기가 같이 가진 값만 — 유튜브는 0.7배를 모른다', () => {
  const yt = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  assert.deepEqual(ratesFor(yt), [...PRACTICE_RATES]);
  assert.deepEqual(ratesFor(null), [], '배속을 못 하는 재생기(널)는 고를 것이 없다');
  assert.deepEqual(ratesFor([1, 2]), [1, 2]);
  assert.equal(normalizeRate(0.7), 1);
  assert.equal(normalizeRate('0.75'), 0.75);
});

test('practice: 마디 여럿 → [첫 마디의 1, 마지막 마디 다음의 1) — 뒤집혀도 바로 세운다', () => {
  assert.deepEqual(rowsToCountRange(3, 3, 8), { fromCount: 16, toCount: 24 });
  assert.deepEqual(rowsToCountRange(4, 3, 8), { fromCount: 16, toCount: 32 });
  assert.deepEqual(rowsToCountRange(0, 0, 8), { fromCount: -8, toCount: 0 }, 'intro 는 음수 카운트다');
  assert.equal(rowsToCountRange(NaN, 1, 8), null);
});

test('practice: 고른 블록들 → 가장 앞 시작 ~ 가장 뒤 끝(사이 빈틈 포함), 안 고른 블록은 무시', () => {
  const placements = [
    { groupId: 'a', row: 2, startIndex: 2, length: 2 },     // 10..12
    { groupId: 'b', row: 3, startIndex: 4, length: 4 },     // 20..24
    { groupId: 'c', row: 1, startIndex: 0, length: 8 }
  ];
  assert.deepEqual(placementsToCountRange(placements, ['a', 'b'], 8), { fromCount: 10, toCount: 24 });
  assert.equal(placementsToCountRange(placements, [], 8), null);
  assert.equal(placementsToCountRange(placements, ['없음'], 8), null);
});

test('practice: 카운트 구간 → 초 구간은 지금 박자로 — 박자가 없으면 null(거짓 구간을 주지 않는다)', () => {
  assert.deepEqual(countRangeToSpan({ fromCount: 16, toCount: 24 }, T120), { startSec: 8, endSec: 12 });
  assert.equal(countRangeToSpan({ fromCount: 16, toCount: 24 }, DEFAULT_TEMPO), null);
  assert.equal(countRangeToSpan({ fromCount: 5, toCount: 5 }, T120), null);
  // 보정점을 고치면 같은 카운트 구간이 다른 초가 된다 — 그래서 초를 들고 있지 않는다.
  const bent = normalizeTempo({ ...T120, points: [{ count: 16, sec: 9 }] });
  assert.equal(countRangeToSpan({ fromCount: 16, toCount: 24 }, bent).startSec, 9);
});

test('practice: 구간의 이름은 안무표의 말 — 마디로 떨어지면 `8x3 ~ 8x4`', () => {
  assert.equal(countRangeLabel({ fromCount: 16, toCount: 24 }, 8), '8x3');
  assert.equal(countRangeLabel({ fromCount: 16, toCount: 32 }, 8), '8x3 ~ 8x4');
  assert.equal(countRangeLabel({ fromCount: 18, toCount: 22 }, 8), '8x3의 3~6카운트');
  assert.equal(countRangeLabel({ fromCount: 20, toCount: 26 }, 8), '8x3의 5카운트 ~ 8x4의 2카운트');
  assert.equal(countRangeLabel({ fromCount: -8, toCount: 0 }, 8), 'intro');
  assert.equal(normalizeCountRange({ fromCount: 1.5, toCount: 3 }), null);
});

test('practice: 카운트 소리는 카운트마다 한 번 — 마디의 1 과 5 가 다르게 울린다', () => {
  const clicks = countClicks(0, 4, T120, 8);                 // 0..4초 = 카운트 0..7
  assert.deepEqual(clicks.map(c => c.beat), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(clicks.map(c => c.accent), ['one', 'plain', 'plain', 'plain', 'half', 'plain', 'plain', 'plain']);
  // 하프타임(1카운트 = 2박)은 소리도 카운트를 따른다 — 박마다가 아니다.
  const half = normalizeTempo({ ...T120, beatsPerCount: 2 });
  assert.equal(countClicks(0, 4, half, 8).length, 4);
  assert.deepEqual(countClicks(0, 4, DEFAULT_TEMPO, 8), [], '박자가 없으면 소리도 없다');
});

test('practice: 소리 계획 — 이어지는 표본은 같은 카운트를 두 번 예약하지 않는다', () => {
  let state = EMPTY_CLICK_PLAN;
  const seen = [];
  for (let i = 0; i < 30; i++) {                             // 0.1초마다 3초
    const r = planClicks(state, { sample: { sec: i * 0.1, atMs: 1000 + i * 100, rate: 1, playing: true }, tempo: T120, cols: 8 });
    assert.equal(r.reset, false);
    state = r.state;
    seen.push(...r.events.map(e => e.count));
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6]);
  // 벽시계 시각은 표본 + (영상 시각 차 / 배속)이다.
  const r = planClicks(EMPTY_CLICK_PLAN, { sample: { sec: 0.4, atMs: 5000, rate: 0.5, playing: true }, tempo: T120, cols: 8 });
  assert.deepEqual(r.events.map(e => [e.count, e.atMs]), [[1, 5200]], '0.5배면 0.1초 뒤 카운트가 0.2초 뒤에 울린다');
});

test('practice: 소리 계획 — 반복 구간의 끝에서 자른다. 되감기가 늦어도 끝 박이 한 번 더 울리지 않는다', () => {
  const loop = { startSec: 8, endSec: 12 };                  // 8x3
  let state = EMPTY_CLICK_PLAN;
  const counts = [];
  let resets = 0;
  // 8초부터 12.08초까지 재생 — 마지막 표본은 끝을 넘었다(enforceLoop 가 그 뒤 되감는다)
  for (let sec = 8; sec <= 12.08; sec += 0.1) {
    const r = planClicks(state, { sample: { sec, atMs: sec * 1000, rate: 1, playing: true }, tempo: T120, cols: 8, loop });
    state = r.state; counts.push(...r.events.map(e => e.count));
  }
  assert.deepEqual(counts, [16, 17, 18, 19, 20, 21, 22, 23], '24(다음 마디의 1)는 예약되지 않는다');
  // 되감은 자리의 표본 — 처음 카운트가 곧바로 다시 예약되고, 예약을 버리라는 신호가 간다.
  const back = planClicks(state, { sample: { sec: 8, atMs: 20000, rate: 1, playing: true }, tempo: T120, cols: 8, loop });
  if (back.reset) resets++;
  assert.equal(resets, 1);
  assert.deepEqual(back.events.map(e => e.count), [16]);
});

test('practice: 소리 계획 — 멈춤 · 배속 바꿈이면 예약을 버린다', () => {
  const s0 = planClicks(EMPTY_CLICK_PLAN, { sample: { sec: 0, atMs: 0, rate: 1, playing: true }, tempo: T120, cols: 8 });
  const paused = planClicks(s0.state, { sample: { sec: 0.1, atMs: 100, rate: 1, playing: false }, tempo: T120, cols: 8 });
  assert.equal(paused.reset, true);
  assert.deepEqual(paused.events, []);
  const slower = planClicks(s0.state, { sample: { sec: 0.1, atMs: 100, rate: 0.5, playing: true }, tempo: T120, cols: 8 });
  assert.equal(slower.reset, true);
});

// ── ② usecases ──────────────────────────────────────────────────────────────

function storeWithTempo() {
  const store = createStore();
  VideoCmd.setTempo(store, { tempo: T120 });
  return store;
}

test('videoCommands: 마디 반복을 잡으면 반복이 켜지고, 반복 구간은 카운트를 지금 박자로 바꾼 것이다', () => {
  const store = storeWithTempo();
  assert.deepEqual(VideoCmd.setPracticeRange(store, { fromCount: 16, toCount: 24 }), { video: true });
  const p = VideoCmd.panelState(store);
  assert.equal(p.loop, true);
  assert.deepEqual(p.practice, { fromCount: 16, toCount: 24 });
  assert.deepEqual(VideoCmd.loopSpan(store), { startSec: 8, endSec: 12 });
  // 박자를 바꾸면 반복 구간도 따라온다(초를 들고 있지 않다).
  VideoCmd.setTempo(store, { tempo: { ...T120, bpm: 60 } });
  assert.deepEqual(VideoCmd.loopSpan(store), { startSec: 16, endSec: 24 });
  assert.equal(VideoCmd.setPracticeRange(store, { fromCount: 3, toCount: 3 }), NONE, '빈 구간은 받지 않는다');
});

test('videoCommands: 반복의 주인은 하나 — In/Out 을 찍으면 마디 반복이 풀리고, 마디 반복은 In/Out 을 건드리지 않는다', () => {
  const store = storeWithTempo();
  VideoCmd.setInOut(store, { inSec: 1, outSec: 3 });
  VideoCmd.setPracticeRange(store, { fromCount: 16, toCount: 24 });
  assert.deepEqual(VideoCmd.loopSpan(store), { startSec: 8, endSec: 12 }, '마디 반복이 이긴다');
  assert.equal(VideoCmd.panelState(store).inSec, 1, 'In/Out 은 그대로 남는다');
  VideoCmd.clearPracticeRange(store);
  assert.deepEqual(VideoCmd.loopSpan(store), { startSec: 1, endSec: 3 }, '풀면 In/Out 으로 돌아간다');

  VideoCmd.setPracticeRange(store, { fromCount: 16, toCount: 24 });
  VideoCmd.setInPoint(store, { sec: 2 });
  assert.equal(VideoCmd.panelState(store).practice, null, '초로 손수 찍으면 마디 반복이 풀린다');

  // ④ 의 `구간 반복` 은 In~Out 을 반복한다 — 마디 반복이 잡혀 있으면 풀고 켠다.
  VideoCmd.setInOut(store, { inSec: 1, outSec: 3 });
  VideoCmd.setPracticeRange(store, { fromCount: 16, toCount: 24 });
  VideoCmd.toggleInOutLoop(store);
  assert.equal(VideoCmd.panelState(store).practice, null);
  assert.equal(VideoCmd.panelState(store).loop, true);
  VideoCmd.toggleInOutLoop(store);
  assert.equal(VideoCmd.panelState(store).loop, false);
});

test('videoCommands: 박자가 없으면 마디 반복은 아무것도 반복하지 않는다', () => {
  const store = createStore();
  VideoCmd.setPracticeRange(store, { fromCount: 16, toCount: 24 });
  assert.equal(VideoCmd.loopSpan(store), null);
});

test('videoCommands: 배속 · 미러 · 소리는 화면 상태 — 안무(media)와 undo 에 들어가지 않는다', () => {
  const store = storeWithTempo();
  const media = JSON.stringify(store.get().media);
  assert.deepEqual(VideoCmd.setRate(store, { rate: 0.75 }), { video: true });
  assert.equal(VideoCmd.panelState(store).rate, 0.75);
  VideoCmd.setRate(store, { rate: 0.7 });
  assert.equal(VideoCmd.panelState(store).rate, 1, '목록 밖의 값은 1배로 접는다');
  VideoCmd.setMirror(store);
  VideoCmd.setClicks(store);
  assert.equal(VideoCmd.panelState(store).mirror, true);
  assert.equal(VideoCmd.panelState(store).clicks, true);
  assert.equal(JSON.stringify(store.get().media), media);
  for (const d of [VideoCmd.setMirror(store), VideoCmd.setClicks(store)]) assert.equal(d.committed, undefined);
});

// ── ③ 박자 시계 ─────────────────────────────────────────────────────────────

function fakeTimers() {
  let t = 1000;
  let nextId = 1;
  const intervals = new Map();
  return {
    now: () => t,
    setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms }); return id; },
    clearInterval: (id) => intervals.delete(id),
    advance(ms) {
      const step = 100;
      for (let done = 0; done < ms; done += step) {
        t += Math.min(step, ms - done);
        for (const { fn } of [...intervals.values()]) fn();
      }
    },
    active: () => intervals.size
  };
}

test('clockPlayer: MediaPlayer 계약을 채우고 kind 는 clock 이다', () => {
  const player = createClockPlayer({ timers: fakeTimers(), doc: null });
  assertMediaPlayer(player);
  assert.equal(player.kind, 'clock');
  assert.equal(player.getState().load, 'ready');
  assert.deepEqual(player.capabilities.rates, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
});

test('clockPlayer: 벽시계 × 배속으로 흐르고, 탐색은 정확하며, 멈추면 선다', async () => {
  const timers = fakeTimers();
  const player = createClockPlayer({ timers, doc: null });
  const samples = [];
  player.onTime(s => samples.push(s));
  assert.equal(await player.play(), 'started');
  timers.advance(1000);
  assert.ok(Math.abs(player.getTimeSample().sec - 1) < 1e-9);
  player.setRate(0.5);
  timers.advance(1000);
  assert.ok(Math.abs(player.getTimeSample().sec - 1.5) < 1e-9, '0.5배는 1초에 0.5초 간다');
  player.setRate(0.7);
  assert.equal(player.getTimeSample().rate, 0.5, '목록 밖의 배속은 무시한다');
  assert.equal(await player.seek(8), 8);
  assert.equal(samples[samples.length - 1].sec, 8, 'seek 은 표본을 동기로 쏜다(구간 반복이 곧바로 본다)');
  player.pause();
  timers.advance(1000);
  assert.equal(player.getTimeSample().sec, 8);
  assert.equal(timers.active(), 0, '멈추면 시계를 돌리지 않는다');
  player.destroy();
  player.destroy();
});

test('clockPlayer: 안무표 끝에 닿으면 멈추고, 다시 누르면 처음부터', async () => {
  const timers = fakeTimers();
  const player = createClockPlayer({ timers, doc: null, getDurationSec: () => 2 });
  player.play();
  timers.advance(2500);
  assert.equal(player.getState().play, 'ended');
  assert.equal(player.getTimeSample().sec, 2);
  player.play();
  assert.equal(player.getTimeSample().sec, 0);
});

// ── ④ 카운트 소리 ───────────────────────────────────────────────────────────

function fakeAudio() {
  const made = [];
  class Ctx {
    constructor() { this.state = 'suspended'; this.currentTime = 10; this.destination = {}; }
    resume() { this.state = 'running'; }
    createOscillator() {
      const osc = { frequency: {}, connect() {}, start(at) { this.at = at; }, stop(at) { this.stoppedAt = at; } };
      made.push(osc);
      return osc;
    }
    createGain() { const ramp = () => {}; return { gain: { setValueAtTime: ramp, exponentialRampToValueAtTime: ramp }, connect() {}, disconnect() {} }; }
  }
  return { win: { AudioContext: Ctx }, made };
}

test('countClicks: 누르기 전에는 소리를 내지 않고, 깨우면 벽시계 시각을 소리 시계로 옮겨 예약한다', () => {
  const { win, made } = fakeAudio();
  const clicks = createCountClicks({ win, now: () => 5000 });
  assert.equal(clicks.available(), true);
  assert.equal(clicks.schedule([{ atMs: 5100, accent: 'one' }]), 0, 'unlock 전에는 예약하지 않는다');
  assert.equal(clicks.unlock(), true);
  assert.equal(clicks.schedule([{ atMs: 5100, accent: 'one' }, { atMs: 4900, accent: 'plain' }]), 1, '이미 지난 박은 버린다');
  assert.ok(Math.abs(made[0].at - 10.1) < 1e-9);
  assert.equal(made[0].frequency.value, 1760);
  clicks.cancel();
  assert.equal(made[0].stoppedAt, 0, '취소하면 아직 안 난 소리를 끈다');
  assert.equal(createCountClicks({ win: {} }).available(), false);
});
