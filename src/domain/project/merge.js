// src/domain/project/merge.js — 부분 불러오기(병합)의 전 알고리즘 (순수)
//
// 원본 index.html 의 mergeProjectData(4068-4176) 중 도메인부(4069-4171)를 옮겼다.
// 렌더 5종(4170) · saveHistory(4171) · 경고 문구 조립(4172-4176)은 여기 없다 —
// 이 파일은 `{ placements, added, stacked }` 만 돌려주고 문구는 유스케이스가 만든다.
//
// ⚠ 이 영역에서 유일하게 무거운 도메인 로직이고 골든 merge-01..16 이 걸려 있다. 한 줄도 의미를 바꾸지 않았다.
// ⚠ 이름 충돌 규칙이 세 가지로 서로 다르다 — 세 함수로 나란히 두어 그 차이가 보이게 했다:
//     카테고리 = 기존 유지(들어오는 값 버림) · 동작 = 이름 겹치면 들어오는 쪽 버림 · 루틴 = '(n)' 접미로 살림.
//     그중 루틴 규칙의 본체만 domain/routines.js 소유이고 여기서는 위임 호출한다.

import { findFreeLane } from '../lanes.js';
import { groupsOf } from '../placements.js';
import { normalize as normalizeCategories } from '../categories.js';
import { normalizeLibrary } from '../moves.js';
import { mergeRoutines as mergeRoutinesDomain } from '../routines.js';

/** ids 는 함수(`()=>string`)와 `{uid}` 객체를 모두 받는다 — domain/placements.js 와 같은 규약. */
function uidOf(ids) {
  return typeof ids === 'function' ? ids : ids.uid;
}

/**
 * 카테고리 병합 — **없는 키만 추가**한다. 같은 키는 기존 색/라벨이 이긴다.
 * 원본은 state.categories 를 제자리에서 늘렸고(4072-4074), 여기서는 같은 키 순서의 새 객체를 돌려준다
 * (기존 키가 먼저, 새 키가 정규화 정렬 순서로 뒤에 붙는다 — 원본의 삽입 순서와 같다).
 * ⚠ incoming 이 falsy 면 아무것도 하지 않는다(원본 4071의 `if (data.categories)`).
 * @see index.html:4071
 * @param {Object<string,{label:string,color:string}>} current
 * @param {any} incoming  파일에서 읽은 raw 카테고리(정규화 전)
 * @returns {Object<string,{label:string,color:string}>}
 */
export function mergeCategories(current, incoming) {
  const out = { ...current };
  if (incoming) {
    Object.entries(normalizeCategories(incoming)).forEach(([k, v]) => {
      if (!out[k]) out[k] = v;
    });
  }
  return out;
}

/**
 * 동작 라이브러리 병합 — **이름이 겹치지 않는 것만** 뒤에 붙인다(들어오는 쪽을 버린다).
 * ⚠ categories 는 이미 병합이 끝난 사전이어야 한다. 원본은 카테고리 병합 뒤에
 *    normalizeMoveList 를 불러 전역 state.categories 를 읽었다(4071 → 4077).
 * @see index.html:4076
 * @param {{id:string,name:string,category:string}[]} current
 * @param {any} incoming  파일에서 읽은 raw moveLibrary
 * @param {Object} categories  병합이 끝난 카테고리 사전
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{id:string,name:string,category:string}[]}
 */
export function mergeMoveLibrary(current, incoming, categories, ids) {
  const existingNames = new Set(current.map(m => m.name));
  const newMoves = normalizeLibrary(incoming || [], categories, ids).filter(m => !existingNames.has(m.name));
  return [...current, ...newMoves];
}

/**
 * 루틴 병합 — id 가 겹치면 건너뛰고, 이름이 겹치면 `이름 (2)`, `이름 (3)` … 으로 살려 둔다.
 *
 * 알고리즘 본체는 domain/routines.js 가 소유한다(그쪽 매니페스트가 4085-4113 을 movedFrom 으로 적었다).
 * 여기는 병합 파이프라인이 쓰는 얇은 어댑터일 뿐이라 구현이 두 벌이 되지 않는다.
 * routines.js 쪽은 `{ routines, added }` 를 돌려주지만 원본 mergeProjectData 는 added 를
 * 쓰지 않으므로(4085·4105의 newRoutines 는 죽은 값이다) 여기서는 목록만 꺼내 쓴다.
 *
 * ⚠ 이름 중복 검사 대상에 **이번에 방금 추가한 루틴도 포함**된다(원본이 push 직후
 *    existingNames() 를 다시 만들기 때문). 같은 이름 3개가 한 번에 들어오면 `A`, `A (2)`, `A (3)` 이 된다.
 * ⚠ incoming 원소가 null 이면 원본과 같은 자리에서 같이 던진다.
 *
 * @see index.html:4082
 * @param {import('./schema.js').Routine[]} current
 * @param {any} incoming  파일에서 읽은 raw routines
 * @returns {import('./schema.js').Routine[]}
 */
export function mergeRoutines(current, incoming) {
  return mergeRoutinesDomain(current, incoming).routines;
}

/** 그룹에서 카운트상 가장 앞선 세그먼트(원본 4147-4149의 reduce 그대로). */
function firstSegment(group) {
  return group.reduce((m, p) => (p.row < m.row || (p.row === m.row && p.startIndex < m.startIndex)) ? p : m, group[0]);
}

/**
 * 배치 병합. 이 파일의 본체다.
 *
 * 순서: 기존 배치 subRow 보정 → 들어오는 배치 정규화(groupId 전량 remap) → groupId 별 묶기 →
 *       그룹 시작 위치 정렬 → 그룹 단위로 비어 있는 가장 낮은 레인 탐색 → 그룹 전체를 같은 레인에 배치.
 *
 * ⚠ groupId 를 **전량 새로 발급**한다(4118-4122). 같은 프로젝트를 부분 채우기해도 원래 groupId 가
 *    겹쳐 이동/삭제 시 합쳐지는 일이 없다. 대가로 diff 관점에서는 항상 "새로 추가된 것"으로 보인다.
 * ⚠ uid() 소비 순서가 원본과 같아야 결정적 env 에서 id 가 일치한다:
 *    항목마다 ① p.groupId 가 없으면 uid() ② remap 에 없으면 uid() ③ id 용 uid() 순.
 * ⚠ 기존 배치 중 subRow 키가 없던 것에는 키가 **맨 뒤에** 붙는다(4115의 제자리 대입 재현).
 * ⚠ 클리핑 순서가 normalize.js 와 다르다: 여기는 length 클립 → filter 이고 `length > 0` 조건이 있다.
 * ⚠ 레인 탐색은 이미 push 된 그룹까지 포함해 누적된 배열을 본다(4157의 state.placements 가 커진다).
 *
 * @see index.html:4110
 * @param {import('./schema.js').Placement[]} current
 * @param {any[]} incoming  파일에서 읽은 raw placements
 * @param {{rows:number, cols:number}} board  ⚠ rows 는 마지막 행 인덱스다(행 개수 아님)
 * @param {Object} categories  병합이 끝난 카테고리 사전
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{ placements: import('./schema.js').Placement[], added: number, stacked: number }}
 */
export function mergePlacements(current, incoming, board, categories, ids) {
  const uid = uidOf(ids);
  const fallback = Object.keys(categories)[0];
  let added = 0, stacked = 0;

  // 병합 전 기존 배치를 subRow=0 으로 초기화 (아직 없는 경우) — 원본은 제자리 변형이었다
  const out = current.map(p => {
    if (p.subRow === undefined) {
      const copy = { ...p };
      copy.subRow = 0;
      return copy;
    }
    return p;
  });

  // 들어오는 배치 정규화 — groupId 를 새로 생성하여 기존 배치와 충돌 방지
  const groupIdRemap = new Map(); // 원본 groupId → 새 groupId
  const rawIncoming = (incoming || []).filter(p => p && p.name).map(p => {
    const origGid = p.groupId || uid();
    if (!groupIdRemap.has(origGid)) groupIdRemap.set(origGid, uid());
    return {
      id: uid(),
      groupId: groupIdRemap.get(origGid),
      name: String(p.name),
      category: categories[p.category] ? p.category : fallback,
      row: Math.max(0, p.row != null ? Number(p.row) : 1),
      startIndex: Math.max(0, Number(p.startIndex) || 0),
      length: Math.max(1, Number(p.length) || 1),
      subRow: 0,
      ...(p.type ? { type: p.type } : {}),
      ...(p.routineId ? { routineId: p.routineId } : {})
    };
  }).map(p => ({ ...p, length: Math.min(p.length, board.cols - p.startIndex) }))
    .filter(p => p.row >= 0 && p.row <= board.rows && p.startIndex < board.cols && p.length > 0);

  // groupId 별로 묶기 (루틴처럼 여러 행에 걸친 배치를 하나의 그룹으로)
  const groupMap = groupsOf(rawIncoming);

  // 그룹의 시작 위치(row→startIndex)로 정렬: 카운트상 먼저 나오는 것이 위(subRow=0)
  const sortedGroups = [...groupMap.values()].sort((a, b) => {
    const aFirst = firstSegment(a);
    const bFirst = firstSegment(b);
    return aFirst.row - bFirst.row || aFirst.startIndex - bFirst.startIndex;
  });

  // 그룹 단위로 충돌 검사: 그룹의 모든 세그먼트가 들어갈 수 있는 가장 낮은 subRow 탐색
  sortedGroups.forEach(group => {
    const targetSubRow = findFreeLane(out, group);
    // 그룹 전체를 같은 subRow 에 배치 (루틴 세그먼트가 레이어 분리되지 않도록)
    group.forEach(norm => {
      norm.subRow = targetSubRow;
      out.push(norm);
    });
    if (targetSubRow > 0) stacked++; else added++;
  });

  return { placements: out, added, stacked };
}

/**
 * 부분 불러오기 전체. mergeProjectData(4068-4171)의 도메인부를 순서까지 그대로 엮는다.
 *
 * ⚠ 진입 엄격도가 전체 불러오기와 다르다: 여기는 `data.placements` 가 배열이기만 하면 통과한다(4069).
 *    normalize.js 의 normalizeProject 는 moveLibrary 까지 배열이어야 한다 — 합치면 동작이 바뀐다.
 * ⚠ 실행 순서를 지켜야 한다: 카테고리 병합 → 동작 병합(새 카테고리 기준) → 루틴 병합 → 배치 병합.
 *    uid() 는 동작 병합에서 먼저, 배치 병합에서 나중에 소비된다.
 * ⚠ 원본은 state 를 제자리에서 고쳤다(categories 늘리기, routines.push, placements.push).
 *    여기서는 전부 새 값으로 돌려주므로 호출부가 **넷 다** 대입해야 원본과 같아진다.
 *
 * @see index.html:4068
 * @param {{ rows:number, cols:number, categories:Object,
 *           moveLibrary:{id:string,name:string,category:string}[],
 *           routines:import('./schema.js').Routine[],
 *           placements:import('./schema.js').Placement[] }} current
 * @param {any} data
 * @param {{ ids: (()=>string)|{uid:()=>string} }} deps
 * @returns {{ok:false, code:'INVALID_PROJECT_FILE'}
 *          |{ok:true, categories:Object, moveLibrary:Array, routines:Array,
 *            placements:Array, added:number, stacked:number}}
 */
export function mergeProject(current, data, deps) {
  const { ids } = deps;
  if (!data || !Array.isArray(data.placements)) return { ok: false, code: 'INVALID_PROJECT_FILE' };

  const categories = mergeCategories(current.categories, data.categories);
  const moveLibrary = mergeMoveLibrary(current.moveLibrary, data.moveLibrary, categories, ids);
  const routines = mergeRoutines(current.routines, data.routines);
  const { placements, added, stacked } = mergePlacements(
    current.placements, data.placements, { rows: current.rows, cols: current.cols }, categories, ids
  );

  return { ok: true, categories, moveLibrary, routines, placements, added, stacked };
}
