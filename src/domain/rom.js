// src/domain/rom.js — 관절 각도의 시계열 → 가동 범위 요약 (순수, domain/pose.js 만 import)
//
// 신설 파일이다(2026-09-10). 이 파일이 "얼마나 좋아지고 있는가" 를 숫자로 만드는 자리다.
// 입력은 **한 사람만 남긴** 프레임 배열이라(domain/poseTracks.framesOfTrack) 여기서는 사람이 여럿이었다는
// 사실을 아예 모른다.
//
// ⚠ 이 파일이 지키는 것 하나: **못 본 것을 본 것처럼 세지 않는다.** 뒤돌아 선 구간, 화면 밖으로 나간 구간,
//   추적을 놓친 구간은 표본에서 빠지지만 **분모에는 남는다**(`coverage`). 그래야 "가동 범위 40°" 옆에
//   "구간의 35% 만 봤음" 이 함께 서고, 사용자가 그 숫자를 믿을지 말지 정할 수 있다.
//   커버리지를 숨기고 평균만 내면 세 프레임으로 잰 값이 300 프레임으로 잰 값과 똑같이 생기게 된다.
//
// ⚠ **임상 정상치를 넣지 않는다.** 여기 있는 기본 눈금(DEFAULT_RULES)은 "눈에 띄는 대목을 골라 주는" 값이지
//   의학적 기준이 아니다. 전부 상대값(좌우 차, 안 움직임, 측정 품질)이고 밖에서 갈아 끼울 수 있다.
//   "무릎은 몇 도까지가 정상" 같은 절대 기준을 여기 박으면 근거 없는 숫자가 권위를 갖는다.
//
// ⚠ 좌표계(`space`)가 다른 두 요약은 **비교하지 않는다**(`compare` 가 거절한다). world(미터)로 잰 각도와
//   화면 평면에 투영해 잰 각도는 같은 자세에서도 다른 숫자라, 나란히 놓으면 없던 변화가 보인다.

import { JOINT_PAIRS, MEASURE_KEYS, jointAngles, measureLabel } from './pose.js';

/**
 * 기본 눈금. 전부 **상대값**이고 호출부가 갈아 끼울 수 있다.
 * @typedef {Object} RomRules
 * @property {number} minScore   이 신뢰도 미만의 각도는 표본에서 뺀다
 * @property {number} minCoverage 이보다 적게 봤으면 그 관절의 요약을 믿지 말라고 표시한다
 * @property {number} asymmetryDeg 좌우 가동 범위가 이보다 벌어지면 표시한다
 * @property {number} stillDeg   가동 범위가 이보다 작으면 "거의 안 움직임" 으로 표시한다
 */
/** @type {Readonly<RomRules>} */
export const DEFAULT_RULES = Object.freeze({
  minScore: 0.5,
  minCoverage: 0.6,
  asymmetryDeg: 15,
  stillDeg: 8
});

/**
 * @typedef {Object} MeasureSummary
 * @property {number|null} min    가장 작은 각(가장 많이 굽힌 순간). 표본이 없으면 null
 * @property {number|null} max    가장 큰 각(가장 많이 편 순간)
 * @property {number|null} range  max - min. **이것이 "가동 범위"** 다
 * @property {number|null} median 중앙값. 평균 대신 쓴다 — 한 프레임의 튄 값이 통째로 끌고 가지 않는다
 * @property {number} samples     실제로 쓴 표본 수
 * @property {number} coverage    samples / 구간의 프레임 수 (0..1)
 */

/**
 * @typedef {Object} RomSummary
 * @property {'world'|'screen'} space 각도를 잰 좌표계. 다르면 비교할 수 없다
 * @property {number} fromSec
 * @property {number} toSec
 * @property {number} frames 구간에 든 프레임 수(사람을 놓친 프레임도 센다 — coverage 의 분모다)
 * @property {Record<string, MeasureSummary>} measures
 */

/** 유한한 실수만. */
function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 정렬된 배열의 중앙값. 빈 배열이면 null. */
function medianOf(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 구간에 든 프레임만 고른다. `toSec` 은 배타적이다(마커·배치의 구간 규약과 같다).
 * @param {import('./pose.js').PoseFrame[]} frames
 * @param {{fromSec?:number, toSec?:number}} [range] 생략하면 전부
 * @returns {import('./pose.js').PoseFrame[]}
 */
export function framesIn(frames, range = {}) {
  const list = Array.isArray(frames) ? frames : [];
  const from = num(range.fromSec, -Infinity);
  const to = num(range.toSec, Infinity);
  return list.filter(f => f.sec >= from && f.sec < to);
}

/**
 * 한 구간의 가동 범위 요약. 이 파일의 본체다.
 *
 * @param {import('./pose.js').PoseFrame[]} frames 한 사람만 남긴 프레임 배열
 * @param {{fromSec?:number, toSec?:number, rules?:Partial<RomRules>}} [options]
 * @returns {RomSummary}
 */
export function summarize(frames, options = {}) {
  const rules = { ...DEFAULT_RULES, ...(options.rules || {}) };
  const list = framesIn(frames, options);
  const values = {};
  for (const key of MEASURE_KEYS) values[key] = [];
  let space = 'screen';
  let sawWorld = false;

  for (const frame of list) {
    const subject = frame.subjects[0];
    if (!subject) continue;                       // 놓친 프레임 — 분모에는 남고 분자에는 안 든다
    const { space: s, angles, scores } = jointAngles(subject);
    if (s === 'world') sawWorld = true;
    for (const key of MEASURE_KEYS) {
      const v = angles[key];
      if (v === null || scores[key] < rules.minScore) continue;
      values[key].push(v);
    }
  }
  // 한 프레임이라도 world 로 쟀으면 world 로 본다 — 섞이는 일은 실제로는 없다(모델 하나가 끝까지 간다).
  space = sawWorld ? 'world' : 'screen';

  const measures = {};
  const denom = list.length || 0;
  for (const key of MEASURE_KEYS) {
    const sorted = values[key].slice().sort((a, b) => a - b);
    const n = sorted.length;
    measures[key] = {
      min: n ? sorted[0] : null,
      max: n ? sorted[n - 1] : null,
      range: n ? sorted[n - 1] - sorted[0] : null,
      median: medianOf(sorted),
      samples: n,
      coverage: denom ? n / denom : 0
    };
  }
  return {
    space,
    fromSec: num(options.fromSec, list.length ? list[0].sec : 0),
    toSec: num(options.toSec, list.length ? list[list.length - 1].sec : 0),
    frames: denom,
    measures
  };
}

/**
 * 카운트별로 나눠 요약한다. 카운트 ↔ 초 변환은 **주입받는다** — 이 파일이 Tempo 를 알 필요가 없고,
 * 보정점이 있든 없든 호출부가 만든 함수 하나로 끝난다.
 * @param {import('./pose.js').PoseFrame[]} frames
 * @param {(sec:number) => number} countOf 초 → 선형 카운트(정수로 접힌 값이어야 한다)
 * @param {{fromSec?:number, toSec?:number, rules?:Partial<RomRules>}} [options]
 * @returns {Array<{count:number, summary:RomSummary}>} 카운트 오름차순
 */
export function summarizeByCount(frames, countOf, options = {}) {
  const list = framesIn(frames, options);
  const buckets = new Map();
  for (const f of list) {
    const c = num(countOf(f.sec), NaN);
    if (!Number.isFinite(c)) continue;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push(f);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([count, fs]) => ({ count, summary: summarize(fs, { rules: options.rules }) }));
}

/**
 * 한 측정값의 시계열. 그래프용이라 각도만 뽑고 걸러 낸 자리는 null 로 남긴다(선이 끊겨 보여야 한다).
 * @param {import('./pose.js').PoseFrame[]} frames
 * @param {string} key
 * @param {{fromSec?:number, toSec?:number, rules?:Partial<RomRules>}} [options]
 * @returns {Array<{sec:number, value:number|null}>}
 */
export function seriesOf(frames, key, options = {}) {
  const rules = { ...DEFAULT_RULES, ...(options.rules || {}) };
  return framesIn(frames, options).map(f => {
    const subject = f.subjects[0];
    if (!subject) return { sec: f.sec, value: null };
    const { angles, scores } = jointAngles(subject);
    const v = angles[key];
    return { sec: f.sec, value: (v === null || scores[key] < rules.minScore) ? null : v };
  });
}

/**
 * 좌우 대칭. 스윙·재즈 솔로는 같은 figure 를 좌우로 반복하는 일이 많아, 한쪽만 작으면 그게 곧 다음 연습 과제다.
 * @param {RomSummary} summary
 * @param {Partial<RomRules>} [rules]
 * @returns {Array<{left:string, right:string, label:string, leftRange:number|null, rightRange:number|null, diff:number|null, flagged:boolean}>}
 */
export function symmetry(summary, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  return JOINT_PAIRS.map(([left, right]) => {
    const l = summary.measures[left];
    const rt = summary.measures[right];
    const lr = l ? l.range : null;
    const rr = rt ? rt.range : null;
    const diff = lr === null || rr === null ? null : Math.abs(lr - rr);
    return {
      left, right,
      label: measureLabel(left).replace(/^왼\s*/, ''),
      leftRange: lr, rightRange: rr, diff,
      flagged: diff !== null && diff >= r.asymmetryDeg
        && l.coverage >= r.minCoverage && rt.coverage >= r.minCoverage
    };
  });
}

/**
 * 눈에 띄는 대목을 골라 준다. **진단이 아니다** — 무엇을 보라고 가리키는 것뿐이고, 문구는 뷰가 만든다.
 * @param {RomSummary} summary
 * @param {Partial<RomRules>} [rules]
 * @returns {Array<{kind:'low-coverage'|'asymmetry'|'still', key:string, label:string, value:number|null}>}
 */
export function findings(summary, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  const out = [];
  for (const key of MEASURE_KEYS) {
    const m = summary.measures[key];
    if (!m) continue;
    if (m.coverage < r.minCoverage) {
      out.push({ kind: 'low-coverage', key, label: measureLabel(key), value: m.coverage });
      continue;                                   // 못 본 관절에 대고 "안 움직였다" 고 하지 않는다
    }
    if (m.range !== null && m.range < r.stillDeg) {
      out.push({ kind: 'still', key, label: measureLabel(key), value: m.range });
    }
  }
  for (const s of symmetry(summary, r)) {
    if (s.flagged) out.push({ kind: 'asymmetry', key: s.left, label: s.label, value: s.diff });
  }
  return out;
}

/**
 * 두 기록을 견준다 — 같은 동작의 지난 테이크와 오늘 테이크다. 이것이 "좋아지고 있는가" 의 답이다.
 *
 * ⚠ 좌표계가 다르면 **거절한다**(`ok:false`). 커버리지가 낮은 관절도 결과에 들어가지만 `trusted:false` 라,
 *   화면이 흐리게 두거나 뺄 수 있다.
 * @param {RomSummary} before
 * @param {RomSummary} after
 * @param {Partial<RomRules>} [rules]
 * @returns {{ok:boolean, reason?:string, items?:Array<{key:string, label:string, before:number|null, after:number|null, delta:number|null, trusted:boolean}>}}
 */
export function compare(before, after, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  if (!before || !after) return { ok: false, reason: 'missing' };
  if (before.space !== after.space) return { ok: false, reason: 'space-mismatch' };
  const items = MEASURE_KEYS.map(key => {
    const b = before.measures[key] || {};
    const a = after.measures[key] || {};
    const bv = b.range === undefined ? null : b.range;
    const av = a.range === undefined ? null : a.range;
    return {
      key,
      label: measureLabel(key),
      before: bv,
      after: av,
      delta: bv === null || av === null ? null : av - bv,
      trusted: (b.coverage || 0) >= r.minCoverage && (a.coverage || 0) >= r.minCoverage
    };
  });
  return { ok: true, items };
}
