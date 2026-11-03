// src/usecases/pendingTrayCommands.js — `?` 정리함: 이름 없는 블록을 몰아서 붙인다 (usecases 계층, RM-24 · 2026-11-03)
//
// 편집 흐름 2단계 「나중에 이름 붙이기」(docs/EDITING_FLOWS.md)다. 받아 적기(1단계)가 쌓은 `?` 를 영상 패널 안의 목록 하나에
// 표 위 차례로 모으고, 줄을 고르면 안무표에서 그 블록이 골라지고 영상은 그 대목을 **마디 반복**(RM-22)으로 되풀이한다.
//
//   openTray     지금의 마디 반복(구간 · 켜짐)을 기억하고 연다
//   pickPending  줄 고르기 — 선택을 그 블록 하나로, 박자가 있으면 (시작-1, 끝+1) 카운트를 반복한다
//   namePending  이름 붙이기 — 목록에 있으면 그 동작으로(갈래까지), 없으면 고른 갈래와 함께 목록에 넣고 붙인다.
//                같은 모양(길이 · 마디 안 시작 칸)의 `?` 무리에도 말없이 붙인다(결정 Q82). 다음 `?` 를 돌려준다
//   closeTray    기억해 둔 마디 반복으로 되돌린다
//
// ⚠ In/Out 은 건드리지 않는다 — 반복의 주인을 카운트 구간(practice)으로 옮길 뿐이다(videoCommands.setPracticeRange).
//   마디 반복은 하나뿐이라 사용자가 잡아 둔 것이 덮이므로, 열 때 기억했다가 닫을 때 되돌린다.
// ⚠ 히스토리 커밋은 여기서 하지 않는다 — 호출부(app/main)가 이름을 한 번 붙일 때마다 한 번 한다. 무리에 붙여도 한 번이라
//   되돌리기는 한 단계다.
// ⚠ 정리함의 상태(`session.video.tray`)는 휘발성 화면 상태다 — 저장하지도 Undo 하지도 않는다.

import { BOARD_MAIN, NONE, boardOf, mergeDirty } from './store.js';
import { selectOnly } from './boardCommands.js';
import { createAndSetGroupMove } from './paletteCommands.js';
import { nameGroupTo } from './captureCommands.js';
import { clearPracticeRange, isTempoReady, panelState, setLoop, setPracticeRange } from './videoCommands.js';
import { adjacentPendingGroupId } from '../domain/placements.js';
import { paddedRange, pendingQueue, repeatsOf } from '../domain/pendingQueue.js';
import { normalizeName } from '../domain/moveMatch.js';
import { normalizeCountRange } from '../domain/practice.js';

/** 패널이 다시 그려져야 한다는 뜻(videoCommands 의 VIDEO 와 같은 값이다). */
const VIDEO = Object.freeze({ video: true });

/**
 * @typedef {Object} TrayState
 * @property {boolean} open
 * @property {string|null} groupId  지금 고른 줄
 * @property {string} category      새 이름을 목록에 넣을 갈래 — 지난번에 고른 것
 * @property {{practice: {fromCount:number,toCount:number}|null, loop:boolean}} saved 열 때의 마디 반복
 */

/** session.video 의 한 키만 바꾼다(다른 휘발성 값이 날아가지 않게). */
// @complexity time=O(1) space=O(1) cc=2
function patchVideo(store, values) {
  const cur = store.get().session.video || {};
  store.patch('session', { video: { ...cur, ...values } });
  return VIDEO;
}

/** 갈래의 처음 값 — 갈래 목록의 첫 키. */
const firstCategory = (state) => Object.keys(state.categories || {})[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 정리함의 화면 상태. 닫혀 있으면 open:false 이고 갈래는 처음 값이다.
 * @param {object} store
 * @returns {TrayState}
 */
// @complexity time=O(1) space=O(1) cc=4
export function trayState(store) {
  const state = store.get();
  const t = state.session.video ? state.session.video.tray : null;
  return {
    open: Boolean(t && t.open),
    groupId: (t && t.groupId) || null,
    category: (t && t.category && state.categories[t.category]) ? t.category : firstCategory(state),
    saved: (t && t.saved) || { practice: null, loop: false }
  };
}

/**
 * 정리함의 줄 — 메인 보드의 이름 없는 블록을 표 위 차례로.
 * @param {object} store
 * @returns {import('../domain/pendingQueue.js').PendingRow[]}
 */
// @complexity time=O(n log n) space=O(n) cc=1
export function trayQueue(store) {
  const board = boardOf(store.get(), BOARD_MAIN);
  return pendingQueue(board.placements, board.cols);
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 정리함을 연다. 지금의 마디 반복(구간 · 켜짐)을 기억한다 — 닫을 때 되돌린다. 이미 열려 있으면 아무 일도 없다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(1) space=O(1) cc=2
export function openTray(store) {
  const cur = trayState(store);
  if (cur.open) return NONE;
  const p = panelState(store);
  const saved = { practice: normalizeCountRange(p.practice), loop: Boolean(p.loop) };
  return patchVideo(store, { tray: { open: true, groupId: null, category: cur.category, saved } });
}

/**
 * 줄 하나를 고른다 — 안무표의 선택을 그 블록 하나로 옮기고, 박자가 있으면 그 블록의 카운트 구간에 앞뒤 한 카운트씩
 * 여유를 두어 마디 반복으로 되풀이한다. In/Out 은 건드리지 않는다.
 *
 * ⚠ 박자가 없으면(박자를 안 맞춘 영상 · 마커에서 옮긴 `?`) 반복은 그대로 두고 `noTempo` 로 알린다 — 이름 붙이기만 된다.
 * ⚠ 박자는 **지금 보는 영상**의 것이다. 블록이 어느 영상에서 받아 적혔는지는 저장되지 않으므로 화면이 「지금 영상 기준」을 알린다.
 *
 * @param {object} store
 * @param {{ groupId: string }} args
 * @returns {import('./store.js').Dirty & {picked?: string, looped?: boolean, noTempo?: boolean,
 *           range?: {fromCount:number, toCount:number}}}
 */
// @complexity time=O(n log n) space=O(n) cc=4
export function pickPending(store, args = {}) {
  const row = trayQueue(store).find(r => r.groupId === args.groupId);
  if (!row) return NONE;
  let dirty = mergeDirty(selectOnly(store, { boardId: BOARD_MAIN, groupId: row.groupId }),
    patchVideo(store, { tray: { ...trayState(store), groupId: row.groupId } }));
  if (!isTempoReady(store)) return { ...dirty, picked: row.groupId, noTempo: true };
  const range = paddedRange(row);
  dirty = mergeDirty(dirty, setPracticeRange(store, range));
  return { ...dirty, picked: row.groupId, looped: true, range };
}

/**
 * 고른 `?` 에 이름을 붙인다 — 같은 모양의 무리에도 함께.
 *
 *   목록에 있는 이름(띄어쓰기 · 대소문자 무시)  → 그 동작으로 — 표기와 갈래까지 그 동작의 것(captureCommands.nameGroupTo)
 *   목록에 없는 이름                            → `category` 로 동작 목록에 **넣고** 그 동작으로 붙인다
 *                                                (paletteCommands.createAndSetGroupMove). RM-15 의 블록 위 입력은 넣지 않는다 — 정리함만 넣는다
 *
 * ⚠ 무리(`withRepeats`, 기본 참)는 **붙이기 전**의 줄로 정한다 — 붙이고 나면 그 블록은 더 이상 `?` 가 아니다.
 * ⚠ 다음 `?` 는 표 위 차례로 이 블록 바로 뒤의 것이고, 뒤에 없으면 맨 앞의 남은 `?` 다. 다 채우면 null 과 `done`.
 *
 * @param {object} store
 * @param {{ groupId: string, label?: string|null, category?: string, withRepeats?: boolean }} args
 * @param {{ ids: (()=>string)|{uid:()=>string} }} deps
 * @returns {import('./store.js').Dirty & {named?: number, next?: string|null, done?: boolean, category?: string, created?: boolean}}
 */
// @complexity time=O(r·n log n) space=O(n) cc=10
export function namePending(store, args = {}, deps = {}) {
  const { groupId, withRepeats = true } = args;
  const text = String(args.label == null ? '' : args.label).trim();
  if (!groupId || !text) return NONE;
  const queue = trayQueue(store);
  if (!queue.some(r => r.groupId === groupId)) return NONE;
  const targets = [groupId, ...(withRepeats ? repeatsOf(queue, groupId) : [])];
  const state = store.get();
  const key = normalizeName(text);
  const known = (state.library || []).some(m => m && normalizeName(m.name) === key);
  const category = args.category && state.categories[args.category] ? args.category : trayState(store).category;

  let dirty = NONE;
  let created = false;
  if (!known) {
    // 새 이름 — 첫 블록에 붙이며 목록에 넣는다. 그 뒤로는 목록에 있으므로 나머지는 아래 길을 탄다.
    const before = (store.get().library || []).length;
    dirty = mergeDirty(dirty, createAndSetGroupMove({ store, ids: deps.ids }, BOARD_MAIN, groupId, text, category));
    created = (store.get().library || []).length > before;
  }
  let named = known ? 0 : 1;
  for (const gid of known ? targets : targets.slice(1)) {
    const { named: one, ...d } = nameGroupTo(store, { boardId: BOARD_MAIN, groupId: gid, label: text });
    if (!one) continue;
    named += 1;
    dirty = mergeDirty(dirty, d);
  }
  if (!named) return NONE;

  const placements = boardOf(store.get(), BOARD_MAIN).placements;
  const next = adjacentPendingGroupId(placements, groupId, 'next') || adjacentPendingGroupId(placements, null, 'next');
  dirty = mergeDirty(dirty, patchVideo(store, { tray: { ...trayState(store), category } }));
  return { ...dirty, named, next, done: next === null, category, created };
}

/**
 * 새 이름을 목록에 넣을 갈래를 바꾼다 — 다음 이름 붙이기에 쓴다. 없는 갈래면 아무 일도 없다.
 * @param {object} store
 * @param {{ category: string }} args
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(1) space=O(1) cc=3
export function setTrayCategory(store, args = {}) {
  const cur = trayState(store);
  if (!cur.open || !args.category || !store.get().categories[args.category]) return NONE;
  return patchVideo(store, { tray: { ...cur, category: args.category } });
}

/**
 * 정리함을 닫는다 — 열 때의 마디 반복 구간과 반복 켜짐으로 되돌린다(열 때 없었으면 구간을 푼다).
 * 마이크를 끄는 것은 음성 인식 어댑터를 아는 호출부(app/main)의 몫이다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(1) space=O(1) cc=3
export function closeTray(store) {
  const cur = trayState(store);
  if (!cur.open) return NONE;
  const { practice, loop } = cur.saved;
  let dirty = practice ? setPracticeRange(store, practice) : clearPracticeRange(store);
  dirty = mergeDirty(dirty, setLoop(store, { loop }));
  return mergeDirty(dirty, patchVideo(store, { tray: { ...trayState(store), open: false, groupId: null } }));
}
