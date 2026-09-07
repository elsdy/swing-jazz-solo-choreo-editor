// src/domain/boardOps.js — 배치 전이 6개 (순수 함수)
//
// 원본 index.html 의 removePlacementGroup(3567-3576) · placeMove(3578-3605) ·
// placeRoutineOnBoard(3607-3634) · movePlacementGroup(3636-3671) ·
// copyPlacementGroup(3673-3704) · rebuildGroup(3706-3726) 을 글자 단위로 옮겼다.
// ctx 제자리 변형과 renderRows()/unmarkDraggingGroups()/state 접근만 걷어내고
// "무엇을 다시 그릴지"를 값(renderRows·changedRows)으로 돌려준다.

import { totalCellsFrom, buildSegments } from './grid.js';
import { findFreeLane, clearSegmentsArea, repackLanes } from './lanes.js';
import { getGroup, groupCount, affectedRowsByGroup, makeSegmentPlacements } from './placements.js';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠⚠ 반환 계약 — renderRows 와 changedRows 는 서로 다른 것이다
//
//   renderRows : **원본이 실제로 renderRows() 에 넘기던 값 그대로.** 오늘 화면을 만드는 값이며
//                호출부는 이것만 렌더에 쓴다. 세 가지 형태가 있다.
//                  number[]  … 그 행들을 그린다 (중복·순서까지 원문 보존)
//                  'all'     … 보드 전체 행. 원본의
//                              `ctx === mainCtx ? [0, ...1..rows] : [1..rows]` (3667·3700) 과 같고
//                              소비자가 grid.rowIndices(board) 로 펼친다.
//                  null      … ⚠ 렌더 호출 자체가 없었다(조기 반환). [] 와 다르다 —
//                              골든 place-09/place-10/move-11/resize-14/routine-04 의 render 는 []
//                              인데 remove-03(존재하지 않는 그룹 삭제)은 "main:rows:[]" 다.
//                              [] 로 뭉개면 골든이 깨진다.
//   changedRows: 실제로 데이터가 바뀐 행만(중복 제거, 등장 순). **진단·최적화용이다.**
//                이동/복사가 전 행을 그리는 과잉(a3d5d5c 가 stale DOM 회피로 도입)을 지금 고치지
//                않으므로, 이 값을 renderRows 대신 렌더에 쓰면 그 시점에 동작이 바뀐다.
//                repackLanes 의 Phase2 스코프 누수(보존 대상 결함)도 여기에만 드러난다.
//
// 공통 시그니처: (board, args, ids, opt) => { placements, renderRows, changedRows }
//   board = { rows, cols, hasIntroRow, placements }  ⚠ board.rows 는 마지막 행 인덱스다(행 개수 아님)
//   ids   = { uid() } 또는 () => string              도메인은 uid 를 스스로 만들지 않는다
//   opt   = 아래 *_POLICY 를 덮어쓰는 부분 객체
// 원본 배열은 절대 변형하지 않고 항상 새 배열을 돌려준다(조기 반환일 때만 입력 배열을 그대로 반환).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * placeMove(3578-3605)의 규칙.
 * @see index.html:3578
 */
export const PLACE_POLICY = Object.freeze({
  clamp: true,          // totalCellsFrom 으로 카운트를 자른다(3581)
  repack: false,        // placeMove 는 repackSubRows 를 부르지 않는다
  renderAllRows: false  // 3605: 세그먼트 행만 그린다
});

/**
 * movePlacementGroup(3636-3671)의 규칙.
 * @see index.html:3636
 */
export const MOVE_POLICY = Object.freeze({
  clamp: true,          // 3640: 보드 끝으로 밀면 길이가 줄어든다
  repack: true,         // 3664: 이동 후 이전 행 + 새 행 재정렬(병합 보장)
  renderAllRows: true   // 3667-3670: ⚠ 전 행 렌더(a3d5d5c). changedRows 가 정직한 범위를 따로 알려준다
});

/**
 * copyPlacementGroup(3673-3704)의 규칙.
 * ⚠ repack:false 는 오타가 아니라 **보존 대상 결함**이다(FINAL-architecture.md §5 #2, 골든 copy-05-no-repack).
 * 이동은 repack 하는데 복사만 하지 않아 복사 후 빈 레인 0 이 그대로 남는다.
 * @see index.html:3673
 */
export const COPY_POLICY = Object.freeze({
  clamp: true,          // 3676
  repack: false,        // ⚠ 결함 보존
  renderAllRows: true   // 3700-3703
});

/**
 * rebuildGroup(3706-3726)의 규칙 — 이 파일에서 유일하게 레인을 탐색하지 않는 전이.
 * ⚠ keepLane:true  — 원래 레인(first.subRow||0)을 그대로 유지한다. lanes.findFreeLane 을 쓰면 안 된다.
 * ⚠ overwriteSameLane:true — 같은 레인에서 겹치는 그룹을 **통째로** 지운다
 *   (clearSegmentsArea 의 그룹 단위 삭제. FINAL-architecture.md §5 #3, 골든 resize-05/resize-06).
 * ⚠ clamp:false — newCount 를 자르지 않는다. buildSegments 가 board.rows 에서 조용히 끊는다.
 * @see index.html:3706
 */
export const RESIZE_POLICY = Object.freeze({
  clamp: false,
  repack: true,             // 3724
  keepLane: true,
  overwriteSameLane: true,
  renderAllRows: false      // 3725: affectedRows 만
});

/**
 * placeRoutineOnBoard(3607-3634)의 규칙.
 * ⚠ clamp:false — placeMove 와 달리 totalCellsFrom 클램프가 **없다**. 보드 밖으로 나가는 부분은
 *   buildSegments 가 말없이 잘라낸다(FINAL-architecture.md §5 #6, 골든 routine-02-place-no-clamp).
 * 매니페스트 exports 밖이라 모듈 사설 상수로 둔다.
 * @see index.html:3607
 */
const ROUTINE_PLACE_POLICY = Object.freeze({
  clamp: false,
  repack: false,
  renderAllRows: false
});

/**
 * removePlacementGroup(3567-3576)의 규칙. 매니페스트 exports 밖이라 사설 상수.
 * @see index.html:3567
 */
const REMOVE_POLICY = Object.freeze({
  repack: true,         // 3574
  renderAllRows: false  // 3575: affectedRows(중복 포함) 그대로
});

// ─────────────────────────────────────────────────────────────────────────────
// 사설 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** ids 는 함수와 { uid } 객체를 모두 받는다(placements.makeSegmentPlacements 와 같은 규약). */
function uidOf(ids) {
  return typeof ids === 'function' ? ids : ids.uid;
}

/** 조기 반환(원본이 renderRows 를 아예 부르지 않던 경로). renderRows:null 이 그 사실을 나타낸다. */
function noRender(board) {
  return { placements: board.placements, renderRows: null, changedRows: [] };
}

/** 등장 순서를 지키며 합집합을 만든다(중복 제거). changedRows 계산 전용. */
function unionRows(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of list) {
      if (seen.has(row)) continue;
      seen.add(row);
      out.push(row);
    }
  }
  return out;
}

/**
 * repack 여부에 따라 결과를 조립한다.
 * @param {object[]} placements  repack 전 배치 목록
 * @param {number[]} rows        원본이 repackSubRows 에 넘기던 행 목록
 * @param {number[]} renderRows  원본이 renderRows 에 넘기던 행 목록
 * @param {{repack:boolean, renderAllRows:boolean}} policy
 */
function finish(placements, rows, renderRows, policy) {
  const packed = policy.repack ? repackLanes(placements, rows) : null;
  return {
    placements: packed ? packed.placements : placements,
    renderRows: policy.renderAllRows ? 'all' : renderRows,
    changedRows: unionRows(rows, packed ? packed.changedRows : [])
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 전이
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 동작 하나를 (startRow, startIndex)에 totalCount 만큼 놓는다. placeMove(3578-3605).
 *
 * 원본은 `state.moveLibrary.find(m => m.id === moveId)` 로 동작을 찾았다 — 그 조회는 유스케이스
 * (paletteCommands/boardCommands) 몫이고 여기서는 찾은 결과를 받는다. move 가 없으면 원본의
 * `if (!move) return;`(3580)과 같이 아무것도 하지 않는다.
 *
 * @see index.html:3578
 * @param {{rows:number,cols:number,hasIntroRow?:boolean,placements:object[]}} board
 * @param {{ move: {name:string,category:string}|null|undefined, startRow:number, startIndex:number, totalCount:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof PLACE_POLICY>} [opt]
 * @returns {{placements:object[], renderRows:number[]|'all'|null, changedRows:number[]}}
 */
export function place(board, args, ids, opt) {
  const policy = { ...PLACE_POLICY, ...opt };
  const { move, startRow, startIndex, totalCount } = args;
  if (!move) return noRender(board);                                              // 3579-3580
  const count = policy.clamp
    ? Math.min(totalCount, totalCellsFrom(startRow, startIndex, board))           // 3581
    : totalCount;
  if (count <= 0) return noRender(board);                                         // 3582
  const segments = buildSegments(startRow, startIndex, count, board);             // 3583
  // 충돌 없는 가장 낮은 subRow 탐색 (이미 배치된 동작 위에 스택) — 3584-3596
  const subRow = findFreeLane(board.placements, segments);
  const groupId = uidOf(ids)();                                                   // 3597: groupId 가 세그먼트 id 보다 먼저다
  const added = makeSegmentPlacements(
    segments,
    { groupId, name: move.name, category: move.category },
    ids,
    { subRow }
  );                                                                              // 3598-3603
  const rows = segments.map(s => s.row);   // 3605: ⚠ [...new Set()] 없이 그대로 넘긴다
  return finish([...board.placements, ...added], rows, rows, policy);
}

/**
 * 루틴 블록 하나를 메인 보드에 놓는다. placeRoutineOnBoard(3607-3634).
 * 원본은 `state.routines.find(...)` 로 루틴을 찾았다 — 조회는 유스케이스 몫.
 *
 * ⚠ placeMove 와 달리 totalCellsFrom 클램프가 없다(ROUTINE_PLACE_POLICY 참조).
 * ⚠ `count <= 0` 가드도 없다. totalCount 가 0 이면 세그먼트 0개로 renderRows([]) 를 부른다.
 *
 * @see index.html:3607
 * @param {object} board
 * @param {{ routine: {id:string,name:string,rows:number,cols:number}|null|undefined, startRow:number, startIndex:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof ROUTINE_PLACE_POLICY>} [opt]
 */
export function placeRoutineBlock(board, args, ids, opt) {
  const policy = { ...ROUTINE_PLACE_POLICY, ...opt };
  const { routine, startRow, startIndex } = args;
  if (!routine) return noRender(board);                                           // 3608-3609
  const rawCount = routine.rows * routine.cols;                                   // 3610
  const count = policy.clamp
    ? Math.min(rawCount, totalCellsFrom(startRow, startIndex, board))
    : rawCount;
  const groupId = uidOf(ids)();                                                   // 3611
  const segments = buildSegments(startRow, startIndex, count, board);             // 3612
  const subRow = findFreeLane(board.placements, segments);                        // 3613-3625
  const added = makeSegmentPlacements(
    segments,
    { groupId, name: routine.name, category: 'routine', type: 'routine', routineId: routine.id },
    ids,
    { subRow }
  );                                                                              // 3626-3632
  const rows = [...new Set(segments.map(s => s.row))];  // 3633: ⚠ 여기만 Set 으로 감싼다(placeMove 3605 와 비대칭)
  return finish([...board.placements, ...added], rows, rows, policy);
}

/**
 * 그룹을 (targetRow, targetStartIndex)로 옮긴다. movePlacementGroup(3636-3671).
 *
 * groupId 는 유지하고 meta(name/category/type/routineId)만 첫 세그먼트에서 복사하며
 * 세그먼트 id 는 새로 발급한다. 레인 탐색은 **자기 그룹을 제거한 뒤의** 배열 위에서 한다(3646).
 *
 * ⚠ 원본은 여기서 unmarkDraggingGroups(ctx)(3665)를 부른다 — DOM 조작이라 ui/overlays 소관이다.
 * ⚠ renderRows 가 'all' 인 이유는 MOVE_POLICY 주석 참조.
 *
 * @see index.html:3636
 * @param {object} board
 * @param {{ groupId:string, targetRow:number, targetStartIndex:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof MOVE_POLICY>} [opt]
 */
export function moveGroup(board, args, ids, opt) {
  const policy = { ...MOVE_POLICY, ...opt };
  const { groupId, targetRow, targetStartIndex } = args;
  const group = getGroup(board.placements, groupId);                              // 3637
  if (!group.length) return noRender(board);                                      // 3638
  const previousRows = group.map(p => p.row);                                     // 3639
  const rawCount = groupCount(board.placements, groupId);
  const count = policy.clamp
    ? Math.min(rawCount, totalCellsFrom(targetRow, targetStartIndex, board))      // 3640
    : rawCount;
  const segments = buildSegments(targetRow, targetStartIndex, count, board);      // 3641
  const meta = { name: group[0].name, category: group[0].category, type: group[0].type, routineId: group[0].routineId }; // 3642
  const kept = board.placements.filter(p => p.groupId !== groupId);               // 3643
  const subRow = findFreeLane(kept, segments);                                    // 3644-3653
  const added = makeSegmentPlacements(segments, { groupId, ...meta }, ids, { subRow }); // 3654-3660
  // 이동 후 이전 행과 새 행 모두 subRow 재정렬하여 병합 보장 — 3663-3664
  const affectedRows = [...new Set([...previousRows, ...segments.map(s => s.row)])];
  return finish([...kept, ...added], affectedRows, affectedRows, policy);
}

/**
 * 그룹을 (targetRow, targetStartIndex)에 복사한다. copyPlacementGroup(3673-3704).
 *
 * ⚠ 이동과 다른 점 두 가지:
 *   1) groupId 도 **새로 발급**한다(3692).
 *   2) 레인 탐색을 **원본 그룹이 그대로 남아 있는** 배열 위에서 한다(3679-3690) — 자기 자신을 피해 쌓인다.
 * ⚠ repackSubRows 를 부르지 않는다(COPY_POLICY 참조, 보존 대상 결함).
 *
 * @see index.html:3673
 * @param {object} board
 * @param {{ groupId:string, targetRow:number, targetStartIndex:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof COPY_POLICY>} [opt]
 */
export function copyGroup(board, args, ids, opt) {
  const policy = { ...COPY_POLICY, ...opt };
  const { groupId, targetRow, targetStartIndex } = args;
  const group = getGroup(board.placements, groupId);                              // 3674
  if (!group.length) return noRender(board);                                      // 3675
  const rawCount = groupCount(board.placements, groupId);
  const count = policy.clamp
    ? Math.min(rawCount, totalCellsFrom(targetRow, targetStartIndex, board))      // 3676
    : rawCount;
  const segments = buildSegments(targetRow, targetStartIndex, count, board);      // 3677
  const meta = { name: group[0].name, category: group[0].category, type: group[0].type, routineId: group[0].routineId }; // 3678
  const subRow = findFreeLane(board.placements, segments);                        // 3679-3690
  const newGroupId = uidOf(ids)();                                                // 3692
  const added = makeSegmentPlacements(segments, { groupId: newGroupId, ...meta }, ids, { subRow }); // 3693-3699
  const rows = [...new Set(segments.map(s => s.row))];
  return finish([...board.placements, ...added], rows, rows, policy);
}

/**
 * 그룹의 길이를 newCount 로 다시 만든다. rebuildGroup(3706-3726) — 리사이즈 확정 경로.
 *
 * ⚠ 이 파일에서 유일하게 레인을 **탐색하지 않는다.** 원래 레인(originalSubRow)을 유지하고,
 *   그 레인에서 겹치는 다른 그룹을 clearSegmentsArea 로 통째로 지운다(RESIZE_POLICY 참조).
 * ⚠ 삭제 판정은 **자기 그룹을 이미 제거한 배열** 위에서 한다(3714 다음 3716). ignoreGroupId 를 넘기는 것은
 *   원문 그대로이지만 이 시점에는 이미 중복 가드다.
 *
 * @see index.html:3706
 * @param {object} board
 * @param {{ groupId:string, newCount:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof RESIZE_POLICY>} [opt]
 */
export function resizeGroup(board, args, ids, opt) {
  const policy = { ...RESIZE_POLICY, ...opt };
  const { groupId, newCount } = args;
  const group = getGroup(board.placements, groupId);                              // 3707
  if (!group.length) return noRender(board);                                      // 3708
  const previousRows = group.map(p => p.row);                                     // 3709
  const first = group[0];                                                         // 3710
  const originalSubRow = first.subRow || 0;                                       // 3711
  const meta = { name: first.name, category: first.category, type: first.type, routineId: first.routineId }; // 3712
  const kept = board.placements.filter(p => p.groupId !== groupId);               // 3713
  const count = policy.clamp
    ? Math.min(newCount, totalCellsFrom(first.row, first.startIndex, board))
    : newCount;
  const segments = buildSegments(first.row, first.startIndex, count, board);      // 3714
  const subRow = policy.keepLane ? originalSubRow : findFreeLane(kept, segments);
  const cleared = policy.overwriteSameLane
    ? clearSegmentsArea(kept, segments, groupId, subRow)                          // 3715
    : { placements: kept, affectedRows: [] };
  const added = makeSegmentPlacements(segments, { groupId, ...meta }, ids, { subRow }); // 3716-3722
  const affectedRows = [...new Set([...previousRows, ...segments.map(s => s.row), ...cleared.affectedRows])]; // 3723
  return finish([...cleared.placements, ...added], affectedRows, affectedRows, policy);
}

/**
 * 그룹을 삭제한다. removePlacementGroup(3567-3576).
 *
 * ⚠ 원본은 메인 보드일 때 `state.selectedGroupIds.delete(groupId)` + `updateCreateRoutineFromSelectionBtn()`
 *   (3570-3572)를 부른다. 도메인은 전역 선택 집합을 모르므로 **selectionRemoved 를 값으로 돌려주고**
 *   유스케이스(boardCommands.removeGroup)가 선택 집합을 갱신하고 Dirty 에 {selection, toolbar} 를 싣는다.
 *   빠뜨리면 '배치 2개 선택 → 하나 삭제 → 툴바가 계속 「루틴으로 편성 (2)」 표시' 회귀가 난다.
 * ⚠ 그룹이 없어도 조기 반환하지 않는다 — renderRows 는 빈 배열이지 null 이 아니다(골든 remove-03).
 * ⚠ affectedRows 는 affectedRowsByGroup 이 돌려주는 **중복 포함** 배열 그대로 렌더에 넘어간다(3568·3575).
 *
 * @see index.html:3567
 * @param {object} board
 * @param {{ groupId:string }} args
 * @param {(()=>string)|{uid:()=>string}} [ids]  쓰지 않는다(시그니처 통일용)
 * @param {Partial<typeof REMOVE_POLICY>} [opt]
 * @returns {{placements:object[], renderRows:number[]|'all', changedRows:number[], selectionRemoved:string[]}}
 */
export function removeGroup(board, args, ids, opt) {
  const policy = { ...REMOVE_POLICY, ...opt };
  const { groupId } = args;
  const affectedRows = affectedRowsByGroup(board.placements, groupId);             // 3568
  const kept = board.placements.filter(p => p.groupId !== groupId);                // 3569
  const result = finish(kept, affectedRows, affectedRows, policy);                 // 3574-3575
  return { ...result, selectionRemoved: [groupId] };                               // 3570-3573
}
