// src/domain/defaults.js — 앱 초기값만 담는다 (순수)
//
// 원본 index.html 의 DEFAULT_COUNT 초기값(1384) · DEFAULT_CATEGORIES(1385-1392) ·
// DEFAULT_MOVES(1444-1456) 를 그대로 옮겼다.
// ⚠ 원본 DEFAULT_MOVES 는 **모듈 로드 시점에 uid() 를 10번** 부른다(1456의 .map). 그대로 두면
//   import 하는 것만으로 Math.random/Date 가 돌아 골든이 비결정적이 되므로 makeDefaultMoves(ids) 팩토리로 바꿨다.

/**
 * 새 배치의 기본 카운트 초기값. 원본은 `let DEFAULT_COUNT = 1`(1384) 인 **가변 모듈 전역**이고
 * 입력창(2373·2376·2377)이 값을 바꾼다. 그 가변 부분은 store 의 몫이고 여기에는 초기값만 둔다.
 * @see index.html:1384
 */
export const DEFAULT_COUNT_INITIAL = 1;

/**
 * 기본 카테고리 사전. 키 삽입 순서가 곧 `categoryNames()` 순서이고,
 * 그 순서를 `applySortToMoves` 의 'category' 모드가 그대로 쓴다 — 순서를 바꾸지 말 것.
 * ⚠ 원본과 마찬가지로 얼리지(freeze) 않았다. 원본 init 은 `structuredClone(DEFAULT_CATEGORIES)`(1399)
 *   로 복제해서 쓴다 — 도메인에서는 `categories.cloneCategories()` 를 대신 쓴다.
 * @see index.html:1385
 * @type {Record<string, { label: string, color: string }>}
 */
export const DEFAULT_CATEGORIES = {
  step: { label: 'step', color: '#22c55e' },
  turn: { label: 'turn', color: '#94a3b8' },
  jump: { label: 'jump', color: '#ef4444' },
  rotate: { label: 'rotate', color: '#3b82f6' },
  shimmy: { label: 'shimmy', color: '#facc15' },
  fall: { label: 'fall', color: '#38bdf8' }
};

/** 원본 1444-1455 의 [이름, 카테고리] 쌍. uid 만 팩토리에서 붙인다. */
const DEFAULT_MOVE_SEEDS = [
  ['Jazz Square', 'step'],
  ['Suzie Q', 'step'],
  ['Charleston', 'step'],
  ['Pivot Turn', 'turn'],
  ['Air Step', 'jump'],
  ['Shimmy', 'shimmy'],
  ['Fall Off Log', 'fall'],
  ['Spin Out', 'rotate'],
  ['Tacky Annie', 'step'],
  ['Boogie Back', 'step']
];

/**
 * 기본 동작 라이브러리를 만든다. uid 를 10번, 위 배열 순서대로 부른다.
 * 키 순서는 원본과 같은 id → name → category.
 * @see index.html:1444
 * @param {(() => string) | { uid: () => string }} ids uid 생성기 (도메인은 uid 를 직접 만들지 않는다)
 * @returns {{ id: string, name: string, category: string }[]}
 */
export function makeDefaultMoves(ids) {
  const nextId = typeof ids === 'function' ? ids : ids.uid;
  return DEFAULT_MOVE_SEEDS.map(([name, category]) => ({ id: nextId(), name, category }));
}
