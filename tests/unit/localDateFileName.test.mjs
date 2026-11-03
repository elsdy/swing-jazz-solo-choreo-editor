// tests/unit/localDateFileName.test.mjs — 기본 파일 이름 · 「만든 날」의 날짜는 이 기계의 지역 날짜다 (RM-62)
//
// 이름 칸을 비운 채 저장하면 project_ · moves_ · categories_ 뒤에 날짜가 붙는다. 그 날짜가 UTC ISO 시각을 앞 열 글자로
// 자른 것(nowIso().slice(0, 10))이어서 한국(UTC+9)의 00:00~08:59 에는 어제로 붙었다. 인쇄용 안무표의 「만든 날」도
// 같은 꼴이었다. 이제 날짜는 env.localDate() — 이 기계의 지역 날짜 — 에서 온다. 파일 안의 savedAt 은 그대로 UTC ISO 다.
//
// 아래 env 는 「KST 2026-11-03 08:30」을 흉내 낸다 — UTC 로는 아직 11-02 이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from '../../src/usecases/store.js';
import { counterEnv } from '../../src/ports/env.js';
import * as Project from '../../src/usecases/projectCommands.js';
import * as Sheet from '../../src/usecases/sheetCommands.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UTC_ISO = '2026-11-02T23:30:00.000Z'; // KST 2026-11-03 08:30
const LOCAL_DAY = '2026-11-03';

function deps() {
  const downloads = [];
  return {
    downloads,
    store: createStore({ ids: counterEnv() }),
    env: { ...counterEnv(), nowIso: () => UTC_ISO, localDate: () => LOCAL_DAY },
    files: {
      downloadJson(payload, fileName) { downloads.push({ payload, fileName }); },
      downloadText(text, fileName) { downloads.push({ text, fileName }); }
    },
    storage: { saveRecents() {}, saveRoutineFavorites() {}, saveLinks() {} },
    commitHistory() {}
  };
}

test('[RM-62 요구 0] 이름 없이 저장하면 project_ 뒤에 지역 날짜가 붙는다', () => {
  const d = deps();
  Project.saveProject(d, { fileName: '   ' });
  assert.equal(d.downloads.length, 1);
  assert.equal(d.downloads[0].payload.fileName, `project_${LOCAL_DAY}`);
  assert.equal(d.downloads[0].fileName, `project_${LOCAL_DAY}-project.json`, '내려받는 이름도 지역 날짜');
  assert.equal(d.store.get().recents.projects[0].fileName, `project_${LOCAL_DAY}`, '최근 목록의 이름도 같다');
});

test('[RM-62 요구 1] 동작 목록 · 카테고리 기본 이름도 지역 날짜를 쓴다', () => {
  const d = deps();
  Project.saveMoveList(d, {});
  Project.saveCategories(d, { fileName: '' });
  assert.deepEqual(d.downloads.map(x => x.payload.fileName), [`moves_${LOCAL_DAY}`, `categories_${LOCAL_DAY}`]);
  assert.deepEqual(d.downloads.map(x => x.fileName), [`moves_${LOCAL_DAY}-moves.json`, `categories_${LOCAL_DAY}-categories.json`]);
});

test('[RM-62 요구 2] savedAt 은 UTC ISO 그대로다', () => {
  const d = deps();
  Project.saveProject(d, {});
  Project.saveMoveList(d, {});
  Project.saveCategories(d, {});
  assert.deepEqual(d.downloads.map(x => x.payload.savedAt), [UTC_ISO, UTC_ISO, UTC_ISO]);
});

test('이름을 적으면 날짜를 붙이지 않는다 — 지역 날짜를 읽지도 않는다', () => {
  const d = deps();
  d.env.localDate = () => { throw new Error('읽으면 안 된다'); };
  Project.saveProject(d, { fileName: '해피핏' });
  assert.equal(d.downloads[0].payload.fileName, '해피핏');
});

test('env 에 localDate 가 없으면 빈 이름 저장은 무엇이 빠졌는지 말하며 던진다', () => {
  const d = deps();
  delete d.env.localDate;
  assert.throws(() => Project.saveProject(d, {}), /env\.localDate\(\)/);
});

test('인쇄용 안무표의 「만든 날」도 지역 날짜다', () => {
  const d = deps();
  const html = Sheet.sheetHtml(d, { title: '링디합' });
  assert.match(html, new RegExp(`만든 날 ${LOCAL_DAY}`));
  assert.doesNotMatch(html, /만든 날 2026-11-02/);
});

test('browserEnv.localDate 는 이 기계의 시간대로 날짜를 낸다 — KST 08:30 은 그날이다', () => {
  // 시간대는 프로세스가 켜질 때 정해지므로 TZ 를 준 자식 node 로 잰다.
  const url = pathToFileURL(join(ROOT, 'src', 'adapters', 'browser.js')).href;
  const code = `import(${JSON.stringify(url)}).then(m => {
    const at = new Date(${JSON.stringify(UTC_ISO)});
    process.stdout.write(JSON.stringify([m.browserEnv.localDate(at), typeof m.browserEnv.localDate()]));
  });`;
  for (const [tz, want] of [['Asia/Seoul', '2026-11-03'], ['UTC', '2026-11-02'], ['America/Los_Angeles', '2026-11-02']]) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [want, 'string'], tz);
  }
});
