// src/ui/helpLinks.js — 화면의 작은 `?` 단추가 여는 문서 절의 표 (ui 계층, 2026-11-02 · RM-26)
//
// 막힌 자리에서 설명서의 **그 절**로 곧장 가게 한다. 단추는 마크업에 `data-help="<키>"` 로 두고, 누름은
// docsHub 가 문서 전체에서 위임받아 이 표로 문서 id 와 앵커를 찾아 open(docId, anchor) 한다.
//
// ⚠ 키 → 문서 · 앵커의 주인은 이 표 하나다. 앵커는 docsHub.renderMarkdown 이 제목에서 만드는 id 와 같아야 한다 —
//   제목이 바뀌면 조용히 허공을 가리키므로 tools/check-docs.mjs 가 표의 줄마다 그 앵커가 실제 문서에 있는지 잰다.
// ⚠ 마크업의 data-help 키와 이 표도 서로 맞춰 센다(원칙 D-14) — 표에 없는 키, 쓰이지 않는 줄이 모두 붉어진다.

/** @typedef {{ key: string, doc: string, anchor: string, what: string }} HelpLink */

/** @type {readonly HelpLink[]} */
export const HELP_LINKS = Object.freeze([
  { key: 'file-menu',   doc: 'tutorial', anchor: '결과-받기',                               what: '파일 메뉴 — 저장 · 불러오기 · 자동 담기' },
  { key: 'fill-bar',    doc: 'tutorial', anchor: '둘째-줄-채우기',                          what: '채우기 줄 — 안무표를 채우는 길 넷' },
  { key: 'example',     doc: 'tutorial', anchor: '예제를-먼저-연다',                        what: '예제 열기' },
  { key: 'video-pick',  doc: 'tutorial', anchor: '8단계-참고-영상을-붙인다',                what: '① 영상 고르기' },
  { key: 'video-tempo', doc: 'tutorial', anchor: '9단계-영상을-옆에-띄우고-박자를-맞춘다',  what: '② 박자 맞추기' },
  { key: 'video-capture', doc: 'features', anchor: '영상-보면서-안무표에-받아-적기',what: '③ 받아 적기' },
  { key: 'video-trim',  doc: 'features', anchor: '영상-구간-inout-잡고-잘라내기',what: '구간 잡고 잘라내기(도구)' },
  { key: 'video-markers', doc: 'features', anchor: '마커로-영상-구간과-안무표-구간-잇기',what: '마커(도구)' },
  { key: 'video-pose',  doc: 'features', anchor: '영상에서-자세-분석하기',what: '자세 분석(도구)' },
  { key: 'quick-place', doc: 'tutorial', anchor: '4단계-나머지-마디를-빠른-배치로-채운다',  what: '동작 선택 팝업(빠른 배치)' },
  { key: 'compose',     doc: 'tutorial', anchor: '말로-채우기',                              what: '✨ 말로 채우기' },
].map(Object.freeze));

const BY_KEY = new Map(HELP_LINKS.map(l => [l.key, l]));

/**
 * 표에 있는 키만 해석한다. 그 밖은 null.
 * @param {string} key
 * @returns {HelpLink|null}
 */
// @complexity time=O(1) space=O(1) cc=1
export function helpLinkFor(key) {
  return BY_KEY.get(String(key)) || null;
}

/**
 * 표의 줄마다 문서 id 가 등록부에 있고 앵커가 그 문서의 렌더 결과에 있는지 잰다. check-docs 와 그 시험이 쓴다.
 * @param {readonly HelpLink[]} links
 * @param {Map<string, Set<string>>} anchorsOf 문서 id → 렌더된 id 집합
 * @param {(id: string) => unknown} resolveDoc 등록부 해석기(docsRegistry.resolveDoc)
 * @returns {string[]} 문제 목록 — 비면 통과. 줄마다 단추 키와 앵커가 찍힌다
 */
// @complexity time=O(n) space=O(n) cc=4
export function missingHelpAnchors(links, anchorsOf, resolveDoc) {
  const problems = [];
  for (const l of links) {
    if (!resolveDoc(l.doc)) { problems.push(`? 단추 '${l.key}': 등록부에 없는 문서 '${l.doc}'`); continue; }
    const ids = anchorsOf.get(l.doc);
    if (!ids) continue;                              // 파일 없음은 등록부 검사가 이미 잡았다
    if (!ids.has(l.anchor)) problems.push(`? 단추 '${l.key}': ${l.doc} 에 앵커가 없다 → #${l.anchor}`);
  }
  return problems;
}

/**
 * 마크업 · 화면 코드가 쓰는 data-help 키와 표를 맞춰 센다(D-14).
 * @param {readonly HelpLink[]} links
 * @param {Iterable<string>} usedKeys 화면 쪽에서 긁은 키
 * @returns {string[]} 문제 목록
 */
// @complexity time=O(n) space=O(n) cc=3
export function unmatchedHelpKeys(links, usedKeys) {
  const table = new Set(links.map(l => l.key));
  const used = new Set(usedKeys);
  const problems = [];
  for (const k of used) if (!table.has(k)) problems.push(`data-help="${k}" 가 helpLinks 표에 없다 — 누르면 아무 일도 없다`);
  for (const k of table) if (!used.has(k)) problems.push(`helpLinks 표의 '${k}' 를 쓰는 단추가 화면에 없다 — 표에서 지우거나 단추를 단다`);
  return problems;
}
