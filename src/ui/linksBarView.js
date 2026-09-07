// src/ui/linksBarView.js — 보드 위 링크바(YouTube · ClickUp · 커스텀 링크) 렌더와 자기 입력 바인딩 (ui 계층)
//
// 원본 index.html 의 renderYoutubeExtras(5129-5152) · renderClickupExtras(5154-5164) ·
// renderCustomLinks(5166-5205) · renderLinksBar(5207-5215) · initLinksBar 의 DOM 바인딩(5217-5222 · 5223-5271)을 옮겼다.
//
// ⚠⚠ **입력 핸들러는 presenter 를 거치지 않는다.** 원본이 그렇다:
//     ytInput 'input'   → renderYoutubeExtras() 만(5228)
//     cuInput 'input'   → renderClickupExtras() 만(5248)
//     커스텀 링크 조작   → renderCustomLinks() 만(5186 · 5199 · 5269)
//   전체 render(=renderLinksBar 5207)를 부르면 `ytInput.value = state.youtubeUrl`(5209) 가
//   **입력 중에 trim 된 값을 되써서** 뒤 공백이 지워지고 커서가 끝으로 튄다. 그래서 부분 렌더를 유지한다.
//   presenter 가 부르는 render(links, titleFetch) 는 프로젝트 불러오기·전체 초기화처럼
//   바깥에서 상태가 통째로 바뀐 경우(원본 4488 · 5126)만을 위한 것이다.
//
// ⚠ 스피너는 **status === 'loading' 일 때만** 그린다. 원본은 만드는 곳(5231-5234)과 지우는 곳(5134)이
//   갈라져 있었지만, 값 하나(TitleFetch)에서 재도출하면 같은 DOM 이 나온다.
//   loading 이면 제목이 반드시 빈 문자열이라(setYoutubeUrl 이 5227 에서 지운다) 칩과 스피너는 공존하지 않는다.
//
// ⚠ 700ms 디바운스는 이 파일이 소유한다(어댑터에 상수가 없다). 원본 5232-5243 의 순서를 지킨다:
//     ① 상태 갱신 + 부분 렌더 → ② 이전 타이머 cancel → ③ 빈 URL 이면 여기서 끝(저장은 커맨드가 이미 함)
//     → ④ (스피너는 status 로 이미 떠 있다) 700ms 예약
// ⚠ AbortController 를 넣지 마라 — 취소 없음이 오늘 동작이다. 늦게 도착한 응답은
//   resolveYoutubeTitle 의 URL 동등 비교(5236) 하나로만 걸러진다.
//
// ⚠ 커스텀 링크의 비대칭(2단계 계약): 레이블 change 는 **다시 그리지 않고**(5181), URL change 만 다시 그린다(5186).
//   레이블을 다시 그리면 입력 중 행이 재생성돼 포커스가 날아간다.

import { CLS, SEL } from './domContract.js';
import { normalizeYoutubeUrl } from '../domain/links.js';

/** 제목 조회 디바운스. 원본 5243 의 리터럴. */
export const TITLE_FETCH_DEBOUNCE_MS = 700;

/** 아무것도 조회하지 않은 상태. usecases/linkCommands.IDLE_TITLE_FETCH 와 같은 모양이다. */
const IDLE_FETCH = { status: 'idle', title: '' };

/**
 * @typedef {{ status: 'idle'|'loading'|'ok'|'error', title: string }} TitleFetch
 */

/**
 * @typedef {object} LinksBarDeps
 * @property {any} store createStore 인스턴스. store.links 만 읽는다.
 * @property {() => TitleFetch} [titleFetchState] linkCommands.titleFetchState(store) 를 감싼 게터.
 *   없으면 항상 idle 로 본다(스피너가 뜨지 않는다).
 * @property {{
 *   setYoutubeUrl: (rawUrl: string) => any,
 *   resolveYoutubeTitle: (requestedUrl: string, result: any) => any,
 *   resetYoutube: () => any,
 *   setClickupUrl: (rawUrl: string) => any,
 *   resetClickup: () => any,
 *   addCustomLink: () => any,
 *   updateCustomLink: (id: string, fields: { label?: string, url?: string }) => any,
 *   removeCustomLink: (id: string) => any
 * }} commands app/main 이 linkCommands 를 묶어 넘긴다.
 * @property {(dirty: any) => void} [render] presenter 의 apply. ⚠ 이 뷰는 **쓰지 않는다**(위 경고 참조) —
 *   받아도 무해하도록 자리만 남겨 두었다. 링크바의 입력 경로는 전부 자기 부분 렌더다.
 * @property {(fn: Function, waitMs: number) => (Function & { cancel(): void, pending(): boolean })} debounce
 *   adapters/browser.debounce
 * @property {(url: string) => Promise<string>|string} fetchTitle adapters/youtubeOembed.fetchTitle.
 *   ⚠ 입력 **원문**을 그대로 넘긴다 — 정규화는 어댑터가 안에서 한다(원본 5092).
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * 링크바 뷰를 만든다. 팩토리 안에서 자기 입력(#youtubeUrlInput · #clickupUrlInput ·
 * #ytResetBtn · #clickupResetBtn · #addCustomLinkBtn)을 한 번 바인딩한다.
 *
 * @param {LinksBarDeps} deps
 * @returns {{
 *   render(links?: any, titleFetch?: TitleFetch): void,
 *   renderYoutubeExtras(): void,
 *   renderClickupExtras(): void,
 *   renderCustomLinks(): void
 * }}
 */
export function createLinksBarView(deps) {
  const {
    store,
    titleFetchState = () => IDLE_FETCH,
    commands,
    debounce,
    fetchTitle,
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  /**
   * '↗ 새 창에서 열기' 버튼. 원본 3벌(5144-5147 · 5160-5163 · 5190-5194)이 글자 단위로 같다.
   * @param {() => string} getUrl 클릭 시점에 열 URL을 돌려준다(값을 캡처하지 않는다)
   * @returns {HTMLButtonElement}
   */
  function makeOpenBtn(getUrl) {
    const openBtn = document.createElement('button');
    openBtn.className = CLS.ghost + ' ' + CLS.linkOpenBtn;
    openBtn.type = 'button';
    openBtn.title = '새 창에서 열기';
    openBtn.textContent = '↗';
    openBtn.addEventListener('click', () => {
      const u = getUrl();
      if (u) window.open(u, '_blank', 'noopener');
    });
    return openBtn;
  }

  /**
   * YouTube 행의 제목 칩 · 스피너 · ↗ 버튼(원본 renderYoutubeExtras 5129-5152 + 스피너 5231-5234).
   * @param {any} [links] 생략하면 store.links
   * @param {TitleFetch} [fetch_] 생략하면 titleFetchState()
   */
  function renderYoutubeExtras(links, fetch_) {
    const state = links || store.links;
    const fetchState = fetch_ || titleFetchState() || IDLE_FETCH;
    const row = byId('youtubeLinkRow');                              // 5130
    const group = byId('ytUrlGroup');                                // 5131
    if (!row || !group) return;                                      // 5132
    // 제목 칩·스피너는 group 안에서 제거 (URL 입력 바로 옆)
    group.querySelectorAll(SEL.linkTitleChips).forEach(el => el.remove());   // 5134
    // ↗ 버튼은 row 레벨에서 제거
    row.querySelectorAll(SEL.linkOpenBtn).forEach(el => el.remove());        // 5136
    if (!state.youtubeUrl) return;                                   // 5137
    if (state.youtubeTitle) {                                        // 5138
      const a = document.createElement('a');
      a.className = CLS.linkTitleChip;                               // 5140
      a.href = normalizeYoutubeUrl(state.youtubeUrl);                // 5141
      a.target = '_blank'; a.rel = 'noopener noreferrer';            // 5142
      a.title = state.youtubeTitle;                                  // 5143
      a.textContent = state.youtubeTitle;                            // 5144
      group.appendChild(a); // URL 바로 옆, gap 없이                  // 5145
    }
    // ⚠ 원본 5233-5234 — 스피너는 group 안, 입력 바로 뒤에 붙는다. 문구도 원문 그대로('…'는 U+2026).
    if (fetchState.status === 'loading') {
      const spinner = document.createElement('span');
      spinner.className = CLS.linkTitleFetching;
      spinner.textContent = '제목 불러오는 중…';
      group.appendChild(spinner);
    }
    // ↗ 버튼은 group 바깥 row 에 (5151).
    // ⚠ 클릭 시점에 store.links 를 다시 읽는다 — 원본이 가변 전역 state 를 읽던 것과 같아야 한다.
    row.appendChild(makeOpenBtn(() => normalizeYoutubeUrl(store.links.youtubeUrl)));
  }

  /** ClickUp 행의 ↗ 버튼(원본 renderClickupExtras 5154-5164). */
  function renderClickupExtras(links) {
    const state = links || store.links;
    const row = byId('clickupLinkRow');                              // 5155
    if (!row) return;                                                // 5156
    row.querySelectorAll(SEL.linkOpenBtn).forEach(el => el.remove()); // 5157
    if (!state.clickupUrl) return;                                   // 5158
    // ⚠ ClickUp 은 정규화하지 않는다 — 입력값 그대로 연다(5162). 클릭 시점에 store 를 다시 읽는다.
    row.appendChild(makeOpenBtn(() => store.links.clickupUrl));
  }

  /** 커스텀 링크 행 전부(원본 renderCustomLinks 5166-5205). */
  function renderCustomLinks(links) {
    const state = links || store.links;
    const container = byId('customLinksContainer');                  // 5167
    if (!container) return;                                          // 5168
    container.innerHTML = '';                                        // 5169
    state.customLinks.forEach(link => {
      const row = document.createElement('div');
      row.className = CLS.linkRow;                                   // 5172

      const badge = document.createElement('span');
      badge.className = CLS.linkBadge + ' ' + CLS.badgeCustom;       // 5175
      badge.textContent = '🔗';
      row.appendChild(badge);

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = CLS.linkLabelInput;                     // 5179
      labelInput.placeholder = '레이블';                              // 5180
      labelInput.value = link.label;
      // ⚠ 5181 — 저장만 하고 **다시 그리지 않는다**. 여기서 재렌더하면 입력 중 행이 재생성된다.
      //   커맨드는 NONE 을 돌려주므로 반환값을 버린다(presenter 를 부르지 않는다).
      labelInput.addEventListener('change', () => { commands.updateCustomLink(link.id, { label: labelInput.value }); });
      row.appendChild(labelInput);

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.placeholder = 'URL 입력...';                           // 5185 — '...'는 마침표 3개다
      urlInput.value = link.url;
      // ⚠ 5186 — trim 은 커맨드가 한다(뷰에서 미리 자르지 마라). 저장 뒤 목록만 다시 그린다.
      urlInput.addEventListener('change', () => {
        commands.updateCustomLink(link.id, { url: urlInput.value });
        renderCustomLinks();
      });
      row.appendChild(urlInput);

      // ⚠ 5194 — 여기만 link.url 이 아니라 **입력창의 현재 값**을 읽는다. 원문 그대로 둔다.
      row.appendChild(makeOpenBtn(() => urlInput.value.trim()));

      const delBtn = document.createElement('button');
      delBtn.className = CLS.linkDelBtn;                             // 5198
      delBtn.type = 'button';
      delBtn.title = '삭제';
      delBtn.textContent = '×';
      // ⚠ confirmOnce 가 없다(원본 5199-5202). 한 번 누르면 바로 지워진다.
      delBtn.addEventListener('click', () => {
        commands.removeCustomLink(link.id);
        renderCustomLinks();
      });
      row.appendChild(delBtn);

      container.appendChild(row);                                    // 5204
    });
  }

  /**
   * 링크바 전체(원본 renderLinksBar 5207-5215). presenter 가 Dirty.links 에 대해 부른다.
   * ⚠ 입력창 value 를 store 값으로 덮으므로 **입력 중에는 부르지 마라**.
   * @param {any} [links]
   * @param {TitleFetch} [titleFetch]
   */
  function renderAll(links, titleFetch) {
    const state = links || store.links;
    const fetchState = titleFetch || titleFetchState() || IDLE_FETCH;
    const ytInput = byId('youtubeUrlInput');
    if (ytInput) ytInput.value = state.youtubeUrl;                   // 5209
    const cuInput = byId('clickupUrlInput');
    if (cuInput) cuInput.value = state.clickupUrl;                   // 5211
    renderYoutubeExtras(state, fetchState);                          // 5212
    renderClickupExtras(state);                                      // 5213
    renderCustomLinks(state);                                        // 5214
  }

  // ── 바인딩 (원본 initLinksBar 5223-5271) ─────────────────────────────────

  /** 700ms 뒤 제목을 조회한다. 원본 5235-5243 의 setTimeout 안쪽. */
  const scheduleTitleFetch = debounce((url) => {
    Promise.resolve(fetchTitle(url)).then((title) => {
      // 5236 URL 동등 비교 · 5237 제목 대입 · 5239 저장은 전부 커맨드가 한다.
      const dirty = commands.resolveYoutubeTitle(url, title);
      // URL 이 바뀌어 가드에 걸렸으면 NONE({}) 이 오고, 원본도 이때 아무것도 그리지 않는다.
      if (dirty && dirty.links) renderYoutubeExtras();               // 5238
    });
  }, TITLE_FETCH_DEBOUNCE_MS);

  const ytInput = byId('youtubeUrlInput');
  if (ytInput) {
    ytInput.addEventListener('input', () => {                        // 5226
      // ① URL 대입 + 제목 비우기 + (빈 URL 이면) 즉시 저장까지 커맨드가 한다(5227-5229 · 5241).
      commands.setYoutubeUrl(ytInput.value);
      renderYoutubeExtras();                                         // 5230
      // ② 이전 예약을 먼저 취소한다(5232의 clearTimeout).
      scheduleTitleFetch.cancel();
      const url = ytInput.value.trim();                              // 5225
      if (!url) return;                                              // 5241 — 저장은 이미 끝났다
      // ③ 스피너는 status:'loading' 으로 위 renderYoutubeExtras 가 이미 붙였다. ④ 700ms 예약.
      scheduleTitleFetch(url);
    });
  }

  const cuInput = byId('clickupUrlInput');
  if (cuInput) {
    cuInput.addEventListener('input', () => {                        // 5246
      commands.setClickupUrl(cuInput.value);                         // 5247 + 즉시 저장(5249)
      renderClickupExtras();                                         // 5248
    });
  }

  const ytResetBtn = byId('ytResetBtn');
  if (ytResetBtn) {
    ytResetBtn.addEventListener('click', () => {                     // 5252 (PR #17)
      commands.resetYoutube();                                       // 5253-5254 + 저장(5257)
      if (ytInput) ytInput.value = '';                               // 5255
      renderYoutubeExtras();                                         // 5256
    });
  }

  const clickupResetBtn = byId('clickupResetBtn');
  if (clickupResetBtn) {
    clickupResetBtn.addEventListener('click', () => {                // 5260 (PR #17)
      commands.resetClickup();                                       // 5261 + 저장(5264)
      if (cuInput) cuInput.value = '';                               // 5262
      renderClickupExtras();                                         // 5263
    });
  }

  const addCustomLinkBtn = byId('addCustomLinkBtn');
  if (addCustomLinkBtn) {
    addCustomLinkBtn.addEventListener('click', () => {               // 5267
      commands.addCustomLink();                                      // 5268 + 저장(5269)
      renderCustomLinks();                                           // 5269
    });
  }

  // ⚠ deps.render(presenter) 는 일부러 쓰지 않는다 — 원본의 링크바 입력 경로는 전부 부분 렌더다.
  return {
    render: renderAll,
    renderYoutubeExtras: () => renderYoutubeExtras(),
    renderClickupExtras: () => renderClickupExtras(),
    renderCustomLinks: () => renderCustomLinks()
  };
}
