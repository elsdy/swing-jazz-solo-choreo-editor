// src/app/noticeRouter.js — 알림 세 급을 띄울 자리로 보낸다 (app 계층, RM-04 · RM-19)
//
// 유스케이스는 Dirty.notify 로 { kind, message, action? } 만 돌려준다(usecases/store.js 의 Notice).
// 어디에 띄울지는 조립부의 몫인데, 그 갈래가 app/main 의 views.notify 안에 박혀 있어 시험이 닿지 못했다 —
// 그래서 status 급이 「상태줄이 서기 전까지 토스트로」 라는 임시 길에 그대로 머물렀다. 갈래를 여기로 뽑아
// 가짜 토스트 · 모달 · 상태줄을 주입해 잰다.
//   block  → 모달(앱 안 창). 작업을 멈춰야 하는 오류만 온다.
//   toast  → 토스트. 알아야 할 실패 · 되돌릴 수 있는 지우기.
//   status → 상태줄(ui/statusBar.show). 참고할 소식(병합 완료 · 표 끝이라 붙이지 않음).
//
// ⚠ 「되돌리기」 action 이 달린 토스트는 띄우는 순간의 히스토리 깊이를 적어 둔다 — 토스트가 떠 있는 몇 초 사이에
//   다른 것을 놓으면 Undo 가 그것을 되돌리게 되므로, 누를 때 깊이가 그대로인지 보기 위해서다(app/main 의 onAction).
//   그 판정은 여기서 하지 않는다. 여기는 깊이를 **싣기만** 한다.

/**
 * @typedef {import('../usecases/store.js').Notice} Notice
 */

/**
 * @param {{
 *   toast: { show(n: Notice): void },
 *   modal?: { show(n: Notice): void },
 *   statusBar?: { show(n: Notice): void },
 *   historyDepth?: (boardId: string) => number
 * }} deps
 *   modal: 없으면 block 도 toast.show 로 간다(ui/toastView 는 block 을 스스로 모달로 그린다).
 *   statusBar: 없으면 status 급은 토스트로 떨어진다 — 마크업에 상태줄이 없는 화면(옛 판)의 안전망이다.
 *   historyDepth: action.boardId 의 지금 past 깊이. action 이 있는 알림에만 쓴다.
 * @returns {(n: Notice) => void}
 */
// @complexity time=O(1) space=O(1) cc=7
export function createNoticeRouter(deps) {
  const { toast, modal = null, statusBar = null, historyDepth = () => 0 } = deps;
  return function route(n) {
    if (!n || !n.kind) return;
    if (n.action && n.action.command === 'undo') {
      toast.show({ ...n, action: { ...n.action, depth: historyDepth(n.action.boardId) } });
      return;
    }
    if (n.kind === 'block') { (modal || toast).show(n); return; }
    if (n.kind === 'status' && statusBar) { statusBar.show(n); return; }
    toast.show(n);
  };
}
