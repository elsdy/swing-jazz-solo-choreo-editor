// src/ui/paletteView.js — 동작 목록(팔레트) 렌더 + 카드 팩토리 + 동작 컨텍스트 메뉴 (ui 계층)
//
// 원본 index.html 의 renderPalette(3055-3181) + 그 안의 buildCard(3064-3161),
// openMoveContextMenu(3247-3286) · closeMoveContextMenu(3288-3293),
// 그리고 bindControls 맨 앞의 메뉴 닫기 리스너 2개(2299-2304)와
// 팔레트 정렬 버튼의 `.active`/글리프 조작(2312-2336)을 옮겼다.
//
// ⚠ 이 파일이 지키는 네 가지
//  ① **뷰는 input/** 을 import 하지 않는다.** 카드의 dragstart/dragend·터치 드래그·이름 롱프레스는
//     주입받은 `attachCardInput(card, move, { chip, nameEl })` 하나가 붙인다.
//     원본 3079-3092(dragstart 가 state.drag 와 reState.drag 에 **같은 객체**를 대입)와
//     attachTouchDragToPaletteChip(3931) · attachMoveMenuTrigger(3210)이 그 안으로 들어간다.
//  ② **검색어를 DOM 에서 읽지 않는다.** 원본 renderPalette(3057)는 `#paletteSearch` 를 직접
//     읽었지만, 이제 store.palette.searchQuery 를 쓴다. 입력 리스너(input/controls)가
//     paletteCommands.setSearchQuery 를 부르고 Dirty{palette} 로 여기까지 온다.
//  ③ **정렬 버튼의 `.active` 와 ↑/↓ 글리프는 store.palette 에서 재도출한다.**
//     원본은 클릭 핸들러가 직접 토글했지만(2315-2336) 커맨드가 `{palette:true}` 만 돌려주므로
//     render() 안에서 다시 계산한다. 화면 결과는 같다.
//  ④ **제목 '동작 목록'(PR #17)은 마크업(1294 부근)에 이미 있다 — 뷰가 만들지 않는다.**

import { SEL, CLS } from './domContract.js';
import { escapeHtml, confirmOnce, makeInlineStarBtn } from './widgets.js';
import { categoryNames, categoryColor } from '../domain/categories.js';
import { selectPaletteMoves } from '../domain/moves.js';

/** 동작 CRUD 는 전부 메인 보드 스냅샷에 커밋된다(원본 saveHistory). */
const MAIN = 'main';

/** Dirty 가 '아무 일도 없었다'(store.NONE)인지. ui 는 usecases 를 import 할 수 없어 키 개수로 본다. */
function changed(dirty) {
  return !!dirty && Object.keys(dirty).length > 0;
}

/**
 * @typedef {Object} PaletteViewDeps
 * @property {HTMLElement} paletteListEl `#paletteList`(1304)
 * @property {{ alpha: HTMLElement, added: HTMLElement, category: HTMLElement, dir: HTMLElement }} sortButtons
 *   `#sortAlphaBtn`(1299) `#sortAddedBtn`(1300) `#sortCategoryBtn`(1301) `#sortDirBtn`(1302)
 * @property {any} store 읽기 전용 store 인스턴스(library/categories/favorites/palette/session)
 * @property {PaletteViewCommands} commands app/main 이 ctx 를 미리 묶어 넘긴 커맨드들
 * @property {(dirty:any)=>void} render app/render 의 presenter
 * @property {(boardId:string)=>any} commit historyCommands.commit 을 감싼 것
 * @property {(card: HTMLElement, move: any, parts: { chip: HTMLElement, nameEl: HTMLElement }) => void} attachCardInput
 *   input/paletteInput 이 만든 배선. 카드 전체의 dragstart/dragend/터치 드래그와
 *   nameEl 의 dblclick/contextmenu/480ms 롱프레스를 여기서 붙인다.
 */

/**
 * @typedef {Object} PaletteViewCommands
 * @property {(moveId:string)=>any} activatePaletteMove 카드 클릭(그리기용 활성 동작 토글)
 * @property {(moveId:string, nextCategory:string)=>any} setMoveCategory 카드의 카테고리 select
 * @property {(moveId:string)=>any} deleteMove 카드 × / 메뉴 '삭제'
 * @property {(moveName:string)=>any} toggleMoveFavorite ★ (⚠ id 가 아니라 이름)
 * @property {(moveId:string)=>any} renameMove 메뉴 '이름 변경'(prompt 는 커맨드 안에서)
 * @property {(moveId:string)=>any} promptMoveCategory 메뉴 '카테고리: …'(prompt 는 커맨드 안에서)
 */

/**
 * 팔레트 뷰를 만든다. 모듈 최상위에서 DOM 을 찾지 않는다 — 요소는 전부 인자로 받는다.
 *
 * ⚠ 생성 즉시 document 에 메뉴 닫기 리스너 2개를 건다(원본 bindControls 2299-2304).
 *   원본에서도 이 둘이 document click/scroll 중 **가장 먼저** 등록되므로, app/main 이
 *   컨트롤 바인딩보다 먼저 뷰를 만들면 등록 순서까지 같아진다.
 * @param {PaletteViewDeps} deps
 */
export function createPaletteView(deps) {
  const {
    paletteListEl,
    sortButtons,
    store,
    commands,
    render,
    commit,
    attachCardInput,
  } = deps;

  /** 열려 있는 동작 컨텍스트 메뉴. 원본은 state.moveContextMenu(1411) 였다 — 뷰가 소유한다. */
  let moveContextMenu = null;

  // ───────────────────────────────────────────────────────────────────────────
  // 컨텍스트 메뉴 (원본 3247-3293)
  // ───────────────────────────────────────────────────────────────────────────

  /** @see index.html:3288 */
  function closeContextMenu() {
    if (moveContextMenu) {
      moveContextMenu.remove();
      moveContextMenu = null;
    }
  }

  /**
   * 동작 이름을 더블클릭/우클릭/길게 눌렀을 때 뜨는 메뉴. body 포털이라 골든이 못 잡는다.
   * ⚠ 위치는 `getBoundingClientRect()` 를 **appendChild 뒤에** 재고 Math.max(12, Math.min(…, 화면-폭-12)).
   * @see index.html:3247
   * @param {string} moveId
   * @param {number} x
   * @param {number} y
   */
  function openContextMenu(moveId, x, y) {
    closeContextMenu();
    const move = store.library.find(m => m.id === moveId);
    if (!move) return;

    const menu = document.createElement('div');
    menu.className = CLS.contextMenu;
    menu.innerHTML = `<div class="${CLS.contextMenuTitle}">${escapeHtml(move.name)}</div>`;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = '이름 변경';
    renameBtn.addEventListener('click', () => {
      closeContextMenu();                       // 3257: 메뉴를 먼저 닫고 prompt 를 띄운다
      const dirty = commands.renameMove(moveId);
      render(dirty);
      // 3187·3189 의 취소/빈 이름 조기 반환에서는 saveHistory 가 없다.
      if (changed(dirty)) render(commit(MAIN));
    });

    const categoryBtn = document.createElement('button');
    categoryBtn.type = 'button';
    categoryBtn.textContent = `카테고리: ${store.categories[move.category]?.label || move.category}`;
    categoryBtn.addEventListener('click', () => {
      closeContextMenu();                       // 3264
      const dirty = commands.promptMoveCategory(moveId);
      render(dirty);
      if (changed(dirty)) render(commit(MAIN));  // 3267·3269 의 조기 반환에서는 커밋하지 않는다
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', () => confirmOnce(deleteBtn, '삭제', () => {
      // ⚠ 이 경로만 deleteMove(3198-3208) 를 타서 **상태를 바꾼 뒤** 메뉴를 닫는다(3204).
      //   카드의 × 버튼(3134-3145)에는 메뉴 닫기가 없다.
      const dirty = commands.deleteMove(moveId);
      if (!changed(dirty)) return;              // 3199-3200: 동작을 못 찾으면 아무 일도 없다
      closeContextMenu();
      render(dirty);
      render(commit(MAIN));
    }));

    menu.append(renameBtn, categoryBtn, deleteBtn);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(x, window.innerWidth - rect.width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(y, window.innerHeight - rect.height - 12))}px`;
    moveContextMenu = menu;
  }

  // 원본 bindControls 2299-2304. 리스너 대상은 document 이고 scroll 만 캡처 단계다.
  document.addEventListener('click', (e) => {
    if (moveContextMenu && !e.target.closest(SEL.contextMenu)) closeContextMenu();
  });
  document.addEventListener('scroll', () => {
    if (moveContextMenu) closeContextMenu();
  }, true);

  // ───────────────────────────────────────────────────────────────────────────
  // 정렬 버튼 (원본 2312-2336 의 표시 부분만)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `.active` 3개와 방향 글리프를 store.palette 에서 다시 계산한다.
   * ⚠ 라벨 원문은 마크업에 있다: `가나다` `추가순` `카테고리`, 방향 버튼은 `↑`/`↓`.
   * @see index.html:2315
   */
  function syncSortButtons() {
    const { sortMode, sortDir } = store.palette;
    if (sortButtons) {
      if (sortButtons.alpha) sortButtons.alpha.classList.toggle(CLS.active, sortMode === 'alpha');
      if (sortButtons.added) sortButtons.added.classList.toggle(CLS.active, sortMode === 'added');
      if (sortButtons.category) sortButtons.category.classList.toggle(CLS.active, sortMode === 'category');
      if (sortButtons.dir) sortButtons.dir.textContent = sortDir === 'asc' ? '↑' : '↓';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 카드 (원본 buildCard 3064-3161)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 동작 카드 하나. **카드 전체가 draggable** 이다(칩만이 아니다 — 3078).
   * @param {{id:string,name:string,category:string}} move
   * @returns {HTMLElement}
   */
  function buildCard(move) {
    const categories = store.categories;

    const card = document.createElement('div');
    // 3066: 활성 동작이면 palette-active. reState 쪽은 언제나 null 이라 main 만 본다.
    card.className = CLS.moveCard
      + (store.session.activePaletteMove[MAIN]?.moveId === move.id ? ' ' + CLS.paletteActive : '');
    card.addEventListener('click', (e) => {
      if (e.target.closest(SEL.selectOrButton)) return;   // 3068
      render(commands.activatePaletteMove(move.id));      // 3069-3071
    });

    const chip = document.createElement('div');
    chip.className = CLS.moveChip;
    chip.style.background = categoryColor(categories, move.category);
    chip.title = `${move.name} 드래그`;
    card.draggable = true;                                // 3078

    const meta = document.createElement('div');
    meta.className = CLS.moveMeta;
    const nameEl = document.createElement('div');
    nameEl.className = CLS.moveName;
    nameEl.textContent = move.name;
    nameEl.title = '더블클릭, 우클릭 또는 길게 눌러 메뉴 열기';
    meta.appendChild(nameEl);

    const actions = document.createElement('div');
    actions.className = CLS.moveActions;

    const shell = document.createElement('div');
    shell.className = CLS.categoryShell;
    const dot = document.createElement('span');
    dot.className = CLS.categoryDot;
    dot.style.background = categoryColor(categories, move.category);
    const select = document.createElement('select');
    select.className = CLS.categorySelect;
    select.innerHTML = categoryNames(categories)
      .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(categories[name].label)}</option>`)
      .join('');
    // ⚠ 카드의 select 는 현재 값을 복원한다(3118). `#newMoveCategory` 는 복원하지 않는다 — 원문의 비대칭.
    select.value = move.category;
    select.addEventListener('change', (e) => {
      const next = e.target.value;
      // 3121-3125. 렌더 범위가 renderRows(affectedRows)라 컨텍스트 메뉴 경로와 다르다.
      render(commands.setMoveCategory(move.id, next));
      render(commit(MAIN));
    });
    shell.append(dot, select);

    const del = document.createElement('button');
    del.className = CLS.iconBtn;
    del.type = 'button';
    del.textContent = '×';
    del.title = '삭제';
    del.addEventListener('click', () => {
      confirmOnce(del, '×', () => {
        // 3136-3140. ⚠ 이 경로에는 closeMoveContextMenu 가 없다(메뉴 경로에만 있다).
        render(commands.deleteMove(move.id));
        render(commit(MAIN));
      });
    });

    // 원본 3143-3159 판: title 있음 / stopPropagation 없음(카드 click 이 이미 button 을 거른다) /
    // 자기 클래스 토글 없음 — 별은 Dirty{palette} 재렌더로 켜진다.
    const starBtn = makeInlineStarBtn(
      () => store.favorites.moveNames.has(move.name),
      () => { render(commands.toggleMoveFavorite(move.name)); },
      { title: '즐겨찾기 (빠른 배치에 표시)', stopPropagation: false, toggleClass: false }
    );

    actions.append(shell, starBtn, del);
    card.append(chip, meta, actions);

    // ⚠ 원본은 dragstart/dragend 를 chip 생성 직후(3079-3092), 터치 드래그를 그 다음(3095),
    //   이름 메뉴 트리거를 nameEl 생성 직후(3101)에 붙였다. 여기서는 카드가 다 조립된 뒤
    //   한 번에 넘긴다 — 이벤트 종류가 서로 달라 관찰 동작은 같다.
    if (attachCardInput) attachCardInput(card, move, { chip, nameEl });
    return card;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 목록 (원본 renderPalette 3055-3181)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 팔레트 전체를 다시 그린다. Dirty.palette 의 유일한 소비자.
   * @see index.html:3055
   */
  function renderPalette() {
    syncSortButtons();
    paletteListEl.innerHTML = '';

    // 3057-3062 와 같다: 검색 필터 → 즐겨찾기/일반 분리 → 각각 정렬.
    const { favs, others } = selectPaletteMoves(store.library, {
      query: store.palette.searchQuery,
      favorites: store.favorites.moveNames,
      sort: store.palette,
      categories: store.categories,
    });

    // ① 즐겨찾기 섹션 (3163-3175)
    if (favs.length > 0) {
      const favHeader = document.createElement('div');
      favHeader.style.cssText = 'font-size:10px;font-weight:800;color:#facc15;padding:4px 2px 2px;letter-spacing:0.04em;';
      favHeader.textContent = '★ 즐겨찾기';
      paletteListEl.appendChild(favHeader);
      favs.forEach(m => paletteListEl.appendChild(buildCard(m)));
      if (others.length > 0) {
        const divEl = document.createElement('div');
        divEl.style.cssText = 'height:1px;background:var(--line);margin:6px 0 4px;';
        paletteListEl.appendChild(divEl);
      }
    }

    // ② 일반 동작 섹션 (3178)
    others.forEach(m => paletteListEl.appendChild(buildCard(m)));
  }

  return {
    /** Dirty.palette → 목록 + 정렬 버튼 재렌더 */
    render: renderPalette,
    /** input/paletteInput 이 dblclick·contextmenu·롱프레스에서 부른다 */
    openContextMenu,
    closeContextMenu,
    isContextMenuOpen: () => moveContextMenu !== null,
  };
}
