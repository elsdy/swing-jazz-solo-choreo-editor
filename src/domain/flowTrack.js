// src/domain/flowTrack.js — 작업 차례를 그리는 **길**의 기하 (순수 함수, 의존성 0)
//
// 2026-09-21 신설. 사용자가 건네준 `boot-flow.html` 의 길 그리기를 이 앱의 크기에 맞게 옮겼다.
// 거기서는 1440×820 한 장이었고 여기서는 영상 아래 좁은 띠라, **살아남는 것만** 가져왔다 —
// 스플라인 길 · 원근(멀수록 좁아지는 리본) · 마디 자리. 바닥 격자와 눈금자는 이 높이에서
// 읽히지 않아 두고 왔다.
//
// ⚠ 이 파일은 **좌표만** 만든다. 색·발광·애니메이션은 CSS 가, 버튼은 ui 가 맡는다.
//   그래서 폭이 바뀔 때마다 다시 불러도 되고, 시험이 눈 없이 값을 검사할 수 있다.
// ⚠ 원본의 Catmull-Rom 은 **끝점을 늘린 가짜 제어점** 둘을 양쪽에 붙여 시작·끝의 기울기를
//   만든다. 그 두 점을 빼면 길이 양 끝에서 꺾인다 — 옮기면서 그대로 뒀다.

/** 한 구간을 몇 조각으로 쪼개 그릴까. 촘촘할수록 곡선이 매끈하고 문자열이 길어진다. */
const SEG = 18;

/**
 * 마디 자리와 길을 만든다.
 *
 * 세로는 **가운데가 솟은 완만한 활**이다(원본은 멀어질수록 올라가는 원근 곡선이었다). 좁은 띠에서는
 * 그 굴곡이 크면 라벨이 서로 어긋나 읽기 어려워서, 높이의 3할 안쪽으로 눌렀다.
 *
 * @param {object} args
 * @param {number} args.width   그릴 폭(px)
 * @param {number} args.height  그릴 높이(px)
 * @param {number} args.count   마디 수(2 이상)
 * @param {number} [args.padX]  양 끝 여백(px)
 * @returns {{ points: {x:number,y:number}[], center: string, ribbon: string }|null}
 *   못 그리면 null. `center` 는 길 한가운데 선, `ribbon` 은 원근이 든 띠(닫힌 도형)
 */
export function flowTrack({ width, height, count, padX = 48 }) {
  if (![width, height, count].every(Number.isFinite)) return null;
  if (!(width > 0) || !(height > 0) || !(count >= 2)) return null;

  const x0 = Math.min(padX, width / 4);
  const x1 = width - x0;
  if (!(x1 > x0)) return null;

  // 마디는 **고르게** 둔다(읽기 쉬움이 먼저다). 세로만 활처럼 휜다.
  const arc = Math.min(height * 0.3, 26);
  const baseY = height * 0.5 + arc * 0.5;
  const yAt = (x) => {
    const t = (x - x0) / (x1 - x0);          // 0..1
    return baseY - arc * Math.sin(Math.PI * t);
  };

  const points = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + (x1 - x0) * i / (count - 1);
    points.push({ x, y: yAt(x) });
  }

  // 가짜 제어점 둘(원본과 같은 이유 — 양 끝의 기울기를 만든다).
  const ctrl = [
    { x: points[0].x - 60, y: points[0].y + 10 },
    ...points,
    { x: points[count - 1].x + 60, y: points[count - 1].y + 10 }
  ];

  const samples = [];
  for (let i = 0; i < ctrl.length - 3; i++) {
    for (let k = 0; k < SEG; k++) samples.push(catmullRom(ctrl[i], ctrl[i + 1], ctrl[i + 2], ctrl[i + 3], k / SEG));
  }
  samples.push(ctrl[ctrl.length - 2]);

  // 원근 — 왼쪽(가까움)이 두껍고 오른쪽(멂)이 얇다. 원본의 `width(x)` 와 같은 뜻이다.
  const halfAt = (x) => {
    const t = (x - x0) / (x1 - x0);
    return Math.max(2, (height * 0.16) * (1 - 0.55 * Math.min(1, Math.max(0, t))));
  };
  const left = offsetSide(samples, halfAt, -1);
  const right = offsetSide(samples, halfAt, 1);

  return {
    points,
    center: toPath(samples),
    ribbon: toPath(left) + ' L' + right.slice().reverse().map(p => `${r1(p.x)} ${r1(p.y)}`).join(' L') + ' Z'
  };
}

/** Catmull-Rom 한 점. 원본 `cr` 과 같은 식이다. */
function catmullRom(p0, p1, p2, p3, t) {
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** 곡선의 법선 방향으로 밀어 낸 한 쪽 가장자리. */
function offsetSide(samples, halfAt, sign) {
  return samples.map((p, i) => {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const half = halfAt(p.x);
    return { x: p.x - sign * (dy / len) * half, y: p.y + sign * (dx / len) * half };
  });
}

const r1 = (n) => Math.round(n * 10) / 10;
const toPath = (pts) => 'M' + pts.map(p => `${r1(p.x)} ${r1(p.y)}`).join(' L');
