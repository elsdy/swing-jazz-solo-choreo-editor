// src/domain/project/versions.js — 판본과 연습 기록의 규칙 (순수 함수, RM-29 · 2026-11-03)
//
// 한 안무 파일 안에 이름 붙인 판본(A안 · 공연본)을 떠 두고, 연습한 날마다 한 줄씩 기록을 쌓는다.
// 스키마(schema.js 의 ChoreoVersion · PracticeLog)는 2026-09 부터 자리만 있었고 아무도 만들지 않았다 — 이 파일이 첫 주인이다.
//
// 판의 결정 셋(2026-10-01):
//   Q41 판본은 안무 파일 **안에** 둔다 — 파일 하나만 옮기면 판본과 기록이 다 따라간다. 서버가 없어도 된다
//   Q42 영상은 안무 공통이고 판본은 안무표만 뜬다(schema.VERSION_SKIP_FIELDS)
//   Q43 판본 · 기록이 있을 때만 쓰기 버전을 올린다(serialize.js — 옛 앱이 거절하게)
//
// ⚠ 판본의 본문(`doc`)은 **파일과 같은 평평한 모양**이다(buildProjectFile 이 만드는 것의 일부). 새 모양을 만들지 않는 것이
//   요점이다 — 판본을 여는 길이 곧 파일을 여는 길(normalizeProject)이 되어, 두 모양이 어긋나 한쪽만 고치는 날이 없다.
// ⚠ 시계 · id 를 스스로 만들지 않는다. 뜬 시각 · 오늘 날짜 · id 는 부르는 쪽(usecases)이 넘긴다.

import { VERSION_FILE_KEYS } from './schema.js';
import { cloneJsonValue } from './snapshot.js';
import { normalizeTakenAt, normalizeNote } from './media.js';
import { countRangeLabel, normalizeCountRange } from '../practice.js';
import { cellOf, linearOf } from '../grid.js';

/** 판본 이름의 최대 길이. 목록 한 줄에 들어가야 한다. */
export const MAX_VERSION_LABEL = 40;

/** 별점의 범위. */
export const RATING_MAX = 5;

// ─────────────────────────────────────────────────────────────────────────────
// 판본
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 파일 본문(평평한 모양)에서 판본이 뜨는 키만 값으로 복제한다. 없는 키(비어서 빠진 것)는 판본에도 없다.
 * @param {object} fileBody buildProjectFile 의 결과(또는 그와 같은 모양)
 * @returns {object}
 */
// @complexity time=O(n) space=O(n) cc=3
export function versionDocOf(fileBody) {
  const out = {};
  if (!fileBody || typeof fileBody !== 'object') return out;
  for (const key of VERSION_FILE_KEYS) if (key in fileBody) out[key] = cloneJsonValue(fileBody[key]);
  return out;
}

/** 이름 한 줄. 줄바꿈을 공백으로 접고 길이를 자른다. */
// @complexity time=O(n) space=O(n) cc=1
export function normalizeVersionLabel(raw) {
  return normalizeNote(raw).slice(0, MAX_VERSION_LABEL);
}

/**
 * 판본 하나를 뜬다. 본문은 **값으로 복제**한다 — 뜬 뒤 지금 안무표를 고쳐도 판본은 그대로다.
 * @param {object} fileBody 지금 안무의 파일 본문(buildProjectFile 결과)
 * @param {{id:string, createdAt:string, label?:string, note?:string, parentId?:string|null}} meta
 * @returns {import('./schema.js').ChoreoVersion}
 */
// @complexity time=O(n) space=O(n) cc=2
export function makeVersion(fileBody, meta) {
  return {
    id: String(meta.id),
    parentId: meta.parentId ? String(meta.parentId) : null,
    createdAt: String(meta.createdAt || ''),
    label: normalizeVersionLabel(meta.label),
    note: normalizeNote(meta.note),
    doc: versionDocOf(fileBody)
  };
}

/**
 * 새 판본의 기본 이름 — `판본 N`. 이미 있는 이름과 겹치지 않는 가장 작은 N(지운 뒤 다시 떠도 겹치지 않는다).
 * @param {{label:string}[]} versions
 * @param {(n:number)=>string} nameOf `판본 {n}` 을 채우는 함수(글자의 주인은 domain/strings 의 LABELS)
 * @returns {string}
 */
// @complexity time=O(n) space=O(n) cc=2
export function nextVersionLabel(versions, nameOf) {
  const taken = new Set((versions || []).map(v => v.label));
  let n = (versions || []).length + 1;
  while (taken.has(nameOf(n))) n++;
  return nameOf(n);
}

/** 판본 본문의 마디 수와 블록(그룹) 수. 본문이 손상돼도 던지지 않는다. */
// @complexity time=O(n) space=O(n) cc=4
function docCounts(doc) {
  const rows = doc && Number.isFinite(Number(doc.rows)) ? Math.max(0, Math.trunc(Number(doc.rows))) : 0;
  const placements = doc && Array.isArray(doc.placements) ? doc.placements : [];
  const groups = new Set(placements.map(p => (p && p.groupId) || (p && p.id)).filter(Boolean));
  return { bars: rows, blocks: groups.size };
}

/**
 * 판본의 요약 — 목록이 그리는 것 전부. **본문을 싣지 않는다.** 요약은 본문에서 언제든 다시 만들어진다(저장하지 않는다).
 * @param {import('./schema.js').ChoreoVersion} version
 * @returns {{id:string, label:string, note:string, parentId:string|null, createdAt:string, bars:number, blocks:number}}
 */
// @complexity time=O(n) space=O(n) cc=1
export function versionSummary(version) {
  const { bars, blocks } = docCounts(version.doc);
  return {
    id: version.id, label: version.label, note: version.note,
    parentId: version.parentId, createdAt: version.createdAt, bars, blocks
  };
}

/**
 * 판본 목록의 요약들 — 새로 뜬 것이 위(createdAt 내림차순, 같으면 뒤에 뜬 것이 위).
 * @param {import('./schema.js').ChoreoVersion[]} versions
 */
// @complexity time=O(n log n) space=O(n) cc=2
export function versionSummaries(versions) {
  return (versions || [])
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v.createdAt === b.v.createdAt ? b.i - a.i : (a.v.createdAt < b.v.createdAt ? 1 : -1)))
    .map(({ v }) => versionSummary(v));
}

/**
 * 손상된 판본 하나를 접는다. id 가 없거나 본문이 객체가 아니면 null(열 수 없는 판본은 고칠 수도 없다).
 * ⚠ parentId 가 가리키는 판본이 없어도 그대로 둔다 — 부모를 지운 판본이다(dangling 허용, ports/storage 의 계약).
 * ⚠ 본문은 여기서 깊게 정규화하지 않는다 — 열 때 normalizeProject 가 한다(같은 길 하나).
 * @param {unknown} raw
 * @returns {import('./schema.js').ChoreoVersion|null}
 */
// @complexity time=O(n) space=O(n) cc=5
export function normalizeVersion(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  if (!raw.doc || typeof raw.doc !== 'object' || Array.isArray(raw.doc)) return null;
  return makeVersion(raw.doc, {
    id: raw.id, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    label: raw.label, note: raw.note, parentId: raw.parentId
  });
}

/**
 * 판본 목록. 같은 id 가 둘이면 앞의 것을 남긴다. 배열이 아니면 빈 목록.
 * @param {unknown} raw
 * @returns {import('./schema.js').ChoreoVersion[]}
 */
// @complexity time=O(n) space=O(n) cc=4
export function normalizeVersions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const v = normalizeVersion(item);
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

/**
 * 파일에 실을 판본 목록. **비면 null** — 키째로 빠진다(판본을 안 쓴 사람의 저장 바이트가 그대로다).
 * @param {import('./schema.js').ChoreoVersion[]} versions
 * @returns {object[]|null}
 */
// @complexity time=O(n) space=O(n) cc=2
export function serializeVersions(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  return versions.map(v => ({
    id: v.id, parentId: v.parentId, createdAt: v.createdAt, label: v.label, note: v.note, doc: v.doc
  }));
}

/**
 * 판본의 이름 · 메모를 고친다. 없는 id 면 같은 목록을 돌려준다(무동작 판정은 === 로).
 * @param {import('./schema.js').ChoreoVersion[]} versions
 * @param {string} id
 * @param {{label?:string, note?:string}} patch
 */
// @complexity time=O(n) space=O(n) cc=6
export function editVersion(versions, id, patch) {
  const i = versions.findIndex(v => v.id === id);
  if (i < 0) return versions;
  const cur = versions[i];
  const label = 'label' in patch ? normalizeVersionLabel(patch.label) : cur.label;
  const note = 'note' in patch ? normalizeNote(patch.note) : cur.note;
  if ((label || cur.label) === cur.label && note === cur.note) return versions;
  const next = versions.slice();
  next[i] = { ...cur, label: label || cur.label, note };   // 이름을 비우면 옛 이름을 남긴다 — 이름 없는 판본은 목록에서 못 고른다
  return next;
}

/**
 * 판본 하나를 뺀다. 자식 판본의 parentId 도, 기록의 versionId 도 **건드리지 않는다**(dangling 허용).
 * @returns {import('./schema.js').ChoreoVersion[]}
 */
// @complexity time=O(n) space=O(n) cc=1
export function removeVersion(versions, id) {
  return versions.some(v => v.id === id) ? versions.filter(v => v.id !== id) : versions;
}

/** 키를 정렬해 적은 JSON — 키 차례만 다른 두 본문을 같게 본다. */
// @complexity time=O(n log n) space=O(n) cc=4
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * 판본 본문의 서명 — 같은 안무면 같은 글자다(키 차례 무관). 「지금 본문이 어느 판본과 같은가」를 잴 때 쓴다.
 * @param {object} doc versionDocOf 의 결과
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function versionSignature(doc) {
  return stableJson(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// 연습 기록
// ─────────────────────────────────────────────────────────────────────────────

/** 0 이상 정수면 그 값, 아니면 null. */
// @complexity time=O(1) space=O(1) cc=3
function countOrNull(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 양수(상한 안)면 소수 둘째 자리까지, 아니면 null. */
// @complexity time=O(1) space=O(1) cc=3
function positiveOrNull(raw, max) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 100) / 100 : null;
}

/** 칸 좌표 하나. 음수 · 정수 아님이면 null. */
// @complexity time=O(1) space=O(1) cc=4
function normalizeCountRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const row = Number(raw.row);
  const index = Number(raw.index);
  return Number.isInteger(row) && row >= 0 && Number.isInteger(index) && index >= 0 ? { row, index } : null;
}

/**
 * 연습 구간 — 양 끝 칸을 포함하는 `{from, to}`. 뒤집혀 있으면 바로 세우고, 한쪽이라도 손상됐으면 null.
 * ⚠ 마디 · 카운트 좌표(행 · 칸)라 보드의 칸 수가 바뀌어도 읽힌다(schema.CountRef).
 * @param {unknown} raw
 * @returns {{from:{row:number,index:number}, to:{row:number,index:number}}|null}
 */
// @complexity time=O(1) space=O(1) cc=5
export function normalizeScope(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const from = normalizeCountRef(raw.from);
  const to = normalizeCountRef(raw.to);
  if (!from || !to) return null;
  const after = from.row > to.row || (from.row === to.row && from.index > to.index);
  return after ? { from: to, to: from } : { from, to };
}

/**
 * 구간 → 연습기의 카운트 구간([fromCount, toCount)). 칸 수가 줄어 칸이 넘치면 그 마디의 끝 칸으로 접는다.
 * @param {{from:{row:number,index:number}, to:{row:number,index:number}}|null} scope
 * @param {number} cols
 */
// @complexity time=O(1) space=O(1) cc=3
export function scopeToCountRange(scope, cols) {
  const s = normalizeScope(scope);
  if (!s || !(cols > 0)) return null;
  const at = (ref) => linearOf(ref.row, Math.min(ref.index, cols - 1), cols);
  return normalizeCountRange({ fromCount: at(s.from), toCount: at(s.to) + 1 });
}

/**
 * 연습기의 카운트 구간 → 구간. 「이번 연습 기록하기」가 연습기의 반복 구간을 그대로 넘기는 이음매다(RM-22).
 * @param {{fromCount:number, toCount:number}|null} range
 * @param {number} cols
 */
// @complexity time=O(1) space=O(1) cc=3
export function scopeFromCountRange(range, cols) {
  const r = normalizeCountRange(range);
  if (!r || !(cols > 0)) return null;
  const from = cellOf(r.fromCount, cols);
  const to = cellOf(r.toCount - 1, cols);
  return normalizeScope({ from, to });
}

/**
 * 구간의 말 — 연습기 · 마커와 **같은 표기**다(practice.countRangeLabel: `8x3` · `8x3 ~ 8x4` · `8x3의 3카운트`).
 * @returns {string} 구간이 없으면 ''
 */
// @complexity time=O(1) space=O(1) cc=2
export function scopeLabel(scope, cols) {
  const range = scopeToCountRange(scope, cols);
  return range ? countRangeLabel(range, cols) : '';
}

/** 한 마디 토큰(`intro` · `8x3` · `3`)의 행 번호. 아니면 null. */
// @complexity time=O(1) space=O(1) cc=4
function rowOfToken(token) {
  const t = token.trim().toLowerCase();
  if (t === 'intro') return 0;
  const m = /^(?:\d+\s*x\s*)?(\d+)$/.exec(t);
  return m ? Number(m[1]) : null;
}

/**
 * 구간 한쪽 끝의 말 → 그 끝이 덮는 칸들 `{row, first, last}`. `8x3` 은 마디 전체, `8x3의 3카운트` 는 그 칸,
 * `8x3의 3~5카운트` 는 그 칸들. 못 읽으면 null.
 */
// @complexity time=O(1) space=O(1) cc=7
function parseEnd(text, cols) {
  const m = /^(.+?)(?:\s*의\s*(\d+)(?:\s*~\s*(\d+))?\s*카운트)?$/.exec(text.trim());
  if (!m) return null;
  const row = rowOfToken(m[1]);
  if (row === null) return null;
  if (m[2] === undefined) return { row, first: 0, last: cols - 1 };
  const a = Number(m[2]) - 1;
  const b = m[3] === undefined ? a : Number(m[3]) - 1;
  if (a < 0 || b < a || b >= cols) return null;
  return { row, first: a, last: b };
}

/**
 * 사람이 적은 구간의 말 → 구간. scopeLabel 이 적는 꼴을 모두 다시 읽는다(왕복) — `8x3` · `8x3 ~ 8x4` ·
 * `3~4`(마디 번호만) · `8x3의 3카운트` · `8x3의 3~5카운트` · `8x3의 3카운트 ~ 8x4의 2카운트` · `intro`.
 * @param {string} text
 * @param {number} cols
 * @returns {{ok:true, scope:object|null}|{ok:false}} 빈 글이면 ok 이고 scope 는 null(구간 없음)
 */
// @complexity time=O(n) space=O(n) cc=10
export function parseScope(text, cols) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: true, scope: null };
  if (!(cols > 0)) return { ok: false };
  // 한 끝으로 다 읽히면 그것(`8x3의 3~5카운트` 의 `~` 는 한 끝 안의 것이다), 아니면 `~` 마다 갈라 두 끝이 다 읽히는 자리를 찾는다
  const whole = parseEnd(t, cols);
  const ends = whole ? [whole, whole] : splitEnds(t, cols);
  if (!ends) return { ok: false };
  // 뒤집어 적었으면(`8x4 ~ 8x3`) 끝을 통째로 바꾼다 — 칸만 바꾸면 한 마디 끝에서 다음 마디 처음이 된다
  const [a, b] = ends[0].row > ends[1].row || (ends[0].row === ends[1].row && ends[0].first > ends[1].first)
    ? [ends[1], ends[0]] : ends;
  const scope = normalizeScope({ from: { row: a.row, index: a.first }, to: { row: b.row, index: b.last } });
  return scope ? { ok: true, scope } : { ok: false };
}

/** `~` 자리마다 갈라 보고 두 끝이 다 읽히는 첫 자리의 두 끝. 없으면 null. */
// @complexity time=O(n) space=O(n) cc=4
function splitEnds(t, cols) {
  for (let i = t.indexOf('~'); i >= 0; i = t.indexOf('~', i + 1)) {
    const a = parseEnd(t.slice(0, i), cols);
    const b = a && parseEnd(t.slice(i + 1), cols);
    if (a && b) return [a, b];
  }
  return null;
}

/**
 * 손상된 연습 기록 한 줄을 접는다. id 가 없으면 null(고칠 수도 지울 수도 없다).
 * 음수 시도 수 · 범위 밖 별점 · 손상된 구간은 「모름」(null)으로, 깨끗한 수가 시도 수보다 크면 시도 수로 접는다.
 * ⚠ versionId · clipId 가 가리키는 것이 없어도 그대로 둔다(dangling 허용).
 * @param {unknown} raw
 * @returns {import('./schema.js').PracticeLog|null}
 */
// @complexity time=O(1) space=O(1) cc=8
export function normalizePracticeLog(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const attempts = countOrNull(raw.attempts);
  let cleanRuns = countOrNull(raw.cleanRuns);
  if (cleanRuns !== null && attempts !== null && cleanRuns > attempts) cleanRuns = attempts;
  const rating = countOrNull(raw.rating);
  return {
    id: String(raw.id),
    at: normalizeTakenAt(raw.at),
    versionId: raw.versionId ? String(raw.versionId) : '',
    clipId: raw.clipId ? String(raw.clipId) : '',
    scope: normalizeScope(raw.scope),
    bpm: positiveOrNull(raw.bpm, 600),
    rate: positiveOrNull(raw.rate, 4),
    attempts,
    cleanRuns,
    rating: rating !== null && rating >= 1 && rating <= RATING_MAX ? rating : null,
    trouble: normalizeNote(raw.trouble),
    note: normalizeNote(raw.note)
  };
}

/**
 * 기록 목록 — 날짜 오름차순(같은 날은 적은 차례), 날짜 모르는 줄은 맨 뒤. 같은 id 는 앞의 것을 남긴다.
 * @param {unknown} raw
 * @returns {import('./schema.js').PracticeLog[]}
 */
// @complexity time=O(n log n) space=O(n) cc=6
export function normalizePracticeLogs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const log = normalizePracticeLog(item);
    if (!log || seen.has(log.id)) continue;
    seen.add(log.id);
    out.push(log);
  }
  return sortLogs(out);
}

/** 날짜 오름차순, 같은 날은 들어온 차례, 날짜 없는 것은 맨 뒤. */
// @complexity time=O(n log n) space=O(n) cc=5
function sortLogs(logs) {
  return logs.map((log, i) => ({ log, i })).sort((a, b) => {
    if (a.log.at === b.log.at) return a.i - b.i;
    if (!a.log.at) return 1;
    if (!b.log.at) return -1;
    return a.log.at < b.log.at ? -1 : 1;
  }).map(({ log }) => log);
}

/**
 * 파일에 실을 기록 목록. **비면 null**(키째 빠진다). 줄마다 빈 칸(null · '')은 쓰지 않는다 — id 는 늘 쓴다.
 * @param {import('./schema.js').PracticeLog[]} logs
 * @returns {object[]|null}
 */
// @complexity time=O(n) space=O(n) cc=4
export function serializePracticeLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return null;
  return logs.map(log => {
    const out = {};
    for (const [key, value] of Object.entries(log)) {
      if (key !== 'id' && (value === null || value === '')) continue;
      out[key] = value;
    }
    return out;
  });
}

/**
 * 기록 한 줄을 넣거나(같은 id 가 없으면) 고친다(있으면). 넣은 뒤 날짜 차례로 다시 선다.
 * @param {import('./schema.js').PracticeLog[]} logs
 * @param {unknown} raw
 * @returns {import('./schema.js').PracticeLog[]|null} 손상돼 넣을 수 없으면 null
 */
// @complexity time=O(n log n) space=O(n) cc=3
export function upsertPracticeLog(logs, raw) {
  const log = normalizePracticeLog(raw);
  if (!log) return null;
  const i = logs.findIndex(l => l.id === log.id);
  const next = logs.slice();
  if (i < 0) next.push(log); else next[i] = log;
  return sortLogs(next);
}

/** 기록 한 줄을 뺀다. 없는 id 면 같은 목록. */
// @complexity time=O(n) space=O(n) cc=1
export function removePracticeLog(logs, id) {
  return logs.some(l => l.id === id) ? logs.filter(l => l.id !== id) : logs;
}

/**
 * 새 기록의 초안 — 저장하지 않는다. 화면의 한 줄 편집기가 이것으로 열린다.
 *   clip      「이 테이크 기록」으로 들어왔으면 그 영상(id · 찍은 날을 채운다)
 *   today     영상에 날짜가 없거나 영상 없이 열면 쓰는 날(`YYYY-MM-DD`, 부르는 쪽이 시계를 읽어 넘긴다)
 *   practice  연습기의 반복 구간(RM-22) — 있으면 구간으로, rate 가 1 이 아니면 배속으로 채운다
 * @param {{id:string, today:string, clip?:{id:string, takenAt?:string}|null, versionId?:string,
 *          practice?:{fromCount:number,toCount:number}|null, rate?:number, cols?:number}} input
 * @returns {import('./schema.js').PracticeLog}
 */
// @complexity time=O(1) space=O(1) cc=6
export function practiceLogDraft(input) {
  const { id, today, clip = null, versionId = '', practice = null, rate = 1, cols = 8 } = input;
  const at = (clip && normalizeTakenAt(clip.takenAt)) || normalizeTakenAt(today);
  return normalizePracticeLog({
    id, at, versionId, clipId: clip ? clip.id : '',
    scope: scopeFromCountRange(practice, cols),
    rate: rate !== 1 ? rate : null
  });
}

/**
 * 기록 한 줄의 말 조각들 — 목록이 ` · ` 로 잇는다. 「0.75배 · 3/10 깨끗 · ★★★ · 8x3에서 늦음」.
 * 판본 이름과 영상 이름은 부르는 쪽이 id 로 찾아 넘긴다(없으면 '' — 지운 판본 · 영상).
 * @param {import('./schema.js').PracticeLog} log
 * @param {{cols:number, versionLabel?:string, clipName?:string}} ctx
 * @returns {string[]}
 */
// @complexity time=O(1) space=O(1) cc=9
export function practiceLogParts(log, ctx) {
  const parts = [];
  if (ctx.versionLabel) parts.push(ctx.versionLabel);
  const range = scopeLabel(log.scope, ctx.cols);
  if (range) parts.push(range);
  if (log.rate !== null) parts.push(`${log.rate}배`);
  if (log.bpm !== null) parts.push(`BPM ${log.bpm}`);
  if (log.attempts !== null) parts.push(`${log.cleanRuns === null ? '?' : log.cleanRuns}/${log.attempts} 깨끗`);
  else if (log.cleanRuns !== null) parts.push(`${log.cleanRuns}번 깨끗`);
  if (log.rating !== null) parts.push('★'.repeat(log.rating));
  if (log.trouble) parts.push(log.trouble);
  if (ctx.clipName) parts.push(`🎬 ${ctx.clipName}`);
  return parts;
}
