// src/domain/selection.js — 고르기 규칙 (순수 함수, RM-14 · 2026-11-02)
//
// 안무표에서 「무엇이 골라지나」만 정한다 — 범위(Shift+클릭) · 네모(빈 칸 끌기) · 클릭의 뜻 · 사라진 블록 걸러 내기.
// 상태(store.selection · selectionAnchor)를 바꾸는 것은 usecases/boardCommands 의 몫이고, 화면의 점선 네모는 ui/overlays 가 그린다.
//
// ⚠ 판정은 **그룹 단위**다(원칙 D-2). 여러 행에 걸친 블록은 한 조각만 닿아도 그룹 id 하나로 들어가고, 아래층(subRow>0)의 블록도
//   같은 자리면 함께 들어간다 — 한 블록의 조각만 골라져 묶음 이동이 블록을 쪼개는 일을 막는다.
// ⚠ 시간 순서는 선형 카운트(grid.linearOf — row 1 의 0카운트가 0, 메인의 intro 행은 음수)로 센다(keyboardEdit 과 같은 축).

import { linearOf } from './grid.js';
import { getGroup, groupCount, groupsOf } from './placements.js';
import { planNudge } from './keyboardEdit.js';

/**
 * @typedef {Object} CellRect  행 · 칸 범위(양끝 포함). gestureMath.rectCellRange 가 만든다.
 * @property {number} rowFrom
 * @property {number} rowTo
 * @property {number} colFrom
 * @property {number} colTo
 */

/**
 * 그룹이 덮는 선형 카운트 구간 `[start, end)`. 없으면 null.
 * @param {{cols:number, placements:object[]}} board
 * @param {string} groupId
 * @returns {{start:number, end:number}|null}
 */
// @complexity time=O(p) space=O(p) cc=2
export function groupSpan(board, groupId) {
  const first = getGroup(board.placements, groupId)[0];
  if (!first) return null;
  const start = linearOf(first.row, first.startIndex, board.cols);
  return { start, end: start + groupCount(board.placements, groupId) };
}

/**
 * 앵커 블록부터 누른 블록까지 **시간 순서로 사이에 있는** 그룹 전부. 두 블록이 덮는 구간을 합친 범위에 조금이라도 겹치는
 * 그룹은 층과 행을 가리지 않고 통째로 들어간다. 앞 · 뒤 어느 쪽을 눌러도 같은 답이다.
 * 앵커나 누른 블록이 없으면 있는 쪽 하나만(둘 다 없으면 빈 배열).
 * @param {{cols:number, placements:object[]}} board
 * @param {string|null} anchorId
 * @param {string} targetId
 * @returns {string[]} 시작이 이른 차례
 */
// @complexity time=O(p) space=O(g) cc=7
export function rangeBetween(board, anchorId, targetId) {
  const a = anchorId ? groupSpan(board, anchorId) : null;
  const t = groupSpan(board, targetId);
  if (!a && !t) return [];
  if (!a) return [targetId];
  if (!t) return [anchorId];
  const from = Math.min(a.start, t.start);
  const to = Math.max(a.end, t.end);
  return sortByStart(board, [...groupsOf(board.placements).keys()].filter((groupId) => {
    const s = groupSpan(board, groupId);
    return s && s.start < to && s.end > from;
  }));
}

/**
 * 네모(행 · 칸 범위)에 **한 조각이라도** 닿는 그룹 전부. 행을 넘은 네모도 된다.
 * @param {{placements:object[]}} board
 * @param {CellRect} rect
 * @returns {string[]} 시작이 이른 차례
 */
// @complexity time=O(p) space=O(g) cc=4
export function groupsInRect(board, rect) {
  if (!rect) return [];
  const hit = new Set();
  for (const p of board.placements) {
    if (p.row < rect.rowFrom || p.row > rect.rowTo) continue;
    if (p.startIndex > rect.colTo || p.startIndex + p.length - 1 < rect.colFrom) continue;
    hit.add(p.groupId);
  }
  return sortByStart(board, [...hit]);
}

/**
 * 클릭 한 번의 뜻(Q84 — 편집기 관습). 돌려주는 것은 다음 선택 집합과 앵커다.
 *   'only'   그냥 클릭      — 그것만 고른다
 *   'toggle' Ctrl/Cmd+클릭  — 더하기/빼기
 *   'range'  Shift+클릭     — 앵커부터 누른 블록까지를 지금 고른 것에 더한다
 * 셋 다 누른 블록이 새 앵커다.
 * @param {{cols:number, placements:object[]}} board
 * @param {{selection:Set<string>, anchor:string|null}} current
 * @param {string} groupId
 * @param {'only'|'toggle'|'range'} mode
 * @returns {{selection:Set<string>, anchor:string}}
 */
// @complexity time=O(p) space=O(g) cc=4
export function selectionAfterClick(board, current, groupId, mode) {
  if (mode === 'toggle') {
    const next = new Set(current.selection);
    if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
    return { selection: next, anchor: groupId };
  }
  if (mode === 'range') {
    const next = new Set(current.selection);
    for (const id of rangeBetween(board, current.anchor, groupId)) next.add(id);
    return { selection: next, anchor: groupId };
  }
  return { selection: new Set([groupId]), anchor: groupId };
}

/**
 * 보드에 **아직 있는** 그룹만 남긴다 — 블록을 바꾸는 길(지우기 · 되돌리기 · 불러오기) 뒤에 선택이 유령을 가리키지 않게.
 * @param {{placements:object[]}} board
 * @param {Iterable<string>} ids
 * @returns {string[]} 들어온 차례 그대로
 */
// @complexity time=O(p+k) space=O(g) cc=1
export function presentOnly(board, ids) {
  const present = new Set(board.placements.map(p => p.groupId));
  return [...ids].filter(id => present.has(id));
}

/**
 * 묶음 끌기(RM-14 · 손가락은 RM-48)의 거리와 놓일 자리 — 끄는 블록의 시작에서 놓을 칸까지의 선형 카운트 차이(delta)만큼
 * 묶음 전체를 옮기는 계획이다. 옮기기 자체는 화살표와 같은 planNudge 규칙(하나라도 못 가면 아무것도 안 옮김)을 따른다.
 * 마우스 몸통 끌기(input/boardController)와 손가락 끌기(input/touchDrag)가 같은 셈을 쓰도록 여기 한 자리에 둔다 —
 * 두 input 모듈은 서로 import 하지 않는다.
 * @param {{cols:number, placements:object[]}} board
 * @param {string} groupId  끄는 블록
 * @param {Iterable<string>} bundle  함께 갈 그룹들(끄는 블록 포함)
 * @param {number} row  놓을 시작 행(잡은 칸을 뺀 자리, RM-57)
 * @param {number} startIndex
 * @returns {{delta:number, steps:{groupId:string, row:number, startIndex:number, count:number}[]|null, label:string|null}|null}
 *          끄는 블록이 사라졌으면 null, 하나라도 못 가면 steps 가 null. label 은 미리보기 첫 조각에 적는 「N개 함께」
 */
// @complexity time=O(k·p) space=O(k+p) cc=3
export function bundleDragPlan(board, groupId, bundle, row, startIndex) {
  const span = groupSpan(board, groupId);
  if (!span) return null;
  const delta = linearOf(row, startIndex, board.cols) - span.start;
  const plan = planNudge(board, presentOnly(board, bundle), delta);
  if (!plan) return { delta, steps: null, label: null };
  const steps = plan.map(s => ({ ...s, count: groupCount(board.placements, s.groupId) }));
  return { delta, steps, label: `${steps.length}개 함께` };
}

/**
 * 앵커가 아직 보드에 있으면 그대로, 없으면 null.
 * @param {{placements:object[]}} board
 * @param {string|null} anchor
 * @returns {string|null}
 */
// @complexity time=O(p) space=O(1) cc=2
export function presentAnchor(board, anchor) {
  return anchor && board.placements.some(p => p.groupId === anchor) ? anchor : null;
}

/** 시작이 이른 차례로. 시작이 같으면 들어온 차례. */
// @complexity time=O(g log g · p) space=O(g) cc=1
function sortByStart(board, ids) {
  return ids
    .map((id, i) => ({ id, i, start: (groupSpan(board, id) || { start: 0 }).start }))
    .sort((x, y) => x.start - y.start || x.i - y.i)
    .map(x => x.id);
}
