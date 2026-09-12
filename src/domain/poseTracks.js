// src/domain/poseTracks.js — "프레임마다 잡힌 사람들" 을 "한 사람의 궤적" 으로 잇는다 (순수)
//
// 신설 파일이다(2026-09-10). 이 파일이 있는 이유는 하나다: **자세 모델은 같은 사람에게 같은 번호를 주지
// 않는다.** 프레임마다 사람을 새로 찾을 뿐이라 `subjects[0]` 이 어제의 그 사람이라는 보장이 없고,
// 두 사람이 스쳐 지나가면 순서가 조용히 뒤바뀐다. 누가 누구인지는 우리가 이어야 한다.
//
// ⚠ 설계의 뼈대는 **템포 보정점과 같다.** 완벽한 자동 추적을 만들려 하지 않는다 — 춤은 사람이 겹치고
//   돌고 화면 밖으로 나간다. 대신 "여기 이 사람" 이라는 **앵커**를 사용자가 찍으면 그 앞뒤로 이어 붙이고,
//   흔들린 구간은 숨기지 않고 `ambiguous` 로 **드러낸다.** 틀린 궤적으로 조용히 낸 가동 범위는
//   이 기능에서 가장 나쁜 실패다(옆 사람의 팔을 내 기록으로 남긴다).
//
// ⚠ 한 사람만 나오는 영상에서는 앵커가 필요 없다(`autoAnchors`). 사용자가 아무것도 안 해도 된다.
//
// ⚠ 거리는 **몸 크기로 나눈 값**으로 잰다. 화면 정규 좌표에서 0.1 은 멀리 선 사람에게는 몸 하나이고
//   가까이 선 사람에게는 한 뼘이다. 픽셀 거리를 그대로 문턱으로 쓰면 줌마다 다르게 동작한다.

import { boxOf, centroidOf } from './pose.js';   // 자료형(PoseFrame·PoseSubject)도 여기 것을 쓴다

/** 한 프레임 사이에 사람이 움직일 수 있다고 보는 최대 거리. 몸 높이의 배수다. */
export const MAX_JUMP = 1.2;

/** 사람을 놓친 뒤 몇 프레임까지 기다렸다가 포기하는가. 잠깐 가려지는 것은 흔하다. */
export const COAST_FRAMES = 6;

/**
 * 1등과 2등 후보가 이만큼 안에서 붙어 있으면 "누구인지 헷갈렸다" 로 본다.
 * 두 사람이 스쳐 지나가는 순간이 정확히 이 모양이라, 여기서 잘못 고르면 그 뒤로 통째로 남의 궤적이 된다.
 */
export const AMBIGUOUS_RATIO = 1.35;

/** 궤적 하나에 붙는 기본 id. 사람 수가 늘면 p1, p2, … 로 나간다. */
export function trackIdOf(n) {
  return `p${n}`;
}

/**
 * @typedef {Object} PoseAnchor
 * @property {number} sec 이 시각의 프레임에서
 * @property {number} subject 이 번호의 사람이
 * @property {string} id 이 궤적이다
 */

/**
 * @typedef {Object} TrackSpan
 * @property {string} id
 * @property {number} fromSec
 * @property {number} toSec
 */

/**
 * @typedef {Object} PoseTracks
 * @property {string[]} ids 이어 붙인 궤적 id 목록
 * @property {Array<Record<string, number>>} byFrame 프레임마다 `{궤적 id: 사람 번호}`. 없으면 키가 없다
 * @property {TrackSpan[]} ambiguous 누구인지 헷갈린 구간. 사용자가 그 자리에서 다시 찍어야 하는 곳이다
 * @property {TrackSpan[]} lost 놓친 구간(가려짐·화면 밖)
 */

/**
 * 한 프레임에 몇 명이 잡혔는가의 요약. 화면이 "인물을 고르세요" 를 띄울지 말지 이걸로 정한다.
 * @param {import('./pose.js').PoseFrame[]} frames
 * @returns {{max:number, framesWithMultiple:number, total:number}}
 */
export function subjectCounts(frames) {
  let max = 0;
  let many = 0;
  const list = Array.isArray(frames) ? frames : [];
  for (const f of list) {
    const n = f && Array.isArray(f.subjects) ? f.subjects.length : 0;
    if (n > max) max = n;
    if (n > 1) many++;
  }
  return { max, framesWithMultiple: many, total: list.length };
}

/**
 * 한 사람짜리 영상인가. **한 프레임이라도** 둘 이상이면 거짓이다 —
 * 뒤에서 지나가는 사람 하나가 궤적을 통째로 가져갈 수 있으므로 관대하게 굴지 않는다.
 * @param {import('./pose.js').PoseFrame[]} frames
 * @returns {boolean}
 */
export function isSinglePerson(frames) {
  const { max } = subjectCounts(frames);
  return max === 1;
}

/**
 * 사람이 하나뿐이면 앵커를 저절로 만든다. 사용자가 아무것도 고르지 않아도 되는 경로다.
 * 여럿이면 **빈 배열** — 자동으로 고르지 않는다(누구인지는 우리가 알 수 없다).
 * @param {import('./pose.js').PoseFrame[]} frames
 * @returns {PoseAnchor[]}
 */
export function autoAnchors(frames) {
  if (!isSinglePerson(frames)) return [];
  const first = (frames || []).find(f => f.subjects.length === 1);
  return first ? [{ sec: first.sec, subject: 0, id: trackIdOf(1) }] : [];
}

/**
 * 화면의 한 점을 누른 것이 누구인가. 상자 안에 든 사람 중 중심이 가장 가까운 사람,
 * 아무 상자에도 안 들었으면 몸 높이의 `maxDist` 배 안에서 가장 가까운 사람이다.
 * @param {import('./pose.js').PoseFrame|null} frame
 * @param {{x:number, y:number}} point 화면 정규 좌표(0..1)
 * @param {{maxDist?:number, minScore?:number}} [opts]
 * @returns {number|null} 사람 번호. 아무도 없으면 null
 */
export function pickSubjectAt(frame, point, opts = {}) {
  if (!frame || !Array.isArray(frame.subjects) || !point) return null;
  const maxDist = Number.isFinite(opts.maxDist) ? opts.maxDist : 0.75;
  const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 0.3;
  let insideBest = null, insideDist = Infinity;
  let nearBest = null, nearDist = Infinity;
  for (let i = 0; i < frame.subjects.length; i++) {
    const box = boxOf(frame.subjects[i], minScore);
    const c = centroidOf(frame.subjects[i], minScore);
    if (!box || !c) continue;
    const d = Math.sqrt((c.x - point.x) ** 2 + (c.y - point.y) ** 2);
    const inside = point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    if (inside) {
      if (d < insideDist) { insideDist = d; insideBest = i; }
    } else if (d < nearDist && d <= maxDist * Math.max(box.h, 0.05)) {
      nearDist = d; nearBest = i;
    }
  }
  return insideBest !== null ? insideBest : nearBest;
}

/** 프레임 배열에서 그 시각에 해당하는 인덱스(그 시각 이상인 첫 프레임, 없으면 마지막). */
function frameIndexAt(frames, sec) {
  for (let i = 0; i < frames.length; i++) if (frames[i].sec >= sec) return i;
  return frames.length - 1;
}

/** 몸 높이. 없거나 너무 작으면 최소값으로 — 0 으로 나누지 않는다. */
function heightOf(subject) {
  const box = boxOf(subject);
  return Math.max(box ? box.h : 0, 0.05);
}

/**
 * 한 방향으로 궤적을 이어 붙인다. forward/backward 가 정확히 같은 코드를 쓰도록 step 으로 방향만 바꾼다.
 * @param {import('./pose.js').PoseFrame[]} frames
 * @param {number} startIndex 이미 할당이 끝난 프레임
 * @param {number} stopIndex  여기까지(포함) 간다
 * @param {number} step +1 또는 -1
 * @param {string} id
 * @param {Array<Record<string, number>>} byFrame 여기에 채워 넣는다(가변)
 * @param {{ambiguous:boolean[], lost:boolean[]}} marks
 */
function walk(frames, startIndex, stopIndex, step, id, byFrame, marks) {
  const seedIdx = byFrame[startIndex] && byFrame[startIndex][id];
  if (seedIdx === undefined) return;
  let last = centroidOf(frames[startIndex].subjects[seedIdx]);
  let lastH = heightOf(frames[startIndex].subjects[seedIdx]);
  let missed = 0;

  for (let i = startIndex + step; step > 0 ? i <= stopIndex : i >= stopIndex; i += step) {
    const frame = frames[i];
    if (!last) return;
    // 이 프레임에서 다른 궤적이 이미 가져간 사람은 후보에서 뺀다 — 한 사람이 둘일 수 없다.
    const taken = new Set(Object.values(byFrame[i] || {}));
    let best = null, bestCost = Infinity, secondCost = Infinity;
    for (let s = 0; s < frame.subjects.length; s++) {
      if (taken.has(s)) continue;
      const c = centroidOf(frame.subjects[s]);
      if (!c) continue;
      const cost = Math.sqrt((c.x - last.x) ** 2 + (c.y - last.y) ** 2) / lastH;
      if (cost < bestCost) { secondCost = bestCost; bestCost = cost; best = s; }
      else if (cost < secondCost) { secondCost = cost; }
    }
    if (best === null || bestCost > MAX_JUMP) {
      // 놓쳤다. 잠깐 가려진 것일 수 있으니 마지막 자리를 들고 몇 프레임 기다린다.
      marks.lost[i] = true;
      if (++missed > COAST_FRAMES) return;
      continue;
    }
    missed = 0;
    if (!byFrame[i]) byFrame[i] = {};
    byFrame[i][id] = best;
    // 2등이 바짝 붙어 있으면 지금 고른 것이 맞다고 장담할 수 없다. 그 사실을 남긴다.
    if (secondCost < Infinity && secondCost <= bestCost * AMBIGUOUS_RATIO) marks.ambiguous[i] = true;
    last = centroidOf(frame.subjects[best]);
    lastH = heightOf(frame.subjects[best]);
  }
}

/** 참으로 표시된 프레임들을 연속 구간으로 묶는다. */
function spansOf(flags, frames, id) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= frames.length; i++) {
    if (i < frames.length && flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push({ id, fromSec: frames[start].sec, toSec: frames[i - 1].sec });
      start = -1;
    }
  }
  return out;
}

/**
 * 앵커에서 출발해 궤적을 이어 붙인다.
 *
 * 같은 id 의 앵커가 여럿이면 **뒤 앵커가 그 지점부터 이긴다** — 템포의 `여기로 다시 맞추기` 와 같은 규약이라,
 * 두 사람이 스쳐 지나가 궤적이 옮겨 붙은 자리에서 한 번 더 찍으면 그 뒤가 고쳐진다.
 * 첫 앵커에서는 영상 앞쪽으로도 거슬러 올라간다(중간에서 찍어도 처음부터 이어진다).
 *
 * @param {import('./pose.js').PoseFrame[]} frames 시각 오름차순(ports/pose.normalizePoseFrames 가 보장)
 * @param {PoseAnchor[]} anchors 비어 있으면 한 사람짜리 영상에 한해 autoAnchors 로 채운다
 * @returns {PoseTracks}
 */
export function buildTracks(frames, anchors) {
  const list = Array.isArray(frames) ? frames : [];
  const seeds = (Array.isArray(anchors) && anchors.length) ? anchors : autoAnchors(list);
  const byFrame = list.map(() => ({}));
  const ambiguous = [];
  const lost = [];
  if (!list.length || !seeds.length) return { ids: [], byFrame, ambiguous, lost };

  const ids = [];
  for (const a of seeds) if (a && a.id && !ids.includes(a.id)) ids.push(a.id);

  for (const id of ids) {
    const own = seeds
      .filter(a => a && a.id === id && Number.isFinite(a.sec) && Number.isInteger(a.subject))
      .map(a => ({ ...a, index: frameIndexAt(list, a.sec) }))
      .filter(a => a.index >= 0 && a.subject >= 0 && a.subject < list[a.index].subjects.length)
      .sort((x, y) => x.index - y.index);
    if (!own.length) continue;

    const marks = { ambiguous: [], lost: [] };
    for (let k = 0; k < own.length; k++) {
      const at = own[k].index;
      byFrame[at][id] = own[k].subject;
      // 다음 앵커 직전까지만 간다 — 그 뒤는 다음 앵커가 자기 자리에서 다시 시작한다.
      const stop = k + 1 < own.length ? own[k + 1].index - 1 : list.length - 1;
      walk(list, at, stop, +1, id, byFrame, marks);
    }
    walk(list, own[0].index, 0, -1, id, byFrame, marks);

    ambiguous.push(...spansOf(marks.ambiguous, list, id));
    lost.push(...spansOf(marks.lost, list, id));
  }
  return { ids, byFrame, ambiguous, lost };
}

/**
 * 궤적 하나만 남긴 프레임 배열. 가동 범위 계산(domain/rom.js)은 언제나 이걸 받는다 —
 * 그래서 rom.js 는 사람이 여럿이었다는 사실을 아예 모른다.
 *
 * ⚠ 놓친 프레임도 **버리지 않고** 사람이 없는 프레임으로 남긴다. 빼 버리면 "80% 만 봤다" 가
 *   "100% 다 봤다" 로 둔갑해 신뢰도가 부풀려진다.
 * @param {import('./pose.js').PoseFrame[]} frames
 * @param {PoseTracks} tracks
 * @param {string} id
 * @returns {import('./pose.js').PoseFrame[]}
 */
export function framesOfTrack(frames, tracks, id) {
  const list = Array.isArray(frames) ? frames : [];
  const byFrame = (tracks && tracks.byFrame) || [];
  return list.map((f, i) => {
    const s = byFrame[i] ? byFrame[i][id] : undefined;
    const subject = s === undefined ? null : f.subjects[s];
    return { sec: f.sec, subjects: subject ? [subject] : [] };
  });
}
