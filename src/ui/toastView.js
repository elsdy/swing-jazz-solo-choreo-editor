// src/ui/toastView.js — 알림 세 급을 화면에 띄운다 (ui 계층, RM-04)
//
// 유스케이스는 Dirty.notify 로 { kind, message, action? } 만 돌려준다. 조립부(app/main)가 그것을 여기로 보낸다.
//   block  → 앱 안 모달 하나. `확인`(또는 Enter·Esc)을 눌러야 닫힌다 — 작업을 멈춰야 하는 오류만 온다.
//   toast  → 화면 구석에 쌓이고 몇 초 뒤 저절로 사라진다. 누르지 않아도 작업이 이어진다.
//   status → 상태줄(RM-19)이 서기 전까지는 토스트로 대신 뜬다.
//
// ⚠ 브라우저 alert 를 쓰지 않는다. alert 는 누르기 전까지 앱 전체를 멈춘다 — 영상을 틀어 놓고 받아 적는
//   흐름을 끊던 것이 이 파일이 생긴 까닭이다.
// ⚠ 토스트의 버튼(「되돌리기」)은 action 값을 onAction 에 그대로 넘긴다. 무엇을 부를지는 조립부가 안다.
// ⚠ 같은 문구가 겹쳐 오면 새로 쌓지 않고 기존 것의 시간만 늘린다 — 같은 실패를 연달아 겪으면 화면이
//   토스트로 덮인다.

/** 토스트가 떠 있는 시간(ms). 되돌리기 버튼이 있으면 손이 갈 시간을 더 준다. */
export const TOAST_MS = 3200;
export const TOAST_ACTION_MS = 6000;
/** 한꺼번에 쌓아 두는 토스트 수. 넘치면 가장 오래된 것부터 내린다. */
export const TOAST_MAX = 3;

/**
 * @param {{
 *   doc?: Document,
 *   onAction?: (action: { label: string, command: string, boardId: string }) => void,
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout
 * }} [deps]
 * @returns {{ show(n: { kind: string, message: string, action?: object }): void, dismissAll(): void }}
 */
export function createToastView(deps = {}) {
  const doc = deps.doc || document;
  const later = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.clearTimeout || ((id) => clearTimeout(id));
  const onAction = deps.onAction || (() => {});

  /** @type {HTMLElement|null} */
  let stack = null;
  /** @type {HTMLElement|null} */
  let modal = null;
  /** 모달을 열기 전에 포커스를 쥐고 있던 요소 — 닫으면 돌려준다. */
  let returnFocus = null;

  function ensureStack() {
    if (stack && stack.isConnected) return stack;
    stack = doc.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    doc.body.appendChild(stack);
    return stack;
  }

  function removeToast(el) {
    if (el._timer) cancel(el._timer);
    el.remove();
  }

  function arm(el, ms) {
    if (el._timer) cancel(el._timer);
    el._timer = later(() => removeToast(el), ms);
  }

  function showToast(n) {
    const host = ensureStack();
    const ms = n.action ? TOAST_ACTION_MS : TOAST_MS;
    const same = [...host.children].find(el => el.dataset.message === n.message && !n.action && !el._hasAction);
    if (same) { arm(same, ms); return; }

    const el = doc.createElement('div');
    el.className = `toast toast-${n.kind}`;
    el.dataset.message = n.message;
    const text = doc.createElement('span');
    text.className = 'toast-text';
    text.textContent = n.message;
    el.appendChild(text);
    if (n.action) {
      el._hasAction = true;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = n.action.label;
      btn.addEventListener('click', () => {
        removeToast(el);
        onAction({ ...n.action });
      });
      el.appendChild(btn);
    }
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.textContent = '×';
    close.title = '닫기';
    close.addEventListener('click', () => removeToast(el));
    el.appendChild(close);

    host.appendChild(el);
    while (host.children.length > TOAST_MAX) removeToast(host.firstElementChild);
    arm(el, ms);
  }

  function closeModal() {
    if (!modal) return;
    modal.remove();
    modal = null;
    if (returnFocus && typeof returnFocus.focus === 'function' && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function showModal(n) {
    // 막는 오류가 겹치면 문구만 바꾼다 — 모달 위에 모달을 쌓지 않는다.
    if (modal) { modal.querySelector('.notice-modal-text').textContent = n.message; return; }
    returnFocus = doc.activeElement;
    modal = doc.createElement('div');
    modal.className = 'notice-modal-backdrop';
    const box = doc.createElement('div');
    box.className = 'notice-modal';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const text = doc.createElement('p');
    text.className = 'notice-modal-text';
    text.textContent = n.message;
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.className = 'notice-modal-ok';
    ok.textContent = '확인';
    ok.addEventListener('click', closeModal);
    box.append(text, ok);
    modal.appendChild(box);
    // ⚠ 모달이 떠 있는 동안 글쇠는 모달 것이다 — 보드 단축키로 새지 않게 여기서 멈춘다.
    modal.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); closeModal(); }
      if (e.key === 'Tab') { e.preventDefault(); ok.focus(); }
    });
    doc.body.appendChild(modal);
    ok.focus();
  }

  return {
    show(n) {
      if (!n || typeof n.message !== 'string') return;
      if (n.kind === 'block') showModal(n);
      else showToast(n);
    },
    dismissAll() {
      if (stack) [...stack.children].forEach(removeToast);
      closeModal();
    }
  };
}
