// tests/unit/thumbBarState.test.mjs — 엄지 줄 상태가 메인 판의 빠른 배치 켜짐을 넘기는가 (RM-36)
//
// app/main 의 엄지 줄 getState 는 app/thumbState 의 thumbBarState 를 부른다. 그 함수를 실제 store 로 돌려
// 메인 판만 보는지, main.js 가 정말 그 함수를 쓰는지(소스 대조) 함께 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../src/usecases/store.js';
import { toggleQuickPlaceMode } from '../../src/usecases/boardCommands.js';
import { thumbBarState } from '../../src/app/thumbState.js';

test('엄지 줄 상태는 실제 store 의 메인 판 빠른 배치 켜짐을 quickPlaceOn 으로 넘긴다', () => {
  const main = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ thumbBarState \} from '\.\/thumbState\.js'/);
  assert.match(main, /createThumbBar\(\{\s*(\/\/[^\n]*\n\s*)*getState: \(\) => thumbBarState\(store,/);

  const store = createStore();
  assert.equal(thumbBarState(store).quickPlaceOn, false);
  toggleQuickPlaceMode(store, { boardId: 'main' });
  assert.equal(thumbBarState(store).quickPlaceOn, true);
  toggleQuickPlaceMode(store, { boardId: 'main' });
  assert.equal(thumbBarState(store).quickPlaceOn, false);
  // 루틴 판만 켜면 엄지 줄(메인 판)은 꺼진 채다.
  toggleQuickPlaceMode(store, { boardId: 'routine' });
  assert.equal(thumbBarState(store).quickPlaceOn, false);
});
