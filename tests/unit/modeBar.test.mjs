// tests/unit/modeBar.test.mjs — 채우기 줄 입구의 막힘 판정(ui/modeBar.entryStates, RM-26)
//
// 막힘은 **이미 있는 상태**(서버 응답 · LLM 설정)만 읽는다. 이름은 계획서의 「요구 ↔ 시험」 표와 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { entryStates } from '../../src/ui/modeBar.js';

test('서버 · LLM 상태에 따라 막힌 입구와 까닭을 낸다', () => {
  const noServer = entryStates({ server: false, llm: null });
  assert.equal(noServer.compose.blocked, true);
  assert.match(noServer.compose.reason, /로컬 서버/);
  for (const k of ['video', 'quickPlace', 'manual']) assert.equal(noServer[k].blocked, false, `${k} 는 서버 없이도 된다`);

  const noKey = entryStates({ server: true, llm: { available: false } });
  assert.equal(noKey.compose.blocked, true);
  assert.match(noKey.compose.reason, /LLM 키/);

  const noConfig = entryStates({ server: true, llm: null });
  assert.equal(noConfig.compose.blocked, true, 'LLM 설정을 못 읽었으면 막힌 것으로 본다');

  const ready = entryStates({ server: true, llm: { available: true } });
  for (const k of ['compose', 'video', 'quickPlace', 'manual']) {
    assert.equal(ready[k].blocked, false, `${k} 가 막혔다`);
    assert.equal(ready[k].reason, '');
  }
  assert.deepEqual(entryStates(undefined).compose.blocked, true, '상태를 모르면 서버 없음으로 본다');
});
