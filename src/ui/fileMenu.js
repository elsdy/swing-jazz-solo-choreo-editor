// src/ui/fileMenu.js — 앱바 왼쪽의 파일 메뉴 (ui 계층)
//
// 신설 파일이다(2026-09-20). 앱바 왼쪽 끝에 있던 다섯 칸(앱 이름 · 부제 · 이름 입력칸 ·
// 저장 · 불러오기 둘)과 맨 오른쪽의 `전체 초기화` 를 **버튼 하나 뒤로** 모았다.
// 시선이 가장 먼저 닿는 자리를 "지금 무슨 파일인가" 하나에 내주는 것이 목적이다.
//
// ⚠ 이 뷰는 **버튼을 새로 걸지 않는다.** 저장·불러오기·초기화의 클릭 핸들러는 예전 그대로
//   input/controls.js 가 id 로 건다 — 마크업이 자리를 옮겼을 뿐이다. 여기서 하는 일은
//   메뉴를 여닫는 것과, 이름 입력칸의 값을 제목에 비추는 것 둘뿐이다.
// ⚠ 파일 이름의 원본은 여전히 `#fileNameInput.value` 하나다. 제목은 그 사본이라 값을
//   되읽지 않는다 — 두 군데가 값을 들고 있으면 둘이 어긋나는 날이 온다.

import { bindOutsideClose } from './popup.js';

/** 이름이 비었을 때 제목에 적는 말. 파일 이름이 아니라 **표시용**이다. */
export const UNTITLED = '제목 없는 안무';

/**
 * @param {{
 *   getSaveTarget?: () => {bound: string, kind: 'server'|'browser', blocked?: boolean, reason?: string},
 *   elements?: Record<string, HTMLElement|null>
 * }} [options]
 *   getSaveTarget: 지금 무엇에 담기고 있나 — 묶인 파일 이름(없으면 빈 문자열)과 담는 자리.
 *   ⚠ **게터다.** 묶임은 저장·열기로 세션 중에 바뀐다.
 * @returns {{ syncName(): void, close(): void }}
 */
export function createFileMenu(options = {}) {
  const { getSaveTarget = null, elements = {} } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const wrap = byId('fileMenuWrap');
  const btn = byId('fileMenuBtn');
  const panel = byId('fileMenuPanel');
  const nameEl = byId('fileMenuName');
  const input = byId('fileNameInput');
  const saveNote = byId('fileMenuSaveNote');

  /**
   * 「어디에 담기는가」 한 줄(2026-09-22).
   *
   * 셋 중 하나다 — 묶인 파일에 담기는 중 / 아직 임시 칸 / 이 브라우저에만.
   * ⚠ 이름칸의 값이 아니라 **묶인 파일 이름**을 적는다. 둘은 다를 수 있다(이름을 고치고 저장하지
   *   않았을 때) — 그때 사용자가 알아야 하는 것은 「지금 담기는 파일」이다.
   */
  function syncSaveNote() {
    if (!saveNote) return;
    if (!getSaveTarget) { saveNote.hidden = true; return; }
    const { bound = '', kind = 'browser', blocked = false, reason = '' } = getSaveTarget() || {};
    saveNote.hidden = false;
    // ⚠ **막힌 것을 가장 먼저 말한다.** 담기가 멈춘 채로 「담기고 있습니다」라고 적으면 그 거짓말이
    //   이 줄을 둔 뜻을 통째로 무너뜨린다(실측으로 그렇게 나왔다).
    if (blocked) {
      const what = bound || '작업 문서';
      saveNote.dataset.bound = 'stop';
      saveNote.textContent = reason === 'conflict'
        // 덮어쓰지 않기로 한 것이므로 사용자에게 고를 것을 준다 — 새로고침(저쪽) 또는 다른 이름(이쪽).
        ? `⚠ 담기를 멈췄습니다 — \`${what}\` 이 다른 탭이나 기기에서 바뀌었습니다. 덮어쓰지 않았습니다. `
          + '저쪽 것을 쓰려면 새로고침하고, 지금 화면의 것을 지키려면 이름을 바꿔 `프로젝트 저장` 하세요.'
        : `⚠ 담기를 멈췄습니다 — \`${what}\` 가 더 새 판의 앱에서 담긴 것이라 열지 못했습니다. `
          + '페이지를 새로고침하면 최신 앱으로 열립니다. 그 파일은 건드리지 않았습니다.';
      return;
    }
    if (kind !== 'server') {
      saveNote.dataset.bound = 'off';
      saveNote.textContent = '이 브라우저에만 담기고 있습니다 — 보관 폴더에 쌓으려면 로컬 서버로 열고, 파일로 받으려면 아래 `프로젝트 저장`.';
      return;
    }
    if (bound) {
      saveNote.dataset.bound = 'on';
      saveNote.textContent = `보관 폴더의 \`${bound}.json\` 에 자동으로 담기고 있습니다. 덮어쓰기 전 판은 폴더의 .history 에 남습니다.`;
      return;
    }
    saveNote.dataset.bound = 'off';
    saveNote.textContent = '아직 임시 칸(`_작업중`)에 담기고 있습니다 — `프로젝트 저장` 을 한 번 누르면 그 이름의 파일로 옮겨 갑니다.';
  }

  /** 입력칸의 값을 제목에 비춘다. 저장·불러오기·직접 입력이 모두 이 한 함수로 모인다. */
  function syncName() {
    syncSaveNote();
    if (!nameEl) return;
    const value = (input && input.value || '').trim();
    nameEl.textContent = value || UNTITLED;
    // 이름이 길면 버튼이 줄여서 보여 주므로(text-overflow), 전체는 툴팁에 남긴다.
    nameEl.title = value || UNTITLED;
  }

  function isOpen() {
    return !!panel && !panel.hidden;
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function open() {
    if (!panel) return;
    panel.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    // 연 사람이 하려던 일의 열에 아홉은 이름 바꾸기다 — 커서를 거기 둔다.
    if (input && input.focus) { input.focus(); input.select?.(); }
    // ⚠ getEl 은 **감싸개**를 돌려준다. 패널만 주면 여는 버튼을 누를 때 바깥으로 판정돼
    //   닫기와 토글이 같은 클릭에서 맞부딪친다.
    bindOutsideClose(() => (isOpen() ? wrap : null), close);
  }

  if (btn) btn.onclick = () => { if (isOpen()) close(); else open(); };
  if (input) input.addEventListener('input', syncName);

  // Escape 로 닫는다. ⚠ 메뉴가 열려 있을 때만 삼킨다 — 항상 삼키면 선택 해제·받아 적기 끝내기
  //   같은 Esc 의 원래 뜻이 앱 전체에서 죽는다.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation();
    close();
    if (btn && btn.focus) btn.focus();
  });

  syncName();
  return { syncName, close };
}
