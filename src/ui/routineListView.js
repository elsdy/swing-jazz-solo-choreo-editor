// src/ui/routineListView.js — 사이드바의 루틴 카드 목록 (ui 계층)
//
// 원본 index.html 의 renderRoutineList(4691-4771)과 그 안의 buildCard, routineListEl(1460)을 옮겼다.
//
// ⚠ 뷰는 상태를 읽고 DOM 을 만들 뿐 커맨드를 직접 부르지 않는다 — 전부 주입받은 commands 를 거친다.
// ⚠ dragstart 에서 `mainCtx.drag = {...}` 를 직접 쓰던 4707-4708 은 ui → input 교차 import 가 되므로
//   주입받은 dragSession 에 넘긴다. dataTransfer 조작 순서(drag 대입 → effectAllowed → setData)는 원문 그대로다.
//   ⚠ 루틴 드래그를 받는 보드는 **메인뿐**이다(원본은 mainCtx.drag 에만 넣는다) —
//     input/dragSession 의 boards 표도 같은 값(['main'])을 적고 있다.
// ⚠ dragend(4712)의 화면 정리(clearTrackHighlights + clearPreview)는 dragSession 의 일이 아니다.
//   ui/overlays 가 하는 일이므로 app/main 이 onDragEnd 로 감싸 넘긴다.

import { CLS } from './domContract.js';
import { DEFAULT_ROUTINE_COLOR } from '../domain/categories.js';
import { escapeHtml, confirmOnce, makeInlineStarBtn } from './widgets.js';

// 루틴 칩의 기본색은 domain/categories 가 갖는다 — 안무표 블록과 같은 값을 써야
// 목록 칩과 블록 색이 갈리지 않는다(원본 4715 는 여기에 리터럴을 또 뒀다).

/** 즐겨찾기 머리글의 인라인 스타일. 원본 4756. */
const FAV_HEADER_STYLE = 'font-size:10px;font-weight:800;color:#facc15;padding:4px 2px 2px;letter-spacing:0.04em;';
/** 즐겨찾기와 나머지 사이의 구분선. 원본 4763. */
const DIVIDER_STYLE = 'height:1px;background:var(--line);margin:6px 0 4px;';
/** 루틴이 하나도 없을 때의 안내. 원본 4694 — 문구·인라인 스타일까지 원문 그대로. */
const EMPTY_HTML = '<div class="helper" style="padding:4px 2px;">아직 루틴이 없습니다. + 새 루틴을 눌러 만들어 보세요.</div>';

/**
 * @typedef {object} RoutineListDeps
 * @property {any} store createStore 인스턴스(읽기 전용으로 쓴다). routines · favorites.routineIds ·
 *   session.editingRoutineId 세 곳을 읽는다.
 * @property {{
 *   toggleFavorite: (routineId: string) => any,
 *   renameRoutine: (routineId: string) => any,
 *   openRoutineEditor: (routineId: string) => any,
 *   deleteRoutine: (routineId: string) => any
 * }} commands app/main 이 routineCommands 를 묶어 넘긴다.
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {{ begin: (kind: string, payload?: object, options?: { boards?: string[] }) => any, end: () => void }} dragSession
 *   input/dragSession 인스턴스(앱 전체에 하나). 원본 4708 의 `mainCtx.drag = {type:'routine', routineId}` 자리다.
 * @property {() => void} [onDragEnd] 원본 4712 의 나머지 두 줄
 *   `clearTrackHighlights(mainCtx); clearPreview(mainCtx);`. ui/overlays 로 만들어 app/main 이 넘긴다.
 * @property {HTMLElement} [root] 목록을 담을 요소. 기본값은 #routineList(원본 1460)
 */

/**
 * 루틴 카드 목록 뷰를 만든다.
 *
 * @param {RoutineListDeps} deps
 * @returns {{ render(): void }}
 */
export function createRoutineListView(deps) {
  const {
    store,
    commands,
    render,
    dragSession,
    onDragEnd = () => {},
    root = document.getElementById('routineList')
  } = deps;

  /**
   * 카드 하나(원본 4700-4751). 만드는 순서·붙이는 순서가 전부 원문 그대로다.
   * @param {any} routine
   * @returns {HTMLElement}
   */
  function buildCard(routine) {
    const card = document.createElement('div');
    // 4702 — 편집 중인 루틴만 .is-editing
    card.className = CLS.routineCard + (store.session.editingRoutineId === routine.id ? ' ' + CLS.isEditing : '');
    card.draggable = true;                                          // 4703
    card.dataset.routineId = routine.id;                            // 4704

    // 드래그 → 메인 보드에 루틴 배치 (4707-4712)
    card.addEventListener('dragstart', (e) => {
      // 4708 — `mainCtx.drag = { type:'routine', routineId }`. 메인 보드만 받는다.
      dragSession.begin('routine', { routineId: routine.id }, { boards: ['main'] });
      e.dataTransfer.effectAllowed = 'copy';                        // 4709
      e.dataTransfer.setData('text/plain', routine.id);             // 4710
    });
    card.addEventListener('dragend', () => {                        // 4712
      dragSession.end();          // mainCtx.drag = null
      onDragEnd();                // clearTrackHighlights(mainCtx) + clearPreview(mainCtx)
    });

    const chip = document.createElement('div');
    chip.className = CLS.routineChip;                               // 4715
    chip.style.background = routine.color || DEFAULT_ROUTINE_COLOR; // 4716

    const info = document.createElement('div');
    // 4719 — innerHTML 이라 이름은 escapeHtml 을 거친다. `박자 × `의 곱셈기호(×)는 원문 그대로.
    info.innerHTML = `<div class="${CLS.routineNameText}">${escapeHtml(routine.name)}</div><div class="${CLS.routineMetaText}">${routine.cols}박자 × ${routine.rows}행</div>`;
    info.style.minWidth = '0';                                      // 4720
    info.addEventListener('dblclick', () => render(commands.renameRoutine(routine.id)));  // 4721

    const actions = document.createElement('div');
    actions.className = CLS.routineActions;                         // 4724

    // 4726-4731 — 루틴 카드 판 ★ 버튼: title '즐겨찾기' / stopPropagation true / 클래스 토글 **없음**
    // (toggleFavorite 이 돌려주는 Dirty.routineList 로 목록이 다시 그려지며 별이 켜진다)
    const starBtn = makeInlineStarBtn(
      () => store.favorites.routineIds.has(routine.id),
      () => { render(commands.toggleFavorite(routine.id)); },
      { title: '즐겨찾기', stopPropagation: true, toggleClass: false }
    );

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = CLS.editBtn;                                // 4735
    editBtn.textContent = '✏';                                      // 4736
    editBtn.title = '루틴 편집';                                     // 4737
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      render(commands.openRoutineEditor(routine.id));               // 4738
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = CLS.iconBtn;                                 // 4742
    delBtn.textContent = '×';                                       // 4743
    delBtn.title = '루틴 삭제';                                      // 4744
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 4747 — 2초 안에 두 번 눌러야 지워진다. 되돌릴 라벨은 '×'.
      confirmOnce(delBtn, '×', () => { render(commands.deleteRoutine(routine.id)); });
    });

    actions.append(starBtn, editBtn, delBtn);                       // 4749
    card.append(chip, info, actions);                               // 4750
    return card;
  }

  /** 목록 전체를 다시 그린다(원본 renderRoutineList 4691-4770). */
  function renderList() {
    root.innerHTML = '';                                            // 4692
    const routines = store.routines;
    if (!routines.length) {                                         // 4693
      root.innerHTML = EMPTY_HTML;                                  // 4694
      return;
    }
    const favIds = store.favorites.routineIds;
    const favs = routines.filter(r => favIds.has(r.id));            // 4697
    const others = routines.filter(r => !favIds.has(r.id));         // 4698

    if (favs.length) {                                              // 4753
      const favHeader = document.createElement('div');
      favHeader.style.cssText = FAV_HEADER_STYLE;                   // 4755
      favHeader.textContent = '★ 즐겨찾기';                          // 4756
      root.appendChild(favHeader);
      favs.forEach(r => root.appendChild(buildCard(r)));            // 4758
      if (others.length) {                                          // 4759
        const div = document.createElement('div');
        div.style.cssText = DIVIDER_STYLE;                          // 4761
        root.appendChild(div);
      }
    }
    others.forEach(r => root.appendChild(buildCard(r)));            // 4766
  }

  return { render: renderList };
}
