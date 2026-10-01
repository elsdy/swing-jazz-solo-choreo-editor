// tools/lib/js-text.mjs — 검사기들이 함께 쓰는 JS 원문 읽기. 의존성 0.
//
// 원칙 검사(check-principles)는 주석과 문자열 **속**을 지운 원문에서 코드 모양을 찾고,
// 문서 검사(check-docs 의 라벨 인용 대조)는 거꾸로 문자열 **속**만 모아 화면에 뜰 수 있는 글자로 쓴다.
// 둘은 같은 토크나이저의 두 얼굴이라 한 곳에 둔다 — 하나만 고치면 둘이 다른 JS 를 읽게 된다.

/** 템플릿의 `${…}` 자리에 넣는 표식. 라벨 대조가 「여기엔 무엇이든 온다」로 읽는다. */
export const HOLE = '\u0001';

/** 오프셋 → 1부터 세는 줄 번호. */
export const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/**
 * JS 원문을 한 번 훑어 ① 주석과 문자열 속을 같은 길이의 공백으로 지운 원문(줄바꿈은 남겨 줄 번호가 그대로다)과
 * ② 문자열 리터럴의 속 글자를 함께 돌려준다. 템플릿의 `${…}` 안은 코드이므로 남기고, 글자에서는 HOLE 로 바꾼다.
 * 정규식 리터럴은 앞 글자로 어림한다(정규식 속은 문자열로 치지 않는다).
 * @returns {{ blanked: string, strings: { text: string, offset: number }[] }}
 */
export function scanJs(src) {
  const out = src.split('');
  const strings = [];
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  const prevSignificant = (k) => { while (k >= 0 && /\s/.test(src[k])) k--; return k >= 0 ? src[k] : ''; };
  function readTemplate() {
    // src[i] === '`'
    const at = i + 1;
    let text = '';
    let j = i + 1;
    let start = j;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { blank(start, j); text += src.slice(start, j); i = j + 1; strings.push({ text, offset: at }); return; }
      if (src[j] === '$' && src[j + 1] === '{') {
        blank(start, j);
        text += src.slice(start, j) + HOLE;
        i = j + 2;
        readCode(1);
        j = i;          // i 는 짝 '}' 바로 뒤
        start = j;
        continue;
      }
      j++;
    }
    blank(start, j); text += src.slice(start, j); i = j;
    strings.push({ text, offset: at });
  }
  function readCode(depth) {
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
      if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
      if (c === '\'' || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        strings.push({ text: src.slice(i + 1, j), offset: i + 1 });
        blank(i + 1, j); i = j + 1; continue;
      }
      if (c === '`') { readTemplate(); continue; }
      if (c === '/' && /^[(,=:[!&|?{};+\-*%<>~^]?$/.test(prevSignificant(i - 1)) && !/[\w$)\]]/.test(prevSignificant(i - 1))) {
        let j = i + 1; let inClass = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j++;
        }
        blank(i + 1, j); i = j + 1; continue;
      }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { i++; return; } }
      i++;
    }
  }
  readCode(Infinity);
  return { blanked: out.join(''), strings };
}

/** 주석과 문자열 **속**을 지운 원문. 코드 모양만 찾을 때 쓴다. */
export const blankJs = (src) => scanJs(src).blanked;
