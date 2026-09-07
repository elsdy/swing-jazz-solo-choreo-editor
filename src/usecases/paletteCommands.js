// src/usecases/paletteCommands.js — 동작 CRUD · 즐겨찾기 · 검색/정렬 · 활성 동작 (usecases 계층)
//
// 원본 index.html 의 addCustomMove(3990-3998) · renameMove(3183-3196) · deleteMove(3198-3208) ·
// buildCard 의 카드 클릭/select/×/★ 핸들러(3067-3072·3120-3126·3134-3145·3147-3159) ·
// openMoveContextMenu 의 카테고리 변경(3265-3281) · bindControls 의 검색·정렬 버튼(2304-2325) ·
// cancelActivePaletteMove(2814-2818) · createAndPlaceQuickMove(2229-2241, 루틴판 5029-5035) 를 옮겼다.
// DOM 접근과 render*() 호출은 전부 걷어내고 Dirty 를 돌려준다. prompt/alert 는 주입받은 Dialogs 로만 한다.

import {
  NONE, mergeDirty, boardOf, BOARD_MAIN
} from './store.js';
import * as Moves from '../domain/moves.js';
import * as BoardOps from '../domain/boardOps.js';

// ─────────────────────────────────────────────────────────────────────────────
// 호출 규약
//
//   모든 커맨드는 `(ctx, …args) => Dirty` 다. ctx 는 app/main 이 조립해 주는 협력자 묶음이고
//   커맨드는 ctx 밖의 어떤 전역도 만지지 않는다.
//
//   ⚠ **히스토리 커밋은 여기서 하지 않는다.** 원본이 saveHistory() 를 부르던 자리를 각 함수의
//     JSDoc 에 `[history] …` 로 표시해 두었으니, 호출부(input/controls·ui/paletteView)가
//     커맨드 직후에 주입받은 history.commit('main') 을 불러야 한다. 표시가 없으면 커밋하지 않는다
//     (예: 즐겨찾기·검색·정렬·활성화는 원본도 히스토리를 쌓지 않는다).
//
//   ⚠ 즐겨찾기 키는 **동작 id 가 아니라 이름**이다(원본 1411·3061-3062·3149).
//     "이름을 바꾸면 즐겨찾기가 풀린다"는 관찰 동작이 여기서 나오므로 시그니처를 moveId 로 바꾸지 말 것.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PaletteCtx
 * @property {ReturnType<import('./store.js').createStore>} store
 * @property {import('../ports/env.js').Dialogs} dialogs  promptText/alert 만 쓴다
 * @property {(()=>string)|{uid:()=>string}} ids  uid 생성기(adapters/browser.browserEnv)
 * @property {{ saveFavorites?: (fav:{moveNames:string[],categories:string[]}) => unknown }} [storage]
 *   ⚠ 원본 saveFavorites(4227-4230)는 choreo_fav_moves 와 choreo_fav_cats **두 키를 함께** 쓴다.
 *   그래서 어댑터에도 두 키를 함께 쓰는 함수 하나로 넘긴다. 없으면 저장을 건너뛴다(테스트·골든용).
 */

/** 팔레트 정렬 모드 3종(PR #17 이 'category' 를 추가했다). 원본은 검증 없이 대입만 한다(2316·2321·2326). */
const SORT_MODES = ['alpha', 'added', 'category'];

/**
 * 즐겨찾기 2종(동작 이름 · 카테고리)을 한꺼번에 저장한다. 원본 saveFavorites(4227-4230) 그대로 —
 * 동작 즐겨찾기만 바뀌어도 카테고리 즐겨찾기 키까지 다시 쓴다.
 * @see index.html:4227
 * @param {PaletteCtx} ctx
 */
function persistFavorites(ctx) {
  const fav = ctx.store.get().favorites;
  ctx.storage?.saveFavorites?.({ moveNames: [...fav.moveNames], categories: [...fav.categories] });
}

// ─────────────────────────────────────────────────────────────────────────────
// 동작 CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 새 동작을 라이브러리 맨 뒤에 추가한다. [history] 원본은 뒤이어 saveHistory() 를 부른다(3997).
 *
 * ⚠ 원본은 `#newMoveName` 의 값을 `.value.trim()` 으로 읽는다(3991). 호출부가 trim 을 잊어도
 *   같은 결과가 나오도록 여기서 한 번 더 trim 한다(이미 trim 된 문자열에는 무해).
 * ⚠ 입력창 비우기(`newMoveName.value = ''`, 3995)는 UI 몫이다 — 성공했을 때만 비운다.
 * @see index.html:3990
 * @param {PaletteCtx} ctx
 * @param {string} rawName `#newMoveName` 의 값
 * @param {string} category `#newMoveCategory` 의 값
 * @returns {import('./store.js').Dirty}
 */
export function addMove(ctx, rawName, category) {
  const name = String(rawName ?? '').trim();
  if (!name) {                                                  // 3993
    ctx.dialogs.alert('동작 이름을 입력해 주세요.');
    return NONE;
  }
  const state = ctx.store.get();
  ctx.store.update({ library: Moves.addMove(state.library, name, category, ctx.ids) });   // 3994
  return { palette: true };                                     // 3996
}

/**
 * 동작 이름 변경. 같은 이름의 **메인 보드 배치**도 전부 새 이름으로 바뀐다.
 * [history] 원본은 뒤이어 saveHistory() 를 부른다(3195).
 *
 * ⚠ 렌더 범위는 `renderBoard(true)`(3194) — 골격 재생성 + 전 행이다. moves.renameMove 가 함께
 *   돌려주는 affectedRows 를 렌더에 쓰면 동작이 바뀐다(브리프의 STAGE1 계약 경고).
 * ⚠ **루틴 보드(reState.placements)와 루틴 정의(routine.placements)의 이름은 바뀌지 않는다.**
 *   원본 3191 이 state.placements 만 훑기 때문이다 — 보존 대상 결함(deviations-found.jsonl 참조).
 *   그래서 Dirty 에 boards.routine 을 넣지 않는다.
 * @see index.html:3183
 * @param {PaletteCtx} ctx
 * @param {string} moveId
 * @returns {import('./store.js').Dirty}
 */
export function renameMove(ctx, moveId) {
  const state = ctx.store.get();
  const move = state.library.find(m => m.id === moveId);
  if (!move) return NONE;                                       // 3184-3185
  const next = ctx.dialogs.promptText('동작 이름 변경', move.name);   // 3186
  if (next == null) return NONE;                                // 3187: 취소
  const board = boardOf(state, BOARD_MAIN);
  const res = Moves.renameMove(state.library, board.placements, moveId, next);
  if (!res.ok) {
    if (res.reason === 'empty-name') ctx.dialogs.alert('이름을 비워둘 수 없습니다.');   // 3189
    return NONE;
  }
  ctx.store.update({ library: res.moveLibrary });                // 3190
  ctx.store.setBoard(BOARD_MAIN, { placements: res.placements });// 3191
  return { palette: true, boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } } };   // 3193-3194
}

/**
 * 동작 삭제. 같은 **이름**의 메인 보드 배치도 전부 사라진다.
 * [history] 원본은 뒤이어 saveHistory() 를 부른다(3207).
 *
 * 원본의 두 경로가 도메인·렌더 범위까지 완전히 같아 하나로 합쳤다:
 *   카드 × 버튼(3134-3145, confirmOnce 안) / 컨텍스트 메뉴 deleteMove(3198-3208, confirmOnce 안).
 * ⚠ 유일한 차이인 closeMoveContextMenu()(3204)는 UI 몫이다.
 * ⚠ affectedRows 는 **삭제 전에** 계산되고 중복을 제거하지 않는다(원본 3136·3201 그대로).
 * @see index.html:3198
 * @param {PaletteCtx} ctx
 * @param {string} moveId
 * @returns {import('./store.js').Dirty}
 */
export function deleteMove(ctx, moveId) {
  const state = ctx.store.get();
  const board = boardOf(state, BOARD_MAIN);
  const res = Moves.removeMove(state.library, board.placements, moveId);
  if (!res.ok) return NONE;                                     // 3199-3200
  ctx.store.update({ library: res.moveLibrary });                // 3202
  ctx.store.setBoard(BOARD_MAIN, { placements: res.placements });// 3203
  return { palette: true, boards: { [BOARD_MAIN]: { rows: res.affectedRows } } };   // 3205-3206
}

/**
 * 카드의 카테고리 `<select>` 변경(3120-3126). [history] 뒤이어 saveHistory()(3125).
 *
 * ⚠ 렌더 범위가 컨텍스트 메뉴 경로와 다르다 — 여기는 renderRows(affectedRows)(3124),
 *   메뉴는 renderBoard(true)(3274). 그래서 두 경로를 하나로 합치지 않았다(promptMoveCategory 참조).
 * ⚠ "존재하는 카테고리 키인가" 검사(3269)는 이 경로에 **없다**. select 의 option 이 사전에서
 *   만들어지므로 원본도 검사하지 않는다.
 * @see index.html:3120
 * @param {PaletteCtx} ctx
 * @param {string} moveId
 * @param {string} nextCategory
 * @returns {import('./store.js').Dirty}
 */
export function setMoveCategory(ctx, moveId, nextCategory) {
  const state = ctx.store.get();
  const board = boardOf(state, BOARD_MAIN);
  const res = Moves.setMoveCategory(state.library, board.placements, moveId, nextCategory);
  if (!res.ok) return NONE;
  ctx.store.update({ library: res.moveLibrary });                // 3121
  ctx.store.setBoard(BOARD_MAIN, { placements: res.placements });// 3122
  return { palette: true, boards: { [BOARD_MAIN]: { rows: res.affectedRows } } };   // 3123-3124
}

/**
 * 컨텍스트 메뉴의 '카테고리: …' 항목(3265-3281). prompt 로 **카테고리 키**를 직접 받는다.
 * [history] 뒤이어 saveHistory()(3275).
 *
 * ⚠ setMoveCategory 와 별개 함수인 이유는 셋이다: ①prompt 를 탄다 ②없는 키면 alert 로 거부한다(3269)
 *   ③렌더가 renderBoard(true) 라 골격까지 다시 세운다(3274). 옵션 하나로 합치면 셋 중 하나를 잃는다.
 * ⚠ `if (!next) return;`(3267) 이라 **빈 문자열도 취소로 취급**한다(renameMove 의 `next == null` 과 다르다).
 * @see index.html:3265
 * @param {PaletteCtx} ctx
 * @param {string} moveId
 * @returns {import('./store.js').Dirty}
 */
export function promptMoveCategory(ctx, moveId) {
  const state = ctx.store.get();
  const move = state.library.find(m => m.id === moveId);
  if (!move) return NONE;                                       // 3249-3250 이 이미 걸렀지만 방어
  const next = ctx.dialogs.promptText('카테고리 키 변경', move.category);   // 3266
  if (!next) return NONE;                                       // 3267
  const trimmed = next.trim();                                  // 3268
  if (!state.categories[trimmed]) {                             // 3269
    ctx.dialogs.alert('존재하는 카테고리 키를 입력해 주세요.');
    return NONE;
  }
  const board = boardOf(state, BOARD_MAIN);
  const res = Moves.setMoveCategory(state.library, board.placements, moveId, trimmed);
  if (!res.ok) return NONE;
  ctx.store.update({ library: res.moveLibrary });                // 3270
  ctx.store.setBoard(BOARD_MAIN, { placements: res.placements });// 3271
  return { palette: true, boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } } };   // 3273-3274
}

// ─────────────────────────────────────────────────────────────────────────────
// 즐겨찾기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 동작 즐겨찾기 토글(★ 버튼 3147-3159). 히스토리에 쌓지 않고 **localStorage 에 즉시 쓴다**(3155).
 *
 * ⚠ 키가 이름이라 같은 이름의 동작이 둘이면 함께 별이 켜진다(원본 그대로).
 * ⚠ Set 을 제자리 변형하지 않고 새 Set 을 만든다. delete/add 순서가 같아 직렬화 순서도 원본과 같다.
 * @see index.html:3147
 * @param {PaletteCtx} ctx
 * @param {string} moveName ⚠ id 가 아니라 이름
 * @returns {import('./store.js').Dirty}
 */
export function toggleMoveFavorite(ctx, moveName) {
  const fav = ctx.store.get().favorites;
  const moveNames = new Set(fav.moveNames);
  if (moveNames.has(moveName)) moveNames.delete(moveName);      // 3151
  else moveNames.add(moveName);                                 // 3153
  ctx.store.patch('favorites', { moveNames });
  persistFavorites(ctx);                                        // 3155
  return { palette: true };                                     // 3156
}

// ─────────────────────────────────────────────────────────────────────────────
// 검색 · 정렬
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팔레트 검색어. 원본은 renderPalette(3057)가 `#paletteSearch` 를 직접 읽고 input 리스너는
 * renderPalette() 만 불렀다(2304). 도메인/유스케이스에 DOM 을 들이지 않으려고 값으로 올린다.
 * @see index.html:2304
 * @see index.html:3057
 * @param {PaletteCtx} ctx
 * @param {string} query 입력 원문(소문자화·필터는 domain/moves.selectPaletteMoves 가 한다)
 * @returns {import('./store.js').Dirty}
 */
export function setSearchQuery(ctx, query) {
  ctx.store.patch('palette', { searchQuery: String(query ?? '') });
  return { palette: true };
}

/**
 * 정렬 모드(2315-2328). 버튼 3개가 각자 값을 대입할 뿐 토글이 아니다.
 * ⚠ 버튼의 `.active` 클래스(2311-2314)는 ui/paletteView 가 store.palette.sortMode 로 재도출한다.
 * @see index.html:2315
 * @param {PaletteCtx} ctx
 * @param {'alpha'|'added'|'category'} mode
 * @returns {import('./store.js').Dirty}
 */
export function setSortMode(ctx, mode) {
  if (!SORT_MODES.includes(mode)) throw new TypeError(`알 수 없는 정렬 모드 '${mode}'`);
  ctx.store.patch('palette', { sortMode: mode });
  return { palette: true };
}

/**
 * 정렬 방향(2330-2334). 원본 버튼은 **토글**이다 — dir 을 생략하면 뒤집는다.
 * ⚠ ↑/↓ 글리프(2332)도 ui/paletteView 가 store.palette.sortDir 로 재도출한다.
 * @see index.html:2330
 * @param {PaletteCtx} ctx
 * @param {'asc'|'desc'} [dir] 생략하면 현재 값을 뒤집는다
 * @returns {import('./store.js').Dirty}
 */
export function setSortDir(ctx, dir) {
  const cur = ctx.store.get().palette.sortDir;
  const next = dir === undefined ? (cur === 'asc' ? 'desc' : 'asc') : dir;
  if (next !== 'asc' && next !== 'desc') throw new TypeError(`알 수 없는 정렬 방향 '${dir}'`);
  ctx.store.patch('palette', { sortDir: next });
  return { palette: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 활성 동작(draw-to-place)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팔레트 카드 클릭으로 '활성 동작'을 토글한다(3067-3072). 같은 카드를 다시 누르면 해제된다.
 *
 * ⚠ **메인 보드에만 쓴다.** 원본에서 reState.activePaletteMove 는 null 만 대입되고(4801·4844)
 *   어떤 코드도 값을 넣지 않는다 — 루틴을 채우면 루틴 보드에 없던 '그려서 배치'가 생겨 동작 변경이다.
 * @see index.html:3067
 * @param {PaletteCtx} ctx
 * @param {string} moveId
 * @returns {import('./store.js').Dirty}
 */
export function activatePaletteMove(ctx, moveId) {
  const session = ctx.store.get().session;
  const wasActive = session.activePaletteMove[BOARD_MAIN]?.moveId === moveId;   // 3069
  ctx.store.patch('session', {
    activePaletteMove: {
      ...session.activePaletteMove,
      [BOARD_MAIN]: wasActive ? null : { moveId }                              // 3070
    }
  });
  return { palette: true };                                                    // 3071
}

/**
 * 활성 동작 해제(2814-2818). 이미 없으면 아무 일도 하지 않는다(NONE) — 원본의 조기 반환(2815).
 *
 * ⚠ 팔레트 dragstart(3082)도 `state.activePaletteMove = null` 을 하지만 **렌더는 하지 않는다**.
 *   그 자리에서는 이 함수를 부르고 **반환 Dirty 를 버려라** — 그러면 원본과 완전히 같다.
 * @see index.html:2814
 * @param {PaletteCtx} ctx
 * @returns {import('./store.js').Dirty}
 */
export function cancelActivePaletteMove(ctx) {
  const session = ctx.store.get().session;
  if (!session.activePaletteMove[BOARD_MAIN]) return NONE;                     // 2815
  ctx.store.patch('session', {
    activePaletteMove: { ...session.activePaletteMove, [BOARD_MAIN]: null }    // 2816
  });
  return { palette: true };                                                    // 2817
}

// ─────────────────────────────────────────────────────────────────────────────
// 빠른 배치: 이름으로 찾거나 만들어서 바로 놓기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createAndPlaceQuickMove(2229-2241)와 루틴판 placeWithCat/confirmBtn(5029-5035·5013-5023 꼬리)의
 * 도메인 절차가 완전히 같아 boardId 하나로 합쳤다.
 * [history] 원본은 뒤이어 saveHistory()(2240) / saveHistoryRe()(5034) 를 부른다 —
 * 호출부가 history.commit(boardId) 를 부를 것.
 *
 * 처리 순서(uid 소비 순서까지 원본 그대로):
 *   ① 같은 **이름**의 동작이 이미 있으면 재사용하고 uid 를 쓰지 않는다(2231-2232)
 *   ② 없으면 새로 만들어 라이브러리 맨 뒤에 붙이고 renderPalette()(2233-2237)
 *   ③ placeMove(=boardOps.place)로 놓는다(2239)
 * ⚠ 이미 있는 동작이면 **카테고리를 갱신하지 않는다**(원본 그대로).
 * ⚠ boardOps.place 가 renderRows:null 을 주면(카운트 0 이하) 원본도 렌더를 부르지 않았다 —
 *   boards 키를 만들지 않는다.
 * @see index.html:2229
 * @see index.html:5029
 * @param {PaletteCtx} ctx
 * @param {'main'|'routine'} boardId
 * @param {string} name
 * @param {string} categoryKey 새로 만들 때만 쓰인다
 * @param {number} row
 * @param {number} cellIndex
 * @param {number} [count] 생략하면 store.session.defaultCount(원본 DEFAULT_COUNT 기본 인자)
 * @returns {import('./store.js').Dirty}
 */
export function createAndPlace(ctx, boardId, name, categoryKey, row, cellIndex, count) {
  const state = ctx.store.get();
  const totalCount = count === undefined ? state.session.defaultCount : count;
  const found = Moves.findOrCreateByName(state.library, name, categoryKey, ctx.ids);
  let dirty = NONE;
  if (found.created) {
    ctx.store.update({ library: found.moveLibrary });            // 2234-2235
    dirty = { palette: true };                                   // 2236
  }
  const board = boardOf(ctx.store.get(), boardId);
  const placed = BoardOps.place(
    board,
    { move: found.move, startRow: row, startIndex: cellIndex, totalCount },
    ctx.ids
  );                                                             // 2239 → placeMove(3578)
  if (placed.renderRows === null) return dirty;                  // 3579-3582 의 조기 반환
  ctx.store.setBoard(boardId, { placements: placed.placements });
  return mergeDirty(dirty, { boards: { [boardId]: { rows: placed.renderRows } } });   // 3605
}
