// src/ui/placementView.js — placement 1개 → DOM, 그리고 비고 칸 문자열 (ui 계층)
//
// 원본 index.html 의 createPlacementEl(3420-3445) · renderRowNotes(3394-3408) ·
// placementRangeLabel(3410-3418)을 옮겼다.
//
// ⚠ 이 파일은 **커맨드를 부르지 않는다.** 상태를 읽어 DOM 을 만들 뿐이다.
//   클릭·드래그 배선은 input/boardController 의 몫이고, 그쪽은 여기서 만든
//   `.placement` / `.move-handle` / `.resize-handle` 을 el 위임으로 되읽는다
//   (그 암묵 계약이 ui/domContract.js 다).
//
// ⚠⚠ 보존 대상 결함 두 가지가 이 파일에 있다 — 고치지 마라:
//   #5 루틴 배치는 routine.color 를 **읽기만** 하고 el.style.background 에 쓰지 않는다(3438이 else 안).
//      CSS 의 `.placement.is-routine` 이 !important 그라디언트를 주기 때문에 오늘 화면은 그 색이다.
//      균일하게 칠하도록 '고치면' 보드의 루틴 블록 색이 전부 바뀐다.
//      → domain/categories.resolvePlacementColor 가 `apply:false` 로 이 사실을 값으로 돌려준다.
//   #7 intro 행의 라벨은 'intro' 인데 비고의 범위 라벨은 `8x0` 이다(3364 vs 3417).

import { CLS, DATA } from './domContract.js';
import { escapeHtml } from './widgets.js';
import { readCellH } from './cssVars.js';
import { resolvePlacementColor } from '../domain/categories.js';
import { groupCount, placementRangeLabel } from '../domain/placements.js';

/**
 * @typedef {Object} PlacementViewDeps
 * @property {{ rows:number, cols:number, hasIntroRow?:boolean, placements:any[] }} board
 *   store.viewDeps(boardId).board — 이 보드의 BoardDoc.
 * @property {Record<string, {label:string,color:string}>} categories
 * @property {{ id:string, color?:string }[]} routines
 * @property {Set<string>} selection  메인 보드의 선택 그룹 집합(store.selection)
 * @property {{ allowsSelection?: boolean }} [policy]
 *   store.policy(boardId). ⚠ 원본 3424 의 `ctx === mainCtx` 가 이 플래그다.
 * @property {{ type?:string, groupId?:string }|null} [drag]
 *   input/dragSession 의 현재 드래그. ⚠ store.viewDeps 에는 없다 — app/main 이 따로 주입한다.
 * @property {number} [cellH]
 *   이 프레임의 --cellH(px). ui/boardView 가 renderRow 마다 한 번 읽어 내려 넘긴다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 배치 1개 → DOM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배치 하나를 그리는 `.placement` 엘리먼트를 만든다(트랙에 붙이는 것은 호출부의 몫).
 *
 * 원본과 **순서까지** 같다: className → is-routine → is-selected → is-dragging →
 * dataset 3종 → left/width/top → 색 → innerHTML.
 *
 * ⚠ `.is-selected` 복원이 여기서 일어난다. 선택 표시는 오늘 두 경로다 —
 *   ① 클릭 시 boardView.setSelected 가 클래스만 토글(원본 2462-2463)
 *   ② 행을 다시 그릴 때 여기서 복원(원본 3424).
 *   ②를 ①의 재렌더로 대체하지 마라. 클릭 한 번마다 그 행의 `.placement` 가 전부 파괴·재생성되어
 *   드래그·툴팁·포커스 동작이 달라진다.
 * ⚠ `data-routine-id` 는 루틴 블록에만 붙는다(3428). 일반 배치에는 **키 자체가 없다**.
 * ⚠ `cnt` 는 그룹 전체 카운트다(세그먼트 길이가 아니다) — 툴팁과 라벨이 같은 값을 쓴다.
 *
 * @see index.html:3420
 * @param {{ id:string, groupId:string, name:string, category?:string, type?:string,
 *           routineId?:string, row:number, startIndex:number, length:number, subRow?:number }} placement
 * @param {number} visualSubRow 이 배치가 놓일 레이어(0 이 맨 위 줄)
 * @param {PlacementViewDeps} deps
 * @returns {HTMLDivElement}
 */
export function createPlacementEl(placement, visualSubRow, deps) {
  const { board, categories, routines, selection, policy, drag } = deps;
  const el = document.createElement('div');
  el.className = CLS.placement;
  if (placement.type === 'routine') el.classList.add(CLS.isRoutine);
  // 원본 3424 의 `ctx === mainCtx` → policy.allowsSelection (루틴 편집 보드는 false)
  if (policy?.allowsSelection && selection?.has(placement.groupId)) el.classList.add(CLS.isSelected);
  if (drag?.type === 'placement-move' && drag.groupId === placement.groupId) el.classList.add(CLS.isDragging);
  el.dataset[DATA.groupId] = placement.groupId;
  el.dataset[DATA.name] = placement.name;
  if (placement.routineId) el.dataset[DATA.routineId] = placement.routineId;
  el.style.left = `calc(${placement.startIndex} * var(--cellW) + 4px)`;
  el.style.width = `calc(${placement.length} * var(--cellW) - 8px)`;
  // 시각적 subRow 로 레이어 위치를 px 로 직접 지정.
  // ⚠ 원본 3432 는 배치마다 getCellHPx() 를 다시 불렀다. 값은 같은 프레임 안에서 변하지 않으므로
  //   boardView 가 행마다 한 번 읽어 넘긴 cellH 를 쓰고, 없으면 원본과 똑같이 여기서 읽는다.
  const cellH = typeof deps.cellH === 'number' ? deps.cellH : readCellH();
  el.style.top = `${visualSubRow * cellH + 6}px`;
  // ⚠⚠ 보존 결함 #5 — 루틴 배치는 apply:false 라 background 를 **쓰지 않는다**(원본 3438 이 else 안).
  const color = resolvePlacementColor(placement, { categories, routines: routines || [] });
  if (color.apply) el.style.background = color.background;
  if (color.textColor) el.style.color = color.textColor;
  const cnt = groupCount(board.placements, placement.groupId);
  el.innerHTML = `<div class="${CLS.tooltip}">${escapeHtml(placement.name)} ${cnt}c</div>`
    + `<div class="${CLS.moveHandle}" draggable="true" title="위치 이동"></div>`
    + `<div class="${CLS.label}">${escapeHtml(placement.name)} <span style="opacity:.72; font-size:11px;">${cnt}c</span></div>`
    + `<div class="${CLS.resizeHandle}" title="길이 조절"></div>`;
  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// 비고 칸
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 행의 비고 칸 HTML 문자열(`<br>` 로 이은 여러 줄). 붙이는 것은 호출부의 몫이다.
 *
 * ⚠ PR #17 의 규칙: **여러 행에 걸친 동작은 첫 행의 비고에만 적는다.**
 *   각 배치마다 같은 groupId 의 최소 row 를 다시 구해 자기 행과 비교한다(원본 3397-3401).
 *   O(n²) 이지만 값이 같아야 하므로 그대로 옮겼다.
 * ⚠ 루틴 블록은 `▶ 이름` 만 적고 범위 라벨이 없다(3404).
 * ⚠ escapeHtml 이 **조립 뒤 한 번** 걸린다 — 괄호와 범위 라벨까지 통째로 이스케이프된다(3405).
 *   순서를 바꾸면 이름에 `&` 가 든 동작의 표기가 달라진다.
 *
 * @see index.html:3394
 * @param {number} row
 * @param {{ board: { cols:number, placements:any[] } }} deps
 * @returns {string} 비어 있으면 '' (호출부가 `|| '<span class="muted">-</span>'` 로 받는다)
 */
export function renderRowNotes(row, deps) {
  const { placements, cols } = deps.board;
  return placements
    .filter(p => p.row === row)
    .filter(p => {
      // 여러 행에 걸친 동작은 첫 번째 행의 비고란에만 표시
      const firstRow = Math.min(...placements.filter(s => s.groupId === p.groupId).map(s => s.row));
      return p.row === firstRow;
    })
    .sort((a, b) => a.startIndex - b.startIndex)
    .map(p => {
      if (p.type === 'routine') return escapeHtml(`▶ ${p.name}`);
      return escapeHtml(`${p.name} (${placementRangeLabel(placements, p.groupId, cols)})`);
    })
    .join('<br>');
}

/**
 * 범위 라벨 `8x0 : 1 [6]`. **domain/placements.placementRangeLabel 을 그대로 위임한다** —
 * 포맷 문자열이 두 벌이 되지 않게 하려는 것이 이 함수의 유일한 존재 이유다.
 * @see index.html:3410
 * @param {any[]} placements
 * @param {string} groupId
 * @param {number} cols
 * @returns {string}
 */
export function rangeLabel(placements, groupId, cols) {
  return placementRangeLabel(placements, groupId, cols);
}
