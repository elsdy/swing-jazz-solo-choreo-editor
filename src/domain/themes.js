// src/domain/themes.js — 고를 수 있는 화면 테마의 목록 (순수, 의존성 0)
//
// 2026-09-21 신설. **목록의 주인은 여기 하나다** — 설정 화면도 부팅 코드도 이 표를 읽는다.
// 테마를 하나 더하는 일이 "여기 한 줄 + CSS 한 블록"으로 끝나야 한다.
//
// ⚠ 기본값(`basic`)은 **표식을 쓰지 않는다**(`<html>` 에 data-theme 이 붙지 않는다). 그래야
//   테마를 한 번도 안 고른 사람의 화면이 이 기능이 들어오기 전과 한 픽셀도 다르지 않다.
// ⚠ 이 브라우저의 취향이라 안무표 파일에 들어가지 않는다(단축키와 같은 규약).

/** @typedef {{ id: string, label: string, hint: string }} Theme */

/** @type {readonly Theme[]} */
export const THEMES = Object.freeze([
  Object.freeze({
    id: 'basic',
    label: '기본',
    hint: '차분한 남색. 오래 봐도 눈이 편하다'
  }),
  Object.freeze({
    id: 'neon',
    label: '네온 플로우',
    hint: '빛나는 마디와 흐르는 선. 작업 차례가 계기판처럼 보인다'
  }),
  Object.freeze({
    id: 'rose',
    label: '자정 장미',
    hint: '어두운 자두색에 장미빛. 네온과 같은 밝기라 밤에도 눈이 편하다'
  }),
  Object.freeze({
    id: 'candy',
    label: '솜사탕',
    hint: '밝은 파스텔. 분홍과 민트로 환하게 — 유일하게 밝은 테마다'
  })
]);

/** 표식을 붙이지 않는 테마(= 기본). */
export const DEFAULT_THEME = 'basic';

/**
 * 손상된 값·모르는 id 를 기본값으로 흡수한다.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTheme(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  return THEMES.some(t => t.id === id) ? id : DEFAULT_THEME;
}

/**
 * `<html>` 에 쓸 값. 기본 테마면 **빈 문자열**이고, 호출부는 그때 속성을 지운다.
 * @param {unknown} raw
 * @returns {string}
 */
export function themeAttr(raw) {
  const id = normalizeTheme(raw);
  return id === DEFAULT_THEME ? '' : id;
}
