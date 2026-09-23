// src/domain/moveMatch.js — 말로 들은 것을 동작 목록의 동작에 맞춘다 (domain 계층)
//
// 신규 파일이다(2026-09-22). 마이크로 받아 적은 거친 글자("어 킥볼체인지")를 동작 목록의
// 정식 표기(`Kick Ball Change`)로 바꾸는 첫 관문이다.
//
// **LLM 앞에 이것이 서 있는 까닭:** 음성 인식이 제대로 알아들은 말은 대부분 여기서 끝난다.
// 「찰스턴」처럼 목록에 그 이름이 그대로 있으면 글자만 씻어도 맞는다. 그런 것까지 LLM 에 보내면
// 한 마디에 1~2초씩 기다리고 돈도 든다. **여기서 확신이 서지 않을 때만** LLM 을 부른다.
//
// 반대로 여기서 못 하는 것도 분명하다 — 「킥볼체인지」와 `Kick Ball Change` 는 글자가 한 자도
// 겹치지 않는다. 한글로 옮겨 적은 영어를 원어로 되돌리는 일은 규칙으로 못 하고, 그게 LLM 의 몫이다.
// 그래서 이 파일은 **모르면 모른다고 한다**(`sure: false`). 억지로 가장 비슷한 것을 고르면
// 엉뚱한 이름이 조용히 붙는데, 받아 적는 중에는 그걸 알아채지 못한다.
//
// ⚠ **domain/choreoPlan.matchMove 와 다른 일이다.** 그쪽은 LLM 이 이미 깔끔하게 내놓은 이름을
//   목록에 잇는 일이라 너그러워도 된다(세 글자 이상이면 품기만 해도 맞다고 본다). 이쪽은 사람이
//   방금 입으로 낸 말이고, 틀리면 **엉뚱한 이름이 조용히 붙는다** — 그래서 점수를 매기고, 확신이
//   안 서면 모른다고 한다. 두 규칙을 한 함수에 합치면 어느 한쪽이 반드시 틀린다.
// ⚠ 순수 함수만. 시계·난수·DOM 을 쓰지 않는다.

/**
 * 말버릇. 인식된 글자 앞뒤에 늘 붙지만 뜻이 없는 것들이다.
 * ⚠ **짧은 동작 이름을 잡아먹지 않게** 토큰 단위로만 지운다. `그`·`뭐` 를 부분 문자열로 지우면
 *   「그레이프바인」이 「레이프바인」이 된다.
 */
export const FILLERS = Object.freeze([
  '어', '음', '아', '그', '저', '이제', '인제', '뭐', '자', '엄', '으음', '흠', '그니까', '그러니까'
]);

/** 이 점수 이상이면 LLM 없이 바로 붙인다. 아래면 «들은 대로» 두고 LLM 에게 묻는다. */
export const SURE_SCORE = 0.82;

/** 후보로도 내지 않는 바닥 점수. 이보다 낮으면 그냥 남남이다. */
export const FLOOR_SCORE = 0.45;

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

/**
 * 비교용으로 씻은 글자. 띄어쓰기·가운뎃점·붙임표·괄호를 없애고 소문자로 내린다.
 * 「Kick Ball Change」 · 「kick-ball-change」 · 「KickBallChange」 가 모두 같은 글자가 된다.
 */
export function normalizeName(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[\s·・\-_/()[\]{}.,!?~"'`]+/g, '')
    .trim();
}

/**
 * 말버릇만 떼고 **사람이 읽을 꼴 그대로** 돌려준다(띄어쓰기·대소문자를 살린다).
 * 못 맞춘 말을 블록에 그대로 적을 때 쓴다 — `음... 그 쇼티조지` 가 아니라 `쇼티조지` 가 적혀야 한다.
 * ⚠ 전부 말버릇이면 원문을 그대로 돌려준다. 빈 이름을 만들면 블록이 `?` 로 남는다.
 * @param {string} text
 * @returns {string}
 */
export function cleanSpoken(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';
  const kept = raw
    .split(/[\s·]+/)
    .filter((w) => w && !FILLERS.includes(w.replace(/^[.,!?~]+|[.,!?~]+$/g, '')));
  return kept.length ? kept.join(' ').replace(/^[.,!?~\s]+|[.,!?~\s]+$/g, '') || raw : raw;
}

/**
 * 말로 들은 글자에서 말버릇을 떼고 씻는다(비교용).
 * @param {string} text
 * @returns {string} 씻은 글자. 남는 것이 없으면 빈 문자열
 */
export function normalizeSpoken(text) {
  return normalizeName(cleanSpoken(text));
}

/** 한글 음절의 초성만 뽑는다. 한글이 아니면 그 글자를 그대로 둔다. */
export function choseongOf(text) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) {
    const code = ch.codePointAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      out += CHOSEONG[Math.floor((code - HANGUL_BASE) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 편집 거리. 짧은 이름끼리 비교하므로 O(n·m) 로 충분하다. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * 씻은 글자 둘의 닮은 정도 `[0,1]`.
 *
 * 세 갈래를 **가장 높은 것 하나**로 본다.
 *  · 같다 → 1
 *  · 한쪽이 다른 쪽을 품는다 → 0.78 + 길이 비율 (「찰스턴」 ⊂ 「찰스턴킥」)
 *  · 편집 거리 → 1 − 거리/긴쪽
 * 초성 비교는 **한글끼리, 길이가 같을 때만** 덧댄다 — 「ㅊㅅㅌ」이 「ㅊㅅㅌ」과 맞으면
 * 인식이 받침만 틀린 경우다. 길이가 다르면 초성은 너무 헐거워 남남끼리도 맞는다.
 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;
  let best = 1 - editDistance(a, b) / long.length;
  // ⚠ 품는다고 후하게 주면 **잘린 이름**이 확신으로 올라간다. 「쇼티조지」 안에 「조지」가
  //   들어 있다고 `조지` 로 붙여 버리면, LLM 이 `Shorty George` 로 고칠 기회를 뺏는다.
  //   그래서 길이 비율에 강하게 기댄다 — 거의 같은 길이일 때만 확신 구간에 닿는다.
  if (long.includes(short)) best = Math.max(best, 0.5 + 0.45 * (short.length / long.length));
  // ⚠ **세 글자부터만** 초성을 본다. 두 글자에서는 초성이 너무 헐거워 남남이 맞는다 —
  //   「재즈」와 「조지」는 둘 다 `ㅈㅈ` 다. 세 글자면 우연히 같을 확률이 확 떨어진다.
  if (a.length === b.length && a.length >= 3 && choseongOf(a) === choseongOf(b)) {
    best = Math.max(best, 0.86);     // 받침만 틀린 인식(「찰스톤」 → 「찰스턴」)을 확신 구간에 넣는다
  }
  return Math.max(0, Math.min(1, best));
}

/**
 * @typedef {object} MoveMatch
 * @property {string} name  동작 목록에 있는 그대로의 표기
 * @property {number} score `[0,1]`
 * @property {boolean} sure SURE_SCORE 이상인가 — 참이면 LLM 없이 붙여도 된다
 */

/**
 * 말로 들은 것을 동작 목록에 맞춘다.
 *
 * @param {string} spoken 음성 인식이 준 거친 글자
 * @param {string[]} moveNames 동작 목록의 이름들(표기 그대로)
 * @returns {MoveMatch|null} 바닥 점수에도 못 미치면 null
 */
export function matchSpoken(spoken, moveNames) {
  const needle = normalizeSpoken(spoken);
  if (!needle) return null;
  let best = null;
  for (const raw of moveNames || []) {
    const name = String(raw == null ? '' : raw);
    if (!name.trim()) continue;
    const score = similarity(needle, normalizeName(name));
    if (!best || score > best.score) best = { name, score, sure: false };
  }
  if (!best || best.score < FLOOR_SCORE) return null;
  return { ...best, sure: best.score >= SURE_SCORE };
}

/**
 * 후보 몇 개를 점수순으로. 화면이 "이거 아니면 저거" 를 물을 때 쓴다.
 * @param {string} spoken
 * @param {string[]} moveNames
 * @param {number} [limit]
 * @returns {MoveMatch[]}
 */
export function spokenCandidates(spoken, moveNames, limit = 3) {
  const needle = normalizeSpoken(spoken);
  if (!needle) return [];
  return (moveNames || [])
    .map((raw) => String(raw == null ? '' : raw))
    .filter((name) => name.trim())
    .map((name) => {
      const score = similarity(needle, normalizeName(name));
      return { name, score, sure: score >= SURE_SCORE };
    })
    .filter((m) => m.score >= FLOOR_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

/**
 * 붙일 이름을 고른다 — 맞는 것이 있으면 그 표기, 없으면 **들은 대로**.
 *
 * ⚠ 못 맞췄다고 빈 이름으로 두지 않는다. 들은 대로라도 적혀 있으면 나중에 그 블록만 보고
 *   고칠 수 있지만, `?` 로 남으면 영상을 다시 봐야 한다. 그게 이 기능을 쓰는 까닭이다.
 * @param {string} spoken
 * @param {string[]} moveNames
 * @returns {{ name:string, matched:MoveMatch|null, needsLlm:boolean }}
 */
export function resolveSpokenName(spoken, moveNames) {
  const heard = cleanSpoken(spoken);
  const matched = matchSpoken(heard, moveNames);
  if (matched && matched.sure) return { name: matched.name, matched, needsLlm: false };
  return { name: heard, matched, needsLlm: Boolean(heard) };
}
