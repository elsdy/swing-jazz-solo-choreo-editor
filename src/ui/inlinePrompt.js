// src/ui/inlinePrompt.js — 이름을 그 칸 위에서 바로 적는 입력 (ui 계층, RM-04)
//
// 브라우저 prompt 창을 걷어 낸 자리다. 동작 이름 · 카테고리 키 · 루틴 이름 · 블록 이름 · 영상 이름의
// 다섯 곳이 이것을 쓴다. 블록 이름은 2026-11-02(RM-15)부터 추천 목록 · Tab 이 붙은 askName 이다. 누른 칸(anchor) 바로 위에 입력창이 겹쳐 뜨고, 그 자리에서 적는다.
//   Enter → 확정(적은 값)   Esc → 취소(null)   바깥을 누르면(포커스를 잃으면) → 확정
// 취소는 prompt 와 같이 null 이다 — 호출부는 예전처럼 「null 이면 아무 일도 하지 않는다」.
//
// ⚠ 입력 중의 글쇠는 보드 단축키로 새지 않는다(keydown 을 여기서 멈춘다). 그렇지 않으면 이름에 `B` 를
//   치는 순간 받아 적기 경계가 찍히고, Ctrl+Z 가 보드를 되돌린다.
// ⚠ 한 번에 하나만 뜬다. 새로 열면 앞의 것은 취소(null)로 닫힌다.
// ⚠ Promise 로 돌려준다 — 창이 모달이 아니므로 값이 나중에 온다. 호출부는 then 에서 커맨드를 부른다.

import { joinJamo } from '../domain/hangul.js';

/** @type {null | ((value: string|null) => void)} */
let closeCurrent = null;

/**
 * @param {{
 *   anchor?: Element|null,
 *   at?: { x: number, y: number },
 *   title: string,
 *   value?: string,
 *   doc?: Document
 * }} opts  anchor 가 화면에 없으면 at(누른 자리)에, 그것도 없으면 화면 가운데 위쪽에 뜬다.
 *   ⚠ 누르는 순간 다시 그려지는 칸(동작 목록의 카드)은 dblclick 이 올 때 이미 떨어져 나가 있다 — 그래서 at 을 함께 준다.
 * @returns {Promise<string|null>}
 */
export function askText(opts) {
  const doc = opts.doc || document;
  if (closeCurrent) closeCurrent(null);

  return new Promise((resolve) => {
    const box = doc.createElement('div');
    box.className = 'inline-prompt';
    const label = doc.createElement('div');
    label.className = 'inline-prompt-title';
    label.textContent = opts.title;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'inline-prompt-input';
    input.value = opts.value ?? '';
    input.setAttribute('aria-label', opts.title);
    const hint = doc.createElement('div');
    hint.className = 'inline-prompt-hint';
    hint.textContent = 'Enter 확정 · Esc 취소';
    box.append(label, input, hint);

    place(box, opts.anchor, doc, opts.at);

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (closeCurrent === finish) closeCurrent = null;
      box.remove();
      resolve(value);
    };
    closeCurrent = finish;

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;               // 한글 조합 중의 Enter 는 글자를 맺는 것이다
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    // 바깥을 누르면 확정한다(파인더·편집기의 이름 바꾸기와 같다). Esc 로만 취소한다.
    // ⚠ 창 자체가 포커스를 잃은 것(다른 앱·영상 창으로 갔다)은 바깥을 누른 것이 아니다 — 그때도 blur 가 오는데,
    //   거기서 확정하면 적던 이름이 반쯤 들어가고 입력이 사라진다(2026-10-01 브라우저 시험에서 겪었다).
    //   돌아와서 입력을 다시 누르면 이어서 적을 수 있다.
    input.addEventListener('blur', () => {
      if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return;
      finish(input.value);
    });

    doc.body.appendChild(box);
    input.focus();
    input.select();
  });
}

/**
 * @typedef {Object} NameAnswer
 * @property {string|null} value 적은(고른) 이름. 취소 · 블록이 사라짐이면 null
 * @property {'enter'|'tab'|'shift-tab'|'pick'|'blur'|'escape'|'gone'} via 어떻게 닫혔나 — 조립부는 tab · shift-tab 으로 다음 `?` 로 간다
 */

/**
 * 블록 위 이름 입력(RM-15) — askText 에 **추천 목록 · 화살표 고르기 · Tab** 을 얹은 것.
 *
 *   글자를 칠 때마다 `suggest(질의)` 가 준 동작이 입력 아래에 줄로 선다(최대 8개). ↓ ↑ 로 고르고
 *   Enter → 고른 것이 있으면 그 이름, 없으면 적은 글자(via 'enter')
 *   Tab / Shift+Tab → 같은 값으로 닫되 via 'tab' · 'shift-tab' — 조립부가 다음 · 앞 `?` 로 옮겨 다시 연다
 *   Esc → null   바깥을 누르면 → 적은 글자(via 'blur')   항목을 누르면 → 그 이름(via 'pick')
 *
 * ⚠ 한글 조합 중(isComposing)의 Enter · Tab 은 글자를 맺는 것이라 가로채지 않는다.
 * ⚠ Tab 은 **이 입력이 열려 있을 때만** 가로챈다(여기 keydown 에서 멈춘다) — 평소의 포커스 이동은 그대로다.
 * ⚠ 가리키던 블록(anchor)이 다시 그리기로 떨어져 나가면 입력도 닫는다(via 'gone', null) — 반쯤 친 이름이 엉뚱한 블록에
 *   붙지 않게. 문서의 자식 변화를 보고 anchor.isConnected 를 되묻는다.
 * ⚠ askText 와 같은 「한 번에 하나」다 — 새로 열면 앞의 것은 취소로 닫힌다.
 * ⚠ jamoRejoin(RM-50) — 한글 낱자 글쇠로 열린 입력에서만 켠다. body 에서 받은 첫 글쇠들을 실제 입력기가 조합 없이 맺어
 *   「ㅅㅡ윙」처럼 흩어 넣으므로, **맺힌 뒤**(isComposing 이 아닌 input) 흩어진 자모를 domain/hangul.joinJamo 로 다시 묶는다.
 *   조합 중에는 값을 절대 건드리지 않는다(입력기가 깨진다). compositionend 뒤에 input 이 오지 않는 브라우저(Safari)가 있어
 *   닫을 때(enter · tab · blur) 한 번 더 거친다. 고른 추천(↓↑ · 누름)은 목록의 이름이라 거치지 않는다.
 *
 * @param {{
 *   anchor?: Element|null,
 *   at?: { x: number, y: number },
 *   title: string,
 *   value?: string,
 *   selectAll?: boolean,
 *   suggest?: (query: string) => Array<{ name: string, category?: string }>,
 *   jamoRejoin?: boolean,
 *   doc?: Document
 * }} opts selectAll 이 참이면 처음 값을 통째로 고른 채 연다(갈아 끼우기). 거짓이면 커서가 값 끝에 선다(첫 글자를 잇는다).
 *   jamoRejoin 이 참이면 맺힌 뒤 흩어진 한글 자모를 다시 묶는다(위 ⚠)
 * @returns {Promise<NameAnswer>}
 */
// @complexity time=O(k+m) space=O(k+m) cc=22
export function askName(opts) {
  const doc = opts.doc || document;
  if (closeCurrent) closeCurrent(null);

  return new Promise((resolve) => {
    const box = doc.createElement('div');
    box.className = 'inline-prompt inline-prompt-name';
    const label = doc.createElement('div');
    label.className = 'inline-prompt-title';
    label.textContent = opts.title;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'inline-prompt-input';
    input.value = opts.value ?? '';
    input.setAttribute('aria-label', opts.title);
    const list = doc.createElement('div');
    list.className = 'inline-prompt-list';
    const hint = doc.createElement('div');
    hint.className = 'inline-prompt-hint';
    hint.textContent = 'Enter 확정 · Tab 다음 ? · Esc 취소';
    box.append(label, input, list, hint);

    place(box, opts.anchor, doc, opts.at);

    let done = false;
    let observer = null;
    const finish = (value, via) => {
      if (done) return;
      done = true;
      if (closeCurrent === finish) closeCurrent = null;
      if (observer) observer.disconnect();
      box.remove();
      resolve({ value, via });
    };
    closeCurrent = (value) => finish(value, 'escape');

    /** @type {Array<{ name: string, category?: string }>} */
    let items = [];
    let active = -1;
    const suggest = typeof opts.suggest === 'function' ? opts.suggest : () => [];
    const paint = () => {
      list.innerHTML = '';
      items.forEach((m, i) => {
        const row = doc.createElement('div');
        row.className = 'inline-prompt-item' + (i === active ? ' is-active' : '');
        row.textContent = m.name;
        if (m.category) {
          const cat = doc.createElement('span');
          cat.className = 'inline-prompt-item-cat';
          cat.textContent = m.category;
          row.appendChild(cat);
        }
        // mousedown 에서 고른다 — click 까지 기다리면 그 사이 blur 가 먼저 와 적은 글자로 닫힌다.
        row.addEventListener('mousedown', (e) => { e.preventDefault(); finish(m.name, 'pick'); });
        list.appendChild(row);
      });
      list.style.display = items.length ? '' : 'none';
    };
    const refresh = () => {
      // 조합 중이라 값을 아직 못 묶었어도(「ㅅㅡ윙」) 추천은 묶은 글자(「스윙」)로 찾는다 — 값은 건드리지 않는다.
      items = (suggest(opts.jamoRejoin ? joinJamo(input.value) : input.value) || []).slice(0, 8);
      active = -1;
      paint();
    };
    // 흩어진 자모를 다시 묶는다 — 바뀌었을 때만 값을 갈고, 커서는 끝에서 잰 자리를 지킨다(끝에 있었으면 끝).
    const rejoin = () => {
      if (!opts.jamoRejoin) return;
      const before = input.value;
      const after = joinJamo(before);
      if (after === before) return;
      const fromEnd = before.length - (typeof input.selectionEnd === 'number' ? input.selectionEnd : before.length);
      input.value = after;
      const caret = Math.max(0, after.length - fromEnd);
      if (typeof input.setSelectionRange === 'function') input.setSelectionRange(caret, caret);
    };
    const typed = () => { rejoin(); return input.value; };
    const chosen = () => (active >= 0 && items[active] ? items[active].name : typed());

    input.addEventListener('input', (e) => {
      if (!(e && e.isComposing)) rejoin();     // 조합 중의 값은 입력기의 것이다 — 손대면 조합이 깨진다
      refresh();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;               // 한글 조합 중의 Enter · Tab 은 글자를 맺는 것이다
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        active = e.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length;
        paint();
      } else if (e.key === 'Enter') { e.preventDefault(); finish(chosen(), 'enter'); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(chosen(), e.shiftKey ? 'shift-tab' : 'tab'); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null, 'escape'); }
    });
    input.addEventListener('blur', () => {
      if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return;
      finish(typed(), 'blur');
    });

    doc.body.appendChild(box);
    refresh();
    input.focus();
    if (opts.selectAll) input.select();
    else if (typeof input.setSelectionRange === 'function') input.setSelectionRange(input.value.length, input.value.length);

    // 가리키던 블록이 사라지면 닫는다. 자리 스냅샷(anchorOf)은 늘 isConnected 라 해당 없다.
    const view = doc.defaultView;
    const anchor = opts.anchor;
    if (anchor && view && typeof view.MutationObserver === 'function' && 'isConnected' in anchor) {
      observer = new view.MutationObserver(() => { if (!anchor.isConnected) finish(null, 'gone'); });
      observer.observe(doc.body, { childList: true, subtree: true });
    }
  });
}

/**
 * 입력창을 anchor 위에 겹쳐 놓는다. 화면 밖으로 나가지 않게 가둔다.
 * @param {HTMLElement} box
 * @param {Element|null|undefined} anchor
 * @param {Document} doc
 * @param {{x:number,y:number}} [at]
 */
function place(box, anchor, doc, at) {
  const view = doc.defaultView || { innerWidth: 1024, innerHeight: 768 };
  let rect = anchor && anchor.isConnected && typeof anchor.getBoundingClientRect === 'function'
    ? anchor.getBoundingClientRect() : null;
  if (!rect && at && Number.isFinite(at.x) && Number.isFinite(at.y)) rect = { left: at.x - 24, top: at.y - 8, width: 260 };
  const width = Math.max(220, Math.min(360, rect ? rect.width : 300));
  let left = rect ? rect.left : (view.innerWidth - width) / 2;
  let top = rect ? rect.top - 22 : view.innerHeight * 0.2;
  left = Math.max(8, Math.min(left, view.innerWidth - width - 8));
  top = Math.max(8, Math.min(top, view.innerHeight - 90));
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
  box.style.width = `${Math.round(width)}px`;
}

/**
 * 사라질 요소(메뉴처럼 열자마자 닫는 것)의 자리를 붙잡아 둔다. askText 의 anchor 로 넘긴다.
 * @param {Element|null|undefined} el
 * @returns {{ isConnected: true, getBoundingClientRect(): DOMRect } | null}
 */
export function anchorOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const rect = el.getBoundingClientRect();
  return { isConnected: true, getBoundingClientRect: () => rect };
}
