// src/ui/docsRegistry.js — 앱 안에서 읽을 수 있는 문서의 목록. **이 파일이 목록의 유일한 주인이다.**
//
// 문서를 하나 추가한다 = 여기 한 줄을 더한다. 뷰어(docsHub.js)는 이 배열만 읽고,
// 화면 어디에도 문서 목록을 손으로 적지 않는다.
//
// ⚠ 보안: 문서를 읽어 오는 코드는 여기 있는 id 만 받는다. 요청에서 받은 경로로 fetch 하지 않는다.
//    임의 경로를 허용하면 같은 출처의 아무 파일이나 화면에 띄우는 창이 된다.

/**
 * 갈래는 코드 구조가 아니라 **읽는 사람**으로 나눈다.
 * @typedef {'start'|'usage'|'changes'|'dev'} DocGroup
 */
export const DOC_GROUPS = [
  { id: 'start',   label: '시작하기',        hint: '처음 켰다면 여기부터' },
  { id: 'usage',   label: '기능과 사용법',   hint: '그 버튼이 무슨 일을 하는지' },
  { id: 'changes', label: '바뀐 것',         hint: '언제부터 이렇게 됐는지' },
  { id: 'dev',     label: '만드는 사람을 위해', hint: '고치기 전에 읽는 것' },
];

/**
 * @typedef {{ id:string, group:DocGroup, title:string, path:string, desc:string }} DocEntry
 */

/** @type {DocEntry[]} */
export const DOCS = [
  {
    id: 'tutorial',
    group: 'start',
    title: '튜토리얼',
    path: 'docs/TUTORIAL.md',
    desc: '처음 켜서 안무 한 곡을 끝낼 때까지',
  },
  {
    id: 'readme',
    group: 'start',
    title: '프로젝트 소개',
    path: 'README.md',
    desc: '이 도구가 무엇이고 어떻게 실행하는지',
  },
  {
    id: 'features',
    group: 'usage',
    title: '기능 설명서',
    path: 'docs/FEATURES.md',
    desc: '기능마다 무엇을 하는지·어디에 있는지·어떻게 쓰는지',
  },
  {
    id: 'history',
    group: 'changes',
    title: '개발 이력',
    path: 'docs/HISTORY.md',
    desc: 'PR 마다 사용자 눈에 무엇이 달라졌는지',
  },
  {
    id: 'roadmap',
    group: 'changes',
    title: '로드맵',
    path: 'docs/ROADMAP.md',
    desc: '앞으로 무엇을 만들고, 무엇을 안 하기로 했는지',
  },
  {
    id: 'architecture',
    group: 'dev',
    title: '아키텍처',
    path: 'docs/ARCHITECTURE.md',
    desc: '계층과 의존 규칙, 상태가 화면에 닿는 경로',
  },
  {
    id: 'ports',
    group: 'dev',
    title: '포트 계약',
    path: 'docs/PORTS.md',
    desc: '동영상·시퀀스 엔진·버전 저장소가 들어올 자리',
  },
  {
    id: 'principles',
    group: 'dev',
    title: '개발 원칙',
    path: 'docs/PRINCIPLES.md',
    desc: '버그 기록에서 뽑아낸 재발 방지 규칙 25개',
  },
  {
    id: 'bugs',
    group: 'dev',
    title: '버그 기록',
    path: 'docs/BUG_REPORTS.md',
    desc: '무엇이 왜 그렇게 됐는지. 원칙의 근거',
  },
  {
    id: 'deviations',
    group: 'dev',
    title: '일부러 두고 온 것',
    path: 'docs/deviations.md',
    desc: '재구성에서 고치지 않은 원본 동작과 그 이유',
  },
  {
    id: 'claude',
    group: 'dev',
    title: '개발 지침',
    path: 'CLAUDE.md',
    desc: '이 저장소에서 작업할 때의 규칙',
  },
];

const BY_ID = new Map(DOCS.map(d => [d.id, d]));

/**
 * 등록부에 있는 id 만 해석한다. 그 밖은 null — 이것이 경로 주입을 막는 유일한 관문이다.
 * @param {string} id
 * @returns {DocEntry|null}
 */
export function resolveDoc(id) {
  return BY_ID.get(String(id)) || null;
}

/** 갈래별로 묶은 목록. 등록부의 순서를 그대로 지킨다. */
export function docsByGroup() {
  return DOC_GROUPS.map(g => ({ ...g, docs: DOCS.filter(d => d.group === g.id) }));
}

/** 문서끼리 거는 링크(`[…](PRINCIPLES.md#r-1)`)의 파일 이름을 등록부 id 로 되돌린다. */
export function idForFileName(fileName) {
  const name = String(fileName).replace(/^.*\//, '');
  const hit = DOCS.find(d => d.path.replace(/^.*\//, '') === name);
  return hit ? hit.id : null;
}

export const DEFAULT_DOC_ID = 'tutorial';
