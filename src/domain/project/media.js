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
import { MEDIA_FIELDS } from './schema.js';

/** 아직 아무것도 정하지 않은 영상 블록. tempo.bpm 0 = 미설정(클램프 대상이 아니다). */
export const DEFAULT_MEDIA = Object.freeze({ tempo: DEFAULT_TEMPO, source: null });

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
 * @param {unknown} raw
 * @returns {import('./schema.js').MediaSourceRef|null}
 */
export function normalizeMediaSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!MEDIA_SOURCE_KINDS.includes(kind)) return null;
  if (kind === 'file') {
    const name = raw.name == null ? '' : String(raw.name).trim();
    return name ? { kind, name } : null;
  }
  const url = raw.url == null ? '' : String(raw.url);
  if (!url) return null;
  return { kind, url };
}

/**
 * 손상된 입력 → MediaBlock. **언제나 두 필드를 채운 새 객체**를 돌려준다(snapshot.toLinkBundle 과 같은 규약).
 * media 가 아예 없는 옛 파일이 여기서 기본값으로 떨어지고, 그 결과가 DEFAULT_MEDIA 와 같으므로
 * 다시 저장할 때 isEmptyMedia 가 참이 되어 **바이트가 늘지 않는다.**
 * @param {unknown} raw
 * @returns {import('./schema.js').MediaBlock}
 */
export function normalizeMedia(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { tempo: normalizeTempo(src.tempo), source: normalizeMediaSource(src.source) };
}

/**
 * 이 블록이 "아직 아무것도 정하지 않음"인가.
 * ⚠ tempo.bpm 이 0(미설정)이어도 앵커를 옮겼다면 비어 있지 않다 — 사용자가 찍은 값이므로 저장해야 한다.
 * @param {unknown} media
 * @returns {boolean}
 */
export function isEmptyMedia(media) {
  const m = normalizeMedia(media);
  if (m.source !== null) return false;
  const t = m.tempo;
  return t.bpm === DEFAULT_TEMPO.bpm
    && t.beatsPerCount === DEFAULT_TEMPO.beatsPerCount
    && t.anchorSec === DEFAULT_TEMPO.anchorSec
    && t.anchorCount === DEFAULT_TEMPO.anchorCount;
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
  for (const key of MEDIA_FIELDS) out[key] = m[key];
  return out;
}
