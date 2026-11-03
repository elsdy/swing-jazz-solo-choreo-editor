// src/usecases/partCommands.js — 파트(섹션)를 긋고 · 고치고 · 옮기고 · 한 번 더 놓는다 (usecases 계층, 2026-11-03 RM-23)
//
// 상태는 `state.parts`(파트 목록 — UNDO_FIELDS · DOC_FIELDS 의 11번째)와 `state.session.partFolds`(접힌 파트의 시작 마디 —
// 화면의 일이라 저장하지도 되돌리지도 않는다) 둘이다. 규칙(정규화 · 범위 밀기 · 접힌 행)은 domain/parts 가,
// 블록을 마디째 옮기는 일은 domain/boardOps(permuteRows · duplicateRowRange)가 한다.
//
// ⚠ 옮기기 · 한 번 더는 **블록과 파트를 한 번에** 바꾼다 — 둘을 따로 커밋하면 Undo 한 번 뒤에 파트만 엉뚱한 곳에
//   남는다(계획서 「조심할 것」). 히스토리 커밋은 이 계층의 공통 규약대로 호출부(app/main)가 한 번 한다.
// ⚠ 이름 · 색 · 긋기 · 지우기는 블록을 건드리지 않는다 — Dirty 는 `{parts:true}` 뿐이고 행을 다시 그리지 않는다
//   (ui/boardView.syncParts 가 dataset 과 CSS 변수만 입힌다 — 프레이즈와 같은 결).

import * as boardOps from '../domain/boardOps.js';
import {
  normalizePart, normalizeParts, partAt, partMoveTarget, splitsPart, rowOrderAfterMove, remapParts,
  partsAfterRepeat, pruneFolds, PART_COLORS
} from '../domain/parts.js';
import { BOARD_MAIN, NONE, boardOf, notice } from './store.js';

/** 블록을 건드리지 않는 파트 변경의 Dirty. */
const PARTS = Object.freeze({ parts: true });

/**
 * 지금의 파트 목록(정규화된 것 — 시작 순 · 겹침 없음). 메인 보드의 마지막 마디 밖은 잘린다.
 * @param {object} store
 * @returns {import('../domain/parts.js').Part[]}
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function partsState(store) {
  return normalizeParts(store.get().parts, { rows: boardOf(store.get(), BOARD_MAIN).rows });
}

/**
 * 이 마디가 든 파트. 없으면 null.
 * @param {object} store
 * @param {number} row
 * @returns {import('../domain/parts.js').Part|null}
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function partOf(store, row) {
  return partAt(partsState(store), row);
}

/** 접힌 파트의 시작 마디들(지금 있는 파트만). */
// @complexity time=O(n+f) space=O(f) cc=1
export function foldedStarts(store) {
  return pruneFolds(store.get().session.partFolds || new Set(), partsState(store));
}

/**
 * 새 파트의 기본값 — 시작 마디부터 다음 파트 앞(또는 넉 마디 · 끝 마디)까지, 색은 아직 안 쓴 첫 색.
 * 팝업이 칸을 미리 채우는 데 쓴다.
 * @param {object} store
 * @param {number} row 시작 마디
 * @returns {{ startRow:number, endRow:number, color:string, maxEnd:number }|null} 그 마디가 이미 파트 안이면 null
 */
// @complexity time=O(n log n) space=O(n) cc=4
export function draftPart(store, row) {
  const parts = partsState(store);
  const rows = boardOf(store.get(), BOARD_MAIN).rows;
  if (!(row >= 1 && row <= rows) || partAt(parts, row)) return null;
  const next = parts.find(p => p.startRow > row);
  const maxEnd = next ? next.startRow - 1 : rows;
  const used = new Set(parts.map(p => p.color));
  const color = PART_COLORS.find(c => !used.has(c)) || PART_COLORS[parts.length % PART_COLORS.length];
  return { startRow: row, endRow: Math.min(maxEnd, row + 3), color, maxEnd };
}

/**
 * 이 파트의 끝 마디가 갈 수 있는 끝 — 다음 파트 앞, 없으면 마지막 마디. 고치기 팝업의 `끝 마디` 칸이 쓴다.
 * @param {object} store
 * @param {{ startRow:number }} part
 * @returns {number}
 */
// @complexity time=O(n log n) space=O(n) cc=2
export function partMaxEnd(store, part) {
  const next = partsState(store).find(p => p.startRow > part.startRow);
  return next ? next.startRow - 1 : boardOf(store.get(), BOARD_MAIN).rows;
}

/** 파트 목록을 쓰고 접힘 집합을 맞춘다. */
// @complexity time=O(n+f) space=O(n) cc=2
function writeParts(store, parts, folds) {
  const next = folds || pruneFolds(store.get().session.partFolds || new Set(), parts);
  store.update({ parts });
  if (next !== store.get().session.partFolds) store.patch('session', { partFolds: next });
}

/**
 * 파트를 긋는다. 이름이 비었거나 구간이 틀렸거나 다른 파트와 겹치면 알림만.
 * @param {object} store
 * @param {{ name:string, startRow:number, endRow:number, color?:string }} args
 * @returns {object} Dirty
 */
// @complexity time=O(n log n) space=O(n) cc=5
export function addPart(store, args) {
  const parts = partsState(store);
  const rows = boardOf(store.get(), BOARD_MAIN).rows;
  const part = normalizePart(args, parts.length);
  if (!part) return { notify: notice('status', '파트 이름과 마디 구간을 적어 주세요.') };
  if (part.endRow > rows) return { notify: notice('status', `안무표는 ${rows}마디까지입니다.`) };
  const clash = parts.find(p => part.startRow <= p.endRow && part.endRow >= p.startRow);
  if (clash) return { notify: notice('status', `「${clash.name}」 파트(${clash.startRow}~${clash.endRow}마디)와 겹칩니다 — 파트끼리는 겹치지 않습니다.`) };
  writeParts(store, normalizeParts([...parts, part]));
  return PARTS;
}

/**
 * 파트의 이름 · 색 · 끝 마디를 바꾼다. 끝 마디를 늘려 다음 파트와 겹치면 알림만.
 * @param {object} store
 * @param {{ startRow:number, name?:string, color?:string, endRow?:number }} args
 * @returns {object} Dirty
 */
// @complexity time=O(n log n) space=O(n) cc=6
export function updatePart(store, args) {
  const parts = partsState(store);
  const i = parts.findIndex(p => p.startRow === args.startRow);
  if (i < 0) return NONE;
  const cur = parts[i];
  const next = normalizePart({
    name: args.name ?? cur.name, startRow: cur.startRow, endRow: args.endRow ?? cur.endRow, color: args.color ?? cur.color
  }, i);
  if (!next) return { notify: notice('status', '파트 이름은 비울 수 없습니다.') };
  const rows = boardOf(store.get(), BOARD_MAIN).rows;
  const after = parts[i + 1];
  if (next.endRow > rows || (after && next.endRow >= after.startRow)) {
    return { notify: notice('status', '다음 파트와 겹치게 늘릴 수 없습니다.') };
  }
  if (next.name === cur.name && next.color === cur.color && next.endRow === cur.endRow) return NONE;
  writeParts(store, parts.map((p, k) => (k === i ? next : p)));
  return PARTS;
}

/**
 * 파트를 지운다 — **이름표만** 떼고 마디와 블록은 그대로 둔다.
 * @param {object} store
 * @param {{ startRow:number }} args
 * @returns {object} Dirty
 */
// @complexity time=O(n log n) space=O(n) cc=2
export function removePart(store, args) {
  const parts = partsState(store);
  if (!parts.some(p => p.startRow === args.startRow)) return NONE;
  writeParts(store, parts.filter(p => p.startRow !== args.startRow));
  return PARTS;
}

/**
 * 파트를 접고 편다(화면의 일 — 저장 · 되돌리기에 들지 않는다). 접힌 파트는 첫 마디 한 줄의 요약이 된다.
 * @param {object} store
 * @param {{ startRow:number, folded?:boolean }} args  folded 를 주면 그 값으로, 없으면 반전
 * @returns {object} Dirty
 */
// @complexity time=O(n log n) space=O(f) cc=4
export function togglePartFold(store, args) {
  const part = partsState(store).find(p => p.startRow === args.startRow);
  if (!part) return NONE;
  const cur = foldedStarts(store);
  const want = typeof args.folded === 'boolean' ? args.folded : !cur.has(part.startRow);
  if (want === cur.has(part.startRow)) return NONE;
  const next = new Set(cur);
  if (want) next.add(part.startRow); else next.delete(part.startRow);
  store.patch('session', { partFolds: next });
  return PARTS;
}

/**
 * 파트를 통째로 옮긴다 — 위(-1)는 앞 칸(앞 파트가 있으면 그 파트 통째) 앞으로, 아래(+1)는 뒤 칸 뒤로.
 * 안의 블록이 함께 가고 다른 파트의 범위도 새 차례를 따른다. 한 번 누름이 되돌리기 한 단계다(커밋은 호출부).
 * @param {object} store
 * @param {{ startRow:number, dir:-1|1 }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
// @complexity time=O(n log n + r) space=O(n+r) cc=6
export function movePart(store, args, deps = {}) {
  const parts = partsState(store);
  const part = parts.find(p => p.startRow === args.startRow);
  if (!part) return NONE;
  const board = boardOf(store.get(), BOARD_MAIN);
  const before = partMoveTarget(parts, part, args.dir, board.rows);
  if (before === null || splitsPart(parts, before)) {
    return { notify: notice('status', args.dir < 0 ? '맨 위 파트라 더 올리지 않았습니다.' : '맨 아래 파트라 더 내리지 않았습니다.') };
  }
  const rowMap = rowOrderAfterMove(board.rows, part.startRow, part.endRow, before);
  if (!rowMap) return NONE;
  const result = boardOps.permuteRows(board, { rowMap }, deps.ids);
  if (result.renderRows !== null) store.setBoard(BOARD_MAIN, { placements: result.placements });
  const folds = new Set([...foldedStarts(store)].map(r => rowMap.get(r) ?? r));
  writeParts(store, remapParts(parts, rowMap), folds);
  return { boards: { [BOARD_MAIN]: { rows: 'all' } }, parts: true };
}

/**
 * 「한 번 더」 — 파트의 마디와 블록을 바로 뒤에 **독립된 한 벌**로 놓고 같은 이름 · 같은 색의 파트를 긋는다.
 * 사본의 블록은 새 그룹 번호라 한쪽을 고쳐도 다른 쪽은 그대로다. 뒤의 블록 · 파트는 그만큼 밀린다.
 * @param {object} store
 * @param {{ startRow:number }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object} Dirty
 */
// @complexity time=O(n log n) space=O(n) cc=3
export function repeatPart(store, args, deps = {}) {
  const parts = partsState(store);
  const part = parts.find(p => p.startRow === args.startRow);
  if (!part) return NONE;
  const board = boardOf(store.get(), BOARD_MAIN);
  const result = boardOps.duplicateRowRange(board, { from: part.startRow, to: part.endRow }, deps.ids);
  if (result.renderRows === null) return NONE;
  store.setBoard(BOARD_MAIN, { rows: result.rows, placements: result.placements });
  const n = part.endRow - part.startRow + 1;
  const folds = new Set([...foldedStarts(store)].map(r => (r > part.endRow ? r + n : r)));
  writeParts(store, partsAfterRepeat(parts, part).parts, folds);
  return { layout: true, toolbar: true, boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } }, parts: true };
}
