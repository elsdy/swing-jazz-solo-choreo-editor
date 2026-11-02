// src/ui/partView.js — 파트(섹션)를 긋고 고치는 작은 팝업 (ui 계층, 2026-11-03 RM-23)
//
// 마디 이름 칸이 파트의 손잡이다.
//   - 파트가 없는 마디 이름을 누르면 **범위 고르기**가 시작된다 — 그 마디부터 넉 마디(또는 다음 파트 앞까지)가 칠해지고,
//     다른 마디 이름을 누르면 끝이 거기로 바뀐다. 팝업의 `파트로 묶기…` 가 이름 · 끝 · 색을 적는 칸을 연다.
//   - 파트 안의 마디 이름을 누르면 그 파트가 접히고(첫 마디 한 줄 요약), 다시 누르면 펴진다.
//   - 마디 메뉴(우클릭 · 길게 누르기)의 `파트로 묶기…` · `파트 고치기…` 가 같은 팝업을 바로 연다.
//
// ⚠ 생김새는 형제 팝업(rowActionPopup · routineActionPopup)과 **같은 클래스**에 `part-popup` 하나를 더한다.
// ⚠ 커맨드는 **히스토리 커밋까지 끝낸** Dirty 를 돌려줘야 한다(형제 팝업과 같은 규약). 접기만 커밋하지 않는다(화면의 일).
// ⚠ 범위 고르기의 칠은 마디 이름 칸의 `data-part-pick` 하나다 — 팝업을 닫으면 지운다. 상태는 이 파일 안에만 산다
//   (저장 · 되돌리기와 무관한 손짓 도중의 것).
// ⚠ 글자는 모두 domain/strings 의 `part.*` 줄이다 — 여기서 새 글자를 적지 않는다.

import { CLS, DATA, SEL } from './domContract.js';
import { confirmOnce } from './widgets.js';
import { placePlacementActionPopup } from '../domain/popupPlacement.js';
import { PART_COLORS, PART_NAME_MAX } from '../domain/parts.js';
import { str, fill } from '../domain/strings.js';

/**
 * @typedef {{ name:string, startRow:number, endRow:number, color:string }} Part
 * @typedef {object} PartViewDeps
 * @property {() => HTMLElement|null} boardEl 메인 보드(마디 이름 칸을 칠할 자리)
 * @property {(row:number) => Part|null} partOf 이 마디가 든 파트
 * @property {(row:number) => ({startRow:number, endRow:number, color:string, maxEnd:number}|null)} draftOf 새 파트의 기본값
 * @property {(part:Part) => number} maxEndOf 이 파트의 끝 마디가 갈 수 있는 끝(다음 파트 앞 · 마지막 마디)
 * @property {(startRow:number) => boolean} isFolded
 * @property {{
 *   add(args:{name:string,startRow:number,endRow:number,color:string}): any,
 *   update(args:{startRow:number,name?:string,endRow?:number,color?:string}): any,
 *   remove(args:{startRow:number}): any,
 *   fold(args:{startRow:number}): any,
 *   move(args:{startRow:number, dir:-1|1}): any,
 *   repeat(args:{startRow:number}): any
 * }} commands
 * @property {(dirty:any) => void} render presenter
 */

/**
 * @param {PartViewDeps} deps
 * @returns {{ tapLabel(row:number, x:number, y:number): void, openNew(row:number, x:number, y:number): void,
 *   openEdit(row:number, x:number, y:number): void, close(): void, current(): HTMLElement|null }}
 */
// @complexity time=O(1) space=O(1) cc=1
export function createPartView(deps) {
  const { boardEl, partOf, draftOf, maxEndOf, isFolded, commands, render } = deps;

  /** @type {HTMLElement|null} */
  let popupEl = null;
  /** 범위 고르기 중이면 그 범위. @type {{startRow:number, endRow:number, color:string, maxEnd:number}|null} */
  let pick = null;
  let lastX = 0;
  let lastY = 0;
  /** 새 파트 이름 칸이 열려 있으면 그 `끝 마디` 칸 — 고르기 중 마디 이름을 누르면 여기를 고친다. */
  let formEnd = null;
  /** 바깥 누름 리스너를 떼는 함수. */
  let outsideOff = null;

  /** 마디 이름 칸의 고르기 칠을 지금 pick 에 맞춘다. */
  // @complexity time=O(r) space=O(1) cc=5
  function paintPick() {
    const root = boardEl();
    if (!root) return;
    for (const label of root.querySelectorAll(SEL.rowLabel)) {
      const row = Number(label.dataset[DATA.row]);
      if (pick && row >= pick.startRow && row <= pick.endRow) label.dataset[DATA.partPick] = DATA.FLAG_ON;
      else delete label.dataset[DATA.partPick];
    }
  }

  /** 두 번 불러도 안전하다. */
  // @complexity time=O(r) space=O(1) cc=2
  function close() {
    if (popupEl) { popupEl.remove(); popupEl = null; }
    if (outsideOff) { outsideOff(); outsideOff = null; }
    pick = null;
    formEnd = null;
    paintPick();
  }

  /** 빈 팝업 틀(제목 한 줄)을 세운다. */
  // @complexity time=O(1) space=O(1) cc=1
  function frame(titleText) {
    if (popupEl) popupEl.remove();
    formEnd = null;
    const popup = document.createElement('div');
    popup.className = `${CLS.routineActionPopup} ${CLS.partPopup}`;
    const title = document.createElement('div');
    title.className = CLS.rapTitle;
    title.textContent = titleText;
    popup.appendChild(title);
    popupEl = popup;
    return popup;
  }

  /** 팝업을 문서에 붙이고 형제 팝업과 같은 규칙으로 자리를 잡는다. */
  // @complexity time=O(1) space=O(1) cc=1
  function place(popup, x, y) {
    document.body.appendChild(popup);
    const { left, top } = placePlacementActionPopup({
      clientX: x, clientY: y, viewW: window.innerWidth, viewH: window.innerHeight, height: popup.offsetHeight,
    });
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    bindOutside();
  }

  /**
   * 바깥을 누르면 닫는다 — popup.bindOutsideClose 와 같되, **범위 고르기 중 마디 이름 칸을 누른 것은 닫지 않는다**
   * (그 누름의 click 을 tapLabel 이 받아 끝을 바꾼다). 그래서 형제 팝업의 것을 쓰지 않고 여기 둔다.
   */
  // @complexity time=O(1) space=O(1) cc=1
  function bindOutside() {
    if (outsideOff) outsideOff();
    let handler = null;
    const timer = setTimeout(() => {
      // @complexity time=O(d) space=O(1) cc=6
      handler = (e) => {
        if (!popupEl || popupEl.contains(e.target)) return;
        const root = boardEl();
        if (pick && root && root.contains(e.target) && e.target.closest?.(SEL.rowLabel)) return;
        close();
      };
      document.addEventListener('pointerdown', handler);
    }, 0);
    outsideOff = () => { clearTimeout(timer); if (handler) document.removeEventListener('pointerdown', handler); };
  }

  /** 단추 하나. */
  // @complexity time=O(1) space=O(1) cc=2
  function button(text, onClick, danger = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (danger) btn.className = CLS.danger;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** `이름` · `끝 마디` · `색` 칸 셋. 고른 값은 돌려준 read() 로 읽는다. */
  // @complexity time=O(k) space=O(k) cc=2
  function fields(popup, init) {
    const nameRow = document.createElement('label');
    nameRow.className = CLS.partPopupRow;
    nameRow.append(str('part.name.label'));
    const name = document.createElement('input');
    name.type = 'text';
    name.name = 'partName';
    name.maxLength = PART_NAME_MAX;
    name.placeholder = str('part.name.placeholder');
    name.value = init.name || '';
    nameRow.appendChild(name);

    const endRow = document.createElement('label');
    endRow.className = CLS.partPopupRow;
    endRow.append(str('part.end.label'));
    const end = document.createElement('input');
    end.type = 'number';
    end.name = 'partEnd';
    end.min = String(init.startRow);
    end.max = String(init.maxEnd);
    end.value = String(init.endRow);
    endRow.appendChild(end);

    const colorRow = document.createElement('div');
    colorRow.className = CLS.partPopupRow;
    colorRow.append(str('part.color.label'));
    let color = init.color;
    const swatches = [];
    for (const c of PART_COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = CLS.partSwatch;
      sw.style.background = c;
      sw.dataset.color = c;
      sw.setAttribute('aria-label', c);
      sw.classList.toggle(CLS.partSwatchOn, c === color);
      sw.addEventListener('click', () => {
        color = c;
        for (const s of swatches) s.classList.toggle(CLS.partSwatchOn, s.dataset.color === c);
      });
      swatches.push(sw);
      colorRow.appendChild(sw);
    }
    popup.append(nameRow, endRow, colorRow);
    return {
      name,
      end,
      // @complexity time=O(1) space=O(1) cc=1
      read: () => ({ name: name.value.trim(), endRow: Math.round(Number(end.value)), color }),
    };
  }

  /** 단계 1 — 범위 고르기 팝업. 다른 마디 이름을 누르면 끝이 바뀌고, `파트로 묶기…` 가 이름 칸을 연다. */
  // @complexity time=O(r) space=O(1) cc=1
  function showPick() {
    const popup = frame(fill('part.new.title', { from: pick.startRow }));
    const hint = document.createElement('div');
    hint.className = CLS.partPopupRow;
    hint.textContent = fill('part.pick.range', { from: pick.startRow, to: pick.endRow });
    popup.appendChild(hint);
    popup.appendChild(button(str('part.menu.new'), () => showNewForm()));
    paintPick();
    place(popup, lastX, lastY);
  }

  /** 단계 2 — 새 파트의 이름 · 끝 · 색. Enter 도 `파트로 묶기` 와 같다. */
  // @complexity time=O(k) space=O(k) cc=2
  function showNewForm() {
    const draft = pick;
    if (!draft) return;
    const popup = frame(fill('part.new.title', { from: draft.startRow }));
    const f = fields(popup, { ...draft, name: '' });
    // @complexity time=O(1) space=O(1) cc=1
    const submit = () => {
      const v = f.read();
      close();
      render(commands.add({ name: v.name, startRow: draft.startRow, endRow: v.endRow, color: v.color }));
    };
    f.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    popup.appendChild(button(str('part.create'), submit));
    paintPick();
    place(popup, lastX, lastY);
    formEnd = f.end;
    f.name.focus();
  }

  /**
   * 새 파트 — 마디 메뉴의 `파트로 묶기…` 에서 바로 이름 칸으로.
   * @param {number} row 시작 마디
   */
  // @complexity time=O(k) space=O(k) cc=2
  function openNew(row, x, y) {
    close();
    const draft = draftOf(row);
    if (!draft) return;
    pick = draft; lastX = x; lastY = y;
    showNewForm();
  }

  /**
   * 파트 고치기 — 이름 · 끝 · 색, 접기 · 펴기, 한 번 더, 위로 · 아래로, 지우기.
   * @param {number} row 파트 안의 아무 마디
   */
  // @complexity time=O(k) space=O(k) cc=4
  function openEdit(row, x, y) {
    close();
    const part = partOf(row);
    if (!part) return;
    const at = { startRow: part.startRow };
    const popup = frame(fill('part.edit.title', { name: part.name, from: part.startRow, to: part.endRow }));
    const f = fields(popup, { ...part, maxEnd: maxEndOf(part) });
    // @complexity time=O(1) space=O(1) cc=1
    const run = (fn) => () => { close(); render(fn()); };
    const apply = run(() => commands.update({ ...at, ...f.read() }));
    f.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    popup.appendChild(button(str('part.apply'), apply));
    popup.appendChild(button(isFolded(part.startRow) ? str('part.unfold') : str('part.fold'), run(() => commands.fold(at))));
    popup.appendChild(button(str('part.repeat'), run(() => commands.repeat(at))));
    popup.appendChild(button(str('part.moveUp'), run(() => commands.move({ ...at, dir: -1 }))));
    popup.appendChild(button(str('part.moveDown'), run(() => commands.move({ ...at, dir: 1 }))));
    const label = str('part.remove');
    const del = button(label, () => confirmOnce(del, label, run(() => commands.remove(at))), true);
    popup.appendChild(del);
    place(popup, x, y);
  }

  /**
   * 마디 이름 칸을 한 번 눌렀다. 고르기 중이면 끝을 바꾸고, 파트 안이면 접고 펴고, 아니면 고르기를 시작한다.
   * @param {number} row
   */
  // @complexity time=O(r) space=O(1) cc=9
  function tapLabel(row, x, y) {
    if (pick && popupEl && row !== pick.startRow && !partOf(row)) {
      if (row > pick.startRow && row <= pick.maxEnd) {
        pick = { ...pick, endRow: row };
        // 이름 칸이 이미 열렸으면 적던 이름을 두고 `끝 마디` 칸만 고친다
        if (formEnd) { formEnd.value = String(row); paintPick(); return; }
        lastX = x; lastY = y;
        showPick();
        return;
      }
    }
    const part = partOf(row);
    if (part) {
      close();
      render(commands.fold({ startRow: part.startRow }));
      return;
    }
    close();
    const draft = draftOf(row);
    if (!draft) return;
    pick = draft; lastX = x; lastY = y;
    showPick();
  }

  return { tapLabel, openNew, openEdit, close, current: () => popupEl };
}
