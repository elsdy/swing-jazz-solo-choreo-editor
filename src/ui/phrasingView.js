// src/ui/phrasingView.js — 안무표 도구 모음의 `🎵 프레이즈` 버튼과 그 팝업 (ui 계층)
//
// 신설 파일이다(2026-09-13). 곡 구조(프레이즈 길이 · 코러스당 프레이즈 수 · 시작 마디)를 정하는 자리다.
// 칠하는 것은 ui/boardView.syncPhrasing 이고, 여기는 **숫자를 받는 창**이다.
//
// docsHub·settingsView 와 같은 규약이다 — 자기 DOM 과 자기 <style> 을 만들어 붙이고 index.html 의
// 마크업은 건드리지 않는다(골든·셀렉터 계약 보호).
//
// ⚠ 팝업이지 오버레이가 아니다. 안무표를 보면서 숫자를 바꿔야 결과가 바로 보이므로 화면을 덮지 않는다.

import { CLS } from './domContract.js';
import { positionPopup } from './popup.js';

const STYLE_ID = 'phrasing-view-style';
const CSS = `
.phrasing-popup {
  position: fixed; z-index: 5200; width: min(340px, 92vw);
  display: grid; gap: 8px; padding: 12px;
  background: #0f1729; border: 1px solid rgba(148,163,184,0.22);
  border-radius: 12px; box-shadow: 0 18px 44px rgba(0,0,0,0.45);
}
/* ⚠ 반드시 있어야 한다. 위의 display:grid 가 브라우저 기본 스타일의 [hidden]{display:none} 을
   이겨서, 이 줄이 없으면 닫아도(hidden=true) 팝업이 화면에 그대로 떠 있는다.
   ⚠ 이 CSS 는 템플릿 문자열 안이다 — 주석에 백틱을 쓰면 문자열이 거기서 끊겨 모듈 전체가 죽는다. */
.phrasing-popup[hidden] { display: none; }
.phrasing-popup h3 { margin: 0; font-size: 12.5px; font-weight: 800; color: #e5e7eb; }
.phrasing-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.phrasing-row .phrasing-grow { flex: 1; }
.phrasing-label { font-size: 11px; color: #8892a4; white-space: nowrap; }
.phrasing-num { width: 3.6em; text-align: center; }
.phrasing-summary {
  font-size: 11px; line-height: 1.5; color: #cbd5e1;
  background: rgba(148,163,184,0.10); border-radius: 8px; padding: 6px 9px;
}
.phrasing-legend { display: grid; gap: 3px; font-size: 10.5px; color: #94a3b8; }
.phrasing-legend b { display: inline-block; width: 22px; height: 8px; border-radius: 3px; vertical-align: middle; margin-right: 5px; }
.phrasing-swatches { display: flex; gap: 3px; align-items: center; }
.phrasing-swatches i { width: 14px; height: 8px; border-radius: 3px; }
`;

/**
 * @typedef {object} PhrasingViewDeps
 * @property {HTMLElement} container `🎵 프레이즈` 버튼을 붙일 곳(안무표 도구 모음의 `.top-actions`)
 * @property {() => import('../domain/phrasing.js').Phrasing} getPhrasing 지금 구조(언제나 네 필드가 찬 값)
 * @property {() => number} getRows 메인 보드의 마지막 마디 번호(board.rows)
 * @property {() => string} getPresetId 지금 숫자와 같은 프리셋의 id. 없으면 `''`
 * @property {(phrasing: object, rows: number) => string} summarize domain/phrasing.phrasingSummary
 * @property {{id:string,label:string}[]} presets domain/phrasing.PHRASING_PRESETS
 * @property {{phrase:string[], chorus:string[]}} palettes 범례에 보여 줄 색 목록
 * @property {{
 *   toggle: (args?: {on?: boolean}) => any,
 *   set: (patch: object) => any,
 *   applyPreset: (presetId: string) => any
 * }} commands app/main 이 usecases/phrasingCommands 를 store 에 묶어 넘긴다
 * @property {(dirty: any) => void} render presenter 의 apply
 * @property {() => void} [commitHistory] 확정 시점에 한 번 부른다(숫자 입력은 change 에서만 확정된다)
 * @property {Document} [doc]
 */

/**
 * @param {PhrasingViewDeps} deps
 * @returns {{ render(): void, open(): void, close(): void }}
 */
export function createPhrasingView(deps) {
  const {
    container, getPhrasing, getRows, getPresetId, summarize, presets, palettes,
    commands, render, commitHistory = () => {}, doc = document
  } = deps;

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const openBtn = doc.createElement('button');
  openBtn.id = 'phrasingBtn';
  openBtn.className = CLS.ghost;
  openBtn.type = 'button';
  openBtn.textContent = '🎵 프레이즈';
  openBtn.title = '프레이즈와 코러스를 색으로 구분해 보여 줍니다';
  if (container) container.appendChild(openBtn);

  const popup = doc.createElement('div');
  popup.className = 'phrasing-popup';
  popup.hidden = true;
  popup.innerHTML = `
    <h3>프레이즈 · 코러스</h3>
    <div class="phrasing-row">
      <button class="primary" data-act="toggle" type="button">표시 켜기</button>
      <span class="phrasing-grow"></span>
      <button class="ghost" data-act="close" type="button">닫기</button>
    </div>
    <div class="phrasing-row">
      <span class="phrasing-label">곡 구조</span>
      <select class="video-pick" data-role="preset" style="flex:1; min-width:0;"></select>
    </div>
    <div class="phrasing-row">
      <span class="phrasing-label">프레이즈</span>
      <input class="phrasing-num" data-role="rows-per-phrase" type="number" min="1" max="64" />
      <span class="phrasing-label">마디 ·</span>
      <span class="phrasing-label">코러스</span>
      <input class="phrasing-num" data-role="phrases-per-chorus" type="number" min="1" max="32" />
      <span class="phrasing-label">프레이즈</span>
    </div>
    <div class="phrasing-row">
      <span class="phrasing-label">첫 코러스 시작</span>
      <input class="phrasing-num" data-role="start-row" type="number" min="1" max="9999" />
      <span class="phrasing-label">마디</span>
    </div>
    <div class="phrasing-summary" data-role="summary"></div>
    <div class="phrasing-legend">
      <div><span class="phrasing-swatches" data-role="phrase-swatches"></span> 가운데 트랙 테두리 = 프레이즈</div>
      <div><span class="phrasing-swatches" data-role="chorus-swatches"></span> 마디 이름 · 비고 테두리 = 코러스</div>
      <div>마디 이름 아래 <code>2-1</code> 은 코러스 2 의 1번째 프레이즈라는 뜻입니다.</div>
    </div>`;
  doc.body.appendChild(popup);

  const q = (sel) => popup.querySelector(sel);
  const presetSel = q('[data-role="preset"]');
  const rowsPerPhraseEl = q('[data-role="rows-per-phrase"]');
  const phrasesPerChorusEl = q('[data-role="phrases-per-chorus"]');
  const startRowEl = q('[data-role="start-row"]');
  const summaryEl = q('[data-role="summary"]');
  const toggleBtn = q('[data-act="toggle"]');

  // 프리셋 선택지와 색 견본은 한 번만 세운다(둘 다 도메인 상수라 바뀌지 않는다).
  for (const p of presets) {
    const opt = doc.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    presetSel.appendChild(opt);
  }
  const custom = doc.createElement('option');
  custom.value = '';
  custom.textContent = '직접 정한 값';
  presetSel.appendChild(custom);

  function paintSwatches(role, colors) {
    const host = q(`[data-role="${role}"]`);
    for (const color of colors) {
      const chip = doc.createElement('i');
      chip.style.background = color;
      host.appendChild(chip);
    }
  }
  paintSwatches('phrase-swatches', palettes.phrase);
  paintSwatches('chorus-swatches', palettes.chorus);

  const isOpen = () => !popup.hidden;

  // ── 바깥 클릭으로 닫기 ──
  // ⚠ ui/popup.js 의 bindOutsideClose 를 쓰지 않는다. 그 함수는 **자기가 닫았을 때만** 리스너를 떼는
  //   원본의 성질을 일부러 보존한 것이라 새 뷰가 기대어 쓸 물건이 아니고, 여기서는 진입 버튼을
  //   `안쪽` 으로 쳐야 한다 — 그러지 않으면 pointerdown 이 먼저 닫고 click 이 다시 열어서
  //   버튼으로는 영영 닫을 수 없게 된다.
  let outsideBound = false;
  function onOutsideDown(e) {
    if (popup.contains(e.target) || openBtn.contains(e.target)) return;
    close();
  }
  function bindOutside() {
    if (outsideBound) return;
    outsideBound = true;
    // 지금 처리 중인 클릭이 곧바로 자기를 닫지 않도록 다음 틱에 붙인다(popup.js 와 같은 이유).
    setTimeout(() => { if (outsideBound) doc.addEventListener('pointerdown', onOutsideDown); }, 0);
  }
  function unbindOutside() {
    outsideBound = false;
    doc.removeEventListener('pointerdown', onOutsideDown);
  }

  /** store 만 보고 팝업과 버튼의 모든 표시를 재도출한다. Dirty.phrasing 의 적용점이다. */
  function renderView() {
    const p = getPhrasing();
    openBtn.className = p.on ? CLS.quickBtnActive : CLS.ghost;
    if (toggleBtn) {
      toggleBtn.textContent = p.on ? '표시 끄기' : '표시 켜기';
      toggleBtn.className = p.on ? 'ghost' : 'primary';
    }
    // ⚠ 타이핑 중에는 되쓰지 않는다 — 커서가 끝으로 튀고 입력이 잘린다(영상 패널과 같은 규칙).
    const typing = (el) => el && doc.activeElement === el;
    if (!typing(presetSel)) presetSel.value = getPresetId();
    if (!typing(rowsPerPhraseEl)) rowsPerPhraseEl.value = String(p.rowsPerPhrase);
    if (!typing(phrasesPerChorusEl)) phrasesPerChorusEl.value = String(p.phrasesPerChorus);
    if (!typing(startRowEl)) startRowEl.value = String(p.startRow);
    if (summaryEl) summaryEl.textContent = summarize(p, getRows());
  }

  function open() {
    popup.hidden = false;
    renderView();
    const rect = openBtn.getBoundingClientRect();
    positionPopup(popup, rect.left, rect.bottom + 6);
    bindOutside();
  }

  function close() {
    popup.hidden = true;
    unbindOutside();
  }

  /** 숫자 하나를 확정한다. 값이 실제로 바뀐 경우에만 히스토리를 남긴다(커맨드가 NONE 을 준다). */
  function commitField(patch) {
    const dirty = commands.set(patch);
    render(dirty);
    if (dirty && dirty.phrasing) commitHistory();
    renderView();
  }

  openBtn.onclick = () => (isOpen() ? close() : open());
  popup.addEventListener('click', (e) => {
    const act = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!act) return;
    if (act.dataset.act === 'close') { close(); return; }
    if (act.dataset.act === 'toggle') {
      const dirty = commands.toggle();
      render(dirty);
      if (dirty && dirty.phrasing) commitHistory();
      renderView();
    }
  });
  presetSel.onchange = () => {
    if (!presetSel.value) { renderView(); return; }   // `직접 정한 값` 은 고르는 것이 아니라 상태다
    const dirty = commands.applyPreset(presetSel.value);
    render(dirty);
    if (dirty && dirty.phrasing) commitHistory();
    renderView();
  };
  // ⚠ change(blur/Enter)에만 건다. input 에 걸면 글자마다 undo 단계가 쌓인다(링크바와 같은 규칙).
  rowsPerPhraseEl.onchange = () => commitField({ on: true, rowsPerPhrase: Number(rowsPerPhraseEl.value) });
  phrasesPerChorusEl.onchange = () => commitField({ on: true, phrasesPerChorus: Number(phrasesPerChorusEl.value) });
  startRowEl.onchange = () => commitField({ startRow: Number(startRowEl.value) });

  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  return { render: renderView, open, close };
}
