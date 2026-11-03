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
 * @property {string} model  잰 모델(`mediapipe/full`). 모르면 빈 문자열. 둘 다 알고 다르면 비교할 수 없다(RM-30)
 * @property {number} aspect 잰 영상의 폭/높이. 모르면 0. 둘 다 알고 다르면 비교할 수 없다(RM-30)
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
 * 프레임들이 뜬 영상의 폭/높이. 처음 보이는 사람의 것을 쓴다 — 한 영상 안에서는 바뀌지 않는다. 모르면 0.
 * @param {import('./pose.js').PoseFrame[]} list
 * @returns {number}
 */
// @complexity time=O(n) space=O(1) cc=4
function aspectOf(list) {
  for (const f of list) {
    const a = f.subjects[0] ? num(f.subjects[0].aspect, NaN) : NaN;
    if (Number.isFinite(a) && a > 0) return a;
  }
  return 0;
}

/**
 * 한 구간의 가동 범위 요약. 이 파일의 본체다.
 *
 * `model` · `aspect` 는 비교를 거절할 근거로 요약에 따라다닌다(RM-30). aspect 를 안 주면 프레임에서 읽는다.
 * @param {import('./pose.js').PoseFrame[]} frames 한 사람만 남긴 프레임 배열
 * @param {{fromSec?:number, toSec?:number, rules?:Partial<RomRules>, model?:string, aspect?:number}} [options]
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
  const aspect = num(options.aspect, NaN);
  return {
    space,
    model: options.model == null ? '' : String(options.model),
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : aspectOf(list),
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
    .map(([count, fs]) => ({ count, summary: summarize(fs, { rules: options.rules, model: options.model, aspect: options.aspect }) }));
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

/** 화면 비율이 다른 영상인가. 2% 안쪽은 같은 것으로 친다(1920x1080 과 1920x1088 인코딩 여백). 모르면(0) 대조하지 않는다. */
const ASPECT_TOLERANCE = 0.02;

// @complexity time=O(1) space=O(1) cc=4
function aspectDiffers(a, b) {
  const x = num(a, 0);
  const y = num(b, 0);
  if (!(x > 0) || !(y > 0)) return false;
  return Math.abs(x - y) / Math.max(x, y) > ASPECT_TOLERANCE;
}

/**
 * 두 기록을 견준다 — 같은 동작의 지난 테이크와 오늘 테이크다. 이것이 "좋아지고 있는가" 의 답이다.
 *
 * ⚠ 좌표계가 다르면 **거절한다**(`ok:false`). 모델 · 화면 비율도 둘 다 알고 다르면 거절한다(RM-30). 커버리지가 낮은 관절도 결과에 들어가지만 `trusted:false` 라,
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
  // 모델 · 화면 비율은 **둘 다 알 때만** 대조한다 — 옛 요약(이 필드가 없던 것)끼리는 그대로 견준다(RM-30).
  if (before.model && after.model && before.model !== after.model) return { ok: false, reason: 'model-mismatch' };
  if (aspectDiffers(before.aspect, after.aspect)) return { ok: false, reason: 'aspect-mismatch' };
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

// ─────────────────────────────────────────────────────────────────────────────
// 요약 표와 테이크 비교 (RM-30, 2026-11-03)
//
// 짝 파일에 남긴 원본에서 그때그때 만든다 — 요약은 어디에도 저장하지 않는다(2026-10-01 결정 Q36).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 요약 표의 줄. 관절마다 가동 범위 · 최소 · 최대 · 커버리지와 「믿을 만한가」를 낸다.
 * ⚠ 못 본 관절(커버리지가 눈금 미만)도 **빼지 않는다** — `trusted:false` 로 두어 화면이 흐리게 그린다.
 *   빼면 「무릎이 없다」와 「무릎을 못 봤다」가 같은 화면이 된다.
 * @param {RomSummary} summary
 * @param {Partial<RomRules>} [rules]
 * @returns {Array<{key:string, label:string, range:number|null, min:number|null, max:number|null, coverage:number, trusted:boolean}>}
 */
// @complexity time=O(k) space=O(k) cc=3
export function summaryRows(summary, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  const measures = (summary && summary.measures) || {};
  return MEASURE_KEYS.map(key => {
    const m = measures[key] || { min: null, max: null, range: null, coverage: 0 };
    return {
      key, label: measureLabel(key),
      range: m.range, min: m.min, max: m.max,
      coverage: m.coverage || 0,
      trusted: (m.coverage || 0) >= r.minCoverage && m.range !== null
    };
  });
}

/** 마커 이름표를 짝지을 열쇠로 — 앞뒤 공백을 떼고 대소문자를 접는다. 빈 이름표는 짝짓지 않는다. */
function labelKey(label) {
  return String(label == null ? '' : label).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 두 테이크의 마커를 **이름표로** 짝짓는다(2026-10-01 결정 Q35). 박자가 조금 어긋나도 사람이 찍은 구간이라
 * 엉뚱한 동작끼리 붙지 않는다. 한 테이크에 같은 이름이 여럿이면 **나온 차례대로** 짝짓는다(첫째는 첫째와).
 * 이름표가 빈 마커와 짝이 없는 마커는 빠진다.
 * @param {Array<{label?:string, inSec:number, outSec:number}>} before 영상 시각 순이 아니어도 된다
 * @param {Array<{label?:string, inSec:number, outSec:number}>} after
 * @returns {Array<{label:string, before:{inSec:number, outSec:number}, after:{inSec:number, outSec:number}}>} before 의 시각 순
 */
// @complexity time=O(n log n + m log m) space=O(n + m) cc=8
export function pairMarkersByLabel(before, after) {
  const byTime = (list) => (Array.isArray(list) ? list : [])
    .filter(m => m && labelKey(m.label) && Number.isFinite(m.inSec) && Number.isFinite(m.outSec) && m.outSec > m.inSec)
    .slice().sort((a, b) => a.inSec - b.inSec);
  const queues = new Map();
  for (const m of byTime(after)) {
    const k = labelKey(m.label);
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(m);
  }
  const out = [];
  for (const m of byTime(before)) {
    const q = queues.get(labelKey(m.label));
    if (!q || !q.length) continue;
    const other = q.shift();
    out.push({
      label: String(m.label).trim(),
      before: { inSec: m.inSec, outSec: m.outSec },
      after: { inSec: other.inSec, outSec: other.outSec }
    });
  }
  return out;
}

/**
 * 두 테이크를 견준다 — 분석 구간 전체 한 줄, 그리고 이름표가 같은 마커마다 한 줄(2026-10-01 결정 Q35).
 * 마커가 없는 테이크는 전체만 견준다. 모델 · 좌표계 · 화면 비율이 다르면 **통째로 거절한다**(`ok:false`) —
 * 전체에서 거절할 이유는 마커 구간에서도 같다.
 *
 * @param {{frames: import('./pose.js').PoseFrame[], model?:string, aspect?:number, markers?:Array<{label?:string, inSec:number, outSec:number}>}} before
 * @param {{frames: import('./pose.js').PoseFrame[], model?:string, aspect?:number, markers?:Array<{label?:string, inSec:number, outSec:number}>}} after
 * @param {Partial<RomRules>} [rules]
 * @returns {{ok:boolean, reason?:string, sections?:Array<{label:string, marker:boolean, items:ReturnType<typeof compare>['items']}>}}
 */
// @complexity time=O((p+1)·(n+m)) space=O(n+m) cc=4
export function compareTakes(before, after, rules = {}) {
  if (!before || !after) return { ok: false, reason: 'missing' };
  const sum = (take, range = {}) => summarize(take.frames, { ...range, rules, model: take.model, aspect: take.aspect });
  const whole = compare(sum(before), sum(after), rules);
  if (!whole.ok) return { ok: false, reason: whole.reason };
  const sections = [{ label: '', marker: false, items: whole.items }];
  for (const pair of pairMarkersByLabel(before.markers, after.markers)) {
    const res = compare(
      sum(before, { fromSec: pair.before.inSec, toSec: pair.before.outSec }),
      sum(after, { fromSec: pair.after.inSec, toSec: pair.after.outSec }),
      rules
    );
    if (res.ok) sections.push({ label: pair.label, marker: true, items: res.items });
  }
  return { ok: true, sections };
}
