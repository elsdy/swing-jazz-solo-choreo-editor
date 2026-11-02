// src/domain/themes.js — 고를 수 있는 화면 테마의 목록 (순수, 의존성 0)
//
// 2026-09-21 신설. **목록의 주인은 여기 하나다** — 설정 화면도 부팅 코드도 이 표를 읽는다.
// 테마를 하나 더하는 일이 "여기 한 줄 + CSS 한 블록"으로 끝나야 한다.
//
// ⚠ 기본값(`basic`)은 **표식을 쓰지 않는다**(`<html>` 에 data-theme 이 붙지 않는다). 그래야
//   테마를 한 번도 안 고른 사람의 화면이 이 기능이 들어오기 전과 한 픽셀도 다르지 않다.
// ⚠ 이 브라우저의 취향이라 안무표 파일에 들어가지 않는다(단축키와 같은 규약).
// ⚠ 테마는 **분위기**다(RM-17, 2026-11-02) — 색만 바꾸고 모양(모서리 · 크기 · 글자)은 기본과 한 벌이다.
//   그래서 설명 문구도 색과 분위기만 말한다. 「무엇이 달라 보인다」를 약속하지 않는다.

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
    hint: '깊은 남색에 청록 빛. 작업 차례가 빛나는 길로 이어진다'
  }),
  Object.freeze({
    id: 'rose',
    label: '자정 장미',
    hint: '어두운 자두색에 장미빛. 밤에도 눈이 편하다'
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
