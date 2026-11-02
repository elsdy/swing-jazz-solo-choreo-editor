// src/domain/boardOps.js — 배치 전이 6개 (순수 함수)
//
// 원본 index.html 의 removePlacementGroup(3567-3576) · placeMove(3578-3605) ·
// placeRoutineOnBoard(3607-3634) · movePlacementGroup(3636-3671) ·
// copyPlacementGroup(3673-3704) · rebuildGroup(3706-3726) 을 글자 단위로 옮겼다.
// ctx 제자리 변형과 renderRows()/unmarkDraggingGroups()/state 접근만 걷어내고
// "무엇을 다시 그릴지"를 값(renderRows·changedRows)으로 돌려준다.

import { totalCellsFrom, buildSegments, linearOf, cellOf } from './grid.js';
import { findFreeLane, clearSegmentsArea, repackLanes } from './lanes.js';
import { getGroup, groupCount, groupsOf, affectedRowsByGroup, makeSegmentPlacements } from './placements.js';

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
//                이동/복사는 전 행을 그린다 — a3d5d5c 가 stale DOM 회피로 도입했고, 2026-11-02 에 규모를 재어
//                **원칙으로 정했다**(docs/PRINCIPLES.md D-20, RM-35). 이 값을 renderRows 대신 렌더에 쓰면 동작이
//                바뀐다 — 좁힐 일이 생기면 동작 변경 커밋으로 따로 낸다(tests/unit/boardScale.test.mjs 가 이 값의 정직성을 지킨다).
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
  renderAllRows: true   // 3667-3670: 전 행 렌더 — 원칙 D-20(RM-35 에서 재어 정함). changedRows 가 정직한 범위를 따로 알려준다
});

/**
 * copyPlacementGroup(3673-3704)의 규칙.
 * 2026-09-29 에 repack 을 true 로 뒤집어 **원본과 다른 동작**이 됐다(RM-02). 원본은 이동은 repack 하는데
 * 복사만 하지 않아, 붙여 넣은 행에 겹침이 사라진 뒤 위층에 혼자 남은 블록이 그대로 떠 있었다. 2026-09-23 결정
 * D-1(「겹침이 사라지면 층은 즉시 위로 당긴다」)에 맞춰 놓기·이동·삭제·늘이기와 같은 규칙이 됐다.
 * 다시 채우는 것은 **붙여 넣은 행**뿐이다 — 원본 행은 바뀌지 않았으므로 건드리지 않는다.
 * 골든: copy-06-repack-target-row(차이) · copy-05-source-row-untouched(원본 행). meta.intentionalChanges 참조.
 * @see index.html:3673
 */
export const COPY_POLICY = Object.freeze({
  clamp: true,          // 3676
  repack: true,         // 2026-09-29 — 원본은 false(RM-02)
  renderAllRows: true   // 3700-3703 — 원칙 D-20(이동과 같다)
});

/**
 * rebuildGroup(3706-3726)의 규칙.
 *
 * 2026-09-07 에 두 플래그를 뒤집어 **원본과 다른 동작**이 됐다(로직은 그대로, 플래그만 바뀌었다).
 *  · keepLane:false        — 원본은 원래 레인(first.subRow||0)을 고수했다. 이제 배치·이동·복사와 같이
 *    findFreeLane 으로 빈 레인을 찾아 내려간다.
 *  · overwriteSameLane:false — 원본은 같은 레인에서 겹치는 그룹을 clearSegmentsArea 로 **통째로** 지웠다
 *    (FINAL-architecture.md §5 #3). 이제 아무것도 지우지 않고 아래층으로 쌓는다.
 * 둘 다 true 로 되돌리면 원본 동작이 그대로 살아난다 — 그때 깨지는 골든이
 * resize-05-stacks-instead-of-overwrite · resize-12-routine-board · resize-13-grow-then-repack-scope 이고,
 * 그 셋의 기대값 내력은 골든 meta.intentionalChanges 에 적혀 있다.
 * 근거: 개발 원칙 D-2(배치 충돌은 조작 종류와 무관하게 같은 규칙),
 * docs/deviations.md "고쳐서 내보낸 것 — 리사이즈만 겹친 동작을 확인 없이 지웠다".
 * ⚠ clamp:false — newCount 를 자르지 않는다. buildSegments 가 board.rows 에서 조용히 끊는다(원본 그대로).
 * @see index.html:3706
 */
export const RESIZE_POLICY = Object.freeze({
  clamp: false,
  repack: true,             // 3724
  keepLane: false,          // ← 이동·복사와 같은 규칙: 겹치면 빈 레인을 찾아 내려간다
  overwriteSameLane: false, // ← 겹친 그룹을 지우지 않는다
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
 *
 * ⚠ **레인이 바뀐 행은 반드시 다시 그린다**(2026-09-20). 그전에는 호출부가 넘긴 renderRows 만
 *   그려서, repack 이 그 밖의 행을 내려도 화면은 옛 층에 그대로 뒀다 — 겹친 둘 중 하나를 지워도
 *   남은 블록이 아래층에 붙어 있고 행이 두 줄인 채로 보였다(더블클릭 과녁이 흔들리는 까닭).
 *   `renderAllRows` 면 이미 전부라 더할 것이 없다.
 * @param {object[]} placements  repack 전 배치 목록
 * @param {number[]} rows        원본이 repackSubRows 에 넘기던 행 목록
 * @param {number[]} renderRows  원본이 renderRows 에 넘기던 행 목록
 * @param {{repack:boolean, renderAllRows:boolean}} policy
 */
function finish(placements, rows, renderRows, policy) {
  const packed = policy.repack ? repackLanes(placements, rows) : null;
  return {
    placements: packed ? packed.placements : placements,
    renderRows: policy.renderAllRows ? 'all' : unionRows(renderRows, packed ? packed.changedRows : []),
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
 * ⚠ move 는 **동작 목록의 항목이 아니어도 된다.** 이름 없이 자리부터 잡는 받아 적기(2026-09-12)가
 *   `{name:'', category, pending:true}` 를 그대로 넘긴다 — 여기서 목록을 다시 조회하지 않기 때문에
 *   가능한 일이고, 그 덕에 "이름을 먼저 정해야 놓을 수 있다"는 순서가 풀린다.
 *
 * @see index.html:3578
 * @param {{rows:number,cols:number,hasIntroRow?:boolean,placements:object[]}} board
 * @param {{ move: {name:string,category:string,pending?:boolean}|null|undefined, startRow:number, startIndex:number, totalCount:number }} args
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
    { groupId, name: move.name, category: move.category, pending: move.pending },
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
 * groupId 는 유지하고 meta(name/category/pending/type/routineId)만 첫 세그먼트에서 복사하며
 * (⚠ pending 은 2026-10-01 에 더했다 — 그전에는 받아 적기의 `?` 블록을 옮기거나 늘이거나 복사하면 표시가 빠져
 *  이름도 `?` 도 없는 빈 블록이 됐다. 이동 · 복사 · 늘이기 세 자리가 같은 meta 를 쓴다)
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
  const meta = { name: group[0].name, category: group[0].category, pending: group[0].pending, type: group[0].type, routineId: group[0].routineId }; // 3642
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
  const meta = { name: group[0].name, category: group[0].category, pending: group[0].pending, type: group[0].type, routineId: group[0].routineId }; // 3678
  const subRow = findFreeLane(board.placements, segments);                        // 3679-3690
  const newGroupId = uidOf(ids)();                                                // 3692
  const added = makeSegmentPlacements(segments, { groupId: newGroupId, ...meta }, ids, { subRow }); // 3693-3699
  const rows = [...new Set(segments.map(s => s.row))];
  return finish([...board.placements, ...added], rows, rows, policy);
}

/**
 * 담아 둔 블록 하나를 (targetRow, targetStartIndex)에 붙여 넣는다(2026-10-01, RM-13 키보드 붙여넣기 · 복제).
 *
 * copyGroup 과 **같은 규칙**이다 — COPY_POLICY(끝에서 자르기 · 붙여 넣은 행의 층 당기기), 빈 레인 찾기,
 * groupId 먼저 · 세그먼트 id 다음의 발급 차례. 다른 점은 무엇을 복사할지가 보드 위의 그룹이 아니라
 * **값**(이름 · 카테고리 · 길이 …)으로 들어온다는 것 하나다 — 복사한 뒤 원본을 지워도 붙여 넣을 수 있어야 한다.
 * ⚠ 새 복사 길이 층 규칙(D-1)을 우회하지 않게 따로 식을 두지 않는다. 바꿀 일이 생기면 copyGroup 과 함께 바꾼다.
 *
 * @param {object} board
 * @param {{ block: {name:string, category:string, pending?:boolean, type?:string, routineId?:string, count:number},
 *           targetRow:number, targetStartIndex:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof COPY_POLICY>} [opt]
 * @returns {{placements:object[], renderRows:number[]|'all'|null, changedRows:number[], groupId:string|null}}
 */
export function pasteBlock(board, args, ids, opt) {
  const policy = { ...COPY_POLICY, ...opt };
  const { block, targetRow, targetStartIndex } = args;
  if (!block || !(block.count > 0)) return { ...noRender(board), groupId: null };
  const count = policy.clamp
    ? Math.min(block.count, totalCellsFrom(targetRow, targetStartIndex, board))
    : block.count;
  if (count <= 0) return { ...noRender(board), groupId: null };
  const segments = buildSegments(targetRow, targetStartIndex, count, board);
  const meta = { name: block.name, category: block.category, pending: block.pending, type: block.type, routineId: block.routineId };
  const subRow = findFreeLane(board.placements, segments);
  const groupId = uidOf(ids)();
  const added = makeSegmentPlacements(segments, { groupId, ...meta }, ids, { subRow });
  const rows = [...new Set(segments.map(s => s.row))];
  return { ...finish([...board.placements, ...added], rows, rows, policy), groupId };
}

/**
 * 그룹의 길이를 newCount 로 다시 만든다. rebuildGroup(3706-3726) — 리사이즈 확정 경로.
 *
 * ⚠ 오늘의 기본 정책(RESIZE_POLICY)은 이동·복사와 같다 — findFreeLane 으로 빈 레인을 찾아 내려가고
 *   겹친 그룹은 지우지 않는다. 아래 두 분기는 원본 동작(keepLane·overwriteSameLane)을 되살릴 수 있게
 *   남겨 둔 것이며, 기본값에서는 clearSegmentsArea 쪽 가지가 타지 않는다.
 * ⚠ (원본 경로) 삭제 판정은 **자기 그룹을 이미 제거한 배열** 위에서 한다(3714 다음 3716). ignoreGroupId 를
 *   넘기는 것은 원문 그대로이지만 이 시점에는 이미 중복 가드다.
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
  const meta = { name: first.name, category: first.category, pending: first.pending, type: first.type, routineId: first.routineId }; // 3712
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
 * 그룹의 **시작점**을 당기거나 민다 — 왼쪽 가장자리 트리밍(RM-12). 끝 칸은 그대로 두고 시작 칸과 길이를 함께 바꾼다.
 * newCount 는 끝 칸에서 거꾸로 센 새 길이다(오른쪽 늘이기 resizeGroup 의 newCount 와 같은 뜻, 방향만 반대).
 *
 * 쌓기 규칙은 늘이기와 같다(RESIZE_POLICY — D-2): 새 자리에 겹치는 그룹이 있으면 지우지 않고 findFreeLane 으로 빈 층을 찾아
 * 내려가고, 끝에 손댄 행의 층을 다시 채운다. ⚠ 보드 앞 끝(인트로 행이 있으면 그 첫 칸)보다 앞으로 당기면 앞 끝에서 자른다.
 * 여러 행에 걸친 그룹이면 시작 행이 바뀔 수 있다 — 그룹을 선형 구간으로 펴서 다시 자르므로 조각 수는 새 구간이 정한다.
 *
 * @param {object} board
 * @param {{ groupId:string, newCount:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @param {Partial<typeof RESIZE_POLICY>} [opt]
 * @returns {{placements:object[], renderRows:number[]|'all'|null, changedRows:number[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=4
export function trimGroupStart(board, args, ids, opt) {
  const policy = { ...RESIZE_POLICY, ...opt };
  const { groupId } = args;
  const newCount = Math.trunc(Number(args.newCount));
  const group = getGroup(board.placements, groupId);
  if (!group.length || !(newCount >= 1)) return noRender(board);
  const span = spanOf(group, board.cols);
  const front = linearOf(board.hasIntroRow ? 0 : 1, 0, board.cols);              // 보드 첫 칸
  const from = Math.max(span.to - newCount + 1, front);                           // 앞 끝에서 자른다
  const kept = board.placements.filter(p => p.groupId !== groupId);
  const start = cellOf(from, board.cols);
  const segments = buildSegments(start.row, start.index, span.to - from + 1, board);
  const subRow = policy.keepLane ? span.subRow : findFreeLane(kept, segments);
  const added = makeSegmentPlacements(segments, { groupId, ...metaOf(span.head) }, ids, { subRow });
  const affectedRows = [...new Set([...rowsOf(span.segs), ...segments.map(s => s.row)])];
  return finish([...kept, ...added], affectedRows, affectedRows, policy);
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

// ─────────────────────────────────────────────────────────────────────────────
// 분할 · 병합 · 마디 편집 (2026-11-02, RM-16)
//
// 그룹을 **선형 카운트**로 펴서 다룬다(placements.shiftAllPlacements 와 같은 방식) — 조각의 row/startIndex 를
// 손대지 않고, 구간을 정한 뒤 grid.buildSegments 로 다시 자른다. 마디 경계에 걸친 그룹이 조각 몇 개인지를
// 여기서 셈하지 않는 까닭이다.
//
// 규칙(계획서 docs/roadmap/plans/RM-16.md 의 결정):
//   · 끼운 마디가 여러 마디에 걸친 블록 한가운데를 지나가면 **그 자리에서 둘로 끊는다** — 카운트 길이가 그대로라
//     음악과 어긋나지 않는다. 옮기기(행 맞바꾸기)도 두 행의 경계에서 같은 규칙으로 끊는다.
//   · 병합은 **같은 이름 · 같은 층 · 바로 붙은 것**만. 이름 없는 `?` 블록끼리도 합친다. 루틴 블록은 합치지 않는다.
//   · 지운 마디에만 있던 블록은 사라지고, 다른 마디로 이어지는 블록은 그 마디만큼 짧아진다.
//   · 끝에 층 다시 채우기(D-1)를 **손댄 그룹의 행**에만 거친다 — 안 건드린 행의 층은 그대로다.
// ⚠ 보드의 rows 는 마지막 행 번호다. 인트로 행(0)은 끼우거나 지우거나 옮길 수 없다 — 그 위에 끼우는 것도 없다.
// ⚠ 마커 · 보정점은 건드리지 않는다(결정: 안무표만 밀고 마커는 그대로 둔다). 알림은 유스케이스가 한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 그룹의 이름 · 분류 · 표지 — 이동 · 복사 · 늘이기가 쓰는 그 meta 와 같다. */
// @complexity time=O(1) space=O(1) cc=1
function metaOf(head) {
  return { name: head.name, category: head.category, pending: head.pending, type: head.type, routineId: head.routineId };
}

/**
 * 그룹 하나의 선형 구간. 조각은 언제나 이어져 있으므로(makeSegmentPlacements) 첫 조각의 시작과 길이 합이면 된다.
 * @returns {{ groupId:string, from:number, to:number, total:number, subRow:number, head:object, segs:object[] }}
 */
// @complexity time=O(k log k) space=O(k) cc=3
function spanOf(segs, cols) {
  const sorted = [...segs].sort((a, b) => a.row - b.row || a.startIndex - b.startIndex);
  const head = sorted[0];
  const from = linearOf(head.row, head.startIndex, cols);
  const total = sorted.reduce((n, p) => n + p.length, 0);
  return { groupId: head.groupId, from, to: from + total - 1, total, subRow: head.subRow || 0, head, segs: sorted };
}

/** 보드의 그룹 전부를 선형 구간으로. 등장 순(첫 조각의 배열 위치)을 지킨다. */
// @complexity time=O(n log n) space=O(n) cc=2
function spansOf(placements, cols) {
  const out = [];
  for (const [, segs] of groupsOf(placements)) out.push(spanOf(segs, cols));
  return out;
}

/** 선형 구간 [from, from+total) 을 그룹 하나의 조각들로 다시 자른다. */
// @complexity time=O(k) space=O(k) cc=1
function rebuildSpan(board, groupId, meta, from, total, subRow, ids) {
  const start = cellOf(from, board.cols);
  const segments = buildSegments(start.row, start.index, total, board);
  return makeSegmentPlacements(segments, { groupId, ...meta }, ids, { subRow });
}

/** 손댄 그룹의 행만 층을 다시 채우고(D-1) 결과를 조립한다. 행 수가 바뀌는 전이는 전 행을 그린다. */
// @complexity time=O(n log n)? space=O(n) cc=3
function finishRows(placements, touchedRows, renderAll, extra = {}) {
  const rows = [...new Set(touchedRows)];
  const packed = rows.length ? repackLanes(placements, rows) : { placements, changedRows: [] };
  return {
    placements: packed.placements,
    renderRows: renderAll ? 'all' : unionRows(rows, packed.changedRows),
    changedRows: unionRows(rows, packed.changedRows),
    ...extra
  };
}

/** 조각 목록의 행들. */
const rowsOf = (segs) => segs.map(p => p.row);

/**
 * 그룹을 **앞 조각 frontCount 카운트 · 뒤 조각 나머지**로 둘로 나눈다. 이름 · 분류 · 층은 두 조각에 그대로 남는다.
 * 앞 조각이 원래 그룹 번호를 지키고(고른 상태가 남는다), 뒤 조각은 새 번호를 받는다.
 *
 * ⚠ frontCount 가 1..total-1 이 아니면 아무것도 하지 않는다(renderRows:null) — 끝에서 자르면 조각이 비거나 전부다.
 * ⚠ 루틴 블록은 자르지 않는다 — 루틴은 편집기에서 고친다.
 *
 * @param {object} board
 * @param {{ groupId:string, frontCount:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{placements:object[], renderRows:number[]|null, changedRows:number[], groupIds:string[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=5
export function splitGroup(board, args, ids) {
  const { groupId, frontCount } = args;
  const group = getGroup(board.placements, groupId);
  if (!group.length || group[0].type === 'routine') return { ...noRender(board), groupIds: [] };
  const span = spanOf(group, board.cols);
  const front = Math.trunc(Number(frontCount));
  if (!(front >= 1 && front <= span.total - 1)) return { ...noRender(board), groupIds: [] };
  const meta = metaOf(span.head);
  const kept = board.placements.filter(p => p.groupId !== groupId);
  const backId = uidOf(ids)();                                   // 그룹 번호가 조각 id 보다 먼저다(place 와 같은 차례)
  const a = rebuildSpan(board, groupId, meta, span.from, front, span.subRow, ids);
  const b = rebuildSpan(board, backId, meta, span.from + front, span.total - front, span.subRow, ids);
  return finishRows([...kept, ...a, ...b], rowsOf(span.segs), false, { groupIds: [groupId, backId] });
}

/**
 * 이 그룹과 합칠 수 있는 이웃 — **바로 뒤**에 붙은 것, 없으면 **바로 앞**에 붙은 것. 없으면 null.
 * 같은 이름 · 같은 층 · 같은 `?` 여부여야 하고, 루틴 블록은 짝이 되지 않는다.
 * @param {object[]} placements
 * @param {number} cols
 * @param {string} groupId
 * @returns {string|null} 짝 그룹 번호
 */
// @complexity time=O(n log n) space=O(n) cc=9
export function mergePartner(placements, cols, groupId) {
  const mine = placements.filter(p => p.groupId === groupId);
  if (!mine.length || mine[0].type === 'routine') return null;
  const me = spanOf(mine, cols);
  const alike = (s) => s.groupId !== groupId && s.head.type !== 'routine'
    && (s.head.name || '') === (me.head.name || '') && !!s.head.pending === !!me.head.pending && s.subRow === me.subRow;
  const spans = spansOf(placements, cols).filter(alike);
  const next = spans.find(s => s.from === me.to + 1);
  if (next) return next.groupId;
  const prev = spans.find(s => s.to === me.from - 1);
  return prev ? prev.groupId : null;
}

/**
 * 붙어 있는 같은 이름 · 같은 층의 두 그룹을 하나로 합친다. 앞에 있는 쪽의 그룹 번호가 남고, 뒤의 것은 사라진다.
 * 짝이 아니면(떨어져 있거나 이름 · 층이 다르면) 아무것도 하지 않는다 — mergePartner 가 짝의 기준이다.
 *
 * @param {object} board
 * @param {{ groupId:string, withGroupId:string }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{placements:object[], renderRows:number[]|null, changedRows:number[], groupId:string|null, selectionRemoved:string[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=10
export function mergeGroups(board, args, ids) {
  const { groupId, withGroupId } = args;
  if (!withGroupId || withGroupId === groupId) return { ...noRender(board), groupId: null, selectionRemoved: [] };
  const partner = mergePartner(board.placements, board.cols, groupId);
  const other = partner === withGroupId ? withGroupId : null;
  // 앞에서 찾은 짝이 뒤 것일 때 사용자가 앞 것을 가리켰을 수도 있다 — 반대 방향으로도 한 번 본다.
  const paired = other || (mergePartner(board.placements, board.cols, withGroupId) === groupId ? withGroupId : null);
  if (!paired) return { ...noRender(board), groupId: null, selectionRemoved: [] };
  const a = spanOf(getGroup(board.placements, groupId), board.cols);
  const b = spanOf(getGroup(board.placements, paired), board.cols);
  if (a.to + 1 !== b.from && b.to + 1 !== a.from) return { ...noRender(board), groupId: null, selectionRemoved: [] };
  const [first, second] = a.from < b.from ? [a, b] : [b, a];
  const kept = board.placements.filter(p => p.groupId !== a.groupId && p.groupId !== b.groupId);
  const merged = rebuildSpan(board, first.groupId, metaOf(first.head), first.from, first.total + second.total, first.subRow, ids);
  return finishRows([...kept, ...merged], [...rowsOf(a.segs), ...rowsOf(b.segs)], false, {
    groupId: first.groupId, selectionRemoved: [second.groupId]
  });
}

/**
 * 그룹들을 선형 경계 `boundary`(그 카운트부터 뒤)에서 잘라 뒤쪽을 `delta` 만큼 옮긴다 — 끼우기 · 복제 · 옮기기의 공통 걸음.
 * 경계에 걸친 그룹은 끊긴다: 앞 조각이 번호를 지키고 뒤 조각은 새 번호를 받는다.
 * @returns {{ placements:object[], touched:number[], cutIds:string[] }} touched 는 손댄 그룹의 **옮긴 뒤** 행
 */
// @complexity time=O(n log n) space=O(n) cc=4
function shiftFrom(board, placements, boundary, delta, ids, nextBoard) {
  const out = [];
  const touched = [];
  const cutIds = [];
  for (const s of spansOf(placements, board.cols)) {
    if (s.to < boundary) { out.push(...s.segs); continue; }
    const meta = metaOf(s.head);
    if (s.from >= boundary) {
      const moved = rebuildSpan(nextBoard, s.groupId, meta, s.from + delta, s.total, s.subRow, ids);
      out.push(...moved);
      continue;
    }
    // 경계에 걸쳤다 — 그 자리에서 끊는다
    const frontLen = boundary - s.from;
    const backId = uidOf(ids)();
    const front = rebuildSpan(nextBoard, s.groupId, meta, s.from, frontLen, s.subRow, ids);
    const back = rebuildSpan(nextBoard, backId, meta, boundary + delta, s.total - frontLen, s.subRow, ids);
    out.push(...front, ...back);
    touched.push(...rowsOf(front), ...rowsOf(back));
    cutIds.push(s.groupId);
  }
  return { placements: out, touched, cutIds };
}

/** 행 번호가 끼우거나 지울 수 있는 몸통 행인가(인트로 행 0 은 아니다). */
const isBodyRow = (board, row) => Number.isInteger(row) && row >= 1 && row <= board.rows;

/**
 * `row` 위에 빈 마디 하나를 끼운다. 그 행부터의 배치가 모두 한 마디(cols 카운트) 밀리고 rows 가 하나 는다.
 * 경계(row 의 첫 카운트)에 걸친 블록은 그 자리에서 둘로 끊긴다.
 *
 * @param {object} board
 * @param {{ row:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{placements:object[], renderRows:'all'|null, changedRows:number[], rows:number, cutIds:string[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=2
export function insertRow(board, args, ids) {
  const { row } = args;
  if (!isBodyRow(board, row)) return { ...noRender(board), rows: board.rows, cutIds: [] };
  const nextBoard = { ...board, rows: board.rows + 1 };
  const boundary = linearOf(row, 0, board.cols);
  const r = shiftFrom(board, board.placements, boundary, board.cols, ids, nextBoard);
  return finishRows(r.placements, r.touched, true, { rows: nextBoard.rows, cutIds: r.cutIds });
}

/**
 * `row` 마디를 지운다. 그 마디에만 있던 블록은 사라지고, 다른 마디로 이어지는 블록은 그 마디만큼 짧아지며,
 * 뒤의 배치는 한 마디 당겨지고 rows 가 하나 준다. 인트로 행과 마지막 남은 몸통 행은 지우지 않는다.
 *
 * @param {object} board
 * @param {{ row:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{placements:object[], renderRows:'all'|null, changedRows:number[], rows:number, selectionRemoved:string[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=9
export function deleteRow(board, args, ids) {
  const { row } = args;
  if (!isBodyRow(board, row) || board.rows <= 1) return { ...noRender(board), rows: board.rows, selectionRemoved: [] };
  const cols = board.cols;
  const nextBoard = { ...board, rows: board.rows - 1 };
  const r0 = linearOf(row, 0, cols);
  const r1 = r0 + cols - 1;
  const out = [];
  const touched = [];
  const removed = [];
  for (const s of spansOf(board.placements, cols)) {
    if (s.to < r0) { out.push(...s.segs); continue; }
    const meta = metaOf(s.head);
    if (s.from > r1) { out.push(...rebuildSpan(nextBoard, s.groupId, meta, s.from - cols, s.total, s.subRow, ids)); continue; }
    if (s.from >= r0 && s.to <= r1) { removed.push(s.groupId); continue; }   // 그 마디에만 있었다
    // 걸쳤다 — 지운 마디 몫만 빼고 이어 붙인다(앞 조각 + 당겨진 뒤 조각은 선형으로 이어진다)
    const frontLen = Math.max(0, r0 - s.from);
    const backLen = Math.max(0, s.to - r1);
    const from = frontLen ? s.from : r0;
    const built = rebuildSpan(nextBoard, s.groupId, meta, from, frontLen + backLen, s.subRow, ids);
    out.push(...built);
    touched.push(...rowsOf(built));
  }
  return finishRows(out, touched, true, { rows: nextBoard.rows, selectionRemoved: removed });
}

/**
 * `row` 마디를 바로 아래에 복제한다 — 새 마디를 끼우고(아래 블록은 한 마디 밀린다) 그 마디의 블록을
 * **새 그룹 번호**로 복사한다. 여러 마디에 걸친 블록은 이 마디 몫만 복사된다.
 *
 * @param {object} board
 * @param {{ row:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{placements:object[], renderRows:'all'|null, changedRows:number[], rows:number, copiedIds:string[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=5
export function duplicateRow(board, args, ids) {
  const { row } = args;
  if (!isBodyRow(board, row)) return { ...noRender(board), rows: board.rows, copiedIds: [] };
  const cols = board.cols;
  const nextBoard = { ...board, rows: board.rows + 1 };
  const r0 = linearOf(row, 0, cols);
  const r1 = r0 + cols - 1;
  // 1) row+1 자리에 빈 마디를 끼운다(row 와 row+1 의 경계에 걸친 블록은 끊긴다)
  const shifted = shiftFrom(board, board.placements, r1 + 1, cols, ids, nextBoard);
  // 2) row 에 있는 조각을 새 번호로 한 마디 아래에 복사한다
  const copies = [];
  const copiedIds = [];
  for (const s of spansOf(shifted.placements, cols)) {
    if (s.to < r0 || s.from > r1) continue;
    const from = Math.max(s.from, r0);
    const to = Math.min(s.to, r1);
    const copyId = uidOf(ids)();
    copies.push(...rebuildSpan(nextBoard, copyId, metaOf(s.head), from + cols, to - from + 1, s.subRow, ids));
    copiedIds.push(copyId);
  }
  const touched = [...shifted.touched, row + 1];
  return finishRows([...shifted.placements, ...copies], touched, true, { rows: nextBoard.rows, copiedIds });
}

/**
 * `row` 마디를 이웃(`delta` = -1 위 · +1 아래)과 맞바꾼다. 두 행의 경계에 걸친 블록은 경계에서 끊긴다 —
 * 끼우기와 같은 규칙이다. 두 행 모두 몸통 행이어야 한다(인트로 행과는 바꾸지 않는다).
 *
 * @param {object} board
 * @param {{ row:number, delta:number }} args
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {{placements:object[], renderRows:number[]|null, changedRows:number[], cutIds:string[]}}
 */
// @complexity time=O(n log n) space=O(n) cc=10
export function moveRow(board, args, ids) {
  const { row, delta } = args;
  const step = Math.sign(Number(delta));
  const other = row + step;
  if (!step || !isBodyRow(board, row) || !isBodyRow(board, other)) return { ...noRender(board), cutIds: [] };
  const cols = board.cols;
  const lo = Math.min(row, other);
  const b0 = linearOf(lo, 0, cols);            // 아랫 행(lo) 의 시작
  const b1 = b0 + cols;                        // 윗 행(hi) 의 시작
  const b2 = b1 + cols;                        // hi 다음 행의 시작
  const out = [];
  const touched = [];
  const cutIds = [];
  for (const s of spansOf(board.placements, cols)) {
    if (s.to < b0 || s.from >= b2) { out.push(...s.segs); continue; }
    const meta = metaOf(s.head);
    // 세 경계에서 조각을 가른다: [from..b0-1] · [b0..b1-1] · [b1..b2-1] · [b2..to]
    const pieces = [];
    const cut = (a, b, shift) => { if (a <= b) pieces.push({ from: a + shift, total: b - a + 1 }); };
    cut(s.from, Math.min(s.to, b0 - 1), 0);
    cut(Math.max(s.from, b0), Math.min(s.to, b1 - 1), cols);    // lo 행 몫 → hi 로
    cut(Math.max(s.from, b1), Math.min(s.to, b2 - 1), -cols);   // hi 행 몫 → lo 로
    cut(Math.max(s.from, b2), s.to, 0);
    if (pieces.length > 1) cutIds.push(s.groupId);
    pieces.forEach((piece, i) => {
      const id = i === 0 ? s.groupId : uidOf(ids)();
      const built = rebuildSpan(board, id, meta, piece.from, piece.total, s.subRow, ids);
      out.push(...built);
      touched.push(...rowsOf(built));
    });
  }
  return finishRows(out, [lo, lo + 1, ...touched], false, { cutIds });
}
