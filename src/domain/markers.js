// src/domain/markers.js — 영상 구간 ↔ 안무표 구간 마커 (순수)
//
// 신설 파일이다. 원본 index.html 에 대응물이 없다. 마커 하나는 "영상의 [inSec, outSec) 가 안무표의
// [fromCount, toCount) 카운트 구간이다" 라는 매핑이다. 보정점(domain/tempo.js 의 TempoPoint)이
// **점 하나**(카운트 = 초)라면 마커는 **구간 둘**의 짝이고, 이름표(label)를 가진다.
//
// ⚠ 마커는 재생 헤드를 움직이지 않는다. 카운트 ↔ 초 변환은 여전히 tempo 하나가 한다. 마커의 양 끝을
//   보정점으로 반영하는 것은 사용자의 명시적 조작(markerTempoPoints → usecases)이다 — 마커를 찍는 것과
//   박자를 고치는 것은 다른 일이고, 슬쩍 합치면 마커 하나가 세로선을 통째로 옮겨 놓는 놀라운 일이 생긴다.
// ⚠ 시각과 카운트 모두 **바깥에서 안으로** 들어온다. 이 파일은 DOM·시계·난수를 한 글자도 쓰지 않는다.
//   id 도 난수가 아니라 값에서 결정론적으로 만든다(markerIdOf) — 같은 구간을 같은 시각에 두 번 찍으면
//   같은 마커라 갈아 끼워진다.

/**
 * @typedef {Object} Marker
 * @property {string} id        결정론적 식별자(markerIdOf). 파일에서 되읽을 때는 있는 값을 그대로 쓴다
 * @property {number} inSec     영상 구간 시작(초)
 * @property {number} outSec    영상 구간 끝(초, 배타적). inSec 보다 크다
 * @property {number} fromCount 안무표 구간 시작(선형 카운트, 정수)
 * @property {number} toCount   안무표 구간 끝(선형 카운트, 배타적, 정수). fromCount 보다 크다
 * @property {string} label     이름표. 비어 있을 수 있다(뷰가 카운트로 대신 말한다)
 */

/** 유한한 실수인가. NaN·Infinity·문자열·null 을 전부 거른다. */
function finiteOr(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 값에서 결정론적으로 만드는 id. 밀리초 단위까지만 본다 — 같은 구간을 같은 순간에 두 번 찍은 것은 같은 마커다.
 * @param {{inSec:number, fromCount:number, toCount:number}} m
 * @returns {string}
 */
export function markerIdOf(m) {
  return `mk:${Math.round(m.fromCount)}:${Math.round(m.toCount)}:${Math.round(m.inSec * 1000)}`;
}

/**
 * 마커 하나를 정규화한다. 모양이 틀리면 null.
 * 규칙: 네 숫자가 유한해야 하고, 뒤집힌 구간은 바로 세우며, 길이 0 은 버린다. 카운트는 정수로 접는다.
 * @param {unknown} raw
 * @returns {Marker|null}
 */
export function normalizeMarker(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let inSec = finiteOr(raw.inSec, NaN);
  let outSec = finiteOr(raw.outSec, NaN);
  let fromCount = finiteOr(raw.fromCount, NaN);
  let toCount = finiteOr(raw.toCount, NaN);
  if ([inSec, outSec, fromCount, toCount].some(n => !Number.isFinite(n))) return null;
  if (outSec < inSec) [inSec, outSec] = [outSec, inSec];
  fromCount = Math.round(fromCount);
  toCount = Math.round(toCount);
  if (toCount < fromCount) [fromCount, toCount] = [toCount, fromCount];
  if (!(outSec > inSec) || !(toCount > fromCount)) return null;
  const label = raw.label == null ? '' : String(raw.label);
  const m = { id: '', inSec, outSec, fromCount, toCount, label };
  m.id = raw.id == null || String(raw.id) === '' ? markerIdOf(m) : String(raw.id);
  return m;
}

/**
 * 손상된 배열 → 마커 배열. 같은 id 는 뒤의 것이 이기고, 영상 시각(inSec) 오름차순으로 정렬한다.
 * ⚠ 겹치는 구간은 허용한다 — 같은 대목을 두 번 찍은 영상(두 테이크)이 한 안무표 구간에 붙을 수 있다.
 * @param {unknown} raw
 * @returns {Marker[]}
 */
export function normalizeMarkers(raw) {
  if (!Array.isArray(raw)) return [];
  const byId = new Map();
  for (const item of raw) {
    const m = normalizeMarker(item);
    if (m) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.inSec - b.inSec || a.fromCount - b.fromCount);
}

/**
 * 마커를 하나 넣는다(같은 id 는 갈아 끼운다). 모양이 틀리면 **null** — 조용히 버리지 않는다.
 * @param {Marker[]} markers
 * @param {unknown} raw
 * @returns {Marker[]|null}
 */
export function addMarker(markers, raw) {
  const m = normalizeMarker(raw);
  if (!m) return null;
  return normalizeMarkers([...(markers || []).filter(x => x.id !== m.id), m]);
}

/**
 * 그 id 의 마커를 뺀다. 없으면 같은 내용의 새 배열이다.
 * @param {Marker[]} markers
 * @param {string} id
 * @returns {Marker[]}
 */
export function removeMarker(markers, id) {
  return normalizeMarkers((markers || []).filter(m => m.id !== String(id)));
}

/**
 * 영상을 [inSec, outSec) 로 잘라 새 클립으로 만들었을 때 마커가 어디로 가는가.
 * 잘린 구간과 겹치지 않는 마커는 버리고, 걸친 마커는 구간 안으로 잘라 넣은 뒤 시각을 inSec 만큼 당긴다.
 * ⚠ 카운트는 건드리지 않는다 — 안무표는 그대로고 영상의 시간축만 바뀐 것이다. 다만 시각을 잘라 넣었으면
 *   그 마커의 카운트 구간은 이제 영상보다 넓다. 그 어긋남은 마커의 "대략 여기"라는 뜻 안에 있다.
 * ⚠ id 는 새로 만든다(markerIdOf) — 시각이 바뀌었으니 다른 마커다.
 * @param {Marker[]} markers
 * @param {number} inSec
 * @param {number} outSec
 * @returns {Marker[]}
 */
export function shiftMarkersForTrim(markers, inSec, outSec) {
  const a = finiteOr(inSec, NaN);
  const b = finiteOr(outSec, NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return normalizeMarkers(markers);
  const out = [];
  for (const m of markers || []) {
    const s = Math.max(m.inSec, a);
    const e = Math.min(m.outSec, b);
    if (!(e > s)) continue;
    out.push({ inSec: s - a, outSec: e - a, fromCount: m.fromCount, toCount: m.toCount, label: m.label });
  }
  return normalizeMarkers(out);
}

/**
 * 마커의 양 끝을 보정점 두 개로. "이 카운트가 이 시각에 시작하고, 저 카운트가 저 시각에 끝난다".
 * 어디에 넣을지는 호출부(usecases)가 정한다 — bpm 이 없으면 두 점 앵커로, 있으면 보정점으로.
 * @param {Marker} m
 * @returns {[{count:number, sec:number}, {count:number, sec:number}]}
 */
export function markerTempoPoints(m) {
  return [{ count: m.fromCount, sec: m.inSec }, { count: m.toCount, sec: m.outSec }];
}

/**
 * 그 시각에 걸려 있는 마커들(있으면). 뷰가 "지금 어느 마커 안인가"를 말할 때 쓴다.
 * @param {Marker[]} markers
 * @param {number} sec
 * @returns {Marker[]}
 */
export function markersAt(markers, sec) {
  const t = finiteOr(sec, NaN);
  if (!Number.isFinite(t)) return [];
  return (markers || []).filter(m => m.inSec <= t && t < m.outSec);
}
