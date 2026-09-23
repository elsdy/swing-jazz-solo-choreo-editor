// src/ui/settingsView.js — 상단 `⚙ 설정` 버튼과 설정 팝업 (ui 계층)
//
// 신설 파일이다. 이 앱에는 지금까지 설정 화면이 없었다 — 기본 카운트·정렬처럼 화면에 붙은 조작이 전부였다.
// 첫 항목은 **영상 보관 폴더**다: 업로드한 영상을 어느 폴더 아래 `video-clip/<프로젝트>/` 로 복사할지.
// 2026-09-11 에 **자세 분석 모델**이 붙었다: 관절점을 찾는 파일을 어디에 받아 둘지와 어느 크기를 쓸지.
//
// docsHub 와 같은 규약이다 — 자기 DOM 과 자기 <style> 을 만들어 붙이고 index.html 은 건드리지 않는다.
// 어댑터(clipLibrary)는 import 하지 않고 함수로 주입받는다(ui 는 브라우저 저장소를 모른다).
//
// 단축키 절(2026-09-20)은 domain/hotkeys 의 표를 그대로 읽어 그린다 — 무엇을 바꿀 수 있는지의
// 주인은 거기 하나이고, 이 화면은 그것을 보여 주고 누른 글쇠를 받아 넘기기만 한다.

import {
  EDITABLE_ACTIONS, HOTKEY_ACTIONS, MAX_KEYS_PER_ACTION,
  checkKey, eventKey, keysLabel, normalizeHotkeys, ownerOf, setKeys
} from '../domain/hotkeys.js';
import { DEFAULT_THEME, THEMES, normalizeTheme } from '../domain/themes.js';

const STYLE_ID = 'settings-view-style';
const CSS = `
/* 테마 고르기(2026-09-21). 한 줄이 테마 하나다 — 색 미리보기·이름·한 줄 설명. */
.settings-themes { display: grid; gap: 6px; }
.settings-theme {
  display: flex; align-items: center; gap: 10px; text-align: left; width: 100%;
  padding: 8px 10px; border-radius: 10px; cursor: pointer;
  background: rgba(148,163,184,0.06); border: 1px solid rgba(148,163,184,0.22); color: inherit;
}
.settings-theme:hover { border-color: rgba(34,197,94,0.5); }
.settings-theme.is-on { border-color: rgba(34,197,94,0.75); background: rgba(34,197,94,0.12); }
.settings-theme b { display: block; font-size: 12.5px; }
.settings-theme small { display: block; font-size: 11px; color: #94a3b8; margin-top: 1px; }
.settings-theme-swatch {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 9px;
  border: 1px solid rgba(148,163,184,0.3);
}
.settings-theme-swatch[data-id="basic"] { background: linear-gradient(140deg, #0b1220 0%, #111827 60%, #22c55e 160%); }
.settings-theme-swatch[data-id="neon"] {
  background: radial-gradient(circle at 30% 25%, rgba(56,189,248,0.85), transparent 55%),
              radial-gradient(circle at 75% 80%, rgba(251,191,36,0.9), transparent 55%),
              linear-gradient(160deg, #050b18, #0b1e38);
  border-color: rgba(56,189,248,0.5);
}
.settings-theme-swatch[data-id="rose"] {
  background: radial-gradient(circle at 30% 25%, rgba(244,114,182,0.9), transparent 55%),
              radial-gradient(circle at 78% 82%, rgba(192,132,252,0.9), transparent 55%),
              linear-gradient(160deg, #140a1c, #2a1236);
  border-color: rgba(244,114,182,0.5);
}
.settings-theme-swatch[data-id="candy"] {
  background: radial-gradient(circle at 28% 24%, rgba(244,114,182,0.95), transparent 58%),
              radial-gradient(circle at 78% 80%, rgba(45,212,191,0.9), transparent 58%),
              linear-gradient(160deg, #fff9fd, #f6f0ff);
  border-color: rgba(236,72,153,0.45);
}

/* 단축키 목록(2026-09-20). 한 줄이 동작 하나다 — 이름·하는 일·지금 글쇠·바꾸기. */
.settings-keys { display: grid; gap: 6px; margin-top: 6px; }
.settings-key-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 7px 9px; border-radius: 10px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(148,163,184,0.14); }
.settings-key-row[hidden] { display: none; }
.settings-key-main { flex: 1 1 14em; min-width: 0; }
.settings-key-main b { display: block; font-size: 12px; }
.settings-key-main small { display: block; margin-top: 1px; font-size: 10.5px; color: var(--muted, #94a3b8); line-height: 1.35; }
.settings-key-caps { display: flex; gap: 4px; flex-wrap: wrap; }
.settings-key-cap { font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 6px;
  background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.35); color: #e6edf6; white-space: nowrap; }
.settings-key-row.is-listening .settings-key-cap { border-color: rgba(74,222,128,0.6); color: #bbf7d0; }
.settings-key-fixed .settings-key-cap { opacity: 0.55; }

.settings-overlay { position: fixed; inset: 0; z-index: 6000; display: none;
  background: rgba(6,10,20,0.72); backdrop-filter: blur(3px); }
.settings-overlay[data-open="1"] { display: block; }
.settings-shell { position: absolute; left: 50%; top: 8vh; transform: translateX(-50%);
  width: min(780px, 96vw); max-height: 84vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: #0f1729; border: 1px solid rgba(148,163,184,0.22); border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45); }
.settings-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid rgba(148,163,184,0.16); flex: 0 0 auto; }
.settings-head h2 { margin: 0; font-size: 14px; font-weight: 800; color: #e5e7eb; white-space: nowrap; }
.settings-search { flex: 1; min-width: 0; }
/* 갈래 옆단 + 본문. ⚠ 스크롤은 shell 이 아니라 **본문이** 한다 — 옆단이 같이 흘러가면
   긴 설정에서 갈래를 누르러 위로 되돌아가야 한다. */
.settings-main { display: grid; grid-template-columns: 176px 1fr; min-height: 0; flex: 1 1 auto; }
.settings-side { border-right: 1px solid rgba(148,163,184,0.16); padding: 10px 8px;
  overflow-y: auto; display: grid; gap: 4px; align-content: start; }
.settings-nav-item { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
  min-height: 38px; padding: 6px 9px; cursor: pointer; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: #cbd5e1; font-size: 12px; font-weight: 700; }
.settings-nav-item:hover { background: rgba(148,163,184,0.10); transform: none; }
.settings-nav-item[aria-current="true"] { background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.30); color: #eafff1; }
.settings-nav-item .settings-nav-count { margin-left: auto; font-size: 10px; font-weight: 800; color: #7c8aa3; }
.settings-nav-item[aria-current="true"] .settings-nav-count { color: #a7d8bb; }
.settings-nav-item:disabled { opacity: 0.4; cursor: default; }
.settings-nav-hint { font-size: 10px; color: #64748b; padding: 2px 9px 8px; line-height: 1.4; }
.settings-body { padding: 14px; display: grid; gap: 16px; align-content: start; overflow-y: auto; min-height: 0; }
/* 검색어에 걸린 줄. ⚠ 배경이 아니라 왼쪽 테두리다 — 배경은 갈래 선택이 이미 쓰고 있다. */
.settings-row.is-hit { border-left: 2px solid #86efac; padding-left: 7px; margin-left: -9px; }
.settings-empty { font-size: 12px; color: #94a3b8; line-height: 1.6; }
@media (max-width: 640px) {
  /* 폰: 옆단을 위로 눕힌다. 손가락 과녁이 되도록 줄 높이는 그대로 둔다. */
  .settings-main { grid-template-columns: 1fr; }
  .settings-side { border-right: 0; border-bottom: 1px solid rgba(148,163,184,0.16);
    grid-auto-flow: column; grid-auto-columns: max-content; overflow-x: auto; align-content: center; }
  .settings-nav-hint { display: none; }
}
.settings-section h3 { margin: 0 0 6px; font-size: 12.5px; color: #dbe4ef; }
.settings-section .helper { margin: 6px 0 0; }
.settings-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
/* ⚠ 반드시 있어야 한다. 위의 display:flex 가 브라우저 기본 [hidden]{display:none} 을 이겨서,
   이 줄이 없으면 row.hidden = true 가 아무 일도 하지 않는다 — 서버 모드에서 브라우저 전용 줄
   (폴더 지정·해제)이 그대로 보이고, 눌러도 되는 일이 없어 "버튼이 안 눌린다" 로 보인다.
   같은 함정을 이 저장소가 다섯 번 막았다(.video-panel · .video-field · .docs-toc-children …).
   ⚠ 이 CSS 는 템플릿 문자열 안이다 — 주석에 백틱을 쓰면 문자열이 거기서 끊겨 모듈 전체가 죽는다. */
.settings-row[hidden] { display: none; }
.settings-label { font-size: 11px; color: #8892a4; white-space: nowrap; }
.settings-chip { font-size: 11px; color: #a7f3d0; background: rgba(34,197,94,0.14);
  border: 1px solid rgba(34,197,94,0.25); border-radius: 999px; padding: 2px 8px;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-chip.is-off { color: #94a3b8; background: rgba(148,163,184,0.10); border-color: rgba(148,163,184,0.22); }
.settings-text { width: 10em; }
.settings-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #cbd5e1;
  background: rgba(148,163,184,0.10); border-radius: 6px; padding: 4px 8px; margin-top: 6px; word-break: break-all; }
/* 저장장치 고르기(2026-09-13). 폰에서 누르는 것이라 줄마다 최소 44px 을 준다(손가락 과녁). */
.settings-volumes { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
.settings-volume { display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  min-height: 44px; width: 100%; text-align: left; padding: 6px 10px; cursor: pointer;
  color: #e2e8f0; background: rgba(148,163,184,0.08); border: 1px solid rgba(148,163,184,0.18);
  border-radius: 8px; font-size: 12px; }
.settings-volume:hover:not(:disabled) { background: rgba(148,163,184,0.16); }
.settings-volume.is-current { border-color: rgba(34,197,94,0.45); background: rgba(34,197,94,0.10); }
.settings-volume span { font-size: 10px; color: #94a3b8; word-break: break-all; }
.settings-volume:disabled { opacity: 0.45; cursor: not-allowed; }
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
 * @property {{
 *   getStatus: () => Promise<object|null>,
 *   setConfig: (next: {dir?: string, poseModel?: string}) => Promise<object|null>,
 *   fetchOne: (key: string) => Promise<{ok:boolean, error?:string, bytes?:number}>
 * }} [models] 자세 분석 모델의 보관 위치(server.py). 서버 모드에서만 보인다
 * @property {() => string} [getProjectName] 경로 미리보기에 쓸 지금 프로젝트 이름
 * @property {(subdir: string, projectName: string) => string[]} [previewDirParts] 미리보기 경로 조각(domain/clips.clipDirParts)
 * @property {() => void} [onChange] 설정이 바뀌었다 — 호출부가 패널 문구 등을 다시 그린다
 * @property {Window} [win] `location.hostname` 으로 관리 화면을 열 수 있는 기기인지 본다
 * @property {Document} [doc]
 */

/**
 * 설정 화면을 만들고 진입 버튼을 붙인다.
 * @param {SettingsViewDeps} deps
 * @returns {{ open(): void, close(): void, render(): Promise<void> }}
 */
/**
 * 단축키 줄을 그리고 글쇠를 받는다. createSettingsView 안에서만 쓴다.
 * 바깥으로 빼지 않은 이유: 이 절의 DOM 과 상태(지금 무엇을 받는 중인가)가 여기 갇혀 있어야
 * 다른 절이 실수로 건드릴 수 없다.
 */
export function createSettingsView(deps) {
  const {
    container,
    getClipSetting,
    saveClipSetting,
    clips,
    server = null,
    llm = null,
    models = null,
    getProjectName = () => '',
    previewDirParts = (subdir, name) => [subdir || 'video-clip', name || '_미지정'],
    onChange = () => {},
    // 단축키(2026-09-20). ui 는 저장소를 모르므로 읽고 쓰는 것은 주입받는다.
    // ⚠ getHotkeys 는 **게터다** — 설정 화면이 열려 있는 동안에도 바깥이 바꿀 수 있다.
    getHotkeys = null,
    saveHotkeys = () => {},
    // 작업 차례 기록(2026-09-21). 이 화면은 **읽고 지우기만** 한다 — 세는 것도 담는 것도 바깥이다.
    flow = { top: () => [], total: () => 0, clear: () => {} },
    // 테마(2026-09-21). 목록의 주인은 domain/themes 이고, 고르면 바깥이 담고 `<html>` 에 바른다.
    getTheme = () => DEFAULT_THEME,
    setTheme = () => {},
    doc = document,
    // 관리 화면을 열 수 있는 기기인지 판정하고 새 탭을 여는 데 쓴다. 테스트가 가짜를 준다.
    win = typeof window === 'undefined' ? { location: { hostname: '' }, open() {} } : window
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
        <input class="settings-search" data-role="search" type="search" placeholder="설정 검색 — 폴더 · 모델 · API 키 …" autocomplete="off" />
        <button class="ghost" data-act="close" type="button">✕ 닫기</button>
      </div>
      <div class="settings-main">
        <nav class="settings-side" data-role="nav" aria-label="설정 갈래"></nav>
      <div class="settings-body">
        <section class="settings-section" data-cat="storage" data-available="1"
          data-keywords="영상 클립 video clip 경로 path 폴더 디렉터리 저장 업로드 보관">
          <h3>영상 보관 폴더</h3>
          <div class="helper">영상 패널의 <code>📁 영상 파일 열기</code> 로 고른 영상을 이 폴더 아래에 복사해 둡니다. 그러면 저장한 안무표를 다시 열 때 같은 파일을 다시 고르지 않아도 됩니다. 폴더는 이 브라우저에만 기억되고, 어디로도 올라가지 않습니다.</div>
          <div class="settings-row" data-role="browser-row">
            <span class="settings-label">폴더</span>
            <span class="settings-chip is-off" data-role="folder">미지정</span>
            <button class="ghost accent" data-act="pick" type="button">폴더 지정</button>
            <button class="ghost" data-act="forget" type="button">해제</button>
          </div>
          <!-- ⚠ 서버 모드에서는 **읽기만** 한다(2026-09-13). 보관 위치를 정하는 것은 서버의 일이다 —
               클라이언트가 정하면 브라우저마다 다른 답을 들고 같은 서버를 서로 다르게 설정하게 된다.
               바꾸는 자리는 서버의 관리 화면(/admin) 하나다. -->
          <div class="settings-row" data-role="server-row" hidden>
            <span class="settings-label">보관 위치</span>
            <span class="settings-chip" data-role="server-root">—</span>
            <button class="ghost accent" data-act="open-admin" type="button">서버 설정 열기 ↗</button>
          </div>
          <div class="settings-row">
            <span class="settings-label">하위 폴더</span>
            <input class="settings-text" data-role="subdir" type="text" placeholder="video-clip" />
            <span class="settings-label">/ 프로젝트 이름 / 파일 이름</span>
          </div>
          <div class="settings-path" data-role="preview"></div>
          <div class="helper" data-role="note"></div>
        </section>

        <section class="settings-section" data-role="projects-section" data-cat="storage"
          data-keywords="프로젝트 안무표 json 저장 최근 목록 폴더 경로 백업 보관">
          <h3>프로젝트 보관 폴더</h3>
          <div class="helper"><code>프로젝트 저장</code> 을 누르면 안무표가 이 폴더에도 쌓이고, <b>최근 프로젝트 목록이 이 폴더를 읽습니다</b>. 다운로드 폴더로도 그대로 떨어지므로 남에게 보내거나 백업하는 길은 바뀌지 않습니다. 영상과 같은 루트 아래 <b>다른 폴더</b>라 한 자리만 백업하면 둘 다 들어갑니다.</div>
          <div class="settings-row">
            <span class="settings-label">하위 폴더</span>
            <input class="settings-text" data-role="projects-subdir" type="text" placeholder="projects" disabled />
            <button class="ghost accent" data-act="open-admin" type="button">서버 설정 열기 ↗</button>
            <span class="settings-label">/ 프로젝트 이름.json</span>
          </div>
          <div class="settings-path" data-role="projects-preview"></div>
          <div class="helper" data-role="projects-note"></div>
        </section>

        <section class="settings-section" data-role="models-section" data-cat="models"
          data-keywords="자세 관절 포즈 pose mediapipe 모델 다운로드 내려받기 GPU 분석 크기 lite full heavy">
          <h3>자세 분석 모델</h3>
          <div class="helper">영상에서 관절 위치를 찾아 주는 파일입니다. 계산은 <b>이 브라우저가</b> 하고 서버는 파일을 받아 두고 내주기만 합니다 — 영상은 이 컴퓨터 밖으로 나가지 않습니다. 한 번 받아 두면 그 뒤로는 인터넷 없이 됩니다. 받지 않아도 나머지 기능은 전부 그대로입니다.</div>
          <div class="settings-row">
            <span class="settings-label">저장 위치</span>
            <input class="settings-text" data-role="models-dir" type="text" style="width: 22em; max-width: 100%;" placeholder="/절대/경로" />
            <button class="ghost accent" data-act="models-browse" type="button" title="폴더 고르기 창을 띄웁니다">📂 폴더 고르기</button>
            <button class="ghost" data-act="models-apply" type="button">적용</button>
          </div>
          <div class="settings-row" data-role="models-suggest"></div>
          <div class="settings-row">
            <span class="settings-label">모델 크기</span>
            <select data-role="models-size" class="video-pick">
              <option value="lite">가벼움 (lite)</option>
              <option value="full">보통 (full)</option>
              <option value="heavy">정확함 (heavy)</option>
            </select>
            <span class="settings-chip is-off" data-role="models-state">확인 중…</span>
            <button class="ghost accent" data-act="models-fetch" type="button">내려받기</button>
          </div>
          <div class="settings-path" data-role="models-files"></div>
          <div class="helper" data-role="models-note"></div>
        </section>

        <section class="settings-section" data-role="llm-section" data-cat="models"
          data-keywords="말로 채우기 LLM AI 프롬프트 claude anthropic openai gpt codex ollama lm studio 모델 API 키 key token 주소 baseurl">
          <h3>말로 채우기 — LLM</h3>
          <div class="helper"><code>✨ 말로 채우기</code> 가 쓰는 모델입니다. 호출은 로컬 서버가 대신 하고, API 키는 서버의 설정 파일에만 남습니다 — 저장소 밖, 안무·영상 폴더와도 다른 자리입니다. 브라우저로 오지 않습니다.</div>
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
        <section class="settings-section" data-role="keys-section" data-cat="keys" data-available="1"
          data-keywords="단축키 글쇠 키보드 hotkey shortcut key 스페이스 space 받아 적기 건너뛰기 재생 일시정지">
          <h3>단축키</h3>
          <div class="helper">영상을 보면서 손을 자판에 두고 쓰는 글쇠입니다. 바꾸려면 <code>바꾸기</code> 를 누르고 원하는 글쇠를 누르세요. <b>글자를 치는 중에는 듣지 않습니다</b> — 동작 이름을 입력하는 동안 안무표가 바뀌는 일은 없습니다. 이 설정은 이 브라우저에만 남고 안무표 파일에는 들어가지 않습니다.</div>
          <div class="settings-keys" data-role="keys-list"></div>
          <div class="settings-row">
            <button class="ghost" data-act="keys-reset" type="button">기본값으로</button>
            <span class="settings-label" data-role="keys-note"></span>
          </div>
        </section>
        <section class="settings-section" data-role="theme-section" data-cat="theme" data-available="1"
          data-keywords="테마 모양 색 디자인 네온 neon theme 다크 어둡게 빛">
          <h3>테마</h3>
          <div class="helper">화면의 색과 빛을 고릅니다. <b>안무 블록의 색은 바뀌지 않습니다</b> — 그 색은 카테고리의 뜻이라 테마가 아닙니다. 이 브라우저에만 남고 안무표 파일에는 들어가지 않습니다.</div>
          <div class="settings-themes" data-role="theme-list"></div>
        </section>
        <section class="settings-section" data-role="flow-section" data-cat="flow" data-available="1"
          data-keywords="작업 차례 workflow 순서 기록 버릇 통계 다음 적응형">
          <h3>작업 차례</h3>
          <div class="helper">어떤 버튼 다음에 어떤 버튼을 눌렀는지 세어 둔 것입니다. <b>이 기록으로 화면이 바뀌지는 않습니다</b> — 영상 아래 단계 줄에 <code>다음</code> 표식 하나를 어디에 붙일지만 정하고, 같은 길을 다섯 번 넘게 갔으며 그것이 절반을 넘을 때만 붙습니다. 이 브라우저에만 남고 안무표 파일에는 들어가지 않습니다.</div>
          <div class="settings-path" data-role="flow-list"></div>
          <div class="settings-row">
            <button class="ghost" data-act="flow-clear" type="button">기록 지우기</button>
            <span class="settings-label" data-role="flow-note"></span>
          </div>
        </section>
        <div class="settings-empty" data-role="empty" hidden></div>
      </div>
      </div>
    </div>`;
  doc.body.appendChild(overlay);

  // ── 갈래와 검색 ──────────────────────────────────────────────────────────
  //
  // 설정이 넷을 넘어가면서 한 줄로 이어 놓은 화면이 읽히지 않게 됐다. 갈래로 묶고, 갈래를 몰라도
  // 닿을 수 있게 검색을 둔다. **목록의 주인은 아래 CATEGORIES 하나이고** 절은 `data-cat` 으로
  // 자기 갈래를 밝힌다 — 설정 하나를 더하는 일이 `<section data-cat="…">` 한 줄로 끝나야 한다.
  //
  // ⚠ 절의 보임/숨김은 이제 **두 가지가 곱해져** 정해진다: 지금 쓸 수 있는가(`data-available`,
  //   서버 모드에서만 나오는 절이 있다)와 지금 고른 갈래·검색어에 걸리는가. 그래서 `section.hidden`
  //   을 직접 대입하는 자리를 남기지 않고 전부 applyFilter 를 거친다.
  const CATEGORIES = Object.freeze([
    Object.freeze({ id: 'storage', label: '보관 자리', hint: '파일이 어디에 쌓이는가' }),
    Object.freeze({ id: 'models', label: '모델', hint: '자세 분석과 말로 채우기가 쓰는 모델' }),
    Object.freeze({ id: 'keys', label: '단축키', hint: '손을 자판에 두고 쓰는 글쇠' }),
    Object.freeze({ id: 'flow', label: '작업 차례', hint: '어떤 버튼 다음에 어떤 버튼을 눌렀나' }),
    Object.freeze({ id: 'theme', label: '테마', hint: '화면 전체의 색과 빛' })
  ]);
  const ALL_CAT = 'all';

  const sections = [...overlay.querySelectorAll('.settings-section')];
  const navEl = overlay.querySelector('[data-role="nav"]');
  const searchEl = overlay.querySelector('[data-role="search"]');
  const emptyEl = overlay.querySelector('[data-role="empty"]');

  /** 지금 고른 갈래. 검색 중에는 무시한다(검색은 언제나 전부에서 찾는다). */
  let activeCat = ALL_CAT;
  /** 지금 검색어(소문자·앞뒤 공백 제거). 빈 문자열이면 검색하지 않는 상태다. */
  let query = '';

  /** 지금 화면에 낼 수 있는 절인가. 서버가 없으면 서버 전용 절이 여기서 걸린다. */
  const isAvailable = (sec) => sec.dataset.available === '1';

  /**
   * 절을 쓸 수 있게/없게 표시한다. 호출부는 `section.hidden` 을 직접 만지지 않는다 —
   * 최종 보임 여부는 갈래·검색과 함께 applyFilter 가 정한다.
   */
  function setAvailable(sec, on) {
    if (!sec) return;
    if (on) sec.dataset.available = '1'; else delete sec.dataset.available;
    applyFilter();
  }

  /** 검색 대상 문자열. 화면에 보이는 글자 + 절이 밝힌 키워드(`data-keywords`)다. */
  function haystack(sec) {
    return `${sec.textContent} ${sec.dataset.keywords || ''}`.toLowerCase();
  }

  /** 갈래·검색어를 한 번에 적용한다. 이 함수가 절의 `hidden` 을 정하는 **유일한 자리**다. */
  function applyFilter() {
    const searching = query !== '';
    let shown = 0;
    const hitsByCat = new Map(CATEGORIES.map(c => [c.id, 0]));

    for (const sec of sections) {
      const usable = isAvailable(sec);
      const inCat = searching || activeCat === ALL_CAT || sec.dataset.cat === activeCat;
      const hit = !searching || haystack(sec).includes(query);
      const visible = usable && inCat && hit;
      sec.hidden = !visible;
      if (usable && hit) hitsByCat.set(sec.dataset.cat, (hitsByCat.get(sec.dataset.cat) || 0) + 1);
      if (visible) shown += 1;

      // 걸린 줄에 표시를 남긴다. 절 제목·설명만 걸린 경우에는 어느 줄에도 붙지 않는다.
      for (const row of sec.querySelectorAll('.settings-row')) {
        const rowHit = searching && !row.hidden && row.textContent.toLowerCase().includes(query);
        row.classList.toggle('is-hit', rowHit);
      }
    }

    for (const btn of navEl.querySelectorAll('.settings-nav-item')) {
      const id = btn.dataset.cat;
      const count = id === ALL_CAT
        ? [...hitsByCat.values()].reduce((a, b) => a + b, 0)
        : (hitsByCat.get(id) || 0);
      btn.querySelector('.settings-nav-count').textContent = count === 0 ? '' : String(count);
      btn.disabled = count === 0 && !searching;
      // 검색 중에는 갈래가 아니라 `전체` 가 켜진 것으로 보인다 — 실제로 전부에서 찾기 때문이다.
      btn.setAttribute('aria-current', String((searching ? ALL_CAT : activeCat) === id));
    }

    if (emptyEl) {
      emptyEl.hidden = shown > 0;
      emptyEl.textContent = shown > 0 ? ''
        : (searching ? `‘${searchEl.value.trim()}’ 에 맞는 설정이 없습니다. 다른 말로 찾아보세요 — 폴더 · 모델 · 키 · 주소.`
          : '이 갈래에 지금 쓸 수 있는 설정이 없습니다. 서버로 열면(python3 server.py) 더 나옵니다.');
    }
  }

  // 옆단은 CATEGORIES 에서 만든다(화면 코드에 갈래를 손으로 적지 않는다).
  for (const cat of [{ id: ALL_CAT, label: '전체', hint: '' }, ...CATEGORIES]) {
    const btn = doc.createElement('button');
    btn.className = 'settings-nav-item';
    btn.type = 'button';
    btn.dataset.cat = cat.id;
    btn.innerHTML = `<span>${cat.label}</span><span class="settings-nav-count"></span>`;
    if (cat.hint) btn.title = cat.hint;
    navEl.appendChild(btn);
    if (cat.hint) {
      const hint = doc.createElement('div');
      hint.className = 'settings-nav-hint';
      hint.textContent = cat.hint;
      navEl.appendChild(hint);
    }
  }
  navEl.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.settings-nav-item') : null;
    if (!btn) return;
    activeCat = btn.dataset.cat;
    // 갈래를 고르는 것은 "검색을 그만두고 이 묶음을 본다"는 뜻이다.
    if (query) { query = ''; searchEl.value = ''; }
    applyFilter();
  });
  if (searchEl) {
    // ⚠ input 에 건다(change 가 아니다). 설정 검색은 값을 확정하는 것이 아니라 좁혀 가는 것이라
    //   글자마다 결과가 따라와야 한다 — 여기서는 되돌리기도 저장도 일어나지 않는다.
    searchEl.oninput = () => { query = searchEl.value.trim().toLowerCase(); applyFilter(); };
  }
  // 첫 상태를 한 번 맞춘다. 서버 전용 절은 아직 `data-available` 이 없어 여기서 접힌다 —
  // 마크업의 `hidden` 을 뺀 자리를 이 한 줄이 대신한다.
  applyFilter();

  const folderChip = overlay.querySelector('[data-role="folder"]');
  const browserRow = overlay.querySelector('[data-role="browser-row"]');
  const serverRow = overlay.querySelector('[data-role="server-row"]');
  const serverRootChip = overlay.querySelector('[data-role="server-root"]');
  const adminBtns = [...overlay.querySelectorAll('[data-act="open-admin"]')];
  /** 지금 이 브라우저가 서버를 도는 바로 그 기계인가. 서버의 판정과 같은 규칙이다(server.py is_loopback). */
  const isLocalHost = () => {
    const h = (win.location && win.location.hostname) || '';
    return h === 'localhost' || h === '::1' || h.split('.')[0] === '127';
  };
  const subdirInput = overlay.querySelector('[data-role="subdir"]');
  const previewEl = overlay.querySelector('[data-role="preview"]');
  const projectsSection = overlay.querySelector('[data-role="projects-section"]');
  const projectsSubdirInput = overlay.querySelector('[data-role="projects-subdir"]');
  const projectsPreview = overlay.querySelector('[data-role="projects-preview"]');
  const projectsNote = overlay.querySelector('[data-role="projects-note"]');
  const noteEl = overlay.querySelector('[data-role="note"]');
  const pickBtn = overlay.querySelector('[data-act="pick"]');
  const modelsSection = overlay.querySelector('[data-role="models-section"]');
  const modelsDir = overlay.querySelector('[data-role="models-dir"]');
  const modelsSize = overlay.querySelector('[data-role="models-size"]');
  const modelsState = overlay.querySelector('[data-role="models-state"]');
  const modelsFiles = overlay.querySelector('[data-role="models-files"]');
  const modelsNote = overlay.querySelector('[data-role="models-note"]');
  const modelsFetchBtn = overlay.querySelector('[data-act="models-fetch"]');
  const modelsBrowseBtn = overlay.querySelector('[data-act="models-browse"]');
  const modelsSuggest = overlay.querySelector('[data-role="models-suggest"]');
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

  /** 바이트 → 사람이 읽는 크기. 용량이 곧 이 항목의 결정 근거라 화면에 늘 함께 선다. */
  function mb(bytes) {
    const n = Number(bytes) || 0;
    return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
  }

  /** 내려받는 중인가. 그동안 버튼을 잠그고 진행률을 note 에 쓴다. */
  let fetching = false;
  /** 폴더 고르기 창이 떠 있는가. 그 약속은 사용자가 고를 때까지 안 끝나므로 그동안 버튼을 잠근다. */
  let browsing = false;

  /**
   * 자세 분석 모델 항목. 서버 모드에서만 보인다 — 파일을 받아 둘 수 있는 것은 서버뿐이다.
   * ⚠ 여기서 모델을 로드하지 않는다. 설정은 "어디에 둘지" 까지이고 쓰는 것은 분석 쪽의 몫이다.
   */
  async function renderModels() {
    if (!modelsSection) return;
    const active = !!(models && server && server.isActive());
    setAvailable(modelsSection, active);
    if (!active) return;
    const st = await models.getStatus();
    if (!st) {
      if (modelsNote) modelsNote.textContent = '서버에서 모델 설정을 읽지 못했습니다. 서버가 켜져 있는지 확인하세요.';
      return;
    }
    if (modelsDir && doc.activeElement !== modelsDir) modelsDir.value = st.dir;
    if (modelsSize && doc.activeElement !== modelsSize) modelsSize.value = st.poseModel;
    if (modelsState) {
      modelsState.textContent = st.ready ? '준비됨' : `${st.missing}개 필요 · 약 ${mb(st.missingBytes)}`;
      modelsState.classList.toggle('is-off', !st.ready);
    }
    if (modelsFetchBtn) {
      modelsFetchBtn.disabled = fetching || st.ready;
      modelsFetchBtn.textContent = fetching ? '내려받는 중…' : (st.ready ? '받아 둠' : `내려받기 (약 ${mb(st.missingBytes)})`);
    }
    if (modelsFiles) {
      modelsFiles.textContent = st.files
        .filter(f => f.needed || f.present)
        .map(f => `${f.present ? '있음' : '없음'}  ${f.name}  ${mb(f.present ? f.bytes : f.approx)}`)
        .join('\n');
    }
    // 창을 못 띄우는 환경(리눅스에 zenity 도 없는 경우 등)에서는 버튼을 감춘다 — 눌러도 안 되는 버튼은 없느니만 못하다.
    if (modelsBrowseBtn) {
      modelsBrowseBtn.hidden = !st.canChoose;
      modelsBrowseBtn.disabled = fetching || browsing;
      modelsBrowseBtn.textContent = browsing ? '📂 창에서 고르는 중…' : '📂 폴더 고르기';
    }
    // 추천 위치. 창을 못 띄워도 한 번 눌러 고를 수 있는 길이다.
    if (modelsSuggest) {
      const list = Array.isArray(st.suggestions) ? st.suggestions : [];
      modelsSuggest.hidden = list.length === 0;
      modelsSuggest.innerHTML = '';
      if (list.length) {
        const label = doc.createElement('span');
        label.className = 'settings-label';
        label.textContent = '추천';
        modelsSuggest.appendChild(label);
      }
      for (const item of list) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = item.dir === st.dir ? 'ghost accent' : 'ghost';
        b.textContent = item.label;
        b.title = `${item.dir}\n${item.note}`;
        b.disabled = fetching || browsing;
        b.onclick = () => useDir(item.dir);
        modelsSuggest.appendChild(b);
      }
    }
    if (modelsNote && !fetching && !browsing) {
      modelsNote.textContent = st.ready
        ? `${st.dir} 에 받아 두었습니다. 이 컴퓨터에서는 인터넷 없이 분석할 수 있습니다. 모델 크기를 바꾸면 그 크기의 파일을 한 번 더 받아야 합니다.`
        : `내려받기를 누르면 ${st.dir} 에 받습니다. 저장 위치를 바꾸려면 절대 경로를 넣고 적용을 누르세요(없는 폴더는 만듭니다). 크기는 가벼울수록 빠르고 정확할수록 느립니다.`;
    }
  }

  /**
   * 모자란 모델 파일을 **하나씩** 받는다. 20MB 를 통째로 기다리게 하면 멈춘 것처럼 보이기 때문이다.
   * 서버가 이미 있는 파일은 그대로 두므로(cached) 중간에 실패해도 다시 부르면 이어서 받는다.
   */
  async function downloadModels() {
    if (!models || fetching) return;
    fetching = true;
    renderModels();
    try {
      const st = await models.getStatus();
      const todo = st ? st.files.filter(f => f.needed && !f.present) : [];
      for (let i = 0; i < todo.length; i++) {
        const f = todo[i];
        if (modelsNote) modelsNote.textContent = `${i + 1}/${todo.length} 받는 중 — ${f.label} (약 ${mb(f.approx)})`;
        const res = await models.fetchOne(f.key);
        if (!res.ok) {
          fetching = false;
          if (modelsNote) modelsNote.textContent = `${f.label} 을 받지 못했습니다: ${res.error} — 인터넷 연결을 확인하고 다시 누르면 남은 것부터 이어 받습니다.`;
          renderModels();
          return;
        }
      }
    } finally {
      fetching = false;
    }
    await renderModels();
    onChange();
  }

  /**
   * 이 폴더를 보관 위치로 삼고, 모자란 것이 있으면 **그대로 이어서 받는다**.
   * 고르기와 받기를 두 번 누르게 하지 않는 것이 이 함수의 목적이다.
   * @param {string} dir
   */
  async function useDir(dir) {
    if (!models) return;
    const st = await models.setConfig({ dir });
    if (!st) {
      if (modelsNote) modelsNote.textContent = '서버가 그 경로를 만들지 못했습니다. 절대 경로인지, 쓸 수 있는 곳인지 확인하세요.';
      return;
    }
    await renderModels();
    onChange();
    if (!st.ready) await downloadModels();
  }

  /** LLM 항목. 서버 모드에서만 보인다(키를 브라우저에 둘 수 없으므로 브라우저 모드에서는 이 기능 자체가 없다). */
  async function renderLlm() {
    if (!llmSection) return;
    const active = !!(llm && server && server.isActive());
    setAvailable(llmSection, active);
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
    // ⚠ 단축키는 **먼저** 그린다. 아래 셋은 서버를 기다리므로(await), 뒤에 두면 서버가 없는
    //   환경에서 목록이 몇 초 뒤에야 나타난다 — 이 절은 서버와 무관하다.
    renderKeys();
    renderThemes();
    renderFlow();
    await renderModels();
    await renderLlm();
    await renderProjects();
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
  /**
   * 프로젝트 보관 폴더 절(2026-09-13).
   * ⚠ **서버가 있을 때만 보인다.** 정적 호스팅에서는 파일을 쓸 자리가 없어 지금까지처럼 다운로드로만
   *   돌아가므로, 고칠 수 없는 설정을 보여 주면 거짓말이 된다(모델 절과 같은 규칙).
   */
  async function renderProjects() {
    const active = !!(server && server.isActive());
    setAvailable(projectsSection, active);
    if (!active) return;
    const cfg = await server.getConfig();
    const sub = (cfg && cfg.projectsSubdir) || 'projects';
    if (projectsSubdirInput && doc.activeElement !== projectsSubdirInput) projectsSubdirInput.value = sub;
    if (projectsPreview) {
      projectsPreview.textContent = `${cfg ? cfg.root : '<서버 루트>'}/${sub}/<프로젝트 이름>.json`;
    }
    if (projectsNote) {
      projectsNote.textContent = cfg
        ? `지금 보관 폴더는 ${cfg.projectsDir} 입니다. 같은 이름으로 저장하면 덮어씁니다 — 같은 안무를 여러 번 저장하는 것이 정상이기 때문입니다(영상 클립은 반대로 " (2)" 가 붙습니다).`
        : '로컬 서버에서 설정을 읽지 못했습니다. 서버가 켜져 있는지 확인하세요.';
    }
  }

  async function renderServer() {
    if (browserRow) browserRow.hidden = true;
    if (serverRow) serverRow.hidden = false;
    const cfg = await server.getConfig();
    if (serverRootChip) serverRootChip.textContent = cfg ? cfg.root : '읽지 못했습니다';
    // ⚠ 관리 화면은 **서버를 도는 기계에서만** 열린다(2026-09-13). 폰에서 눌러 403 을 보게 두지 않는다 —
    //   눌러도 안 되는 버튼은 없느니만 못하다(U-13 과 같은 규칙).
    const local = isLocalHost();
    for (const btn of adminBtns) {
      btn.disabled = !local;
      btn.title = local
        ? '서버 설정 화면을 새 탭에서 엽니다.'
        : '보관 위치는 서버를 도는 기계에서만 바꿉니다 — 그 기계에서 /admin 을 여세요.';
    }
    // ⚠ 서버 모드에서는 칸을 **잠근다.** 바꾸는 자리는 서버의 관리 화면 하나다.
    if (subdirInput) {
      subdirInput.value = cfg ? cfg.subdir : '';
      subdirInput.disabled = true;
      subdirInput.title = '보관 위치는 서버가 정합니다 — `서버 설정 열기` 에서 바꿉니다.';
    }
    if (previewEl) {
      const parts = previewDirParts(cfg ? cfg.subdir : '', getProjectName());
      previewEl.textContent = `${cfg ? cfg.root : '<서버 루트>'}/${parts.join('/')}/<파일 이름>`;
    }
    if (noteEl) {
      noteEl.textContent = cfg
        ? `로컬 서버(server.py)가 영상을 보관합니다. 지금 보관 폴더는 ${cfg.dir} 이고, 서버를 다시 켜도 유지됩니다. `
          + (isLocalHost()
            ? '어느 디스크에 쌓을지는 서버가 정합니다 — 바꾸려면 `서버 설정 열기` 를 누르세요(같은 서버를 보는 모든 기기에 함께 적용됩니다).'
            : '어느 디스크에 쌓을지는 서버가 정합니다 — 바꾸려면 서버를 도는 기계에서 `/admin` 을 여세요. 이 기기에서는 바꿀 수 없습니다.')
        : '로컬 서버에서 설정을 읽지 못했습니다. 서버가 켜져 있는지 확인하세요.';
    }
  }

  function open() {
    overlay.dataset.open = '1';
    // 열 때마다 검색어를 비운다 — 지난번에 찾다 만 말이 남아 있으면 "설정이 사라졌다"로 보인다.
    if (searchEl && searchEl.value) { searchEl.value = ''; query = ''; }
    applyFilter();
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
    if (kind === 'models-apply' && models && modelsDir) {
      useDir(modelsDir.value.trim());
      return;
    }
    if (kind === 'models-browse' && models) {
      // ★ 서버가 **사용자 화면**에 네이티브 폴더 고르기 창을 띄운다. 고를 때까지 안 끝나므로 그동안 잠근다.
      browsing = true;
      if (modelsNote) modelsNote.textContent = '폴더 고르기 창을 띄웠습니다. 화면에서 폴더를 고르세요.';
      renderModels();
      models.chooseDir().then(async (res) => {
        browsing = false;
        if (res.ok) {
          await renderModels();
          onChange();
          if (res.status && !res.status.ready) await downloadModels();
          return;
        }
        await renderModels();
        if (modelsNote) {
          modelsNote.textContent = res.canceled
            ? '폴더를 고르지 않았습니다. 지금 위치를 그대로 씁니다.'
            : `폴더 고르기 창을 띄우지 못했습니다: ${res.error} — 경로를 직접 넣고 \`적용\` 을 누르세요.`;
        }
      });
      return;
    }
    if (kind === 'models-fetch' && models) {
      downloadModels();
      return;
    }
    // 보관 위치(영상·안무표 둘 다)를 정하는 것은 **서버의 일**이다 — 앱은 그 화면으로 보내기만 한다.
    // 여기서 PUT /api/config 를 부르던 두 갈래를 2026-09-13 에 닫았다.
    if (kind === 'open-admin') {
      if (!isLocalHost()) return;
      win.open('/admin', '_blank', 'noopener');
    }
  });
  if (modelsSize && models) {
    modelsSize.onchange = () => {
      models.setConfig({ poseModel: modelsSize.value }).then(() => { renderModels(); onChange(); });
    };
  }
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
  // ── 단축키 (2026-09-20) ─────────────────────────────────────────────────
  //
  // 그전에는 글쇠가 input/controls.js 에 문자열로 박혀 있어서, 무엇을 듣는지 알려면 코드를 읽어야
  // 했고 바꾸려면 코드를 고쳐야 했다. 여기서는 domain/hotkeys 의 표를 그대로 그리고, 누른 글쇠를
  // 받아 넘기기만 한다 — **무엇을 바꿀 수 있는지의 주인은 도메인 하나다.**
  const keysSection = overlay.querySelector('[data-role="keys-section"]');
  const keysListEl = overlay.querySelector('[data-role="keys-list"]');
  const keysNoteEl = overlay.querySelector('[data-role="keys-note"]');

  /** 지금 글쇠를 받는 중인 동작 id. 빈 문자열이면 받는 중이 아니다. */
  let listeningFor = '';

  /** 지금 표. 게터가 없으면 기본값이다(설정이 없는 테스트도 화면은 그려진다). */
  const hotkeyMap = () => normalizeHotkeys(typeof getHotkeys === 'function' ? getHotkeys() : null);

  function renderKeys() {
    if (!keysListEl) return;
    const map = hotkeyMap();
    keysListEl.textContent = '';
    for (const action of HOTKEY_ACTIONS) {
      const row = doc.createElement('div');
      row.className = 'settings-key-row' + (action.fixed ? ' settings-key-fixed' : '');
      if (listeningFor === action.id) row.classList.add('is-listening');
      row.dataset.id = action.id;

      const main = doc.createElement('div');
      main.className = 'settings-key-main';
      const name = doc.createElement('b');
      name.textContent = action.label;
      const hint = doc.createElement('small');
      hint.textContent = action.hint;
      main.append(name, hint);

      const caps = doc.createElement('div');
      caps.className = 'settings-key-caps';
      const cap = doc.createElement('span');
      cap.className = 'settings-key-cap';
      cap.textContent = listeningFor === action.id ? '글쇠를 누르세요…' : keysLabel(map[action.id]);
      caps.appendChild(cap);

      row.append(main, caps);

      if (!action.fixed) {
        const btn = doc.createElement('button');
        btn.className = 'ghost';
        btn.type = 'button';
        btn.dataset.act = 'keys-listen';
        btn.textContent = listeningFor === action.id ? '취소' : '바꾸기';
        row.appendChild(btn);
      }
      keysListEl.appendChild(row);
    }
    if (keysNoteEl && !listeningFor) keysNoteEl.textContent = '';
  }

  if (keysListEl) {
    keysListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="keys-listen"]');
      if (!btn) return;
      const id = btn.closest('.settings-key-row').dataset.id;
      listeningFor = listeningFor === id ? '' : id;
      if (keysNoteEl) {
        keysNoteEl.textContent = listeningFor
          ? '누른 글쇠가 그 자리에 들어갑니다. `Esc` 로 그만둡니다.'
          : '';
      }
      renderKeys();
    });
  }

  if (keysSection) {
    // ⚠ **캡처 단계**에서 듣는다(세 번째 인자 true). 아래의 `Escape → close` 와 설정 화면 안의
    //   입력칸들이 같은 이벤트를 먼저 가져가면 글쇠를 못 받는다.
    doc.addEventListener('keydown', (e) => {
      if (!listeningFor || !isOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        listeningFor = '';
        renderKeys();
        return;
      }
      // 조합만 누른 상태(Shift 를 잡고 있는 중 등)는 아직 글쇠가 아니다 — 계속 기다린다.
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

      const id = listeningFor;
      const key = eventKey(e);
      const ok = checkKey(key);
      if (!ok.ok) {
        if (keysNoteEl) keysNoteEl.textContent = ok.reason;
        return;
      }
      const map = hotkeyMap();
      const taken = ownerOf(map, key, id);
      // ⚠ 한 동작의 글쇠를 **갈아 끼운다**(더하지 않는다). 여럿을 붙이고 싶으면 그 화면을 따로
      //   만들어야 하는데, 그보다 "지금 무엇을 누르면 되나"가 한 줄로 읽히는 편이 낫다.
      const next = setKeys(map, id, [key]);
      saveHotkeys(next);
      listeningFor = '';
      renderKeys();
      if (keysNoteEl) {
        const owner = taken ? (HOTKEY_ACTIONS.find(a => a.id === taken) || {}).label : '';
        keysNoteEl.textContent = owner
          ? `\`${key}\` 를 옮겼습니다 — \`${owner}\` 에서는 빠졌습니다.`
          : `\`${key}\` 로 바꿨습니다.`;
      }
    }, true);
  }

  // ── 작업 차례 (2026-09-21) ───────────────────────────────────────────────
  //
  // 세어 둔 것을 **사람이 읽을 수 있게** 내놓는 자리다. 기계가 배운 것을 사람이 못 보면 그것을
  // 믿을지 말지 정할 수 없고, 못 믿는 추천은 없느니만 못하다.
  // ⚠ 이 절은 아무것도 바꾸지 않는다(지우기 하나뿐이다). 화면을 움직이는 적응은 만들지 않았다.
  const flowListEl = overlay.querySelector('[data-role="flow-list"]');
  const flowNoteEl = overlay.querySelector('[data-role="flow-note"]');

  /** 기록의 id 를 사람 말로. 모르는 id 는 그대로 보인다(단계가 늘어도 화면이 깨지지 않는다). */
  const FLOW_LABELS = Object.freeze({
    step1: '① 영상 고르기', step2: '② 박자 맞추기', step3: '③ 받아 적기',
    step4: '④ 구간 잘라내기', step5: '⑤ 마커', step6: '⑥ 자세 분석',
    play: '재생·일시정지', tap: '탭', tapok: 'BPM 정하기',
    capture: '받아 적기·끊기', skip: '건너뛰기', stop: '그만'
  });
  const flowLabel = (id) => FLOW_LABELS[id] || id;

  function renderFlow() {
    if (!flowListEl) return;
    const rows = typeof flow.top === 'function' ? flow.top(12) : [];
    const total = typeof flow.total === 'function' ? flow.total() : 0;
    flowListEl.textContent = rows.length
      ? rows.map(t => `${flowLabel(t.from)} → ${flowLabel(t.to)}   ${t.n}번`).join('\n')
      : '아직 기록이 없습니다. 영상 아래 단계 줄과 조작 줄을 쓰면 여기에 쌓입니다.';
    if (flowNoteEl) flowNoteEl.textContent = total ? `모두 ${total}번` : '';
  }

  // ── 테마 (2026-09-21) ────────────────────────────────────────────────────
  // ⚠ 목록을 여기에 적지 않는다 — domain/themes 의 THEMES 를 그대로 그린다.
  const themeListEl = overlay.querySelector('[data-role="theme-list"]');

  function renderThemes() {
    if (!themeListEl) return;
    const cur = normalizeTheme(getTheme());
    themeListEl.textContent = '';
    for (const theme of THEMES) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-theme' + (theme.id === cur ? ' is-on' : '');
      btn.dataset.id = theme.id;
      // 색 미리보기 — 고르기 전에 무엇이 되는지 보여 준다(이름만으로는 아무도 모른다).
      const swatch = doc.createElement('span');
      swatch.className = 'settings-theme-swatch';
      swatch.dataset.id = theme.id;
      const main = doc.createElement('span');
      const name = doc.createElement('b');
      name.textContent = theme.label;
      const hint = doc.createElement('small');
      hint.textContent = theme.hint;
      main.append(name, hint);
      btn.append(swatch, main);
      btn.onclick = () => { setTheme(theme.id); renderThemes(); };
      themeListEl.appendChild(btn);
    }
  }

  const flowClearBtn = overlay.querySelector('[data-act="flow-clear"]');
  if (flowClearBtn) {
    flowClearBtn.onclick = () => {
      if (typeof flow.clear === 'function') flow.clear();
      renderFlow();
      if (flowNoteEl) flowNoteEl.textContent = '기록을 지웠습니다.';
    };
  }

  const keysResetBtn = overlay.querySelector('[data-act="keys-reset"]');
  if (keysResetBtn) {
    keysResetBtn.onclick = () => {
      saveHotkeys(normalizeHotkeys(null));
      listeningFor = '';
      renderKeys();
      if (keysNoteEl) keysNoteEl.textContent = '기본값으로 되돌렸습니다.';
    };
  }

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && !listeningFor) close();
  });

  return { open, close, render };
}
