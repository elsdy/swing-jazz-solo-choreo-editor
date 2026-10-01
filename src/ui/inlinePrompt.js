// src/ui/inlinePrompt.js — 이름을 그 칸 위에서 바로 적는 입력 (ui 계층, RM-04)
//
// 브라우저 prompt 창을 걷어 낸 자리다. 동작 이름 · 카테고리 키 · 루틴 이름 · 블록 이름 · 영상 이름의
// 다섯 곳이 이것을 쓴다. 누른 칸(anchor) 바로 위에 입력창이 겹쳐 뜨고, 그 자리에서 적는다.
//   Enter → 확정(적은 값)   Esc → 취소(null)   바깥을 누르면(포커스를 잃으면) → 확정
// 취소는 prompt 와 같이 null 이다 — 호출부는 예전처럼 「null 이면 아무 일도 하지 않는다」.
//
// ⚠ 입력 중의 글쇠는 보드 단축키로 새지 않는다(keydown 을 여기서 멈춘다). 그렇지 않으면 이름에 `B` 를
//   치는 순간 받아 적기 경계가 찍히고, Ctrl+Z 가 보드를 되돌린다.
// ⚠ 한 번에 하나만 뜬다. 새로 열면 앞의 것은 취소(null)로 닫힌다.
// ⚠ Promise 로 돌려준다 — 창이 모달이 아니므로 값이 나중에 온다. 호출부는 then 에서 커맨드를 부른다.

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
