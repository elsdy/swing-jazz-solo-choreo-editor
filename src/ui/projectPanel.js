// src/ui/projectPanel.js — 왼쪽 사이드바 맨 위의 프로젝트 칸 (ui 계층)
//
// 신설 파일이다(2026-09-20). 그전에는 「프로젝트」가 앱바의 이름 입력칸 하나였다 — 지금 무엇을
// 보고 있는지, 이 안무에 영상이 몇 벌 달려 있는지, 그것이 언제 찍은 것인지 화면 어디에도 없었다.
//
// 이 칸이 답하는 것은 셋이다.
//   ① 지금 어떤 안무를 보고 있나         — 이름 한 줄
//   ② 그 안무에 영상이 몇 벌 쌓였나      — `영상 4벌 · 8월 2일 ~ 9월 12일`
//   ③ 그중 지금 보고 있는 것은 어느 것인가 — 날짜 순 목록에서 `▶ 지금`
//
// **한 프로젝트는 한 안무다.** 영상은 그 안무를 여러 번 찍은 것이고, 날짜를 달고 쌓이면 그
// 목록이 곧 "어떻게 좋아져 왔는가" 가 된다 — 숙련도를 따로 매기지 않아도 된다(그래서 안 매긴다).
//
// ⚠ 여기에만 있는 기능은 **영상 메타(날짜·메모)뿐**이다. 나머지(영상 고르기·이름 바꾸기·빼기)는
//   영상 패널 `① 영상 고르기` 와 같은 커맨드를 부른다 — 길을 하나 더 만든 것이 아니다.
// ⚠ 이름칸의 주인은 여전히 `#fileNameInput` 이다. 여기는 그 값을 비추고 되돌려줄 뿐이라,
//   두 군데가 각자 이름을 들고 있다가 어긋나는 일이 없다.

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   getProjectName: () => string,
 *   setProjectName: (name: string) => void,
 *   getClips: () => { activeId: string, clips: object[] },
 *   byProgress: (clips: object[]) => object[],
 *   summarize: (clips: object[]) => string,
 *   formatDate: (takenAt: string) => string,
 *   commands: {
 *     select: (id: string) => void,
 *     rename: (id: string, name: string) => void,
 *     setMeta: (id: string, patch: {takenAt?: string, note?: string}) => void,
 *     remove: (id: string) => void
 *   },
 *   openVideoPanel: () => void,
 *   confirmOnce: (btn: HTMLElement, label: string, run: () => void) => void,
 *   doc?: Document
 * }} options
 * @returns {{ render(): void }}
 */
export function createProjectPanel(options) {
  const {
    elements = {}, getProjectName, setProjectName, getClips, byProgress, summarize, formatDate,
    commands, openVideoPanel = () => {}, confirmOnce = (btn, label, run) => run(), doc = document
  } = options;
  const byId = (id) => (id in elements ? elements[id] : doc.getElementById(id));

  const root = byId('projectPanel');
  const nameEl = byId('projectName');
  const summaryEl = byId('projectSummary');
  const listEl = byId('projectClips');

  /** 지금 자세히 펼쳐 둔 영상 id. 한 번에 하나만 편다 — 넷을 다 펴면 목록이 아니라 양식이 된다. */
  let openId = '';

  function render() {
    if (!root) return;
    if (nameEl) {
      const name = (getProjectName() || '').trim();
      nameEl.textContent = name || '제목 없는 안무';
      nameEl.classList.toggle('is-untitled', !name);
    }
    const { activeId, clips } = getClips();
    if (summaryEl) summaryEl.textContent = summarize(clips);
    if (!listEl) return;

    listEl.textContent = '';
    for (const clip of byProgress(clips)) {
      listEl.appendChild(clipRow(clip, clip.id === activeId));
    }
    if (clips.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'project-empty';
      empty.textContent = '아직 영상이 없습니다. 영상을 열면 이 안무의 기록으로 여기에 쌓입니다.';
      listEl.appendChild(empty);
    }
  }

  /** 목록의 한 줄. 접혀 있을 때는 날짜·이름·상태만 보이고, 펴면 날짜·메모를 고친다. */
  function clipRow(clip, isActive) {
    const row = doc.createElement('div');
    row.className = 'project-clip' + (isActive ? ' is-active' : '');
    row.dataset.id = clip.id;

    const head = doc.createElement('button');
    head.className = 'project-clip-head';
    head.type = 'button';
    head.title = isActive ? '지금 보고 있는 영상입니다' : '이 영상으로 갈아탑니다';

    const when = doc.createElement('span');
    when.className = 'project-clip-when';
    when.textContent = formatDate(clip.takenAt) || '날짜 없음';
    if (!clip.takenAt) when.classList.add('is-unknown');

    const name = doc.createElement('span');
    name.className = 'project-clip-name';
    name.textContent = clip.name;

    head.append(when, name);
    if (isActive) {
      const now = doc.createElement('span');
      now.className = 'project-clip-now';
      now.textContent = '▶ 지금';
      head.appendChild(now);
    }
    // ⚠ 지금 보고 있는 것을 다시 누르면 **영상 패널을 연다**(갈아타기가 아니다). 폰에서는 패널이
    //   닫힌 채 시작하므로, 목록에서 지금 것을 눌렀는데 아무 일도 없으면 고장으로 보인다.
    head.onclick = () => { if (isActive) openVideoPanel(); else commands.select(clip.id); };
    row.appendChild(head);

    const meta = doc.createElement('div');
    meta.className = 'project-clip-meta';
    meta.appendChild(chip(clip.tempo && clip.tempo.bpm > 0 ? `박자 ${Math.round(clip.tempo.bpm)}` : '박자 —'));
    meta.appendChild(chip(`마커 ${(clip.markers || []).length}`));
    if (clip.note) {
      const note = doc.createElement('span');
      note.className = 'project-clip-note';
      note.textContent = clip.note;
      meta.appendChild(note);
    }
    const edit = doc.createElement('button');
    edit.className = 'ghost project-clip-edit';
    edit.type = 'button';
    edit.textContent = openId === clip.id ? '접기' : '✎';
    edit.title = '날짜·이름·메모를 고칩니다';
    edit.onclick = () => { openId = openId === clip.id ? '' : clip.id; render(); };
    meta.appendChild(edit);
    row.appendChild(meta);

    if (openId === clip.id) row.appendChild(editor(clip));
    return row;
  }

  function chip(text) {
    const el = doc.createElement('span');
    el.className = 'project-chip';
    el.textContent = text;
    return el;
  }

  /** 펼친 줄. 값이 바뀌었을 때만 커맨드를 부른다(커맨드가 스스로도 걸러 내지만 히스토리를 아낀다). */
  function editor(clip) {
    const box = doc.createElement('div');
    box.className = 'project-clip-editor';

    const dateRow = doc.createElement('label');
    dateRow.className = 'project-field';
    dateRow.append(fieldLabel('찍은 날'));
    const date = doc.createElement('input');
    date.type = 'date';
    date.value = clip.takenAt || '';
    // ⚠ `change` 다(`input` 이 아니다). 날짜 입력칸은 치는 중간마다 값을 뱉어서, `input` 으로
    //   받으면 `2026-0` 같은 중간 상태가 히스토리에 한 단계씩 쌓인다.
    date.onchange = () => commands.setMeta(clip.id, { takenAt: date.value });
    dateRow.appendChild(date);

    const nameRow = doc.createElement('label');
    nameRow.className = 'project-field';
    nameRow.append(fieldLabel('이름'));
    const name = doc.createElement('input');
    name.type = 'text';
    name.value = clip.name;
    name.placeholder = '공연본 · 3주차 연습';
    name.onchange = () => commands.rename(clip.id, name.value);
    nameRow.appendChild(name);

    const noteRow = doc.createElement('label');
    noteRow.className = 'project-field';
    noteRow.append(fieldLabel('메모'));
    const note = doc.createElement('input');
    note.type = 'text';
    note.value = clip.note || '';
    note.placeholder = '한 줄 — 무대가 어두움 · 앞쪽 8마디만';
    note.onchange = () => commands.setMeta(clip.id, { note: note.value });
    noteRow.appendChild(note);

    const actions = doc.createElement('div');
    actions.className = 'project-field';
    const del = doc.createElement('button');
    del.className = 'danger project-clip-del';
    del.type = 'button';
    del.textContent = '목록에서 빼기';
    del.title = '이 영상에 찍어 둔 박자와 마커가 함께 사라집니다. 보관 폴더의 파일은 그대로 남습니다';
    // ⚠ `confirm()` 이 아니라 confirmOnce 다 — 이 저장소의 확인 방식이고, 되돌리는 길은 Undo 하나다.
    del.onclick = () => confirmOnce(del, '목록에서 빼기', () => { openId = ''; commands.remove(clip.id); });
    actions.appendChild(del);

    box.append(dateRow, nameRow, noteRow, actions);
    return box;
  }

  function fieldLabel(text) {
    const el = doc.createElement('span');
    el.className = 'project-field-label';
    el.textContent = text;
    return el;
  }

  // 이름은 눌러서 고친다 — 앱바의 입력칸이 주인이고 여기는 그리로 보낸다.
  if (nameEl) {
    nameEl.onclick = () => {
      const input = byId('fileNameInput');
      if (!input) return;
      input.focus();
      if (input.select) input.select();
      if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' });
    };
  }
  const input = byId('fileNameInput');
  if (input) input.addEventListener('input', () => { if (nameEl) render(); });

  render();
  return { render };
}
