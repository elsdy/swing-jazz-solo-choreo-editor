// src/usecases/captureCommands.js — 받아 적기: 영상에서 안무표로 가는 다리 (usecases 계층)
//
// 신규 파일이다(2026-09-12). 원본 index.html 에 대응물이 없다.
// docs/EDITING_FLOWS.md 의 1단계 — "영상을 보면서 동작이 시작될 때 한 번, 끝날 때 한 번 누르면
// 그 구간이 이름 없는 블록으로 표에 바로 놓인다".
//
// 이 파일이 푸는 것은 그 문서의 막히는 곳 ①②③ 셋이다.
//   ① 재생 위치에서 바로 블록을 놓을 수 없다  → captureToggle
//   ② 이름이 있어야만 놓인다                  → boardCommands.placeBlockAt(pending)
//   ③ 마커가 블록이 되지 않는다               → markersToBlocks
//
// ⚠ 경계 — **시각(초)은 언제나 인자로 들어온다.** usecases 는 Date·performance 를 쓸 수 없고
//   (tools/check-arch.mjs 가 막는다) 플레이어도 모른다. 지금 몇 초인지는 뷰가 안다.
//
// ⚠ 경계 — **받아 적는 중의 시작점은 휘발성이다.** `session.video.captureSec` 에 둔다.
//   In/Out 과 같은 성격(확정 전의 화면 상태)이고, 저장하지도 Undo 하지도 않는다.
//   확정되어 표에 블록으로 놓이는 순간부터가 안무이고, 그것은 boards 에 들어가 Undo 대상이 된다.
//
// ⚠ 히스토리 커밋은 여기서 하지 않는다 — 저장소 규약대로 호출부(ui/videoPanel)의 몫이다.
//   다만 무엇이 커밋할 만한 일이었는지는 반환값의 `placed` 로 알려준다.

import { BOARD_MAIN, NONE, boardOf, mergeDirty } from './store.js';
import { placeBlockAt, setBoardRows } from './boardCommands.js';
import { isTempoUsable, normalizeTempo, rowsForDuration, spanToCountRange } from '../domain/tempo.js';
import { cellOf, linearOf } from '../domain/grid.js';
import { normalizeMarkers } from '../domain/markers.js';
import { activeClipOf } from '../domain/project/media.js';
import { affectedRowsByGroup, isPending, nameGroup, pendingGroupIds } from '../domain/placements.js';

/** 패널이 다시 그려져야 한다는 뜻(videoCommands 의 VIDEO 와 같은 값이다). */
const VIDEO = Object.freeze({ video: true });

/**
 * 이보다 짧은 구간은 실수로 두 번 누른 것으로 본다. 1/8초면 가장 빠른 스윙(bpm 240, 1카운트 0.25초)
 * 에서도 반 카운트가 안 되므로, 일부러 찍은 구간을 잘라먹지 않는다.
 */
export const MIN_SPAN_SEC = 0.125;

/**
 * 자동으로 늘릴 수 있는 마디의 상한 (2026-09-20).
 *
 * 박자를 잘못 잡으면(두 점을 거꾸로 찍었거나 bpm 이 열 배로 들어갔거나) 한 시간짜리 영상이
 * 수만 마디를 요구한다. 그만큼 골격을 세우면 화면이 굳는다 — 늘리다 만 것이 굳은 것보다 낫다.
 * 10분짜리 곡을 bpm 400 · 1박 카운트 · 8카운트 마디로 받아도 500마디이므로, 실제로 쓰는
 * 범위는 여기 한참 못 미친다.
 * ⚠ 사용자가 손으로 정하는 마디 수에는 걸리지 않는다. **자동으로 늘릴 때만** 보는 값이다.
 */
export const MAX_AUTO_ROWS = 2048;

// ─────────────────────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 받아 적는 중인가. 시작을 찍었지만 아직 끝을 안 찍은 상태면 그 시각(초).
 * @param {object} store
 * @returns {number|null}
 */
export function captureStartSec(store) {
  const v = store.get().session.video;
  const sec = v ? v.captureSec : null;
  return Number.isFinite(sec) ? sec : null;
}

/**
 * 받아 적기를 쓸 수 있는가. 초를 카운트로 바꾸는 것은 박자가 하므로, 박자가 없으면 놓을 자리를 모른다.
 * @param {object} store
 * @returns {boolean}
 */
export function canCapture(store) {
  // ⚠ **지금 보고 있는 영상**의 박자다(2026-09-12). 영상마다 시간축이 달라 박자도 영상에 붙는다.
  return isTempoUsable(normalizeTempo(activeClipOf(store.get().media).tempo));
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────────────────────

/** session.video 를 통째로 갈아 끼우지 않고 한 키만 바꾼다(다른 휘발성 값이 날아가지 않게). */
function patchVideo(store, values) {
  const cur = store.get().session.video || {};
  store.patch('session', { video: { ...cur, ...values } });
  return VIDEO;
}

// ─────────────────────────────────────────────────────────────────────────────
// 자동 확장 — 영상보다 짧은 안무표에는 뒷부분을 놓을 자리가 없다 (2026-09-20)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 마디가 `rows` 보다 적으면 거기까지 늘린다. 이미 그만큼이면 아무 일도 하지 않는다.
 *
 * ⚠ **줄이지 않는다.** 사용자가 일부러 넓혀 둔 표를 영상 길이에 맞춰 잘라내면 그 자리에 있던
 *   블록이 잘려 나간다(setBoardRows 는 clampToGrid 를 거친다). 늘리는 쪽만 자동이다.
 * ⚠ 상한(MAX_AUTO_ROWS)을 넘으면 **상한까지만** 늘리고 `capped` 로 알린다 — 박자를 잘못
 *   잡았을 때 수만 마디를 세우다 화면이 굳는 것을 막는다.
 *
 * `말로 채우기`(planCommands.applyPlan)도 같은 규칙으로 늘린다 — "모자라면 늘리고 줄이지는
 * 않는다". 거기는 LLM 이 준 rowsNeeded 가 이미 유한해서 상한이 필요 없었다.
 *
 * @param {object} store
 * @param {{ rows:number, boardId?:'main'|'routine' }} args
 * @returns {import('./store.js').Dirty & {grew?:number, capped?:boolean}}
 *   grew: 늘린 뒤의 마디 수(늘리지 않았으면 없다)
 */
export function growRowsTo(store, args) {
  const { boardId = BOARD_MAIN } = args;
  const want = Math.ceil(Number(args.rows));
  if (!Number.isFinite(want)) return NONE;
  const board = boardOf(store.get(), boardId);
  const capped = want > MAX_AUTO_ROWS;
  const next = Math.min(want, MAX_AUTO_ROWS);
  if (next <= board.rows) return capped ? { ...NONE, capped: true } : NONE;
  const dirty = setBoardRows(store, { boardId, rows: next });
  return capped ? { ...dirty, grew: next, capped: true } : { ...dirty, grew: next };
}

/**
 * 이 영상을 끝까지 받아 적을 수 있게 마디를 한 번에 늘린다 (2026-09-20).
 *
 * 받아 적기를 여는 순간 한 번 부른다. 영상 길이와 지금 박자로 필요한 마디 수가 나오므로,
 * 받는 동안 자리가 모자라는 일이 없다 — 재생 위치가 표 끝에 닿아도 그 뒤가 이미 있다.
 * 그 뒤에 보정점으로 어긋나 모자라지면 captureSpan 이 받을 때마다 모자라는 만큼 더 늘린다.
 *
 * ⚠ **영상 길이를 여기서 알아내지 않는다.** 재생기는 어댑터이고 usecases 는 그것을 모른다 —
 *   뷰가 `player.getDuration()` 을 읽어 넘긴다. 모르면(라이브·아직 안 실림) null 이고, 그때는
 *   아무 일도 하지 않는다. 그래도 받아 적기 자체는 된다(모자라면 그때 늘어난다).
 * ⚠ 박자가 없으면 셀 수 없으므로 아무 일도 하지 않는다. 이 시점에는 이미 canCapture 가 참이다.
 *
 * @param {object} store
 * @param {{ durationSec:number|null, boardId?:'main'|'routine' }} args
 * @returns {import('./store.js').Dirty & {grew?:number, capped?:boolean}}
 */
export function growRowsForDuration(store, args = {}) {
  const { boardId = BOARD_MAIN } = args;
  const state = store.get();
  const board = boardOf(state, boardId);
  const tempo = normalizeTempo(activeClipOf(state.media).tempo);
  const rows = rowsForDuration(Number(args.durationSec), board.cols, tempo);
  if (rows === null) return NONE;
  return growRowsTo(store, { rows, boardId });
}

/**
 * 초 구간 하나를 안무표에 이름 없는 블록으로 놓는다.
 *
 * 초 → 카운트 변환은 domain/tempo.spanToCountRange 가 한다 — 보정점이 있으면 그것까지 반영된 값이라
 * 템포가 흔들리는 영상에서도 자리가 맞는다. 끝 카운트는 **포함**이다(구간 중간에서 끝나도 그 칸을 덮는다).
 *
 * @param {object} store
 * @param {{ inSec:number, outSec:number, boardId?:'main'|'routine', name?:string, category?:string }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object & {placed?:boolean, needsTempo?:boolean}} Dirty
 */
export function captureSpan(store, args, deps = {}) {
  const { boardId = BOARD_MAIN } = args;
  const inSec = Number(args.inSec);
  const outSec = Number(args.outSec);
  if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || !(outSec - inSec >= MIN_SPAN_SEC)) return NONE;
  const state = store.get();
  const tempo = normalizeTempo(activeClipOf(state.media).tempo);
  if (!isTempoUsable(tempo)) return { ...NONE, needsTempo: true };
  const board = boardOf(state, boardId);
  const { from, to } = spanToCountRange(inSec, outSec, board.cols, tempo);
  const totalCount = linearOf(to.row, to.index, board.cols) - linearOf(from.row, from.index, board.cols) + 1;
  if (totalCount <= 0) return NONE;
  // 자리가 모자라면 먼저 늘린다(2026-09-20). 받아 적기를 열 때 영상 길이만큼 이미 늘려 두었지만,
  // 그 뒤에 찍은 보정점이 뒷부분을 늦추면 계산이 한두 마디 어긋난다 — 그때 여기가 받는다.
  // ⚠ 늘리는 것이 **먼저**다. placeBlockAt 은 보드 밖이면 조용히 아무것도 안 놓는다.
  // ⚠ grew·capped 는 **Dirty 의 키가 아니다**(assertDirty 가 낯선 키에 던진다). 알림용 플래그라
  //   여기서 갈라내고, needsTempo·placed 와 같은 결로 호출부까지 얹어 보낸다.
  const { grew, capped, ...grownDirty } = growRowsTo(store, { rows: to.row, boardId });
  const notes = { ...(grew ? { grew } : {}), ...(capped ? { capped: true } : {}) };
  const dirty = placeBlockAt(
    store,
    { boardId, name: args.name, category: args.category, startRow: from.row, startIndex: from.index, totalCount },
    deps
  );
  // 늘렸는데도 못 놓았다 — 되감아 인트로 앞(음수 카운트)으로 간 경우다. 늘린 것은 살린다.
  if (dirty === NONE) return grew ? { ...grownDirty, ...notes } : NONE;
  return { ...mergeDirty(grownDirty, dirty), placed: true, ...notes };
}

/**
 * 받아 적기 키를 한 번 눌렀다 — **경계를 찍는다**(2026-09-13).
 *
 * 안무는 이어져 있다. 한 동작의 끝이 곧 다음 동작의 시작이므로 동작마다 두 번 누를 까닭이 없다.
 * 첫 누름이 시작을 열고, 그다음부터는 누를 때마다 **앞 구간을 놓고 그 자리에서 다음 구간을 연다.**
 * 그래서 `B B B B` 네 번이면 구간이 셋이고, 마지막에 열려 있는 구간은 `그만`(stopCapture)이 버린다.
 *
 * ```
 *   B    B    B    B      ■ 그만
 *   └─1──┴─2──┴──3─┘      └ 열린 채 버려진다
 * ```
 *
 * ⚠ **되감아 앞쪽을 찍으면 구간을 만들지 않고 경계만 옮긴다.** 뒤로 간 것은 "다시 여기서부터" 라는
 *   뜻이지 거꾸로 된 구간을 만들라는 뜻이 아니다(그전에는 min/max 로 바로 세웠다 — 두 번 누르기
 *   시절에는 맞는 규칙이었다).
 * ⚠ 너무 짧으면(MIN_SPAN_SEC 미만) 구간을 만들지 않고 **경계만 옮긴다** — 손이 떨려 두 번 눌린 것이다.
 *   그전처럼 시작점을 지우면 연속으로 찍던 흐름이 거기서 끊긴다.
 * ⚠ 블록을 못 놓아도(보드 밖) 경계는 **언제나 옮긴다.** 안 그러면 사용자가 같은 자리에 갇힌다.
 *
 * @param {object} store
 * @param {{ sec:number, boardId?:'main'|'routine' }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object & {started?:boolean, placed?:boolean, needsTempo?:boolean}} Dirty
 */
export function captureToggle(store, args, deps = {}) {
  const sec = Number(args.sec);
  if (!Number.isFinite(sec)) return NONE;
  const start = captureStartSec(store);
  if (start === null) {
    if (!canCapture(store)) return { ...NONE, needsTempo: true };
    // 여는 순간 **영상 길이만큼 한 번에** 늘린다(2026-09-20). 받는 동안 자리가 모자라지 않게
    // 하는 것이 목적이고, 길이를 모르면(args.durationSec 이 null) 아무 일도 하지 않는다 —
    // 그때는 받을 때마다 captureSpan 이 모자라는 만큼 늘린다.
    const { grew, capped, ...grownDirty } = growRowsForDuration(store, { ...args, boardId: args.boardId });
    const opened = patchVideo(store, { captureSec: sec });
    return {
      ...mergeDirty(grownDirty, opened),
      started: true,
      ...(grew ? { grew } : {}),
      ...(capped ? { capped: true } : {})
    };
  }
  const moved = patchVideo(store, { captureSec: sec });     // 경계는 언제나 옮긴다
  if (sec - start < MIN_SPAN_SEC) return moved;             // 되감았거나 두 번 눌렸다
  const span = captureSpan(store, { ...args, inSec: start, outSec: sec }, deps);
  // ⚠ mergeDirty 는 **아는 키만** 골라 새 객체를 만든다 — grew·capped·placed 는 여기서 다시 얹는다.
  const dirty = mergeDirty(moved, span);
  const notes = { ...(span.grew ? { grew: span.grew } : {}), ...(span.capped ? { capped: true } : {}) };
  if (span.needsTempo) return { ...dirty, needsTempo: true };
  return span.placed ? { ...dirty, placed: true, ...notes } : { ...dirty, ...notes };
}

/**
 * 여기까지는 **안무가 아니다**(설명·쉬는 시간·박수). 앞 구간을 놓지 않고 경계만 옮긴다(2026-09-13).
 *
 * 연속으로 찍는 동안 손을 멈추지 않고 빈 곳을 남기는 길이다. 이것이 없으면 설명하는 대목까지
 * 블록이 되어 나중에 하나씩 지워야 한다.
 * ⚠ 아직 시작도 안 했으면 그냥 여는 것과 같다 — "여기부터 볼 만하다" 는 뜻이므로.
 *
 * @param {object} store
 * @param {{ sec:number }} args
 * @returns {object & {started?:boolean, skipped?:boolean, needsTempo?:boolean}} Dirty
 */
export function captureSkip(store, args = {}) {
  const sec = Number(args.sec);
  if (!Number.isFinite(sec)) return NONE;
  if (!canCapture(store)) return { ...NONE, needsTempo: true };
  const had = captureStartSec(store) !== null;
  return { ...patchVideo(store, { captureSec: sec }), started: !had, skipped: had };
}

/**
 * 받아 적기를 끝낸다. **열려 있던 구간은 버린다** — 마지막 경계가 곧 마지막 동작의 끝이므로,
 * 그 뒤는 아직 무엇인지 모르는 대목이다.
 * ⚠ 이름이 cancel 이 아니라 stop 인 까닭: 지금까지 찍어 둔 구간은 이미 표에 놓여 있고 사라지지 않는다.
 *   되돌리려면 Undo 를 쓴다.
 * @param {object} store
 * @returns {object} Dirty
 */
export function stopCapture(store) {
  if (captureStartSec(store) === null) return NONE;
  return patchVideo(store, { captureSec: null });
}

/** 옛 이름. 하는 일은 stopCapture 와 같다 — 부르는 곳이 아직 남아 있어 둔다. */
export const cancelCapture = stopCapture;

/**
 * 찍어 둔 마커를 전부 블록으로 옮긴다(2026-09-12). 그동안 모은 마커가 살아나는 경로다 — 막히는 곳 ③.
 *
 * ⚠ 마커는 이미 카운트 구간을 들고 있으므로 박자를 거치지 않는다. 박자가 없어도 된다.
 * ⚠ 이름표가 있는 마커는 그 이름으로, 없으면 이름 없는 블록으로 놓인다.
 * ⚠ 마커는 지우지 않는다 — 영상 구간과의 짝은 그대로 쓸모가 있다(되감아 보기).
 * ⚠ 이미 옮겼는지는 보지 않는다. 두 번 누르면 두 벌이 쌓인다 — 되돌리기는 Undo 한 번이다.
 *
 * @param {object} store
 * @param {{ boardId?:'main'|'routine' }} [args]
 * @param {{ ids:(()=>string)|{uid:()=>string} }} deps
 * @returns {object & {placed?:number}} Dirty
 */
export function markersToBlocks(store, args = {}, deps = {}) {
  const { boardId = BOARD_MAIN } = args;
  const markers = normalizeMarkers(activeClipOf(store.get().media).markers);
  if (!markers.length) return NONE;
  let dirty = NONE;
  let placed = 0;
  for (const m of markers) {
    const board = boardOf(store.get(), boardId);
    const from = cellOf(m.fromCount, board.cols);
    const one = placeBlockAt(
      store,
      { boardId, name: m.label, startRow: from.row, startIndex: from.index, totalCount: m.toCount - m.fromCount },
      deps
    );
    if (one === NONE) continue;
    dirty = mergeDirty(dirty, one);
    placed += 1;
  }
  return placed ? { ...dirty, placed } : NONE;
}

// ─────────────────────────────────────────────────────────────────────────────
// 이름 붙이기 — 1단계에서는 "고른 것에 한 번"까지다
//
// 계획의 2단계는 이름 없는 블록만 모아 한 화면에서 채우는 것이고(되풀이를 "아까 그것"으로 묶는 것까지),
// 여기 있는 것은 그 전에 `?` 가 영영 `?` 로 남지 않게 하는 최소한의 길이다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이름 없는 블록이 몇 개인가(그룹 기준). 뷰가 "이름 붙일 것 N개"를 말할 때 쓴다.
 * @param {object} store
 * @param {'main'|'routine'} [boardId]
 * @returns {number}
 */
export function pendingCount(store, boardId = BOARD_MAIN) {
  return pendingGroupIds(boardOf(store.get(), boardId).placements).length;
}

/**
 * 선택한 블록들에 이름을 붙인다. 이름은 dialogs 가 묻는다(원본 renameMove 와 같은 idiom).
 *
 * ⚠ 선택 안에 이름 있는 블록이 섞여 있으면 **이름 없는 것만** 바꾼다 — 고르다 딸려 들어온 블록의
 *   이름을 조용히 덮어쓰면 되돌릴 길을 찾기 어렵다.
 * ⚠ 동작 목록에는 등록하지 않는다(placeBlockAt 과 같은 이유).
 *
 * @param {object} store
 * @param {{ boardId?:'main'|'routine' }} [args]
 * @param {{ dialogs:{promptText:(title:string, value?:string)=>string|null} }} deps
 * @returns {object & {named?:number}} Dirty
 */
export function nameSelected(store, args = {}, deps = {}) {
  const { boardId = BOARD_MAIN } = args;
  const state = store.get();
  const board = boardOf(state, boardId);
  const chosen = [...(state.selection || [])].filter(gid => board.placements.some(p => p.groupId === gid && isPending(p)));
  if (!chosen.length) return NONE;
  const label = deps.dialogs.promptText('이 블록의 이름', '');
  if (label == null || !String(label).trim()) return NONE;
  let placements = board.placements;
  const rows = [];
  for (const gid of chosen) {
    rows.push(...affectedRowsByGroup(placements, gid));
    placements = nameGroup(placements, gid, label);
  }
  store.setBoard(boardId, { placements });
  return { boards: { [boardId]: { rows: [...new Set(rows)] } }, named: chosen.length };
}
