// tests/unit/hangulJoin.test.mjs — 흩어진 한글 자모를 2벌식으로 다시 묶기 (domain/hangul.joinJamo, RM-50)
//
// 블록을 고른 채 한글을 바로 치면 실제 입력기가 첫 글쇠들을 조합 없이 맺어 「ㅅㅡ윙」처럼 흩어 넣는다(RM-50 · RM-51 이 쟀다).
// 그 줄을 입력기가 했을 묶음으로 되돌리는 순수 함수를 본다. 첫 시험 이름은 계획서 「요구 ↔ 시험」 표 2 와 같다.
// ⚠ 이 시험은 묶는 규칙만 잰다 — 실제 입력기가 낱자를 흩는 길은 만든 글쇠 이벤트로 흉내 낼 수 없어 실기로 잰다(BUG_REPORTS).

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinJamo } from '../../src/domain/hangul.js';

test('[RM-50 요구 1] 흩어진 자모를 2벌식으로 다시 조합한다', () => {
  // 실제 macOS 2벌식에서 잰 세 경우(RM-15 마무리 · RM-51)
  assert.equal(joinJamo('ㅅㅡ윙'), '스윙');
  assert.equal(joinJamo('ㅊㅏㄹ스턴'), '찰스턴');
  assert.equal(joinJamo('ㅎㅏㄴ'), '한');
  // 모두 낱자로 흩어진 경우도 같은 이름이 된다
  assert.equal(joinJamo('ㅅㅡㅇㅜㅣㅇ'), '스윙', '겹모음 ㅜ+ㅣ=ㅟ');
  assert.equal(joinJamo('ㅊㅏㄹㅅㅡㅌㅓㄴ'), '찰스턴', '받침 ㄹ 뒤 자음은 새 글자');
  // 겹모음 · 겹받침 · 받침 넘기기
  assert.equal(joinJamo('ㅗㅏ'), 'ㅘ', '초성 없는 겹모음');
  assert.equal(joinJamo('ㄱㅗㅏ'), '과');
  assert.equal(joinJamo('ㅇㅡㅣ'), '의');
  assert.equal(joinJamo('ㄷㅏㄹㄱ'), '닭', '겹받침 ㄹ+ㄱ=ㄺ');
  assert.equal(joinJamo('ㄷㅏㄹㄱㅏ'), '달가', '모음이 오면 겹받침의 뒤 낱자만 넘어간다');
  assert.equal(joinJamo('ㅎㅏㄴㅏ'), '하나', '모음이 오면 받침이 다음 글자의 초성으로 넘어간다');
  assert.equal(joinJamo('한ㅏ'), '하나', '맺힌 음절 뒤 낱자도 2벌식대로 묶인다');
  assert.equal(joinJamo('스ㅇ'), '승', '맺힌 음절 뒤 자음은 받침이 된다');
  assert.equal(joinJamo('ㄸㅏㄸ'), '따ㄸ', 'ㄸ 은 받침이 못 된다');
  // 한글이 아닌 글자는 경계 — 그대로 두고 앞뒤를 끊는다
  assert.equal(joinJamo('Shim Sham'), 'Shim Sham');
  assert.equal(joinJamo('abcㅎㅏㄴdef'), 'abc한def');
  assert.equal(joinJamo('ㅎㅏ ㄴㅏ'), '하 나', '빈칸을 건너 묶지 않는다');
  assert.equal(joinJamo('ㄳㅏ'), 'ㄳㅏ', '2벌식으로 칠 수 없는 겹자음 낱자는 경계다');
  // 이미 맺힌 음절만 있는 글은 한 글자도 바뀌지 않는다
  for (const s of ['스윙', '찰스턴', '한', '닭가슴살', '각사', '과일', '앉아', '뷁', '스윙 Out 8', '']) assert.equal(joinJamo(s), s, s);
  // 일부러 낱자를 친 이름 — 초성 + 중성 짝이 아니면 묶지 않는다
  for (const s of ['ㅋㅋ', 'ㄱㅅ', 'ㅠㅠ', 'ㅇㅋ', 'ㅏㅏ']) assert.equal(joinJamo(s), s, s);
  assert.equal(joinJamo(null), '', 'null 은 빈 글');
});
