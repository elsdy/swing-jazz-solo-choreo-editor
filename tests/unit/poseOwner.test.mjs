// tests/unit/poseOwner.test.mjs — 클립을 바꾸면 옛 자세 분석을 걷는다 (RM-30)
//
// 2026-11-03 브라우저 시험에서 잼: take-b 를 분석하고 사이드바에서 take-a 를 고르자 take-a 영상 위에 take-b 의
// 71장이 그대로 남았다. 서버 클립은 확인이 끝나기 전에 소스가 null 이라 재생기 종류가 file → null → file 로
// 바뀌고, 그때마다 loadedVideoKey 가 비어 `loadedVideoKey && poseFrames.length` 조건이 끝내 서지 않았다.
// main.js 는 조립 계층이라 단위로 띄울 수 없어 소스를 대조한다(thumbBarState 와 같은 길).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
const body = (name) => {
  const at = main.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} 이 main.js 에 없다`);
  return main.slice(at, main.indexOf('\n}\n', at));
};

test('poseOwner: 영상이 바뀌면 분석의 주인과 견주어 걷는다 — loadedVideoKey 가 비어도 놓치지 않는다', () => {
  const ensure = body('ensurePlayer');
  assert.match(ensure, /if \(poseOwnerKey && poseOwnerKey !== key\) \{\s*const dirty = dropPoseAnalysis\(\);\s*queueMicrotask\(\(\) => render\(dirty\)\);/,
    '걷은 것을 그리지 않으면 상태는 비었는데 화면에 옛 「71장」 이 남는다');
  assert.doesNotMatch(ensure, /loadedVideoKey && poseFrames\.length/, '옛 조건 — 재생기 종류가 바뀌면 서지 않는다');
  // 다시 열면 짝 파일에서 되살아나야 한다
  assert.match(ensure, /poseRestoredFor = '';/);
});

test('poseOwner: 주인은 분석이 끝날 때 · 되살릴 때 서고, 걷을 때 빈다 — 걷기 전 기다리던 저장은 내보낸다', () => {
  assert.match(body('runPoseAnalysis'), /poseOwnerKey = loadedVideoKey;/);
  assert.match(body('restorePoseRecord'), /poseOwnerKey = mark;/);
  const drop = body('dropPoseAnalysis');
  assert.match(drop, /poseOwnerKey = '';/);
  assert.ok(drop.indexOf('flushPoseSave()') < drop.indexOf('poseFrames = []'), '프레임을 비우기 전에 남겨야 한다');
  // 부팅 중 ensurePlayer 가 읽으므로 16-b · 16-c 보다 먼저 선다(TDZ)
  assert.ok(main.indexOf('let poseOwnerKey') < main.indexOf('function ensurePlayer('));
  assert.ok(main.indexOf('let poseRestoredFor') < main.indexOf('function ensurePlayer('));
});
