// src/ui/trashView.js — 파일 서랍의 휴지통 (ui 계층)
//
// 신규 파일이다(2026-09-22). 최근 프로젝트 목록의 `삭제` 가 그날부터 영구 삭제가 아니라 서버의
// `.trash/` 로 옮기는 일이 됐다(server.py, 로드맵 「기둥 D」). 옮겨 둔 것을 되살리는 자리가 이 뷰다 —
// 지우는 버튼과 같은 서랍 안, 목록 바로 아래. 되돌릴 길이 화면에 보여야 「삭제」를 누를 때 손이 떨리지 않는다.
//
// ⚠ 서버가 없으면(정적 호스팅) 휴지통도 없다 — 목록이 비면 통째로 감춘다. 빈 휴지통을 늘 보이면 소음이다.
// ⚠ 이력(직전 판)은 여기서 다루지 않는다. 그것은 「안전망 판본」 화면(로드맵 M2)의 몫이고,
//   지금은 서버 API 만 있다.
// ⚠ 복구는 무엇도 지우지 않는다(서버가 기존 파일을 먼저 이력에 남긴다) — 그래서 확인을 묻지 않는다.

import { CLS } from './domContract.js';
import { escapeHtml } from './widgets.js';

/** 한 번에 보이는 항목 수. 그 아래는 「N개 더」 한 줄이다 — 휴지통은 뒤질 곳이지 목록이 아니다. */
const SHOW_LIMIT = 6;

/**
 * @param {{
 *   listTrash: () => Promise<{file:string, name:string, stamp:string, size:number, mtime:number}[]>,
 *   restore: (file: string) => Promise<{name:string}|null>,
 *   onRestored: (name: string) => void,
 *   elements?: Record<string, HTMLElement|null>
 * }} deps
 * @returns {{ render(): Promise<void> }}
 */
export function createTrashView(deps) {
  const { listTrash, restore, onRestored = () => {}, elements = {} } = deps;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));
  const root = byId('savedTrash');
  let seq = 0;                                   // 늦게 돌아온 옛 응답이 새 화면을 덮지 않게

  function whenOf(mtime) {
    const d = new Date(mtime * 1000);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : '';
  }

  async function render() {
    if (!root) return;
    const my = ++seq;
    const items = await listTrash();
    if (my !== seq) return;
    root.innerHTML = '';
    if (!items.length) { root.hidden = true; return; }
    root.hidden = false;

    const head = document.createElement('div');
    head.className = 'saved-trash-head';
    head.textContent = `휴지통 · ${items.length}개 — 복구하면 목록으로 돌아옵니다`;
    root.appendChild(head);

    for (const item of items.slice(0, SHOW_LIMIT)) {
      const row = document.createElement('div');
      row.className = `${CLS.savedItem} saved-trash-item`;
      const info = document.createElement('div');
      info.innerHTML = `<div style="font-weight:800;">${escapeHtml(item.name)}</div><div class="${CLS.helper}">${escapeHtml(whenOf(item.mtime))} 에 지움</div>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = CLS.ghost;
      btn.textContent = '복구';
      btn.title = '이 안무표를 보관 폴더로 되돌립니다. 같은 이름이 이미 있으면 그것은 이력에 남깁니다';
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '복구 중…';
        const res = await restore(item.file);
        if (res) onRestored(res.name);
        else { btn.disabled = false; btn.textContent = '복구'; }
        render();
      };
      row.appendChild(info);
      row.appendChild(btn);
      root.appendChild(row);
    }
    if (items.length > SHOW_LIMIT) {
      const more = document.createElement('div');
      more.className = CLS.helper;
      more.textContent = `${items.length - SHOW_LIMIT}개 더 — 보관 폴더의 .trash 에 있습니다`;
      root.appendChild(more);
    }
  }

  return { render };
}
