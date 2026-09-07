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

/** 커맨드가 실제로 무언가를 바꿨는가. store.NONE 은 얼어붙은 빈 객체다. */
const changed = (dirty) => !!dirty && Object.keys(dirty).length > 0;

/**
 * 사이드바·툴바 바인딩 일체.
 *
 * ⚠ 이 함수가 마지막에 bindHotkeys(deps) 를 부른다(원본 2380). app/main 은 bindHotkeys 를
 *   **따로 또 부르지 마라** — document keydown 리스너가 두 겹이 되어 undo 가 두 번 돈다.
 *
 * @param {Object} deps
 * @param {Object} deps.store   store 인스턴스(정렬 방향 토글의 현재 값을 읽는 데만 쓴다)
 * @param {Object} deps.els   DOM 요소 묶음(app/main 이 getElementById 로 모아 넘긴다)
 *   paletteSearch, sortAlphaBtn, sortAddedBtn, sortCategoryBtn, sortDirBtn,
 *   addMoveBtn, newMoveName, newMoveCategory,
 *   saveBtn, loadFileBtn, mergeFileBtn, saveMoveListBtn, loadMoveListBtn,
 *   saveCategoriesBtn, loadCategoriesBtn, clearBtn,
 *   fileLoader, mergeFileLoader, moveListLoader, categoryLoader,
 *   fileNameInput, moveListFileNameInput, categoryFileNameInput,
 *   boardColsInput, boardColsDec, boardColsInc,
 *   defaultCountInput, defaultCountDec, defaultCountInc,
 *   quickPlaceBtn, undoBtn, redoBtn, addRoutineBtn, createRoutineFromSelectionBtn,
 *   mainBoardEl
 * @param {Object} deps.commands  커맨드 파사드(아래 본문의 호출부가 계약이다)
 * @param {(dirty: object) => void} deps.render
 * @param {(btn: HTMLElement, label: string, fn: () => void) => void} deps.confirmOnce  ui/widgets 주입
 * @param {{ readJsonFromInput(input, onData, onError): void }} deps.fileIO   adapters/browserFileIO 주입
 * @param {{ alert(message: string): void }} deps.dialogs                     adapters/browserDialogs 주입
 * @returns {void}
 */
export function bindControls(deps) {
  const { els, store, commands, render, confirmOnce, fileIO, dialogs } = deps;
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
  els.saveBtn.addEventListener('click', () => {
    apply(commands.saveProject({ fileName: els.fileNameInput.value }));
  });
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
  els.clearBtn.addEventListener('click', (e) => {
    confirmOnce(e.currentTarget, '전체 초기화', () => {
      apply(commands.clearBoard());              // 4482-4490 (링크 초기화 포함)
      apply(commands.commitHistory('main'));     // 4491
    });
  });

  // ── 파일 인풋 4개 (2363-2366) ──────────────────────────────────────────────
  // ⚠ 껍데기(files[0] 없으면 즉시 반환 / JSON.parse 와 onData 가 같은 try / value='' 는 동기)는
  //   어댑터가 소유한다. 여기서는 alert 문구만 경로별로 다르게 넘긴다.
  els.fileLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.loadProjectFromFile({ data, fileName: file.name })),
      () => dialogs.alert('올바른 프로젝트 파일이 아닙니다.'));
  });
  els.mergeFileLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.mergeProjectFromFile({ data, fileName: file.name })),
      () => dialogs.alert('올바른 프로젝트 파일이 아닙니다.'));
  });
  els.moveListLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.loadMoveListFromFile({ data, fileName: file.name })),
      () => dialogs.alert('동작 파일을 읽을 수 없습니다.'));
  });
  els.categoryLoader.addEventListener('change', (e) => {
    fileIO.readJsonFromInput(e.target,
      (data, file) => apply(commands.loadCategoriesFromFile({ data, fileName: file.name })),
      () => dialogs.alert('카테고리 파일을 읽을 수 없습니다.'));
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
  if (els.quickPlaceBtn) {
    els.quickPlaceBtn.addEventListener('click', () => apply(commands.toggleQuickPlace('main')));
  }

  // ── Undo / Redo 버튼 (2378-2379) ───────────────────────────────────────────
  els.undoBtn.addEventListener('click', () => apply(commands.undo('main')));
  els.redoBtn.addEventListener('click', () => apply(commands.redo('main')));

  // ── 단축키 (2380) ──────────────────────────────────────────────────────────
  bindHotkeys(deps);

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
      if (!e.target.closest(SEL.placement)) apply(commands.clearSelection());
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
 * 전역 단축키. 원본 onHotkey(2820-2831) + bindControls 의 등록(2380).
 *
 * ⚠ 보존 대상 결함 #11 두 가지를 그대로 둔다:
 *   1) 입력 필드 가드가 없다 — <input> 안에서 Ctrl+Z 를 눌러도 보드가 undo 된다(HOTKEY_INPUT_GUARD).
 *   2) 언제나 메인 보드다 — 루틴 편집기가 열려 있어도 단축키가 루틴 히스토리에 가지 않는다.
 *      activeBoardId 를 인자로 받되 **기본값이 () => 'main'** 이라 오늘 동작이 유지된다
 *      (HOTKEY_ACTIVE_BOARD 플래그를 켜는 날 이 함수만 바꾸면 된다).
 * ⚠ Escape 의 cancelActivePaletteMove 는 dragstart 경로와 달리 **Dirty 를 그린다**(2802 renderPalette).
 *
 * @param {Object} deps
 * @param {Object} deps.commands
 * @param {(dirty: object) => void} deps.render
 * @param {() => 'main'|'routine'} [deps.activeBoardId]
 * @param {Document} [deps.doc]
 * @returns {void}
 */
export function bindHotkeys(deps) {
  const { commands, render, activeBoardId = () => 'main', doc = document } = deps;
  const apply = (dirty) => { if (dirty) render(dirty); };

  doc.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') { apply(commands.cancelActivePaletteMove()); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
      e.preventDefault();
      apply(commands.undo(activeBoardId()));
    }
    if (((e.ctrlKey || e.metaKey) && key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'z')) {
      e.preventDefault();
      apply(commands.redo(activeBoardId()));
    }
  });
}
