// src/domain/phrasing.js — 프레이즈·코러스 구조 (순수, import 0개)
//
// 신설 파일이다(2026-09-13). 원본 index.html 에 대응물이 없다 — 지금까지 안무표는 마디(8카운트)의
// 평평한 목록이었고, 그 위의 **묶음**(프레이즈·코러스)은 사람 머릿속에만 있었다.
//
// 이 파일이 아는 것은 한 가지다: **마디 번호 → 이 마디가 몇 번째 프레이즈·코러스에 속하는가.**
// 색을 고르는 것까지가 여기 몫이고(팔레트가 도메인에 있는 이유는 아래), 그 색을 어디에 칠할지는 ui 가 정한다.
//
// ⚠ 용어. 이 앱에서 **한 행 = 한 마디 = 8카운트**다(보드 헤더의 `마디`). 그래서
//   `rowsPerPhrase: 4` 는 "프레이즈 하나가 4마디(32카운트)"라는 뜻이다. 스윙에서 흔한 두 경우가
//   이 두 숫자로 그대로 떨어진다:
//     · 32마디 곡  프레이즈 4마디 × 코러스당 4프레이즈 → 한 코러스 16마디
//     · 블루스     프레이즈 6마디 × 코러스당 1프레이즈 → 한 코러스 6마디, 코러스마다 프레이즈가 바뀐다
//
// ⚠ 색은 **전역 번호**로 고른다(코러스 안의 순번이 아니다). 한 줄 규칙으로 위의 두 경우가 모두 맞는다 —
//   코러스당 4프레이즈면 팔레트가 4색이라 "각 코러스의 1번 프레이즈"가 언제나 같은 색이 되고(A·A·B·A 를
//   색으로 읽는다), 블루스처럼 코러스당 1프레이즈면 코러스가 넘어갈 때마다 색이 넘어간다.
//   두 팔레트의 길이를 4와 6으로 어긋나게 둔 것도 같은 이유다 — 두 색이 한꺼번에 되돌아오지 않는다.

/**
 * @typedef {Object} Phrasing
 * @property {boolean} on               구조를 화면에 표시하는가. 기본은 꺼짐 — 켜야 보이는 기능이다
 * @property {number} rowsPerPhrase     프레이즈 하나가 몇 마디인가 (1..64)
 * @property {number} phrasesPerChorus  코러스 하나가 몇 프레이즈인가 (1..32)
 * @property {number} startRow          첫 코러스가 시작하는 마디 (1 이상). 앞에 인트로가 붙는 곡을 위한 값
 */

/** 아직 아무것도 정하지 않은 상태. `on:false` 라 화면은 이 기능이 들어오기 전과 같다. */
export const DEFAULT_PHRASING = Object.freeze({ on: false, rowsPerPhrase: 4, phrasesPerChorus: 4, startRow: 1 });

/** 저장 포맷의 키 순서. 곧 저장 바이트다. */
export const PHRASING_FIELDS = Object.freeze(['on', 'rowsPerPhrase', 'phrasesPerChorus', 'startRow']);

/**
 * 프레이즈 색 4개. 안무표의 **트랙 테두리**에 칠한다.
 * ⚠ 노랑과 초록을 뺐다 — 노랑은 선택 표시(`.placement.is-selected`), 초록은 재생 헤드·영상 패널이
 *   이미 쓰는 색이라 같은 화면에서 뜻이 겹친다.
 */
export const PHRASE_COLORS = Object.freeze(['#f472b6', '#38bdf8', '#a78bfa', '#fb923c']);

/** 코러스 색 6개. 행 양 끝의 **마디 이름·비고 칸 테두리**에 칠한다(프레이즈와 자리를 나눈다). */
export const CHORUS_COLORS = Object.freeze(['#2dd4bf', '#fbbf24', '#818cf8', '#fb7185', '#a3e635', '#22d3ee']);

/**
 * 흔한 곡 구조. 사용자가 숫자 둘을 몰라도 고를 수 있게 하는 것이 목적이다.
 * label 은 화면에 그대로 나가는 문구다(바꾸면 docs/FEATURES.md 도 함께 고친다).
 */
export const PHRASING_PRESETS = Object.freeze([
  Object.freeze({ id: 'standard', label: '32마디 곡 — 4마디 × 4프레이즈', rowsPerPhrase: 4, phrasesPerChorus: 4 }),
  Object.freeze({ id: 'blues', label: '블루스 — 6마디 × 1프레이즈', rowsPerPhrase: 6, phrasesPerChorus: 1 }),
  Object.freeze({ id: 'short', label: '16마디 곡 — 4마디 × 2프레이즈', rowsPerPhrase: 4, phrasesPerChorus: 2 }),
  Object.freeze({ id: 'eights', label: '8카운트마다 — 1마디 × 8프레이즈', rowsPerPhrase: 1, phrasesPerChorus: 8 })
]);

const ROWS_PER_PHRASE_MAX = 64;
const PHRASES_PER_CHORUS_MAX = 32;

/** 유한한 정수로 접고 범위 안에 가둔다. 손상된 값은 기본값으로 떨어진다(거부하지 않는다). */
function intIn(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * 손상된 입력 → Phrasing. **언제나 네 필드를 채운 새 객체**를 돌려준다(normalizeMedia 와 같은 규약).
 * @param {Partial<Phrasing>|null|undefined} raw
 * @returns {Phrasing}
 */
export function normalizePhrasing(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    on: src.on === true,
    rowsPerPhrase: intIn(src.rowsPerPhrase, DEFAULT_PHRASING.rowsPerPhrase, 1, ROWS_PER_PHRASE_MAX),
    phrasesPerChorus: intIn(src.phrasesPerChorus, DEFAULT_PHRASING.phrasesPerChorus, 1, PHRASES_PER_CHORUS_MAX),
    startRow: intIn(src.startRow, DEFAULT_PHRASING.startRow, 1, 9999)
  };
}

/**
 * 이 구조가 "아직 아무것도 정하지 않음"인가. 참이면 파일에 쓰지 않는다.
 * ⚠ `on:false` 라도 숫자를 만졌으면 비어 있지 않다 — 껐다 켜는 사이에 사용자가 맞춰 둔 값이 날아가면 안 된다.
 * @param {unknown} phrasing
 * @returns {boolean}
 */
export function isEmptyPhrasing(phrasing) {
  const p = normalizePhrasing(phrasing);
  return PHRASING_FIELDS.every(key => p[key] === DEFAULT_PHRASING[key]);
}

/**
 * 파일에 쓸 모양. 기본값 그대로면 **null** 이고, 그때 호출부가 키를 통째로 뺀다 —
 * 이 기능을 안 쓴 사용자의 저장 파일은 바이트가 같아야 한다.
 * @param {unknown} phrasing
 * @returns {Phrasing|null}
 */
export function serializePhrasing(phrasing) {
  if (isEmptyPhrasing(phrasing)) return null;
  const p = normalizePhrasing(phrasing);
  const out = {};
  for (const key of PHRASING_FIELDS) out[key] = p[key];
  return out;
}

/**
 * @typedef {Object} PhraseMark
 * @property {number} phrase          전역 프레이즈 번호(1부터)
 * @property {number} chorus          전역 코러스 번호(1부터)
 * @property {number} phraseInChorus  이 코러스 안에서 몇 번째 프레이즈인가(1부터)
 * @property {number} rowInPhrase     이 프레이즈 안에서 몇 번째 마디인가(1부터)
 * @property {string} phraseColor
 * @property {string} chorusColor
 * @property {boolean} isPhraseStart
 * @property {boolean} isPhraseEnd
 * @property {boolean} isChorusStart
 * @property {boolean} isChorusEnd
 * @property {string} tag            `코러스-프레이즈` 두 자리 꼬리표(예: `2-1`). 마디 이름 아래 붙는다
 */

/**
 * 이 마디가 어느 프레이즈·코러스인가. **꺼져 있거나 시작 마디 앞이면 null** 이다(intro 행 row 0 포함).
 *
 * ⚠ 여기서 normalizePhrasing 을 부르지 않는다 — 보드의 모든 행마다 불리는 함수라 매번 객체를 만들면
 *   행 수만큼 쓰레기가 생긴다. 대신 읽는 값마다 그 자리에서 최소한으로 방어한다.
 * @param {number} row  보드의 행 번호(0 = intro)
 * @param {Phrasing|null|undefined} phrasing
 * @returns {PhraseMark|null}
 */
export function phraseMark(row, phrasing) {
  const p = phrasing && typeof phrasing === 'object' ? phrasing : null;
  if (!p || p.on !== true) return null;
  if (!Number.isFinite(row)) return null;

  const rowsPerPhrase = intIn(p.rowsPerPhrase, DEFAULT_PHRASING.rowsPerPhrase, 1, ROWS_PER_PHRASE_MAX);
  const phrasesPerChorus = intIn(p.phrasesPerChorus, DEFAULT_PHRASING.phrasesPerChorus, 1, PHRASES_PER_CHORUS_MAX);
  const startRow = intIn(p.startRow, DEFAULT_PHRASING.startRow, 1, 9999);

  const offset = Math.floor(row) - startRow;
  if (offset < 0) return null;                       // intro 와 시작 전 마디는 어느 프레이즈도 아니다

  const phrase = Math.floor(offset / rowsPerPhrase);
  const rowInPhrase = offset - phrase * rowsPerPhrase;
  const chorus = Math.floor(phrase / phrasesPerChorus);
  const phraseInChorus = phrase - chorus * phrasesPerChorus;

  return {
    phrase: phrase + 1,
    chorus: chorus + 1,
    phraseInChorus: phraseInChorus + 1,
    rowInPhrase: rowInPhrase + 1,
    phraseColor: PHRASE_COLORS[phrase % PHRASE_COLORS.length],
    chorusColor: CHORUS_COLORS[chorus % CHORUS_COLORS.length],
    isPhraseStart: rowInPhrase === 0,
    isPhraseEnd: rowInPhrase === rowsPerPhrase - 1,
    isChorusStart: rowInPhrase === 0 && phraseInChorus === 0,
    isChorusEnd: rowInPhrase === rowsPerPhrase - 1 && phraseInChorus === phrasesPerChorus - 1,
    tag: `${chorus + 1}-${phraseInChorus + 1}`
  };
}

/**
 * 지금 설정이 이 안무표를 어떻게 자르는지 한 줄로. 설정 화면이 "무슨 일이 일어날지"를 미리 말하는 데 쓴다.
 * @param {Phrasing} phrasing
 * @param {number} rows  보드의 마지막 행 인덱스(= 마디 수. board.rows 와 같은 의미)
 * @returns {string}
 */
export function phrasingSummary(phrasing, rows) {
  const p = normalizePhrasing(phrasing);
  const perChorus = p.rowsPerPhrase * p.phrasesPerChorus;
  const usable = Math.max(0, (Number(rows) || 0) - p.startRow + 1);
  const choruses = Math.ceil(usable / perChorus);
  const from = p.startRow > 1 ? `${p.startRow}마디부터 ` : '';
  return usable === 0
    ? `${p.startRow}마디부터 세는데 안무표가 거기까지 오지 않습니다.`
    : `${from}한 코러스 = ${perChorus}마디(${p.phrasesPerChorus}프레이즈 × ${p.rowsPerPhrase}마디) · 지금 안무표에 코러스 ${choruses}개`;
}
