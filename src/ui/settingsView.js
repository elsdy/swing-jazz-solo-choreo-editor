// src/ui/settingsView.js — 상단 `⚙ 설정` 버튼과 설정 팝업 (ui 계층)
//
// 신설 파일이다. 이 앱에는 지금까지 설정 화면이 없었다 — 기본 카운트·정렬처럼 화면에 붙은 조작이 전부였다.
// 첫 항목은 **영상 보관 폴더**다: 업로드한 영상을 어느 폴더 아래 `video-clip/<프로젝트>/` 로 복사할지.
//
// docsHub 와 같은 규약이다 — 자기 DOM 과 자기 <style> 을 만들어 붙이고 index.html 은 건드리지 않는다.
// 어댑터(clipLibrary)는 import 하지 않고 함수로 주입받는다(ui 는 브라우저 저장소를 모른다).

const STYLE_ID = 'settings-view-style';
const CSS = `
.settings-overlay { position: fixed; inset: 0; z-index: 6000; display: none;
  background: rgba(6,10,20,0.72); backdrop-filter: blur(3px); }
.settings-overlay[data-open="1"] { display: block; }
.settings-shell { position: absolute; left: 50%; top: 8vh; transform: translateX(-50%);
  width: min(560px, 94vw); max-height: 84vh; overflow-y: auto;
  background: #0f1729; border: 1px solid rgba(148,163,184,0.22); border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45); }
.settings-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid rgba(148,163,184,0.16); }
.settings-head h2 { margin: 0; font-size: 14px; font-weight: 800; color: #e5e7eb; }
.settings-head .settings-spacer { flex: 1; }
.settings-body { padding: 14px; display: grid; gap: 16px; }
.settings-section h3 { margin: 0 0 6px; font-size: 12.5px; color: #dbe4ef; }
.settings-section .helper { margin: 6px 0 0; }
.settings-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.settings-label { font-size: 11px; color: #8892a4; white-space: nowrap; }
.settings-chip { font-size: 11px; color: #a7f3d0; background: rgba(34,197,94,0.14);
  border: 1px solid rgba(34,197,94,0.25); border-radius: 999px; padding: 2px 8px;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-chip.is-off { color: #94a3b8; background: rgba(148,163,184,0.10); border-color: rgba(148,163,184,0.22); }
.settings-text { width: 10em; }
.settings-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #cbd5e1;
  background: rgba(148,163,184,0.10); border-radius: 6px; padding: 4px 8px; margin-top: 6px; word-break: break-all; }
`;

/** 이 브라우저가 폴더 지정을 못 할 때의 안내. 기능이 없는 것이지 고장이 아니다. */
const UNSUPPORTED_TEXT = '이 브라우저는 폴더 지정을 지원하지 않습니다(크롬·엣지에서만 됩니다). 영상 파일은 열 수 있지만 보관 폴더에 복사되지 않아, 다음에 열 때 같은 파일을 다시 골라야 합니다.';

/**
 * @typedef {object} SettingsViewDeps
 * @property {HTMLElement} container `⚙ 설정` 버튼을 붙일 곳(.top-actions)
 * @property {() => {folderName:string, subdir:string}} getClipSetting localStorage 의 설정을 읽는다
 * @property {(next: {folderName:string, subdir:string}) => void} saveClipSetting
 * @property {{
 *   isSupported: () => boolean,
 *   getFolder: () => Promise<{name:string}|null>,
 *   pickFolder: () => Promise<{name:string}|null>,
 *   forgetFolder: () => Promise<void>
 * }} clips 어댑터의 폴더 부분. ★ pickFolder 는 클릭 핸들러 안에서 불러야 한다(브라우저 제약)
 * @property {{
 *   isActive: () => boolean,
 *   getConfig: () => Promise<{root:string, subdir:string, dir:string}|null>,
 *   setConfig: (next: {root?: string, subdir?: string}) => Promise<{root:string, subdir:string, dir:string}|null>
 * }} [server] 로컬 서버(server.py)의 보관 설정. isActive 가 참이면 폴더 선택 대신 경로 입력을 보여 준다
 * @property {{
 *   getConfig: () => Promise<{provider:string, model:string, baseUrl:string, hasKey:boolean, keyFromEnv:boolean, available:boolean}|null>,
 *   setConfig: (next: object) => Promise<object|null>
 * }} [llm] 서버의 LLM 설정(server.py). 서버 모드에서만 보인다. 키 값은 서버가 돌려주지 않는다
 * @property {() => string} [getProjectName] 경로 미리보기에 쓸 지금 프로젝트 이름
 * @property {(subdir: string, projectName: string) => string[]} [previewDirParts] 미리보기 경로 조각(domain/clips.clipDirParts)
 * @property {() => void} [onChange] 설정이 바뀌었다 — 호출부가 패널 문구 등을 다시 그린다
 * @property {Document} [doc]
 */

/**
 * 설정 화면을 만들고 진입 버튼을 붙인다.
 * @param {SettingsViewDeps} deps
 * @returns {{ open(): void, close(): void, render(): Promise<void> }}
 */
export function createSettingsView(deps) {
  const {
    container,
    getClipSetting,
    saveClipSetting,
    clips,
    server = null,
    llm = null,
    getProjectName = () => '',
    previewDirParts = (subdir, name) => [subdir || 'video-clip', name || '_미지정'],
    onChange = () => {},
    doc = document
  } = deps;

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const openBtn = doc.createElement('button');
  openBtn.id = 'settingsOpenBtn';
  openBtn.className = 'ghost';
  openBtn.type = 'button';
  openBtn.textContent = '⚙ 설정';
  openBtn.title = '영상 보관 폴더 등 이 브라우저의 설정';
  if (container) container.appendChild(openBtn);

  const overlay = doc.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-shell" role="dialog" aria-modal="true" aria-label="설정">
      <div class="settings-head">
        <h2>설정</h2>
        <span class="settings-spacer"></span>
        <button class="ghost" data-act="close" type="button">✕ 닫기</button>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <h3>영상 보관 폴더</h3>
          <div class="helper">영상 패널의 <code>📁 영상 파일 열기</code> 로 고른 영상을 이 폴더 아래에 복사해 둡니다. 그러면 저장한 안무표를 다시 열 때 같은 파일을 다시 고르지 않아도 됩니다. 폴더는 이 브라우저에만 기억되고, 어디로도 올라가지 않습니다.</div>
          <div class="settings-row" data-role="browser-row">
            <span class="settings-label">폴더</span>
            <span class="settings-chip is-off" data-role="folder">미지정</span>
            <button class="ghost accent" data-act="pick" type="button">폴더 지정</button>
            <button class="ghost" data-act="forget" type="button">해제</button>
          </div>
          <div class="settings-row" data-role="server-row" hidden>
            <span class="settings-label">서버 보관 루트</span>
            <input class="settings-text" data-role="root" type="text" style="width: 22em; max-width: 100%;" placeholder="/절대/경로" />
            <button class="ghost accent" data-act="apply-root" type="button">적용</button>
          </div>
          <div class="settings-row">
            <span class="settings-label">하위 폴더</span>
            <input class="settings-text" data-role="subdir" type="text" placeholder="video-clip" />
            <span class="settings-label">/ 프로젝트 이름 / 파일 이름</span>
          </div>
          <div class="settings-path" data-role="preview"></div>
          <div class="helper" data-role="note"></div>
        </section>

        <section class="settings-section" data-role="llm-section" hidden>
          <h3>말로 채우기 — LLM</h3>
          <div class="helper"><code>✨ 말로 채우기</code> 가 쓰는 모델입니다. 호출은 로컬 서버가 대신 하고, API 키는 서버의 설정 파일(<code>.clipserver.json</code>)에만 남습니다 — 브라우저로 오지 않습니다.</div>
          <div class="settings-row">
            <span class="settings-label">제공자</span>
            <select data-role="llm-provider" class="video-pick">
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai">OpenAI (GPT·Codex)</option>
              <option value="ollama">로컬 LLM (Ollama · LM Studio · llama.cpp)</option>
            </select>
            <span class="settings-label">모델</span>
            <input class="settings-text" data-role="llm-model" type="text" placeholder="claude-opus-5" style="width: 16em;" />
            <button class="ghost" data-act="llm-models" type="button" title="지금 주소·키로 모델 목록을 받아 옵니다">목록 받기</button>
          </div>
          <div class="settings-row" data-role="llm-pick-row" hidden>
            <span class="settings-label">서버의 모델</span>
            <select data-role="llm-pick" class="video-pick" style="max-width: 100%;"></select>
          </div>
          <div class="settings-row">
            <span class="settings-label">주소</span>
            <input class="settings-text" data-role="llm-base" type="text" style="width: 22em; max-width: 100%;" placeholder="https://api.anthropic.com" />
          </div>
          <div class="settings-row" data-role="llm-key-row">
            <span class="settings-label">API 키</span>
            <input class="settings-text" data-role="llm-key" type="password" style="width: 22em; max-width: 100%;" placeholder="입력한 것만 서버에 저장됩니다" autocomplete="off" />
            <span class="settings-chip is-off" data-role="llm-key-state">키 없음</span>
          </div>
          <div class="settings-row">
            <button class="ghost accent" data-act="llm-save" type="button">저장</button>
            <button class="ghost" data-act="llm-clear-key" type="button">키 지우기</button>
          </div>
          <div class="helper" data-role="llm-note"></div>
        </section>
      </div>
    </div>`;
  doc.body.appendChild(overlay);

  const folderChip = overlay.querySelector('[data-role="folder"]');
  const browserRow = overlay.querySelector('[data-role="browser-row"]');
  const serverRow = overlay.querySelector('[data-role="server-row"]');
  const rootInput = overlay.querySelector('[data-role="root"]');
  const subdirInput = overlay.querySelector('[data-role="subdir"]');
  const previewEl = overlay.querySelector('[data-role="preview"]');
  const noteEl = overlay.querySelector('[data-role="note"]');
  const pickBtn = overlay.querySelector('[data-act="pick"]');
  const llmSection = overlay.querySelector('[data-role="llm-section"]');
  const llmProvider = overlay.querySelector('[data-role="llm-provider"]');
  const llmModel = overlay.querySelector('[data-role="llm-model"]');
  const llmBase = overlay.querySelector('[data-role="llm-base"]');
  const llmKey = overlay.querySelector('[data-role="llm-key"]');
  const llmKeyRow = overlay.querySelector('[data-role="llm-key-row"]');
  const llmKeyState = overlay.querySelector('[data-role="llm-key-state"]');
  const llmNote = overlay.querySelector('[data-role="llm-note"]');
  const llmPickRow = overlay.querySelector('[data-role="llm-pick-row"]');
  const llmPick = overlay.querySelector('[data-role="llm-pick"]');

  /** 제공자별 기본 모델·주소. server.py 의 LLM_DEFAULTS 와 같다(빈 칸의 placeholder 로만 쓴다). */
  const LLM_DEFAULTS = {
    anthropic: { model: 'claude-opus-5', baseUrl: 'https://api.anthropic.com' },
    openai: { model: 'gpt-5', baseUrl: 'https://api.openai.com' },
    ollama: { model: 'llama3.1', baseUrl: 'http://127.0.0.1:11434' }
  };

  /** LLM 항목. 서버 모드에서만 보인다(키를 브라우저에 둘 수 없으므로 브라우저 모드에서는 이 기능 자체가 없다). */
  async function renderLlm() {
    if (!llmSection) return;
    const active = !!(llm && server && server.isActive());
    llmSection.hidden = !active;
    if (!active) return;
    const cfg = await llm.getConfig();
    if (!cfg) { if (llmNote) llmNote.textContent = '서버에서 LLM 설정을 읽지 못했습니다.'; return; }
    const typing = (el) => el && doc.activeElement === el;
    if (llmProvider && !typing(llmProvider)) llmProvider.value = cfg.provider;
    if (llmModel && !typing(llmModel)) llmModel.value = cfg.model;
    if (llmBase && !typing(llmBase)) llmBase.value = cfg.baseUrl;
    if (llmKeyRow) llmKeyRow.hidden = false;      // 로컬도 LM Studio 처럼 토큰을 요구할 수 있다
    if (llmKeyState) {
      llmKeyState.textContent = cfg.hasKey ? (cfg.keyFromEnv ? '키 있음(서버 환경 변수)' : '키 있음(설정 파일)') : (cfg.provider === 'ollama' ? '키 없음(Ollama 는 필요 없음, LM Studio 는 필요)' : '키 없음');
      llmKeyState.classList.toggle('is-off', !cfg.hasKey);
    }
    if (llmNote) {
      llmNote.textContent = cfg.available
        ? `지금 ${cfg.provider} · ${cfg.baseUrl} 의 ${cfg.model} 을 씁니다.${cfg.provider === 'ollama' ? ' 모델 이름이 그 서버에 없으면 로드된 모델을 씁니다 — 목록 받기로 확인하세요.' : ''}`
        : (cfg.provider === 'ollama'
          ? `${cfg.baseUrl} 에 Ollama 나 LM Studio 가 떠 있어야 합니다.`
          : `키가 없어 말로 채우기가 동작하지 않습니다. 위에 키를 넣거나 서버를 ${cfg.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} 환경 변수와 함께 띄우세요.`);
    }
  }
  const forgetBtn = overlay.querySelector('[data-act="forget"]');

  function isOpen() { return overlay.dataset.open === '1'; }

  /** store 가 아니라 설정·어댑터에서 재도출한다(팝업이 열릴 때와 바뀔 때만). */
  async function render() {
    await renderLlm();
    if (server && server.isActive()) { await renderServer(); return; }
    if (browserRow) browserRow.hidden = false;
    if (serverRow) serverRow.hidden = true;
    const setting = getClipSetting();
    const supported = clips.isSupported();
    const folder = supported ? await clips.getFolder() : null;

    if (folderChip) {
      folderChip.textContent = folder ? folder.name : '미지정';
      folderChip.classList.toggle('is-off', !folder);
      folderChip.title = folder ? folder.name : '';
    }
    if (pickBtn) {
      pickBtn.disabled = !supported;
      pickBtn.textContent = folder ? '다른 폴더 지정' : '폴더 지정';
    }
    if (forgetBtn) forgetBtn.disabled = !folder;
    if (subdirInput && doc.activeElement !== subdirInput) subdirInput.value = setting.subdir || '';
    if (previewEl) {
      const parts = previewDirParts(setting.subdir, getProjectName());
      previewEl.textContent = `${folder ? folder.name : '<폴더>'}/${parts.join('/')}/<파일 이름>`;
    }
    if (noteEl) {
      noteEl.textContent = !supported
        ? UNSUPPORTED_TEXT
        : (folder
          ? '브라우저가 세션마다 이 폴더의 사용 허가를 다시 물을 수 있습니다. 그때는 영상 패널의 `📂 보관 폴더에서 불러오기` 를 누르면 됩니다.'
          : '폴더를 지정하면 그 아래에 하위 폴더를 만들어 영상을 복사합니다. 이미 있는 파일은 건드리지 않고, 같은 이름이 있으면 `(2)` 를 붙입니다.');
    }
  }

  /** 서버 모드. 폴더는 서버의 루트이고, 변경은 서버의 설정 파일에 남는다(브라우저 저장소는 쓰지 않는다). */
  async function renderServer() {
    if (browserRow) browserRow.hidden = true;
    if (serverRow) serverRow.hidden = false;
    const cfg = await server.getConfig();
    if (rootInput && doc.activeElement !== rootInput) rootInput.value = cfg ? cfg.root : '';
    if (subdirInput && doc.activeElement !== subdirInput) subdirInput.value = cfg ? cfg.subdir : '';
    if (previewEl) {
      const parts = previewDirParts(cfg ? cfg.subdir : '', getProjectName());
      previewEl.textContent = `${cfg ? cfg.root : '<서버 루트>'}/${parts.join('/')}/<파일 이름>`;
    }
    if (noteEl) {
      noteEl.textContent = cfg
        ? `로컬 서버(server.py)가 영상을 보관합니다. 지금 보관 폴더는 ${cfg.dir} 이고, 서버를 다시 켜도 유지됩니다(저장소의 .clipserver.json). 서버는 이 컴퓨터에서만 접속됩니다.`
        : '로컬 서버에서 설정을 읽지 못했습니다. 서버가 켜져 있는지 확인하세요.';
    }
  }

  function open() {
    overlay.dataset.open = '1';
    render();
  }

  function close() {
    delete overlay.dataset.open;
  }

  openBtn.onclick = open;
  overlay.addEventListener('click', (e) => {
    const act = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!act) {
      if (e.target === overlay) close();          // 바깥 클릭
      return;
    }
    const kind = act.dataset.act;
    if (kind === 'close') { close(); return; }
    if (kind === 'pick') {
      // ★ await 뒤로 미루지 않는다 — showDirectoryPicker 는 클릭 콜스택 안에서만 열린다.
      clips.pickFolder().then((picked) => {
        if (!picked) return;
        saveClipSetting({ ...getClipSetting(), folderName: picked.name });
        render();
        onChange();
      });
      return;
    }
    if (kind === 'forget') {
      clips.forgetFolder().then(() => {
        saveClipSetting({ ...getClipSetting(), folderName: '' });
        render();
        onChange();
      });
      return;
    }
    if (kind === 'llm-save' && llm) {
      const next = {};
      if (llmProvider) next.provider = llmProvider.value;
      if (llmModel) next.model = llmModel.value.trim();
      if (llmBase) next.baseUrl = llmBase.value.trim();
      if (llmKey && llmKey.value) next.apiKey = llmKey.value;      // 비어 있으면 보내지 않는다(기존 키 유지)
      llm.setConfig(next).then((cfg) => {
        if (llmKey) llmKey.value = '';
        if (!cfg && llmNote) llmNote.textContent = '저장하지 못했습니다. 서버가 켜져 있는지 확인하세요.';
        renderLlm();
        onChange();
      });
      return;
    }
    if (kind === 'llm-models' && llm) {
      // 목록은 지금 저장된 설정 기준이다 — 주소·키를 바꿨으면 먼저 저장한다.
      const pending = {};
      if (llmProvider) pending.provider = llmProvider.value;
      if (llmBase) pending.baseUrl = llmBase.value.trim();
      if (llmKey && llmKey.value) pending.apiKey = llmKey.value;
      llm.setConfig(pending).then(() => llm.listModels()).then(({ models, details, error }) => {
        if (llmKey) llmKey.value = '';
        if (llmPick) {
          llmPick.innerHTML = '';
          for (const d of details) {
            const o = doc.createElement('option');
            o.value = d.id;
            o.textContent = d.label;
            llmPick.appendChild(o);
          }
          if (llmModel && models.includes(llmModel.value)) llmPick.value = llmModel.value;
        }
        if (llmPickRow) llmPickRow.hidden = models.length === 0;
        if (llmNote) llmNote.textContent = models.length ? `서버에 모델 ${models.length}개. 아래에서 고르면 모델 칸에 들어갑니다 — 그 뒤 저장하세요. 로드되지 않은 모델은 첫 호출 때 LM Studio 가 그 자리에서 로드합니다.` : (error || '모델 목록이 비어 있습니다.');
        if (llmModel && models.length && !models.includes(llmModel.value)) { llmModel.value = models[0]; if (llmPick) llmPick.value = models[0]; }
      });
      return;
    }
    if (kind === 'llm-clear-key' && llm) {
      llm.setConfig({ apiKey: '' }).then(() => { renderLlm(); onChange(); });
      return;
    }
    if (kind === 'apply-root' && server && rootInput) {
      server.setConfig({ root: rootInput.value.trim() }).then((cfg) => {
        if (!cfg && noteEl) noteEl.textContent = '서버가 그 경로를 만들지 못했습니다. 절대 경로인지, 쓸 수 있는 곳인지 확인하세요.';
        else { render(); onChange(); }
      });
    }
  });
  if (llmPick) llmPick.onchange = () => { if (llmModel) llmModel.value = llmPick.value; };
  if (llmProvider) {
    llmProvider.onchange = () => {
      if (llmPickRow) llmPickRow.hidden = true;
      const d = LLM_DEFAULTS[llmProvider.value] || LLM_DEFAULTS.anthropic;
      if (llmModel) { llmModel.value = d.model; llmModel.placeholder = d.model; }
      if (llmBase) { llmBase.value = d.baseUrl; llmBase.placeholder = d.baseUrl; }
    };
  }
  if (subdirInput) {
    subdirInput.onchange = () => {
      const subdir = subdirInput.value.trim();
      if (server && server.isActive()) {
        server.setConfig({ subdir }).then(() => { render(); onChange(); });
        return;
      }
      saveClipSetting({ ...getClipSetting(), subdir });
      render();
      onChange();
    };
  }
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  return { open, close, render };
}
