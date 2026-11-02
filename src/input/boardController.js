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
//   5. 커맨드·협력자는 전부 **주입**받는다 — usecases 도, 형제 input 모듈도 import 하지 않는다.
//      import 하는 것은 domContract(같은 rank 3 의 유일한 예외)와 domain 순수 함수뿐이다.

import { SEL, CLS, DATA } from '../ui/domContract.js';
import { dragPreviewCount } from '../domain/gestureMath.js';
import * as gesture from '../domain/boardGesture.js';
import { groupCount } from '../domain/placements.js';

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
 *   toggleSelection({ groupId })                            -> Dirty
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
    const count = dragPreviewCount(currentDrag(), defaultCount(), board().placements);
    if (count == null) { overlays.clearPreview(boardId); return; }
    overlays.updatePreview(boardId, row, startIndex, count);
  }

  // ── 그리기·빠른 배치·더블탭의 상태 (RM-08) ──────────────────────────────────
  // 원본의 drawState / quickDrawState / quickTouchAnchor / lastTapTime·lastTapGroupId 넷이 한 벌이 됐다.
  // 판단은 domain/boardGesture 의 전이 함수가 하고, 리스너는 이벤트를 값으로 바꿔 넘긴 뒤
  // 돌려받은 할 일을 **차례대로** 실행할 뿐이다.
  // ⚠ 같은 pointerdown 에서 세 갈래(⑨ → ⑱ → ㉒)가 차례로 돈다. 앞 갈래가 바꾼 상태를 뒤 갈래가 본다 —
  //   그래서 상태는 갈래마다가 아니라 이 한 변수에 둔다.
  let gestureState = gesture.initialGestureState();

  /** 전이 함수가 이벤트마다 읽는 세션 값과 측정 함수. 측정은 전이 함수가 부를 때만 일어난다. */
  const gestureEnv = () => ({
    quickPlaceMode: !!quickPlaceMode(),
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
        case 'remove': apply(commands.removeGroup({ groupId: fx.groupId })); break;
        case 'commit': commit(); break;
        case 'openPicker': quickPicker.open(fx.row, fx.startIndex, fx.clientX, fx.clientY, fx.count); break;
        default: throw new Error(`boardController: 모르는 할 일 ${fx.kind}`);
      }
    }
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
    if (drag?.type === 'palette') {
      apply(commands.placeMove({ moveId: drag.moveId, startRow: row, startIndex, totalCount: defaultCount() }));
      commit();
    } else if (drag?.type === 'placement-move') {
      if (drag.copyMode) {
        apply(commands.copyGroup({ groupId: drag.groupId, targetRow: row, targetStartIndex: startIndex }));
      } else {
        apply(commands.moveGroup({ groupId: drag.groupId, targetRow: row, targetStartIndex: startIndex }));
      }
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
    // 핸들 클릭은 무시 (드래그/리사이즈 용도)
    if (e.target.closest(SEL.moveHandle) || e.target.closest(SEL.resizeHandle)) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl) return;
    if (!policy.allowsSelection) return;   // 2446 `if (ctx !== mainCtx) return;`

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

    // 일반 배치 클릭 → 선택 토글
    // ⚠ 클래스 토글(2461-2463)은 Dirty.selection → boardView.setSelected 가 한다.
    //   행을 다시 그리는 것으로 대체하지 마라(드래그·툴팁·포커스가 끊긴다).
    e.stopPropagation();
    apply(commands.toggleSelection({ groupId }));
  });

  // ── ④-b contextmenu — 마우스에서도 같은 팝업에 닿는 길 (2026-09-21) ───────
  // ⚠ 마우스의 한 번/두 번 클릭은 그대로 둔다(손에 익었고 과녁도 충분하다). 우클릭은 **더하는**
  //   길이라 빼앗는 것이 없다 — 동작 목록의 이름도 같은 관습이다(우클릭·롱프레스로 메뉴).
  el.addEventListener('contextmenu', (e) => {
    if (!placementActionPopup || !policy.allowsSelection) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl || placementEl.classList.contains(CLS.isRoutine)) return;
    e.preventDefault();
    const groupId = placementEl.dataset[DATA.groupId];
    const placement = board().placements.find(p => p.groupId === groupId);
    if (!placement) return;
    placementActionPopup.open(placement, e.clientX, e.clientY, groupCount(board().placements, groupId));
  });

  // ── ⑤ dblclick — 마우스 삭제 (2467-2474) ───────────────────────────────────
  el.addEventListener('dblclick', (e) => {
    // `✎` 를 두 번 누른 것은 "지워라"가 아니다 — 팝업을 열려다 손이 두 번 간 것이다.
    if (e.target.closest(SEL.nameBtn)) return;
    const placementEl = e.target.closest(SEL.placement);
    if (!placementEl) return;
    // 2470: 루틴은 팝업으로 처리 (`ctx === mainCtx`)
    if (placementEl.classList.contains(CLS.isRoutine) && policy.allowsRoutineBlocks) return;
    const groupId = placementEl.dataset[DATA.groupId];
    apply(commands.removeGroup({ groupId }));
    commit();
  });

  // ── ⑥ dragstart — 블록 이동/복사 (2476-2487) ───────────────────────────────
  // ⚠ copyMode(e.altKey)는 dragstart 시점에 **한 번만** 캡처한다. drop 에서 다시 읽지 않는다.
  el.addEventListener('dragstart', (e) => {
    // ⚠ 손가락 블록 이동(touchDrag)이 도는 중에 오는 네이티브 드래그(iOS 는 길게 누르면 draggable 을 끈다)는 막는다 —
    //   한 누름이 두 경로로 처리되지 않게(RM-11). 원본은 touchstart 의 preventDefault 가 이것까지 막았다.
    if (currentDrag()?.isTouchDragging) { e.preventDefault(); return; }
    const moveHandle = e.target.closest(SEL.moveHandle);
    if (!moveHandle) return;
    const placementEl = moveHandle.closest(SEL.placement);
    if (!placementEl) return;
    const groupId = placementEl.dataset[DATA.groupId];
    const copyMode = e.altKey;
    dragSession.begin('placement-move', { groupId, copyMode }, { boards: [boardId] });
    e.dataTransfer.effectAllowed = copyMode ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', groupId);
    if (!copyMode) overlays.markDraggingGroup(boardId, groupId);
  });

  // ── ⑦ dragend (2489-2495) ──────────────────────────────────────────────────
  el.addEventListener('dragend', (e) => {
    if (!e.target.closest(SEL.moveHandle)) return;
    dragSession.end();
    overlays.clearTrackHighlights(boardId);
    overlays.clearPreview(boardId);
    overlays.unmarkDraggingGroups(boardId);
  });

  // ── 포인터 한 벌(RM-11, 2026-11-02) — 원본 ⑧~⑫ · ⑮~㉕ 가 pointer* 네 리스너로 합쳐졌다 ──────────
  // 마우스인가 손가락인가는 창 폭이 아니라 **그 누름의 pointerType** 으로 가른다(gesture.pointerKind).
  // 어느 전이를 돌릴지는 gesture.transitionsFor 가 원본 리스너 차례대로 돌려준다 — 리스너는 종류를 묻지 않는다.
  //
  // ⚠ 원본과 같은 것: 한 pointerdown 에서 손잡이(⑧ · ⑨) → 더블탭(⑨) → 그리기(⑮ · ⑱) → 빠른 배치(㉒) 차례.
  //   손잡이에 닿은 누름은 그리기 전이에 넘겨도 onPlacement 라 no-op 이다 — 그래서 손잡이 갈래에서 바로 돌아간다.
  // ⚠ 뗌(up)은 보드가 아니라 document 에서 듣는다 — 원본 ⑰ 이 그랬고(보드 밖에서 떼도 놓인다), 보드마다 하나씩
  //   총 2개가 붙는 것도 같다. 손가락은 pointerdown 과녁에 묵시적으로 붙잡혀(implicit capture) 보드 밖에서 떼도 온다.
  // ⚠ touchstart 의 preventDefault 가 막던 「손잡이 누른 채 페이지 스크롤」은 이제 CSS `touch-action: none`
  //   (`.move-handle` · `.resize-handle`)이 막는다 — 포인터 이벤트의 preventDefault 는 스크롤을 막지 못한다.
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

  // ── pointerdown — 손잡이(⑧ · ⑨) → 더블탭(⑨) → 그리기 · 빠른 배치(⑮ · ⑱ · ㉒) ────────────────
  el.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType || 'mouse';
    const finger = isFinger(e);

    const resizeHandle = e.target.closest(SEL.resizeHandle);
    if (resizeHandle) {
      e.preventDefault();
      const placementEl = resizeHandle.closest(SEL.placement);
      if (!placementEl) return;
      // 2503: 메인 보드의 루틴 블록은 리사이즈 금지 (`ctx === mainCtx`) — 마우스에만 있던 가드다(원본 2513 터치에는 없다).
      if (!finger && placementEl.classList.contains(CLS.isRoutine) && policy.allowsRoutineBlocks) return;
      if (finger) overlays.hideFloatingTooltip();
      pointerSession.start(boardId, placementEl.dataset[DATA.groupId], e.clientX);
      return;
    }
    if (finger) {
      const moveHandle = e.target.closest(SEL.moveHandle);
      if (moveHandle) {
        e.preventDefault();
        const placementEl = moveHandle.closest(SEL.placement);
        if (!placementEl) return;
        overlays.showFloatingTooltip(placementEl);
        touchDrag.start(placementEl.dataset[DATA.groupId], e.clientX, e.clientY);
        return;
      }
      // 더블탭으로 배치 삭제 (move-handle, resize-handle, ✎ 외 영역 터치 시)
      // ⚠ **블록 동작 팝업이 있는 보드에서는 이 길을 닫는다**(2026-09-21 — 그때는 「팝업이 뜨는 폭」이었고, 2026-11-02 부터
      //   손가락이면 언제나 팝업이 뜨므로 팝업이 있는 보드 전부다). 지우기는 팝업 안에 있고, 그대로 두면
      //   첫 탭이 연 팝업 **위로** 둘째 탭이 떨어져 엉뚱한 줄이 눌린다(팝업이 누른 자리에 뜬다).
      if (e.target.closest(SEL.nameBtn)) return;
      if (!placementActionPopup) {
        const placementEl = e.target.closest(SEL.placement);
        if (placementEl) {
          // ⚠ 루틴 가드는 preventDefault 뒤에 온다(2539) — 그 차례는 gesture.placementTap 이 지킨다.
          step(gesture.placementTap, e, {
            now: Date.now(),
            groupId: placementEl.dataset[DATA.groupId],
            routineGuarded: placementEl.classList.contains(CLS.isRoutine) && !!policy.allowsRoutineBlocks,
          });
        }
      }
    }
    // 마우스 손잡이가 아닌 누름은 그리기 · 빠른 배치로 간다(⑮). 손가락은 ⑱ → ㉒ 차례(같은 touchstart 의 세 리스너).
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
    }
    steps(gesture.transitionsFor(e.pointerType).move, e, pointerEv(e));
  });

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
  doc.addEventListener('pointerup', (e) => steps(gesture.transitionsFor(e.pointerType).up, e, pointerEv(e)));
  doc.addEventListener('pointercancel', (e) => steps(gesture.transitionsFor(e.pointerType).cancel, e, null));

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
