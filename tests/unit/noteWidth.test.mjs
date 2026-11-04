// tests/unit/noteWidth.test.mjs — 비고 칸 폭 재측정(RM-42)
//
// 렌더마다 --noteW 를 0px 로 썼다가 칸 65개의 scrollWidth 를 다시 재던 것(강제 리플로 두 번)을
// 감싸개(.note-content, inline-block)의 offsetWidth 를 한 번 읽는 것으로 바꿨다.
// DOM 없이 가짜 칸 · 가짜 noteRoot 로 쓰기 · 읽기를 센다. 실제 브라우저에서 옛 폭과 같은지는
// tools/boardBench.html 에서 손으로 견줬다(docs/roadmap/plans/RM-42.md).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setNoteWidth } from '../../src/ui/cssVars.js';

const PAD = { paddingLeft: '12px', paddingRight: '12px' };

/** setProperty 로 받은 값을 차례대로 적는 가짜 noteRoot. */
// @complexity time=O(1) space=O(k) cc=1
function fakeRoot() {
  const props = {};
  const calls = [];
  return {
    calls,
    style: {
      setProperty(k, v) { calls.push([k, v]); props[k] = v; },
      getPropertyValue(k) { return props[k] || ''; },
    },
  };
}

/** 내용 폭이 contentW 인 가짜 비고 칸. 옛 꼴의 scrollWidth 는 왼쪽 안쪽 여백 + 내용 폭이다(Chrome 156 에서 잰 꼴). */
// @complexity time=O(1) space=O(1) cc=1
function fakeCell(contentW, reads, pad = 12) {
  return {
    contentW,
    get scrollWidth() { reads.scroll++; return pad + this.contentW; },
    get firstElementChild() {
      const cell = this;
      return { get offsetWidth() { reads.offset++; return cell.contentW; } };
    },
  };
}

const readStyle = () => PAD;

test('[RM-42 요구 0] 비고 칸 폭을 잴 때 0px 를 먼저 쓰지 않는다', () => {
  const reads = { scroll: 0, offset: 0 };
  const root = fakeRoot();
  const cells = [fakeCell(100, reads), fakeCell(180, reads), fakeCell(40, reads)];
  setNoteWidth(root, cells, readStyle);
  assert.ok(!root.calls.some(([, v]) => v === '0px'), `0px 를 썼다: ${JSON.stringify(root.calls)}`);
  assert.equal(reads.scroll, 0, 'scrollWidth 를 읽지 않는다');
  assert.equal(reads.offset, cells.length, '감싸개의 offsetWidth 를 칸마다 한 번 읽는다');
});

test('[RM-42 요구 1] 폭이 같으면 --noteW 를 다시 쓰지 않는다', () => {
  const reads = { scroll: 0, offset: 0 };
  const root = fakeRoot();
  const cells = [fakeCell(120, reads), fakeCell(200, reads)];
  const first = setNoteWidth(root, cells, readStyle);
  assert.equal(root.calls.length, 1, '처음에는 한 번 쓴다');
  const second = setNoteWidth(root, cells, readStyle);
  assert.equal(root.calls.length, 1, '두 번째 호출에서는 쓰지 않는다');
  assert.equal(second, first, '돌려주는 값은 그대로 그 폭이다');
  assert.equal(second, 200 + 12 + 16);
});

test('[RM-42 요구 2] 폭 규칙 — 하한 60 · 여백 16 · 칸 없으면 null · 줄면 줄어든다', () => {
  const reads = { scroll: 0, offset: 0 };
  // 내용 폭 0 → 하한 60
  let root = fakeRoot();
  assert.equal(setNoteWidth(root, [fakeCell(0, reads)], readStyle), 60);
  assert.deepEqual(root.calls, [['--noteW', '60px']]);
  // 300 → 300 + 왼쪽 안쪽 여백 12 + 16
  root = fakeRoot();
  assert.equal(setNoteWidth(root, [fakeCell(300, reads)], readStyle), 328);
  // 빈 목록 → null, 아무것도 쓰지 않는다
  root = fakeRoot();
  assert.equal(setNoteWidth(root, [], readStyle), null);
  assert.equal(setNoteWidth(root, null, readStyle), null);
  assert.deepEqual(root.calls, []);
  // 넓은 칸을 지우면 폭이 줄어든다(이전 폭이 하한이 되지 않는다)
  root = fakeRoot();
  const wide = fakeCell(400, reads);
  const narrow = fakeCell(90, reads);
  assert.equal(setNoteWidth(root, [wide, narrow], readStyle), 428);
  wide.contentW = 10;
  assert.equal(setNoteWidth(root, [wide, narrow], readStyle), 118);
  assert.equal(root.style.getPropertyValue('--noteW'), '118px');
  // 보드마다 자기 noteRoot 에 쓴다
  const a = fakeRoot();
  const b = fakeRoot();
  setNoteWidth(a, [fakeCell(50, reads)], readStyle);
  setNoteWidth(b, [fakeCell(250, reads)], readStyle);
  assert.equal(a.style.getPropertyValue('--noteW'), '78px');
  assert.equal(b.style.getPropertyValue('--noteW'), '278px');
});

test('[RM-42 요구 3] 안쪽 여백을 더한 폭이 옛 scrollWidth 측정과 같다', () => {
  const reads = { scroll: 0, offset: 0 };
  const widths = [0, 7, 44, 136, 301, 512];
  const cells = widths.map(w => fakeCell(w, reads, 12));
  // 옛 꼴: --noteW 0px 뒤의 scrollWidth = 왼쪽 안쪽 여백 + 내용 폭. 좌우 12px/12px 이어도 오른쪽은 들지 않는다
  const old = Math.max(60, Math.max(...cells.map(c => c.scrollWidth)) + 16);
  let styleReads = 0;
  const root = fakeRoot();
  const got = setNoteWidth(root, cells, () => { styleReads++; return PAD; });
  assert.equal(got, old);
  assert.equal(root.style.getPropertyValue('--noteW'), `${old}px`);
  assert.equal(styleReads, 1, '계산 스타일은 한 번만 읽는다');
  // 소수 px 여백도 더한다(정수로 올린다)
  const r2 = fakeRoot();
  assert.equal(setNoteWidth(r2, [fakeCell(200, reads)], () => ({ paddingLeft: '10.5px', paddingRight: '10.5px' })), 227);
});

test('[RM-42 요구 4] 리사이즈 경로도 같은 측정 함수를 부른다', () => {
  const layout = readFileSync(new URL('../../src/ui/layout.js', import.meta.url), 'utf8');
  const cssVars = readFileSync(new URL('../../src/ui/cssVars.js', import.meta.url), 'utf8');
  const body = layout.slice(layout.indexOf('function applyNoteWidth'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /return setNoteWidth\(noteRoot, boardEl\.querySelectorAll\(SEL\.noteCell\)\);/, 'applyNoteWidth 는 cssVars.setNoteWidth 하나로 잰다');
  assert.doesNotMatch(layout, /--noteW['"]\s*,/, 'layout.js 는 --noteW 를 직접 쓰지 않는다');
  assert.doesNotMatch(cssVars, /setProperty\('--noteW',\s*'0px'\)/, '0px 쓰기가 사라졌다');
  assert.doesNotMatch(cssVars, /scrollWidth\)/, 'scrollWidth 로 재지 않는다');
});
