// tests/unit/domain.test.mjs — 골든이 못 덮는 **신규 코드**의 단위 테스트
//
//   node --test tests/          이 파일 하나를 돌린다 (의존성 0, DOM 0)
//
// 골든(tests/golden/*.json)은 index.html 원문에서 뽑은 것이라 원문에 없던 코드는 한 줄도 덮지 못한다.
// 여기서 검사하는 것이 정확히 그 여집합이다:
//   · domain/tempo.js          — 원본에 대응물이 아예 없는 신설 모듈(카운트 ↔ 초)
//   · ports/media.js           — 신설 포트. 계약 위반을 잡는 게 이 파일의 존재 이유다
//   · usecases/store.mergeDirty — 원본에 없던 Dirty 대수(代數). 결합법칙이 깨지면 렌더가 조용히 샌다
//   · domain/project/migrations — version 필드의 첫 독자. v1 파일이 오늘처럼 열려야 한다
//   · domain/grid 의 카운트 축   — linearOf/cellOf 는 신설이고 tempo 가 그 위에 서 있다
//   · domain/boardOps 의 충돌 규칙 — 2026-09-07 에 **의도적으로** 원본과 갈라졌다. 골든은 시나리오별
//     결과만 못박지만, 여기서는 그 결과를 낳는 성질("네 조작이 하나의 규칙")을 직접 단언한다
//   · 영상 패널(2026-09) — adapters/media 의 YouTube 어댑터가 포트 계약을 채우는지, pickPlayer 의
//     URL 분기, videoCommands 의 두 점 앵커·탭 템포, 그리고 **media 가 없는 옛 파일의 왕복**

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  boardSignature, buildSegments, cellOf, linearOf, totalCellsFrom
} from '../../src/domain/grid.js';
import {
  DEFAULT_TEMPO, cellToTime, countToTime, isTempoUsable, normalizeTempo,
  placementToSpan, secondsPerCount, tempoFromTwoPoints, timeToCell, timeToCount
} from '../../src/domain/tempo.js';
import {
  MEDIA_PLAYER_MEMBERS, assertMediaPlayer, isMediaPlayer, normalizeClipSegments
} from '../../src/ports/media.js';
import {
  DEFAULT_ROUTINE_COLOR, MIN_CONTRAST, TEXT_DARK, TEXT_LIGHT, bestContrastOn,
  categoryColor, contrastRatio, darken, normalize as normalizeCategories,
  parseHexColor, resolvePlacementColor, textColorOn
} from '../../src/domain/categories.js';
import { DEFAULT_CATEGORIES } from '../../src/domain/defaults.js';
import { ROUTINE_COLORS } from '../../src/domain/routines.js';
import { createNullMediaPlayer } from '../../src/adapters/nullMediaPlayer.js';
import {
  BOARD_MAIN, BOARD_ROUTINE, NONE, assertDirty, createStore, mergeDirty
} from '../../src/usecases/store.js';
import {
  DOC_FIELDS, ROUTINE_UNDO_FIELDS, SCHEMA_VERSION, UNDO_FIELDS
} from '../../src/domain/project/schema.js';
import { applySnapshot, pickUndoFields, toLinkBundle } from '../../src/domain/project/snapshot.js';
import * as History from '../../src/usecases/historyCommands.js';
import { clearBoard } from '../../src/usecases/boardCommands.js';
import { serializeLinks } from '../../src/domain/links.js';
import { CLEAR_BTN_LABEL } from '../../src/input/controls.js';
import { detectSchemaVersion, migrateProjectFile } from '../../src/domain/project/migrations.js';
import {
  DEFAULT_MEDIA, isEmptyMedia, normalizeMedia, normalizeMediaSource, serializeMedia
} from '../../src/domain/project/media.js';
import { buildProjectFile } from '../../src/domain/project/serialize.js';
import { createYouTubePlayer, YT_CAPABILITIES } from '../../src/adapters/media/youtubePlayer.js';
import { mediaSourceFromUrl, pickPlayer, pickPlayerKind } from '../../src/adapters/media/pickPlayer.js';
import * as VideoCmd from '../../src/usecases/videoCommands.js';
import { normalizeProject } from '../../src/domain/project/normalize.js';
import { counterEnv } from '../../src/ports/env.js';
import {
  COPY_POLICY, MOVE_POLICY, PLACE_POLICY, RESIZE_POLICY,
  copyGroup, moveGroup, place, resizeGroup
} from '../../src/domain/boardOps.js';

const COLS_CASES = [1, 8, 128];

// ── undo × 링크 테스트가 공유하는 표본 ──────────────────────────────────────
/** 링크 4필드가 전부 채워진 표본. **매번 새 객체**를 준다(테스트끼리 배열을 공유하면 안 된다). */
const LINKS_SAMPLE = () => ({
  youtubeUrl: 'https://www.youtube.com/watch?v=abc',
  youtubeTitle: '스윙 솔로 안무',
  clickupUrl: 'https://app.clickup.com/t/123',
  customLinks: [{ id: 'c1', label: '안무 메모', url: 'https://example.com/memo' }]
});
/** `전체 초기화`(linkCommands.clearLinks)가 남기는 값. */
const EMPTY_LINKS = () => ({ youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: [] });

/** saveLinks 주입을 기록하는 가짜 저장 포트. 인자는 **깊은 복제로** 붙잡는다(나중 변형에 오염되지 않게). */
function fakeLinkStorage() {
  const calls = [];
  return { calls, saveLinks(payload) { calls.push(JSON.parse(JSON.stringify(payload))); } };
}

/** 배치 1개 + 링크 4필드가 채워진 store. DOM 도 어댑터도 쓰지 않는다. */
function seededStore() {
  const store = createStore();
  store.setBoard(BOARD_MAIN, {
    placements: [{ id: 'p1', groupId: 'g1', name: 'Suzie Q', category: 'step', row: 1, startIndex: 0, length: 4 }]
  });
  store.patch('links', LINKS_SAMPLE());
  return store;
}
const TEMPOS = [
  normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 0 }),
  normalizeTempo({ bpm: 187.5, beatsPerCount: 2, anchorSec: 12.34, anchorCount: 17 }),
  normalizeTempo({ bpm: 400, beatsPerCount: 0.125, anchorSec: -3, anchorCount: -40 })
];

// ─────────────────────────────────────────────────────────────────────────────
// domain/grid — 카운트 축
// ─────────────────────────────────────────────────────────────────────────────

test('grid: linearOf ↔ cellOf 는 음수 구간(intro 행)에서도 서로의 역이다', () => {
  for (const cols of COLS_CASES) {
    for (let n = -300; n <= 300; n++) {
      const { row, index } = cellOf(n, cols);
      assert.ok(index >= 0 && index < cols, `cols=${cols} n=${n} index=${index} 가 [0,cols) 밖`);
      assert.equal(linearOf(row, index, cols), n, `cols=${cols} n=${n} 왕복 실패`);
    }
  }
});

test('grid: intro 행(row 0)은 분기 없이 음수 카운트 구간 [-cols,-1] 로 떨어진다', () => {
  for (const cols of COLS_CASES) {
    for (let i = 0; i < cols; i++) {
      const n = linearOf(0, i, cols);
      assert.ok(n >= -cols && n <= -1, `cols=${cols} i=${i} → ${n}`);
    }
    assert.equal(linearOf(1, 0, cols), 0, '본문 첫 칸이 원점이다');
  }
});

test('grid: totalCellsFrom 은 카운트 축의 뺄셈과 같은 값이다', () => {
  for (const cols of COLS_CASES) {
    for (const rows of [1, 4, 8, 33]) {
      const board = { rows, cols, hasIntroRow: true };
      for (let row = 0; row <= rows; row++) {
        for (const startIndex of [0, Math.floor(cols / 2), cols - 1]) {
          // 보드 끝 = 마지막 행의 다음 행 0칸. 그 카운트에서 현재 카운트를 빼면 남은 칸 수다.
          const expected = linearOf(rows + 1, 0, cols) - linearOf(row, startIndex, cols);
          assert.equal(totalCellsFrom(row, startIndex, board), expected);
        }
      }
    }
  }
});

test('grid: buildSegments 는 보드 안에서 요청 카운트를 정확히 나눠 담는다', () => {
  const board = { rows: 8, cols: 8, hasIntroRow: true };
  for (const start of [{ row: 0, index: 0 }, { row: 1, index: 3 }, { row: 8, index: 7 }]) {
    for (const count of [0, 1, 7, 8, 9, 64, 200]) {
      const segs = buildSegments(start.row, start.index, count, board);
      const capped = Math.max(0, Math.min(count, totalCellsFrom(start.row, start.index, board)));
      assert.equal(segs.reduce((s, x) => s + x.length, 0), capped);
      // 세그먼트는 카운트 축에서 빈틈 없이 이어진다
      let cursor = linearOf(start.row, start.index, board.cols);
      for (const seg of segs) {
        assert.equal(linearOf(seg.row, seg.startIndex, board.cols), cursor);
        cursor += seg.length;
      }
    }
  }
  assert.equal(boardSignature(board), '8x8');
});

// ─────────────────────────────────────────────────────────────────────────────
// domain/tempo — 원본에 대응물이 없는 신설 모듈
// ─────────────────────────────────────────────────────────────────────────────

test('tempo: countToTime ↔ timeToCount 는 -300..300 카운트에서 왕복한다', () => {
  for (const tempo of TEMPOS) {
    assert.ok(isTempoUsable(tempo));
    for (let count = -300; count <= 300; count++) {
      const sec = countToTime(count, tempo);
      assert.ok(Math.abs(timeToCount(sec, tempo) - count) < 1e-9, `count=${count} 왕복 실패`);
    }
  }
});

test('tempo: cellToTime ↔ timeToCell 은 cols 1/8/128 에서 같은 칸으로 되돌아온다', () => {
  for (const cols of COLS_CASES) {
    for (const tempo of TEMPOS) {
      for (let n = -300; n <= 300; n += 7) {
        const { row, index } = cellOf(n, cols);
        const sec = cellToTime(row, index, cols, tempo);
        const back = timeToCell(sec, cols, tempo);
        assert.equal(back.row, row, `cols=${cols} n=${n} row`);
        assert.equal(back.index, index, `cols=${cols} n=${n} index`);
        // 칸 경계에 정확히 선 시각이므로 진행률은 0 이어야 한다(부동소수 오차를 흡수한 뒤)
        assert.ok(back.fraction < 1e-6, `cols=${cols} n=${n} fraction=${back.fraction}`);
      }
    }
  }
});

test('tempo: timeToCell 의 fraction 은 언제나 [0,1) 이다 — intro 행(음수 카운트) 포함', () => {
  const cols = 8;
  const tempo = TEMPOS[0];
  const spc = secondsPerCount(tempo);
  for (let n = -40; n < 40; n++) {
    for (const frac of [0, 0.001, 0.25, 0.5, 0.999]) {
      const cell = timeToCell(countToTime(n, tempo) + frac * spc, cols, tempo);
      assert.ok(cell.fraction >= 0 && cell.fraction < 1, `n=${n} frac=${frac} → ${cell.fraction}`);
      assert.equal(linearOf(cell.row, cell.index, cols), n);
      // intro 행은 정확히 [-cols,-1] 한 행 분량이다(그보다 더 음수면 그 위의 가상 행이 된다)
      if (n >= -cols && n < 0) assert.equal(cell.row, 0, 'intro 행은 음수 카운트 구간이다');
    }
  }
});

test('tempo: placementToSpan 은 8카운트를 정확히 8 * secondsPerCount 로 만든다', () => {
  for (const cols of COLS_CASES) {
    for (const tempo of TEMPOS) {
      const spc = secondsPerCount(tempo);
      const span = placementToSpan({ row: 2, startIndex: 0, length: 8 }, cols, tempo);
      assert.ok(Math.abs((span.endSec - span.startSec) - 8 * spc) < 1e-9);
      assert.ok(Math.abs(span.startSec - cellToTime(2, 0, cols, tempo)) < 1e-12);
    }
  }
});

test('tempo: tempoFromTwoPoints 는 역전·동일시각·동일카운트를 전부 null 로 거부한다', () => {
  const ok = tempoFromTwoPoints({ count: 0, sec: 1 }, { count: 32, sec: 17 });
  assert.ok(ok && ok.bpm > 0, '정상 두 점은 템포를 만든다');
  assert.equal(ok.anchorSec, 1);
  assert.equal(ok.anchorCount, 0);

  assert.equal(tempoFromTwoPoints({ count: 32, sec: 17 }, { count: 0, sec: 1 }), null, '카운트 역전');
  assert.equal(tempoFromTwoPoints({ count: 0, sec: 17 }, { count: 32, sec: 1 }), null, '시각 역전');
  assert.equal(tempoFromTwoPoints({ count: 0, sec: 5 }, { count: 32, sec: 5 }), null, '동일 시각');
  assert.equal(tempoFromTwoPoints({ count: 8, sec: 1 }, { count: 8, sec: 5 }), null, '동일 카운트');
  assert.equal(isTempoUsable(DEFAULT_TEMPO), false, 'bpm 0 은 아직 미설정이다');
});

// ─────────────────────────────────────────────────────────────────────────────
// ports/media — 계약 위반을 잡는 것이 존재 이유다
// ─────────────────────────────────────────────────────────────────────────────

test('media: 널 재생기는 MediaPlayer 계약을 통과한다', () => {
  assert.equal(MEDIA_PLAYER_MEMBERS.length, 14);
  const player = createNullMediaPlayer();
  assert.equal(assertMediaPlayer(player), player, '통과하면 받은 것을 그대로 돌려준다');
  assert.equal(isMediaPlayer(player), true);
});

test('media: 멤버 하나를 뺀 가짜 14벌이 전부 거부된다', () => {
  for (const member of MEDIA_PLAYER_MEMBERS) {
    const fake = { ...createNullMediaPlayer() };
    delete fake[member];
    assert.equal(isMediaPlayer(fake), false, `${member} 를 빼도 통과했다`);
    assert.throws(
      () => assertMediaPlayer(fake, '가짜'),
      (err) => err instanceof TypeError && err.message.includes(member),
      `${member} 이름이 오류 메시지에 없다`
    );
  }
  assert.equal(isMediaPlayer(null), false);
  assert.equal(isMediaPlayer({}), false);
});

test('media: normalizeClipSegments 는 쓰레기를 전부 흡수한다', () => {
  const out = normalizeClipSegments([
    null, 42, 'seg', { startSec: 'x', endSec: 1 }, { startSec: 0, endSec: NaN },
    { id: 'a', startSec: 0, endSec: 0 },              // 영길이 → 버린다
    { id: 'b', startSec: 5, endSec: 2 },              // 역전 → 뒤집어 살린다
    { startSec: 1, endSec: 2 },                       // id 없음 → 인덱스로 발급
    { id: 'b', startSec: 8, endSec: 9, label: 7 },    // 중복 id → 접미
    { id: 'c', startSec: 1, endSec: 2, meta: { k: 1 } }
  ]);
  assert.deepEqual(out.map(s => s.id), ['b', 'seg7', 'b#8', 'c']);
  assert.deepEqual(out[0], { id: 'b', startSec: 2, endSec: 5 });
  assert.equal(out[2].label, '7', 'label 은 문자열로 정규화된다');
  assert.deepEqual(out[3].meta, { k: 1 }, 'meta 는 그대로 통과한다');
  for (const seg of out) assert.ok(seg.endSec > seg.startSec);
  assert.deepEqual(normalizeClipSegments(null), []);
  assert.deepEqual(normalizeClipSegments({ length: 2 }), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// usecases/store — Dirty 대수
// ─────────────────────────────────────────────────────────────────────────────

const DIRTY_SAMPLES = [
  NONE,
  { palette: true },
  { boards: { main: { rows: [1, 2] } } },
  { boards: { main: { rows: 'all' }, routine: { skeleton: true } } },
  { boards: { routine: { rows: [3] } }, savedLists: ['moves'] },
  { savedLists: ['projects', 'moves'], history: true },
  { notify: { kind: 'alert', message: '첫 번째' } },
  { notify: { kind: 'alert', message: '두 번째' }, toolbar: true }
];

test('store: mergeDirty 는 결합법칙을 지킨다', () => {
  for (const a of DIRTY_SAMPLES) {
    for (const b of DIRTY_SAMPLES) {
      for (const c of DIRTY_SAMPLES) {
        assert.deepEqual(
          mergeDirty(mergeDirty(a, b), c),
          mergeDirty(a, mergeDirty(b, c)),
          `결합법칙 실패: ${JSON.stringify([a, b, c])}`
        );
      }
    }
  }
});

test('store: mergeDirty 는 입력을 한 글자도 변형하지 않는다', () => {
  const before = DIRTY_SAMPLES.map(d => JSON.stringify(d));
  for (const a of DIRTY_SAMPLES) for (const b of DIRTY_SAMPLES) mergeDirty(a, b);
  assert.deepEqual(DIRTY_SAMPLES.map(d => JSON.stringify(d)), before);

  // 반환된 중첩 구조도 입력과 공유되지 않는다 — 결과를 고쳐도 원본이 안전해야 한다
  const src = { boards: { main: { rows: [1, 2] } }, savedLists: ['moves'] };
  const merged = mergeDirty(NONE, src);
  merged.boards.main.rows.push(99);
  merged.savedLists.push('categories');
  assert.deepEqual(src.boards.main.rows, [1, 2]);
  assert.deepEqual(src.savedLists, ['moves']);
});

test("store: mergeDirty 의 rows 는 'all' 이 흡수하고 배열은 순서를 지키는 합집합이다", () => {
  const all = { boards: { main: { rows: 'all' } } };
  assert.equal(mergeDirty({ boards: { main: { rows: [1, 2] } } }, all).boards.main.rows, 'all');
  assert.equal(mergeDirty(all, { boards: { main: { rows: [1, 2] } } }).boards.main.rows, 'all');
  assert.deepEqual(
    mergeDirty({ boards: { main: { rows: [3, 1] } } }, { boards: { main: { rows: [1, 5] } } }).boards.main.rows,
    [3, 1, 5]
  );
  // ⚠ 한쪽만 있을 때는 중복도 제거하지 않는다(원본 affectedRows 의 중복이 골든에 박혀 있다)
  assert.deepEqual(mergeDirty(NONE, { boards: { main: { rows: [2, 2, 3] } } }).boards.main.rows, [2, 2, 3]);
  assert.equal(mergeDirty({ boards: { main: { skeleton: true } } }, NONE).boards.main.skeleton, true);
});

test('store: mergeDirty 의 savedLists 는 합집합, notify 는 나중 것이 이긴다', () => {
  assert.deepEqual(
    mergeDirty({ savedLists: ['projects', 'moves'] }, { savedLists: ['moves', 'categories'] }).savedLists,
    ['projects', 'moves', 'categories']
  );
  const merged = mergeDirty(
    { notify: { kind: 'alert', message: '첫 번째' } },
    { notify: { kind: 'alert', message: '두 번째' } }
  );
  assert.equal(merged.notify.message, '두 번째');
  assert.deepEqual(mergeDirty(NONE, NONE), {});
});

// ─────────────────────────────────────────────────────────────────────────────
// domain/project/migrations — version 필드의 첫 독자
// ─────────────────────────────────────────────────────────────────────────────

const V1_FILE = Object.freeze({
  version: 1,
  savedAt: '2024-05-05T05:05:05.000Z',
  fileName: 'demo',
  rows: 4,
  cols: 8,
  categories: { step: { label: 'step', color: '#22c55e' } },
  moveLibrary: [{ id: 'm1', name: '스텝', category: 'step' }],
  placements: [{ id: 'p1', groupId: 'g1', name: '스텝', category: 'step', row: 1, startIndex: 0, length: 4, subRow: 0 }],
  routines: [{ id: 'rt', name: '루틴 1', rows: 2, cols: 8, placements: [], color: '#6366f1', isFavorite: true }],
  youtubeUrl: 'https://youtu.be/abc',
  youtubeTitle: '제목',
  clickupUrl: '',
  customLinks: [{ id: 'l1', label: '메모', url: 'https://example.com' }]
});

test('migrations: version 1 파일은 진입 규약(평평한 최상위)이 그대로 유지된 채 열린다', () => {
  const snapshot = JSON.stringify(V1_FILE);
  const res = migrateProjectFile(V1_FILE, { now: () => '1970-01-01T00:00:00.000Z' });
  assert.equal(res.ok, true);
  assert.equal(res.from, 1);
  assert.equal(res.to, SCHEMA_VERSION);
  assert.equal(JSON.stringify(V1_FILE), snapshot, '입력을 변형하지 않는다');

  // usecases/projectCommands.readProjectData 가 하는 되펼치기 한 줄
  const opened = { ...res.value, ...res.value.doc };
  for (const key of ['rows', 'cols', 'categories', 'moveLibrary', 'placements', 'routines',
    'youtubeUrl', 'youtubeTitle', 'clickupUrl', 'customLinks', 'fileName', 'savedAt']) {
    assert.deepEqual(opened[key], V1_FILE[key], `${key} 가 왕복에서 바뀌었다`);
  }
  assert.deepEqual(res.value.doc.links, {
    youtubeUrl: V1_FILE.youtubeUrl, youtubeTitle: V1_FILE.youtubeTitle,
    clickupUrl: V1_FILE.clickupUrl, customLinks: V1_FILE.customLinks
  });
  // 레코드를 날조하지 않는다 — v1 에는 역사가 없다
  assert.deepEqual(res.value.versions, []);
  assert.deepEqual(res.value.practiceLogs, []);
  assert.deepEqual(res.value.media, []);
});

test('migrations: 열린 v1 파일이 normalizeProject 를 그대로 통과한다', () => {
  const opened = { ...migrateProjectFile(V1_FILE).value };
  const flat = { ...opened, ...opened.doc };
  const normalized = normalizeProject(flat, { ids: counterEnv() });
  assert.notEqual(normalized, null, 'v1 파일이 열리지 않았다');
  assert.equal(normalized.rows, 4);
  assert.equal(normalized.cols, 8);
  assert.equal(normalized.placements.length, 1);
  assert.equal(normalized.moveLibrary.length, 1);
  assert.deepEqual([...normalized.favoriteRoutineIds], ['rt']);
  assert.equal(normalized.fileName, 'demo');
});

test('migrations: version 이 없으면 v1, 미래 버전은 거부한다', () => {
  assert.equal(detectSchemaVersion({}), 1, 'version 없는 임의 JSON 도 지금처럼 열려야 한다');
  assert.equal(detectSchemaVersion({ version: 0 }), 1);
  assert.equal(detectSchemaVersion({ version: 2 }), 2);
  assert.equal(migrateProjectFile(null).code, 'NOT_AN_OBJECT');
  assert.equal(migrateProjectFile([]).code, 'NOT_AN_OBJECT');
  assert.equal(migrateProjectFile({ version: SCHEMA_VERSION + 1 }).code, 'FUTURE_SCHEMA');
  // 이미 최신이면 단계가 하나도 적용되지 않는다
  const latest = migrateProjectFile({ version: SCHEMA_VERSION, doc: {} });
  assert.equal(latest.ok, true);
  assert.deepEqual(latest.applied, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// domain/categories — 색 대비. 눈으로 고른 임계값을 대신하는 자리다.
//
// 예전에는 YIQ 밝기 > 90 이면 검은 글자였는데, 그 임계값은 커밋 세 번 만에 남은 값이라
// 기본 팔레트 14색이 전부 90 을 넘었다 — 흰 글자 분기가 죽은 코드였다.
// 이제 두 후보의 대비비를 재서 큰 쪽을 쓰고, **팔레트 전체를 여기서 대입해 검증한다.**
// 색을 새로 넣거나 바꾸면 이 테스트가 먼저 막는다. → docs/PRINCIPLES.md 의 U-4
// ─────────────────────────────────────────────────────────────────────────────

test('parseHexColor 는 3자리·6자리를 받고 그 밖은 null 이다', () => {
  assert.deepEqual(parseHexColor('#abc'), { r: 0xaa, g: 0xbb, b: 0xcc });
  assert.deepEqual(parseHexColor('22c55e'), { r: 0x22, g: 0xc5, b: 0x5e });
  assert.deepEqual(parseHexColor('#22C55E'), { r: 0x22, g: 0xc5, b: 0x5e });
  for (const bad of ['', '#ggg', '#12345', 'rgb(1,2,3)', null, undefined, 42]) {
    assert.equal(parseHexColor(bad), null, `${String(bad)} 는 해석되면 안 된다`);
  }
});

test('contrastRatio 는 흑백에서 21, 같은 색에서 1 이다', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#22c55e', '#22c55e'), 1);
  assert.equal(contrastRatio('#zzz', '#fff'), null);
});

test('textColorOn 은 더 잘 읽히는 쪽을 고른다', () => {
  assert.equal(textColorOn('#ffffff'), TEXT_DARK);
  assert.equal(textColorOn('#000000'), TEXT_LIGHT);
  // 해석할 수 없는 색은 CSS 기본값과 같은 어두운 글자로 떨어진다
  assert.equal(textColorOn('nope'), TEXT_DARK);
  // 고른 색이 실제로 더 나은 쪽임을 정의대로 확인한다
  for (const bg of ['#22c55e', '#6366f1', '#0f172a', '#facc15']) {
    const chosen = contrastRatio(bg, textColorOn(bg));
    const other = contrastRatio(bg, textColorOn(bg) === TEXT_DARK ? TEXT_LIGHT : TEXT_DARK);
    assert.ok(chosen >= other, `${bg}: 고른 글자색이 더 나쁘다 (${chosen} < ${other})`);
  }
});

test('기본 팔레트 전 색이 MIN_CONTRAST 를 넘는다', () => {
  const palette = [
    ...Object.entries(DEFAULT_CATEGORIES).map(([key, v]) => [`카테고리 ${key}`, v.color]),
    ...ROUTINE_COLORS.map((c, i) => [`루틴 ${i + 1}`, c]),
    ['카테고리 폴백', categoryColor({}, '없는키')],
    ['루틴 폴백', DEFAULT_ROUTINE_COLOR],
  ];
  for (const [name, color] of palette) {
    const ratio = bestContrastOn(color);
    assert.ok(
      ratio !== null && ratio >= MIN_CONTRAST,
      `${name} ${color} 의 대비비가 ${ratio?.toFixed(2)} 로 ${MIN_CONTRAST} 미만이다. ` +
      `색을 바꾸거나 글자색 후보를 늘려라 — 눈으로 넘기지 마라.`
    );
  }
});

test('darken 은 검정 쪽으로 섞고 범위를 벗어난 값을 클램프한다', () => {
  assert.equal(darken('#ffffff', 0), '#ffffff');
  assert.equal(darken('#ffffff', 1), '#000000');
  assert.equal(darken('#808080', 0.5), '#404040');
  assert.equal(darken('#ffffff', -1), '#ffffff');   // 클램프
  assert.equal(darken('nope', 0.5), 'nope');        // 해석 못 하면 그대로
});

test('resolvePlacementColor 는 루틴 색을 실제로 칠하고 글자색을 함께 준다', () => {
  const routines = [{ id: 'r1', color: '#ec4899' }];
  const categories = { step: { label: 'step', color: '#22c55e' } };

  const move = resolvePlacementColor({ category: 'step' }, { categories, routines });
  assert.equal(move.background, '#22c55e');
  assert.equal(move.base, '#22c55e');
  assert.equal(move.apply, true);
  assert.equal(move.textColor, textColorOn('#22c55e'));

  const routine = resolvePlacementColor({ type: 'routine', routineId: 'r1' }, { categories, routines });
  assert.ok(routine.background.includes('#ec4899'), '루틴 색이 배경에 들어가야 한다');
  assert.ok(routine.background.startsWith('linear-gradient'), '루틴은 그러데이션이다');
  assert.equal(routine.base, '#ec4899');
  assert.equal(routine.apply, true, '예전에는 apply:false 라 색이 묻혔다 — 되돌아가면 안 된다');
  assert.equal(routine.textColor, textColorOn('#ec4899'));

  // 루틴을 못 찾으면 기본색으로 떨어지되 여전히 칠한다
  const missing = resolvePlacementColor({ type: 'routine', routineId: '없음' }, { categories, routines });
  assert.equal(missing.base, DEFAULT_ROUTINE_COLOR);
  assert.equal(missing.apply, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// undo 스냅샷 × 링크 — 골든이 한 줄도 덮지 못하는 자리
//
// tests/golden/placement-algorithms.json 의 연산 15종에는 undo/redo 가 **없다**. 그래서
// `전체 초기화`가 지운 링크를 Undo 로 되살리는 이 경로의 유일한 안전망이 아래 테스트들이다.
// DOM 도 어댑터도 쓰지 않는다 — usecases + domain 만으로 돌아간다.
// ─────────────────────────────────────────────────────────────────────────────

/** 링크·템포가 undo 로 되돌아오려면 스냅샷 필드여야 한다. 루틴 보드에는 링크바도 영상도 없다. */
test('schema: UNDO_FIELDS 에 links·media 가 있고 ROUTINE_UNDO_FIELDS 에는 없다', () => {
  assert.ok(UNDO_FIELDS.includes('links'), 'links 가 빠지면 전체 초기화한 링크가 Undo 로 안 돌아온다');
  assert.ok(UNDO_FIELDS.includes('media'), 'media 가 빠지면 애써 찍은 템포·앵커가 Undo 로 안 돌아온다');
  assert.ok(!ROUTINE_UNDO_FIELDS.includes('links'), '루틴 편집기에는 링크바가 없다');
  assert.ok(!ROUTINE_UNDO_FIELDS.includes('media'), '루틴 보드에는 시간 매핑이 없다');
  // 두 목록의 집합이 같아야 한다 — 한쪽에만 있으면 "파일엔 있는데 Undo 는 못 하는" 결함이 다시 생긴다.
  assert.deepEqual([...UNDO_FIELDS].sort(), [...DOC_FIELDS].sort());
  // 키 순서 = 스냅샷 JSON 바이트 순서. 앞 6개는 원본 리터럴 순서 그대로이고 신설은 꼬리에 붙는다.
  assert.deepEqual([...UNDO_FIELDS],
    ['rows', 'cols', 'placements', 'moveLibrary', 'categories', 'routines', 'links', 'media']);
  assert.deepEqual([...ROUTINE_UNDO_FIELDS], ['rows', 'cols', 'placements']);
});

/**
 * 얕은 복제로 두면 스냅샷과 현재 상태가 customLinks **배열을 공유**해, 스냅샷이 조용히
 * "지금 값"을 따라간다 = undo 가 아무것도 되돌리지 못한다. 이 테스트가 그 문을 지킨다.
 */
test('snapshot: pickUndoFields 는 links 를 값으로 복제한다(배열 공유 금지)', () => {
  const state = {
    rows: 8, cols: 8, placements: [], moveLibrary: [], categories: {}, routines: [],
    links: LINKS_SAMPLE()
  };
  const picked = pickUndoFields(state);
  const frozen = JSON.stringify(picked);

  // 스냅샷을 뜬 **뒤** 상태를 헤집는다 — 원본이 하는 제자리 변형까지 흉내낸다.
  state.links.customLinks.push({ id: 'c2', label: '나중', url: 'https://example.com/later' });
  state.links.customLinks[0].label = '바뀐 레이블';
  state.links.youtubeUrl = '';
  state.links.customLinks.length = 0;

  assert.equal(JSON.stringify(picked), frozen, '스냅샷이 현재 상태를 따라 변했다 — 얕은 복제다');
  assert.notEqual(picked.links, state.links);
  assert.notEqual(picked.links.customLinks, state.links.customLinks);
  assert.equal(picked.links.customLinks[0].label, '안무 메모');
});

test('snapshot: toLinkBundle 은 언제나 4필드를 채운 새 객체를 준다', () => {
  assert.deepEqual(toLinkBundle(), { youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: [] });
  assert.deepEqual(toLinkBundle(null), { youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: [] });
  assert.deepEqual(toLinkBundle({ customLinks: '배열아님' }).customLinks, []);
  const src = { youtubeUrl: 'u', customLinks: [{ id: 'a' }] };
  const bundle = toLinkBundle(src);
  assert.notEqual(bundle.customLinks, src.customLinks);
  assert.notEqual(bundle.customLinks[0], src.customLinks[0]);
});

/**
 * applySnapshot(main) 의 links 는 routines 와 달리 **언제나** 패치에 있어야 한다.
 * "키가 없으면 지금 값 유지" 로 두면 링크를 지운 상태를 되돌릴 수 없다 — 고친 결함이 그대로 남는다.
 */
test('snapshot: applySnapshot(main) 은 links 가 없는 옛 스냅샷도 빈 4필드로 되돌린다', () => {
  const legacy = JSON.stringify({ rows: 8, cols: 8, placements: [], moveLibrary: [], categories: {}, routines: [] });
  const patch = applySnapshot(legacy, { kind: 'main' });
  assert.deepEqual(patch.links, { youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: [] });
  assert.ok(!('routines' in patch) || Array.isArray(patch.routines));

  // 루틴 패치에는 links 가 없어야 한다(루틴 undo 가 링크를 건드리면 안 된다).
  const routineSnap = JSON.stringify({ rows: 4, cols: 8, placements: [] });
  assert.deepEqual(Object.keys(applySnapshot(routineSnap, { kind: 'routine' })), ['rows', 'cols', 'placements']);
});

// ── 핵심 시나리오 ────────────────────────────────────────────────────────────

test('history: 전체 초기화가 지운 배치와 링크가 Undo 로 함께 돌아오고 Redo 로 다시 비워진다', () => {
  const store = seededStore();
  const storage = fakeLinkStorage();
  const hist = History.createHistory(store, { storage });

  History.commit(hist, BOARD_MAIN);                       // 초기 스냅샷(배치 1 + 링크 4필드)
  assert.equal(History.canUndo(hist, BOARD_MAIN), false, '첫 스냅샷만으로는 되돌릴 것이 없다');

  clearBoard(store, { storage });                          // 배치 + 링크가 함께 비워지고 즉시 저장된다
  History.commit(hist, BOARD_MAIN);
  assert.equal(store.board(BOARD_MAIN).placements.length, 0);
  assert.deepEqual(store.get().links, { youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: [] });
  assert.deepEqual(storage.calls.at(-1), serializeLinks(EMPTY_LINKS()), '전체 초기화가 빈 링크를 즉시 썼다');

  const dirty = History.undo(hist, BOARD_MAIN);
  assert.equal(store.board(BOARD_MAIN).placements.length, 1, '배치가 안 돌아왔다');
  assert.deepEqual(store.get().links, LINKS_SAMPLE(), '링크가 안 돌아왔다 — 이 결함을 고친 것이다');
  assert.equal(dirty.links, true, 'Dirty.links 가 꺼져 있으면 상태만 바뀌고 입력창은 옛 값을 보여 준다');
  assert.deepEqual(storage.calls.at(-1), serializeLinks(LINKS_SAMPLE()),
    'undo 가 localStorage 에 되쓰지 않으면 새로고침에서 지워진 값이 되살아난다');

  const redoDirty = History.redo(hist, BOARD_MAIN);
  assert.equal(store.board(BOARD_MAIN).placements.length, 0);
  assert.deepEqual(store.get().links, EMPTY_LINKS());
  assert.equal(redoDirty.links, true);
  assert.deepEqual(storage.calls.at(-1), serializeLinks(EMPTY_LINKS()));
});

test('history: 메인 복원 Dirty 는 링크바를 포함해 restoreSnapshot 의 렌더 목록을 전부 켠다', () => {
  const store = seededStore();
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);
  store.patch('links', { clickupUrl: '' });
  History.commit(hist, BOARD_MAIN);

  const dirty = assertDirty(History.undo(hist, BOARD_MAIN), 'undo(main)');
  assert.equal(dirty.links, true);
  assert.equal(dirty.history, true);
  assert.equal(dirty.selection, true);
  assert.deepEqual(dirty.boards, { [BOARD_MAIN]: { rows: 'all', skeleton: true } });

  // 되돌릴 것이 없으면 원본처럼 아무 일도 하지 않는다(버튼 갱신조차 없다).
  const empty = History.createHistory(store);
  History.commit(empty, BOARD_MAIN);
  assert.equal(History.undo(empty, BOARD_MAIN), NONE);
  assert.equal(History.redo(empty, BOARD_MAIN), NONE);
});

test('history: 복원 시 주입된 saveLinks 가 실제로 불리고, 주입이 없으면 조용히 넘어간다', () => {
  const store = seededStore();
  const storage = fakeLinkStorage();
  const hist = History.createHistory(store, { storage });
  History.commit(hist, BOARD_MAIN);
  store.patch('links', EMPTY_LINKS());
  History.commit(hist, BOARD_MAIN);

  storage.calls.length = 0;
  History.undo(hist, BOARD_MAIN);
  assert.equal(storage.calls.length, 1, 'undo 가 saveLinks 를 정확히 한 번 불러야 한다');
  const payload = storage.calls[0];
  // serializeLinks 가 만드는 그 모양·그 키 순서여야 한다(linkCommands·projectCommands 와 같은 값).
  assert.deepEqual(Object.keys(payload), ['youtubeUrl', 'youtubeTitle', 'clickupUrl', 'customLinks']);
  assert.deepEqual(payload, serializeLinks(LINKS_SAMPLE()));

  // 제목 조회 상태도 함께 맞춘다 — 조회 중에 Undo 하면 스피너가 영영 남는다.
  assert.deepEqual(store.get().session.youtubeTitleFetch, { status: 'idle', title: LINKS_SAMPLE().youtubeTitle });

  // 주입이 없어도(골든 어댑터) 던지지 않는다.
  const bare = History.createHistory(seededStore());
  assert.equal(bare.storage, null);
  History.commit(bare, BOARD_MAIN);
  bare.store.patch('links', EMPTY_LINKS());
  History.commit(bare, BOARD_MAIN);
  assert.doesNotThrow(() => History.undo(bare, BOARD_MAIN));
  assert.deepEqual(bare.store.get().links, LINKS_SAMPLE());

  // storage 는 있는데 saveLinks 가 없는 어댑터도 마찬가지다.
  const partial = History.createHistory(seededStore(), { storage: {} });
  History.commit(partial, BOARD_MAIN);
  partial.store.patch('links', EMPTY_LINKS());
  History.commit(partial, BOARD_MAIN);
  assert.doesNotThrow(() => History.undo(partial, BOARD_MAIN));
});

test('history: 링크만 바꾸고 커밋하면 Undo 한 번이 링크만 되돌리고 배치는 그대로다', () => {
  const store = seededStore();
  const hist = History.createHistory(store, { storage: fakeLinkStorage() });
  History.commit(hist, BOARD_MAIN);

  const placementsBefore = JSON.stringify(store.board(BOARD_MAIN).placements);
  store.patch('links', { clickupUrl: 'https://app.clickup.com/t/999' });   // ClickUp 입력창 change
  History.commit(hist, BOARD_MAIN);
  assert.equal(History.canUndo(hist, BOARD_MAIN), true);

  History.undo(hist, BOARD_MAIN);
  assert.equal(store.get().links.clickupUrl, LINKS_SAMPLE().clickupUrl);
  assert.equal(JSON.stringify(store.board(BOARD_MAIN).placements), placementsBefore, '배치까지 되돌아갔다');
  assert.equal(History.canUndo(hist, BOARD_MAIN), false, '링크 편집이 undo 단계를 하나만 만들어야 한다');
});

test('history: 값이 바뀌지 않은 커밋은 스택을 늘리지 않는다(중복 판정)', () => {
  const store = seededStore();
  const hist = History.createHistory(store, { storage: fakeLinkStorage() });
  const stack = hist.stack(BOARD_MAIN);

  History.commit(hist, BOARD_MAIN);
  const depth = stack.past.length;

  // 같은 값으로 change 가 여러 번 들어와도(blur → Enter → blur) 스택은 그대로다.
  for (let i = 0; i < 5; i++) History.commit(hist, BOARD_MAIN);
  assert.equal(stack.past.length, depth, '값이 같은 커밋이 스택을 늘렸다 — change 마다 undo 단계가 쌓인다');
  assert.equal(History.canUndo(hist, BOARD_MAIN), false);

  // 중복이어도 Dirty 는 { history:true } 다(원본이 중복 분기에서도 버튼을 갱신한다).
  assert.deepEqual(History.commit(hist, BOARD_MAIN), { history: true });

  // 실제로 값이 바뀌면 한 칸 늘고, 커스텀 링크 배열 안쪽 변경도 감지된다.
  store.patch('links', { customLinks: [{ id: 'c1', label: '고친 레이블', url: 'https://example.com/memo' }] });
  History.commit(hist, BOARD_MAIN);
  assert.equal(stack.past.length, depth + 1);
  History.undo(hist, BOARD_MAIN);
  assert.deepEqual(store.get().links, LINKS_SAMPLE());
});

test('history: 루틴 편집기 undo 는 링크를 건드리지 않는다', () => {
  const store = seededStore();
  const storage = fakeLinkStorage();
  const hist = History.createHistory(store, { storage });

  store.setBoard(BOARD_ROUTINE, { placements: [{ id: 'r1', groupId: 'rg1', name: 'Boogie', category: 'step', row: 0, startIndex: 0, length: 2 }] });
  History.commit(hist, BOARD_ROUTINE);
  store.setBoard(BOARD_ROUTINE, { placements: [] });
  History.commit(hist, BOARD_ROUTINE);

  store.patch('links', { youtubeUrl: 'https://www.youtube.com/watch?v=zzz' });  // 편집기를 여는 동안 바뀐 링크
  storage.calls.length = 0;

  const dirty = assertDirty(History.undo(hist, BOARD_ROUTINE), 'undo(routine)');
  assert.equal(store.board(BOARD_ROUTINE).placements.length, 1, '루틴 배치는 되돌아와야 한다');
  assert.equal(store.get().links.youtubeUrl, 'https://www.youtube.com/watch?v=zzz', '루틴 undo 가 링크를 되돌렸다');
  assert.deepEqual(store.get().links.customLinks, LINKS_SAMPLE().customLinks);
  assert.equal(storage.calls.length, 0, '루틴 undo 는 localStorage 를 건드리면 안 된다');
  assert.equal(dirty.links, undefined);
  assert.deepEqual(dirty, { boards: { [BOARD_ROUTINE]: { rows: 'all', skeleton: true } }, routineEditor: true, history: true });

  // 메인 스택은 루틴 조작에 흔들리지 않는다.
  assert.equal(History.canUndo(hist, BOARD_MAIN), false);
});

/**
 * 복원된 links 의 **키 순서와 값**이 원래 상태와 같아야 한다. 스냅샷 중복 판정이 JSON 문자열
 * 비교라서, 복원이 링크의 키 순서를 흔들면 "undo 직후의 커밋"이 중복으로 걸러지지 않고
 * 유령 undo 단계가 쌓인다(Undo 를 눌렀는데 같은 화면이 두 번 나오고, redo 스택까지 날아간다).
 *
 * ⚠ categories 는 이 테스트에서 **미리 정렬해 둔다**. restoreMain 이 categories.normalize 를
 *   태우고 그 함수가 키를 정렬하기 때문에(categories.js:201-203, 원본 restoreSnapshot 2849 그대로),
 *   정렬되지 않은 카테고리로 시작하면 복원 후 스냅샷 문자열이 달라진다 — 링크와 무관한
 *   **이 변경 이전부터 있던 성질**이고, 바로 아래 테스트가 그것만 따로 못박는다.
 */
test('history: undo 로 복원한 links 는 원래 스냅샷과 글자 단위로 같다(키 순서 안정성)', () => {
  const store = seededStore();
  store.update({ categories: normalizeCategories(DEFAULT_CATEGORIES) });   // 정렬 차이를 미리 제거
  const hist = History.createHistory(store, { storage: fakeLinkStorage() });
  const stack = hist.stack(BOARD_MAIN);

  History.commit(hist, BOARD_MAIN);
  const first = stack.past[0];
  clearBoard(store, { storage: fakeLinkStorage() });
  History.commit(hist, BOARD_MAIN);

  History.undo(hist, BOARD_MAIN);
  assert.deepEqual(Object.keys(store.get().links), ['youtubeUrl', 'youtubeTitle', 'clickupUrl', 'customLinks'],
    '복원된 links 의 키 순서가 초기 상태·serializeLinks 와 달라졌다');

  const depth = stack.past.length;
  History.commit(hist, BOARD_MAIN);
  assert.equal(stack.past.length, depth, '복원 직후의 커밋이 중복으로 걸러지지 않았다 — 유령 undo 단계가 쌓인다');
  assert.equal(stack.past.at(-1), first, '복원된 상태의 스냅샷이 원래 스냅샷과 글자 단위로 같아야 한다');
});

/**
 * ⚠ **보존 대상 결함의 특성화 테스트**(이 PR 이 만든 것이 아니다 — HEAD 에도 있다).
 * restoreMain 은 categories 를 normalize 로 태우고 그 함수는 키를 정렬한다(원본 2849 그대로).
 * DEFAULT_CATEGORIES 는 정렬돼 있지 않으므로, undo 직후에 커밋하면 카테고리 키 순서만 다른
 * 스냅샷이 하나 더 쌓이고 **redo 스택이 날아간다**.
 * 고치려면 원본 동작을 바꿔야 하므로 여기서는 손대지 않고, 사실을 못박아 둔다 —
 * 이 단언이 깨졌다면 누군가 정렬 성질을 건드린 것이니 docs/deviations.md 를 함께 고쳐라.
 */
test('history: (보존) 카테고리 정렬 때문에 undo 직후 커밋이 유령 단계를 만든다', () => {
  const store = seededStore();                             // categories = DEFAULT_CATEGORIES(정렬 안 됨)
  assert.notDeepEqual(
    Object.keys(store.get().categories),
    [...Object.keys(store.get().categories)].sort((a, b) => a.localeCompare(b)),
    '기본 카테고리가 이미 정렬돼 있다면 이 테스트의 전제가 사라졌다'
  );
  const hist = History.createHistory(store, { storage: fakeLinkStorage() });
  History.commit(hist, BOARD_MAIN);
  clearBoard(store, { storage: fakeLinkStorage() });
  History.commit(hist, BOARD_MAIN);
  History.undo(hist, BOARD_MAIN);

  assert.equal(History.canRedo(hist, BOARD_MAIN), true);
  const depth = hist.stack(BOARD_MAIN).past.length;
  History.commit(hist, BOARD_MAIN);
  assert.equal(hist.stack(BOARD_MAIN).past.length, depth + 1, '유령 단계가 사라졌다면 정렬 성질이 바뀐 것이다');
  assert.equal(History.canRedo(hist, BOARD_MAIN), false, '그 커밋이 redo 스택을 날린다');
  // 링크는 그 와중에도 정확히 되돌아와 있다 — 이 PR 이 책임지는 부분은 멀쩡하다.
  assert.deepEqual(store.get().links, LINKS_SAMPLE());
});

/**
 * `전체 초기화` 버튼의 라벨은 index.html 과 controls.js 에 **손으로 맞춘 쌍**이다.
 * confirmOnce 가 확인 뒤 CLEAR_BTN_LABEL 로 버튼을 되돌리므로, 한쪽만 바꾸면 확인 2차 클릭
 * 뒤에 버튼 이름이 조용히 달라진다. 다른 검사 스크립트는 이 쌍을 보지 않는다.
 */
test('controls: #clearBtn 의 마크업 글자와 CLEAR_BTN_LABEL 이 같다', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = /<button id="clearBtn"[^>]*>([^<]*)<\/button>/.exec(html);
  assert.ok(m, 'index.html 에서 #clearBtn 을 찾지 못했다');
  assert.equal(m[1], CLEAR_BTN_LABEL);
  // 링크까지 지운다는 사실이 라벨에 드러나야 한다(확인 문구 '정말요?' 만으로는 알 수 없다).
  assert.ok(CLEAR_BTN_LABEL.includes('링크'), '전체 초기화가 링크바까지 비운다는 안내가 사라졌다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 배치 충돌 규칙 — place · moveGroup · copyGroup · resizeGroup 이 하나의 규칙을 쓴다
//
// 2026-09-07 에 RESIZE_POLICY 의 keepLane·overwriteSameLane 을 false 로 뒤집었다. 그 전까지
// 리사이즈만 원래 레인을 고수하고, 그 레인에서 겹친 그룹을 clearSegmentsArea 로 **통째로 지웠다**.
// 배치·이동·복사는 처음부터 findFreeLane 으로 빈 레인을 찾아 쌓았으므로, 같은 겹침이 조작 종류에
// 따라 다른 결과를 냈다 — 개발 원칙 D-2 위반이자 docs/deviations.md 의 "특히 걸리는 하나".
//
// 골든(resize-05/12/13)은 그 세 시나리오의 **결과**를 못박는다. 여기서 못박는 것은 그 결과를 낳는
// **성질**이다: 네 조작의 레인 결정이 같은가, 겹친 그룹의 세그먼트가 하나도 사라지지 않는가,
// 그리고 정책이 정말 데이터인가(플래그를 되돌리면 옛 동작이 그대로 재현되는가).
// ─────────────────────────────────────────────────────────────────────────────

/** 결정적 uid. 조작 하나마다 새로 만든다(호출 횟수가 조작마다 달라 공유하면 id 가 어긋난다). */
const conflictIds = () => counterEnv({ prefix: 'n' });

/** 8칸 × 4행. 메인은 intro 행(row 0)이 있고 루틴 보드는 없다 — 충돌 규칙은 그 차이와 무관해야 한다. */
const CONFLICT_MAIN = Object.freeze({ rows: 4, cols: 8, hasIntroRow: true });
const CONFLICT_ROUTINE = Object.freeze({ rows: 4, cols: 8, hasIntroRow: false });

/** 배치 리터럴 한 줄. groupId 를 name 으로도 쓴다(어느 그룹이 살아남았는지 이름만 봐도 알게). */
function seg(groupId, row, startIndex, length, subRow) {
  return { id: `${groupId}@${row}.${startIndex}`, groupId, name: groupId, category: 'step', row, startIndex, length, subRow };
}

/** 사람이 읽는 보드 형태. 정렬해 비교하므로 배열 순서에는 의존하지 않는다. */
function shapeOf(placements) {
  return placements
    .map(p => `${p.groupId} r${p.row} s${p.startIndex} len${p.length} lane${p.subRow}`)
    .sort();
}

/** 그룹의 레인. 세그먼트마다 레인이 다르면 그 자체가 결함이므로 여기서 먼저 걸러 낸다. */
function laneOfGroup(placements, groupId) {
  const segs = placements.filter(p => p.groupId === groupId);
  assert.ok(segs.length, `그룹 ${groupId} 가 보드에서 사라졌다`);
  const lanes = [...new Set(segs.map(p => p.subRow || 0))];
  assert.deepEqual(lanes, [lanes[0]], `그룹 ${groupId} 의 세그먼트가 서로 다른 레인에 흩어졌다(repack Phase2 가 통일해야 한다)`);
  return lanes[0];
}

/**
 * 네 정책 전부가 "겹친 그룹을 보존한다"고 선언한다.
 * keepLane/overwriteSameLane 가지는 resizeGroup 에만 있고 나머지 셋은 그 개념 자체가 없다 —
 * 그래서 셋은 키가 없는 것으로(!== true), 리사이즈는 **명시적 false** 로 검사한다.
 * 리사이즈에서 키가 사라지면 "누가 실수로 지웠나 / 일부러 되돌렸나"를 구분할 수 없으므로 존재도 함께 단언한다.
 */
test('boardOps: 네 조작의 정책이 모두 겹친 그룹을 보존한다(D-2)', () => {
  const policies = [['PLACE', PLACE_POLICY], ['MOVE', MOVE_POLICY], ['COPY', COPY_POLICY], ['RESIZE', RESIZE_POLICY]];
  for (const [name, policy] of policies) {
    assert.notEqual(policy.overwriteSameLane, true, `${name}_POLICY 가 겹친 그룹을 지운다 — 네 조작이 다시 갈라졌다`);
    assert.notEqual(policy.keepLane, true, `${name}_POLICY 가 레인을 고수한다 — 겹쳐도 아래로 내려가지 않는다`);
  }
  assert.equal(Object.hasOwn(RESIZE_POLICY, 'overwriteSameLane'), true,
    'RESIZE_POLICY 에서 overwriteSameLane 키가 사라졌다 — 옛 동작을 되살릴 가지가 없어졌다면 lanes.clearSegmentsArea 의 주석부터 고쳐라');
  assert.equal(Object.hasOwn(RESIZE_POLICY, 'keepLane'), true, 'RESIZE_POLICY 에서 keepLane 키가 사라졌다');
});

/**
 * 같은 보드·같은 겹침을 네 조작으로 만들면 **같은 레인**이 나온다.
 * 블로커 B 가 row1 [2..5] lane0 에 있고, 네 조작 모두 row1 [0..3] 을 차지하려 한다 — 2·3 에서 겹친다.
 * 답은 넷 다 lane1 이어야 하고, B 는 넷 다 lane0 에 그대로 있어야 한다.
 */
test('boardOps: 같은 겹침에서 네 조작이 같은 레인을 고르고 상대를 살려 둔다', () => {
  const blocker = () => seg('B', 1, 2, 4, 0);
  const donor = () => seg('S', 3, 0, 4, 0);   // 이동·복사의 원본. 겹침과 무관한 자리에 둔다.

  const results = {
    place: place(
      { ...CONFLICT_MAIN, placements: [blocker()] },
      { move: { name: 'S', category: 'step' }, startRow: 1, startIndex: 0, totalCount: 4 },
      conflictIds()
    ),
    move: moveGroup(
      { ...CONFLICT_MAIN, placements: [blocker(), donor()] },
      { groupId: 'S', targetRow: 1, targetStartIndex: 0 },
      conflictIds()
    ),
    copy: copyGroup(
      { ...CONFLICT_MAIN, placements: [blocker(), donor()] },
      { groupId: 'S', targetRow: 1, targetStartIndex: 0 },
      conflictIds()
    ),
    // 리사이즈는 목적지를 인자로 받지 않는다 — 같은 자리에서 2 → 4 로 늘리면 같은 [0..3] 을 덮는다.
    resize: resizeGroup(
      { ...CONFLICT_MAIN, placements: [blocker(), seg('S', 1, 0, 2, 0)] },
      { groupId: 'S', newCount: 4 },
      conflictIds()
    )
  };

  for (const [op, result] of Object.entries(results)) {
    const placed = result.placements.filter(p => p.row === 1 && p.startIndex === 0);
    assert.equal(placed.length, 1, `${op}: row1 [0..3] 에 놓인 세그먼트가 정확히 하나여야 한다`);
    assert.equal(placed[0].length, 4, `${op}: 길이가 4카운트가 아니다`);
    assert.equal(placed[0].subRow, 1, `${op}: 겹친 B 위에 쌓이지 않았다(lane1 이어야 한다)`);
    assert.equal(laneOfGroup(result.placements, 'B'), 0, `${op}: 블로커 B 가 밀려났거나 사라졌다`);
    assert.equal(result.placements.filter(p => p.groupId === 'B').length, 1, `${op}: 블로커 B 의 세그먼트가 지워졌다`);
  }
});

/**
 * ⚠ 이번 변경의 **핵심 증상**. clearSegmentsArea 는 겹친 세그먼트가 아니라 그 groupId 전체를 지웠다.
 * 그래서 여러 행에 걸친 그룹은 **한 칸만 겹쳐도 다른 행의 조각까지** 통째로 사라졌다.
 * T 는 row2 [7..7] + row3 [0..2] 두 조각짜리 그룹이고, S 를 3카운트로 늘리면 row2 의 7 한 칸만 겹친다.
 * row3 조각은 겹치는 것이 아무것도 없으므로 손대면 안 된다.
 */
test('boardOps: 리사이즈로 한 칸만 겹쳐도 상대 그룹의 다른 행 조각이 살아남는다', () => {
  const board = {
    ...CONFLICT_MAIN,
    placements: [seg('T', 2, 7, 1, 0), seg('T', 3, 0, 3, 0), seg('S', 2, 5, 1, 0)]
  };
  const result = resizeGroup(board, { groupId: 'S', newCount: 3 }, conflictIds());

  assert.deepEqual(shapeOf(result.placements), [
    'S r2 s5 len3 lane1',   // 늘린 쪽이 아래층으로 내려간다
    'T r2 s7 len1 lane0',   // 겹친 조각도 그대로
    'T r3 s0 len3 lane0'    // ⚠ 겹치지도 않은 조각 — 옛 동작에서 여기가 사라졌다
  ]);
  assert.equal(result.placements.length, 3, '세그먼트 개수가 3이 아니다 — 무언가 지워졌거나 늘어났다');
  // 아무것도 지우지 않았으니 row3 은 다시 그릴 이유가 없다. 옛 동작은 T 를 지우느라 [2,3] 을 그렸다.
  assert.deepEqual(result.renderRows, [2], 'renderRows 에 손대지 않은 행이 섞였다');
});

/**
 * 리사이즈한 쪽만 내려간다. 겹치지 않으면 레인이 그대로다.
 * ⚠ "그대로"는 **충돌 규칙**의 이야기다. RESIZE_POLICY.repack:true 가 뒤따르므로,
 *   혼자 lane2 에 떠 있던 그룹은 겹침과 무관하게 lane0 으로 당겨진다(레인 번호 정규화). 그것도 함께 못박는다.
 */
test('boardOps: 리사이즈는 겹칠 때만 아래층으로 내려간다', () => {
  // (1) 같은 행·같은 레인이지만 겹치지 않는다 → lane0 유지
  const apart = resizeGroup(
    { ...CONFLICT_MAIN, placements: [seg('X', 1, 6, 2, 0), seg('S', 1, 0, 2, 0)] },
    { groupId: 'S', newCount: 4 },   // [0..3] 은 X[6..7] 과 겹치지 않는다
    conflictIds()
  );
  assert.deepEqual(shapeOf(apart.placements), ['S r1 s0 len4 lane0', 'X r1 s6 len2 lane0']);

  // (2) 한 칸이라도 닿으면 내려간다
  const touching = resizeGroup(
    { ...CONFLICT_MAIN, placements: [seg('X', 1, 6, 2, 0), seg('S', 1, 0, 2, 0)] },
    { groupId: 'S', newCount: 7 },   // [0..6] — X 의 6 한 칸과 닿는다
    conflictIds()
  );
  assert.deepEqual(shapeOf(touching.placements), ['S r1 s0 len7 lane1', 'X r1 s6 len2 lane0']);

  // (3) 겹치는 것이 없어도 repack 이 레인 번호를 0부터 다시 매긴다 — 충돌 규칙이 아니라 repack 의 일이다
  const alone = resizeGroup(
    { ...CONFLICT_MAIN, placements: [seg('S', 1, 0, 2, 2)] },
    { groupId: 'S', newCount: 4 },
    conflictIds()
  );
  assert.deepEqual(shapeOf(alone.placements), ['S r1 s0 len4 lane0'], 'repack 이 빈 레인 0·1 을 남겨 뒀다');
});

/**
 * 축소는 아무도 지우지 않는다 — 옛 정책으로 돌려도 결과가 **글자 단위로 같다**.
 * (축소는 덮는 칸이 줄기만 하므로 새 충돌을 만들 수 없다. 지우던 것은 언제나 확대 쪽 이야기였다.)
 * T 는 row1 [6..7] + row2 [0..5] 두 조각이고 X 가 row2 [0..3] lane1 에 있다.
 * T 를 2카운트로 줄이면 row2 조각이 사라지고, 비게 된 lane0 으로 X 가 당겨 올라간다.
 */
test('boardOps: 축소는 아무도 지우지 않는다(옛 정책과 결과가 같다)', () => {
  const board = () => ({
    ...CONFLICT_MAIN,
    placements: [seg('T', 1, 6, 2, 0), seg('T', 2, 0, 6, 0), seg('X', 2, 0, 4, 1)]
  });
  const expected = [
    'T r1 s6 len2 lane0',
    'X r2 s0 len4 lane0'   // repack 이 빈 lane0 으로 끌어올린다
  ];
  const now = resizeGroup(board(), { groupId: 'T', newCount: 2 }, conflictIds());
  assert.deepEqual(shapeOf(now.placements), expected);
  assert.equal(now.placements.filter(p => p.groupId === 'X').length, 1, '축소가 남의 그룹을 지웠다');

  const legacy = resizeGroup(board(), { groupId: 'T', newCount: 2 }, conflictIds(), { overwriteSameLane: true, keepLane: true });
  assert.deepEqual(shapeOf(legacy.placements), expected, '축소 경로가 정책에 따라 갈라졌다 — 축소는 원래 두 정책이 같아야 한다');
});

/**
 * 정책은 **데이터**다. 두 플래그를 옛 값으로 덮어쓰면 삭제 동작이 그대로 재현된다.
 * 위 "한 칸만 겹쳐도 살아남는다" 와 같은 보드를 쓴다 — 같은 입력에서 정책만으로 결과가 갈린다는 것이 요점이다.
 * 이 테스트가 깨졌다면 resizeGroup 본문에서 가지 하나가 사라진 것이고,
 * 그러면 boardOps.RESIZE_POLICY · lanes.clearSegmentsArea 의 주석과 골든 meta.intentionalChanges 가 거짓이 된다.
 */
test('boardOps: RESIZE_POLICY 를 옛 값으로 덮어쓰면 삭제 동작이 재현된다', () => {
  const board = {
    ...CONFLICT_MAIN,
    placements: [seg('T', 2, 7, 1, 0), seg('T', 3, 0, 3, 0), seg('S', 2, 5, 1, 0)]
  };
  const legacy = resizeGroup(board, { groupId: 'S', newCount: 3 }, conflictIds(), { overwriteSameLane: true, keepLane: true });

  assert.deepEqual(shapeOf(legacy.placements), ['S r2 s5 len3 lane0'],
    '옛 동작이 재현되지 않았다 — 그룹 통째 삭제 + 원래 레인 고수여야 한다');
  assert.equal(legacy.placements.filter(p => p.groupId === 'T').length, 0, 'T 가 남아 있다면 옛 삭제 경로가 죽은 것이다');
  // 겹치지도 않은 row3 까지 다시 그리게 되는 것이 옛 동작의 흔적이다(그 행의 조각이 사라졌으므로).
  assert.deepEqual(legacy.renderRows, [2, 3]);

  // 기본값과 정말로 다른가 — 같다면 위 단언들이 우연히 맞은 것이다.
  const now = resizeGroup(board, { groupId: 'S', newCount: 3 }, conflictIds());
  assert.notDeepEqual(shapeOf(now.placements), shapeOf(legacy.placements), '기본 정책과 옛 정책의 결과가 같아졌다');
});

/**
 * 루틴 보드(hasIntroRow:false)도 같은 규칙이다. 골든 resize-12 와 같은 배치를 도메인에서 직접 돌린다.
 * 스텝을 10카운트로 늘리면 row2 [2..7] + row3 [0..3] 두 조각이 되고 row3 조각이 턴과 정면으로 겹친다.
 * ⚠ 겹치지 않는 row2 조각까지 lane1 로 내려간다 — findFreeLane 이 그룹의 세그먼트를 **함께** 보기 때문이고,
 *   이동·복사가 이미 쓰는 규칙과 같다. 그룹의 레인은 조각마다 달라질 수 없다.
 */
test('boardOps: 루틴 보드에서도 겹치면 그룹 전체가 한 레인 아래로 내려간다', () => {
  const board = {
    ...CONFLICT_ROUTINE,
    placements: [seg('STEP', 2, 2, 2, 0), seg('TURN', 3, 0, 4, 0)]
  };
  const result = resizeGroup(board, { groupId: 'STEP', newCount: 10 }, conflictIds());

  assert.deepEqual(shapeOf(result.placements), [
    'STEP r2 s2 len6 lane1',
    'STEP r3 s0 len4 lane1',
    'TURN r3 s0 len4 lane0'
  ]);
  assert.equal(laneOfGroup(result.placements, 'STEP'), 1, '두 행에 걸친 그룹의 레인이 조각마다 달라졌다');
  assert.equal(laneOfGroup(result.placements, 'TURN'), 0, '겹친 턴이 지워졌거나 밀려났다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 영상 패널 (2026-09) — adapters/media · usecases/videoCommands · media 저장 블록
//
// 골든이 한 줄도 못 덮는다(원본 index.html 에 대응물이 없다). 여기서 지키는 것은 넷이다.
//   ① YouTube 어댑터가 MediaPlayer 계약을 실제로 만족하는가 — DOM 없이도 검사된다
//   ② pickPlayer 가 URL 하나로 어댑터를 고르는가(못 알아보면 널 재생기, 오류가 아니다)
//   ③ 두 점 앵커·탭 템포가 store 를 어떻게 바꾸는가, 그리고 **재생 위치가 들어가지 않는가**
//   ④ media 가 없는 옛 파일이 지금과 똑같이 열리고, 빈 media 가 저장 바이트를 늘리지 않는가
// ─────────────────────────────────────────────────────────────────────────────

/**
 * YT IFrame API 의 최소 스텁. **onReady 를 생성자 안에서 동기로** 부른다 —
 * 실제 YT 는 비동기로 부르지만, 어댑터가 두 순서를 모두 견디는지 확인하는 편이 더 강한 검사다
 * (어댑터는 `ev.target` 으로 플레이어를 붙잡는다).
 */
function fakeYT() {
  const made = [];
  function Player(container, cfg) {
    const self = this;
    made.push(self);
    self.container = container;
    self.cfg = cfg;
    self.sec = Number(cfg.playerVars && cfg.playerVars.start) || 0;
    self.rate = 1;
    self.destroyed = false;
    self.muted = false;
    self.cued = null;
    self.getCurrentTime = () => self.sec;
    self.getDuration = () => 120;
    self.getPlaybackRate = () => self.rate;
    self.setPlaybackRate = (r) => { self.rate = r; };
    self.playVideo = () => cfg.events.onStateChange({ data: 1, target: self });
    self.pauseVideo = () => cfg.events.onStateChange({ data: 2, target: self });
    // ⚠ 일부러 요청보다 0.4초 앞에 착지한다 — YT 의 키프레임 스냅을 흉내낸 것이고,
    //   그 오차가 capabilities.seekToleranceSec(0.5) 안이라는 것이 계약이다.
    self.seekTo = (sec) => { self.sec = Math.max(0, sec - 0.4); };
    self.cueVideoById = (arg) => { self.cued = arg; self.sec = arg.startSeconds || 0; };
    self.mute = () => { self.muted = true; };
    self.unMute = () => { self.muted = false; };
    self.destroy = () => { self.destroyed = true; };
    cfg.events.onReady({ target: self });
  }
  return { YT: { Player }, made };
}

/** container 스텁. destroy 가 "컨테이너를 비운 채 남긴다"를 검사하려면 innerHTML 이 필요하다. */
const fakeContainer = () => ({ innerHTML: '<p>자리표시</p>' });

/** 어댑터가 API 스크립트를 실제로 받아왔다고 치는 주입점. 네트워크를 한 번도 타지 않는다. */
function stubbedPlayer(extra = {}) {
  const yt = fakeYT();
  const container = fakeContainer();
  const player = createYouTubePlayer({
    container,
    win: { location: { origin: 'http://localhost:8000' } },
    doc: {},
    loadApi: () => Promise.resolve({ ok: true, YT: yt.YT }),
    playConfirmMs: 20,
    sampleIntervalMs: 10,
    ...extra
  });
  return { player, yt, container };
}

test('youtubePlayer: 생성만으로 MediaPlayer 계약을 만족한다(DOM 도 네트워크도 없이)', () => {
  // 인자 하나 없이 node 에서 만들어도 던지지 않아야 한다 — 계약 검사가 곧 이 어댑터의 자기검증이다.
  const bare = createYouTubePlayer();
  assert.equal(assertMediaPlayer(bare, 'youtubePlayer'), bare);
  assert.ok(isMediaPlayer(bare));
  assert.equal(bare.kind, 'youtube');
  for (const key of MEDIA_PLAYER_MEMBERS) assert.ok(bare[key] != null, `${key} 가 없다`);

  // capabilities 는 불변이고 seekToleranceSec 은 옵셔널이 아니다(YT 는 키프레임에 스냅한다).
  assert.equal(Object.isFrozen(bare.capabilities), true);
  assert.equal(bare.capabilities.seekToleranceSec, 0.5);
  assert.equal(bare.capabilities.needsUserGesture, true);
  assert.equal(bare.capabilities.canSeek, true);
  assert.ok(Array.isArray(YT_CAPABILITIES.rates) && YT_CAPABILITIES.rates.includes(1));

  // 소스가 없을 때의 상태는 오류가 아니라 정상이다.
  assert.deepEqual(bare.getState(), { load: 'idle', play: 'unstarted', error: null });
  assert.equal(bare.getDuration(), null, '0 을 돌려주면 "0초짜리"라는 거짓말이 된다');
  assert.equal(bare.getTimeSample(), null);
  bare.destroy();
  bare.destroy();   // 멱등
});

test('youtubePlayer: API 로드 실패는 던지지 않고 {load:"error"} 로 드러난다', async () => {
  const player = createYouTubePlayer({
    container: fakeContainer(),
    win: {}, doc: {},
    loadApi: () => Promise.resolve({ ok: false, code: 'network', message: 'blocked' })
  });
  await player.load({ kind: 'youtube', videoId: 'abc' });   // reject 하지 않는다
  const state = player.getState();
  assert.equal(state.load, 'error');
  assert.equal(state.error.code, 'network', '뷰는 이 코드를 보고 한국어 문구를 고른다');

  // 오류 상태에서도 play 는 던지지 않고 결과 문자열을 준다.
  assert.equal(await player.play(), 'error');
  player.destroy();
});

test('youtubePlayer: 준비되면 재생·탐색이 되고 seek 은 실제 착지 시각을 돌려준다', async () => {
  // ⚠ 아래 테스트들이 destroy 를 반드시 부르는 이유: 재생 중이면 폴링 인터벌이 돌고 있어서
  //   그걸 안 걷으면 node 의 테스트 러너가 종료되지 않는다.
  const { player, yt, container } = stubbedPlayer();
  await player.load({ kind: 'youtube', videoId: 'abc', startSec: 5 });

  assert.equal(player.getState().load, 'ready');
  assert.equal(player.getDuration(), 120);
  assert.equal(yt.made.length, 1);
  assert.equal(yt.made[0].cfg.playerVars.enablejsapi, 1);
  assert.equal(yt.made[0].cfg.playerVars.origin, 'http://localhost:8000');

  assert.equal(await player.play(), 'started');
  assert.equal(player.getState().play, 'playing');

  // ★ 요청 30 → 착지 29.6. "요청 ≠ 결과"를 타입으로 인정하는 자리이며, 오차가 허용치 안이다.
  const landed = await player.seek(30);
  assert.equal(landed, 29.6);
  assert.ok(Math.abs(landed - 30) <= player.capabilities.seekToleranceSec);

  // seek 직후 표본이 갱신되어 있어야 한다(계약 3보장 중 하나).
  assert.equal(player.getTimeSample().sec, 29.6);
  assert.equal(player.getTimeSample().playing, true);

  player.pause();
  assert.equal(player.getState().play, 'paused');

  player.setRate(1.5);
  assert.equal(yt.made[0].rate, 1.5);
  player.setMuted(true);
  assert.equal(yt.made[0].muted, true);

  player.destroy();
  assert.equal(yt.made[0].destroyed, true, 'destroy 가 iframe 을 안 걷었다');
  assert.equal(container.innerHTML, '', 'destroy 는 컨테이너를 비운 채로 남긴다');
  player.destroy();   // 멱등
});

test('youtubePlayer: onTime 은 구독 즉시 1회 보내고 해제하면 끊긴다', async () => {
  const { player } = stubbedPlayer();
  await player.load({ kind: 'youtube', videoId: 'abc' });

  const seen = [];
  const off = player.onTime(s => seen.push(s));
  assert.equal(seen.length, 1, '구독 즉시 1회 보장이 깨졌다');
  assert.ok(Number.isFinite(seen[0].atMs) && Number.isFinite(seen[0].sec));

  await player.seek(10);
  assert.equal(seen.length, 2, 'seek 직후 1회 보장이 깨졌다');

  off();
  await player.seek(20);
  assert.equal(seen.length, 2, '해제한 구독자에게 계속 보냈다');
  player.destroy();
});

test('youtubePlayer: 같은 kind 의 소스 교체는 iframe 을 다시 만들지 않는다', async () => {
  const { player, yt } = stubbedPlayer();
  await player.load({ kind: 'youtube', videoId: 'abc' });
  await player.load({ kind: 'youtube', videoId: 'def', startSec: 12 });

  assert.equal(yt.made.length, 1, 'iframe 을 다시 만들면 재생이 눈에 띄게 끊긴다');
  assert.deepEqual(yt.made[0].cued, { videoId: 'def', startSeconds: 12 });
  assert.equal(player.getState().load, 'ready');

  // 소스를 비우는 것은 오류가 아니라 정상 경로다.
  await player.load(null);
  assert.deepEqual(player.getState(), { load: 'idle', play: 'unstarted', error: null });
  player.destroy();
});

test('youtubePlayer: 준비 전 play/seek 은 던지지 않고 마지막 의도 1개만 큐잉된다', async () => {
  // ⚠ API 로드를 **손으로 열어야** 하는 게이트로 막는다. 즉시 resolve 하는 스텁을 쓰면 첫 await 에서
  //   로딩이 끝나 버려 "준비 전"이라는 상황 자체가 만들어지지 않는다(그러면 이 테스트는 아무것도 안 지킨다).
  const yt = fakeYT();
  let openGate;
  const gate = new Promise((resolve) => { openGate = resolve; });
  const player = createYouTubePlayer({
    container: fakeContainer(),
    win: { location: { origin: 'http://localhost:8000' } },
    doc: {},
    loadApi: () => gate.then(() => ({ ok: true, YT: yt.YT })),
    playConfirmMs: 20,
    sampleIntervalMs: 10
  });
  try {
    assert.equal(await player.play(), 'no-source', '소스가 없는 것과 준비가 안 된 것은 다른 말이다');

    // 로딩이 끝나기 전에 seek → play 순서로 눌렀다면, 이뤄지는 것은 **마지막 하나**다.
    const loading = player.load({ kind: 'youtube', videoId: 'abc' });
    assert.equal(player.getState().load, 'loading');
    assert.equal(await player.seek(50), 50, '준비 전 seek 은 요청값을 그대로 돌려준다(던지지 않는다)');
    assert.equal(await player.play(), 'not-ready');

    openGate();
    await loading;
    assert.equal(player.getState().play, 'playing', '큐잉된 마지막 의도(play)가 적용되지 않았다');
    assert.equal(yt.made[0].sec, 0, 'seek 은 마지막 의도가 아니므로 적용되면 안 된다');
  } finally {
    // ⚠ finally 로 감싼다. 단언이 실패한 채 destroy 를 건너뛰면 폴링 인터벌이 살아남아
    //   테스트 러너가 영영 끝나지 않는다(실패가 "느린 테스트"로 둔갑한다).
    player.destroy();
  }
});

test('pickPlayer: URL 을 알아보면 YouTube, 못 알아보면 널 재생기다', () => {
  assert.deepEqual(mediaSourceFromUrl('https://youtu.be/dQw4w9WgXcQ'), { kind: 'youtube', videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(mediaSourceFromUrl('https://www.youtube.com/watch?v=abc123&t=1m30s'),
    { kind: 'youtube', videoId: 'abc123', startSec: 90 });
  // startSec 0 은 키를 만들지 않는다(비교·저장이 단순해진다).
  assert.deepEqual(Object.keys(mediaSourceFromUrl('https://www.youtube.com/watch?v=abc123')), ['kind', 'videoId']);

  for (const bad of [null, undefined, '', '   ', '그냥 글자', 'https://example.com/a.mp4', 'https://vimeo.com/1']) {
    assert.equal(mediaSourceFromUrl(bad), null, `${bad} 를 소스로 인정했다`);
    assert.equal(pickPlayerKind(bad), 'null');
  }
  assert.equal(pickPlayerKind('https://youtu.be/abc'), 'youtube');

  // 못 알아본 URL 이어도 **완전한 MediaPlayer** 가 나온다 — 호출부에 `player?.` 가 생기지 않는다.
  const nullish = pickPlayer('그냥 글자');
  assert.equal(nullish.kind, 'null');
  assert.ok(isMediaPlayer(nullish));
  const yt = pickPlayer('https://youtu.be/abc');
  assert.equal(yt.kind, 'youtube');
  yt.destroy();
});

// ── videoCommands ───────────────────────────────────────────────────────────

test('videoCommands: 패널 상태는 휘발성이고 media 를 건드리지 않는다', () => {
  const store = createStore();
  assert.deepEqual(VideoCmd.panelState(store).open, false, '켜야 보이는 기능이므로 기본은 닫힘이다');

  assert.deepEqual(VideoCmd.togglePanel(store), { video: true });
  assert.equal(VideoCmd.panelState(store).open, true);
  assert.deepEqual(VideoCmd.openPanel(store), NONE, '값이 안 바뀌면 헛렌더를 만들지 않는다');
  assert.deepEqual(VideoCmd.setCollapsed(store), { video: true });
  assert.equal(VideoCmd.panelState(store).collapsed, true);
  assert.deepEqual(VideoCmd.setFollow(store, { follow: false }), { video: true });
  assert.equal(VideoCmd.panelState(store).follow, false);

  // 화면 상태를 아무리 만져도 안무(media)는 그대로다 = undo 스택에 아무 일도 없다.
  assert.deepEqual(store.get().media, DEFAULT_MEDIA);
  assertDirty(VideoCmd.closePanel(store));
});

test('videoCommands: 재생 위치·재생 상태는 store 어디에도 없다', () => {
  const store = createStore();
  VideoCmd.openPanel(store);
  const text = JSON.stringify({ media: store.get().media, video: store.get().session.video });
  for (const banned of ['currentSec', 'playing', 'playhead', 'currentTime']) {
    assert.ok(!text.includes(banned), `${banned} 가 store 에 들어왔다 — 초당 60회 재렌더가 된다`);
  }
  assert.deepEqual(Object.keys(store.get().session.video).sort(),
    ['collapsed', 'follow', 'open', 'taps', 'tempoPoints']);
});

test('videoCommands: 두 점을 찍으면 bpm 과 앵커가 동시에 정해진다', () => {
  const store = createStore();
  // "여기가 8x1 의 1"(선형 0, 2초) — 아직 확정이 아니므로 히스토리 커밋 신호가 없다.
  const first = VideoCmd.markTempoPoint(store, { count: 0, sec: 2 });
  assert.deepEqual(first, { video: true });
  assert.equal(first.committed, undefined);
  assert.equal(VideoCmd.isTempoReady(store), false, '한 점만으로는 변환하면 안 된다');

  // "여기가 8x5 의 1"(선형 32, 12초) → 32카운트 / 10초 = 192bpm
  const second = VideoCmd.markTempoPoint(store, { count: 32, sec: 12 });
  assert.equal(second.committed, true, '확정 신호가 없으면 호출부가 히스토리를 커밋할 자리를 모른다');
  assert.equal(VideoCmd.isTempoReady(store), true);

  const tempo = VideoCmd.mediaState(store).tempo;
  assert.equal(tempo.bpm, 192);
  assert.equal(tempo.anchorSec, 2, '앞선 점이 앵커가 된다');
  assert.equal(tempo.anchorCount, 0);
  assert.deepEqual(VideoCmd.panelState(store).tempoPoints, [], '확정 뒤에는 찍던 점이 남지 않는다');

  // 카운트 0 은 2초, 카운트 32 는 12초 — 찍은 두 점을 그대로 되돌려준다.
  assert.equal(countToTime(0, tempo), 2);
  assert.ok(Math.abs(countToTime(32, tempo) - 12) < 1e-9);
});

test('videoCommands: 뒤집힌 두 점은 거부하고 마지막 점부터 다시 센다', () => {
  const store = createStore();
  VideoCmd.markTempoPoint(store, { count: 32, sec: 12 });
  const bad = VideoCmd.markTempoPoint(store, { count: 0, sec: 2 });   // 순서가 뒤집혔다
  assert.equal(bad.committed, undefined);
  assert.equal(VideoCmd.isTempoReady(store), false, '뒤집힌 두 점으로 음수 bpm 이 만들어졌다');
  assert.deepEqual(VideoCmd.panelState(store).tempoPoints, [{ count: 0, sec: 2 }],
    '실수로 뒤쪽을 먼저 찍었을 때 마지막 점에서 다시 셀 수 있어야 한다');

  // 이어서 뒤쪽 점을 찍으면 정상 확정된다.
  assert.equal(VideoCmd.markTempoPoint(store, { count: 16, sec: 7 }).committed, true);
  assert.equal(VideoCmd.mediaState(store).tempo.bpm, 192);

  // 취소는 찍던 점만 버린다.
  VideoCmd.markTempoPoint(store, { count: 0, sec: 0 });
  assert.deepEqual(VideoCmd.clearTempoPoints(store), { video: true });
  assert.deepEqual(VideoCmd.clearTempoPoints(store), NONE);
});

test('videoCommands: 탭 템포는 확정할 때만 media 에 쓰고 간격이 벌어지면 새로 센다', () => {
  const store = createStore();
  assert.deepEqual(VideoCmd.commitTaps(store), NONE, '탭 2개 미만은 아무 일도 하지 않는다');

  for (const at of [10, 10.5, 11, 11.5]) VideoCmd.tapTempo(store, { atSec: at });
  assert.equal(VideoCmd.mediaState(store).tempo.bpm, 0, '두드리는 동안 media 가 바뀌면 undo 가 쌓인다');

  const done = VideoCmd.commitTaps(store);
  assert.equal(done.committed, true);
  assert.equal(VideoCmd.mediaState(store).tempo.bpm, 120, '평균 간격 0.5초 = 120bpm');
  assert.deepEqual(VideoCmd.panelState(store).taps, []);

  // TAP_RESET_SEC 보다 벌어지면 앞의 탭을 버린다(딴짓하다 돌아와 다시 두드린 경우).
  VideoCmd.tapTempo(store, { atSec: 100 });
  VideoCmd.tapTempo(store, { atSec: 100 + VideoCmd.TAP_RESET_SEC + 1 });
  assert.deepEqual(VideoCmd.panelState(store).taps, [100 + VideoCmd.TAP_RESET_SEC + 1]);
  assert.deepEqual(VideoCmd.clearTaps(store), { video: true });

  // 앵커는 탭이 건드리지 않는다 — 탭은 "얼마나 빠른가"만 답한다.
  assert.equal(VideoCmd.mediaState(store).tempo.anchorSec, 0);
});

test('videoCommands: 소스는 링크바 URL 그대로이고 템포를 건드리지 않는다', () => {
  const store = createStore();
  VideoCmd.markTempoPoint(store, { count: 0, sec: 2 });
  VideoCmd.markTempoPoint(store, { count: 32, sec: 12 });

  assert.deepEqual(VideoCmd.setSource(store, { url: '  https://youtu.be/abc  ' }), { video: true });
  assert.deepEqual(VideoCmd.mediaState(store).source, { kind: 'youtube', url: 'https://youtu.be/abc' });
  assert.equal(VideoCmd.mediaState(store).tempo.bpm, 192, '소스만 바꿨는데 애써 찍은 템포가 날아갔다');
  assert.deepEqual(VideoCmd.setSource(store, { url: 'https://youtu.be/abc' }), NONE);

  // 빈 URL 은 "소스 없음"이지 오류가 아니다.
  assert.deepEqual(VideoCmd.setSource(store, { url: '' }), { video: true });
  assert.equal(VideoCmd.mediaState(store).source, null);

  // 재앵커는 bpm 을 그대로 두고 앵커만 옮긴다.
  VideoCmd.reanchorTo(store, { count: 64, sec: 25 });
  assert.equal(VideoCmd.mediaState(store).tempo.bpm, 192);
  assert.equal(VideoCmd.mediaState(store).tempo.anchorCount, 64);
  assert.deepEqual(VideoCmd.reanchorTo(store, { count: NaN, sec: 1 }), NONE);
});

test('videoCommands: 템포가 undo 스냅샷을 타고 되돌아온다', () => {
  const store = createStore();
  const hist = History.createHistory(store);
  History.commit(hist, BOARD_MAIN);                        // 템포 미설정 상태

  VideoCmd.markTempoPoint(store, { count: 0, sec: 2 });
  VideoCmd.markTempoPoint(store, { count: 32, sec: 12 });
  History.commit(hist, BOARD_MAIN);                        // 확정 시점에만 커밋한다
  assert.equal(store.get().media.tempo.bpm, 192);

  History.undo(hist, BOARD_MAIN);
  assert.equal(store.get().media.tempo.bpm, 0, '템포가 Undo 로 되돌아오지 않았다');
  History.redo(hist, BOARD_MAIN);
  assert.equal(store.get().media.tempo.bpm, 192);
  assert.equal(store.get().media.tempo.anchorSec, 2);
});

test('videoCommands: 전체 초기화가 링크와 함께 영상 소스·템포도 비운다', () => {
  // 회귀(2026-09): `전체 초기화(링크 포함)` 가 링크바의 youtubeUrl 만 비우고 media.source 를
  // 남겼다. 그러면 링크바는 비었는데 패널은 옛 영상을 계속 싣고, 다음 저장이 사용자가 지운
  // 주소를 파일에 다시 썼다 — 같은 사실이 두 곳에서 갈라지는 상태다.
  const saved = [];
  const storage = { saveLinks: (next) => saved.push(next) };
  const store = createStore();
  store.update({ links: LINKS_SAMPLE() });
  VideoCmd.setSource(store, { url: 'https://www.youtube.com/watch?v=abc' });
  VideoCmd.markTempoPoint(store, { count: 0, sec: 2 });
  VideoCmd.markTempoPoint(store, { count: 32, sec: 12 });
  assert.equal(store.get().media.tempo.bpm, 192);

  const hist = History.createHistory(store, { storage });
  History.commit(hist, BOARD_MAIN);

  const dirty = clearBoard(store, { storage });
  assert.equal(dirty.video, true, 'Dirty.video 가 없으면 패널이 안 다시 그려져 iframe 이 그대로 남는다');
  assert.equal(store.get().media.source, null, '링크를 비웠는데 영상 소스가 남았다');
  assert.equal(store.get().media.tempo.bpm, 0, '지운 영상의 앵커가 다음 영상에 조용히 적용된다');
  assert.equal(isEmptyMedia(store.get().media), true);

  // 되돌리면 배치처럼 함께 살아난다(media 는 undo 스냅샷 안에 있다).
  History.commit(hist, BOARD_MAIN);
  History.undo(hist, BOARD_MAIN);
  assert.equal(store.get().media.tempo.bpm, 192, 'Undo 로 템포가 안 돌아왔다');
  assert.deepEqual(store.get().media.source, { kind: 'youtube', url: 'https://www.youtube.com/watch?v=abc' });
});

test('videoCommands: 영상을 한 번도 안 쓴 전체 초기화는 Dirty 가 예전과 같다', () => {
  // 이 기능이 들어오기 전과 글자 하나 달라지면 안 된다 — 골든 150 이 이 Dirty 를 재생한다.
  const store = createStore();
  store.update({ links: LINKS_SAMPLE() });
  const dirty = clearBoard(store, { storage: { saveLinks() {} } });
  assert.equal('video' in dirty, false, '영상을 안 쓴 사용자에게 video 플래그가 새어 나갔다');
  assert.deepEqual(VideoCmd.clearMedia(store), NONE);
});

// ── 저장 포맷 ───────────────────────────────────────────────────────────────

test('media: 빈 블록은 저장 바이트를 한 글자도 늘리지 않는다', () => {
  const source = {
    rows: 8, cols: 8, categories: {}, moveLibrary: [], placements: [], routines: [],
    youtubeUrl: '', youtubeTitle: '', clickupUrl: '', customLinks: []
  };
  const before = JSON.stringify(buildProjectFile(source, { fileName: 'a', savedAt: 'S' }));
  const withEmpty = JSON.stringify(
    buildProjectFile({ ...source, media: normalizeMedia(null) }, { fileName: 'a', savedAt: 'S' }));
  assert.equal(withEmpty, before, '빈 media 가 파일에 새어 나갔다');
  assert.ok(!before.includes('"media"'));

  // 값이 있으면 customLinks 뒤에 붙는다(키 순서 = 바이트 순서).
  const filled = buildProjectFile(
    { ...source, media: { tempo: { bpm: 180, beatsPerCount: 1, anchorSec: 2, anchorCount: 0 }, source: null } },
    { fileName: 'a', savedAt: 'S' });
  assert.deepEqual(Object.keys(filled).slice(-2), ['customLinks', 'media']);
  assert.equal(filled.media.tempo.bpm, 180);
  assert.deepEqual(Object.keys(filled.media), ['tempo', 'source']);

  // passthrough 로 남의 media 가 되살아나면 안 된다.
  const guarded = buildProjectFile(source, { passthrough: { media: { tempo: { bpm: 999 } }, 미래필드: 1 } });
  assert.equal('media' in guarded, false);
  assert.equal(guarded.미래필드, 1, '알 수 없는 키는 여전히 왕복해야 한다');
});

test('media: normalizeMedia 는 손상된 입력을 기본값으로 접고 isEmptyMedia 가 그것을 알아본다', () => {
  for (const bad of [null, undefined, 42, '문자열', [], { tempo: 'x', source: 7 }]) {
    assert.deepEqual(normalizeMedia(bad), DEFAULT_MEDIA, `${JSON.stringify(bad)} 가 기본값으로 안 접혔다`);
    assert.equal(isEmptyMedia(bad), true);
    assert.equal(serializeMedia(bad), null);
  }
  // 모르는 kind·빈 url 은 소스 없음이다(오류가 아니다).
  assert.equal(normalizeMediaSource({ kind: 'vimeo', url: 'x' }), null);
  assert.equal(normalizeMediaSource({ kind: 'youtube', url: '' }), null);
  assert.deepEqual(normalizeMediaSource({ kind: 'youtube', url: 'u', 잡음: 1 }), { kind: 'youtube', url: 'u' });

  // bpm 0(미설정)이어도 앵커를 옮겼으면 비어 있지 않다 — 사용자가 찍은 값이라 저장해야 한다.
  assert.equal(isEmptyMedia({ tempo: { anchorSec: 3 } }), false);
  assert.equal(isEmptyMedia({ source: { kind: 'youtube', url: 'u' } }), false);
  // 언제나 새 객체다(스냅샷이 store 와 객체를 공유하면 undo 가 죽는다).
  const src = { tempo: { bpm: 100 }, source: { kind: 'youtube', url: 'u' } };
  assert.notEqual(normalizeMedia(src).tempo, src.tempo);
  assert.notEqual(normalizeMedia(src).source, src.source);
});

test('media: media 가 없는 옛 파일이 지금과 똑같이 열리고 왕복해도 커지지 않는다', () => {
  // V1_FILE 에는 media 가 아예 없다 — 이 기능이 들어오기 전의 파일이다.
  assert.equal('media' in V1_FILE, false);

  const res = migrateProjectFile(V1_FILE, { now: () => '1970-01-01T00:00:00.000Z' });
  assert.equal(res.ok, true);
  assert.equal(res.value.doc.media, null, '없던 것을 날조하지 않는다');

  const flat = { ...res.value, ...res.value.doc };
  const normalized = normalizeProject(flat, { ids: counterEnv() });
  assert.notEqual(normalized, null, '옛 파일이 열리지 않았다');
  assert.deepEqual(normalized.media, DEFAULT_MEDIA, 'media 가 없으면 미설정으로 떨어져야 한다');

  // 열었다 다시 저장했을 때 media 키가 생기지 않아야 한다(= 바이트가 안 늘어난다).
  const resaved = buildProjectFile({
    rows: normalized.rows, cols: normalized.cols, categories: normalized.categories,
    moveLibrary: normalized.moveLibrary, placements: normalized.placements, routines: normalized.routines,
    ...toLinkBundle(flat), media: normalized.media
  }, { fileName: 'demo', savedAt: 'S' });
  assert.equal('media' in resaved, false);
});

test('media: 우리가 쓴 media 블록은 v1→v2 왕복에서 살아남는다', () => {
  const withMedia = {
    ...V1_FILE,
    media: { tempo: { bpm: 180, beatsPerCount: 2, anchorSec: 1.5, anchorCount: 8 }, source: { kind: 'youtube', url: 'https://youtu.be/abc' } }
  };
  const res = migrateProjectFile(withMedia, { now: () => '1970-01-01T00:00:00.000Z' });
  assert.deepEqual(res.value.doc.media, withMedia.media, '최상위 media:[] 가 우리 블록을 덮어썼다');
  assert.deepEqual(res.value.media, [], '최상위 자리는 MediaRef 목록 그대로다(이름만 같다)');

  // readProjectData 의 되펼치기에서는 doc 쪽이 이긴다 — 우리가 읽고 싶은 값이 나온다.
  const flat = { ...res.value, ...res.value.doc };
  assert.deepEqual(normalizeProject(flat, { ids: counterEnv() }).media, withMedia.media);
});

test('snapshot: applySnapshot(main) 은 media 가 없는 옛 스냅샷도 미설정으로 되돌린다', () => {
  const legacy = JSON.stringify({ rows: 8, cols: 8, placements: [], moveLibrary: [], categories: {}, routines: [] });
  assert.deepEqual(applySnapshot(legacy, { kind: 'main' }).media, DEFAULT_MEDIA);
  // 루틴 패치에는 media 가 없어야 한다(루틴 보드에는 시간 매핑이 없다).
  const routineSnap = JSON.stringify({ rows: 4, cols: 8, placements: [] });
  assert.equal('media' in applySnapshot(routineSnap, { kind: 'routine' }), false);

  // pickUndoFields 는 media 를 **값으로 복제**한다(스냅샷이 지금 값을 따라가면 undo 가 죽는다).
  const state = {
    rows: 8, cols: 8, placements: [], moveLibrary: [], categories: {}, routines: [],
    links: LINKS_SAMPLE(), media: { tempo: { bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 0 }, source: null }
  };
  const picked = pickUndoFields(state);
  state.media.tempo.bpm = 999;
  assert.equal(picked.media.tempo.bpm, 120, '스냅샷이 현재 상태를 따라 변했다 — 얕은 복제다');
});
