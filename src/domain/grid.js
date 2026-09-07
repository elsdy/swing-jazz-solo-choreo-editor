// src/domain/grid.js — 격자 기하 + 카운트 축 (순수 함수, 의존성 0)
//
// 원본 index.html 의 clamp(2243) · boardSignature(2294) · pointerToCellIndex 산술부(3449-3451) ·
// totalCellsFrom(3453) · calcCrossRowCount(3458) · buildSegments(3464) ·
// applyBoardSizeFromInput/applyReBoardSizeFromInput 의 클램핑부 · updateMobileCellSize 의 산술부를 옮겼다.
// 모든 도메인 모듈이 이 파일에 의존한다. 브라우저 전역·시계·난수를 한 글자도 쓰지 않는다.

// ─────────────────────────────────────────────────────────────────────────────
// ⚠⚠ board.rows 는 "행 개수"가 아니라 "마지막 행 인덱스"다. ⚠⚠
// 메인 보드는 intro(row 0)가 있어 실제 행이 rows+1 개, 루틴 보드는 rows 개다.
// 그래서 totalCellsFrom = (rows-row)*cols + (cols-startIndex) 하나가 두 보드에서 다 맞는다.
// 필드명을 lastRow 로 고치면 프로젝트 JSON 의 rows 키와 boardSignature 캐시 키가 어긋나므로
// 이름은 그대로 두고 firstRowIndex/rowIndices/rowCount 파생 함수로만 다룬다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} BoardGrid
 * @property {number} rows         마지막 행 인덱스 (행 개수가 아니다 — 위 경고 참조)
 * @property {number} cols         한 행의 칸 수
 * @property {boolean} [hasIntroRow] intro 행(row 0) 보유 여부. 메인 true, 루틴 false/undefined
 */

/**
 * @typedef {Object} Segment
 * @property {number} row
 * @property {number} startIndex
 * @property {number} length
 */

/**
 * 값을 [min, max] 안으로 가둔다.
 * @see index.html:2243
 * @param {number} num
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

/**
 * 보드 골격 캐시 키. 프로젝트 JSON 과 무관한 순수 문자열이지만 형식(`${cols}x${rows}`)을 바꾸면
 * renderBoard 의 재빌드 판정이 달라지므로 원문 그대로 둔다.
 * @see index.html:2294
 * @param {BoardGrid} board
 * @returns {string}
 */
export function boardSignature(board) {
  return `${board.cols}x${board.rows}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 행 인덱스 파생 — 원본의 `ctx === mainCtx ? [0, ...] : [...]` 분기 6곳을 흡수한다
// (3324 intro 행 생성 · 3330 expectedSize · 3334 · 3667 · 3700 · 3886 allRows)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 첫 행 인덱스. 메인 보드는 intro 때문에 0, 루틴 보드는 1.
 * @param {BoardGrid} board
 * @returns {number}
 */
export function firstRowIndex(board) {
  return board.hasIntroRow ? 0 : 1;
}

/**
 * 보드의 전체 행 인덱스 목록.
 * 원본: `ctx === mainCtx ? [0, ...Array.from({length: ctx.rows}, (_, i) => i + 1)]
 *                        : Array.from({length: ctx.rows}, (_, i) => i + 1)`
 * @see index.html:3334
 * @see index.html:3667
 * @see index.html:3700
 * @param {BoardGrid} board
 * @returns {number[]}
 */
export function rowIndices(board) {
  const body = Array.from({ length: board.rows }, (_, i) => i + 1);
  return board.hasIntroRow ? [0, ...body] : body;
}

/**
 * 실제 행 개수. 원본 renderBoard 의 expectedSize(`ctx === mainCtx ? ctx.rows + 1 : ctx.rows`).
 * @see index.html:3330
 * @param {BoardGrid} board
 * @returns {number}
 */
export function rowCount(board) {
  return board.hasIntroRow ? board.rows + 1 : board.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// 카운트 축 — 격자의 1급 좌표
// 원점을 row 1 의 0카운트로 잡으면 intro 행(row 0)이 [-cols, -1] 구간으로 분기 없이 떨어진다.
// ⚠ totalCellsFrom / calcCrossRowCount 는 이 축으로 다시 유도하지 않고 원본 식을 그대로 옮겼다.
//   골든이 초록이 된 뒤에 갈아탈 일이다(FINAL-architecture.md §2).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (row, index) → 선형 카운트. row 1 의 index 0 이 0.
 * @param {number} row
 * @param {number} index
 * @param {number} cols
 * @returns {number}
 */
export const linearOf = (row, index, cols) => (row - 1) * cols + index;

/**
 * 선형 카운트 → (row, index). 음수 구간(intro 행)에서도 성립한다.
 * @param {number} n
 * @param {number} cols
 * @returns {{ row: number, index: number }}
 */
export const cellOf = (n, cols) => ({ row: Math.floor(n / cols) + 1, index: ((n % cols) + cols) % cols });

/**
 * (row, startIndex) 부터 보드 끝까지 남은 칸 수.
 * @see index.html:3453
 * @param {number} row
 * @param {number} startIndex
 * @param {BoardGrid} board
 * @returns {number}
 */
export function totalCellsFrom(row, startIndex, board) {
  return ((board.rows - row) * board.cols) + (board.cols - startIndex);
}

/**
 * 시작(row,col)→끝(row,col)까지 셀 수 계산 (다중 행 포함).
 * @see index.html:3458
 * @param {number} startRow
 * @param {number} startCol
 * @param {number} endRow
 * @param {number} endCol
 * @param {BoardGrid} board
 * @returns {number}
 */
export function calcCrossRowCount(startRow, startCol, endRow, endCol, board) {
  if (endRow < startRow || (endRow === startRow && endCol < startCol)) return 1;
  if (endRow === startRow) return endCol - startCol + 1;
  return (board.cols - startCol) + (endRow - startRow - 1) * board.cols + (endCol + 1);
}

/**
 * 총 카운트를 행 단위 세그먼트로 쪼갠다. board.rows 를 넘어가는 몫은 조용히 버려진다.
 * @see index.html:3464
 * @param {number} startRow
 * @param {number} startIndex
 * @param {number} totalCount
 * @param {BoardGrid} board
 * @returns {Segment[]}
 */
export function buildSegments(startRow, startIndex, totalCount, board) {
  const segments = [];
  let remaining = totalCount;
  let row = startRow;
  let col = startIndex;
  while (remaining > 0 && row <= board.rows) {
    const len = Math.min(board.cols - col, remaining);
    segments.push({ row, startIndex: col, length: len });
    remaining -= len;
    row += 1;
    col = 0;
  }
  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// 보드 크기 변경 시 배치 클리핑
// ⚠ 메인과 루틴의 규칙이 정반대다. 데이터(overflowRows)로 드러내되 식은 원문 그대로.
//   - 메인(applyBoardSizeFromInput 2955-2958): 행 초과 배치를 **삭제**한다.
//   - 루틴(applyReBoardSizeFromInput 4869-4874): 행 초과 배치는 **숨길 뿐 삭제하지 않는다**
//     (행을 다시 늘리면 복원된다). 열 초과만 길이를 자른다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @see index.html:2955
 * @see index.html:4869
 * @param {object[]} placements
 * @param {BoardGrid} board            새 크기
 * @param {{ overflowRows?: 'drop'|'keep' }} [options] 'drop'=메인, 'keep'=루틴
 * @returns {object[]} 새 배열 (원본 배열/객체는 건드리지 않는다)
 */
export function clampToGrid(placements, board, options = {}) {
  const { overflowRows = 'drop' } = options;
  return placements
    .filter(p => (overflowRows === 'drop' ? p.row <= board.rows && p.startIndex < board.cols : p.startIndex < board.cols))
    .map(p => ({ ...p, length: Math.min(p.length, board.cols - p.startIndex) }))
    .filter(p => p.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 포인터·레이아웃 산술 (DOM 측정값은 인자로 받는다)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 트랙 rect 안의 clientX → 셀 인덱스. pointerToCellIndex(3447-3451) 의 산술부.
 * getBoundingClientRect 호출은 input/hitTest.js 의 몫이다.
 * @see index.html:3449
 * @param {number} clientX
 * @param {{ left: number, width: number }} rect  트랙의 측정값
 * @param {number} cols
 * @returns {number}
 */
export function cellIndexFromRatio(clientX, rect, cols) {
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width - 1));
  return Math.max(0, Math.min(cols - 1, Math.floor(x / (rect.width / cols))));
}

/**
 * 모바일(<=720px) 셀 폭 계산. updateMobileCellSize(2255-2261) 의 산술부.
 * CSS 변수 쓰기(--cellW/--rowLabelW=48px/--cellH=40px)와 브레이크포인트 분기는 ui/layout.js 담당.
 * @see index.html:2255
 * @param {number} viewportWidth  뷰포트 폭 (innerWidth)
 * @param {number} cols           board.cols
 * @returns {number} cellW (px)
 */
export function computeCellWidth(viewportWidth, cols) {
  const appPadding = 10 * 2;
  const panelBorder = 2;
  const boardWrapPadding = 8 * 2;
  const rowGap = 6;
  const rowLabelW = 48;
  const available = viewportWidth - appPadding - panelBorder - boardWrapPadding - rowLabelW - rowGap;
  return Math.max(24, Math.floor(available / cols));
}
