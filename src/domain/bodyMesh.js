// src/domain/bodyMesh.js — 관절점 → 몸 표면 메시 (순수, domain/pose.js 만 import)
//
// 신설 파일이다(2026-09-12). 관절 **점**을 관절 **몸**으로 바꾼다. 뼈마다 통(원기둥)을 씌우고 몸통을
// 어깨선~허리~엉덩이선으로 잇고 머리를 얹어, 와이어프레임으로 그리면 사람 형태가 나온다.
//
// ⚠ **이것은 몸매 복원이 아니다.** SMPL 같은 인체 메시 모델은 픽셀에서 그 사람의 체형까지 추정해 실루엣에
//   딱 맞춘다. 여기서 하는 것은 **평균 몸을 관절 길이에 맞춰 늘리는 것**이라, 자세는 맞지만 몸집은
//   `RADII` 표의 평균값이다. 옷·체형·근육은 반영되지 않는다. 진짜 메시를 원하면 HMR 계열 모델
//   (PyTorch·GPU)이 필요하고 그것은 이 저장소의 "표준 라이브러리만" 을 깬다 — 그 판단은
//   docs/ROADMAP.md 에 적혀 있다.
//
// ⚠ 좌표계를 가리지 않는다. **등방(等方) 공간**이면 무엇이든 받는다 — world(미터)면 그대로,
//   화면 정규 좌표면 가로 눌림을 먼저 되돌린 것(domain/pose.spaceOf)을 줘야 통이 타원이 되지 않는다.
//   되돌린 좌표로 만든 메시를 영상 위에 얹을 때는 그리는 쪽이 x 를 다시 나눈다(ui/meshView 의 xScale).
//
// ⚠ 관절이 없으면 그 부위를 **만들지 않는다**. 팔이 가려진 프레임에서 팔을 지어내면, 없는 것을 본 것처럼
//   그리게 된다 — 이 기능에서 가장 나쁜 실패다(domain/rom.js 의 coverage 와 같은 태도).

import { spaceOf } from './pose.js';

/** 통 하나의 둘레를 몇 조각으로 나누는가. 8이면 와이어프레임이 사람으로 읽히면서 선이 너무 빽빽하지 않다. */
export const LIMB_SIDES = 8;

/** 몸통 둘레의 조각 수. 팔다리보다 굵어서 조금 더 잘게 나눈다. */
export const TORSO_SIDES = 10;

/** 머리 구의 가로·세로 분할. */
export const HEAD_LAT = 4;
export const HEAD_LON = 8;

/**
 * 부위별 굵기. **몸통 길이(어깨 중점 ~ 엉덩이 중점)에 대한 비율**이다.
 * 사람마다 다른 절대 치수를 쓰지 않고 비율로 두면, 멀리 찍힌 사람이든 가까이 찍힌 사람이든 같은 모양이 나온다.
 * ⚠ 평균값이다. 이 표를 고치면 모든 사람의 몸집이 함께 바뀐다 — 그것이 이 방식의 한계다(파일 상단 주석).
 */
export const RADII = Object.freeze({
  upperArm: [0.115, 0.090],
  foreArm: [0.090, 0.062],
  thigh: [0.165, 0.115],
  shin: [0.115, 0.072],
  foot: [0.072, 0.048],
  torsoDepth: 0.46,     // 어깨/엉덩이 **너비**에 대한 앞뒤 두께 비율
  waist: 0.88,          // 허리는 어깨·엉덩이 너비를 섞은 값의 이 배율
  head: 0.225,          // 머리 반지름 / 몸통 길이
  neck: 0.085
});

/** 뼈마다 어느 두 점을 잇고 어느 굵기를 쓰는가. 여기 없는 점은 메시에 들어가지 않는다. */
export const LIMBS = Object.freeze([
  { a: 'leftShoulder', b: 'leftElbow', r: 'upperArm' },
  { a: 'leftElbow', b: 'leftWrist', r: 'foreArm' },
  { a: 'rightShoulder', b: 'rightElbow', r: 'upperArm' },
  { a: 'rightElbow', b: 'rightWrist', r: 'foreArm' },
  { a: 'leftHip', b: 'leftKnee', r: 'thigh' },
  { a: 'leftKnee', b: 'leftAnkle', r: 'shin' },
  { a: 'leftAnkle', b: 'leftFootIndex', r: 'foot' },
  { a: 'rightHip', b: 'rightKnee', r: 'thigh' },
  { a: 'rightKnee', b: 'rightAnkle', r: 'shin' },
  { a: 'rightAnkle', b: 'rightFootIndex', r: 'foot' }
]);

// ── 벡터 ─────────────────────────────────────────────────────────────────────

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const mid = (a, b) => mul(add(a, b), 0.5);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const len = (a) => Math.sqrt(dot(a, a));

/** 길이 1로. 길이가 0이면 null — 방향이 없는 벡터로 좌표계를 세울 수 없다. */
function unit(a) {
  const n = len(a);
  return n > 1e-9 ? mul(a, 1 / n) : null;
}

/**
 * 방향 d 에 수직인 두 축을 고른다. ref 와 나란하면 다른 ref 로 물러난다 —
 * 안 그러면 팔을 위로 들었을 때 통이 납작하게 무너진다.
 * @param {{x:number,y:number,z:number}} d 길이 1
 * @param {{x:number,y:number,z:number}} ref
 * @returns {[object, object]}
 */
export function frameFor(d, ref) {
  let u = unit(cross(d, ref));
  if (!u) u = unit(cross(d, { x: 1, y: 0, z: 0 }));
  if (!u) u = unit(cross(d, { x: 0, y: 0, z: 1 }));
  return [u, cross(d, u)];
}

/** 중심 c 에서 (u,v) 평면 위에 반지름 r 인 고리를 만든다. */
function ring(c, u, v, r, sides) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2;
    const cos = Math.cos(t), sin = Math.sin(t);
    out.push({
      x: c.x + (u.x * cos + v.x * sin) * r,
      y: c.y + (u.y * cos + v.y * sin) * r,
      z: c.z + (u.z * cos + v.z * sin) * r
    });
  }
  return out;
}

/**
 * 메시를 쌓아 올리는 그릇. 고리를 넣으면 앞 고리와 사각면으로 이어 준다.
 * 면은 네 꼭짓점 번호로 두고, 선은 면에서 뽑는다 — 같은 선을 두 번 그리지 않으려고 집합으로 모은다.
 */
function builder() {
  const vertices = [];
  const quads = [];
  const edgeSet = new Set();
  const edges = [];
  const addEdge = (i, j) => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([i, j]);
  };
  return {
    vertices, quads, edges,
    /** 고리 하나를 넣고 시작 번호를 돌려준다. */
    pushRing(points, closed = true) {
      const base = vertices.length;
      for (const p of points) vertices.push(p);
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        if (!closed && j === 0) break;
        addEdge(base + i, base + j);
      }
      return base;
    },
    /** 두 고리를 사각면으로 잇는다. 개수가 같아야 한다. */
    bridge(baseA, baseB, count, closed = true) {
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        if (!closed && j === 0) break;
        quads.push([baseA + i, baseA + j, baseB + j, baseB + i]);
        addEdge(baseA + i, baseB + i);
      }
      if (!closed) addEdge(baseA + count - 1, baseB + count - 1);
    }
  };
}

/**
 * 관절점 사전에서 몸 표면 메시를 만든다.
 *
 * @param {Record<string, {x:number,y:number,z:number}|null>} pts 등방 공간의 점들(파일 상단 주석)
 * @param {{sides?:number, radii?:object, headLat?:number, headLon?:number}} [options]
 * @returns {{vertices:Array<{x:number,y:number,z:number}>, edges:Array<[number,number]>,
 *            quads:Array<number[]>, scale:number, parts:string[]}}
 *   `parts` 는 실제로 만들어진 부위 이름이다 — 관절이 없어 못 만든 부위를 호출부가 알 수 있다.
 */
export function buildBodyMesh(pts, options = {}) {
  const sides = Number.isFinite(options.sides) && options.sides >= 3 ? Math.floor(options.sides) : LIMB_SIDES;
  const R = { ...RADII, ...(options.radii || {}) };
  const empty = { vertices: [], edges: [], quads: [], scale: 0, parts: [] };
  if (!pts) return empty;

  const ls = pts.leftShoulder, rs = pts.rightShoulder, lh = pts.leftHip, rh = pts.rightHip;
  // 몸통 네 점이 없으면 몸을 세울 좌표계가 없다. 크기도 방향도 여기서 나온다.
  if (!ls || !rs || !lh || !rh) return empty;

  const shoulderMid = mid(ls, rs);
  const hipMid = mid(lh, rh);
  const scale = len(sub(shoulderMid, hipMid));
  if (!(scale > 1e-9)) return empty;

  // 몸의 좌표계: 위(엉덩이→어깨) · 옆(오른어깨→왼어깨) · 앞(둘의 외적).
  const up = unit(sub(shoulderMid, hipMid)) || { x: 0, y: -1, z: 0 };
  const side = unit(sub(ls, rs)) || { x: 1, y: 0, z: 0 };
  const front = unit(cross(up, side)) || { x: 0, y: 0, z: 1 };

  const B = builder();
  const parts = [];

  // ── 몸통: 어깨선 → 허리 → 엉덩이선을 통으로 잇는다 ──
  const shoulderW = len(sub(ls, rs)) / 2;
  const hipW = len(sub(lh, rh)) / 2;
  const waistW = ((shoulderW + hipW) / 2) * R.waist;
  const torsoRing = (center, halfWidth) => {
    const out = [];
    for (let i = 0; i < TORSO_SIDES; i++) {
      const t = (i / TORSO_SIDES) * Math.PI * 2;
      const a = Math.cos(t) * halfWidth;
      const b = Math.sin(t) * halfWidth * R.torsoDepth;
      out.push({
        x: center.x + side.x * a + front.x * b,
        y: center.y + side.y * a + front.y * b,
        z: center.z + side.z * a + front.z * b
      });
    }
    return out;
  };
  const waistMid = add(hipMid, mul(sub(shoulderMid, hipMid), 0.45));
  const t0 = B.pushRing(torsoRing(shoulderMid, shoulderW));
  const t1 = B.pushRing(torsoRing(waistMid, waistW));
  const t2 = B.pushRing(torsoRing(hipMid, hipW));
  B.bridge(t0, t1, TORSO_SIDES);
  B.bridge(t1, t2, TORSO_SIDES);
  parts.push('torso');

  // ── 팔다리: 뼈마다 끝이 가는 통 ──
  for (const limb of LIMBS) {
    const a = pts[limb.a], b = pts[limb.b];
    if (!a || !b) continue;                       // 없는 관절은 지어내지 않는다
    const d = unit(sub(b, a));
    if (!d) continue;
    const [u, v] = frameFor(d, up);
    const [r0, r1] = R[limb.r];
    const s0 = B.pushRing(ring(a, u, v, r0 * scale, sides));
    const s1 = B.pushRing(ring(b, u, v, r1 * scale, sides));
    B.bridge(s0, s1, sides);
    parts.push(limb.a + '-' + limb.b);
  }

  // ── 목과 머리 ──
  if (pts.nose) {
    const neckTop = add(shoulderMid, mul(up, R.neck * scale * 2));
    const [nu, nv] = frameFor(up, side);
    const n0 = B.pushRing(ring(shoulderMid, nu, nv, R.neck * scale, sides));
    const n1 = B.pushRing(ring(neckTop, nu, nv, R.neck * scale * 0.9, sides));
    B.bridge(n0, n1, sides);

    // 코는 얼굴 앞면이다 — 구의 중심을 뒤로 물려야 머리가 앞으로 튀어나오지 않는다.
    const headR = R.head * scale;
    const center = add(pts.nose, mul(front, -headR * 0.45));
    const headLat = Number.isFinite(options.headLat) ? options.headLat : HEAD_LAT;
    const headLon = Number.isFinite(options.headLon) ? options.headLon : HEAD_LON;
    let prev = null;
    for (let i = 0; i <= headLat; i++) {
      const phi = (i / headLat) * Math.PI;          // 0 = 아래, π = 위
      const y = -Math.cos(phi);
      const rr = Math.sin(phi);
      const c = add(center, mul(up, y * headR));
      const base = rr < 1e-6
        ? B.pushRing([c])                           // 극점은 점 하나
        : B.pushRing(ring(c, side, front, rr * headR, headLon));
      const count = rr < 1e-6 ? 1 : headLon;
      if (prev) {
        if (prev.count === count) B.bridge(prev.base, base, count);
        else for (let k = 0; k < Math.max(prev.count, count); k++) {
          B.edges.push([prev.base + (k % prev.count), base + (k % count)]);
        }
      }
      prev = { base, count };
    }
    parts.push('head');
  }

  return { vertices: B.vertices, edges: B.edges, quads: B.quads, scale, parts };
}

/**
 * 사람 하나에서 바로 메시를 만든다. 좌표계 고르기(world 우선, 없으면 가로 눌림 되돌린 화면 좌표)를
 * domain/pose.spaceOf 에 맡긴다 — 각도를 재는 것과 **같은 공간**이라 둘이 어긋나지 않는다.
 * @param {import('./pose.js').PoseSubject} subject
 * @param {object} [options] buildBodyMesh 와 같고, `space:'screen'` 이면 영상 위에 겹칠 좌표계를 쓴다
 * @returns {{vertices:Array, edges:Array, quads:Array, scale:number, parts:string[], space:'world'|'screen'}}
 */
export function meshOfSubject(subject, options = {}) {
  const { space, pts } = spaceOf(subject, options.space === 'screen' ? 'screen' : 'auto');
  return { ...buildBodyMesh(pts, options), space };
}

// ─────────────────────────────────────────────────────────────────────────────
// 투영 — 돌려서 평면에 놓는다. 그리는 일(ui)과 나누어 여기 순수하게 둔다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 세로축(yaw) 다음 가로축(pitch) 순으로 돌린다.
 * @param {{x:number,y:number,z:number}} p
 * @param {number} yawDeg
 * @param {number} pitchDeg
 * @returns {{x:number,y:number,z:number}}
 */
export function rotatePoint(p, yawDeg, pitchDeg) {
  const ay = (yawDeg * Math.PI) / 180;
  const ax = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  return { x: x1, y: p.y * cx - z1 * sx, z: p.y * sx + z1 * cx };
}

/**
 * 꼭짓점들을 돌려서 주어진 상자에 꽉 채워 넣는다(평행 투영).
 *
 * ⚠ `flipY` 기본값은 **거짓**이다. MediaPipe 는 화면 좌표도 world 좌표도 y 가 **아래로** 자라고
 *   (실측: 코 -0.578, 발목 +0.447) 캔버스도 아래로 자라므로, 그대로 그리면 맞다.
 *   2026-09-12 에 여기를 참으로 두었다가 사람이 물구나무로 그려졌다 — y 축 규약은 추측하지 말고 재야 한다.
 * @param {Array<{x:number,y:number,z:number}>} vertices
 * @param {{yaw?:number, pitch?:number, width:number, height:number, pad?:number,
 *          flipY?:boolean, xScale?:number, fit?:{minX:number,maxX:number,minY:number,maxY:number}}} view
 *   `xScale` 은 영상 위에 얹을 때 가로 눌림을 **다시 적용**하는 값이다(1이면 등방 그대로).
 *   `fit` 을 주면 그 상자 기준으로 맞춘다 — 프레임마다 크기가 출렁이지 않게 한 번 재서 고정할 때 쓴다.
 *   `direct` 가 참이면 **맞추지 않는다**. 0..1 좌표를 그대로 width·height 에 곱한다 — 영상 위에 겹칠 때는
 *   화면을 채우는 것이 아니라 **사람이 있는 자리에** 놓여야 하므로 자동 맞춤이 오히려 어긋난다.
 * @returns {{points:Array<{x:number,y:number,depth:number}>, scale:number,
 *            bounds:{minX:number,maxX:number,minY:number,maxY:number}}}
 */
export function projectVertices(vertices, view) {
  const yaw = Number.isFinite(view.yaw) ? view.yaw : 0;
  const pitch = Number.isFinite(view.pitch) ? view.pitch : 0;
  const pad = Number.isFinite(view.pad) ? view.pad : 0;
  const flipY = !!view.flipY;
  const xScale = Number.isFinite(view.xScale) && view.xScale > 0 ? view.xScale : 1;

  const turned = vertices.map(p => {
    const q = rotatePoint(p, yaw, pitch);
    return { x: q.x * xScale, y: flipY ? -q.y : q.y, depth: q.z };
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of turned) {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  }
  const bounds = turned.length ? { minX, maxX, minY, maxY } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  if (view.direct) {
    return {
      points: turned.map(q => ({ x: q.x * view.width, y: q.y * view.height, depth: q.depth })),
      scale: 1,
      bounds
    };
  }
  const box = view.fit || bounds;
  const dx = Math.max(box.maxX - box.minX, 1e-9);
  const dy = Math.max(box.maxY - box.minY, 1e-9);
  const scale = Math.min((view.width - pad * 2) / dx, (view.height - pad * 2) / dy);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    points: turned.map(q => ({
      x: view.width / 2 + (q.x - cx) * scale,
      y: view.height / 2 + (q.y - cy) * scale,
      depth: q.depth
    })),
    scale,
    bounds
  };
}
