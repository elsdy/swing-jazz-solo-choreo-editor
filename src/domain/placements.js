// src/domain/placements.js — placement 질의와 생성 (순수 함수)
//
// 원본 index.html 의 getAffectedRowsByGroup(3386) · getAffectedRowsByMoveName(3390) ·
// placementRangeLabel 계산부(3410-3418) · groupCount(3479) · getGroup(3483) 과,
// 6곳에 흩어져 있던 placement 리터럴 생성(3585·3627·3660·3694·3717·4668)을 makeSegmentPlacements 하나로 모았다.
// 이름 기준 전수 치환(3120·3191·3273)도 여기로 옮겼다.

import { linearOf } from './grid.js';

/**
 * @typedef {Object} Placement
 * @property {string} id
 * @property {string} groupId
 * @property {string} name
 * @property {string} category
 * @property {true} [pending]  이름을 아직 안 붙인 블록(받아 적기). 참일 때만 키가 있다
 * @property {'routine'} [type]
 * @property {string} [routineId]
 * @property {number} row
 * @property {number} startIndex
 * @property {number} length
 * @property {number} [subRow]
 */

// ─────────────────────────────────────────────────────────────────────────────
// 질의
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 그룹의 세그먼트를 (row, startIndex) 순으로 정렬해 돌려준다. 입력 배열은 건드리지 않는다.
 * @see index.html:3483
 * @param {Placement[]} placements
 * @param {string} groupId
 * @returns {Placement[]}
 */
export function getGroup(placements, groupId) {
  return placements.filter(p => p.groupId === groupId).sort((a, b) => a.row - b.row || a.startIndex - b.startIndex);
}

/**
 * 그룹의 총 카운트(모든 세그먼트 length 합).
 * @see index.html:3479
 * @param {Placement[]} placements
 * @param {string} groupId
 * @returns {number}
 */
export function groupCount(placements, groupId) {
  return placements.filter(p => p.groupId === groupId).reduce((sum, p) => sum + p.length, 0);
}

/**
 * groupId 별로 세그먼트를 묶는다. 값 배열은 **원본 배열 순서**를 유지한다(정렬하지 않는다).
 * mergeProjectData(4139-4144)의 groupMap 생성과 syncCurrentRoutine(4655-4659)의 그룹 순회가 쓰던 형태.
 * @see index.html:4139
 * @param {Placement[]} placements
 * @returns {Map<string, Placement[]>}
 */
export function groupsOf(placements) {
  const map = new Map();
  placements.forEach(p => {
    if (!map.has(p.groupId)) map.set(p.groupId, []);
    map.get(p.groupId).push(p);
  });
  return map;
}

/**
 * 그룹이 걸쳐 있는 행 목록. ⚠ 중복을 제거하지 않는다(원본 그대로) — 호출부가 필요하면 Set 으로 감싼다.
 * @see index.html:3386
 * @param {Placement[]} placements
 * @param {string} groupId
 * @returns {number[]}
 */
export function affectedRowsByGroup(placements, groupId) {
  return placements.filter(p => p.groupId === groupId).map(p => p.row);
}

/**
 * 같은 이름의 배치가 있는 행 목록. ⚠ 중복 제거 없음(원본 그대로).
 * @see index.html:3390
 * @param {Placement[]} placements
 * @param {string} name
 * @returns {number[]}
 */
export function affectedRowsByMoveName(placements, name) {
  return placements.filter(p => p.name === name).map(p => p.row);
}

/**
 * placementRangeLabel(3410-3418)의 계산부. 문자열 포맷은 placementRangeLabel / ui.rangeLabel 이 맡는다.
 * @see index.html:3411
 * @param {Placement[]} placements
 * @param {string} groupId
 * @param {number} [cols] 주면 startCount(카운트 축 좌표)를 함께 계산한다. 표기 문자열에는 쓰이지 않는다
 * @returns {{ segments: Placement[], first: Placement, totalLength: number, startCount: number|null }|null}
 *          그룹이 없으면 null (원본은 이 경우 '' 를 반환했다)
 */
export function groupRanges(placements, groupId, cols) {
  const segs = placements
    .filter(p => p.groupId === groupId)
    .sort((a, b) => a.row - b.row || a.startIndex - b.startIndex);
  if (!segs.length) return null;
  const first = segs[0];
  const totalLength = segs.reduce((sum, s) => sum + s.length, 0);
  return {
    segments: segs,
    first,
    totalLength,
    startCount: cols == null ? null : linearOf(first.row, first.startIndex, cols)
  };
}

/**
 * 비고란 표기. ⚠ PR #17 이후 형식이다: 행별 나열이 아니라 **첫 행 기준 `8x0 : 1 [6]`**
 * (`${cols}x${첫행} : ${첫칸+1} [${전체카운트}]`). 그룹이 없으면 빈 문자열.
 * 원본은 cols 를 ctx 에서 읽었다 — 여기서는 인자로 받는다.
 * @see index.html:3410
 * @param {Placement[]} placements
 * @param {string} groupId
 * @param {number} cols
 * @returns {string}
 */
export function placementRangeLabel(placements, groupId, cols) {
  const range = groupRanges(placements, groupId, cols);
  if (!range) return '';
  return `${cols}x${range.first.row} : ${range.first.startIndex + 1} [${range.totalLength}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 생성 — placement 키 순서를 고정하는 유일한 팩토리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 세그먼트 목록 → placement 목록.
 *
 * ⚠⚠ 키 순서를 여기 한 곳에서 고정한다: id, groupId, name, category, [type, routineId],
 *    row, startIndex, length, [subRow]. saveHistory(2864)가 JSON.stringify 문자열 비교로 중복
 *    스냅샷을 거르므로 키 순서가 달라지면 undo 깊이와 프로젝트 파일 바이트가 달라진다.
 *    원본 placeMove(3585-3590)의 순서를 글자 그대로 따랐다.
 *
 * ⚠ type/routineId 는 `meta.type === 'routine'` 일 때만 붙는다. 원본 move/copy/rebuild
 *   (3662·3696·3719)가 `...(meta.type === 'routine' ? { type: 'routine', routineId } : {})` 였다.
 *
 * ⚠ withSubRow:false 는 syncCurrentRoutine(4668-4671)만 쓴다 — 그 경로는 subRow 키를 **아예 넣지 않는다**.
 *   보존해야 하는 결함(FINAL-architecture.md §5 #1). 여기서 `subRow: 0` 을 채우면 루틴 블록이 있는
 *   모든 프로젝트의 JSON 바이트가 달라진다.
 *
 * ⚠ pending 은 **참일 때만** 키가 붙는다(2026-09-12, 받아 적기). 이름 없이 자리부터 잡은 블록에만
 *   생기는 키라 이름 있는 배치의 JSON 바이트는 그대로고, 자리는 category 바로 뒤다 —
 *   루틴 블록은 언제나 이름이 있으므로 type/routineId 와 겹치지 않는다.
 *
 * @see index.html:3585
 * @see index.html:3627
 * @see index.html:3660
 * @see index.html:3694
 * @see index.html:3717
 * @see index.html:4668
 * @param {{row:number,startIndex:number,length:number}[]} segments
 * @param {{ groupId: string, name: string, category: string, pending?: boolean, type?: string, routineId?: string }} meta
 * @param {(() => string) | { uid: () => string }} ids  uid 생성기. 도메인은 uid()를 직접 만들지 않는다
 * @param {{ subRow?: number, withSubRow?: boolean }} [options]
 * @returns {Placement[]}
 */
export function makeSegmentPlacements(segments, meta, ids, options = {}) {
  const { subRow = 0, withSubRow = true } = options;
  const nextId = typeof ids === 'function' ? ids : ids.uid;
  return segments.map(seg => ({
    id: nextId(),
    groupId: meta.groupId,
    name: meta.name,
    category: meta.category,
    ...(meta.pending ? { pending: true } : {}),
    ...(meta.type === 'routine' ? { type: 'routine', routineId: meta.routineId } : {}),
    row: seg.row,
    startIndex: seg.startIndex,
    length: seg.length,
    ...(withSubRow ? { subRow } : {})
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 전수 치환 — 이름/카테고리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 동작 이름 변경 시 같은 이름의 배치를 전부 새 이름으로 바꾼다.
 * `{ ...p, name }` 이라 name 키가 이미 있는 객체의 키 순서는 유지된다.
 * ⚠ 루틴 이름 변경(4686)은 이 함수가 아니다 — 그쪽은 routineId 로 골라 **제자리 변형**한다(domain/routines.js).
 * @see index.html:3191
 * @param {Placement[]} placements
 * @param {string} prevName
 * @param {string} nextName
 * @returns {Placement[]}
 */
export function rewriteMoveName(placements, prevName, nextName) {
  return placements.map(p => p.name === prevName ? { ...p, name: nextName } : p);
}

/**
 * 동작의 카테고리 변경 시 같은 **이름**의 배치를 전부 새 카테고리로 바꾼다.
 * ⚠ 이름 기준이다(원본 3120·3273이 `p.name === move.name`). 같은 이름의 다른 동작이 있으면 함께 바뀐다.
 * @see index.html:3120
 * @see index.html:3273
 * @param {Placement[]} placements
 * @param {string} moveName
 * @param {string} nextCategory
 * @returns {Placement[]}
 */
export function rewriteCategoryKey(placements, moveName, nextCategory) {
  return placements.map(p => p.name === moveName ? { ...p, category: nextCategory } : p);
}

// ─────────────────────────────────────────────────────────────────────────────
// 이름 없는 블록 (2026-09-12, 받아 적기)
//
// 영상을 보며 "지금 뭔가 했다"를 먼저 찍고 이름은 나중에 붙인다. 그 사이 동안 블록은 자리와 길이만
// 가진 채 표 위에 있다. 이름이 비어 있다는 사실을 `pending: true` 로 **명시**한다 — 빈 문자열만으로
// 판정하면 손상된 파일에서 이름이 날아간 배치와 구분되지 않고, 그러면 정규화가 지워야 할지 살려야
// 할지 알 수 없다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이름을 아직 안 붙인 블록인가.
 * @param {Placement} p
 * @returns {boolean}
 */
export function isPending(p) {
  return Boolean(p && p.pending);
}

/**
 * 이름 없는 블록의 groupId 들(등장 순, 중복 제거). 2단계의 "한 곳에서 이름 붙이기"가 읽을 목록이다.
 * @param {Placement[]} placements
 * @returns {string[]}
 */
export function pendingGroupIds(placements) {
  const seen = new Set();
  const out = [];
  for (const p of placements || []) {
    if (!isPending(p) || seen.has(p.groupId)) continue;
    seen.add(p.groupId);
    out.push(p.groupId);
  }
  return out;
}

/**
 * 그 그룹에 이름을 붙인다(pending 키는 사라진다). 이름이 비면 아무것도 하지 않는다 —
 * 지우는 것은 삭제이지 이름 붙이기가 아니다.
 * @param {Placement[]} placements
 * @param {string} groupId
 * @param {string} name
 * @param {string} [category]  주지 않으면 원래 카테고리를 그대로 둔다
 * @returns {Placement[]} 바뀐 것이 없으면 입력 배열을 그대로 돌려준다
 */
export function nameGroup(placements, groupId, name, category) {
  const label = String(name == null ? '' : name).trim();
  if (!label) return placements;
  let touched = false;
  const next = (placements || []).map(p => {
    if (p.groupId !== groupId) return p;
    touched = true;
    const { pending, ...rest } = p;
    return { ...rest, name: label, ...(category ? { category } : {}) };
  });
  return touched ? next : placements;
}
