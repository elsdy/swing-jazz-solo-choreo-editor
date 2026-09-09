// src/adapters/media/pickPlayer.js — URL 을 보고 어떤 재생기를 쓸지 고른다 (adapters 계층)
//
// 신규 파일이다. 지금 고를 수 있는 것은 둘뿐이다: YouTube 어댑터와 널 재생기.
// "어떤 어댑터인가"를 아는 유일한 자리이며, 뷰와 유스케이스는 MediaPlayer 하나만 본다.
//
// ⚠ URL 파싱을 두 벌로 만들지 않는다. videoId 추출은 domain/links.js 의 parseYoutubeUrl 하나뿐이고
//   (그 함수는 normalizeYoutubeUrl 옆에서 같은 규칙을 쓴다), 여기서는 정규식을 한 글자도 쓰지 않는다.
//   링크바가 저장하는 문자열과 재생기가 보는 videoId 가 갈라지면 "같은 곡인데 두 값"이 된다.
//
// ⚠ 여기서 index.ts 같은 배럴 파일을 만들지 않았다. 배럴은 "무엇이 실제로 쓰이는지"를 가리고,
//   이 프로젝트에는 번들러가 없어 import 한 줄이 곧 네트워크 요청 한 번이다.

import { parseYoutubeUrl } from '../../domain/links.js';
import { createNullMediaPlayer } from '../nullMediaPlayer.js';
import { createYouTubePlayer } from './youtubePlayer.js';

/**
 * URL → MediaSource. 못 알아보면 **null**(= 소스 없음)이고, 그건 오류가 아니라 정상 상태다.
 *
 * ⚠ 빈 칸도 null 이다. 사용자가 링크바를 비운 것은 "영상을 안 쓰겠다"는 뜻이지 실패가 아니다.
 * @param {string|null|undefined} url  링크바에 사용자가 넣은 원문
 * @returns {import('../../ports/media.js').MediaSource|null}
 */
export function mediaSourceFromUrl(url) {
  if (url == null) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const { videoId, startSec } = parseYoutubeUrl(raw);
  if (!videoId) return null;
  // startSec 0 은 키를 만들지 않는다 — `{kind, videoId}` 만 있는 편이 비교와 저장에서 단순하다.
  return startSec > 0 ? { kind: 'youtube', videoId, startSec } : { kind: 'youtube', videoId };
}

/**
 * 이 URL 을 어떤 어댑터가 맡는가. 뷰가 "왜 안 되는지"를 고를 때 쓴다(널이면 안내 문구가 다르다).
 * @param {string|null|undefined} url
 * @returns {'youtube'|'null'}
 */
export function pickPlayerKind(url) {
  return mediaSourceFromUrl(url) ? 'youtube' : 'null';
}

/**
 * URL 에 맞는 재생기를 만든다. **호출부에 분기가 생기지 않는 것이 목적이다** —
 * 알아볼 수 없는 URL 이어도 널 재생기가 나오므로 `player?.` 가 필요 없다
 * (docs/PORTS.md 'createNullMediaPlayer() 가 존재하는 이유').
 *
 * ⚠ 소스를 여기서 load() 하지 않는다. 만들기와 싣기를 나누는 이유는 계약이 "kind 가 같으면
 *   재생성 없이 소스만 바꾼다"이기 때문이다 — 호출부는 kind 가 그대로면 이 함수를 다시 부르지 말고
 *   `player.load(mediaSourceFromUrl(newUrl))` 만 불러야 iframe 이 다시 로드되지 않는다.
 *
 * @param {string|null|undefined} url
 * @param {object} [options]  youtubePlayer 에 그대로 전달된다(container·win·doc·timers·loadApi 등)
 * @returns {import('../../ports/media.js').MediaPlayer}
 */
export function pickPlayer(url, options = {}) {
  return pickPlayerKind(url) === 'youtube'
    ? createYouTubePlayer(options)
    : createNullMediaPlayer();
}
