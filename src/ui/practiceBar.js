// src/ui/practiceBar.js — 영상 패널의 연습 조작 줄 (ui 계층, RM-22 · 2026-10-01)
//
// 마디 반복 연습기의 화면이다. 유튜브 · 내 영상 파일 · 영상 없는 박자 시계가 **같은 줄 하나**를 쓴다:
//   ▶ 재생 · 배속 · 🔁 반복 · ⇋ 미러 · 🔔 카운트 소리
//   [마디] ~ [마디] `마디 반복` · `고른 블록 반복` · `구간 풀기`
// 반복 구간은 **카운트**로 잡는다(domain/practice). 초로 바꾸고 되감는 것은 app/main 의 몫이다.
//
// ⚠ 어댑터를 모른다. 재생기 · 소리 장치는 app/main 이 주입한 함수로만 닿는다(videoPanel 과 같은 경계 ④).
// ⚠ 영상 패널(ui/videoPanel)을 import 하지 않는다 — ui 끼리는 서로 모른다(tools/check-arch).
// ⚠ 반복 · 배속 · 미러 · 소리는 전부 화면 상태다. 저장되지 않고 undo 에도 남지 않는다 — 커밋하지 않는다.

import { CLS } from './domContract.js';
import { rowIndices } from '../domain/grid.js';
import { isTempoUsable } from '../domain/tempo.js';
import { countRangeLabel, normalizeCountRange, placementsToCountRange, rowsToCountRange } from '../domain/practice.js';
import { activeClipOf } from '../domain/project/media.js';

/** 메인 보드의 store 상 id(ui 는 usecases 를 import 하지 않는다). */
const BOARD_MAIN = 'main';

/** 초 → `m:ss.s`. 음수(intro 앞)도 부호를 붙인다. */
function clock(sec) {
  const sign = sec < 0 ? '-' : '';
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  return `${sign}${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** 배속 → 화면의 말. 1배는 `1×`. */
const rateLabel = (r) => `${r}×`;

/**
 * @typedef {object} PracticeBarDeps
 * @property {any} store                createStore 인스턴스(읽기만 한다)
 * @property {(dirty: any) => void} render
 * @property {() => string} getPlayerKind 'youtube' | 'file' | 'clock' | 'null'
 * @property {() => {play?: string}} getPlayerState
 * @property {() => ({startSec:number, endSec:number}|null)} getLoopSpan 지금 반복되는 초 구간 —
 *   usecases/videoCommands.loopSpan(마디 반복이 있으면 그것을 지금 박자로, 아니면 In~Out)
 * @property {() => number[]} getRates   지금 재생기에서 고를 수 있는 배속(domain/practice.ratesFor 를 거친 것)
 * @property {() => boolean} [clicksAvailable] 이 브라우저가 소리를 낼 수 있는가
 * @property {() => void} onTogglePlay
 * @property {(range: {fromCount:number, toCount:number}) => void} onPractice 반복 구간을 잡고 그 시작으로 가서 재생한다
 * @property {{
 *   setLoop: (args?: {loop?: boolean}) => any,
 *   clearPracticeRange: () => any,
 *   setRate: (args: {rate:number}) => any,
 *   setMirror: (args?: {mirror?: boolean}) => any,
 *   setClicks: (args?: {clicks?: boolean}) => any
 * }} commands app/main 이 videoCommands 를 store 에 묶어 넘긴다(배속 · 소리는 재생기 · 소리 장치까지 닿게 감싸서)
 * @property {Record<string, HTMLElement|null>} [elements] 테스트용 요소 주입
 */

/**
 * @param {PracticeBarDeps} deps
 * @returns {{ render(): void, renderPlay(): void }}
 */
export function createPracticeBar(deps) {
  const {
    store, render, getPlayerKind, getPlayerState, getRates, getLoopSpan,
    clicksAvailable = () => true,
    onTogglePlay, onPractice, commands, elements = {}
  } = deps;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const frame = byId('videoFrame');
  const playBtn = byId('practicePlayBtn');
  const rateSel = byId('practiceRate');
  const loopBtn = byId('practiceLoopBtn');
  const mirrorBtn = byId('practiceMirrorBtn');
  const clickBtn = byId('practiceClickBtn');
  const fromRow = byId('practiceFromRow');
  const toRow = byId('practiceToRow');
  const rowsBtn = byId('practiceRowsBtn');
  const selBtn = byId('practiceSelBtn');
  const clearBtn = byId('practiceClearBtn');
  const help = byId('practiceHelp');

  const panel = () => store.get().session.video || {};
  const board = () => store.board(BOARD_MAIN);
  const tempo = () => activeClipOf(store.get().media).tempo;
  const hasPlayer = () => getPlayerKind() !== 'null';

  /** 마디 고르기 칸을 보드와 맞춘다. 보드 모양이 바뀔 때만 다시 만든다(고른 값은 지킨다). */
  let rowsSig = '';
  function syncRowOptions() {
    const b = board();
    const sig = `${b.cols}x${b.rows}:${b.hasIntroRow ? 1 : 0}`;
    if (sig === rowsSig) return;
    rowsSig = sig;
    for (const sel of [fromRow, toRow]) {
      if (!sel) continue;
      const keep = sel.value;
      sel.innerHTML = '';
      for (const row of rowIndices(b)) {
        const opt = document.createElement('option');
        opt.value = String(row);
        opt.textContent = row === 0 ? 'intro' : `${b.cols}x${row}`;
        sel.appendChild(opt);
      }
      if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
      else sel.value = String(Math.min(1, b.rows));
    }
  }

  /** 마디 고르기 칸이 가리키는 카운트 구간. */
  function rowsRange() {
    return rowsToCountRange(Number(fromRow && fromRow.value), Number(toRow && toRow.value), board().cols);
  }

  /** 고른 블록이 덮는 카운트 구간(없으면 null). */
  function selectionRange() {
    return placementsToCountRange(board().placements, store.selection || [], board().cols);
  }

  function renderPlay() {
    if (!playBtn) return;
    const playing = (getPlayerState() || {}).play === 'playing';
    playBtn.textContent = playing ? '❚❚ 멈춤' : '▶ 재생';
    playBtn.disabled = !hasPlayer();
  }

  function renderRates(p) {
    if (!rateSel) return;
    const rates = getRates();
    const sig = rates.join(',');
    if (rateSel.dataset.sig !== sig) {
      rateSel.dataset.sig = sig;
      rateSel.innerHTML = '';
      for (const r of (rates.length ? rates : [1])) {
        const opt = document.createElement('option');
        opt.value = String(r);
        opt.textContent = rateLabel(r);
        rateSel.appendChild(opt);
      }
    }
    rateSel.disabled = rates.length === 0;
    rateSel.value = String(rates.includes(p.rate) ? p.rate : 1);
  }

  function renderAll() {
    const p = panel();
    const b = board();
    const ready = isTempoUsable(tempo());
    const span = getLoopSpan();
    const practice = normalizeCountRange(p.practice);
    syncRowOptions();
    renderPlay();
    renderRates(p);

    if (loopBtn) {
      // 켜져 있어도 반복할 구간이 없으면 꺼진 모양이다 — 「반복 중」 이 거짓말이 되지 않게.
      loopBtn.classList.toggle(CLS.quickBtnActive, !!(p.loop && span));
      loopBtn.disabled = !span;
    }
    if (mirrorBtn) {
      mirrorBtn.classList.toggle(CLS.quickBtnActive, !!p.mirror);
      // 박자 시계에는 뒤집을 그림이 없다.
      mirrorBtn.disabled = getPlayerKind() === 'clock';
    }
    // ⚠ 끌 때는 속성을 **없앤다**(U-11) — `[data-mirror]` 는 빈 문자열에도 걸린다.
    if (frame) frame.toggleAttribute('data-mirror', !!p.mirror && getPlayerKind() !== 'clock');
    if (clickBtn) {
      clickBtn.classList.toggle(CLS.quickBtnActive, !!p.clicks);
      clickBtn.disabled = !clicksAvailable() || !ready;
    }
    if (rowsBtn) rowsBtn.disabled = !ready || !hasPlayer();
    if (selBtn) selBtn.disabled = !ready || !hasPlayer() || !selectionRange();
    if (clearBtn) clearBtn.disabled = !practice;
    for (const sel of [fromRow, toRow]) if (sel) sel.disabled = !ready;

    if (!help) return;
    if (!ready) {
      help.textContent = '마디로 반복하려면 박자가 있어야 합니다 — `② 박자 맞추기` 에서 BPM 을 정하세요. 영상이 없어도 BPM 만 있으면 박자로 돕니다.';
    } else if (practice) {
      const where = countRangeLabel(practice, b.cols);
      help.textContent = span
        ? `${where} · ${clock(span.startSec)} ~ ${clock(span.endSec)}` + (p.loop ? ' — 반복 중' : ' — `🔁 반복` 을 켜면 끝에서 처음으로 되감습니다')
        : `${where} — 박자가 맞지 않아 반복할 수 없습니다.`;
    } else if (span && p.loop) {
      help.textContent = `In ${clock(span.startSec)} ~ Out ${clock(span.endSec)} 을 반복합니다(④ 의 In/Out).`;
    } else {
      help.textContent = '마디를 골라 `마디 반복`, 또는 안무표에서 블록을 고르고 `고른 블록 반복` 을 누르면 그 구간이 되풀이됩니다.';
    }
  }

  // ── 입력 — 한 번만 묶는다 ────────────────────────────────────────────────
  if (playBtn) playBtn.onclick = () => onTogglePlay();
  if (rateSel) rateSel.onchange = () => render(commands.setRate({ rate: Number(rateSel.value) }));
  if (loopBtn) loopBtn.onclick = () => render(commands.setLoop());
  if (mirrorBtn) mirrorBtn.onclick = () => render(commands.setMirror());
  // ⚠ 소리 장치는 **이 누름 안에서** 깨워야 한다 — commands.setClicks 를 감싼 app/main 이 그 자리다.
  if (clickBtn) clickBtn.onclick = () => render(commands.setClicks());
  if (rowsBtn) rowsBtn.onclick = () => { const r = rowsRange(); if (r) onPractice(r); };
  if (selBtn) selBtn.onclick = () => { const r = selectionRange(); if (r) onPractice(r); };
  if (clearBtn) clearBtn.onclick = () => render(commands.clearPracticeRange());
  // 앞 칸을 뒤 칸보다 뒤로 고르면 뒤 칸을 따라 옮긴다 — 한 마디만 고르는 가장 흔한 길이 한 번에 된다.
  if (fromRow && toRow) {
    fromRow.onchange = () => { if (Number(toRow.value) < Number(fromRow.value)) toRow.value = fromRow.value; };
  }

  return { render: renderAll, renderPlay };
}
