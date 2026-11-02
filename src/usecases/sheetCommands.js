// src/usecases/sheetCommands.js — 카운트 시트 내보내기: 텍스트 복사 · 읽기 전용 HTML 내려받기 · 인쇄 (usecases 계층)
//
// 신설 파일이다(RM-21). 안무표를 남에게 줄 수 있는 꼴 셋으로 내보낸다. 글자를 만드는 것은 도메인
// (domain/countSheet · domain/sheetHtml)이고, 클립보드 · 내려받기 · 인쇄 창은 주입받은 fileIO(adapters/browser 의
// browserFileIO)가 한다 — 여기는 DOM 도 Date 도 모른다.
//
// ⚠ 상태를 바꾸지 않는다. 돌려주는 Dirty 는 알림(notify)뿐이다.
// ⚠ 파일 이름은 이름칸의 날값을 받는다(saveProject 와 같다). 비어 있으면 `안무표`.

import { BOARD_MAIN, NONE, boardOf, notice } from './store.js';
import { writeCountSheet } from '../domain/countSheet.js';
import { buildSheetHtml } from '../domain/sheetHtml.js';
import { activeClipOf } from '../domain/project/media.js';

/**
 * @typedef {Object} SheetDeps
 * @property {ReturnType<import('./store.js').createStore>} store
 * @property {{ copyText: (text: string) => Promise<boolean>|boolean,
 *              downloadText: (text: string, fileName: string, mime?: string) => unknown,
 *              print: () => unknown }} files 어댑터. 세 메서드만 부른다
 * @property {{ nowIso?: () => string }} [env] HTML 의 「만든 날」. 없으면 적지 않는다
 */

/** 기본 파일 이름. */
export const DEFAULT_SHEET_NAME = '안무표';

/**
 * 이름칸의 날값 → 파일 이름 줄기. 끝의 점을 떼고(saveProject 와 같은 규칙) 비면 기본 이름.
 * @param {unknown} raw
 * @returns {string}
 */
// @complexity time=O(n) space=O(n) cc=2
export function sheetFileName(raw) {
  const name = (typeof raw === 'string' ? raw : '').trim().replace(/\.+$/g, '');
  return name || DEFAULT_SHEET_NAME;
}

/**
 * 지금 메인 보드의 텍스트 시트.
 * @param {object} store
 * @param {{ title?: string }} [args]
 * @returns {string}
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function sheetText(store, args = {}) {
  return writeCountSheet(boardOf(store.get(), BOARD_MAIN), { title: args.title });
}

/**
 * 지금 활성 영상의 내보내기용 요약 — 종류 · 주소/이름 · 마커. 영상이 없으면 null.
 * @param {object} state
 * @returns {{ kind:'youtube'|'file', url?:string, name?:string, markers:object[] }|null}
 */
// @complexity time=O(1) space=O(1) cc=4
export function sheetVideo(state) {
  const clip = activeClipOf(state.media);
  const source = clip && clip.source;
  if (!source || !source.kind) return null;
  const markers = Array.isArray(clip.markers) ? clip.markers : [];
  return source.kind === 'youtube'
    ? { kind: 'youtube', url: source.url || '', markers }
    : { kind: 'file', name: source.name || clip.name || '', markers };
}

/**
 * 지금 메인 보드의 읽기 전용 HTML.
 * @param {SheetDeps} deps
 * @param {{ title?: string }} [args]
 * @returns {string}
 */
// @complexity time=O(r·n·c) space=O(r·n·c) cc=2
export function sheetHtml(deps, args = {}) {
  const state = deps.store.get();
  return buildSheetHtml({
    title: args.title,
    board: boardOf(state, BOARD_MAIN),
    categories: state.categories,
    routines: state.routines,
    video: sheetVideo(state),
    generatedAt: deps.env && typeof deps.env.nowIso === 'function' ? deps.env.nowIso() : ''
  });
}

/**
 * 텍스트 시트를 클립보드에 담는다. 담지 못하면 오류 알림(던지지 않는다).
 * @param {SheetDeps} deps
 * @param {{ fileName?: string }} [args] 이름칸의 날값 — 첫 줄의 제목이 된다
 * @returns {Promise<import('./store.js').Dirty>}
 */
// @complexity time=O(n log n) space=O(n) cc=3
export async function copySheetText(deps, args = {}) {
  const title = (typeof args.fileName === 'string' ? args.fileName : '').trim();
  const text = sheetText(deps.store, { title });
  let ok = false;
  try { ok = Boolean(await deps.files.copyText(text)); } catch { ok = false; }
  const lines = text.split('\n').length;
  return {
    notify: ok
      ? notice('status', `텍스트 시트 ${lines}줄을 담았습니다. 메신저 · 메모장에 붙이세요.`)
      : notice('error', '클립보드에 담지 못했습니다 — 브라우저가 막았습니다. 읽기 전용 HTML 로 받아 보세요.')
  };
}

/**
 * 읽기 전용 HTML 을 `<이름>-sheet.html` 로 내려받는다.
 * @param {SheetDeps} deps
 * @param {{ fileName?: string }} [args]
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(r·n·c) space=O(r·n·c) cc=1
export function downloadSheetHtml(deps, args = {}) {
  const name = sheetFileName(args.fileName);
  deps.files.downloadText(sheetHtml(deps, { title: name }), `${name}-sheet.html`, 'text/html');
  return { notify: notice('status', `${name}-sheet.html 을 내려받았습니다. 더블클릭으로 열립니다.`) };
}

/**
 * 인쇄 창을 연다. 인쇄할 것이 없으면(빈 안무표) 알림만.
 * @param {SheetDeps} deps
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(1) space=O(1) cc=2
export function printSheet(deps) {
  const board = boardOf(deps.store.get(), BOARD_MAIN);
  if (!board.placements.length) return { notify: notice('status', '안무표가 비어 있습니다 — 블록을 놓은 뒤 인쇄하세요.') };
  deps.files.print();
  return NONE;
}
