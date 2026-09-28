// tests/unit/docFields.test.mjs — 필드 등록표(schema.FIELD_TABLE)의 **모든 필드**가 저장·열기·되돌리기에서 살아남는가 (RM-01)
//
// 필드마다 시험을 손으로 쓰면 필드를 늘릴 때 시험도 빠뜨린다 — 그러면 값이 오류 없이 사라지는 것을 아무도 모른다.
// 그래서 시험을 **등록표에서 만든다.** 필드마다 「기본값이 아닌 견본」 하나만 적으면, 세 왕복을 그 필드 이름으로 돈다.
//
//   ① 저장 → 다시 열기          파일(작업 중 문서와 같은 모양)에 실리고, 열면 그대로 돌아오나
//   ② 바꾸기 → 되돌리기         그 필드만 기본값으로 바꾸고 Undo 하면 견본이 돌아오나
//   ③ 지운 값이 되살아나지 않나  비운 필드로 저장할 때 옛 파일의 그 키가 passthrough 로 끼어들지 않나
//
// ⚠ 등록표에 줄을 더하고 SAMPLES 를 빠뜨리면 맨 첫 시험이 붉어진다 — 견본 없이는 그 필드를 잴 수 없다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DOC_FIELDS, FIELD_TABLE } from '../../src/domain/project/schema.js';
import { normalizeProject } from '../../src/domain/project/normalize.js';
import { buildProjectFile } from '../../src/domain/project/serialize.js';
import { normalizeLinks } from '../../src/domain/links.js';
import { DEFAULT_CATEGORIES } from '../../src/domain/defaults.js';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import { docView, writeDoc } from '../../src/usecases/docFields.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as History from '../../src/usecases/historyCommands.js';

function env() {
  let n = 0;
  return { nowIso: () => '2026-09-28T00:00:00.000Z', uid: () => 'id' + (++n) };
}
const deps = store => ({
  store, env: env(), dialogs: { alert: () => {} },
  storage: { saveRoutineFavorites() {}, saveLinks() {} }
});

/**
 * 필드마다 **기본값이 아닌** 견본(날것). 기대값은 아래에서 앱의 정규화를 한 번 거쳐 만든다 —
 * 날것을 그대로 기대하면 정규화가 붙이는 칸(id · subRow 같은) 때문에 뜻 없이 붉어진다.
 */
const SAMPLES = {
  rows: 12,
  cols: 6,
  categories: { ...DEFAULT_CATEGORIES, lindy: { label: '린디', color: '#e3b341' } },
  moveLibrary: [{ id: 'm1', name: 'Swing Out', category: 'lindy' }],
  placements: [{ id: 'p1', groupId: 'g1', name: 'Swing Out', category: 'lindy', row: 2, startIndex: 0, length: 2, subRow: 0 }],
  routines: [{ id: 'r1', name: '첫 루틴', rows: 1, cols: 8, placements: [], color: '#52d9c8', isFavorite: false }],
  links: { youtubeUrl: 'https://youtu.be/abc', youtubeTitle: '곡', clickupUrl: 'https://app.clickup.com/t/1',
    customLinks: [{ id: 'l1', label: '악보', url: 'https://example.com/s' }] },
  media: { activeId: '', clips: [{ name: '테이크 1', source: { kind: 'youtube', url: 'https://youtu.be/abc' },
    tempo: { bpm: 172, anchorSec: 1.5, anchorCount: 1 } }] },
  phrasing: { on: true, rowsPerPhrase: 2, phrasesPerChorus: 4, startRow: 2 },
  stepTodos: { pick: [{ id: 't1', text: '곡 고르기', done: true }] }
};

/** 견본을 앱이 파일을 열 때와 같은 정규화에 한 번 통과시킨 기대값 — 등록표의 모든 필드를 싣는다. */
function expected() {
  const flat = { ...SAMPLES, ...SAMPLES.links };
  const n = normalizeProject(flat, { ids: env(), defaultCategories: DEFAULT_CATEGORIES });
  const out = { ...n, links: normalizeLinks(flat, { normalizeCustomItems: true, ids: env() }) };
  const doc = {};
  for (const key of DOC_FIELDS) doc[key] = out[key];
  return doc;
}

/** 견본이 든 store — 파일을 거치지 않고 store 에 곧바로 쓴다(그래야 저장 쪽의 빠뜨림이 드러난다) */
function seeded() {
  const store = createStore();
  writeDoc(store, expected());
  return store;
}

test('등록표의 모든 필드에 견본이 있고, 견본은 새 store 의 기본값과 다르다', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...DOC_FIELDS].sort(),
    'schema.FIELD_TABLE 에 필드를 더했으면 SAMPLES 에도 한 줄 — 견본 없이는 그 필드를 잴 수 없다');
  const want = expected(), fresh = docView(createStore().get());
  for (const key of DOC_FIELDS) {
    assert.notEqual(want[key], undefined, `${key}: 정규화가 이 필드를 돌려주지 않는다`);
    assert.notDeepEqual(want[key], fresh[key], `${key}: 견본이 기본값과 같으면 사라져도 모른다`);
  }
});

for (const { key } of FIELD_TABLE) {
  test(`① 저장 → 다시 열기: ${key} 가 그대로 돌아온다`, () => {
    const store = seeded();
    const file = JSON.parse(JSON.stringify(Project.draftSnapshot(deps(store), { fileName: '견본' })));
    const again = createStore();
    Project.restoreDraft(deps(again), file);
    assert.deepEqual(docView(again.get())[key], expected()[key],
      `${key}: 저장했다 다시 열면 달라진다 — 저장용 뷰(projectCommands.mainView)나 불러오기가 이 필드를 빠뜨렸다`);
  });

  test(`② 바꾸기 → 되돌리기: ${key} 가 Undo 로 돌아온다`, () => {
    const store = seeded();
    const hist = History.createHistory(store);
    History.commit(hist, BOARD_MAIN);
    writeDoc(store, { [key]: docView(createStore().get())[key] });   // 그 필드만 기본값으로
    History.commit(hist, BOARD_MAIN);
    assert.equal(History.canUndo(hist, BOARD_MAIN), true, `${key}: 바꿨는데 커밋이 무시됐다 — 스냅샷이 이 필드를 안 담는다`);
    History.undo(hist, BOARD_MAIN);
    assert.deepEqual(docView(store.get())[key], expected()[key], `${key}: Undo 로 돌아오지 않는다`);
  });
}

for (const { key, file } of FIELD_TABLE.filter(f => f.optional)) {
  test(`③ 비운 ${key} 는 옛 파일에서 되살아나지 않는다`, () => {
    const store = seeded();
    const old = JSON.parse(JSON.stringify(Project.draftSnapshot(deps(store), { fileName: '견본' })));
    writeDoc(store, { [key]: docView(createStore().get())[key] });   // 비웠다
    const view = { ...docView(store.get()), ...docView(store.get()).links };
    const saved = buildProjectFile(view, { passthrough: old });
    for (const k of file) {
      assert.equal(k in saved, false,
        `${k}: 비웠는데 옛 파일의 값이 passthrough 로 되살아난다 — serialize.PROJECT_KEYS 에 이 키가 없다`);
    }
  });
}
