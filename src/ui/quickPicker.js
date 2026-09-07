// src/ui/quickPicker.js — 빠른 배치 팝업 **1벌** (ui 계층)
//
// 원본 index.html 에는 같은 팝업이 두 벌, 네 함수 646줄로 복제돼 있었다:
//   메인  quickPickerEl(1718) · closeQuickPicker(1776) · openQuickPicker(1808) ·
//         showMovePickerScreen(1842-1982) · makeQuickMoveItem(1998) · makeQuickCatItem(2025) ·
//         makeAddBtn(2048) · showCategoryScreen(2057-2227)
//   루틴  reQuickPickerEl(4772) · closeReQuickPicker(4774) · openReQuickPicker(4898) ·
//         showReMovePickerScreen(4917-4974) · showReCategoryScreen(4976-5076)
//
// 두 벌을 줄 단위로 대조해 나온 차이는 **여섯 가지뿐**이고 전부 옵션(노브)으로 뺐다.
//
// ┌ 노브 ────────────┬ 메인(1842·2057) ────────────┬ 루틴(4917·4976) ──────────────────────┐
// │ boardId          │ 'main'                      │ 'routine'                              │
// │ title            │ '동작 선택'(1847)            │ '동작 선택 (루틴)'(4921)               │
// │ keyboardNav      │ true (화살표/Enter/Esc)      │ false — keydown 리스너 자체가 없다      │
// │ enterHint        │ true — 무결과 힌트 뒤에       │ false — 마침표에서 끝난다(4952)         │
// │                  │ ' Enter를 눌러 새 동작으로   │                                        │
// │                  │ 추가'(1926)                  │                                        │
// │ addBtnKbActive   │ true (1878·1923·1930)        │ false                                  │
// │ catScreenAutoKb  │ true — 카테고리 검색 결과가   │ false                                  │
// │                  │ 있으면 kbIndex=0(2191-2192)  │                                        │
// └──────────────────┴─────────────────────────────┴────────────────────────────────────────┘
// 커밋/닫기/미리보기 지우기/배치 대상은 노브가 아니라 **주입**이다(deps.commit·deps.clearPreview).
// 루틴 인스턴스는 불리언 4개를 전부 false 로 만들어 오늘 동작을 그대로 보존한다
// (= docs/deviations.md #10 '루틴 퀵피커에 키보드 내비 없음'. 켜지 마라).
//
// ⚠ 키보드 규칙(PR #14·#15)을 그대로 옮겼다 — 헷갈리기 쉬우니 못 박아 둔다:
//   · ArrowDown/Up 은 항목을 순환하며 kb-active 를 옮기고, 그때 [+] 의 kb-active 를 **뗀다**.
//   · **Enter 의 기본 동작은 '새 동작 추가'** 다. 검색 결과가 있어도 kbIndex 는 -1 로 남아 있어서
//     화살표로 **명시 선택**하지 않는 한 Enter 는 카테고리 화면으로 넘어간다(1938-1946).
//   · 정확히 일치하는 이름이 없으면 [+] 가 보이고 kb-active 로 강조된다(1922-1930).
//   · 카테고리 화면의 Enter 는 반대다 — 검색 결과가 있으면 kbIndex 가 0 으로 **자동 강조**되어
//     Enter 가 첫 항목을 고른다(2191-2192). 결과가 없으면 '✦ 추가 & 배치' 를 누른다(2211).

import { CLS } from './domContract.js';
import { makeInlineStarBtn } from './widgets.js';
import { positionPopup, qDivider, qLabel, bindOutsideClose } from './popup.js';
import { categoryNames, categoryColor, deriveKey } from '../domain/categories.js';

/**
 * 노브 기본값 = **메인 판**(원본 1842·2057). 루틴 인스턴스만 값을 뒤집는다.
 * @type {{ boardId:string, title:string, keyboardNav:boolean, enterHint:boolean,
 *          addBtnKbActive:boolean, catScreenAutoKb:boolean }}
 */
const MAIN_OPTIONS = {
  boardId: 'main',
  title: '동작 선택',
  keyboardNav: true,
  enterHint: true,
  addBtnKbActive: true,
  catScreenAutoKb: true,
};

/**
 * 루틴 편집기용 노브. app/main 이 그대로 넘기면 원본 showReMovePickerScreen 과 같아진다.
 * @type {typeof MAIN_OPTIONS}
 */
export const ROUTINE_OPTIONS = Object.freeze({
  boardId: 'routine',
  title: '동작 선택 (루틴)',
  keyboardNav: false,
  enterHint: false,
  addBtnKbActive: false,
  catScreenAutoKb: false,
});

/**
 * 초록색 [+] 버튼. 원본 makeAddBtn(2048-2056) — 메인·루틴 두 화면이 함께 쓴다.
 * ⚠ CSS 클래스가 없다. 전부 인라인 스타일이고 `display:none` 이 기본값이라
 *   render() 가 `style.display = ''` 로 켠다.
 * @see index.html:2048
 * @returns {HTMLButtonElement}
 */
function makeAddBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = 'padding:4px 12px;width:auto;flex-shrink:0;font-size:18px;font-weight:bold;border-radius:8px;display:none;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.45);color:var(--accent);cursor:pointer;line-height:1;';
  btn.textContent = '+';
  return btn;
}

/**
 * @typedef {Object} QuickPickerDeps
 * @property {any} store 읽기 전용 store(library/categories/favorites/session)
 * @property {(()=>string)|{uid:()=>string}} ids uid 생성기. `deriveKey` 가 0~2번 소비한다
 * @property {QuickPickerCommands} commands app/main 이 ctx 를 미리 묶어 넘긴 커맨드들
 * @property {(dirty:any)=>void} render app/render 의 presenter
 * @property {(boardId:string)=>any} commit historyCommands.commit 을 감싼 것
 * @property {()=>void} clearPreview ui/overlays 의 clearPreview(boardId) 를 감싼 인자 없는 콜백.
 *   메인은 clearPreview(mainCtx)(1779), 루틴은 clearPreview(reCtx)(4776) 였다
 */

/**
 * @typedef {Object} QuickPickerCommands
 * @property {(boardId:string, moveId:string, row:number, cellIndex:number, count:number)=>any} placeMove
 *   boardCommands.placeMoveAt 을 감싼 것 (원본 placeMove(m.id,row,cellIndex,count[,reCtx]))
 * @property {(boardId:string, name:string, categoryKey:string, row:number, cellIndex:number, count:number)=>any} createAndPlace
 *   paletteCommands.createAndPlace (원본 createAndPlaceQuickMove 2229 / placeWithCat 5029)
 * @property {(key:string, label:string, color:string)=>any} addCategory
 *   categoryCommands.addCategory (원본 2118 / 5018)
 * @property {(moveName:string)=>any} toggleMoveFavorite ★ (⚠ id 가 아니라 이름)
 * @property {(key:string)=>any} toggleCategoryFavorite ★
 */

/**
 * 빠른 배치 팝업 인스턴스를 만든다. 보드마다 하나씩(메인 1개 · 루틴 편집기 1개).
 *
 * @param {QuickPickerDeps} deps
 * @param {Partial<typeof MAIN_OPTIONS>} [options] 생략하면 메인 판
 * @returns {{ open:(row:number,cellIndex:number,clientX:number,clientY:number,count?:number)=>void,
 *             close:(keepPreview?:any)=>void, isOpen:()=>boolean, element:()=>HTMLElement|null }}
 */
export function createQuickPicker(deps, options = {}) {
  const { store, ids, commands, render, commit, clearPreview } = deps;
  const opts = { ...MAIN_OPTIONS, ...options };

  /** 열려 있는 팝업. 원본의 모듈 변수 quickPickerEl(1718) / reQuickPickerEl(4772). */
  let popupEl = null;

  /**
   * 팝업을 닫는다.
   * ⚠⚠ `keepPreview` 가 truthy 면 미리보기를 남긴다. **이 함수를 addEventListener 에 그대로 넘기면
   *    첫 인자로 MouseEvent 가 들어와 keepPreview 가 참이 된다** — 원본 1852·2076·4924·4983 의
   *    `closeBtn.addEventListener('click', closeQuickPicker)` 가 정확히 그 모양이라
   *    **× 버튼으로 닫으면 미리보기가 지워지지 않는다.** 오늘 동작이므로 화살표 함수로 감싸지 마라.
   * @see index.html:1776
   * @see index.html:4774
   * @param {any} [keepPreview]
   */
  function close(keepPreview = false) {
    if (popupEl) { popupEl.remove(); popupEl = null; }
    if (!keepPreview) clearPreview();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 항목 팩토리 (원본 makeQuickMoveItem 1998-2024 · makeQuickCatItem 2025-2047)
  // 둘 다 메인·루틴 팝업이 **공유**하던 함수라 노브가 없다.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 동작 한 줄: [색 점][이름][카테고리 배지] + ★.
   * ★ 는 원본 1984 판(옵션 기본값) — 자기 클래스를 토글하고 팔레트를 다시 그린다.
   * @see index.html:1998
   */
  function makeQuickMoveItem(move, onClick) {
    const categories = store.categories;

    const item = document.createElement('div');
    item.className = CLS.quickPopupItem;
    item.style.cursor = 'default';

    const clickZone = document.createElement('div');
    clickZone.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;min-width:0;';
    clickZone.addEventListener('click', onClick);

    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:3px;background:${categoryColor(categories, move.category)};flex-shrink:0;`;
    const label = document.createElement('span');
    label.textContent = move.name;
    label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const catBadge = document.createElement('span');
    catBadge.style.cssText = 'font-size:10px;color:var(--muted);flex-shrink:0;';
    catBadge.textContent = categories[move.category]?.label || move.category;
    clickZone.append(dot, label, catBadge);

    const star = makeInlineStarBtn(
      () => store.favorites.moveNames.has(move.name),
      () => { render(commands.toggleMoveFavorite(move.name)); }   // 2019: saveFavorites + renderPalette
    );
    item.append(clickZone, star);
    return item;
  }

  /**
   * 카테고리 한 줄: [색 점][레이블] + ★.
   * ⚠ `state.categories[key].label` 을 **옵셔널 체이닝 없이** 읽는다(2040) — 원문 그대로.
   * @see index.html:2025
   */
  function makeQuickCatItem(key, onClick) {
    const categories = store.categories;

    const item = document.createElement('div');
    item.className = CLS.quickPopupItem;
    item.style.cursor = 'default';

    const clickZone = document.createElement('div');
    clickZone.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;';
    clickZone.addEventListener('click', onClick);

    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:3px;background:${categoryColor(categories, key)};flex-shrink:0;`;
    const label = document.createElement('span');
    label.textContent = categories[key].label;
    clickZone.append(dot, label);

    const star = makeInlineStarBtn(
      () => store.favorites.categories.has(key),
      () => { render(commands.toggleCategoryFavorite(key)); }     // 2044: saveFavorites + renderCategoryOptions
    );
    item.append(clickZone, star);
    return item;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 화면 1: 동작 선택 (원본 showMovePickerScreen 1842 / showReMovePickerScreen 4917)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} popup
   * @param {number} row
   * @param {number} cellIndex
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} count
   */
  function showMoveScreen(popup, row, cellIndex, clientX, clientY, count) {
    popup.innerHTML = '';

    const header = document.createElement('div');
    header.className = CLS.quickPopupHeader;
    header.appendChild(qLabel(opts.title));
    const closeBtn = document.createElement('button');
    closeBtn.className = CLS.iconBtn;
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);   // ⚠ 감싸지 마라 — close 위 주석 참조(1852)
    header.appendChild(closeBtn);
    popup.appendChild(header);

    // 검색 입력 + [+] 버튼 (기본 활성화)
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '동작 이름 검색...';
    nameInput.style.flex = '1';
    const addBtn = makeAddBtn();
    addBtn.title = '새 동작으로 추가';
    inputRow.append(nameInput, addBtn);
    popup.appendChild(inputRow);

    const resultList = document.createElement('div');
    resultList.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:4px;max-height:45vh;overflow-y:auto;';
    popup.appendChild(resultList);

    let kbIndex = -1;             // 키보드 커서(-1 = 없음). ⚠ 결과가 있어도 -1 로 남는다
    let selectableItems = [];     // 지금 화면의 선택 가능한 DOM 항목
    let selectableCallbacks = []; // 같은 순서의 클릭 콜백

    function updateKbHighlight() {
      selectableItems.forEach((el, i) => el.classList.toggle(CLS.kbActive, i === kbIndex));
      if (kbIndex >= 0 && selectableItems[kbIndex]) {
        selectableItems[kbIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    /** 항목 하나를 만들고 목록·콜백 배열에 함께 넣는다(원본은 4줄이 6번 반복됐다). */
    function pushMove(move) {
      const cb = () => {
        render(commands.placeMove(opts.boardId, move.id, row, cellIndex, count));   // 1903
        render(commit(opts.boardId));                                               // 1903 saveHistory(Re)
        close();                                                                    // 1903
      };
      const el = makeQuickMoveItem(move, cb);
      resultList.appendChild(el);
      selectableItems.push(el);
      selectableCallbacks.push(cb);
    }

    function renderList() {
      const q = nameInput.value.trim();
      const ql = q.toLowerCase();
      resultList.innerHTML = '';
      selectableItems = [];
      selectableCallbacks = [];
      kbIndex = -1;
      if (opts.addBtnKbActive) addBtn.classList.remove(CLS.kbActive);   // 1894

      const library = store.library;
      const favNames = store.favorites.moveNames;

      if (!ql) {
        addBtn.style.display = 'none';
        const favs = library.filter(m => favNames.has(m.name));         // 1898
        const others = library.filter(m => !favNames.has(m.name));      // 1899
        if (favs.length) {
          resultList.appendChild(qLabel('즐겨찾기'));
          favs.forEach(pushMove);
          if (others.length) resultList.appendChild(qDivider());
        }
        others.forEach(pushMove);
        return;
      }

      const matches = library.filter(m => m.name.toLowerCase().includes(ql));   // 1918
      if (matches.length === 0) {
        addBtn.style.display = '';
        if (opts.addBtnKbActive) addBtn.classList.add(CLS.kbActive);    // 1923
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px;color:var(--muted);padding:6px 10px;';
        // ⚠ 라벨 원문. 메인은 뒤에 안내가 붙고(1926) 루틴은 마침표에서 끝난다(4952).
        hint.textContent = opts.enterHint
          ? `"${q}" 와 일치하는 동작이 없습니다. Enter를 눌러 새 동작으로 추가`
          : `"${q}" 와 일치하는 동작이 없습니다.`;
        resultList.appendChild(hint);
      } else {
        const exactExists = matches.some(m => m.name.toLowerCase() === ql);     // 1929
        addBtn.style.display = exactExists ? 'none' : '';
        if (opts.addBtnKbActive) addBtn.classList.toggle(CLS.kbActive, !exactExists);   // 1930
        matches.forEach(pushMove);
        // ⚠ kbIndex 는 -1 로 남는다 → Enter 의 기본 동작이 '새 동작 추가'다(1940 주석).
      }
    }

    nameInput.addEventListener('input', renderList);
    if (opts.keyboardNav) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (selectableItems.length === 0) return;
          kbIndex = kbIndex < selectableItems.length - 1 ? kbIndex + 1 : 0;
          if (opts.addBtnKbActive) addBtn.classList.remove(CLS.kbActive);
          updateKbHighlight();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (selectableItems.length === 0) return;
          kbIndex = kbIndex > 0 ? kbIndex - 1 : selectableItems.length - 1;
          if (opts.addBtnKbActive) addBtn.classList.remove(CLS.kbActive);
          updateKbHighlight();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (kbIndex >= 0 && kbIndex < selectableCallbacks.length) {
            selectableCallbacks[kbIndex]();
          } else {
            // 화살표로 명시 선택하지 않았으면 → 새 동작 추가(카테고리 선택 화면)
            const name = nameInput.value.trim();
            if (!name) return;
            showCategoryScreen(popup, name, row, cellIndex, count);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
    }
    addBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      showCategoryScreen(popup, name, row, cellIndex, count);
    });

    renderList();
    setTimeout(() => nameInput.focus(), 50);

    positionPopup(popup, clientX, clientY);   // 1981 — open() 에서 부른 것과 별개로 한 번 더
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 화면 2: 카테고리 선택 (원본 showCategoryScreen 2057 / showReCategoryScreen 4976)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} popup
   * @param {string} moveName 화면 1에서 입력한 새 동작 이름(trim 완료)
   * @param {number} row
   * @param {number} cellIndex
   * @param {number} count
   */
  function showCategoryScreen(popup, moveName, row, cellIndex, count) {
    popup.innerHTML = '';

    const header = document.createElement('div');
    header.className = CLS.quickPopupHeader;
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = CLS.iconBtn;
    backBtn.textContent = '←';
    backBtn.addEventListener('click', () => {
      // ⚠ 되돌아갈 때는 지금 팝업의 좌상단을 새 앵커로 쓴다(2067-2068).
      const rect = popup.getBoundingClientRect();
      showMoveScreen(popup, row, cellIndex, rect.left, rect.top, count);
    });
    header.appendChild(backBtn);
    header.appendChild(qLabel('카테고리 선택'));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = CLS.iconBtn;
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);   // ⚠ 감싸지 마라(2076)
    header.appendChild(closeBtn);
    popup.appendChild(header);

    const badge = document.createElement('div');
    badge.style.cssText = 'font-size:11px;color:var(--muted);padding:2px 4px 4px;';
    badge.textContent = `동작: "${moveName}"`;
    popup.appendChild(badge);

    // 입력 + [+] 버튼
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const catInput = document.createElement('input');
    catInput.type = 'text';
    catInput.placeholder = '카테고리 검색...';
    catInput.style.flex = '1';
    const addBtn = makeAddBtn();
    addBtn.title = '새 카테고리로 추가';
    inputRow.append(catInput, addBtn);
    popup.appendChild(inputRow);

    // 새 카테고리 색상 폼 (초기 숨김)
    const newCatForm = document.createElement('div');
    newCatForm.style.cssText = 'display:none;align-items:center;gap:6px;padding:4px 0;';
    const catColorInput = document.createElement('input');
    catColorInput.type = 'color';
    catColorInput.value = '#22c55e';
    catColorInput.style.cssText = 'width:28px;height:28px;padding:0;border:1px solid rgba(148,163,184,0.2);border-radius:6px;cursor:pointer;background:none;flex:0 0 auto;';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'primary special';
    confirmBtn.textContent = '✦ 추가 & 배치';
    confirmBtn.style.flex = '1';
    newCatForm.append(catColorInput, confirmBtn);
    popup.appendChild(newCatForm);

    confirmBtn.addEventListener('click', () => {
      const catLabel = catInput.value.trim();
      if (!catLabel) { catInput.focus(); return; }                 // 2114
      // ⚠⚠ 호출 순서를 바꾸지 마라(2단계 계약).
      //    deriveKey(uid 0~2회) → addCategory → createAndPlace(uid 0~1회 + 세그먼트) → commit → 닫기.
      //    deriveKey 를 커맨드 안으로 옮기면 uid 소비 순서가 달라져 골든 결정성이 깨진다.
      const key = deriveKey(catLabel, store.categories, ids);      // 2116-2117
      render(commands.addCategory(key, catLabel, catColorInput.value));   // 2118-2120
      render(commands.createAndPlace(opts.boardId, moveName, key, row, cellIndex, count));   // 2121
      render(commit(opts.boardId));                                // 2240 saveHistory / 5034 saveHistoryRe
      close();                                                     // 2122
    });

    const resultList = document.createElement('div');
    resultList.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:4px;max-height:40vh;overflow-y:auto;';
    popup.appendChild(resultList);

    let kbIndex = -1;
    let selectableItems = [];
    let selectableCallbacks = [];

    function updateKbHighlight() {
      selectableItems.forEach((el, i) => el.classList.toggle(CLS.kbActive, i === kbIndex));
      if (kbIndex >= 0 && selectableItems[kbIndex]) {
        selectableItems[kbIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    /** 기존 카테고리로 바로 만들고 배치한다(원본 createAndPlaceQuickMove 2229 / placeWithCat 5029). */
    function pushCat(key) {
      const cb = () => {
        render(commands.createAndPlace(opts.boardId, moveName, key, row, cellIndex, count));
        render(commit(opts.boardId));   // createAndPlaceQuickMove 안의 saveHistory(2240)
        close();
      };
      const el = makeQuickCatItem(key, cb);
      resultList.appendChild(el);
      selectableItems.push(el);
      selectableCallbacks.push(cb);
    }

    function renderList() {
      const q = catInput.value.trim();
      const ql = q.toLowerCase();
      resultList.innerHTML = '';
      newCatForm.style.display = 'none';
      selectableItems = [];
      selectableCallbacks = [];
      kbIndex = -1;

      const categories = store.categories;
      const favCats = store.favorites.categories;

      if (!ql) {
        addBtn.style.display = 'none';
        const favKeys = categoryNames(categories).filter(k => favCats.has(k));     // 2151
        const otherKeys = categoryNames(categories).filter(k => !favCats.has(k));  // 2152
        if (favKeys.length) {
          resultList.appendChild(qLabel('즐겨찾기'));
          favKeys.forEach(pushCat);
          if (otherKeys.length) resultList.appendChild(qDivider());
        }
        otherKeys.forEach(pushCat);
        return;
      }

      const matches = categoryNames(categories).filter(k => categories[k].label.toLowerCase().includes(ql));   // 2175
      if (matches.length === 0) {
        addBtn.style.display = '';
        newCatForm.style.display = 'flex';
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px;color:var(--muted);padding:6px 10px;';
        hint.textContent = `"${q}" 와 일치하는 카테고리가 없습니다.`;
        resultList.appendChild(hint);
      } else {
        addBtn.style.display = 'none';
        matches.forEach(pushCat);
        if (opts.catScreenAutoKb) {   // 2191-2192 — 화면 1과 정반대로 첫 항목을 자동 강조한다
          kbIndex = 0;
          updateKbHighlight();
        }
      }
    }

    catInput.addEventListener('input', renderList);
    if (opts.keyboardNav) {
      catInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (selectableItems.length === 0) return;
          kbIndex = kbIndex < selectableItems.length - 1 ? kbIndex + 1 : 0;
          updateKbHighlight();   // ⚠ 화면 1과 달리 여기서는 addBtn 의 kb-active 를 만지지 않는다
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (selectableItems.length === 0) return;
          kbIndex = kbIndex > 0 ? kbIndex - 1 : selectableItems.length - 1;
          updateKbHighlight();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (kbIndex >= 0 && kbIndex < selectableCallbacks.length) {
            selectableCallbacks[kbIndex]();
          } else if (newCatForm.style.display === 'flex') {
            confirmBtn.click();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
    }
    addBtn.addEventListener('click', () => {
      newCatForm.style.display = 'flex';
      newCatForm.style.alignItems = 'center';
    });

    renderList();
    catInput.focus();   // ⚠ 화면 1과 달리 setTimeout 이 없다(2227)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 열기 (원본 openQuickPicker 1808-1828 / openReQuickPicker 4898-4916)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * ⚠ 순서를 지켜라: 기존 팝업만 제거(미리보기 유지) → createElement → className →
   *   모듈 변수 대입 → body.appendChild → positionPopup(크기를 재야 한다) → 화면 1 그리기 →
   *   setTimeout 0 뒤 바깥 클릭 닫기.
   * @param {number} row
   * @param {number} cellIndex
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} [count] 생략하면 store.session.defaultCount (원본 기본 인자 DEFAULT_COUNT)
   */
  function open(row, cellIndex, clientX, clientY, count) {
    const total = count === undefined ? store.session.defaultCount : count;
    close(true);   // 1809: 기존 팝업만 제거, 미리보기는 유지
    const popup = document.createElement('div');
    popup.className = CLS.quickPopup;
    popupEl = popup;
    document.body.appendChild(popup);
    positionPopup(popup, clientX, clientY);
    showMoveScreen(popup, row, cellIndex, clientX, clientY, total);

    // 외부 탭/클릭 시 닫기. ⚠ 게터를 넘긴다 — 화면 1↔2 는 같은 요소를 재사용하지만
    //   open() 이 다시 불리면 요소가 갈리므로 매번 최신 것을 봐야 한다(원본이 모듈 변수를 읽는 것과 같다).
    bindOutsideClose(() => popupEl, () => close());
  }

  return {
    open,
    close,
    isOpen: () => popupEl !== null,
    element: () => popupEl,
  };
}
