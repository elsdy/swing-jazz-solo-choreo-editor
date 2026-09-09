// src/domain/project/normalize.js — 불러온 프로젝트 데이터의 정규화·클리핑 (순수)
//
// 원본 index.html 의 applyProjectData(4341-4387) 중 도메인부(4342-4386)를 옮겼다.
// 렌더 5종 · fileNameInput.value 대입 · applyLinksData · saveRoutineFavorites · saveHistory 는 여기 없다.
//
// ⚠ 진입 엄격도를 mergeProjectData 와 통합하지 않는다.
//    전체 불러오기는 moveLibrary 와 placements 가 **둘 다** 배열이어야 통과하고(4342),
//    부분 불러오기는 placements 만 본다(4069). 합치면 지금 병합으로 열리는 파일이 안 열린다.
//
// ⚠ 순서 의존을 시그니처로 못박았다. 원본은 state.categories 를 먼저 갈아끼운 뒤
//    normalizeMoveList 와 fallback 이 그 **새** categories 를 전역으로 읽었다(4345 → 4347 → 4348).
//    여기서는 categories 를 인자로 흘려보내 그 순서가 코드에 드러나게 했다.

import { normalize as normalizeCategories } from '../categories.js';
import { normalizeLibrary } from '../moves.js';
import { normalizeRoutine } from '../routines.js';
import { normalizeMedia } from './media.js';

/** ids 는 함수(`()=>string`)와 `{uid}` 객체를 모두 받는다 — domain/placements.js 와 같은 규약. */
function uidOf(ids) {
  return typeof ids === 'function' ? ids : ids.uid;
}

/**
 * 파일에서 읽은 배치 배열을 보드 크기에 맞춰 정규화·클리핑한다.
 *
 * ⚠ 키 순서가 makeSegmentPlacements 와 다르다: 여기서는 type/routineId 가 **맨 뒤**다(원본 4359-4360).
 *    makeSegmentPlacements 는 category 다음에 넣는다. 두 순서를 통일하면 저장 JSON 바이트가 달라진다.
 * ⚠ merge 쪽(mergePlacements)과 클리핑 순서가 다르다: 여기는 filter → length 클립,
 *    merge 는 length 클립 → filter 이고 merge 에만 `length > 0` 조건이 있다(4136 vs 4361).
 *    그래서 startIndex 가 cols 경계에 걸린 배치의 생존 여부가 두 경로에서 다르다 — 원본 그대로 둔다.
 *
 * @see index.html:4349
 * @param {any[]} rawPlacements
 * @param {{rows:number, cols:number}} board  ⚠ rows 는 마지막 행 인덱스다(행 개수 아님)
 * @param {Object<string,{label:string,color:string}>} categories  이미 정규화된 카테고리 사전
 * @param {(()=>string)|{uid:()=>string}} ids
 * @returns {import('./schema.js').Placement[]}
 */
export function normalizePlacements(rawPlacements, board, categories, ids) {
  const uid = uidOf(ids);
  const fallback = Object.keys(categories)[0];
  return (Array.isArray(rawPlacements) ? rawPlacements : []).filter(p => p && p.name).map(p => ({
    id: p.id || uid(),
    groupId: p.groupId || uid(),
    name: String(p.name),
    category: categories[p.category] ? p.category : fallback,
    row: Math.max(0, p.row != null ? Number(p.row) : 1),
    startIndex: Math.max(0, Number(p.startIndex) || 0),
    length: Math.max(1, Number(p.length) || 1),
    subRow: Number(p.subRow) || 0,
    // 루틴 배치 필드 보존
    ...(p.type ? { type: p.type } : {}),
    ...(p.routineId ? { routineId: p.routineId } : {})
  })).filter(p => p.row >= 0 && p.row <= board.rows && p.startIndex < board.cols)
     .map(p => ({ ...p, length: Math.min(p.length, board.cols - p.startIndex) }));
}

/**
 * 전체 불러오기용 정규화. applyProjectData(4342-4386)의 도메인부 전부.
 *
 * 반환값을 그대로 상태에 대입하면 원본과 같다. **null 을 돌려주면 원본의 경고 경로**다
 * (원본 4342 는 그 자리에서 '잘못된 프로젝트 파일 형식입니다.' 경고 팝업을 띄우고 undefined 를 돌려준다).
 * 경고 문구는 여기서 만들지 않는다 — 유스케이스의 몫이다.
 *
 * 실행 순서는 원본과 같다: rows/cols → categories → moveLibrary(새 categories 기준) →
 * placements(새 categories 기준) → routines → fileName.
 * uid() 소비 순서도 같으므로 결정적 env 아래에서 id 가 원본과 일치한다.
 *
 * ⚠ media 는 여기서 다룬다(2026-09 신설). 원본에 대응물이 없어 "오늘 동작 보존" 제약이 없고,
 *    링크와 달리 브라우저 저장소를 건드리지 않기 때문이다 — 순수 정규화 한 줄로 끝난다.
 * ⚠ 링크는 여기서 다루지 않는다. 원본은 applyLinksData(data)(4380)로 별도 처리하며
 *    그 안에서 브라우저 저장소까지 건드린다 — domain/links.js 와 유스케이스의 몫이다.
 * ⚠ routines 가 배열이 아니면 routines=[] 이고 favoriteRoutineIds 도 비운다(4376-4379).
 *    원본은 두 갈래 모두에서 saveRoutineFavorites() 를 부르므로 호출부가 항상 저장해야 한다.
 *
 * @see index.html:4341
 * @param {any} data
 * @param {{ ids: (()=>string)|{uid:()=>string}, defaultCategories?: Object }} deps
 * @returns {{ rows:number, cols:number, categories:Object,
 *             moveLibrary:{id:string,name:string,category:string}[],
 *             placements: import('./schema.js').Placement[],
 *             routines: import('./schema.js').Routine[],
 *             favoriteRoutineIds: Set<string>, media: import('./schema.js').MediaBlock,
 *             fileName: string } | null}
 */
export function normalizeProject(data, deps) {
  const { ids, defaultCategories = {} } = deps;
  if (!data || !Array.isArray(data.moveLibrary) || !Array.isArray(data.placements)) return null;

  const rows = Math.max(1, Number(data.rows) || 8);
  const cols = Math.max(1, Number(data.cols) || 8);
  const categories = normalizeCategories(data.categories || defaultCategories);
  const moveLibrary = normalizeLibrary(data.moveLibrary, categories, ids);
  const placements = normalizePlacements(data.placements, { rows, cols }, categories, ids);

  let routines;
  let favoriteRoutineIds;
  if (Array.isArray(data.routines)) {
    routines = data.routines.map(r => normalizeRoutine(r, ids));
    // favoriteRoutineIds 를 isFavorite 값 기준으로 재구성 (원본 4372)
    favoriteRoutineIds = new Set(routines.filter(r => r.isFavorite).map(r => r.id));
  } else {
    routines = [];
    favoriteRoutineIds = new Set();
  }

  // media 는 신설 필드다(2026-09). **없는 옛 파일이 지금과 똑같이 열려야 하므로** 여기서 거부하지 않고
  // DEFAULT_MEDIA(bpm 0 = 미설정)로 떨어뜨린다. 그 값은 isEmptyMedia 가 참이라 다시 저장할 때
  // 파일에서 키째로 빠진다 — 열었다 저장하는 왕복이 바이트를 늘리지 않는다.
  const media = normalizeMedia(data.media);

  return { rows, cols, categories, moveLibrary, placements, routines, favoriteRoutineIds, media, fileName: data.fileName || '' };
}
