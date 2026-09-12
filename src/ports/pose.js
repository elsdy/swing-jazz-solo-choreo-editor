// src/ports/pose.js — 자세 추정기(PoseEstimator)의 계약. import 0개.
//
// 신설 파일이다(2026-09-10). 영상에서 사람의 관절점을 뽑아 주는 바깥세상과의 경계다.
// ports/media.js 가 "재생기가 무엇이든 MediaPlayer 하나로 본다" 였다면, 여기는
// "자세 모델이 무엇이든 PoseFrame 하나로 본다" 이다.
//
// ⚠ 경계 ① — **모델의 인덱스를 이 경계 밖으로 내보내지 않는다.** MediaPipe 는 33개 점을 인덱스로 주고
//   COCO 계열은 17개다. 어댑터가 자기 모델의 인덱스를 `leftElbow` 같은 **이름**으로 옮겨서 넣는다.
//   그래야 모델을 갈아 끼워도 domain/pose.js 의 각도 계산이 한 줄도 안 바뀐다.
//
// ⚠ 경계 ②-a — **정규 좌표는 각도를 일그러뜨린다.** `points` 는 가로를 폭으로, 세로를 높이로 나눈 값이라
//   480x640 영상에서는 가로가 0.75배로 눌린 공간이다. 그 좌표로 잰 각은 실제 각과 다르다(2026-09-11 에
//   합성 영상으로 확인: 넣은 110.0° 가 93.9° 로 나왔다). 그래서 프레임마다 `aspect`(폭/높이)를 함께 실어
//   보내고, 각도를 잴 때 domain/pose.js 가 그만큼 되돌린다. world 좌표에는 해당하지 않는다(이미 미터다).
//
// ⚠ 경계 ② — **좌표계가 둘이다.** `points` 는 화면 기준 정규 좌표(0..1)라 오버레이와 클릭 판정에 쓰고,
//   `world` 는 엉덩이 중점을 원점으로 하는 미터 좌표라 **각도 계산에 쓴다**. world 가 없는 모델(2D 전용)도
//   있으므로 null 이 정상이고, 그때 각도는 화면 평면에 투영된 값이라 카메라 각도에 흔들린다 —
//   그 사실은 `space` 로 결과에 따라다녀야 한다(숨기면 거짓말이 된다).
//
// ⚠ 경계 ③ — **분석은 배치 작업이다.** 프레임 하나씩 요청하는 API 로 두지 않는다. 영상을 시각으로 탐색하고
//   디코드된 프레임을 꺼내는 일은 전부 DOM 이라 어댑터의 몫이고, 유스케이스는 "이 구간을 이 간격으로 재
//   달라" 한 번만 말한다. 진행률은 콜백으로 나온다 — 수십 초가 걸리는 일이라 진행 표시가 없으면 멈춘 것처럼 보인다.
//
// ⚠ 경계 ④ — **던지지 않는다.** 모델을 못 받는 것(오프라인·용량)은 예외가 아니라 상태다.
//   `load()` 와 `analyze()` 는 언제나 resolve 하고 실패를 값으로 돌려준다. 한국어 문구는 뷰가 만든다.

/** @typedef {'idle'|'loading'|'ready'|'error'} PoseLoadState */

/**
 * 관절점 하나. 좌표의 뜻은 어느 자리에 들어 있느냐로 갈린다(경계 ②).
 * @typedef {Object} PosePoint
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} score 0..1. 이 점이 실제로 보였는가(가려짐·화면 밖이면 낮다)
 */

/**
 * 한 프레임에 잡힌 사람 하나.
 * @typedef {Object} PoseSubject
 * @property {Record<string, PosePoint|null>} points 화면 정규 좌표(0..1). 오버레이·클릭 판정용
 * @property {Record<string, PosePoint|null>|null} world 미터 좌표(엉덩이 중점 원점). 각도 계산용. 없으면 null
 * @property {number} score 이 사람 검출의 신뢰도 0..1
 * @property {number} aspect 이 좌표를 뜬 그림의 폭/높이. `points` 로 각을 잴 때 가로 눌림을 되돌린다.
 *   모르면 1(정사각형으로 친다 — 옛 동작 그대로다)
 */

/**
 * 한 시각의 결과.
 * ⚠ `subjects` 의 **순서에는 아무 뜻이 없다.** 모델은 프레임마다 사람을 다시 찾을 뿐 같은 사람에게 같은
 *   번호를 주지 않는다(MediaPipe 도 그렇다). "누가 누구인가" 는 domain/poseTracks.js 가 따로 잇는다.
 * @typedef {Object} PoseFrame
 * @property {number} sec 이 프레임의 영상 시각(초)
 * @property {PoseSubject[]} subjects
 */

/**
 * @typedef {Object} PoseRequest
 * @property {number} fromSec 분석 시작(초)
 * @property {number} toSec   분석 끝(초, 배타적)
 * @property {number} fps     초당 몇 장을 볼 것인가. 가동 범위에는 10~15 면 충분하고 빠른 동작은 30 이 필요하다
 * @property {number} maxSubjects 한 프레임에서 찾을 사람 수 상한. 1 이면 모델이 한 명만 찾는다(가장 빠르다)
 * @property {(done: number, total: number) => void} [onProgress] 프레임을 하나 끝낼 때마다
 * @property {() => boolean} [isCancelled] 참을 돌려주면 중간에 멈추고 그때까지의 프레임을 돌려준다
 */

/**
 * @typedef {Object} PoseResult
 * @property {boolean} ok
 * @property {PoseFrame[]} frames 취소됐으면 그때까지의 것. 실패해도 빈 배열이지 null 이 아니다
 * @property {'world'|'screen'} space 각도를 어느 좌표계에서 재야 하는가
 * @property {string} error 실패 이유(빈 문자열이면 성공). 사용자에게 보일 문구는 뷰가 만든다
 */

/**
 * @typedef {Object} PoseEstimator
 * @property {string} id 'mediapipe/full' 처럼 **모델까지 구분되는** 값.
 *   ★ 결과에 함께 저장한다 — 모델이 바뀌면 같은 영상에서도 각도가 몇 도씩 달라지므로,
 *     다른 id 로 잰 두 기록을 나란히 놓고 "좋아졌다" 고 말하면 안 된다
 * @property {() => {name:string, model:string, space:'world'|'screen', maxSubjects:number}} describe
 * @property {() => {load: PoseLoadState, error: string}} getState
 * @property {() => Promise<{ok:boolean, error:string}>} load 모델·런타임을 받아 온다. **던지지 않는다**
 * @property {(source: unknown, request: PoseRequest) => Promise<PoseResult>} analyze
 *   source 는 어댑터가 아는 것(<video> 엘리먼트)이다. 포트는 그것이 무엇인지 모른다
 * @property {() => void} destroy 멱등
 */

/** PoseEstimator 가 반드시 가져야 하는 멤버 전부. assertPoseEstimator 의 유일한 판정 근거다. */
export const POSE_ESTIMATOR_MEMBERS = Object.freeze([
  'id', 'describe', 'getState', 'load', 'analyze', 'destroy'
]);

/**
 * 낯선 구현이 계약을 지키는지 확인한다. `id` 는 값이면 되고 나머지는 함수여야 한다.
 * @param {any} estimator
 * @param {string} [label='PoseEstimator']
 * @returns {any} 통과하면 받은 것을 그대로 돌려준다(체이닝용)
 * @throws {TypeError} 빠진 멤버 이름을 전부 나열한다
 */
export function assertPoseEstimator(estimator, label = 'PoseEstimator') {
  const missing = POSE_ESTIMATOR_MEMBERS.filter(k =>
    k === 'id' ? estimator?.[k] == null : typeof estimator?.[k] !== 'function');
  if (missing.length) throw new TypeError(`${label} 계약 위반: ${missing.join(', ')}`);
  return estimator;
}

/** assertPoseEstimator 의 불리언판. */
export function isPoseEstimator(estimator) {
  try { assertPoseEstimator(estimator); return true; } catch { return false; }
}

/** 유한한 실수만 통과시킨다. */
function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 0..1 로 가둔다. score 는 모델마다 범위가 제각각이라 여기서 한 번 접는다. */
function unit(value) {
  const n = num(value, 0);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 점 하나를 정규화한다. 좌표 셋 중 하나라도 유한하지 않으면 **null**(= 이 점은 없다)이다.
 * ⚠ 0 으로 채우지 않는다. 없는 점을 원점에 놓으면 각도가 그럴듯한 거짓값으로 나온다.
 * @param {unknown} raw
 * @returns {PosePoint|null}
 */
export function normalizePosePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = num(raw.x, NaN);
  const y = num(raw.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // z 는 2D 모델에 아예 없다 — 그때는 0 으로 둔다(같은 평면에 있다는 뜻이라 각도가 2D 로 떨어진다).
  const z = num(raw.z, 0);
  // visibility(MediaPipe) 와 score 를 둘 다 받아 준다. 둘 다 없으면 1(= 모델이 말 안 함)이다.
  const raw_score = raw.score !== undefined ? raw.score : (raw.visibility !== undefined ? raw.visibility : 1);
  return { x, y, z, score: unit(raw_score) };
}

/**
 * 이름 → 점 사전을 정규화한다. 모르는 이름도 그대로 통과시킨다 — 어떤 이름을 쓸지는 domain 의 몫이다.
 * @param {unknown} raw
 * @returns {Record<string, PosePoint|null>}
 */
export function normalizePosePoints(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) out[key] = normalizePosePoint(raw[key]);
  return out;
}

/**
 * 프레임 하나를 정규화한다. 어댑터가 준 쓰레기를 여기서 전부 흡수한다.
 * ⚠ 점이 하나도 없는 사람은 버린다 — 빈 껍데기가 목록에 있으면 인물 지정이 그것을 고를 수 있다.
 * @param {unknown} raw
 * @returns {PoseFrame|null} sec 이 유한하지 않으면 null
 */
export function normalizePoseFrame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sec = num(raw.sec, NaN);
  if (!Number.isFinite(sec)) return null;
  const list = Array.isArray(raw.subjects) ? raw.subjects : [];
  const subjects = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const points = normalizePosePoints(s.points);
    if (!Object.values(points).some(p => p !== null)) continue;
    const world = s.world == null ? null : normalizePosePoints(s.world);
    // 0 이나 음수는 나눗셈을 깨뜨린다 — 모르는 값으로 친다.
    const aspect = num(s.aspect, NaN);
    subjects.push({
      points, world,
      score: unit(s.score !== undefined ? s.score : 1),
      aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1
    });
  }
  return { sec, subjects };
}

/**
 * 프레임 배열을 정규화하고 **시각 오름차순으로** 세운다. 같은 시각이 둘이면 뒤의 것이 이긴다.
 * 뒤에 오는 모든 계산(구간 자르기, 사람 잇기)이 이 순서를 전제한다.
 * @param {unknown} raw
 * @returns {PoseFrame[]}
 */
export function normalizePoseFrames(raw) {
  if (!Array.isArray(raw)) return [];
  const bySec = new Map();
  for (const item of raw) {
    const f = normalizePoseFrame(item);
    if (f) bySec.set(f.sec, f);
  }
  return [...bySec.values()].sort((a, b) => a.sec - b.sec);
}
