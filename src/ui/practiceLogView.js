// src/ui/practiceLogView.js — 사이드바 프로젝트 칸의 「연습 기록」 목록과 한 줄 편집기 (ui 계층, RM-29 · 2026-11-03)
//
// 연습한 날마다 한 줄이 쌓인다 — 날짜 · 판본 · 구간 · 속도 · 깨끗/시도 · 별점 · 걸린 자리 · 메모, 그리고 그날 찍은 테이크.
// 영상 목록(ui/projectPanel)의 짝이다: 영상 목록이 「언제 무엇을 찍었나」라면 이것은 「그날 어떻게 했나」다.
//
// ⚠ 편집기는 **초안**을 든다 — `기록 적기` 를 눌러야 store 에 쌓인다. 칸마다 바로 쓰지 않는 까닭은, 구간 칸처럼 치는 중간
//   글자(`8x`)가 손상된 값으로 접혀 저장되면 안 되기 때문이다(영상 줄의 날짜 칸이 `change` 로 받는 것과 같은 걱정).
// ⚠ 기록은 되돌리기를 타지 않는다 — 삭제는 confirmOnce 로 묻고, 낱말도 「삭제」다(docs/GLOSSARY.md).
// ⚠ 글자는 domain/strings 의 표가 주인이다(str · fill).

import { str } from '../domain/strings.js';

import { iconLabel } from './icon.js';
import { PRACTICE_RATES } from '../domain/practice.js';
import { parseScope, scopeLabel, practiceLogParts, RATING_MAX } from '../domain/project/versions.js';

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   getLogs: () => object[],
 *   getContext: () => { cols: number, versions: {id:string,label:string}[], clips: {id:string,name:string}[] },
 *   formatDate: (at: string) => string,
 *   commands: { draft: () => object, save: (log: object) => void, remove: (id: string) => void },
 *   confirmOnce?: (btn: HTMLElement, label: string, run: () => void) => void,
 *   doc?: Document
 * }} options
 * @returns {{ render(): void, openDraft(log: object): void }}
 */
// @complexity time=O(n) space=O(n) cc=3
export function createPracticeLogView(options) {
  const {
    elements = {}, getLogs, getContext, formatDate, commands,
    confirmOnce = (btn, label, run) => run(), doc = document
  } = options;
  const byId = (id) => (id in elements ? elements[id] : doc.getElementById(id));
  const root = byId('practiceLogs');

  /** 지금 편집 중인 초안(새 줄이거나 고치는 줄의 사본). 없으면 null — 한 번에 하나만 편다. */
  let draft = null;

  // @complexity time=O(n) space=O(n) cc=5
  function render() {
    if (!root) return;
    const logs = getLogs();
    const ctx = getContext();
    root.textContent = '';

    const head = doc.createElement('div');
    head.className = 'project-sub-head';
    const title = doc.createElement('span');
    title.className = 'project-sub-title';
    title.textContent = str('log.head');
    const add = doc.createElement('button');
    add.className = 'ghost project-sub-add';
    add.type = 'button';
    iconLabel(add, 'plus', str('log.add'), doc);
    add.title = str('log.add.title');
    add.onclick = () => openDraft(commands.draft());
    head.append(title, add);
    root.appendChild(head);

    // 새 줄의 초안은 목록 맨 위에 편다 — 고치는 줄은 그 자리에서 편다
    const isNew = draft && !logs.some(l => l.id === draft.id);
    if (isNew) root.appendChild(editor(draft, ctx, true));

    const list = doc.createElement('div');
    list.className = 'project-clips';
    for (const log of logs) {
      list.appendChild(draft && draft.id === log.id ? editor(draft, ctx, false) : row(log, ctx));
    }
    root.appendChild(list);
    if (logs.length === 0 && !isNew) {
      const empty = doc.createElement('div');
      empty.className = 'project-empty';
      empty.textContent = str('log.empty');
      root.appendChild(empty);
    }
  }

  /** 접힌 한 줄 — 날짜와 말 조각들. 누르면 그 자리에서 편다. */
  // @complexity time=O(1) space=O(1) cc=5
  function row(log, ctx) {
    const box = doc.createElement('div');
    box.className = 'project-clip project-log';
    box.dataset.id = log.id;
    const head = doc.createElement('button');
    head.className = 'project-clip-head';
    head.type = 'button';
    head.title = str('log.edit.title');
    const when = doc.createElement('span');
    when.className = 'project-clip-when';
    when.textContent = formatDate(log.at) || str('log.noDate');
    if (!log.at) when.classList.add('is-unknown');
    const version = log.versionId ? ctx.versions.find(v => v.id === log.versionId) : null;
    const clip = log.clipId ? ctx.clips.find(c => c.id === log.clipId) : null;
    const parts = practiceLogParts(log, {
      cols: ctx.cols,
      versionLabel: version ? version.label : (log.versionId ? str('log.versionGone') : ''),
      clipName: clip ? clip.name : ''
    });
    const text = doc.createElement('span');
    text.className = 'project-clip-name project-log-text';
    text.textContent = parts.join(' · ') || str('log.none');
    head.append(when, text);
    head.onclick = () => { draft = { ...log }; render(); };
    box.appendChild(head);
    if (log.note) {
      const note = doc.createElement('div');
      note.className = 'project-clip-note';
      note.textContent = log.note;
      box.appendChild(note);
    }
    return box;
  }

  /** 펼친 한 줄 — 초안을 고친다. `기록 적기` 를 눌러야 쌓인다. */
  // @complexity time=O(n) space=O(n) cc=6
  function editor(cur, ctx, isNew) {
    const box = doc.createElement('div');
    box.className = 'project-clip project-log is-active';
    const form = doc.createElement('div');
    form.className = 'project-clip-editor project-log-editor';

    const date = input('date', cur.at || '');
    const version = select([['', str('log.none')], ...ctx.versions.map(v => [v.id, v.label])], cur.versionId);
    const clip = select([['', str('log.none')], ...ctx.clips.map(c => [c.id, c.name])], cur.clipId);
    const scope = input('text', scopeLabel(cur.scope, ctx.cols), str('log.scope.placeholder'));
    const bpm = input('number', cur.bpm === null ? '' : String(cur.bpm), str('log.bpm.placeholder'));
    bpm.min = '1'; bpm.step = '1'; bpm.inputMode = 'numeric';
    const rate = select([['', str('log.none')], ...PRACTICE_RATES.map(r => [String(r), `${r}배`])],
      cur.rate === null ? '' : String(cur.rate));
    const clean = input('number', cur.cleanRuns === null ? '' : String(cur.cleanRuns));
    const attempts = input('number', cur.attempts === null ? '' : String(cur.attempts));
    for (const el of [clean, attempts]) { el.min = '0'; el.step = '1'; el.inputMode = 'numeric'; }
    const stars = [];
    for (let n = 1; n <= RATING_MAX; n++) stars.push([String(n), '★'.repeat(n)]);
    const rating = select([['', str('log.none')], ...stars], cur.rating === null ? '' : String(cur.rating));
    const trouble = input('text', cur.trouble || '', str('log.trouble.placeholder'));
    const note = input('text', cur.note || '', str('log.note.placeholder'));

    const error = doc.createElement('div');
    error.className = 'project-log-error';
    error.hidden = true;

    form.append(
      field(str('log.field.date'), date),
      field(str('log.field.version'), version),
      field(str('log.field.clip'), clip),
      field(str('log.field.scope'), scope),
      field(str('log.field.speed'), bpm, rate),
      field(str('log.field.runs'), clean, attempts),
      field(str('log.field.rating'), rating),
      field(str('log.field.trouble'), trouble),
      field(str('log.field.note'), note),
      error
    );

    const actions = doc.createElement('div');
    actions.className = 'project-field project-log-actions';
    const save = doc.createElement('button');
    save.type = 'button';
    save.className = 'primary';
    save.textContent = str('log.save');
    save.onclick = () => {
      const read = parseScope(scope.value, ctx.cols);
      if (!read.ok) { error.textContent = str('log.scope.bad'); error.hidden = false; scope.focus(); return; }
      const log = {
        id: cur.id, at: date.value, versionId: version.value, clipId: clip.value, scope: read.scope,
        bpm: bpm.value, rate: rate.value, attempts: attempts.value, cleanRuns: clean.value,
        rating: rating.value, trouble: trouble.value, note: note.value
      };
      draft = null;
      commands.save(log);
    };
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost';
    cancel.textContent = str('log.cancel');
    cancel.onclick = () => { draft = null; render(); };
    actions.append(save, cancel);
    if (!isNew) {
      const del = doc.createElement('button');
      del.type = 'button';
      del.className = 'danger project-log-del';
      del.textContent = str('log.delete');
      del.title = str('log.delete.title');
      // ⚠ 되돌릴 수 없으니 confirmOnce — `정말요?` 로 2초 바뀐 뒤 한 번 더 눌러야 지운다
      del.onclick = () => confirmOnce(del, str('log.delete'), () => { draft = null; commands.remove(cur.id); });
      actions.appendChild(del);
    }
    form.appendChild(actions);
    box.appendChild(form);
    return box;
  }

  // @complexity time=O(1) space=O(1) cc=2
  function input(type, value, placeholder = '') {
    const el = doc.createElement('input');
    el.type = type;
    el.value = value;
    if (placeholder) el.placeholder = placeholder;
    return el;
  }

  // @complexity time=O(n) space=O(n) cc=2
  function select(pairs, value) {
    const el = doc.createElement('select');
    for (const [v, text] of pairs) {
      const opt = doc.createElement('option');
      opt.value = v;
      opt.textContent = text;
      el.appendChild(opt);
    }
    // 가리키는 판본 · 영상을 지웠으면 목록에 없다 — 그 id 를 잃지 않게 한 줄을 더해 둔다(dangling 허용)
    if (value && !pairs.some(([v]) => v === value)) {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = str('log.versionGone');
      el.appendChild(opt);
    }
    el.value = value || '';
    return el;
  }

  // @complexity time=O(1) space=O(1) cc=1
  function field(label, ...controls) {
    const row = doc.createElement('label');
    row.className = 'project-field';
    const name = doc.createElement('span');
    name.className = 'project-field-label';
    name.textContent = label;
    row.append(name, ...controls);
    return row;
  }

  /** 초안 하나로 편집기를 연다(「이 테이크 기록」 · `기록 더하기`). */
  // @complexity time=O(n) space=O(n) cc=1
  function openDraft(log) {
    draft = { ...log };
    render();
    if (root && typeof root.scrollIntoView === 'function') root.scrollIntoView({ block: 'nearest' });
  }

  render();
  return { render, openDraft };
}
