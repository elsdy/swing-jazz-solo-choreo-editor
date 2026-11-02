// tests/unit/guideLines.test.mjs — 조용한 안내 줄(RM-19): 평소에는 비고, 막혔을 때만 경고, 살아 있는 값만 소식
//
// 늘 떠 있던 설명 문단을 걷었다. 그 결과가 「아무 말도 안 하는 화면」이 되면 안 된다 — 막힌 까닭(BPM 없음 ·
// 박자 밀림 · 보정점 순서 · 자르기 실패)은 여전히 말해야 한다. 이 시험이 그 두 쪽을 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUIET, NEED_BPM_TEXT, captureGuide, voiceGuide, markGuide, tapGuide, pointGuide,
  trimGuide, exportGuide, markerGuide, poseGuide, practiceGuide, applyGuide
} from '../../src/ui/guideLines.js';

test('받아 적기 안내: 평소에는 비고, BPM 없음 · 밀림일 때만 경고를 낸다', () => {
  // 평소 — 박자가 있고 받지 않는 중, 받는 중이지만 박자가 맞는 중
  assert.deepEqual(captureGuide({ ready: true, running: false }), QUIET);
  assert.deepEqual(captureGuide({ ready: true, running: true, drift: { state: 'ok' }, bpm: 120 }), QUIET);
  assert.deepEqual(captureGuide({ ready: true, running: true, drift: null, bpm: 120 }), QUIET);

  // BPM 없음 — 왜 버튼이 죽었는지의 답
  assert.deepEqual(captureGuide({ ready: false, running: false }), { text: NEED_BPM_TEXT, tone: 'warn' });

  // 갈수록 밀림 — 다시 잰 BPM 을 함께
  const fast = captureGuide({ ready: true, running: true, drift: { state: 'fast', bpmEstimate: 124 }, bpm: 120, formatBpm: (b) => `${b}` });
  assert.equal(fast.tone, 'warn');
  assert.match(fast.text, /갈수록 밀립니다/);
  assert.match(fast.text, /빠릅니다/);
  assert.match(fast.text, /약 124 BPM/);
  assert.equal(captureGuide({ ready: true, running: true, drift: { state: 'slow' }, bpm: 120 }).tone, 'warn');

  // 고르게 어긋남 — 손의 버릇
  const lag = captureGuide({ ready: true, running: true, drift: { state: 'lag', mean: 0.5 }, bpm: 120 });
  assert.equal(lag.tone, 'warn');
  assert.match(lag.text, /고르게 늦게/);
});

test('나머지 안내 줄도 평소에는 빈 글이다 — 값이 있거나 막혔을 때만 말한다', () => {
  // 마이크: 꺼져 있으면 빈 글, 다시 켜는 틈 · 오류는 경고, 붙을 이름은 소식
  assert.deepEqual(voiceGuide({ ready: true, wanted: false, listening: false }), QUIET);
  assert.deepEqual(voiceGuide({ ready: true, wanted: true, listening: true }), QUIET);
  assert.equal(voiceGuide({ ready: true, wanted: true, listening: false }).tone, 'warn');
  assert.equal(voiceGuide({ error: '마이크 권한이 없습니다', ready: true, wanted: true, listening: false }).tone, 'warn');
  assert.equal(voiceGuide({ ready: true, wanted: true, listening: true, heard: { name: '스윙아웃', heard: '스윙아웃' } }).tone, 'info');

  assert.deepEqual(markGuide({ points: 0, needed: 2 }), QUIET);
  assert.equal(markGuide({ points: 1, needed: 2, firstLabel: '8x1의 1카운트 = 0:12.3' }).tone, 'info');

  assert.deepEqual(tapGuide({ taps: 1 }), QUIET);
  assert.equal(tapGuide({ taps: 4, measured: '탭 4번 → 120 BPM' }).tone, 'info');
  assert.equal(tapGuide({ taps: 4, measured: null }).tone, 'warn');

  assert.deepEqual(pointGuide({ rejected: false }), QUIET);
  assert.equal(pointGuide({ rejected: true }).tone, 'warn');

  // 자르기: 준비됨 · In/Out 없음은 빈 글, 환경 막힘 · 실패는 경고
  assert.deepEqual(trimGuide({ state: 'ready' }), QUIET);
  assert.deepEqual(trimGuide({ state: 'no-inout' }), QUIET);
  assert.equal(trimGuide({ state: 'no-ffmpeg' }).tone, 'warn');
  assert.equal(trimGuide({ state: 'ready', error: 'exit 1' }).tone, 'warn');

  assert.deepEqual(exportGuide({ state: 'no-selection', selected: false }), QUIET);
  assert.equal(exportGuide({ state: 'no-tempo', selected: true, selectionLabel: '8x1' }).tone, 'warn');

  assert.deepEqual(markerGuide({ rejected: false, hasRange: false }), QUIET);

  // 자세 분석: 준비됐으면 빈 글(설명은 처음 한 번 안내로 갔다), 막힘은 경고
  assert.deepEqual(poseGuide({ state: 'idle', why: 'ready' }), QUIET);
  assert.equal(poseGuide({ state: 'idle', why: 'no-model' }).tone, 'warn');
  assert.equal(poseGuide({ state: 'error', error: 'x', why: 'ready' }).tone, 'warn');

  // 연습 줄: 박자가 있고 반복하지 않으면 빈 글
  assert.deepEqual(practiceGuide({ ready: true, text: '' }), QUIET);
  assert.equal(practiceGuide({ ready: false }).tone, 'warn');
});

test('applyGuide: 빈 글이면 줄을 숨기고, 경고면 오류 색을 붙인다', () => {
  const classes = new Set();
  const el = { textContent: 'old', hidden: false, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  applyGuide(el, QUIET, 'is-error');
  assert.equal(el.textContent, '');
  assert.equal(el.hidden, true);
  applyGuide(el, { text: '막힘', tone: 'warn' }, 'is-error');
  assert.equal(el.hidden, false);
  assert.ok(classes.has('is-error'));
  applyGuide(el, { text: '값', tone: 'info' }, 'is-error');
  assert.ok(!classes.has('is-error'));
  applyGuide(null, QUIET, 'is-error');   // 마크업에 없는 줄은 조용히 넘어간다
});
