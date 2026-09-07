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

import test from 'node:test';
import assert from 'node:assert/strict';

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
  categoryColor, contrastRatio, darken, parseHexColor, resolvePlacementColor, textColorOn
} from '../../src/domain/categories.js';
import { DEFAULT_CATEGORIES } from '../../src/domain/defaults.js';
import { ROUTINE_COLORS } from '../../src/domain/routines.js';
import { createNullMediaPlayer } from '../../src/adapters/nullMediaPlayer.js';
import { NONE, mergeDirty } from '../../src/usecases/store.js';
import { SCHEMA_VERSION } from '../../src/domain/project/schema.js';
import { detectSchemaVersion, migrateProjectFile } from '../../src/domain/project/migrations.js';
import { normalizeProject } from '../../src/domain/project/normalize.js';
import { counterEnv } from '../../src/ports/env.js';

const COLS_CASES = [1, 8, 128];
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
