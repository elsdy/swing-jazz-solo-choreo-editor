// src/ui/poseOverlay.js — 영상 위에 관절·몸을 겹쳐 그린다 (ui 계층, **휘발성 채널 B**)
//
// 신설 파일이다(2026-09-12). ui/playhead.js 와 같은 자리에 선다 — 재생 위치를 따라 초당 수십 번 바뀌는
// 그림이라 **렌더 파이프라인을 타지 않는다.** rAF 루프가 자기 캔버스에만 그리고, store 는 읽기만 한다
// (그것도 주입된 게터를 통해서).
//
// ⚠ 경계 ① — **프레임이 아니라 영상이 그려진 칸에 맞춘다.** 영상은 레터박스와 함께 가운데 들어가므로
//   (`object-fit: contain`) 프레임을 꽉 채우면 관절이 검은 띠 쪽으로 밀린다. 캔버스의 자리와 크기를
//   여기서 재서 인라인으로 넣는다.
//
// ⚠ 경계 ② — **측정은 아낀다.** getBoundingClientRect 를 매 프레임 읽으면 초당 60번 리플로가 된다.
//   재는 것은 `invalidate()` 뒤 한 번뿐이고, 나머지 프레임은 캐시를 쓴다(playhead 와 같은 규약).
//
// ⚠ 경계 ③ — **분석 결과를 들고 있지 않는다.** 프레임 배열은 app/main.js 소유이고 여기는 게터로 본다.
//   그래야 이 파일이 관절점 수만 개를 복제하지 않는다.

import { meshOfSubject } from '../domain/bodyMesh.js';
import { createMeshView } from './meshView.js';

/** 이 시각과 얼마나 떨어진 분석 프레임까지 같은 순간으로 볼 것인가(초). 넘으면 아무것도 안 그린다. */
export const MATCH_TOLERANCE_SEC = 0.2;

/** 뼈대 모드에서 잇는 선. domain/bodyMesh 의 LIMBS 와 달리 몸통 네 변을 포함한다(눈으로 몸을 읽으려고). */
const BONES = Object.freeze([
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'], ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['leftAnkle', 'leftFootIndex'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'], ['rightAnkle', 'rightFootIndex']
]);

/** 지금 보는 사람과 그 밖의 사람을 다른 색으로 그린다 — 누구를 재고 있는지가 화면에서 보여야 한다. */
const ACTIVE = Object.freeze({ stroke: 'rgba(134,239,172,0.95)', fill: 'rgba(6,30,18,0.45)', joint: 'rgba(34,197,94,0.95)' });
const OTHER = Object.freeze({ stroke: 'rgba(148,163,184,0.55)', fill: 'rgba(15,23,42,0.35)', joint: 'rgba(148,163,184,0.6)' });

/**
 * @typedef {object} PoseOverlayDeps
 * @property {HTMLCanvasElement} canvas `.video-frame` 안에 있는 캔버스
 * @property {HTMLElement} frame `.video-frame`. 크기를 여기서 잰다
 * @property {() => {w:number, h:number}} getVideoSize 영상의 원본 크기. 모르면 {w:0,h:0}
 * @property {() => number} getCurrentSec 보간된 현재 미디어 시각(초)
 * @property {() => boolean} isActive 지금 그려도 되는가(패널이 열려 있고 분석 결과가 있는가)
 * @property {(sec: number) => {sec:number, subjects:Array, activeIndex:number}|null} getFrameAt
 *   그 시각에 해당하는 분석 프레임. `activeIndex` 는 지금 보는 궤적이 가리키는 사람 번호(-1이면 없음)
 * @property {() => boolean} getShowMesh 메시를 입힐 것인가
 * @property {(sec: number, point: {x:number, y:number}) => void} [onPick]
 *   영상 위를 눌렀다. 좌표는 **영상 기준 0..1** 이다 — 사람 고르기에 쓴다
 * @property {Window} [win]
 * @property {Document} [doc]
 */

/**
 * 오버레이를 만든다. 만들기만 하고 아무것도 그리지 않는다 — `start()` 를 불러야 루프가 돈다.
 * @param {PoseOverlayDeps} deps
 * @returns {{ start(): void, stop(): void, invalidate(): void, isRunning(): boolean, draw(): void }}
 */
export function createPoseOverlay(deps) {
  const {
    canvas, frame, getVideoSize, getCurrentSec, isActive, getFrameAt,
    getShowMesh = () => true,
    onPick = null,
    win = window
  } = deps;

  const meshView = createMeshView({ canvas });
  const ctx = canvas ? canvas.getContext('2d') : null;

  let rafId = null;
  /** 캐시된 배치. null 이면 다시 재야 한다(경계 ②). */
  let box = null;
  /** 마지막으로 그린 분석 프레임의 시각. 같으면 다시 그리지 않는다 — 멈춘 영상에서 헛그림을 막는다. */
  let lastDrawnSec = null;
  let lastMeshFlag = null;
  let lastActive = null;

  /**
   * 영상이 실제로 그려진 칸을 잰다(`object-fit: contain` 의 결과). 캔버스를 그 칸에 딱 맞춘다.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  function measure() {
    if (!frame || !canvas) return null;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const { w: vw, h: vh } = getVideoSize() || { w: 0, h: 0 };
    if (!(fw > 0 && fh > 0 && vw > 0 && vh > 0)) return null;
    const scale = Math.min(fw / vw, fh / vh);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    const x = Math.round((fw - w) / 2);
    const y = Math.round((fh - h) / 2);
    // 인라인으로 자리를 잡는다. 백킹 스토어도 같은 크기라 0..1 좌표가 그대로 픽셀이 된다.
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return { x, y, w, h };
  }

  /** 뼈대 한 사람. 메시를 끈 모드다. */
  function strokeSkeleton(subject, colors) {
    const p = subject.points || {};
    const at = (n) => (p[n] && p[n].score > 0.2 ? [p[n].x * canvas.width, p[n].y * canvas.height] : null);
    ctx.lineWidth = Math.max(1.5, canvas.width / 220);
    ctx.strokeStyle = colors.stroke;
    for (const [a, b] of BONES) {
      const A = at(a), B = at(b);
      if (!A || !B) continue;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
    const r = Math.max(2, canvas.width / 130);
    ctx.fillStyle = colors.joint;
    for (const name of Object.keys(p)) {
      const P = at(name);
      if (!P) continue;
      ctx.beginPath(); ctx.arc(P[0], P[1], r, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** 한 프레임을 그린다. 그릴 것이 없으면 지우기만 한다. */
  function draw() {
    if (!ctx || !canvas) return;
    if (!box) box = measure();
    if (!box) { canvas.hidden = true; return; }

    if (!isActive()) {
      canvas.hidden = true;
      lastDrawnSec = null;
      return;
    }
    const sec = getCurrentSec();
    const found = getFrameAt(sec);
    if (!found || Math.abs(found.sec - sec) > MATCH_TOLERANCE_SEC) {
      // 분석 구간 밖이다 — 아무것도 그리지 않는다. 가장 가까운 프레임을 억지로 그리면 거짓말이 된다.
      if (lastDrawnSec !== null) { ctx.clearRect(0, 0, canvas.width, canvas.height); lastDrawnSec = null; }
      canvas.hidden = false;
      return;
    }
    const mesh = getShowMesh();
    if (found.sec === lastDrawnSec && mesh === lastMeshFlag && found.activeIndex === lastActive) return;
    lastDrawnSec = found.sec;
    lastMeshFlag = mesh;
    lastActive = found.activeIndex;

    canvas.hidden = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 지금 보는 사람을 **마지막에** 그린다 — 겹치면 그 사람이 위로 온다.
    const order = found.subjects.map((s, i) => i).sort((a, b) => (a === found.activeIndex ? 1 : 0) - (b === found.activeIndex ? 1 : 0));
    for (const i of order) {
      const subject = found.subjects[i];
      if (!subject) continue;
      const colors = i === found.activeIndex || found.activeIndex < 0 ? ACTIVE : OTHER;
      if (mesh) {
        const built = meshOfSubject(subject, { space: 'screen' });
        if (!built.vertices.length) continue;
        const aspect = Number.isFinite(subject.aspect) && subject.aspect > 0 ? subject.aspect : 1;
        meshView.render(built, {
          xScale: 1 / aspect, flipY: false, direct: true, clear: false,
          colors, lineWidth: Math.max(1, canvas.width / 500)
        });
      } else {
        strokeSkeleton(subject, colors);
      }
    }
  }

  function loop() {
    if (rafId === null) return;
    draw();
    rafId = win.requestAnimationFrame(loop);
  }

  if (canvas && onPick) {
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      onPick(getCurrentSec(), { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    });
  }

  return {
    start() {
      if (rafId !== null) return;
      box = null;
      rafId = win.requestAnimationFrame(loop);
    },
    stop() {
      if (rafId !== null) win.cancelAnimationFrame(rafId);
      rafId = null;
      if (canvas) canvas.hidden = true;
      lastDrawnSec = null;
    },
    /** 크기가 달라졌을 수 있다 — 다음 프레임에 다시 잰다. */
    invalidate() {
      box = null;
      lastDrawnSec = null;
    },
    isRunning() { return rafId !== null; },
    draw
  };
}
