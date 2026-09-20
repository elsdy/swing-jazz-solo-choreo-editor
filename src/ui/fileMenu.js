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
 * @param {{ elements?: Record<string, HTMLElement|null> }} [options]
 * @returns {{ syncName(): void, close(): void }}
 */
export function createFileMenu(options = {}) {
  const { elements = {} } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  const wrap = byId('fileMenuWrap');
  const btn = byId('fileMenuBtn');
  const panel = byId('fileMenuPanel');
  const nameEl = byId('fileMenuName');
  const input = byId('fileNameInput');

  /** 입력칸의 값을 제목에 비춘다. 저장·불러오기·직접 입력이 모두 이 한 함수로 모인다. */
  function syncName() {
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
