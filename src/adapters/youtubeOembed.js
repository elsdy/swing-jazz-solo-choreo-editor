// src/adapters/youtubeOembed.js — YouTube oEmbed 제목 조회 (adapters 계층)
//
// 원본 index.html 의 fetchYoutubeTitle(5090-5098)이 통째로 여기 있다.
// 이 프로젝트에서 네트워크를 만지는 유일한 파일이라 한 파일로 떼어 두었다.
// 정규화 규칙은 domain/links.js 의 normalizeYoutubeUrl 하나뿐이다(원본도 5092 에서 그것을 부른다).

import { normalizeYoutubeUrl } from '../domain/links.js';

/** oEmbed 엔드포인트. 원본 5093 의 문자열 그대로. */
const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed';

/**
 * URL 의 영상 제목. **실패를 전부 `''` 로 삼킨다** — 오늘 그대로다.
 *
 * ⚠ 보존 대상 결함 3가지(FINAL-architecture §5 #15):
 *   ① 네트워크 오류·비공개 영상·임베드 금지·JSON 파싱 실패가 모두 `''` 로 뭉개져
 *      화면에는 제목 칩이 그냥 안 뜬다. 사용자는 이유를 알 수 없다.
 *   ② 취소(AbortController)가 없다. 입력이 빨리 바뀌면 요청이 겹치고 **늦게 도착한 응답이 이긴다** —
 *      호출부(ui/linksBarView)가 `state.youtubeUrl === url` 재확인으로 부분 방어할 뿐이다(5237).
 *      여기에 AbortController 를 넣는 것은 동작 변경이다.
 *   ③ 700ms 디바운스는 여기 없다. 호출부가 adapters/browser.js 의 debounce 로 소유한다(5234).
 *
 * status 를 함께 돌려주는 판(OEMBED_STATUS 플래그)은 다음 PR 이다 — 지금 만들면 죽은 코드이거나
 * 화면이 달라진다.
 * @see index.html:5090
 * @param {string} url 사용자가 입력한 원문 URL(정규화는 이 함수가 한다)
 * @returns {Promise<string>} 제목, 또는 실패 시 ''
 */
export async function fetchTitle(url) {
  try {
    const canonical = normalizeYoutubeUrl(url);
    const res = await fetch(`${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonical)}&format=json`);
    if (!res.ok) return '';
    const data = await res.json();
    return data.title || '';
  } catch {
    return '';
  }
}
