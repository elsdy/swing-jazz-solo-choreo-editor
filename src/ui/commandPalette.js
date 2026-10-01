// src/ui/commandPalette.js — 명령 팔레트(Ctrl+K)와 단축키 일람(?) (ui 계층, RM-09)
//
// 둘 다 명령 등록부(domain/commands)를 **읽기만** 하는 화면이다. 버튼이 89개라 무엇이 어디 있는지 배우기
// 어렵고, 단축키가 무엇인지는 설정 깊숙이 들어가야 보였다 — 이름을 몇 글자 쳐서 부르는 길과, 글쇠를 한 장으로
// 보는 길을 둔다.
//
// ⚠ 실행은 주입받는다(`run`). ui 는 input 을 import 하지 않고 실행의 주인은 app/main 의 COMMAND_RUNNERS 다.
// ⚠ 팔레트 안의 글쇠는 보드 단축키로 새지 않는다(keydown 을 여기서 멈춘다) — 검색창에 `B` 를 치는 순간
//   받아 적기 경계가 찍히면 안 된다(inlinePrompt 와 같은 규약).
// ⚠ 한 번에 하나만 뜬다. 하나를 열면 다른 하나는 닫힌다.
// ⚠ 열고 닫을 때 요소를 만들고 없앤다(hidden 을 토글하지 않는다) — 숨김을 이기는 display 규칙을 걱정할 일이 없다.

import { COMMANDS, commandById } from '../domain/commands.js';
import { HOTKEY_ACTIONS, eventKey, keysLabel } from '../domain/hotkeys.js';

/**
 * 검색어에 맞는 명령. 라벨 · 버튼 글자 · 설명 · id 에 **들어 있으면** 맞는다(띄어쓰기 · 대소문자 무시).
 * 라벨이 검색어로 시작하는 것을 앞에 둔다. 글자가 같으면 등록부의 차례다.
 * @param {string} query
 * @param {readonly import('../domain/commands.js').CommandDef[]} [list]
 * @returns {import('../domain/commands.js').CommandDef[]}
 */
export function matchCommands(query, list = COMMANDS) {
  const flat = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');
  const q = flat(query);
  const shown = list.filter(c => c.id !== 'palette');
  if (!q) return shown;
  const hits = [];
  shown.forEach((c, i) => {
    const label = flat(c.label);
    const hay = [label, flat(c.button), flat(c.hint), flat(c.id)].join(' ');
    if (!hay.includes(q)) return;
    hits.push({ c, i, rank: label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2 });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).map(h => h.c);
}

/**
 * @param {{
 *   run: (id: string) => void,
 *   keysOf: (id: string) => string[]|undefined,
 *   doc?: Document
 * }} deps
 *   run: 등록부의 명령 하나를 실행한다(app/main 의 runCommand). ⚠ 팔레트를 **닫은 뒤** 부른다 — 파일 창 같은 것이
 *   팔레트 위에 겹치지 않고, 포커스가 원래 자리로 돌아간 뒤에 명령이 돈다.
 *   keysOf: 지금 글쇠(설정에서 바꾼 것). 목록 · 일람이 그대로 적는다.
 * @returns {{ openPalette(): void, openSheet(): void, close(): void, isOpen(): boolean }}
 */
export function createCommandPalette(deps) {
  const { run, keysOf = () => undefined } = deps;
  const doc = deps.doc || document;

  /** @type {HTMLElement|null} */
  let layer = null;
  /** 연 순간 포커스를 쥐고 있던 요소 — 닫으면 돌려준다. */
  let returnFocus = null;

  const keysFor = (id) => {
    const cmd = commandById(id);
    const keys = keysOf(id);
    return Array.isArray(keys) ? keys : (cmd ? cmd.keys : []);
  };

  function close() {
    if (!layer) return;
    layer.remove();
    layer = null;
    if (returnFocus && returnFocus.isConnected && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  }

  /** 바탕을 깔고 그 위에 상자를 둔다. 바탕을 누르면 닫힌다. */
  function mount(boxClass, label) {
    close();
    returnFocus = doc.activeElement;
    layer = doc.createElement('div');
    layer.className = 'command-layer';
    layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(); });
    const box = doc.createElement('div');
    box.className = boxClass;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', label);
    layer.appendChild(box);
    doc.body.appendChild(layer);
    return box;
  }

  // ── 명령 팔레트 ────────────────────────────────────────────────────────────
  function openPalette() {
    const box = mount('command-palette', '명령 찾기');
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'command-palette-input';
    input.placeholder = '명령 이름을 몇 글자 — Enter 로 실행, Esc 로 닫기';
    input.setAttribute('aria-label', '명령 찾기');
    const list = doc.createElement('ul');
    list.className = 'command-palette-list';
    list.setAttribute('role', 'listbox');
    box.append(input, list);

    let items = [];
    let at = 0;

    const pick = (id) => {
      close();
      run(id);
    };

    function draw() {
      items = matchCommands(input.value);
      if (at >= items.length) at = Math.max(0, items.length - 1);
      list.textContent = '';
      if (!items.length) {
        const empty = doc.createElement('li');
        empty.className = 'command-palette-empty';
        empty.textContent = '맞는 명령이 없습니다.';
        list.appendChild(empty);
        return;
      }
      items.forEach((c, i) => {
        const li = doc.createElement('li');
        li.className = 'command-palette-item' + (i === at ? ' is-on' : '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === at ? 'true' : 'false');
        li.dataset.id = c.id;
        const main = doc.createElement('span');
        main.className = 'command-palette-main';
        const name = doc.createElement('b');
        name.textContent = c.label;
        const hint = doc.createElement('small');
        hint.textContent = c.hint;
        main.append(name, hint);
        li.appendChild(main);
        const keys = keysFor(c.id);
        if (keys.length) {
          const cap = doc.createElement('span');
          cap.className = 'command-palette-keys';
          cap.textContent = keysLabel(keys);
          li.appendChild(cap);
        }
        // ⚠ mousedown 에서 막는다 — 그래야 검색창이 포커스를 잃지 않고, 누름(click)이 한 번만 돈다.
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => pick(c.id));
        list.appendChild(li);
      });
      const on = list.children[at];
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', () => { at = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      // 보드 단축키로 새지 않는다(머리 주석).
      e.stopPropagation();
      // ⚠ 한글을 조합하는 중의 Enter 는 글자를 확정하는 글쇠다 — 거기서 실행하면 「영상」을 치고 Enter 로
      //   확정하는 순간 맨 위 명령이 돈다. 조합이 끝난 뒤의 Enter 만 실행이다.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) at = (at + 1) % items.length; draw(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) at = (at - 1 + items.length) % items.length; draw(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (items[at]) pick(items[at].id);
        return;
      }
      // 열어 둔 채 여는 글쇠를 다시 누르면 닫는다(Ctrl+K 두 번). 설정에서 바꾼 글쇠를 따른다.
      if (keysFor('palette').includes(eventKey(e))) { e.preventDefault(); close(); }
    });

    draw();
    input.focus();
  }

  // ── 단축키 일람 ────────────────────────────────────────────────────────────
  function openSheet() {
    const box = mount('shortcut-sheet', '단축키 일람');
    box.tabIndex = -1;
    const head = doc.createElement('div');
    head.className = 'shortcut-sheet-head';
    const title = doc.createElement('b');
    title.textContent = '단축키 일람';
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ghost';
    closeBtn.textContent = '✕ 닫기';
    closeBtn.onclick = close;
    head.append(title, closeBtn);

    const table = doc.createElement('dl');
    table.className = 'shortcut-sheet-list';
    for (const a of HOTKEY_ACTIONS) {
      const dt = doc.createElement('dt');
      dt.textContent = keysLabel(keysFor(a.id));
      const dd = doc.createElement('dd');
      const name = doc.createElement('b');
      name.textContent = a.label;
      const hint = doc.createElement('small');
      hint.textContent = a.fixed ? `${a.hint} · 고정` : a.hint;
      dd.append(name, hint);
      table.append(dt, dd);
    }

    const foot = doc.createElement('div');
    foot.className = 'shortcut-sheet-foot';
    const note = doc.createElement('small');
    note.textContent = '글자를 치는 중(이름칸 · 검색창)에는 홑글쇠가 먹지 않습니다. 글쇠는 설정에서 바꿉니다.';
    const toSettings = doc.createElement('button');
    toSettings.type = 'button';
    toSettings.className = 'ghost';
    toSettings.textContent = '단축키 바꾸기';
    toSettings.onclick = () => { close(); run('openSettings'); };
    foot.append(note, toSettings);

    box.append(head, table, foot);
    // ⚠ 일람이 떠 있는 동안 글쇠는 일람의 것이다 — Esc · 같은 글쇠로 닫고, 나머지는 보드로 새지 않는다.
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || keysFor('shortcuts').includes(eventKey(e))) { e.preventDefault(); close(); }
    });
    box.focus();
  }

  return { openPalette, openSheet, close, isOpen: () => !!layer };
}
