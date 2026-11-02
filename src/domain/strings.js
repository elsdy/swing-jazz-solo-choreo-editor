// src/domain/strings.js — 라벨 문자열 표 (순수 데이터, import 0개)
//
// 신설 파일이다(2026-11-02, RM-10). **명령이 아닌** 화면 글자 — 팝업 줄 · 목록의 지우기 단추 · 툴팁 · 플레이스홀더 ·
// 그 글자를 인용하는 안내 문장 — 의 주인이 이 표 하나다. ui · input 이 모두 읽을 수 있게 안쪽(domain)에 둔다
// (ui 안에 두면 input 이 못 읽는다 — 둘은 서로 import 하지 않는다).
//
// ⚠ **명령의 글자는 여기 없다.** 단추 글자 · 라벨 · 툴팁 몸말의 주인은 `domain/commands.js` 의 COMMANDS 다(RM-09).
//   같은 글자를 두 표에 적지 않는다 — 안내 문장이 명령 이름을 인용해야 하면 `{save}` 같은 구멍을 두고 부르는 쪽이
//   `commandById('saveProject').button` 을 채운다.
// ⚠ 값에 든 `{이름}` 은 구멍이다 — `fill(key, { 이름: 값 })` 이 채운다. 구멍 밖의 글자는 그대로 화면에 뜬다.
// ⚠ 마크업에 글자를 남긴 정적 단추는 `data-label="<키>"`(글자) · `data-title="<키>"`(툴팁) 를 달아 이 표를 가리킨다.
//   부팅 때 채우지 않는다 — 스크립트가 늦거나 깨져도 빈 단추가 뜨지 않게. 둘이 같은지는 시험이 본다
//   (tests/unit/strings.test.mjs 「마크업의 data-label 버튼」). 글자를 바꾸면 **표와 마크업을 함께** 고친다.
// ⚠ 키는 갈래.대상(.title) 꼴이다. 키를 바꾸면 부르는 자리를 모두 고친다 — 없는 키는 `str` 이 던진다(조용히
//   `undefined` 를 그리지 않는다, 원칙 D-14). src 가 부르는 키가 모두 표에 있는지도 시험이 센다.
// ⚠ 낱말의 뜻은 docs/GLOSSARY.md 가 정한다 — 되돌릴 수 있으면 「지우기」, 없으면 「삭제」.

// 자주 인용되는 단추 글자 — 안내 문장이 같은 글자를 두 번 적지 않게 여기서 한 번만.
const VIDEO_IN = '[ 시작점 지금 여기';      // 「[ In 지금 여기」였다(~2026-11-02) — 용어집: 찍는 단추는 긴 말, 시각 표시는 In · Out
const VIDEO_OUT = '끝점 ] 지금 여기';
const FAVORITE_QUICK = '즐겨찾기 (빠른 배치에 표시)';

/**
 * 명령이 아닌 화면 글자 전부. 키 → 글자.
 * @type {Readonly<Record<string, string>>}
 */
export const LABELS = Object.freeze({
  // ── 안무표 블록 팝업 (ui/placementActionPopup) ───────────────────────────
  'block.untitled': '이름 없는 블록',
  // 아래 단추 글자는 그림 글자 없이 적는다 — 그림은 부르는 자리가 iconLabel 로 붙인다(RM-18, 개발 원칙 U-18)
  'block.pick': '동작 정하기',
  'block.select': '선택하기',
  'block.deselect': '선택 풀기',
  'block.remove': '지우기',
  // 블록 양쪽 가장자리 손잡이의 툴팁(ui/placementView, RM-12). 왼쪽은 「위치 이동」이었다(~2026-11-03) — 옮기기는 이제 몸통 끌기다.
  'block.trimStart.title': '시작점 조절',
  'block.resize.title': '길이 조절',

  // ── 루틴 블록 팝업 (ui/routineActionPopup) ────────────────────────────────
  'routineBlock.edit': '편집',
  'routineBlock.remove': '지우기',            // 「× 삭제」였다(~2026-11-02) — 되돌리기로 돌아오니 지우기다. 안무표 블록 팝업과 같은 말

  // ── 영상 구간 — ④ 구간 잡고 잘라내기 (index.html data-label · ui/videoPanel) ──
  'video.in': VIDEO_IN,
  'video.in.title': '지금 영상 시각을 구간의 시작점으로 찍습니다',
  'video.out': VIDEO_OUT,
  'video.out.title': '지금 영상 시각을 구간의 끝점으로 찍습니다',
  'video.inout.empty': `영상을 보다가 구간의 시작에서 \`${VIDEO_IN}\`, 끝에서 \`${VIDEO_OUT}\` 를 누르세요. 재생 중이든 멈춘 채든 지금 시각이 찍힙니다.`,
  'video.inout.range': 'In {in} · Out {out} · 길이 {len}초',
  'video.inout.looping': ' · 구간 반복 중',
  'video.inout.needOut': 'In {in} — 이제 구간의 끝점을 찍으세요.',
  'video.inout.needIn': 'Out {out} — 이제 구간의 시작점을 찍으세요.',

  // ── 파일 메뉴 — 어디에 담기는가 한 줄 (ui/fileMenu). {save} 는 saveProject 명령의 단추 글자 ──
  'file.untitled': '제목 없는 안무',
  'file.note.conflict': '⚠ 담기를 멈췄습니다 — `{what}` 이 다른 탭이나 기기에서 바뀌었습니다. 덮어쓰지 않았습니다. '
    + '저쪽 것을 쓰려면 새로고침하고, 지금 화면의 것을 지키려면 이름을 바꿔 `{save}` 를 누르세요.',
  'file.note.newer': '⚠ 담기를 멈췄습니다 — `{what}` 가 더 새 판의 앱에서 담긴 것이라 열지 못했습니다. '
    + '페이지를 새로고침하면 최신 앱으로 열립니다. 그 파일은 건드리지 않았습니다.',
  'file.note.failed': '⚠ 이 브라우저에 담지 못하고 있습니다 — 저장 공간이 찼거나 저장소가 막혔습니다. '
    + '새로고침하면 지금 화면의 것이 사라질 수 있으니 `{save}` 로 파일을 받아 두세요.',
  'file.note.browser': '이 브라우저에만 담기고 있습니다 — 보관 폴더에 쌓으려면 로컬 서버로 열고, 파일로 받으려면 아래 `{save}`.',
  'file.note.bound': '보관 폴더의 `{bound}.json` 에 자동으로 담기고 있습니다. 덮어쓰기 전 판은 왼쪽 `파일` 서랍의 `지난 판` 에서 되살립니다.',
  'file.note.unbound': '아직 임시 칸(`_작업중`)에 담기고 있습니다 — `{save}` 를 한 번 누르면 그 이름의 파일로 옮겨 갑니다.',

  // ── 파일 서랍의 최근 목록 셋 (ui/savedListsView) — 휴지통 · 목록에서 없애는 것이라 「삭제」다 ──
  'saved.delete': '삭제',
  'saved.delete.projectHint': '목록에서 지웁니다. 서버로 열었다면 보관 폴더의 파일도 함께 지워집니다 — 되돌릴 수 없습니다.',

  // ── 동작 목록 (ui/paletteView) ───────────────────────────────────────────
  'move.menu.rename': '이름 변경',
  'move.menu.category': '카테고리: {label}',
  'move.menu.delete': '지우기',               // 「삭제」였다(~2026-11-02) — 토스트의 되돌리기로 돌아온다
  'move.rename.title': '동작 이름 변경',
  'move.categoryKey.title': '카테고리 키 변경',
  'move.card.drag': '{name} 드래그',
  'move.card.menuHint': '더블클릭, 우클릭 또는 길게 눌러 메뉴 열기',
  'move.card.delete.title': '지우기',

  // ── 카테고리 관리 (ui/categoryView) ──────────────────────────────────────
  'category.color.title': '색상 변경',
  'category.name.placeholder': '카테고리 이름',
  'category.delete.title': '카테고리 지우기',  // 「카테고리 삭제」였다(~2026-11-02)

  // ── 루틴 목록 (ui/routineListView) ───────────────────────────────────────
  'routine.swatch.title': '색 {n}',
  'routine.color.title': '루틴 색 바꾸기',
  'routine.name.title': '루틴 이름',
  'routine.favorite.title': '즐겨찾기',
  'routine.edit.title': '루틴 편집',
  'routine.delete.title': '루틴 지우기',       // 「루틴 삭제」였다(~2026-11-02)

  // ── 링크 줄의 커스텀 링크 (ui/linksBarView) ───────────────────────────────
  'link.open.title': '새 창에서 열기',
  'link.label.placeholder': '레이블',
  'link.url.placeholder': 'URL 입력...',
  'link.delete.title': '지우기',              // 「삭제」였다(~2026-11-02)

  // ── 말로 채우기의 결과 문장 꼬리 (ui/composeView) ─────────────────────────
  'compose.undoHint': '되돌리기(Ctrl/Cmd+Z)로 되돌릴 수 있습니다.',   // 「Undo 로 …」였다(~2026-11-02). undo 글쇠는 고정이라 적어도 거짓이 되지 않는다

  // ── 파트(섹션) — 마디 이름 칸의 띠 · 마디 메뉴 · 파트 팝업 (ui/partView · ui/rowActionPopup · app/render, RM-23) ──
  'part.menu.new': '파트로 묶기…',
  'part.menu.edit': '파트 고치기…',
  'part.new.title': '새 파트 — {from}마디부터',
  'part.pick.range': '{from}~{to}마디 — 다른 마디 이름을 누르면 끝이 바뀝니다',
  'part.edit.title': '{name} 파트 — {from}~{to}마디',
  'part.name.label': '이름',
  'part.name.placeholder': 'A파트 · 인트로 · 브레이크',
  'part.end.label': '끝 마디',
  'part.color.label': '색',
  'part.create': '파트로 묶기',
  'part.apply': '이름 · 끝 · 색 바꾸기',
  'part.fold': '접기',
  'part.unfold': '펴기',
  'part.repeat': '한 번 더',
  'part.moveUp': '파트를 위로',
  'part.moveDown': '파트를 아래로',
  'part.remove': '파트 지우기',
  'part.removed': '파트를 지웠습니다 — 마디와 블록은 그대로입니다.',
  'part.emptySummary': '빈 파트',
  'part.label.title': '{name} 파트 ({from}~{to}마디) — 누르면 접고, 우클릭 · 길게 누르면 고칩니다',
  'part.label.titleFolded': '{name} 파트가 접혀 있습니다({from}~{to}마디) — 누르면 폅니다',

  // ── 여러 자리가 같이 쓰는 것 ──────────────────────────────────────────────
  'favorite.quickPlace.title': FAVORITE_QUICK,
});

/**
 * 표의 글자. 없는 키는 던진다 — 오타가 빈 단추로 조용히 지나가지 않게.
 * @complexity time=O(1) space=O(1) cc=2
 * @param {string} key
 * @returns {string}
 */
export function str(key) {
  const value = LABELS[key];
  if (value === undefined) throw new Error(`라벨 표에 없는 키: ${key}`);
  return value;
}

/**
 * 구멍(`{이름}`)을 채운 글자. 주지 않은 구멍은 그대로 남긴다(무엇이 빠졌는지 화면에서 보이게).
 * @complexity time=O(n) space=O(n) cc=3
 * @param {string} key
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
export function fill(key, vars) {
  const src = vars && typeof vars === 'object' ? vars : {};
  return str(key).replace(/\{(\w+)\}/g, (hole, name) => (name in src ? String(src[name]) : hole));
}
