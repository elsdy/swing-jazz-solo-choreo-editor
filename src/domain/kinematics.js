// src/domain/kinematics.js — 관절의 속도·가속도 (순수, domain/pose.js 만 import)
//
// 신설 파일이다(2026-09-12). domain/rom.js 가 "얼마나 넓게 움직였나"(가동 범위)를 잰다면
// 이 파일은 "얼마나 빠르고 날카롭게 움직였나"를 잰다. 스윙에서 같은 동작을 같은 각도로 해도
// 스냅이 있는 사람과 없는 사람이 갈리는데, 그 차이가 여기 숫자로 나온다.
//
// ⚠⚠ 이 파일이 지키는 것 하나: **2차 미분은 잡음을 증폭한다.** 랜드마크는 프레임마다 몇 mm 씩
//   떨린다. 그 떨림을 그대로 두 번 미분하면 가속도는 실제 동작이 아니라 **잡음의 그림자**가 된다
//   (떨림 진폭이 같아도 프레임 간격이 절반이면 가속도 잡음은 네 배가 된다). 그래서 미분 전에
//   반드시 평활화하고, 얼마나 평활화했는지(`smoothing`)를 결과에 적어 돌려준다. 평활화 창을
//   0 으로 두면 이 파일은 "날것을 줬으니 믿지 말라"는 뜻으로 그 사실도 함께 적는다.
//
// ⚠ **어느 좌표계로 재는가가 뜻을 바꾼다.**
//   · world(미터, 엉덩이 중점 원점) — 몸 기준의 움직임이다. 손목이 몸에 대해 얼마나 빠른가.
//     카메라가 흔들려도, 사람이 무대를 가로질러도 영향을 받지 않는다. **이것이 기본이다.**
//   · screen(정규 좌표 0..1) — 화면 기준이다. 카메라가 움직이면 사람이 가만히 있어도 값이 생기고,
//     단위가 미터가 아니라 "화면 폭의 비율"이라 m/s² 로 읽으면 안 된다.
//   두 좌표계의 값을 나란히 놓지 않는다(rom.js 의 space 규칙과 같다).
//
// ⚠ 절대 가속도(무대를 가로지르는 몸 전체의 가속도)는 **이 파일이 낼 수 없다.** 카메라 보정도
//   없고 카메라 자체가 움직이므로, 화면 좌표의 변화에서 실제 이동을 분리할 방법이 없다.
//   여기서 내는 것은 전부 **몸 기준**이다.

import { JOINT_SPECS, MEASURE_KEYS, TORSO_TILT, jointAngles, spaceOf } from './pose.js';

/**
 * 기본 눈금.
 * @typedef {Object} MotionRules
 * @property {number} minScore  이 신뢰도 미만의 표본은 버린다(rom.js 와 같은 뜻)
 * @property {number} smoothing 평활화 창(표본 개수, 홀수로 접는다). 0 이면 평활화하지 않는다
 * @property {number} maxGapSec 표본 사이가 이보다 벌어지면 **미분하지 않는다**(놓친 구간을 잇지 않는다)
 */
/** @type {Readonly<MotionRules>} */
export const DEFAULT_MOTION_RULES = Object.freeze({
  minScore: 0.5,
  // 30fps 에서 5프레임 ≈ 0.17초. 스윙의 1카운트(180bpm 에서 0.33초)보다 짧아 동작을 뭉개지 않으면서
  // 랜드마크 떨림은 걷어낸다. 더 키우면 스냅의 봉우리가 깎이고, 줄이면 잡음이 봉우리로 올라온다.
  smoothing: 5,
  // 0.25초. 이보다 벌어진 두 표본을 이어 미분하면 그 사이에 무슨 일이 있었는지 모르는 채
  // "평균 속도"를 순간 속도처럼 적게 된다.
  maxGapSec: 0.25
});

/** 속도·가속도를 재는 점. 손끝·발끝이 가장 빠르고, 무릎·팔꿈치가 스냅을 말한다. */
export const MOTION_POINTS = Object.freeze([
  'leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle',
  'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee'
]);

/** 사람이 읽는 이름. */
const POINT_LABELS = Object.freeze({
  leftWrist: '왼손목', rightWrist: '오른손목',
  leftAnkle: '왼발목', rightAnkle: '오른발목',
  leftElbow: '왼팔꿈치', rightElbow: '오른팔꿈치',
  leftKnee: '왼무릎', rightKnee: '오른무릎'
});

/**
 * 점 이름 → 사람이 읽는 이름.
 * @param {string} key
 * @returns {string}
 */
export function pointLabel(key) {
  return POINT_LABELS[key] || key;
}

/** 유한한 실수만. */
function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 창 크기를 1 이상의 홀수로 접는다(중앙 평균이라 홀수여야 좌우가 같다). */
function oddWindow(n) {
  const w = Math.floor(num(n, 0));
  if (w <= 1) return 1;
  return w % 2 ? w : w + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 표본 뽑기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 점의 시계열. 놓친 프레임·신뢰도 낮은 프레임은 **빠진다**(이어 붙이지 않는다) —
 * 빠진 자리는 sec 간격이 벌어지는 것으로 드러나고, maxGapSec 이 거기서 미분을 끊는다.
 *
 * @param {import('./pose.js').PoseFrame[]} frames 한 사람만 남긴 프레임 배열
 * @param {string} name POSE_POINT_NAMES 중 하나
 * @param {{minScore?:number, prefer?:'auto'|'screen'}} [options]
 * @returns {{space:'world'|'screen', samples:{sec:number, x:number, y:number, z:number}[], frames:number}}
 */
export function pointSeries(frames, name, options = {}) {
  const minScore = num(options.minScore, DEFAULT_MOTION_RULES.minScore);
  const list = Array.isArray(frames) ? frames : [];
  const samples = [];
  let space = 'screen';
  let sawWorld = false;
  for (const frame of list) {
    const subject = frame.subjects[0];
    if (!subject) continue;
    const { space: s, pts } = spaceOf(subject, options.prefer || 'auto');
    if (s === 'world') sawWorld = true;
    const p = pts[name];
    // ⚠ 신뢰도는 **언제나 화면 좌표**에서 읽는다(world 에는 가려짐 정보가 없는 모델이 있다).
    const seen = (subject.points || {})[name];
    if (!p || !seen || seen.score < minScore) continue;
    const sec = num(frame.sec, NaN);
    if (!Number.isFinite(sec)) continue;
    samples.push({ sec, x: num(p.x, 0), y: num(p.y, 0), z: num(p.z, 0) });
  }
  samples.sort((a, b) => a.sec - b.sec);
  space = sawWorld ? 'world' : 'screen';
  return { space, samples, frames: list.length };
}

/**
 * 한 관절 각도의 시계열(도). 각속도는 스냅을 가장 정직하게 말한다 —
 * 점의 속도는 사람이 무대를 가로지르기만 해도 커지지만, 각도는 몸의 모양만 본다.
 *
 * @param {import('./pose.js').PoseFrame[]} frames
 * @param {string} key MEASURE_KEYS 중 하나
 * @param {{minScore?:number}} [options]
 * @returns {{space:'world'|'screen', samples:{sec:number, deg:number}[], frames:number}}
 */
export function angleSeries(frames, key, options = {}) {
  const minScore = num(options.minScore, DEFAULT_MOTION_RULES.minScore);
  const list = Array.isArray(frames) ? frames : [];
  const samples = [];
  let sawWorld = false;
  for (const frame of list) {
    const subject = frame.subjects[0];
    if (!subject) continue;
    const { space, angles, scores } = jointAngles(subject);
    if (space === 'world') sawWorld = true;
    const deg = angles[key];
    if (deg === null || scores[key] < minScore) continue;
    const sec = num(frame.sec, NaN);
    if (!Number.isFinite(sec)) continue;
    samples.push({ sec, deg });
  }
  samples.sort((a, b) => a.sec - b.sec);
  return { space: sawWorld ? 'world' : 'screen', samples, frames: list.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 평활화와 미분
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 가운데 맞춤 이동평균. **시각은 건드리지 않고 값만** 고른다.
 *
 * ⚠ 표본이 고르지 않아도(놓친 프레임이 있어도) 개수 기준으로 창을 잡는다. 시간 기준으로 잡으면
 *   빈 구간에서 창이 통째로 비어 값이 사라진다 — 그건 평활화가 아니라 삭제다.
 * ⚠ 가장자리는 창을 줄여서 쓴다(값을 버리지 않는다). 그래서 맨 앞뒤 몇 표본은 덜 평활하다.
 *
 * @template {{sec:number}} T
 * @param {T[]} samples
 * @param {string[]} keys 평활화할 숫자 필드들
 * @param {number} window 창 크기(표본 개수). 1 이하면 그대로 돌려준다
 * @returns {T[]}
 */
export function smooth(samples, keys, window) {
  const w = oddWindow(window);
  const list = Array.isArray(samples) ? samples : [];
  if (w <= 1 || list.length === 0) return list.slice();
  const half = (w - 1) / 2;
  return list.map((s, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(list.length - 1, i + half);
    const out = { ...s };
    for (const key of keys) {
      let sum = 0;
      let n = 0;
      for (let j = lo; j <= hi; j++) {
        const v = list[j][key];
        if (Number.isFinite(v)) { sum += v; n += 1; }
      }
      out[key] = n ? sum / n : s[key];
    }
    return out;
  });
}

/**
 * 3차원 점 시계열 → 속도·가속도.
 *
 * 중앙차분을 쓴다(앞뒤 표본으로 가운데를 잰다) — 전진차분보다 한 표본만큼 덜 늦고 잡음에 덜 민감하다.
 * 양옆 중 하나라도 간격이 maxGapSec 을 넘으면 그 자리는 **비운다**(null) — 놓친 구간을 건너뛰며
 * 미분하면 없던 급가속이 생긴다.
 *
 * @param {{sec:number,x:number,y:number,z:number}[]} samples 평활화가 끝난 시계열
 * @param {{maxGapSec?:number}} [options]
 * @returns {{sec:number, speed:number|null, accel:number|null}[]}
 *   speed 는 크기(스칼라)다 — 방향은 스윙에서 읽을 일이 드물고, 크기만 봐도 스냅이 드러난다.
 */
export function derive(samples, options = {}) {
  const maxGap = num(options.maxGapSec, DEFAULT_MOTION_RULES.maxGapSec);
  const list = Array.isArray(samples) ? samples : [];
  const vel = list.map((s, i) => {
    const a = list[i - 1];
    const b = list[i + 1];
    if (!a || !b) return { sec: s.sec, v: null };
    const dt = b.sec - a.sec;
    if (!(dt > 0) || (s.sec - a.sec) > maxGap || (b.sec - s.sec) > maxGap) return { sec: s.sec, v: null };
    return {
      sec: s.sec,
      v: { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt }
    };
  });
  return vel.map((cur, i) => {
    const speed = cur.v ? Math.hypot(cur.v.x, cur.v.y, cur.v.z) : null;
    const a = vel[i - 1];
    const b = vel[i + 1];
    let accel = null;
    if (a && b && a.v && b.v) {
      const dt = b.sec - a.sec;
      if (dt > 0 && (cur.sec - a.sec) <= maxGap && (b.sec - cur.sec) <= maxGap) {
        accel = Math.hypot((b.v.x - a.v.x) / dt, (b.v.y - a.v.y) / dt, (b.v.z - a.v.z) / dt);
      }
    }
    return { sec: cur.sec, speed, accel };
  });
}

/**
 * 각도 시계열 → 각속도·각가속도(도/초, 도/초²). derive 와 같은 규칙이다.
 * @param {{sec:number, deg:number}[]} samples 평활화가 끝난 시계열
 * @param {{maxGapSec?:number}} [options]
 * @returns {{sec:number, degPerSec:number|null, degPerSec2:number|null}[]}
 */
export function deriveAngle(samples, options = {}) {
  const maxGap = num(options.maxGapSec, DEFAULT_MOTION_RULES.maxGapSec);
  const list = Array.isArray(samples) ? samples : [];
  const vel = list.map((s, i) => {
    const a = list[i - 1];
    const b = list[i + 1];
    if (!a || !b) return { sec: s.sec, v: null };
    const dt = b.sec - a.sec;
    if (!(dt > 0) || (s.sec - a.sec) > maxGap || (b.sec - s.sec) > maxGap) return { sec: s.sec, v: null };
    return { sec: s.sec, v: (b.deg - a.deg) / dt };
  });
  return vel.map((cur, i) => {
    const a = vel[i - 1];
    const b = vel[i + 1];
    let acc = null;
    if (a && b && a.v !== null && b.v !== null) {
      const dt = b.sec - a.sec;
      if (dt > 0 && (cur.sec - a.sec) <= maxGap && (b.sec - cur.sec) <= maxGap) acc = (b.v - a.v) / dt;
    }
    return { sec: cur.sec, degPerSec: cur.v === null ? null : Math.abs(cur.v), degPerSec2: acc === null ? null : Math.abs(acc) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 요약
// ─────────────────────────────────────────────────────────────────────────────

/** 시계열에서 봉우리와 중앙값을 뽑는다. 표본이 없으면 전부 null. */
function peakOf(rows, key) {
  let peak = null;
  let atSec = null;
  const values = [];
  for (const r of rows) {
    const v = r[key];
    if (v === null || !Number.isFinite(v)) continue;
    values.push(v);
    if (peak === null || v > peak) { peak = v; atSec = r.sec; }
  }
  values.sort((a, b) => a - b);
  const n = values.length;
  const median = n ? (n % 2 ? values[n >> 1] : (values[(n >> 1) - 1] + values[n >> 1]) / 2) : null;
  return { peak, atSec, median, samples: n };
}

/**
 * 한 구간의 움직임 요약. 이 파일의 본체다.
 *
 * 돌려주는 값에 **어떻게 쟀는지**가 함께 들어간다(space·smoothing·coverage). 가속도는 재는 방법에
 * 따라 배로 달라지는 값이라, 숫자만 떼어 놓으면 비교할 수 없기 때문이다.
 *
 * @param {import('./pose.js').PoseFrame[]} frames 한 사람만 남긴 프레임 배열
 * @param {{fromSec?:number, toSec?:number, rules?:Partial<MotionRules>, points?:string[], keys?:string[]}} [options]
 * @returns {{
 *   space:'world'|'screen', smoothing:number, frames:number, fromSec:number, toSec:number,
 *   unit:{speed:string, accel:string},
 *   points:Record<string,{peakSpeed:number|null, peakSpeedAtSec:number|null, medianSpeed:number|null,
 *                         peakAccel:number|null, peakAccelAtSec:number|null, medianAccel:number|null,
 *                         samples:number, coverage:number}>,
 *   angles:Record<string,{peakDegPerSec:number|null, peakAtSec:number|null, medianDegPerSec:number|null,
 *                         peakDegPerSec2:number|null, samples:number, coverage:number}>
 * }}
 */
export function summarizeMotion(frames, options = {}) {
  const rules = { ...DEFAULT_MOTION_RULES, ...(options.rules || {}) };
  const from = num(options.fromSec, -Infinity);
  const to = num(options.toSec, Infinity);
  const list = (Array.isArray(frames) ? frames : []).filter(f => f.sec >= from && f.sec < to);
  const pointKeys = options.points || MOTION_POINTS;
  const angleKeys = options.keys || MEASURE_KEYS;

  let space = 'screen';
  const points = {};
  for (const name of pointKeys) {
    const series = pointSeries(list, name, { minScore: rules.minScore });
    if (series.space === 'world') space = 'world';
    const rows = derive(smooth(series.samples, ['x', 'y', 'z'], rules.smoothing), rules);
    const sp = peakOf(rows, 'speed');
    const ac = peakOf(rows, 'accel');
    points[name] = {
      peakSpeed: sp.peak, peakSpeedAtSec: sp.atSec, medianSpeed: sp.median,
      peakAccel: ac.peak, peakAccelAtSec: ac.atSec, medianAccel: ac.median,
      samples: series.samples.length,
      coverage: list.length ? series.samples.length / list.length : 0
    };
  }

  const angles = {};
  for (const key of angleKeys) {
    const series = angleSeries(list, key, { minScore: rules.minScore });
    if (series.space === 'world') space = 'world';
    const rows = deriveAngle(smooth(series.samples, ['deg'], rules.smoothing), rules);
    const v = peakOf(rows, 'degPerSec');
    const a = peakOf(rows, 'degPerSec2');
    angles[key] = {
      peakDegPerSec: v.peak, peakAtSec: v.atSec, medianDegPerSec: v.median,
      peakDegPerSec2: a.peak,
      samples: series.samples.length,
      coverage: list.length ? series.samples.length / list.length : 0
    };
  }

  return {
    space,
    smoothing: oddWindow(rules.smoothing),
    frames: list.length,
    fromSec: list.length ? list[0].sec : 0,
    toSec: list.length ? list[list.length - 1].sec : 0,
    // ⚠ 단위가 좌표계를 따라간다. world 는 미터, screen 은 "화면 폭의 비율"이다 —
    //   screen 값을 m/s² 라고 부르면 그 자리에서 거짓말이 된다.
    unit: space === 'world'
      ? { speed: 'm/s', accel: 'm/s²' }
      : { speed: '화면폭/s', accel: '화면폭/s²' },
    points,
    angles
  };
}

/**
 * 두 요약을 견준다(같은 좌표계·같은 평활화일 때만). rom.compare 와 같은 규칙이다 —
 * 재는 방법이 다른 두 숫자를 나란히 놓으면 없던 변화가 보인다.
 * @param {ReturnType<typeof summarizeMotion>} before
 * @param {ReturnType<typeof summarizeMotion>} after
 * @returns {{ok:false, reason:string}|{ok:true, points:Record<string,{deltaPeakSpeed:number|null, deltaPeakAccel:number|null}>}}
 */
export function compareMotion(before, after) {
  if (!before || !after) return { ok: false, reason: 'missing' };
  if (before.space !== after.space) return { ok: false, reason: 'space' };
  if (before.smoothing !== after.smoothing) return { ok: false, reason: 'smoothing' };
  const points = {};
  for (const name of Object.keys(after.points)) {
    const a = before.points[name];
    const b = after.points[name];
    points[name] = {
      deltaPeakSpeed: (a && a.peakSpeed !== null && b.peakSpeed !== null) ? b.peakSpeed - a.peakSpeed : null,
      deltaPeakAccel: (a && a.peakAccel !== null && b.peakAccel !== null) ? b.peakAccel - a.peakAccel : null
    };
  }
  return { ok: true, points };
}
