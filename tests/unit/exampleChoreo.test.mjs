// tests/unit/exampleChoreo.test.mjs — `예제 열기` 가 여는 예제 안무표(examples/shim-sham.json, RM-26)
//
// 예제는 손으로 쓴 JSON 이다. 저장 포맷이 바뀌거나 손이 미끄러지면 **누른 순간 빈 표나 오류 문구**가 뜨는데,
// 처음 켠 사람이 가장 먼저 누르는 버튼이라 그게 첫인상이 된다. 그래서 앱이 여는 그 길(loadProjectFromRecent)로
// 열어 본다. 이름은 계획서(docs/roadmap/plans/RM-26.md)의 「요구 ↔ 시험」 표와 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateProjectFile } from '../../src/domain/project/migrations.js';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import { writeDoc } from '../../src/usecases/docFields.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as History from '../../src/usecases/historyCommands.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const example = () => JSON.parse(readFileSync(join(ROOT, 'examples', 'shim-sham.json'), 'utf8'));

function env() {
  let n = 0;
  return { nowIso: () => '2026-11-02T00:00:00.000Z', uid: () => 'id' + (++n) };
}
const deps = (store, hist) => ({
  store, env: env(), dialogs: { alert: () => {} },
  storage: { saveRoutineFavorites() {}, saveLinks() {} },
  commitHistory: hist ? (boardId) => History.commit(hist, boardId) : undefined
});

test('예제 안무가 저장 포맷 검사를 통과하고 8마디 · 영상 링크 · 박자를 가진다', () => {
  const raw = example();
  const mig = migrateProjectFile(raw, { now: () => '2026-11-02T00:00:00.000Z' });
  assert.equal(mig.ok, true, `저장 포맷 검사에 걸린다: ${JSON.stringify(mig)}`);

  // `프로젝트 저장` 이 쓰는 모양 그대로인가 — 열고 다시 저장하면 글자 하나 다르지 않아야 한다(저장 시각만 빼고).
  let saved = null;
  const io = { ...deps(createStore()), files: { downloadJson: (payload) => { saved = payload; } } };
  io.storage = { ...io.storage, saveRecents() {}, loadRecents: () => [] };
  Project.loadProjectFromRecent(io, raw);
  try { Project.saveProject(io, { fileName: raw.fileName }); } catch { /* 최근 목록 쓰기는 이 시험의 관심 밖 */ }
  assert.deepEqual({ ...saved, savedAt: '' }, { ...raw, savedAt: '' },
    '예제 파일이 `프로젝트 저장` 의 모양과 다르다 — 앱에서 열고 저장한 것으로 다시 만든다');

  const store = createStore();
  const dirty = Project.loadProjectFromRecent(deps(store), raw);
  assert.notEqual(dirty.notify?.kind, 'block', `열면 막는 문구가 뜬다: ${dirty.notify?.message}`);

  const board = store.board(BOARD_MAIN);
  assert.equal(board.rows, 8, '8마디');
  assert.equal(board.cols, 8, '한 마디 8카운트');
  assert.equal(board.placements.length, 8, '마디마다 블록 하나');
  const rowsCovered = new Set(board.placements.map(p => p.row));
  for (let r = 1; r <= 8; r++) assert.ok(rowsCovered.has(r), `${r}번째 마디가 비었다`);
  const names = new Set(store.get().library.map(m => m.name));
  for (const p of board.placements) assert.ok(names.has(p.name), `동작 목록에 없는 블록: ${p.name}`);

  assert.match(store.links.youtubeUrl, /^https:\/\/www\.youtube\.com\/watch\?v=/, '공개 유튜브 링크');
  const clip = store.get().media.clips[0];
  assert.ok(clip, '영상 클립 하나');
  assert.ok(clip.tempo && clip.tempo.bpm > 0, '기준 박자(BPM)');
});

test('예제를 연 뒤 되돌리기 한 번이면 연 앞의 안무표로 돌아간다', () => {
  const store = createStore();
  const hist = History.createHistory(store);
  // 연 앞의 안무표 — 블록 하나가 놓인 것
  writeDoc(store, { placements: [{ id: 'p1', groupId: 'g1', name: 'Jazz Square', category: 'step', row: 2, startIndex: 0, length: 4, subRow: 0 }] });
  History.commit(hist, BOARD_MAIN);
  History.reset(hist, BOARD_MAIN);                        // 부팅의 되살리기가 세우는 바닥과 같은 자리
  const before = JSON.stringify(store.board(BOARD_MAIN).placements);

  Project.loadProjectFromRecent(deps(store, hist), example());
  assert.equal(store.board(BOARD_MAIN).placements.length, 8);
  assert.equal(History.canUndo(hist, BOARD_MAIN), true, '예제를 열었는데 되돌릴 단계가 없다');

  History.undo(hist, BOARD_MAIN);
  assert.equal(JSON.stringify(store.board(BOARD_MAIN).placements), before, '되돌리기 한 번으로 연 앞의 안무표가 돌아오지 않는다');
  assert.equal(History.canUndo(hist, BOARD_MAIN), false, '바닥 아래로 더 되돌아간다');

  // 빈 안무표에서 연 경우 — 되돌리면 빈 표로, 그 아래로는 내려가지 않는다
  const empty = createStore();
  const h2 = History.createHistory(empty);
  History.commit(h2, BOARD_MAIN);
  History.reset(h2, BOARD_MAIN);
  Project.loadProjectFromRecent(deps(empty, h2), example());
  History.undo(h2, BOARD_MAIN);
  assert.equal(empty.board(BOARD_MAIN).placements.length, 0, '빈 표에서 연 예제가 되돌려지지 않는다');
  assert.equal(History.canUndo(h2, BOARD_MAIN), false);
  // 되살린 상태의 서명이 같아 유령 단계가 쌓이지 않는다(RM-07)
  const depth = h2.stack(BOARD_MAIN).past.length;
  History.commit(h2, BOARD_MAIN);
  assert.equal(h2.stack(BOARD_MAIN).past.length, depth, 'Undo 직후 커밋이 유령 단계를 쌓는다');
  assert.equal(History.canRedo(h2, BOARD_MAIN), true, 'Undo 직후 커밋이 Redo 를 날렸다');
});
