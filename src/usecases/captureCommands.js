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
import { placeBlockAt } from './boardCommands.js';
import { isTempoUsable, normalizeTempo, spanToCountRange } from '../domain/tempo.js';
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
  const dirty = placeBlockAt(
    store,
    { boardId, name: args.name, category: args.category, startRow: from.row, startIndex: from.index, totalCount },
    deps
  );
  if (dirty === NONE) return NONE;                       // 보드 밖이라 아무것도 안 놓였다
  return { ...dirty, placed: true };
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
    return { ...patchVideo(store, { captureSec: sec }), started: true };
  }
  const moved = patchVideo(store, { captureSec: sec });     // 경계는 언제나 옮긴다
  if (sec - start < MIN_SPAN_SEC) return moved;             // 되감았거나 두 번 눌렸다
  const span = captureSpan(store, { ...args, inSec: start, outSec: sec }, deps);
  const dirty = mergeDirty(moved, span);
  if (span.needsTempo) return { ...dirty, needsTempo: true };
  return span.placed ? { ...dirty, placed: true } : dirty;
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
