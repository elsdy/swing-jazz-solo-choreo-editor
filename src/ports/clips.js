// src/ports/clips.js — 영상 보관 폴더(클립 라이브러리)의 계약. import 0개.
//
// 신설 파일이다. 업로드한 영상 파일을 사용자가 지정한 폴더 아래 `video-clip/<프로젝트>/<파일>` 로
// 복사해 두고, 다음에 열 때 같은 파일을 다시 고르지 않아도 되게 하는 것이 목적이다.
//
// ⚠ 이 앱에는 서버가 없다. 브라우저가 디스크에 쓸 수 있는 길은 File System Access API
//   (`showDirectoryPicker`)뿐이고, 그것도 사용자가 폴더를 직접 고른 뒤 그 **핸들**을 IndexedDB 에
//   남겨 두는 방식이다. 지원 브라우저는 크롬 계열뿐이다 — 그래서 `isSupported()` 가 계약의 첫 줄이고,
//   지원하지 않는 브라우저에서는 조용히 "없는 기능"이어야 한다(오류가 아니다).
// ⚠ 폴더 핸들에 대한 권한은 세션마다 다시 물을 수 있다. 사용자 제스처 안에서만 물을 수 있으므로
//   `ensurePermission(interactive)` 가 그 사실을 인자로 드러낸다.

/** 지정한 폴더 아래 클립을 모아 두는 하위 폴더의 기본 이름. 설정에서 바꿀 수 있다. */
export const DEFAULT_CLIP_SUBDIR = 'video-clip';

/** 프로젝트 이름이 아직 없을 때 클립이 들어가는 폴더. */
export const CLIP_UNFILED_DIR = '_미지정';

/**
 * localStorage 에 남기는 설정. 핸들은 여기 못 들어가므로(직렬화 불가) 표시용 이름만 둔다.
 * @typedef {Object} ClipFolderSetting
 * @property {string} folderName 사용자가 고른 폴더의 표시 이름. 비어 있으면 미지정
 * @property {string} subdir     폴더 아래 하위 폴더 이름(기본 video-clip)
 */

/**
 * @typedef {Object} ClipLibrary
 * @property {() => boolean} isSupported 이 브라우저가 폴더 지정을 지원하는가
 * @property {() => Promise<{name:string}|null>} getFolder 지정된 폴더(핸들이 남아 있으면). 없으면 null
 * @property {() => Promise<{name:string}|null>} pickFolder 폴더 선택 대화상자. 취소하면 null. ★ 사용자 제스처 안에서만
 * @property {() => Promise<void>} forgetFolder 지정 해제(핸들을 지운다. 디스크의 파일은 그대로다)
 * @property {(interactive: boolean) => Promise<boolean>} ensurePermission
 *   읽기·쓰기 권한이 있는가. interactive 가 참이면 없을 때 묻는다(제스처 필요), 거짓이면 조용히 확인만 한다
 * @property {(file: File, dirParts: string[], fileName: string) => Promise<{path:string}>} saveClip
 *   폴더 아래 dirParts 경로를 만들고 파일을 복사한다. 이름이 겹치면 `(2)` 를 붙인다. 돌려주는 path 는
 *   폴더 기준 상대 경로('/' 구분)다 — 이것이 프로젝트 파일에 저장된다
 * @property {(path: string) => Promise<File|null>} openClip path 의 파일. 없거나 권한이 없으면 null
 */
