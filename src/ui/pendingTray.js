// src/ui/pendingTray.js — `?` 정리함의 목록 화면 (ui 계층, RM-24 · 2026-11-03)
//
// 영상 패널 ③ 받아 적기 안에 뜨는 「이름 붙일 것 N개」 목록이다. 줄 하나가 이름 없는 블록 하나(표 위 차례)이고,
//   [8x3·1 · 4카운트] [↑ 와 같음] [박자가 없어 재생 못 함]            ← 줄마다
//   [이름 적기] [갈래 ▾]                                              ← 지금 고른 줄에만
// 줄을 누르면 안무표에서 그 블록이 골라지고 영상이 그 대목을 마디 반복으로 되풀이하며, 그 줄 위에 이름 입력(askName,
// RM-15 의 추천 목록 · Tab)이 뜬다. 붙이면 다음 `?` 로 넘어가 같은 일을 되풀이한다.
//
// ⚠ 명령은 모른다 — app/main 이 usecases/pendingTrayCommands 를 store 에 묶어 `commands` 로 넘긴다(ui 는 usecases 를 import 하지 않는다).
// ⚠ 이름을 한 번 붙일 때마다 commitHistory 를 한 번 부른다 — 같은 모양의 무리에 함께 붙어도 되돌리기는 한 단계다.
// ⚠ 줄은 **바뀌었을 때만** 다시 만든다(서명). 이름 입력은 가리키던 단추가 떨어져 나가면 닫히므로(askName 의 'gone'),
//   LLM 이 앞 블록 이름을 늦게 고쳐 끼우는 렌더처럼 줄과 무관한 렌더가 적던 이름을 날리면 안 된다.

import { CLS, DATA, SEL } from './domContract.js';
import { askName } from './inlinePrompt.js';
import { fill, str } from '../domain/strings.js';

/**
 * @typedef {object} PendingTrayDeps
 * @property {(dirty: any) => void} render
 * @property {() => void} commitHistory              되돌리기 한 단계를 쌓는다
 * @property {(query: string) => Array<{name:string, category?:string}>} suggest 이름 입력의 추천(domain/moveMatch.suggestMoves)
 * @property {(text: string) => void} notify          참고 알림 한 줄(다 채웠다)
 * @property {(groupId: string, picked: any) => void} [onPicked] 줄을 골랐다 — 조립부가 영상을 그 대목으로 옮기고 블록을 보인다
 * @property {() => void} [onClosed]                  닫았다 — 조립부가 마이크를 끈다
 * @property {(heard: any) => void} [onHeard]          말로 붙였다 — 조립부가 LLM 줄에 세운다
 * @property {{
 *   state: () => {open:boolean, groupId:string|null, category:string},
 *   queue: () => Array<{groupId:string, place:string, count:number, key:string, row:number, startIndex:number}>,
 *   tempoReady: () => boolean,
 *   categories: () => Array<{key:string, label:string}>,
 *   selectedPending: () => string|null,
 *   open: () => any, close: () => any,
 *   pick: (args: {groupId:string}) => any,
 *   name: (args: {groupId:string, label:string, category:string}) => any,
 *   hear: (args: {groupId:string, text:string}) => any,
 *   setCategory: (args: {category:string}) => any
 * }} commands
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * @param {PendingTrayDeps} deps
 * @returns {{ render(): void, open(): void, close(): void, hear(text: string): boolean, isOpen(): boolean }}
 */
// @complexity time=O(1) space=O(1) cc=1
export function createPendingTray(deps) {
  const {
    render, commitHistory, suggest, notify,
    onPicked = () => {}, onClosed = () => {}, onHeard = () => {},
    commands, elements = {}
  } = deps;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const tray = byId('videoPendingTray');
  const title = byId('videoPendingTitle');
  const basis = byId('videoPendingBasis');
  const list = byId('videoPendingList');
  const help = byId('videoPendingHelp');
  const closeBtn = byId('videoPendingCloseBtn');

  /** 마지막으로 그린 줄의 서명. 같으면 다시 만들지 않는다(이름 입력이 가리키는 단추를 살린다). */
  let listSig = null;
  /** 그린 줄의 자리(행 · 칸). 방금 이름을 붙여 목록에서 빠진 줄의 이웃을 찾을 때 쓴다. */
  /** @type {Map<string, {row:number, startIndex:number}>} */
  const lastPlace = new Map();

  /** Dirty 에 얹힌 알림용 값을 떼어 낸다 — render 는 Dirty 의 키만 받는다(assertDirty). */
  // @complexity time=O(1) space=O(1) cc=2
  const split = (res) => {
    const { picked, looped, noTempo, range, named, next, done, category, created, name, heard, needsLlm, groupId, groupIds, ...dirty } = res || {};
    return { dirty, info: { picked, looped, noTempo, range, named, next, done, category, created, name, heard, needsLlm, groupId, groupIds } };
  };

  // ── 그리기 ────────────────────────────────────────────────────────────────

  /** 줄 하나. 지금 고른 줄이면 이름 단추와 갈래 고르기가 붙는다. */
  // @complexity time=O(c) space=O(c) cc=6
  function rowEl(doc, r, ctx) {
    const li = doc.createElement('li');
    li.className = CLS.pendingRow + (r.groupId === ctx.current ? ` ${CLS.isCurrent}` : '');
    li.dataset[DATA.groupId] = r.groupId;
    const pick = doc.createElement('button');
    pick.type = 'button';
    pick.className = `ghost ${CLS.pendingRowPick}`;
    pick.textContent = `${r.place} · ${fill('tray.count', { n: r.count })}`;
    pick.onclick = () => pickRow(r.groupId);
    li.appendChild(pick);
    const head = ctx.heads.get(r.key);
    if (head && head.groupId !== r.groupId) {
      const same = doc.createElement('span');
      same.className = CLS.pendingRowSame;
      same.textContent = str('tray.same');
      same.title = fill('tray.same.title', { place: head.place });
      li.appendChild(same);
    }
    if (!ctx.tempo) {
      const note = doc.createElement('span');
      note.className = CLS.pendingRowNote;
      note.textContent = str('tray.noTempo');
      li.appendChild(note);
    }
    if (r.groupId !== ctx.current) return li;
    const nameBtn = doc.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = `ghost accent ${CLS.pendingRowName}`;
    nameBtn.textContent = str('tray.name');
    nameBtn.onclick = () => askFor(r.groupId);
    const cat = doc.createElement('select');
    cat.className = CLS.pendingRowCat;
    cat.title = str('tray.category');
    cat.setAttribute('aria-label', str('tray.category'));
    for (const c of ctx.categories) {
      const opt = doc.createElement('option');
      opt.value = c.key;
      opt.textContent = c.label;
      cat.appendChild(opt);
    }
    cat.value = ctx.category;
    // 갈래를 고르면 이름 입력이 닫혔으므로(바깥을 눌렀다) 다시 연다 — 갈래를 먼저 고르고 이름을 치는 손을 끊지 않는다.
    cat.onchange = () => { render(commands.setCategory({ category: cat.value })); askFor(r.groupId); };
    li.append(nameBtn, cat);
    return li;
  }

  /** 열려 있으면 줄을, 아니면 감춘다. 줄은 서명이 바뀌었을 때만 다시 만든다. */
  // @complexity time=O(n) space=O(n) cc=8
  function renderTray() {
    if (!tray) return;
    const state = commands.state();
    tray.hidden = !state.open;
    if (!state.open) { listSig = null; return; }
    const queue = commands.queue();
    const tempo = commands.tempoReady();
    if (title) title.textContent = fill('tray.title', { n: queue.length });
    if (basis) basis.textContent = tempo ? str('tray.basis') : str('tray.noTempo');
    if (help) help.textContent = queue.length ? str('tray.hint') : str('tray.empty');
    if (!list) return;
    const categories = commands.categories();
    const sig = JSON.stringify([queue.map(r => [r.groupId, r.key, r.place]), state.groupId, tempo, categories.map(c => c.key)]);
    const select = list.querySelector(`.${CLS.pendingRowCat}`);
    if (sig === listSig) {
      if (select && select.value !== state.category) select.value = state.category;   // 갈래만 바뀌었다 — 줄은 그대로
      return;
    }
    listSig = sig;
    const heads = new Map();
    for (const r of queue) {
      if (!heads.has(r.key)) heads.set(r.key, r);
      lastPlace.set(r.groupId, { row: r.row, startIndex: r.startIndex });
    }
    const doc = list.ownerDocument;
    list.innerHTML = '';
    const ctx = { current: state.groupId, heads, tempo, categories, category: state.category };
    for (const r of queue) list.appendChild(rowEl(doc, r, ctx));
  }

  // ── 손짓 ──────────────────────────────────────────────────────────────────

  /** 줄을 고른다 — 선택 · 마디 반복을 옮기고, 줄을 다시 그린 뒤 그 줄 위에 이름 입력을 연다. */
  // @complexity time=O(n) space=O(n) cc=3
  function pickRow(groupId, { ask = true } = {}) {
    const { dirty, info } = split(commands.pick({ groupId }));
    render(dirty);
    renderTray();
    if (!info.picked) return;
    onPicked(groupId, info);
    const el = list && list.querySelector(SEL.pendingRowOf(groupId));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    if (ask) askFor(groupId);
  }

  /** 지금 줄 위에 이름 입력을 연다. Enter · Tab · 추천 고르기 · 바깥 누르기로 붙이고, 빈 Tab 은 붙이지 않고 다음으로 넘어간다. */
  // @complexity time=O(1) space=O(1) cc=8
  function askFor(groupId) {
    const anchor = list && list.querySelector(`${SEL.pendingRowOf(groupId)} ${SEL.pendingRowName}`);
    askName({ anchor, title: str('tray.name.title'), value: '', suggest }).then(({ value, via }) => {
      if (via === 'escape' || via === 'gone' || value == null) return;
      const text = String(value).trim();
      if (text) { nameRow(groupId, text, via); return; }
      if (via === 'tab' || via === 'shift-tab') stepFrom(groupId, via === 'tab' ? 1 : -1);   // 빈 Tab — 이 줄은 건너뛴다
    });
  }

  /** 붙인다 — 한 단계 커밋하고, 다음 `?` 로 넘어간다. 다 채웠으면 알린다. */
  // @complexity time=O(n) space=O(n) cc=5
  function nameRow(groupId, label, via) {
    const { dirty, info } = split(commands.name({ groupId, label, category: commands.state().category }));
    render(dirty);
    if (!info.named) return;
    commitHistory();
    renderTray();
    if (info.done) { notify(str('tray.done')); return; }
    if (via === 'shift-tab') { stepFrom(groupId, -1); return; }
    if (info.next) pickRow(info.next);
  }

  /**
   * 표 위 차례로 이 줄의 앞(-1) · 뒤(+1) 줄로 간다. 끝이면 반대쪽 끝으로 돈다.
   * ⚠ 방금 이름을 붙인 줄은 목록에서 빠졌으므로 **자리**로 이웃을 찾는다 — 차례 번호로 찾으면 맨 앞으로 튄다.
   */
  // @complexity time=O(n) space=O(n) cc=7
  function stepFrom(groupId, dir) {
    const queue = commands.queue();
    if (!queue.length) return;
    const here = queue.find(r => r.groupId === groupId) || lastPlace.get(groupId);
    const order = (a) => (here ? (a.row - here.row) || (a.startIndex - here.startIndex) : 0);
    const others = queue.filter(r => r.groupId !== groupId);
    if (!others.length) { pickRow(queue[0].groupId); return; }
    const ahead = dir > 0 ? others.filter(r => order(r) > 0) : others.filter(r => order(r) < 0).reverse();
    const target = ahead[0] || (dir > 0 ? others[0] : others[others.length - 1]);
    pickRow(target.groupId);
  }

  if (closeBtn) closeBtn.onclick = () => close();

  /** 닫는다 — 마디 반복을 열 때로 되돌리고(명령) 마이크를 끈다(조립부). */
  // @complexity time=O(1) space=O(1) cc=1
  function close() {
    render(commands.close());
    renderTray();
    onClosed();
  }

  return {
    render: renderTray,
    isOpen: () => commands.state().open,
    /** 연다 — 안무표에서 고른 `?` 가 있으면 그 줄부터, 없으면 맨 앞 줄부터. ③ 받아 적기 칸이 접혀 있으면 편다. */
    // @complexity time=O(n) space=O(n) cc=5
    open() {
      render(commands.open());
      renderTray();
      const step = tray && typeof tray.closest === 'function' ? tray.closest('details') : null;
      if (step && !step.open) step.open = true;
      const queue = commands.queue();
      if (!queue.length) return;
      const chosen = commands.selectedPending();
      pickRow(chosen && queue.some(r => r.groupId === chosen) ? chosen : queue[0].groupId);
    },
    close,
    /**
     * 들은 한마디 — 지금 고른 줄에 붙인다(받아 적는 중이면 명령이 물러서 거짓). 붙였으면 한 단계 커밋하고 다음으로 간다.
     * @param {string} text
     * @returns {boolean} 붙였는가 — 거짓이면 조립부가 받아 적기 쪽(hearUtterance)으로 보낸다
     */
    // @complexity time=O(n) space=O(n) cc=4
    hear(text) {
      const state = commands.state();
      if (!state.open || !state.groupId) return false;
      const { dirty, info } = split(commands.hear({ groupId: state.groupId, text }));
      if (!info.named) return false;
      render(dirty);
      commitHistory();
      onHeard(info);
      renderTray();
      const queue = commands.queue();
      if (!queue.length) { notify(str('tray.done')); return true; }
      stepFrom(state.groupId, 1);
      return true;
    }
  };
}
