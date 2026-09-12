// src/domain/pose.js — 관절점 → 관절 각도 (순수 함수, import 0개)
//
// 신설 파일이다(2026-09-10). 자세 추정 모델이 준 점들에서 "팔꿈치가 몇 도인가" 를 낸다.
// 모델이 무엇이든(MediaPipe 33점, COCO 17점) 이 파일은 **이름으로만** 점을 찾으므로 한 줄도 안 바뀐다.
// 인덱스 → 이름 변환은 어댑터의 몫이다(ports/pose.js 경계 ①).
//
// ⚠ 각도의 뜻을 여기서 한 번만 정한다: **관절 안쪽 각(0~180°), 180° 가 곧게 편 상태**다.
//   임상에서 흔히 쓰는 "굴곡 각"(무릎 굴곡 30° = 여기서는 150°)과 뒤집힌 값이므로 화면 문구도 이 규약을 따른다.
//   두 규약을 함께 쓰면 "가동 범위가 늘었다" 의 방향이 사람마다 반대로 읽힌다.
//
// ⚠ 이 파일은 **정상 범위를 모른다.** "무릎은 몇 도까지가 정상" 같은 임상 기준값을 여기 넣지 않는다.
//   그건 나이·종목·개인차로 갈리는 값이라 상수로 박으면 근거 없는 숫자가 권위를 갖는다.
//   여기서 내는 것은 잰 값(각도·범위·좌우 차)뿐이고, 눈에 띄는 대목을 고르는 눈금은 domain/rom.js 가
//   **밖에서 받아서** 쓴다.
//
// ⚠ 자료형(PosePoint·PoseSubject·PoseFrame)을 여기서 **한 번 더** 적는다. `ports/pose.js` 에도 같은 모양이
//   있는데, 계층 규칙상 domain 은 ports 를 JSDoc 으로도 참조할 수 없기 때문이다(tools/check-arch.mjs 는
//   원문에서 `import()` 를 뽑는다). domain/clips.js 의 `UNFILED` 가 ports/clips.js 의 `CLIP_UNFILED_DIR` 와
//   같은 값을 두 번 적는 것과 같은 사정이다 — **한쪽을 고치면 다른 쪽도 고친다.**
//
// ⚠ 좌표계는 world(미터) 를 쓰는 것이 원칙이다. world 가 없으면 화면 좌표로 떨어지는데, 그때 각도는
//   카메라 평면에 투영된 값이라 **카메라를 옮기면 숫자가 달라진다.** 그래서 결과에 `space` 를 함께 실어
//   보내고, 화면 좌표로 잰 기록과 world 로 잰 기록을 나란히 비교하지 못하게 한다.

/**
 * 관절점 하나. `ports/pose.js` 의 같은 이름과 **같은 모양이어야 한다**(위 주석 참조).
 * @typedef {Object} PosePoint
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} score 0..1. 이 점이 실제로 보였는가
 */

/**
 * 한 프레임에 잡힌 사람 하나.
 * @typedef {Object} PoseSubject
 * @property {Record<string, PosePoint|null>} points 화면 정규 좌표(0..1)
 * @property {Record<string, PosePoint|null>|null} world 미터 좌표(엉덩이 중점 원점). 없으면 null
 * @property {number} score
 * @property {number} [aspect] 이 좌표를 뜬 그림의 폭/높이. 없으면 1
 */

/**
 * 한 시각의 결과. `subjects` 의 순서에는 뜻이 없다 — 누가 누구인지는 domain/poseTracks.js 가 잇는다.
 * @typedef {Object} PoseFrame
 * @property {number} sec
 * @property {PoseSubject[]} subjects
 */

/** 라디안 → 도. */
const DEG = 180 / Math.PI;

/** 우리가 쓰는 관절점 이름 전부. 어댑터는 자기 모델의 점을 이 이름으로 옮겨 넣는다. */
export const POSE_POINT_NAMES = Object.freeze([
  'nose',
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
  'leftFootIndex', 'rightFootIndex'
]);

/**
 * 재는 관절 하나의 정의. `points` 는 [바깥, **관절**, 바깥] 세 점이고 가운데 점에서 각을 잰다.
 * `pair` 는 좌우 대칭 비교의 짝이다.
 * @typedef {Object} JointSpec
 * @property {[string,string,string]} points
 * @property {string} label 화면에 그대로 쓰는 한국어 이름
 * @property {'left'|'right'} side
 * @property {string} pair 반대쪽 관절 키
 */

/** @type {Readonly<Record<string, JointSpec>>} */
export const JOINT_SPECS = Object.freeze({
  leftElbow: { points: ['leftShoulder', 'leftElbow', 'leftWrist'], label: '왼 팔꿈치', side: 'left', pair: 'rightElbow' },
  rightElbow: { points: ['rightShoulder', 'rightElbow', 'rightWrist'], label: '오른 팔꿈치', side: 'right', pair: 'leftElbow' },
  // 어깨는 위팔과 몸통이 이루는 각이다 — 팔을 몸에 붙이면 0 에 가깝고 만세하면 180 에 가깝다.
  leftShoulder: { points: ['leftElbow', 'leftShoulder', 'leftHip'], label: '왼 어깨', side: 'left', pair: 'rightShoulder' },
  rightShoulder: { points: ['rightElbow', 'rightShoulder', 'rightHip'], label: '오른 어깨', side: 'right', pair: 'leftShoulder' },
  leftHip: { points: ['leftShoulder', 'leftHip', 'leftKnee'], label: '왼 고관절', side: 'left', pair: 'rightHip' },
  rightHip: { points: ['rightShoulder', 'rightHip', 'rightKnee'], label: '오른 고관절', side: 'right', pair: 'leftHip' },
  leftKnee: { points: ['leftHip', 'leftKnee', 'leftAnkle'], label: '왼 무릎', side: 'left', pair: 'rightKnee' },
  rightKnee: { points: ['rightHip', 'rightKnee', 'rightAnkle'], label: '오른 무릎', side: 'right', pair: 'leftKnee' },
  leftAnkle: { points: ['leftKnee', 'leftAnkle', 'leftFootIndex'], label: '왼 발목', side: 'left', pair: 'rightAnkle' },
  rightAnkle: { points: ['rightKnee', 'rightAnkle', 'rightFootIndex'], label: '오른 발목', side: 'right', pair: 'leftAnkle' }
});

/** 좌우 짝이 있는 관절 키를 한 번씩만(왼쪽 기준). 대칭 비교가 이 목록을 돈다. */
export const JOINT_PAIRS = Object.freeze(
  Object.keys(JOINT_SPECS).filter(k => JOINT_SPECS[k].side === 'left').map(k => Object.freeze([k, JOINT_SPECS[k].pair]))
);

/** 세 점으로 정의되지 않는 측정값. 몸통 기울기는 축과의 각이라 따로 낸다. */
export const TORSO_TILT = 'torsoTilt';

/** 몸통 기울기의 표시 이름. JOINT_SPECS 밖이지만 결과 사전에는 같은 층에 들어간다. */
export const TORSO_TILT_LABEL = '상체 기울기';

/** 두 점의 중점. 하나라도 없으면 null. */
function midOf(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * b 에서 잰 a-b-c 사이 각(도). 0~180 이고 180 이 일직선이다.
 * 세 점 중 하나라도 없거나 두 변 중 하나가 길이 0 이면 null — 0 을 돌려주지 않는다(0 도 유효한 각이다).
 * @param {{x:number,y:number,z:number}|null} a
 * @param {{x:number,y:number,z:number}|null} b 각을 재는 관절
 * @param {{x:number,y:number,z:number}|null} c
 * @returns {number|null}
 */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const un = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const vn = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (!(un > 0) || !(vn > 0)) return null;
  // 부동소수 오차로 |cos| 이 1 을 아주 조금 넘으면 acos 가 NaN 이다 — 가둔다.
  let cos = (ux * vx + uy * vy + uz * vz) / (un * vn);
  if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
  return Math.acos(cos) * DEG;
}

/**
 * 몸통이 수직에서 얼마나 기울었는가(도). 0 이 곧추선 상태다.
 *
 * ⚠ 수직 **축**과의 각이라 0~90 이다(수직 **방향**이 아니다). 모델마다 y 가 위로 자라기도 아래로 자라기도
 *   해서, 방향으로 재면 같은 자세가 어떤 모델에서는 10° 다른 모델에서는 170° 로 나온다. 축으로 재면
 *   그 규약 차이가 사라진다 — 물구나무를 구별하지 못하는 대신 어떤 모델에도 맞다.
 * @param {Record<string, {x:number,y:number,z:number}|null>} pts
 * @returns {number|null}
 */
export function torsoTilt(pts) {
  const shoulder = midOf(pts.leftShoulder, pts.rightShoulder);
  const hip = midOf(pts.leftHip, pts.rightHip);
  if (!shoulder || !hip) return null;
  const dx = shoulder.x - hip.x, dy = shoulder.y - hip.y, dz = shoulder.z - hip.z;
  const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(n > 0)) return null;
  const cos = Math.abs(dy) / n;          // 절댓값 = 축과의 각
  return Math.acos(cos > 1 ? 1 : cos) * DEG;
}

/**
 * 각도를 잴 좌표계를 고른다. world 가 있고 실제로 점이 들어 있으면 world, 아니면 화면 좌표다.
 *
 * ⚠ 화면 좌표를 고를 때는 **가로 눌림을 되돌린다.** 정규 좌표는 가로를 폭으로 세로를 높이로 나눈 값이라
 *   480x640 영상에서 가로가 0.75배로 눌려 있고, 그대로 각을 재면 실제와 다른 숫자가 나온다
 *   (2026-09-11 합성 영상 검사: 넣은 110.0° 가 93.9° 로 나왔다. `tests/pose-check.html`).
 *   각은 균일 확대에 변하지 않으므로 x 에 폭/높이를 곱하는 것만으로 픽셀 공간의 기하가 돌아온다.
 * ⚠ 되돌린 좌표는 **각도 계산에만** 쓴다. 오버레이와 클릭 판정은 원래의 정규 좌표를 그대로 써야
 *   화면 위치와 맞는다(boxOf·centroidOf 가 그쪽이다).
 * ⚠ z 도 x 와 같이 되돌린다. 화면 좌표의 z 는 x 와 같은 잣대(폭 기준)라 x 만 고치면 깊이만 눌린 채 남는다.
 *   2D 모델은 z 가 0 이라 곱해도 그대로다 — 어느 쪽이든 맞다.
 * @param {PoseSubject} subject
 * @param {'auto'|'screen'} [prefer='auto'] 'screen' 이면 world 가 있어도 화면 좌표를 쓴다.
 *   영상 **위에 겹쳐 그릴 때**가 그렇다 — world 는 엉덩이 중점이 원점이라 화면의 사람과 자리가 다르다
 * @returns {{space:'world'|'screen', pts:Record<string, any>}}
 */
export function spaceOf(subject, prefer = 'auto') {
  const world = subject && subject.world;
  const hasWorld = !!world && Object.values(world).some(p => p !== null);
  if (hasWorld && prefer !== 'screen') return { space: 'world', pts: world };
  const points = (subject && subject.points) || {};
  const aspect = subject && Number.isFinite(subject.aspect) && subject.aspect > 0 ? subject.aspect : 1;
  if (aspect === 1) return { space: 'screen', pts: points };
  const scaled = {};
  for (const key of Object.keys(points)) {
    const p = points[key];
    scaled[key] = p ? { x: p.x * aspect, y: p.y, z: p.z * aspect, score: p.score } : null;
  }
  return { space: 'screen', pts: scaled };
}

/**
 * 사람 하나의 모든 관절 각도.
 *
 * `scores` 는 각 각도가 **얼마나 믿을 만한가**다 — 그 각을 이루는 세 점의 신뢰도 중 가장 낮은 값이고,
 * 언제나 화면 좌표(`points`)에서 읽는다. world 좌표에는 가려짐 정보가 없는 모델이 있기 때문이다.
 * 뒤돌아 선 구간의 각도를 평균에 넣지 않으려면 호출부가 이 값으로 거른다(domain/rom.js).
 *
 * @param {PoseSubject} subject
 * @returns {{space:'world'|'screen', angles:Record<string, number|null>, scores:Record<string, number>}}
 */
export function jointAngles(subject) {
  const { space, pts } = spaceOf(subject);
  const seen = (subject && subject.points) || {};
  const angles = {};
  const scores = {};
  for (const key of Object.keys(JOINT_SPECS)) {
    const [a, b, c] = JOINT_SPECS[key].points;
    angles[key] = angleAt(pts[a], pts[b], pts[c]);
    scores[key] = Math.min(seen[a] ? seen[a].score : 0, seen[b] ? seen[b].score : 0, seen[c] ? seen[c].score : 0);
  }
  angles[TORSO_TILT] = torsoTilt(pts);
  scores[TORSO_TILT] = Math.min(
    seen.leftShoulder ? seen.leftShoulder.score : 0, seen.rightShoulder ? seen.rightShoulder.score : 0,
    seen.leftHip ? seen.leftHip.score : 0, seen.rightHip ? seen.rightHip.score : 0
  );
  return { space, angles, scores };
}

/** 결과 사전에 들어가는 측정 키 전부(관절 10 + 몸통 기울기 1). 화면과 저장이 이 순서를 쓴다. */
export const MEASURE_KEYS = Object.freeze([...Object.keys(JOINT_SPECS), TORSO_TILT]);

/**
 * 측정 키 → 화면에 쓰는 이름.
 * @param {string} key
 * @returns {string}
 */
export function measureLabel(key) {
  if (key === TORSO_TILT) return TORSO_TILT_LABEL;
  return JOINT_SPECS[key] ? JOINT_SPECS[key].label : key;
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면 기하 — 인물 지정과 오버레이가 쓴다. 언제나 화면 정규 좌표(0..1)다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사람 하나를 감싸는 상자. 보이는 점(score 가 minScore 이상)만 센다.
 * @param {PoseSubject} subject
 * @param {number} [minScore=0.3]
 * @returns {{x:number, y:number, w:number, h:number}|null} 쓸 점이 없으면 null
 */
export function boxOf(subject, minScore = 0.3) {
  const pts = (subject && subject.points) || {};
  let x0 = null, y0 = null, x1 = null, y1 = null;
  for (const key of Object.keys(pts)) {
    const p = pts[key];
    if (!p || p.score < minScore) continue;
    if (x0 === null || p.x < x0) x0 = p.x;
    if (x1 === null || p.x > x1) x1 = p.x;
    if (y0 === null || p.y < y0) y0 = p.y;
    if (y1 === null || p.y > y1) y1 = p.y;
  }
  if (x0 === null) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 사람 하나의 중심점. 상자의 중심이다(엉덩이 중점을 쓰면 가려졌을 때 통째로 사라진다).
 * @param {PoseSubject} subject
 * @param {number} [minScore=0.3]
 * @returns {{x:number, y:number}|null}
 */
export function centroidOf(subject, minScore = 0.3) {
  const box = boxOf(subject, minScore);
  return box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null;
}
