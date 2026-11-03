// src/ui/poseView.js — 영상 패널의 `자세 분석` 구획 (ui 계층)
//
// 신설 파일이다(2026-09-12). 마크업은 index.html 의 `.video-pose-section` 이고 이 파일은 그것을 읽고 묶는다
// (videoPanel.js 가 이미 크므로 구획 하나를 따로 뗐다 — 둘은 서로 import 하지 않고 app/main.js 가 붙인다).
//
// ⚠ 경계 ① — **그림은 여기서 그리지 않는다.** 영상 위 관절·몸은 ui/poseOverlay.js 의 rAF 루프가
//   자기 캔버스에만 그린다(채널 B). 여기는 버튼과 문구뿐이다.
//
// ⚠ 경계 ② — **히스토리를 건드리지 않는다.** 분석은 안무가 아니라 영상을 들여다보는 일이라
//   undo 에 남지 않는다(usecases/poseCommands.js 경계 ②). 그래서 commitHistory 를 받지 않는다.
//
// ⚠ 경계 ③ — **왜 안 되는지를 말한다.** 버튼을 그냥 잠그면 사용자는 고장으로 읽는다. 모델이 없는 것과
//   유튜브라 안 되는 것은 할 일이 다르므로 문구가 달라야 한다(구간 자르기와 같은 규약).

import { fill, str } from '../domain/strings.js';

import { CLS } from './domContract.js';
import { applyGuide, poseGuide } from './guideLines.js';
import { iconLabel } from './icon.js';

/** 분석이 안 되는 이유 → 안내. 어댑터·서버는 사실만 주고 문구는 여기서 만든다. */
export const POSE_TEXT = Object.freeze({
  'no-server': '로컬 서버(server.py)가 없어 자세 분석을 할 수 없습니다. `python3 server.py` 로 열면 됩니다.',
  'no-model': '자세 분석 모델을 아직 받지 않았습니다. `설정` 의 `자세 분석 모델` 에서 내려받으세요.',
  'not-file': '자세 분석은 영상 **파일**에만 됩니다. 유튜브는 재생 화면의 픽셀을 읽을 수 없습니다 — `영상 파일 열기` 로 받아 온 파일이어야 합니다.',
  'not-loaded': '영상이 아직 실리지 않았습니다. 영상이 뜬 뒤에 누르세요.',
  'busy': '분석하는 중입니다. 구간이 길면 수십 초가 걸립니다 — 끝나면 영상 위에 관절이 겹쳐 그려집니다.',
  'ready': 'In~Out 을 찍어 두었으면 그 구간만, 아니면 영상 전체를 봅니다. 길수록 오래 걸리니 구간을 좁히는 편이 낫습니다.'
});

/**
 * @typedef {object} PoseViewDeps
 * @property {any} store createStore 인스턴스. `session.pose` 를 **읽기만** 한다
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {() => 'ready'|'busy'|'no-server'|'no-model'|'not-file'|'not-loaded'} getReadiness
 *   지금 분석할 수 있는가, 없으면 왜인가
 * @property {() => void} onRun `자세 분석`. 어댑터를 아는 자리(app/main)가 실제로 돌린다
 * @property {{
 *   clearAnalysis: () => any, setActiveTrack: (args:{id:string}) => any,
 *   addTrack: () => any, clearAnchors: () => any, setMesh: (args?:{on?:boolean}) => any,
 *   setLive: (args?:{live?:boolean}) => any 재생하며 실시간으로 볼 것인가(2026-09-13).
 *     ⚠ 루프를 돌리는 것은 app/main 이다 — 뷰는 상태만 뒤집는다
 *   setCompare?: (args: {id: string}) => object   견줄 다른 테이크를 고른다(RM-30). 빈 id 면 견주지 않는다
 * }} commands
 * @property {() => void} [onChange] 고른 사람·앵커가 바뀌었다 — 호출부가 궤적을 다시 잇는다
 * @property {(scope: string) => RomView|null} [getRom] 가동 범위 표(RM-30). 끝난 분석이 없으면 null.
 *   계산은 app/main 이 domain/rom 으로 한다 — 뷰는 받은 줄을 그리기만 한다
 * @property {() => CompareView|null} [getCompare] 테이크 견주기(RM-30). 견줄 수 없는 상태면 null
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 주입
 */

/**
 * @typedef {Object} RomRow
 * @property {string} key
 * @property {string} label
 * @property {number|null} range
 * @property {number|null} min
 * @property {number|null} max
 * @property {number} coverage 0..1
 * @property {boolean} trusted 거짓이면 흐리게 그린다 — 충분히 보지 못한 관절이다
 */

/**
 * @typedef {Object} RomView
 * @property {Array<{id:string, label:string}>} scopes 고를 수 있는 구간(전체 · 마커 · 마디)
 * @property {string} scope 지금 그린 구간(고른 것이 사라졌으면 전체로 떨어진 값)
 * @property {RomRow[]} rows
 * @property {number} bpm 마디를 나눈 박자. 0 이면 박자가 없어 마디가 없다
 */

/**
 * @typedef {Object} CompareView
 * @property {Array<{id:string, label:string}>} candidates 짝 파일이 있는 다른 테이크
 * @property {string} selectedId
 * @property {'idle'|'loading'|'ok'|'missing'|'rejected'|'need-self'} status
 * @property {string} reason status 가 rejected 일 때 domain/rom.compare 의 reason
 * @property {string} before 전 테이크 이름
 * @property {string} after  후 테이크 이름
 * @property {Array<{label:string, marker:boolean, items:Array<{key:string, label:string, before:number|null, after:number|null, delta:number|null, trusted:boolean}>}>} sections
 */

/** 각도 한 칸. 모르면 — 다(0° 와 「모른다」를 같은 글자로 쓰지 않는다). */
function deg(v) {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}°`;
}

/** 차이 한 칸. 늘었으면 +, 줄었으면 −(빼기 기호), 같으면 0°. */
function signedDeg(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const n = Math.round(v);
  return n > 0 ? `+${n}°` : n < 0 ? `−${-n}°` : '0°';
}

/** 비교를 거절한 까닭 → 안내. 키를 글자로 적어 부른다(문자열 표 시험이 부르는 자리를 센다). */
const REJECT_TEXT = Object.freeze({
  'space-mismatch': () => str('pose.compare.spaceMismatch'),
  'model-mismatch': () => str('pose.compare.modelMismatch'),
  'aspect-mismatch': () => str('pose.compare.aspectMismatch')
});

/** 짝 파일과의 관계 → 한 줄. 모르면 빈 글자. */
const STORED_TEXT = Object.freeze({
  saving: () => str('pose.stored.saving'),
  saved: () => str('pose.stored.saved'),
  restored: () => str('pose.stored.restored'),
  failed: () => str('pose.stored.failed')
});

/**
 * `<select>` 의 고를 것을 맞춘다. 목록이 그대로면 다시 만들지 않는다 — 렌더마다 갈아 끼우면 펼친 목록이 닫히고
 * 키보드로 고르던 자리가 날아간다.
 * @param {HTMLSelectElement} sel
 * @param {Array<{id:string, label:string}>} options
 * @param {string} value
 */
// @complexity time=O(n) space=O(n) cc=4
function syncSelect(sel, options, value) {
  const sig = JSON.stringify(options.map(o => [o.id, o.label]));
  if (sel.dataset.sig !== sig) {
    sel.textContent = '';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.dataset.sig = sig;
  }
  if (sel.value !== value) sel.value = value;
}

/** 표 하나. head 는 칸 이름, rows 는 [칸 글자들, 흐리게 할까, 줄 툴팁]. */
// @complexity time=O(r·c) space=O(r·c) cc=4
function fillTable(table, head, rows) {
  table.textContent = '';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of head) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const [cells, dim, title] of rows) {
    const tr = document.createElement('tr');
    if (dim) tr.className = 'is-untrusted';
    if (title) tr.title = title;
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
}

/**
 * 자세 분석 구획을 묶는다.
 * @param {PoseViewDeps} deps
 * @returns {{ render(): void }}
 */
export function createPoseView(deps) {
  const {
    store, render, getReadiness, onRun, commands,
    onChange = () => {},
    getRom = () => null,
    getCompare = () => null,
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const liveBtn = byId('videoPoseLiveBtn');
  const runBtn = byId('videoPoseRunBtn');
  const meshBtn = byId('videoPoseMeshBtn');
  const clearBtn = byId('videoPoseClearBtn');
  const progress = byId('videoPoseProgress');
  const peopleRow = byId('videoPosePeopleRow');
  const peopleBox = byId('videoPosePeople');
  const addBtn = byId('videoPoseAddBtn');
  const pickClearBtn = byId('videoPosePickClearBtn');
  const help = byId('videoPoseHelp');
  // 가동 범위 표 · 테이크 견주기(RM-30)
  const romBox = byId('videoPoseRom');
  const scopeSel = byId('videoPoseScope');
  const storedEl = byId('videoPoseStored');
  const romTable = byId('videoPoseRomTable');
  const romNote = byId('videoPoseRomNote');
  const compareSel = byId('videoPoseCompare');
  const compareBody = byId('videoPoseCompareBody');

  // 툴팁의 주인은 문자열 표다 — 마크업에도 같은 글자가 있지만(처음 그릴 때) 표가 이긴다.
  if (scopeSel) scopeSel.title = str('pose.rom.scope.title');
  if (compareSel) compareSel.title = str('pose.compare.title');

  /** 고른 구간. 화면의 선택이라 store 에 두지 않는다 — 다시 분석하거나 영상을 바꾸면 고른 것이 없어져 전체로 떨어진다. */
  let scope = 'all';

  /** 휘발성 상태. usecases/poseCommands.DEFAULT_POSE 와 같은 기본값을 쓴다(ui 는 usecases 를 import 하지 않는다). */
  const state = () => store.get().session.pose || {
    state: 'idle', done: 0, total: 0, error: '', frames: 0, maxSubjects: 0,
    trackIds: [], activeId: '', anchors: [], ambiguous: 0, lost: 0, showMesh: true,
    live: false, liveFps: 0, delegate: '', stored: '', compareId: ''
  };

  /** 초를 `m:ss` 로. 구간 안내에만 쓴다. */
  function clock(sec) {
    if (!Number.isFinite(sec)) return '-';
    const m = Math.floor(Math.abs(sec) / 60);
    const s = Math.abs(sec) - m * 60;
    return `${sec < 0 ? '-' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  /**
   * 실시간으로 도는 동안의 안내. **잰 값을 그대로 적는다** — "빠릅니다" 가 아니라 몇 fps 인지.
   * CPU 로 섰으면 그 사실을 감추지 않는다(실측 5.6fps 라 눈에 띄게 끊긴다).
   */
  // @complexity time=O(n)? space=O(n)? cc=4
  function liveText(p) {
    const bits = ['재생하면 그 프레임의 관절을 그 자리에서 찾아 그립니다'];
    if (p.liveFps > 0) bits.push(`지금 초당 ${p.liveFps}장`);
    if (p.delegate === 'CPU') {
      bits.push('이 기기는 **CPU** 로 돌고 있어 끊깁니다 — 구간을 미리 `자세 분석` 하는 편이 낫습니다');
    } else if (p.delegate === 'GPU') {
      bits.push('GPU 로 돕니다');
    }
    bits.push('가동 범위·가속도 요약은 여전히 `자세 분석` 이 필요합니다(한 장으로는 범위를 못 잽니다)');
    return bits.join(' · ') + '.';
  }

  // @complexity time=O(n)? space=O(n)? cc=33
  function renderPose() {
    const p = state();
    const why = getReadiness();
    const running = p.state === 'running';

    // 재생하며 실시간(2026-09-13). 분석하는 중에는 잠근다 — 같은 추정기를 둘이 쓰면 타임스탬프가 엉킨다.
    if (liveBtn) {
      liveBtn.disabled = why !== 'ready' || running;
      liveBtn.className = p.live ? CLS.quickBtnActive : CLS.ghost;
      iconLabel(liveBtn, p.live ? 'square' : 'play', p.live ? '따라 그리기 끄기' : '따라 그리기');
    }
    if (runBtn) {
      runBtn.disabled = why !== 'ready';
      iconLabel(runBtn, 'person', running ? '분석하는 중…' : (p.state === 'done' ? '다시 분석' : '자세 분석'));
    }
    if (meshBtn) {
      meshBtn.className = p.showMesh ? CLS.quickBtnActive : CLS.ghost;
      meshBtn.textContent = p.showMesh ? '메시' : '뼈대';
    }
    if (clearBtn) clearBtn.disabled = p.state === 'idle' && p.anchors.length === 0;

    if (progress) {
      progress.hidden = !running;
      const bar = progress.firstElementChild;
      if (bar) bar.style.width = p.total > 0 ? `${Math.round((p.done / p.total) * 100)}%` : '0';
    }

    // 인물 줄 — 둘 이상 잡혔을 때만 보인다. 한 사람이면 고를 것이 없다.
    const many = p.state === 'done' && (p.maxSubjects > 1 || p.trackIds.length > 1);
    if (peopleRow) peopleRow.hidden = !many;
    if (peopleBox && many) {
      peopleBox.innerHTML = '';
      p.trackIds.forEach((id, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = id === p.activeId ? CLS.quickBtnActive : CLS.ghost;
        b.textContent = `${i + 1}번`;
        b.title = '이 사람의 관절을 진하게 그립니다';
        b.onclick = () => { render(commands.setActiveTrack({ id })); onChange(); };
        peopleBox.appendChild(b);
      });
    }
    if (addBtn) addBtn.disabled = p.state !== 'done';
    if (pickClearBtn) pickClearBtn.disabled = p.anchors.length === 0;

    if (help) {
      // 안내 줄은 평소에 비고(RM-19), 실패 · 막힘만 경고로, 도는 중 · 끝난 요약 · 따라 그리기만 소식으로 적힌다.
      // 준비됐을 때의 설명(POSE_TEXT.ready)은 처음 한 번 안내(ui/onceHint 의 step6)로 갔다.
      let text = '';
      if (running) {
        text = p.total > 0 ? `${p.done}/${p.total} 프레임 — ${POSE_TEXT.busy}` : POSE_TEXT.busy;
      } else if (p.state === 'done') {
        const bits = [`${clock(p.fromSec)}~${clock(p.toSec)} 에서 ${p.frames}장을 봤습니다`];
        bits.push(p.maxSubjects > 1 ? `한 화면에 최대 ${p.maxSubjects}명` : '한 사람');
        if (p.ambiguous > 0) bits.push(`헷갈린 구간 ${p.ambiguous}곳 — 그 대목에서 영상 위의 사람을 눌러 다시 고르세요`);
        if (p.lost > 0) bits.push(`놓친 구간 ${p.lost}곳`);
        if (many) bits.push('영상 위의 사람을 누르면 그 사람으로 바뀝니다');
        text = bits.join(' · ') + '.';
      } else if (p.live) {
        text = liveText(p);
      }
      applyGuide(help, poseGuide({ state: p.state, error: p.error, live: !!p.live, why, text }), CLS.isError);
    }

    renderRom(p);
  }

  /**
   * 가동 범위 표와 테이크 견주기(RM-30). 끝난 분석이 있을 때만 보인다.
   * ⚠ 못 본 관절은 빼지 않고 **흐리게** 둔다 — 빼면 「무릎이 없다」와 「무릎을 못 봤다」가 같은 화면이 된다.
   */
  // @complexity time=O(r) space=O(r) cc=12
  function renderRom(p) {
    if (!romBox) return;
    const view = p.state === 'done' ? getRom(scope) : null;
    romBox.hidden = !view;
    if (!view) return;
    scope = view.scope;
    if (scopeSel) syncSelect(scopeSel, view.scopes, view.scope);
    if (storedEl) storedEl.textContent = STORED_TEXT[p.stored] ? STORED_TEXT[p.stored]() : '';
    if (romTable) {
      fillTable(romTable,
        [str('pose.rom.col.joint'), str('pose.rom.col.range'), str('pose.rom.col.minmax'), str('pose.rom.col.coverage')],
        view.rows.map(r => [
          [r.label, deg(r.range), r.range === null ? '—' : `${deg(r.min)}~${deg(r.max)}`, `${Math.round(r.coverage * 100)}%`],
          !r.trusted,
          r.trusted ? '' : fill('pose.rom.untrusted', { pct: Math.round(r.coverage * 100) })
        ]));
    }
    if (romNote) romNote.textContent = view.bpm > 0 ? fill('pose.rom.tempo', { bpm: Math.round(view.bpm) }) : str('pose.rom.noTempo');
    renderCompare();
  }

  // @complexity time=O(s·k) space=O(s·k) cc=10
  function renderCompare() {
    const c = getCompare();
    if (compareSel) {
      const options = [{ id: '', label: str('pose.compare.none') }, ...(c ? c.candidates : [])];
      syncSelect(compareSel, options, c ? c.selectedId : '');
      compareSel.disabled = !c || c.candidates.length === 0;
    }
    if (!compareBody) return;
    compareBody.textContent = '';
    if (!c) return;
    const say = (text, cls = 'helper') => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      compareBody.appendChild(el);
    };
    if (c.candidates.length === 0) return say(str('pose.compare.empty'));
    if (!c.selectedId || c.status === 'idle') return;
    if (c.status === 'loading') return say(str('pose.compare.loading'));
    if (c.status === 'missing') return say(str('pose.compare.missing'), `helper ${CLS.isError}`);
    if (c.status === 'need-self') return say(str('pose.compare.needSelf'));
    if (c.status === 'rejected') {
      return say(REJECT_TEXT[c.reason] ? REJECT_TEXT[c.reason]() : c.reason, `helper ${CLS.isError}`);
    }
    say(fill('pose.compare.head', { before: c.before, after: c.after }), 'pose-compare-head');
    for (const sec of c.sections) {
      const title = document.createElement('div');
      title.className = 'pose-compare-section';
      title.textContent = sec.marker ? fill('pose.rom.marker', { label: sec.label }) : str('pose.rom.all');
      const table = document.createElement('table');
      table.className = 'pose-rom-table';
      fillTable(table,
        [str('pose.rom.col.joint'), str('pose.compare.col.before'), str('pose.compare.col.after'), str('pose.compare.col.delta')],
        sec.items.map(i => [[i.label, deg(i.before), deg(i.after), signedDeg(i.delta)], !i.trusted, '']));
      compareBody.append(title, table);
    }
    if (!c.sections.some(sec => sec.marker)) say(str('pose.compare.noMarkers'));
  }

  if (runBtn) runBtn.onclick = () => { if (getReadiness() === 'ready') onRun(); };
  if (liveBtn) liveBtn.onclick = () => { render(commands.setLive()); onChange(); };
  if (meshBtn) meshBtn.onclick = () => { render(commands.setMesh()); onChange(); };
  if (clearBtn) clearBtn.onclick = () => { render(commands.clearAnalysis()); onChange(); };
  if (addBtn) addBtn.onclick = () => { render(commands.addTrack()); onChange(); };
  if (pickClearBtn) pickClearBtn.onclick = () => { render(commands.clearAnchors()); onChange(); };
  if (scopeSel) scopeSel.onchange = () => { scope = scopeSel.value || 'all'; renderPose(); };
  if (compareSel && commands.setCompare) compareSel.onchange = () => { render(commands.setCompare({ id: compareSel.value })); };

  return { render: renderPose };
}
