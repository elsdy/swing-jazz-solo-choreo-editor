// src/ports/storage.js — 영속 저장소의 계약. import 0개.
//
// 원본 index.html 의 localStorage 7키(4043·4054·4064·4196~4229·4640·5101)와
// downloadJson(4182-4192)·handle*Import 껍데기 4벌(4390·4409·4428·4454)의 계약면이다.
// 모든 저장소 계약이 Promise 를 반환한다 — 지금 동기로 못 박으면 IndexedDB 어댑터를 붙일 때
// 호출부를 전부 다시 써야 한다(설계 근거: spec-연습_버전 §5.2).

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 오늘 index.html 은 저장 실패를 삼킨다: setItem 14곳에 try/catch 가 하나도 없고
//   loadLocalMeta/loadLinks 의 catch 는 파싱 실패를 빈 배열로 조용히 덮는다.
//   이 포트는 그 실패를 "표현할 수 있게" 정의만 해 뒀었다 — 2026-11-02(RM-33)부터 SnapshotStore 는
//   adapters/idbSnapshots 가 실제로 채우고, 쓰기 실패를 StorageError 로 **거부한다**(아래 계약).
//   KvStore(작은 설정 — 테마 · 단축키 · 즐겨찾기 · 동작/카테고리 최근 목록)는 여전히 localStorage 위의 동기
//   구현(adapters/localStore.localKv)이고 아무도 StorageError 를 던지지 않는다 — 부팅 때 동기로 읽혀야 첫 화면이 깜빡이지 않는다.
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
  clipFolder: 'choreo_clip_folder',
  /**
   * 2026-09-20 신설. 사용자가 바꾼 단축키만 담는다(`{id: keys[]}`).
   * ⚠ 기본값과 같은 것은 안 담는다(domain/hotkeys.toSaved) — 손대지 않은 사람에게는 키 자체가 안 생긴다.
   * ⚠ 안무표가 아니라 **이 브라우저의 취향**이라 프로젝트 파일에 들어가지 않는다.
   */
  hotkeys: 'choreo_hotkeys',
  /**
   * 2026-09-21 신설. "어떤 버튼 다음에 어떤 버튼"의 횟수표(`{from: {to: n}}`).
   * ⚠ 안무표가 아니라 **이 브라우저의 버릇**이라 프로젝트 파일에 들어가지 않는다.
   * ⚠ 이 표로 화면을 움직이지 않는다 — `다음` 표식 하나를 어디에 붙일지만 정한다(domain/flowStats).
   */
  flowStats: 'choreo_flow_stats',
  /**
   * 2026-09-21 신설. 고른 화면 테마 id(domain/themes).
   * ⚠ 이 브라우저의 취향이라 안무표 파일에 들어가지 않는다(단축키와 같은 규약).
   */
  theme: 'choreo_theme',
  /**
   * 2026-11-02 신설(RM-19). 「처음 한 번」 안내를 본 단계의 열쇠 목록(`string[]`).
   * ⚠ 안무표가 아니라 **이 브라우저의 기억**이라 프로젝트 파일에 들어가지 않는다(단축키 · 테마와 같은 규약).
   *   `설정` 의 `처음 한 번 안내 다시 보기` 가 비운다.
   */
  onceHints: 'choreo_once_hints',
  /**
   * 2026-11-02 신설(RM-26). 처음 한 번 안내(코치마크)를 끝까지 봤거나 건너뛰었다는 표시 하나.
   * ⚠ 이 브라우저의 것이라 안무표 파일에 들어가지 않는다. ⚙ 설정의 「안내 다시 보기」가 지운다.
   */
  coachSeen: 'choreo_coach_seen',
  /**
   * 2026-11-02 신설(RM-27). 「이 환경에서 안 되는 것」 알림 — 끔/켬과 마지막으로 알린 환경 지문(`{enabled, seen}`).
   * ⚠ 환경이 바뀐 때만 다시 알리려고 지문을 남긴다. 이 브라우저의 것이라 안무표 파일에 들어가지 않는다.
   */
  supportNotice: 'choreo_support_notice'
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
 * 작업 문서 한 벌과 최근 프로젝트 10개 — **서버 없이 연 앱**이 브라우저 안에 담는 자리.
 * 2026-11-02(RM-33)부터 adapters/idbSnapshots 가 IndexedDB 세 칸(목록 · 내용 · 작업 문서)으로 채운다.
 * 그전에는 choreo_saved_files 한 키에 payload 10개가 통째로 들어가 쿼터가 차면 조용히 실패했다.
 * IndexedDB 가 없거나 못 열면 같은 계약이 옛 두 키(choreo_saved_files · choreo_draft) 위에서 돈다.
 *
 * ⚠ 키는 **fileName** 이다(원본의 dedupe 키 그대로). projectId 는 쓰지 않는다 — 안무표 파일에 그런 것이 없다.
 * ⚠ 실패 계약 — 읽기는 던지지 않는다(빈 배열 · null). 목록 쓰기(putRecent · deleteRecent · saveRecents)는
 *   StorageError(QUOTA_EXCEEDED · UNAVAILABLE)로 **거부**하고, 호출부(app/main 의 storage 다리)가 받아 알린다.
 *   saveCurrent 만은 false 로 알린다 — 자동 담기는 편집을 멈추면 안 된다(adapters/draftStore 의 규약).
 * @typedef {Object} SnapshotStore
 * @property {() => Promise<{projectId: string, doc: unknown, savedAt: string}|null>} loadCurrent 작업 문서(1.2초마다 담기는 것)
 * @property {(projectId: string, doc: unknown) => Promise<boolean>} saveCurrent 실패는 false — 던지지 않는다
 * @property {() => Promise<{fileName: string, savedAt: string}[]>} listRecents
 *   ★ doc 을 포함하지 않는다. 목록 UI 가 payload 를 파싱하지 않게 하는 가장 중요한 시그니처 선택. 순서는 넣은 차례(새것이 앞)
 * @property {(fileName: string) => Promise<unknown|null>} getRecent 이름으로 내용 하나. 날것을 준다 —
 *   마이그레이션은 usecases/projectCommands.readProjectData 가 **한 번** 태운다(이중 변환 없음)
 * @property {(entry: {fileName: string, savedAt: string, data: unknown}) => Promise<string[]>} putRecent 맨 앞에 넣고 fileName 으로 dedupe, 상한 10. 남은 이름들을 준다
 * @property {(list: {fileName: string, savedAt: string, data?: unknown}[]) => Promise<string[]>} saveRecents
 *   목록 한 벌을 그대로 맞춘다(usecases 가 `saveRecents(kind, list)` 로 넘기는 모양). 내용 없는 **새** 이름(보관 폴더에서 온 줄)은 건너뛰고,
 *   목록에서 빠진 이름은 내용까지 지운다
 * @property {(fileName: string) => Promise<void>} deleteRecent
 */

/**
 * 파일 내려받기/읽기. 오늘 downloadJson(4182)과 FileReader 껍데기 4벌의 자리다.
 * @typedef {Object} FileGateway
 * @property {(payload: unknown, fileName: string) => Promise<void>} downloadJson
 *   ⚠ 오늘 saveProjectFile(4038)은 4041 에서 파일을 먼저 내려받고 4043 에서 localStorage 에 쓴다. 쿼터가 차면
 *   "저장은 됐는데 목록에 없음"이 되는데, 순서를 바꾸면 동작이 바뀐다 — 어댑터가 순서를 보존한다
 * @property {(file: unknown) => Promise<unknown>} readJsonFile
 *   파싱 실패는 StorageError('CORRUPT'). 오늘은 호출부마다 alert('올바른 프로젝트 파일이 아닙니다.')
 * @property {(text: string, fileName: string, mime?: string) => void} downloadText
 *   2026-11-02 신설(RM-21). 글자 그대로를 파일로 내려받는다 — 텍스트 시트 · 읽기 전용 HTML. downloadJson 과 같은 꼴(a 클릭 · 즉시 revoke)이다
 * @property {(text: string) => Promise<boolean>} copyText
 *   2026-11-02 신설(RM-21). 클립보드에 담는다. 담지 못하면 던지지 않고 false — 유스케이스가 알림으로 바꾼다
 * @property {() => void} print
 *   2026-11-02 신설(RM-21). 브라우저 인쇄 창을 연다(index.html 의 @media print 가 편집 도구를 숨긴다)
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
