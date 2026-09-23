// src/usecases/voiceNameCommands.js — 마이크로 말한 이름을 받아 적는 구간에 붙인다 (usecases 계층)
//
// 신규 파일이다(2026-09-22). 사용자 요청: "동작을 좀 편하게 채우고 싶은데 마이크를 써서 동작
// 이름을 대략적으로 정할 수 없을까? LLM 을 써도 될 것 같은데."
//
// ── 말한 이름은 «지금 열려 있는 구간» 에 붙는다 ──────────────────────────────────
//
// 받아 적기는 동작이 **시작되는** 자리에서 누른다. 그러니 누른 뒤 눈앞에서 벌어지는 것이 방금
// 연 구간이고, 그것을 보면서 이름을 말한다. 그래서 말한 이름은 **그때 열려 있던 구간**의 것이다.
//
// ```
//   ▮끊기            ▮끊기            ▮끊기
//     │  "찰스턴"      │  "킥볼체인지"    │
//     └──── 구간1 ────┴──── 구간2 ────┘
//          찰스턴          Kick Ball Change
// ```
//
// 말이 **끝난** 시각으로 붙이면 안 된다 — 말하는 동안 영상은 계속 가고, 말이 끝났을 때는 이미
// 다음 구간이 열려 있을 수 있다. 그래서 어댑터가 **말이 시작된 시각**(첫 중간 결과가 온 순간)을
// 함께 준다. 오늘 오전에 격자로 고친 "한 칸 밀림" 과 같은 부류의 버그를 여기서 미리 막는 것이다.
//
// ⚠ 한 구간에 두 번 말하면 **나중 것이 이긴다.** 잘못 말하고 고쳐 말하는 것이 사람의 기본값이다.
// ⚠ 들은 이름은 휘발성이다(`session.video`). 블록에 붙는 순간부터가 안무이고, 그것은 boards 로
//   들어가 Undo 대상이 된다 — 받아 적기의 `captureSec` 과 같은 규약이다.
//
// ── 빠른 길과 느린 길을 갈라 둔다 ─────────────────────────────────────────────
//
// 말 → 글자(0.3초)는 실시간이어야 하지만 글자 → 동작 목록은 그렇지 않다. 그래서
//   ① domain/moveMatch 가 확신하면 그 자리에서 정식 표기로 붙인다 (공짜·즉시)
//   ② 확신이 안 서면 **들은 대로** 붙여 놓고 LLM 에 모아서 묻는다 (1~2초, 흐름은 안 멈춘다)
// 「킥볼체인지」 → `Kick Ball Change` 는 글자가 한 자도 안 겹쳐 규칙으로 못 하는 일이고,
// 그것 하나 때문에 모든 말을 LLM 에 보낼 까닭은 없다.

import { NONE, boardOf, BOARD_MAIN } from './store.js';
import { cleanSpoken, resolveSpokenName } from '../domain/moveMatch.js';
import { nameGroup } from '../domain/placements.js';

/** 패널이 다시 그려져야 한다는 뜻(captureCommands 의 VIDEO 와 같은 값이다). */
const VIDEO = Object.freeze({ video: true });

/**
 * LLM 에게 한 번에 묻는 최대 개수. 이보다 쌓이면 먼저 보낸다.
 * 서른을 넘기면 프롬프트가 길어져 오히려 느려지고, 서버도 30개에서 자른다.
 */
export const MAX_LLM_BATCH = 12;

/** session.video 의 한 키만 바꾼다(다른 휘발성 값이 날아가지 않게). */
function patchVideo(store, values) {
  const cur = store.get().session.video || {};
  store.patch('session', { video: { ...cur, ...values } });
  return VIDEO;
}

/** 동작 목록의 이름들. 맞출 대상이다. */
function moveNamesOf(store) {
  return (store.get().library || []).map((m) => m.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 지금 열려 있는 구간에 붙을 이름. 아직 아무 말도 안 했으면 null.
 * 화면이 이것을 보여 줘서 **어디에 붙을지를 눈으로 확인**하게 한다 — 붙고 나서 알면 늦다.
 * @param {object} store
 * @returns {{heard:string, name:string, needsLlm:boolean, atSec:number}|null}
 */
export function heardName(store) {
  const v = store.get().session.video;
  const h = v ? v.voiceHeard : null;
  return h && typeof h.name === 'string' && h.name ? h : null;
}

/**
 * LLM 에게 물어야 할 것들. `[{groupId, heard}]`
 * @param {object} store
 */
export function llmQueue(store) {
  const v = store.get().session.video;
  const q = v ? v.voiceQueue : null;
  return Array.isArray(q) ? q : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한마디를 들었다. 지금 열려 있는 구간의 이름으로 삼는다.
 *
 * ⚠ **`atSec` 이 지금 열린 구간보다 앞이면 버린다.** 말하는 도중에 `▮ 끊기` 를 누르면 그 말은
 *   앞 구간의 것인데, 그 구간은 이미 놓였다. 뒤늦게 다음 구간에 붙이면 한 칸 밀린 이름이 된다 —
 *   이름이 없는 것보다 **틀린 이름이 붙는 것이 나쁘다**(영상을 다시 보기 전에는 모른다).
 *
 * @param {object} store
 * @param {{ text:string, atSec?:number }} args
 * @returns {object & {name?:string, heard?:string, needsLlm?:boolean, stale?:boolean}} Dirty
 */
export function hearUtterance(store, args = {}) {
  const heard = cleanSpoken(args.text);
  if (!heard) return NONE;
  const v = store.get().session.video || {};
  const openedAt = Number(v.captureSec);
  const atSec = Number(args.atSec);
  if (Number.isFinite(openedAt) && Number.isFinite(atSec) && atSec < openedAt) {
    return { ...NONE, stale: true };       // 이 말은 이미 놓인 구간의 것이다
  }
  const { name, needsLlm } = resolveSpokenName(heard, moveNamesOf(store));
  return {
    ...patchVideo(store, { voiceHeard: { heard, name, needsLlm, atSec: Number.isFinite(atSec) ? atSec : 0 } }),
    name, heard, needsLlm
  };
}

/** 구간이 놓였거나 받아 적기가 끝났다 — 들어 둔 이름을 비운다. */
export function clearHeard(store) {
  const v = store.get().session.video || {};
  if (!v.voiceHeard) return NONE;
  return patchVideo(store, { voiceHeard: null });
}

/**
 * 방금 놓인 블록을 LLM 에게 물을 줄에 세운다.
 * @param {object} store
 * @param {{ groupId:string, heard:string }} args
 * @returns {object} Dirty
 */
export function queueForLlm(store, args = {}) {
  const groupId = String(args.groupId || '');
  const heard = String(args.heard || '').trim();
  if (!groupId || !heard) return NONE;
  return patchVideo(store, { voiceQueue: llmQueue(store).concat([{ groupId, heard }]) });
}

/** 줄에 선 것을 **꺼내면서 비운다.** 보내 놓고 또 보내지 않기 위해서다. */
export function takeLlmQueue(store) {
  const queue = llmQueue(store);
  if (!queue.length) return { queue: [], dirty: NONE };
  return { queue: queue.slice(0, MAX_LLM_BATCH), dirty: patchVideo(store, { voiceQueue: queue.slice(MAX_LLM_BATCH) }) };
}

/**
 * LLM 이 맞춰 준 이름으로 조용히 갈아 끼운다.
 *
 * ⚠ **사람이 그 뒤에 손으로 고친 블록은 건드리지 않는다.** 들은 대로 적힌 이름이 그대로 있을
 *   때만 바꾼다 — 사람이 고쳐 놓은 것을 1초 뒤에 기계가 덮으면 그건 고장이다.
 * ⚠ `sure` 가 거짓인 답은 버린다. 모르겠다고 한 것을 억지로 붙이면 들은 대로가 더 낫다.
 *
 * @param {object} store
 * @param {{groupId:string, heard:string}[]} asked 물어본 것(groupId 를 아는 쪽)
 * @param {{heard:string, name:string, category?:string, sure?:boolean}[]} answers 서버가 준 답
 * @returns {object & {changed?:number}} Dirty
 */
export function applyLlmNames(store, asked, answers) {
  const byHeard = new Map();
  for (const a of answers || []) {
    if (a && typeof a.heard === 'string' && typeof a.name === 'string' && a.name.trim() && a.sure !== false) {
      byHeard.set(a.heard, a);
    }
  }
  if (!byHeard.size) return NONE;
  const board = boardOf(store.get(), BOARD_MAIN);
  let placements = board.placements;
  const rows = new Set();
  let changed = 0;
  for (const item of asked || []) {
    const answer = byHeard.get(item.heard);
    if (!answer || answer.name === item.heard) continue;
    const mine = placements.filter((p) => p.groupId === item.groupId);
    if (!mine.length) continue;                              // 지워졌다
    if (!mine.every((p) => p.name === item.heard)) continue; // 사람이 이미 고쳤다
    const next = nameGroup(placements, item.groupId, answer.name, answer.category || undefined);
    if (next === placements) continue;
    placements = next;
    for (const p of mine) rows.add(p.row);
    changed += 1;
  }
  if (!changed) return NONE;
  store.setBoard(BOARD_MAIN, { placements });
  return { boards: { [BOARD_MAIN]: { rows: [...rows] } }, changed };
}

/** 받아 적기를 끝냈다 — 들은 것도 줄도 비운다. */
export function resetVoice(store) {
  const v = store.get().session.video || {};
  if (!v.voiceHeard && !(v.voiceQueue || []).length) return NONE;
  return patchVideo(store, { voiceHeard: null, voiceQueue: [] });
}
