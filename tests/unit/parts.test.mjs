// tests/unit/parts.test.mjs — 파트(섹션)의 꼴 · 마디 표시 · 범위 밀기 · 접기 (domain/parts, RM-23)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeParts, serializeParts, isEmptyParts, partMarkOf, boardMarkOf,
  shiftPartsForInsert, shiftPartsForDelete, shiftPartsForDuplicate, clipParts,
  hiddenRows, visibleRows, foldSummary, rowOrderAfterMove, partMoveTarget, splitsPart, remapParts,
  partsAfterRepeat, pruneFolds, PART_COLORS
} from '../../src/domain/parts.js';
import { phraseMark } from '../../src/domain/phrasing.js';

const A = { name: 'A파트', startRow: 1, endRow: 4, color: '#38bdf8' };
const B = { name: '브레이크', startRow: 6, endRow: 6, color: '#f472b6' };

test('parts: 겹치는 파트와 손상된 값은 버리고 빈 틈은 남긴다', () => {
  const raw = [
    B,
    A,
    { name: '겹침', startRow: 3, endRow: 5, color: '#a78bfa' },     // A 와 겹친다 — 먼저 시작한 A 가 남는다
    { name: '거꾸로', startRow: 9, endRow: 8, color: '#a78bfa' },    // 시작 > 끝
    { name: '', startRow: 10, endRow: 10, color: '#a78bfa' },       // 이름 없음
    { name: '   ', startRow: 11, endRow: 11 },                       // 빈칸 이름
    { name: '인트로', startRow: 0, endRow: 1 },                      // intro 행(row 0)은 파트가 아니다
    { name: '소수', startRow: 1.5, endRow: 2 },
    null, 42, '문자열', [],
    { name: '색이 틀림', startRow: 8, endRow: 9, color: 'red' }      // 색만 틀리면 버리지 않고 기본색
  ];
  const parts = normalizeParts(raw);
  assert.deepEqual(parts.map(p => p.name), ['A파트', '브레이크', '색이 틀림']);
  assert.ok(PART_COLORS.includes(parts[2].color), '틀린 색은 기본색으로 떨어진다');
  // 겹침이 없다
  for (let i = 1; i < parts.length; i++) assert.ok(parts[i].startRow > parts[i - 1].endRow);
  // 빈 틈(5 · 7 마디)은 어느 파트도 아니다
  assert.equal(partMarkOf(5, parts), null);
  assert.equal(partMarkOf(7, parts), null);
  // 범위 밖 — 안무표가 6마디면 8마디에서 시작하는 파트는 버리고, 넘치는 끝은 자른다
  assert.deepEqual(normalizeParts([A, { ...B, endRow: 9 }, { name: 'C', startRow: 8, endRow: 9 }], { rows: 6 }).map(p => [p.name, p.startRow, p.endRow]),
    [['A파트', 1, 4], ['브레이크', 6, 6]]);
  // 손상된 목록 전체
  for (const bad of [null, undefined, 42, '문자열', {}]) assert.deepEqual(normalizeParts(bad), []);
  // 비었으면 파일에 쓰지 않는다
  assert.equal(isEmptyParts([]), true);
  assert.equal(serializeParts([]), null);
  assert.equal(serializeParts([{ name: '', startRow: 1, endRow: 1 }]), null);
  assert.deepEqual(Object.keys(serializeParts([A])[0]), ['name', 'startRow', 'endRow', 'color'], '키 순서 = 저장 바이트');
});

test('parts: partMarkOf 는 마디마다 파트 이름·색·첫 마디 여부를 낸다', () => {
  const parts = normalizeParts([A, B]);
  const first = partMarkOf(1, parts);
  assert.equal(first.name, 'A파트');
  assert.equal(first.color, '#38bdf8');
  assert.equal(first.isStart, true);
  for (const row of [2, 3, 4]) {
    const m = partMarkOf(row, parts);
    assert.equal(m.name, 'A파트');
    assert.equal(m.isStart, false, `${row}마디는 첫 마디가 아니다`);
    assert.equal(m.rowInPart, row);
  }
  assert.equal(partMarkOf(4, parts).isEnd, true);
  const solo = partMarkOf(6, parts);
  assert.equal(solo.isStart && solo.isEnd, true, '한 마디짜리 파트는 첫 마디이자 끝 마디다');
  assert.equal(partMarkOf(0, parts), null, 'intro 행은 파트가 아니다');
  assert.equal(partMarkOf(5, parts), null, '파트 밖 마디');
  assert.equal(partMarkOf(99, parts), null);
  assert.equal(partMarkOf(1, null), null);
});

test('parts: 접힌 파트는 첫 행 하나로 줄고 요약에 마디 수와 첫 동작이 담긴다', () => {
  const parts = normalizeParts([A, B]);
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(visibleRows(all, parts, new Set()), all, '아무것도 안 접었으면 그대로');
  assert.deepEqual(visibleRows(all, parts, new Set([1])), [0, 1, 5, 6, 7], 'A파트가 첫 마디 한 줄로 준다');
  assert.deepEqual([...hiddenRows(parts, [1, 6])].sort(), [2, 3, 4], '한 마디짜리 파트는 접어도 감출 행이 없다');
  assert.deepEqual(visibleRows(all, parts, [42]), all, '없는 파트의 열쇠는 무시한다');

  const placements = [
    { row: 3, startIndex: 0, subRow: 0, name: '뒤의 것' },
    { row: 2, startIndex: 4, subRow: 1, name: '위 층' },
    { row: 2, startIndex: 4, subRow: 0, name: 'Swing Out' },
    { row: 5, startIndex: 0, subRow: 0, name: '파트 밖' }
  ];
  assert.equal(foldSummary(parts[0], placements), 'A파트 · 4마디 · Swing Out');
  assert.equal(foldSummary(parts[1], placements), '브레이크 · 1마디 · 빈 파트');
  assert.equal(foldSummary(parts[0], [{ row: 1, startIndex: 0, name: '' }], { untitled: '이름 없음' }), 'A파트 · 4마디 · 이름 없음');

  // 접힘 집합은 지금 있는 파트에 맞춘다 — 같으면 같은 집합
  const folds = new Set([1]);
  assert.equal(pruneFolds(folds, parts), folds);
  assert.deepEqual([...pruneFolds(new Set([1, 3]), parts)], [1]);
});

test('parts: 마디를 넣고 지우면 파트 범위가 밀리고 줄어든다', () => {
  const parts = normalizeParts([{ ...A, startRow: 2, endRow: 4 }, B]);   // A 2~4 · 브레이크 6
  const span = list => list.map(p => [p.startRow, p.endRow]);
  // 넣기 — 파트 안(시작 다음 ~ 끝)이면 파트가 는다
  assert.deepEqual(span(shiftPartsForInsert(parts, 3)), [[2, 5], [7, 7]]);
  assert.deepEqual(span(shiftPartsForInsert(parts, 4)), [[2, 5], [7, 7]], '끝 마디 위에 넣어도 안이다');
  // 넣기 — 파트 시작 위 · 앞이면 통째로 밀린다
  assert.deepEqual(span(shiftPartsForInsert(parts, 2)), [[3, 5], [7, 7]]);
  assert.deepEqual(span(shiftPartsForInsert(parts, 1)), [[3, 5], [7, 7]]);
  // 넣기 — 파트 뒤면 그대로
  assert.deepEqual(span(shiftPartsForInsert(parts, 5)), [[2, 4], [7, 7]]);
  // 지우기 — 경계 마디를 지우면 준다
  assert.deepEqual(span(shiftPartsForDelete(parts, 2)), [[2, 3], [5, 5]], '첫 마디를 지우면 다음 마디가 첫 마디가 된다');
  assert.deepEqual(span(shiftPartsForDelete(parts, 4)), [[2, 3], [5, 5]]);
  assert.deepEqual(span(shiftPartsForDelete(parts, 1)), [[1, 3], [5, 5]], '앞 마디를 지우면 당겨진다');
  // 지우기 — 다 지우면 파트도 사라진다
  assert.deepEqual(span(shiftPartsForDelete(parts, 6)), [[2, 4]]);
  let left = parts;
  for (let i = 0; i < 3; i++) left = shiftPartsForDelete(left, 2);
  assert.deepEqual(left.map(p => p.name), ['브레이크'], 'A파트의 마디를 모두 지우면 A파트가 사라진다');
  // 복제 — 복사된 마디는 원래 마디의 파트에 든다
  assert.deepEqual(span(shiftPartsForDuplicate(parts, 4)), [[2, 5], [7, 7]]);
  assert.deepEqual(span(shiftPartsForDuplicate(parts, 5)), [[2, 4], [7, 7]]);
  // 마디 수를 줄이면 잘린다
  assert.deepEqual(span(clipParts(parts, 3)), [[2, 3]]);
  // 입력을 바꾸지 않는다
  assert.deepEqual(span(parts), [[2, 4], [6, 6]]);
});

test('parts: 파트가 있는 마디는 파트 표시가 프레이즈 표시를 이긴다', () => {
  const parts = normalizeParts([{ ...A, startRow: 2, endRow: 3 }]);
  const phrasing = { on: true, rowsPerPhrase: 2, phrasesPerChorus: 2, startRow: 1 };
  const markOf = row => phraseMark(row, phrasing);
  const inside = boardMarkOf(2, parts, markOf);
  assert.equal(inside.part.color, '#38bdf8', '파트 안 마디는 파트 색');
  assert.equal(inside.phrase, null, '파트 안 마디에는 프레이즈 표시가 없다');
  for (const row of [0, 1, 4, 5]) {
    const outside = boardMarkOf(row, parts, markOf);
    assert.equal(outside.part, null);
    assert.deepEqual(outside.phrase, phraseMark(row, phrasing), `${row}마디는 프레이즈 표시가 그대로`);
  }
  // 파트가 없는 곡은 프레이즈 색칠이 그대로 돈다
  assert.deepEqual(boardMarkOf(2, [], markOf).phrase, phraseMark(2, phrasing));
});

test('parts: 통째로 옮기는 자리 · 새 차례 · 한 번 더의 파트 목록', () => {
  const parts = normalizeParts([{ ...A, startRow: 1, endRow: 2 }, { ...B, startRow: 3, endRow: 4 }]);   // A 1~2 · 브레이크 3~4 · 5~6 빈 마디
  // 아래로 — 다음 파트 통째 뒤(옛 번호 5 앞)
  assert.equal(partMoveTarget(parts, parts[0], 1, 6), 5);
  // 위로 — 앞 파트 통째 앞
  assert.equal(partMoveTarget(parts, parts[1], -1, 6), 1);
  assert.equal(partMoveTarget(parts, parts[0], -1, 6), null, '맨 위');
  assert.equal(partMoveTarget(parts, { ...B, startRow: 5, endRow: 6 }, 1, 6), null, '맨 아래');
  assert.equal(splitsPart(parts, 2), true, '파트 한가운데');
  assert.equal(splitsPart(parts, 3), false, '파트 경계');

  const map = rowOrderAfterMove(6, 1, 2, 5);   // A(1~2) 를 5 앞으로 — [3,4,1,2,5,6]
  assert.deepEqual([...map].sort((a, b) => a[0] - b[0]), [[1, 3], [2, 4], [3, 1], [4, 2], [5, 5], [6, 6]]);
  assert.deepEqual(remapParts(parts, map).map(p => [p.name, p.startRow, p.endRow]), [['브레이크', 1, 2], ['A파트', 3, 4]]);
  assert.equal(rowOrderAfterMove(6, 1, 2, 2), null, '제자리');
  assert.equal(rowOrderAfterMove(6, 1, 2, 3), null, '제자리(바로 뒤)');
  assert.deepEqual([...rowOrderAfterMove(4, 1, 1, 5)].sort((a, b) => a[0] - b[0]), [[1, 4], [2, 1], [3, 2], [4, 3]], '맨 끝으로');

  const { parts: after, copy } = partsAfterRepeat(parts, parts[0]);
  assert.deepEqual(copy, { ...parts[0], startRow: 3, endRow: 4 });
  assert.deepEqual(after.map(p => [p.name, p.startRow, p.endRow]), [['A파트', 1, 2], ['A파트', 3, 4], ['브레이크', 5, 6]]);
});
