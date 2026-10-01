// src/input/controls.js — 사이드바·툴바의 버튼/입력/파일 인풋 바인딩 + 단축키
//
// 원본 index.html 의 bindControls(2298-2388) 중
//   · 팔레트 컨텍스트 메뉴 닫기 리스너(2299-2304)  → ui/paletteView 가 소유한다
//   · 저장목록 정렬 버튼(2342-2355)                → ui/savedListsView 가 소유한다
// 두 덩어리를 뺀 전부와, onHotkey(2820-2831), init 의 보드 빈 영역 클릭 선택 해제(1527-1529),
// init 의 '+ 빠른 배치' 토글(1679-1694)을 옮겼다.
//
// ⚠ 링크바 바인딩(5217-5271)은 **하나도** 여기 없다 — ui/linksBarView 가 통째로 소유한다.
//
// ⚠ 히스토리 커밋 지점은 STAGE2 계약의 목록을 그대로 따른다.
//    커밋하는 것: addMove(3997) · clearBoard(4491) · applyBoardSizeFromInput(2961)
//    커밋하지 않는 것: setDefaultCount(2371-2374) · 정렬/검색 · 링크 전부
//    커맨드가 스스로 커밋하는 것: saveProject·임포트 4종·createRoutine·createRoutineFromSelection
//      (ProjectDeps/RoutineDeps.commitHistory 배선 — 여기서 또 부르면 스냅샷이 두 번 쌓인다)
// ⚠ 이 파일은 usecases·adapters·ui 를 import 하지 않는다. 커맨드·confirmOnce·파일IO·디바운스는
//    전부 app/main 이 주입한다(유일한 예외는 rank 3 공유 리프인 ui/domContract).

import { SEL } from '../ui/domContract.js';
import { DEFAULT_HOTKEYS, commandForKey, eventKey } from '../domain/hotkeys.js';

/**
 * 커맨드가 실제로 무언가를 바꿨는가. store.NONE 은 얼어붙은 빈 객체다.
 * ⚠ notify 는 세지 않는다(RM-04) — 「동작 이름을 입력해 주세요」만 싣고 돌아온 것은 바꾼 것이 아니다.
 */
const changed = (dirty) => !!dirty && Object.keys(dirty).some(k => k !== 'notify');

/**
 * `전체 초기화` 버튼의 라벨. index.html 의 `#clearBtn` 글자와 **한 글자도 다르면 안 된다** —
 * confirmOnce 가 확인 뒤 이 문자열로 버튼을 되돌리기 때문이다.
 * ⚠ 원본은 '전체 초기화' 였다. 이 버튼이 링크바까지 비운다는 것(4484-4490)이 어디에도 적혀
 *   있지 않아 괄호를 달았다 — 확인 문구('정말요?')는 confirmOnce 가 고정으로 쓴다.
 */
export const CLEAR_BTN_LABEL = '전체 초기화(링크 포함)';

/**
 * `안무표만 비우기` 버튼의 라벨. 위와 같은 규약이다 — 마크업의 글자와 **한 글자도 다르면 안 된다**
 * (confirmOnce 가 확인 뒤 이 문자열로 버튼을 되돌린다).
 */
export const CLEAR_BOARD_BTN_LABEL = '안무표만 비우기';

/**
 * 사이드바·툴바 바인딩 일체.
 *
 * ⚠ 이 함수가 마지막에 bindHotkeys(deps) · bindCommandButtons(deps) 를 부른다(원본 2380). app/main 은 둘을
 *   **따로 또 부르지 마라** — document 리스너가 두 겹이 되어 undo 가 두 번 돈다.
 *
 * @param {Object} deps
 * @param {Object} deps.store   store 인스턴스(정렬 방향 토글의 현재 값을 읽는 데만 쓴다)
 * @param {Object} deps.els   DOM 요소 묶음(app/main 이 getElementById 로 모아 넘긴다)
 *   paletteSearch, sortAlphaBtn, sortAddedBtn, sortCategoryBtn, sortDirBtn,
 *   addMoveBtn, newMoveName, newMoveCategory,
 *   loadFileBtn, mergeFileBtn, saveMoveListBtn, loadMoveListBtn,
 *   saveCategoriesBtn, loadCategoriesBtn, clearBtn, clearBoardBtn,
 *   fileLoader, mergeFileLoader, moveListLoader, categoryLoader,
 *   fileNameInput, moveListFileNameInput, categoryFileNameInput,
 *   boardColsInput, boardColsDec, boardColsInc,
 *   defaultCountInput, defaultCountDec, defaultCountInc,
 *   addRoutineBtn, createRoutineFromSelectionBtn,
 *   mainBoardEl
 * @param {Object} deps.commands  커맨드 파사드(아래 본문의 호출부가 계약이다)
 * @param {(id: string, ctx?: {board?: string, source?: string}) => boolean} deps.runCommand  명령 등록부의 실행기(app/main) —
 *   단축키와 `data-command` 버튼이 함께 쓴다
 * @param {(dirty: object) => void} deps.render
 * @param {(btn: HTMLElement, label: string, fn: () => void) => void} deps.confirmOnce  ui/widgets 주입
 * @param {{ readJsonFromInput(input, onData, onError): void }} deps.fileIO   adapters/browserFileIO 주입
 * @returns {void}
 */
export function bindControls(deps) {
  const { els, store, commands, render, confirmOnce, fileIO } = deps;
  const apply = (dirty) => { if (dirty) render(dirty); };

  // ── 팔레트 검색 (2305) ─────────────────────────────────────────────────────
  // ⚠ 뷰가 #paletteSearch 를 직접 읽지 않도록 여기서 store 로 밀어 넣는다.
  els.paletteSearch.addEventListener('input', (e) => {
    apply(commands.setSearchQuery(e.target.value));
  });

  // ── 팔레트 정렬 버튼 (2307-2335) ───────────────────────────────────────────
  // ⚠ 원본의 setActiveSortBtn(.active 토글)과 ↑/↓ 글리프 갱신은 ui/paletteView 가
  //   store.palette 에서 재도출한다(Dirty.palette). 여기서 클래스를 만지지 마라.
  els.sortAlphaBtn.addEventListener('click', () => apply(commands.setSortMode('alpha')));
  els.sortAddedBtn.addEventListener('click', () => apply(commands.setSortMode('added')));
  els.sortCategoryBtn.addEventListener('click', () => apply(commands.setSortMode('category')));
  els.sortDirBtn.addEventListener('click', () => {
    apply(commands.setSortDir(store.palette.sortDir === 'asc' ? 'desc' : 'asc'));   // 2331
  });

  // ── 동작 추가 (2336, addCustomMove 3990-3998) ──────────────────────────────
  els.addMoveBtn.addEventListener('click', () => {
    const dirty = commands.addMove(els.newMoveName.value, els.newMoveCategory.value);
    apply(dirty);
    if (changed(dirty)) {
      els.newMoveName.value = '';        // 3995 — 성공했을 때만 비운다
      apply(commands.commitHistory('main'));   // 3997
    }
  });

  // ── 프로젝트 저장/불러오기 (2337-2339) ─────────────────────────────────────
  // ⚠ `프로젝트 저장` 은 여기서 걸지 않는다(RM-09) — `data-command="saveProject"` 를 bindCommandButtons 가 듣는다.
  els.loadFileBtn.addEventListener('click', () => els.fileLoader.click());
  els.mergeFileBtn.addEventListener('click', () => els.mergeFileLoader.click());

  // ── 동작목록/카테고리 저장·불러오기 (2356-2359) ────────────────────────────
  els.saveMoveListBtn.addEventListener('click', () => {
    apply(commands.saveMoveList({ fileName: els.moveListFileNameInput.value }));
  });
  els.loadMoveListBtn.addEventListener('click', () => els.moveListLoader.click());
  els.saveCategoriesBtn.addEventListener('click', () => {
    apply(commands.saveCategories({ fileName: els.categoryFileNameInput.value }));
  });
  els.loadCategoriesBtn.addEventListener('click', () => els.categoryLoader.click());

  // ── 전체 초기화 (2360-2362) ────────────────────────────────────────────────
  // ⚠ 첫 인자가 e.currentTarget 이다(2361). 1차 클릭에서는 아무 일도 일어나면 안 된다.
  // ⚠ label 은 confirmOnce 가 **되돌릴 라벨**이자 버튼이 평소에 달고 있는 글자다. 이 버튼은
  //   배치뿐 아니라 링크바 4필드까지 비우므로(4484-4490) 무엇이 함께 지워지는지를 라벨이 말한다 —
  //   index.html 의 #clearBtn 글자와 **같아야 한다**(다르면 확인 뒤 버튼 이름이 바뀐다).
  //   버튼이 좁아 짧게 적는다. 2026-09 이후로는 Undo 로 링크까지 되돌아온다(UNDO_FIELDS).
  // 안무표만 비우기(2026-09-21). 링크·영상·박자·동작 목록은 그대로 둔다.
  // ⚠ 되돌릴 수 있는 일이지만(Undo 한 번) 잃는 것이 크므로 아래 `전체 초기화` 와 **같은 2단계 확인**을
  //   쓴다. 확인 문구는 confirmOnce 가 고정으로 쓴다(`정말요?`).
  if (els.clearBoardBtn) {
    els.clearBoardBtn.addEventListener('click', (e) => {
      confirmOnce(e.currentTarget, CLEAR_BOARD_BTN_LABEL, () => {
        apply(commands.clearPlacements());
        apply(commands.commitHistory('main'));
      });
    });
  }

  els.clearBtn.addEventListener('click', (e) => {
    confirmOnce(e.currentTarget, CLEAR_BTN_LABEL, () => {
      apply(commands.clearBoard());              // 4482-4490 (링크 초기화 포함)
      apply(commands.commitHistory('main'));     // 4491 — 링크까지 한 스냅샷에 담긴다
    });
  });

  // ── 파일 인풋 4개 (2363-2366) ──────────────────────────────────────────────
  // ⚠ 껍데기(files[0] 없으면 즉시 반환 / JSON.parse 와 onData 가 같은 try / value='' 는 동기)는
  //   어댑터가 소유한다. 여기서는 알림의 급과 문구만 경로별로 다르게 넘긴다(RM-04 — 띄우는 것은 render 의 마지막 단계).
  //   프로젝트 파일은 열지 못하면 작업을 멈춰야 하므로 막는(block) 급, 동작·카테고리 파일은 토스트다.
  const fail = (kind, message) => () => apply({ notify: { kind, message } });
  els.fileLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.loadProjectFromFile({ data, fileName: file.name })),
      fail('block', '올바른 프로젝트 파일이 아닙니다.'));
  });
  els.mergeFileLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.mergeProjectFromFile({ data, fileName: file.name })),
      fail('block', '올바른 프로젝트 파일이 아닙니다.'));
  });
  els.moveListLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.loadMoveListFromFile({ data, fileName: file.name })),
      fail('toast', '동작 파일을 읽을 수 없습니다.'));
  });
  els.categoryLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.loadCategoriesFromFile({ data, fileName: file.name })),
      fail('toast', '카테고리 파일을 읽을 수 없습니다.'));
  });

  // ── 안무표 크기 알약 (2367-2370) ───────────────────────────────────────────
  // ⚠ 명명 함정: #boardColsInput 이 담는 값은 cols 가 아니라 **rows** 다(2953).
  //   마크업을 바꾸지 않으므로 id 는 그대로 두고 여기서 rows 로만 다룬다.
  const applyBoardSizeFromInput = () => {
    apply(commands.setBoardRows({ rows: parseInt(els.boardColsInput.value || '8', 10) }));  // 2953
    apply(commands.commitHistory('main'));                                                  // 2961
  };
  els.boardColsInput.addEventListener('change', applyBoardSizeFromInput);
  els.boardColsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); els.boardColsInput.blur(); }
  });
  els.boardColsDec.addEventListener('click', () => {
    els.boardColsInput.value = Math.max(1, parseInt(els.boardColsInput.value || '8', 10) - 1);
    applyBoardSizeFromInput();
  });
  els.boardColsInc.addEventListener('click', () => {
    els.boardColsInput.value = Math.min(128, parseInt(els.boardColsInput.value || '8', 10) + 1);
    applyBoardSizeFromInput();
  });

  // ── 기본 카운트 알약 (2371-2377) ───────────────────────────────────────────
  // ⚠ 히스토리를 쌓지 않는다(원본에 saveHistory 가 없다).
  // ⚠ 무효 입력 되돌리기(2374)는 커맨드가 항상 { toolbar:true } 를 돌려주고
  //   ui/toolbarView 가 defaultCountInput.value 를 store.session.defaultCount 로 맞추는 것으로 재현된다.
  els.defaultCountInput.addEventListener('change', () => {
    apply(commands.setDefaultCount(parseInt(els.defaultCountInput.value, 10)));   // 2372
  });
  els.defaultCountDec.addEventListener('click', () => {
    const v = Math.max(1, parseInt(els.defaultCountInput.value || '1', 10) - 1);
    els.defaultCountInput.value = v;
    apply(commands.setDefaultCount(v));
  });
  els.defaultCountInc.addEventListener('click', () => {
    const v = Math.min(64, parseInt(els.defaultCountInput.value || '1', 10) + 1);   // 상한 64 는 버튼만의 규칙
    els.defaultCountInput.value = v;
    apply(commands.setDefaultCount(v));
  });

  // ── '+ 빠른 배치' 토글 (init 1679-1694) ────────────────────────────────────
  // ⚠ 원본은 bindControls 가 아니라 init() 끝(1679-1694)에서 걸었다. 옮겨 온 자리는 여기다 —
  //   루틴판 짝(#reQuickPlaceBtn, 4838-4849)은 ui/routineEditorView 가 onclick 으로 건다.
  // ⚠ 버튼 클래스('ghost' ↔ 'quick-btn-active')는 여기서 만지지 마라. 커맨드가 Dirty.toolbar 를
  //   돌려주고 ui/toolbarView 가 store.session.quickPlaceMode.main 에서 재도출한다(1683-1690).
  // ⚠ 켤 때의 renderPalette(1687)도 커맨드가 Dirty.palette 로 알린다.
  // ⚠ 끌 때의 closeQuickPicker(1692)는 DOM 이라 app/main 이 커맨드에 주입한다.
  // ⚠ 누름은 여기서 걸지 않는다(RM-09) — `data-command="quickPlace"` 를 bindCommandButtons 가 듣는다.
  //   루틴판 짝(#reQuickPlaceBtn)도 `data-board="routine"` 으로 같은 명령이다.

  // ── Undo / Redo 버튼 (2378-2379) ───────────────────────────────────────────
  // ⚠ 여기서 걸지 않는다(RM-09). 마크업의 `data-command="undo"` 를 아래 bindCommandButtons 가 듣는다 —
  //   루틴 편집기의 짝(`data-board="routine"`)도 같은 길이다. 여기서 또 걸면 한 번 누름에 두 번 돈다.

  // ── 단축키 (2380) · 명령 버튼 ───────────────────────────────────────────────
  bindHotkeys(deps);
  bindCommandButtons(deps);

  // ── 2381: updateHistoryButtons() ───────────────────────────────────────────
  render({ history: true });

  // ── 루틴 버튼 (2382-2383) ──────────────────────────────────────────────────
  els.addRoutineBtn.addEventListener('click', () => apply(commands.createRoutine()));
  els.createRoutineFromSelectionBtn.addEventListener('click', () => apply(commands.createRoutineFromSelection()));

  // ── 안무표 빈 영역 클릭 시 선택 해제 (init 1527-1529) ──────────────────────
  // ⚠ 원본은 bindBoardDelegatedEvents(mainCtx) **다음에** 이 리스너를 붙인다. 같은 요소의
  //   click 리스너 두 개는 stopPropagation 으로 서로를 막지 못하므로(stopImmediatePropagation 이
  //   아니다) 등록 순서가 결과를 바꾸지 않는다 — 여기에 두어도 동작이 같다.
  if (els.mainBoardEl) {
    els.mainBoardEl.addEventListener('click', (e) => {
      if (e.target.closest(SEL.placement)) return;
      apply(commands.clearSelection());
      // 붙여넣기(Ctrl+V)가 고른 블록이 없을 때 놓일 자리 — 마지막으로 누른 빈 칸(RM-13). 칸 계산은 조립 층이 한다.
      if (typeof deps.rememberCell === 'function') deps.rememberCell(e.clientX, e.clientY);
    });
  }

  // ⚠ 링크바(#youtubeUrlInput · #clickupUrlInput · #ytResetBtn · #clickupResetBtn ·
  //   #addCustomLinkBtn · 커스텀 링크 행)는 **ui/linksBarView 가 전부 소유한다**.
  //   여기서 #youtubeUrlInput 'input' 을 다시 걸지 마라 — 리스너가 두 겹이 되어 oEmbed 조회가
  //   두 번 돌고, 게다가 이 파일의 render(presenter)를 태우면 Dirty.links → renderLinksBar 가
  //   `ytInput.value = state.youtubeUrl`(5209)로 **입력 중에 trim 된 값을 되써서** 커서가 튄다.
  //   원본 5230 은 renderYoutubeExtras() 부분 렌더뿐이다.
}

/**
 * `data-command="<id>"` 를 단 버튼의 누름을 명령 등록부의 실행기로 보낸다(RM-09).
 *
 * 버튼마다 따로 걸던 것을 문서 하나에 한 번 건다 — 버튼이 나중에 그려지거나 다시 그려져도 걸 것이 없다.
 * `data-board` 가 있으면 그 보드에서 실행한다(루틴 편집기의 Undo 는 `routine`). 없으면 `main`.
 * ⚠ 꺼진 버튼은 누름 자체가 오지 않지만(브라우저가 막는다) 안쪽 글자를 눌러 올라온 경우를 위해 한 번 더 본다.
 * @param {Object} deps
 * @param {(id: string, ctx?: {board?: string, source?: string}) => boolean} deps.runCommand
 * @param {Document} [deps.doc]
 */
export function bindCommandButtons(deps) {
  const { runCommand, doc = document } = deps;
  if (typeof runCommand !== 'function') return;
  doc.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-command]') : null;
    if (!btn || btn.disabled) return;
    runCommand(btn.dataset.command, { board: btn.dataset.board || 'main', source: 'button' });
  });
}

/** 재생기(`<video>` · `<audio>`)가 포커스를 쥐었을 때 그쪽에 양보하는 화살표. */
const PLAYER_KEYS = Object.freeze(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight']);

/**
 * 전역 단축키. 원본 onHotkey(2820-2831) + bindControls 의 등록(2380).
 *
 * 2026-10-01(RM-09)부터 이 함수는 **무엇을 할지 모른다.** 눌린 글쇠를 이름으로 바꿔 명령 등록부에서 명령을
 * 찾고(`hotkeys.commandForKey`), 그 id 를 조립 층의 실행기(`runCommand`)에 넘길 뿐이다. 그전에는 Escape 와
 * Undo/Redo 가 여기 박혀 있었고, 바꿀 수 있는 글쇠는 `HOTKEY_COMMANDS` 라는 셋째 표를 거쳐 파사드의 이름을
 * 찾았다 — 이름 하나가 빠지면 그 글쇠가 말없이 죽었다(원칙 D-14).
 *
 * ⚠ 예전에 일부러 두고 온 결함(#11) 둘을 2026-10-01(RM-13)에 고쳤다:
 *   1) 입력 필드 가드 — <input> 안에서 Ctrl+Z 를 누르면 보드가 아니라 글자가 되돌아간다. 등록부의 `whileTyping`
 *      이 그 자리다(`stop` 과 화면을 여는 조합 글쇠만 참).
 *   2) 활성 보드 — 루틴 편집기가 열려 있으면 단축키가 루틴 보드로 간다. 무엇이 활성인지는 조립 층이
 *      activeBoardId 로 알려 준다(기본값 () => 'main' 은 시험 · 조립 전용).
 * ⚠ 홑글쇠(`B`·`K`·`N`·`Space`)는 **입력 필드 안에서는 듣지 않는다** — 가드가 없으면 동작 이름을 타이핑하는
 *   동안 블록이 쌓인다.
 * ⚠ 실행기가 참을 돌려주면 기본 동작을 막는다. `Escape`(stop)는 언제나 거짓이다 — 예전에도 막지 않았다.
 *
 * @param {Object} deps
 * @param {(id: string, ctx?: {board?: string, source?: string}) => boolean} deps.runCommand  app/main 이 주입
 * @param {() => 'main'|'routine'} [deps.activeBoardId]
 * @param {() => Record<string, string[]>} [deps.hotkeys]
 * @param {Document} [deps.doc]
 * @returns {void}
 */
export function bindHotkeys(deps) {
  const {
    runCommand, activeBoardId = () => 'main', doc = document,
    // ⚠ **게터다.** 설정에서 글쇠를 바꾸면 다음 입력부터 바로 들어야 한다 — 값으로 받으면 묶은
    //   시점의 표에 갇혀서, 바꾼 것이 새로고침 전까지 안 먹는다.
    hotkeys = () => DEFAULT_HOTKEYS
  } = deps;
  if (typeof runCommand !== 'function') return;

  /**
   * 재생기 자신이 이미 그 글쇠를 처리했는가.
   *
   * ⚠⚠ `<video>` 에 포커스가 있으면 **브라우저가 먼저** `스페이스` 를 재생/일시정지로 쓴다.
   *   그 처리는 기본 동작이 아니라 재생기 안쪽의 리스너라, 우리가 document 에서 `preventDefault`
   *   해도 이미 일어난 뒤다 — 그러고서 우리 커맨드까지 돌면 **두 번 토글되어 아무 일도 안 한
   *   것처럼 보인다.** 영상을 크게 띄운 뒤로 영상을 눌러 포커스를 주는 일이 흔해지면서 "스페이스가
   *   안 먹는다"가 됐다(2026-09-21).
   * ⚠ 그래서 재생기가 포커스를 쥐고 있으면 **우리는 비킨다.** 글쇠 하나에 주인은 하나다.
   *   막지도 않는다(preventDefault 없음) — 막으면 재생기 쪽 처리까지 취소되어 진짜로 아무 일도
   *   일어나지 않는다.
   * ⚠ 재생/일시정지와 화살표에만 해당한다. `B`·`K`·`N` 은 재생기가 쓰지 않는 글쇠라 그대로 우리 것이다.
   * @param {EventTarget|null} target
   * @param {string} pressed normalizeKey 를 거친 이름
   */
  const playerOwnsKey = (target, pressed) => {
    // 화살표도 재생기가 쥐면 되감기 · 소리 크기다(RM-13) — 고른 블록이 있어도 비킨다.
    if (pressed !== 'Space' && !PLAYER_KEYS.includes(pressed)) return false;
    const tag = target && target.tagName;
    return tag === 'VIDEO' || tag === 'AUDIO';
  };

  /** 지금 글자를 치고 있는가. 홑글쇠 단축키는 여기서 막힌다. */
  const typing = (target) => {
    const el = target;
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
  };

  doc.addEventListener('keydown', (e) => {
    const pressed = eventKey(e);
    // 재생기가 쥔 글쇠면 우리는 비킨다(위 ⚠⚠). 막지도 않는다.
    if (playerOwnsKey(e.target, pressed)) return;
    const cmd = commandForKey(hotkeys(), pressed, typing(e.target));
    if (!cmd) return;
    // ⚠ **결과와 무관하게 먼저 막는다.** `Space` 는 포커스가 버튼에 있으면 그 버튼을 다시
    //   누르고(`▮ 끊기` 를 손으로 누른 직후가 그렇다) 페이지를 한 화면 내린다.
    //   명령이 아무 일도 안 했더라도 그 둘은 일어나면 안 된다.
    if (pressed === 'Space') e.preventDefault();
    if (runCommand(cmd.id, { board: activeBoardId(), source: 'key' })) e.preventDefault();
  });
}
