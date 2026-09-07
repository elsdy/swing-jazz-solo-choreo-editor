// src/testing/golden-adapter.mjs — 골든 리플레이 어댑터 (rank 4, DOM 0)
//
// tests/run.mjs 가 이 파일 하나를 불러 tests/golden/placement-algorithms.json 150개를 재생한다.
// 골든은 index.html 원문에서 뽑은 "오늘의 동작"이므로, 여기서 새 도메인·유스케이스를 부른 결과가
// 그대로 맞아떨어져야 리팩터링이 동작을 바꾸지 않았다는 증명이 된다.
//
// 규칙 셋:
//   1. node 에서 DOM 없이 돌아야 한다 → **usecases 와 domain 만** 부른다. ui/input/adapters 금지.
//   2. 비결정성 0 → uid 는 ports/env.counterEnv(), 대화상자는 ports/env.silentDialogs().
//      세계(reset)마다 새로 만들므로 시나리오마다 id 가 1번부터 다시 나간다.
//   3. 렌더/경고는 **호출하지 않고 기록만** 한다. 커맨드가 돌려준 Dirty 가 유일한 정보원이다.
//
// ⚠ 이 파일은 "테스트 하네스"이지 앱의 일부가 아니다. app/main.js 의 presenter 를 흉내내지만
//   presenter 자체는 아니다 — 아래 BOARD_ORDER 주석의 예외를 보라.

import { counterEnv, silentDialogs } from '../ports/env.js';
import * as boardOps from '../domain/boardOps.js';
import { categoryNames } from '../domain/categories.js';
import {
  boardSignature, buildSegments, calcCrossRowCount, clamp, totalCellsFrom
} from '../domain/grid.js';
import { clearSegmentsArea, repackLanes } from '../domain/lanes.js';
import {
  affectedRowsByGroup, affectedRowsByMoveName, groupCount, placementRangeLabel
} from '../domain/placements.js';
import {
  BOARD_IDS, BOARD_MAIN, BOARD_ROUTINE, createStore, expandRows
} from '../usecases/store.js';
import {
  copyGroupTo, moveGroupTo, placeMoveAt, placeRoutineAt, removeGroup, resizeGroupTo, setBoardRows
} from '../usecases/boardCommands.js';
import { loadProjectFromRecent, mergeProjectFromRecent } from '../usecases/projectCommands.js';
import { setRoutineSize, syncFromEditor } from '../usecases/routineCommands.js';

// ─────────────────────────────────────────────────────────────────────────────
// 이름 대응 — 골든은 보드를 'main' | 're' 로, store 는 'main' | 'routine' 으로 부른다
// ─────────────────────────────────────────────────────────────────────────────

/** 골든의 board 문자열 → store 의 boardId. */
const BOARD_ID_OF = Object.freeze({ main: BOARD_MAIN, re: BOARD_ROUTINE });
/** store 의 boardId → 골든 로그에 적히는 board 문자열. */
const LOG_NAME_OF = Object.freeze({ [BOARD_MAIN]: 'main', [BOARD_ROUTINE]: 're' });

/** 기본 렌더 순서. FINAL-architecture 3-2 의 presenter 와 같다(main → routine). */
const BOARD_ORDER = BOARD_IDS;

/**
 * ⚠ 루틴 보드 크기 변경만 순서가 뒤집힌다.
 * 원본 applyReBoardSizeFromInput 은 renderBoard(true, reCtx)(4874) 를 먼저 부르고 그 다음
 * syncCurrentRoutine(4875)이 메인 보드의 renderRows 를 부른다. presenter 는 두 보드를 항상
 * main → routine 으로 훑으므로 로그 순서가 원본과 반대가 된다(골든 reboardsize-03).
 * 같은 tick 안의 동기 렌더라 화면 결과는 같지만, 골든은 호출 순서를 기록한다.
 * → 이 op 에서만 원문 순서를 재현한다. deviations-found.jsonl 에 기록해 두었다.
 */
const ROUTINE_FIRST_ORDER = Object.freeze([BOARD_ROUTINE, BOARD_MAIN]);

/** applyProjectData/migrations 가 요구하는 시각 포트. 골든은 시각을 관찰하지 않는다. */
const FIXED_ISO = '1970-01-01T00:00:00.000Z';

/**
 * ui/widgets.escapeHtml 의 사본. renderRowNotes(3404-3405)가 이스케이프한 문자열을 만들고
 * 골든 notes-07 이 그 결과를 그대로 비교하므로 여기서도 같은 치환·같은 순서가 필요하다.
 * ⚠ ui 를 import 할 수 없어 사본을 둔다. 원본이 바뀌면 이쪽도 함께 바꿔야 한다.
 * @param {unknown} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * ui/placementView.renderRowNotes(원본 3394-3408)를 도메인 함수로만 다시 짠 것.
 * ⚠ ui 를 import 할 수 없어 사본을 둔다. 계산은 전부 domain/placements 가 하고
 *   여기 남은 것은 필터·정렬·문자열 조립뿐이다.
 * @param {object[]} placements
 * @param {number} row
 * @param {number} cols
 * @returns {string}
 */
function renderRowNotes(placements, row, cols) {
  return placements
    .filter(p => p.row === row)
    .filter(p => {
      // 여러 행에 걸친 동작은 첫 번째 행의 비고란에만 표시 (3398-3400)
      const firstRow = Math.min(...placements.filter(s => s.groupId === p.groupId).map(s => s.row));
      return p.row === firstRow;
    })
    .sort((a, b) => a.startIndex - b.startIndex)
    .map(p => {
      if (p.type === 'routine') return escapeHtml(`▶ ${p.name}`);
      return escapeHtml(`${p.name} (${placementRangeLabel(placements, p.groupId, cols)})`);
    })
    .join('<br>');
}

// ─────────────────────────────────────────────────────────────────────────────
// 어댑터
// ─────────────────────────────────────────────────────────────────────────────

/**
 * tests/replay.mjs 상단의 adapter 계약(연산 15개 + placements/log)을 구현한다.
 * 한 인스턴스를 150개 시나리오가 돌려 쓰며 reset(setup) 이 세계를 통째로 갈아치운다.
 * @returns {object}
 */
export function createAdapter() {
  /** @type {ReturnType<typeof createStore>} */
  let store;
  /** @type {{ uid: () => string, now: () => number, nowIso: () => string }} */
  let env;
  /** @type {ReturnType<typeof silentDialogs>} */
  let dialogs;
  /** usecases 커맨드에 넘길 협력자 묶음. reset 마다 다시 만든다. */
  let deps;
  /** @type {object[]} */
  let renderLog;
  /** @type {string[]} */
  let alertLog;
  /** dialogs.calls 에서 어디까지 alertLog 로 옮겼는지. */
  let dialogCursor;

  /**
   * 골든의 시드 배치({ g, ... })를 store 의 배치로 바꾼다.
   * ⚠ groupId 는 시드의 `g` 를 **그대로** 쓴다 — 시나리오 ops 가 그 문자열로 그룹을 지목한다.
   * ⚠ JSON 은 undefined 를 못 적으므로 골든은 "키가 없다"를 null 로 적는다(merge-13 의 subRow).
   *   null 값 키를 버려야 mergePlacements 의 `p.subRow === undefined` 분기가 원본처럼 탄다.
   */
  function seedPlacement(raw) {
    const { g, ...rest } = raw;
    const out = { id: env.uid(), groupId: g };
    for (const [key, value] of Object.entries(rest)) {
      if (value === null) continue;
      out[key] = value;
    }
    return out;
  }

  /** 즉시 alert(silentDialogs.calls)를 아직 안 옮긴 것만 순서대로 옮긴다. */
  function drainDialogAlerts() {
    for (; dialogCursor < dialogs.calls.length; dialogCursor++) {
      const call = dialogs.calls[dialogCursor];
      if (call.kind === 'alert') alertLog.push(call.message);
    }
  }

  /**
   * 커맨드가 돌려준 Dirty 를 로그로 바꾼다 — presenter 가 화면에 하는 일을 기록으로만 한다.
   * 순서: 즉시 alert → 보드 렌더 → notify(병합 완료 문구). 원본 mergeProjectData 가
   * 렌더 5종(4174) 다음에 alert(4179) 를 부르는 순서와 같다.
   * @param {object|null|undefined} dirty
   * @param {readonly string[]} [order] 보드 렌더 순서
   */
  function record(dirty, order = BOARD_ORDER) {
    drainDialogAlerts();
    if (!dirty) return;
    for (const boardId of order) {
      const bd = dirty.boards && dirty.boards[boardId];
      if (!bd) continue;
      if (bd.skeleton) {
        // renderBoard(true, ctx) — 골격 재생성 + 전 행 (원본 2960·4874·4384·4174)
        renderLog.push({ fn: 'renderBoard', board: LOG_NAME_OF[boardId], force: true });
      } else {
        renderLog.push({
          fn: 'renderRows',
          board: LOG_NAME_OF[boardId],
          rows: expandRows(store.get(), boardId, bd.rows)
        });
      }
    }
    if (dirty.notify) alertLog.push(dirty.notify.message);
  }

  /**
   * boardOps 결과를 store 에 적용하고 boards Dirty 로 바꾼다.
   * usecases/boardCommands.js 의 사설 applyBoardResult 와 같은 규칙이다 —
   * `rebuild` op 만 클램프 없는 도메인 함수를 직접 부르므로 여기 한 벌이 필요하다.
   */
  function applyBoardResult(boardId, result) {
    if (result.renderRows === null) return null;   // 원본이 렌더 자체를 안 부르던 경로
    store.setBoard(boardId, { placements: result.placements });
    return { boards: { [boardId]: { rows: result.renderRows } } };
  }

  const idOf = (board) => BOARD_ID_OF[board] || BOARD_MAIN;
  const boardDoc = (board) => store.board(idOf(board));

  return {
    /**
     * 세계 초기화. 시나리오마다 store·env·dialogs·로그를 통째로 새로 만든다.
     * ⚠ createStore 를 ids 없이 부른다 — ids 를 주면 기본 동작 10개를 만들며 uid 를 10번 쓰는데,
     *   골든은 라이브러리를 setup.moves 로 덮어쓰므로 그 소비가 무의미하다.
     */
    reset(setup = {}) {
      env = { ...counterEnv({ prefix: 'g' }), nowIso: () => FIXED_ISO };
      dialogs = silentDialogs();
      store = createStore();
      renderLog = [];
      alertLog = [];
      dialogCursor = 0;

      store.setBoard(BOARD_MAIN, {
        rows: setup.rows ?? 8,
        cols: setup.cols ?? 8,
        placements: (setup.main || []).map(seedPlacement)
      });
      store.setBoard(BOARD_ROUTINE, {
        rows: setup.reRows ?? 4,
        cols: setup.reCols ?? 8,
        placements: (setup.re || []).map(seedPlacement)
      });
      store.update({
        library: (setup.moves || []).map(m => ({ ...m })),
        routines: (setup.routines || []).map(r => ({ ...r }))
      });
      // reState.routineId — 편집 중인 루틴이 있어야 syncCurrentRoutine 이 동작한다(4644)
      store.patch('session', { editingRoutineId: setup.routineId ?? null });

      deps = {
        store,
        env,
        dialogs,
        // 골든은 저장소를 관찰하지 않는다. 호출은 받되 아무것도 하지 않는다.
        storage: {
          saveRecents: () => {},
          saveRoutineFavorites: () => {},
          saveLinks: () => {}
        },
        files: { downloadJson: () => {} }
        // commitHistory/resetHistory 는 일부러 주입하지 않는다 —
        // 골든 시나리오의 op 들은 히스토리를 건드리지 않는 원본 함수들에 대응한다.
      };
    },

    // ── 배치 전이 ────────────────────────────────────────────────────────────

    placeMove({ board, moveId, row, startIndex, count }) {
      record(placeMoveAt(
        store,
        { boardId: idOf(board), moveId, startRow: row, startIndex, totalCount: count },
        { ids: env }
      ));
    },

    placeRoutine({ board, routineId, row, startIndex }) {
      record(placeRoutineAt(
        store,
        { boardId: idOf(board), routineId, startRow: row, startIndex },
        { ids: env }
      ));
    },

    moveGroup({ board, groupId, row, startIndex }) {
      record(moveGroupTo(
        store,
        { boardId: idOf(board), groupId, targetRow: row, targetStartIndex: startIndex },
        { ids: env }
      ));
    },

    copyGroup({ board, groupId, row, startIndex }) {
      record(copyGroupTo(
        store,
        { boardId: idOf(board), groupId, targetRow: row, targetStartIndex: startIndex },
        { ids: env }
      ));
    },

    /**
     * rebuildGroup(3706-3726) 그 자체 — **클램프가 없다.**
     * usecases/boardCommands.resizeGroupTo 는 원본 finalizeResize(3832)의 클램프를 안고 있으므로
     * 여기서는 도메인 함수를 직접 부른다(골든 resize-08).
     */
    rebuild({ board, groupId, count }) {
      const boardId = idOf(board);
      const result = boardOps.resizeGroup(store.board(boardId), { groupId, newCount: count }, env);
      record(applyBoardResult(boardId, result));
    },

    /**
     * finalizeResize(3828-3834) — clamp(previewCount || originalCount, 1, totalCellsFrom(origin)).
     * ⚠ resizeGroupTo 는 origin 을 인자로 받지 않고 그룹의 첫 세그먼트에서 다시 읽는다.
     *   startResize(3735)가 origin 을 `getGroup(...)[0]` 에서 채우고 리사이즈가 그룹을 옮기지
     *   않으므로 두 값은 언제나 같다(STAGE2 계약). previewCount 가 falsy 면 커맨드 쪽 `||` 폴백이
     *   groupCount 를 쓰는데 그것이 곧 originalCount 다.
     */
    finalizeResize({ board, resize }) {
      record(resizeGroupTo(
        store,
        { boardId: idOf(board), groupId: resize.groupId, newCount: resize.previewCount },
        { ids: env }
      ));
    },

    remove({ board, groupId }) {
      record(removeGroup(store, { boardId: idOf(board), groupId }));
    },

    /** repackSubRows(3506-3565). 원본은 렌더를 부르지 않는다 — 호출부가 자기 행 목록으로 부른다. */
    repack({ board, rows }) {
      const boardId = idOf(board);
      const packed = repackLanes(store.board(boardId).placements, rows);
      store.setBoard(boardId, { placements: packed.placements });
      record(null);
    },

    /** clearSegmentsArea(3487-3505). 반환한 affectedRows 가 골든의 values 에 기록된다. */
    clearArea({ board, segments, ignoreGroupId, subRow }) {
      const boardId = idOf(board);
      const res = clearSegmentsArea(store.board(boardId).placements, segments, ignoreGroupId, subRow);
      store.setBoard(boardId, { placements: res.placements });
      record(null);
      return res.affectedRows;
    },

    // ── 프로젝트 ────────────────────────────────────────────────────────────

    /**
     * 부분 채우기. 최근목록 경로를 쓰는 이유는 그쪽이 마이그레이션까지 태우는 실제 경로이면서
     * 최근목록을 건드리지 않기 때문이다(파일 경로는 pushRecent 로 저장소를 만진다).
     */
    merge({ data }) {
      record(mergeProjectFromRecent(deps, data));
    },

    /** 전체 불러오기. 위와 같은 이유로 최근목록 경로를 쓴다. */
    applyProject({ data }) {
      record(loadProjectFromRecent(deps, data));
    },

    // ── 보드 크기 ───────────────────────────────────────────────────────────

    /**
     * applyBoardSizeFromInput(2952-2962). ⚠ 골든은 입력창의 **날값**을 넘긴다(빈 문자열 포함).
     * 파싱은 원본 2953 과 input/controls.js 가 함께 쓰는 `parseInt(value || '8', 10)` 그대로다 —
     * 여기서 Math.max(1, '') 로 바로 넘기면 빈 입력이 8 이 아니라 1 이 된다(골든 boardsize-05).
     */
    boardSize({ rows }) {
      record(setBoardRows(store, { boardId: BOARD_MAIN, rows: parseInt(rows || '8', 10) }));
    },

    /** applyReBoardSizeFromInput(4862-4877). 렌더 순서는 ROUTINE_FIRST_ORDER 주석 참조. */
    reBoardSize({ rows, cols }) {
      record(setRoutineSize(deps, { rows, cols }), ROUTINE_FIRST_ORDER);
    },

    /**
     * syncCurrentRoutine(4643-4673). 편집기 보드를 시나리오가 준 내용으로 채운 뒤 커밋한다.
     * ⚠ editingRoutineId 를 여기서 지정한다 — 원본은 편집기가 열려 있을 때만 이 경로에 온다(4644).
     */
    syncRoutine({ routineId, rows, cols, placements }) {
      store.setBoard(BOARD_ROUTINE, { rows, cols, placements: (placements || []).map(seedPlacement) });
      store.patch('session', { editingRoutineId: routineId });
      record(syncFromEditor(deps));
    },

    // ── 순수 함수 직접 호출 ─────────────────────────────────────────────────

    /**
     * 도메인 순수 함수를 그대로 부른다. 반환값이 골든의 values 에 기록된다.
     * board 인자는 격자(rows/cols/hasIntroRow)와 placements 를 어느 보드에서 읽을지만 정한다.
     */
    probe({ board, fn, args = [] }) {
      const doc = boardDoc(board);
      switch (fn) {
        case 'buildSegments':          return buildSegments(args[0], args[1], args[2], doc);
        case 'totalCellsFrom':         return totalCellsFrom(args[0], args[1], doc);
        case 'calcCrossRowCount':      return calcCrossRowCount(args[0], args[1], args[2], args[3], doc);
        case 'boardSignature':         return boardSignature(doc);
        case 'clamp':                  return clamp(args[0], args[1], args[2]);
        case 'categoryNames':          return categoryNames(store.categories);
        case 'groupCount':             return groupCount(doc.placements, args[0]);
        case 'getAffectedRowsByGroup': return affectedRowsByGroup(doc.placements, args[0]);
        case 'getAffectedRowsByMoveName': return affectedRowsByMoveName(doc.placements, args[0]);
        case 'placementRangeLabel':    return placementRangeLabel(doc.placements, args[0], doc.cols);
        case 'renderRowNotes':         return renderRowNotes(doc.placements, args[0], doc.cols);
        default: throw new Error(`probe: 알 수 없는 함수 '${fn}'`);
      }
    },

    // ── 관찰 ────────────────────────────────────────────────────────────────

    placements(board) {
      return boardDoc(board).placements;
    },

    log() {
      drainDialogAlerts();
      return { render: renderLog, alerts: alertLog };
    }
  };
}
