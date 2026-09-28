// src/usecases/docFields.js — 필드 등록표의 store 쪽 한 줄씩: 그 필드가 store 의 **어디에** 살고, 바뀌면 **무엇을** 다시 그리나
//
// 등록표(domain/project/schema.FIELD_TABLE)는 ChoreoDoc 의 모양을 말하고, 이 파일은 그것이 store 안에서 어디에 있는지를
// 말한다. store 는 보드를 boards.main 아래 두고 동작 목록을 `library` 라 부르므로 ChoreoDoc 과 이름·자리가 다르다.
// 그 차이를 메우는 **유일한 자리**가 여기다 — 되돌리기(historyCommands)와 저장·열기(projectCommands)가 같이 쓴다.
//
// 겪은 일(RM-01): 이 옮겨 적기가 전에는 네 벌(스냅샷 뷰 · 복원 · 저장용 뷰 · 불러오기)이었고, 필드를 늘릴 때마다
// 네 곳을 손으로 고쳤다. stepTodos 는 스냅샷 뷰에서 빠져 되돌리기를 안 탔고(2026-09-21), phrasing 은 저장용 뷰와
// 불러오기에서 빠져 파일에 실리지 않았다(2026-09-28). 등록표에 줄을 더하고 여기를 빠뜨리면 byField 가 던진다.

import { DOC_FIELDS } from '../domain/project/schema.js';
import { byField } from '../domain/project/fields.js';
import { BOARD_MAIN, boardOf } from './store.js';

/**
 * 필드마다:
 *   get(state)  store 의 지금 값(참조 — 복제는 스냅샷·직렬화가 한다)
 *   board       보드 칸이면 setBoard(BOARD_MAIN) 의 키, 아니면 없음
 *   top         store 최상위 칸의 이름(ChoreoDoc 이름과 다를 수 있다 — moveLibrary 는 `library`)
 *   dirty       그 필드가 통째로 바뀌었을 때 다시 그릴 것(되돌리기 · 파일 열기가 합쳐 쓴다)
 */
const STORE_OPS = byField({
  rows:        { get: s => boardOf(s, BOARD_MAIN).rows, board: 'rows',
                 dirty: { layout: true, boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } } } },
  cols:        { get: s => boardOf(s, BOARD_MAIN).cols, board: 'cols',
                 dirty: { layout: true, boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } } } },
  categories:  { get: s => s.categories, top: 'categories', dirty: { legend: true, categorySelect: true, palette: true } },
  moveLibrary: { get: s => s.library, top: 'library', dirty: { palette: true } },
  placements:  { get: s => boardOf(s, BOARD_MAIN).placements, board: 'placements',
                 dirty: { boards: { [BOARD_MAIN]: { skeleton: true, rows: 'all' } } } },
  routines:    { get: s => s.routines, top: 'routines', dirty: { routineList: true } },
  links:       { get: s => s.links, top: 'links', dirty: { links: true } },
  media:       { get: s => s.media, top: 'media', dirty: { video: true } },
  // ⚠ boards.skeleton 이 행 dataset 을 날리므로 보드를 다시 그릴 때는 프레이즈 표시도 반드시 다시 입힌다
  phrasing:    { get: s => s.phrasing, top: 'phrasing', dirty: { phrasing: true } },
  stepTodos:   { get: s => s.stepTodos, top: 'stepTodos', dirty: { video: true } }
}, 'usecases/docFields.js');

/**
 * store 의 지금 상태를 **ChoreoDoc 모양**으로 — 등록표의 모든 필드를 DOC_FIELDS 순서로 싣는다(참조).
 * 스냅샷(snapshot.pickUndoFields)과 파일(serialize.buildProjectFile)이 이것을 읽는다.
 * @param {object} state store.get()
 * @param {readonly string[]} [keys] 일부만(기본은 전부)
 * @returns {object}
 */
export function docView(state, keys = DOC_FIELDS) {
  const out = {};
  for (const key of keys) out[key] = STORE_OPS[key].get(state);
  return out;
}

/**
 * ChoreoDoc 모양의 값들을 store 에 쓴다. **있는 키만** 쓴다 — 없는 키는 지금 값을 남긴다
 * (되돌리기의 routines 가 그 길을 쓴다: 옛 스냅샷에 routines 가 없으면 지금 것을 둔다).
 * 보드 칸(rows·cols·placements)은 setBoard 한 번으로, 나머지는 update 한 번으로 모아 쓴다.
 * @param {object} store
 * @param {object} values  ChoreoDoc 모양(일부여도 된다)
 * @param {object} [extraTop] 같은 update 에 함께 실을 것(선택 해제 같은)
 */
export function writeDoc(store, values, extraTop = null) {
  const board = {}, top = {};
  for (const key of DOC_FIELDS) {
    if (!(key in values)) continue;
    const op = STORE_OPS[key];
    if (op.board) board[op.board] = values[key];
    else top[op.top] = values[key];
  }
  if (Object.keys(board).length) store.setBoard(BOARD_MAIN, board);
  if (extraTop) Object.assign(top, extraTop);
  if (Object.keys(top).length) store.update(top);
}

/**
 * 필드들이 통째로 바뀌었을 때 다시 그릴 것 — 필드마다의 dirty 를 합친다. 같은 키는 한 번만 싣는다.
 * @param {readonly string[]} [keys]
 * @returns {object}
 */
export function docDirty(keys = DOC_FIELDS) {
  const out = {};
  for (const key of keys) {
    for (const [k, v] of Object.entries(STORE_OPS[key].dirty)) {
      if (k === 'boards') out.boards = { ...(out.boards || {}), ...v };
      else out[k] = v;
    }
  }
  return out;
}
