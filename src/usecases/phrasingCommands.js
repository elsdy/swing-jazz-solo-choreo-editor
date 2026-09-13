// src/usecases/phrasingCommands.js — 프레이즈·코러스 구조를 바꾼다 (usecases 계층)
//
// 신설 파일이다(2026-09-13). 상태는 `state.phrasing` 하나이고 UNDO_FIELDS·DOC_FIELDS 안이다 —
// 곡 구조는 안무의 일부라 Undo 로 되돌아오고 파일에 실린다(domain/project/schema.js 주석).
//
// ⚠ 돌려주는 Dirty 는 `{phrasing:true}` **하나뿐이다.** 배치는 한 글자도 바뀌지 않으므로
//   `boards` 를 함께 세우면 행을 통째로 다시 그려 놓고 결과가 같은 낭비가 된다
//   (ui/boardView.syncPhrasing 은 dataset 과 CSS 변수만 건드린다 — selection 과 같은 결이다).
// ⚠ 히스토리 커밋은 여기서 하지 않는다. 이 파일의 공통 규약대로 호출부(ui/phrasingView)가
//   확정 시점에 한 번 커밋한다 — 숫자를 한 칸씩 올리는 동안 단계가 쌓이면 Undo 가 못 쓰게 된다.

import { NONE } from './store.js';
import { normalizePhrasing, PHRASING_FIELDS, PHRASING_PRESETS } from '../domain/phrasing.js';

/** 이 커맨드들이 돌려주는 유일한 Dirty. */
const PHRASING = Object.freeze({ phrasing: true });

/**
 * 지금의 구조. **언제나 네 필드를 채워** 돌려준다(뷰가 기본값을 손으로 적지 않게).
 * @param {object} store
 * @returns {import('../domain/phrasing.js').Phrasing}
 */
export function phrasingState(store) {
  return normalizePhrasing(store.get().phrasing);
}

/**
 * 일부 필드만 바꾼다. 손상된 값은 normalizePhrasing 이 범위 안으로 가둔다.
 * @param {object} store
 * @param {Partial<import('../domain/phrasing.js').Phrasing>} [patch]
 * @returns {import('./store.js').Dirty}
 */
export function setPhrasing(store, patch = {}) {
  const cur = phrasingState(store);
  const next = normalizePhrasing({ ...cur, ...patch });
  if (PHRASING_FIELDS.every(key => next[key] === cur[key])) return NONE;
  store.update({ phrasing: next });
  return PHRASING;
}

/**
 * 표시를 켜고 끈다. 숫자는 건드리지 않는다 — 껐다 켜는 사이에 맞춰 둔 구조가 날아가면 안 된다.
 * @param {object} store
 * @param {{on?: boolean}} [args] on 을 주면 그 값으로, 없으면 반전
 * @returns {import('./store.js').Dirty}
 */
export function togglePhrasing(store, args = {}) {
  const cur = phrasingState(store);
  return setPhrasing(store, { on: typeof args.on === 'boolean' ? args.on : !cur.on });
}

/**
 * 흔한 곡 구조 하나를 적용한다. **함께 켠다** — 프리셋을 고르는 것은 "이렇게 보여 달라"는 뜻이다.
 * ⚠ 시작 마디(startRow)는 건드리지 않는다. 인트로 길이는 곡 구조가 아니라 그 사람의 안무다.
 * @param {object} store
 * @param {string} presetId domain/phrasing.PHRASING_PRESETS 의 id
 * @returns {import('./store.js').Dirty}
 */
export function applyPhrasingPreset(store, presetId) {
  const preset = PHRASING_PRESETS.find(p => p.id === presetId);
  if (!preset) return NONE;
  return setPhrasing(store, {
    on: true,
    rowsPerPhrase: preset.rowsPerPhrase,
    phrasesPerChorus: preset.phrasesPerChorus
  });
}

/**
 * 지금 설정과 정확히 같은 프리셋의 id. 없으면 `''`(직접 입력한 값이라는 뜻).
 * @param {object} store
 * @returns {string}
 */
export function matchedPresetId(store) {
  const cur = phrasingState(store);
  const hit = PHRASING_PRESETS.find(p =>
    p.rowsPerPhrase === cur.rowsPerPhrase && p.phrasesPerChorus === cur.phrasesPerChorus);
  return hit ? hit.id : '';
}
