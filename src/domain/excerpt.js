// src/domain/excerpt.js — 안무표에서 고른 대목을 영상 구간으로 바꾸는 규칙 (순수 함수, RM-31 · 2026-10-01)
//
// 영상 쪽 자르기(In/Out)의 반대 방향이다. 사람은 「이 여섯 마디」를 고르고, 초 구간은 박자로 계산한다.
// 계산의 재료는 이미 있다 — 카운트 구간(domain/practice)과 카운트 ↔ 초(domain/tempo). 여기서 더하는 것은
// 셋뿐이다: 앞 여유 카운트, 영상 밖으로 나간 구간 잘라 맞추기, 새 클립의 이름.
// DOM·시계·난수를 한 글자도 쓰지 않는다.

import { countToTime, isTempoUsable } from './tempo.js';
import { countRangeLabel, normalizeCountRange } from './practice.js';

/**
 * 고른 대목 앞에 붙이는 여유(카운트). 첫 동작의 준비 움직임과 음악이 들어가는 자리가 보이게 한다.
 * 영상 첫 프레임이 이미 동작 중간이면 보내 받은 사람이 어디서 시작하는지 모른다.
 */
export const EXCERPT_LEAD_COUNTS = 2;

/** 이보다 짧은 구간은 자르지 않는다. server.py 의 자르기 API 가 받는 최소 길이와 같은 값이다. */
export const MIN_EXCERPT_SEC = 0.1;

/** 영상 길이를 이만큼 넘는 것은 「끝에서 잘렸다」고 말하지 않는다 — 마지막 프레임 반올림 차이다. */
const END_SLACK_SEC = 0.05;

/** 클립 이름에 늘어놓는 블록 이름의 수. 그보다 많으면 `…` 로 접는다. */
const LABEL_NAMES = 3;

/**
 * @typedef {Object} ExcerptSpan
 * @property {true} ok
 * @property {number} startSec 자를 시작(초, 0 이상) — 앞 여유를 포함한다
 * @property {number} endSec   자를 끝(초, 배타) — 영상 길이를 넘지 않는다
 * @property {number} leadSec  실제로 붙은 앞 여유(초). 영상 0초에 걸려 여유가 줄면 그만큼 작다
 * @property {boolean} clippedStart 고른 대목 **자체가** 영상 0초보다 앞에서 시작해 앞이 잘렸다
 * @property {boolean} clippedEnd   고른 대목이 영상 끝을 넘어 뒤가 잘렸다
 */

/**
 * 카운트 구간 → 영상에서 자를 초 구간.
 *
 * ⚠ 여유는 **카운트로** 앞당긴다(초를 빼지 않는다). 보정점이 여럿인 가변 템포에서는 그 자리의 한 카운트가
 *   몇 초인지가 구간마다 다르다 — countToTime 이 그 구간의 기울기를 쓴다.
 * ⚠ 박자 앞(intro)이나 영상 밖으로 나간 구간은 **잘라 맞추고 알린다**(clippedStart · clippedEnd). 서버는 0초 이상,
 *   0.1초 이상 길이만 받으므로 앱이 먼저 맞춘다. 잘라 맞춘 뒤에도 남는 것이 없으면 'outside' 다.
 * ⚠ 영상 길이를 모르면(null) 끝은 맞추지 않는다 — 서버(ffmpeg)가 끝을 넘긴 만큼은 그냥 짧게 만든다.
 *
 * @param {{fromCount:number, toCount:number}|null} range
 * @param {import('./tempo.js').Tempo} tempo
 * @param {{leadCounts?: number, durationSec?: number|null}} [opts]
 * @returns {ExcerptSpan|{ok:false, reason:'no-range'|'no-tempo'|'outside'}}
 */
export function excerptSpan(range, tempo, opts = {}) {
  const r = normalizeCountRange(range);
  if (!r) return { ok: false, reason: 'no-range' };
  if (!isTempoUsable(tempo)) return { ok: false, reason: 'no-tempo' };
  // 개발 원칙 D-5 — 여유 0 은 유효한 값이다. `|| 기본값` 으로 쓰지 않는다.
  const leadRaw = Number(opts.leadCounts);
  const lead = opts.leadCounts == null || !Number.isFinite(leadRaw) ? EXCERPT_LEAD_COUNTS : Math.max(0, leadRaw);
  const dur = Number(opts.durationSec);
  const hasDur = opts.durationSec != null && Number.isFinite(dur) && dur > 0;

  const bodyStart = countToTime(r.fromCount, tempo);
  const leadStart = countToTime(r.fromCount - lead, tempo);
  const rawEnd = countToTime(r.toCount, tempo);

  const startSec = Math.max(0, leadStart);
  const endSec = hasDur ? Math.min(rawEnd, dur) : rawEnd;
  if (!(endSec - startSec >= MIN_EXCERPT_SEC)) return { ok: false, reason: 'outside' };
  return {
    ok: true,
    startSec,
    endSec,
    leadSec: Math.max(0, Math.min(bodyStart, endSec) - startSec),
    clippedStart: bodyStart < 0,
    clippedEnd: hasDur && rawEnd > dur + END_SLACK_SEC
  };
}

/**
 * 잘라 낸 클립의 이름 — 초가 아니라 **안무표의 말**로 짓는다(`8x5 ~ 8x8 Shim Sham`).
 * 영상 목록과 보관 폴더의 파일 이름에 함께 쓰인다. 파일 이름에 못 쓰는 글자는 서버가 거른다.
 * @param {{fromCount:number, toCount:number}|null} range
 * @param {number} cols
 * @param {readonly string[]} [names] 고른 블록 이름들(앞에서부터)
 * @returns {string} 구간이 틀리면 빈 문자열
 */
export function excerptLabel(range, cols, names = []) {
  const where = countRangeLabel(range, cols);
  if (!where) return '';
  const uniq = [];
  for (const n of Array.isArray(names) ? names : []) {
    const s = String(n == null ? '' : n).trim();
    if (s && !uniq.includes(s)) uniq.push(s);
  }
  if (!uniq.length) return where;
  const shown = uniq.slice(0, LABEL_NAMES).join(' · ');
  return `${where} ${shown}${uniq.length > LABEL_NAMES ? ' …' : ''}`;
}
