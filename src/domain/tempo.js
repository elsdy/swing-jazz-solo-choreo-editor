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
 * @property {TempoPoint[]} points  보정점. 카운트·초 모두 **오름차순**이고 카운트가 겹치지 않는다.
 *   비어 있으면 bpm·앵커만의 선형 변환이다. 있으면 앵커와 보정점을 합친 점열 사이를 구간별 선형으로
 *   잇고, 양 끝 밖은 bpm 의 기울기로 뻗는다 — 템포가 흔들리는 실황 영상에서 동작마다 시작 시각을
 *   찍어 두면 그 사이가 저절로 맞는다
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
export const DEFAULT_TEMPO = Object.freeze({ bpm: 0, beatsPerCount: 1, anchorSec: 0, anchorCount: 0, points: Object.freeze([]) });

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

/**
 * 경계를 **가장 가까운 칸**으로 붙이는 반올림(2026-09-22).
 * ⚠ 엡실론을 더하고 반올림한다 — countToTime 을 거쳐 돌아온 값은 7.999999999999998 처럼 오차를
 *   달고 오고, 정확히 x.5 인 경계는 **뒤 칸**으로 보낸다(사용자가 말한 "사이면 다음 박").
 */
function roundCount(linear) {
  return Math.round(linear + COUNT_EPSILON);
}

/**
 * 받아 적기가 경계를 붙이는 격자 — **두 카운트** (2026-09-22).
 *
 * 스윙·재즈 솔로의 동작은 두 카운트 단위로 시작한다(카운트 축의 0·2·4·6 = 화면의 1·3·5·7박).
 * 한 카운트만 어긋난 자리에서 동작이 시작하는 일은 없으므로, 반올림한 값이 홀수 카운트를
 * 가리키면 그것은 **손이 빨랐거나 늦었다는 뜻**이지 안무가 그렇다는 뜻이 아니다.
 *
 * 격자의 위상은 **카운트 0**(안무표의 1카운트)에 맞춘다 — `② 박자 맞추기` 가 정한 기준 박자가
 * 거기이므로, 그것이 곧 사용자가 "첫 박" 이라고 부르는 자리다.
 *
 * ⚠ 이 값을 1 로 두면 2026-09-22 이전처럼 한 카운트 격자가 된다. 6카운트·3카운트 안무를 받아
 *   적어야 하는 날이 오면 그때 화면 스위치로 꺼낼 자리이고, 지금은 상수다.
 */
export const CAPTURE_GRID_COUNTS = 2;

/**
 * 경계를 `gridCounts` 칸마다 하나씩 있는 격자에 붙인다.
 * ⚠ **반올림한 정수를 다시 붙이지 않는다.** 두 번 반올림하면 2.6 이 3 을 거쳐 4 로 가는데,
 *   2.6 은 4 보다 2 에 가깝다. 언제나 원래 실수에서 한 번에 붙인다.
 */
function snapCount(linear, gridCounts) {
  const g = Number(gridCounts);
  if (!(g > 1)) return roundCount(linear);
  return Math.round((linear + COUNT_EPSILON) / g) * g;
}

/**
 * 경계 하나를 카운트 축에서 읽는다 — 잰 값·격자에 붙인 값·그 차이.
 *
 * `offset` 이 이 기능의 요점이다(2026-09-22). 사람이 누른 자리와 격자 사이의 거리인데,
 *  · 여러 번 눌러도 **한쪽으로 일정하면** 반응 지연이다 → `표 전체 옮기기` 로 고친다.
 *  · 누를수록 **한쪽으로 커지면** 영상의 실제 속도가 정한 BPM 과 다르다는 뜻이다.
 * 어느 쪽인지는 domain/captureDrift.js 가 표본을 모아 판정한다.
 *
 * @param {number} sec
 * @param {Tempo} tempo
 * @param {number} [gridCounts]
 * @returns {{ raw:number, snapped:number, offset:number }|null} 읽을 수 없으면 null
 */
export function boundaryCount(sec, tempo, gridCounts = 1) {
  // ⚠ 초를 **먼저** 본다. timeToCount 는 못 읽는 값을 0 으로 흘려보내므로, 여기서 안 막으면
  //   NaN 이 "카운트 0 에서 딱 맞게 눌렀다"는 표본이 되어 판정을 조용히 끈다.
  if (!Number.isFinite(Number(sec))) return null;
  const raw = timeToCount(Number(sec), tempo);
  if (!Number.isFinite(raw)) return null;
  const snapped = snapCount(raw, gridCounts);
  return { raw, snapped, offset: raw - snapped };
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
    anchorCount: finiteOr(src.anchorCount, DEFAULT_TEMPO.anchorCount),
    points: normalizeTempoPoints(src.points)
  };
}

/**
 * 손상된 보정점 배열을 **카운트·초 모두 오름차순이고 카운트가 겹치지 않는** 배열로 만든다.
 * 규칙: 유한하지 않은 점은 버린다 → 카운트로 정렬한다(같은 카운트는 뒤의 것이 이긴다) →
 * 앞 점보다 초가 크지 않은 점은 버린다(시간이 되감기는 지도는 역함수가 없다).
 * ⚠ 앵커와의 관계는 여기서 보지 않는다 — 그건 tempoPoints 가 합칠 때 처리한다.
 * @param {unknown} raw
 * @returns {TempoPoint[]}
 */
export function normalizeTempoPoints(raw) {
  if (!Array.isArray(raw)) return [];
  const byCount = new Map();
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const count = finiteOr(p.count, NaN);
    const sec = finiteOr(p.sec, NaN);
    if (!Number.isFinite(count) || !Number.isFinite(sec)) continue;
    byCount.set(count, { count, sec });
  }
  const sorted = [...byCount.values()].sort((a, b) => a.count - b.count);
  const out = [];
  for (const p of sorted) {
    if (out.length && !(p.sec > out[out.length - 1].sec)) continue;
    out.push(p);
  }
  return out;
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
 * 변환에 실제로 쓰는 점열: 앵커 + 보정점을 카운트 순으로 합친 것. **길이 ≥ 1** 이 보장된다.
 * 앵커와 같은 카운트의 보정점이 있으면 보정점이 이긴다. 앵커를 넣었더니 초가 되감기는 보정점
 * (앵커보다 앞 카운트인데 초는 뒤, 또는 그 반대)은 그 점을 버린다 — 앵커가 기준이다.
 * ⚠ 보정점이 없으면 `[앵커]` 하나라 아래 두 함수가 정확히 옛 선형식으로 떨어진다.
 * @param {Tempo} tempo
 * @returns {TempoPoint[]}
 */
export function tempoPoints(tempo) {
  const anchor = { count: tempo.anchorCount, sec: tempo.anchorSec };
  const pts = Array.isArray(tempo.points) ? tempo.points : [];
  if (pts.length === 0) return [anchor];
  if (pts.some(p => p.count === anchor.count)) return pts;
  // 점열은 이미 카운트·초 모두 오름차순이다(normalizeTempoPoints). 앵커 앞쪽에서는 앵커보다 초가 늦은 점,
  // 뒤쪽에서는 앵커보다 초가 이른 점이 되감기다 — 그 점들만 버리면 나머지는 그대로 오름차순이다.
  const before = pts.filter(p => p.count < anchor.count && p.sec < anchor.sec);
  const after = pts.filter(p => p.count > anchor.count && p.sec > anchor.sec);
  return [...before, anchor, ...after];
}

/**
 * 선형 카운트 → 시각(초). 점열 사이는 구간별 선형, 양 끝 밖은 bpm 의 기울기로 뻗는다.
 * 보정점이 없으면 `anchorSec + (count - anchorCount) * spc` 그대로다. 앵커 이전(음수 카운트, intro 행)도
 * 그대로 음수 방향으로 나간다.
 * @param {number} count
 * @param {Tempo} tempo
 * @returns {number}
 */
export function countToTime(count, tempo) {
  const pts = tempoPoints(tempo);
  const spc = secondsPerCount(tempo);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (count <= first.count) return first.sec + (count - first.count) * spc;
  if (count >= last.count) return last.sec + (count - last.count) * spc;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (count <= b.count) return a.sec + (count - a.count) * ((b.sec - a.sec) / (b.count - a.count));
  }
  return last.sec;   // 도달하지 않는다(위 분기가 전부 덮는다)
}

/**
 * 시각(초) → 선형 카운트(실수). countToTime 의 정확한 역함수다(점열이 초·카운트 모두 오름차순이라 가능하다).
 * 칸 경계에 딱 떨어지지 않으므로 정수가 아니다.
 * @param {number} sec
 * @param {Tempo} tempo
 * @returns {number}
 */
export function timeToCount(sec, tempo) {
  const pts = tempoPoints(tempo);
  const spc = secondsPerCount(tempo);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (sec <= first.sec) return first.count + (sec - first.sec) / spc;
  if (sec >= last.sec) return last.count + (sec - last.sec) / spc;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (sec <= b.sec) return a.count + (sec - a.sec) * ((b.count - a.count) / (b.sec - a.sec));
  }
  return last.count;
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

/**
 * **경계로 끊은** 구간 → 격자 범위. 잇달아 놓아도 서로 겹치지 않는다 (2026-09-20).
 *
 * spanToCountRange 와 무엇이 다른가 — 끝을 `ceil-1` 이 아니라 **반올림 −1** 로 잡는다.
 * 그쪽 규칙("칸 중간에서 끝나도 그 칸을 덮는다")은 마커처럼 **혼자 떨어진 구간**에는 맞지만,
 * 받아 적기처럼 경계 하나가 앞 구간의 끝이면서 뒤 구간의 시작인 사슬에서는 그 칸을 둘이
 * 동시에 갖는다. 그러면 배치가 겹쳐 한 마디가 두 줄로 쌓인다 — 순서대로 받아 적은 안무에
 * 겹칠 것이 있을 리 없으므로 그건 언제나 버그다.
 *
 * ```
 *   경계 8.6카운트에서 끊었을 때
 *     spanToCountRange   앞 …8  뒤 8…   ← 칸 8 을 둘이 갖는다 (겹침)
 *     반올림             앞 …8  뒤 9…   ← 겹치진 않지만 한 칸 늦다
 *     이 함수(반올림)    앞 …7  뒤 8…   ← 누른 순간에서 **가장 가까운 칸**이 그 동작의 첫 칸이다
 * ```
 *
 * **왜 반올림인가** — 이 규칙은 두 번 뒤집혔다. 그 기록을 남겨 둔다.
 *
 *  · 처음(2026-09-12)엔 반올림이었다.
 *  · 2026-09-20 에 **내림**으로 바꿨다 — "생각했던 것보다 한 카운트 뒤에 놓인다"는 보고 때문이다.
 *    사람은 동작이 바뀌는 것을 보고 나서 누르므로(반응 지연 150~250ms) 늦게 누르는 쪽으로 치우치고,
 *    내림은 누른 순간이 아직 그 칸 안에 있으면 그 칸으로 붙여 한 칸 어치 지연까지 흡수한다.
 *  · 2026-09-22 에 **반올림으로 되돌렸다** — "7박과 8박 사이에서 끊으면 8박에서 시작해야 한다"는
 *    요청이다. 내림은 **미리 누르는 것**을 전혀 못 받아 준다: 8박을 겨누고 0.3칸 일찍 누르면
 *    7.7 → 칸 7 로 떨어져 한 칸 당겨진다. 익숙해진 사람은 박이 오는 것을 알고 미리 누르므로
 *    이쪽이 더 잦다.
 *
 * **바꾸면서 잃는 것**(다음에 또 뒤집기 전에 읽을 것): 반 칸을 넘게 **늦게** 누르면 이제 다음
 * 칸으로 간다. 내림이 흡수하던 "한 칸까지의 지연"이 "반 칸까지"로 줄어든 것이다. 둘 다 만족시키는
 * 값은 없다 — 한쪽으로 치우친 사람에게 맞추면 반대쪽이 틀린다.
 * ⚠ 치우침이 일정하면(늘 반 칸 늦다면) 변환을 고치지 말고 `③ 받아 적기` 의 `전체 ← 1카운트` 로
 *   뒤에 통째로 민다 — 변환에 상수 보정을 박아 넣으면 제때 누른 사람이 반대로 당겨진다.
 *
 * ⚠ 두 경계가 **같은 칸에 들면** `to` 가 `from` 보다 작다. 놓을 칸이 없다는 뜻이고,
 *   호출부가 그것을 보고 아무것도 놓지 않는다(억지로 한 칸을 만들면 그 칸을 또 겹쳐 문다).
 *   그래서 여기서는 spanToCountRange 처럼 `Math.max(fromN, …)` 로 접지 **않는다.**
 * ⚠ `roundCount` 를 쓴다(단순 Math.round 가 아니다) — countToTime 을 거쳐 돌아온 값은
 *   7.999999999999998 처럼 오차를 달고 오고, 정확히 x.5 인 경계는 뒤 칸으로 보내야 한다.
 * ⚠ **양 끝이 같은 함수를 쓴다.** 한쪽만 반올림하면 앞 구간의 끝과 뒤 구간의 시작이 어긋나
 *   칸을 겹쳐 물거나 버린다 — 이 함수가 존재하는 까닭 자체가 그 겹침이었다. `gridCounts` 도
 *   마찬가지로 양 끝에 똑같이 먹인다.
 *
 * **`gridCounts`** (2026-09-22) — 2 를 주면 경계가 **짝수 카운트에만** 붙는다(CAPTURE_GRID_COUNTS).
 * 동작이 두 카운트 단위로만 시작하는 안무에서는 홀수 카운트로 떨어진 경계가 언제나 손의 오차이고,
 * 그것을 그대로 두면 한 칸 밀린 블록이 앞 동작의 첫 칸을 파고든다. 붙이고 남은 거리는 버리지 말고
 * `boundaryCount` 로 따로 재서 속도 어긋남을 알리는 데 쓴다.
 * ⚠ 격자를 키우면 **놓을 수 없는 구간도 늘어난다** — 두 경계가 같은 짝수 칸에 붙으면 `empty` 다.
 *   두 카운트보다 짧은 동작은 애초에 없다는 전제가 이 값의 근거다.
 *
 * @param {number} startSec 이 구간을 연 경계
 * @param {number} endSec   이 구간을 닫은(=다음 구간을 연) 경계
 * @param {number} cols
 * @param {Tempo} tempo
 * @param {number} [gridCounts] 1 이면 칸마다, 2 면 짝수 칸에만 붙인다
 * @returns {{ from:{row:number,index:number}, to:{row:number,index:number}, empty:boolean }}
 *   empty: 두 경계가 같은 칸이라 놓을 것이 없다
 */
export function boundarySpanToCountRange(startSec, endSec, cols, tempo, gridCounts = 1) {
  const fromN = snapCount(timeToCount(startSec, tempo), gridCounts);
  const toN = snapCount(timeToCount(endSec, tempo), gridCounts) - 1;
  return { from: cellOf(fromN, cols), to: cellOf(toN, cols), empty: toN < fromN };
}

/**
 * 이 길이의 영상을 끝까지 담으려면 마디가 몇이어야 하는가 (2026-09-20).
 *
 * 영상에서 받아 적을 때 안무표가 영상보다 짧으면 뒷부분을 놓을 자리가 없다. 받아 적기를
 * 여는 순간 이 값으로 마디를 한 번에 늘려 두면, 받는 동안 자리가 모자라는 일이 없다.
 *
 * ⚠ **마지막 카운트가 든 마디**를 돌려준다(spanToCountRange 의 `to.row` 와 같은 값이다).
 *   끝이 마디 한가운데면 그 마디까지 세므로, 끝 카운트가 8x3의 3카운트면 3을 돌려준다.
 * ⚠ 앵커가 0초가 아니면 **0초는 음수 카운트**다. 그래도 세는 것은 끝뿐이므로 영향이 없다 —
 *   앵커보다 앞선 대목은 안무 이전(인트로·설명)이고 그 자리는 인트로 행의 몫이다.
 * ⚠ 박자를 못 쓰면(bpm 이 없거나 0) `null` 이다. 초를 카운트로 바꿀 수 없으니 셀 수가 없다.
 *
 * @param {number} durationSec 영상 전체 길이(초). 모르면 호출부가 null 을 주고 여기 오지 않는다
 * @param {number} cols 한 마디의 카운트 수
 * @param {Tempo} tempo
 * @returns {number|null} 필요한 마디 수(1 이상). 셀 수 없으면 null
 */
export function rowsForDuration(durationSec, cols, tempo) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (!isTempoUsable(tempo)) return null;
  const { to } = spanToCountRange(0, durationSec, cols, tempo);
  return Math.max(1, to.row);
}

// ─────────────────────────────────────────────────────────────────────────────
// 템포 보정 — 사용자가 BPM 을 몰라도 두 점만 찍으면 된다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "여기가 8x1의 1", "여기가 8x5의 1" 두 점 → bpm 과 앵커를 동시에 얻는다.
 * 멀리 떨어진 두 점을 쓸수록 클릭 오차가 bpm 에 미치는 영향이 카운트 차이만큼 나눠진다.
 * ⚠ 보정점 없이 새 Tempo 를 만든다 — bpm 을 새로 잰 것이므로 옛 보정점은 그 bpm 과 어긋난 값이다.
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
 * ⚠ 보정점이 있으면 지도 전체를 **같은 만큼 민다**(각 점의 초에 같은 차이를 더한다). 점을 그대로 두면
 *   앵커만 옮겨져 되감기는 점이 생기고, 지우면 애써 찍은 것이 날아간다. "싱크가 통째로 어긋났다"가
 *   이 조작의 뜻이므로 밀어 두는 것이 맞다.
 * @param {Tempo} tempo
 * @param {TempoPoint} point
 * @returns {Tempo}
 */
export function reanchor(tempo, point) {
  const shift = point.sec - countToTime(point.count, tempo);
  const had = tempo.points || [];
  // 옛 앵커도 지도의 한 점이었다 — 보정점이 있을 때는 그것을 보정점으로 남겨야 지도의 모양이 그대로 밀린다.
  const carried = had.length ? [...had, { count: tempo.anchorCount, sec: tempo.anchorSec }] : [];
  return normalizeTempo({
    bpm: tempo.bpm,
    beatsPerCount: tempo.beatsPerCount,
    anchorSec: point.sec,
    anchorCount: point.count,
    points: carried.filter(p => p.count !== point.count).map(p => ({ count: p.count, sec: p.sec + shift }))
  });
}

/**
 * 시간축을 통째로 민다 — 영상을 [inSec, …) 로 잘라 새 클립으로 만들면 모든 시각이 inSec 만큼 당겨진다.
 * 앵커와 보정점의 초에 같은 deltaSec 을 더하고, bpm·beatsPerCount·카운트는 그대로다.
 * ⚠ 미설정(bpm 0)이어도 앵커 초는 민다 — 앵커만 찍어 둔 사용자의 값도 그 영상의 시간축에 붙은 값이다.
 * @param {Tempo} tempo
 * @param {number} deltaSec 더할 초(잘라내기면 -inSec)
 * @returns {Tempo}
 */
export function shiftTempo(tempo, deltaSec) {
  const d = finiteOr(deltaSec, 0);
  const t = normalizeTempo(tempo);
  return normalizeTempo({
    ...t,
    anchorSec: t.anchorSec + d,
    points: t.points.map(p => ({ count: p.count, sec: p.sec + d }))
  });
}

/**
 * 보정점 하나를 넣는다(같은 카운트가 있으면 갈아 끼운다). 앵커와 같은 카운트면 보정점으로 앵커를 덮는다.
 * ⚠ 넣은 결과가 되감기면(앞 카운트인데 초가 뒤이거나 그 반대) **null** — 넣지 않는다. 조용히 다른 점을
 *   버리면 사용자는 무엇이 사라졌는지 모른다. 뷰가 null 을 보고 "앞뒤 점과 순서가 맞지 않는다"고 말한다.
 * @param {Tempo} tempo
 * @param {TempoPoint} point
 * @returns {Tempo|null}
 */
export function addTempoPoint(tempo, point) {
  const count = finiteOr(point && point.count, NaN);
  const sec = finiteOr(point && point.sec, NaN);
  if (!Number.isFinite(count) || !Number.isFinite(sec)) return null;
  const kept = (tempo.points || []).filter(p => p.count !== count);
  const merged = [...kept, { count, sec }].sort((a, b) => a.count - b.count);
  for (let i = 1; i < merged.length; i++) {
    if (!(merged[i].sec > merged[i - 1].sec)) return null;
  }
  // 앵커와도 되감기면 안 된다(앵커와 같은 카운트는 덮는 것이라 예외).
  if (count !== tempo.anchorCount) {
    const before = count < tempo.anchorCount;
    if (before ? !(sec < tempo.anchorSec) : !(sec > tempo.anchorSec)) return null;
  }
  return normalizeTempo({ ...tempo, points: merged });
}

/**
 * 그 카운트의 보정점을 뺀다. 없으면 그대로 돌려준다(새 객체).
 * @param {Tempo} tempo
 * @param {number} count
 * @returns {Tempo}
 */
export function removeTempoPoint(tempo, count) {
  return normalizeTempo({ ...tempo, points: (tempo.points || []).filter(p => p.count !== count) });
}

/**
 * 보정점을 전부 뺀다. bpm·앵커는 그대로다.
 * @param {Tempo} tempo
 * @returns {Tempo}
 */
export function clearTempoPointsOf(tempo) {
  return normalizeTempo({ ...tempo, points: [] });
}

/**
 * 두드린 간격이 얼마나 고른가 — 간격의 표준편차를 평균으로 나눈 값(0 이면 완벽, 0.02 면 2%).
 *
 * `bpmFromTaps` 는 **처음과 끝만** 쓴다(중간 탭은 개수로만 들어간다). 그래서 값 하나로는 그것이
 * 고르게 두드린 결과인지 손이 흔들린 결과인지 알 수 없다 — 이 함수가 그 차이를 값으로 만든다.
 * 화면은 이것을 "표 끝에서 몇 카운트 어긋나는가"로 번역해 보여 준다(그게 사용자의 결정 근거다).
 *
 * ⚠ 간격이 둘은 있어야 흔들림을 말할 수 있다(탭 3번). 그보다 적으면 `null` 이다.
 * @param {number[]} tapSecs 두드린 시각(초). 증가 순서여야 한다
 * @returns {number|null} 상대 표준편차. 못 재면 null
 */
export function tapSpread(tapSecs) {
  if (!Array.isArray(tapSecs) || tapSecs.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < tapSecs.length; i++) {
    const gap = tapSecs[i] - tapSecs[i - 1];
    if (!Number.isFinite(gap) || gap <= 0) return null;
    gaps.push(gap);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!(mean > 0)) return null;
  const varSum = gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0);
  return Math.sqrt(varSum / gaps.length) / mean;
}

/**
 * BPM 이 `refBpm` 만큼 틀렸다면 `counts` 카운트 뒤에 몇 카운트가 어긋나는가.
 *
 * **BPM 의 오차는 거리에 비례해 쌓인다.** 0.2% 차이는 1마디에서는 0.016카운트라 아무도 못 느끼지만
 * 52마디(416카운트) 끝에서는 0.83카운트 — 재생 헤드가 한 칸 가까이 밀린다. 그래서 두 값을 견줄 때
 * "BPM 175.2 대 174.8" 이 아니라 **이 수**를 보여야 한다. 사람이 고를 수 있는 단위이기 때문이다.
 *
 * @param {number} bpm 견줄 값
 * @param {number} refBpm 기준 값
 * @param {number} counts 안무표의 총 카운트
 * @returns {number|null} 어긋나는 카운트 수. 못 재면 null
 */
export function driftCounts(bpm, refBpm, counts) {
  if (!Number.isFinite(bpm) || !Number.isFinite(refBpm) || !Number.isFinite(counts)) return null;
  if (!(bpm > 0) || !(refBpm > 0) || !(counts > 0)) return null;
  return Math.abs(bpm - refBpm) / refBpm * counts;
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
