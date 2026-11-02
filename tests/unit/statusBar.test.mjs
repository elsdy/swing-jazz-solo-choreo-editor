// tests/unit/statusBar.test.mjs — 상태줄(RM-19): 새 판정을 만들지 않고 기존 판정을 모아 한 줄로 적는다
//
// 상태줄이 읽는 것은 다섯이다 — 받는 중(captureSec) · 듣는 중(음성 어댑터) · 루틴 편집 중(session) ·
// 담기 자리(draftStore · draftBlocked) · 되돌릴 수 있음(히스토리). 여기서는 그 값들을 꾸며 넣고 조각을 잰다.
// 그리고 상태줄을 다시 그리는 사건이 보드 다시 그리기를 끌고 오지 않는지(app/render 의 라우팅)를 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { statusParts, saveTargetState, voiceLabel, createStatusBar, STATUS_NOTICE_MS } from '../../src/ui/statusBar.js';
import { createRenderer } from '../../src/app/render.js';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as CaptureCmd from '../../src/usecases/captureCommands.js';

const ids = (parts) => parts.map(p => p.id);
const textOf = (parts, id) => (parts.find(p => p.id === id) || {}).text;

/** 아주 작은 가짜 문서 — 상태줄이 쓰는 것만(createElement · appendChild · textContent · dataset · hidden). */
function fakeEl() {
  const el = {
    children: [], dataset: {}, hidden: false, _text: '',
    appendChild(c) { el.children.push(c); return c; },
    get textContent() { return el._text || el.children.map(c => c.textContent).join(''); },
    set textContent(v) { el._text = v; el.children = []; }
  };
  return el;
}
const fakeDoc = { createElement: () => fakeEl() };

test('상태줄: 받는 중 · 듣는 중 · 담기 자리 · 되돌릴 수 있음을 기존 판정에서 읽는다', () => {
  // 평소 — 아무것도 켜져 있지 않고 브라우저에만 담긴다.
  const idle = statusParts({ capture: { startSec: null }, save: { kind: 'browser' }, history: { canUndo: false } });
  assert.deepEqual(ids(idle), ['save']);
  assert.equal(textOf(idle, 'save'), '이 브라우저에만 담김');

  // 받는 중은 captureSec 하나로 정해진다 — 그 값의 시각을 그대로 적는다.
  const fmt = (sec) => `0:${String(sec).padStart(2, '0')}`;
  const busy = statusParts({
    capture: { startSec: 12 },
    voice: { available: true, wanted: true, listening: true },
    routine: { editing: true },
    save: { kind: 'server', bound: '린디' },
    history: { canUndo: true }
  }, { formatClock: fmt });
  assert.deepEqual(ids(busy), ['capture', 'voice', 'routine', 'save', 'undo'], '지금 하는 일 → 담기 자리 → 되돌리기 차례');
  assert.equal(textOf(busy, 'capture'), '● 0:12 부터 받는 중');
  assert.equal(textOf(busy, 'voice'), '🎤 듣는 중');
  assert.equal(textOf(busy, 'save'), '보관 폴더의 `린디.json` 에 담김');
  assert.equal(textOf(busy, 'undo'), '되돌릴 수 있음 (Ctrl+Z)');

  // 켜 두었지만 크롬이 잠깐 멈춘 틈은 `🎤 …` — 엄지 바와 같은 라벨이다(한 함수).
  assert.equal(voiceLabel({ available: true, wanted: true, listening: false }), '🎤 …');
  assert.equal(voiceLabel({ available: true, wanted: false, listening: false }), '');
  assert.equal(voiceLabel({ available: false, wanted: true, listening: true }), '', '마이크가 없으면 말하지 않는다');

  // 담기 판정 넷 — 파일 메뉴의 「어디에 담기는가」와 같은 함수다.
  assert.deepEqual(saveTargetState({ kind: 'server', bound: '' }), { state: 'draft', bound: '' });
  assert.deepEqual(saveTargetState({ kind: 'server', bound: 'a', blocked: true, reason: 'conflict' }), { state: 'stop-conflict', bound: 'a' });
  assert.deepEqual(saveTargetState({ kind: 'server', bound: 'a', blocked: true, reason: 'future' }), { state: 'stop-future', bound: 'a' });
  assert.deepEqual(saveTargetState(null), { state: 'browser', bound: '' });
  // 브라우저 칸이 받지 않으면(RM-33) 「이 브라우저에만 담김」이 아니라 실패다 — 막힘 다음, 자리보다 먼저.
  assert.deepEqual(saveTargetState({ kind: 'browser', failed: true }), { state: 'stop-failed', bound: '' });
  assert.deepEqual(statusParts({ save: { kind: 'browser', failed: true } })[0], { id: 'save', text: '⚠ 담기 실패 — 이 브라우저에 담지 못하고 있습니다', tone: 'warn' });

  // 담기가 멈췄으면 그것이 가장 앞이고 경고다 — 멈춘 줄 모르고 계속 작업하는 것이 가장 나쁜 실패다.
  const stopped = statusParts({ capture: { startSec: 3 }, save: { kind: 'server', bound: 'a', blocked: true, reason: 'conflict' } });
  assert.equal(stopped[0].id, 'save');
  assert.equal(stopped[0].tone, 'warn');
  assert.equal(stopped.filter(p => p.id === 'save').length, 1, '멈춤과 「담김」을 함께 말하지 않는다');

  // 실제 store 의 받는 중 판정(CaptureCmd.captureStartSec)을 그대로 읽는다 — 상태줄이 따로 세지 않는다.
  const store = createStore();
  assert.equal(CaptureCmd.captureStartSec(store), null);
  const viaStore = statusParts({ capture: { startSec: CaptureCmd.captureStartSec(store) } });
  assert.ok(!ids(viaStore).includes('capture'));
});

test('상태줄 뷰: 조각마다 색을 달고, 같은 조각이면 DOM 을 건드리지 않고, 참고 알림은 몇 초 뒤 비운다', () => {
  const root = fakeEl(); const parts = fakeEl(); const notice = fakeEl();
  notice.hidden = true;
  let state = { save: { kind: 'browser' } };
  const timers = [];
  const bar = createStatusBar({
    elements: { statusBar: root, statusBarParts: parts, statusBarNotice: notice },
    getState: () => state,
    doc: fakeDoc,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}
  });
  assert.equal(parts.children.length, 1);
  assert.equal(parts.children[0].dataset.part, 'save');
  assert.equal(parts.children[0].dataset.tone, 'muted');
  assert.equal(root.dataset.warn, 'off');

  const first = parts.children[0];
  bar.render();
  assert.equal(parts.children[0], first, '조각이 같으면 다시 만들지 않는다 — 음성 어댑터가 초당 몇 번 부른다');

  state = { save: { kind: 'server', bound: 'a', blocked: true, reason: 'future' } };
  bar.render();
  assert.equal(root.dataset.warn, 'on');

  bar.show({ kind: 'status', message: '표 끝이라 붙이지 않았습니다.' });
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, '표 끝이라 붙이지 않았습니다.');
  assert.equal(timers.at(-1).ms, STATUS_NOTICE_MS);
  timers.at(-1).fn();
  assert.equal(notice.hidden, true);
  assert.equal(notice.textContent, '');
});

test('상태줄 갱신은 보드 다시 그리기를 부르지 않는다', () => {
  const store = createStore();
  const calls = [];
  const spy = (name) => () => { calls.push(name); };
  const views = {
    board: { [BOARD_MAIN]: { rebuild: spy('board.rebuild'), updateRows: spy('board.updateRows'), syncPhrasing: spy('board.syncPhrasing'), setSelected: spy('board.setSelected') } },
    status: { render: spy('status.render') }
  };
  const apply = createRenderer(store, views);

  // 받는 중 시각 · 음성처럼 영상 패널만 더럽히는 사건
  apply({ video: true });
  assert.deepEqual(calls, ['status.render'], '보드 뷰는 한 번도 불리지 않는다');

  // 되돌리기 깊이 · 루틴 편집 개폐도 상태줄만 다시 그린다(보드 쪽 Dirty 가 없으면)
  calls.length = 0;
  apply({ history: true });
  apply({ routineEditor: true });
  assert.deepEqual(calls, ['status.render', 'status.render']);

  // 거꾸로, 보드만 바뀐 사건은 상태줄을 부르지 않는다 — 받아 적으며 블록이 놓일 때마다 그릴 까닭이 없다.
  calls.length = 0;
  apply({ boards: { [BOARD_MAIN]: { rows: [1] } } });
  assert.ok(!calls.includes('status.render'));
  assert.ok(calls.includes('board.updateRows'));
});
