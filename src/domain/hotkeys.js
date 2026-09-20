// src/domain/hotkeys.js — 단축키 (순수 함수, import 0개)
//
// 신설 파일이다(2026-09-20). 그전에는 글쇠가 `input/controls.js` 안에 문자열로 박혀 있었다
// (`key === 'b'`, `key === 'n'` …). 바꾸려면 코드를 고쳐야 했고, 어떤 글쇠가 쓰이는지 알려면
// 그 파일을 읽어야 했다 — 화면 어디에도 목록이 없었다.
//
// 여기서 정하는 것은 **무엇을 할 수 있고 기본 글쇠가 무엇인가** 하나다. 실제로 듣는 것은
// `input/controls.js` 이고, 고르는 화면은 `ui/settingsView.js` 이고, 어디에 담는지는
// `app/main.js` 가 정한다. 이 파일은 그 셋이 같은 표를 보게 하는 자리다.
//
// ⚠ 이 파일은 `KeyboardEvent` 를 **받지 않는다.** 이벤트는 브라우저의 것이고 도메인은 그것을
//   모른다 — 호출부가 `{key, code, ctrl, meta, alt, shift}` 로 풀어서 넘긴다(eventKey 참고).
// ⚠ 글쇠 이름은 **화면에 그대로 나가는 글자**다(`Space`, `B`, `Escape`). 바꾸면 설정 화면과
//   안내 문구가 함께 달라진다.

/**
 * @typedef {Object} HotkeyAction
 * @property {string} id      커맨드 쪽 이름. 저장 파일의 키이기도 하다
 * @property {string} label   설정 화면에 나가는 이름
 * @property {string} hint    무엇을 하는지 한 줄
 * @property {string[]} keys  기본 글쇠(여럿이면 전부 듣는다)
 * @property {boolean} fixed  바꿀 수 없는가. 참이면 목록에 보이기만 한다
 */

/**
 * 이 앱이 듣는 글쇠 전부. **여기 없는 글쇠는 앱이 듣지 않는다.**
 *
 * ⚠ `Undo`·`Redo` 는 고정이다. OS 관례(`Ctrl/Cmd+Z`)를 바꾸면 손이 먼저 틀리고, 되돌리기를
 *   잘못 눌러 잃는 것이 가장 비싸다.
 * ⚠ `Escape` 도 고정이다. 이 앱에서 한 글쇠에 두 뜻이 걸려 있고(받는 중이면 받아 적기를 끝내고,
 *   아니면 고른 동작을 푼다) 브라우저·OS 가 먼저 가져가는 경우도 있다.
 * @type {readonly HotkeyAction[]}
 */
export const HOTKEY_ACTIONS = Object.freeze([
  Object.freeze({
    id: 'capture',
    label: '받아 적기 · 여기서 끊기',
    hint: '동작이 바뀌는 자리마다 한 번. 앞 구간이 놓이고 그 자리에서 다음이 열린다',
    keys: Object.freeze(['B', 'K']),
    fixed: false
  }),
  Object.freeze({
    id: 'skip',
    label: '건너뛰기',
    hint: '여기까지는 안무가 아니다(설명·쉬는 시간). 앞 구간을 놓지 않고 경계만 옮긴다',
    keys: Object.freeze(['N']),
    fixed: false
  }),
  Object.freeze({
    id: 'play',
    label: '재생 · 일시정지',
    hint: '영상 패널이 열려 있을 때 듣는다',
    keys: Object.freeze(['Space']),
    fixed: false
  }),
  Object.freeze({
    id: 'stop',
    label: '받아 적기 그만',
    hint: '열려 있던 마지막 구간은 버린다. 받는 중이 아니면 고른 동작을 푼다',
    keys: Object.freeze(['Escape']),
    fixed: true
  }),
  Object.freeze({
    id: 'undo',
    label: '되돌리기',
    hint: 'OS 관례라 바꾸지 않는다',
    keys: Object.freeze(['Ctrl+Z', 'Cmd+Z']),
    fixed: true
  }),
  Object.freeze({
    id: 'redo',
    label: '다시 하기',
    hint: 'OS 관례라 바꾸지 않는다',
    keys: Object.freeze(['Ctrl+Y', 'Cmd+Shift+Z']),
    fixed: true
  })
]);

/** 바꿀 수 있는 것만. 설정 화면이 이 순서로 줄을 세운다. */
export const EDITABLE_ACTIONS = Object.freeze(HOTKEY_ACTIONS.filter(a => !a.fixed));

/** `{id: keys[]}` 기본값. */
export const DEFAULT_HOTKEYS = Object.freeze(
  Object.fromEntries(HOTKEY_ACTIONS.map(a => [a.id, a.keys]))
);

/** 한 동작에 붙일 수 있는 글쇠의 수. 넘으면 목록이 읽히지 않고, 하나도 없으면 못 쓰는 동작이 된다. */
export const MAX_KEYS_PER_ACTION = 3;

/**
 * 받아 줄 수 없는 글쇠. 브라우저·OS 가 먼저 가져가거나, 이 앱이 이미 다른 뜻으로 쓴다.
 * ⚠ 소문자 비교다(normalizeKey 를 거친 뒤 대조한다).
 */
const RESERVED = Object.freeze(['escape', 'tab', 'enter', 'backspace', 'delete', 'meta', 'control', 'alt', 'shift']);

/**
 * 브라우저 이벤트에서 뽑은 날값을 **화면에 그대로 나가는 글쇠 이름**으로 만든다.
 *
 * ```
 *   ' '  → 'Space'      'b' → 'B'       'ArrowLeft' → 'ArrowLeft'
 *   ctrl+z → 'Ctrl+Z'   meta+shift+z → 'Cmd+Shift+Z'
 * ```
 *
 * ⚠ 조합은 **Ctrl → Cmd → Alt → Shift** 차례로 붙인다. 순서를 섞으면 같은 조합이 두 이름을
 *   갖게 되어 저장된 값과 비교가 어긋난다.
 * ⚠ `Cmd` 다(`Meta` 가 아니다). 화면에 나가는 글자이고 맥 사용자가 자판에서 보는 이름이다.
 *
 * @param {{key?: string, ctrl?: boolean, meta?: boolean, alt?: boolean, shift?: boolean}} raw
 * @returns {string} 못 읽으면 빈 문자열
 */
export function normalizeKey(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let base = typeof src.key === 'string' ? src.key : '';
  if (!base) return '';
  if (base === ' ' || base.toLowerCase() === 'spacebar' || base.toLowerCase() === 'space') base = 'Space';
  else if (base.length === 1) base = base.toUpperCase();
  // 그 밖(Escape·ArrowLeft·F5 …)은 브라우저가 주는 이름을 그대로 쓴다.
  const parts = [];
  if (src.ctrl) parts.push('Ctrl');
  if (src.meta) parts.push('Cmd');
  if (src.alt) parts.push('Alt');
  // ⚠ Shift 는 **조합으로만** 센다. 홑글쇠의 대문자화는 위에서 이미 했고, `Shift+B` 와 `B` 를
  //   다른 것으로 두면 대문자로 친 사람이 아무것도 못 누르는 일이 생긴다.
  if (src.shift && parts.length > 0) parts.push('Shift');
  parts.push(base);
  return parts.join('+');
}

/**
 * `KeyboardEvent` 를 글쇠 이름으로. 호출부(input 계층)가 쓰는 얇은 껍질이다.
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean}} e
 * @returns {string}
 */
export function eventKey(e) {
  if (!e) return '';
  return normalizeKey({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey });
}

/**
 * 이 글쇠를 사용자가 고를 수 있는가.
 * @param {string} key normalizeKey 를 거친 이름
 * @returns {{ok: true} | {ok: false, reason: string}} reason 은 화면에 그대로 나간다
 */
export function checkKey(key) {
  const name = String(key || '');
  if (!name) return { ok: false, reason: '읽지 못한 글쇠입니다.' };
  const base = name.split('+').pop().toLowerCase();
  if (RESERVED.includes(base)) return { ok: false, reason: `\`${name}\` 은 앱이 다른 뜻으로 쓰거나 브라우저가 먼저 가져갑니다.` };
  return { ok: true };
}

/**
 * 손상된 값을 `{id: keys[]}` 로 정규화한다. **모르는 id 는 버리고, 빠진 id 는 기본값으로 채운다.**
 *
 * ⚠ 고정 동작(`fixed`)은 저장된 값이 무엇이든 **언제나 기본값**이다. 옛 파일이나 손으로 고친
 *   값이 `Ctrl+Z` 를 빼앗아 가면 되돌리기가 죽는데, 그건 화면에서 되돌릴 길이 없다.
 * ⚠ 같은 동작 안의 중복은 합치고, MAX_KEYS_PER_ACTION 까지만 남긴다.
 * ⚠ **한 글쇠는 한 동작만 갖는다.** 앞에 놓인 동작이 이긴다(HOTKEY_ACTIONS 차례) — 뒤엣것에서
 *   그 글쇠를 뺀다. 그래서 정규화를 거친 표에는 충돌이 없다.
 * ⚠ 글쇠가 하나도 없는 동작은 **비운 채로 둔다**(`[]`). 화면에는 `없음` 으로 나오고 언제든 다시
 *   붙일 수 있다.
 *   기본값으로 되돌리게 해 봤더니 훨씬 나빴다 — `K` 를 재생에 주면 받아 적기가 비고, 그것이
 *   기본값 `B`·`K` 를 도로 집어 가면서 방금 준 `K` 까지 빼앗고 건너뛰기의 `N` 까지 되돌렸다.
 *   **한 자리를 옮겼을 뿐인데 표 전체가 초기화되는** 연쇄였다. 비어 있는 것이 그보다 정직하다.
 * ⚠ 단, **빠진 id 는** 기본값으로 채운다. 값이 아예 없는 것(새 사용자·새 동작)과 사용자가
 *   일부러 비운 것(`[]`)은 다른 뜻이다.
 *
 * @param {unknown} raw
 * @returns {Record<string, string[]>}
 */
export function normalizeHotkeys(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const used = new Map();          // 글쇠 → 이미 가져간 동작 id
  const out = {};
  for (const action of HOTKEY_ACTIONS) {
    const wanted = action.fixed ? [...action.keys] : listOf(src[action.id], action.keys);
    const kept = [];
    for (const key of wanted) {
      if (kept.length >= MAX_KEYS_PER_ACTION) break;
      if (kept.includes(key)) continue;
      if (used.has(key)) continue;                     // 앞의 동작이 이미 가져갔다
      if (!action.fixed && !checkKey(key).ok) continue;
      kept.push(key);
      used.set(key, action.id);
    }
    out[action.id] = kept;
  }
  return out;
}

/** 배열이면 문자열만 걸러 정규화하고, 아니면 기본값을 그대로 쓴다. */
function listOf(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const out = [];
  for (const item of value) {
    const key = typeof item === 'string' ? normalizeKey({ key: item.split('+').pop(), ctrl: /\bCtrl\+/.test(item), meta: /\bCmd\+/.test(item), alt: /\bAlt\+/.test(item), shift: /\bShift\+/.test(item) }) : '';
    if (key) out.push(key);
  }
  return out;
}

/**
 * 이 글쇠를 이미 쓰고 있는 다른 동작. 없으면 `''`.
 * @param {Record<string, string[]>} map normalizeHotkeys 를 거친 표
 * @param {string} key
 * @param {string} exceptId 이 동작은 세지 않는다(자기 자신에 다시 붙이는 경우)
 * @returns {string} 동작 id
 */
export function ownerOf(map, key, exceptId = '') {
  for (const action of HOTKEY_ACTIONS) {
    if (action.id === exceptId) continue;
    if ((map[action.id] || []).includes(key)) return action.id;
  }
  return '';
}

/**
 * 한 동작의 글쇠를 바꾼다. **다른 동작이 쓰던 글쇠면 그쪽에서 뺀다** — 한 글쇠는 한 동작만 갖는다.
 * @param {Record<string, string[]>} map
 * @param {string} id
 * @param {string[]} keys
 * @returns {Record<string, string[]>} 새 표(원본을 바꾸지 않는다)
 */
export function setKeys(map, id, keys) {
  const action = HOTKEY_ACTIONS.find(a => a.id === id);
  if (!action || action.fixed) return normalizeHotkeys(map);
  const next = {};
  for (const a of HOTKEY_ACTIONS) next[a.id] = [...(map[a.id] || a.keys)];
  next[id] = Array.isArray(keys) ? [...keys] : [];
  // 다른 동작에서 같은 글쇠를 뺀다. 정규화는 앞선 동작을 우선하므로 여기서 미리 비워 둬야
  // 방금 고른 쪽이 이긴다(사용자가 방금 누른 것이 사용자의 뜻이다).
  for (const a of HOTKEY_ACTIONS) {
    if (a.id === id || a.fixed) continue;
    next[a.id] = next[a.id].filter(k => !next[id].includes(k));
  }
  return normalizeHotkeys(next);
}

/**
 * 기본값과 다른 것만 남긴 저장용 표. 손대지 않았으면 `{}` 라 저장 바이트가 늘지 않는다.
 * @param {Record<string, string[]>} map
 * @returns {Record<string, string[]>}
 */
export function toSaved(map) {
  const norm = normalizeHotkeys(map);
  const out = {};
  for (const action of HOTKEY_ACTIONS) {
    if (action.fixed) continue;
    const keys = norm[action.id];
    if (keys.join('|') !== action.keys.join('|')) out[action.id] = keys;
  }
  return out;
}

/**
 * 글쇠 이름을 화면용 한 줄로. 비어 있으면 `없음`.
 * @param {string[]} keys
 * @returns {string}
 */
export function keysLabel(keys) {
  return Array.isArray(keys) && keys.length ? keys.join(' · ') : '없음';
}
