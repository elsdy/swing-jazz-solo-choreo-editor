// src/domain/project/serialize.js — 파일로 내보낼 페이로드 조립 (순수, ./schema.js 만 import)
//
// 원본 index.html 의 projectPayloadWithRoutines(5273-5286) · saveMoveListFile 의 페이로드부(4049-4052) ·
// saveCategoriesFile 의 페이로드부(4060-4062)를 옮겼다.
// projectPayload(4025-4036)는 호출처가 0인 죽은 코드라 이관하지 않았다(grep 으로 확인, 아래 주석 참조).

import { LEGACY_FILE_VERSION } from './schema.js';

/** 프로젝트 파일이 이미 쓰는 최상위 키. passthrough 가 이것들을 덮어쓰지 못하게 막는다. */
const PROJECT_KEYS = new Set([
  'version', 'savedAt', 'fileName', 'rows', 'cols', 'categories', 'moveLibrary',
  'placements', 'routines', 'youtubeUrl', 'youtubeTitle', 'clickupUrl', 'customLinks'
]);

/** 카테고리 사전을 키 오름차순으로 재조립한다. 동작목록·카테고리 두 파일이 같은 규칙을 쓴다(4051·4062). */
function sortCategoriesByKey(categories) {
  return Object.fromEntries(
    Object.entries(categories).sort(([a], [b]) => a.localeCompare(b))
  );
}

/** 알 수 없는 최상위 키만 골라 되돌려준다(미래 필드가 왕복에서 사라지지 않도록). */
function unknownKeys(passthrough, known) {
  const out = {};
  if (!passthrough || typeof passthrough !== 'object') return out;
  for (const key of Object.keys(passthrough)) {
    if (!known.has(key)) out[key] = passthrough[key];
  }
  return out;
}

/**
 * 프로젝트 파일 본문. projectPayloadWithRoutines(5273-5286)를 키 순서까지 그대로 옮긴 것이다.
 *
 * ⚠ 오늘 그대로인 점 세 가지:
 *  1. `version` 은 LEGACY_FILE_VERSION(=1) 이다. SCHEMA_VERSION(=2)로 쓰면 저장 파일이 달라진다.
 *  2. state 의 배열을 **복제하지 않고 그대로 참조**한다. saveProjectFile(4041-4042)이 이 페이로드를
 *     최근목록에 그대로 넣기 때문에, 저장 후 편집이 최근목록 항목에도 비치는 오늘의 성질이 보존된다.
 *  3. `source.routines.map` 에 `|| []` 가드를 넣지 않았다 — 원본과 같은 자리에서 같이 던진다.
 *
 * savedAt 은 인자로 받는다. 도메인은 시계를 읽지 않는다(원본 5275 는 여기서 현재 시각을 직접 만든다).
 *
 * @see index.html:5273
 * @param {Object} source  state 처럼 rows/cols/categories/moveLibrary/placements/routines 와
 *                         평평한 링크 4필드를 가진 객체
 * @param {{ fileName?: string, savedAt?: string, favoriteRoutineIds?: Set<string>|string[]|null,
 *           passthrough?: Object|null }} [options]
 * @returns {import('./schema.js').ProjectFile}
 */
export function buildProjectFile(source, options = {}) {
  const { fileName = '', savedAt = '', favoriteRoutineIds = null, passthrough = null } = options;
  const favorites = favoriteRoutineIds instanceof Set
    ? favoriteRoutineIds
    : new Set(Array.isArray(favoriteRoutineIds) ? favoriteRoutineIds : []);

  return {
    version: LEGACY_FILE_VERSION,
    savedAt,
    fileName,
    rows: source.rows,
    cols: source.cols,
    categories: source.categories,
    moveLibrary: source.moveLibrary,
    placements: source.placements,
    // isFavorite 을 favoriteRoutineIds 기준으로 동기화해서 저장 (원본 5281)
    routines: source.routines.map(r => ({ ...r, isFavorite: favorites.has(r.id) })),
    youtubeUrl: source.youtubeUrl,
    youtubeTitle: source.youtubeTitle,
    clickupUrl: source.clickupUrl,
    customLinks: source.customLinks,
    ...unknownKeys(passthrough, PROJECT_KEYS)
  };
}

/** 동작목록 파일이 이미 쓰는 최상위 키. */
const MOVE_FILE_KEYS = new Set(['version', 'savedAt', 'fileName', 'categories', 'moves']);

/**
 * 동작목록 파일 본문. saveMoveListFile(4049-4052)의 페이로드부 그대로다.
 * moves 는 name 오름차순, categories 는 키 오름차순으로 정렬해서 나간다.
 * @see index.html:4049
 * @param {{ moveLibrary: {name:string}[], categories: Object }} source
 * @param {{ fileName?: string, savedAt?: string, passthrough?: Object|null }} [options]
 * @returns {Object}
 */
export function buildMoveListFile(source, options = {}) {
  const { fileName = '', savedAt = '', passthrough = null } = options;
  const sortedMoves = [...source.moveLibrary].sort((a, b) => a.name.localeCompare(b.name));
  const sortedCategories = sortCategoriesByKey(source.categories);
  return {
    version: LEGACY_FILE_VERSION,
    savedAt,
    fileName,
    categories: sortedCategories,
    moves: sortedMoves,
    ...unknownKeys(passthrough, MOVE_FILE_KEYS)
  };
}

/** 카테고리 파일이 이미 쓰는 최상위 키. */
const CATEGORY_FILE_KEYS = new Set(['version', 'savedAt', 'fileName', 'categories']);

/**
 * 카테고리 파일 본문. saveCategoriesFile(4060-4062)의 페이로드부 그대로다.
 * @see index.html:4060
 * @param {{ categories: Object }} source
 * @param {{ fileName?: string, savedAt?: string, passthrough?: Object|null }} [options]
 * @returns {Object}
 */
export function buildCategoryFile(source, options = {}) {
  const { fileName = '', savedAt = '', passthrough = null } = options;
  const sortedCategories = sortCategoriesByKey(source.categories);
  return {
    version: LEGACY_FILE_VERSION,
    savedAt,
    fileName,
    categories: sortedCategories,
    ...unknownKeys(passthrough, CATEGORY_FILE_KEYS)
  };
}
