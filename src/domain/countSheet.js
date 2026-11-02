// src/domain/countSheet.js — 카운트 시트: 마디 하나를 한 줄로 쓰고, 그 글을 다시 읽는다 (순수)
//
// 신설 파일이다(RM-21). 안무표를 메신저 · 메모장에 붙일 수 있는 글로 바꾼다.
//
//   intro · -
//   8x1 · 1 Swing Out · 5 Kick Ball Change
//   8x2 · 1 Shim Sham [6] · 7 Break / 3 Clap [2]
//
// 줄의 머리는 choreoPlan.rowLabel 과 **같은 글자**(intro · 8xN)다 — 미리보기 표 · 보드의 행 라벨과 어긋나지 않는다.
// 한 줄의 문법(판의 결정, 2026-10-13):
//   · 항목은 `<시작 카운트> <이름>` 이고 ` · ` 로 잇는다. 시작 카운트는 1 부터다.
//   · 길이는 **기본은 적지 않는다** — 같은 층의 다음 항목까지(없으면 행 끝까지)가 길이다.
//     그 규칙과 다를 때만(사이가 비거나 · 마디를 넘어가거나) `[6]` 처럼 대괄호로 적는다.
//   · 겹친 층(subRow)은 ` / ` 로 가른다. 앞이 0층, 그다음이 1층이다. 비어 있는 층은 `-` 로 둔다.
//   · 아무것도 없는 행은 `-` 다. 여러 행에 걸친 블록은 **시작 행에만** 길이와 함께 적는다.
//   · 이름 없는 블록(받아 적기의 `?`)은 `?` 로, 루틴 블록은 `▶ 이름` 으로 적는다.
//
// ⚠ 이 문법은 한 번 남에게 나가면 되돌리기 어렵다 — 왕복 시험(tests/unit/countSheet.test.mjs)으로 굳힌다.
// ⚠ 읽기는 안무표를 **직접 만들지 않는다.** 안무 계획 꼴(bar · count · length · name)로만 바꾸고, 놓는 길은
//   choreoPlan.normalizePlan → paletteCommands.createAndPlace 로 「말로 채우기」와 같다(새 배치 경로를 두지 않는다).
// ⚠ 이름 속의 ` · ` · ` / ` · `[n]` 은 문법 글자라 쓰기에서 한 칸으로 눌러 적는다 — 그런 이름은 왕복이 정확하지 않다.

import { rowLabel } from './choreoPlan.js';

/** 항목 사이. */
export const ENTRY_SEP = ' · ';
/** 층 사이. */
export const LANE_SEP = ' / ';
/** 빈 행 · 빈 층. 비고란의 `-` 와 같은 글자다. */
export const EMPTY_MARK = '-';
/** 이름 없는 블록. */
export const PENDING_MARK = '?';
/** 루틴 블록의 머리. 비고란이 쓰는 것과 같다. */
export const ROUTINE_MARK = '▶';

/** 이름 속의 문법 글자를 한 칸으로 누른다. */
// @complexity time=O(n) space=O(n) cc=1
function plainName(name) {
  return String(name == null ? '' : name).replace(/\s*·\s*/g, ' ').replace(/\s*\/\s*/g, ' ').replace(/\[|\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 한 그룹의 시작 세그먼트(행 · 칸이 가장 앞인 것)와 전체 길이.
 * @param {object[]} placements
 * @returns {Map<string, {head: object, length: number}>} groupId → 시작 세그먼트와 전체 길이
 */
// @complexity time=O(n) space=O(g) cc=5
function groupHeads(placements) {
  const out = new Map();
  for (const p of placements) {
    const cur = out.get(p.groupId);
    if (!cur) { out.set(p.groupId, { head: p, length: p.length }); continue; }
    cur.length += p.length;
    if (p.row < cur.head.row || (p.row === cur.head.row && p.startIndex < cur.head.startIndex)) cur.head = p;
  }
  return out;
}

/**
 * 블록 하나의 글자. 이름 없는 블록은 `?`, 루틴은 `▶ 이름`.
 * @param {object} p
 * @returns {string}
 */
// @complexity time=O(n) space=O(n) cc=3
export function entryName(p) {
  if (p.pending) return PENDING_MARK;
  const name = plainName(p.name) || PENDING_MARK;
  return p.type === 'routine' ? `${ROUTINE_MARK} ${name}` : name;
}

/**
 * 행 하나의 본문(머리 뒤). 층마다 항목을 ` · ` 로 잇고 층은 ` / ` 로 가른다.
 * @param {{ cols:number }} board
 * @param {{ start:number, length:number, lane:number, name:string }[]} entries 이 행에서 **시작하는** 블록들
 * @returns {string}
 */
// @complexity time=O(n log n) space=O(n) cc=6
export function rowBody(board, entries) {
  if (!entries.length) return EMPTY_MARK;
  const laneCount = entries.reduce((m, e) => Math.max(m, e.lane), 0) + 1;
  const lanes = [];
  for (let lane = 0; lane < laneCount; lane++) {
    const list = entries.filter(e => e.lane === lane).sort((a, b) => a.start - b.start);
    if (!list.length) { lanes.push(EMPTY_MARK); continue; }
    lanes.push(list.map((e, i) => {
      const next = list[i + 1];
      const defaultLength = (next ? next.start : board.cols) - e.start;
      const tail = e.length === defaultLength ? '' : ` [${e.length}]`;
      return `${e.start + 1} ${e.name}${tail}`;
    }).join(ENTRY_SEP));
  }
  return lanes.join(LANE_SEP);
}

/**
 * 행마다 그 행에서 시작하는 블록의 항목 목록. 이어지는 세그먼트(둘째 행부터)는 적지 않는다.
 * @param {{ placements: object[] }} board
 * @returns {Map<number, {start:number, length:number, lane:number, name:string}[]>} row → 항목
 */
// @complexity time=O(n) space=O(n) cc=2
export function sheetEntries(board) {
  const out = new Map();
  for (const { head, length } of groupHeads(board.placements || []).values()) {
    const list = out.get(head.row) || [];
    list.push({ start: head.startIndex, length, lane: head.subRow || 0, name: entryName(head) });
    out.set(head.row, list);
  }
  return out;
}

/**
 * 안무표 → 글. intro 와 각 마디가 한 줄씩이다. 제목을 주면 첫 줄에 적는다.
 * @param {{ rows:number, cols:number, hasIntroRow?:boolean, placements:object[] }} board
 * @param {{ title?: string }} [options]
 * @returns {string}
 */
// @complexity time=O(n log n) space=O(n) cc=4
export function writeCountSheet(board, options = {}) {
  const lines = [];
  const title = String(options.title || '').trim();
  if (title) lines.push(title);
  const entries = sheetEntries(board);
  const first = board.hasIntroRow === false ? 1 : 0;
  for (let row = first; row <= board.rows; row++) {
    lines.push(`${rowLabel(row, board.cols)}${ENTRY_SEP}${rowBody(board, entries.get(row) || [])}`);
  }
  return lines.join('\n');
}

const HEAD_RE = /^(intro|(\d+)x(\d+))(?:\s*·\s*(.*))?$/u;
const ENTRY_RE = /^(\d+)\s+(.+?)(?:\s*\[(\d+)\])?$/u;

/**
 * 글 → 안무 계획. 줄마다 머리(intro · 8xN)를 읽고 항목을 `{bar, count, length, name, lane}` 으로 바꾼다.
 * 이름은 **맞추지 않는다** — 목록과 느슨하게 맞추고 없는 이름을 새 동작으로 표시하는 것은 choreoPlan.normalizePlan 이다.
 * 이상한 줄 · 항목은 버리지 않고 `dropped` 에 이유와 함께 남긴다.
 *
 * - 첫 줄이 머리로 시작하지 않으면 제목이다. 그 뒤의 머리 없는 줄은 버린다.
 * - 길이가 없는 항목은 같은 층의 다음 항목까지, 없으면 행 끝까지다(쓰기와 같은 규칙).
 * - `?`(이름 없는 블록)는 놓을 이름이 없으므로 버린다. `▶ 이름` 은 머리를 떼고 이름만 쓴다.
 * - cols 는 `8xN` 머리에서 읽는다. intro 줄만 있으면 options.cols(기본 8)다.
 *
 * @param {string} text
 * @param {{ cols?: number }} [options]
 * @returns {{ title:string, cols:number, rows:number,
 *   moves:{bar:number, count:number, length:number, name:string, lane:number}[],
 *   dropped:{line:string, reason:string}[] }}
 */
// @complexity time=O(n) space=O(n) cc=16
export function parseCountSheet(text, options = {}) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  let title = '';
  let cols = 0;
  let rows = 0;
  let sawLine = false;
  const dropped = [];
  /** @type {{bar:number, lane:number, count:number, length:number|null, name:string}[][]} 행·층별 항목 */
  const laneLists = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const head = HEAD_RE.exec(line);
    if (!head) {
      if (!sawLine) { title = line; sawLine = true; continue; }
      dropped.push({ line, reason: '마디 줄(intro · 8xN)로 시작하지 않는다' });
      continue;
    }
    sawLine = true;
    const bar = head[1] === 'intro' ? 0 : Number(head[3]);
    if (head[2]) cols = cols || Number(head[2]);
    rows = Math.max(rows, bar);
    const body = (head[4] || '').trim();
    body.split(/\s*\/\s*/).forEach((laneText, lane) => {
      const list = [];
      for (const entry of laneText.split(/\s*·\s*/)) {
        const e = entry.trim();
        if (!e || e === EMPTY_MARK) continue;
        const m = ENTRY_RE.exec(e);
        if (!m) { dropped.push({ line: e, reason: '「카운트 이름」 꼴이 아니다' }); continue; }
        let name = m[2].trim();
        if (name.startsWith(ROUTINE_MARK)) name = name.slice(ROUTINE_MARK.length).trim();
        if (!name || name === PENDING_MARK) { dropped.push({ line: e, reason: '이름을 아직 안 붙인 블록이다' }); continue; }
        list.push({ bar, lane, count: Number(m[1]), length: m[3] ? Number(m[3]) : null, name });
      }
      if (list.length) laneLists.push(list);
    });
  }

  if (!cols) cols = Math.max(1, Number(options.cols) || 8);
  const moves = [];
  for (const list of laneLists) {
    list.sort((a, b) => a.count - b.count);
    list.forEach((e, i) => {
      const next = list[i + 1];
      const length = e.length != null ? e.length : Math.max(1, (next ? next.count : cols + 1) - e.count);
      moves.push({ bar: e.bar, count: e.count, length, name: e.name, lane: e.lane });
    });
  }
  return { title, cols, rows, moves, dropped };
}
