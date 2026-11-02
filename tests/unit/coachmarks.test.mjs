// tests/unit/coachmarks.test.mjs — 처음 한 번 안내의 흐름(ui/coachmarks.createCoachFlow, RM-26)
//
// 말풍선 그리기는 브라우저의 일이지만 **차례와 본 기록**은 DOM 없이 잰다. 이름은 계획서의 「요구 ↔ 시험」 표와 같다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COACHMARKS, createCoachFlow } from '../../src/ui/coachmarks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 이 브라우저의 본 기록 자리를 흉내 낸다(adapters/localStore 의 loadCoachSeen · saveCoachSeen 자리). */
function memorySeen(initial = false) {
  let v = initial;
  const writes = [];
  return { load: () => v, save: (x) => { v = x === true; writes.push(v); }, writes };
}

test('본 기록이 없으면 세 장을 차례로 내고 끝나면 본 기록을 남긴다', () => {
  const seen = memorySeen();
  const flow = createCoachFlow({ seen, context: () => ({ hasPlacements: false }) });
  assert.equal(COACHMARKS.length, 3);
  const order = [flow.start()?.id, flow.next()?.id, flow.next()?.id];
  assert.deepEqual(order, ['fill', 'palette', 'video'], '채우기 줄 → 동작 목록 → 영상');
  assert.deepEqual(COACHMARKS.map(c => c.target), ['modeBar', 'paletteSearch', 'videoPanelBtn'], '대상은 id 로 붙는다');
  assert.equal(flow.total(), 3);
  assert.equal(seen.load(), false, '마지막 장을 보는 중에는 아직 끝나지 않았다');
  assert.equal(flow.next(), null);
  assert.equal(seen.load(), true, '끝까지 봤는데 본 기록이 없다');
  assert.equal(flow.start(), null, '본 기록이 있는데 다시 뜬다');

  const skipped = memorySeen();
  const f2 = createCoachFlow({ seen: skipped });
  f2.start();
  f2.skip();
  assert.equal(skipped.load(), true, '건너뛰기도 본 기록을 남긴다');
  assert.equal(f2.running(), false);

  // 되살린 안무표가 있으면 「무엇으로 채울까」(①)는 건너뛰고 두 장만 낸다
  const f3 = createCoachFlow({ seen: memorySeen(), context: () => ({ hasPlacements: true }) });
  assert.equal(f3.start()?.id, 'palette');
  assert.equal(f3.total(), 2);
});

test('안내 다시 보기는 본 기록을 지워 다음 시작에 첫 장부터 낸다', () => {
  const seen = memorySeen(true);
  const flow = createCoachFlow({ seen });
  assert.equal(flow.start(), null, '본 기록이 있으면 시작하지 않는다');
  flow.reset();
  assert.equal(seen.load(), false, '다시 보기가 본 기록을 지우지 않았다');
  assert.equal(flow.start()?.id, 'fill', '첫 장부터가 아니다');
});

test('말풍선이 붙는 대상 id 가 지금 화면 마크업에 있다', () => {
  // 다른 항목(RM-20 · RM-36)이 마크업을 옮기다 id 를 지우면 말풍선이 화면 가운데로 떨어진다 — 여기서 붉게 한다
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const c of COACHMARKS) assert.match(html, new RegExp(`id="${c.target}"`), `${c.id}: #${c.target} 가 index.html 에 없다`);
});
