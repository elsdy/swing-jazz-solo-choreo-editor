// tests/fixtures/bigBoard.mjs — 규모를 재는 큰 견본 안무표 (RM-35, 2026-11-02)
//
// 64마디 × 8카운트, 동작 300개, 가장 깊은 곳이 3층인 메인 보드를 **도메인 함수(boardOps.place)로 쌓아** 만든다.
// 손으로 적은 배치 목록이 아니라 실제 놓기 규칙(findFreeLane — 겹치면 아래층으로)을 거친 결과라서,
// 층이 어떻게 생기는지도 운영 코드와 같다. node 시험(tests/unit/boardScale.test.mjs)과 브라우저 재기 페이지
// (tools/boardBench.html)가 **같은 자**로 쓰기 위해 node 전용 import 없이 순수 ES 모듈로 둔다.
//
// 층을 만드는 법 — 한 마디의 8칸을 네 겹으로 덮는다(모두 place 가 빈 레인을 찾아 내려간 결과다):
//   ① 0층: [0..3] · [4..7] 두 블록으로 마디를 꽉 채운다           — 64마디 × 2 = 128개
//   ② 1층: [2..5] 하나가 ① 둘과 겹쳐 1층으로 내려간다              — 64마디 × 1 =  64개
//   ③ 1층: [0..1] 하나가 ① 과 겹치지만 ② 와는 안 겹쳐 1층에 들어간다  — 64마디 × 1 =  64개
//   ④ 2층: [3..4] 하나가 ①·② 와 겹쳐 2층으로 내려간다 — 앞 44마디만  — 44마디 × 1 =  44개
//                                                                       합계 300개
// 그래서 1~44마디는 3층(subRow 0·1·2), 45~64마디는 2층이다. intro 행(0행)은 비워 둔다 — 원본 격자의 꼴을 지키되
// 자를 단순하게 두기 위한 것이고, 재기 페이지가 "떠난 마디·도착한 마디"를 고를 때 1행부터 쓴다.

import { place } from '../../src/domain/boardOps.js';
import { DEFAULT_CATEGORIES } from '../../src/domain/defaults.js';

/** 견본의 규모. 시험이 이 숫자와 실제 결과를 대조한다. */
export const BIG_BOARD = Object.freeze({
  rows: 64,          // 마디 수(= board.rows, 마지막 행 인덱스)
  cols: 8,           // 한 마디의 카운트
  groups: 300,       // 동작(그룹) 수
  maxLayers: 3,      // 가장 깊은 마디의 층 수(subRow 0·1·2)
  threeLayerRows: 44 // 3층까지 쌓인 마디 수(1~44)
});

/** 블록 이름 · 카테고리 견본 — 색이 모두 다르게 나오도록 기본 카테고리 여섯을 돌려 쓴다. */
const NAMES = ['Shim Sham', 'Suzie Q', 'Boogie Back', 'Fall Off the Log', 'Tacky Annie', 'Half Break', 'Shorty George', 'Apple Jack'];
const CATEGORY_KEYS = Object.keys(DEFAULT_CATEGORIES);

/** 재현 가능한 uid — 견본을 두 번 만들어도 같은 id 가 나와 지문 · 스냅샷 비교가 흔들리지 않는다. */
// @complexity time=O(1) space=O(1) cc=1
export function makeIds(prefix = 'big') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/**
 * 네 겹의 놓기 계획을 (마디, 시작 칸, 길이) 차례로 편다. 위의 ①~④ 그대로다.
 * @param {{rows:number, threeLayerRows:number}} size
 * @returns {{row:number, startIndex:number, totalCount:number}[]}
 */
// @complexity time=O(n) space=O(n) cc=5
function layoutPlan(size) {
  const plan = [];
  for (let row = 1; row <= size.rows; row++) {                          // ①
    plan.push({ row, startIndex: 0, totalCount: 4 });
    plan.push({ row, startIndex: 4, totalCount: 4 });
  }
  for (let row = 1; row <= size.rows; row++) plan.push({ row, startIndex: 2, totalCount: 4 });   // ②
  for (let row = 1; row <= size.rows; row++) plan.push({ row, startIndex: 0, totalCount: 2 });   // ③
  for (let row = 1; row <= size.threeLayerRows; row++) plan.push({ row, startIndex: 3, totalCount: 2 }); // ④
  return plan;
}

/**
 * 큰 견본 보드를 만든다. 돌려주는 것은 boardOps 가 받는 모양 `{rows, cols, hasIntroRow, placements}` 다.
 *
 * @param {{ ids?: () => string, size?: Partial<typeof BIG_BOARD> }} [options]
 *   ids 를 넘기지 않으면 makeIds() 의 결정적 id 를 쓴다. size 로 규모를 줄여 작은 견본을 만들 수도 있다(시험의 대조용).
 * @returns {{rows:number, cols:number, hasIntroRow:boolean, placements:object[]}}
 */
// @complexity time=O(n·p) space=O(p) cc=3
export function buildBigBoard(options = {}) {
  const size = { ...BIG_BOARD, ...(options.size || {}) };
  const ids = options.ids || makeIds();
  let board = { rows: size.rows, cols: size.cols, hasIntroRow: true, placements: [] };
  let k = 0;
  for (const step of layoutPlan(size)) {
    const move = { name: NAMES[k % NAMES.length], category: CATEGORY_KEYS[k % CATEGORY_KEYS.length] };
    k++;
    const result = place(board, { move, startRow: step.row, startIndex: step.startIndex, totalCount: step.totalCount }, ids);
    if (result.renderRows === null) throw new Error(`bigBoard: ${step.row}행 ${step.startIndex}칸에 놓지 못했다`);
    board = { ...board, placements: result.placements };
  }
  return board;
}

/**
 * 견본의 모양을 센다 — 시험과 재기 페이지가 「정말 64마디 · 300개 · 3층인가」를 같은 식으로 확인한다.
 * @param {{rows:number, placements:object[]}} board
 * @returns {{ rows:number, groups:number, maxLayers:number, layersByRow:Map<number,number> }}
 */
// @complexity time=O(p) space=O(r) cc=3
export function describeBoard(board) {
  const groups = new Set();
  const layersByRow = new Map();
  for (const p of board.placements) {
    groups.add(p.groupId);
    const layers = (p.subRow || 0) + 1;
    if ((layersByRow.get(p.row) || 0) < layers) layersByRow.set(p.row, layers);
  }
  const maxLayers = Math.max(0, ...layersByRow.values());
  return { rows: board.rows, groups: groups.size, maxLayers, layersByRow };
}

/**
 * 한 행의 지문 — 그 행의 배치가 하나라도 달라지면 문자열이 달라진다. app/render.js 의 rowFingerprints 와 같은 재료
 * (groupId · startIndex · length · subRow · name · category)를 쓰되, **같은 행 안의 차례에 흔들리지 않게** 정렬한다.
 * 시험 · 재기 페이지가 「어느 마디가 실제로 바뀌었나」를 셀 때 쓴다.
 * @param {{placements:object[]}} board
 * @returns {Map<number,string>}
 */
// @complexity time=O(p log p) space=O(p) cc=2
export function rowFingerprints(board) {
  const parts = new Map();
  for (const p of board.placements) {
    if (!parts.has(p.row)) parts.set(p.row, []);
    parts.get(p.row).push(`${p.groupId}:${p.startIndex}:${p.length}:${p.subRow || 0}:${p.name}:${p.category}`);
  }
  const out = new Map();
  for (const [row, list] of parts) out.set(row, list.sort().join('|'));
  return out;
}

/**
 * 두 지문 사이에 달라진 행(사라진 행 · 생긴 행 · 내용이 바뀐 행). 정렬된 배열.
 * @param {Map<number,string>} before
 * @param {Map<number,string>} after
 * @returns {number[]}
 */
// @complexity time=O(r) space=O(r) cc=3
export function changedRowsBetween(before, after) {
  const rows = new Set([...before.keys(), ...after.keys()]);
  return [...rows].filter(row => before.get(row) !== after.get(row)).sort((a, b) => a - b);
}
