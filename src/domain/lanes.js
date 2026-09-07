// src/domain/lanes.js — subRow(레인) 규칙 전담 (순수 함수, 의존성 0)
//
// 원본 index.html 의 clearSegmentsArea(3487-3505) · repackSubRows(3506-3565) 전문과,
// 5곳에 복제돼 있던 "충돌 없는 가장 낮은 subRow 탐색" 루프(3585·3614·3645·3681·4152)를 findFreeLane 하나로,
// 8곳에 복제돼 있던 구간 겹침식(3494·3519·3555·3589·3618·3651·3686·4143)을 overlaps 하나로 합쳤다.
// 알고리즘·정렬 동점 순서·제거 규칙은 한 글자도 바꾸지 않았다.

/**
 * @typedef {Object} Span  겹침 판정에 필요한 최소 형태
 * @property {number} startIndex
 * @property {number} length
 */

// ─────────────────────────────────────────────────────────────────────────────
// 구간 겹침 — 원본 8곳이 글자 단위로 같은 식이었다(확인 완료)
//   3494 clearSegmentsArea : !(seg.startIndex + seg.length - 1 < p.startIndex || p.startIndex + p.length - 1 < seg.startIndex)
//   3519 repack Phase1     : !(p.startIndex   + p.length   - 1 < ex.startIndex || ex.startIndex + ex.length - 1 < p.startIndex)
//   3555 repack Phase2     : 3494 와 동일
//   3589 placeMove         : segEnd 를 미리 뽑아 쓸 뿐 같은 식
//   3618 placeRoutineOnBoard / 3651 movePlacementGroup / 3686 copyPlacementGroup / 4143 mergeProjectData : 동일
// 같은 행인지(row 비교)는 호출부가 따로 확인한다 — 원본이 그랬다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 두 구간이 겹치는가. 행 비교는 하지 않는다.
 * @see index.html:3494
 * @see index.html:3519
 * @param {Span} a
 * @param {Span} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  return !(a.startIndex + a.length - 1 < b.startIndex || b.startIndex + b.length - 1 < a.startIndex);
}

/**
 * segments 전부가 충돌 없이 들어갈 수 있는 가장 낮은 subRow(레인)를 찾는다.
 *
 * 원본 5곳을 대조한 결과:
 *  - placeMove(3583-3592) · placeRoutineOnBoard(3612-3623) · copyPlacementGroup(3679-3690) ·
 *    mergeProjectData(4152-4163) 은 `while(true) { segments.some(...) }` 형태로 완전히 동일하다.
 *  - ⚠ movePlacementGroup(3644-3653) 만 labeled `outer:` 루프를 쓴다. 세그먼트 하나라도 충돌하면
 *    targetSubRow++ 후 처음부터 다시 도는 구조라서, `some` 판정과 **결과가 동일**하다(부작용 없음).
 *    따라서 합쳤다. 차이는 순회 중단 시점뿐이다.
 *  - rebuildGroup(3706-3728) 은 원본에서 이 목록에 없었다. 레인을 탐색하지 않고 **원래 레인
 *    (originalSubRow)을 유지**했기 때문이다. 2026-09-07 에 RESIZE_POLICY.keepLane 을 false 로 뒤집어
 *    리사이즈도 이 함수를 쓰게 했다(배치 충돌 규칙을 조작 종류와 무관하게 하나로 — 개발 원칙 D-2).
 *  - startLane/ignoreGroupId 는 repackLanes Phase 2(3549-3562)가 쓴다: maxSub 부터 시작하고 자기 그룹은 제외.
 *
 * @see index.html:3583
 * @see index.html:3612
 * @see index.html:3644
 * @see index.html:3679
 * @see index.html:4152
 * @param {object[]} placements                        이미 보드에 있는 배치들
 * @param {{row:number,startIndex:number,length:number}[]} segments 놓으려는 세그먼트들
 * @param {{ startLane?: number, ignoreGroupId?: string|null }} [options]
 * @returns {number} 충돌 없는 최소 레인
 */
export function findFreeLane(placements, segments, options = {}) {
  const { startLane = 0, ignoreGroupId = null } = options;
  let lane = startLane;
  for (;;) {
    const hasConflict = segments.some(seg => placements.some(ex =>
      (ignoreGroupId == null || ex.groupId !== ignoreGroupId) &&
      ex.row === seg.row && (ex.subRow || 0) === lane &&
      overlaps(seg, ex)
    ));
    if (!hasConflict) return lane;
    lane++;
  }
}

/**
 * 한 행의 배치를 레인 인덱스로 묶는다. 파생 헬퍼(원본에 대응 함수 없음) —
 * renderRow(3364-3375)의 maxVisualSubRow 계산과 repack Phase1 의 layers[] 를 값으로 드러낸다.
 * 구멍이 있는 레인은 빈 배열로 채워지므로 `lanesOfRow(...).length - 1 === maxVisualSubRow` 다.
 * @param {object[]} placements
 * @param {number} row
 * @returns {object[][]} index = subRow
 */
export function lanesOfRow(placements, row) {
  const lanes = [];
  placements.forEach(p => {
    if (p.row !== row) return;
    const s = p.subRow || 0;
    for (let i = lanes.length; i <= s; i++) lanes[i] = [];
    lanes[s].push(p);
  });
  return lanes;
}

/**
 * segments 가 덮는 영역과 겹치는 배치를 **그룹 단위로** 제거한다.
 *
 * ⚠ 2026-09-07 부터 **운영 경로에서 호출되지 않는다.** 마지막 호출자였던 boardOps.resizeGroup 이
 *   RESIZE_POLICY.overwriteSameLane:false 로 바뀌어 겹친 그룹을 지우는 대신 아래층으로 쌓기 때문이다.
 *   그래도 지우지 않는다 — 그 정책 플래그를 true 로 되돌리면 그대로 되살아나는 가지이고,
 *   골든 clear-01~clear-06 이 이 함수를 clearArea op 으로 직접 검사한다.
 *
 * ⚠ 보존해야 하는 결함 두 가지(FINAL-architecture.md §5 #3):
 *  1) 겹친 세그먼트 하나만 지우는 게 아니라 그 groupId 전체를 지운다.
 *     그래서 subRow 를 지정해도 **다른 레인에 있는 같은 그룹의 세그먼트까지 사라진다**.
 *  2) affectedRows 는 removeIds 확정 후 `ctx.placements` 전체에서 다시 뽑으므로,
 *     subRow/ignoreGroupId 가드에 걸려 스캔에서 빠졌던 세그먼트의 행까지 포함된다.
 *  3) `if (ignoreGroupId && ...)` 는 truthy 검사라 groupId 가 빈 문자열이면 무시되지 않는다(원문 유지).
 *
 * 원본은 ctx.placements 를 제자리에서 갈아끼우고 affectedRows 만 반환했다.
 * 순수화하면서 {placements, affectedRows} 를 반환한다. 아무것도 지우지 않으면 입력 배열을 그대로 돌려준다
 * (원본이 `if (removeIds.size)` 로 재할당을 건너뛰던 것과 같다).
 *
 * @see index.html:3487
 * @param {object[]} placements
 * @param {{row:number,startIndex:number,length:number}[]} segments
 * @param {string|null} [ignoreGroupId]
 * @param {number|null} [subRow]  지정 시 같은 레이어만 제거 (다른 레이어는 보존)
 * @returns {{ placements: object[], affectedRows: number[] }} affectedRows 는 중복 포함·원본 순서
 */
export function clearSegmentsArea(placements, segments, ignoreGroupId = null, subRow = null) {
  const removeIds = new Set();
  placements.forEach(p => {
    if (ignoreGroupId && p.groupId === ignoreGroupId) return;
    // subRow 지정 시 같은 레이어만 제거 (다른 레이어는 보존)
    if (subRow !== null && (p.subRow || 0) !== subRow) return;
    if (segments.some(seg => seg.row === p.row && overlaps(seg, p))) {
      removeIds.add(p.groupId);
    }
  });
  const affectedRows = placements.filter(p => removeIds.has(p.groupId)).map(p => p.row);
  const next = removeIds.size ? placements.filter(p => !removeIds.has(p.groupId)) : placements;
  return { placements: next, affectedRows };
}

/**
 * 지정 행들의 subRow를 재정렬: 갭 없이 0부터 촘촘하게 재배정.
 * 배치 이동/삭제 후 "빈 상단 레이어" 현상을 방지한다.
 *
 * 원본 repackSubRows(3506-3565)를 그대로 옮겼다. 제자리 변형만 버리고 얕은 복제 위에서 같은 절차를 돌린다:
 *  - Phase 1: 행별 탐욕 배정. 정렬은 `(a.subRow||0) - (b.subRow||0) || a.startIndex - b.startIndex`,
 *    ⚠ stable sort 동점 순서(3512)에 결과가 의존하므로 비교 함수를 절대 바꾸지 말 것.
 *  - Phase 2: 여러 행에 걸친 그룹의 subRow 를 maxSub 이상에서 통일.
 *
 * ⚠ 보존해야 하는 결함(FINAL-architecture.md §5 #4): Phase 2 는 인자로 받은 rows **밖의 행**까지
 *   바꿀 수 있는데 원본 호출부는 그 행을 다시 그리지 않는다. changedRows 는 그 사실을 값으로 드러낼 뿐
 *   **렌더 대상이 아니다** — 오늘의 호출부는 각자의 affectedRows 로만 renderRows 를 부른다.
 *   changedRows 를 렌더에 쓰면 동작이 바뀐다.
 *
 * @see index.html:3506
 * @param {object[]} placements
 * @param {number[]} rows  재정렬 대상 행 (중복 허용)
 * @returns {{ placements: object[], changedRows: number[] }} changedRows: subRow 값이 실제로 바뀐 행(중복 제거, 등장 순)
 */
export function repackLanes(placements, rows) {
  // 원본은 ctx.placements 의 객체를 직접 변형했다. 순수성을 지키려고 얕은 복제 위에서 같은 절차를 돌린다.
  // ⚠ subRow 키가 없던 객체({...p})는 복제 후에도 키가 없고, 아래에서 대입될 때 **맨 뒤에** 붙는다.
  //   원본의 `p.subRow = s` 와 키 순서가 같아 JSON 바이트가 보존된다(syncCurrentRoutine 경로).
  const work = placements.map(p => ({ ...p }));

  const uniqueRows = [...new Set(rows)];
  // Phase 1: 행별 탐욕 배정 (기존 로직)
  uniqueRows.forEach(row => {
    const rp = work.filter(p => p.row === row);
    if (!rp.length) return;
    // 현재 subRow → startIndex 순으로 정렬 (stable sort: 동점 시 기존 순서 유지)
    rp.sort((a, b) => (a.subRow || 0) - (b.subRow || 0) || a.startIndex - b.startIndex);
    // 각 배치에 충돌 없는 최소 subRow 재배정
    const layers = []; // layers[s] = 이미 배정된 배치 목록
    rp.forEach(p => {
      let s = 0;
      while (true) {
        const layer = layers[s] || [];
        const conflict = layer.some(ex => overlaps(p, ex));
        if (!conflict) break;
        s++;
      }
      p.subRow = s;
      if (!layers[s]) layers[s] = [];
      layers[s].push(p);
    });
  });

  // Phase 2: 그룹 일관성 보장 — 여러 행에 걸친 그룹의 subRow를 통일
  // (스케일링으로 새 행에 세그먼트가 생기면 행별 배정에서 subRow가 달라질 수 있음)
  const rowSet = new Set(uniqueRows);
  const groupsInScope = new Set();
  work.forEach(p => { if (rowSet.has(p.row)) groupsInScope.add(p.groupId); });

  const groupAllSegs = new Map();
  work.forEach(p => {
    if (!groupsInScope.has(p.groupId)) return;
    if (!groupAllSegs.has(p.groupId)) groupAllSegs.set(p.groupId, []);
    groupAllSegs.get(p.groupId).push(p);
  });

  groupAllSegs.forEach((segs, gid) => {
    if (segs.length <= 1) return;
    const maxSub = Math.max(...segs.map(p => p.subRow || 0));
    if (segs.every(p => (p.subRow || 0) === maxSub)) return;

    // 그룹 전체가 들어갈 수 있는 충돌 없는 subRow 탐색 (maxSub부터)
    const targetSub = findFreeLane(work, segs, { startLane: maxSub, ignoreGroupId: gid });
    segs.forEach(p => p.subRow = targetSub);
  });

  // 실제로 subRow 가 바뀐 행 (진단·Dirty 계산용, 렌더 대상 아님 — 위 주석 참조)
  const changedRows = [];
  const seen = new Set();
  for (let i = 0; i < work.length; i++) {
    if ((work[i].subRow || 0) === (placements[i].subRow || 0)) continue;
    if (seen.has(work[i].row)) continue;
    seen.add(work[i].row);
    changedRows.push(work[i].row);
  }

  return { placements: work, changedRows };
}
