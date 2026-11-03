// src/domain/pendingQueue.js — `?` 정리함의 줄과 되풀이 무리 (domain 계층, RM-24 · 2026-11-03)
//
// 받아 적기로 쌓인 이름 없는 블록(`?`)을 **표 위 차례**(행 → 칸)로 세운 목록과, 그 목록에서 「아까 그것」
// — 길이와 마디 안 시작 칸이 같은 `?` — 을 묶는 규칙이다. 화면(ui/pendingTray)과 명령(usecases/pendingTrayCommands)이
// 같은 줄을 읽는다.
//
// ⚠ 차례 규칙은 `placements.adjacentPendingGroupId`(RM-15 의 Tab) 와 같다 — 그룹은 **첫 조각**(가장 앞의 row → startIndex)
//   으로 줄 세우고, 마디에 걸친 그룹도 한 번만 나온다. 저장 차례(`pendingGroupIds`)를 쓰지 않는다 — 옮기거나 붙여넣거나
//   마커를 블록으로 바꾸면 저장 차례와 표 위 차례가 어긋난다.
// ⚠ 「같은 모양」은 길이와 **마디 안** 시작 칸만 본다. 같은 동작이란 보장은 없다 — 결정(Q82)이 「말없이 전부 붙이고,
//   틀리면 되돌리기 한 번」을 골랐다.

import { isPending } from './placements.js';
import { linearOf } from './grid.js';

/**
 * @typedef {Object} PendingRow
 * @property {string} groupId
 * @property {number} row         첫 조각의 행(0 = intro)
 * @property {number} startIndex  첫 조각의 칸(0부터)
 * @property {number} count       길이(카운트) — 조각 길이의 합
 * @property {number} fromCount   선형 카운트(포함) — domain/grid.linearOf
 * @property {number} toCount     선형 카운트(배타)
 * @property {string} place       화면의 자리 — `8x3·1`(행 라벨 · 1부터 센 칸), intro 는 `intro·1`
 * @property {string} key         되풀이 무리의 열쇠 — `시작 칸:길이`
 */

/**
 * 행 라벨. 보드 · 연습 줄과 같은 꼴이다(intro / `8x3`).
 * @param {number} row
 * @param {number} cols
 */
const rowLabel = (row, cols) => (row === 0 ? 'intro' : `${cols}x${row}`);

/**
 * 이름 없는 블록을 표 위 차례로 세운 줄 — 그룹마다 한 줄, 자리 · 길이와 함께.
 * @param {import('./placements.js').Placement[]} placements
 * @param {number} cols 한 마디의 칸 수
 * @returns {PendingRow[]}
 */
// @complexity time=O(n log n) space=O(n) cc=8
export function pendingQueue(placements, cols) {
  const groups = new Map();                      // groupId → { first, count }
  for (const p of placements || []) {
    if (!isPending(p)) continue;
    const g = groups.get(p.groupId);
    if (!g) { groups.set(p.groupId, { first: p, count: p.length }); continue; }
    g.count += p.length;
    if (p.row < g.first.row || (p.row === g.first.row && p.startIndex < g.first.startIndex)) g.first = p;
  }
  const rows = [...groups.values()].map(({ first, count }) => {
    const fromCount = linearOf(first.row, first.startIndex, cols);
    return {
      groupId: first.groupId,
      row: first.row,
      startIndex: first.startIndex,
      count,
      fromCount,
      toCount: fromCount + count,
      place: `${rowLabel(first.row, cols)}·${first.startIndex + 1}`,
      key: `${first.startIndex}:${count}`
    };
  });
  return rows.sort((a, b) => a.row - b.row || a.startIndex - b.startIndex);
}

/**
 * 되풀이 무리 — 길이와 마디 안 시작 칸이 같은 줄끼리. 무리마다 groupId 를 줄 차례로 담고, 무리는 머리(첫 줄)의 차례로 선다.
 * 혼자인 줄도 한 사람짜리 무리로 나온다.
 * @param {PendingRow[]} queue pendingQueue 의 결과
 * @returns {string[][]}
 */
// @complexity time=O(n) space=O(n) cc=3
export function pendingRepeatGroups(queue) {
  const byKey = new Map();
  for (const r of queue || []) {
    const list = byKey.get(r.key);
    if (list) list.push(r.groupId);
    else byKey.set(r.key, [r.groupId]);
  }
  return [...byKey.values()];
}

/**
 * 그 줄과 같은 무리의 **다른** groupId 들(줄 차례). 무리가 없으면 빈 배열.
 * @param {PendingRow[]} queue
 * @param {string} groupId
 * @returns {string[]}
 */
// @complexity time=O(n) space=O(n) cc=3
export function repeatsOf(queue, groupId) {
  const me = (queue || []).find(r => r.groupId === groupId);
  if (!me) return [];
  return queue.filter(r => r.key === me.key && r.groupId !== groupId).map(r => r.groupId);
}

/**
 * 반복할 카운트 구간 — 블록의 구간에 앞뒤 한 카운트씩 여유를 둔다. 앞 여유는 **0 아래로 내려가지 않는다**(곡의 1카운트
 * 앞은 대개 영상에 없는 자리다). 블록이 이미 intro(음수 카운트)에 있으면 그 시작에서 멈춘다.
 * @param {{fromCount:number, toCount:number}} row
 * @returns {{fromCount:number, toCount:number}}
 */
// @complexity time=O(1) space=O(1) cc=1
export function paddedRange(row) {
  return { fromCount: Math.max(row.fromCount - 1, Math.min(row.fromCount, 0)), toCount: row.toCount + 1 };
}
