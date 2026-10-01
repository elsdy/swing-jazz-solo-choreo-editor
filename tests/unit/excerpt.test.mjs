// tests/unit/excerpt.test.mjs — 안무표에서 고른 대목을 영상으로 잘라 내보내기(RM-31 · 2026-10-01)
//
//   ① domain/excerpt — 카운트 구간 → 자를 초 구간(앞 여유 · 0초 앞 · 영상 끝 넘음 · 가변 템포), 클립 이름
//   ② usecases/videoCommands.addExcerptClip — 지금 영상을 두고 목록에만 더하는가, 박자·마커를 당겨 물려주는가
//   ③ adapters/clipServer.trim — 이름(label) 인자가 요청에 실리는가

import test from 'node:test';
import assert from 'node:assert/strict';

import { EXCERPT_LEAD_COUNTS, MIN_EXCERPT_SEC, excerptLabel, excerptSpan } from '../../src/domain/excerpt.js';
import { normalizeTempo, DEFAULT_TEMPO } from '../../src/domain/tempo.js';
import { createStore, NONE } from '../../src/usecases/store.js';
import * as VideoCmd from '../../src/usecases/videoCommands.js';
import { createClipServer } from '../../src/adapters/clipServer.js';

/** 120bpm · 1카운트 = 1박 → 0.5초. 8x1 의 1(카운트 0) = 10초. */
const T120 = normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 10, anchorCount: 0 });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ≠ ${b}`);

// ── ① domain ────────────────────────────────────────────────────────────────

test('excerpt: 고른 마디의 초 구간에 앞 2카운트 여유가 붙는다', () => {
  assert.equal(EXCERPT_LEAD_COUNTS, 2);
  const span = excerptSpan({ fromCount: 8, toCount: 24 }, T120);
  assert.equal(span.ok, true);
  close(span.startSec, 10 + 8 * 0.5 - 2 * 0.5, '시작 = 8x2 의 1 - 2카운트');
  close(span.endSec, 10 + 24 * 0.5, '끝 = 8x3 의 끝');
  close(span.leadSec, 1);
  assert.equal(span.clippedStart, false);
  assert.equal(span.clippedEnd, false);
});

test('excerpt: 여유 0 도 유효한 값이다(개발 원칙 D-5) — 박자 그대로 자른다', () => {
  const span = excerptSpan({ fromCount: 8, toCount: 16 }, T120, { leadCounts: 0 });
  close(span.startSec, 14);
  close(span.endSec, 18);
  assert.equal(span.leadSec, 0);
  const dflt = excerptSpan({ fromCount: 8, toCount: 16 }, T120, { leadCounts: undefined });
  close(dflt.startSec, 13, '주지 않으면 기본 여유');
});

test('excerpt: 여유가 영상 0초에 걸리면 여유만 줄고 「잘렸다」고 말하지 않는다', () => {
  // 카운트 0 = 10초 → 여유 2카운트(1초)는 9초. 앵커를 0.4초로 당기면 여유가 0초에 걸린다.
  const t = normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 0.4, anchorCount: 0 });
  const span = excerptSpan({ fromCount: 0, toCount: 8 }, t);
  assert.equal(span.startSec, 0);
  close(span.leadSec, 0.4);
  assert.equal(span.clippedStart, false);
});

test('excerpt: 고른 대목 자체가 0초보다 앞이면 앞을 잘라 맞추고 알린다', () => {
  // intro 행(음수 카운트)이 영상 시작 전이다: 카운트 -8 = 10 - 4 = 6초 … 앵커를 2초로 두면 -8 은 -2초.
  const t = normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 2, anchorCount: 0 });
  const span = excerptSpan({ fromCount: -8, toCount: 8 }, t);
  assert.equal(span.ok, true);
  assert.equal(span.startSec, 0);
  close(span.endSec, 6);
  assert.equal(span.clippedStart, true);
  assert.equal(span.leadSec, 0);
});

test('excerpt: 영상 끝을 넘는 대목은 끝을 잘라 맞추고 알린다, 길이를 모르면 맞추지 않는다', () => {
  const span = excerptSpan({ fromCount: 8, toCount: 24 }, T120, { durationSec: 20 });
  close(span.endSec, 20);
  assert.equal(span.clippedEnd, true);
  const tiny = excerptSpan({ fromCount: 8, toCount: 24 }, T120, { durationSec: 21.98 });
  assert.equal(tiny.clippedEnd, false, '마지막 프레임 반올림 차이는 알리지 않는다');
  const unknown = excerptSpan({ fromCount: 8, toCount: 24 }, T120, { durationSec: null });
  close(unknown.endSec, 22);
  assert.equal(unknown.clippedEnd, false);
});

test('excerpt: 잘라 맞춘 뒤 남는 것이 없으면 outside, 박자가 없으면 no-tempo, 구간이 틀리면 no-range', () => {
  assert.deepEqual(excerptSpan({ fromCount: 80, toCount: 88 }, T120, { durationSec: 20 }), { ok: false, reason: 'outside' });
  const early = normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 0, anchorCount: 64 });
  assert.deepEqual(excerptSpan({ fromCount: 0, toCount: 8 }, early), { ok: false, reason: 'outside' }, '전부 0초 앞');
  assert.deepEqual(excerptSpan({ fromCount: 0, toCount: 8 }, DEFAULT_TEMPO), { ok: false, reason: 'no-tempo' });
  assert.deepEqual(excerptSpan(null, T120), { ok: false, reason: 'no-range' });
  assert.deepEqual(excerptSpan({ fromCount: 8, toCount: 8 }, T120), { ok: false, reason: 'no-range' });
  // 최소 길이 바로 위는 받는다(딱 0.1 은 부동소수로 0.0999… 가 되어 서버도 거절한다 — 앱도 같은 비교다).
  const edge = excerptSpan({ fromCount: 0, toCount: 8 }, T120, { durationSec: 10 + MIN_EXCERPT_SEC + 0.001, leadCounts: 0 });
  assert.equal(edge.ok, true);
});

test('excerpt: 가변 템포 — 여유와 끝을 그 자리의 기울기로 잰다(초를 빼지 않는다)', () => {
  // 0 → 10초, 16 → 18초(0.5초/카운트), 32 → 22초(0.25초/카운트). 그 뒤는 bpm(120 → 0.5초).
  const t = normalizeTempo({ bpm: 120, beatsPerCount: 1, anchorSec: 10, anchorCount: 0, points: [{ count: 16, sec: 18 }, { count: 32, sec: 22 }] });
  const span = excerptSpan({ fromCount: 18, toCount: 30 }, t);
  close(span.startSec, 18, '여유 2카운트(16~18)는 빠른 구간의 0.25초 × 2 = 0.5초');
  close(span.endSec, 18 + 14 * 0.25);
  close(span.leadSec, 0.5);
  const across = excerptSpan({ fromCount: 16, toCount: 32 }, t);
  close(across.startSec, 17, '여유가 느린 구간(0.5초/카운트)에 걸리면 그 기울기');
  close(across.endSec, 22);
});

test('excerpt: 클립 이름은 초가 아니라 안무표의 말이다', () => {
  assert.equal(excerptLabel({ fromCount: 32, toCount: 64 }, 8, ['Shim Sham']), '8x5 ~ 8x8 Shim Sham');
  assert.equal(excerptLabel({ fromCount: 8, toCount: 16 }, 8, []), '8x2');
  assert.equal(excerptLabel({ fromCount: 10, toCount: 14 }, 8, ['a', 'a', ' ']), '8x2의 3~6카운트 a', '같은 이름 · 빈 이름은 한 번만');
  assert.equal(excerptLabel({ fromCount: 0, toCount: 8 }, 8, ['a', 'b', 'c', 'd']), '8x1 a · b · c …');
  assert.equal(excerptLabel(null, 8, ['a']), '');
});

// ── ② usecases ──────────────────────────────────────────────────────────────

function storeWithTake() {
  const store = createStore();
  VideoCmd.setFileSource(store, { name: 'take.mov', path: 'video-clip/p/take.mov' });
  VideoCmd.renameClip(store, { id: VideoCmd.mediaState(store).id, name: '9/8 연습' });
  VideoCmd.setClipMeta(store, { id: VideoCmd.mediaState(store).id, takenAt: '2026-09-08' });
  VideoCmd.setTempo(store, { tempo: { bpm: 120, anchorSec: 12, anchorCount: 0 } });
  VideoCmd.addTempoPoint(store, { count: 16, sec: 21 });
  VideoCmd.addMarkerAt(store, { inSec: 12, outSec: 16, fromCount: 0, toCount: 8, label: 'a' });
  VideoCmd.addMarkerAt(store, { inSec: 40, outSec: 44, fromCount: 32, toCount: 40, label: '밖' });
  VideoCmd.setInOut(store, { inSec: 30, outSec: 35 });
  return store;
}

test('addExcerptClip: 지금 영상·박자·In/Out 은 그대로 두고 새 클립을 목록에 더하기만 한다', () => {
  const store = storeWithTake();
  const before = VideoCmd.mediaState(store);
  const dirty = VideoCmd.addExcerptClip(store, {
    name: 'take [8x1 a].mp4', path: 'video-clip/p/take [8x1 a].mp4', label: '8x1 a', startSec: 11, endSec: 20
  });
  assert.deepEqual(dirty, { video: true });
  assert.deepEqual(VideoCmd.mediaState(store), before, '지금 영상은 한 글자도 안 바뀐다(applyTrim 과 다르다)');
  assert.deepEqual(VideoCmd.inOutRange(store), { inSec: 30, outSec: 35 }, 'In/Out 도 그대로');
  const { clips, activeId } = VideoCmd.clipList(store);
  assert.equal(activeId, before.id);
  assert.equal(clips.length, 2);
  const added = clips[1];
  assert.equal(added.name, '8x1 a');
  assert.deepEqual(added.source, { kind: 'file', name: 'take [8x1 a].mp4', path: 'video-clip/p/take [8x1 a].mp4' });
  assert.equal(added.takenAt, '2026-09-08', '같은 테이크라 찍은 날을 물려받는다');
  assert.equal(added.note, '「9/8 연습」에서 잘라 냄');
});

test('addExcerptClip: 새 클립의 박자·마커는 시작만큼 당겨 물려받아 곧바로 맞는다', () => {
  const store = storeWithTake();
  VideoCmd.addExcerptClip(store, { name: 'x.mp4', path: 'video-clip/p/x.mp4', label: 'x', startSec: 11, endSec: 20 });
  const added = VideoCmd.clipList(store).clips[1];
  assert.equal(added.tempo.bpm, 120);
  assert.equal(added.tempo.anchorSec, 1, '원본 12초 = 새 클립 1초');
  assert.deepEqual(added.tempo.points, [{ count: 16, sec: 10 }]);
  assert.deepEqual(added.markers.map(m => [m.inSec, m.outSec, m.label]), [[1, 5, 'a']], '잘린 구간 밖의 마커는 따라가지 않는다');
});

test('addExcerptClip: 틀린 입력과 이미 있는 경로는 아무것도 하지 않는다', () => {
  const store = storeWithTake();
  assert.equal(VideoCmd.addExcerptClip(store, { name: 'x.mp4', path: 'p/x.mp4', startSec: 5, endSec: 5 }), NONE);
  assert.equal(VideoCmd.addExcerptClip(store, { name: '', path: '', startSec: 0, endSec: 5 }), NONE);
  assert.equal(VideoCmd.addExcerptClip(store, { name: 'take.mov', path: 'video-clip/p/take.mov', startSec: 0, endSec: 5 }), NONE, '지금 영상과 같은 경로');
  assert.equal(VideoCmd.clipList(store).clips.length, 1);
  // 이름이 없으면 순번 이름이다.
  VideoCmd.addExcerptClip(store, { name: 'y.mp4', path: 'p/y.mp4', startSec: 0, endSec: 5 });
  assert.equal(VideoCmd.clipList(store).clips[1].name, '테이크 2');
});

// ── ③ adapters ──────────────────────────────────────────────────────────────

test('clipServer.trim: label 을 주면 요청에 실리고, 안 주면 옛 요청 모양 그대로다', async () => {
  const bodies = [];
  const api = createClipServer({
    fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 201, json: async () => ({ ok: true, path: 'v/p/a [8x2].mp4', name: 'a [8x2].mp4', url: '/clips/x', durationSec: 4 }) };
    }
  });
  const res = await api.trim('v/p/a.mov', 13, 18, '8x2');
  assert.equal(res.ok, true);
  assert.equal(res.name, 'a [8x2].mp4');
  await api.trim('v/p/a.mov', 13, 18);
  assert.deepEqual(bodies, [{ path: 'v/p/a.mov', inSec: 13, outSec: 18, label: '8x2' }, { path: 'v/p/a.mov', inSec: 13, outSec: 18 }]);
});
