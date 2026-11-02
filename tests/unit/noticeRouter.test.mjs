// tests/unit/noticeRouter.test.mjs — 알림 세 급의 자리(RM-04 · RM-19)
//
// 유스케이스는 급과 문구만 돌려준다. 이 시험은 **실제 유스케이스가 돌려준 알림**을 라우터에 넣어
// 어느 자리로 가는지 잰다 — 참고(status)는 상태줄로만, 막음(block)은 모달, 토스트(toast)는 토스트.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeRouter } from '../../src/app/noticeRouter.js';
import { createStore, notice, BOARD_MAIN } from '../../src/usecases/store.js';
import { counterEnv } from '../../src/ports/env.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as Board from '../../src/usecases/boardCommands.js';

const NO_DIALOGS = {
  alert(m) { throw new Error(`dialogs.alert 를 불렀다: ${m}`); },
  promptText(m) { throw new Error(`dialogs.promptText 를 불렀다: ${m}`); },
  confirm(m) { throw new Error(`dialogs.confirm 을 불렀다: ${m}`); }
};

function projectDeps(store, storage = {}) {
  return {
    store,
    env: { ...counterEnv(), nowIso: () => '2026-11-02T00:00:00.000Z' },
    dialogs: NO_DIALOGS,
    files: { downloadJson() {} },
    storage: { saveRecents() {}, saveRoutineFavorites() {}, saveLinks() {}, ...storage },
    commitHistory() {}
  };
}

/** 자리마다 받은 것을 적는 가짜 셋. */
function sinks() {
  const got = { toast: [], modal: [], status: [] };
  return {
    got,
    toast: { show: (n) => got.toast.push(n) },
    modal: { show: (n) => got.modal.push(n) },
    statusBar: { show: (n) => got.status.push(n) }
  };
}

test('참고(status) 급 알림은 상태줄로만 가고 토스트에는 뜨지 않는다 — 막음 · 토스트 급은 예전 자리 그대로', () => {
  const s = sinks();
  const route = createNoticeRouter({ toast: s.toast, modal: s.modal, statusBar: s.statusBar, historyDepth: () => 7 });

  // 참고 ① — 최근 프로젝트 병합 완료
  const store = createStore({ ids: counterEnv() });
  const merged = Project.mergeProjectFromRecent(projectDeps(store), { placements: [] });
  assert.equal(merged.notify.kind, 'status');
  route(merged.notify);

  // 참고 ② — 표 끝이라 붙이지 않음
  // (표 바깥 아래 줄을 붙일 자리로 주면 모든 조각이 표 끝을 넘는다)
  const pasted = Board.pasteClip(createStore(), { boardId: BOARD_MAIN, clip: [{ name: 'a', category: 'basic', count: 1, offset: 0 }], at: { row: 999, startIndex: 0 } }, { ids: counterEnv() });
  assert.deepEqual(pasted.notify, notice('status', '표 끝이라 붙이지 않았습니다.'));
  route(pasted.notify);

  assert.equal(s.got.status.length, 2);
  assert.match(s.got.status[0].message, /^병합 완료/);
  assert.equal(s.got.status[1].message, '표 끝이라 붙이지 않았습니다.');
  assert.equal(s.got.toast.length, 0, '참고 급은 토스트에 뜨지 않는다');
  assert.equal(s.got.modal.length, 0);

  // 막음 — 형식이 틀린 프로젝트는 모달로
  const bad = Project.mergeProjectFromRecent(projectDeps(createStore({ ids: counterEnv() })), { nope: true });
  route(bad.notify);
  assert.deepEqual(s.got.modal, [notice('block', '잘못된 프로젝트 파일 형식입니다.')]);

  // 토스트 — 동작 파일을 들이다 저장이 던지면
  const failing = projectDeps(createStore({ ids: counterEnv() }), { saveRecents() { throw new Error('쿼터'); } });
  const moves = Project.loadMoveListFromFile(failing, { data: { moves: [] }, fileName: '동작.json' });
  route(moves.notify);
  // 토스트 — 되돌리기가 달린 지우기는 띄우는 순간의 히스토리 깊이를 싣는다
  route(notice('toast', '지웠습니다', { label: '되돌리기', command: 'undo', boardId: BOARD_MAIN }));
  assert.equal(s.got.toast.length, 2);
  assert.equal(s.got.toast[0].message, '동작 파일을 읽을 수 없습니다.');
  assert.equal(s.got.toast[1].action.depth, 7);

  assert.equal(s.got.status.length, 2, '막음 · 토스트 급 동안 상태줄은 0번 불렸다');
  assert.equal(s.got.modal.length, 1);
});

test('상태줄이 없는 화면에서는 참고 급이 토스트로 떨어진다 — 모달이 없으면 막음도 토스트(toastView 가 모달로 그린다)', () => {
  const got = [];
  const route = createNoticeRouter({ toast: { show: (n) => got.push(n) } });
  route(notice('status', '병합 완료'));
  route(notice('block', '잘못된 프로젝트 파일 형식입니다.'));
  route(null);
  assert.deepEqual(got.map(n => n.kind), ['status', 'block']);
});
