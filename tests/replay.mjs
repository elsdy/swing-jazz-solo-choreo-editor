// tests/replay.mjs — 골든 시나리오 재생 엔진 (node/브라우저 공용, DOM·의존성 0)
//
// 이 파일은 "어떻게 실행하는가"만 안다. "무엇이 정답인가"는 tests/golden/*.json 에 있고,
// "실제 코드를 어떻게 부르는가"는 adapter 가 안다.
//
//   골든 생성 : scratchpad 하네스 + legacy adapter(index.html 원문 추출) → runAll() → 기대값 기록
//   회귀 검사 : tests/run.mjs   + src adapter(리팩터링 후 도메인 모듈)  → runAll() → 기대값 대조
//
// 두 경로가 같은 replayScenario/normalize 를 쓰기 때문에, 골든은 "이 엔진으로 재현 가능한 값"임이
// 정의상 보장된다. 정규화 규칙이 바뀌면 골든을 다시 만들어야 한다(REPLAY_VERSION 을 올릴 것).

export const REPLAY_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// adapter 계약
// ─────────────────────────────────────────────────────────────────────────────
// adapter 는 아래 메서드를 구현한다. board 는 'main' | 're'.
// placements 는 { id, groupId, name, category, row, startIndex, length, subRow, type?, routineId? }
// 형태의 평면 배열이며, 반환 배열을 replay 가 변형하지 않는다.
//
//   reset(setup)                                     세계 초기화 + 시드 배치/동작/루틴/카테고리 주입
//   placeMove({board, moveId, row, startIndex, count})
//   placeRoutine({row, startIndex, routineId})        메인 보드 전용
//   moveGroup({board, groupId, row, startIndex})
//   copyGroup({board, groupId, row, startIndex})
//   rebuild({board, groupId, count})                  리사이즈 확정(클램프 없음)
//   finalizeResize({board, resize})                   클램프 포함 리사이즈 확정
//   remove({board, groupId})
//   repack({board, rows})
//   clearArea({board, segments, ignoreGroupId, subRow})  → 반환값이 values 에 기록됨
//   merge({data})                                     부분 채우기(mergeProjectData)
//   applyProject({data})                              전체 불러오기(applyProjectData)
//   boardSize({rows})                                 메인 보드 행 수 변경(초과 배치 삭제)
//   reBoardSize({rows, cols})                         루틴 보드 크기 변경(행 초과는 숨김만)
//   syncRoutine({routineId, rows, cols, placements})  루틴 편집 반영 → 메인 보드 재분할
//   probe({fn, board, args})                          순수 함수 호출 → 반환값이 values 에 기록됨
//   placements(board)                                 현재 배치 배열
//   log()                                             { render: [...], alerts: [...] }
//
// 미구현 op 는 메서드를 두지 않으면 되고, 그 시나리오는 SKIP 으로 보고된다.

const OP_TO_METHOD = {
  placeMove: 'placeMove',
  placeRoutine: 'placeRoutine',
  move: 'moveGroup',
  copy: 'copyGroup',
  rebuild: 'rebuild',
  finalizeResize: 'finalizeResize',
  remove: 'remove',
  repack: 'repack',
  clearArea: 'clearArea',
  merge: 'merge',
  applyProject: 'applyProject',
  boardSize: 'boardSize',
  reBoardSize: 'reBoardSize',
  syncRoutine: 'syncRoutine',
  probe: 'probe'
};

export const OPS = Object.keys(OP_TO_METHOD);

// ─────────────────────────────────────────────────────────────────────────────
// 재생
// ─────────────────────────────────────────────────────────────────────────────

function groupIdsOf(list) {
  const s = new Set();
  for (const p of list) s.add(p.groupId);
  return s;
}

/**
 * 시나리오 하나를 adapter 위에서 재생한다.
 * @returns {{ raw: object } | { unsupported: string[] }}
 */
export function replayScenario(scenario, adapter) {
  const missing = [];
  for (const op of scenario.ops || []) {
    const m = OP_TO_METHOD[op.op];
    if (!m) throw new Error(`알 수 없는 op: ${op.op} (시나리오 ${scenario.id})`);
    if (typeof adapter[m] !== 'function') missing.push(op.op);
  }
  if (missing.length) return { unsupported: [...new Set(missing)] };

  adapter.reset(structuredClone(scenario.setup || {}));

  // 별칭 표: 시나리오가 "직전 op 이 만든 그룹"을 이름으로 참조할 수 있게 한다.
  // 시드 배치의 groupId 는 시나리오 안에 문자열로 그대로 적히므로 별칭이 필요 없다.
  const alias = new Map();
  const resolve = (g) => (alias.has(g) ? alias.get(g) : g);
  const values = [];

  for (const op of scenario.ops || []) {
    const board = op.board || 'main';
    const before = groupIdsOf(adapter.placements(board));
    const args = { ...op, board };
    if (op.group !== undefined) args.groupId = resolve(op.group);
    if (op.ignoreGroup !== undefined) args.ignoreGroupId = resolve(op.ignoreGroup);
    if (op.resize && op.resize.group !== undefined) {
      args.resize = { ...op.resize, groupId: resolve(op.resize.group) };
    }
    const ret = adapter[OP_TO_METHOD[op.op]](args);
    if (op.as) {
      const after = groupIdsOf(adapter.placements(board));
      const fresh = [...after].filter(g => !before.has(g)).sort();
      alias.set(op.as, fresh.length ? fresh[0] : null);
    }
    if (op.op === 'probe' || op.op === 'clearArea') values.push(ret === undefined ? null : ret);
  }

  const logs = adapter.log ? adapter.log() : { render: [], alerts: [] };
  return {
    raw: {
      main: adapter.placements('main'),
      re: adapter.placements('re'),
      values,
      render: logs.render || [],
      alerts: logs.alerts || [],
      aliases: Object.fromEntries([...alias.entries()])
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 정규화 — 골든이 "우연한 것"에 묶이지 않게 한다
// ─────────────────────────────────────────────────────────────────────────────
// · placement.id 는 통째로 버린다(브리프 01: 세그먼트 id 는 영속적 정체성이 아니다).
// · groupId 는 정렬 후 첫 등장 순서로 G1, G2… 라벨링한다 → id 발급 순서에 의존하지 않는다.
// · subRow 가 undefined 인 배치(syncCurrentRoutine 결함)는 null 로 남겨 결함이 보이게 둔다.
// · 정렬 키에 length 까지 넣어 완전 결정적으로 만든다.

const sortKey = (p) => [
  p.row,
  p.subRow === undefined || p.subRow === null ? -1 : p.subRow,
  p.startIndex,
  p.length,
  String(p.name),
  String(p.type || ''),
  String(p.routineId || '')
];

function cmp(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

function canonBoard(list, labels) {
  const sorted = [...list].sort(cmp);
  return sorted.map(p => {
    if (!labels.has(p.groupId)) labels.set(p.groupId, 'G' + (labels.size + 1));
    const out = {
      g: labels.get(p.groupId),
      name: p.name,
      category: p.category,
      row: p.row,
      startIndex: p.startIndex,
      length: p.length,
      subRow: p.subRow === undefined ? null : p.subRow
    };
    if (p.type !== undefined) out.type = p.type;
    if (p.routineId !== undefined) out.routineId = p.routineId;
    return out;
  });
}

// probe/clearArea 가 돌려주는 "행 번호 목록"은 내부 배열 순서에 딸려 나오는 우연한 값이다.
// 숫자 배열은 오름차순으로 정규화해 리팩터링이 배열 순서를 바꿔도 오탐이 나지 않게 한다.
function canonValue(v) {
  if (Array.isArray(v) && v.length && v.every(x => typeof x === 'number')) return [...v].sort((a, b) => a - b);
  return v;
}

export function normalize(raw) {
  const labels = new Map();
  const main = canonBoard(raw.main || [], labels);
  const re = canonBoard(raw.re || [], labels);
  const aliases = {};
  for (const [k, v] of Object.entries(raw.aliases || {})) {
    aliases[k] = v == null ? null : (labels.get(v) || 'gone');
  }
  return {
    main,
    re,
    values: (raw.values || []).map(canonValue),
    render: (raw.render || []).map(e =>
      e.fn === 'renderRows'
        ? `${e.board}:rows:[${e.rows.join(',')}]`
        : `${e.board}:board:${e.force ? 'full' : 'incr'}`
    ),
    alerts: raw.alerts || [],
    aliases
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 비교
// ─────────────────────────────────────────────────────────────────────────────

const j = (v) => JSON.stringify(v);

/** 기대값과 실제값의 차이를 사람이 읽는 문자열 배열로 돌려준다. 빈 배열이면 통과. */
export function compare(expected, actual) {
  const diffs = [];
  const sections = ['main', 're', 'values', 'render', 'alerts', 'aliases'];
  for (const key of sections) {
    const e = expected[key], a = actual[key];
    if (j(e) === j(a)) continue;
    if ((key === 'main' || key === 're') && Array.isArray(e) && Array.isArray(a)) {
      const n = Math.max(e.length, a.length);
      for (let i = 0; i < n; i++) {
        if (j(e[i]) !== j(a[i])) diffs.push(`${key}[${i}]  기대 ${j(e[i] ?? null)}\n${' '.repeat(key.length + 4)}실제 ${j(a[i] ?? null)}`);
      }
      if (e.length !== a.length) diffs.push(`${key}.length  기대 ${e.length} / 실제 ${a.length}`);
    } else {
      diffs.push(`${key}  기대 ${j(e)}\n${' '.repeat(key.length + 2)}실제 ${j(a)}`);
    }
  }
  return diffs;
}

/**
 * 골든 전체를 adapter 위에서 재생하고 결과를 모은다.
 * @param {object} golden  tests/golden/*.json 파싱 결과
 * @param {object} adapter
 * @param {{ record?: boolean }} [options]  record:true 면 비교 대신 기대값을 만들어 채운다(골든 생성용)
 */
export function runAll(golden, adapter, options = {}) {
  const results = [];
  for (const scenario of golden.scenarios) {
    let out;
    try {
      out = replayScenario(scenario, adapter);
    } catch (err) {
      results.push({ id: scenario.id, desc: scenario.desc, status: 'error', diffs: [String(err && err.stack || err)] });
      continue;
    }
    if (out.unsupported) {
      results.push({ id: scenario.id, desc: scenario.desc, status: 'skip', diffs: [`미구현 op: ${out.unsupported.join(', ')}`] });
      continue;
    }
    const actual = normalize(out.raw);
    if (options.record) {
      scenario.expect = actual;
      results.push({ id: scenario.id, desc: scenario.desc, status: 'record', diffs: [] });
      continue;
    }
    const diffs = compare(scenario.expect, actual);
    results.push({ id: scenario.id, desc: scenario.desc, status: diffs.length ? 'fail' : 'pass', diffs, actual });
  }
  const tally = { pass: 0, fail: 0, skip: 0, error: 0, record: 0 };
  for (const r of results) tally[r.status]++;
  return { results, tally };
}

/** 시나리오 스펙 자체의 위생 검사 — 골든이 골든답게 생겼는지. */
export function lintGolden(golden) {
  const problems = [];
  const seen = new Set();
  if (golden.replayVersion !== REPLAY_VERSION) {
    problems.push(`replayVersion=${golden.replayVersion} 인데 엔진은 ${REPLAY_VERSION} — 골든을 다시 만들어야 한다.`);
  }
  for (const s of golden.scenarios || []) {
    if (!s.id) problems.push('id 없는 시나리오');
    if (seen.has(s.id)) problems.push(`중복 id: ${s.id}`);
    seen.add(s.id);
    if (!s.desc) problems.push(`${s.id}: desc 없음`);
    if (!Array.isArray(s.ops) || !s.ops.length) problems.push(`${s.id}: ops 비어 있음`);
    if (!s.expect) problems.push(`${s.id}: expect 없음`);
    for (const op of s.ops || []) {
      if (!OP_TO_METHOD[op.op]) problems.push(`${s.id}: 알 수 없는 op "${op.op}"`);
    }
  }
  return problems;
}
