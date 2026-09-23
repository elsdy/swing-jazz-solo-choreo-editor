// src/domain/captureDrift.js — 받아 적으며 쌓인 「얼마나 어긋났나」를 읽는다 (domain 계층)
//
// 신규 파일이다(2026-09-22). 받아 적기가 경계를 짝수 카운트 격자에 붙이면서(tempo.CAPTURE_GRID_COUNTS)
// **붙이고 남은 거리**가 매번 하나씩 생긴다. 그 거리를 버리지 않고 모으면 두 가지를 알 수 있다.
//
//   · 여러 번 눌러도 치우침이 **일정하다**      → 손의 반응 지연이다. `표 전체 옮기기` 로 고친다.
//   · 누를수록 치우침이 **한쪽으로 커진다**     → 영상의 실제 속도가 정한 BPM 과 다르다.
//
// 둘째 것이 이 파일이 있는 까닭이다. 사용자는 "속도가 바뀐 것을 알아챌 수 있게 표시해 달라"고 했고,
// 그것을 **소리 없이 고치지 않는다** — BPM 을 저절로 바꾸면 이미 놓인 블록이 통째로 어긋난다.
// 여기서는 판정만 하고, 바꿀지 말지는 사람이 `② 박자 맞추기` 에서 정한다.
//
// ⚠ 순수 함수만 둔다. 표본은 인자로 들어오고 새 배열로 나간다(session.video 에 사는 휘발성 값이다).
// ⚠ **문구는 여기 없다.** 판정만 돌려주고 한국어 문장은 ui 가 만든다(ui/bpmBadge · ui/videoPanel).

/**
 * 들고 있는 표본의 최대 개수. 오래된 것부터 버린다.
 * 안무 한 판은 경계가 수십 개라 전부 들고 있으면 **옛날 구간의 어긋남이 지금 판정을 끈다** —
 * 곡이 중간에 빨라졌을 때 알아채는 것이 목적이므로 최근 것만 본다.
 */
export const MAX_DRIFT_SAMPLES = 16;

/** 이보다 적으면 아무 말도 하지 않는다. 두세 개로 기울기를 재면 손 떨림이 그대로 추세가 된다. */
export const MIN_DRIFT_SAMPLES = 4;

/** 평균 치우침이 이만큼(카운트)을 넘으면 "한쪽으로 쏠렸다"고 본다. 반 칸의 절반이 조금 넘는다. */
export const LAG_COUNTS = 0.3;

/** 기울기가 이만큼(비율)을 넘으면 속도가 다르다고 본다. 1.5% 면 130bpm 에서 약 2bpm 이다. */
export const SLOPE_MIN = 0.015;

/** 직선에서 이만큼 넘게 흩어지면 기울기를 믿지 않는다 — 경계 하나가 엉뚱한 칸에 붙은 판이다. */
export const FIT_MAX_COUNTS = 0.35;

/** 표본이 카운트 축에서 이만큼도 안 벌어져 있으면 기울기를 잴 수 없다. */
const MIN_SPREAD_COUNTS = 4;

/**
 * @typedef {object} DriftSample
 * @property {number} at  격자에 붙인 카운트 (표에서의 자리)
 * @property {number} off 잰 값 − 붙인 값 (카운트). 양수면 사람이 늦었다
 */

/**
 * 표본 하나를 더한 **새 배열**을 돌려준다. 읽을 수 없는 값이면 들어온 배열을 그대로 돌려준다
 * (호출부가 참조 비교만으로 "바뀐 것이 없다"를 안다 — stepTodos 와 같은 규약이다).
 * @param {DriftSample[]|undefined} samples
 * @param {{at:number, off:number}} sample
 * @returns {DriftSample[]}
 */
export function noteDriftSample(samples, sample) {
  const list = Array.isArray(samples) ? samples : [];
  const at = Number(sample && sample.at);
  const off = Number(sample && sample.off);
  if (!Number.isFinite(at) || !Number.isFinite(off)) return list;
  const next = list.concat([{ at, off }]);
  return next.length > MAX_DRIFT_SAMPLES ? next.slice(next.length - MAX_DRIFT_SAMPLES) : next;
}

/** 저장 바이트를 쓰지 않는 값이라 지울 때는 그냥 빈 배열이다. */
export function clearDriftSamples() {
  return [];
}

/** 최소제곱 직선의 기울기와 흩어진 정도. 잴 수 없으면 null. */
function fitSlope(samples) {
  const n = samples.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (const s of samples) { sx += s.at; sy += s.off; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (const s of samples) {
    const dx = s.at - mx;
    sxx += dx * dx;
    sxy += dx * (s.off - my);
  }
  const spread = Math.max(...samples.map((s) => s.at)) - Math.min(...samples.map((s) => s.at));
  if (!(sxx > 0) || spread < MIN_SPREAD_COUNTS) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const s of samples) {
    const e = s.off - (slope * s.at + intercept);
    sse += e * e;
  }
  return { slope, fit: Math.sqrt(sse / n) };
}

/**
 * 모은 표본을 한 줄 판정으로 바꾼다.
 *
 * `state` 는 다섯 가지다.
 *  · `idle` — 표본이 모자라다. 화면은 아무 말도 하지 않는다.
 *  · `ok`   — 잘 맞는다.
 *  · `lag`  — 한쪽으로 고르게 치우쳤다(손이 늦거나 빠르다). `표 전체 옮기기` 가 답이다.
 *  · `slow` — 영상이 정한 BPM 보다 **느리다**. 누를수록 잰 카운트가 앞서 나간다.
 *  · `fast` — 영상이 정한 BPM 보다 **빠르다**.
 *
 * `bpmEstimate` 는 "격자가 맞다면 BPM 은 이쯤이다"라는 **추정**이다. 경계가 정말 짝수 카운트에
 * 놓였다는 전제 위에서만 뜻이 있으므로, 흩어진 정도가 크면(FIT_MAX_COUNTS) 내지 않는다.
 *
 * @param {DriftSample[]|undefined} samples
 * @param {number} [bpm] 지금 정해져 있는 BPM. 0·없음이면 추정값을 내지 않는다
 * @returns {{state:'idle'|'ok'|'lag'|'slow'|'fast', samples:number, mean:number,
 *            slope:number|null, fit:number|null, bpmEstimate:number|null}}
 */
export function driftReport(samples, bpm = 0) {
  const list = (Array.isArray(samples) ? samples : []).filter(
    (s) => s && Number.isFinite(s.at) && Number.isFinite(s.off)
  );
  const n = list.length;
  const mean = n ? list.reduce((a, s) => a + s.off, 0) / n : 0;
  const base = { state: /** @type {'idle'} */ ('idle'), samples: n, mean, slope: null, fit: null, bpmEstimate: null };
  if (n < MIN_DRIFT_SAMPLES) return base;

  const line = fitSlope(list);
  const slope = line ? line.slope : null;
  const fit = line ? line.fit : null;
  const trusted = line !== null && line.fit <= FIT_MAX_COUNTS;

  if (trusted && Math.abs(line.slope) >= SLOPE_MIN) {
    const ref = Number(bpm);
    const estimate = Number.isFinite(ref) && ref > 0 && line.slope > -0.9 ? ref / (1 + line.slope) : null;
    // 기울기가 **양수**면 잰 카운트가 격자보다 앞서 나간다 = 영상이 우리 BPM 보다 느리다.
    return { state: line.slope > 0 ? 'slow' : 'fast', samples: n, mean, slope, fit, bpmEstimate: estimate };
  }
  if (Math.abs(mean) >= LAG_COUNTS) return { state: 'lag', samples: n, mean, slope, fit, bpmEstimate: null };
  return { state: 'ok', samples: n, mean, slope, fit, bpmEstimate: null };
}
