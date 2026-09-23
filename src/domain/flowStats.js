// src/domain/flowStats.js — "어떤 버튼 다음에 어떤 버튼" 기록 (순수 함수, 의존성 0)
//
// 2026-09-21 신설. 사람의 작업 차례는 한정적이라, 무엇 다음에 무엇을 눌렀는지 세어 두면 다음에
// 누를 것을 짚어 줄 수 있다 — 그것이 이 표의 쓸모다.
//
// ⚠⚠ **이 표로 화면을 움직이지 않는다.** 버튼의 자리·순서·개수는 언제나 그대로이고, 이 표는
//   `다음` 표식 하나를 어디에 붙일지만 정한다. 손에 익은 자리가 통계 때문에 옮겨 다니면
//   그것은 적응이 아니라 **과녁이 흔들리는 것**이다(더블클릭이 안 되던 그 부류다).
// ⚠ 표본이 적으면 **아무 말도 하지 않는다**(nextAfter 의 minSamples). 한 번 눌러 본 길을
//   "늘 하는 일"로 내세우면, 처음 한 실수가 그대로 굳는다.
// ⚠ 안무표가 아니라 **이 브라우저의 버릇**이다. 프로젝트 파일에 넣지 않는다(저장 바이트 규약).

/** 한 출발점에서 기억할 다음 후보의 수. 넘으면 적게 눌린 것부터 버린다. */
export const MAX_NEXT_PER_ID = 8;
/** 기억할 출발점의 수. 버튼이 늘어도 표가 무한히 자라지 않게 한다. */
export const MAX_FROM_IDS = 40;
/** 이만큼은 봐야 "늘 이렇게 한다"고 말한다. 그 아래는 우연과 구분되지 않는다. */
export const MIN_SAMPLES = 5;

/** 손상된 값을 `{from: {to: count}}` 로 정규화한다. 숫자가 아닌 것·0 이하는 버린다. */
export function normalizeFlowStats(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [from, nexts] of Object.entries(src)) {
    if (!from || typeof nexts !== 'object' || nexts === null) continue;
    const row = {};
    for (const [to, n] of Object.entries(nexts)) {
      const count = Number(n);
      if (!to || !Number.isFinite(count) || count <= 0) continue;
      row[to] = Math.floor(count);
    }
    if (Object.keys(row).length) out[from] = row;
  }
  return out;
}

/**
 * `from` 다음에 `to` 를 눌렀다고 한 번 센다. **새 표를 돌려준다**(제자리 변형 없음).
 * @param {object} stats
 * @param {string} from
 * @param {string} to
 * @returns {object} 새 표. 셀 수 없는 입력이면 받은 표 그대로
 */
export function noteTransition(stats, from, to) {
  const cur = normalizeFlowStats(stats);
  if (!from || !to || typeof from !== 'string' || typeof to !== 'string') return cur;
  if (from === to) return cur;   // 같은 버튼을 이어 누른 것은 차례가 아니다(`끊기` 연타가 그렇다)
  const row = { ...(cur[from] || {}) };
  row[to] = (row[to] || 0) + 1;
  const next = { ...cur, [from]: trimRow(row) };
  return trimTable(next);
}

/** 후보가 너무 많아지면 적게 눌린 것부터 버린다. */
function trimRow(row) {
  const keys = Object.keys(row);
  if (keys.length <= MAX_NEXT_PER_ID) return row;
  const kept = keys.sort((a, b) => row[b] - row[a] || (a < b ? -1 : 1)).slice(0, MAX_NEXT_PER_ID);
  return Object.fromEntries(kept.map(k => [k, row[k]]));
}

/** 출발점이 너무 많아지면 총 횟수가 적은 것부터 버린다. */
function trimTable(table) {
  const keys = Object.keys(table);
  if (keys.length <= MAX_FROM_IDS) return table;
  const total = (id) => Object.values(table[id]).reduce((a, b) => a + b, 0);
  const kept = keys.sort((a, b) => total(b) - total(a) || (a < b ? -1 : 1)).slice(0, MAX_FROM_IDS);
  return Object.fromEntries(kept.map(k => [k, table[k]]));
}

/**
 * `from` 다음에 **늘 하는 일**. 표본이 모자라거나 1등이 뚜렷하지 않으면 `null` 이다.
 *
 * ⚠ 1등이 절반을 **넘어야** 한다(같으면 안 된다). "셋 중 조금 더 많이 누른 것"이나 3:3 으로
 *   갈린 길은 짚어 줄 값이 아니고, 그것을 `다음` 이라고 내세우면 나머지를 고르는 사람이 매번
 *   틀린 안내를 본다. 반반이면 **아무 말도 하지 않는 것**이 맞다.
 * @param {object} stats
 * @param {string} from
 * @param {{minSamples?: number, minShare?: number}} [opt]
 * @returns {{id: string, n: number, total: number, share: number}|null}
 */
export function nextAfter(stats, from, opt = {}) {
  const minSamples = Number.isFinite(opt.minSamples) ? opt.minSamples : MIN_SAMPLES;
  const minShare = Number.isFinite(opt.minShare) ? opt.minShare : 0.5;
  const row = normalizeFlowStats(stats)[from];
  if (!row) return null;
  const entries = Object.entries(row).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total < minSamples) return null;
  const [id, n] = entries[0];
  const share = n / total;
  if (!(share > minShare)) return null;   // 반반(0.5)도 말하지 않는다 — 위 ⚠
  return { id, n, total, share };
}

/**
 * 많이 다닌 길부터. 설정 화면이 "무엇을 배웠나"를 사람에게 보여 줄 때 쓴다 —
 * **표를 읽을 수 있어야 그 표를 믿을지 말지 사람이 정한다.**
 * @param {object} stats
 * @param {number} [limit]
 * @returns {{from:string, to:string, n:number}[]}
 */
export function topTransitions(stats, limit = 12) {
  const table = normalizeFlowStats(stats);
  const all = [];
  for (const [from, row] of Object.entries(table)) {
    for (const [to, n] of Object.entries(row)) all.push({ from, to, n });
  }
  all.sort((a, b) => b.n - a.n || (a.from < b.from ? -1 : 1) || (a.to < b.to ? -1 : 1));
  return all.slice(0, Math.max(0, limit));
}

/** 표에 담긴 총 횟수. "아직 아무것도 못 배웠다"를 화면이 말할 수 있게 한다. */
export function flowTotal(stats) {
  return topTransitions(stats, Infinity).reduce((sum, t) => sum + t.n, 0);
}
