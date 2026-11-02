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
const ICON_DELETE = '×';
const FAVORITE_QUICK = '즐겨찾기 (빠른 배치에 표시)';

/**
 * 명령이 아닌 화면 글자 전부. 키 → 글자.
 * @type {Readonly<Record<string, string>>}
 */
export const LABELS = Object.freeze({
  // ── 안무표 블록 팝업 (ui/placementActionPopup) ───────────────────────────
  'block.untitled': '이름 없는 블록',
  'block.pick': '✎ 동작 정하기',
  'block.select': '☐ 선택하기',
  'block.deselect': '☑ 선택 풀기',
  'block.remove': '× 지우기',
  // 블록 양쪽 가장자리 손잡이의 툴팁(ui/placementView, RM-12). 왼쪽은 「위치 이동」이었다(~2026-11-03) — 옮기기는 이제 몸통 끌기다.
  'block.trimStart.title': '시작점 조절',
  'block.resize.title': '길이 조절',

  // ── 루틴 블록 팝업 (ui/routineActionPopup) ────────────────────────────────
  'routineBlock.edit': '✏ 편집',
  'routineBlock.remove': '× 지우기',          // 「× 삭제」였다(~2026-11-02) — 되돌리기로 돌아오니 지우기다. 안무표 블록 팝업과 같은 말

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

  // ── 판본 (ui/projectPanel · usecases/versionCommands, RM-29) — 되돌리기를 타지 않으니 없애는 말은 「삭제」다 ──
  'version.head': '판본',
  'version.snapshot': '+ 판본 뜨기',
  'version.snapshot.title': '지금 안무표를 이름 붙인 판본(A안 · 공연본)으로 한 장 떠 둡니다. 영상과 링크는 판본마다 갈리지 않고 함께 씁니다',
  'version.empty': '아직 판본이 없습니다. 지금 안무표를 판본으로 떠 두면 이것저것 바꿔 본 뒤에도 그 판으로 돌아갑니다.',
  'version.defaultName': '판본 {n}',
  'version.made': '「{label}」 판본을 떠 두었습니다.',
  'version.opened': '「{label}」 판본을 열었습니다.',
  'version.deleted': '「{label}」 판본을 삭제했습니다.',
  'version.open': '이 판 열기',
  'version.open.title': '이 판의 안무표를 지금 안무표로 엽니다. 되돌리기는 이 판에서 다시 시작합니다',
  'version.open.unkept.title': '지금 안무표는 어느 판본에도 떠 두지 않았습니다 — 열면 지금 것이 사라지고 되돌리기로도 돌아오지 않습니다. 남기려면 먼저 판본을 뜨세요. 한 번 더 누르면 엽니다',
  'version.base': '◆ 지금 이 판에서',
  'version.base.title': '지금 안무표가 이 판에서 갈라져 나왔습니다. 새로 뜨는 판본의 부모가 됩니다',
  'version.counts': '{bars}마디 · 블록 {blocks}',
  'version.parent': '← {label}',
  'version.parent.gone': '← 삭제한 판본',
  'version.edit.title': '판본의 이름 · 메모를 고칩니다',
  'version.field.name': '이름',
  'version.field.note': '메모',
  'version.name.placeholder': 'A안 · 공연본',
  'version.note.placeholder': '한 줄 — 끝 8마디를 바꿈',
  'version.delete': '판본 삭제',
  'version.delete.title': '이 판본을 삭제합니다 — 되돌릴 수 없습니다. 이 판에서 갈라진 판본과 이 판을 가리키는 기록은 그대로 남습니다',

  // ── 연습 기록 (ui/practiceLogView · ui/projectPanel, RM-29) ────────────────
  'log.head': '연습 기록',
  'log.add': '+ 연습 기록',
  'log.add.title': '오늘 한 연습을 한 줄 적습니다. 연습기에 마디 반복 구간이 걸려 있으면 그 구간과 배속이 채워집니다',
  'log.empty': '아직 연습 기록이 없습니다. 연습한 날마다 구간 · 속도 · 몇 번 깨끗했는지를 한 줄씩 적으면 나아진 것이 보입니다.',
  'log.take': '이 테이크 기록',
  'log.take.title': '이 영상과 찍은 날을 채운 연습 기록을 엽니다',
  'log.noDate': '날짜 없음',
  'log.edit.title': '이 기록을 고칩니다',
  'log.field.date': '날짜',
  'log.field.version': '판본',
  'log.field.clip': '영상',
  'log.field.scope': '구간',
  'log.field.speed': '속도',
  'log.field.runs': '깨끗/시도',
  'log.field.rating': '별점',
  'log.field.trouble': '걸린 자리',
  'log.field.note': '메모',
  'log.none': '—',
  'log.versionGone': '삭제한 판본',
  'log.scope.placeholder': '8x3 ~ 8x4',
  'log.scope.bad': '구간을 읽지 못했습니다 — 8x3 · 8x3 ~ 8x4 · 8x3의 3카운트 꼴로 적어 주세요.',
  'log.bpm.placeholder': 'BPM',
  'log.trouble.placeholder': '8x3에서 늦음',
  'log.note.placeholder': '한 줄 — 거울 앞 · 무릎이 아픔',
  'log.save': '기록 적기',
  'log.cancel': '닫기',
  'log.delete': '기록 삭제',
  'log.delete.title': '이 기록을 삭제합니다 — 되돌릴 수 없습니다',

  // ── 여러 자리가 같이 쓰는 것 ──────────────────────────────────────────────
  'icon.delete': ICON_DELETE,
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
