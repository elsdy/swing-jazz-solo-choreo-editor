// src/domain/keyboardEdit.js — 키보드 편집의 자리 계산 (순수 함수)
//
// 신설 파일이다(2026-10-01, RM-13). 화살표 · Delete · 복사 · 붙여넣기 · 복제가 **어디로** 가는지만 정한다.
// 실제로 옮기고 붙이는 것은 이미 있는 규칙(boardOps.moveGroup · pasteBlock · removeGroup)이다 —
// 끌기와 키보드가 같은 층(겹침) 규칙을 타게 하려고 여기에는 「목표 자리」 계산만 둔다.
//
// 자리는 선형 카운트(grid.linearOf — row 1 의 0카운트가 0, 메인의 intro 행은 음수)로 셈한다.
// 그래서 「한 칸 앞」이 행 끝에서 다음 행 처음으로 자연스럽게 넘어간다.
//
// ⚠ **끌기와 다른 점 하나** — 끌기는 표 끝으로 밀면 길이가 잘리지만(MOVE_POLICY.clamp), 키보드는 잘리기 전에
//   멈춘다. 화살표를 한 번 더 눌렀을 뿐인데 블록이 짧아지면 되돌리기 전까지 알아채기 어렵다.

import { cellOf, firstRowIndex, linearOf, totalCellsFrom } from './grid.js';
import { getGroup, groupCount } from './placements.js';

/** 한 마디의 카운트. Shift+←/→ 가 이만큼 건너뛴다(행의 칸 수와 따로다 — 행이 4칸이어도 한 마디는 8카운트). */
export const BAR_COUNTS = 8;

/**
 * 방향 이름 → 선형 카운트의 차이.
 * ↑/↓ 는 한 **행**(같은 박자 자리의 위아래 마디)이라 행의 칸 수만큼, Shift+←/→ 는 한 마디(8카운트)다.
 * @param {'left'|'right'|'up'|'down'|'barLeft'|'barRight'} dir
 * @param {number} cols
 * @returns {number} 모르는 방향이면 0
 */
export function nudgeDelta(dir, cols) {
  switch (dir) {
    case 'left': return -1;
    case 'right': return 1;
    case 'up': return -cols;
    case 'down': return cols;
    case 'barLeft': return -BAR_COUNTS;
    case 'barRight': return BAR_COUNTS;
    default: return 0;
  }
}

/** 그룹의 시작 선형 카운트. 없으면 null. */
function startOf(board, groupId) {
  const first = getGroup(board.placements, groupId)[0];
  return first ? linearOf(first.row, first.startIndex, board.cols) : null;
}

/** 보드의 첫 칸 · 끝 칸 다음(선형). 메인은 intro 행부터다. */
function bounds(board) {
  return {
    min: linearOf(firstRowIndex(board), 0, board.cols),
    end: linearOf(board.rows, board.cols, board.cols),   // 마지막 칸 다음 — 여기까지 채울 수 있다
  };
}

/**
 * 그룹을 delta 만큼 옮긴 시작 자리. 표 밖이거나 **잘릴 자리면 null**(움직이지 않는다).
 * @param {{rows:number, cols:number, hasIntroRow?:boolean, placements:object[]}} board
 * @param {string} groupId
 * @param {number} delta 선형 카운트의 차이
 * @returns {{row:number, startIndex:number}|null}
 */
export function shiftedStart(board, groupId, delta) {
  const start = startOf(board, groupId);
  if (start === null || !delta) return null;
  const next = start + delta;
  const { min, end } = bounds(board);
  const count = groupCount(board.placements, groupId);
  if (next < min || next + count > end) return null;
  const { row, index } = cellOf(next, board.cols);
  // 위 판정과 같은 말이지만 grid 의 원본 식으로 한 번 더 본다 — 둘이 어긋나면 이동이 길이를 자른다.
  if (totalCellsFrom(row, index, board) < count) return null;
  return { row, startIndex: index };
}

/**
 * 고른 그룹 전부를 같은 거리로 옮길 계획. **하나라도 못 가면 아무것도 옮기지 않는다**(null) —
 * 몇 개만 움직이면 고른 묶음의 간격이 말없이 바뀐다.
 * 차례는 가는 쪽 끝부터다(오른쪽으로 가면 오른쪽 것부터) — 앞의 것이 뒤의 것 자리에 먼저 들어가 층이 흔들리지 않게.
 * @param {object} board
 * @param {string[]} groupIds
 * @param {number} delta
 * @returns {{groupId:string, row:number, startIndex:number}[]|null}
 */
export function planNudge(board, groupIds, delta) {
  const plan = [];
  for (const groupId of groupIds) {
    const to = shiftedStart(board, groupId, delta);
    if (!to) return null;
    plan.push({ groupId, ...to, from: startOf(board, groupId) });
  }
  if (!plan.length) return null;
  plan.sort((a, b) => (delta > 0 ? b.from - a.from : a.from - b.from));
  return plan.map(({ from, ...rest }) => rest);
}

/**
 * 고른 그룹들 가운데 가장 늦게 끝나는 것의 **바로 다음 칸**. 붙여넣기 · 복제가 놓이는 자리다.
 * 표 끝에 닿아 있으면 null.
 * @param {object} board
 * @param {string[]} groupIds
 * @returns {{row:number, startIndex:number}|null}
 */
export function cellAfter(board, groupIds) {
  let last = null;
  for (const groupId of groupIds) {
    const start = startOf(board, groupId);
    if (start === null) continue;
    const endAt = start + groupCount(board.placements, groupId);
    if (last === null || endAt > last) last = endAt;
  }
  if (last === null || last >= bounds(board).end) return null;
  const { row, index } = cellOf(last, board.cols);
  return { row, startIndex: index };
}

/**
 * @typedef {Object} ClipBlock
 * @property {string} name
 * @property {string} category
 * @property {boolean} [pending]
 * @property {string} [type]
 * @property {string} [routineId]
 * @property {number} count   길이(카운트)
 * @property {number} offset  담은 묶음의 첫 블록 시작에서 몇 카운트 뒤인가 — 붙일 때 간격을 지킨다
 */

/**
 * 고른 그룹들을 담는다 — 이름 · 카테고리 · 길이와 서로의 간격. 시작이 이른 차례다.
 * ⚠ 자리(row · startIndex)와 id 는 담지 않는다. 붙일 때 새로 정하고 새로 발급한다.
 * @param {object} board
 * @param {string[]} groupIds
 * @returns {ClipBlock[]}
 */
export function clipOf(board, groupIds) {
  const items = [];
  for (const groupId of groupIds) {
    const first = getGroup(board.placements, groupId)[0];
    if (!first) continue;
    items.push({
      start: linearOf(first.row, first.startIndex, board.cols),
      block: {
        name: first.name,
        category: first.category,
        ...(first.pending ? { pending: true } : {}),
        ...(first.type === 'routine' ? { type: 'routine', routineId: first.routineId } : {}),
        count: groupCount(board.placements, groupId),
      },
    });
  }
  items.sort((a, b) => a.start - b.start);
  const base = items.length ? items[0].start : 0;
  return items.map(({ start, block }) => ({ ...block, offset: start - base }));
}

/**
 * 담은 묶음을 (row, startIndex)부터 붙일 자리들. 표 밖으로 나가는 블록은 빼고(앞쪽은 그대로 붙는다),
 * 첫 블록조차 못 붙으면 빈 배열.
 * @param {object} board
 * @param {ClipBlock[]} clip
 * @param {{row:number, startIndex:number}} at
 * @returns {{block:ClipBlock, row:number, startIndex:number}[]}
 */
export function pastePlan(board, clip, at) {
  if (!Array.isArray(clip) || !at) return [];
  const base = linearOf(at.row, at.startIndex, board.cols);
  const { min, end } = bounds(board);
  const out = [];
  for (const block of clip) {
    const n = base + (block.offset || 0);
    if (n < min || n >= end) continue;
    const { row, index } = cellOf(n, board.cols);
    out.push({ block, row, startIndex: index });
  }
  return out;
}

/**
 * 보드 위의 그룹 id 전부(처음 나온 차례). 모두 고르기가 쓴다.
 * @param {object} board
 * @returns {string[]}
 */
export function allGroupIds(board) {
  return [...new Set(board.placements.map(p => p.groupId))];
}
