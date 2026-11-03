// tests/unit/versions.test.mjs — 판본과 연습 기록 (RM-29 · 2026-11-03)
//
// 계획서(docs/roadmap/plans/RM-29.md)의 「요구 ↔ 시험」 표의 시험 이름을 그대로 쓴다 — 이름이 곧 요구다.
// 판본 · 기록은 필드 등록표(FIELD_TABLE) 밖이라 docFields 의 왕복 시험이 재지 않는다. 그래서 왕복 · 바이트 · 되돌리기를
// 여기서 따로 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, BOARD_MAIN } from '../../src/usecases/store.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as Version from '../../src/usecases/versionCommands.js';
import * as History from '../../src/usecases/historyCommands.js';
import { buildProjectFile } from '../../src/domain/project/serialize.js';
import { migrateProjectFile } from '../../src/domain/project/migrations.js';
import { normalizeProject } from '../../src/domain/project/normalize.js';
import { SCHEMA_VERSION, VERSION_FIELDS, VERSION_FILE_KEYS, VERSION_SKIP_FIELDS, FIELD_TABLE } from '../../src/domain/project/schema.js';
import { DEFAULT_CATEGORIES } from '../../src/domain/defaults.js';
import { docView } from '../../src/usecases/docFields.js';
import {
  versionSummaries, versionSummary, normalizeVersions, normalizePracticeLogs, serializePracticeLogs,
  scopeLabel, parseScope, practiceLogParts
} from '../../src/domain/project/versions.js';
import { countRangeLabel } from '../../src/domain/practice.js';
import { formatRange } from '../../src/ui/videoPanel.js';

/** 시계와 id — 부를 때마다 1초 · 1번씩 나아간다(판본의 뜬 차례가 createdAt 으로 갈린다). */
function env() {
  let n = 0;
  let t = 0;
  return {
    uid: () => 'id' + (++n),
    nowIso: () => new Date(Date.UTC(2026, 10, 3, 0, 0, t++)).toISOString(),
    now: () => 0
  };
}

/** 프로젝트 명령의 deps — 내려받은 파일 · 최근 목록 · 되돌리기를 시험이 볼 수 있게 붙잡는다. */
function makeDeps(store, hist = null) {
  const downloads = [];
  const deps = {
    store, env: env(),
    files: { downloadJson: (payload, name) => downloads.push({ payload, name }) },
    storage: { saveRoutineFavorites() {}, saveLinks() {}, saveRecents() {} },
    commitHistory: hist ? (boardId) => History.commit(hist, boardId) : undefined,
    resetHistory: hist ? (boardId) => History.reset(hist, boardId) : undefined
  };
  return { deps, downloads };
}

/** 블록 둘(g1 · g2)이 놓인 store — 6마디 */
function seeded() {
  const store = createStore();
  store.setBoard(BOARD_MAIN, {
    rows: 6,
    placements: [
      { id: 'p1', groupId: 'g1', name: 'Swing Out', category: 'basic', row: 0, startIndex: 0, length: 2, subRow: 0 },
      { id: 'p2', groupId: 'g2', name: 'Circle', category: 'basic', row: 1, startIndex: 0, length: 2, subRow: 0 }
    ]
  });
  return store;
}

const placementsOf = (store) => store.board(BOARD_MAIN).placements;

test('판본 뜨기는 안무 본문을 값으로 복제하고 이름·메모·부모를 붙인다', () => {
  const store = seeded();
  const { deps } = makeDeps(store);
  const dirty = Version.snapshotVersion(deps, { label: 'A안', note: '처음 짠 것' });
  assert.equal(dirty.versions, true);
  const [a] = store.versions;
  assert.equal(a.label, 'A안');
  assert.equal(a.note, '처음 짠 것');
  assert.equal(a.parentId, null, '첫 판본에는 부모가 없다');
  assert.equal(store.get().versionBase, a.id, '뜬 판본이 지금 본문의 바탕이 된다');

  // 필드 등록표의 필드가 하나도 빠지지 않는다 — 영상 · 링크(Q42 로 판본이 뜨지 않는 것)만 빼고
  const body = Project.currentDocBody(store.get());
  for (const key of VERSION_FILE_KEYS) {
    if (key in body) assert.deepEqual(a.doc[key], body[key], `${key}: 판본 본문이 지금 안무표와 다르다`);
  }
  assert.deepEqual(VERSION_FIELDS, FIELD_TABLE.map(f => f.key).filter(k => !VERSION_SKIP_FIELDS.includes(k)),
    '판본이 뜨는 필드는 등록표에서 영상 · 링크를 뺀 전부다');
  for (const key of ['media', 'youtubeUrl', 'customLinks']) assert.equal(key in a.doc, false, `${key}: 판본이 영상 · 링크를 떴다`);

  // 값으로 복제 — 뜬 뒤 지금 안무표를 고쳐도 판본은 그대로다
  const before = structuredClone(a.doc.placements);
  store.setBoard(BOARD_MAIN, { placements: [] });
  placementsOf(store).push({ id: 'x' });
  assert.deepEqual(store.versions[0].doc.placements, before, '판본 본문이 지금 안무표를 따라 바뀌었다 — 참조로 들고 있다');

  // 이름 없이 뜨면 `판본 N`, 부모는 지금 바탕
  Version.snapshotVersion(deps);
  const b = store.versions[1];
  assert.equal(b.label, '판본 2');
  assert.equal(b.parentId, a.id, '두 번째 판본의 부모는 첫 판본이다');
  assert.equal(store.get().versionBase, b.id);
});

test('판본 요약은 본문에서 다시 만들어지고 목록에는 본문이 실리지 않는다', () => {
  const store = seeded();
  const { deps } = makeDeps(store);
  Version.snapshotVersion(deps, { label: 'A안' });
  store.setBoard(BOARD_MAIN, { rows: 8, placements: placementsOf(store).slice(0, 1) });
  Version.snapshotVersion(deps, { label: 'B안', note: '끝을 바꿈' });

  const list = versionSummaries(store.versions);
  assert.deepEqual(list.map(v => v.label), ['B안', 'A안'], '새로 뜬 것이 위');
  for (const item of list) assert.equal('doc' in item, false, '목록 항목에 본문이 실렸다');
  assert.deepEqual(list.map(v => [v.bars, v.blocks]), [[8, 1], [6, 2]], '마디 수 · 블록 수가 본문에서 나온다');
  assert.equal(list[0].parentId, list[1].id);
  assert.equal(list[0].note, '끝을 바꿈');

  // 요약은 저장하지 않는다 — 버리고 본문에서 다시 만들면 같은 값이다
  const again = versionSummaries(normalizeVersions(JSON.parse(JSON.stringify(store.versions))));
  assert.deepEqual(again, list);
  const saved = buildProjectFile({ ...Project.currentDocBody(store.get()) }, { versions: store.versions });
  for (const v of saved.versions) {
    for (const key of ['bars', 'blocks']) assert.equal(key in v, false, `${key}: 요약이 파일에 실렸다`);
  }
  assert.deepEqual(versionSummary(store.versions[0]).bars, 6);
});

test('판본을 열면 선택·되돌리기가 비고 다른 판본과 기록은 남는다', () => {
  const store = seeded();
  const hist = History.createHistory(store);
  const { deps } = makeDeps(store, hist);
  History.reset(hist, BOARD_MAIN);
  Version.snapshotVersion(deps, { label: 'A안' });
  Version.saveLog(deps, { id: 'L1', at: '2026-11-01', attempts: 5, cleanRuns: 2 });

  // A안에서 갈라져 블록 하나를 지우고, 하나를 고른 채로 둔다 — 되돌리기 한 단계가 쌓인다
  store.setBoard(BOARD_MAIN, { placements: placementsOf(store).slice(0, 1) });
  History.commit(hist, BOARD_MAIN);
  store.update({ selection: new Set(['g1']), selectionAnchor: 'g1' });
  assert.equal(History.canUndo(hist, BOARD_MAIN), true, '준비: 되돌릴 것이 있다');
  assert.equal(Version.currentIsKept(deps), false, '지금 본문은 어느 판본에도 없다 — 화면이 한 번 더 묻는다');

  const dirty = Version.openVersion(deps, { id: store.versions[0].id });
  assert.equal(dirty.notify.kind, 'status');
  assert.equal(placementsOf(store).length, 2, 'A안의 안무표가 지금 안무표가 됐다');
  assert.equal(store.get().selection.size, 0, '선택이 남았다');
  assert.equal(store.get().selectionAnchor, null);
  assert.equal(History.canUndo(hist, BOARD_MAIN), false, '되돌리기가 판을 열기 전으로 샌다 — 바닥이 연 판이어야 한다');
  assert.equal(store.versions.length, 1, '다른 판본이 사라졌다');
  assert.equal(store.practiceLogs.length, 1, '기록이 사라졌다');
  assert.equal(Version.currentIsKept(deps), true, '방금 연 그대로면 남은 것으로 친다');

  // 없는 판본은 아무 일도 하지 않는다
  assert.equal(Version.openVersion(deps, { id: 'nope' }).notify, undefined);
});

test('판본을 열면 선택·되돌리기가 비고 다른 판본과 기록은 남는다 — 새로고침으로 되살린 그 판은 「남았다」로 친다', () => {
  // 브라우저 시험에서 찾았다(2026-11-03): 동작 목록이 이름순이 아닌 채로 판본을 뜨고 새로고침하면, 되살리기가 목록을
  // 이름순으로 세워(domain/moves.normalizeLibrary) 지금 본문이 판본과 「다르다」로 보였다 — 고친 것이 없는데 `정말요?` 가 떴다.
  const store = seeded();
  store.update({ library: [
    { id: 'm2', name: 'Suzie Q', category: 'step' }, { id: 'm1', name: 'Air Step', category: 'step' }
  ] });
  store.setBoard(BOARD_MAIN, { placements: placementsOf(store).map(p => ({ ...p, category: 'step' })) });
  const { deps } = makeDeps(store);
  Version.snapshotVersion(deps, { label: 'A안' });
  const draft = JSON.parse(JSON.stringify(Project.draftSnapshot(deps, { fileName: '' })));
  const back = createStore();
  const again = makeDeps(back).deps;
  Project.restoreDraft(again, draft);
  assert.equal(Version.currentIsKept(again), true, '되살린 그대로인데 판본에 없다고 한다 — 정규화가 바꾼 차례를 「고침」으로 본다');
  // 정말 고치면 「없다」
  back.setBoard(BOARD_MAIN, { placements: [] });
  assert.equal(Version.currentIsKept(again), false);
});

test('판본을 지워도 자식 판본과 기록이 깨지지 않는다', () => {
  const store = seeded();
  const { deps } = makeDeps(store);
  Version.snapshotVersion(deps, { label: 'A안' });
  const parentId = store.versions[0].id;
  Version.snapshotVersion(deps, { label: 'B안' });
  Version.saveLog(deps, { id: 'L1', at: '2026-11-01', versionId: parentId });

  const dirty = Version.deleteVersion(deps, { id: parentId });
  assert.equal(dirty.versions, true);
  assert.equal(store.versions.length, 1);
  assert.equal(store.versions[0].parentId, parentId, '자식의 부모 id 를 지웠다 — 그대로 둔다(dangling 허용)');
  assert.equal(store.practiceLogs[0].versionId, parentId, '기록의 판본 표시를 지웠다');

  // 정규화 · 요약 · 기록 목록이 던지지 않는다
  const back = normalizeVersions(JSON.parse(JSON.stringify(store.versions)));
  assert.equal(back[0].parentId, parentId);
  assert.doesNotThrow(() => versionSummaries(back));
  const logs = normalizePracticeLogs(JSON.parse(JSON.stringify(store.practiceLogs)));
  assert.equal(logs[0].versionId, parentId);
  assert.doesNotThrow(() => practiceLogParts(logs[0], { cols: 8, versionLabel: '', clipName: '' }));

  // 이름 고치기 — 비우면 옛 이름을 남긴다
  const id = store.versions[0].id;
  Version.editVersionMeta(deps, { id, label: '공연본', note: '무대용' });
  assert.equal(store.versions[0].label, '공연본');
  Version.editVersionMeta(deps, { id, label: '   ' });
  assert.equal(store.versions[0].label, '공연본');
  assert.equal(Version.deleteVersion(deps, { id: 'nope' }).versions, undefined, '없는 판본을 지웠다고 한다');
});

test('연습 기록은 손상된 값을 접고 날짜 오름차순으로 왕복한다', () => {
  const raw = [
    { id: 'c', at: '2026-11-03', attempts: -2, cleanRuns: 3, rating: 9, scope: { from: 'x' }, bpm: -1 },
    { id: 'none' },
    { id: 'a', at: '2026-11-01', attempts: 4, cleanRuns: 7, rating: 3, rate: 0.75,
      scope: { from: { row: 4, index: 7 }, to: { row: 3, index: 0 } }, trouble: '8x3에서 늦음' },   // 뒤집힌 구간은 바로 세운다
    { at: '2026-11-02' },                        // id 가 없다 — 고칠 수도 지울 수도 없어 버린다
    { id: 'a', at: '2026-10-01' },               // 같은 id — 앞의 것을 남긴다
    { id: 'b', at: '2026-11-02', bpm: 160 }
  ];
  const logs = normalizePracticeLogs(raw);
  assert.deepEqual(logs.map(l => l.id), ['a', 'b', 'c', 'none'], '날짜 오름차순, 날짜 모르는 줄은 맨 뒤');
  const [a, , c] = logs;
  assert.equal(a.cleanRuns, 4, '깨끗한 수가 시도 수보다 크면 시도 수로 접는다');
  assert.equal(c.attempts, null, '음수 시도 수는 모름');
  assert.equal(c.cleanRuns, 3);
  assert.equal(c.rating, null, '범위 밖 별점은 모름');
  assert.equal(c.scope, null, '손상된 구간은 모름');
  assert.equal(c.bpm, null);

  assert.deepEqual(a.scope, { from: { row: 3, index: 0 }, to: { row: 4, index: 7 } }, '뒤집힌 구간을 바로 세운다');

  // 구간 표기는 연습기(practice.countRangeLabel) · 마커(videoPanel.formatRange)와 같다
  assert.equal(scopeLabel(a.scope, 8), countRangeLabel({ fromCount: 16, toCount: 32 }, 8));
  assert.equal(scopeLabel(a.scope, 8), '8x3 ~ 8x4');
  const part = { from: { row: 3, index: 2 }, to: { row: 4, index: 1 } };
  assert.equal(scopeLabel(part, 8), formatRange(18, 26, 8), '마디로 떨어지지 않는 구간은 마커 이름과 같은 말');
  assert.deepEqual(parseScope(scopeLabel(a.scope, 8), 8), { ok: true, scope: a.scope }, '표기를 다시 읽으면 같은 구간');
  assert.deepEqual(parseScope('', 8), { ok: true, scope: null });
  assert.equal(parseScope('8x', 8).ok, false);

  // 왕복 — 빈 칸은 파일에 쓰지 않고, 다시 읽으면 깊게 같다
  const file = serializePracticeLogs(logs);
  assert.deepEqual(file.find(l => l.id === 'none'), { id: 'none' });
  assert.deepEqual(normalizePracticeLogs(JSON.parse(JSON.stringify(file))), logs);
  assert.equal(serializePracticeLogs([]), null, '비면 키째 빠진다');

  // 적기 · 고치기 · 지우기
  const store = seeded();
  const { deps } = makeDeps(store);
  Version.saveLog(deps, { id: 'L2', at: '2026-11-02' });
  Version.saveLog(deps, { id: 'L1', at: '2026-11-01', attempts: '3', cleanRuns: '1' });
  assert.deepEqual(store.practiceLogs.map(l => l.id), ['L1', 'L2']);
  assert.equal(store.practiceLogs[0].attempts, 3, '화면 칸의 글자를 수로 받는다');
  Version.saveLog(deps, { id: 'L1', at: '2026-11-05' });
  assert.deepEqual(store.practiceLogs.map(l => l.id), ['L2', 'L1'], '고친 뒤 날짜 차례로 다시 선다');
  assert.equal(Version.saveLog(deps, { at: '2026-11-05' }).versions, undefined, 'id 없는 기록을 적었다');
  Version.deleteLog(deps, { id: 'L2' });
  assert.deepEqual(store.practiceLogs.map(l => l.id), ['L1']);
});

test('이 테이크 기록은 영상 id와 찍은 날을 채운 기록 초안을 만든다', () => {
  const store = seeded();
  store.update({ media: { activeId: 'c1', clips: [
    { id: 'c1', name: '3주차', takenAt: '2026-10-20' },
    { id: 'c2', name: '날짜 없음' }
  ] } });
  const { deps } = makeDeps(store);
  Version.snapshotVersion(deps, { label: 'A안' });

  const draft = Version.logDraft(deps, { today: '2026-11-03', clipId: 'c1' });
  assert.equal(draft.clipId, 'c1');
  assert.equal(draft.at, '2026-10-20', '찍은 날을 채운다');
  assert.equal(draft.versionId, store.versions[0].id, '지금 바탕 판본을 채운다');
  assert.equal(store.practiceLogs.length, 0, '초안은 store 에 쓰지 않는다 — `기록 적기` 를 눌러야 쌓인다');

  const noDate = Version.logDraft(deps, { today: '2026-11-03', clipId: 'c2' });
  assert.equal(noDate.at, '2026-11-03', '날짜 없는 클립은 주입한 오늘로 채운다');
  assert.equal(noDate.clipId, 'c2');

  // 연습기에 마디 반복 구간이 걸려 있으면 구간과 배속도 채운다(RM-22 이음매)
  store.patch('session', { video: { ...store.get().session.video, practice: { fromCount: 16, toCount: 32 }, rate: 0.75 } });
  const looped = Version.logDraft(deps, { today: '2026-11-03' });
  assert.equal(looped.clipId, '');
  assert.equal(scopeLabel(looped.scope, 8), countRangeLabel({ fromCount: 16, toCount: 32 }, 8));
  assert.equal(looped.rate, 0.75);
});

test('판본·기록은 저장→다시 열기·초안 되살리기 왕복에서 살아남는다', () => {
  const store = seeded();
  const { deps, downloads } = makeDeps(store);
  Version.snapshotVersion(deps, { label: 'A안', note: '메모' });
  Version.snapshotVersion(deps, { label: 'B안' });
  Version.saveLog(deps, { id: 'L1', at: '2026-11-01', attempts: 5, cleanRuns: 3, rating: 4,
    scope: { from: { row: 1, index: 2 }, to: { row: 2, index: 7 } }, trouble: '턴이 늦음' });
  const want = { versions: store.versions, practiceLogs: store.practiceLogs, versionBase: store.get().versionBase };

  Project.saveProject(deps, { fileName: '시험' });
  const saved = JSON.parse(JSON.stringify(downloads[0].payload));
  const reopened = createStore();
  Project.loadProjectFromRecent(makeDeps(reopened).deps, saved);
  assert.deepEqual({ versions: reopened.versions, practiceLogs: reopened.practiceLogs, versionBase: reopened.get().versionBase }, want,
    '저장 → 다시 열기에서 판본 · 기록이 달라졌다');

  const fromFile = createStore();
  Project.loadProjectFromFile(makeDeps(fromFile).deps, { data: structuredClone(saved), fileName: '시험-project.json' });
  assert.deepEqual(fromFile.versions, want.versions, '파일에서 열기에서 판본이 달라졌다');

  const draft = JSON.parse(JSON.stringify(Project.draftSnapshot(deps, { fileName: '시험' })));
  const restored = createStore();
  Project.restoreDraft(makeDeps(restored).deps, draft);
  assert.deepEqual({ versions: restored.versions, practiceLogs: restored.practiceLogs, versionBase: restored.get().versionBase }, want,
    '초안 되살리기에서 판본 · 기록이 달라졌다');

  // 판본을 안 쓴 파일을 열면 앞의 판본 · 기록이 비워진다(다른 안무의 것이 남지 않는다)
  Project.loadProjectFromRecent(makeDeps(restored).deps, { rows: 4, cols: 8, moveLibrary: [], placements: [] });
  assert.deepEqual([restored.versions, restored.practiceLogs, restored.get().versionBase], [[], [], '']);
});

test('판본·기록을 안 쓴 파일은 저장 바이트가 한 글자도 늘지 않는다', () => {
  const store = seeded();
  const { deps, downloads } = makeDeps(store);
  Project.saveProject(deps, { fileName: '시험' });
  const payload = downloads[0].payload;
  for (const key of ['versions', 'practiceLogs', 'baseVersionId', 'mediaRefs']) {
    assert.equal(key in payload, false, `${key}: 판본 · 기록을 안 썼는데 키가 실렸다`);
  }
  assert.equal(payload.version, 1, '판본 · 기록이 없으면 쓰기 버전은 1 그대로다');
  // 기능 전의 저장(판본 · 기록 옵션 없이 지은 것)과 문자열이 한 글자도 다르지 않다
  const before = buildProjectFile({ ...docView(store.get()), ...docView(store.get()).links }, {
    fileName: '시험', savedAt: payload.savedAt, favoriteRoutineIds: store.get().favorites.routineIds
  });
  assert.equal(JSON.stringify(payload), JSON.stringify(before));

  // 초안도 같다
  const draft = Project.draftSnapshot(deps, { fileName: '시험' });
  assert.equal('versions' in draft || 'practiceLogs' in draft, false);
});

test('판본·기록은 되돌리기 스냅샷에 들지 않는다', () => {
  const store = seeded();
  const hist = History.createHistory(store);
  const { deps } = makeDeps(store, hist);
  History.reset(hist, BOARD_MAIN);
  Version.snapshotVersion(deps, { label: '판본이름표' });
  Version.saveLog(deps, { id: 'L1', at: '2026-11-01', trouble: '기록표지' });

  // 동작 하나를 옮기고 커밋한다
  const moved = placementsOf(store).map(p => (p.groupId === 'g2' ? { ...p, row: 3 } : p));
  store.setBoard(BOARD_MAIN, { placements: moved });
  History.commit(hist, BOARD_MAIN);
  const stack = hist.stack(BOARD_MAIN);
  const text = JSON.stringify([stack.past, stack.present, stack.future]);
  for (const mark of ['판본이름표', '기록표지', 'practiceLogs', 'versionBase']) {
    assert.equal(text.includes(mark), false, `${mark}: 되돌리기 스냅샷에 판본 · 기록이 들었다`);
  }

  History.undo(hist, BOARD_MAIN);
  assert.equal(placementsOf(store).find(p => p.groupId === 'g2').row, 1, '준비: 옮기기가 되돌려졌다');
  assert.equal(store.versions.length, 1, 'Undo 가 판본을 없앴다');
  assert.equal(store.practiceLogs.length, 1, 'Undo 가 기록을 없앴다');
});

test('판본이 든 파일은 쓰기 버전을 올려 옛 앱이 거절하게 한다', () => {
  // 옛 앱(RM-29 전)의 SCHEMA_VERSION 은 2 — 그보다 큰 version 을 단 파일은 FUTURE_SCHEMA 로 거절한다
  const OLD_APP_SCHEMA = 2;
  const store = seeded();
  const { deps, downloads } = makeDeps(store);
  Version.snapshotVersion(deps, { label: 'A안' });
  Project.saveProject(deps, { fileName: '판본' });
  const withVersions = downloads[0].payload;
  assert.equal(withVersions.version, SCHEMA_VERSION);
  assert.ok(withVersions.version > OLD_APP_SCHEMA, '옛 앱이 이 파일을 열어 판본을 조용히 버린다');
  // 이 앱보다 새 판의 파일을 이 앱이 거절하는 것과 같은 길이다
  assert.equal(migrateProjectFile({ ...withVersions, version: SCHEMA_VERSION + 1 }).code, 'FUTURE_SCHEMA');
  assert.equal(migrateProjectFile(withVersions).ok, true, '이 앱은 자기가 쓴 파일을 연다');

  // 기록만 있어도 올린다 — 기록도 옛 앱이 버린다
  const logOnly = seeded();
  const second = makeDeps(logOnly);
  Version.saveLog(second.deps, { id: 'L1', at: '2026-11-01' });
  Project.saveProject(second.deps, { fileName: '기록' });
  assert.equal(second.downloads[0].payload.version, SCHEMA_VERSION);
  assert.equal('baseVersionId' in second.downloads[0].payload, false, '판본이 없으면 바탕 판본 id 도 쓰지 않는다');

  // 둘 다 없으면 1 그대로
  const plain = makeDeps(seeded());
  Project.saveProject(plain.deps, { fileName: '빈' });
  assert.equal(plain.downloads[0].payload.version, 1);

  // v3 파일을 다시 정규화해도 판본이 남는다
  const n = normalizeProject(JSON.parse(JSON.stringify(withVersions)), { ids: env(), defaultCategories: DEFAULT_CATEGORIES });
  assert.equal(n.versions.length, 1);
});
