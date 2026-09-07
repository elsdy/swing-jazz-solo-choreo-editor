// src/usecases/categoryCommands.js — 카테고리 커맨드 (usecases 계층)
//
// 원본 index.html 의 renderCategoryManager 안 인라인 핸들러 4종(색 2982-2991 · 라벨 2993-3001 ·
// 삭제 3006-3024 · ★ 3026-3039)과, 빠른 배치 팝업의 '새 카테고리로 추가' 트랜잭션
// (showCategoryScreen 2113-2121 / showReCategoryScreen 5013-5022, 글자 단위로 같다)을 옮겼다.
// DOM 과 render*() 호출은 전부 걷어내고 Dirty 를 돌려준다.

import { NONE, boardOf, BOARD_MAIN, BOARD_ROUTINE } from './store.js';
import * as Categories from '../domain/categories.js';

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일이 지켜야 하는 세 가지 (설계에서 확정)
//
//  ① **색상 슬라이더는 두 단계다.** `input` 마다 미리보기를 갱신하고(previewColor),
//     `change` 에서만 히스토리에 커밋한다(commitColor). previewColor 의 Dirty 에
//     categoryManager 를 넣으면 <input type="color"> 가 파괴되어 네이티브 색상 피커가
//     첫 드래그에서 닫힌다(원본 2982-2991 이 manager 를 일부러 다시 그리지 않는 이유).
//
//  ② **renderCategoryOptions 는 무조건 renderCategoryManager 를 부른다**(2967).
//     그 결합은 Dirty 가 아니라 presenter 가 재현한다 — `categorySelect: true` 를 보면
//     app/render 가 renderOptions 와 renderManager 를 **둘 다** 부른다. 그러니 이 파일은
//     categorySelect 만 켜면 되고 categoryManager 를 함께 켤 필요가 없다.
//
//  ③ **히스토리 커밋은 여기서 하지 않는다.** 원본이 saveHistory() 를 부르던 자리를
//     `[history]` 로 표시했으니 호출부가 history.commit('main') 을 부를 것.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CategoryCtx
 * @property {ReturnType<import('./store.js').createStore>} store
 * @property {import('../ports/env.js').Dialogs} dialogs  alert 만 쓴다
 * @property {{ saveFavorites?: (fav:{moveNames:string[],categories:string[]}) => unknown }} [storage]
 *   ⚠ paletteCommands 와 **같은 함수**를 넘겨라. 원본 saveFavorites(4227-4230)는 두 키를 함께 쓴다.
 */

/**
 * 즐겨찾기 2종을 한꺼번에 저장한다(원본 saveFavorites 4227-4230).
 * paletteCommands 에 같은 헬퍼가 있다 — usecases 끼리 얽히지 않도록 4줄을 일부러 복제했다.
 * @param {CategoryCtx} ctx
 */
function persistFavorites(ctx) {
  const fav = ctx.store.get().favorites;
  ctx.storage?.saveFavorites?.({ moveNames: [...fav.moveNames], categories: [...fav.categories] });
}

// ─────────────────────────────────────────────────────────────────────────────
// 생성
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 새 카테고리를 사전 맨 뒤에 추가한다. 빠른 배치 팝업의 '✦ 추가 & 배치'(2113-2121, 5013-5022).
 *
 * ⚠ **키는 호출부가 먼저 만든다.** `categories.deriveKey(label, store.categories, ids)` 를
 *   부르고 그 결과를 넘겨라 — deriveKey 가 uid 를 0~2번 소비하고, 그 소비 순서가
 *   뒤이어 오는 findOrCreateByName/place 의 id 와 함께 골든 결정성을 만든다(2115-2117).
 *   ui/quickPicker 는 domain/categories.js 를 직접 import 할 수 있으므로 계층 위반이 아니다.
 * ⚠ 원본은 여기서 **히스토리를 쌓지 않는다.** 곧바로 이어지는 createAndPlace 의 saveHistory 가
 *   카테고리 추가까지 한 스냅샷에 담는다(2122 → 2240).
 * ⚠ 렌더는 renderCategoryOptions() + renderLegend() 두 개뿐이다(2119-2120) —
 *   팔레트는 다시 그리지 않는다.
 * @see index.html:2113
 * @see index.html:5013
 * @param {CategoryCtx} ctx
 * @param {string} key deriveKey 가 만든, 사전에 없는 키
 * @param {string} label 이미 trim 된 레이블
 * @param {string} color `<input type="color">` 값
 * @returns {import('./store.js').Dirty}
 */
export function addCategory(ctx, key, label, color) {
  const state = ctx.store.get();
  ctx.store.update({ categories: Categories.addCategory(state.categories, key, label, color) });   // 2118
  return { categorySelect: true, legend: true };                 // 2119-2120
}

// ─────────────────────────────────────────────────────────────────────────────
// 색 — input 미리보기 / change 커밋의 2단계
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 색상 슬라이더 `input` 핸들러(2982-2991). 매 프레임 상태를 갱신하고 화면을 다시 칠한다.
 *
 * ⚠ Dirty 에 **categoryManager 를 넣지 마라**(파일 상단 ①).
 * ⚠ 루틴 보드는 **편집기가 열려 있을 때만** 다시 그린다 — 원본 2990 이
 *   `if (reState.routineId)` 로 감싸고 있다. 항상 그리면 닫힌 보드까지 매 프레임 재렌더가 돈다.
 * @see index.html:2982
 * @param {CategoryCtx} ctx
 * @param {string} key
 * @param {string} color
 * @returns {import('./store.js').Dirty}
 */
export function previewColor(ctx, key, color) {
  const state = ctx.store.get();
  ctx.store.update({ categories: Categories.setColor(state.categories, key, color) });   // 2983
  const dirty = {
    legend: true,                                                // 2984
    palette: true,                                               // 2985
    boards: { [BOARD_MAIN]: { rows: 'all' } }                     // 2986: [0, 1..rows]
  };
  if (state.session.editingRoutineId) {
    dirty.boards[BOARD_ROUTINE] = { rows: 'all' };                // 2990: [1..reState.rows]
  }
  return dirty;
}

/**
 * 색상 슬라이더 `change` 핸들러(2988-2990). 원본은 **saveHistory() 한 줄뿐**이다 —
 * 상태는 이미 previewColor 가 갱신했고 다시 그릴 것도 없다.
 * [history] 호출부가 history.commit('main') 을 부를 것.
 *
 * color 를 넘기면 마지막 값을 한 번 더 확정한다(같은 값이면 무해). 넘기지 않으면 상태를 건드리지 않는다 —
 * 어느 쪽이든 Dirty 는 NONE 이다.
 * @see index.html:2988
 * @param {CategoryCtx} ctx
 * @param {string} [key]
 * @param {string} [color]
 * @returns {import('./store.js').Dirty}
 */
export function commitColor(ctx, key, color) {
  if (key !== undefined && color !== undefined) {
    const state = ctx.store.get();
    ctx.store.update({ categories: Categories.setColor(state.categories, key, color) });
  }
  return NONE;
}

// ─────────────────────────────────────────────────────────────────────────────
// 레이블 · 삭제 · 즐겨찾기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 카테고리 레이블 변경(라벨 입력의 `change` 2996-3001). [history] 뒤이어 saveHistory()(3000).
 * ⚠ 빈 문자열이면 **키 자체가 레이블**이 된다(2997 `input.value.trim() || name`).
 * ⚠ 보드는 다시 그리지 않는다 — 배치가 들고 있는 것은 카테고리 키이지 레이블이 아니다.
 * @see index.html:2996
 * @param {CategoryCtx} ctx
 * @param {string} key
 * @param {string} rawLabel 입력창 원문
 * @returns {import('./store.js').Dirty}
 */
export function renameLabel(ctx, key, rawLabel) {
  const state = ctx.store.get();
  ctx.store.update({ categories: Categories.renameLabel(state.categories, key, rawLabel) });   // 2997-2998
  return { categorySelect: true, legend: true, palette: true };   // 2999-3001 (categorySelect → manager 동반)
}

/**
 * 카테고리 삭제(× 버튼 3011-3023). 그 카테고리를 쓰던 **동작과 메인 보드 배치는 사라지지 않고
 * 폴백 카테고리(자기 자신이 아닌 첫 키)로 옮겨간다**(3014-3015).
 * [history] 뒤이어 saveHistory()(3021).
 *
 * ⚠ **호출 순서 주의.** 원본은 `categoryNames().length <= 1` 검사를 confirmOnce **밖**에서 한다(3012) —
 *   마지막 카테고리는 2단계 확인 없이 즉시 alert 로 막힌다. ui/categoryView 는
 *   `categories.categoryNames(store.categories).length <= 1` 를 confirmOnce 앞에서 직접 검사해야
 *   같은 순서가 된다. 여기 있는 같은 가드는 그 검사를 빠뜨렸을 때를 위한 방어일 뿐이다.
 * ⚠ 루틴 보드 배치(reState.placements)와 루틴 정의의 category 는 옮기지 않는다 —
 *   원본 3015 가 state.placements 만 훑는다(보존 대상 결함).
 * @see index.html:3011
 * @param {CategoryCtx} ctx
 * @param {string} key
 * @returns {import('./store.js').Dirty}
 */
export function removeCategory(ctx, key) {
  const state = ctx.store.get();
  const board = boardOf(state, BOARD_MAIN);
  const res = Categories.removeCategory(
    { categories: state.categories, moveLibrary: state.library, placements: board.placements },
    key
  );
  if (!res.ok) {
    ctx.dialogs.alert('카테고리는 최소 1개 이상 있어야 합니다.');   // 3012
    return NONE;
  }
  ctx.store.update({ categories: res.categories, library: res.moveLibrary });   // 3014·3016
  ctx.store.setBoard(BOARD_MAIN, { placements: res.placements });               // 3015
  return {
    categorySelect: true,                                        // 3017 (→ manager 동반)
    legend: true,                                                // 3018
    palette: true,                                               // 3019
    boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } }     // 3020 renderBoard(true)
  };
}

/**
 * 카테고리 즐겨찾기 토글(★ 3032-3039). 히스토리에 쌓지 않고 localStorage 에 즉시 쓴다(3037).
 *
 * ⚠ 렌더는 renderCategoryOptions() **하나뿐**이다(3038) — 범례도 팔레트도 다시 그리지 않는다.
 *   별 표시는 관리 행에 있고, categorySelect 가 presenter 에서 manager 를 함께 그려 갱신된다.
 * @see index.html:3032
 * @param {CategoryCtx} ctx
 * @param {string} key
 * @returns {import('./store.js').Dirty}
 */
export function toggleCategoryFavorite(ctx, key) {
  const fav = ctx.store.get().favorites;
  const categories = new Set(fav.categories);
  if (categories.has(key)) categories.delete(key);               // 3034
  else categories.add(key);                                      // 3036
  ctx.store.patch('favorites', { categories });
  persistFavorites(ctx);                                         // 3037
  return { categorySelect: true };                               // 3038
}
