// src/domain/links.js — 링크바의 값 규칙 (순수 함수)
//
// 원본 index.html 의 normalizeYoutubeUrl(5078-5088) · saveLinks 직렬화부(5101-5104) ·
// loadLinks 정규화부(5111-5114) · applyLinksData 정규화부(5119-5123) ·
// renderCustomLinks 의 label/url 제자리 변형(5181·5186)과 삭제(5198) 를 옮겼다.
//
// ⚠ normalizeYoutubeUrl 은 **오늘과 글자 단위로 같은 문자열**을 돌려줘야 한다(저장된 링크가 그대로 비교된다).
//   정규식을 새로 쓰지 않고 원문을 그대로 옮겼다.
// ⚠ 링크는 undo 범위 밖이다(브리프 00-DELTA #6). clearBoard 가 링크를 지우고 즉시 localStorage 에 쓴다 —
//   그 규칙은 `normalizeLinks({})` 가 만드는 빈 값과 같다.

/** @typedef {{ id: string, label: string, url: string }} CustomLink */
/** @typedef {{ youtubeUrl: string, youtubeTitle: string, clickupUrl: string, customLinks: CustomLink[] }} Links */

const idsOf = (ids) => (typeof ids === 'function' ? ids : ids.uid);

// ─────────────────────────────────────────────────────────────────────────────
// YouTube URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * YouTube URL 을 `https://www.youtube.com/watch?v=…` 형태로 정규화한다.
 * 원본 5078-5088 을 한 글자도 바꾸지 않고 옮겼다.
 * ⚠ 파싱에 실패하거나 v 파라미터가 없으면 **입력을 trim 만 해서 그대로** 돌려준다(빈 문자열도 그대로).
 * ⚠ raw 가 문자열이 아니면 마지막 `raw.trim()` 에서 터진다 — 원본도 같다(try 밖이라 catch 되지 않는다).
 * @see index.html:5078
 * @param {string} raw
 * @returns {string}
 */
export function normalizeYoutubeUrl(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/watch?v=${u.pathname.slice(1).split('?')[0]}`;
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
  } catch {}
  return raw.trim();
}

/** `90` · `1m30s` · `1h2m3s` 형태의 시간 파라미터를 초로. 못 읽으면 0. */
function parseTimeParam(value) {
  if (!value) return 0;
  const plain = /^\d+$/.exec(value);
  if (plain) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/**
 * normalizeYoutubeUrl 옆에 두는 구조 분해판. 임베드 플레이어가 videoId 를 요구하기 때문에 둔다.
 * ⚠ 부르는 곳은 adapters/media/pickPlayer.js **한 곳뿐**이다(2026-09, 영상 패널). videoId 파싱을
 *   두 벌로 만들지 않기 위해 어댑터가 정규식을 쓰지 않고 이 함수를 쓴다.
 *   normalizeYoutubeUrl 의 동작에는 전혀 관여하지 않으며, 실패는 예외 없이
 *   `{ videoId: '', startSec: 0 }` 으로 흡수한다 — 못 알아본 URL 은 "소스 없음"이지 오류가 아니다.
 * @param {string} raw
 * @returns {{ videoId: string, startSec: number }}
 */
export function parseYoutubeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    let videoId = '';
    if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1).split('?')[0];
    else if (u.hostname.includes('youtube.com')) videoId = u.searchParams.get('v') || '';
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    return { videoId, startSec: parseTimeParam(t) };
  } catch {
    return { videoId: '', startSec: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 링크 묶음 정규화 · 직렬화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 링크 묶음 정규화. ⚠ 원본에는 **규칙이 두 벌** 있고 커스텀 링크 항목 처리가 다르다:
 *  - loadLinks(5111-5114, localStorage): `Array.isArray ? d.customLinks : []` — 항목을 **손대지 않는다**.
 *    id 가 없는 항목이 그대로 들어와 삭제 버튼(l.id !== link.id)이 오작동할 수 있다.
 *  - applyLinksData(5119-5123, 프로젝트 파일): 항목마다 `{ id: l.id || uid(), label: String(...), url: String(...) }`.
 * 합치면 동작이 바뀌므로 `normalizeCustomItems` 로 갈라 둔다. 기본값은 loadLinks 쪽(false)이다.
 *
 * `normalizeLinks({})` 는 네 값이 모두 비어 있는 묶음을 만든다 — loadLinks 의 catch 분기(5115)와
 * clearBoard 의 링크 초기화(브리프 00-DELTA #6)가 쓰는 값이 정확히 이것이다.
 * @see index.html:5111
 * @see index.html:5119
 * @param {object|null|undefined} data
 * @param {{ normalizeCustomItems?: boolean, ids?: (() => string) | { uid: () => string } }} [options]
 * @returns {Links}
 */
export function normalizeLinks(data, options = {}) {
  const { normalizeCustomItems = false, ids = null } = options;
  const d = data || {};
  const rawCustom = Array.isArray(d.customLinks) ? d.customLinks : [];
  let customLinks = rawCustom;
  if (normalizeCustomItems) {
    const nextId = idsOf(ids);
    customLinks = rawCustom.map(l => ({ id: l.id || nextId(), label: String(l.label || ''), url: String(l.url || '') }));
  }
  return {
    youtubeUrl: d.youtubeUrl || '',
    youtubeTitle: d.youtubeTitle || '',
    clickupUrl: d.clickupUrl || '',
    customLinks
  };
}

/**
 * localStorage('choreo_links') 와 프로젝트 페이로드에 실리는 형태. 키 순서는 원본 5101-5104 그대로.
 * @see index.html:5101
 * @param {Links} links
 * @returns {Links}
 */
export function serializeLinks(links) {
  return {
    youtubeUrl: links.youtubeUrl, youtubeTitle: links.youtubeTitle,
    clickupUrl: links.clickupUrl,
    customLinks: links.customLinks
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 커스텀 링크
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 빈 커스텀 링크를 맨 뒤에 추가한다(5268).
 * @see index.html:5268
 * @param {CustomLink[]} customLinks
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {CustomLink[]} 새 배열
 */
export function addCustomLink(customLinks, ids) {
  const nextId = idsOf(ids);
  return [...customLinks, { id: nextId(), label: '', url: '' }];
}

/**
 * 커스텀 링크 한 개의 label/url 갱신.
 * ⚠ **비대칭을 그대로 옮겼다**: label 은 입력값을 그대로 쓰고(5181 `link.label = labelInput.value`),
 *   url 만 trim 한다(5186 `link.url = urlInput.value.trim()`). 레이블 앞뒤 공백은 살아남는다.
 * ⚠ 원본은 배열 안의 객체를 제자리 변형한다. 여기서는 새 배열/새 객체를 돌려주므로 호출부가 대입해야 한다.
 *   키가 이미 있어 키 순서와 JSON 바이트는 같다.
 * @see index.html:5181
 * @see index.html:5186
 * @param {CustomLink[]} customLinks
 * @param {string} id
 * @param {{ label?: string, url?: string }} patch
 * @returns {CustomLink[]} 새 배열
 */
export function updateCustomLink(customLinks, id, patch) {
  return customLinks.map(l => {
    if (l.id !== id) return l;
    const next = { ...l };
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.url !== undefined) next.url = String(patch.url).trim();
    return next;
  });
}

/**
 * 커스텀 링크 삭제(5198).
 * ⚠ id 기준이라 id 가 없는(=undefined) 항목이 여럿이면 한꺼번에 사라진다 — loadLinks 경로로 들어온
 *   항목은 id 정규화를 거치지 않으므로 실제로 가능한 일이다(원본 그대로).
 * @see index.html:5198
 * @param {CustomLink[]} customLinks
 * @param {string} id
 * @returns {CustomLink[]} 새 배열
 */
export function removeCustomLink(customLinks, id) {
  return customLinks.filter(l => l.id !== id);
}
