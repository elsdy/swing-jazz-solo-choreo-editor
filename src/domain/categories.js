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

/** 블록 글자에 쓸 수 있는 두 색. 어두운 쪽은 `.placement` 의 CSS 기본값과 같은 값이다. */
export const TEXT_DARK = '#08111f';
export const TEXT_LIGHT = '#ffffff';

/** 읽을 수 있다고 보는 최소 대비비. WCAG 2.1 의 본문 기준. */
export const MIN_CONTRAST = 4.5;

/**
 * `#rgb` · `#rrggbb` 를 0-255 삼원색으로. 해석할 수 없으면 null.
 * ⚠ 3자리 표기를 받는 것은 원본과 다르다 — 원본 isLightColor 는 `#abc` 에서 NaN 을 냈다.
 * @param {string} hex
 * @returns {{ r:number, g:number, b:number }|null}
 */
export function parseHexColor(hex) {
  if (typeof hex !== 'string') return null;
  let c = hex.trim().replace(/^#/, '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

/** WCAG 상대 휘도(0~1). */
export function relativeLuminance(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

/** 두 색의 대비비(1~21). 해석할 수 없는 색이 있으면 null. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 이 배경 위에 올릴 글자색. **더 잘 읽히는 쪽**을 고른다.
 *
 * 원본은 YIQ 밝기 > 90 이면 어두운 글자였는데, 임계값 90 은 눈으로 세 번 뒤집은 끝에 남은
 * 값이라 기본 카테고리 6색과 루틴 8색이 **전부** 90 을 넘었다 — 흰 글자 분기가 한 번도 실행되지
 * 않는 죽은 코드였고, `#6366f1` 같은 어두운 인디고 위에 검은 글자가 올라갔다.
 * 이제 임계값 대신 두 후보의 대비비를 실제로 재서 큰 쪽을 쓴다. 값을 손으로 고를 자리가 없어졌다.
 * → docs/PRINCIPLES.md 의 U-4
 *
 * @param {string} background `#rgb` 또는 `#rrggbb`
 * @returns {string} TEXT_DARK 또는 TEXT_LIGHT. 해석할 수 없는 색이면 TEXT_DARK
 */
export function textColorOn(background) {
  const dark = contrastRatio(background, TEXT_DARK);
  const light = contrastRatio(background, TEXT_LIGHT);
  if (dark === null || light === null) return TEXT_DARK;
  return light > dark ? TEXT_LIGHT : TEXT_DARK;
}

/**
 * 그 배경에서 실제로 얻는 대비비. 팔레트를 검증할 때 쓴다(테스트가 이걸 단언한다).
 * @param {string} background
 * @returns {number|null}
 */
export function bestContrastOn(background) {
  return contrastRatio(background, textColorOn(background));
}

/**
 * hex 를 검정 쪽으로 `amount`(0~1) 만큼 섞는다. 루틴 블록의 그러데이션 끝색을 만드는 데 쓴다.
 * @param {string} hex
 * @param {number} amount
 * @returns {string} `#rrggbb`
 */
export function darken(hex, amount) {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const k = Math.min(1, Math.max(0, amount));
  const mix = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, '0');
  return `#${mix(rgb.r)}${mix(rgb.g)}${mix(rgb.b)}`;
}

/** 루틴 색이 없을 때 쓰는 기본색. 사이드바 칩(routineListView)과 같은 값이어야 한다. */
export const DEFAULT_ROUTINE_COLOR = '#818cf8';

/** 루틴 블록 그러데이션의 끝색을 만들 때 섞는 양. */
const ROUTINE_GRADIENT_SHADE = 0.28;

/**
 * 배치 하나의 색을 결정한다.
 *
 * 루틴 배치는 예전에 색을 **계산만 하고 칠하지 않아서**, 사이드바 목록의 칩은 루틴 색인데
 * 안무표 블록은 CSS 에 박힌 보라 그러데이션 하나로만 그려졌다(색을 여덟 개 돌려 써도 전부 같은 색).
 * 이제 루틴 색에서 그러데이션을 만들어 실제로 칠한다 — 두 자리가 같은 색을 쓴다.
 *
 * 글자색은 배경의 **대비비로** 고른다(textColorOn). 카테고리 배치와 루틴 배치가 같은 규칙을 쓴다.
 *
 * @param {{ type?: string, routineId?: string, category?: string }} placement
 * @param {{ categories: CategoryMap, routines: { id: string, color?: string }[] }} lookup
 * @returns {{ background: string, base: string, apply: boolean, textColor: string }}
 *   `background` 는 CSS 에 그대로 넣을 값(루틴은 그러데이션), `base` 는 대비 판정에 쓴 단색.
 */
export function resolvePlacementColor(placement, lookup) {
  const { categories, routines } = lookup;
  if (placement.type === 'routine') {
    const routine = (routines || []).find(r => r.id === placement.routineId);
    const base = routine?.color || DEFAULT_ROUTINE_COLOR;
    const end = darken(base, ROUTINE_GRADIENT_SHADE);
    return {
      background: `linear-gradient(135deg, ${base} 0%, ${end} 100%)`,
      base,
      apply: true,
      textColor: textColorOn(base),
    };
  }
  const base = categoryColor(categories, placement.category);
  return { background: base, base, apply: true, textColor: textColorOn(base) };
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
