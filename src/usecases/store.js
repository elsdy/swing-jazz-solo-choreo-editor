// src/usecases/store.js — 단일 저장소 + Dirty 기술자 + mergeDirty (usecases 계층)
//
// 원본 index.html 의 state(1394-1423) · reState(1426-1440) · savedSortMode(1518) ·
// 가변 DEFAULT_COUNT(1384) · _routineColorIdx(4497)을 한 값 객체로 모았다.
// DOM 캐시(rowRefs 1408·1431, moveContextMenu 1411, quickPickerEl 1440, boardSig 1407·1435)와
// 제스처 상태(drag 1400·1432, resize 1402·1433)는 여기 없다 — ui/input 계층 소유다.

import { DEFAULT_CATEGORIES, DEFAULT_COUNT_INITIAL, makeDefaultMoves } from '../domain/defaults.js';
import { cloneCategories } from '../domain/categories.js';
import { rowIndices } from '../domain/grid.js';
import { normalizeMedia } from '../domain/project/media.js';

// ─────────────────────────────────────────────────────────────────────────────
// 보드 식별자와 보드별 정책
// ─────────────────────────────────────────────────────────────────────────────

export const BOARD_MAIN = 'main';
export const BOARD_ROUTINE = 'routine';

/** 렌더 순회용 고정 순서. app/render 와 골든 어댑터가 이 순서를 쓴다. */
export const BOARD_IDS = Object.freeze([BOARD_MAIN, BOARD_ROUTINE]);

/**
 * 원본의 `ctx === mainCtx` 분기 14곳 중 "보드의 역할"에 해당하는 것을 데이터로 바꾼 표.
 * - hasIntroRow        : intro 행(row 0) 생성 여부 (3324) — grid.rowIndices/rowCount 가 읽는다
 * - allowsRoutineBlocks: 루틴 블록 drop(2429) / 루틴 배치 삭제 차단(2470·2503·2539)
 * - allowsSelection    : createPlacementEl 의 .is-selected (3424)
 * - overflowRows       : 보드 크기 축소 시 행 초과 배치를 버리는가(메인 2955) 남기는가(루틴 4869)
 * - snapshotKind       : domain/project/snapshot.applySnapshot 의 kind 인자
 */
export const BOARD_POLICY = Object.freeze({
  [BOARD_MAIN]: Object.freeze({
    hasIntroRow: true,
    allowsRoutineBlocks: true,
    allowsSelection: true,
    overflowRows: 'drop',
    snapshotKind: 'main'
  }),
  [BOARD_ROUTINE]: Object.freeze({
    hasIntroRow: false,
    allowsRoutineBlocks: false,
    allowsSelection: false,
    overflowRows: 'keep',
    snapshotKind: 'routine'
  })
});

// ─────────────────────────────────────────────────────────────────────────────
// Dirty — "무엇을 다시 그릴지"를 값으로 만든 기술자
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{ rows?: number[]|'all', skeleton?: true }} BoardDirty */
/**
 * @typedef {{
 *   layout?: true,
 *   boards?: { main?: BoardDirty, routine?: BoardDirty },
 *   selection?: true,
 *   palette?: true, legend?: true, categorySelect?: true, categoryManager?: true,
 *   routineList?: true, routineEditor?: true,
 *   savedLists?: ('projects'|'moves'|'categories')[],
 *   links?: true, toolbar?: true, history?: true, video?: true,
 *   notify?: { kind:'alert', message:string }
 * }} Dirty
 */

/** 아무것도 다시 그릴 것이 없다. 커맨드가 무동작일 때 이걸 돌려준다. */
export const NONE = Object.freeze({});

/** 불리언 플래그 전부. presenter 의 적용 순서와는 무관하다(순서는 app/render 가 안다). */
const DIRTY_FLAGS = Object.freeze([
  'layout', 'selection', 'palette', 'legend', 'categorySelect', 'categoryManager',
  'routineList', 'routineEditor', 'links', 'toolbar', 'history',
  // 2026-09 신설(영상 패널). 패널 열림/접힘·따라가기·템포 표시가 이 플래그로 다시 그려진다.
  // ⚠ **재생 헤드는 이 플래그를 쓰지 않는다.** 재생 위치는 초당 60번 바뀌므로 렌더 파이프라인을
  //   타면 안 된다 — 뷰의 rAF 루프가 자기 엘리먼트의 transform 만 직접 쓴다(docs/PORTS.md 채널 B).
  'video'
]);
const DIRTY_KEYS = new Set([...DIRTY_FLAGS, 'boards', 'savedLists', 'notify']);
const BOARD_DIRTY_KEYS = new Set(['rows', 'skeleton']);
const SAVED_LIST_KEYS = new Set(['projects', 'moves', 'categories']);

/**
 * rows 병합. ⚠ 한쪽이 없으면 **있는 쪽을 그대로 복사**한다(중복 제거도 하지 않는다) —
 * mergeDirty(NONE, d) 가 d 를 글자 하나 바꾸지 않아야 골든의 renderRows 로그가 보존된다
 * (원본 clearSegmentsArea 의 affectedRows 는 중복을 포함한다). 둘 다 있을 때만 합집합.
 */
function mergeRows(a, b) {
  if (a === undefined) return Array.isArray(b) ? b.slice() : b;
  if (b === undefined) return Array.isArray(a) ? a.slice() : a;
  if (a === 'all' || b === 'all') return 'all';
  const out = [];
  const seen = new Set();
  for (const row of [...a, ...b]) {
    if (seen.has(row)) continue;
    seen.add(row);
    out.push(row);
  }
  return out;
}

function mergeBoardDirty(a, b) {
  if (a === undefined && b === undefined) return undefined;
  const out = {};
  const rows = mergeRows(a?.rows, b?.rows);
  if (rows !== undefined) out.rows = rows;
  if (a?.skeleton || b?.skeleton) out.skeleton = true;
  return out; // 빈 객체도 그대로 — "키가 있다"는 사실 자체가 정보다
}

function mergeBoardsDirty(a, b) {
  if (!a && !b) return undefined;
  const out = {};
  for (const id of BOARD_IDS) {
    const merged = mergeBoardDirty(a?.[id], b?.[id]);
    if (merged !== undefined) out[id] = merged;
  }
  return out;
}

function mergeSavedLists(a, b) {
  if (!a && !b) return undefined;
  if (!a) return b.slice();
  if (!b) return a.slice();
  const out = [];
  for (const key of [...a, ...b]) if (!out.includes(key)) out.push(key);
  return out;
}

/**
 * 두 Dirty 를 합친다. **순수 함수** — 입력을 변형하지 않고 중첩 구조도 새로 만든다.
 * rows 합집합('all' 이 흡수) · 불리언 OR · savedLists 합집합 · notify 는 나중 것이 이긴다.
 * @param {Dirty|null|undefined} a
 * @param {Dirty|null|undefined} b
 * @returns {Dirty}
 */
export function mergeDirty(a, b) {
  const left = a || {};
  const right = b || {};
  const out = {};
  for (const flag of DIRTY_FLAGS) if (left[flag] || right[flag]) out[flag] = true;
  const boards = mergeBoardsDirty(left.boards, right.boards);
  if (boards !== undefined) out.boards = boards;
  const savedLists = mergeSavedLists(left.savedLists, right.savedLists);
  if (savedLists !== undefined) out.savedLists = savedLists;
  const notify = right.notify !== undefined ? right.notify : left.notify;
  if (notify !== undefined) out.notify = { ...notify };
  return out;
}

/**
 * 개발용 검증. 알 수 없는 키가 있으면 던진다 — 오타 하나로 화면이 조용히 안 그려지는 것을 막는다.
 * 운영 경로에서 부르지 말 것(app/main 의 DEV 분기에서만 부른다).
 * @param {Dirty} d
 * @param {string} [label]
 * @returns {Dirty}
 */
export function assertDirty(d, label = 'Dirty') {
  if (d === undefined || d === null) return d;
  if (typeof d !== 'object' || Array.isArray(d)) throw new TypeError(`${label}: 객체가 아니다`);
  for (const key of Object.keys(d)) {
    if (!DIRTY_KEYS.has(key)) throw new TypeError(`${label}: 알 수 없는 키 '${key}'`);
    if (DIRTY_FLAGS.includes(key) && typeof d[key] !== 'boolean') {
      throw new TypeError(`${label}.${key}: 불리언이어야 한다`);
    }
  }
  if (d.boards !== undefined) {
    if (typeof d.boards !== 'object' || d.boards === null) throw new TypeError(`${label}.boards: 맵이어야 한다`);
    for (const id of Object.keys(d.boards)) {
      if (!BOARD_IDS.includes(id)) throw new TypeError(`${label}.boards: 알 수 없는 보드 '${id}'`);
      const bd = d.boards[id];
      if (typeof bd !== 'object' || bd === null) throw new TypeError(`${label}.boards.${id}: 객체여야 한다`);
      for (const key of Object.keys(bd)) {
        if (!BOARD_DIRTY_KEYS.has(key)) throw new TypeError(`${label}.boards.${id}: 알 수 없는 키 '${key}'`);
      }
      if (bd.rows !== undefined && bd.rows !== 'all' && !Array.isArray(bd.rows)) {
        throw new TypeError(`${label}.boards.${id}.rows: number[] 또는 'all'`);
      }
    }
  }
  if (d.savedLists !== undefined) {
    if (!Array.isArray(d.savedLists)) throw new TypeError(`${label}.savedLists: 배열이어야 한다`);
    for (const key of d.savedLists) {
      if (!SAVED_LIST_KEYS.has(key)) throw new TypeError(`${label}.savedLists: 알 수 없는 목록 '${key}'`);
    }
  }
  if (d.notify !== undefined) {
    if (typeof d.notify !== 'object' || d.notify === null) throw new TypeError(`${label}.notify: 객체여야 한다`);
    if (d.notify.kind !== 'alert') throw new TypeError(`${label}.notify.kind: 'alert' 만 지원한다`);
    if (typeof d.notify.message !== 'string') throw new TypeError(`${label}.notify.message: 문자열이어야 한다`);
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ rows:number, cols:number, hasIntroRow:boolean, placements:Object[] }} BoardDoc
 *   ⚠ rows 는 마지막 행 인덱스다(행 개수 아님). domain/grid.js 상단 경고 참조.
 */

/**
 * 초기 상태. 원본 state(1394-1423) · reState(1426-1440)의 전 필드가 여기 있거나,
 * 없다면 아래 주석이 어디로 갔는지 밝힌다.
 * @param {(() => string) | { uid: () => string } | null} ids
 */
function createInitialState(ids) {
  // 여기 없는 원본 필드와 그 새 주인:
  //   drag(1400·1432)     → input/dragSession. ⚠ 원본 3084-3085 는 팔레트 dragstart 에서
  //                          state.drag 와 reState.drag 에 **같은 객체**를 대입한다 —
  //                          두 보드가 하나의 드래그를 공유한다. 별칭이 아니라 단일 소유로 옮겨야 한다.
  //   resize(1402·1433)   → input/pointerSession
  //   rowRefs(1408·1431)  → ui/boardView (직렬화 대상 state 에서 축출)
  //   boardSignature/boardSig(1407·1435) → ui/boardView
  //   moveContextMenu(1411) → ui/paletteView
  //   quickPickerEl(1440)   → ui/quickPicker
  //   history/future(1409-1410·1437-1438) → usecases/historyCommands 의 HistoryStack ×2
  return {
    // 두 보드의 데이터. 이것만이 JSON 직렬화 대상이다.
    boards: {
      [BOARD_MAIN]: { rows: 8, cols: 8, hasIntroRow: true, placements: [] },      // 1395-1397
      [BOARD_ROUTINE]: { rows: 4, cols: 8, hasIntroRow: false, placements: [] }   // 1428-1430
    },
    library: ids ? makeDefaultMoves(ids) : [],          // state.moveLibrary (1398 + init 1523)
    categories: cloneCategories(DEFAULT_CATEGORIES),    // 1399
    routines: [],                                       // 1416
    favorites: {
      moveNames: new Set(),   // 1411 ⚠ id 가 아니라 **이름**이 키다(3061-3062). 이름을 바꾸면 즐겨찾기가 풀린다
      categories: new Set(),  // 1412
      routineIds: new Set()   // 1417
    },
    links: {                  // 1419-1422 — 평평한 4필드를 한 구획으로만 모았다(직렬화 키는 그대로)
      youtubeUrl: '',
      youtubeTitle: '',
      clickupUrl: '',
      customLinks: []
    },
    // 2026-09 신설(영상 패널). 원본에 대응물이 없다. `{tempo, source}` 블록 하나이며
    // UNDO_FIELDS·DOC_FIELDS 의 8번째 필드다 — Undo 로 되돌아오고 파일에도 실린다(비었으면 안 실린다).
    // ⚠ 재생 위치·재생 상태는 여기 **절대** 넣지 마라. 아래 session.video 도 마찬가지다 —
    //   거기 있는 것은 "패널이 열려 있나" 같은 화면 상태이지 시각이 아니다.
    media: normalizeMedia(null),
    recents: {                // 1403-1405, 각각 상한 10 / 3 / 3 (4042·4053·4063)
      projects: [],
      moves: [],
      categories: []
    },
    palette: {
      searchQuery: '',        // 원본은 #paletteSearch 를 직독했다(3057). 도메인에 DOM 을 들이지 않으려 여기 둔다
      sortMode: 'alpha',      // 1414 'alpha' | 'added' | 'category'
      sortDir: 'asc'          // 1415 'asc' | 'desc'
    },
    selection: new Set(),     // 1418 selectedGroupIds — 메인 보드 전용(BOARD_POLICY.allowsSelection)
    session: {
      // ⚠ 소유권 확정: activePaletteMove 와 quickPlaceMode 는 **store 소유이고 보드마다 하나씩**이다.
      //   activePaletteMove 를 input 에 두면 renderPalette(3066)가 .palette-active 를 못 붙여
      //   draw-to-place 의 유일한 피드백이 사라진다(1401 ↔ 1434 는 원래 독립 필드다).
      //   quickPlaceMode 도 버튼이 둘이고 완전히 독립이다(1413 토글 1679-1694 ↔ 1436 토글 4838-4849).
      activePaletteMove: { [BOARD_MAIN]: null, [BOARD_ROUTINE]: null },
      quickPlaceMode: { [BOARD_MAIN]: false, [BOARD_ROUTINE]: false },
      defaultCount: DEFAULT_COUNT_INITIAL,  // 1384 의 가변 모듈 전역
      editingRoutineId: null,               // reState.routineId (1427)
      routineColorIdx: 0,                   // _routineColorIdx (4497). ⚠ 저장하지 않는다(보존 대상 결함)
      recentSortMode: 'recent',             // savedSortMode (1518) 'recent' | 'alpha'
      // 영상 패널의 **휘발성** 상태(2026-09). 저장하지도 Undo 하지도 않는다.
      //   open      패널이 열려 있는가 (닫힌 상태가 기본 — 켜야 보이는 기능이다)
      //   collapsed 헤더만 남기고 접었는가
      //   follow    재생 위치를 안무표가 따라가는가("따라가기")
      //   tempoPoints 두 점 앵커를 찍는 중 모아 둔 점들. 두 개가 차면 Tempo 로 접히고 비워진다
      //   taps      탭 템포로 누른 시각(초). 확정되면 비워진다
      //   inSec/outSec  In·Out 지점(초, 없으면 null). 잘라내기와 마커 만들기의 재료이고 확정 전 값이라 휘발성이다
      //   loop      In~Out 구간을 반복 재생하는가
      //   captureSec 받아 적는 중인 구간의 시작(초, 아니면 null). 끝을 찍는 순간 블록이 되고 비워진다
      // ⚠ 여기에도 재생 위치(currentSec)는 없다. 있으면 초당 60번 store 가 바뀐다.
      video: { open: false, collapsed: false, follow: true, tempoPoints: [], taps: [], inSec: null, outSec: null, loop: false, captureSec: null },
      // 자세 분석의 **요약만** 둔다(2026-09-12). 관절점 수만 개는 app/main.js 가 모듈 변수로 들고 있다 —
      // store 에 넣으면 undo 스냅샷이 그만큼 불어나고, 되돌릴 값도 아니다(usecases/poseCommands.js 경계 ①).
      pose: { state: 'idle', done: 0, total: 0, error: '', frames: 0, maxSubjects: 0,
              trackIds: [], activeId: '', anchors: [], ambiguous: 0, lost: 0, fromSec: 0, toSec: 0, showMesh: true }
    }
  };
}

/**
 * 상태에서 BoardDoc 하나를 꺼낸다. 도메인(grid/lanes/boardOps)에 넘길 유일한 통로이며
 * 원본의 `ctx === mainCtx` 분기 14곳을 대체한다.
 * @param {Object} state
 * @param {'main'|'routine'} boardId
 * @returns {BoardDoc}
 */
export function boardOf(state, boardId) {
  const board = state.boards[boardId];
  if (!board) throw new TypeError(`알 수 없는 보드 '${boardId}'`);
  return board;
}

/**
 * BoardDirty.rows 를 실제 행 인덱스 배열로 편다. 'all' 은 grid.rowIndices 로,
 * 배열은 그대로, 없으면 빈 배열. presenter 와 골든 어댑터가 같은 규칙을 쓰게 한다.
 * @param {Object} state
 * @param {'main'|'routine'} boardId
 * @param {number[]|'all'|undefined} rows
 * @returns {number[]}
 */
export function expandRows(state, boardId, rows) {
  if (rows === 'all') return rowIndices(boardOf(state, boardId));
  return Array.isArray(rows) ? rows : [];
}

/**
 * 저장소를 만든다. **관찰자 패턴이 없다** — 유스케이스가 Dirty 를 돌려주고
 * 호출부(app/render)가 그것을 소비한다. 구독 API 를 추가하지 말 것(설계에서 잘라냈다).
 *
 * @param {{ ids?: (() => string) | { uid: () => string } } & Object} [initial]
 *   `ids` 는 uid 생성기다. 원본은 DEFAULT_MOVES(1444)를 모듈 로드 시 만들며 uid 를 10번 먼저
 *   소비하므로, app/main 은 다른 무엇보다 먼저 createStore({ ids: env }) 를 불러야 id 소비 순서가 같다.
 *   나머지 키는 최상위 얕은 패치로 적용된다(테스트에서 보드를 미리 채울 때 쓴다).
 */
export function createStore(initial = {}) {
  const { ids = null, ...seed } = initial;
  let state = createInitialState(ids);
  if (Object.keys(seed).length) state = { ...state, ...seed };

  const store = {
    /** 현재 상태(읽기 전용으로 다뤄라). */
    get() { return state; },
    get state() { return state; },

    /**
     * 최상위 얕은 병합. 함수를 주면 fn(state) 의 반환값을 패치로 쓴다(undefined 면 무변경).
     * @returns {Object} 새 상태
     */
    update(patchOrFn) {
      const patch = typeof patchOrFn === 'function' ? patchOrFn(state) : patchOrFn;
      if (!patch) return state;
      state = { ...state, ...patch };
      return state;
    },

    /**
     * 1단 중첩 구획(session·palette·links·media·recents·favorites)을 병합한다.
     * @param {'session'|'palette'|'links'|'media'|'recents'|'favorites'} section
     */
    patch(section, values) {
      if (section === 'boards') throw new TypeError("boards 는 setBoard(boardId, values) 로 갱신한다");
      if (!(section in state)) throw new TypeError(`알 수 없는 구획 '${section}'`);
      state = { ...state, [section]: { ...state[section], ...values } };
      return state;
    },

    /** BoardDoc 접근자. store.board('main') / store.board('routine'). */
    board(boardId) { return boardOf(state, boardId); },

    /** BoardDoc 하나를 병합 갱신한다. hasIntroRow 는 정책이라 덮어쓰지 않는다. */
    setBoard(boardId, values) {
      const board = boardOf(state, boardId);
      const next = { ...board, ...values, hasIntroRow: board.hasIntroRow };
      state = { ...state, boards: { ...state.boards, [boardId]: next } };
      return state;
    },

    /** 보드별 정책(hasIntroRow·allowsRoutineBlocks·allowsSelection·overflowRows·snapshotKind). */
    policy(boardId) {
      const policy = BOARD_POLICY[boardId];
      if (!policy) throw new TypeError(`알 수 없는 보드 '${boardId}'`);
      return policy;
    },

    /** 보드 뷰 한 행을 그리는 데 필요한 값 묶음(3424·3437·3441 이 읽던 것). drag 는 input 이 따로 준다. */
    viewDeps(boardId) {
      return {
        boardId,
        board: boardOf(state, boardId),
        policy: store.policy(boardId),
        categories: state.categories,
        routines: state.routines,
        selection: state.selection
      };
    },

    // 자주 읽는 구획의 읽기 전용 접근자 — app/render 가 store.categories 처럼 쓴다
    get boards() { return state.boards; },
    get library() { return state.library; },
    get categories() { return state.categories; },
    get routines() { return state.routines; },
    get favorites() { return state.favorites; },
    get links() { return state.links; },
    get media() { return state.media; },
    get recents() { return state.recents; },
    get palette() { return state.palette; },
    get selection() { return state.selection; },
    get session() { return state.session; }
  };

  return store;
}
