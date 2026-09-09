// src/ports/storage.js — 영속 저장소의 계약. import 0개.
//
// 원본 index.html 의 localStorage 7키(4043·4054·4064·4196~4229·4640·5101)와
// downloadJson(4182-4192)·handle*Import 껍데기 4벌(4390·4409·4428·4454)의 계약면이다.
// 모든 저장소 계약이 Promise 를 반환한다 — 지금 동기로 못 박으면 IndexedDB 어댑터를 붙일 때
// 호출부를 전부 다시 써야 한다(설계 근거: spec-연습_버전 §5.2).

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 오늘 index.html 은 저장 실패를 삼킨다: setItem 14곳에 try/catch 가 하나도 없고
//   loadLocalMeta/loadLinks 의 catch 는 파싱 실패를 빈 배열로 조용히 덮는다.
//   이 포트는 그 실패를 "표현할 수 있게" 정의만 해 둔다. 어댑터가 실제로 던질지는 3단계에서 정한다 —
//   지금 던지게 만들면 동작이 바뀐다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 원본이 쓰는 localStorage 키 7개 + 2026-09-09 의 clipFolder. 문자열을 바꾸면 기존 사용자의 데이터가 통째로 사라지므로
 * 값은 절대 바꾸지 않는다(키 이름만 이 상수를 통해 부른다).
 * @see index.html:4043 choreo_saved_files
 * @see index.html:4054 choreo_saved_moves
 * @see index.html:4064 choreo_saved_categories
 * @see index.html:4228 choreo_fav_moves
 * @see index.html:4229 choreo_fav_cats
 * @see index.html:4640 choreo_fav_routines
 * @see index.html:5101 choreo_links
 */
export const STORAGE_KEYS = Object.freeze({
  savedFiles: 'choreo_saved_files',
  savedMoves: 'choreo_saved_moves',
  savedCategories: 'choreo_saved_categories',
  favMoves: 'choreo_fav_moves',
  favCategories: 'choreo_fav_cats',
  favRoutines: 'choreo_fav_routines',
  links: 'choreo_links',
  /** 2026-09-09 신설. 영상 보관 폴더 설정(표시 이름·하위 폴더). 폴더 핸들 자체는 IndexedDB 에 있다(adapters/clipLibrary). */
  clipFolder: 'choreo_clip_folder'
});

/**
 * StorageError.code 로 올 수 있는 값 전부.
 * QUOTA_EXCEEDED 쿼터 초과(choreo_saved_files 가 payload 10개를 품는 지금 가장 현실적인 실패) /
 * UNAVAILABLE  저장소 자체를 못 씀(사파리 프라이빗, 서드파티 쿠키 차단) /
 * CORRUPT      값은 있는데 JSON 이 깨졌거나 형식이 다름(오늘의 catch 가 삼키는 것) /
 * NOT_FOUND    키가 없음
 */
export const STORAGE_ERROR_CODES = Object.freeze(['QUOTA_EXCEEDED', 'UNAVAILABLE', 'CORRUPT', 'NOT_FOUND']);

/**
 * 모든 저장소 쓰기·읽기의 실패 계약. 지금 14곳에 흩어진 "try/catch 없음"을 어댑터 한 곳으로 모은다.
 */
export class StorageError extends Error {
  /**
   * @param {'QUOTA_EXCEEDED'|'UNAVAILABLE'|'CORRUPT'|'NOT_FOUND'} code
   * @param {string} message 한국어 문구는 여기 두지 않는다 — 뷰가 code 를 보고 고른다
   * @param {unknown} [cause] 원래 예외(DOMException 등)
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 키-값 저장소. localStorage 어댑터가 첫 구현이고, 값은 이미 파싱된 JS 값이다
 * (JSON.stringify/parse 는 어댑터 몫 — 오늘 setItem 14곳·getItem 7곳에 복제된 그 두 줄이 여기로 모인다).
 * @typedef {Object} KvStore
 * @property {(key: string) => Promise<unknown|null>} get 없으면 null. 파싱 실패는 StorageError('CORRUPT')
 * @property {(key: string, value: unknown) => Promise<void>} set 쿼터 초과는 StorageError('QUOTA_EXCEEDED')
 * @property {(key: string) => Promise<void>} remove 없는 키를 지워도 오류가 아니다
 * @property {() => Promise<string[]>} keys
 */

/**
 * 현재 보드와 최근 프로젝트 10개. 오늘은 choreo_saved_files 한 키에 payload 전체가 들어가지만
 * 다음 단계에서 IndexedDB 로 옮긴다(목록 렌더가 400KB 를 파싱하지 않게).
 * @typedef {Object} SnapshotStore
 * @property {() => Promise<{projectId: string, doc: unknown, savedAt: string}|null>} loadCurrent
 * @property {(projectId: string, doc: unknown) => Promise<void>} saveCurrent 오토세이브. 오늘은 없다(새로고침 = 작업 소실)
 * @property {() => Promise<{projectId: string, fileName: string, savedAt: string}[]>} listRecents
 *   ★ doc 을 포함하지 않는다. 목록 UI 가 payload 를 파싱하지 않게 하는 가장 중요한 시그니처 선택
 * @property {(projectId: string) => Promise<unknown|null>} getRecent 읽을 때 마이그레이션 통과를 보장한다
 * @property {(entry: unknown) => Promise<void>} putRecent 상한 10, projectId ?? fileName 으로 dedupe
 * @property {(projectId: string) => Promise<void>} deleteRecent
 */

/**
 * 파일 내려받기/읽기. 오늘 downloadJson(4182)과 FileReader 껍데기 4벌의 자리다.
 * @typedef {Object} FileGateway
 * @property {(payload: unknown, fileName: string) => Promise<void>} downloadJson
 *   ⚠ 오늘 saveProjectFile(4038)은 4041 에서 파일을 먼저 내려받고 4043 에서 localStorage 에 쓴다. 쿼터가 차면
 *   "저장은 됐는데 목록에 없음"이 되는데, 순서를 바꾸면 동작이 바뀐다 — 어댑터가 순서를 보존한다
 * @property {(file: unknown) => Promise<unknown>} readJsonFile
 *   파싱 실패는 StorageError('CORRUPT'). 오늘은 호출부마다 alert('올바른 프로젝트 파일이 아닙니다.')
 */

/**
 * 연습 버전 히스토리. meta 와 doc 을 나누는 이유는 목록을 그리려고 20×20KB 를 파싱하면 안 되기 때문.
 * meta 는 doc 에서 파생 가능한 데이터라 손상돼도 rebuildVersionMeta 로 복구된다.
 * @typedef {Object} VersionRepository
 * @property {(projectId: string) => Promise<unknown[]>} listVersions doc 미포함. createdAt 내림차순
 * @property {(projectId: string, versionId: string) => Promise<unknown|null>} getVersion
 * @property {(projectId: string, version: unknown) => Promise<void>} putVersion
 *   meta 는 구현이 version.doc 에서 파생 계산한다 — 호출자가 meta 를 만들지 않는다
 * @property {(projectId: string, versionId: string) => Promise<void>} deleteVersion
 *   자식 버전의 parentId 도, 로그의 versionId 도 손대지 않는다(dangling 허용)
 * @property {(projectId: string) => Promise<number>} rebuildVersionMeta 복구된 개수를 돌려준다
 */

/**
 * 연습 기록. 항목이 ~300B 라 통째로 돌려준다.
 * @typedef {Object} PracticeLogRepository
 * @property {(projectId: string, range?: {from?: string, to?: string}) => Promise<unknown[]>} listLogs at 오름차순
 * @property {(projectId: string, log: unknown) => Promise<void>} putLog
 * @property {(projectId: string, logId: string) => Promise<void>} deleteLog
 */
