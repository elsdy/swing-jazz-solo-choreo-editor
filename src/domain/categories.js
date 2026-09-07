// src/domain/categories.js — 카테고리 사전 트랜잭션과 색 판정 (순수 함수)
//
// 원본 index.html 의 categoryColor(2277) · isLightColor(2281) · categoryNames(2290) ·
// normalizeCategories(4000-4013) · renderCategoryManager 안의 인라인 트랜잭션(2982-3021) ·
// 카테고리 키 생성 2벌(2115-2117, 5015-5017) · createPlacementEl 의 색 분기(3433-3440) 를 옮겼다.
//
// 사전은 언제나 값 객체다. 모든 트랜잭션은 새 객체를 돌려주고 인자를 건드리지 않는다.
// ⚠ 키 삽입 순서가 곧 categoryNames() 순서이고, moves.applySortToMoves 의 'category' 모드가
//   그 순서를 indexOf 로 읽는다. 새 키는 반드시 **맨 뒤**에, 기존 키의 갱신은 **제자리**에.

import { DEFAULT_CATEGORIES } from './defaults.js';

/** @typedef {{ label: string, color: string }} Category */
/** @typedef {Record<string, Category>} CategoryMap */

// ─────────────────────────────────────────────────────────────────────────────
// 질의 · 색 판정
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 카테고리 키 목록. 삽입 순서 그대로.
 * @see index.html:2290
 * @param {CategoryMap} categories
 * @returns {string[]}
 */
export function categoryNames(categories) {
  return Object.keys(categories);
}

/**
 * 카테고리 색. 없는 키면 '#cbd5e1'.
 * @see index.html:2277
 * @param {CategoryMap} categories
 * @param {string} name
 * @returns {string}
 */
export function categoryColor(categories, name) {
  return categories[name]?.color || '#cbd5e1';
}

/**
 * 밝은 색인가? (YIQ 밝기 > 90)
 * ⚠ 임계값 90 은 원본 그대로다. 통상 쓰는 128/150 이 아니라 90이라 어두운 색도 '밝다'고 나오는
 *   구간이 넓다 — 흰 글씨가 붙는 조건을 바꾸므로 절대 손대지 말 것.
 * ⚠ '#abc' 같은 3자리 표기는 parseInt 가 NaN 을 내서 항상 false 가 된다(원본 동작 그대로).
 * @see index.html:2281
 * @param {string} hex
 * @returns {boolean}
 */
export function isLightColor(hex) {
  if (!hex) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 90;
}

/**
 * 배치 하나의 색을 결정한다. createPlacementEl(3433-3440) 의 분기를 값으로 옮긴 것.
 *
 * ⚠ 보존해야 하는 결함(#5): 루틴 배치일 때 원본은 `el.style.background` 를 **설정하지 않는다**
 *   (3439가 else 블록 안에 있다). 색만 계산하고 칠하지 않으므로 루틴 블록은 CSS 의 .is-routine
 *   배경을 쓴다. 그 사실을 `apply:false` 로 그대로 돌려준다.
 * @see index.html:3433
 * @param {{ type?: string, routineId?: string, category?: string }} placement
 * @param {{ categories: CategoryMap, routines: { id: string, color?: string }[] }} lookup
 * @returns {{ background: string, apply: boolean, textColor: '#fff'|null }}
 */
export function resolvePlacementColor(placement, lookup) {
  const { categories, routines } = lookup;
  let background;
  let apply;
  if (placement.type === 'routine') {
    const routine = routines.find(r => r.id === placement.routineId);
    background = routine?.color || '#6366f1';
    apply = false;   // ⚠ 원본은 여기서 background 를 칠하지 않는다 (보존)
  } else {
    background = categoryColor(categories, placement.category);
    apply = true;
  }
  return { background, apply, textColor: isLightColor(background) ? null : '#fff' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 정규화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * structuredClone(DEFAULT_CATEGORIES) 를 대신하는 명시적 복제(순수·테스트 가능).
 * 값이 {label,color} 평면 객체라 얕은 복제로 충분하다.
 * @see index.html:1399
 * @param {CategoryMap} categories
 * @returns {CategoryMap}
 */
export function cloneCategories(categories) {
  const out = {};
  Object.entries(categories).forEach(([key, value]) => { out[key] = { ...value }; });
  return out;
}

/**
 * 불러온 사전을 정규화한다. ⚠ **키를 localeCompare 로 정렬**해서 돌려준다 —
 * 그래서 프로젝트를 불러오면 카테고리 순서가 가나다순으로 재배열되고,
 * 그 순서가 applySortToMoves('category') 의 그룹 순서를 바꾼다. 원본 동작이다.
 * @see index.html:4000
 * @param {unknown} input
 * @param {CategoryMap} [defaults] 색·빈 사전 폴백 (원본의 DEFAULT_CATEGORIES)
 * @returns {CategoryMap}
 */
export function normalize(input, defaults = DEFAULT_CATEGORIES) {
  const source = input && typeof input === 'object' ? input : defaults;
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    out[key] = {
      label: String(value.label || key),
      color: String(value.color || defaults[key]?.color || '#cbd5e1')
    };
  });
  const sorted = {};
  Object.keys(out).sort((a, b) => a.localeCompare(b)).forEach(k => { sorted[k] = out[k]; });
  return Object.keys(sorted).length ? sorted : cloneCategories(defaults);
}

// ─────────────────────────────────────────────────────────────────────────────
// 트랜잭션
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 레이블에서 카테고리 키를 만든다.
 * ⚠ 원본에 **두 벌**(2115-2117 빠른배치, 5015-5017 루틴 빠른배치)이 있고 `diff` 로 대조해
 *   **글자 단위로 완전히 같음**을 확인했다. 그래서 하나로 합쳤다.
 * ⚠ uid 호출 횟수가 입력에 따라 다르다(빈 base 면 6자리 1회, 키 충돌이면 4자리 1회 추가).
 *   `||` / `?:` 의 지연 평가를 그대로 유지해야 uid 소비 순서가 원본과 같다.
 * @see index.html:2115
 * @see index.html:5015
 * @param {string} label 이미 trim 된 레이블 (원본 호출부가 catInput.value.trim() 을 넘긴다)
 * @param {CategoryMap} categories
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {string} 사전에 없는 새 키
 */
export function deriveKey(label, categories, ids) {
  const nextId = typeof ids === 'function' ? ids : ids.uid;
  const base = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const catKey = base || nextId().slice(0, 6);
  return categories[catKey] ? catKey + '_' + nextId().slice(0, 4) : catKey;
}

/**
 * 새 카테고리를 사전 **맨 뒤**에 추가한다. 원본은 `state.categories[k] = {...}` 제자리 대입(2118·5018).
 * 새 키는 맨 뒤에 붙고 기존 키는 제자리에서 덮이는데, 스프레드도 동일한 순서를 만든다.
 * @see index.html:2118
 * @param {CategoryMap} categories
 * @param {string} key
 * @param {string} label
 * @param {string} color
 * @returns {CategoryMap} 새 사전
 */
export function addCategory(categories, key, label, color) {
  return { ...categories, [key]: { label, color } };
}

/**
 * 카테고리 레이블 변경. 원본 2998-2999 의 `input.value.trim() || name` 규칙을 그대로 담았다
 * (빈 문자열이면 키 자체가 레이블이 된다).
 * @see index.html:2998
 * @param {CategoryMap} categories
 * @param {string} key
 * @param {string} rawLabel 입력창 원문
 * @returns {CategoryMap}
 */
export function renameLabel(categories, key, rawLabel) {
  const next = String(rawLabel).trim() || key;
  return { ...categories, [key]: { ...categories[key], label: next } };
}

/**
 * 카테고리 색 변경. 원본 2983(색상 슬라이더 input 핸들러)의 도메인부.
 * @see index.html:2983
 * @param {CategoryMap} categories
 * @param {string} key
 * @param {string} color
 * @returns {CategoryMap}
 */
export function setColor(categories, key, color) {
  return { ...categories, [key]: { ...categories[key], color } };
}

/**
 * 카테고리 삭제 + 그 카테고리를 쓰던 동작·배치를 폴백 카테고리로 옮긴다.
 * 원본 3012-3017 (renderCategoryManager 의 × 버튼 안, confirmOnce 통과 후)의 도메인부.
 *
 * ⚠ 원본 순서 그대로: ① 마지막 1개면 거부 ② **삭제 전** 사전에서 자기 자신이 아닌 첫 키를
 *   폴백으로 고른다 ③ moveLibrary → placements 순으로 카테고리를 옮긴다 ④ 마지막에 키를 지운다.
 *   삭제된 카테고리를 쓰던 동작은 사라지지 않고 폴백으로 **이동**한다.
 * ⚠ 거부 사유의 alert('카테고리는 최소 1개 이상 있어야 합니다.')(3012)은 UI 몫이다.
 * @see index.html:3012
 * @param {{ categories: CategoryMap, moveLibrary: object[], placements: object[] }} state
 * @param {string} key
 * @returns {{ ok: false, reason: 'last-category' } | { ok: true, categories: CategoryMap, moveLibrary: object[], placements: object[], fallback: string }}
 */
export function removeCategory(state, key) {
  const { categories, moveLibrary, placements } = state;
  if (categoryNames(categories).length <= 1) return { ok: false, reason: 'last-category' };
  const fallback = categoryNames(categories).find(n => n !== key);
  const nextMoveLibrary = moveLibrary.map(m => m.category === key ? { ...m, category: fallback } : m);
  const nextPlacements = placements.map(p => p.category === key ? { ...p, category: fallback } : p);
  const nextCategories = {};
  Object.entries(categories).forEach(([k, v]) => { if (k !== key) nextCategories[k] = v; });
  return { ok: true, categories: nextCategories, moveLibrary: nextMoveLibrary, placements: nextPlacements, fallback };
}
