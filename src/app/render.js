// src/app/render.js — Dirty → 뷰 호출 (app 계층)
//
// 원본 index.html 에는 render*() 호출이 143곳 흩어져 있었다(renderPalette 31 · renderRows 19 ·
// renderBoard 17 · renderCategoryOptions 15 · renderLegend 14 · renderRoutineList 13 …).
// 그 전부가 이 파일 한 표로 모인다. 커맨드는 "무엇을 다시 그릴지"를 값(Dirty)으로 돌려주고,
// 여기서만 그 값을 뷰 호출로 바꾼다. **앱에서 뷰를 아는 유일한 파일이다.**
//
// ⚠⚠ 렌더 순서가 이 파일의 전부다 — layout → boards → selection → 패널 → notify.
//   ① layout 이 가장 먼저다. 원본 applyBoardSizeFromInput(2952-2962)이
//      syncBoardSizeUI() → updateMobileCellSize()(CSS 변수 쓰기) **다음에** renderBoard(true) 를
//      부른다. 순서를 뒤집으면 낡은 --cellW 로 골격이 서고 --noteW 측정(scrollWidth)이 한 프레임 어긋난다.
//   ② categorySelect 는 categoryManager 를 **함께** 그린다. 원본 renderCategoryOptions(2967)가
//      무조건 renderCategoryManager() 를 부르는 사슬이 여기서만 재현된다. 반대는 아니다 —
//      색 슬라이더 input 핸들러(2982-2988)는 manager 를 일부러 다시 그리지 않는다
//      (매 input 마다 다시 그리면 <input type="color"> 가 파괴돼 네이티브 피커가 첫 드래그에서 닫힌다).
//   ③ selection 은 행을 다시 그리지 않는다. 클래스만 토글하고(boardView.setSelected),
//      재렌더 시 복원은 placementView 가 store.selection 을 읽어 따로 한다 — 오늘의 두 경로다.
//   ④ notify(alert)는 **맨 마지막**이다. 부분 불러오기의 '병합 완료…' 가 렌더 뒤에 떠야
//      원본 mergeProjectData(4174-4179)와 같은 순서가 된다.
//
// ⚠ 이 파일은 커맨드를 부르지 않는다. store 는 **읽기만** 한다.

import { BOARD_IDS, BOARD_MAIN, expandRows, assertDirty } from '../usecases/store.js';
import * as Grid from '../domain/grid.js';

/**
 * @typedef {import('../usecases/store.js').Dirty} Dirty
 */

/**
 * presenter 를 만든다. `views` 는 app/main 이 채우는 **가변 객체**여도 된다 —
 * 이 함수는 호출 시점에 `views.x` 를 다시 읽으므로, 뷰가 서로를 필요로 하는 순환 배선
 * (뷰 → render → 뷰)을 빈 객체 하나로 끊을 수 있다.
 *
 * @param {object} store usecases/store.js 의 createStore(...) 결과
 * @param {{
 *   layout?: { syncCellSize(): void },
 *   board?: { main?: object, routine?: object },
 *   toolbar?: { render(): void, syncHistory(): void, syncSelection(): void },
 *   palette?: { render(): void },
 *   category?: { renderOptions(): void, renderManager(): void, renderLegend(): void },
 *   routineList?: { render(): void },
 *   routineEditor?: { sync(): void, syncHistory(): void },
 *   savedLists?: { render(kind: string, list?: unknown[]): void },
 *   linksBar?: { render(links?: object, titleFetch?: object): void },
 *   video?: { render(): void, renderStatus(): void },
 *   notify?: (n: { kind: 'alert', message: string }) => void
 * }} views
 * @param {{ dev?: boolean, paranoid?: boolean }} [options]
 *   dev: assertDirty + assertDirtyCovers 를 켠다. **운영 경로에서 켜지 마라**(던진다).
 *   paranoid: 보드가 더러우면 그 보드의 전 행을 다시 그린다(`?render=full`). 기본 off —
 *   기본값을 켜면 '덜 그리는' 회귀는 막지만 매 렌더가 배치 엘리먼트를 재생성해 동작이 달라진다.
 * @returns {(d: Dirty, opts?: { paranoid?: boolean }) => void}
 */
export function createRenderer(store, views, options = {}) {
  const { dev = false, paranoid: paranoidDefault = false } = options;

  /** dev 전용. 직전에 그린 시점의 행 지문 — assertDirtyCovers 가 다음 호출과 비교한다. */
  let lastSeen = null;

  return function apply(d, opts = {}) {
    if (!d) return;                       // 커맨드가 void 를 돌려줘도 안전하다
    if (dev) assertDirty(d, 'render');    // 오타 하나로 화면이 조용히 안 그려지는 것을 막는다
    const paranoid = opts.paranoid !== undefined ? opts.paranoid : paranoidDefault;

    // ── ① layout — CSS 변수가 보드 골격보다 먼저다 ─────────────────────────
    if (d.layout) views.layout?.syncCellSize();

    // ── ② boards — { main, routine } 맵을 고정 순서로 순회 ─────────────────
    // ⚠ paranoid 라도 rebuild 는 하지 않는다. 골격 재생성은 innerHTML 을 날려
    //   떠 있는 프리뷰·고스트를 지운다(드래그 중 동작이 바뀐다).
    // ⚠ 'all' 을 여기서 손으로 펴지 마라 — store.expandRows 가 유일한 규칙이다.
    for (const boardId of BOARD_IDS) {
      const b = d.boards?.[boardId];
      if (!b) continue;
      const view = views.board?.[boardId];
      if (!view) continue;
      if (b.skeleton) view.rebuild(store.board(boardId));
      const rows = paranoid
        ? Grid.rowIndices(store.board(boardId))
        : expandRows(store.get(), boardId, b.rows);
      view.updateRows(rows, store.viewDeps(boardId));
    }
    // 메인 보드가 다시 그려졌으면 재생 헤드의 캐시(칸 폭·켜 둔 블록)를 버린다. 헤드 자체는 여기서
    // 그리지 않는다(채널 B) — 다음 rAF 프레임이 스스로 다시 잰다.
    if (d.layout || d.boards?.[BOARD_MAIN]) views.playhead?.invalidate();

    // ── ③ selection — 행 재렌더 없이 클래스만 ──────────────────────────────
    // ⚠ **전체 선택 집합**을 넘긴다(바뀐 것만이 아니다). 루틴 보드에는 붙는 게 없다
    //   (policy.allowsSelection === false).
    if (d.selection) {
      views.board?.main?.setSelected(store.selection);
      views.toolbar?.syncSelection();
      // 영상 패널의 `선택한 블록이 여기서 시작` 은 선택에 따라 켜지고 꺼진다. 패널 전체가 아니라 템포 구획만 다시 그린다.
      views.video?.syncSelection();
    }

    // ── ④ 패널 ────────────────────────────────────────────────────────────
    if (d.palette) views.palette?.render();
    if (d.legend) views.category?.renderLegend();
    if (d.categorySelect) {
      // 원본 2967 의 무조건 사슬. renderOptions 는 스스로 renderManager 를 부르지 않는다.
      views.category?.renderOptions();
      views.category?.renderManager();
    } else if (d.categoryManager) {
      views.category?.renderManager();
    }
    if (d.routineList) views.routineList?.render();
    if (d.routineEditor) views.routineEditor?.sync();
    // ⚠ 영상 패널은 **루틴 편집기와 동시에 열리지 않는다**(CSS 가 `[data-routine="on"]` 으로 가린다).
    //   그래서 편집기 개폐도 이 패널을 다시 그려야 한다 — 안 그리면 숨겨진 채 소리만 계속 난다.
    // ⚠ 재생 헤드는 이 경로를 타지 **않는다**. 초당 60회 재렌더가 된다(ui/playhead.js 채널 B).
    if (d.video || d.routineEditor) views.video?.render();
    if (d.savedLists) {
      for (const kind of d.savedLists) views.savedLists?.render(kind, store.recents[kind]);
    }
    // ⚠ titleFetch 를 넘기지 않는다 — linksBarView 가 주입받은 titleFetchState() 로 재도출한다.
    //   여기서 usecases/linkCommands 를 부르면 presenter 가 커맨드 계층을 알게 된다.
    if (d.links) views.linksBar?.render(store.links);
    // 툴바와 루틴 편집기 버튼 disabled 를 **함께** 맞춘다(원본 updateHistoryButtons 2888 /
    // updateReHistoryButtons 2894 는 따로였지만, 둘 다 멱등이라 함께 불러도 결과가 같다).
    if (d.history) {
      views.toolbar?.syncHistory();
      views.routineEditor?.syncHistory();
    }
    if (d.toolbar) views.toolbar?.render();

    // ── ⑤ notify — 언제나 마지막(원본 mergeProjectData 4174-4179 의 순서) ──
    if (d.notify) views.notify?.(d.notify);

    if (dev) lastSeen = assertDirtyCovers(store, d, lastSeen);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEV 안전장치 — "덜 그리는" 회귀는 이 앱의 실제 버그 이력이다 (cc590a7 · a3d5d5c)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 보드 두 개의 **행별 지문**. 같은 행의 배치가 하나라도 달라지면 문자열이 달라진다.
 * @param {object} store
 * @returns {{ main: Map<number,string>, routine: Map<number,string> }}
 */
function rowFingerprints(store) {
  const out = {};
  for (const boardId of BOARD_IDS) {
    const board = store.board(boardId);
    const byRow = new Map();
    for (const row of Grid.rowIndices(board)) byRow.set(row, '');
    for (const p of board.placements) {
      const prev = byRow.get(p.row);
      if (prev === undefined) continue;   // 격자 밖 배치(루틴 overflowRows:'keep')는 그릴 행이 없다
      byRow.set(p.row, `${prev}|${p.groupId}:${p.startIndex}:${p.length}:${p.subRow}:${p.name}:${p.category}`);
    }
    out[boardId] = byRow;
  }
  return out;
}

/**
 * 실제로 바뀐 행이 Dirty 에 덮이는지 검사한다. **DEV 전용** — 운영 경로에서 부르지 마라.
 *
 * 커맨드가 `boards` 를 빠뜨려도 boardView.renderRows 의 자가치유 가드가 골격은 살려 주지만
 * "그 행만 조용히 안 그려지는" 침묵 실패는 남는다. 그것을 즉시 던져서 잡는다.
 * ⚠ 배치가 안 바뀌었는데 다시 그려야 하는 경우(선택 표시·카테고리 색)는 여기서 못 잡는다 —
 *   그건 paranoid 모드가 받는다.
 *
 * @param {object} store
 * @param {Dirty} d 방금 적용한 Dirty
 * @param {{main:Map<number,string>,routine:Map<number,string>}|null} before
 *   직전 호출이 돌려준 지문. null 이면 검사를 건너뛰고 기준선만 만든다.
 * @returns {{main:Map<number,string>,routine:Map<number,string>}} 다음 호출에 넘길 지문
 */
export function assertDirtyCovers(store, d, before) {
  const after = rowFingerprints(store);
  if (!before) return after;
  for (const boardId of BOARD_IDS) {
    const b = d?.boards?.[boardId];
    const covered = b
      ? new Set(b.rows === 'all' ? [...after[boardId].keys()] : expandRows(store.get(), boardId, b.rows))
      : new Set();
    // 골격을 다시 세웠으면 그 보드는 전부 다시 그려졌다.
    if (b?.skeleton) continue;
    for (const [row, sig] of after[boardId]) {
      if (before[boardId].get(row) === sig) continue;
      if (covered.has(row)) continue;
      throw new Error(
        `render: ${boardId} 보드 ${row}행이 바뀌었는데 Dirty 가 덮지 않는다 — ` +
        `커맨드의 boards.${boardId}.rows 를 확인하라 (Dirty: ${JSON.stringify(d)})`
      );
    }
  }
  return after;
}
