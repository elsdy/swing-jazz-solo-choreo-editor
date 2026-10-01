// src/domain/commands.js — 명령 등록부 (순수 데이터, import 0개)
//
// 신설 파일이다(2026-10-01, RM-09). 그전에는 한 명령이 세 곳에 따로 적혀 있었다 — 단축키의 이름 · 설명 ·
// 기본 글쇠는 `domain/hotkeys.js` 의 표에, 글쇠를 어느 커맨드에 이을지는 `input/controls.js` 의
// `HOTKEY_COMMANDS` 에, 버튼의 글자는 `index.html` 에. 이름으로 잇는 배선이라 하나만 빠져도 그 글쇠는
// **말없이** 아무 일도 하지 않았다(2026-09-20~22 의 스페이스, 원칙 D-14).
//
// 이제 명령마다 **한 줄**이다 — id · 라벨 · 설명 · 기본 글쇠 · 버튼 글자 · 갈래. 단축키 표(`hotkeys.js` 의
// `HOTKEY_ACTIONS`)는 이 표에서 글쇠가 있는 줄만 골라 **파생**하고, 실행은 `app/main.js` 의 `COMMAND_RUNNERS`
// 가 같은 id 로 잇는다. 버튼은 마크업에 `data-command="<id>"` 를 달아 이 표를 가리킨다.
//
// ⚠ 실행 함수를 여기 넣지 않는다. 도메인은 유스케이스를 모른다 — 실행의 주인은 조립 층(app)이다.
// ⚠ `id` 는 **저장되는 이름**이다. 사용자가 바꾼 글쇠가 `{id: 글쇠[]}` 로 이 브라우저에 담긴다 —
//   id 를 바꾸면 옛 설정이 말없이 기본값으로 돌아간다. 바꿀 일이 생기면 옮김 규칙을 함께 둔다.
// ⚠ 줄의 **차례가 뜻을 갖는다.** 한 글쇠가 두 명령에 걸리면 앞의 줄이 이긴다(hotkeys.normalizeHotkeys).

/**
 * @typedef {Object} CommandDef
 * @property {string} id         저장 · 배선 · `data-command` 가 함께 쓰는 이름
 * @property {string} label      설정 · 일람 · 팔레트에 나가는 이름
 * @property {string} hint       무엇을 하는지 한 줄
 * @property {string[]} keys     기본 글쇠(여럿이면 전부 듣는다). 없으면 `[]` — 버튼 · 팔레트로만 부른다
 * @property {string[]} [alsoKeys] 화면에 적지 않고 함께 듣는 글쇠(관례가 둘인 조합). 고정 명령에만 쓴다
 * @property {boolean} fixed     글쇠를 바꿀 수 없는가
 * @property {boolean} whileTyping 글자를 치는 중(입력칸 · 글상자)에도 듣는가
 * @property {string} [button]   버튼에 쓰는 글자. 없으면 버튼이 없는 명령이다
 * @property {string} [title]    버튼의 툴팁 몸말. 없으면 라벨. 지금 글쇠는 commandTitle 이 뒤에 붙인다
 */

/** @param {CommandDef} c */
const def = (c) => Object.freeze({
  ...c,
  keys: Object.freeze([...(c.keys || [])]),
  alsoKeys: Object.freeze([...(c.alsoKeys || [])]),
  whileTyping: !!c.whileTyping,
});

/**
 * 이 앱의 명령 전부.
 *
 * ⚠ `undo`·`redo` 는 고정이다. OS 관례(`Ctrl/Cmd+Z`)를 바꾸면 손이 먼저 틀리고, 되돌리기를
 *   잘못 눌러 잃는 것이 가장 비싸다.
 * ⚠ `stop` 도 고정이다. 이 앱에서 `Escape` 한 글쇠에 두 뜻이 걸려 있고(받는 중이면 받아 적기를 끝내고,
 *   아니면 고른 동작을 푼다) 브라우저·OS 가 먼저 가져가는 경우도 있다.
 * ⚠ 글자를 치는 중에도 듣는 것(`whileTyping`)은 셋뿐이다 — `Escape` 와 Ctrl 조합 둘. 홑글쇠가 입력칸에서
 *   먹으면 동작 이름을 치는 동안 블록이 쌓인다. Ctrl+Z 가 입력칸에서도 안무표를 되돌리는 것은 일부러
 *   두고 온 결함이다(docs/deviations.md #11).
 * @type {readonly CommandDef[]}
 */
export const COMMANDS = Object.freeze([
  def({
    id: 'capture',
    label: '받아 적기 · 여기서 끊기',
    hint: '동작이 바뀌는 자리마다 한 번. 앞 구간이 놓이고 그 자리에서 다음이 열린다',
    keys: ['B', 'K'],
    fixed: false,
  }),
  def({
    id: 'skip',
    label: '건너뛰기',
    hint: '여기까지는 안무가 아니다(설명·쉬는 시간). 앞 구간을 놓지 않고 경계만 옮긴다',
    keys: ['N'],
    fixed: false,
  }),
  def({
    id: 'play',
    label: '재생 · 일시정지',
    hint: '영상 패널이 열려 있을 때 듣는다',
    keys: ['Space'],
    fixed: false,
  }),
  def({
    id: 'stop',
    label: '받아 적기 그만',
    hint: '열려 있던 마지막 구간은 버린다. 받는 중이 아니면 고른 동작을 푼다',
    keys: ['Escape'],
    fixed: true,
    whileTyping: true,
  }),
  def({
    id: 'undo',
    label: '되돌리기',
    hint: 'OS 관례라 바꾸지 않는다',
    keys: ['Ctrl+Z', 'Cmd+Z'],
    fixed: true,
    whileTyping: true,
    button: 'Undo',
  }),
  def({
    id: 'redo',
    label: '다시 하기',
    hint: 'OS 관례라 바꾸지 않는다',
    keys: ['Ctrl+Y', 'Cmd+Shift+Z'],
    // 예전 글쇠 처리는 Ctrl·Cmd 어느 쪽이든 `Y` 와 `Shift+Z` 를 모두 들었다 — 화면에는 관례 둘만 적는다.
    alsoKeys: ['Ctrl+Shift+Z', 'Cmd+Y'],
    fixed: true,
    whileTyping: true,
    button: 'Redo',
  }),
]);

/** id → 명령. 없는 id 는 `undefined`. */
const BY_ID = new Map(COMMANDS.map(c => [c.id, c]));

/**
 * @param {string} id
 * @returns {CommandDef|undefined}
 */
export function commandById(id) {
  return BY_ID.get(id);
}

/**
 * 버튼의 툴팁. 몸말(title, 없으면 라벨)에 지금 글쇠를 붙인다 — 글쇠가 없으면 몸말만.
 * ⚠ 글쇠를 마크업에 손으로 적지 않는다. `(단축키 K 또는 B)` 처럼 적어 두면 설정에서 글쇠를 바꾼 사람에게 거짓말이 된다.
 * @param {CommandDef} cmd
 * @param {string[]} [keys] 지금 글쇠(사용자가 바꾼 것). 없으면 기본 글쇠
 * @returns {string}
 */
export function commandTitle(cmd, keys) {
  if (!cmd) return '';
  const list = Array.isArray(keys) ? keys : cmd.keys;
  const body = cmd.title || cmd.label;
  return list.length ? `${body} (${list.join(' · ')})` : body;
}

/**
 * 실행 표가 등록부와 어긋난 자리. 조립 층이 부팅 때 한 번 부른다(원칙 D-14).
 * @param {Record<string, unknown>} runners id → 실행 함수
 * @returns {{ missing: string[], unknown: string[] }} 등록부에 있는데 실행이 없는 id · 실행만 있고 등록부에 없는 id
 */
export function runnerGaps(runners) {
  const src = runners && typeof runners === 'object' ? runners : {};
  return {
    missing: COMMANDS.filter(c => typeof src[c.id] !== 'function').map(c => c.id),
    unknown: Object.keys(src).filter(id => !BY_ID.has(id)),
  };
}
