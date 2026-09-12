// src/usecases/poseCommands.js — 자세 분석의 화면 상태 (usecases 계층)
//
// 신설 파일이다(2026-09-12). 영상 패널의 `자세 분석` 구획이 쓰는 상태를 다룬다.
//
// ⚠ 경계 ① — **관절점 자체는 store 에 들어가지 않는다.** 30초를 15fps 로 보면 프레임 450장이고
//   사람마다 점 15개이니 숫자 수만 개다. store 에 넣으면 스냅샷 문자열이 그만큼 불어나 undo 가 느려지고,
//   되돌릴 값도 아니다(다시 분석하면 같은 값이 나온다). 결과는 app/main.js 가 모듈 변수로 들고 있고
//   여기에는 **요약만** 둔다 — 몇 장을 봤는지, 몇 명이었는지, 어느 궤적이 있는지.
//   재생 위치를 store 에 넣지 않는 것과 같은 이유다(usecases/videoCommands.js 경계 ①).
//
// ⚠ 경계 ② — **undo 를 타지 않는다.** 분석은 안무가 아니라 영상을 들여다보는 일이다. 전부
//   `session.pose` 에 살고 파일에도 안 나간다. 반대로 마커(domain/markers)는 안무라서 media 에 산다.
//
// ⚠ 경계 ③ — 여기서 추정기를 부르지 않는다. 모델을 올리고 프레임을 훑는 것은 어댑터의 일이고,
//   이 파일은 "시작했다 / 몇 장 했다 / 끝났다 / 실패했다" 라는 사실만 받아 적는다.

import { NONE } from './store.js';

/** 자세 구획이 다시 그려져야 한다는 뜻. 영상 패널 안에 있으므로 같은 깃발을 쓴다. */
const VIDEO = Object.freeze({ video: true });

/** session.pose 의 기본값. 옛 스냅샷을 복원한 뒤에도 안전하도록 읽을 때마다 채운다. */
export const DEFAULT_POSE = Object.freeze({
  state: 'idle',        // 'idle' | 'running' | 'done' | 'error'
  done: 0,
  total: 0,
  error: '',
  frames: 0,
  maxSubjects: 0,
  trackIds: [],
  activeId: '',
  anchors: [],          // [{sec, subject, id}] — "이 시각의 이 사람이 이 궤적이다"
  ambiguous: 0,
  lost: 0,
  fromSec: 0,
  toSec: 0,
  showMesh: true
});

/**
 * 자세 분석의 화면 상태. 없는 키는 기본값으로 채운다.
 * @param {object} store
 * @returns {typeof DEFAULT_POSE}
 */
export function poseState(store) {
  const p = store.get().session.pose;
  return p ? { ...DEFAULT_POSE, ...p } : { ...DEFAULT_POSE };
}

/** session.pose 를 부분 갱신한다. 값이 하나도 안 바뀌면 NONE 을 돌려 헛렌더를 막는다. */
function patch(store, values) {
  const cur = poseState(store);
  let changed = false;
  for (const key of Object.keys(values)) {
    const a = cur[key];
    const b = values[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || JSON.stringify(a) !== JSON.stringify(b)) changed = true;
    } else if (a !== b) {
      changed = true;
    }
  }
  if (!changed) return NONE;
  store.patch('session', { pose: { ...cur, ...values } });
  return VIDEO;
}

/**
 * 분석을 시작했다. 앞선 결과는 여기서 지운다 — 새 구간의 진행률 옆에 옛 사람 목록이 남으면 안 된다.
 * @param {object} store
 * @param {{fromSec?: number, toSec?: number}} [args]
 * @returns {import('./store.js').Dirty}
 */
export function startAnalysis(store, args = {}) {
  const fromSec = Number.isFinite(args.fromSec) ? args.fromSec : 0;
  const toSec = Number.isFinite(args.toSec) ? args.toSec : 0;
  return patch(store, {
    state: 'running', done: 0, total: 0, error: '',
    frames: 0, maxSubjects: 0, trackIds: [], activeId: '',
    ambiguous: 0, lost: 0, fromSec, toSec
  });
}

/**
 * 진행률. **자주 불린다**(프레임마다) — 값이 그대로면 NONE 이라 헛렌더가 없다.
 * @param {object} store
 * @param {{done?: number, total?: number}} args
 * @returns {import('./store.js').Dirty}
 */
export function setProgress(store, args = {}) {
  if (poseState(store).state !== 'running') return NONE;
  const done = Number.isFinite(args.done) ? Math.max(0, Math.floor(args.done)) : 0;
  const total = Number.isFinite(args.total) ? Math.max(0, Math.floor(args.total)) : 0;
  return patch(store, { done, total });
}

/**
 * 분석이 끝났다. 궤적이 하나면 그것을 바로 고른다 — 한 사람짜리 영상에서 사용자가 아무것도 안 해도 된다.
 * @param {object} store
 * @param {{frames?:number, maxSubjects?:number, trackIds?:string[], ambiguous?:number, lost?:number}} args
 * @returns {import('./store.js').Dirty}
 */
export function finishAnalysis(store, args = {}) {
  const trackIds = Array.isArray(args.trackIds) ? args.trackIds.map(String) : [];
  const cur = poseState(store);
  const activeId = trackIds.includes(cur.activeId) ? cur.activeId : (trackIds[0] || '');
  return patch(store, {
    state: 'done',
    frames: Number.isFinite(args.frames) ? args.frames : 0,
    maxSubjects: Number.isFinite(args.maxSubjects) ? args.maxSubjects : 0,
    trackIds, activeId,
    ambiguous: Number.isFinite(args.ambiguous) ? args.ambiguous : 0,
    lost: Number.isFinite(args.lost) ? args.lost : 0,
    error: ''
  });
}

/**
 * 분석이 실패했다. 문구는 어댑터·서버가 만든 것을 그대로 싣는다(뷰가 앞말을 붙인다).
 * @param {object} store
 * @param {{error?: string}} args
 * @returns {import('./store.js').Dirty}
 */
export function failAnalysis(store, args = {}) {
  return patch(store, { state: 'error', error: String(args.error || '알 수 없는 오류'), done: 0, total: 0 });
}

/**
 * 결과를 버린다(소스가 바뀌었거나 사용자가 지웠다).
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearAnalysis(store) {
  const cur = poseState(store);
  if (cur.state === 'idle' && cur.anchors.length === 0) return NONE;
  return patch(store, { ...DEFAULT_POSE, showMesh: cur.showMesh });
}

/**
 * 어느 사람을 볼 것인가.
 * @param {object} store
 * @param {{id?: string}} args
 * @returns {import('./store.js').Dirty}
 */
export function setActiveTrack(store, args = {}) {
  const id = String(args.id || '');
  const cur = poseState(store);
  if (!cur.trackIds.includes(id)) return NONE;
  return patch(store, { activeId: id });
}

/**
 * "이 시각의 이 사람" 을 찍는다. 궤적을 잇는 앵커이며, 같은 시각의 같은 궤적은 갈아 끼운다.
 *
 * ⚠ id 를 주지 않으면 **지금 보고 있는 궤적**에 붙는다. 두 사람이 스쳐 지나가 궤적이 옮겨 붙었을 때
 *   그 자리에서 한 번 더 찍어 고치는 것이 가장 흔한 쓰임이라, 그때 id 를 고르게 하면 성가시다
 *   (템포의 `여기로 다시 맞추기` 와 같은 규약 — domain/poseTracks.buildTracks).
 * @param {object} store
 * @param {{sec?: number, subject?: number, id?: string}} args
 * @returns {import('./store.js').Dirty}
 */
export function addAnchor(store, args = {}) {
  const sec = Number(args.sec);
  const subject = Number(args.subject);
  if (!Number.isFinite(sec) || !Number.isInteger(subject) || subject < 0) return NONE;
  const cur = poseState(store);
  const id = String(args.id || cur.activeId || 'p1');
  const kept = cur.anchors.filter(a => !(a.id === id && Math.abs(a.sec - sec) < 1e-6));
  const anchors = [...kept, { sec, subject, id }].sort((a, b) => a.sec - b.sec || (a.id < b.id ? -1 : 1));
  const trackIds = cur.trackIds.includes(id) ? cur.trackIds : [...cur.trackIds, id];
  return patch(store, { anchors, trackIds, activeId: id });
}

/**
 * 새 사람을 하나 더 고르기 시작한다 — 다음 앵커가 붙을 새 궤적 id 를 만든다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function addTrack(store) {
  const cur = poseState(store);
  let n = cur.trackIds.length + 1;
  while (cur.trackIds.includes(`p${n}`)) n++;
  const id = `p${n}`;
  return patch(store, { trackIds: [...cur.trackIds, id], activeId: id });
}

/**
 * 찍어 둔 앵커를 전부 버린다. 궤적도 함께 없어진다 — 앵커가 곧 궤적의 근거다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearAnchors(store) {
  const cur = poseState(store);
  if (cur.anchors.length === 0 && cur.trackIds.length === 0) return NONE;
  return patch(store, { anchors: [], trackIds: [], activeId: '' });
}

/**
 * 메시를 입힐 것인가(끄면 뼈대만).
 * @param {object} store
 * @param {{on?: boolean}} [args] 생략하면 토글
 * @returns {import('./store.js').Dirty}
 */
export function setMesh(store, args = {}) {
  const next = typeof args.on === 'boolean' ? args.on : !poseState(store).showMesh;
  return patch(store, { showMesh: next });
}

/**
 * 지금 겹쳐 그릴 것이 있는가. 오버레이 루프가 이걸 보고 돌지 말지 정한다.
 * @param {object} store
 * @returns {boolean}
 */
export function hasOverlay(store) {
  const p = poseState(store);
  return p.state === 'done' && p.frames > 0;
}
