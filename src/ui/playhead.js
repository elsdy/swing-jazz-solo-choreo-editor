// src/ui/playhead.js — 안무표 위의 재생 헤드 (ui 계층, **휘발성 채널 B**)
//
// 신규 파일이다. 원본 index.html 에 대응물이 없다 — 오늘 이 앱에는 시간축 자체가 없었다.
//
// ⚠⚠ **이 파일은 렌더 파이프라인을 타지 않는다.** 재생 위치는 초당 60번 바뀌므로 Dirty 로 라우팅하면
//   전체 재렌더가 초당 60회가 된다(docs/PORTS.md '재생 헤드가 렌더 파이프라인을 타면 안 되는 이유').
//   그래서 채널이 둘이다:
//     채널 A(도메인) — 상태 변경 → store → 뷰 갱신. bpm·앵커 확정, 소스 변경이 여기다.
//     채널 B(휘발성) — 이 파일. rAF 루프가 **자기가 만든 엘리먼트 하나의 transform 만** 직접 쓴다.
//   그러므로 여기서 store 를 **쓰지 않는다**(읽기만 한다, 그것도 주입된 게터를 통해서).
//
// ⚠ 칸 폭은 `--cellW` 를 읽지 않고 `track.getBoundingClientRect().width / cols` 로 잰다.
//   레이아웃 변경에 유일하게 안전한 측정법이고, 이미 포인터 좌표 계산(domain/grid.cellIndexFromRatio)이
//   같은 근거를 쓴다. 매 프레임 재면 강제 리플로가 되므로 **행이 바뀔 때·리사이즈·재렌더에만** 재고 캐시한다.
//
// ⚠ 움직임은 `left` 가 아니라 `transform: translateX()` 다. left 는 매 프레임 레이아웃을 다시 계산시킨다.
//
// ⚠ 헤드는 **현재 행의 `.track` 안에** 산다(8카운트에 한 번만 자리를 옮긴다). 트랙은
//   `position:relative; overflow:hidden` 이라 그 안에서 좌표가 그대로 맞고, 행을 벗어나면 잘려서
//   "지금 어느 마디인가"가 저절로 드러난다.
//   ⚠ boardView.renderRow 는 `.placement` 만 걷어내므로 헤드는 행 재렌더에서 살아남는다. 다만
//     골격 재생성(buildBoardSkeleton)은 innerHTML 을 비우므로, 매 프레임 parentElement 를 확인해
//     끊긴 경우 다시 붙인다(비교는 프로퍼티 하나라 공짜다).

import { CLS } from './domContract.js';
import { timeToCell } from '../domain/tempo.js';

/** 사용자가 스크롤·터치한 뒤 자동 추종을 멈추는 시간. 따라가기와 손 스크롤이 싸우면 화면이 튄다. */
export const FOLLOW_SUSPEND_MS = 3000;

/** 따라가기 계산 주기. 매 프레임 getBoundingClientRect 를 두 번 읽으면 리플로가 초당 60번이다. */
export const FOLLOW_INTERVAL_MS = 160;

/** 가로 추종의 안전 구역. 헤드가 이 띠를 벗어날 때만 가로로 스크롤한다(0.25 ~ 0.75). */
const FOLLOW_BAND = 0.25;

/** 세로 추종의 여백(px). 행이 뷰포트 가장자리에 걸치기 전에 미리 옮긴다. */
const FOLLOW_EDGE_PAD = 8;

/**
 * @typedef {object} PlayheadDeps
 * @property {HTMLElement} scrollRoot 안무표의 스크롤 컨테이너(#mainBoardWrap). 따라가기가 이걸 움직인다
 * @property {(row: number) => HTMLElement|null} getTrack 행 인덱스 → 그 행의 `.track`.
 *   app/main 이 `boardView.rowRefs` 로 잇는다. 격자 밖 행이면 null 을 줘야 한다(헤드가 숨는다)
 * @property {() => number} getCols 메인 보드의 칸 수
 * @property {() => import('../domain/tempo.js').Tempo} getTempo 확정된 Tempo
 * @property {() => boolean} isActive 지금 헤드를 그려도 되는가.
 *   ⚠ **템포가 준비되지 않았으면 반드시 거짓이어야 한다** — bpm 0 에서 그리면 그럴듯한 위치에
 *     거짓말이 서 있게 되고, 그게 가장 나쁜 실패다(docs/PORTS.md)
 * @property {() => number} getCurrentSec 보간된 현재 미디어 시각(초).
 *   app/main 이 `projectTime(player.getTimeSample(), performance.now(), duration)` 로 만든다
 * @property {() => boolean} [isFollowing] "따라가기" 가 켜져 있는가. 기본 false
 * @property {Window} [win]
 * @property {Document} [doc]
 */

/**
 * 재생 헤드를 만든다. 만들기만 하고 아무것도 그리지 않는다 — `start()` 를 불러야 루프가 돈다.
 *
 * @param {PlayheadDeps} deps
 * @returns {{
 *   el: HTMLElement,
 *   start(): void,
 *   stop(): void,
 *   invalidate(): void,
 *   isRunning(): boolean
 * }}
 */
export function createPlayhead(deps) {
  const {
    scrollRoot,
    getTrack,
    getCols,
    getTempo,
    isActive,
    getCurrentSec,
    isFollowing = () => false,
    win = window,
    doc = document
  } = deps;

  const el = doc.createElement('div');
  el.className = CLS.playhead;
  el.hidden = true;

  /** rAF 핸들. null 이면 루프가 멈춰 있다. */
  let rafId = null;
  /** 캐시된 칸 폭(px). 0 이면 "다시 재야 한다"는 뜻이다. */
  let cellW = 0;
  /** 마지막으로 따라가기를 계산한 시각(ms). */
  let lastFollowMs = 0;
  /** 이 시각(ms)까지는 자동 추종을 멈춘다. 사용자가 손으로 스크롤한 직후다. */
  let suspendUntil = 0;

  const nowMs = () => win.performance.now();

  /** 칸 폭 캐시를 버린다. 리사이즈·보드 재렌더·패널 개폐가 부른다. */
  function invalidate() {
    cellW = 0;
  }

  /**
   * 사용자가 안무표를 직접 만졌다 — 잠시 자동 추종을 멈춘다.
   * ⚠ `scroll` 이벤트를 듣지 않는 이유: 우리가 스크롤해도 그 이벤트가 오므로 자기 스크롤에
   *   자기가 반응해 추종이 영원히 멈춘다. **사람의 제스처만** 듣는다.
   */
  function suspendFollow() {
    suspendUntil = nowMs() + FOLLOW_SUSPEND_MS;
  }

  if (scrollRoot) {
    scrollRoot.addEventListener('wheel', suspendFollow, { passive: true });
    scrollRoot.addEventListener('touchstart', suspendFollow, { passive: true });
    scrollRoot.addEventListener('pointerdown', suspendFollow, { passive: true });
  }
  // 폭이 바뀌면 칸 폭도 바뀐다. 값을 여기서 다시 재지 않고 버리기만 한다(다음 프레임이 잰다).
  win.addEventListener('resize', invalidate);

  /**
   * 재생 위치가 화면 안에 남도록 안무표를 스크롤한다.
   * ⚠ `scroll-behavior:smooth` 를 쓰지 마라 — 매 프레임 목표가 바뀌어 부드러운 스크롤끼리 싸운다.
   * @param {HTMLElement} track 현재 행의 트랙
   * @param {number} x 트랙 안에서의 헤드 위치(px)
   */
  function follow(track, x) {
    if (!scrollRoot || !isFollowing()) return;
    const ms = nowMs();
    if (ms < suspendUntil) return;
    if (ms - lastFollowMs < FOLLOW_INTERVAL_MS) return;
    lastFollowMs = ms;

    const rootRect = scrollRoot.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();

    // 세로 — 현재 행이 가장자리에 걸리면 뷰포트 가운데로 끌어온다.
    if (trackRect.top < rootRect.top + FOLLOW_EDGE_PAD || trackRect.bottom > rootRect.bottom - FOLLOW_EDGE_PAD) {
      const centered = (scrollRoot.clientHeight - trackRect.height) / 2;
      scrollRoot.scrollTop += (trackRect.top - rootRect.top) - centered;
    }

    // 가로 — 헤드가 가운데 띠를 벗어날 때만 민다(칸마다 스크롤하면 눈이 피곤하다).
    const headX = trackRect.left + x;
    const leftEdge = rootRect.left + rootRect.width * FOLLOW_BAND;
    const rightEdge = rootRect.left + rootRect.width * (1 - FOLLOW_BAND);
    if (headX < leftEdge) scrollRoot.scrollLeft += headX - leftEdge;
    else if (headX > rightEdge) scrollRoot.scrollLeft += headX - rightEdge;
  }

  /** 한 프레임. **여기서 하는 DOM 쓰기는 el.style.transform 과 el.hidden 뿐이다.** */
  function frame() {
    rafId = win.requestAnimationFrame(frame);

    if (!isActive()) { el.hidden = true; return; }

    const cols = getCols();
    if (!(cols > 0)) { el.hidden = true; return; }

    // 초 → 칸. intro 행(row 0)은 음수 카운트로 분기 없이 떨어진다(domain/tempo.js 상단 참조).
    const { row, index, fraction } = timeToCell(getCurrentSec(), cols, getTempo());
    const track = getTrack(row);
    // 격자 밖(앵커보다 한참 앞이거나 마지막 행 뒤)이면 그릴 자리가 없다 — 숨긴다.
    if (!track) { el.hidden = true; return; }

    // 행이 바뀌었거나 골격이 다시 세워져 끊겼으면 새 트랙에 붙인다(8카운트에 한 번).
    if (el.parentElement !== track) {
      track.appendChild(el);
      cellW = 0;                       // 트랙이 바뀌었으니 폭도 다시 잰다
    }
    if (!cellW) cellW = track.getBoundingClientRect().width / cols;

    const x = (index + fraction) * cellW;
    el.style.transform = `translateX(${x}px)`;
    el.hidden = false;

    follow(track, x);
  }

  return {
    el,

    /** 루프를 돌린다. 이미 돌고 있으면 아무 일도 하지 않는다(멱등). */
    start() {
      if (rafId !== null) return;
      lastFollowMs = 0;
      rafId = win.requestAnimationFrame(frame);
    },

    /**
     * 루프를 멈추고 헤드를 숨긴다. 멱등.
     * ⚠ 엘리먼트를 DOM 에서 떼지 않는다 — 다음 start 에서 그대로 다시 쓴다.
     */
    stop() {
      if (rafId !== null) {
        win.cancelAnimationFrame(rafId);
        rafId = null;
      }
      el.hidden = true;
    },

    invalidate,

    isRunning() { return rafId !== null; }
  };
}
