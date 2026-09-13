// src/ui/savedListsView.js — 최근 프로젝트 / 동작목록 / 카테고리 세 목록 (ui 계층)
//
// 원본 index.html 의 renderSavedList(4258-4285) · renderSavedMoveList(4287-4311) ·
// renderSavedCategoryList(4313-4339) · savedListEl/savedMoveListEl/savedCategoryListEl(1500-1502) ·
// bindControls 의 저장목록 정렬 버튼(2342-2355)을 옮겼다.
//
// 세 함수는 목록 요소 · 빈 목록 문구 · 버튼 구성만 다르고 나머지는 같다 → 설정표 하나로 합쳤다.
//
// ⚠⚠ **정렬은 프로젝트 목록에만 걸린다.** moves/categories 는 저장 순서 그대로 그린다
//    (원본 4290 · 4316 에 sort 가 없다). projectCommands.setRecentSort 가 Dirty 로
//    {savedLists:['projects']} 만 내는 이유다. 세 목록을 같게 만들지 마라.
//
// ⚠ 원본은 행을 innerHTML 한 덩어리로 만들고 `row.querySelectorAll('button')` 을 **순서대로 구조분해**해
//   핸들러를 붙였다(4272 · 4294 · 4320). 버튼을 하나 끼워 넣으면 조용히 어긋나는 구조라
//   버튼만 createElement 로 명시 생성한다. 만들어지는 DOM(태그·클래스·순서·텍스트)은 원본과 같다.
//   ⚠ 원본 버튼에는 type 속성이 없다(innerHTML 로 만들어 기본 submit 이다). 폼 밖이라 동작이 같으므로
//     여기서도 type 을 붙이지 않는다.

import { CLS } from './domContract.js';
import { escapeHtml, confirmOnce } from './widgets.js';

/** 목록 종류별 설정. key 는 store.recents 의 키이자 Dirty.savedLists 의 값이다. */
const KIND_SPEC = {
  // 원본 renderSavedList(4258-4285)
  projects: {
    rootId: 'savedList',
    /** 원본 4261 — 이 목록만 빈 상태 안내가 있다. */
    emptyHtml: '<div class="helper">저장된 프로젝트 목록이 없습니다.</div>',
    sortable: true
  },
  // 원본 renderSavedMoveList(4287-4311) — 빈 목록이면 아무것도 그리지 않고 끝난다(4289)
  moves: { rootId: 'savedMoveList', emptyHtml: null, sortable: false },
  // 원본 renderSavedCategoryList(4313-4339) — 마찬가지(4315)
  categories: { rootId: 'savedCategoryList', emptyHtml: null, sortable: false }
};

/**
 * @typedef {object} SavedListsDeps
 * @property {any} store createStore 인스턴스. recents 와 session.recentSortMode 를 읽는다.
 * @property {{
 *   loadProjectFromRecent: (data: any) => any,
 *   mergeProjectFromRecent: (data: any) => any,
 *   loadMoveListFromRecent: (data: any) => any,
 *   loadCategoriesFromRecent: (data: any) => any,
 *   removeRecent: (kind: 'projects'|'moves'|'categories', fileName: string) => any,
 *   setRecentSort: (mode: 'recent'|'alpha') => any
 * }} commands app/main 이 projectCommands 를 묶어 넘긴다.
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {(fileName: string) => void} [setProjectFileName] '이름 복사' 버튼(원본 4273).
 *   ⚠ 커맨드가 아니다 — #fileNameInput.value 에 직접 대입하던 한 줄이다.
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * 세 목록을 함께 다루는 뷰를 만든다. 내부적으로는 종류마다 독립된 렌더러 세 개다.
 *
 * @param {SavedListsDeps} deps
 * @returns {{
 *   render(kind: 'projects'|'moves'|'categories', list?: any[]): void,
 *   renderAll(): void,
 *   syncSortButtons(): void
 * }}
 */
export function createSavedListsView(deps) {
  const {
    store,
    commands,
    render,
    setProjectFileName = () => {},
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const roots = {
    projects: byId(KIND_SPEC.projects.rootId),      // 1500
    moves: byId(KIND_SPEC.moves.rootId),            // 1501
    categories: byId(KIND_SPEC.categories.rootId)   // 1502
  };
  const sortRecentBtn = byId('savedSortRecentBtn');
  const sortAlphaBtn = byId('savedSortAlphaBtn');

  // ── 정렬 버튼 (원본 2342-2355) ────────────────────────────────────────────
  // 클래스 토글은 여기서 직접 하지 않는다. setRecentSort 가 {savedLists:['projects']} 를 돌려주면
  // presenter 가 render('projects', …) 를 부르고, 그 안의 syncSortButtons 가 .active 를 재도출한다.
  if (sortRecentBtn) sortRecentBtn.addEventListener('click', () => render(commands.setRecentSort('recent')));
  if (sortAlphaBtn) sortAlphaBtn.addEventListener('click', () => render(commands.setRecentSort('alpha')));

  /** 정렬 버튼의 .active 를 store.session.recentSortMode 에서 재도출한다(2346-2347 · 2352-2353). */
  function syncSortButtons() {
    const alpha = store.session.recentSortMode === 'alpha';
    if (sortRecentBtn) sortRecentBtn.classList.toggle(CLS.active, !alpha);
    if (sortAlphaBtn) sortAlphaBtn.classList.toggle(CLS.active, alpha);
  }

  // ── 행 만들기 ────────────────────────────────────────────────────────────

  /**
   * 파일 이름 + 저장 시각 블록. 원본 4270 · 4293 · 4319 의 왼쪽 절반과 글자 단위로 같다.
   * @param {{ fileName: string, savedAt: string|number }} item
   * @returns {HTMLElement}
   */
  function buildInfo(item) {
    const info = document.createElement('div');
    info.innerHTML = `<div style="font-weight:800;">${escapeHtml(item.fileName)}</div><div class="${CLS.helper}">${new Date(item.savedAt).toLocaleString()}</div>`;
    return info;
  }

  /**
   * @param {string} className 공백으로 이어 붙인 클래스 문자열(원본 마크업 순서 그대로)
   * @param {string} text 버튼 라벨 — ⚠ 화면 문구다. 바꾸지 마라.
   * @param {(btn: HTMLButtonElement) => void} onClick
   * @param {string} [title]
   * @returns {HTMLButtonElement}
   */
  function makeBtn(className, text, onClick, title) {
    const btn = document.createElement('button');
    btn.className = className;
    if (title != null) btn.title = title;
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  /**
   * 삭제 버튼. 세 목록 모두 라벨이 '삭제' 이고 confirmOnce 를 거친다(4276-4282 · 4302-4308 · 4328-4334).
   * @param {'projects'|'moves'|'categories'} kind
   * @param {{ fileName: string }} item
   */
  function makeDeleteBtn(kind, item) {
    return makeBtn(CLS.danger, '삭제', (btn) => {
      confirmOnce(btn, '삭제', () => { render(commands.removeRecent(kind, item.fileName)); });
    });
  }

  /**
   * 목록 행 하나.
   * @param {'projects'|'moves'|'categories'} kind
   * @param {any} item
   * @returns {HTMLElement}
   */
  function buildRow(kind, item) {
    const row = document.createElement('div');
    row.className = CLS.savedItem;
    row.appendChild(buildInfo(item));

    const actions = document.createElement('div');
    actions.className = CLS.row;

    if (kind === 'projects') {
      // 원본 4271 의 버튼 4개. **순서와 클래스 조합까지 그대로**다.
      actions.appendChild(makeBtn(
        CLS.ghost, '이름 복사',
        () => { setProjectFileName(item.fileName); },              // 4273 — 커맨드가 아니다
        '프로젝트 이름을 입력창에 복사'
      ));
      actions.appendChild(makeBtn(
        CLS.ghost + ' ' + CLS.accent, '부분 불러오기',
        // ⚠ 두 번째 인자로 **항목 전체**를 함께 준다(2026-09-13). 보관 폴더에서 온 항목은 `data` 가
        //   없고 이름으로 읽어 와야 한다 — 옛 항목(브라우저에 내용이 든 것)은 첫 인자만 쓰므로 그대로다.
        () => render(commands.mergeProjectFromRecent(item.data, item))   // 4274
      ));
      actions.appendChild(makeBtn(
        CLS.ghost, '전체 불러오기',
        () => render(commands.loadProjectFromRecent(item.data, item))    // 4275
      ));
    } else if (kind === 'moves') {
      // 원본 4293 의 버튼 2개
      actions.appendChild(makeBtn(
        CLS.ghost, '불러오기',
        () => render(commands.loadMoveListFromRecent(item.data))   // 4295-4301
      ));
    } else {
      // 원본 4319 의 버튼 2개
      actions.appendChild(makeBtn(
        CLS.ghost, '불러오기',
        () => render(commands.loadCategoriesFromRecent(item.data)) // 4321-4327
      ));
    }

    actions.appendChild(makeDeleteBtn(kind, item));
    row.appendChild(actions);
    return row;
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  /**
   * 한 목록을 다시 그린다.
   * @param {'projects'|'moves'|'categories'} kind
   * @param {any[]} [list] 생략하면 store.recents[kind] 를 읽는다
   */
  function renderKind(kind, list) {
    const spec = KIND_SPEC[kind];
    if (!spec) return;
    const root = roots[kind];
    if (!root) return;

    if (spec.sortable) syncSortButtons();

    root.innerHTML = '';                                            // 4259 · 4288 · 4314
    const items = list || store.recents[kind] || [];
    if (!items.length) {                                            // 4260 · 4289 · 4315
      if (spec.emptyHtml) root.innerHTML = spec.emptyHtml;          // 4261
      return;
    }

    const sorted = [...items];                                      // 4264
    // ⚠ 프로젝트 목록만 정렬한다(4265-4267). 로케일 'ko' 도 원문 그대로.
    if (spec.sortable && store.session.recentSortMode === 'alpha') {
      sorted.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ko'));
    }
    sorted.forEach(item => root.appendChild(buildRow(kind, item)));
  }

  /** 부팅 시 세 목록을 한 번에(원본 init 이 세 render 를 차례로 부르던 자리). */
  function renderAll() {
    renderKind('projects');
    renderKind('moves');
    renderKind('categories');
  }

  return { render: renderKind, renderAll, syncSortButtons };
}
