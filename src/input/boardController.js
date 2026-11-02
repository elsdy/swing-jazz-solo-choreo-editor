// src/input/boardController.js — 보드 1개당 위임 이벤트 컨트롤러
//
// 원본 index.html 의 bindBoardDelegatedEvents(2389-2785) 전체를 그대로 옮겼다.
// 원본은 mainCtx(1521)와 reCtx(4856) 두 번 불려 보드마다 자기 클로저 상태
// (drawState / quickDrawState / quickTouchAnchor / lastTapTime / lastTapGroupId)를 따로 가졌고,
// document 레벨 mouseup 리스너도 보드마다 하나씩 총 2개가 붙었다. 인스턴스 2개가 그것을 재현한다.
//
// ⚠ 이 파일이 지켜야 하는 것들
//   1. 리스너 등록 **순서**와 등록 **대상**(el 인지 document 인지), capture 플래그, preventDefault 의 위치가
//      원본과 다르면 안 된다. 마우스·터치 두 벌이던 리스너는 2026-11-02(RM-11)에 **포인터 한 벌**(pointerdown ·
//      pointermove · pointerup · pointercancel)로 합쳐졌다 — 원본 번호(⑧~㉕)는 그 안의 갈래로 남아 있다.
//   2. 마우스 규칙과 손가락 규칙의 갈림은 **그 누름의 pointerType** 으로 정한다(domain/boardGesture.pointerKind).
//      무엇이 다른지는 domain/boardGesture 머리의 표와 docs/deviations.md 「터치와 마우스의 불일치」에 있다.
//   3. 드래그 카운트의 **하한**이 곳마다 다르다. 프리뷰는 1, 커밋은 DEFAULT_COUNT 다.
//      → domain/gestureMath.resolveDragCount 에 lowerBound 로 넘긴다.
//   6. 그리기·빠른 배치·더블탭의 **판단**은 domain/boardGesture 의 전이 함수가 한다(RM-08, 2026-10-01).
//      여기 남은 것은 이벤트를 값으로 바꾸기와 할 일 실행뿐이다 — 시험은 tests/unit/boardGesture.test.mjs.
//   4. `ctx === mainCtx` 4곳(2429 drop · 2470 dblclick · 2503 pointerdown(리사이즈) · 2539 pointerdown(더블탭))은
//      생성 시 policy 로 사라진다. 2446(click)의 `ctx !== mainCtx` 는 policy.allowsSelection 이다.
//   7. 블록을 잡는 문법(RM-12, 2026-11-03) — 누른 자리를 블록 폭으로 잰다(gestureMath.resolveGrabZone). 양쪽 가장자리는
//      트리밍(왼쪽 시작점 · 오른쪽 길이), 몸통은 끌면 옮기기(Alt 면 복사) · 떼면 클릭(고르기), 두 번 누르면 동작 고르기 창.
//      손가락은 몸통을 **길게 눌러야** 옮기기다 — 짚고 굴리면 화면 넘기기, 탭하면 팝업. 옛 이동 손잡이(`.move-handle`,
//      네이티브 dragstart)는 걷었다. 보드의 drop 리스너는 동작 목록 카드 · 루틴 카드의 네이티브 끌어다 놓기만 받는다.
//   5. 커맨드·협력자는 전부 **주입**받는다 — usecases 도, 형제 input 모듈도 import 하지 않는다.
//      import 하는 것은 domContract(같은 rank 3 의 유일한 예외)와 domain 순수 함수뿐이다.

import { SEL, CLS, DATA } from '../ui/domContract.js';
import { dragPreviewCount, resizeBlocked, resolveGrabZone, BODY_LONG_PRESS_MS, LONGPRESS_MOVE_THRESHOLD_PX } from '../domain/gestureMath.js';
import * as gesture from '../domain/boardGesture.js';
import { groupCount } from '../domain/placements.js';
import { linearOf } from '../domain/grid.js';
import { planNudge } from '../domain/keyboardEdit.js';
import { groupSpan, presentOnly } from '../domain/selection.js';

/**
 * 보드 하나에 위임 리스너를 건다.
 *
 * @param {Object} deps
 * @param {HTMLElement} deps.el              보드 루트(`#board` / `#reBoard`). 원본 ctx.el.
 * @param {'main'|'routine'} deps.boardId
 * @param {Object} deps.store                app/main 이 만든 store 인스턴스(읽기 전용으로만 쓴다)
 * @param {Object} deps.commands             보드에 미리 묶인 커맨드 파사드(아래 표 참조)
 * @param {(dirty: object) => void} deps.render
 * @param {Object} deps.overlays             ui/overlays 인스턴스(두 보드 공유 — 메서드가 boardId 를 받는다)
 * @param {Object} deps.hitTest              input/hitTest 모듈 네임스페이스 그대로
 *   (`import * as hitTest from './hitTest.js'` — hitTest(x, y, opts) 와 cellIndexAt 만 쓴다)
 * @param {Object} deps.dragSession          input/dragSession 인스턴스(앱 전체에 하나)
 * @param {Object} deps.pointerSession       input/pointerSession 인스턴스(앱 전체에 하나)
 * @param {Object} deps.touchDrag            input/touchDrag 인스턴스(이 보드의 것)
 * @param {Object} deps.quickPicker          ui/quickPicker 인스턴스(이 보드의 것)
 * @param {Object} [deps.routineActionPopup] ui/routineActionPopup (메인 보드만 쓴다)
 * @param {Object} [deps.placementActionPopup] ui/placementActionPopup (2026-09-21 — 손가락으로 한 번 누르면 뜬다.
 *   2026-11-02 RM-11 까지는 창 폭(isTouchLayout)으로 갈랐고, 이제 그 누름의 pointerType 으로 가른다)
 * @param {Object} [deps.rowActionPopup]     ui/rowActionPopup (2026-11-02 RM-16, 행 라벨 우클릭 · 길게 누르기 — 메인 보드만)
 * @param {Function} [deps.longPress]        adapters/browser.longPress — 행 라벨 길게 누르기와 손가락 몸통 옮기기(RM-12)에 쓴다
 *   (없으면 행 라벨은 우클릭만, 손가락으로는 블록을 옮기지 못한다)
 * @param {Function} [deps.rowLabelTap]      (row, clientX, clientY) => void — 행 라벨을 한 번 눌렀다(2026-11-03 RM-23,
 *   파트 범위 고르기 · 접고 펴기 — 메인 보드만). input 은 ui 를 import 하지 않으므로 app/main 이 ui/partView 를 묶어 준다
 * @param {Object} [deps.policy]             기본값 store.policy(boardId)
 * @param {Document} [deps.doc]              기본값 document (document pointerup 등록 대상)
 * @returns {{ boardId: string, el: HTMLElement }}
 *
 * commands 파사드(전부 이 보드의 boardId 가 이미 묶여 있어야 한다):
 *   placeMove({ moveId, startRow, startIndex, totalCount }) -> Dirty
 *   placeRoutine({ routineId, startRow, startIndex })       -> Dirty
 *   moveGroup({ groupId, targetRow, targetStartIndex })     -> Dirty
 *   copyGroup({ groupId, targetRow, targetStartIndex })     -> Dirty
 *   removeGroup({ groupId })                                -> Dirty
 *   selectOnly({ groupId })                                 -> Dirty   그냥 클릭(RM-14)
 *   toggleSelection({ groupId })                            -> Dirty   Ctrl/Cmd+클릭
 *   selectRange({ groupId })                                -> Dirty   Shift+클릭
 *   selectInRect({ rect })                                  -> Dirty   빈 칸 끌기 네모(RM-14)
 *   moveSelection({ delta })                                -> Dirty   고른 묶음을 같은 거리로(RM-14 묶음 끌기)
 *   commitHistory()                                         -> Dirty|void   (saveHistory / saveHistoryRe)
 */
export function createBoardController(deps) {
  const {
    el,
    boardId,
    store,
    commands,
    render,
    overlays,
    hitTest,
    dragSession,
    pointerSession,
    touchDrag,
    quickPicker,
    placementActionPopup = null,
    rowActionPopup = null,
    longPress = null,
    rowLabelTap = null,
    routineActionPopup = null,
    policy = store.policy(boardId),
    doc = document
  } = deps;

  // ── 상태 읽기 도우미 ────────────────────────────────────────────────────────
  // ⚠ store.update 는 매번 새 최상위 상태 객체를 만든다. 값을 캡처하지 말고 그때그때 읽어라.

  /** 원본 ctx.rows/cols/placements 에 해당하는 BoardDoc. */
  const board = () => store.board(boardId);
  /** 원본의 가변 모듈 전역 DEFAULT_COUNT(1384). */
  const defaultCount = () => store.get().session.defaultCount;
  /** 원본 ctx.quickPlaceMode. 보드별로 완전히 독립이다. */
  const quickPlaceMode = () => store.get().session.quickPlaceMode[boardId];
  /** 원본 ctx.activePaletteMove. 루틴 보드 쪽은 항상 null 이다(reState 에 null 만 대입된다). */
  const activePaletteMove = () => store.get().session.activePaletteMove[boardId];
  /** 원본 pointerToCellIndex(track, clientX, ctx). */
  const cellIndex = (track, clientX) => hitTest.cellIndexAt(track, clientX, board());
  /** 원본 ctx.drag. ⚠ boardId 를 넘겨야 "이 보드가 받아들이는 드래그"만 보인다(dragSession 계약). */
  const currentDrag = () => dragSession.current(boardId);
  /** 원본 `document.elementFromPoint(x, y)?.closest('.track')` + 보드 포함 판정 + 앵커 폴백. */
  const hitAt = (clientX, clientY, options = {}) =>
    hitTest.hitTest(clientX, clientY, { doc, boardEl: el, board: board(), boardId, ...options });

  /** Dirty 를 그린다. 커맨드가 NONE(={}) 이나 void 를 돌려줘도 안전하다. */
  const apply = (dirty) => { if (dirty) render(dirty); };
  /** 원본 _saveHistory() — saveHistory() 또는 saveHistoryRe(). */
  const commit = () => apply(commands.commitHistory());

  /**
   * 원본 updatePreview(row, startIndex, undefined, ctx)(3900-3906)의 카운트 결정부.
   * overrideCount 가 없을 때 ctx.drag 의 종류로 카운트를 정하던 부분만 여기로 올라왔다.
   * ⚠ drag 가 없으면 원본은 clearPreview() 를 부른 **뒤** 조기 반환한다(3901-3902).
   */
  function updatePreviewFromDrag(row, startIndex) {
    const bundleDrag = currentDrag();
    if (bundleDrag?.type === 'placement-move' && bundleDrag.bundle) { updateBundlePreview(bundleDrag, row, startIndex); return; }
    const count = dragPreviewCount(currentDrag(), defaultCount(), board().placements);
    if (count == null) { overlays.clearPreview(boardId); return; }
    overlays.updatePreview(boardId, row, startIndex, count);
  }

  // ── 묶음 끌기 (RM-14) ──────────────────────────────────────────────────────
  // 고른 블록(둘 이상) 가운데 하나의 몸통을 끌면 묶음 전체가 같은 거리로 간다(RM-12 전에는 왼쪽 손잡이였다). 거리는 「끄는 블록의 시작 → 놓은 칸」의
  // 선형 카운트 차이이고, 옮기기는 화살표와 같은 moveSelection(planNudge — 하나라도 못 가면 아무것도 안 옮김)이다.

  /**
   * 이 블록을 끌면 함께 갈 묶음. 고른 블록이고 고른 것이 둘 이상일 때만 — 하나뿐이면 지금처럼 그 블록만 옮긴다.
   * @param {string} groupId
   * @returns {string[]|null}
   */
  // @complexity time=O(p+k) space=O(k) cc=3
  function bundleOf(groupId) {
    const selection = store.get().selection;
    if (!policy.allowsSelection || !selection.has(groupId)) return null;
    const ids = presentOnly(board(), selection);
    return ids.length > 1 ? ids : null;
  }

  /**
   * 끄는 블록의 시작에서 놓을 칸까지의 거리(선형 카운트). 블록이 사라졌으면 null.
   * @returns {number|null}
   */
  // @complexity time=O(p) space=O(1) cc=2
  function bundleDelta(drag, row, startIndex) {
    const span = groupSpan(board(), drag.groupId);
    return span ? linearOf(row, startIndex, board().cols) - span.start : null;
  }

  /**
   * 묶음이 놓일 자리를 블록마다 프리뷰로 그린다 — 미리보기 = 결과. 하나라도 못 가면(놓아도 안 옮겨지면) 프리뷰를 지운다.
   * @returns {void}
   */
  // @complexity time=O(k·p) space=O(k) cc=3
  function updateBundlePreview(drag, row, startIndex) {
    const delta = bundleDelta(drag, row, startIndex);
    const plan = delta === null ? null : planNudge(board(), presentOnly(board(), drag.bundle), delta);
    if (!plan) { overlays.clearPreview(boardId); return; }
    const placements = board().placements;
    overlays.updateBundlePreview(boardId,
      plan.map(step => ({ row: step.row, startIndex: step.startIndex, count: groupCount(placements, step.groupId) })),
      `${plan.length}개 함께`);
  }

  // ── 그리기·빠른 배치·더블탭의 상태 (RM-08) ──────────────────────────────────
  // 원본의 drawState / quickDrawState / quickTouchAnchor / lastTapTime·lastTapGroupId 넷이 한 벌이 됐다.
  // 판단은 domain/boardGesture 의 전이 함수가 하고, 리스너는 이벤트를 값으로 바꿔 넘긴 뒤
  // 돌려받은 할 일을 **차례대로** 실행할 뿐이다.
  // ⚠ 같은 pointerdown 에서 세 갈래(⑨ → ⑱ → ㉒)가 차례로 돈다. 앞 갈래가 바꾼 상태를 뒤 갈래가 본다 —
  //   그래서 상태는 갈래마다가 아니라 이 한 변수에 둔다.
  let gestureState = gesture.initialGestureState();
  /**
   * 네모 고르기 · 몸통 끌기 · 트리밍을 놓은 뒤 따라오는 합성 click 을 한 번 삼킨다(RM-14 · RM-12). mousedown(빈 칸)과 mouseup(다른 칸)의 공통 조상에 click 이
   * 오고, 그것이 보드의 「빈 곳 누름 = 선택 풀기」(input/controls) 로 가 방금 고른 것을 풀어 버리기 때문이다.
   * ⚠ 다음 mousedown 에서 되돌린다 — 보드 밖에서 뗀 끌기는 click 이 오지 않아 그대로 두면 다음 진짜 클릭을 삼킨다.
   * ⚠ 보드 click 리스너 가운데 이 컨트롤러의 것이 먼저 등록된다(app/main 의 차례) — stopImmediatePropagation 이 그래서 먹는다.
   */
  let swallowClick = false;

  /** 전이 함수가 이벤트마다 읽는 세션 값과 측정 함수. 측정은 전이 함수가 부를 때만 일어난다. */
  const gestureEnv = () => ({
    quickPlaceMode: !!quickPlaceMode(),
    marquee: !!policy.allowsSelection,
    activeMove: activePaletteMove() || null,
    defaultCount: defaultCount(),
    board: board(),
    colAt: cellIndex,
    endAt: resolveEnd,
    hitAt: (x, y) => hitAt(x, y),
  });

  /**
   * 전이 함수 하나를 돌리고 할 일을 실행한다.
   * ⚠ 상태를 먼저 바꾸고 할 일을 실행한다. 할 일 중 무엇도 이 상태를 다시 읽지 않는다(커맨드·오버레이·팝업뿐).
   */
  // @complexity time=O(f) space=O(1) cc=24
  function step(transition, e, ev) {
    const { state, effects } = transition(gestureState, ev, gestureEnv());
    gestureState = state;
    for (const fx of effects) {
      switch (fx.kind) {
        case 'preventDefault': e.preventDefault(); break;
        case 'stopPropagation': e.stopPropagation(); break;
        case 'preview': overlays.updatePreview(boardId, fx.row, fx.startIndex, fx.count); break;
        case 'clearPreview': overlays.clearPreview(boardId); break;
        case 'place':
          apply(commands.placeMove({ moveId: fx.moveId, startRow: fx.startRow, startIndex: fx.startIndex, totalCount: fx.totalCount }));
          break;
        case 'commit': commit(); break;
        // RM-12 — 가장자리 트리밍. 끄는 동안의 프리뷰 · 뗄 때의 확정은 pointerSession 이 document 에서 한다.
        case 'startTrim':
          if (isFinger(e)) overlays.hideFloatingTooltip();
          pointerSession.start(boardId, fx.groupId, fx.clientX, fx.edge);
          swallowClick = true;
          break;
        // RM-12 — 몸통 끌기. 세션 · 프리뷰는 옛 이동 손잡이(dragstart · dragover)가 쓰던 그것이다.
        case 'beginMove': beginPlacementMove(fx.groupId, fx.copy, fx.bundle); break;
        case 'movePreview': updatePreviewFromDrag(fx.row, fx.startIndex); break;
        case 'endMove': endPlacementMove(); break;
        case 'move': apply(commands.moveGroup({ groupId: fx.groupId, targetRow: fx.row, targetStartIndex: fx.startIndex })); break;
        case 'copy': apply(commands.copyGroup({ groupId: fx.groupId, targetRow: fx.row, targetStartIndex: fx.startIndex })); break;
        case 'moveBundle': moveBundle(fx.groupId, fx.row, fx.startIndex); break;
        case 'swallowClick': swallowClick = true; break;
        case 'openGroupPicker': quickPicker?.openForGroup(fx.groupId, fx.clientX, fx.clientY); break;
        case 'openPicker': quickPicker.open(fx.row, fx.startIndex, fx.clientX, fx.clientY, fx.count); break;
        // RM-14 네모 고르기 — 끄는 동안은 점선 네모만, 뗄 때 한 번 고른다(커밋 없음 — 선택은 히스토리에 들지 않는다)
        case 'marquee': overlays.showMarquee(boardId, fx.rect); break;
        case 'clearMarquee': overlays.clearMarquee(boardId); break;
        case 'selectRect':
          if (typeof commands.selectInRect === 'function') apply(commands.selectInRect({ rect: fx.rect }));
          swallowClick = true;
          break;
        case 'openRowMenu': rowActionPopup?.open({ row: fx.row, first: fx.first, last: fx.last }, fx.clientX, fx.clientY); break;
        default: throw new Error(`boardController: 모르는 할 일 ${fx.kind}`);
      }
    }
  }

  /**
   * 블록 옮기기를 연다 — 몸통을 끌기 시작한 때(RM-12). 옛 이동 손잡이의 dragstart(2476-2487)가 하던 일 그대로다:
   * 세션을 열고, 옮기기면 끌리는 블록(묶음이면 묶음 전체)에 표시를 붙인다. 복사는 원본이 그대로라 표시하지 않는다.
   */
  // @complexity time=O(k) space=O(1) cc=3
  function beginPlacementMove(groupId, copyMode, bundle) {
    dragSession.begin('placement-move', { groupId, copyMode, bundle }, { boards: [boardId] });
    overlays.hideFloatingTooltip();
    if (!copyMode) for (const id of bundle || [groupId]) overlays.markDraggingGroup(boardId, id);
  }

  /** 블록 옮기기를 닫는다 — 옛 dragend(2489-2495) 그대로. 놓기(move · copy)보다 먼저 불린다. */
  // @complexity time=O(1) space=O(1) cc=1
  function endPlacementMove() {
    dragSession.end();
    overlays.clearTrackHighlights(boardId);
    overlays.clearPreview(boardId);
    overlays.unmarkDraggingGroups(boardId);
  }

  /**
   * 묶음 끌기를 놓는다(RM-14) — 옮겼을 때만 한 번 커밋한다. 막혔거나(표 밖) 제자리면 히스토리에 한 칸도 늘지 않는다.
   * @param {string} groupId  끈 블록
   */
  // @complexity time=O(k·p) space=O(k) cc=3
  function moveBundle(groupId, row, startIndex) {
    const delta = bundleDelta({ groupId }, row, startIndex);
    const dirty = delta ? commands.moveSelection({ delta }) : null;
    if (dirty) apply(dirty);
    if (dirty?.boards) commit();
  }

  /**
   * 마우스 그리기·빠른 배치 끌기의 끝점 해석(원본 2631-2635 · 2647-2651 · 2668-2672 · 2744-2747).
   * ⚠ 보드 밖으로 끌면 앵커 트랙으로 되돌아간다 — "보드 밖에서도 카운트가 시작 행 기준"이라는
   *   관찰 동작이다. hitTest 의 fallbackTrack/fallbackRow 가 그 세 줄을 그대로 낸다.
   */
  function resolveEnd(anchor, clientX, clientY) {
    const hit = hitAt(clientX, clientY, { fallbackTrack: anchor.track, fallbackRow: anchor.row });
    return { endRow: hit.row, endCol: hit.col };
  }

  /**
   * 마지막 pointerdown 의 종류. click(④)이 PointerEvent 라 pointerType 을 들고 오는 브라우저(Chrome 90+ · Firefox 97+ ·
   * Safari 17+)에서는 그것을 쓰고, 아니면 이것으로 가른다 — click 은 언제나 그 누름의 pointerdown 뒤에 온다.
   */
  let lastPointerType = 'mouse';
  const clickPointerType = (e) => e.pointerType || lastPointerType;

  // ── ① dragover (2394-2401) ─────────────────────────────────────────────────
  // ⚠ 여기만 elementFromPoint 가 아니라 e.target.closest 를 쓴다 — hitTest 로 바꾸지 마라.
  el.addEventListener('dragover', (e) => {
    const track = e.target.closest(SEL.track);
    if (!track) return;
    e.preventDefault();
    overlays.clearTrackHighlights(boardId);
    track.classList.add(CLS.dropHover);
    updatePreviewFromDrag(Number(track.dataset[DATA.row]), cellIndex(track, e.clientX));
  });

  // ── ② dragleave (2403-2409) ────────────────────────────────────────────────
  // ⚠ clearPreview 는 하지 않는다(원본에 없다).
  el.addEventListener('dragleave', (e) => {
    const track = e.target.closest(SEL.track);
    if (!track) return;
    const related = e.relatedTarget;
    if (related && track.contains(related)) return;
    track.classList.remove(CLS.dropHover);
  });

  // ── ③ drop (2411-2433) ─────────────────────────────────────────────────────
  el.addEventListener('drop', (e) => {
    const track = e.target.closest(SEL.track);
    if (!track) return;
    e.preventDefault();
    overlays.clearTrackHighlights(boardId);
    const row = Number(track.dataset[DATA.row]);
    const startIndex = cellIndex(track, e.clientX);
    overlays.clearPreview(boardId);
    const drag = currentDrag();
    // ⚠ 블록 옮기기(placement-move) 갈래는 없다 — RM-12 부터 블록은 네이티브 드래그가 아니라 몸통 포인터 끌기로 옮긴다
    //   (step 의 move · copy · moveBundle). 여기 오는 것은 동작 목록 카드와 루틴 카드뿐이다.
    if (drag?.type === 'palette') {
      apply(commands.placeMove({ moveId: drag.moveId, startRow: row, startIndex, totalCount: defaultCount() }));
      commit();
    } else if (drag?.type === 'routine' && policy.allowsRoutineBlocks) {   // 2429 `ctx === mainCtx`
      apply(commands.placeRoutine({ routineId: drag.routineId, startRow: row, startIndex }));
      commit();
    }
    // 2432 `ctx.drag = null` — 세션이 하나라 모든 보드에서 끝난다(dragSession 계약).
    dragSession.end();
  });

  // ── ④ click — 선택 토글 / 루틴 팝업 (2435-2465) ────────────────────────────
  el.addEventListener('click', (e) => {
    // 네모 고르기 · 묶음 끌기 뒤의 합성 click — 방금 고른 것을 풀지 않게 한 번 삼킨다(RM-14)
    if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
    // 가장자리 손잡이 클릭은 무시 (트리밍 용도)
    if (e.target.closest(SEL.edgeHandles)) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl) return;
    // 2446 `if (ctx !== mainCtx) return;` — 고르기가 없는 보드(루틴 편집)는 블록 팝업이 있을 때 손가락 탭만 받는다(RM-12).
    if (!policy.allowsSelection && !placementActionPopup) return;

    const groupId = placementEl.dataset[DATA.groupId];

    // `✎` — 이 블록의 동작 정하기(2026-09-20). 선택 토글보다 **먼저** 본다. 이 단추는 고른 블록에만
    // 뜨므로 여기 닿았다는 것은 이미 고른 블록이라는 뜻이고, 토글로 넘기면 팝업을 여는 클릭이
    // 선택을 풀어 버려 단추가 손 밑에서 사라진다.
    if (e.target.closest(SEL.nameBtn)) {
      e.stopPropagation();
      quickPicker?.openForGroup(groupId, e.clientX, e.clientY);
      return;
    }

    // 무엇을 하나 — 루틴 팝업 · 블록 동작 팝업 · 선택 토글. 갈림은 domain/boardGesture.placementTapRoute 가 **그 누름의
    // pointerType** 으로 정한다(RM-11, 2026-11-02 — 그전에는 창 폭 isTouchLayout 이었다).
    const route = gesture.placementTapRoute({
      pointerType: clickPointerType(e),
      isRoutine: placementEl.classList.contains(CLS.isRoutine),
      hasActionPopup: !!placementActionPopup,
    });

    // 루틴 배치 단일 클릭 → 편집/삭제 팝업
    if (route === 'routine-popup') {
      const placement = board().placements.find(p => p.groupId === groupId);
      if (!placement) return;
      e.stopPropagation();
      routineActionPopup?.open(placement, e.clientX, e.clientY);
      return;
    }

    // ── 손가락: 한 번 탭하면 **무엇을 할 수 있는지**가 팝업으로 뜬다 (2026-09-21) ──
    // 그전에는 탭 = 고르기, 두 번 탭 = 지우기였는데 둘 다 손가락에게 불친절했다(팝업 파일의 주석).
    // ⚠ 여기 `click` 에서 연다. pointerdown 에서 열면 블록을 짚고 표를 굴리는 흔한 동작이 죽는다.
    //   합성 click 은 손가락이 움직이면 아예 안 온다 — 브라우저가 이미 "탭인가 스크롤인가"를 가려 주는 셈이라
    //   그 판정을 다시 만들지 않는다.
    if (route === 'action-popup') {
      e.stopPropagation();
      const placement = board().placements.find(p => p.groupId === groupId);
      if (!placement) return;
      placementActionPopup.open(placement, e.clientX, e.clientY, groupCount(board().placements, groupId));
      return;
    }

    if (!policy.allowsSelection) return;   // 고르기가 없는 보드의 마우스 클릭은 아무 일도 없다(2446)
    // 일반 배치 클릭 → 고르기(RM-14 · Q84 편집기 관습). 그냥 클릭은 **그것만**, Ctrl/Cmd+클릭은 더하기/빼기, Shift+클릭은 범위.
    // 2026-11-02 전에는 클릭이 더하기/빼기였다(원본 2453-2465). 뜻의 판정은 domain/selection 이 하고 여기는 글쇠만 읽는다.
    // ⚠ 클래스 토글(2461-2463)은 Dirty.selection → boardView.setSelected 가 한다.
    //   행을 다시 그리는 것으로 대체하지 마라(드래그·툴팁·포커스가 끊긴다).
    e.stopPropagation();
    if (e.shiftKey) apply(commands.selectRange({ groupId }));
    else if (e.ctrlKey || e.metaKey) apply(commands.toggleSelection({ groupId }));
    else apply(commands.selectOnly({ groupId }));
  });

  // ── ④-b contextmenu — 마우스에서도 같은 팝업에 닿는 길 (2026-09-21) ───────
  // ⚠ 마우스의 한 번/두 번 클릭은 그대로 둔다(손에 익었고 과녁도 충분하다). 우클릭은 **더하는**
  //   길이라 빼앗는 것이 없다 — 동작 목록의 이름도 같은 관습이다(우클릭·롱프레스로 메뉴).
  el.addEventListener('contextmenu', (e) => {
    // 손가락으로 길게 눌러 블록을 옮기는 중(RM-12)이면 안드로이드가 뒤늦게 보내는 contextmenu 로 팝업을 열지 않는다
    if (currentDrag()?.isTouchDragging) { e.preventDefault(); return; }
    // 루틴 편집 보드도 연다(RM-12 — 두 번 누르기가 지우지 않아 거기서는 이 팝업의 `× 지우기` 가 지우는 길이다)
    if (!placementActionPopup) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl || placementEl.classList.contains(CLS.isRoutine)) return;
    e.preventDefault();
    const groupId = placementEl.dataset[DATA.groupId];
    const placement = board().placements.find(p => p.groupId === groupId);
    if (!placement) return;
    placementActionPopup.open(placement, e.clientX, e.clientY, groupCount(board().placements, groupId));
  });

  // ── ④-c 행 라벨 우클릭 · 길게 누르기 — 마디 메뉴 (2026-11-02, RM-16) ─────────
  // 블록의 우클릭(④-b)보다 **뒤에** 걸린다. 라벨은 블록이 아니라 서로 겹치지 않지만, 두 리스너가 같은 이벤트를
  // 보므로 각자 자기 과녁(closest)만 본다. 판정(몸통 행인가)은 domain/boardGesture.rowLabelPress 가 한다.
  // @complexity time=O(d) space=O(1) cc=2
  const rowLabelEv = (target, x, y) => {
    const label = target.closest(SEL.rowLabel);
    return { row: label ? Number(label.dataset[DATA.row]) : null, x, y };
  };
  if (rowActionPopup) {
    el.addEventListener('contextmenu', (e) => step(gesture.rowLabelPress, e, rowLabelEv(e.target, e.clientX, e.clientY)));
    // 터치는 길게 누르기 — 동작 카드의 메뉴와 같은 0.48초 · 8px 규칙이다. preventDefault 는 없다(passive).
    if (typeof longPress === 'function') {
      longPress(el, {
        delayMs: 480, moveTolerancePx: 8, resetOnStart: true,
        onLongPress: ({ x, y, event }) => step(gesture.rowLabelPress, event, rowLabelEv(event.target, x, y)),
      });
    }
  }

  // ── ④-d 행 라벨 한 번 누르기 — 파트 범위 고르기 · 접고 펴기 (2026-11-03, RM-23) ──────────
  // 우클릭(④-c)과 겹치지 않는다(우클릭은 click 이 아니다). 길게 누르기 뒤에 오는 합성 click 은 마디 메뉴가 떠 있으면 버린다.
  // intro 행(row 0)은 파트가 될 수 없어 넘긴다 — 판정의 주인은 domain/parts(draftPart 가 null) 지만 여기서 일찍 거른다.
  if (typeof rowLabelTap === 'function') {
    // @complexity time=O(d) space=O(1) cc=4
    el.addEventListener('click', (e) => {
      const label = e.target.closest(SEL.rowLabel);
      if (!label || rowActionPopup?.current?.()) return;
      const row = Number(label.dataset[DATA.row]);
      if (!(row >= 1)) return;
      rowLabelTap(row, e.clientX, e.clientY);
    });
  }

  // ── ⑤ dblclick — 마우스 두 번 누르기 = 동작 고르기 창 (2467-2474) ──────────────────────
  // RM-12(2026-11-03) 전에는 확인 없이 **지웠다**. 이제 `✎` 가 여는 그 창을 연다 — 지우기는 Delete · 팝업 · 루틴 팝업으로만.
  el.addEventListener('dblclick', (e) => {
    // `✎` 를 두 번 누른 것은 첫 클릭이 이미 창을 열었다 — 다시 열지 않는다.
    if (e.target.closest(SEL.nameBtn)) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl) return;
    // 2470: 루틴은 팝업으로 처리 (`ctx === mainCtx`)
    if (placementEl.classList.contains(CLS.isRoutine) && policy.allowsRoutineBlocks) return;
    quickPicker?.openForGroup(placementEl.dataset[DATA.groupId], e.clientX, e.clientY);
  });

  // ⑥ dragstart · ⑦ dragend (2476-2495) 는 RM-12 에서 걷었다 — 블록에 draggable 이 없다(몸통 포인터 끌기가 대신한다).

  // ── 포인터 한 벌(RM-11, 2026-11-02) — 원본 ⑧~⑫ · ⑮~㉕ 가 pointer* 네 리스너로 합쳐졌다 ──────────
  // 마우스인가 손가락인가는 창 폭이 아니라 **그 누름의 pointerType** 으로 가른다(gesture.pointerKind).
  // 어느 전이를 돌릴지는 gesture.transitionsFor 가 원본 리스너 차례대로 돌려준다 — 리스너는 종류를 묻지 않는다.
  //
  // ⚠ 원본과 같은 것: 한 pointerdown 에서 블록(⑧ · ⑨ — RM-12 부터 가장자리 · 몸통) → 더블탭(⑨) → 그리기(⑮ · ⑱) →
  //   빠른 배치(㉒) 차례. 블록에 닿은 누름은 그리기 전이에 넘겨도 onPlacement 라 no-op 이다 — 그래서 트리밍은 바로 돌아간다.
  // ⚠ 뗌(up)은 보드가 아니라 document 에서 듣는다 — 원본 ⑰ 이 그랬고(보드 밖에서 떼도 놓인다), 보드마다 하나씩
  //   총 2개가 붙는 것도 같다. 손가락은 pointerdown 과녁에 묵시적으로 붙잡혀(implicit capture) 보드 밖에서 떼도 온다.
  // ⚠ touchstart 의 preventDefault 가 막던 「손잡이 누른 채 페이지 스크롤」은 이제 CSS `touch-action: none`
  //   (`.trim-handle` · `.resize-handle`)이 막는다 — 포인터 이벤트의 preventDefault 는 스크롤을 막지 못한다.
  //   몸통은 스크롤을 열어 둔다(RM-12 — 블록을 짚고 표를 굴린다). 길게 눌러 옮기기가 시작된 뒤에만 touchmove 를 막는다.
  // ⚠ click 은 PointerEvent 가 아닌 브라우저가 있어 pointerdown 의 종류를 기억해 둔다(lastPointerType).

  const isFinger = (e) => gesture.pointerKind(e.pointerType) === 'touch';

  /** 포인터 이벤트 → 전이 함수가 읽는 값. 트랙과 블록 위인지는 e.target 으로 본다(마우스 전이가 쓴다 — elementFromPoint 아님). */
  const pointerEv = (e) => {
    const track = e.target.closest(SEL.track);
    return {
      x: e.clientX, y: e.clientY, track,
      row: track ? Number(track.dataset[DATA.row]) : null,
      onPlacement: !!e.target.closest(SEL.placementOrHandles),
    };
  };
  /** 한 단계의 전이 함수들을 차례대로 돌린다. */
  const steps = (fns, e, ev) => { for (const fn of fns) step(fn, e, ev); };

  // ── pointerdown — 블록(⑧ · ⑨ — 가장자리 · 몸통) → 더블탭(⑨) → 그리기 · 빠른 배치 · 네모 고르기(⑮ · ⑱ · ㉒ · RM-14) ──────
  el.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType || 'mouse';
    swallowClick = false;   // RM-14 — 지난 네모가 남긴 「다음 click 삼키기」는 새 누름에서 풀린다
    const placementEl = e.target.closest(SEL.placement);
    // 블록 위의 왼쪽 단추 누름(RM-12) — 누른 자리를 블록 폭으로 재어 가장자리 · 몸통으로 가른다. `✎` 는 비켜 간다(click 이 연다).
    if (placementEl && !(e.button > 0) && !e.target.closest(SEL.nameBtn)) {
      const groupId = placementEl.dataset[DATA.groupId];
      const rect = placementEl.getBoundingClientRect();
      // 2503: 메인 보드의 루틴 블록은 트리밍 금지 (`ctx === mainCtx`) — 양쪽 가장자리 모두, 마우스 · 손가락 모두(RM-11 · RM-12).
      const routineGuarded = resizeBlocked({ isRoutine: placementEl.classList.contains(CLS.isRoutine), allowsRoutineBlocks: !!policy.allowsRoutineBlocks });
      const zone = resolveGrabZone(e.clientX - rect.left, rect.width);
      step(gesture.placementDown, e, {
        x: e.clientX, y: e.clientY, groupId, zone, routineGuarded, altKey: !!e.altKey, pointerType: e.pointerType,
        bundle: bundleOf(groupId),
      });
      if (pointerSession.isActive(boardId)) return;   // 트리밍이 시작됐다 — 그리기 전이에 넘기지 않는다
      // 두 번 탭(손가락) — 블록 동작 팝업이 있는 보드에서는 닫는다(2026-09-21): 첫 탭이 연 팝업 **위로** 둘째 탭이 떨어진다.
      if (isFinger(e) && !placementActionPopup) {
        step(gesture.placementTap, e, { now: Date.now(), groupId, routineGuarded, x: e.clientX, y: e.clientY });
      }
    }
    // 블록이 아닌 누름은 그리기 · 빠른 배치로 간다(⑮). 손가락은 ⑱ → ㉒ 차례(같은 touchstart 의 세 리스너).
    steps(gesture.transitionsFor(e.pointerType).down, e, pointerEv(e));
  });

  // ── pointermove — 손가락 블록 이동(⑩) · 그리기 카운트(⑯ · ⑲ · ㉓) ────────────────────────
  // ⚠ 늘이기 프리뷰(⑩ 의 앞 갈래)는 여기 없다 — pointerSession 이 document 에서 마우스·손가락을 한 길로 듣는다.
  el.addEventListener('pointermove', (e) => {
    if (pointerSession.isActive(boardId)) return;
    if (isFinger(e)) {
      const drag = currentDrag();
      if (drag?.type === 'placement-move' && drag.isTouchDragging) {
        e.preventDefault();
        touchDrag.moveGhost(e.clientX, e.clientY);
        return;
      }
    } else {
      step(gesture.bodyMove, e, { x: e.clientX, y: e.clientY });   // RM-12 몸통 끌기 — 누르지 않았으면 아무 일도 없다
    }
    steps(gesture.transitionsFor(e.pointerType).move, e, pointerEv(e));
  });

  // ── 손가락 몸통 옮기기 — 길게 누르기(RM-12, 계획서 결정 「길게 눌러야 옮기기」) ─────────────────────
  // 몸통은 스크롤을 열어 두므로(CSS `.placement` 의 touch-action) 짚고 굴리면 화면이 넘어가고, 그 전에 8px 넘게 움직이면
  // 시계가 풀린다. 움직이지 않고 BODY_LONG_PRESS_MS 를 채우면 옛 이동 손잡이와 같은 손가락 끌기(touchDrag)가 시작된다.
  // ⚠ 끌기가 시작된 뒤의 첫 touchmove 를 막아야 브라우저가 스크롤을 열지 않는다(pointercancel 로 끌기를 빼앗기지 않는다) —
  //   동작 목록 카드의 길게 누르기(input/paletteInput)와 같은 장치다. 몸짓은 위 pointermove 가 듣는다.
  if (typeof longPress === 'function') {
    longPress(el, {
      delayMs: BODY_LONG_PRESS_MS, moveTolerancePx: LONGPRESS_MOVE_THRESHOLD_PX, resetOnStart: true,
      onLongPress: ({ x, y, event }) => {
        const placementEl = event.target.closest?.(SEL.placement);
        if (!placementEl || !placementEl.isConnected || event.target.closest(SEL.nameBtn)) return;
        if (pointerSession.isActive() || currentDrag()) return;
        const rect = placementEl.getBoundingClientRect();
        if (resolveGrabZone(x - rect.left, rect.width) !== 'body') return;
        overlays.showFloatingTooltip(placementEl);
        touchDrag.start(placementEl.dataset[DATA.groupId], x, y);
        swallowClick = true;   // 떼면 오는 합성 click 이 블록 팝업을 열지 않게
      },
    });
    el.addEventListener('touchmove', (e) => { if (currentDrag()?.isTouchDragging) e.preventDefault(); }, { passive: false });
  }

  // ── pointerup(보드) — 툴팁 · 손가락 블록 이동 종료(⑪) ───────────────────────────────────
  el.addEventListener('pointerup', (e) => {
    if (!isFinger(e)) return;
    overlays.hideFloatingTooltip();
    if (pointerSession.isActive(boardId)) return;   // 늘이기 종료는 pointerSession 의 document 리스너가 한다
    const drag = currentDrag();
    if (drag?.type !== 'placement-move' || !drag.isTouchDragging) return;
    touchDrag.finish(false);
  });

  // ── pointercancel(보드) — 손가락 블록 이동 취소(⑫) ─────────────────────────────────────
  el.addEventListener('pointercancel', (e) => {
    if (!isFinger(e)) return;
    overlays.hideFloatingTooltip();
    if (pointerSession.isActive(boardId)) return;
    const drag = currentDrag();
    if (drag?.type !== 'placement-move' || !drag.isTouchDragging) return;
    touchDrag.finish(true);
  });

  // ── document pointerup · pointercancel — 그리기 확정(⑰ · ⑳ · ㉔) · 취소(㉑ · ㉕) ─────────────
  // ⚠ el 이 아니라 document 에 붙는다. 보드마다 1개씩 총 2개가 등록되는 것이 원본(⑰)이다.
  // RM-12 몸통 끌기의 뗌 · 취소도 여기다 — 보드 밖에서 떼면 놓지 않고 끝낸다(bodyUp 이 hitAt 으로 가린다).
  doc.addEventListener('pointerup', (e) => {
    if (!isFinger(e)) step(gesture.bodyUp, e, { x: e.clientX, y: e.clientY });
    steps(gesture.transitionsFor(e.pointerType).up, e, pointerEv(e));
  });
  doc.addEventListener('pointercancel', (e) => {
    step(gesture.bodyCancel, e, null);
    steps(gesture.transitionsFor(e.pointerType).cancel, e, null);
  });

  // ── ⑬⑭ pointerenter / pointerleave — 툴팁 (2585-2596, capture:true) ──────────────────
  // ⚠ enter/leave 는 버블링하지 않으므로 capture 로 보드에서 가로챈다. 손가락은 누를 때 enter · 뗄 때 leave 가 온다.
  el.addEventListener('pointerenter', (e) => {
    const p = e.target.closest(SEL.placement);
    if (!p) return;
    overlays.showFloatingTooltip(p);
  }, true);
  el.addEventListener('pointerleave', (e) => {
    const p = e.target.closest(SEL.placement);
    if (!p) return;
    if (e.relatedTarget && p.contains(e.relatedTarget)) return;
    overlays.hideFloatingTooltip();
  }, true);

  return { boardId, el };
}
