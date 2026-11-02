// src/domain/parts.js — 파트(섹션) — 곡 구조를 1급으로 (순수, import 0개)
//
// 신설 파일이다(2026-11-03, RM-23). 안무표 마디 위에 인트로 · A · B · 브레이크 같은 **파트**를 둔다 —
// 파트 하나는 `{ name, startRow, endRow, color }` 이고 마디 구간이다. 영상 마커와는 따로 산다(로드맵 Q6 —
// 영상을 바꾸거나 빼도 곡 구조가 남는다).
//
// 이 파일이 아는 것: 꼴(정규화 · 직렬화 · 비었나), 이 마디가 어느 파트인가(partMarkOf), 마디를 넣고 지울 때
// 파트 범위가 어떻게 따라가는가(shiftParts*), 접힌 파트가 어떤 행을 감추고 무엇으로 요약되는가.
// 블록을 옮기는 일은 domain/boardOps 의 몫이고, 둘을 한 스냅샷으로 묶는 것은 usecases/partCommands 다.
//
// ⚠ 규약은 domain/phrasing.js 와 같다 — 손상된 값은 버리고(던지지 않는다), 비면 파일에 키를 쓰지 않는다.
// ⚠ 파트는 1마디부터다. intro 행(row 0)은 어느 파트도 아니다(계획서 결정 — 프레이즈와 같은 규약).
// ⚠ 파트끼리 겹치지 않는다. 겹치면 **먼저 시작하는 것**이 남는다(시작이 같으면 앞에 적힌 것). 어느 파트에도
//   들지 않는 마디는 그대로 둔다 — 곡에 파트를 다 그을 까닭이 없다.
// ⚠ 프레이즈 · 코러스 색칠과 함께 산다 — 파트가 있는 마디는 파트가 띠와 색을 정하고, 없는 마디는 프레이즈가
//   그대로 돈다(boardMarkOf).

/**
 * @typedef {Object} Part
 * @property {string} name      사람이 붙인 이름(인트로 · A파트 · 브레이크 …). 빈 이름은 파트가 아니다
 * @property {number} startRow  첫 마디(1 이상)
 * @property {number} endRow    끝 마디(startRow 이상)
 * @property {string} color     `#rrggbb`
 */

/** 저장 포맷의 키 순서. 곧 저장 바이트다. */
export const PART_FIELDS = Object.freeze(['name', 'startRow', 'endRow', 'color']);

/**
 * 파트 색. 마디 이름 칸의 띠와 꼬리표에 칠한다.
 * ⚠ 노랑(선택 표시) · 초록(재생 헤드)은 뺐다 — 같은 화면에서 뜻이 겹친다(phrasing.PHRASE_COLORS 와 같은 까닭).
 */
export const PART_COLORS = Object.freeze(['#f472b6', '#38bdf8', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171']);

/** 이름의 최대 길이. 마디 이름 칸의 꼬리표가 넘치지 않을 만큼. */
export const PART_NAME_MAX = 24;

const ROW_MAX = 9999;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** 정수 행 번호인가. 문자열 숫자도 받는다(입력 칸에서 온 값). */
// @complexity time=O(1) space=O(1) cc=2
function rowOf(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * 파트 하나를 다듬는다. 손상됐으면 null — 호출부가 버린다.
 * 색만 틀렸으면 버리지 않고 색 차례의 기본색으로 떨어진다(이름과 구간이 곡 구조의 본체다).
 * @param {unknown} raw
 * @param {number} index  색 기본값을 고를 차례
 * @returns {Part|null}
 */
// @complexity time=O(1) space=O(1) cc=8
export function normalizePart(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, PART_NAME_MAX) : '';
  if (!name) return null;
  const startRow = rowOf(raw.startRow);
  const endRow = rowOf(raw.endRow);
  if (!(startRow >= 1) || !(endRow >= startRow) || endRow > ROW_MAX) return null;
  const color = typeof raw.color === 'string' && COLOR_RE.test(raw.color)
    ? raw.color.toLowerCase()
    : PART_COLORS[Math.abs(index) % PART_COLORS.length];
  return { name, startRow, endRow, color };
}

/**
 * 손상된 입력 → 파트 목록. **언제나 새 배열**이고 시작 마디 순이며 서로 겹치지 않는다.
 * `rows`(보드의 마지막 마디)를 주면 그 밖에서 시작하는 파트는 버리고, 끝이 넘치면 마지막 마디로 자른다.
 * @param {unknown} raw
 * @param {{ rows?: number }} [opts]
 * @returns {Part[]}
 */
// @complexity time=O(n log n) space=O(n) cc=7
export function normalizeParts(raw, opts = {}) {
  if (!Array.isArray(raw)) return [];
  const rows = Number.isInteger(opts.rows) && opts.rows >= 1 ? opts.rows : null;
  const parts = [];
  raw.forEach((item, i) => {
    const p = normalizePart(item, i);
    if (!p) return;
    if (rows !== null) {
      if (p.startRow > rows) return;
      if (p.endRow > rows) p.endRow = rows;
    }
    parts.push(p);
  });
  // 시작 순으로 — 같은 시작이면 원래 차례(Array.prototype.sort 는 안정 정렬이다)
  parts.sort((a, b) => a.startRow - b.startRow);
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && p.startRow <= last.endRow) continue;   // 겹친다 — 먼저 시작한 것이 남는다
    out.push(p);
  }
  return out;
}

/** 파트를 하나도 긋지 않았나. 참이면 파일에 쓰지 않는다. */
// @complexity time=O(n log n) space=O(n) cc=1
export function isEmptyParts(parts) {
  return normalizeParts(parts).length === 0;
}

/**
 * 파일에 쓸 모양. 비었으면 **null** 이고, 그때 호출부가 키를 통째로 뺀다 — 파트를 한 번도 안 쓴 사람의
 * 저장 파일은 바이트가 예전과 같아야 한다.
 * @param {unknown} parts
 * @returns {Part[]|null}
 */
// @complexity time=O(n log n) space=O(n) cc=2
export function serializeParts(parts) {
  const list = normalizeParts(parts);
  if (!list.length) return null;
  return list.map(p => {
    const out = {};
    for (const key of PART_FIELDS) out[key] = p[key];
    return out;
  });
}

/**
 * 이 마디가 든 파트. 없으면 null.
 * @param {readonly Part[]|null|undefined} parts  정규화된 목록(시작 순)
 * @param {number} row
 * @returns {Part|null}
 */
// @complexity time=O(n) space=O(1) cc=4
export function partAt(parts, row) {
  if (!Array.isArray(parts) || !Number.isInteger(row) || row < 1) return null;
  for (const p of parts) if (row >= p.startRow && row <= p.endRow) return p;
  return null;
}

/**
 * @typedef {Object} PartMark
 * @property {string} name
 * @property {string} color
 * @property {number} startRow
 * @property {number} endRow
 * @property {number} rowInPart  이 파트 안에서 몇 번째 마디인가(1부터)
 * @property {boolean} isStart   파트의 첫 마디 — 이름 꼬리표가 붙는다
 * @property {boolean} isEnd
 */

/**
 * 이 마디의 파트 표시. **파트 밖 마디와 intro 행(row 0)은 null** 이다.
 * @param {number} row
 * @param {readonly Part[]|null|undefined} parts
 * @returns {PartMark|null}
 */
// @complexity time=O(n) space=O(1) cc=2
export function partMarkOf(row, parts) {
  const p = partAt(parts, row);
  if (!p) return null;
  return {
    name: p.name, color: p.color, startRow: p.startRow, endRow: p.endRow,
    rowInPart: row - p.startRow + 1, isStart: row === p.startRow, isEnd: row === p.endRow
  };
}

/**
 * 파트 표시와 프레이즈 표시를 합친다 — **파트가 있는 마디는 파트가 이긴다**(프레이즈 표시는 null).
 * 파트가 없는 마디는 프레이즈 표시를 그대로 돌려준다. 프레이즈 표시는 호출부가 만들어 넘긴다
 * (domain/phrasing.phraseMark — 이 파일은 import 0개를 지킨다).
 * @param {number} row
 * @param {readonly Part[]|null|undefined} parts
 * @param {(row:number) => object|null} phraseMarkOf
 * @returns {{ part: PartMark|null, phrase: object|null }}
 */
// @complexity time=O(n) space=O(1) cc=2
export function boardMarkOf(row, parts, phraseMarkOf) {
  const part = partMarkOf(row, parts);
  if (part) return { part, phrase: null };
  return { part: null, phrase: typeof phraseMarkOf === 'function' ? phraseMarkOf(row) : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 마디를 넣고 지울 때 — 파트 범위가 따라간다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `row` 위에 마디 `count` 개를 끼운 뒤의 파트. 파트 **안**(시작 다음 ~ 끝)에 끼우면 파트가 늘고,
 * 파트 시작 마디 위 · 그 앞에 끼우면 파트가 통째로 밀린다.
 * @param {readonly Part[]} parts
 * @param {number} row
 * @param {number} [count]
 * @returns {Part[]}
 */
// @complexity time=O(n) space=O(n) cc=3
export function shiftPartsForInsert(parts, row, count = 1) {
  return (parts || []).map(p => {
    if (p.startRow >= row) return { ...p, startRow: p.startRow + count, endRow: p.endRow + count };
    if (p.endRow >= row) return { ...p, endRow: p.endRow + count };
    return { ...p };
  });
}

/**
 * `row` 마디를 지운 뒤의 파트. 뒤의 파트는 한 마디 당겨지고, 그 마디를 품은 파트는 한 마디 준다 —
 * 그 마디 하나뿐이던 파트는 사라진다.
 * @param {readonly Part[]} parts
 * @param {number} row
 * @returns {Part[]}
 */
// @complexity time=O(n) space=O(n) cc=4
export function shiftPartsForDelete(parts, row) {
  const out = [];
  for (const p of parts || []) {
    if (p.endRow < row) { out.push({ ...p }); continue; }
    if (p.startRow > row) { out.push({ ...p, startRow: p.startRow - 1, endRow: p.endRow - 1 }); continue; }
    if (p.startRow === p.endRow) continue;   // 그 마디 하나뿐이었다 — 파트도 사라진다
    out.push({ ...p, endRow: p.endRow - 1 });
  }
  return out;
}

/**
 * `row` 마디를 바로 아래에 복제한 뒤의 파트 — 복사된 마디는 원래 마디의 파트에 든다(그 파트가 는다).
 * @param {readonly Part[]} parts
 * @param {number} row
 * @returns {Part[]}
 */
// @complexity time=O(n) space=O(n) cc=3
export function shiftPartsForDuplicate(parts, row) {
  return (parts || []).map(p => {
    if (p.startRow > row) return { ...p, startRow: p.startRow + 1, endRow: p.endRow + 1 };
    if (p.endRow >= row) return { ...p, endRow: p.endRow + 1 };
    return { ...p };
  });
}

/**
 * 보드의 마지막 마디가 `rows` 로 줄었을 때 — 그 밖에서 시작하는 파트는 사라지고, 넘치는 끝은 잘린다.
 * @param {readonly Part[]} parts
 * @param {number} rows
 * @returns {Part[]}
 */
// @complexity time=O(n) space=O(n) cc=3
export function clipParts(parts, rows) {
  const out = [];
  for (const p of parts || []) {
    if (p.startRow > rows) continue;
    out.push(p.endRow > rows ? { ...p, endRow: rows } : { ...p });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 통째로 옮기기 · 한 번 더 — 행의 새 차례
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 몸통 마디 [from..to] 를 `before` 마디 앞으로 옮긴 뒤 **옛 마디 → 새 마디** 표. 바뀌지 않는 마디도 싣는다.
 * `before` 는 옛 번호이고 rows+1 이면 맨 끝이다. 옮겨도 차례가 같으면(before ∈ [from..to+1]) null.
 * @param {number} rows  마지막 마디
 * @param {number} from
 * @param {number} to
 * @param {number} before
 * @returns {Map<number,number>|null}
 */
// @complexity time=O(r) space=O(r) cc=6
export function rowOrderAfterMove(rows, from, to, before) {
  if (!(from >= 1 && to >= from && to <= rows)) return null;
  if (!(before >= 1 && before <= rows + 1)) return null;
  if (before >= from && before <= to + 1) return null;
  const order = [];
  for (let r = 1; r <= rows; r++) {
    if (r === before) for (let m = from; m <= to; m++) order.push(m);
    if (r >= from && r <= to) continue;
    order.push(r);
  }
  if (before === rows + 1) for (let m = from; m <= to; m++) order.push(m);
  const map = new Map();
  order.forEach((oldRow, i) => map.set(oldRow, i + 1));
  return map;
}

/**
 * 파트를 다른 파트 앞으로 옮길 때의 자리(`before`, 옛 번호). 위로는 바로 앞 칸(앞 파트가 있으면 그 파트 통째)
 * 앞으로, 아래로는 바로 뒤 칸(뒤 파트가 있으면 그 파트 통째) 뒤로. 더 갈 데가 없으면 null.
 * @param {readonly Part[]} parts
 * @param {Part} part
 * @param {-1|1} dir
 * @param {number} rows
 * @returns {number|null}
 */
// @complexity time=O(n) space=O(1) cc=5
export function partMoveTarget(parts, part, dir, rows) {
  if (dir < 0) {
    if (part.startRow <= 1) return null;
    const prev = partAt(parts, part.startRow - 1);
    return prev ? prev.startRow : part.startRow - 1;
  }
  if (part.endRow >= rows) return null;
  const next = partAt(parts, part.endRow + 1);
  return (next ? next.endRow : part.endRow + 1) + 1;
}

/**
 * 옛 마디 → 새 마디 표대로 파트를 옮긴다. 파트마다 시작과 끝을 따로 옮기므로 **파트의 마디가 새 차례에서도
 * 이어져 있어야** 한다 — 옮기는 자리(`before`)가 다른 파트의 한가운데면 안 된다(호출부가 막는다).
 * @param {readonly Part[]} parts
 * @param {Map<number,number>} map
 * @returns {Part[]}
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function remapParts(parts, map) {
  return (parts || [])
    .map(p => ({ ...p, startRow: map.get(p.startRow) ?? p.startRow, endRow: map.get(p.endRow) ?? p.endRow }))
    .sort((a, b) => a.startRow - b.startRow);
}

/**
 * `before` 가 어느 파트의 한가운데(시작 다음 ~ 끝)인가 — 거기로 옮기면 그 파트가 둘로 갈린다.
 * @param {readonly Part[]} parts
 * @param {number} before
 * @returns {boolean}
 */
// @complexity time=O(n) space=O(1) cc=2
export function splitsPart(parts, before) {
  return (parts || []).some(p => before > p.startRow && before <= p.endRow);
}

/**
 * 「한 번 더」 — 파트의 마디를 바로 뒤에 한 벌 더 놓은 뒤의 파트 목록. 뒤의 파트는 그만큼 밀리고,
 * 같은 이름 · 같은 색의 새 파트가 사본 위에 그어진다.
 * @param {readonly Part[]} parts
 * @param {Part} part
 * @returns {{ parts: Part[], copy: Part }}
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function partsAfterRepeat(parts, part) {
  const n = part.endRow - part.startRow + 1;
  const shifted = shiftPartsForInsert(parts, part.endRow + 1, n);
  const copy = { ...part, startRow: part.endRow + 1, endRow: part.endRow + n };
  return { parts: [...shifted, copy].sort((a, b) => a.startRow - b.startRow), copy };
}

// ─────────────────────────────────────────────────────────────────────────────
// 접기 — 화면의 일이라 저장하지 않는다(접힘 집합은 store.session)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 접힌 파트가 감추는 행. 접힌 파트는 **첫 마디 하나**로 줄고 나머지 마디가 여기 든다.
 * 접힘 집합의 열쇠는 파트의 시작 마디다(파트에 id 를 두지 않는다 — 파일 바이트가 그만큼 는다).
 * @param {readonly Part[]} parts
 * @param {Iterable<number>|null|undefined} folded  접힌 파트의 시작 마디들
 * @returns {Set<number>}
 */
// @complexity time=O(n+r) space=O(r) cc=4
export function hiddenRows(parts, folded) {
  const keys = new Set(folded || []);
  const out = new Set();
  if (!keys.size) return out;
  for (const p of parts || []) {
    if (!keys.has(p.startRow)) continue;
    for (let r = p.startRow + 1; r <= p.endRow; r++) out.add(r);
  }
  return out;
}

/**
 * 보일 행 목록 — `rowIndices`(intro 포함 0..rows 또는 1..rows)에서 접힌 파트가 감춘 행을 뺀다.
 * @param {readonly number[]} rowIndices
 * @param {readonly Part[]} parts
 * @param {Iterable<number>|null|undefined} folded
 * @returns {number[]}
 */
// @complexity time=O(n+r) space=O(r) cc=1
export function visibleRows(rowIndices, parts, folded) {
  const hidden = hiddenRows(parts, folded);
  return rowIndices.filter(r => !hidden.has(r));
}

/**
 * 접힌 줄의 한 줄 요약 — `이름 · N마디 · 첫 동작`. 블록이 없으면 첫 동작 자리에 `빈 파트`.
 * 첫 동작은 파트 안에서 **가장 먼저 시작하는** 블록의 이름이다(같은 자리면 아래 층이 아니라 위 층).
 * @param {Part} part
 * @param {readonly {row:number,startIndex:number,subRow?:number,name?:string}[]} placements
 * @param {{ untitled?: string, empty?: string }} [words]  이름 없는 블록 · 빈 파트를 부를 말(화면 글자의 주인은 strings 표다)
 * @returns {string}
 */
// @complexity time=O(p) space=O(1) cc=7
export function foldSummary(part, placements, words = {}) {
  let first = null;
  for (const p of placements || []) {
    if (p.row < part.startRow || p.row > part.endRow) continue;
    if (!first || p.row < first.row || (p.row === first.row && (p.startIndex < first.startIndex
      || (p.startIndex === first.startIndex && (p.subRow || 0) < (first.subRow || 0))))) first = p;
  }
  const n = part.endRow - part.startRow + 1;
  const lead = first ? (first.name || words.untitled || '이름 없는 블록') : (words.empty || '빈 파트');
  return `${part.name} · ${n}마디 · ${lead}`;
}

/**
 * 접힘 집합을 지금 파트에 맞춘다 — 사라진 파트의 열쇠를 버린다. 같으면 **같은 집합**을 돌려준다
 * (호출부가 바뀌었는지 === 로 본다).
 * @param {Set<number>} folded
 * @param {readonly Part[]} parts
 * @returns {Set<number>}
 */
// @complexity time=O(n+f) space=O(f) cc=3
export function pruneFolds(folded, parts) {
  if (!folded || !folded.size) return folded || new Set();
  const starts = new Set((parts || []).map(p => p.startRow));
  const next = new Set([...folded].filter(r => starts.has(r)));
  return next.size === folded.size ? folded : next;
}
