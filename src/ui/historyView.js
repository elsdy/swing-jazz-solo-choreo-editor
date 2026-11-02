// src/ui/historyView.js — 파일 서랍의 「지난 판」 (ui 계층)
//
// 신규 파일이다(RM-25, 2026-11-02). 서버는 2026-09-22 부터 안무표를 덮어쓰기 전에 직전 판을 보관 폴더의
// `.history/` 에 남겨 왔지만, 앱에는 그것을 보고 고르는 자리가 없었다 — 되살리려면 숨은 폴더를 열어 시각이 붙은
// 파일 이름을 읽고 손으로 복사해야 했다. 자동 담기가 1.2초마다 묶인 파일을 덮어쓰므로 실수로 지운 것이 곧
// 저장본이 된다. 그 순간 되살릴 길이 화면에 보여야 안전망이 안전망이다. 이 뷰가 그 자리다 — 휴지통(trashView)과
// 같은 서랍, 같은 꼴.
//
// ⚠ 서버가 없거나(정적 호스팅) 묶인 파일이 없거나 이력이 비면 **통째로 감춘다** — 휴지통과 같은 규약이다.
// ⚠ 되살리기는 무엇도 지우지 않는다(서버가 지금 판을 먼저 이력에 남긴다) — 그래서 확인을 묻지 않는다.
//   다만 되살림은 Undo 로 되돌리지 않으므로, 돌아가는 길이 「새로 남은 이력 한 장」이라는 것을 머리 문구로 알린다.
// ⚠ 묶인 이름으로 목록을 부른다. 응답이 늦게 오는 사이 다른 파일로 옮겨 갔으면 그 목록은 남의 것이다 —
//   순번과 이름을 둘 다 다시 보고 버린다. 되살리기의 대상 이름은 서버가 이력 파일 이름에서 가르므로, 목록과
//   묶인 이름이 같을 때만 그 버튼이 묶인 파일을 되살린다.
// ⚠ 시각은 두 가지다. 파일 이름의 `stamp` 는 **그 판을 마지막으로 고친 때**, `mtime` 은 이력에 남긴 때다.
//   사람에게는 stamp 를 「그 판은 언제 것」으로 보인다. 지금 시각은 주입받는다(시험이 시계를 쥔다).

import { CLS } from './domContract.js';
import { escapeHtml } from './widgets.js';

/** 종류 꼬리표. 서버의 `kind`(manual | auto)를 사람 말로. 모르는 값은 손 저장으로 본다(옛 파일과 같은 규칙). */
export const KIND_LABEL = Object.freeze({ manual: '손 저장', auto: '자동 담기' });

/**
 * 이력 파일 이름의 시각(`YYYYMMDD-HHMMSS[-n]`)을 지금 기준의 읽기 좋은 말로.
 *   오늘 14:20 · 어제 14:20 · 3일 전 14:20 · 10-13 14:20 · 2025-10-13 14:20
 * 꼴이 아니면 빈 문자열 — 호출부가 mtime 으로 떨어진다. 순수 함수다(지금 시각을 받는다).
 * @param {string} stamp
 * @param {number} nowMs
 * @returns {string}
 */
// @complexity time=O(1) space=O(1) cc=7
export function whenLabel(stamp, nowMs) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(stamp || ''));
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
  if (!Number.isFinite(at.getTime())) return '';
  const now = new Date(nowMs);
  const dayOf = (t) => Math.floor((t.getTime() - t.getTimezoneOffset() * 60000) / 86400000);
  const days = dayOf(now) - dayOf(at);
  const clock = `${hh}:${mm}`;
  if (days === 0) return `오늘 ${clock}`;
  if (days === 1) return `어제 ${clock}`;
  if (days > 1 && days < 7) return `${days}일 전 ${clock}`;
  if (now.getFullYear() === at.getFullYear()) return `${mo}-${d} ${clock}`;
  return `${y}-${mo}-${d} ${clock}`;
}

/**
 * 바이트 수를 짧게. 안무표는 수 KB 라 KB 까지면 충분하다 — 1 MB 를 넘는 것은 그 자체가 이상 신호라 MB 로 보인다.
 * @param {number} bytes
 * @returns {string}
 */
// @complexity time=O(1) space=O(1) cc=3
export function sizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * @param {{
 *   listHistory: (name: string) => Promise<import('../adapters/projectServer.js').StampedEntry[]>,
 *   boundName: () => string,
 *   restore: (file: string) => Promise<boolean>,
 *   now?: () => number,
 *   elements?: Record<string, HTMLElement|null>,
 *   doc?: Document
 * }} deps
 *   listHistory: 그 이름의 지난 판 목록(최근이 앞). 서버가 없으면 빈 배열.
 *   boundName: 지금 묶인 파일 이름. 비면 감춘다.
 *   restore: 되살리기 흐름 전체(담기 멈춤 → 되살리기 → 다시 읽기 → 불러오기 → 표식 갱신 → 알림). 성공이면 true.
 * @returns {{ render(): Promise<void> }}
 */
// @complexity time=O(n) space=O(n) cc=12
export function createHistoryView(deps) {
  const {
    listHistory, boundName, restore,
    now = () => Date.now(), elements = {},
    doc = typeof document === 'undefined' ? null : document
  } = deps;
  const byId = (id) => (id in elements ? elements[id] : doc && doc.getElementById(id));
  const root = byId('savedHistory');
  let seq = 0;                                   // 늦게 돌아온 옛 응답이 새 화면을 덮지 않게

  const fallbackWhen = (mtime) => {
    const d = new Date(mtime * 1000);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : '';
  };

  async function render() {
    if (!root) return;
    const my = ++seq;
    const name = String(boundName() || '').trim();
    if (!name) { root.innerHTML = ''; root.hidden = true; return; }
    const items = await listHistory(name);
    // 순번이 밀렸거나(새 render 가 떴다) 그 사이 다른 파일로 옮겨 갔으면 이 목록은 남의 것이다.
    if (my !== seq || String(boundName() || '').trim() !== name) return;
    root.innerHTML = '';
    if (!items.length) { root.hidden = true; return; }
    root.hidden = false;

    const head = doc.createElement('div');
    head.className = 'saved-history-head';
    head.textContent = `지난 판 · ${items.length}개 — 되살리면 지금 판도 이력에 한 장 남습니다`;
    root.appendChild(head);

    const nowMs = now();
    for (const item of items) {
      const row = doc.createElement('div');
      row.className = `${CLS.savedItem} saved-history-item`;
      row.dataset.kind = item.kind === 'auto' ? 'auto' : 'manual';
      const when = whenLabel(item.stamp, nowMs) || fallbackWhen(item.mtime);
      const kind = KIND_LABEL[item.kind] || KIND_LABEL.manual;
      const info = doc.createElement('div');
      info.innerHTML = `<div style="font-weight:800;">${escapeHtml(when)}</div>`
        + `<div class="${CLS.helper}">${escapeHtml(kind)} · ${escapeHtml(sizeLabel(item.size))}</div>`;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = CLS.ghost;
      btn.textContent = '되살리기';
      btn.title = '묶인 파일을 이 판으로 되돌리고 바로 엽니다. 지금 판은 먼저 이력에 남습니다';
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '되살리는 중…';
        const ok = await restore(item.file);
        if (!ok) { btn.disabled = false; btn.textContent = '되살리기'; }
        render();
      };
      row.appendChild(info);
      row.appendChild(btn);
      root.appendChild(row);
    }
  }

  return { render };
}
