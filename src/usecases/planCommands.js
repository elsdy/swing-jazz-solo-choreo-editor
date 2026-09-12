// src/usecases/planCommands.js — LLM 이 만든 안무 계획을 메인 보드에 놓는다 (usecases 계층)
//
// 신설 파일이다. 서버가 돌려준 플랜(server.py PLAN_SCHEMA)을 domain/choreoPlan.normalizePlan 으로 격자 항목으로
// 바꾼 뒤, 기존 배치 경로(paletteCommands.createAndPlace = 빠른 동작 생성과 같은 길)로 하나씩 놓는다.
// 새 경로를 만들지 않는 이유: 겹침 규칙·subRow 스택·클램프가 전부 boardOps.place 한 곳에 있고, 거기를 통과해야
// 손으로 놓은 것과 같은 결과가 된다.
//
// ⚠ DOM 도 서버도 모른다. LLM 호출은 어댑터(app/main 이 주입)가 하고, 여기는 이미 받은 플랜만 다룬다.
// ⚠ 히스토리는 호출부가 한 번 커밋한다 — 항목마다 커밋하면 Undo 가 동작 수만큼 쌓인다.

import { NONE, mergeDirty, BOARD_MAIN, boardOf } from './store.js';
import { normalizePlan } from '../domain/choreoPlan.js';
import { createAndPlace } from './paletteCommands.js';
import { setBoardRows } from './boardCommands.js';

/**
 * 플랜을 지금 보드 기준으로 미리 본다(놓지 않는다). 뷰가 표를 그리는 데 쓴다.
 * @param {object} store
 * @param {object} plan 서버가 준 플랜
 * @returns {ReturnType<typeof normalizePlan>}
 */
export function previewPlan(store, plan) {
  const state = store.get();
  const board = boardOf(state, BOARD_MAIN);
  return normalizePlan(plan, { cols: board.cols, rows: board.rows, library: state.library, categories: state.categories });
}

/**
 * 플랜을 메인 보드에 놓는다.
 *
 * - `mode:'replace'` 는 배치만 비우고 놓는다(링크·영상·템포는 건드리지 않는다 — `전체 초기화` 와 다르다).
 * - 행이 모자라면 늘린다(setBoardRows). 줄이지는 않는다.
 * - 목록에 없는 동작은 createAndPlace 가 만든다(카테고리는 normalizePlan 이 골라 둔 것).
 *
 * @param {{store:object, ids:object, dialogs?:object, storage?:object}} ctx paletteCommands 의 PaletteCtx 와 같다
 * @param {object} plan
 * @param {{mode?: 'append'|'replace'}} [args]
 * @returns {import('./store.js').Dirty & {placed?: number, skipped?: number}}
 */
export function applyPlan(ctx, plan, args = {}) {
  const { store } = ctx;
  const normalized = previewPlan(store, plan);
  if (normalized.items.length === 0) return NONE;

  let dirty = NONE;
  const board = boardOf(store.get(), BOARD_MAIN);

  if (args.mode === 'replace' && board.placements.length) {
    const rows = board.placements.map(p => p.row);
    store.setBoard(BOARD_MAIN, { placements: [] });
    dirty = mergeDirty(dirty, { boards: { [BOARD_MAIN]: { rows } } });
  }
  if (normalized.rowsNeeded > board.rows) {
    dirty = mergeDirty(dirty, setBoardRows(store, { boardId: BOARD_MAIN, rows: normalized.rowsNeeded }));
  }

  let placed = 0;
  let skipped = 0;
  for (const item of normalized.items) {
    const d = createAndPlace(ctx, BOARD_MAIN, item.name, item.category, item.row, item.index, item.length);
    if (d && d !== NONE) dirty = mergeDirty(dirty, d);       // 새 동작만 만들어졌어도 팔레트는 다시 그려야 한다
    if (d && d.boards) placed++; else skipped++;
  }
  return { ...dirty, placed, skipped };
}
