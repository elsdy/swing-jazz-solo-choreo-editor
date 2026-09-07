// src/domain/tempo.js — 카운트 ↔ 초 변환 (순수 함수, 의존은 domain/grid.js 하나)
//
// 신규 파일이다. 원본 index.html 에 대응물이 없다 — 좌표는 grid.js 의 카운트 축(linearOf/cellOf)을
// 그대로 재사용하고, 여기서는 그 위에 "카운트 하나가 몇 초인가" 곱셈 한 겹만 얹는다.
// 설계 근거: scratchpad/design/spec-동영상 §3. DOM·타이머·난수·시계를 한 글자도 쓰지 않는다.

import { cellOf, clamp, linearOf } from './grid.js';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 시간은 바깥에서 안으로만 들어온다. 카운트(행·칸)는 이 파일 밖으로 나가지 않는다.
// 플레이어도 외부 시퀀스 엔진도 `초` 하나만 주고받고, 초 ↔ 카운트 변환은 여기 한 곳에서만 한다.
//
// ⚠ intro 행은 분기가 아니라 음수 구간이다. linearOf(row,index,cols) = (row-1)*cols + index 이므로
//   row 0(intro)은 자동으로 [-cols, -1] = 앵커 이전 시각으로 떨어진다. 특수 케이스 0개.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Tempo
 * @property {number} bpm           분당 박자. 0 = 아직 정해지지 않음(미설정)
 * @property {number} beatsPerCount 카운트 1칸 = 몇 박 (기본 1, 하프타임 2, 더블타임 0.5)
 * @property {number} anchorSec     anchorCount 가 재생되는 영상 시각(초)
 * @property {number} anchorCount   anchorSec 에 대응하는 선형 카운트 (0 = 8x1 의 1카운트)
 */

/**
 * @typedef {Object} TempoPoint
 * @property {number} count 선형 카운트
 * @property {number} sec   그 카운트가 재생되는 시각(초)
 */

/**
 * @typedef {Object} CountSpan
 * @property {number} startSec 구간 시작 시각(초)
 * @property {number} endSec   구간 끝 시각(초, 배타적 — 마지막 카운트가 끝나는 순간)
 */

// startOffset 대신 (anchorSec, anchorCount) 쌍을 두는 이유: 사용자가 곡 중간 아무 카운트에서나
// "지금 여기가 이 카운트" 로 재앵커할 수 있고 bpm 은 건드리지 않는다.
// 시작 오프셋은 anchorCount === 0 인 특수한 앵커일 뿐이다.
/** @type {Readonly<Tempo>} */
export const DEFAULT_TEMPO = Object.freeze({ bpm: 0, beatsPerCount: 1, anchorSec: 0, anchorCount: 0 });

const BPM_MIN = 20;
const BPM_MAX = 400;
const BPC_MIN = 0.125;
const BPC_MAX = 8;

// 카운트 경계 판정용 허용 오차. countToTime 을 거쳐 다시 timeToCount 로 돌아오면 배정밀도 오차 탓에
// 정확히 8인 카운트가 7.999999999999998 로 나오고, 그냥 floor 하면 재생 헤드가 한 칸 뒤 칸을
// fraction 0.99999 로 가리킨다. 1e-9 카운트는 400bpm·bpc 0.125 에서도 2e-11 초라 무해하다.
const COUNT_EPSILON = 1e-9;

/** 경계 오차를 흡수하는 floor. timeToCell 을 cellToTime 의 정확한 역함수로 만든다. */
function floorCount(linear) {
  return Math.floor(linear + COUNT_EPSILON);
}

/** 유한한 실수인가. NaN·Infinity·문자열·null 을 전부 거른다. */
function finiteOr(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 손상된 입력을 Tempo 로 정규화한다.
 * bpm 은 20..400, beatsPerCount 는 0.125..8 로 클램프한다.
 * ⚠ bpm 이 유한한 양수가 아니면 클램프하지 않고 0(미설정)으로 둔다 — 0 을 20 으로 올려 버리면
 *   "템포를 아직 안 정했다"가 "20bpm 이다"로 둔갑해 isTempoUsable 이 거짓 참을 돌려준다.
 * @param {Partial<Tempo>|null|undefined} raw
 * @returns {Tempo}
 */
export function normalizeTempo(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const bpmRaw = finiteOr(src.bpm, 0);
  return {
    bpm: bpmRaw > 0 ? clamp(bpmRaw, BPM_MIN, BPM_MAX) : 0,
    beatsPerCount: clamp(finiteOr(src.beatsPerCount, DEFAULT_TEMPO.beatsPerCount), BPC_MIN, BPC_MAX),
    anchorSec: finiteOr(src.anchorSec, DEFAULT_TEMPO.anchorSec),
    anchorCount: finiteOr(src.anchorCount, DEFAULT_TEMPO.anchorCount)
  };
}

/**
 * 이 템포로 실제 변환을 해도 되는가. 호출부는 변환 전에 이걸 먼저 물어야 한다.
 * @param {Tempo|null|undefined} tempo
 * @returns {boolean}
 */
export function isTempoUsable(tempo) {
  if (!tempo || typeof tempo !== 'object') return false;
  return Number.isFinite(tempo.bpm) && tempo.bpm > 0
    && Number.isFinite(tempo.beatsPerCount) && tempo.beatsPerCount > 0
    && Number.isFinite(tempo.anchorSec)
    && Number.isFinite(tempo.anchorCount);
}

/**
 * 카운트 1칸이 몇 초인가.
 * ⚠ bpm 이 0 이면 Infinity 를 돌려준다. 호출부가 isTempoUsable 로 먼저 걸러야 한다.
 * @param {Tempo} tempo
 * @returns {number}
 */
export function secondsPerCount(tempo) {
  return (60 / tempo.bpm) * tempo.beatsPerCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 두 줄 — 나머지는 전부 이 둘의 조합이다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 선형 카운트 → 시각(초). 앵커 이전(음수 카운트, intro 행)도 그대로 음수 방향으로 나간다.
 * @param {number} count
 * @param {Tempo} tempo
 * @returns {number}
 */
export function countToTime(count, tempo) {
  return tempo.anchorSec + (count - tempo.anchorCount) * secondsPerCount(tempo);
}

/**
 * 시각(초) → 선형 카운트(실수). 칸 경계에 딱 떨어지지 않으므로 정수가 아니다.
 * @param {number} sec
 * @param {Tempo} tempo
 * @returns {number}
 */
export function timeToCount(sec, tempo) {
  return tempo.anchorCount + (sec - tempo.anchorSec) / secondsPerCount(tempo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 격자 ↔ 시간
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (행, 칸) → 시각(초).
 * @param {number} row
 * @param {number} index
 * @param {number} cols
 * @param {Tempo} tempo
 * @returns {number}
 */
export function cellToTime(row, index, cols, tempo) {
  return countToTime(linearOf(row, index, cols), tempo);
}

/**
 * 시각(초) → 격자 위치. fraction 은 그 칸 안의 진행률로 재생 헤드 위치에 그대로 쓴다.
 * @param {number} sec
 * @param {number} cols
 * @param {Tempo} tempo
 * @returns {{ row:number, index:number, fraction:number, linear:number }}
 *   fraction 은 [0,1) — floor 기반이라 음수 카운트(intro)에서도 음수가 되지 않는다.
 *   linear 는 보정 전 실수값이라 fraction === linear - floor(linear) 가 아닐 수 있다(경계에서 0 으로 접힌다).
 */
export function timeToCell(sec, cols, tempo) {
  const linear = timeToCount(sec, tempo);
  const n = floorCount(linear);
  const { row, index } = cellOf(n, cols);
  return { row, index, fraction: Math.max(0, linear - n), linear };
}

/**
 * 배치 세그먼트 하나 → 초 구간. endSec 은 배타적(마지막 카운트가 끝나는 순간)이라
 * endSec - startSec === length * secondsPerCount 가 항상 성립한다.
 * @param {{row:number, startIndex:number, length:number}} placement
 * @param {number} cols
 * @param {Tempo} tempo
 * @returns {CountSpan}
 */
export function placementToSpan(placement, cols, tempo) {
  const start = linearOf(placement.row, placement.startIndex, cols);
  return { startSec: countToTime(start, tempo), endSec: countToTime(start + placement.length, tempo) };
}

/**
 * 같은 groupId 의 세그먼트 배열 → 전체를 덮는 하나의 초 구간.
 * ⚠ 세그먼트 사이의 빈틈은 메우지 않고 그냥 포함한다(최소 시작 ~ 최대 끝).
 * @param {{row:number, startIndex:number, length:number}[]} segments
 * @param {number} cols
 * @param {Tempo} tempo
 * @returns {CountSpan|null} 빈 배열이면 null
 */
export function groupToSpan(segments, cols, tempo) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  let minStart = null;
  let maxEnd = null;
  for (const seg of segments) {
    const start = linearOf(seg.row, seg.startIndex, cols);
    const end = start + seg.length;
    if (minStart === null || start < minStart) minStart = start;
    if (maxEnd === null || end > maxEnd) maxEnd = end;
  }
  return { startSec: countToTime(minStart, tempo), endSec: countToTime(maxEnd, tempo) };
}

/**
 * 엔진이 준 초 구간 → 그 구간이 덮는 격자 범위(양끝 포함).
 * from 은 startSec 이 놓인 칸, to 는 endSec 직전 칸이다 — placementToSpan 의 역이 되도록
 * 끝을 ceil-1 로 잡아 "칸 중간에서 끝나는 구간도 그 칸을 포함"하게 한다.
 * ⚠ endSec <= startSec 인 뒤집힌/영길이 구간은 from 한 칸짜리로 접는다(빈 범위를 만들지 않는다).
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} cols
 * @param {Tempo} tempo
 * @returns {{ from:{row:number,index:number}, to:{row:number,index:number} }}
 */
export function spanToCountRange(startSec, endSec, cols, tempo) {
  const fromN = floorCount(timeToCount(startSec, tempo));
  const toN = Math.max(fromN, Math.ceil(timeToCount(endSec, tempo) - COUNT_EPSILON) - 1);
  return { from: cellOf(fromN, cols), to: cellOf(toN, cols) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 템포 보정 — 사용자가 BPM 을 몰라도 두 점만 찍으면 된다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "여기가 8x1의 1", "여기가 8x5의 1" 두 점 → bpm 과 앵커를 동시에 얻는다.
 * 멀리 떨어진 두 점을 쓸수록 클릭 오차가 bpm 에 미치는 영향이 카운트 차이만큼 나눠진다.
 * @param {TempoPoint} a 앞선 점(앵커가 된다)
 * @param {TempoPoint} b 뒤따르는 점
 * @param {number} [beatsPerCount=1]
 * @returns {Tempo|null} 순서가 뒤집혔거나 간격이 0 이면 null (보정 불가)
 */
export function tempoFromTwoPoints(a, b, beatsPerCount = 1) {
  const dCount = b.count - a.count;
  const dSec = b.sec - a.sec;
  if (!(dCount > 0) || !(dSec > 0)) return null;
  return normalizeTempo({
    bpm: (60 * beatsPerCount * dCount) / dSec,
    beatsPerCount,
    anchorSec: a.sec,
    anchorCount: a.count
  });
}

/**
 * bpm 은 그대로 두고 앵커만 옮긴다 — 곡 중간에서 어긋난 싱크를 한 번의 클릭으로 다시 맞추는 경로.
 * @param {Tempo} tempo
 * @param {TempoPoint} point
 * @returns {Tempo}
 */
export function reanchor(tempo, point) {
  return normalizeTempo({
    bpm: tempo.bpm,
    beatsPerCount: tempo.beatsPerCount,
    anchorSec: point.sec,
    anchorCount: point.count
  });
}

/**
 * 탭 템포. 첫 탭과 마지막 탭의 평균 간격으로 bpm 을 추정한다(중간 탭의 흔들림이 평균에 흡수된다).
 * ⚠ 클램프하지 않은 날 bpm 을 돌려준다 — Tempo 로 만들 때 normalizeTempo 가 20..400 으로 가둔다.
 * @param {number[]} tapSecs 탭한 시각(초) 배열. 오름차순이어야 한다
 * @param {number} [beatsPerTap=1] 탭 하나가 몇 박인가
 * @returns {number|null} 탭이 2개 미만이거나 간격이 0 이하면 null
 */
export function bpmFromTaps(tapSecs, beatsPerTap = 1) {
  if (!Array.isArray(tapSecs) || tapSecs.length < 2) return null;
  for (const t of tapSecs) if (!Number.isFinite(t)) return null;
  for (let i = 1; i < tapSecs.length; i++) if (!(tapSecs[i] > tapSecs[i - 1])) return null;
  const avgGap = (tapSecs[tapSecs.length - 1] - tapSecs[0]) / (tapSecs.length - 1);
  const bpm = (60 * beatsPerTap) / avgGap;
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}
