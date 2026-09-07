// src/domain/project/snapshot.js — undo 스냅샷과 ChoreoDoc 복제 (순수, ./schema.js 만 import)
//
// 원본 index.html 의 snapshotState(2833-2841) · snapshotStateRe(2900-2902) ·
// restoreSnapshot 의 순수부(2845-2850)를 옮겼다. 렌더 호출 7종과 selectedGroupIds.clear() 는
// 여기 없다 — 그것은 유스케이스/뷰의 몫이다.
//
// ⚠ 이번 PR 은 스냅샷의 **내용**을 바꾸지 않는다. 타입만 ChoreoDoc 하나로 수렴시키고
// 필드 목록은 오늘 그대로(UNDO_FIELDS 6개 / ROUTINE_UNDO_FIELDS 3개)다.

import { UNDO_FIELDS, ROUTINE_UNDO_FIELDS, DOC_FIELDS, LINK_FIELDS } from './schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// 복제 — 브라우저의 구조적 복제 내장 함수는 도메인에서 금지라 명시적 재귀 복제를 쓴다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON 값(원시값 · 배열 · 평범한 객체)만 다루는 깊은 복제.
 * 날짜 객체/Map/Set/순환참조는 다루지 않는다 — ChoreoDoc 은 정의상 JSON 직렬화 가능하다.
 * 내장 복제 함수를 쓰지 않는 이유는 도메인 순수성 규칙 때문이며, 동작은 같다.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = cloneJsonValue(value[key]);
    return out;
  }
  return value;
}

/**
 * ChoreoDoc 깊은 복제. 키 순서는 입력 그대로 보존된다(JSON 바이트가 달라지지 않도록).
 * @param {import('./schema.js').ChoreoDoc} doc
 * @returns {import('./schema.js').ChoreoDoc}
 */
export function cloneDoc(doc) {
  return cloneJsonValue(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// 생성
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 빈 ChoreoDoc. 원본 state 초기값(1395-1399 rows 8 / cols 8 / 빈 배열 · DEFAULT_CATEGORIES 복제)에 해당한다.
 * categories 는 인자로 받는다 — DEFAULT_CATEGORIES 는 domain/defaults.js 소유라 여기서 알 수 없다.
 * @param {{ categories?: Object, rows?: number, cols?: number }} [seed]
 * @returns {import('./schema.js').ChoreoDoc}
 */
export function createEmptyDoc(seed = {}) {
  return {
    rows: seed.rows ?? 8,
    cols: seed.cols ?? 8,
    categories: cloneJsonValue(seed.categories ?? {}),
    moveLibrary: [],
    placements: [],
    routines: [],
    links: { youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: [] }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 스냅샷 — 문자열 비교로 중복을 거르므로 키 순서가 곧 동작이다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * undo 스냅샷에 들어갈 6필드만 UNDO_FIELDS 순서로 뽑는다.
 * 값이 undefined 인 키는 JSON.stringify 가 통째로 빼므로 원본의 객체 리터럴과 결과가 같다.
 * @see index.html:2833
 * @param {Object} source  state 또는 ChoreoDoc
 * @returns {Object}
 */
export function pickUndoFields(source) {
  const out = {};
  for (const key of UNDO_FIELDS) out[key] = source[key];
  return out;
}

/**
 * ChoreoDoc(또는 state)의 undo 서명 문자열. saveHistory(2864)의 중복 판정이 이 문자열 비교다.
 * @param {Object} source
 * @returns {string}
 */
export function docSignature(source) {
  return JSON.stringify(pickUndoFields(source));
}

/**
 * 메인 보드 undo 스냅샷. snapshotState(2833-2841)와 글자 단위로 같은 문자열을 낸다.
 * @see index.html:2833
 * @param {Object} state
 * @returns {string}
 */
export function snapshotMain(state) {
  return docSignature(state);
}

/**
 * 루틴 편집기 undo 스냅샷. snapshotStateRe(2900-2902)와 글자 단위로 같은 문자열을 낸다.
 * @see index.html:2900
 * @param {Object} reState
 * @returns {string}
 */
export function snapshotRoutine(reState) {
  const out = {};
  for (const key of ROUTINE_UNDO_FIELDS) out[key] = reState[key];
  return JSON.stringify(out);
}

/**
 * 스냅샷 문자열을 상태 패치로 되돌린다. restoreSnapshot(2845-2850) / undoRe(2917-2918)의 순수부다.
 *
 * kind:'main' (기본) — restoreSnapshot 과 동일한 기본값 사슬:
 *   rows||8 · cols||8 · placements||[] · moveLibrary||[] · categories 는 normalizeCategories 통과.
 *   ⚠ routines 는 **배열일 때만** 패치에 들어간다. 배열이 아니면 키 자체가 없어
 *   호출부의 기존 routines 가 그대로 남는다(원본 2850의 `if (Array.isArray(...))` 그대로).
 *
 * kind:'routine' — undoRe/redoRe 와 동일하게 **기본값 없이** rows/cols/placements 를 그대로 싣는다.
 *
 * normalizeCategories 와 defaultCategories 는 인자로 받는다(domain/categories.js 와 defaults.js 소유).
 * 기본값은 항등 함수와 빈 객체라 단독으로도 로드·테스트가 되지만,
 * ⚠ 실제 배선에서는 반드시 진짜 normalizeCategories 와 DEFAULT_CATEGORIES 를 넘겨야 원본과 같다.
 *
 * @see index.html:2844
 * @param {string} snapshot
 * @param {{ kind?: 'main'|'routine', normalizeCategories?: (c:any)=>any, defaultCategories?: Object }} [deps]
 * @returns {Object} 상태에 그대로 대입할 패치
 */
export function applySnapshot(snapshot, deps = {}) {
  const { kind = 'main', normalizeCategories = (c) => c, defaultCategories = {} } = deps;
  const data = JSON.parse(snapshot);

  if (kind === 'routine') {
    return { rows: data.rows, cols: data.cols, placements: data.placements };
  }

  const patch = {
    rows: data.rows || 8,
    cols: data.cols || 8,
    placements: data.placements || [],
    moveLibrary: data.moveLibrary || [],
    categories: normalizeCategories(data.categories || defaultCategories)
  };
  if (Array.isArray(data.routines)) patch.routines = data.routines;
  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChoreoDoc 조립 — v1 의 평평한 링크 4필드를 doc.links 로 모으는 유일한 자리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * state 처럼 링크가 평평하게 놓인 객체에서 ChoreoDoc 을 만든다(DOC_FIELDS 순서 고정).
 * ⚠ 얕은 참조다. 원본 projectPayloadWithRoutines(5273)도 state 배열을 복제하지 않고
 * 그대로 참조하므로(최근목록 항목이 이후 편집에 딸려 바뀌는 오늘의 성질) 여기서도 복제하지 않는다.
 * @param {Object} source
 * @returns {import('./schema.js').ChoreoDoc}
 */
export function toDoc(source) {
  const links = {};
  for (const key of LINK_FIELDS) links[key] = source[key];
  const doc = {};
  for (const key of DOC_FIELDS) doc[key] = key === 'links' ? links : source[key];
  return doc;
}
