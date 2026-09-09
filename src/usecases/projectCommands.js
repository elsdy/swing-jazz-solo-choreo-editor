// src/usecases/projectCommands.js — 저장 / 불러오기 / 부분 채우기 (usecases 계층)
//
// 원본 index.html 의 saveProjectFile(4038-4045) · saveMoveListFile(4047-4056) · saveCategoriesFile(4058-4066) ·
// mergeProjectData 절차부(4068-4071·4172-4179) · applyProjectData 절차부(4341-4342·4371-4386) ·
// handleProjectImport(4389-4406) · handleMergeImport(4408-4425) · handleMoveListImport(4427-4451) ·
// handleCategoryImport(4453-4479) · 최근목록 불러오기/삭제 콜백(4274-4281·4295-4308·4321-4335) ·
// savedSortMode 전환(2344-2355)에서 상태 전이 부분만 옮겼다.
// 파일 선택 껍데기(files[0] → text() → JSON.parse)와 localStorage 접근은 adapters 의 몫이다.

import { NONE, mergeDirty, boardOf, BOARD_MAIN } from './store.js';
import { StorageError } from '../ports/storage.js';
import { DEFAULT_CATEGORIES } from '../domain/defaults.js';
import { normalize as normalizeCategories, categoryNames } from '../domain/categories.js';
import { normalizeLibrary } from '../domain/moves.js';
import { normalizeLinks, serializeLinks } from '../domain/links.js';
import { LEGACY_FILE_VERSION } from '../domain/project/schema.js';
import { buildProjectFile, buildMoveListFile, buildCategoryFile } from '../domain/project/serialize.js';
import { normalizeProject } from '../domain/project/normalize.js';
import { migrateProjectFile } from '../domain/project/migrations.js';
import { mergeProject } from '../domain/project/merge.js';

/**
 * 이 파일의 커맨드가 받는 협력자. 전부 주입이다.
 * @typedef {Object} ProjectDeps
 * @property {ReturnType<import('./store.js').createStore>} store
 * @property {{ uid: () => string, now: () => number, nowIso: () => string }} env
 *   ⚠ nowIso() 는 `new Date().toISOString()` 의 포트면이다. ports/env.js 의 counterEnv 에는 없으므로
 *     테스트는 `{ ...counterEnv(), nowIso: () => '2024-01-01T00:00:00.000Z' }` 로 감싸 넘겨라.
 * @property {{ alert: (message: string) => void }} dialogs
 * @property {{ downloadJson: (payload: unknown, fileName: string) => unknown }} files
 * @property {{ saveRecents: (kind: RecentKind, list: unknown[]) => unknown,
 *              saveRoutineFavorites: (ids: Iterable<string>) => unknown,
 *              saveLinks: (links: object) => unknown }} storage
 *   ⚠ 셋 다 동기다(오늘 localStorage.setItem 그대로). 실패는 던지거나 `{ ok:false }` 로 알린다 —
 *     임포트 경로는 둘 다 오늘의 catch 와 같은 alert 로 흡수한다.
 * @property {(fileName: string) => void} [setProjectFileName]  원본 4379 `fileNameInput.value = …`
 * @property {(boardId: 'main'|'routine') => import('./store.js').Dirty|void} [commitHistory] 원본 saveHistory()
 */

/** @typedef {'projects'|'moves'|'categories'} RecentKind */

/**
 * 최근목록 상한. 프로젝트 10개, 동작목록·카테고리 각 3개(원본 4042·4053·4063).
 * ⚠ 프로젝트 항목은 payload 전체를 품는다 — choreo_saved_files 가 쿼터에 실제로 닿는 유일한 키다.
 */
export const RECENT_LIMITS = Object.freeze({ projects: 10, moves: 3, categories: 3 });

/** 원본의 `new Date().toISOString()`. usecases 는 Date 를 쓸 수 없으므로 포트를 통한다. */
function nowIso(env) {
  if (!env || typeof env.nowIso !== 'function') {
    throw new TypeError('ProjectDeps.env.nowIso() 가 필요하다 — adapters/browser.js 의 browserEnv 가 제공한다');
  }
  return env.nowIso();
}

/** 원본 saveHistory() + updateHistoryButtons() 한 쌍. */
function commitMainHistory(deps) {
  const extra = typeof deps.commitHistory === 'function' ? deps.commitHistory(BOARD_MAIN) : null;
  return mergeDirty({ history: true }, extra);
}

/**
 * 히스토리·직렬화가 기대하는 **평평한 state 뷰**. store 는 보드를 boards.main 아래 두지만
 * 프로젝트 파일과 undo 스냅샷은 원본 state 의 평평한 모양(rows/cols/placements/moveLibrary/…)을 쓴다.
 * 링크 4필드는 최상위로 펼친다(저장 키 순서를 바꾸지 않기 위해).
 */
function mainView(state) {
  const board = boardOf(state, BOARD_MAIN);
  return {
    rows: board.rows,
    cols: board.cols,
    placements: board.placements,
    moveLibrary: state.library,
    categories: state.categories,
    routines: state.routines,
    ...state.links,
    // media 는 링크와 달리 **평평하게 풀지 않는다** — 원래 블록 하나이고, 비어 있으면
    // buildProjectFile 이 키째로 뺀다(저장 바이트가 예전과 같아야 한다).
    media: state.media
  };
}

/** 저장소가 `{ ok:false }` 로 실패를 알리면 오늘 throw 가 잡히던 자리와 같게 예외로 바꾼다. */
function persist(result, what) {
  if (result && typeof result === 'object' && result.ok === false) {
    throw new StorageError(result.code || 'UNAVAILABLE', `${what} 저장 실패`, result.cause);
  }
  return result;
}

/**
 * 최근목록 맨 앞에 넣고 같은 이름을 지운 뒤 상한만큼 자른다(4042·4053·4063·4398·4417·4443·4471).
 * ⚠ **임포트와 저장 경로 전용**이다. 최근목록에서 항목을 여는 경로는 목록을 건드리지 않는다 —
 *   통합하면 항목을 열 때마다 순서가 맨 앞으로 바뀐다(원본에 없는 동작).
 * @returns {import('./store.js').Dirty}
 */
function pushRecent(deps, kind, entry) {
  const { store, storage } = deps;
  const list = [entry, ...store.get().recents[kind].filter(f => f.fileName !== entry.fileName)]
    .slice(0, RECENT_LIMITS[kind]);
  store.patch('recents', { [kind]: list });
  persist(storage.saveRecents(kind, list), kind);
  return { savedLists: [kind] };
}

/** 임포트한 파일 이름에서 확장자를 뗀다(4396·4415·4440·4468). 파일의 **원래 이름**을 넘겨라. */
function baseName(fileName) {
  return String(fileName == null ? '' : fileName).replace(/\.[^.]+$/, '');
}

/**
 * 역직렬화 경계에서 **정확히 한 번** 마이그레이션을 태운다.
 *
 * 배선 지점 3곳: 전체 임포트(4394) · 부분 임포트(4413) · 최근목록 항목 로드(4274-4275).
 * ⚠ 세 번째를 빠뜨리면 임포트가 최근목록에 v2 를 넣는데 로드는 v1 로 읽어
 *   choreo_saved_files 안에서 두 포맷이 섞인다.
 * ⚠ 실패(NOT_AN_OBJECT / FUTURE_SCHEMA / NO_MIGRATION_PATH)는 **날값을 그대로 통과**시킨다.
 *   오늘 index.html 에는 version 을 읽는 코드가 한 줄도 없어서 어떤 JSON 이든 열리려 시도하며,
 *   여기서 새 안내 문구를 띄우면 동작 변경이다(설계 판단: 이번 PR 에서는 배선하지 않는다).
 * ⚠ 되펼치는 한 줄 `{ ...res.value, ...res.value.doc }` 은 v2 문서를 v1 진입 규약(평평한 최상위)으로
 *   되돌린다. v2 는 링크 4필드 미러를 최상위에 유지하므로 applyLinksData 도 그대로 먹는다.
 */
function readProjectData(raw, env) {
  const res = migrateProjectFile(raw, { now: () => nowIso(env) });
  if (!res.ok) return raw;
  return { ...res.value, ...res.value.doc };
}

// ─────────────────────────────────────────────────────────────────────────────
// 저장
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 프로젝트 파일 저장(saveProjectFile 4038-4045).
 * ⚠ 내려받기(4041)가 최근목록 쓰기(4043)보다 **먼저**다. 쿼터가 차면 "파일은 받아졌는데 목록엔 없음"이
 *   되는데 그게 오늘 동작이다.
 * ⚠ 기본 파일명의 날짜와 payload.savedAt 은 원본이 `new Date()` 를 두 번 부른 것을 그대로 따라
 *   각각 env.nowIso() 를 부른다(입력이 비었을 때만 두 번).
 * @see index.html:4038
 * @param {ProjectDeps} deps
 * @param {{ fileName?: string }} [options] fileNameInput 의 날값
 * @returns {import('./store.js').Dirty}
 */
export function saveProject(deps, options = {}) {
  const { store, env, files } = deps;
  const state = store.get();
  const raw = typeof options.fileName === 'string' ? options.fileName : '';
  const fileName = (raw.trim() || `project_${nowIso(env).slice(0, 10)}`).replace(/\.+$/g, '');
  const payload = buildProjectFile(mainView(state), {
    fileName,
    savedAt: nowIso(env),
    favoriteRoutineIds: state.favorites.routineIds
  });
  files.downloadJson(payload, `${fileName}-project.json`);
  return pushRecent(deps, 'projects', { fileName, savedAt: payload.savedAt, data: payload });
}

/**
 * 동작목록 파일 저장(saveMoveListFile 4047-4056). moves 는 이름순, categories 는 키순으로 나간다.
 * @see index.html:4047
 * @param {ProjectDeps} deps
 * @param {{ fileName?: string }} [options] moveListFileNameInput 의 날값
 * @returns {import('./store.js').Dirty}
 */
export function saveMoveList(deps, options = {}) {
  const { store, env, files } = deps;
  const state = store.get();
  const raw = typeof options.fileName === 'string' ? options.fileName : '';
  const fileName = (raw.trim() || `moves_${nowIso(env).slice(0, 10)}`).replace(/\.+$/g, '');
  const payload = buildMoveListFile(
    { moveLibrary: state.library, categories: state.categories },
    { fileName, savedAt: nowIso(env) }
  );
  files.downloadJson(payload, `${fileName}-moves.json`);
  return pushRecent(deps, 'moves', { fileName, savedAt: payload.savedAt, data: payload });
}

/**
 * 카테고리 파일 저장(saveCategoriesFile 4058-4066).
 * @see index.html:4058
 * @param {ProjectDeps} deps
 * @param {{ fileName?: string }} [options] categoryFileNameInput 의 날값
 * @returns {import('./store.js').Dirty}
 */
export function saveCategories(deps, options = {}) {
  const { store, env, files } = deps;
  const state = store.get();
  const raw = typeof options.fileName === 'string' ? options.fileName : '';
  const fileName = (raw.trim() || `categories_${nowIso(env).slice(0, 10)}`).replace(/\.+$/g, '');
  const payload = buildCategoryFile({ categories: state.categories }, { fileName, savedAt: nowIso(env) });
  files.downloadJson(payload, `${fileName}-categories.json`);
  return pushRecent(deps, 'categories', { fileName, savedAt: payload.savedAt, data: payload });
}

// ─────────────────────────────────────────────────────────────────────────────
// 전체 불러오기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * applyProjectData(4341-4387)의 절차부. 마이그레이션은 이미 끝난 데이터를 받는다.
 *
 * 순서가 곧 계약이다(4342 → 4386):
 *   ① normalizeProject 가 null → alert('잘못된 프로젝트 파일 형식입니다.') 하고 아무것도 안 한다
 *   ② rows·cols·categories·moveLibrary·placements·routines·favoriteRoutineIds 일곱을 대입
 *   ③ ⚠ routines 유무 **두 갈래 모두에서** saveRoutineFavorites() (4373·4377)
 *   ④ fileNameInput.value = fileName (4379)
 *   ④' media 대입 — 신설(2026-09). 원본 대응 줄이 없다. `부분 채우기` 에는 **없다**
 *   ⑤ applyLinksData(data) — 링크 정규화 + choreo_links 저장 + 링크바 렌더 (4380)
 *   ⑥ 렌더 5종(4381-4385) ⑦ saveHistory() (4386)
 * ⚠ renderCategoryOptions 는 categories 대입 **직후**(4346)라 항상 함께 더러워진다.
 */
function applyProjectData(deps, data) {
  const { store, env, dialogs, storage } = deps;
  const normalized = normalizeProject(data, { ids: env, defaultCategories: DEFAULT_CATEGORIES });
  if (!normalized) {
    dialogs.alert('잘못된 프로젝트 파일 형식입니다.');               // 4342
    return NONE;
  }

  store.setBoard(BOARD_MAIN, {
    rows: normalized.rows,                                          // 4343
    cols: normalized.cols,                                          // 4344
    placements: normalized.placements                               // 4349-4361
  });
  store.update({
    categories: normalized.categories,                              // 4345
    library: normalized.moveLibrary,                                // 4347
    routines: normalized.routines                                   // 4363-4375
  });
  // media(템포·소스)는 신설이라 원본 대응 줄이 없다. **`media` 가 없는 옛 파일은 여기서
  // DEFAULT_MEDIA 로 떨어지므로** 열리는 모습이 지금과 똑같다(normalize.js 참조).
  store.update({ media: normalized.media });
  store.patch('favorites', { routineIds: normalized.favoriteRoutineIds }); // 4372·4376
  storage.saveRoutineFavorites([...normalized.favoriteRoutineIds]);  // 4373·4377 (두 갈래 모두)

  if (typeof deps.setProjectFileName === 'function') {
    deps.setProjectFileName(normalized.fileName);                    // 4379
  }

  // applyLinksData(4380 → 5118-5127): 항목까지 정규화하고(id 없으면 발급) 즉시 저장한다
  const links = normalizeLinks(data, { normalizeCustomItems: true, ids: env });
  store.update({ links });
  storage.saveLinks(serializeLinks(links));                          // 5125 saveLinks()

  const dirty = {
    categorySelect: true,     // 4346 renderCategoryOptions
    links: true,              // 5126 renderLinksBar
    layout: true,             // 4381 syncBoardSizeUI → updateMobileCellSize
    toolbar: true,            // 4381 syncBoardSizeUI → boardColsInput.value / boardTitle
    legend: true,             // 4382
    palette: true,            // 4383
    boards: { [BOARD_MAIN]: { rows: 'all', skeleton: true } },       // 4384 renderBoard(true)
    routineList: true,        // 4385
    video: true               // 2026-09 신설 — 불러온 템포·소스를 패널에 반영한다(닫혀 있으면 무해)
  };
  return mergeDirty(dirty, commitMainHistory(deps));                 // 4386
}

/**
 * 파일에서 전체 불러오기(handleProjectImport 4389-4406).
 *
 * ⚠ 형식이 틀려도 최근목록에는 **들어간다** — 원본은 applyProjectData 안의 alert 로 되돌아온 뒤에도
 *   4396-4400 을 계속 실행한다. 이 관찰 동작을 그대로 둔다.
 * ⚠ catch 는 오늘 JSON.parse 와 localStorage.setItem 을 함께 감싸던 것이다(4401-4403).
 *   파싱은 어댑터가 하므로 여기서는 저장 실패가 같은 문구로 흡수된다.
 * @see index.html:4389
 * @param {ProjectDeps} deps
 * @param {{ data: unknown, fileName: string }} input  fileName 은 확장자를 포함한 **원래 파일 이름**
 * @returns {import('./store.js').Dirty}
 */
export function loadProjectFromFile(deps, input) {
  let dirty = NONE;
  try {
    const data = readProjectData(input.data, deps.env);              // 4394 (+ 마이그레이션)
    dirty = mergeDirty(dirty, applyProjectData(deps, data));         // 4395
    const fileName = baseName(input.fileName);                       // 4396
    const savedAt = data && data.savedAt ? data.savedAt : nowIso(deps.env); // 4397
    dirty = mergeDirty(dirty, pushRecent(deps, 'projects', { fileName, savedAt, data })); // 4398-4400
  } catch {
    deps.dialogs.alert('올바른 프로젝트 파일이 아닙니다.');            // 4402
  }
  return dirty;
}

/**
 * 최근 프로젝트 항목으로 전체 불러오기(renderSavedList 의 '전체 불러오기' 4275).
 * ⚠ 최근목록을 건드리지 않는다 — 임포트 경로와 통합하지 말 것.
 * @see index.html:4275
 * @param {ProjectDeps} deps
 * @param {unknown} data  최근목록 항목의 data
 * @returns {import('./store.js').Dirty}
 */
export function loadProjectFromRecent(deps, data) {
  return applyProjectData(deps, readProjectData(data, deps.env));
}

// ─────────────────────────────────────────────────────────────────────────────
// 부분 채우기(병합)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mergeProjectData(4068-4180)의 절차부.
 *
 * ⚠ 진입 엄격도가 전체 불러오기와 다르다: placements 가 배열이기만 하면 통과한다(4069).
 * ⚠ 도메인이 돌려준 categories·moveLibrary·routines·placements **넷 다** 대입해야 원본과 같다.
 * ⚠ alert 가 **맨 마지막**이다(4174-4179: 렌더 5종 → saveHistory → alert). 그래서 이 문구만
 *   Dirty.notify 로 싣는다 — presenter 가 notify 를 마지막에 적용하기 때문이다.
 *   반대로 '잘못된 프로젝트 파일 형식입니다.'(4069)는 즉시 떠야 해서 dialogs.alert 를 직접 부른다.
 */
function mergeProjectData(deps, data) {
  const { store, env, dialogs } = deps;
  const state = store.get();
  const main = boardOf(state, BOARD_MAIN);
  const res = mergeProject({
    rows: main.rows,
    cols: main.cols,
    categories: state.categories,
    moveLibrary: state.library,
    routines: state.routines,
    placements: main.placements
  }, data, { ids: env });

  if (!res.ok) {
    dialogs.alert('잘못된 프로젝트 파일 형식입니다.');                // 4069
    return NONE;
  }

  store.setBoard(BOARD_MAIN, { placements: res.placements });        // 4169
  store.update({
    categories: res.categories,                                      // 4073
    library: res.moveLibrary,                                        // 4079
    routines: res.routines                                           // 4106
  });

  const total = res.added + res.stacked;                             // 4176
  const message = `병합 완료: ${total}개 그룹 배치됨`
    + (res.stacked ? ` (${res.stacked}개 충돌 → 아래 레이어)` : ''); // 4177-4178

  const dirty = {
    categorySelect: true,                                            // 4174
    legend: true,                                                    // 4174
    palette: true,                                                   // 4174
    boards: { [BOARD_MAIN]: { rows: 'all', skeleton: true } },        // 4174 renderBoard(true)
    routineList: true                                                // 4175
  };
  return mergeDirty(
    mergeDirty(dirty, commitMainHistory(deps)),                      // 4175 saveHistory
    { notify: { kind: 'alert', message } }                           // 4179 (반드시 마지막)
  );
}

/**
 * 파일에서 부분 채우기(handleMergeImport 4408-4425). 최근목록 맨 앞에 넣는 것도 임포트 경로 전용이다.
 * @see index.html:4408
 * @param {ProjectDeps} deps
 * @param {{ data: unknown, fileName: string }} input  fileName 은 확장자 포함 원래 파일 이름
 * @returns {import('./store.js').Dirty}
 */
export function mergeProjectFromFile(deps, input) {
  let dirty = NONE;
  try {
    const data = readProjectData(input.data, deps.env);              // 4413 (+ 마이그레이션)
    dirty = mergeDirty(dirty, mergeProjectData(deps, data));         // 4414
    const fileName = baseName(input.fileName);                       // 4415
    const savedAt = data && data.savedAt ? data.savedAt : nowIso(deps.env); // 4416
    dirty = mergeDirty(dirty, pushRecent(deps, 'projects', { fileName, savedAt, data })); // 4417-4419
  } catch {
    deps.dialogs.alert('올바른 프로젝트 파일이 아닙니다.');            // 4421
  }
  return dirty;
}

/**
 * 최근 프로젝트 항목으로 부분 채우기(renderSavedList 의 '부분 불러오기' 4274).
 * ⚠ 매니페스트 exports 에 빠져 있던 항목이다 — 이게 없으면 최근목록의 '부분 불러오기' 버튼이 배선되지 않는다.
 * @see index.html:4274
 * @param {ProjectDeps} deps
 * @param {unknown} data
 * @returns {import('./store.js').Dirty}
 */
export function mergeProjectFromRecent(deps, data) {
  return mergeProjectData(deps, readProjectData(data, deps.env));
}

// ─────────────────────────────────────────────────────────────────────────────
// 동작목록 / 카테고리 파일
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 동작목록 적용 공통부(4433-4439 ≡ 4297-4300).
 * ⚠ categories 는 파일에 있을 때만 갈아끼운다. 그 다음에야 normalizeLibrary 가 불리는 순서가
 *   fallback 카테고리를 결정한다(원본이 전역 state.categories 를 읽던 순서 그대로).
 * ⚠ renderBoard(true) 가 포함된다(4438·4300) — 동작 이름만 바뀌어도 보드를 통째로 다시 그린다.
 */
function applyMoveListData(deps, data, rawMoves) {
  const { store, env } = deps;
  if (data && data.categories) {
    store.update({ categories: normalizeCategories(data.categories) }); // 4433·4297
  }
  const categories = store.get().categories;
  store.update({ library: normalizeLibrary(rawMoves, categories, env) }); // 4435·4299

  const dirty = {
    categorySelect: true,                                            // 4434·4298
    legend: true,                                                    // 4436·4300
    palette: true,                                                   // 4437·4300
    boards: { [BOARD_MAIN]: { rows: 'all', skeleton: true } }         // 4438·4300
  };
  return mergeDirty(dirty, commitMainHistory(deps));                  // 4439·4300
}

/**
 * 파일에서 동작목록 불러오기(handleMoveListImport 4427-4451).
 * ⚠ 최상위가 **바레 배열**인 파일도 받아준다(4435). 이 관용은 임포트 경로 전용이며
 *   최근목록 로드(4299)에는 없다 — 합치지 말 것.
 * ⚠ 최근목록에 넣는 snapshot(4442)은 buildMoveListFile 과 **다르다**: 정렬하지 않고 현재 상태를
 *   그대로 담는다. 그래서 serialize.js 를 쓰지 않고 여기서 리터럴로 만든다.
 * @see index.html:4427
 * @param {ProjectDeps} deps
 * @param {{ data: unknown, fileName: string }} input
 * @returns {import('./store.js').Dirty}
 */
export function loadMoveListFromFile(deps, input) {
  const { store, env } = deps;
  let dirty = NONE;
  try {
    const data = input.data;
    const rawMoves = Array.isArray(data) ? data : ((data && (data.moves || data.moveLibrary)) || []); // 4435
    dirty = mergeDirty(dirty, applyMoveListData(deps, data, rawMoves));

    const fileName = baseName(input.fileName);                       // 4440
    const savedAt = (data && data.savedAt) || nowIso(env);           // 4441
    const state = store.get();
    const snapshot = {                                               // 4442
      version: LEGACY_FILE_VERSION,
      savedAt,
      fileName,
      categories: state.categories,
      moves: state.library
    };
    dirty = mergeDirty(dirty, pushRecent(deps, 'moves', { fileName, savedAt, data: snapshot })); // 4443-4445
  } catch {
    deps.dialogs.alert('동작 파일을 읽을 수 없습니다.');               // 4447
  }
  return dirty;
}

/**
 * 최근 동작목록 항목 불러오기(renderSavedMoveList 4295-4301). 목록을 건드리지 않는다.
 * @see index.html:4295
 * @param {ProjectDeps} deps
 * @param {any} data
 * @returns {import('./store.js').Dirty}
 */
export function loadMoveListFromRecent(deps, data) {
  const rawMoves = (data && (data.moves || data.moveLibrary)) || [];  // 4299 (바레 배열 관용 없음)
  return applyMoveListData(deps, data, rawMoves);
}

/**
 * 카테고리 적용 공통부(4459-4467 ≡ 4323-4328).
 * ⚠ `data.categories || data` — 카테고리 사전만 든 파일도 받는다(4459·4323).
 * ⚠ 동작 라이브러리를 새 사전 기준으로 다시 정규화하고(4461·4325), 보드 배치의 category 도
 *   없는 키면 첫 카테고리로 되돌린다(4462-4463·4326-4327).
 */
function applyCategoryData(deps, data) {
  const { store, env } = deps;
  const categories = normalizeCategories((data && data.categories) || data); // 4459·4323
  store.update({ categories });
  store.update(s => ({ library: normalizeLibrary(s.library, categories, env) })); // 4461·4325

  const fallback = categoryNames(categories)[0];                     // 4462·4326
  const main = boardOf(store.get(), BOARD_MAIN);
  store.setBoard(BOARD_MAIN, {
    placements: main.placements.map(p => ({                          // 4463·4327
      ...p,
      category: categories[p.category] ? p.category : fallback
    }))
  });

  const dirty = {
    categorySelect: true,                                            // 4460·4324
    legend: true,                                                    // 4464·4328
    palette: true,                                                   // 4465·4328
    boards: { [BOARD_MAIN]: { rows: 'all', skeleton: true } }         // 4466·4328
  };
  return mergeDirty(dirty, commitMainHistory(deps));                  // 4467·4328
}

/**
 * 파일에서 카테고리 불러오기(handleCategoryImport 4453-4479).
 * ⚠ 최근목록 snapshot(4470)도 정렬 없이 현재 사전을 그대로 담는다(buildCategoryFile 과 다르다).
 * @see index.html:4453
 * @param {ProjectDeps} deps
 * @param {{ data: unknown, fileName: string }} input
 * @returns {import('./store.js').Dirty}
 */
export function loadCategoriesFromFile(deps, input) {
  const { store, env } = deps;
  let dirty = NONE;
  try {
    const data = input.data;
    dirty = mergeDirty(dirty, applyCategoryData(deps, data));

    const fileName = baseName(input.fileName);                       // 4468
    const savedAt = (data && data.savedAt) || nowIso(env);           // 4469
    const snapshot = {                                               // 4470
      version: LEGACY_FILE_VERSION,
      savedAt,
      fileName,
      categories: store.get().categories
    };
    dirty = mergeDirty(dirty, pushRecent(deps, 'categories', { fileName, savedAt, data: snapshot })); // 4471-4473
  } catch {
    deps.dialogs.alert('카테고리 파일을 읽을 수 없습니다.');           // 4475
  }
  return dirty;
}

/**
 * 최근 카테고리 항목 불러오기(renderSavedCategoryList 4321-4329). 목록을 건드리지 않는다.
 * @see index.html:4321
 * @param {ProjectDeps} deps
 * @param {any} data
 * @returns {import('./store.js').Dirty}
 */
export function loadCategoriesFromRecent(deps, data) {
  return applyCategoryData(deps, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// 최근목록 관리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 최근목록 항목 삭제(4278-4280·4304-4306·4332-4334). confirmOnce 2단계 확인은 ui/widgets 가 이미 통과시킨다.
 * ⚠ 원본에 try/catch 가 없다 — 저장 실패는 그대로 터진다. 여기서 삼키면 오늘 동작이 바뀐다.
 * @see index.html:4278
 * @param {ProjectDeps} deps
 * @param {RecentKind} kind
 * @param {string} fileName
 * @returns {import('./store.js').Dirty}
 */
export function removeRecent(deps, kind, fileName) {
  const { store, storage } = deps;
  const list = store.get().recents[kind].filter(f => f.fileName !== fileName);
  store.patch('recents', { [kind]: list });
  persist(storage.saveRecents(kind, list), kind);
  return { savedLists: [kind] };
}

/**
 * 최근 프로젝트 목록 정렬 전환(2344-2355). 'recent' | 'alpha'.
 * ⚠ 보존해야 하는 결함: 이 값은 **프로젝트 목록에만** 걸린다(4265). 동작목록(4290)·카테고리(4316)
 *   목록은 정렬하지 않으므로 Dirty 에 'moves'/'categories' 를 실으면 안 된다 — 실으면 화면 순서가 바뀐다.
 * @see index.html:2344
 * @param {ProjectDeps} deps
 * @param {'recent'|'alpha'} mode
 * @returns {import('./store.js').Dirty}
 */
export function setRecentSort(deps, mode) {
  deps.store.patch('session', { recentSortMode: mode });
  return { savedLists: ['projects'] };
}
