// src/domain/sheetHtml.js — 읽기 전용 HTML 한 장을 문자열로 만든다 (순수)
//
// 신설 파일이다(RM-21). 받은 사람이 앱 없이 더블클릭(`file://`)으로 열어 안무표 · 텍스트 시트 · 영상 마커를 본다.
//
// ⚠ 스크립트를 넣지 않는다. 표는 **미리 그린** `<table>` 이고 스타일은 `<style>` 안에 다 있다 — 모듈 import ·
//   fetch · 바깥 script · 바깥 stylesheet 가 하나라도 끼면 `file://` 에서 빈 화면이 된다.
// ⚠ 제목 · 동작 이름 · 카테고리 · 마커 이름표는 사용자가 적은 값이다. 전부 escapeHtml 을 지난다 — 빠뜨리면
//   받는 사람 쪽에서 태그 · 스크립트가 실행된다(남에게 보내는 파일이다).
// ⚠ 영상은 유튜브일 때만 마커마다 그 시각으로 가는 링크를 단다. 로컬 영상은 받은 사람에게 없으므로 이름 · 시각만 적는다.
// ⚠ 흑백 인쇄를 생각해 루틴 블록은 색 말고 `▶` 와 점선 테두리로도 가른다.

import { cellLabel, rowLabel } from './choreoPlan.js';
import { parseYoutubeUrl } from './links.js';
import { ENTRY_SEP, EMPTY_MARK, PENDING_MARK, ROUTINE_MARK, rowBody, sheetEntries, writeCountSheet } from './countSheet.js';

/**
 * HTML 글자 이스케이프. 속성 값과 본문 모두에 쓴다.
 * @param {unknown} value
 * @returns {string}
 */
// @complexity time=O(n) space=O(n) cc=1
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `#rrggbb` 꼴만 통과시킨다 — 색도 사용자 값이다. */
// @complexity time=O(1) space=O(1) cc=2
function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || '')) ? String(value) : fallback;
}

/** 초 → `m:ss`. */
// @complexity time=O(1) space=O(1) cc=1
export function clock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 선형 카운트(intro 의 1 = 0)를 칸 라벨로. normalizePlan · tempo 와 같은 규칙(행 × cols + 칸)이다.
 * @param {number} count
 * @param {number} cols
 * @returns {string}
 */
// @complexity time=O(1) space=O(1) cc=1
function countLabel(count, cols) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  return cellLabel(Math.floor(n / cols), n % cols, cols);
}

/**
 * 마커 한 줄. 유튜브면 `t=` 정수 초 링크, 아니면 글자만.
 * @param {{inSec:number, outSec:number, fromCount:number, toCount:number, label:string}} m
 * @param {number} cols
 * @param {string} videoId 비어 있으면 링크를 달지 않는다
 * @returns {string}
 */
// @complexity time=O(1) space=O(1) cc=3
function markerLine(m, cols, videoId) {
  const range = `${countLabel(m.fromCount, cols)} ~ ${countLabel(Math.max(m.fromCount, m.toCount - 1), cols)}`;
  const time = `${clock(m.inSec)} ~ ${clock(m.outSec)}`;
  const name = m.label ? escapeHtml(m.label) : range;
  const body = m.label ? `${name} <span class="muted">${escapeHtml(range)}</span>` : name;
  if (!videoId) return `<li><span class="time">${time}</span> ${body}</li>`;
  const href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(m.inSec))}`;
  return `<li><a href="${href}" target="_blank" rel="noopener">${time}</a> ${body}</li>`;
}

/**
 * 영상 절. 유튜브 · 로컬 영상 · 없음 세 갈래.
 * @param {{ kind:'youtube'|'file'|null, url?:string, name?:string, markers?:object[] }|null} video
 * @param {number} cols
 * @returns {string}
 */
// @complexity time=O(m) space=O(m) cc=6
function videoSection(video, cols) {
  if (!video || !video.kind) return '';
  const markers = Array.isArray(video.markers) ? video.markers : [];
  let head;
  let videoId = '';
  if (video.kind === 'youtube') {
    videoId = parseYoutubeUrl(video.url || '').videoId;
    const url = escapeHtml(video.url || '');
    head = videoId ? `<a href="${url}" target="_blank" rel="noopener">${url}</a>` : url;
  } else {
    head = `${escapeHtml(video.name || '')} <span class="muted">(내 컴퓨터의 영상 파일 — 받은 쪽에는 없다)</span>`;
  }
  const list = markers.length
    ? `<ol class="markers">${markers.map(m => markerLine(m, cols, videoId)).join('')}</ol>`
    : '<p class="muted">마커가 없다.</p>';
  return `<section class="video"><h2>영상</h2><p>${head}</p>${list}</section>`;
}

// 원칙-예외(U-16): 받는 사람이 file:// 로 따로 여는 한 파일이라 앱의 토큰(:root)이 없다 — 종이처럼 흰 바탕 · 검은 글자를 글자 그대로 적는다
const STYLE = `
  :root { color-scheme: light; }
  body { margin: 24px; font: 13px/1.45 -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif; color: #111; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .meta, .muted { color: #666; }
  .meta { margin: 0 0 16px; font-size: 12px; }
  table.sheet { border-collapse: collapse; width: 100%; table-layout: fixed; }
  table.sheet th, table.sheet td { border: 1px solid #bbb; padding: 4px 5px; vertical-align: middle; font-size: 12px; min-height: 28px; }
  table.sheet thead th { background: #eee; }
  table.sheet th.label { width: 46px; background: #f4f4f4; font-weight: 700; text-align: center; }
  table.sheet td.note { width: 26%; font-size: 11px; color: #333; word-break: break-word; }
  table.sheet td.block { font-weight: 700; color: #08111f; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1.5px solid #333; }
  table.sheet td.block.cont { font-weight: 400; color: #444; border-left-style: dashed; }
  table.sheet td.block.pending { font-weight: 400; color: #555; background: #f6f6f6 !important; border-style: dashed; }
  table.sheet td.block.routine { border-style: double; border-width: 3px; }
  table.sheet tr.lane td.label { border-top: none; }
  pre { white-space: pre-wrap; font: 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; background: #f7f7f7; padding: 10px; border-radius: 6px; }
  ol.markers { padding-left: 20px; }
  ol.markers .time { font-variant-numeric: tabular-nums; }
  @media print { body { margin: 10mm; } tr { break-inside: avoid; } h2 { break-after: avoid; } }
`;

/**
 * 안무표의 행 하나 → 층마다 `<tr>` 하나. 첫 층에 행 라벨과 비고를 rowspan 으로 둔다.
 * @param {{ rows:number, cols:number, placements:object[] }} board
 * @param {number} row
 * @param {Map<number, object[]>} entries sheetEntries(board)
 * @param {(p:object) => string} styleOf 블록의 inline style
 * @returns {string}
 */
// @complexity time=O(n·c) space=O(n·c) cc=10
function rowHtml(board, row, entries, styleOf) {
  const cols = board.cols;
  const segs = board.placements.filter(p => p.row === row && p.startIndex < cols);
  const laneCount = segs.reduce((m, p) => Math.max(m, p.subRow || 0), 0) + 1;
  const heads = new Set((entries.get(row) || []).map(e => `${e.start}:${e.lane}`));
  const rows = [];
  for (let lane = 0; lane < laneCount; lane++) {
    const inLane = segs.filter(p => (p.subRow || 0) === lane).sort((a, b) => a.startIndex - b.startIndex);
    const cells = [];
    let i = 0;
    for (const p of inLane) {
      if (p.startIndex < i) continue;                // 같은 층에서 겹친 것은 데이터 오류 — 앞의 것만 그린다
      while (i < p.startIndex) { cells.push('<td></td>'); i++; }
      const span = Math.min(p.length, cols - p.startIndex);
      const isHead = heads.has(`${p.startIndex}:${lane}`);
      const cls = ['block', p.pending ? 'pending' : '', p.type === 'routine' ? 'routine' : '', isHead ? '' : 'cont'].filter(Boolean).join(' ');
      const text = p.pending ? PENDING_MARK : `${p.type === 'routine' ? `${ROUTINE_MARK} ` : ''}${isHead ? '' : '↳ '}${escapeHtml(p.name)}`;
      cells.push(`<td class="${cls}" colspan="${span}" style="${styleOf(p)}" title="${escapeHtml(p.category || '')}">${text}</td>`);
      i += span;
    }
    while (i < cols) { cells.push('<td></td>'); i++; }
    const span = laneCount > 1 ? ` rowspan="${laneCount}"` : '';
    const first = lane === 0 ? `<th class="label"${span}>${escapeHtml(rowLabel(row, cols))}</th>` : '';
    const note = lane === 0 ? `<td class="note"${span}>${escapeHtml(rowBody(board, entries.get(row) || []))}</td>` : '';
    rows.push(`<tr${lane ? ' class="lane"' : ''}>${first}${cells.join('')}${note}</tr>`);
  }
  return rows.join('');
}

/**
 * 읽기 전용 HTML 문서 한 장.
 * @param {{
 *   title?: string,
 *   board: { rows:number, cols:number, hasIntroRow?:boolean, placements:object[] },
 *   categories?: Record<string, {label?:string, color?:string}>,
 *   routines?: {id:string, color?:string}[],
 *   video?: { kind:'youtube'|'file'|null, url?:string, name?:string, markers?:object[] }|null,
 *   generatedAt?: string
 * }} input
 * @returns {string}
 */
// @complexity time=O(r·n·c) space=O(r·n·c) cc=7
export function buildSheetHtml(input) {
  const board = input.board;
  const cols = Math.max(1, Number(board.cols) || 8);
  const title = String(input.title || '').trim() || '안무표';
  const categories = input.categories || {};
  const routines = Array.isArray(input.routines) ? input.routines : [];
  const styleOf = (p) => {
    if (p.pending) return '';
    const color = p.type === 'routine'
      ? safeColor((routines.find(r => r.id === p.routineId) || {}).color, '#ddd')
      : safeColor((categories[p.category] || {}).color, '#e5e7eb');
    return `background:${color}`;
  };
  const entries = sheetEntries(board);
  const first = board.hasIntroRow === false ? 1 : 0;
  const body = [];
  for (let row = first; row <= board.rows; row++) body.push(rowHtml({ ...board, cols }, row, entries, styleOf));
  const header = `<tr><th class="label">마디</th>${Array.from({ length: cols }, (_, i) => `<th>${i + 1}</th>`).join('')}<th class="note">비고</th></tr>`;
  const blocks = entries.size ? [...entries.values()].reduce((n, l) => n + l.length, 0) : 0;
  const meta = [`${cols}x${board.rows}`, `블록 ${blocks}개`, input.generatedAt ? `만든 날 ${escapeHtml(String(input.generatedAt).slice(0, 10))}` : '']
    .filter(Boolean).join(ENTRY_SEP);
  const text = writeCountSheet({ ...board, cols }, { title });

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${meta}</p>
<table class="sheet"><thead>${header}</thead><tbody>${body.join('')}</tbody></table>
${videoSection(input.video || null, cols)}
<section class="text"><h2>텍스트 시트</h2><pre>${escapeHtml(text)}</pre></section>
<p class="muted">빈 행은 ${escapeHtml(EMPTY_MARK)} 로 적는다. 이 파일은 안무표 편집기가 내보낸 읽기 전용 사본이다.</p>
</body>
</html>
`;
}
