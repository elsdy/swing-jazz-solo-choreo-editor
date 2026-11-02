// src/ui/versionListView.js — 사이드바 프로젝트 칸의 「판본」 목록 (ui 계층, RM-29 · 2026-11-03)
//
// 한 안무의 A안 · B안 · 공연본을 이름 붙여 떠 두고, 고른 판으로 돌아간다. 줄마다 이름 · 뜬 날 · 마디와 블록 수 ·
// 부모(어느 판에서 갈라졌나)가 보이고, 지금 안무표가 갈라져 나온 판에는 `◆ 지금 이 판에서` 가 붙는다.
//
// ⚠ 목록에는 판본 **요약**만 온다(domain versionSummaries) — 본문(안무표 통째)은 열 때만 쓴다.
// ⚠ `이 판 열기` 는 되돌리기 한 단계로 물릴 수 있지만, 지금 안무표가 어느 판본에도 없으면 confirmOnce 로 한 번 더 묻는다
//   (열면 지금 것이 안무표에서 사라지기 때문이다). 판본 삭제는 되돌릴 수 없어 늘 묻는다 — 낱말도 「삭제」다.
// ⚠ 글자는 domain/strings 의 표가 주인이다(str · fill).

import { str, fill } from '../domain/strings.js';

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   getVersions: () => {id:string,label:string,note:string,parentId:string|null,createdAt:string,bars:number,blocks:number}[],
 *   getBase: () => string,
 *   isKept: () => boolean,
 *   formatDate: (createdAt: string) => string,  ISO 시각을 받아 지역 날짜의 말로(app/main 이 시계를 안다)
 *   commands: {
 *     snapshot: () => void,
 *     open: (id: string) => void,
 *     edit: (id: string, patch: {label?: string, note?: string}) => void,
 *     remove: (id: string) => void
 *   },
 *   confirmOnce?: (btn: HTMLElement, label: string, run: () => void) => void,
 *   doc?: Document
 * }} options
 * @returns {{ render(): void }}
 */
// @complexity time=O(n) space=O(n) cc=3
export function createVersionListView(options) {
  const {
    elements = {}, getVersions, getBase, isKept, formatDate, commands,
    confirmOnce = (btn, label, run) => run(), doc = document
  } = options;
  const byId = (id) => (id in elements ? elements[id] : doc.getElementById(id));
  const root = byId('projectVersions');

  /** 지금 이름 · 메모를 펼쳐 둔 판본 id. 한 번에 하나만 편다. */
  let openId = '';

  // @complexity time=O(n) space=O(n) cc=4
  function render() {
    if (!root) return;
    const versions = getVersions();
    const base = getBase();
    const labels = new Map(versions.map(v => [v.id, v.label]));
    root.textContent = '';

    const head = doc.createElement('div');
    head.className = 'project-sub-head';
    const title = doc.createElement('span');
    title.className = 'project-sub-title';
    title.textContent = str('version.head');
    const add = doc.createElement('button');
    add.className = 'ghost project-sub-add';
    add.type = 'button';
    add.textContent = str('version.snapshot');
    add.title = str('version.snapshot.title');
    add.onclick = () => commands.snapshot();
    head.append(title, add);
    root.appendChild(head);

    const list = doc.createElement('div');
    list.className = 'project-clips';
    for (const v of versions) list.appendChild(row(v, v.id === base, labels));
    root.appendChild(list);
    if (versions.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'project-empty';
      empty.textContent = str('version.empty');
      root.appendChild(empty);
    }
  }

  // @complexity time=O(1) space=O(1) cc=6
  function row(v, isBase, labels) {
    const box = doc.createElement('div');
    box.className = 'project-clip project-version' + (isBase ? ' is-active' : '');
    box.dataset.id = v.id;

    const head = doc.createElement('div');
    head.className = 'project-clip-head project-version-head';
    const when = doc.createElement('span');
    when.className = 'project-clip-when';
    when.textContent = formatDate(v.createdAt || '');   // ISO 시각 그대로 — 지역 날로 바꾸는 것은 부르는 쪽(app)이다
    const name = doc.createElement('span');
    name.className = 'project-clip-name';
    name.textContent = v.label;
    head.append(when, name);
    if (isBase) {
      const now = doc.createElement('span');
      now.className = 'project-clip-now';
      now.textContent = str('version.base');
      now.title = str('version.base.title');
      head.appendChild(now);
    }
    box.appendChild(head);

    const meta = doc.createElement('div');
    meta.className = 'project-clip-meta';
    meta.appendChild(chip(fill('version.counts', { bars: v.bars, blocks: v.blocks })));
    if (v.parentId) {
      const parent = labels.get(v.parentId);
      meta.appendChild(chip(parent ? fill('version.parent', { label: parent }) : str('version.parent.gone')));
    }
    if (v.note) {
      const note = doc.createElement('span');
      note.className = 'project-clip-note';
      note.textContent = v.note;
      meta.appendChild(note);
    }
    const open = doc.createElement('button');
    open.className = 'ghost project-version-open';
    open.type = 'button';
    open.textContent = str('version.open');
    open.title = str('version.open.title');
    open.onclick = () => {
      // 지금 것이 판본에 남아 있으면 바로 연다 — 아니면 `정말요?` 로 한 번 더 묻는다
      if (isKept()) { commands.open(v.id); return; }
      open.title = str('version.open.unkept.title');
      confirmOnce(open, str('version.open'), () => commands.open(v.id));
    };
    meta.appendChild(open);
    const edit = doc.createElement('button');
    edit.className = 'ghost project-clip-edit';
    edit.type = 'button';
    edit.textContent = '✎';
    edit.title = str('version.edit.title');
    edit.onclick = () => { openId = openId === v.id ? '' : v.id; render(); };
    meta.appendChild(edit);
    box.appendChild(meta);

    if (openId === v.id) box.appendChild(editor(v));
    return box;
  }

  // @complexity time=O(1) space=O(1) cc=1
  function chip(text) {
    const el = doc.createElement('span');
    el.className = 'project-chip';
    el.textContent = text;
    return el;
  }

  /** 펼친 줄 — 이름 · 메모. 값이 바뀌었을 때만 부른다(`change`). */
  // @complexity time=O(1) space=O(1) cc=1
  function editor(v) {
    const box = doc.createElement('div');
    box.className = 'project-clip-editor';
    const name = textField(str('version.field.name'), v.label, str('version.name.placeholder'),
      (value) => commands.edit(v.id, { label: value }));
    const note = textField(str('version.field.note'), v.note || '', str('version.note.placeholder'),
      (value) => commands.edit(v.id, { note: value }));
    const actions = doc.createElement('div');
    actions.className = 'project-field';
    const del = doc.createElement('button');
    del.className = 'danger project-clip-del';
    del.type = 'button';
    del.textContent = str('version.delete');
    del.title = str('version.delete.title');
    del.onclick = () => confirmOnce(del, str('version.delete'), () => { openId = ''; commands.remove(v.id); });
    actions.appendChild(del);
    box.append(name, note, actions);
    return box;
  }

  // @complexity time=O(1) space=O(1) cc=1
  function textField(label, value, placeholder, onChange) {
    const row = doc.createElement('label');
    row.className = 'project-field';
    const name = doc.createElement('span');
    name.className = 'project-field-label';
    name.textContent = label;
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.onchange = () => onChange(input.value);
    row.append(name, input);
    return row;
  }

  render();
  return { render };
}
