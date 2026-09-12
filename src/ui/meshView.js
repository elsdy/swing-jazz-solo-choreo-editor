// src/ui/meshView.js — 몸 메시를 캔버스에 그린다 (ui 계층)
//
// 신설 파일이다(2026-09-12). domain/bodyMesh 가 만든 꼭짓점·면을 받아 2D 로 그린다.
// 돌리기·맞추기 계산은 도메인(projectVertices)이 하고, 여기서는 **칠하고 긋는 일만** 한다.
//
// ⚠ 가림은 화가 알고리즘으로 푼다 — 면을 **먼 것부터** 칠하면 가까운 면이 그 위에 덮인다. z 버퍼도
//   깊이 검사도 없으므로 면이 서로 뚫고 지나가면 어긋나지만(팔이 몸통을 파고든 자세), 와이어프레임
//   한 겹에서는 눈에 띄지 않는다. 이 한 줄이 three.js 를 안 들이는 이유다.
//
// ⚠ MediaPipe 의 z 는 **작을수록 카메라에 가깝다**. 그래서 큰 것부터 칠한다. 이 규약이 뒤집히면
//   앞뒤가 뒤바뀐 채로 그려지고, 그림은 그럴듯한데 뒤통수가 앞에 온다.
//
// ⚠ 영상 위에 얹을 때는 `xScale` 로 가로 눌림을 **다시 적용**한다. 메시는 등방 공간에서 만들어졌고
//   영상의 정규 좌표는 가로가 눌려 있으므로(domain/pose.js 참조), 되돌리지 않으면 사람과 어긋난다.

import { projectVertices } from '../domain/bodyMesh.js';

/** 기본 색. 참고 그림처럼 어두운 몸에 밝은 그물이다. */
export const MESH_COLORS = Object.freeze({
  stroke: 'rgba(226,232,240,0.92)',
  fill: 'rgba(15,23,42,0.55)',
  joint: 'rgba(34,197,94,0.95)'
});

/** rgba 문자열의 알파를 바꾼다. 깊이에 따라 흐리게 하는 데만 쓴다. */
function withAlpha(rgba, k) {
  const m = /^rgba?\(([^)]+)\)$/.exec(String(rgba));
  if (!m) return rgba;
  const parts = m[1].split(',').map(s => s.trim());
  const a = parts.length > 3 ? Number(parts[3]) : 1;
  return `rgba(${parts[0]},${parts[1]},${parts[2]},${Math.max(0, Math.min(1, a * k)).toFixed(3)})`;
}

/**
 * @typedef {object} MeshViewDeps
 * @property {HTMLCanvasElement} canvas 그릴 곳. 크기는 호출부가 정한다
 * @property {Document} [doc]
 */

/**
 * 메시 뷰를 만든다. 상태를 거의 갖지 않는다 — 매 호출이 캔버스를 지우고 다시 그린다.
 * @param {MeshViewDeps} deps
 * @returns {{ render(mesh: object, options?: object): {points: Array}|null, clear(): void, canvas: HTMLCanvasElement }}
 */
export function createMeshView(deps) {
  const canvas = deps.canvas;
  const ctx = canvas ? canvas.getContext('2d') : null;

  function clear() {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * @param {{vertices:Array, edges:Array, quads:Array}} mesh domain/bodyMesh 가 만든 것
   * @param {{yaw?:number, pitch?:number, pad?:number, xScale?:number, flipY?:boolean,
   *          fit?:object, direct?:boolean, colors?:object, lineWidth?:number, fillFaces?:boolean,
   *          fade?:boolean, clear?:boolean, joints?:Array<{x:number,y:number,z:number}>}} [options]
   *   `clear:false` 면 지우지 않고 **덧그린다** — 한 화면에 두 사람을 겹쳐 그릴 때 쓴다
   * @returns {{points:Array, bounds:object}|null} 그린 것이 없으면 null
   */
  function render(mesh, options = {}) {
    const wipe = options.clear !== false;
    if (!ctx || !mesh || !mesh.vertices || !mesh.vertices.length) { if (wipe) clear(); return null; }
    const colors = { ...MESH_COLORS, ...(options.colors || {}) };
    const fillFaces = options.fillFaces !== false;
    const fade = options.fade !== false;

    const projected = projectVertices(mesh.vertices, {
      yaw: options.yaw, pitch: options.pitch,
      width: canvas.width, height: canvas.height,
      pad: options.pad, xScale: options.xScale, flipY: options.flipY, fit: options.fit, direct: options.direct
    });
    const P = projected.points;

    if (wipe) clear();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Number.isFinite(options.lineWidth) ? options.lineWidth : Math.max(1, canvas.width / 420);

    // 깊이 범위를 한 번 재서, 뒤에 있는 면을 흐리게 한다.
    let dMin = Infinity, dMax = -Infinity;
    for (const p of P) { if (p.depth < dMin) dMin = p.depth; if (p.depth > dMax) dMax = p.depth; }
    const alphaOf = (d) => (!fade || dMax - dMin < 1e-9) ? 1 : 0.35 + 0.65 * (1 - (d - dMin) / (dMax - dMin));

    // ⚠ **먼 것부터** 칠한다(파일 상단 주석). z 가 클수록 멀다.
    const faces = (mesh.quads || []).map(q => ({
      q, depth: q.reduce((s, i) => s + P[i].depth, 0) / q.length
    })).sort((a, b) => b.depth - a.depth);

    for (const face of faces) {
      const k = alphaOf(face.depth);
      ctx.beginPath();
      ctx.moveTo(P[face.q[0]].x, P[face.q[0]].y);
      for (let i = 1; i < face.q.length; i++) ctx.lineTo(P[face.q[i]].x, P[face.q[i]].y);
      ctx.closePath();
      if (fillFaces) { ctx.fillStyle = withAlpha(colors.fill, k); ctx.fill(); }
      ctx.strokeStyle = withAlpha(colors.stroke, k);
      ctx.stroke();
    }

    // 면에 속하지 않은 선(머리 극점 등)은 따로 긋는다.
    if (!faces.length) {
      for (const [i, j] of (mesh.edges || [])) {
        ctx.strokeStyle = withAlpha(colors.stroke, alphaOf((P[i].depth + P[j].depth) / 2));
        ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.stroke();
      }
    }

    // 관절 점을 함께 찍고 싶으면 같은 투영을 그대로 쓴다 — 메시와 점이 어긋날 수 없다.
    if (Array.isArray(options.joints) && options.joints.length) {
      const jp = projectVertices(options.joints, {
        yaw: options.yaw, pitch: options.pitch,
        width: canvas.width, height: canvas.height,
        pad: options.pad, xScale: options.xScale, flipY: options.flipY, direct: options.direct,
        fit: options.fit || projected.bounds
      });
      const r = Math.max(2, canvas.width / 150);
      for (const p of jp.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(colors.joint, alphaOf(p.depth));
        ctx.fill();
      }
    }
    return { points: P, bounds: projected.bounds };
  }

  return { render, clear, canvas };
}
