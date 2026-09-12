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

import { CLS } from './domContract.js';

/** 분석이 안 되는 이유 → 안내. 어댑터·서버는 사실만 주고 문구는 여기서 만든다. */
export const POSE_TEXT = Object.freeze({
  'no-server': '로컬 서버(server.py)가 없어 자세 분석을 할 수 없습니다. `python3 server.py` 로 열면 됩니다.',
  'no-model': '자세 분석 모델을 아직 받지 않았습니다. `⚙ 설정` 의 `자세 분석 모델` 에서 내려받으세요.',
  'not-file': '자세 분석은 영상 **파일**에만 됩니다. 유튜브는 재생 화면의 픽셀을 읽을 수 없습니다 — `📁 영상 파일 열기` 로 받아 온 파일이어야 합니다.',
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
 * @property {() => void} onRun `🧍 자세 분석`. 어댑터를 아는 자리(app/main)가 실제로 돌린다
 * @property {{
 *   clearAnalysis: () => any, setActiveTrack: (args:{id:string}) => any,
 *   addTrack: () => any, clearAnchors: () => any, setMesh: (args?:{on?:boolean}) => any
 * }} commands
 * @property {() => void} [onChange] 고른 사람·앵커가 바뀌었다 — 호출부가 궤적을 다시 잇는다
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 주입
 */

/**
 * 자세 분석 구획을 묶는다.
 * @param {PoseViewDeps} deps
 * @returns {{ render(): void }}
 */
export function createPoseView(deps) {
  const {
    store, render, getReadiness, onRun, commands,
    onChange = () => {},
    elements = {}
  } = deps;

  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const runBtn = byId('videoPoseRunBtn');
  const meshBtn = byId('videoPoseMeshBtn');
  const clearBtn = byId('videoPoseClearBtn');
  const progress = byId('videoPoseProgress');
  const peopleRow = byId('videoPosePeopleRow');
  const peopleBox = byId('videoPosePeople');
  const addBtn = byId('videoPoseAddBtn');
  const pickClearBtn = byId('videoPosePickClearBtn');
  const help = byId('videoPoseHelp');

  /** 휘발성 상태. usecases/poseCommands.DEFAULT_POSE 와 같은 기본값을 쓴다(ui 는 usecases 를 import 하지 않는다). */
  const state = () => store.get().session.pose || {
    state: 'idle', done: 0, total: 0, error: '', frames: 0, maxSubjects: 0,
    trackIds: [], activeId: '', anchors: [], ambiguous: 0, lost: 0, showMesh: true
  };

  /** 초를 `m:ss` 로. 구간 안내에만 쓴다. */
  function clock(sec) {
    if (!Number.isFinite(sec)) return '-';
    const m = Math.floor(Math.abs(sec) / 60);
    const s = Math.abs(sec) - m * 60;
    return `${sec < 0 ? '-' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  function renderPose() {
    const p = state();
    const why = getReadiness();
    const running = p.state === 'running';

    if (runBtn) {
      runBtn.disabled = why !== 'ready';
      runBtn.textContent = running ? '🧍 분석하는 중…' : (p.state === 'done' ? '🧍 다시 분석' : '🧍 자세 분석');
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
      help.classList.remove(CLS.isError);
      if (p.state === 'error') {
        help.textContent = `분석 실패: ${p.error}`;
        help.classList.add(CLS.isError);
      } else if (running) {
        help.textContent = p.total > 0
          ? `${p.done}/${p.total} 프레임 — ${POSE_TEXT.busy}`
          : POSE_TEXT.busy;
      } else if (p.state === 'done') {
        const bits = [`${clock(p.fromSec)}~${clock(p.toSec)} 에서 ${p.frames}장을 봤습니다`];
        bits.push(p.maxSubjects > 1 ? `한 화면에 최대 ${p.maxSubjects}명` : '한 사람');
        if (p.ambiguous > 0) bits.push(`헷갈린 구간 ${p.ambiguous}곳 — 그 대목에서 영상 위의 사람을 눌러 다시 고르세요`);
        if (p.lost > 0) bits.push(`놓친 구간 ${p.lost}곳`);
        if (many) bits.push('영상 위의 사람을 누르면 그 사람으로 바뀝니다');
        help.textContent = bits.join(' · ') + '.';
      } else {
        help.textContent = why === 'ready' ? POSE_TEXT.ready : (POSE_TEXT[why] || POSE_TEXT.ready);
      }
    }
  }

  if (runBtn) runBtn.onclick = () => { if (getReadiness() === 'ready') onRun(); };
  if (meshBtn) meshBtn.onclick = () => { render(commands.setMesh()); onChange(); };
  if (clearBtn) clearBtn.onclick = () => { render(commands.clearAnalysis()); onChange(); };
  if (addBtn) addBtn.onclick = () => { render(commands.addTrack()); onChange(); };
  if (pickClearBtn) pickClearBtn.onclick = () => { render(commands.clearAnchors()); onChange(); };

  return { render: renderPose };
}
