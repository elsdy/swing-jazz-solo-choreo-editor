// src/usecases/stepTodoCommands.js — 단계별 할 일 (유스케이스)
//
// 2026-09-21 신설. 규칙은 domain/stepTodos 가 갖고, 여기서는 **store 에 쓰고 Dirty 를 돌려주는**
// 일만 한다(이 계층의 규약 — DOM 을 만지지 않고 렌더 함수를 부르지 않는다).
//
// ⚠ 할 일은 안무표와 함께 저장되고 Undo 를 탄다(UNDO_FIELDS·DOC_FIELDS 의 stepTodos).
//   그래서 호출부는 **사람이 확정한 순간에만** commitHistory 를 함께 부른다 — 글자를 치는 동안
//   커밋하면 Undo 한 번이 한 글자를 지운다.
// ⚠ Dirty 는 `video` 다. 할 일은 영상 패널의 작업 차례 안에 살고 안무표를 건드리지 않는다 —
//   `boards` 를 세우면 있지도 않은 까닭으로 격자를 다시 그린다.

import { addTodo, clearDoneTodos, removeTodo, toggleTodo } from '../domain/stepTodos.js';
import { NONE } from './store.js';

/** 이 갈래의 Dirty. 작업 차례만 다시 그린다. */
const VIDEO = Object.freeze({ video: true });

/**
 * @param {object} store
 * @param {{ stepId:string, text:string }} args
 * @param {{ ids:(()=>string)|{uid:()=>string} }} [deps]
 * @returns {object} Dirty
 */
export function addStepTodo(store, args, deps = {}) {
  const uid = typeof deps.ids === 'function' ? deps.ids : deps.ids && deps.ids.uid;
  const next = addTodo(store.get().stepTodos, args.stepId, args.text, uid);
  return write(store, next);
}

/** @returns {object} Dirty */
export function toggleStepTodo(store, args) {
  return write(store, toggleTodo(store.get().stepTodos, args.stepId, args.id));
}

/** @returns {object} Dirty */
export function removeStepTodo(store, args) {
  return write(store, removeTodo(store.get().stepTodos, args.stepId, args.id));
}

/** 끝낸 것만 치운다. @returns {object} Dirty */
export function clearDoneStepTodos(store, args) {
  return write(store, clearDoneTodos(store.get().stepTodos, args.stepId));
}

/**
 * 바뀐 것이 있을 때만 쓴다.
 * ⚠ 도메인 함수는 바뀐 것이 없으면 **받은 표를 그대로** 돌려준다(새 객체를 만들지 않는다).
 *   그 규약 덕에 여기서 참조 비교 하나로 "헛일"을 걸러 낼 수 있다 — 헛 커밋은 Undo 를 더럽힌다.
 */
function write(store, next) {
  if (next === store.get().stepTodos) return NONE;
  store.update({ stepTodos: next });
  return VIDEO;
}
