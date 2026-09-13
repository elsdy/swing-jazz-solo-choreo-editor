// src/domain/clips.js — 클립 보관 경로의 규칙 (순수)
//
// 신설 파일이다. 업로드한 영상이 보관 폴더 아래 어디에 놓이는가를 여기서만 정한다:
//   <보관 폴더>/<subdir>/<프로젝트 이름>/<파일 이름>
// 어댑터(adapters/clipLibrary)는 이 함수가 준 조각을 그대로 디렉터리로 만들 뿐, 이름을 스스로 만들지 않는다.
//
// ⚠ 파일 시스템에 못 쓰는 글자(`/ \ : * ? " < > |` 와 제어 문자)는 `_` 로 바꾼다. 빈 조각은 대체 이름으로
//   떨어진다 — 폴더 이름이 빈 문자열이면 디렉터리를 만들 수 없다.

/** 프로젝트 이름이 없을 때 쓰는 폴더 이름. ports/clips.CLIP_UNFILED_DIR 과 같은 값이다(domain 은 ports 를 import 하지 않는다). */
const UNFILED = '_미지정';

/** 파일·폴더 이름에 못 쓰는 글자. */
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 경로 조각 하나를 파일 시스템에 쓸 수 있는 이름으로 만든다.
 * @param {unknown} raw
 * @param {string} [fallback=UNFILED] 비면 이 이름
 * @returns {string}
 */
export function safeSegment(raw, fallback = UNFILED) {
  const s = String(raw == null ? '' : raw).replace(BAD_CHARS, '_').trim().replace(/^\.+/, '');
  return s || fallback;
}

/**
 * 프로젝트 이름 → 폴더 이름. 확장자(.json)를 떼고 정리한다.
 * @param {unknown} projectName
 * @returns {string}
 */
export function projectDirName(projectName) {
  const base = String(projectName == null ? '' : projectName).replace(/\.[^.]+$/, '');
  return safeSegment(base, UNFILED);
}

/**
 * 클립이 놓일 디렉터리 조각. `[subdir, 프로젝트]` 두 단이다.
 * @param {string} subdir 설정의 하위 폴더 이름(비면 'video-clip')
 * @param {unknown} projectName
 * @returns {string[]}
 */
export function clipDirParts(subdir, projectName) {
  return [safeSegment(subdir, 'video-clip'), projectDirName(projectName)];
}

/**
 * 조각들을 '/' 로 잇는다. 프로젝트 파일에 저장되는 상대 경로의 유일한 표기다.
 * @param {string[]} dirParts
 * @param {string} fileName
 * @returns {string}
 */
export function joinClipPath(dirParts, fileName) {
  return [...dirParts, safeSegment(fileName, 'clip')].join('/');
}

/**
 * 저장된 상대 경로를 다시 조각으로 나눈다. 빈 조각·`..` 은 버린다(폴더 밖으로 나가지 않는다).
 * @param {unknown} path
 * @returns {string[]} 마지막 조각이 파일 이름이다. 비어 있으면 잘못된 경로
 */
export function splitClipPath(path) {
  return String(path == null ? '' : path).split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..');
}

/**
 * 같은 이름이 이미 있을 때 붙일 다음 이름. `a.mp4` → `a (2).mp4` → `a (3).mp4`.
 * @param {string} fileName
 * @param {number} n 2 부터
 * @returns {string}
 */
export function numberedName(fileName, n) {
  const m = /^(.*?)(\.[^.]*)?$/.exec(fileName) || [];
  const stem = m[1] || fileName;
  const ext = m[2] || '';
  return `${stem} (${n})${ext}`;
}

/**
 * 이미 보관된 클립 가운데 **지금 고른 파일과 같은 것**을 찾는다(2026-09-13).
 *
 * 왜 있나 — 같은 영상을 다시 열 때마다 서버가 ` (2)`, ` (3)` 을 붙여 새로 받아, 실측으로 한 폴더에
 * 754MB 중 530MB 가 같은 파일의 사본이었다. 폰에서는 100MB 를 5G 로 다시 올리는 값까지 든다.
 *
 * 판단 기준은 **이름과 바이트 크기**다. 내용을 해시하려면 100MB 를 다 읽어야 하는데, 그 값은
 * 다시 올리는 값과 크게 다르지 않다 — 같은 이름에 같은 바이트 수인 다른 영상은 실제로 거의 없다.
 * ⚠ 그래서 아주 드물게 틀릴 수 있다: 이름도 크기도 같고 내용만 다르면 **옛것을 쓴다.**
 *
 * 번호가 붙은 사본(`a (3).mp4`)도 같은 것으로 본다 — 이미 쌓인 사본을 하나 골라 쓰면 더 늘지 않는다.
 *
 * @param {{name?:string, size?:number, path?:string}[]} clips `GET /api/clips?project=` 가 준 목록
 * @param {{name:string, size:number}} file 지금 고른 파일
 * @returns {{name?:string, size?:number, path?:string}|null} 없으면 null
 */
export function findStoredClip(clips, file) {
  const name = String((file && file.name) || '');
  const size = Number(file && file.size);
  if (!name || !Number.isFinite(size) || size <= 0 || !Array.isArray(clips)) return null;

  const sameSize = clips.filter(c => Number(c && c.size) === size);
  if (!sameSize.length) return null;

  const exact = sameSize.find(c => String(c.name || '') === name);
  if (exact) return exact;

  // `a.mp4` 를 찾을 때 `a (2).mp4` 도 같은 것으로 본다. 확장자는 같아야 한다.
  const m = /^(.*?)(\.[^.]*)?$/.exec(name) || [];
  const stem = m[1] || name;
  const ext = m[2] || '';
  const numbered = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)${ext.replace(/\./g, '\\.')}$`);
  return sameSize.find(c => numbered.test(String(c.name || ''))) || null;
}
