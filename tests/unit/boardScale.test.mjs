// tests/unit/boardScale.test.mjs — 큰 안무표의 규모 시험 (RM-35, 2026-11-02)
//
//   node --test tests/unit/boardScale.test.mjs      (의존성 0, DOM 0)
//
// RM-35 는 「보드는 전 행을 다시 그린다」를 **잰 숫자로** 정한 항목이다. 여기서는 그 결정의 네 기둥을 붙잡는다.
//   ① 견본이 약속한 규모(64마디 · 300개 · 3층)인가 — tests/fixtures/bigBoard.mjs 가 자(尺)다
//   ② 되돌리기 스냅샷 문자열화(docSignature)와 자동 담기 직렬화(buildProjectFile)가 한 프레임 문턱 안인가
//   ③ 이동 · 복사 · 붙여넣기가 'all' 을 돌려주는 것은 **원칙으로 정한 동작**이다 — 플래그를 내리면 여기서 붉어진다
//   ④ changedRows(좁힌 범위 — 재기 페이지가 「좁힌 렌더」로 쓰는 값)는 떠난 · 도착 · 층이 바뀐 마디를 빠짐없이 담는가
// 브라우저 DOM 렌더 시간은 여기서 못 잰다 — tools/boardBench.html 을 열어 사람이 읽는다(계획서에 숫자가 있다).
//
// ⚠ 시간 문턱은 기계 · 부하에 따라 흔들린다. 중앙값으로 재고, 문턱은 잰 값(이 기계 0.03ms 안팎)의 수백 배인
//   한 프레임(16ms)으로 넉넉히 둔다 — RM-35 결정 사항 「느리다의 문턱 = 한 프레임」과 같은 자다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  BIG_BOARD, buildBigBoard, describeBoard, makeIds, rowFingerprints, changedRowsBetween
} from '../fixtures/bigBoard.mjs';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import { docView } from '../../src/usecases/docFields.js';
import { docSignature } from '../../src/domain/project/snapshot.js';
import { buildProjectFile } from '../../src/domain/project/serialize.js';
import {
  MOVE_POLICY, COPY_POLICY, moveGroup, copyGroup, pasteBlock, place, removeGroup
} from '../../src/domain/boardOps.js';

/** 「느리다」의 문턱(ms) — 한 프레임. RM-35 결정 사항. */
const FRAME_MS = 16;
/** 시간 재기 반복 수 — 중앙값을 본다. */
const RUNS = 30;

/** fn 을 RUNS 번 돌린 시간(ms)의 중앙값 · 최댓값. */
// @complexity time=O(k log k) space=O(k) cc=2
function timeMedian(fn) {
  const xs = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    fn();
    xs.push(performance.now() - t);
  }
  xs.sort((a, b) => a - b);
  return { median: xs[Math.floor(RUNS / 2)], max: xs[RUNS - 1] };
}

/** 큰 견본을 메인 보드에 실은 state(docView 가 읽는 모양). */
// @complexity time=O(p) space=O(p) cc=1
function bigState() {
  const board = buildBigBoard();
  const store = createStore();
  store.setBoard(BOARD_MAIN, { rows: board.rows, cols: board.cols, placements: board.placements });
  return { board, state: store.get() };
}

/** 어느 행의 어느 층에 있는 그룹 하나를 고른다. */
// @complexity time=O(p) space=O(1) cc=2
function groupAt(board, row, subRow) {
  const hit = board.placements.find(p => p.row === row && (p.subRow || 0) === subRow);
  assert.ok(hit, `${row}행 ${subRow}층에 배치가 없다`);
  return hit.groupId;
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 견본의 규모
// ─────────────────────────────────────────────────────────────────────────────

test('큰 견본은 64마디·동작 300개이고 3층까지 쌓인다', () => {
  const board = buildBigBoard();
  const d = describeBoard(board);
  assert.equal(d.rows, BIG_BOARD.rows, '마디 수');
  assert.equal(board.cols, BIG_BOARD.cols, '카운트 수');
  assert.equal(d.groups, BIG_BOARD.groups, '동작(그룹) 수');
  assert.equal(d.maxLayers, BIG_BOARD.maxLayers, '가장 깊은 층 수');
  // 1~44마디가 3층, 45~64마디가 2층 — 층은 손으로 적은 것이 아니라 place 의 findFreeLane 이 만든 것이다
  const layers = [...d.layersByRow.values()];
  assert.equal(layers.filter(n => n === 3).length, BIG_BOARD.threeLayerRows, '3층 마디 수');
  assert.equal(layers.filter(n => n === 2).length, BIG_BOARD.rows - BIG_BOARD.threeLayerRows, '2층 마디 수');
  assert.ok(!board.placements.some(p => p.row === 0), 'intro 행은 비어 있다');
  // 같은 그룹은 한 층 — D-2 의 불변식이 견본에서도 지켜진다
  const laneOfGroup = new Map();
  for (const p of board.placements) {
    const seen = laneOfGroup.get(p.groupId);
    if (seen !== undefined) assert.equal(p.subRow || 0, seen, `그룹 ${p.groupId} 의 층이 세그먼트마다 다르다`);
    laneOfGroup.set(p.groupId, p.subRow || 0);
  }
  // 결정적이다 — 두 번 만들어도 같은 지문
  assert.deepEqual([...rowFingerprints(buildBigBoard())], [...rowFingerprints(board)]);
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 스냅샷 문자열화 · 파일 직렬화의 시간
// ─────────────────────────────────────────────────────────────────────────────

test('큰 견본의 스냅샷 문자열화와 파일 직렬화가 문턱 안에 든다', () => {
  const { state } = bigState();
  const view = docView(state);

  const sig = timeMedian(() => docSignature(view));
  const file = timeMedian(() => JSON.stringify(buildProjectFile(view, { fileName: '큰 견본', savedAt: '2026-11-02T00:00:00.000Z' })));

  // 서명은 300개 블록을 품고도 수십 KB 다 — 되돌리기 중복 판정(문자열 비교)이 그대로여도 된다는 뜻이다
  assert.ok(docSignature(view).length > 10_000, '서명이 견본을 다 품지 못했다');
  assert.ok(sig.median < FRAME_MS, `docSignature 중앙값 ${sig.median.toFixed(3)}ms 가 한 프레임(${FRAME_MS}ms)을 넘는다`);
  assert.ok(file.median < FRAME_MS, `buildProjectFile+stringify 중앙값 ${file.median.toFixed(3)}ms 가 한 프레임(${FRAME_MS}ms)을 넘는다`);
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 전 행 렌더 — 원칙으로 정한 동작
// ─────────────────────────────────────────────────────────────────────────────

test('이동·복사는 전 행을 다시 그린다 — 원칙으로 정한 동작', () => {
  // 선언을 직접 읽는다 — 플래그만 뒤집은 되돌림은 결과 시험으로 못 잡는다(D-2 의 교훈)
  assert.equal(MOVE_POLICY.renderAllRows, true, 'MOVE_POLICY.renderAllRows');
  assert.equal(COPY_POLICY.renderAllRows, true, 'COPY_POLICY.renderAllRows');

  const board = buildBigBoard();
  const ids = makeIds('op');
  const from = groupAt(board, 10, 2);

  const moved = moveGroup(board, { groupId: from, targetRow: 50, targetStartIndex: 1 }, ids);
  assert.equal(moved.renderRows, 'all', '이동은 전 행을 그린다');
  // changedRows 는 정직한 범위다 — 떠난 마디와 도착한 마디를 품고, 전 행이 아니다
  assert.ok(moved.changedRows.includes(10) && moved.changedRows.includes(50), `이동 changedRows ${JSON.stringify(moved.changedRows)}`);
  assert.ok(moved.changedRows.length < BIG_BOARD.rows, 'changedRows 가 전 행이면 정직한 범위가 아니다');

  const copied = copyGroup(board, { groupId: from, targetRow: 20, targetStartIndex: 0 }, ids);
  assert.equal(copied.renderRows, 'all', '복사는 전 행을 그린다');
  assert.ok(copied.changedRows.includes(20) && !copied.changedRows.includes(10), `복사 changedRows ${JSON.stringify(copied.changedRows)}`);

  const pasted = pasteBlock(board, { block: { name: 'Shim Sham', category: 'step', count: 3 }, targetRow: 30, targetStartIndex: 2 }, ids);
  assert.equal(pasted.renderRows, 'all', '붙여넣기는 복사와 같은 규칙이다');
  assert.deepEqual(pasted.changedRows, [30]);

  // 조기 반환(없는 그룹)은 전과 같이 null — 'all' 로 뭉개지 않는다
  assert.equal(moveGroup(board, { groupId: 'ghost', targetRow: 1, targetStartIndex: 0 }, ids).renderRows, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 좁힌 범위(changedRows)의 정직성 — 2026-03 잔상 버그의 조건
// ─────────────────────────────────────────────────────────────────────────────

test('좁힌 렌더 범위는 떠난·도착·층이 바뀐 마디를 빠짐없이 담는다', () => {
  // (가) 큰 견본에서 층이 다른 블록을 여러 거리로 옮긴다 — 실제로 지문이 달라진 행 ⊆ changedRows
  const board = buildBigBoard();
  const ids = makeIds('op');
  const cases = [
    [groupAt(board, 1, 2), 60, 0],   // 3층 마디의 맨 아래층을 2층 마디로
    [groupAt(board, 5, 0), 5, 4],    // 같은 마디 안에서 옆으로 — 0층이 빠지며 아래층이 올라온다
    [groupAt(board, 44, 1), 64, 6],  // 보드 끝으로 밀어 길이가 줄어드는 경우(clamp)
    [groupAt(board, 30, 0), 31, 7]   // 다음 마디로 넘어가며 두 마디에 걸치는 경우
  ];
  const before = rowFingerprints(board);
  for (const [groupId, targetRow, targetStartIndex] of cases) {
    const r = moveGroup(board, { groupId, targetRow, targetStartIndex }, ids);
    const actual = changedRowsBetween(before, rowFingerprints({ placements: r.placements }));
    for (const row of actual) {
      assert.ok(r.changedRows.includes(row), `${groupId}→${targetRow}행: ${row}행이 바뀌었는데 changedRows ${JSON.stringify(r.changedRows)} 에 없다`);
    }
    assert.ok(actual.length > 0, '옮겼는데 바뀐 행이 없다');
  }

  // (나) 2026-03 의 잔상 조건 — 층을 함께 쓰던 **다른 마디**가 층 정리로 바뀐다.
  //      C(1행 [6..7] 0층) · A(1행 [4..7] 1층) 위에서, 1행 [7]→2행 [0] 에 걸친 B 는 2층으로 내려가고 2행도 같은 층이다.
  //      C 를 3행으로 옮기면 B 가 두 마디 모두 위로 올라온다. 떠난 마디(1)도 도착한 마디(3)도 아닌 2행이 바뀐다 —
  //      그 행을 빼먹은 것이 a3d5d5c 이전의 잔상 버그다.
  let small = { rows: 4, cols: 8, hasIntroRow: true, placements: [] };
  const sid = makeIds('s');
  const put = (row, startIndex, totalCount) => {
    const r = place(small, { move: { name: 'x', category: 'step' }, startRow: row, startIndex, totalCount }, sid);
    small = { ...small, placements: r.placements };
    return r.placements[r.placements.length - 1].groupId;
  };
  const C = put(1, 6, 2);
  put(1, 4, 4);
  const B = put(1, 7, 2);
  const beforeSmall = rowFingerprints(small);
  const bLane = small.placements.find(p => p.groupId === B).subRow || 0;
  assert.ok(bLane >= 1, '걸친 블록 B 가 아래층에 있어야 조건이 성립한다');

  const moved = moveGroup(small, { groupId: C, targetRow: 3, targetStartIndex: 0 }, sid);
  const actual = changedRowsBetween(beforeSmall, rowFingerprints({ placements: moved.placements }));
  assert.ok(actual.includes(2), `2행(걸친 블록의 둘째 마디)이 층 정리로 바뀌어야 한다 — 바뀐 행 ${JSON.stringify(actual)}`);
  for (const row of actual) {
    assert.ok(moved.changedRows.includes(row), `${row}행이 바뀌었는데 changedRows ${JSON.stringify(moved.changedRows)} 에 없다`);
  }
  assert.equal(moved.renderRows, 'all');

  // 삭제도 같은 조건을 지난다(REMOVE_POLICY 는 전 행이 아니라 renderRows 에 층 정리 행을 합친다)
  const removed = removeGroup(small, { groupId: C });
  const removedRows = changedRowsBetween(beforeSmall, rowFingerprints({ placements: removed.placements }));
  for (const row of removedRows) {
    assert.ok(removed.renderRows.includes(row), `삭제: ${row}행이 바뀌었는데 renderRows ${JSON.stringify(removed.renderRows)} 에 없다`);
  }
});
