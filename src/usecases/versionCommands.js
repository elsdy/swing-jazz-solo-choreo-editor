// src/usecases/versionCommands.js — 판본과 연습 기록의 명령 (usecases 계층, RM-29 · 2026-11-03)
//
// 판본: 뜨기 · 열기 · 이름과 메모 고치기 · 삭제. 연습 기록: 초안 만들기 · 적기(새로 · 고침) · 삭제.
// 규칙(복제 · 정규화 · 요약 · 표기)은 domain/project/versions.js 가, 파일 본문을 뜨고 여는 길은 projectCommands 가 갖는다 —
// 여기는 store 에 쓰고 Dirty 를 돌려줄 뿐이다.
//
// ⚠ 판본과 기록은 **되돌리기를 타지 않는다**(store.js 의 versions 주석). 그래서 삭제는 되돌릴 수 없고, 낱말도 「삭제」다
//   (docs/GLOSSARY.md). 화면이 confirmOnce 로 한 번 더 묻는다.
// ⚠ 판본 **열기**는 전체 불러오기와 같은 길로 안무표를 갈아 끼우고, 되돌리기 스택을 **그 판을 바닥으로** 비운다
//   (계획서 요구 3 — 판본을 오가며 Undo 가 다른 판의 편집으로 새지 않게). 그래서 지금 본문이 어느 판본에도 없으면
//   화면이 confirmOnce 로 한 번 더 묻는다(currentIsKept).
// ⚠ 시계 · id 는 deps.env 가 준다(uid · nowIso). 「오늘」(연습한 날)은 사람의 날이라 지역 날짜를 부르는 쪽이 넘긴다.

import { NONE, notice, boardOf, BOARD_MAIN } from './store.js';
import { currentDocBody, openDocBody } from './projectCommands.js';
import { VERSION_FILE_KEYS } from '../domain/project/schema.js';
import { cloneJsonValue } from '../domain/project/snapshot.js';
import {
  makeVersion, nextVersionLabel, versionDocOf, versionSignature, editVersion, removeVersion,
  practiceLogDraft, upsertPracticeLog, removePracticeLog
} from '../domain/project/versions.js';
import { fill } from '../domain/strings.js';
import { normalizeProject } from '../domain/project/normalize.js';
import { buildProjectFile } from '../domain/project/serialize.js';
import { DEFAULT_CATEGORIES } from '../domain/defaults.js';

/** @typedef {import('./projectCommands.js').ProjectDeps} ProjectDeps */

/** 서명용 id — 정규화가 빈 id 를 채울 때 시계 · 차례에 따라 달라지지 않게 늘 같은 값을 준다. */
const SIGNATURE_IDS = { uid: () => '' };

/**
 * 판본 본문의 **정규화한** 서명 — 「같은 안무표인가」를 잰다. 열 때 거치는 정규화(normalizeProject)를 한 번 지나게 해서,
 * 정규화가 바꾸는 것(동작 목록을 이름순으로 세우기 · 카테고리 키 차례)을 「고침」으로 보지 않는다.
 * ⚠ 날것으로 재던 때, 이름순이 아닌 동작 목록으로 판본을 뜨고 새로고침하면 되살리기가 목록을 이름순으로 세워
 *   고친 것이 없는데 `정말요?` 가 떴다(2026-11-03 브라우저 시험).
 * @param {object} doc 판본 본문(평평한 파일 본문 모양 — VERSION_FILE_KEYS 만)
 */
// @complexity time=O(n log n) space=O(n) cc=2
function keptSignature(doc) {
  const n = normalizeProject({ ...cloneJsonValue(doc) }, { ids: SIGNATURE_IDS, defaultCategories: DEFAULT_CATEGORIES });
  if (!n) return versionSignature(doc);
  return versionSignature(versionDocOf(buildProjectFile(n)));
}

/** 지금 본문의 판본 서명(정규화한 것). */
// @complexity time=O(n log n) space=O(n) cc=1
function currentSignature(state) {
  return keptSignature(versionDocOf(currentDocBody(state)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 판본
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 지금 안무표를 판본으로 뜬다. 부모는 지금 본문이 갈라져 나온 판본(versionBase)이고, 뜬 판본이 새 versionBase 가 된다.
 * 이름을 주지 않으면 `판본 N`.
 * @param {ProjectDeps} deps
 * @param {{label?:string, note?:string}} [input]
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(n log n) space=O(n) cc=3
export function snapshotVersion(deps, input = {}) {
  const { store, env } = deps;
  const state = store.get();
  const version = makeVersion(currentDocBody(state), {
    id: env.uid(),
    createdAt: env.nowIso(),
    label: input.label || nextVersionLabel(state.versions, n => fill('version.defaultName', { n })),
    note: input.note || '',
    parentId: state.versionBase || null
  });
  store.update({ versions: [...state.versions, version], versionBase: version.id });
  store.patch('session', { versionSig: keptSignature(version.doc) });
  return { versions: true, notify: notice('status', fill('version.made', { label: version.label })) };
}

/**
 * 지금 본문이 판본 어딘가에 남아 있나 — 아니면 판본을 열기 전에 한 번 더 묻는다(열면 지금 본문이 안무표에서 사라진다).
 * 방금 뜨거나 연 그대로면 남은 것으로 친다(열며 정규화로 키 차례가 달라진 것을 「바뀌었다」로 보지 않는다).
 * @param {ProjectDeps} deps
 * @returns {boolean}
 */
// @complexity time=O(v·n log n) space=O(n) cc=3
export function currentIsKept(deps) {
  const state = deps.store.get();
  const sig = currentSignature(state);
  if (sig === state.session.versionSig) return true;
  return state.versions.some(v => keptSignature(v.doc) === sig);
}

/**
 * 판본을 연다 — 그 판의 안무표가 지금 안무표가 된다. 영상 · 링크(판본이 뜨지 않는 것)는 지금 그대로 남고,
 * 다른 판본과 기록도 그대로다. 선택이 비고(전체 불러오기와 같은 길 — projectCommands.openDocBody), 되돌리기 스택은
 * 연 판을 바닥으로 다시 선다(deps.resetHistory — 없으면 불러오기처럼 한 단계가 쌓인 채로 둔다).
 * ⚠ 지금 본문이 판본에 없으면 버려지는지는 묻지 않는다 — 화면이 currentIsKept 를 보고 confirmOnce 로 묻는다.
 * @param {ProjectDeps & {resetHistory?: (boardId:string) => object}} deps
 * @param {{id:string}} input
 * @returns {import('./store.js').Dirty}
 */
// @complexity time=O(n log n) space=O(n) cc=5
export function openVersion(deps, input) {
  const { store } = deps;
  const state = store.get();
  const version = state.versions.find(v => v.id === input.id);
  if (!version) return NONE;
  // 지금 본문에서 판본이 뜨는 키를 걷고 판본의 것을 얹는다 — 판본에 없는 키(비어서 빠진 프레이즈 등)는 빈 값으로 떨어진다
  const body = currentDocBody(state);
  for (const key of VERSION_FILE_KEYS) delete body[key];
  const dirty = openDocBody(deps, { ...body, ...cloneJsonValue(version.doc) });
  if (dirty.notify) return dirty;   // 판본 본문이 손상돼 열지 못했다(막는 알림)
  store.update({ versionBase: version.id });
  store.patch('session', { versionSig: currentSignature(store.get()) });
  const reset = typeof deps.resetHistory === 'function' ? deps.resetHistory(BOARD_MAIN) : null;
  return {
    ...dirty,
    ...(reset || {}),
    versions: true,
    notify: notice('status', fill('version.opened', { label: version.label }))
  };
}

/**
 * 판본의 이름 · 메모를 고친다. 이름을 비우면 옛 이름을 남긴다.
 * @param {ProjectDeps} deps
 * @param {{id:string, label?:string, note?:string}} input
 */
// @complexity time=O(n) space=O(n) cc=2
export function editVersionMeta(deps, input) {
  const { store } = deps;
  const { id, ...patch } = input;
  const cur = store.get().versions;
  const next = editVersion(cur, id, patch);
  if (next === cur) return NONE;
  store.update({ versions: next });
  return { versions: true };
}

/**
 * 판본을 삭제한다(되돌릴 수 없다 — 화면이 confirmOnce 로 묻는다). 자식 판본의 부모 · 기록의 판본 표시는 그대로 남는다.
 * @param {ProjectDeps} deps
 * @param {{id:string}} input
 */
// @complexity time=O(n) space=O(n) cc=2
export function deleteVersion(deps, input) {
  const { store } = deps;
  const cur = store.get().versions;
  const gone = cur.find(v => v.id === input.id);
  if (!gone) return NONE;
  store.update({ versions: removeVersion(cur, input.id) });
  return { versions: true, notify: notice('status', fill('version.deleted', { label: gone.label })) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 연습 기록
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 새 기록의 초안 — **store 에 쓰지 않는다.** 화면의 한 줄 편집기가 이것으로 열리고, `기록 적기` 를 눌러야 쌓인다.
 * 영상(clipId)을 주면 그 영상과 찍은 날이 채워진다(「이 테이크 기록」). 연습기에 반복 구간이 있으면 구간과 배속도 채운다(RM-22 이음매).
 * 판본은 지금 본문이 갈라져 나온 판본이다.
 * @param {ProjectDeps} deps
 * @param {{today:string, clipId?:string}} input  today 는 지역 날짜 `YYYY-MM-DD`
 * @returns {import('../domain/project/schema.js').PracticeLog}
 */
// @complexity time=O(n) space=O(1) cc=3
export function logDraft(deps, input) {
  const { store, env } = deps;
  const state = store.get();
  const clip = input.clipId ? (state.media.clips || []).find(c => c.id === input.clipId) || null : null;
  const video = state.session.video;
  return practiceLogDraft({
    id: env.uid(),
    today: input.today,
    clip,
    versionId: state.versionBase,
    practice: video.practice,
    rate: video.rate,
    cols: boardOf(state, BOARD_MAIN).cols
  });
}

/**
 * 기록 한 줄을 적는다 — 같은 id 가 있으면 고치고, 없으면 더한다. 손상된 칸은 접힌다(domain normalizePracticeLog).
 * @param {ProjectDeps} deps
 * @param {object} log
 */
// @complexity time=O(n log n) space=O(n) cc=2
export function saveLog(deps, log) {
  const { store } = deps;
  const next = upsertPracticeLog(store.get().practiceLogs, log);
  if (!next) return NONE;
  store.update({ practiceLogs: next });
  return { versions: true };
}

/**
 * 기록 한 줄을 삭제한다(되돌릴 수 없다 — 화면이 confirmOnce 로 묻는다).
 * @param {ProjectDeps} deps
 * @param {{id:string}} input
 */
// @complexity time=O(n) space=O(n) cc=2
export function deleteLog(deps, input) {
  const { store } = deps;
  const cur = store.get().practiceLogs;
  const next = removePracticeLog(cur, input.id);
  if (next === cur) return NONE;
  store.update({ practiceLogs: next });
  return { versions: true };
}
