// src/ui/guideLines.js — 영상 패널 · 연습 줄의 안내 줄 문구를 고르는 순수 함수 (ui 계층, RM-19)
//
// 늘 떠 있던 안내 문장 열넷(사이드바 셋 · 영상 패널 열하나)은 한 번 읽으면 그다음부터 소음이었다 —
// 받아 적기 안내는 네 문장짜리 문단이었다. 이제 **평소에는 빈 글**이고, 막혔을 때의 경고(BPM 먼저 ·
// 박자 밀림 · 보정점 순서 · 자르기 실패)와 살아 있는 값(보정점 목록 · 탭으로 잰 BPM · 고른 대목의 초)만 뜬다.
// 걷은 설명은 버튼 툴팁(index.html 의 title)과 「처음 한 번」 안내(ui/onceHint.js)로 옮겼다.
//
// ⚠ 여기는 **문구만** 고른다. DOM 을 모르고 store 도 모른다 — 뷰(videoPanel · poseView · practiceBar)가
//   잰 값을 넘기고 돌려받은 글을 적는다. 그래서 시험이 DOM 없이 「평소에 비는가 · 막혔을 때만 경고인가」를 잰다.
// ⚠ 돌려주는 모양은 `{ text, tone }` 하나다. tone 은 'warn'(막힘 · 실패) · 'info'(살아 있는 값) · ''(빈 글).

/** @typedef {{ text: string, tone: 'warn'|'info'|'' }} Guide */

/** 빈 안내 — 평소의 모양. */
export const QUIET = Object.freeze({ text: '', tone: '' });

const warn = (text) => ({ text, tone: 'warn' });
const info = (text) => ({ text, tone: 'info' });

/** `③ 받아 적기` — 박자가 없으면 받을 수 없다. 이 한 줄이 「왜 버튼이 죽었나」의 답이다. */
export const NEED_BPM_TEXT = '먼저 `② 박자 맞추기` 에서 BPM 을 정하세요 — 영상의 초를 안무표의 카운트로 바꾸는 데 박자가 필요합니다.';

/**
 * 받아 적기 안내. 평소(박자 있음 · 안 받는 중)에는 빈 글이다. 「몇 초부터 받는 중」은 상태줄이 말한다.
 * @param {{
 *   ready: boolean,
 *   running: boolean,
 *   drift?: { state?: string, bpmEstimate?: number, mean?: number } | null,
 *   bpm?: number,
 *   formatBpm?: (bpm: number) => string
 * }} s
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=8
export function captureGuide(s) {
  if (!s.ready) return warn(NEED_BPM_TEXT);
  if (!s.running) return QUIET;
  const report = s.drift || {};
  const fmt = s.formatBpm || ((b) => String(b));
  if (report.state === 'fast' || report.state === 'slow') {
    const dir = report.state === 'fast' ? '빠릅니다' : '느립니다';
    const est = report.bpmEstimate ? ` 끊은 자리로 다시 재면 약 ${fmt(report.bpmEstimate)} BPM 입니다 —` : '';
    return warn(`⚠ 끊은 자리가 갈수록 밀립니다: 영상이 지금 BPM(${fmt(s.bpm)})보다 ${dir}.${est}`
      + ' 지금 받는 것을 끝내고 `② 박자 맞추기` 에서 고치면 그다음부터 맞습니다(여기서 저절로 바꾸지는 않습니다).');
  }
  if (report.state === 'lag') {
    const dir = report.mean > 0 ? '늦게' : '일찍';
    return warn(`끊은 자리가 고르게 ${dir} 찍힙니다(평균 ${Math.abs(report.mean).toFixed(2)}카운트).`
      + ' 박자가 아니라 손이라서, 다 받은 뒤 아래 `표 전체 옮기기` 한 번이면 됩니다.');
  }
  return QUIET;
}

/**
 * 마이크 줄. 오류 · 다시 켜는 중 · 지금 붙을 이름만 말한다. 「듣는 중」은 상태줄 · 엄지 바가 말한다.
 * @param {{ error?: string, ready: boolean, wanted: boolean, listening: boolean,
 *   heard?: { name: string, heard: string, needsLlm?: boolean } | null }} s
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=7
export function voiceGuide(s) {
  if (s.error) return warn(s.error);
  if (!s.ready || !s.wanted) return QUIET;
  if (!s.listening) return warn('⏸ 잠깐 멈췄습니다 — 다시 켜는 중입니다. 지금 말한 것은 놓칠 수 있습니다.');
  if (s.heard) {
    return info(s.heard.needsLlm
      ? `“${s.heard.heard}” 로 붙습니다. 동작 목록에서 못 찾아서, 놓인 뒤 LLM 이 정식 이름으로 고쳐 끼웁니다.`
      : `\`${s.heard.name}\` 으로 붙습니다 — 동작 목록에 있는 이름입니다.`);
  }
  return QUIET;
}

/**
 * 두 점 앵커 줄. 첫 점을 찍은 뒤에만 「다음 점」을 안내한다 — 그것은 설명이 아니라 진행 중인 상태다.
 * @param {{ points: number, needed: number, firstLabel?: string }} s
 *   firstLabel: 첫 지점의 `8x1의 1카운트 = 0:12.3` 꼴(뷰가 만든다)
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=2
export function markGuide(s) {
  if (!s.points) return QUIET;
  return info(`${s.points}/${s.needed} — 첫 지점 ${s.firstLabel || ''}. 이제 한참 뒤의 카운트를 골라 한 번 더 누르세요.`);
}

/**
 * 탭 줄. 두드린 것이 둘 미만이면 빈 글이고, 그 뒤로는 잰 값(뷰가 만든 문장)이다. 간격을 못 읽으면 경고.
 * @param {{ taps: number, measured?: string|null }} s measured: `탭 4번 → 120 BPM · …`, 못 읽었으면 null
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=3
export function tapGuide(s) {
  if (s.taps < 2) return QUIET;
  if (s.measured === null || s.measured === undefined) return warn('두드린 간격을 읽지 못했습니다 — `탭 지우기` 로 다시 시작하세요.');
  return info(s.measured);
}

/**
 * 보정점 줄. 순서가 어긋나 거부됐을 때만 경고, 찍힌 점이 있으면 그 목록, 그 밖에는 빈 글.
 * @param {{ rejected: boolean, listed?: string }} s listed: `8x3의 1카운트 = 0:20.0 · …`(뷰가 만든다)
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=3
export function pointGuide(s) {
  if (s.rejected) return warn('앞뒤 보정점과 순서가 맞지 않아 넣지 않았습니다 — 앞 카운트는 앞 시각에, 뒤 카운트는 뒤 시각에 와야 합니다.');
  if (s.listed) return info(s.listed);
  return QUIET;
}

/** 잘라내기가 **환경 때문에** 안 되는 이유 — 사용자가 짐작할 수 없는 것만 말한다. */
export const TRIM_BLOCKED_TEXT = Object.freeze({
  'not-file': '잘라내기는 영상 파일에만 됩니다 — 유튜브 영상은 `영상 파일 열기` 로 받아 온 파일이어야 합니다.',
  'no-server': '로컬 서버(server.py)가 없어 잘라낼 수 없습니다. `python3 server.py` 로 열면 됩니다.',
  'no-ffmpeg': '서버에 ffmpeg 이 없습니다. 설치하고(`brew install ffmpeg`) 서버를 다시 켜면 잘라낼 수 있습니다.',
  'not-stored': '이 파일은 아직 보관 폴더에 없습니다. 보관이 끝나면(파일명 옆 경로가 생기면) 잘라낼 수 있습니다.'
});

/**
 * 잘라내기 줄. 실패 → 경고, 도는 중 → 진행, 환경 막힘 → 경고. 준비됐거나 In/Out 을 아직 안 찍었으면 빈 글
 * (그 설명은 버튼 툴팁에 있다).
 * @param {{ state: string, error?: string }} s
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=4
export function trimGuide(s) {
  if (s.error && s.state !== 'busy') return warn(`잘라내기 실패: ${s.error}`);
  if (s.state === 'busy') return info('잘라내는 중… 구간 길이에 따라 수십 초가 걸릴 수 있습니다. 끝나면 새 클립으로 바뀝니다.');
  if (TRIM_BLOCKED_TEXT[s.state]) return warn(TRIM_BLOCKED_TEXT[s.state]);
  return QUIET;
}

/**
 * 고른 대목 내보내기 줄(RM-31). 고른 것이 없으면 빈 글. 고른 뒤에는 — 박자 없음 · 영상 밖 · 환경 막힘은 경고,
 * 준비됐으면 뷰가 계산한 초 구간(info), 도는 중이면 진행.
 * @param {{ state: string, error?: string, selected: boolean, selectionLabel?: string, readyText?: string }} s
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=9
export function exportGuide(s) {
  if (s.error && s.state !== 'busy') return warn(`내보내기 실패: ${s.error}`);
  if (s.state === 'busy') return info('잘라내는 중… 구간 길이에 따라 수십 초가 걸릴 수 있습니다. 끝나면 영상 목록에 새 클립이 생깁니다.');
  if (!s.selected || s.state === 'no-selection') return QUIET;
  if (s.state === 'ready') return info(s.readyText || '');
  const head = s.selectionLabel ? `선택: ${s.selectionLabel} — ` : '';
  if (s.state === 'no-tempo') return warn(`${head}박자를 먼저 맞추세요(\`② 박자 맞추기\`). 그래야 고른 마디가 영상의 몇 초인지 계산할 수 있습니다.`);
  if (s.state === 'outside') return warn(`${head}고른 대목이 이 영상 밖입니다 — 박자 기준점보다 앞이거나 영상이 끝난 뒤입니다.`);
  if (TRIM_BLOCKED_TEXT[s.state]) return warn(head + TRIM_BLOCKED_TEXT[s.state]);
  return QUIET;
}

/**
 * 마커 줄. 순서가 어긋나 거부됐으면 경고, In~Out 이 있으면 「어디에 맵핑되나」(살아 있는 값), 없으면 빈 글.
 * @param {{ rejected: boolean, hasRange: boolean, target?: string }} s target: 뷰가 만든 `선택: … ← In~Out 을 여기에 맵핑합니다.`
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=3
export function markerGuide(s) {
  if (s.rejected) return warn('이 마커의 양 끝이 앞뒤 보정점과 순서가 맞지 않아 박자에 넣지 않았습니다 — 앞 카운트는 앞 시각에, 뒤 카운트는 뒤 시각에 와야 합니다.');
  if (s.hasRange && s.target) return info(s.target);
  return QUIET;
}

/** 자세 분석이 **환경 때문에** 안 되는 이유. 준비됐을 때의 설명은 버튼 툴팁 · 처음 한 번 안내로 갔다. */
export const POSE_BLOCKED_TEXT = Object.freeze({
  'no-server': '로컬 서버(server.py)가 없어 자세 분석을 할 수 없습니다. `python3 server.py` 로 열면 됩니다.',
  'no-model': '자세 분석 모델을 아직 받지 않았습니다. `설정` 의 `자세 분석 모델` 에서 내려받으세요.',
  'not-file': '자세 분석은 영상 **파일**에만 됩니다. 유튜브는 재생 화면의 픽셀을 읽을 수 없습니다 — `영상 파일 열기` 로 받아 온 파일이어야 합니다.',
  'not-loaded': '영상이 아직 실리지 않았습니다. 영상이 뜬 뒤에 누르세요.'
});

/**
 * 자세 분석 줄. 실패 → 경고, 도는 중 · 끝난 요약 · 따라 그리는 중 → 뷰가 만든 글(info), 막힘 → 경고, 준비됨 → 빈 글.
 * @param {{ state: string, error?: string, live?: boolean, why: string, text?: string }} s
 *   text: 도는 중 · 끝난 뒤 · 따라 그리기의 글(뷰가 잰 값으로 만든다)
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=6
export function poseGuide(s) {
  if (s.state === 'error') return warn(`분석 실패: ${s.error || ''}`);
  if (s.state === 'running' || s.state === 'done' || s.live) return info(s.text || '');
  if (POSE_BLOCKED_TEXT[s.why]) return warn(POSE_BLOCKED_TEXT[s.why]);
  return QUIET;
}

/**
 * 연습 조작 줄. 박자가 없으면 경고(마디 반복이 죽는 까닭), 반복 중이면 그 구간(info), 평소에는 빈 글.
 * @param {{ ready: boolean, text?: string }} s text: 반복 중인 구간의 글(뷰가 만든다), 없으면 빈 글
 * @returns {Guide}
 */
// @complexity time=O(1) space=O(1) cc=3
export function practiceGuide(s) {
  if (!s.ready) return warn('마디로 반복하려면 박자가 있어야 합니다 — `② 박자 맞추기` 에서 BPM 을 정하세요. 영상이 없어도 BPM 만 있으면 박자로 돕니다.');
  if (s.text) return info(s.text);
  return QUIET;
}

/**
 * 안내 줄 엘리먼트에 적는다 — 열한 줄이 같은 꼴로 색을 바꾼다.
 * @param {HTMLElement|null} el
 * @param {Guide} guide
 * @param {string} errorClass 경고일 때 붙일 클래스(domContract 의 CLS.isError)
 */
// @complexity time=O(1) space=O(1) cc=3
export function applyGuide(el, guide, errorClass) {
  if (!el) return;
  el.textContent = guide.text;
  el.hidden = !guide.text;
  if (errorClass) el.classList.toggle(errorClass, guide.tone === 'warn');
}
