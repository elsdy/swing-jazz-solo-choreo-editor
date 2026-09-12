// src/ui/composeView.js — 상단 `✨ 말로 채우기` 버튼과 그 팝업 (ui 계층)
//
// 신설 파일이다. 흐름은 세 단이고 각 단의 결과를 사용자가 고칠 수 있다:
//   ① 말하거나(🎤, 브라우저 음성 인식) 대충 적는다
//   ② `프롬프트 다듬기` — LLM 이 마디·카운트·동작 이름을 명시한 설명으로 고쳐 준다(편집 가능)
//   ③ `안무표 만들기` — LLM 이 스키마(JSON)로 만들고, 표로 미리 본 뒤 `안무표에 채우기`
// LLM 호출은 주입받은 어댑터(adapters/llmServer)가 서버를 거쳐 한다. 여기서는 fetch 를 모른다.
//
// docsHub·settingsView 와 같은 규약 — 자기 DOM·CSS 를 만들고 index.html 은 건드리지 않는다.
// ⚠ 음성 인식(webkitSpeechRecognition)은 크롬 계열에서만 있고, 없으면 🎤 버튼이 그 사실을 말한다.

import { cellLabel } from '../domain/choreoPlan.js';

const STYLE_ID = 'compose-view-style';
const CSS = `
.compose-overlay { position: fixed; inset: 0; z-index: 6000; display: none;
  background: rgba(6,10,20,0.72); backdrop-filter: blur(3px); }
.compose-overlay[data-open="1"] { display: block; }
.compose-shell { position: absolute; left: 50%; top: 5vh; transform: translateX(-50%);
  width: min(760px, 96vw); max-height: 90vh; overflow-y: auto; display: grid; gap: 12px;
  background: #0f1729; border: 1px solid rgba(148,163,184,0.22); border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45); padding: 0 0 14px; }
.compose-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid rgba(148,163,184,0.16); position: sticky; top: 0; background: #0f1729; z-index: 1; }
.compose-head h2 { margin: 0; font-size: 14px; font-weight: 800; color: #e5e7eb; }
.compose-head .compose-spacer { flex: 1; }
.compose-step { padding: 0 14px; display: grid; gap: 6px; }
.compose-step h3 { margin: 0; font-size: 12.5px; color: #dbe4ef; display: flex; align-items: center; gap: 8px; }
.compose-step h3 .compose-badge { font-size: 10px; font-weight: 800; color: #0b1220; background: #86efac;
  border-radius: 999px; padding: 1px 7px; }
.compose-step textarea { width: 100%; min-height: 84px; resize: vertical; font: inherit; font-size: 12.5px;
  line-height: 1.5; color: #e2e8f0; background: #0b1220; border: 1px solid rgba(148,163,184,0.22);
  border-radius: 8px; padding: 8px 10px; box-sizing: border-box; }
.compose-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.compose-row .compose-grow { flex: 1; }
.compose-status { font-size: 11px; color: #94a3b8; line-height: 1.45; min-height: 1.4em; }
.compose-status.is-error { color: #fca5a5; }
.compose-status.is-busy { color: #a7f3d0; }
.compose-mic.is-on { background: rgba(239,68,68,0.25) !important; border-color: rgba(239,68,68,0.6) !important; }
.compose-table-wrap { overflow-x: auto; }
.compose-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.compose-table th, .compose-table td { border: 1px solid rgba(148,163,184,0.18); padding: 4px 8px; text-align: left; white-space: nowrap; }
.compose-table th { background: rgba(148,163,184,0.10); color: #e2e8f0; font-weight: 700; }
.compose-table tr.is-new td { background: rgba(245,158,11,0.10); }
.compose-table td.compose-note { white-space: normal; color: #94a3b8; }
.compose-new { display: inline-block; font-size: 10px; font-weight: 800; color: #fcd34d; margin-left: 4px; }
.compose-notes { margin: 0; padding-left: 18px; font-size: 11.5px; color: #cbd5e1; }
.compose-notes li { margin: 2px 0; }
.compose-model { font-size: 11px; color: #64748b; }
`;

const NO_SPEECH_TEXT = '이 브라우저에는 음성 인식이 없습니다(크롬·엣지에서 됩니다). 아래 칸에 적어 주세요.';

/**
 * @typedef {object} ComposeViewDeps
 * @property {HTMLElement} container `✨ 말로 채우기` 버튼을 붙일 곳(.top-actions)
 * @property {{
 *   getConfig: () => Promise<{provider:string, model:string, available:boolean}|null>,
 *   refine: (text: string, context: object) => Promise<{ok:true, prompt:string}|{ok:false, error:string}>,
 *   compose: (prompt: string, context: object) => Promise<{ok:true, plan:object}|{ok:false, error:string}>
 * }} llm 서버 중계 어댑터
 * @property {() => {cols:number, rows:number, moves:string[], categories:Record<string,string>}} getContext
 *   모델에게 줄 안무표 맥락(칸 수·행 수·동작 이름·카테고리 키→라벨)
 * @property {(plan: object) => {title:string, items:object[], dropped:object[], notes:string[], rowsNeeded:number, newMoves:string[]}} previewPlan
 * @property {(plan: object, args: {mode:'append'|'replace'}) => any} applyPlan Dirty 를 돌려준다(placed·skipped 포함)
 * @property {(dirty: any) => void} render
 * @property {() => void} [commitHistory]
 * @property {() => number} [getCols]
 * @property {() => boolean} [hasPlacements] 지금 보드에 배치가 있는가(덮어쓰기 선택지를 보여 줄지)
 * @property {Window} [win]
 * @property {Document} [doc]
 */

/**
 * @param {ComposeViewDeps} deps
 * @returns {{ open(): void, close(): void }}
 */
export function createComposeView(deps) {
  const {
    container, llm, getContext, previewPlan, applyPlan, render,
    commitHistory = () => {}, getCols = () => 8, hasPlacements = () => false,
    win = window, doc = document
  } = deps;

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const openBtn = doc.createElement('button');
  openBtn.id = 'composeOpenBtn';
  openBtn.className = 'ghost accent';
  openBtn.type = 'button';
  openBtn.textContent = '✨ 말로 채우기';
  openBtn.title = '말하거나 대충 적은 안무를 LLM 이 다듬어 안무표에 채웁니다';
  if (container) container.appendChild(openBtn);

  const overlay = doc.createElement('div');
  overlay.className = 'compose-overlay';
  overlay.innerHTML = `
    <div class="compose-shell" role="dialog" aria-modal="true" aria-label="말로 채우기">
      <div class="compose-head">
        <h2>말로 채우기</h2>
        <span class="compose-model" data-role="model"></span>
        <span class="compose-spacer"></span>
        <button class="ghost" data-act="close" type="button">✕ 닫기</button>
      </div>

      <section class="compose-step">
        <h3><span class="compose-badge">1</span>말하거나 적는다</h3>
        <textarea data-role="raw" placeholder="예: 첫 마디는 찰스턴 여덟 카운트, 그 다음 재즈 스퀘어, 그리고 셋째 마디 5카운트부터 킥볼체인지 두 번…"></textarea>
        <div class="compose-row">
          <button class="ghost compose-mic" data-act="mic" type="button" title="브라우저 음성 인식으로 받아 적습니다">🎤 말하기</button>
          <button class="ghost" data-act="clear-raw" type="button">비우기</button>
          <span class="compose-grow"></span>
          <button class="primary" data-act="refine" type="button">프롬프트 다듬기 →</button>
        </div>
        <div class="compose-status" data-role="status1"></div>
      </section>

      <section class="compose-step">
        <h3><span class="compose-badge">2</span>다듬은 설명 (고쳐도 됩니다)</h3>
        <textarea data-role="prompt" placeholder="1단계를 거치면 여기에 마디·카운트가 명시된 설명이 들어옵니다. 직접 적어도 됩니다."></textarea>
        <div class="compose-row">
          <span class="compose-grow"></span>
          <button class="primary" data-act="compose" type="button">안무표 만들기 →</button>
        </div>
        <div class="compose-status" data-role="status2"></div>
      </section>

      <section class="compose-step" data-role="preview-section" hidden>
        <h3><span class="compose-badge">3</span>미리 보고 채운다</h3>
        <div class="compose-table-wrap"><table class="compose-table"><thead>
          <tr><th>#</th><th>시작</th><th>길이</th><th>동작</th><th>카테고리</th><th>비고</th></tr>
        </thead><tbody data-role="rows"></tbody></table></div>
        <ul class="compose-notes" data-role="notes"></ul>
        <div class="compose-row">
          <label class="compose-status"><input type="radio" name="composeMode" value="append" checked /> 지금 안무표에 더한다</label>
          <label class="compose-status" data-role="replace-label"><input type="radio" name="composeMode" value="replace" /> 배치를 비우고 새로 채운다</label>
          <span class="compose-grow"></span>
          <button class="primary special" data-act="apply" type="button">안무표에 채우기</button>
        </div>
        <div class="compose-status" data-role="status3"></div>
      </section>
    </div>`;
  doc.body.appendChild(overlay);

  const q = (sel) => overlay.querySelector(sel);
  const rawEl = q('[data-role="raw"]');
  const promptEl = q('[data-role="prompt"]');
  const status1 = q('[data-role="status1"]');
  const status2 = q('[data-role="status2"]');
  const status3 = q('[data-role="status3"]');
  const modelEl = q('[data-role="model"]');
  const previewSection = q('[data-role="preview-section"]');
  const rowsEl = q('[data-role="rows"]');
  const notesEl = q('[data-role="notes"]');
  const replaceLabel = q('[data-role="replace-label"]');
  const micBtn = q('[data-act="mic"]');
  const refineBtn = q('[data-act="refine"]');
  const composeBtn = q('[data-act="compose"]');
  const applyBtn = q('[data-act="apply"]');

  /** 마지막으로 서버가 준 플랜. 미리보기와 채우기가 같은 것을 본다. */
  let lastPlan = null;
  let busy = false;

  function setStatus(el, text, kind = '') {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-busy', kind === 'busy');
  }

  function setBusy(on) {
    busy = on;
    for (const b of [refineBtn, composeBtn, applyBtn]) if (b) b.disabled = on;
  }

  function isOpen() { return overlay.dataset.open === '1'; }

  // ── 음성 인식 ────────────────────────────────────────────────────────────
  const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition || null;
  let recognizer = null;
  /** 인식이 켜지기 전의 텍스트. 중간 결과는 이 뒤에 덧붙여 보여 주고, 확정되면 그 자리에 굳는다. */
  let baseText = '';
  let finalText = '';

  function stopMic() {
    if (recognizer) { try { recognizer.stop(); } catch { /* 이미 멈춤 */ } }
    recognizer = null;
    if (micBtn) { micBtn.classList.remove('is-on'); micBtn.textContent = '🎤 말하기'; }
  }

  function startMic() {
    if (!SpeechCtor) { setStatus(status1, NO_SPEECH_TEXT, 'error'); return; }
    const rec = new SpeechCtor();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    baseText = rawEl.value ? rawEl.value.replace(/\s+$/, '') + ' ' : '';
    finalText = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      rawEl.value = baseText + finalText + interim;
    };
    rec.onerror = (ev) => {
      setStatus(status1, ev && ev.error === 'not-allowed'
        ? '마이크 사용이 거부됐습니다. 주소창의 권한에서 허용해 주세요.'
        : `음성 인식 오류: ${ev && ev.error}`, 'error');
      stopMic();
    };
    rec.onend = () => { if (recognizer === rec) stopMic(); };
    recognizer = rec;
    try { rec.start(); } catch (e) { setStatus(status1, `음성 인식을 시작하지 못했습니다: ${e && e.message}`, 'error'); stopMic(); return; }
    micBtn.classList.add('is-on');
    micBtn.textContent = '⏹ 그만 듣기';
    setStatus(status1, '듣고 있습니다 — 말이 끝나면 다시 눌러 멈추세요.', 'busy');
  }

  // ── 단계 ────────────────────────────────────────────────────────────────

  async function refreshModel() {
    const cfg = await llm.getConfig();
    if (!modelEl) return;
    if (!cfg) { modelEl.textContent = '서버 없음 — python3 server.py 로 열어야 됩니다'; return; }
    modelEl.textContent = cfg.available
      ? `${cfg.provider} · ${cfg.model}`
      : `${cfg.provider} · ${cfg.model} — 키 없음(⚙ 설정)`;
  }

  async function refine() {
    if (busy) return;
    stopMic();
    const text = rawEl.value.trim();
    if (!text) { setStatus(status1, '먼저 말하거나 적어 주세요.', 'error'); return; }
    setBusy(true);
    setStatus(status1, 'LLM 이 다듬는 중… (수십 초 걸릴 수 있습니다)', 'busy');
    const r = await llm.refine(text, getContext());
    setBusy(false);
    if (!r.ok) { setStatus(status1, r.error, 'error'); return; }
    promptEl.value = r.prompt;
    setStatus(status1, '다듬었습니다. 2단계에서 고치거나 바로 만들 수 있습니다.');
    promptEl.focus();
  }

  async function compose() {
    if (busy) return;
    const prompt = promptEl.value.trim();
    if (!prompt) { setStatus(status2, '다듬은 설명이 비어 있습니다. 1단계를 거치거나 직접 적어 주세요.', 'error'); return; }
    setBusy(true);
    setStatus(status2, 'LLM 이 안무표 스키마를 만드는 중…', 'busy');
    const r = await llm.compose(prompt, getContext());
    setBusy(false);
    if (!r.ok) { setStatus(status2, r.error, 'error'); return; }
    lastPlan = r.plan;
    renderPreview();
    setStatus(status2, `${(r.plan.moves || []).length}개 동작으로 정리했습니다. 아래에서 확인하세요.`);
  }

  function renderPreview() {
    if (!lastPlan) { previewSection.hidden = true; return; }
    const p = previewPlan(lastPlan);
    const cols = getCols();
    rowsEl.innerHTML = '';
    p.items.forEach((it, i) => {
      const tr = doc.createElement('tr');
      if (it.created) tr.className = 'is-new';
      tr.innerHTML =
        `<td>${i + 1}</td><td>${esc(cellLabel(it.row, it.index, cols))}</td><td>${it.length}c</td>`
        + `<td>${esc(it.name)}${it.created ? '<span class="compose-new">새 동작</span>' : ''}</td>`
        + `<td>${esc(it.category)}</td><td class="compose-note">${esc(it.note)}</td>`;
      rowsEl.appendChild(tr);
    });
    notesEl.innerHTML = '';
    const lines = [];
    if (p.title) lines.push(`제목: ${p.title}`);
    if (p.rowsNeeded > 0) lines.push(`마지막 마디: ${cols}x${p.rowsNeeded} (모자라면 행을 늘립니다)`);
    if (p.newMoves.length) lines.push(`동작 목록에 없어 새로 만들 동작 ${p.newMoves.length}개: ${p.newMoves.join(', ')}`);
    for (const d of p.dropped) lines.push(`버림: ${d.name} — ${d.reason}`);
    for (const n of p.notes) lines.push(`모델 메모: ${n}`);
    for (const line of lines) {
      const li = doc.createElement('li');
      li.textContent = line;
      notesEl.appendChild(li);
    }
    if (replaceLabel) replaceLabel.hidden = !hasPlacements();
    previewSection.hidden = false;
    setStatus(status3, p.items.length ? '' : '놓을 수 있는 동작이 없습니다.', p.items.length ? '' : 'error');
    if (applyBtn) applyBtn.disabled = p.items.length === 0;
  }

  function apply() {
    if (busy || !lastPlan) return;
    const modeEl = overlay.querySelector('input[name="composeMode"]:checked');
    const mode = modeEl && modeEl.value === 'replace' && hasPlacements() ? 'replace' : 'append';
    const { placed = 0, skipped = 0, ...dirty } = applyPlan(lastPlan, { mode }) || {};
    render(dirty);
    commitHistory();
    setStatus(status3, `${placed}개를 놓았습니다${skipped ? `, ${skipped}개는 자리가 없어 건너뛰었습니다` : ''}. Undo 로 되돌릴 수 있습니다.`);
    if (placed) close();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function open() {
    overlay.dataset.open = '1';
    refreshModel();
    rawEl.focus();
  }

  function close() {
    stopMic();
    delete overlay.dataset.open;
  }

  openBtn.onclick = open;
  overlay.addEventListener('click', (e) => {
    const act = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!act) { if (e.target === overlay) close(); return; }
    switch (act.dataset.act) {
      case 'close': close(); break;
      case 'mic': recognizer ? stopMic() : startMic(); break;
      case 'clear-raw': rawEl.value = ''; setStatus(status1, ''); break;
      case 'refine': refine(); break;
      case 'compose': compose(); break;
      case 'apply': apply(); break;
      default: break;
    }
  });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  return { open, close };
}
