// src/domain/choreoPlan.js — LLM 이 만든 안무 계획(플랜)을 안무표에 놓을 수 있는 항목으로 정규화한다 (순수)
//
// 신설 파일이다. 서버(server.py 의 PLAN_SCHEMA)가 모델에게 받아 오는 JSON 은
//   { title, moves:[{bar, count, length, name, category, note}], notes:[…] }
// 이고, 여기서는 그것을 격자 좌표(row·index)와 동작 목록의 실제 동작으로 잇는다.
//
// ⚠ 서버의 PLAN_SCHEMA 와 이 파일은 같은 모양을 두 번 적은 것이다 — 한쪽을 고치면 다른 쪽도 고친다.
// ⚠ 모델의 답을 믿지 않는다. 숫자는 클램프하고, 이름은 목록과 느슨하게 맞추고(공백·대소문자 무시),
//   못 맞춘 이름은 "새 동작"으로 표시해 사용자가 놓기 전에 볼 수 있게 한다.

/** 이름 비교용 정규화: 공백 제거·소문자. "Jazz Square" 와 "jazz square" 와 "재즈스퀘어" 는 각각 자기끼리 맞는다. */
export function nameKey(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/\s+/g, '');
}

/**
 * 동작 목록에서 이름으로 찾는다. 정확히 같은 것 → 정규화해서 같은 것 → 한쪽이 다른 쪽을 포함하는 것 순이다.
 * @param {{id:string, name:string, category:string}[]} library
 * @param {string} name
 * @returns {{id:string, name:string, category:string}|null}
 */
export function matchMove(library, name) {
  const list = Array.isArray(library) ? library : [];
  const exact = list.find(m => m.name === name);
  if (exact) return exact;
  const key = nameKey(name);
  if (!key) return null;
  const loose = list.find(m => nameKey(m.name) === key);
  if (loose) return loose;
  // 포함 관계는 짧은 쪽이 3글자 이상일 때만 — "스텝" 이 모든 동작에 걸리면 안 된다.
  const contains = list.find(m => {
    const k = nameKey(m.name);
    return k.length >= 3 && key.length >= 3 && (k.includes(key) || key.includes(k));
  });
  return contains || null;
}

/**
 * @typedef {Object} PlanItem
 * @property {number} row       격자 행(0 = intro, 1 = 첫 마디)
 * @property {number} index     행 안의 0 기반 칸
 * @property {number} length    카운트 수(1 이상)
 * @property {string} name      놓을 이름(목록에 있으면 그 표기)
 * @property {string} category  카테고리 키(새 동작일 때 쓴다)
 * @property {string} note
 * @property {string|null} moveId 목록의 동작 id. null 이면 새로 만든다
 * @property {boolean} created  새 동작인가
 */

/**
 * 플랜 → 놓을 항목. 실패하는 항목은 버리지 않고 `dropped` 에 이유와 함께 남긴다(사용자가 봐야 한다).
 *
 * @param {{title?:string, moves?:object[], notes?:string[]}} plan
 * @param {{ cols:number, rows:number, library:object[], categories:Record<string,{label:string}> }} ctx
 * @returns {{
 *   title:string, items:PlanItem[], dropped:{name:string, reason:string}[], notes:string[],
 *   rowsNeeded:number, newMoves:string[]
 * }} rowsNeeded 는 놓기 위해 필요한 마지막 행 인덱스(board.rows 와 같은 의미)
 */
export function normalizePlan(plan, ctx) {
  const cols = Math.max(1, Number(ctx && ctx.cols) || 8);
  const library = (ctx && ctx.library) || [];
  const categories = (ctx && ctx.categories) || {};
  const catKeys = Object.keys(categories);
  const defaultCat = catKeys[0] || 'step';
  const src = plan && typeof plan === 'object' ? plan : {};
  const items = [];
  const dropped = [];
  const newMoves = [];
  let rowsNeeded = Math.max(0, Number(ctx && ctx.rows) || 0);

  for (const m of Array.isArray(src.moves) ? src.moves : []) {
    const name = String(m && m.name != null ? m.name : '').trim();
    if (!name) { dropped.push({ name: '(이름 없음)', reason: '동작 이름이 없다' }); continue; }
    const bar = Number(m.bar);
    const count = Number(m.count);
    const length = Math.max(1, Math.floor(Number(m.length) || 1));
    if (!Number.isFinite(bar) || bar < 0) { dropped.push({ name, reason: `마디 번호가 이상하다(${m.bar})` }); continue; }
    if (!Number.isFinite(count)) { dropped.push({ name, reason: `카운트가 이상하다(${m.count})` }); continue; }
    const row = Math.floor(bar);
    // 카운트가 마디를 넘어가면(예: 8x1 의 12카운트) 다음 마디로 넘긴다. 0 이하면 1 로.
    const linear = row * cols + (Math.max(1, Math.floor(count)) - 1);
    const fixedRow = Math.floor(linear / cols);
    const index = linear - fixedRow * cols;
    const endRow = Math.floor((linear + length - 1) / cols);
    rowsNeeded = Math.max(rowsNeeded, endRow);

    const found = matchMove(library, name);
    let category = String(m.category || '').trim();
    if (!found && !catKeys.includes(category)) category = defaultCat;
    if (!found && !newMoves.includes(name)) newMoves.push(name);
    items.push({
      row: fixedRow, index, length,
      name: found ? found.name : name,
      category: found ? found.category : category,
      note: String(m.note || '').trim(),
      moveId: found ? found.id : null,
      created: !found
    });
  }

  return {
    title: String(src.title || '').trim(),
    items,
    dropped,
    notes: (Array.isArray(src.notes) ? src.notes : []).map(n => String(n || '').trim()).filter(Boolean),
    rowsNeeded,
    newMoves
  };
}

/**
 * 격자 위치를 사람이 읽는 라벨로. 미리보기 표가 쓴다. row 0 은 intro.
 * @param {number} row
 * @param {number} index
 * @param {number} cols
 * @returns {string}
 */
export function cellLabel(row, index, cols) {
  return `${row === 0 ? 'intro' : `${cols}x${row}`} · ${index + 1}`;
}
