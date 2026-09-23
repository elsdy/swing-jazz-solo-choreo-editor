// src/domain/stepTodos.js — 작업 차례의 단계마다 달아 두는 할 일 (순수 함수, 의존성 0)
//
// 2026-09-21 신설. 영상을 보며 받아 적다 보면 "여기는 나중에 자르자" · "이 마디는 이름 다시" 같은
// 것이 끊임없이 생기는데, 그때마다 하던 일을 멈추면 흐름이 끊긴다. 그래서 **단계에 적어 두고
// 나중에 처리한다** — 적는 자리가 그 일을 할 자리와 같아서, 나중에 그 단계를 열면 거기 있다.
//
// ⚠ 이것은 **안무의 일부다.** 이 안무표에 대한 할 일이므로 프로젝트 파일에 들어가고 Undo 를 탄다
//   (단축키·테마처럼 브라우저의 취향이 아니다). 다만 **비어 있으면 파일에 키가 생기지 않는다** —
//   할 일을 한 번도 안 적은 사람의 저장 바이트는 이 기능이 들어오기 전과 같다.
// ⚠ 단계 id 는 ui 가 정한 `step1`~`stepN` 이다. 도메인은 그것이 몇 번째인지 모른다 — 그냥 열쇠다.
//   그래서 단계가 늘어도 이 파일은 그대로다.

/** 한 단계에 담을 수 있는 할 일의 수. 넘으면 목록이 아니라 쓰레기통이 된다. */
export const MAX_TODOS_PER_STEP = 30;
/** 한 줄의 길이 상한. 긴 글은 메모가 아니라 문서다. */
export const MAX_TODO_TEXT = 120;

/**
 * 손상된 값을 `{stepId: [{id, text, done}]}` 로 정규화한다.
 * 빈 글·모르는 모양은 버리고, 단계마다 상한까지만 남긴다.
 * @param {unknown} raw
 * @returns {Record<string, {id:string, text:string, done:boolean}[]>}
 */
export function normalizeStepTodos(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [stepId, list] of Object.entries(src)) {
    if (!stepId || !Array.isArray(list)) continue;
    const items = [];
    for (const item of list) {
      const one = normalizeOne(item);
      if (one) items.push(one);
      if (items.length >= MAX_TODOS_PER_STEP) break;
    }
    if (items.length) out[stepId] = items;
  }
  return out;
}

function normalizeOne(item) {
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text == null ? '' : item.text).trim().slice(0, MAX_TODO_TEXT);
  if (!text) return null;                       // 빈 할 일은 할 일이 아니다
  const id = typeof item.id === 'string' && item.id ? item.id : '';
  return { id, text, done: item.done === true };
}

/**
 * 할 일 하나를 더한다. **새 표를 돌려준다**(제자리 변형 없음).
 * @param {object} todos
 * @param {string} stepId
 * @param {string} text
 * @param {() => string} uid 도메인은 시계도 난수도 모른다 — 발급기를 받는다
 * @returns {object} 못 더하면 받은 표 그대로
 */
export function addTodo(todos, stepId, text, uid) {
  const cur = normalizeStepTodos(todos);
  const body = String(text == null ? '' : text).trim().slice(0, MAX_TODO_TEXT);
  // ⚠⚠ 헛일이면 **받은 것을 그대로** 돌려준다(새 객체를 만들지 않는다). 호출부(유스케이스)가
  //   참조 하나로 "바뀐 것이 없다"를 가리기 때문이다 — 여기서 매번 새 객체를 주면 아무것도
  //   안 했는데 store 에 쓰이고 Undo 스택이 빈 단계로 더럽혀진다.
  if (!stepId || !body) return todos;
  const list = cur[stepId] || [];
  if (list.length >= MAX_TODOS_PER_STEP) return todos;
  const id = typeof uid === 'function' ? uid() : '';
  return { ...cur, [stepId]: [...list, { id, text: body, done: false }] };
}

/** 했다/안 했다를 뒤집는다. */
export function toggleTodo(todos, stepId, id) {
  const cur = normalizeStepTodos(todos);
  const list = cur[stepId];
  if (!list || !id) return todos;                       // 헛일이면 받은 것 그대로(위 ⚠⚠)
  let touched = false;
  const next = list.map(t => (t.id === id ? (touched = true, { ...t, done: !t.done }) : t));
  return touched ? { ...cur, [stepId]: next } : todos;
}

/**
 * 하나를 지운다. 마지막 하나를 지우면 **그 단계의 열쇠도 사라진다** —
 * 빈 배열이 남으면 저장 바이트에 빈 목록이 실린다.
 */
export function removeTodo(todos, stepId, id) {
  const cur = normalizeStepTodos(todos);
  const list = cur[stepId];
  if (!list || !id) return todos;                       // 헛일이면 받은 것 그대로(위 ⚠⚠)
  const next = list.filter(t => t.id !== id);
  if (next.length === list.length) return todos;
  const out = { ...cur };
  if (next.length) out[stepId] = next;
  else delete out[stepId];
  return out;
}

/** 끝낸 것만 한 단계에서 치운다(`정리`). */
export function clearDoneTodos(todos, stepId) {
  const cur = normalizeStepTodos(todos);
  const list = cur[stepId];
  if (!list) return todos;                              // 헛일이면 받은 것 그대로(위 ⚠⚠)
  const next = list.filter(t => !t.done);
  if (next.length === list.length) return todos;
  const out = { ...cur };
  if (next.length) out[stepId] = next;
  else delete out[stepId];
  return out;
}

/** 그 단계에 남은(안 끝낸) 할 일 수. 마디 위의 배지가 이 수를 쓴다. */
export function openCount(todos, stepId) {
  const list = normalizeStepTodos(todos)[stepId];
  return list ? list.filter(t => !t.done).length : 0;
}

/** 표 전체에서 남은 할 일 수. */
export function totalOpen(todos) {
  const cur = normalizeStepTodos(todos);
  return Object.keys(cur).reduce((sum, k) => sum + openCount(cur, k), 0);
}

/**
 * 파일에 실을 형태. **비어 있으면 null** 이고, 호출부(serialize.buildProjectFile)가 키를 통째로 뺀다.
 * @param {object} todos
 * @returns {object|null}
 */
export function serializeStepTodos(todos) {
  const cur = normalizeStepTodos(todos);
  return Object.keys(cur).length ? cur : null;
}
