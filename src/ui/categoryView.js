// src/ui/categoryView.js — 범례 · 카테고리 관리 행 · `#newMoveCategory` <select> (ui 계층)
//
// 원본 index.html 의 renderCategoryOptions(2964-2968) · renderCategoryManager(2970-3044) ·
// renderLegend(3046-3053) 세 함수를 옮겼다. DOM 은 그대로 만들고, 상태 전이는 전부
// 주입받은 커맨드로 넘긴다(뷰는 store 도 usecases 도 import 하지 않는다).
//
// ⚠ 이 파일이 지키는 세 가지
//  ① **renderOptions 는 renderManager 를 부르지 않는다.** 원본 2967 의 무조건 호출 사슬은
//     app/render(presenter)가 `Dirty.categorySelect` 를 볼 때 두 함수를 **둘 다** 불러 재현한다.
//     여기서 다시 부르면 색상 슬라이더 드래그 중 관리 행이 두 번 그려진다.
//  ② **색상 `<input type="color">` 는 `input` 마다 previewColor, `change` 에서만 commitColor.**
//     previewColor 의 Dirty 에 categoryManager 가 없어야 네이티브 색상 피커가 첫 드래그에서
//     닫히지 않는다(원본 2982-2991 이 manager 를 일부러 다시 그리지 않는 이유).
//     그래서 **input 경로에서는 절대 renderManager 를 부르지 마라.**
//  ③ **삭제의 '마지막 하나' 가드는 confirmOnce 밖에 있다**(원본 3012). 마지막 카테고리는
//     2단계 확인 없이 즉시 alert 로 막힌다 — 순서를 바꾸면 '정말요?' 를 한 번 보고 나서 막힌다.

import { escapeHtml, confirmOnce, makeInlineStarBtn } from './widgets.js';
import { categoryNames, categoryColor } from '../domain/categories.js';

/** 히스토리를 커밋할 보드. 카테고리 조작은 전부 메인 보드 스냅샷이다(원본 saveHistory). */
const MAIN = 'main';

/**
 * @typedef {Object} CategoryViewDeps
 * @property {HTMLElement} legendEl              `#legend`(1295)
 * @property {HTMLElement} categoryManagerEl     `#categoryManager`(1279)
 * @property {HTMLSelectElement} newMoveCategoryEl `#newMoveCategory`(1289)
 * @property {{ categories: Record<string,{label:string,color:string}>,
 *              favorites: { categories: Set<string> } }} store 읽기 전용 store 인스턴스
 * @property {CategoryViewCommands} commands  app/main 이 ctx 를 미리 묶어 넘긴 커맨드들
 * @property {(dirty: any) => void} render     app/render 의 presenter
 * @property {(boardId: string) => any} commit historyCommands.commit 을 감싼 것. Dirty 를 돌려준다
 * @property {{ alert: (message: string) => void }} dialogs
 */

/**
 * @typedef {Object} CategoryViewCommands
 * @property {(key: string, color: string) => any} previewColor   색 슬라이더 `input`
 * @property {(key?: string, color?: string) => any} commitColor  색 슬라이더 `change`
 * @property {(key: string, rawLabel: string) => any} renameLabel 라벨 입력 `change`
 * @property {(key: string) => any} removeCategory                × 버튼 2차 클릭
 * @property {(key: string) => any} toggleCategoryFavorite        ★ 버튼
 */

/**
 * 카테고리 뷰를 만든다. 모듈 최상위에서 DOM 을 찾지 않는다 — 요소는 전부 인자로 받는다.
 * @param {CategoryViewDeps} deps
 */
export function createCategoryView(deps) {
  const {
    legendEl,
    categoryManagerEl,
    newMoveCategoryEl,
    store,
    commands,
    render,
    commit,
    dialogs,
  } = deps;

  // ───────────────────────────────────────────────────────────────────────────
  // ① `#newMoveCategory` <select> 옵션 (원본 renderCategoryOptions 2964-2968)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * ⚠ 원본은 innerHTML 을 통째로 갈아끼울 뿐 **현재 선택값을 보존하지 않는다**(2966).
   *   그래서 카테고리를 하나 추가하면 '동작 추가' 폼의 선택이 첫 항목으로 돌아간다.
   *   보존 코드를 넣으면 오늘 동작이 바뀐다 — 넣지 마라(팔레트 카드의 select 는 정반대로
   *   `select.value = move.category` 로 복원한다. 이 비대칭이 원문이다).
   * @see index.html:2964
   */
  function renderOptions() {
    const categories = store.categories;
    const options = categoryNames(categories)
      .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(categories[name].label)}</option>`)
      .join('');
    newMoveCategoryEl.innerHTML = options;
    // ⚠ 여기서 renderManager() 를 부르지 마라 — presenter 가 부른다(파일 상단 ①).
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ② 범례 (원본 renderLegend 3046-3053)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `<span><i style="background:…"></i>레이블</span>` 을 카테고리 수만큼.
   * ⚠ 색은 인라인 스타일이라 escapeHtml 을 거치지 않는다(원본 3050 그대로).
   * @see index.html:3046
   */
  function renderLegend() {
    const categories = store.categories;
    legendEl.innerHTML = '';
    categoryNames(categories).forEach(name => {
      const item = document.createElement('span');
      item.innerHTML = `<i style="background:${categoryColor(categories, name)}"></i>${escapeHtml(categories[name].label)}`;
      legendEl.appendChild(item);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 카테고리 관리 행 (원본 renderCategoryManager 2970-3044)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 카테고리마다 [색상] [레이블 입력] [★] [×] 한 줄.
   * ⚠ 자식 순서는 `row.append(colorInput, input, catStarBtn, del)`(3042)이다 — ★ 가 × 앞이다.
   * @see index.html:2970
   */
  function renderManager() {
    const categories = store.categories;
    categoryManagerEl.innerHTML = '';
    categoryNames(categories).forEach(name => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.gap = '5px';

      // ── 색상 ────────────────────────────────────────────────────────────
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = categoryColor(categories, name);
      colorInput.style.cssText = 'width:22px; height:22px; padding:0; border:1px solid rgba(148,163,184,0.2); border-radius:6px; cursor:pointer; background:none; flex:0 0 auto;';
      colorInput.title = '색상 변경';
      colorInput.addEventListener('input', () => {
        // 2983-2987: 범례 · 팔레트 · 두 보드만 다시 그린다. 관리 행은 **일부러** 빼놓는다.
        render(commands.previewColor(name, colorInput.value));
      });
      colorInput.addEventListener('change', () => {
        // 2988-2990: 원본은 saveHistory() 한 줄뿐이다. 상태는 이미 input 이 갱신했으므로
        // commitColor 에 값을 넘기지 않는다(넘겨도 무해하지만 원문에 없는 대입이 생긴다).
        render(commands.commitColor());
        render(commit(MAIN));
      });

      // ── 레이블 ──────────────────────────────────────────────────────────
      const input = document.createElement('input');
      input.type = 'text';
      input.value = categories[name].label;
      input.placeholder = '카테고리 이름';
      input.addEventListener('change', () => {
        // 2996-3001. ⚠ 빈 문자열이면 키 자체가 레이블이 되는 규칙은 커맨드 안에 있다.
        render(commands.renameLabel(name, input.value));
        render(commit(MAIN));
      });

      // ── 삭제 ────────────────────────────────────────────────────────────
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.type = 'button';
      del.textContent = '×';
      del.title = '카테고리 삭제';
      del.addEventListener('click', () => {
        // ⚠ 가드가 confirmOnce **밖**이다(3012). 마지막 하나는 '정말요?' 없이 즉시 막힌다.
        if (categoryNames(store.categories).length <= 1) {
          dialogs.alert('카테고리는 최소 1개 이상 있어야 합니다.');
          return;
        }
        confirmOnce(del, '×', () => {
          render(commands.removeCategory(name));
          render(commit(MAIN));
        });
      });

      // ── 즐겨찾기 ────────────────────────────────────────────────────────
      // 원본 3026-3039 판: title 있음 / stopPropagation 없음 / 자기 클래스 토글 없음.
      // 별이 켜지는 것은 toggleCategoryFavorite 의 Dirty{categorySelect} → presenter 가
      // renderOptions + renderManager 를 부르기 때문이다(Dirty 를 빠뜨리면 별이 안 켜진다).
      const catStarBtn = makeInlineStarBtn(
        () => store.favorites.categories.has(name),
        () => { render(commands.toggleCategoryFavorite(name)); },
        { title: '즐겨찾기 (빠른 배치에 표시)', stopPropagation: false, toggleClass: false }
      );

      row.append(colorInput, input, catStarBtn, del);
      categoryManagerEl.appendChild(row);
    });
  }

  return { renderOptions, renderManager, renderLegend };
}
