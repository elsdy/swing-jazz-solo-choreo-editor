// src/usecases/linkCommands.js — 링크바 상태 전이 + 제목 조회 상태머신 (usecases 계층)
//
// 원본 index.html 의 initLinksBar 입력 핸들러 6종(YouTube 5223-5243 · ClickUp 5245-5250 ·
// ✕ 초기화 2개 5252-5265 · 커스텀 추가 5267-5270), renderCustomLinks 안의 label/url change 와
// 삭제(5181·5186·5197-5200), applyLinksData 절차부(5118-5127), clearBoard 의 링크 초기화(4484-4490)를 옮겼다.
// fetch·setTimeout·localStorage 는 여기 없다 — 디바운스는 input/adapters, 조회는 adapters/youtubeOembed,
// 쓰기는 주입받은 storage 포트가 한다.
//
// ⚠ 히스토리(2026-09): 링크는 이제 undo 스냅샷 필드다(schema.UNDO_FIELDS). 그래도 **이 파일은
//   히스토리를 쌓지 않는다** — Dirty 에 history 를 켜지도 않는다. 커밋은 호출부의 몫이라는 것이
//   이 저장소의 규약이고(input/controls.js 상단 STAGE2 계약), 링크의 커밋 지점은 아래로 한정된다:
//     · YouTube·ClickUp 입력창의 change(blur/Enter) — ui/linksBarView
//     · ✕ 초기화 버튼 둘 · 커스텀 링크 추가/삭제/레이블 change/URL change — ui/linksBarView
//     · `전체 초기화` — input/controls.js 가 clearBoard 뒤에 commitHistory('main')(4491)
//     · 프로젝트 불러오기 — projectCommands 가 applyProjectData 끝에서 커밋(4386)
//   `input` 에는 걸지 않는다(키를 누를 때마다 undo 단계가 쌓인다). resolveYoutubeTitle 에도
//   걸지 않는다 — 사용자의 조작이 아니라 네트워크 응답이다.

import { NONE } from './store.js';
import * as Links from '../domain/links.js';

// ─────────────────────────────────────────────────────────────────────────────
// 제목 조회 상태머신 — 원본은 "스피너를 만드는 곳"과 "지우는 곳"이 갈라져 있었다
//
//   원본: ytInput input 핸들러가 `.link-title-fetching` 스팬을 직접 만들어 붙이고(5227-5231),
//         그걸 지우는 것은 700ms 뒤 renderYoutubeExtras() 의 querySelectorAll(...).remove()(5133)다.
//         URL 을 지우거나 다른 URL 로 바꾸면 다음 input 의 renderYoutubeExtras 가 지운다.
//   여기:  {status, title} 값 하나로 모은다. **status === 'loading' 일 때만 스피너를 그린다.**
//
//   ⚠ 취소(AbortController)를 도입하지 않는다. 오늘은 조회를 취소하지 않고 "응답 도착 시점의
//     store.links.youtubeUrl 이 요청한 URL 과 같은가"만 본다(5236). 늦게 도착한 응답이 이기는
//     성질까지 그대로다 — 취소를 넣으면 동작 변경이다.
//   ⚠ 이 값은 store.session 에 산다(직렬화 대상이 아니다). state.links 에 넣으면
//     projectCommands 가 `...state.links` 로 펼칠 때 프로젝트 파일에 없던 키가 새어 나간다.
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{ status: 'idle'|'loading'|'ok'|'error', title: string }} TitleFetch */

/** 아직 아무것도 조회하지 않은 상태. store.session.youtubeTitleFetch 의 기본값. */
export const IDLE_TITLE_FETCH = Object.freeze({ status: 'idle', title: '' });

/**
 * 제목 조회 상태를 읽는다. store 초기 상태에는 이 키가 없으므로 뷰는 반드시 이걸 통해 읽어라.
 * @param {ReturnType<import('./store.js').createStore>} store
 * @returns {TitleFetch}
 */
export function titleFetchState(store) {
  return store.get().session.youtubeTitleFetch || IDLE_TITLE_FETCH;
}

/**
 * @typedef {Object} LinkCtx
 * @property {ReturnType<import('./store.js').createStore>} store
 * @property {(()=>string)|{uid:()=>string}} ids  커스텀 링크 id 생성기
 * @property {{ saveLinks?: (payload: object) => unknown }} [storage]
 *   ⚠ 원본 saveLinks(5099-5105)는 localStorage['choreo_links'] 에 **즉시 동기로** 쓴다.
 *   어댑터가 Promise 를 돌려줘도 여기서는 기다리지 않는다(원본에 await 지점이 없다).
 *   없으면 저장을 건너뛴다(테스트·골든용).
 */

/** @param {LinkCtx} ctx */
function persistLinks(ctx) {
  ctx.storage?.saveLinks?.(Links.serializeLinks(ctx.store.get().links));   // 5100-5104
}

/** @param {LinkCtx} ctx @param {TitleFetch} value */
function setTitleFetch(ctx, value) {
  ctx.store.patch('session', { youtubeTitleFetch: { status: value.status, title: value.title } });
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube
// ─────────────────────────────────────────────────────────────────────────────

/**
 * YouTube URL 입력(5224-5243). ⚠ **여기서는 저장하지 않는다** — URL 이 비었을 때만 즉시 저장하고(5241),
 * 값이 있으면 700ms 디바운스 뒤 resolveYoutubeTitle 이 저장한다. 이 타이밍 차이가 원본이다
 * (ClickUp·커스텀 링크는 전부 즉시 저장).
 *
 * ⚠ 제목을 **먼저 비운다**(5228). 그래서 URL 을 고치는 순간 이전 제목 칩이 사라진다.
 * ⚠ 커밋 지점이 아니다 — 히스토리는 같은 입력창의 change(blur/Enter)에서 한 번만 쌓인다.
 * ⚠ 디바운스 타이머와 조회는 호출부 몫이다: 700ms 뒤 adapters/youtubeOembed.fetchTitle(url) 을 부르고
 *   그 결과로 resolveYoutubeTitle(ctx, url, result) 를 부를 것. 새 입력이 오면 이전 타이머를 취소한다(5232).
 * @see index.html:5224
 * @param {LinkCtx} ctx
 * @param {string} rawUrl 입력 원문
 * @returns {import('./store.js').Dirty}
 */
export function setYoutubeUrl(ctx, rawUrl) {
  const url = String(rawUrl ?? '').trim();                        // 5225
  ctx.store.patch('links', { youtubeUrl: url, youtubeTitle: '' });// 5226-5227
  if (!url) {
    setTitleFetch(ctx, IDLE_TITLE_FETCH);
    persistLinks(ctx);                                            // 5241: 빈 URL 이면 즉시 저장하고 끝
    return { links: true };                                       // 5229
  }
  setTitleFetch(ctx, { status: 'loading', title: '' });            // 5234-5238 스피너
  return { links: true };                                          // 5229
}

/**
 * 디바운스된 제목 조회의 착지점(5235-5240).
 *
 * ⚠ **커밋 지점이 아니다.** 사용자의 조작이 아니라 네트워크 응답이라 여기서 히스토리를 쌓으면
 *   가만히 있어도 undo 단계가 생긴다. 제목은 다음 커밋 때 함께 스냅샷에 들어간다.
 * ⚠ **가드는 URL 동등 비교 하나뿐이다**(5236). 요청 당시의 URL 과 지금 store 의 URL 이 다르면
 *   아무 일도 하지 않는다 — 저장도, 렌더도 없다(NONE).
 * ⚠ 원본 fetchYoutubeTitle(5090-5097)은 실패를 `''` 로 삼킨다. 그래서 문자열을 받으면 언제나
 *   status:'ok' 로 본다(제목이 빈 문자열이면 칩이 안 뜨고 스피너만 사라진다 — 오늘 그대로).
 *   OEMBED_STATUS 플래그를 켠 어댑터는 {status:'error', title:''} 객체를 줄 수 있고, 그때만 'error' 가 된다.
 * @see index.html:5235
 * @param {LinkCtx} ctx
 * @param {string} requestedUrl 조회를 시작할 때의 URL
 * @param {string|{status?: 'ok'|'error', title?: string}|null} result 어댑터 응답
 * @returns {import('./store.js').Dirty}
 */
export function resolveYoutubeTitle(ctx, requestedUrl, result) {
  if (ctx.store.get().links.youtubeUrl !== requestedUrl) return NONE;   // 5236
  let status = 'ok';
  let title = '';
  if (typeof result === 'string') {
    title = result;
  } else if (result && typeof result === 'object') {
    status = result.status === 'error' ? 'error' : 'ok';
    title = String(result.title || '');
  }
  ctx.store.patch('links', { youtubeTitle: title });               // 5237
  setTitleFetch(ctx, { status, title });
  persistLinks(ctx);                                               // 5239
  return { links: true };                                          // 5238
}

/**
 * YouTube ✕ 초기화 버튼(5252-5258, PR #17). URL·제목을 비우고 즉시 저장한다.
 * ⚠ 입력창 value 비우기(5255)는 UI 몫 — 어차피 renderLinksBar 가 store 값으로 덮는다(5209).
 * @see index.html:5252
 * @param {LinkCtx} ctx
 * @returns {import('./store.js').Dirty}
 */
export function resetYoutube(ctx) {
  ctx.store.patch('links', { youtubeUrl: '', youtubeTitle: '' });  // 5253-5254
  setTitleFetch(ctx, IDLE_TITLE_FETCH);
  persistLinks(ctx);                                               // 5257
  return { links: true };                                          // 5256
}

// ─────────────────────────────────────────────────────────────────────────────
// ClickUp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ClickUp URL 입력(5246-5250). YouTube 와 달리 **디바운스 없이 즉시 저장**한다.
 * @see index.html:5246
 * @param {LinkCtx} ctx
 * @param {string} rawUrl
 * @returns {import('./store.js').Dirty}
 */
export function setClickupUrl(ctx, rawUrl) {
  ctx.store.patch('links', { clickupUrl: String(rawUrl ?? '').trim() });   // 5247
  persistLinks(ctx);                                               // 5249
  return { links: true };                                          // 5248
}

/**
 * ClickUp ✕ 초기화 버튼(5260-5265, PR #17).
 * @see index.html:5260
 * @param {LinkCtx} ctx
 * @returns {import('./store.js').Dirty}
 */
export function resetClickup(ctx) {
  ctx.store.patch('links', { clickupUrl: '' });                    // 5261
  persistLinks(ctx);                                               // 5264
  return { links: true };                                          // 5263
}

// ─────────────────────────────────────────────────────────────────────────────
// 커스텀 링크
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 빈 커스텀 링크 한 줄 추가(5267-5270).
 * @see index.html:5267
 * @param {LinkCtx} ctx
 * @returns {import('./store.js').Dirty}
 */
export function addCustomLink(ctx) {
  const links = ctx.store.get().links;
  ctx.store.patch('links', { customLinks: Links.addCustomLink(links.customLinks, ctx.ids) });   // 5268
  persistLinks(ctx);                                               // 5269
  return { links: true };                                          // 5269
}

/**
 * 커스텀 링크 한 줄의 레이블/URL 갱신(5181·5186).
 *
 * ⚠ **두 입력의 렌더 범위가 다르다.** 레이블 change 는 `link.label = …; saveLinks();` 로 끝나고
 *   renderCustomLinks 를 부르지 **않는다**(5181). URL change 만 다시 그린다(5186).
 *   그래서 fields 에 url 이 있을 때만 Dirty 를 낸다 — 레이블 편집 중 행이 재생성되지 않는 것이 오늘 동작이다.
 * ⚠ label 은 trim 하지 않고 url 만 trim 한다(domain/links.updateCustomLink 가 그 비대칭을 담고 있다).
 * @see index.html:5181
 * @see index.html:5186
 * @param {LinkCtx} ctx
 * @param {string} id
 * @param {{ label?: string, url?: string }} fields
 * @returns {import('./store.js').Dirty}
 */
export function updateCustomLink(ctx, id, fields) {
  const links = ctx.store.get().links;
  ctx.store.patch('links', { customLinks: Links.updateCustomLink(links.customLinks, id, fields) });
  persistLinks(ctx);                                               // 5181·5186
  return fields && fields.url !== undefined ? { links: true } : NONE;   // 5186 만 renderCustomLinks
}

/**
 * 커스텀 링크 삭제(5197-5200).
 * ⚠ id 기준이라 id 가 undefined 인 항목이 여럿이면 한꺼번에 사라진다 — localStorage 에서 읽은
 *   링크는 항목 정규화를 거치지 않아 실제로 가능하다(loadLinks 5113, 보존 대상 결함).
 * @see index.html:5197
 * @param {LinkCtx} ctx
 * @param {string} id
 * @returns {import('./store.js').Dirty}
 */
export function removeCustomLink(ctx, id) {
  const links = ctx.store.get().links;
  ctx.store.patch('links', { customLinks: Links.removeCustomLink(links.customLinks, id) });   // 5198
  persistLinks(ctx);                                               // 5199
  return { links: true };                                          // 5199
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트 파일 · 전체 초기화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 프로젝트 파일을 열 때 링크 4필드를 통째로 갈아끼운다. applyLinksData(5118-5127).
 *
 * ⚠ 커밋은 여기서 하지 않는다 — 불러오기 절차의 마지막(4386)에서 한 번 쌓는다. 그때 링크가
 *   이미 store 에 들어와 있어야 스냅샷에 실린다(이 함수가 그 앞에 불린다).
 * ⚠ 이 경로만 커스텀 링크 **항목을 정규화한다**(id 없으면 uid 부여, label/url String 강제 — 5122).
 *   localStorage 경로(loadLinks 5113)는 항목을 손대지 않는다. 둘을 같게 만들면 저장된 링크의 id 가
 *   새로 생겨 동작이 바뀐다.
 * @see index.html:5118
 * @param {LinkCtx} ctx
 * @param {object} data 프로젝트 파일(평평한 youtubeUrl/youtubeTitle/clickupUrl/customLinks)
 * @returns {import('./store.js').Dirty}
 */
export function applyLinksFromProject(ctx, data) {
  const links = Links.normalizeLinks(data, { normalizeCustomItems: true, ids: ctx.ids });   // 5119-5123
  ctx.store.patch('links', links);
  setTitleFetch(ctx, { status: 'idle', title: links.youtubeTitle });
  persistLinks(ctx);                                               // 5125
  return { links: true };                                          // 5126
}

/**
 * 전체 초기화(clearBoard 4481-4492)가 링크에 하는 일 — 4필드를 비우고 **즉시** localStorage 에 쓴다.
 *
 * ⚠ 이 커맨드는 boardCommands 가 아니라 여기에 둔다. boardCommands.clearBoard 는 배치를 비운 뒤
 *   이 함수를 부르고 두 Dirty 를 mergeDirty 로 합쳐라(원본은 renderLinksBar 를 renderRows 보다
 *   **먼저** 부르지만 presenter 의 고정 순서가 boards → links 라 화면 결과는 같다).
 * ⚠ 2026-09 이전에는 여기가 보존 대상 결함이었다 — 링크가 undo 스냅샷 밖인데 지워지고 즉시
 *   저장돼 Undo 로 돌아오지 않았다. 지우는 동작(PR #17)은 그대로 두고, schema.UNDO_FIELDS 에
 *   links 를 더해 되돌릴 수 있게 했다. **이 함수는 그대로다** — 되돌리기는 호출부의 커밋
 *   (controls.js 의 clearBoard → commitHistory('main') 4491)과 historyCommands 의 복원이 맡는다.
 * ⚠ 비우는 값은 손으로 4필드를 쓰지 않고 `normalizeLinks({})` 가 만드는 것을 쓴다(STAGE1 계약).
 * @see index.html:4481
 * @param {LinkCtx} ctx
 * @returns {import('./store.js').Dirty}
 */
export function clearLinks(ctx) {
  ctx.store.patch('links', Links.normalizeLinks({}));              // 4484-4487
  setTitleFetch(ctx, IDLE_TITLE_FETCH);
  persistLinks(ctx);                                               // 4489
  return { links: true };                                          // 4488
}
