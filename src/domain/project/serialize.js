// src/domain/project/serialize.js — 파일로 내보낼 페이로드 조립 (순수, ./schema.js·./media.js 만 import)
//
// 원본 index.html 의 projectPayloadWithRoutines(5273-5286) · saveMoveListFile 의 페이로드부(4049-4052) ·
// saveCategoriesFile 의 페이로드부(4060-4062)를 옮겼다.
// projectPayload(4025-4036)는 호출처가 0인 죽은 코드라 이관하지 않았다(grep 으로 확인, 아래 주석 참조).

import { LEGACY_FILE_VERSION, VERSIONED_FILE_VERSION, FIELD_TABLE, LINK_FIELDS } from './schema.js';
import { serializeVersions, serializePracticeLogs } from './versions.js';
import { serializeMedia } from './media.js';
import { serializePhrasing } from '../phrasing.js';
import { serializeStepTodos } from '../stepTodos.js';
import { byField } from './fields.js';

/** 판본 · 연습 기록이 파일 꼬리에 싣는 키(RM-29). 차례가 곧 바이트 차례다. */
const HISTORY_KEYS = Object.freeze(['versions', 'practiceLogs', 'baseVersionId']);

/**
 * 프로젝트 파일이 이미 쓰는 최상위 키 — **필드 등록표에서 나온다**(RM-01). passthrough 가 이것들을 덮어쓰지 못하게 막는다.
 * ⚠ 비면 키째로 빠지는 필드(media · phrasing · stepTodos)도 여기 있어야 한다 — 없으면 passthrough 가 옛 파일의 값을
 *   되살려 우리가 뺀 자리에 도로 끼워 넣는다. 손으로 적던 때 stepTodos 가 이 목록에서 빠져 있었다(2026-09-28 에 고침).
 */
const PROJECT_KEYS = new Set([
  'version', 'savedAt', 'fileName', ...FIELD_TABLE.flatMap(f => f.file),
  // 판본 · 기록의 꼬리(RM-29) — 비면 빠지므로 passthrough 가 옛 값을 되살리지 못하게 여기 둔다
  ...HISTORY_KEYS
]);

/**
 * 필드마다 파일에 싣는 법 — 등록표의 한 줄씩이다. `null` 을 돌려주면 그 필드는 키째로 빠진다.
 * source 는 state 처럼 링크 4필드가 **평평하게** 놓인 객체다(원본 projectPayloadWithRoutines 의 입력).
 */
const FILE_OPS = byField({
  rows:        s => ({ rows: s.rows }),
  cols:        s => ({ cols: s.cols }),
  categories:  s => ({ categories: s.categories }),
  moveLibrary: s => ({ moveLibrary: s.moveLibrary }),
  placements:  s => ({ placements: s.placements }),
  // isFavorite 을 favoriteRoutineIds 기준으로 동기화해서 저장 (원본 5281). `|| []` 가드를 넣지 않는다 — 원본과 같은 자리에서 같이 던진다
  routines:    (s, ctx) => ({ routines: s.routines.map(r => ({ ...r, isFavorite: ctx.favorites.has(r.id) })) }),
  links:       s => Object.fromEntries(LINK_FIELDS.map(k => [k, s[k]])),
  // ⚠ 비면 키째로 빠진다(serialize* → null). 그 기능을 한 번도 안 쓴 사람의 저장 파일은 그 기능이 들어오기 전과
  //   **바이트 단위로 같아야** 한다.
  media:       s => { const v = serializeMedia(s.media); return v ? { media: v } : null; },
  phrasing:    s => { const v = serializePhrasing(s.phrasing); return v ? { phrasing: v } : null; },
  stepTodos:   s => { const v = serializeStepTodos(s.stepTodos); return v ? { stepTodos: v } : null; }
}, 'domain/project/serialize.js');

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
 * ⚠ 2026-09 신설: `media` 블록(`{tempo, source}`)이 customLinks 뒤에 붙는다. **비어 있으면 붙지 않는다** —
 *   그래서 이 기능을 안 쓰는 사용자의 파일은 예전과 바이트가 같다(domain/project/media.serializeMedia).
 * ⚠ 필드마다 싣는 법은 위의 FILE_OPS 가 갖고, 이 함수는 등록표를 순회할 뿐이다(RM-01, 2026-09-28).
 *
 * ⚠ 오늘 그대로인 점 세 가지:
 *  1. `version` 은 LEGACY_FILE_VERSION(=1) 이다 — **판본 · 연습 기록이 있을 때만** 3 이다(RM-29, historyTail).
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
 *           passthrough?: Object|null, versions?: object[]|null, practiceLogs?: object[]|null,
 *           baseVersionId?: string }} [options]  versions · practiceLogs · baseVersionId 는 RM-29(꼬리 — historyTail)
 * @returns {import('./schema.js').ProjectFile}
 */
// @complexity time=O(n) space=O(n) cc=6
export function buildProjectFile(source, options = {}) {
  const { fileName = '', savedAt = '', favoriteRoutineIds = null, passthrough = null,
    versions = null, practiceLogs = null, baseVersionId = '' } = options;
  const favorites = favoriteRoutineIds instanceof Set
    ? favoriteRoutineIds
    : new Set(Array.isArray(favoriteRoutineIds) ? favoriteRoutineIds : []);

  const out = { version: LEGACY_FILE_VERSION, savedAt, fileName };
  // 등록표의 차례가 곧 파일의 키 차례다(원본 5273-5286 의 리터럴 차례와 같다 — schema.FIELD_TABLE 주석)
  for (const { key } of FIELD_TABLE) Object.assign(out, FILE_OPS[key](source, { favorites }));
  // ⚠ 꼬리를 **먼저** 짓는다 — historyTail 이 out.version 을 올리는데, 펼침 `{ ...out, ...historyTail(out) }` 안에서
  //   부르면 out 이 이미 펼쳐진 뒤라 version 1 이 그대로 나갔다(옛 앱이 판본 든 파일을 열어 판본을 버린다 — RM-29 시험이 잡았다).
  const tail = historyTail(out, { versions, practiceLogs, baseVersionId });
  return { ...out, ...tail, ...unknownKeys(passthrough, PROJECT_KEYS) };
}

/**
 * 판본 · 연습 기록의 꼬리(RM-29). **둘 다 비면 아무것도 싣지 않고 version 도 1 그대로다** — 판본을 안 쓴 사람의 저장
 * 바이트가 한 글자도 늘지 않는다. 하나라도 있으면 version 을 VERSIONED_FILE_VERSION 으로 올린다(옛 앱이 미래 파일로 보고
 * 거절해, 열었다 저장하며 판본을 지우는 일이 없게 — schema.SCHEMA_VERSION 주석).
 * ⚠ out 의 version 을 고친다(키 차례는 맨 앞 그대로).
 * @returns {object} 덧붙일 키들
 */
// @complexity time=O(n) space=O(n) cc=6
function historyTail(out, { versions, practiceLogs, baseVersionId }) {
  const v = serializeVersions(versions);
  const logs = serializePracticeLogs(practiceLogs);
  if (!v && !logs) return {};
  out.version = VERSIONED_FILE_VERSION;
  const tail = {};
  if (v) tail.versions = v;
  if (logs) tail.practiceLogs = logs;
  // 갈라져 나온 판본은 판본이 있을 때만 뜻이 있다
  if (v && baseVersionId) tail.baseVersionId = String(baseVersionId);
  return tail;
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
