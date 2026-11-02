// src/ui/docsRegistry.js — 앱 안에서 읽을 수 있는 문서의 목록. **이 파일이 목록의 유일한 주인이다.**
//
// 문서를 하나 추가한다 = 여기 한 줄을 더한다. 뷰어(docsHub.js)는 이 배열만 읽고,
// 화면 어디에도 문서 목록을 손으로 적지 않는다.
//
// ⚠ 보안: 문서를 읽어 오는 코드는 여기 있는 id 만 받는다. 요청에서 받은 경로로 fetch 하지 않는다.
//    임의 경로를 허용하면 같은 출처의 아무 파일이나 화면에 띄우는 창이 된다.

/**
 * 갈래는 코드 구조가 아니라 **읽는 사람**으로 나눈다. 둘뿐이다(2026-11-02, RM-26) — 쓰는 사람이 읽는 「도움말」과
 * 만드는 사람이 읽는 「개발」. 「개발」은 `hidden` 이라 문서 창 목록에서 평소에 접혀 있고, 문서끼리의 링크 · 주소로는 열린다.
 * 그전의 넷(시작하기 · 기능과 사용법 · 바뀐 것 · 만드는 사람을 위해)은 사용자가 읽을 글을 개발용 글 사이에 묻었다.
 * @typedef {'help'|'dev'} DocGroup
 */
export const DOC_GROUPS = [
  { id: 'help', label: '도움말', hint: '쓰는 사람이 읽는 것 — 튜토리얼 · 기능 · 바뀐 것' },
  { id: 'dev',  label: '개발',   hint: '만드는 사람이 읽는 것 — 고치기 전에', hidden: true },
];

/**
 * @typedef {{ id:string, group:DocGroup, title:string, path:string, desc:string }} DocEntry
 */

/** @type {DocEntry[]} */
export const DOCS = [
  {
    id: 'tutorial',
    group: 'help',
    title: '튜토리얼',
    path: 'docs/TUTORIAL.md',
    desc: '처음 켜서 안무 한 곡을 끝낼 때까지',
  },
  {
    id: 'readme',
    group: 'help',
    title: '프로젝트 소개',
    path: 'README.md',
    desc: '이 도구가 무엇이고 어떻게 실행하는지',
  },
  {
    id: 'features',
    group: 'help',
    title: '기능 설명서',
    path: 'docs/FEATURES.md',
    desc: '기능마다 무엇을 하는지·어디에 있는지·어떻게 쓰는지',
  },
  {
    id: 'glossary',
    group: 'help',
    title: '용어집',
    path: 'docs/GLOSSARY.md',
    desc: '화면 낱말의 뜻 — 지우기와 삭제, 구간과 마디 반복, 내보내기와 저장을 가른다',
  },
  {
    id: 'history',
    group: 'help',
    title: '개발 이력',
    path: 'docs/HISTORY.md',
    desc: 'PR 마다 사용자 눈에 무엇이 달라졌는지',
  },
  {
    id: 'roadmap',
    group: 'dev',
    title: '로드맵',
    path: 'docs/ROADMAP.md',
    desc: '다음·그다음·나중 — 무엇을 왜 만들고, 지금 어디까지 왔는지',
  },
  {
    id: 'decisions',
    group: 'dev',
    title: '결정 기록',
    path: 'docs/DECISIONS.md',
    desc: '사람이 정해야 했던 것과 그 까닭 · 버린 선택지',
  },
  {
    id: 'editing-flows',
    group: 'dev',
    title: '편집 흐름',
    path: 'docs/EDITING_FLOWS.md',
    desc: '안무표를 채우는 길 스무 가지와, 그중 막힌 것을 여는 계획',
  },
  {
    id: 'video-to-chart',
    group: 'dev',
    title: '영상에서 안무표로',
    path: 'docs/VIDEO_TO_CHART.md',
    desc: '영상을 연 뒤의 순서 — 간격·기준·범위 셋을 가르는 계획',
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
    desc: '동영상 재생기의 계약, 시퀀스 엔진·버전 저장소가 들어올 자리',
  },
  {
    id: 'principles',
    group: 'dev',
    title: '개발 원칙',
    path: 'docs/PRINCIPLES.md',
    desc: '버그 기록에서 뽑아낸 재발 방지 규칙 44개',
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
  {
    id: 'examples',
    group: 'dev',
    title: '예제 안무',
    path: 'examples/README.md',
    desc: '`예제 열기` 가 여는 안무표 파일과 그 모양(RM-26)',
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

/** 갈래별로 묶은 목록. 등록부의 순서를 그대로 지킨다. 숨긴 갈래도 돌려준다 — 접을지는 뷰가 `hidden` 을 보고 정한다. */
// @complexity time=O(g·d) space=O(d) cc=1
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
