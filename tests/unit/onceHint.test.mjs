// tests/unit/onceHint.test.mjs — 「처음 한 번」 안내(RM-19)
//
// 걷어 낸 설명 문장은 그 단계를 처음 쓸 때 한 번만 뜬다. 본 기록은 이 브라우저(kv)에만 남고,
// `⚙ 설정` 의 `처음 한 번 안내 다시 보기` 가 비워 되살린다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnceHints, ONCE_HINTS } from '../../src/ui/onceHint.js';

/** 가짜 kv — localStore 의 loadOnceHints · saveOnceHints 자리. */
function kv(initial = []) {
  let saved = [...initial];
  return { load: () => [...saved], save: (seen) => { saved = [...seen]; }, peek: () => saved };
}

test('처음 한 번 안내: 본 단계는 다시 뜨지 않고 다시 보기로 되살린다', () => {
  const store = kv();
  const shown = [];
  const hints = createOnceHints({ load: store.load, save: store.save, present: (key, text) => shown.push({ key, text }) });

  // 처음 — 뜨고 기록된다
  assert.equal(hints.show('step3'), true);
  assert.deepEqual(shown, [{ key: 'step3', text: ONCE_HINTS.step3 }]);
  assert.deepEqual(store.peek(), ['step3']);

  // 두 번째 — 아무 일도 없다
  assert.equal(hints.show('step3'), false);
  assert.equal(shown.length, 1);

  // 새로고침한 뒤(같은 kv 로 다시 만든다)에도 본 것은 본 것이다
  const reloaded = createOnceHints({ load: store.load, save: store.save, present: (key) => shown.push({ key }) });
  assert.equal(reloaded.seen('step3'), true);
  assert.equal(reloaded.show('step3'), false);
  assert.equal(reloaded.show('practice'), true, '다른 단계는 따로 센다');
  assert.deepEqual(reloaded.seenKeys().sort(), ['practice', 'step3']);

  // 다시 보기 — 기록을 비우면 다음에 그 단계를 열 때 다시 뜬다
  reloaded.reset();
  assert.deepEqual(store.peek(), []);
  assert.equal(reloaded.seenKeys().length, 0);
  assert.equal(reloaded.show('step3'), true);

  // 모르는 열쇠는 띄울 문장이 없으니 「본 것」이다
  assert.equal(reloaded.show('없는-단계'), false);
});

test('걷어 낸 사이드바 문장 셋은 처음 한 번 안내에 원문 그대로 산다', () => {
  // 「✏」 글자는 RM-18 에 아이콘으로 갔다 — 문장은 같은 말을 「연필 버튼」으로 한다(`새 루틴` 단추의 툴팁과 같은 글)
  assert.equal(ONCE_HINTS.routine, '루틴을 드래그해서 안무표에 배치하거나, 연필 버튼으로 편집하세요.');
  assert.match(ONCE_HINTS.category, /^동작 카테고리는 팔레트에서 바로 수정되고/);
  assert.match(ONCE_HINTS.file, /^내보낸 파일에는 안무표 크기/);
  for (const key of ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'practice']) {
    assert.ok(ONCE_HINTS[key] && ONCE_HINTS[key].length > 10, `${key} 의 문장이 있다`);
  }
});

test('kv 가 망가진 값을 주어도 던지지 않는다', () => {
  const hints = createOnceHints({ load: () => null, save: () => {} });
  assert.equal(hints.show('step1'), true);
});
