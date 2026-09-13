// src/domain/project/media.js — 프로젝트의 영상 블록(`media`) 정규화·직렬화 (순수)
//
// 신설 파일이다. 원본 index.html 에 대응물이 없다 — 오늘 영상은 링크바의 URL 문자열 하나뿐이고
// 템포라는 개념이 아예 없었다. 이 파일은 그 둘을 `{ tempo, source }` 한 블록으로 묶는다.
//
// 왜 schema.js 가 아니라 여기인가: schema.js 는 "로직 없음, import 0개" 리프다(파일 상단 계약).
// 여기서는 domain/tempo.js 의 normalizeTempo 를 써야 하므로 로직을 이 파일로 뺀다.
// 키 목록(MEDIA_FIELDS)만 schema.js 가 소유한다 — 필드 목록은 언제나 schema.js 한 곳이다.
//
// ⚠ 저장 바이트 규칙: **비어 있는 media 는 파일에 쓰지 않는다.** serializeMedia 가 null 을
//   돌려주고 serialize.buildProjectFile 이 그 키를 통째로 뺀다. 템포를 한 번도 안 정한
//   사용자의 저장 파일은 이 기능이 들어오기 전과 **바이트 단위로 같아야** 하기 때문이다.
//
// ⚠ 영상은 지금 **프로젝트 공통**이다(버전별로 나누지 않는다). 나눌 때가 오면 이 블록이
//   통째로 ChoreoVersion.reference 옆으로 내려가고, 프로젝트 최상위에는 "기본 영상"만 남는다.
//   그때 바뀌는 것은 blob 의 위치뿐이고 이 파일의 함수는 그대로 쓴다 — 그래서 tempo·source 를
//   state 에 평평하게 풀지 않고 블록 하나로 묶어 두는 것이다.

import { DEFAULT_TEMPO, normalizeTempo } from '../tempo.js';
import { normalizeMarkers } from '../markers.js';
import { CLIP_FIELDS, MEDIA_FIELDS } from './schema.js';

/** 아직 영상이 하나도 없는 블록. 이 값이면 파일에 media 키가 통째로 빠진다(serializeMedia). */
export const DEFAULT_MEDIA = Object.freeze({ activeId: '', clips: Object.freeze([]) });

/** 영상이 하나도 없을 때 뷰·커맨드가 읽는 빈 클립. 옛 DEFAULT_MEDIA 와 모양이 같다(읽는 쪽이 안 바뀐다). */
export const EMPTY_CLIP = Object.freeze({
  id: '', name: '', source: null, tempo: DEFAULT_TEMPO, markers: Object.freeze([])
});

/**
 * 지금 지원하는 소스 종류.
 * `youtube` 는 url 로, `file` 은 **파일명만으로** 저장된다 — 브라우저는 파일 경로를 기억할 수 없고
 * blob URL 은 다음 실행에서 죽으므로, 파일은 "다음에 같은 이름의 파일을 다시 골라 달라"는 힌트만 남긴다.
 */
export const MEDIA_SOURCE_KINDS = Object.freeze(['youtube', 'file']);

/**
 * 소스 참조를 정규화한다. 모르는 kind·빈 url/name 은 **소스 없음(null)** 이다.
 *
 * ⚠ url 은 사용자가 링크바에 넣은 문자열 그대로다. 여기서 normalizeYoutubeUrl 을 돌리지 않는다 —
 *   링크바의 `youtubeUrl` 과 글자가 달라지면 "같은 곡인데 두 값"이 되고, videoId 추출은
 *   adapters/media/pickPlayer.js 가 domain/links.parseYoutubeUrl 로 한 곳에서만 한다.
 * ⚠ 파일 소스에는 url 이 **없다**. blob URL 이 들어와도 버린다 — 저장 파일에 죽은 주소가 남으면 안 된다.
 *   대신 보관 폴더에 복사해 둔 파일은 `path`(폴더 기준 상대 경로)를 갖고, 다음에 열 때 그 경로로 다시 읽는다.
 * @param {unknown} raw
 * @returns {import('./schema.js').MediaSourceRef|null}
 */
export function normalizeMediaSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!MEDIA_SOURCE_KINDS.includes(kind)) return null;
  if (kind === 'file') {
    const name = raw.name == null ? '' : String(raw.name).trim();
    if (!name) return null;
    // path 는 보관 폴더 기준 상대 경로(video-clip/<프로젝트>/<파일>). 보관 폴더에 복사한 파일만 갖는다.
    const path = raw.path == null ? '' : String(raw.path).trim();
    return path ? { kind, name, path } : { kind, name };
  }
  const url = raw.url == null ? '' : String(raw.url);
  if (!url) return null;
  return { kind, url };
}

// ─────────────────────────────────────────────────────────────────────────────
// 영상 하나(클립)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 소스에서 결정론적으로 만드는 클립 id. 난수를 쓰지 않는 이유는 둘이다 —
 * 도메인이 난수를 못 쓰기도 하고, **같은 영상을 두 번 더해도 하나여야** 하기 때문이다.
 * 같은 파일을 다시 고르면 그때 찍어 둔 마커가 그대로 붙은 클립으로 돌아간다.
 *
 * ⚠ 파일은 보관 경로(path)가 있으면 그것으로, 없으면 파일 이름으로 만든다. 보관 폴더에 복사하면
 *   id 가 바뀌는데(이름 → 경로), 그 순간은 클립이 하나뿐이므로 setSource 쪽에서 이어 붙인다.
 * @param {import('./schema.js').MediaSourceRef|null} source
 * @returns {string} 소스가 없으면 빈 문자열
 */
export function clipIdOf(source) {
  const src = normalizeMediaSource(source);
  if (!src) return '';
  return src.kind === 'file' ? `file:${src.path || src.name}` : `yt:${src.url}`;
}

/**
 * 소스가 아직 없는 클립의 id. 유튜브 주소도 파일도 고르기 전에 박자부터 찍는 흐름이 있어서
 * (링크바에 주소를 넣기 전, 또는 탭 템포로 bpm 만 먼저) 자리 하나를 비워 둔다.
 * ⚠ 한 번에 하나뿐이다 — 소스가 붙는 순간 clipIdOf 로 id 가 바뀌고(setMedia) 이 자리는 다시 빈다.
 */
export const SOURCELESS_CLIP_ID = 'clip:-';

/** 이 클립에 사람이 찍어 둔 것이 있는가(소스 없이도 살려 둘 값인가). */
function clipHasContent(tempo, markers) {
  if (markers.length > 0) return true;
  return tempo.bpm !== DEFAULT_TEMPO.bpm
    || tempo.beatsPerCount !== DEFAULT_TEMPO.beatsPerCount
    || tempo.anchorSec !== DEFAULT_TEMPO.anchorSec
    || tempo.anchorCount !== DEFAULT_TEMPO.anchorCount
    || (Array.isArray(tempo.points) && tempo.points.length > 0);
}

/**
 * 이름을 안 붙였을 때의 기본 이름. **파일 이름을 그대로 쓰지 않는다** — 올라오는 파일 이름은
 * `IMG_4821.MOV` 처럼 제각각이라 목록에서 서로 구분되지 않는다. 순번으로 일관되게 붙이고,
 * 원래 파일 이름은 목록에 따로 보여 준다.
 * @param {number} index 0부터
 * @returns {string}
 */
export function defaultClipName(index) {
  return `테이크 ${Math.max(1, Math.floor(index) + 1)}`;
}

/**
 * 손상된 입력 → MediaClip. 소스가 없고 이름도 없고 찍은 것도 없으면 **null**(목록에서 뺀다).
 * @param {unknown} raw
 * @param {number} index 기본 이름에 쓸 순번
 * @returns {import('./schema.js').MediaClip|null}
 */
export function normalizeClip(raw, index = 0) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const source = normalizeMediaSource(src.source);
  const tempo = normalizeTempo(src.tempo);
  const markers = normalizeMarkers(src.markers);
  const given = src.id == null ? '' : String(src.id);
  const id = given || clipIdOf(source) || (clipHasContent(tempo, markers) ? SOURCELESS_CLIP_ID : '');
  if (!id) return null;                       // 소스도 없고 찍어 둔 것도 없는 조각은 영상이 아니다
  const name = src.name == null || String(src.name).trim() === ''
    ? defaultClipName(index)
    : String(src.name).trim();
  return { id, name, source, tempo, markers };
}

/**
 * 클립 배열 정규화. 같은 id 는 **앞엣것이 이긴다**(먼저 찍어 둔 것을 지키는 쪽).
 * @param {unknown} raw
 * @returns {import('./schema.js').MediaClip[]}
 */
export function normalizeClips(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const clip = normalizeClip(item, out.length);
    if (!clip || seen.has(clip.id)) continue;
    seen.add(clip.id);
    out.push(clip);
  }
  return out;
}

/**
 * 지금 보고 있는 영상. 없으면 EMPTY_CLIP — **옛 MediaBlock 과 모양이 같아서** 읽는 쪽
 * (videoCommands.mediaState 를 거치는 모든 코드)이 그대로 돈다.
 * @param {import('./schema.js').MediaBlock} media
 * @returns {import('./schema.js').MediaClip}
 */
export function activeClipOf(media) {
  const m = normalizeMedia(media);
  if (!m.clips.length) return EMPTY_CLIP;
  return m.clips.find(c => c.id === m.activeId) || m.clips[0];
}

/**
 * 이 영상이 안무표의 어디를 덮는가. 마커가 덮는 카운트 구간이다.
 *
 * ⚠ 마커가 없으면 **null** 이다 — "덮지 않는다"가 아니라 "아직 모른다"다. 영상을 올리기만 하고
 *   마커를 안 찍었을 뿐일 수 있으므로, 뷰는 0% 막대가 아니라 "마커 없음"으로 말해야 한다.
 * @param {import('./schema.js').MediaClip} clip
 * @returns {{fromCount:number, toCount:number, markers:number}|null}
 */
export function clipCoverage(clip) {
  const markers = (clip && Array.isArray(clip.markers)) ? clip.markers : [];
  if (!markers.length) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const m of markers) {
    if (m.fromCount < from) from = m.fromCount;
    if (m.toCount > to) to = m.toCount;
  }
  return { fromCount: from, toCount: to, markers: markers.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 블록
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 손상된 입력 → MediaBlock. **언제나 두 필드를 채운 새 객체**를 돌려준다.
 *
 * ⚠ 옛 모양(`{tempo, source, markers}` 이 media 바로 아래 평평하게)을 여기서 받는다 — 클립 하나로
 *   감싸고 이름은 `테이크 1` 이 된다. 2026-09-12 이전에 저장한 파일이 전부 이 모양이다.
 * ⚠ media 가 아예 없는 더 옛날 파일은 DEFAULT_MEDIA 로 떨어지고, 그 결과는 isEmptyMedia 가 참이라
 *   다시 저장할 때 **바이트가 늘지 않는다.**
 * @param {unknown} raw
 * @returns {import('./schema.js').MediaBlock}
 */
export function normalizeMedia(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const clips = Array.isArray(src.clips)
    ? normalizeClips(src.clips)
    : normalizeClips([{ source: src.source, tempo: src.tempo, markers: src.markers }]);
  if (!clips.length) return { activeId: '', clips: [] };
  const wanted = src.activeId == null ? '' : String(src.activeId);
  const activeId = clips.some(c => c.id === wanted) ? wanted : clips[0].id;
  return { activeId, clips };
}

/**
 * 이 블록이 "아직 영상이 하나도 없음"인가.
 * @param {unknown} media
 * @returns {boolean}
 */
export function isEmptyMedia(media) {
  return normalizeMedia(media).clips.length === 0;
}

/**
 * 클립 하나를 파일에 실을 형태로. 키 순서는 CLIP_FIELDS 고정이다.
 * @param {import('./schema.js').MediaClip} clip
 * @returns {object}
 */
function serializeClip(clip) {
  const out = {};
  for (const key of CLIP_FIELDS) out[key] = clip[key];
  // ⚠ 빈 보정점은 키째로 뺀다 — 보정점을 한 번도 안 쓴 사람의 파일은 이 필드가 생기기 전과 바이트가 같아야 한다.
  if (out.tempo && Array.isArray(out.tempo.points) && out.tempo.points.length === 0) {
    const { points: _omit, ...rest } = out.tempo;
    out.tempo = rest;
  }
  // ⚠ 빈 마커도 키째로 뺀다 — 같은 이유다(2026-09-10).
  if (Array.isArray(out.markers) && out.markers.length === 0) delete out.markers;
  return out;
}

/**
 * 파일에 실을 형태. **비어 있으면 null** 이고, 호출부(serialize.buildProjectFile)가 키를 통째로 뺀다.
 * 키 순서는 MEDIA_FIELDS(=schema.js) 고정이다 — 순서가 곧 JSON 바이트다.
 * @param {unknown} media
 * @returns {import('./schema.js').MediaBlock|null}
 */
export function serializeMedia(media) {
  if (isEmptyMedia(media)) return null;
  const m = normalizeMedia(media);
  const out = {};
  for (const key of MEDIA_FIELDS) out[key] = key === 'clips' ? m.clips.map(serializeClip) : m[key];
  return out;
}
