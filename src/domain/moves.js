// src/domain/moves.js — 동작 라이브러리 트랜잭션과 팔레트 질의 파이프라인 (순수 함수)
//
// 원본 index.html 의 normalizeMoveList(4015-4023) · applySortToMoves(4232-4257) ·
// addCustomMove 도메인부(3994) · renameMove 도메인부(3190-3192) ·
// deleteMove 도메인부(3201-3203, 카드 × 버튼 3136-3138 과 동일) ·
// buildCard 의 카테고리 select change(3120-3122) · openMoveContextMenu 의 카테고리 변경(3270-3272) ·
// createAndPlaceQuickMove 의 find-or-create(2231-2235, 루틴판 5020-5021 과 동일) ·
// renderPalette 의 검색·즐겨찾기 분할(3057-3062) 을 옮겼다.
//
// ⚠ 동작 이름은 배치(placement)의 `name` 으로 참조된다(이름 기반 참조, id 아님).
//   그래서 이름 변경·삭제·카테고리 변경은 전부 배치를 함께 건드린다. 영향 행 목록을 같이 돌려준다.

import { categoryNames } from './categories.js';
import { affectedRowsByMoveName, rewriteMoveName, rewriteCategoryKey } from './placements.js';

/** @typedef {{ id: string, name: string, category: string }} Move */
/** @typedef {{ mode: 'alpha'|'added'|'category', dir: 'asc'|'desc' }} PaletteSort */

const idsOf = (ids) => (typeof ids === 'function' ? ids : ids.uid);

// ─────────────────────────────────────────────────────────────────────────────
// 정규화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 불러온 동작 목록을 정규화한다.
 * ⚠ **끝의 `.sort(name.localeCompare)` 를 절대 빼지 말 것.** 저장/불러오기를 거치면 배열 순서가
 *   가나다순으로 재배열되고, 팔레트의 'added' 정렬(4251-4254)은 그 배열 순서를 그대로 읽는다.
 *   정렬을 빼면 불러온 프로젝트의 팔레트 순서와 저장 JSON 바이트가 함께 달라진다.
 * ⚠ 여기 localeCompare 에는 'ko' 로케일 인자가 없다(applySortToMoves 와 다르다). 원본 그대로.
 * @see index.html:4015
 * @param {unknown} list
 * @param {Record<string, {label:string,color:string}>} categories
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {Move[]}
 */
export function normalizeLibrary(list, categories, ids) {
  const nextId = idsOf(ids);
  const valid = new Set(categoryNames(categories));
  const fallback = categoryNames(categories)[0];
  return (Array.isArray(list) ? list : []).filter(item => item && item.name).map(item => ({
    id: item.id || nextId(),
    name: String(item.name),
    category: valid.has(item.category) ? item.category : fallback
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// 트랜잭션
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 동작을 목록 맨 뒤에 추가한다(addCustomMove 3994 의 push).
 * ⚠ 이름 trim 과 빈 이름 alert('동작 이름을 입력해 주세요.')(3993)은 UI 몫이다 — 여기서 검사하지 않는다.
 * @see index.html:3994
 * @param {Move[]} moveLibrary
 * @param {string} name  이미 trim 된 이름
 * @param {string} category
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {Move[]} 새 배열
 */
export function addMove(moveLibrary, name, category, ids) {
  const nextId = idsOf(ids);
  return [...moveLibrary, { id: nextId(), name, category }];
}

/**
 * 동작 이름 변경 + 같은 이름의 배치를 전부 새 이름으로 치환.
 * ⚠ 배치는 **이름**으로 고른다 — 같은 이름의 다른 동작이 있으면 함께 바뀐다(원본 결함 보존).
 * ⚠ 원본은 여기서 renderBoard(true)(전체 재빌드)를 부른다. affectedRows 는 참고용으로 함께 돌려주지만
 *   렌더 대상으로 바꿔 쓰면 동작이 달라진다.
 * ⚠ prompt 취소(next == null)와 alert('이름을 비워둘 수 없습니다.')(3189)는 UI 몫. 여기서는 값 규칙만 본다.
 * @see index.html:3190
 * @param {Move[]} moveLibrary
 * @param {object[]} placements
 * @param {string} moveId
 * @param {string} rawName 입력 원문
 * @returns {{ ok:false, reason:'not-found'|'empty-name' } | { ok:true, moveLibrary:Move[], placements:object[], prevName:string, nextName:string, affectedRows:number[] }}
 */
export function renameMove(moveLibrary, placements, moveId, rawName) {
  const move = moveLibrary.find(m => m.id === moveId);
  if (!move) return { ok: false, reason: 'not-found' };
  const trimmed = String(rawName).trim();
  if (!trimmed) return { ok: false, reason: 'empty-name' };
  const prevName = move.name;
  const affectedRows = affectedRowsByMoveName(placements, prevName);
  return {
    ok: true,
    moveLibrary: moveLibrary.map(m => m.id === moveId ? { ...m, name: trimmed } : m),
    placements: rewriteMoveName(placements, prevName, trimmed),
    prevName,
    nextName: trimmed,
    affectedRows
  };
}

/**
 * 동작 삭제 + 같은 이름의 배치를 전부 삭제.
 * 원본의 두 경로(카드 × 버튼 3136-3138, 컨텍스트 메뉴 deleteMove 3201-3203)가 도메인 상 완전히 같아서 하나로 합쳤다.
 * ⚠ affectedRows 는 **삭제 전에** 계산한다(원본 3136·3201). 중복 제거는 하지 않는다.
 * @see index.html:3201
 * @param {Move[]} moveLibrary
 * @param {object[]} placements
 * @param {string} moveId
 * @returns {{ ok:false, reason:'not-found' } | { ok:true, moveLibrary:Move[], placements:object[], name:string, affectedRows:number[] }}
 */
export function removeMove(moveLibrary, placements, moveId) {
  const move = moveLibrary.find(m => m.id === moveId);
  if (!move) return { ok: false, reason: 'not-found' };
  const affectedRows = affectedRowsByMoveName(placements, move.name);
  return {
    ok: true,
    moveLibrary: moveLibrary.filter(m => m.id !== moveId),
    placements: placements.filter(p => p.name !== move.name),
    name: move.name,
    affectedRows
  };
}

/**
 * 동작의 카테고리 변경 + 같은 **이름**의 배치를 전부 새 카테고리로 치환.
 * 원본 두 경로(카드 select 3120-3122, 컨텍스트 메뉴 3270-3272)의 도메인부가 같아서 하나로 합쳤다.
 * ⚠ 컨텍스트 메뉴 경로에만 있는 "존재하는 카테고리 키인가" 검사(3269)는 호출부 몫이다 — 여기서는 검사하지 않는다.
 * ⚠ 렌더 범위도 두 경로가 다르다: select 는 renderRows(affectedRows)(3124), 메뉴는 renderBoard(true)(3274).
 * @see index.html:3120
 * @see index.html:3270
 * @param {Move[]} moveLibrary
 * @param {object[]} placements
 * @param {string} moveId
 * @param {string} nextCategory
 * @returns {{ ok:false, reason:'not-found' } | { ok:true, moveLibrary:Move[], placements:object[], affectedRows:number[] }}
 */
export function setMoveCategory(moveLibrary, placements, moveId, nextCategory) {
  const move = moveLibrary.find(m => m.id === moveId);
  if (!move) return { ok: false, reason: 'not-found' };
  return {
    ok: true,
    moveLibrary: moveLibrary.map(m => m.id === moveId ? { ...m, category: nextCategory } : m),
    placements: rewriteCategoryKey(placements, move.name, nextCategory),
    affectedRows: affectedRowsByMoveName(placements, move.name)
  };
}

/**
 * 이름으로 동작을 찾고, 없으면 만들어 목록 맨 뒤에 붙인다.
 * 빠른 배치(createAndPlaceQuickMove 2231-2235)와 루틴 빠른 배치(5020-5021)가 같은 규칙이라 하나로 합쳤다.
 * ⚠ 이미 있으면 **카테고리를 갱신하지 않는다**(원본 그대로). 새 카테고리를 골라도 기존 동작의 카테고리는 그대로다.
 * @see index.html:2231
 * @see index.html:5020
 * @param {Move[]} moveLibrary
 * @param {string} name
 * @param {string} categoryKey 새로 만들 때만 쓰인다
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {{ move: Move, moveLibrary: Move[], created: boolean }}
 */
export function findOrCreateByName(moveLibrary, name, categoryKey, ids) {
  const found = moveLibrary.find(m => m.name === name);
  if (found) return { move: found, moveLibrary, created: false };
  const nextId = idsOf(ids);
  const move = { id: nextId(), name, category: categoryKey };
  return { move, moveLibrary: [...moveLibrary, move], created: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 팔레트 질의 파이프라인
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 동작 목록 정렬. PR #17 이 추가한 'category' 모드 포함.
 *
 * ⚠ 보존해야 하는 결함(#13): 'category' 모드는 `categoryNames().indexOf(m.category)` 로 그룹 순서를
 *   정하는데, **삭제된 카테고리를 쓰는 동작은 -1** 이 되어 언제나 맨 앞으로 간다(desc 면 맨 뒤).
 * ⚠ 'alpha'/'category' 의 localeCompare 에는 'ko' 로케일이 붙지만 normalizeLibrary 의 종단 정렬에는 없다.
 * ⚠ 'added' 는 배열 삽입 순서 기준이고 asc 가 reverse(최신이 위)다 — 직관과 반대인 것이 원본이다.
 * @see index.html:4232
 * @param {Move[]} moves
 * @param {PaletteSort} sort
 * @param {Record<string, {label:string,color:string}>} categories
 * @returns {Move[]} 새 배열
 */
export function applySortToMoves(moves, sort, categories) {
  const { mode, dir } = sort;
  const arr = [...moves];
  if (mode === 'alpha') {
    arr.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, 'ko');
      return dir === 'asc' ? cmp : -cmp;
    });
  } else if (mode === 'category') {
    // 카테고리별 정렬: 카테고리 이름순으로 그룹화 후, 그룹 내에서 가나다순
    const catKeys = categoryNames(categories);
    arr.sort((a, b) => {
      const catA = catKeys.indexOf(a.category);
      const catB = catKeys.indexOf(b.category);
      const catCmp = catA - catB;
      if (catCmp !== 0) return dir === 'asc' ? catCmp : -catCmp;
      const nameCmp = a.name.localeCompare(b.name, 'ko');
      return dir === 'asc' ? nameCmp : -nameCmp;
    });
  } else {
    // 'added': 배열 삽입 순서 기준
    // asc = 최신이 위 (reverse), desc = 오래된 게 위 (원래 순서)
    if (dir === 'asc') arr.reverse();
  }
  return arr;
}

/**
 * 팔레트(동작 목록)가 그릴 두 묶음을 만든다: 검색 필터 → 즐겨찾기/일반 분할 → 각각 정렬.
 * renderPalette(3057-3062)가 DOM(#paletteSearch)에서 검색어를 직접 읽던 사슬을 여기서 끊는다 — 검색어는 인자다.
 * ⚠ 검색은 이름만 본다(카테고리 레이블은 보지 않는다). 소문자 includes.
 * @see index.html:3057
 * @param {Move[]} moveLibrary
 * @param {{ query?: string, favorites?: Set<string>|string[], sort: PaletteSort, categories: Record<string, object> }} options
 * @returns {{ favs: Move[], others: Move[] }}
 */
export function selectPaletteMoves(moveLibrary, options) {
  const { query, favorites, sort, categories } = options;
  const q = (query || '').toLowerCase();
  const base = q ? moveLibrary.filter(m => m.name.toLowerCase().includes(q)) : moveLibrary;
  const favSet = favorites instanceof Set ? favorites : new Set(favorites || []);
  const favs = applySortToMoves(base.filter(m => favSet.has(m.name)), sort, categories);
  const others = applySortToMoves(base.filter(m => !favSet.has(m.name)), sort, categories);
  return { favs, others };
}
