// src/domain/practice.js — 마디 반복 연습기의 규칙 (순수 함수, RM-22 · 2026-10-01)
//
// 반복 구간을 **초가 아니라 카운트**로 잡는다. 안무표의 마디·블록을 [fromCount, toCount) 로 접고,
// 초는 그때그때 박자(domain/tempo)로 다시 계산한다 — 보정점을 고치면 반복 구간도 따라온다.
// 카운트 소리의 예약 계획(planClicks)도 여기 있다: 「다음 몇 카운트를 언제 칠까」는 시계를 읽지 않고
// 표본(TimeSample)만으로 정해지는 계산이라 도메인의 일이다. 실제로 소리를 내는 것은 adapters/audio 다.
// DOM·타이머·시계를 한 글자도 쓰지 않는다.

import { cellOf, linearOf } from './grid.js';
import { countToTime, isTempoUsable, timeToCount } from './tempo.js';

// ─────────────────────────────────────────────────────────────────────────────
// 배속
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 조작 줄이 보이는 배속. **유튜브와 파일 재생기가 둘 다 가진 값만** 둔다 — 유튜브는 0.25~2 사이의
 * 정해진 값만 받으므로 「0.7배」 같은 값을 주면 조용히 무시된다(capabilities.rates).
 */
export const PRACTICE_RATES = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);

/**
 * 이 재생기에서 고를 수 있는 배속. 재생기가 배속을 못 하면(rates 가 null) 빈 배열이다.
 * @param {readonly number[]|null|undefined} capabilityRates 재생기의 capabilities.rates
 * @returns {number[]}
 */
export function ratesFor(capabilityRates) {
  if (!Array.isArray(capabilityRates)) return [];
  return PRACTICE_RATES.filter(r => capabilityRates.includes(r));
}

/**
 * 배속 값 하나를 고를 수 있는 값으로 접는다. 목록 밖이면 1배.
 * @param {unknown} rate
 * @returns {number}
 */
export function normalizeRate(rate) {
  const n = Number(rate);
  return PRACTICE_RATES.includes(n) ? n : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 반복 구간 — 카운트로 잡는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CountRange
 * @property {number} fromCount 선형 카운트(포함)
 * @property {number} toCount   선형 카운트(배타) — toCount > fromCount
 */

/**
 * 손상된 입력을 CountRange 로. 정수가 아니거나 비었으면 null.
 * @param {unknown} raw
 * @returns {CountRange|null}
 */
export function normalizeCountRange(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fromCount = Number(raw.fromCount);
  const toCount = Number(raw.toCount);
  if (!Number.isInteger(fromCount) || !Number.isInteger(toCount)) return null;
  if (!(toCount > fromCount)) return null;
  return { fromCount, toCount };
}

/**
 * 마디(행) 여럿 → 카운트 구간. 앞뒤가 뒤집혀 있으면 바로 세운다(고르는 순서는 사람 마음이다).
 * intro 행(0)도 그대로 음수 카운트로 떨어진다(domain/grid.linearOf).
 * @param {number} fromRow
 * @param {number} toRow 포함
 * @param {number} cols
 * @returns {CountRange|null}
 */
export function rowsToCountRange(fromRow, toRow, cols) {
  const a = Number(fromRow);
  const b = Number(toRow);
  const c = Number(cols);
  if (!Number.isInteger(a) || !Number.isInteger(b) || !(Number.isInteger(c) && c > 0)) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { fromCount: linearOf(lo, 0, c), toCount: linearOf(hi + 1, 0, c) };
}

/**
 * 고른 블록들 → 그것들을 덮는 카운트 구간(가장 앞 시작 ~ 가장 뒤 끝). 사이의 빈틈은 그냥 포함한다 —
 * domain/tempo.groupToSpan 과 같은 규칙이다. 고른 것이 하나도 놓여 있지 않으면 null.
 * @param {{groupId:string, row:number, startIndex:number, length:number}[]} placements 보드의 배치 전부
 * @param {Iterable<string>} groupIds 고른 그룹
 * @param {number} cols
 * @returns {CountRange|null}
 */
export function placementsToCountRange(placements, groupIds, cols) {
  const want = new Set(groupIds || []);
  if (!want.size || !Array.isArray(placements)) return null;
  let from = null;
  let to = null;
  for (const p of placements) {
    if (!want.has(p.groupId)) continue;
    const start = linearOf(p.row, p.startIndex, cols);
    const end = start + p.length;
    if (from === null || start < from) from = start;
    if (to === null || end > to) to = end;
  }
  return from === null ? null : normalizeCountRange({ fromCount: from, toCount: to });
}

/**
 * 카운트 구간 → 초 구간. 박자가 없으면(bpm 0) **null** — 거짓 구간을 주느니 반복을 끈다
 * (재생 헤드를 숨기는 규칙과 같다).
 * @param {CountRange|null} range
 * @param {import('./tempo.js').Tempo} tempo
 * @returns {{startSec:number, endSec:number}|null}
 */
export function countRangeToSpan(range, tempo) {
  const r = normalizeCountRange(range);
  if (!r || !isTempoUsable(tempo)) return null;
  const startSec = countToTime(r.fromCount, tempo);
  const endSec = countToTime(r.toCount, tempo);
  return endSec > startSec ? { startSec, endSec } : null;
}

/**
 * 카운트 구간 → 안무표의 말. 마디로 딱 떨어지면 `8x3` · `8x3 ~ 8x4`, 아니면 `8x3의 3카운트 ~ 8x4의 2카운트`.
 * 행 라벨은 보드와 같은 문자열이다(intro / `8x3`).
 * @param {CountRange} range
 * @param {number} cols
 * @returns {string}
 */
export function countRangeLabel(range, cols) {
  const r = normalizeCountRange(range);
  if (!r) return '';
  const a = cellOf(r.fromCount, cols);
  const b = cellOf(r.toCount - 1, cols);
  const row = (n) => (n === 0 ? 'intro' : `${cols}x${n}`);
  if (a.index === 0 && b.index === cols - 1) {
    return a.row === b.row ? row(a.row) : `${row(a.row)} ~ ${row(b.row)}`;
  }
  if (a.row === b.row) return `${row(a.row)}의 ${a.index + 1}~${b.index + 1}카운트`;
  return `${row(a.row)}의 ${a.index + 1}카운트 ~ ${row(b.row)}의 ${b.index + 1}카운트`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 카운트 소리 — 언제 칠까
// ─────────────────────────────────────────────────────────────────────────────

/** 한 번에 내다보는 길이(초, 벽시계). 표본은 0.1초마다 오므로 그보다 넉넉하면 빈틈이 없다. */
export const CLICK_LOOKAHEAD_SEC = 0.35;

/** 한 계획에서 내는 최대 소리 수 — 박자가 터무니없이 빨라도 예약이 폭주하지 않는다. */
const MAX_CLICKS = 32;

/** 지금 막 지난 카운트를 「지금」으로 쳐 주는 너그러움(초, 영상 시각). 되감은 직후의 첫 카운트를 놓치지 않는다. */
const JUST_PASSED_SEC = 0.03;

/**
 * @typedef {Object} CountClick
 * @property {number} count 선형 카운트
 * @property {number} sec   그 카운트가 울리는 영상 시각
 * @property {number} beat  마디 안의 몇째 카운트(1..cols)
 * @property {'one'|'half'|'plain'} accent 마디의 첫 카운트(1)·가운데(5)·나머지
 */

/**
 * [fromSec, toSec) 안에 시작하는 카운트 전부. 박자 보정점(구간마다 다른 빠르기)과 하프타임
 * (한 카운트 = 두 박)을 그대로 따른다 — 소리는 **카운트마다** 한 번이다(춤추는 사람이 세는 단위).
 * @param {number} fromSec
 * @param {number} toSec
 * @param {import('./tempo.js').Tempo} tempo
 * @param {number} cols 한 마디의 카운트 수
 * @returns {CountClick[]}
 */
export function countClicks(fromSec, toSec, tempo, cols) {
  if (!isTempoUsable(tempo) || !(toSec > fromSec) || !(cols > 0)) return [];
  const out = [];
  // `+ 0` 은 -0 을 0 으로 접는다 — ceil(-0.03) 은 -0 이고, 그 카운트가 표에 `-0` 으로 남는다.
  let n = Math.ceil(timeToCount(fromSec, tempo) - 1e-9) + 0;
  for (; out.length < MAX_CLICKS; n++) {
    const sec = countToTime(n, tempo);
    if (sec >= toSec) break;
    if (sec < fromSec) continue;
    const beat = (((n % cols) + cols) % cols) + 1;
    const accent = beat === 1 ? 'one' : (cols % 2 === 0 && beat === cols / 2 + 1 ? 'half' : 'plain');
    out.push({ count: n, sec, beat, accent });
  }
  return out;
}

/**
 * @typedef {Object} ClickPlanState
 * @property {number|null} lastCount 이미 예약한 마지막 카운트
 * @property {number|null} lastSec   직전 표본의 영상 시각
 * @property {number} rate           직전 표본의 배속
 */

/** 아무것도 예약하지 않은 처음 상태. */
export const EMPTY_CLICK_PLAN = Object.freeze({ lastCount: null, lastSec: null, rate: 1 });

/**
 * 표본 하나를 받아 새로 예약할 소리를 정한다. 소리 어댑터는 `reset` 이면 걸어 둔 예약을 모두 버리고
 * `events` 를 그 벽시계 시각(atMs, 표본과 같은 performance.now 기준)에 낸다.
 *
 * 예약을 버리는 때 — 멈춤 · 배속이 바뀜 · 영상이 뒤로 감(구간 반복의 되감기, 탐색) · 크게 앞으로 뜀(탐색).
 * ⚠ 반복 구간이 있으면 **끝(배타) 앞에서 자른다**. 되감기는 표본이 끝을 넘은 뒤(최대 0.1초 늦게) 일어나므로,
 *   자르지 않으면 끝 카운트(= 다음 마디의 1)가 한 번 더 울리고, 되감은 자리의 1이 또 울려 박이 겹친다.
 * @param {ClickPlanState} state
 * @param {{
 *   sample: {sec:number, atMs:number, rate:number, playing:boolean}|null,  재생기의 표본(ports/media.js 의 TimeSample 과 같은 모양)
 *   tempo: import('./tempo.js').Tempo,
 *   cols: number,
 *   loop?: {startSec:number, endSec:number}|null,
 *   lookaheadSec?: number
 * }} input
 * @returns {{state: ClickPlanState, reset: boolean, events: (CountClick & {atMs:number})[]}}
 */
export function planClicks(state, input) {
  const prev = state || EMPTY_CLICK_PLAN;
  const { sample, tempo, cols } = input;
  const lookahead = Number.isFinite(input.lookaheadSec) ? input.lookaheadSec : CLICK_LOOKAHEAD_SEC;
  const hadPlan = prev.lastCount !== null;

  if (!sample || !sample.playing || !isTempoUsable(tempo) || !Number.isFinite(sample.sec)) {
    return { state: EMPTY_CLICK_PLAN, reset: hadPlan, events: [] };
  }
  const rate = sample.rate > 0 ? sample.rate : 1;
  const jumpedBack = prev.lastSec !== null && sample.sec < prev.lastSec - 0.05;
  const jumpedAhead = prev.lastSec !== null && sample.sec > prev.lastSec + (lookahead + 0.5) * rate;
  const reset = hadPlan && (rate !== prev.rate || jumpedBack || jumpedAhead);
  const lastCount = reset ? null : prev.lastCount;

  let toSec = sample.sec + lookahead * rate;
  const loop = input.loop;
  if (loop && sample.sec < loop.endSec) toSec = Math.min(toSec, loop.endSec);

  const events = countClicks(sample.sec - JUST_PASSED_SEC, toSec, tempo, cols)
    .filter(c => lastCount === null || c.count > lastCount)
    .map(c => ({ ...c, atMs: sample.atMs + ((c.sec - sample.sec) / rate) * 1000 }));

  const nextLast = events.length ? events[events.length - 1].count : lastCount;
  return { state: { lastCount: nextLast, lastSec: sample.sec, rate }, reset, events };
}
