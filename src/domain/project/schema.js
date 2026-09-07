// src/domain/project/schema.js — 프로젝트 파일 스키마의 상수와 타입 정의 (로직 없음, import 0개)
//
// 오늘 index.html 은 "상태"를 네 군데에서 서로 다르게 정의한다:
// snapshotState(2833) 6필드 · projectPayloadWithRoutines(5273) 12필드 · restoreSnapshot(2845)의 기본값 ·
// mergeProjectData(4068)의 암묵 shape. 이 파일은 그 넷을 ChoreoDoc 한 타입 위로 모은다.
// 파일은 여전히 version 1 로 쓴다(LEGACY_FILE_VERSION).
//
// ⚠ 2026-09 변경: UNDO_FIELDS 에 links 를 더해 **undo 스냅샷과 파일 포맷의 필드 집합이 같아졌다**.
//   그 전에는 undo 6필드 / 파일 12필드로 "상태의 정의"가 갈려 있었고, 그 틈에서
//   `전체 초기화` 가 지운 링크가 Undo 로 돌아오지 않는 결함이 나왔다(docs/PRINCIPLES.md D-4).

// ─────────────────────────────────────────────────────────────────────────────
// 버전
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 앱이 읽을 수 있는 최신 스키마 버전. migrations.js 만이 이 값을 소비한다.
 * ⚠ 이 값이 2 라고 해서 파일을 2 로 쓰지는 않는다 — serialize.js 는 오늘과 똑같이
 * LEGACY_FILE_VERSION(=1) 을 쓴다. 쓰기 포맷을 바꾸면 저장 파일 바이트가 달라져 동작 변경이 된다.
 */
export const SCHEMA_VERSION = 2;

/**
 * 오늘 projectPayloadWithRoutines(5275) · saveMoveListFile(4051) · saveCategoriesFile(4061) 이
 * 파일에 박는 `version` 값. 읽는 코드는 원본 어디에도 없었다(grep ".version" 0 hits).
 * @see index.html:5275
 */
export const LEGACY_FILE_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// 필드 목록 — 키 순서가 곧 JSON 바이트 순서다. 순서를 바꾸면 undo 중복 판정과 파일이 달라진다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * undo/redo 스냅샷에 들어가는 필드. 앞 6개는 snapshotState(2833-2841)의 리터럴 키 순서 그대로고,
 * `links` 는 **맨 뒤에** 더했다(DOC_FIELDS 도 links 가 맨 뒤다 — 두 목록의 꼬리를 맞춘다).
 *
 * ⚠ links 를 더한 이유: `전체 초기화`(clearBoard 4481-4492)가 링크 4필드를 비우고 즉시
 *   localStorage 에 쓰는데 링크가 스냅샷 밖이라 Undo 로 돌아오지 않았다. 지우는 동작(PR #17)은
 *   그대로 두고 "되돌릴 수 없다"만 없앤 것이다. 링크가 프로젝트 파일에는 원래 들어 있으므로
 *   이 변경은 undo 스냅샷을 파일 포맷 쪽으로 맞추는 방향이기도 하다.
 * ⚠ 키 순서를 바꾸면 스냅샷 문자열이 달라져 중복 판정(saveHistory 2864)이 흔들린다.
 * ⚠ 스냅샷에 실리는 links 는 **값 복제**여야 한다(중첩 customLinks 배열 공유 금지) —
 *   snapshot.js 의 pickUndoFields 가 그 책임을 진다.
 * @see index.html:2833
 */
export const UNDO_FIELDS = Object.freeze(['rows', 'cols', 'placements', 'moveLibrary', 'categories', 'routines', 'links']);

/**
 * 루틴 편집기 undo 스냅샷 필드. snapshotStateRe(2900-2902)의 리터럴 키 순서 그대로다.
 * 루틴 이름·색은 스냅샷에 없다(그래서 루틴 편집기 undo 로는 이름이 되돌아오지 않는다).
 * ⚠ 여기에는 links 를 더하지 않는다 — 루틴 보드에는 링크바가 아예 없다.
 * @see index.html:2900
 */
export const ROUTINE_UNDO_FIELDS = Object.freeze(['rows', 'cols', 'placements']);

/**
 * ChoreoDoc 의 필드. 파일 본문 = 버전 스냅샷 = undo 스냅샷이 공유하는 단일 타입.
 * ⚠ 이제 DOC_FIELDS 와 UNDO_FIELDS 는 **같은 집합**이다(순서만 다르다 — 각자 원본 리터럴 순서를
 *   지킨다). 한쪽에 필드를 더할 때 다른 쪽을 함께 보라: 파일에만 있으면 Undo 로 안 돌아오고,
 *   스냅샷에만 있으면 저장·불러오기에서 새어 나간다.
 */
export const DOC_FIELDS = Object.freeze(['rows', 'cols', 'categories', 'moveLibrary', 'placements', 'routines', 'links']);

/**
 * v1 프로젝트 파일이 최상위에 평평하게 들고 있는 링크 4필드.
 * migrations.js 가 doc.links 로 중첩하면서도 이 4필드를 미러로 남길 때 쓴다.
 * @see index.html:5283
 */
export const LINK_FIELDS = Object.freeze(['youtubeUrl', 'youtubeTitle', 'clickupUrl', 'customLinks']);

// ─────────────────────────────────────────────────────────────────────────────
// 타입 — 전부 JSDoc typedef. 런타임 코드 없음.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배치 한 조각. 키 순서가 makeSegmentPlacements(domain/placements.js)에 의해 고정된다.
 * ⚠ 저장 파일에서 되읽을 때는 normalize.js 의 순서(type/routineId 가 맨 뒤)를 쓴다 — 두 순서가 다르다.
 * @typedef {Object} Placement
 * @property {string} id
 * @property {string} groupId
 * @property {string} name
 * @property {string} category   ⚠ 루틴 배치는 'routine' 인데 이 키는 categories 에 절대 등록되지 않는다
 * @property {number} row
 * @property {number} startIndex
 * @property {number} length
 * @property {number} [subRow]   ⚠ syncCurrentRoutine(4665)이 만드는 배치에는 이 키가 아예 없다
 * @property {'routine'} [type]
 * @property {string} [routineId]
 */

/**
 * @typedef {Object} Routine
 * @property {string} id
 * @property {string} name
 * @property {number} rows
 * @property {number} cols
 * @property {Placement[]} placements
 * @property {string} color
 * @property {boolean} isFavorite
 */

/**
 * @typedef {Object} LinkBundle
 * @property {string} youtubeUrl
 * @property {string} youtubeTitle
 * @property {string} clickupUrl
 * @property {{id:string,label:string,url:string}[]} customLinks
 */

/**
 * 편집 대상 상태 전부. 파일 본문 · 버전 스냅샷 · undo 스냅샷 · (장차) 오토세이브가 공유한다.
 * ⚠ rows 는 "마지막 행 인덱스"이지 행 개수가 아니다 — domain/grid.js 상단 경고 참조.
 * @typedef {Object} ChoreoDoc
 * @property {number} rows
 * @property {number} cols
 * @property {Object<string,{label:string,color:string}>} categories
 * @property {{id:string,name:string,category:string}[]} moveLibrary
 * @property {Placement[]} placements
 * @property {Routine[]} routines
 * @property {LinkBundle} links
 */

/**
 * 프로젝트 파일 최상위. v1 은 doc 없이 필드가 전부 평평하게 놓여 있다.
 * @typedef {Object} ProjectFile
 * @property {number} version
 * @property {string} [projectId]        v2 신설. v1 파일은 `v1:${fileName}` 로 결정론적 부여
 * @property {string} fileName
 * @property {string} savedAt            ISO. ⚠ 오늘 state 로 복원되지 않고 최근목록 메타로만 쓰인다
 * @property {ChoreoDoc} [doc]           v2. v1 은 rows/cols/... 가 최상위에 평평하다
 * @property {ChoreoVersion[]} [versions]      v2 신설. 이번 PR 에서는 항상 []
 * @property {PracticeLog[]} [practiceLogs]    v2 신설. 이번 PR 에서는 항상 []
 * @property {MediaRef[]} [media]              v2 신설. 이번 PR 에서는 항상 []
 */

/**
 * 안무 버전 스냅샷. 이번 PR 에서는 자리만 정의하고 아무도 만들지 않는다.
 * @typedef {Object} ChoreoVersion
 * @property {string} id
 * @property {string} projectId
 * @property {string|null} parentId
 * @property {string} createdAt
 * @property {string} label
 * @property {string} note
 * @property {ChoreoDoc} doc
 * @property {MediaRef|null} reference
 */

/**
 * 연습 기록. ChoreoVersion 과는 다른 축이며 의존은 versionId → version.id 한 방향뿐이다.
 * 이번 PR 에서는 자리만 정의한다.
 * @typedef {Object} PracticeLog
 * @property {string} id
 * @property {string} projectId
 * @property {string} versionId
 * @property {string} at
 * @property {{from:CountRef,to:CountRef}|null} scope
 * @property {number|null} bpm
 * @property {number|null} rating
 * @property {number|null} attempts
 * @property {number|null} cleanRuns
 * @property {{from:CountRef,to:CountRef,note?:string}[]} troubleSpots
 * @property {MediaRef|null} media
 * @property {string} note
 */

/**
 * 카운트 좌표. cols 에 의존하지 않는 구조적 좌표라 보드 크기가 바뀌어도 읽을 수 있다.
 * row 0 = intro 행.
 * @typedef {Object} CountRef
 * @property {number} row
 * @property {number} index
 */

/**
 * 영상 참조. 버전(기준 영상)에도 로그(오늘 찍은 영상)에도 붙으므로 둘 중 누구의 소유도 아니다.
 * @typedef {Object} MediaRef
 * @property {'youtube'|'file'|'url'} kind
 * @property {string} src
 * @property {number} [startSec]
 * @property {number} [endSec]
 * @property {{anchors:{atSec:number,row:number,index:number}[],bpm?:number,countsPerBar?:number}} [countMap]
 */
