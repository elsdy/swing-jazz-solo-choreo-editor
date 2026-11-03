// src/domain/hangul.js — 흩어진 한글 자모를 2벌식 규칙으로 다시 묶는다 (domain 계층, RM-50)
//
// 블록을 고른 채(포커스는 body) 한글을 바로 치면, 실제 macOS 한글 2벌식 입력기는 처음 몇 글쇠를 **조합 없이**
// 맺어 이름 입력에 「ㅅㅡ윙」 · 「ㅊㅏㄹ스턴」 · 「ㅎㅏㄴ」처럼 낱자를 흩어 넣는다(RM-15 마무리 · RM-51 이 쟀다).
// 조합은 입력기의 일이라 앱이 막을 길이 없다 — 그래서 **맺힌 뒤에** 그 낱자들을 입력기가 했을 묶음으로 되돌린다.
//
//   joinJamo('ㅅㅡ윙') → '스윙'   joinJamo('ㅊㅏㄹ스턴') → '찰스턴'   joinJamo('ㅎㅏㄴ') → '한'
//
// 규칙은 2벌식 입력기의 것이다 — 초성 + 중성, 겹모음(ㅗ+ㅏ=ㅘ), 받침, 겹받침(ㄹ+ㄱ=ㄺ), 모음이 오면 받침을 다음 글자로
// 넘기기(한+ㅏ → 하나, 겹받침은 앞 낱자만 남긴다: 닭+ㅏ → 달가).
// 이미 맺힌 음절은 그 상태(초성 · 중성 · 받침) 그대로 이어 받는다 — 음절 뒤에 음절이 오면 둘은 섞이지 않으므로
// **맺힌 음절만 있는 글은 한 글자도 바뀌지 않는다**. 바뀌는 것은 낱자가 앞 글자와 묶일 수 있을 때뿐이다.
//
// ⚠ 낱자끼리는 초성 + 중성 짝이 될 때만 묶는다 — 「ㅋㅋ」 · 「ㄱㅅ」 · 「ㅠㅠ」는 그대로다(모음 없이 겹받침을 만들지 않는다).
// ⚠ 2벌식으로 칠 수 없는 낱자(겹자음 ㄳ · 옛 자모 ㅥ~ㆎ)와 한글이 아닌 글자는 경계다 — 그대로 두고 앞뒤를 끊는다.
// ⚠ 순수 함수만. 문자 코드 셈만 쓴다.

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 겹모음 — 앞 모음 + 뒤 모음. 2벌식에서 두 글쇠로 치는 것만. */
const VOWEL_PAIRS = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
/** 겹받침 — 앞 받침 + 뒤 자음. */
const FINAL_PAIRS = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ',
  'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ'
};
/** 겹받침 → [남는 받침, 다음 글자로 넘어갈 초성]. */
const FINAL_SPLIT = Object.fromEntries(Object.entries(FINAL_PAIRS).map(([pair, joined]) => [joined, [pair[0], pair[1]]]));

const CHO_INDEX = new Map(CHO.map((c, i) => [c, i]));
const JUNG_INDEX = new Map(JUNG.map((c, i) => [c, i]));
const JONG_INDEX = new Map(JONG.map((c, i) => [c, i]));

/**
 * 흩어진 자모를 2벌식 규칙으로 다시 묶는다. 묶을 것이 없으면 들어온 글을 그대로 돌려준다.
 * @param {string} text
 * @returns {string}
 */
// @complexity time=O(n) space=O(n) cc=24
export function joinJamo(text) {
  const s = String(text ?? '');
  /** @type {string[]} */
  const out = [];
  let cho = '';
  let jung = '';
  let jong = '';
  const flush = () => {
    if (cho && jung) out.push(String.fromCharCode(SYLLABLE_FIRST + (CHO_INDEX.get(cho) * 21 + JUNG_INDEX.get(jung)) * 28 + JONG_INDEX.get(jong)));
    else if (cho || jung) out.push(cho || jung);
    cho = ''; jung = ''; jong = '';
  };

  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST) {
      // 맺힌 음절 — 앞 것을 내보내고 그 음절의 상태를 이어 받는다(뒤 낱자가 받침 · 넘기기로 붙을 수 있게).
      flush();
      const k = code - SYLLABLE_FIRST;
      cho = CHO[Math.floor(k / 588)];
      jung = JUNG[Math.floor((k % 588) / 28)];
      jong = JONG[k % 28];
    } else if (CHO_INDEX.has(c)) {
      if (cho && jung && !jong && JONG_INDEX.has(c)) jong = c;                     // 받침(ㄸ ㅃ ㅉ 은 받침이 못 된다)
      else if (cho && jung && jong && FINAL_PAIRS[jong + c]) jong = FINAL_PAIRS[jong + c];   // 겹받침
      else { flush(); cho = c; }
    } else if (JUNG_INDEX.has(c)) {
      if (cho && jung && jong) {
        // 모음이 오면 받침을 다음 글자의 초성으로 넘긴다 — 겹받침은 뒤 낱자만 넘긴다.
        const [keep, moved] = FINAL_SPLIT[jong] || ['', jong];
        jong = keep;
        flush();
        cho = moved; jung = c;
      } else if (jung && !jong && VOWEL_PAIRS[jung + c]) jung = VOWEL_PAIRS[jung + c];  // 겹모음
      else if (cho && !jung) jung = c;
      else { flush(); jung = c; }                                                    // 홀로 선 모음
    } else {
      flush();
      out.push(c);                                                                   // 경계 — 한글이 아닌 글자 · 겹자음 낱자 · 옛 자모
    }
  }
  flush();
  return out.join('');
}
