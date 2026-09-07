// src/domain/routines.js — 루틴 값 객체와 변환 (순수 함수)
//
// 원본 index.html 의 ROUTINE_COLORS/_routineColorIdx(4496-4497) · nextRoutineColor(4498-4502) ·
// createRoutine 의 정의부(4506-4512) · createRoutineFromSelection 의 순수부(4542-4603) ·
// deleteRoutine 의 배열 조작(4620-4623) · renameRoutine 의 도메인부(4679-4684) ·
// syncCurrentRoutine 의 재분산부(4651-4671) · mergeProjectData 의 루틴 '(n)' 이름 규칙(4083-4108) ·
// applyProjectData 의 루틴 정규화(4362-4369) 를 옮겼다.
//
// ⚠ 원본의 nextRoutineColor 는 모듈 전역 카운터 `_routineColorIdx` 를 증가시킨다. 순수하게 만들려고
//   인덱스를 인자로 받고 [색, 다음인덱스] 를 돌려주도록 바꿨다 — 같은 인덱스에서 시작하면 색 순서가 같다.
// ⚠ 루틴 이름 변경은 routineId 기준이라 placements.rewriteMoveName(이름 기준)과 다르다. 여기서 따로 구현한다.

import { buildSegments } from './grid.js';
import { getGroup, makeSegmentPlacements } from './placements.js';

/**
 * @typedef {Object} Routine
 * @property {string} id
 * @property {string} name
 * @property {number} rows   루틴 보드의 행 수 (intro 행이 없어 rows 가 곧 마지막 행 인덱스이자 행 개수)
 * @property {number} cols
 * @property {object[]} placements
 * @property {boolean} isFavorite
 * @property {string} color
 */

const idsOf = (ids) => (typeof ids === 'function' ? ids : ids.uid);

/**
 * 루틴 색 팔레트. 순서가 곧 배정 순서다.
 * @see index.html:4496
 */
export const ROUTINE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#06b6d4'];

/**
 * 다음 루틴 색과 다음 인덱스. 원본 nextRoutineColor(4498-4502) 를 무상태화한 것.
 * ⚠ 인덱스는 세션 전역이고 루틴을 지워도 되돌아가지 않는다(원본 그대로) — 루틴 개수에서 유도하면 안 된다.
 * @see index.html:4498
 * @param {string[]} colors
 * @param {number} idx
 * @returns {[string, number]} [색, 다음 인덱스]
 */
export function nextColor(colors, idx) {
  return [colors[idx % colors.length], idx + 1];
}

/**
 * 기본 루틴 이름. 원본은 `루틴 ${state.routines.length + 1}` 두 곳(4505·4599)에 하드코딩돼 있다.
 * ⚠ 개수 기반이라 중간 루틴을 지우면 이름이 겹칠 수 있다(원본 동작 그대로).
 * @see index.html:4505
 * @param {number} routineCount
 * @returns {string}
 */
export function defaultRoutineName(routineCount) {
  return `루틴 ${routineCount + 1}`;
}

/**
 * 새 빈 루틴. 키 순서는 원본 4507-4512 그대로 id → name → rows → cols → placements → isFavorite → color.
 * ⚠ mergeRoutines/normalizeRoutine 이 만드는 객체는 **키 순서가 다르다**(… color → isFavorite). 원본 그대로다.
 * @see index.html:4506
 * @param {{ name: string, rows?: number, cols?: number, placements?: object[], color: string }} spec
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {Routine}
 */
export function newRoutine(spec, ids) {
  const { name, rows = 4, cols = 8, placements = [], color } = spec;
  const nextId = idsOf(ids);
  return { id: nextId(), name, rows, cols, placements, isFavorite: false, color };
}

/**
 * 안무표에서 선택한 그룹들을 하나의 루틴으로 편성한다. createRoutineFromSelection(4542-4603)의 순수부.
 *
 * 처리 순서(원본 그대로):
 *  ① 선택 집합을 **순회 순서대로** 훑어 그룹 요약을 만들고, 빈 그룹은 건너뛴다
 *  ② (첫 행, 첫 열) 오름차순으로 정렬 — 안무표에서 먼저 나오는 것이 루틴에서도 먼저
 *  ③ 총 카운트로 rows = max(1, ceil(total/cols)) 결정. cols 는 안무표와 같다
 *  ④ 동작들을 루틴 보드에 빈틈없이 이어 붙인다(행이 꽉 차면 다음 행 0열부터)
 *
 * ⚠ uid 소비 순서: 그룹마다 groupId 1개 → 그 그룹의 세그먼트 수만큼 → … → 마지막에 루틴 id 1개.
 * ⚠ `segs[segs.length - 1]` 은 segs 가 비면 터진다(원본 4589도 같다). rows 를 총 카운트로 잡아
 *    두므로 오늘은 도달할 수 없다.
 * @see index.html:4542
 * @param {{ selectedGroupIds: Set<string>|string[], placements: object[], cols: number, name: string, color: string }} spec
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {{ routine: Routine, groupIds: string[] } | null} 선택이 비었으면 null
 */
export function buildFromSelection(spec, ids) {
  const { selectedGroupIds, placements, cols, name, color } = spec;
  const nextId = idsOf(ids);
  const selection = selectedGroupIds instanceof Set ? [...selectedGroupIds] : [...(selectedGroupIds || [])];
  if (!selection.length) return null;

  // 선택된 그룹들을 안무표 배치 순서(행→열)대로 정렬
  const selectedGroups = [];
  selection.forEach(gid => {
    const segs = getGroup(placements, gid);
    if (!segs.length) return;
    const cnt = segs.reduce((sum, p) => sum + p.length, 0);
    selectedGroups.push({
      groupId: gid,
      name: segs[0].name,
      category: segs[0].category,
      count: cnt,
      sortRow: segs[0].row,
      sortCol: segs[0].startIndex
    });
  });
  selectedGroups.sort((a, b) => a.sortRow - b.sortRow || a.sortCol - b.sortCol);

  if (!selectedGroups.length) return null;

  // 총 카운트 합산 → 루틴 크기 결정
  const totalCount = selectedGroups.reduce((sum, g) => sum + g.count, 0);
  const rows = Math.max(1, Math.ceil(totalCount / cols));

  // 루틴 배치 생성: 동작들을 순서대로 루틴 보드에 나란히 배치
  const routinePlacements = [];
  let currentRow = 1;
  let currentCol = 0;

  selectedGroups.forEach(g => {
    const segs = buildSegments(currentRow, currentCol, g.count, { rows, cols });
    const gid = nextId();
    routinePlacements.push(...makeSegmentPlacements(
      segs,
      { groupId: gid, name: g.name, category: g.category },
      nextId,
      { subRow: 0 }
    ));
    // 다음 배치 위치 계산
    const lastSeg = segs[segs.length - 1];
    currentRow = lastSeg.row;
    currentCol = lastSeg.startIndex + lastSeg.length;
    if (currentCol >= cols) {
      currentRow += 1;
      currentCol = 0;
    }
  });

  const routine = { id: nextId(), name, rows, cols, placements: routinePlacements, isFavorite: false, color };
  return { routine, groupIds: selectedGroups.map(g => g.groupId) };
}

/**
 * 루틴 편집 결과를 메인 보드의 루틴 블록에 반영한다 — syncCurrentRoutine(4651-4671)의 재분산부.
 * 그 루틴을 참조하는 그룹마다 통째로 지우고 `rows * cols` 카운트로 다시 세그먼트를 만든다.
 *
 * ⚠ 보존해야 하는 결함(#1): 여기서 만드는 배치에는 **`subRow` 키 자체가 없다**(원본 4666-4670).
 *   withSubRow:false 로 그 키 생략을 그대로 재현한다 — "subRow":0 이 붙으면 저장 JSON 바이트가 달라진다.
 * ⚠ 그룹을 하나 처리할 때마다 작업 배열이 갱신되고 다음 그룹은 갱신된 배열을 본다(원본의 제자리 재대입과 동일).
 * ⚠ affectedRows 는 Set 삽입 순서다: 그룹마다 [옛 행들 → 새 행들]. 중복은 없지만 정렬돼 있지 않다.
 * ⚠ 새 세그먼트가 board.rows 를 넘으면 buildSegments 가 조용히 버린다 — 루틴을 키우면 아래쪽이 사라진다.
 * @see index.html:4651
 * @param {object[]} placements 메인 보드 배치
 * @param {Routine} routine     이미 rows/cols/name 이 갱신된 루틴
 * @param {{ rows:number, cols:number, hasIntroRow?:boolean }} board 메인 보드 격자
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {{ placements: object[], affectedRows: number[], changed: boolean }}
 */
export function redistributeBlocks(placements, routine, board, ids) {
  const nextId = idsOf(ids);
  const affectedPlacements = placements.filter(p => p.routineId === routine.id);
  if (!affectedPlacements.length) return { placements, affectedRows: [], changed: false };

  const newTotalCount = routine.rows * routine.cols;
  const groupIds = [...new Set(affectedPlacements.map(p => p.groupId))];
  const affectedRows = new Set();
  let working = placements;

  groupIds.forEach(groupId => {
    const groupSegs = working
      .filter(p => p.groupId === groupId)
      .sort((a, b) => a.row - b.row || a.startIndex - b.startIndex);
    const firstSeg = groupSegs[0];
    groupSegs.forEach(p => affectedRows.add(p.row));
    working = working.filter(p => p.groupId !== groupId);
    const newSegs = buildSegments(firstSeg.row, firstSeg.startIndex, newTotalCount, board);
    newSegs.forEach(s => affectedRows.add(s.row));
    working = [...working, ...makeSegmentPlacements(
      newSegs,
      { groupId, name: routine.name, category: 'routine', type: 'routine', routineId: routine.id },
      nextId,
      { withSubRow: false }
    )];
  });

  return { placements: working, affectedRows: [...affectedRows], changed: true };
}

/**
 * 루틴 이름 변경 + 그 루틴의 메인 보드 배치 이름을 함께 바꾼다(renameRoutine 4679-4684).
 * ⚠ 원본은 `routine.name = trimmed`(4682) 와 `p.name = trimmed` 로 **제자리 변형**한다. 여기서는 도메인 규칙대로
 *   새 객체를 돌려준다 — name 키가 이미 있으므로 키 순서와 JSON 바이트는 원본과 같다.
 * ⚠ prompt 취소(next == null)는 UI 몫. 빈 이름은 조용히 거부한다(alert 없음, 원본 4681).
 * @see index.html:4679
 * @param {Routine[]} routines
 * @param {object[]} placements 메인 보드 배치
 * @param {string} routineId
 * @param {string} rawName
 * @returns {{ ok:false, reason:'not-found'|'empty-name' } | { ok:true, routines:Routine[], placements:object[], name:string, affectedRows:number[] }}
 */
export function renameRoutine(routines, placements, routineId, rawName) {
  const routine = routines.find(r => r.id === routineId);
  if (!routine) return { ok: false, reason: 'not-found' };
  const trimmed = String(rawName).trim();
  if (!trimmed) return { ok: false, reason: 'empty-name' };
  const nextPlacements = placements.map(p => p.routineId === routineId ? { ...p, name: trimmed } : p);
  return {
    ok: true,
    routines: routines.map(r => r.id === routineId ? { ...r, name: trimmed } : r),
    placements: nextPlacements,
    name: trimmed,
    affectedRows: [...new Set(nextPlacements.filter(p => p.routineId === routineId).map(p => p.row))]
  };
}

/**
 * 루틴 삭제 + 메인 보드에서 그 루틴 배치 제거(deleteRoutine 4620-4623).
 * ⚠ 원본은 배치를 먼저 지우고 그 다음 루틴을 지운다. 편집기 닫기(4618)와
 *   favoriteRoutineIds.delete(4624)는 세션 상태라 호출부 몫이다.
 * @see index.html:4617
 * @param {Routine[]} routines
 * @param {object[]} placements
 * @param {string} routineId
 * @returns {{ routines: Routine[], placements: object[], affectedRows: number[] }}
 */
export function removeRoutine(routines, placements, routineId) {
  const affectedRows = placements.filter(p => p.routineId === routineId).map(p => p.row);
  return {
    routines: routines.filter(r => r.id !== routineId),
    placements: placements.filter(p => p.routineId !== routineId),
    affectedRows: [...new Set(affectedRows)]
  };
}

/**
 * 부분 채우기(mergeProjectData 4083-4108)의 루틴 병합.
 *  - id 가 없거나 이미 있는 id 는 건너뛴다
 *  - 이름이 겹치면 `이름 (2)`, `이름 (3)` … 을 붙인다
 *
 * ⚠ 이름 비교는 **작업 목록이 갱신될 때마다** 다시 계산한다(원본이 push 직후 existingNames() 를
 *   다시 부르는 이유). 그래서 같은 이름 두 개가 한 번에 들어오면 (2), (3) 이 차례로 붙는다.
 * ⚠ `placements` 는 들어온 배열을 **그대로 참조**한다(복제하지 않는다). 원본 4102 그대로.
 * ⚠ 키 순서가 newRoutine 과 다르다: … placements → color → isFavorite.
 * ⚠ incoming 원소가 null 이면 `r.id` 에서 터진다 — 원본 4086도 같다.
 * @see index.html:4083
 * @param {Routine[]} routines
 * @param {unknown} incoming
 * @returns {{ routines: Routine[], added: Routine[] }}
 */
export function mergeRoutines(routines, incoming) {
  if (!Array.isArray(incoming)) return { routines, added: [] };
  const working = [...routines];
  const existingIds = new Set(working.map(r => r.id));
  const existingNames = () => new Set(working.map(r => r.name));
  const added = [];
  incoming.forEach(r => {
    if (!r.id || existingIds.has(r.id)) return; // 같은 id → 건너뜀
    let name = String(r.name || '루틴');
    // 이름 중복 시 번호 붙이기
    const names = existingNames();
    if (names.has(name)) {
      let n = 2;
      while (names.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
    }
    const merged = {
      id: r.id, name,
      rows: Math.max(1, Number(r.rows) || 4),
      cols: Math.max(1, Number(r.cols) || 8),
      placements: Array.isArray(r.placements) ? r.placements : [],
      color: r.color || '#6366f1',
      isFavorite: false
    };
    added.push(merged);
    working.push(merged); // 즉시 추가해야 existingNames()가 갱신됨
    existingIds.add(r.id);
  });
  return { routines: working, added };
}

/**
 * 전체 불러오기(applyProjectData 4362-4369)의 루틴 정규화.
 * ⚠ `isFavorite` 은 파일 값을 그대로 쓴다(mergeRoutines 는 언제나 false). 원본 그대로.
 * ⚠ `placements` 는 들어온 배열을 그대로 참조하고 내용은 검사하지 않는다.
 * @see index.html:4362
 * @param {object} r
 * @param {(() => string) | { uid: () => string }} ids
 * @returns {Routine}
 */
export function normalizeRoutine(r, ids) {
  const nextId = idsOf(ids);
  return {
    id: r.id || nextId(),
    name: String(r.name || '루틴'),
    rows: Math.max(1, Number(r.rows) || 4),
    cols: Math.max(1, Number(r.cols) || 8),
    placements: Array.isArray(r.placements) ? r.placements : [],
    color: r.color || '#6366f1',
    isFavorite: !!r.isFavorite
  };
}
