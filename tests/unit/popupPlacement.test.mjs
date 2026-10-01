// tests/unit/popupPlacement.test.mjs — 떠 있는 창 넷의 자리 (RM-08, 2026-10-01)
//
// 넷은 일부러 다르게 자리를 잡는다(domain/popupPlacement 머리말의 표). 여기 기대값이 그 차이의 기록이다 —
// 하나로 합치는 일(RM-12·RM-17 무렵)은 동작 변경 커밋으로 따로 내고 이 시험을 함께 고친다.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POPUP_MOBILE_MAX_WIDTH, placeCursorPopup, placePlacementActionPopup, placeRoutineActionPopup, placeContextMenu,
} from '../../src/domain/popupPlacement.js';

const DESK = { viewW: 1400, viewH: 900 };
const PHONE = { viewW: 390, viewH: 844 };

// ── 커서 팝업(빠른 배치 팝업) ───────────────────────────────────────────────

test('커서 팝업: 넓은 화면은 커서에서 오른쪽 아래 12px 에 띄우고 높이를 묶지 않는다', () => {
  assert.deepEqual(placeCursorPopup({ clientX: 100, clientY: 200, width: 300, height: 200, ...DESK }),
    { left: 112, top: 212, maxHeight: null });
});

test('커서 팝업: 오른쪽·아래로 넘치면 커서 반대편으로 뒤집는다', () => {
  const r = placeCursorPopup({ clientX: 1300, clientY: 800, width: 300, height: 200, ...DESK });
  assert.deepEqual(r, { left: 1300 - 300 - 12, top: 800 - 200 - 12, maxHeight: null });
});

test('커서 팝업: 뒤집은 자리가 화면 왼쪽·위를 넘으면 8 에서 막는다', () => {
  const r = placeCursorPopup({ clientX: 1100, clientY: 500, width: 1300, height: 890, ...DESK });
  assert.deepEqual(r, { left: 8, top: 8, maxHeight: null });
});

test('커서 팝업: 폭 1040 이하는 커서를 버리고 위 가운데에, 높이를 min(화면×0.55, 420) 으로 묶는다', () => {
  const a = placeCursorPopup({ clientX: 10, clientY: 700, width: 300, height: 500, ...PHONE });
  const b = placeCursorPopup({ clientX: 380, clientY: 20, width: 300, height: 500, ...PHONE });
  assert.deepEqual(a, b);
  assert.deepEqual(a, { left: 45, top: 12, maxHeight: Math.min(844 * 0.55, 420) });
});

test('커서 팝업: 화면보다 넓은 팝업은 폰에서 좌우 12 를 남긴다', () => {
  assert.equal(placeCursorPopup({ clientX: 0, clientY: 0, width: 999, height: 100, ...PHONE }).left, 12);
});

test('커서 팝업: 경계는 1040 이 폰 쪽, 1041 이 넓은 화면 쪽이다', () => {
  assert.equal(POPUP_MOBILE_MAX_WIDTH, 1040);
  const at = (viewW) => placeCursorPopup({ clientX: 100, clientY: 100, width: 200, height: 100, viewW, viewH: 800 });
  assert.equal(at(1040).top, 12);
  assert.equal(at(1041).top, 112);
});

// ── 블록 동작 팝업 ──────────────────────────────────────────────────────────

test('블록 동작 팝업: 누른 자리 10px 아래에 띄운다', () => {
  assert.deepEqual(placePlacementActionPopup({ clientX: 100, clientY: 300, ...PHONE }), { left: 100, top: 310 });
});

test('블록 동작 팝업: 네 변을 모두 8 에서 막는다(가정 크기 160×132)', () => {
  assert.deepEqual(placePlacementActionPopup({ clientX: 385, clientY: 840, ...PHONE }),
    { left: 390 - 160 - 8, top: 844 - 132 - 8 });
  assert.deepEqual(placePlacementActionPopup({ clientX: 2, clientY: -50, ...PHONE }), { left: 8, top: 8 });
});

// ── 루틴 블록 팝업 ──────────────────────────────────────────────────────────

test('루틴 블록 팝업: 누른 자리 6px 아래, 오른쪽·아래 넘침은 8 에서 막는다(가정 크기 140×100)', () => {
  assert.deepEqual(placeRoutineActionPopup({ clientX: 100, clientY: 300, ...PHONE }), { left: 100, top: 306 });
  assert.deepEqual(placeRoutineActionPopup({ clientX: 385, clientY: 840, ...PHONE }),
    { left: 390 - 140 - 8, top: 844 - 100 - 8 });
});

test('루틴 블록 팝업: 왼쪽·위는 막지 않는다 — 148px 보다 좁은 창이면 왼쪽 밖으로 나간다(지금 동작)', () => {
  assert.deepEqual(placeRoutineActionPopup({ clientX: 50, clientY: 20, viewW: 120, viewH: 90 }),
    { left: 120 - 148, top: 90 - 108 });
  // 같은 자리를 형제 팝업은 막는다 — 두 팝업이 다르다는 기록.
  assert.deepEqual(placePlacementActionPopup({ clientX: 50, clientY: 20, viewW: 120, viewH: 90 }), { left: 8, top: 8 });
});

// ── 동작 목록의 동작 메뉴 ───────────────────────────────────────────────────

test('동작 메뉴: 커서 자리 그대로, 네 변을 12 에서 막는다', () => {
  assert.deepEqual(placeContextMenu({ x: 100, y: 200, width: 120, height: 110, ...DESK }), { left: 100, top: 200 });
  assert.deepEqual(placeContextMenu({ x: 1390, y: 890, width: 120, height: 110, ...DESK }),
    { left: 1400 - 120 - 12, top: 900 - 110 - 12 });
  assert.deepEqual(placeContextMenu({ x: 0, y: 0, width: 120, height: 110, ...DESK }), { left: 12, top: 12 });
});

test('동작 메뉴: 화면보다 큰 메뉴는 왼쪽·위 12 가 이긴다', () => {
  assert.deepEqual(placeContextMenu({ x: 50, y: 50, width: 500, height: 900, ...PHONE }), { left: 12, top: 12 });
});
