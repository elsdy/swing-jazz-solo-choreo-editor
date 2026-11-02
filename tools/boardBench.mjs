// tools/boardBench.mjs — 큰 견본에서 보드 렌더를 잰다 (RM-35, 2026-11-02)
//
// 앱과 **같은 렌더 코드**(ui/boardView.updateRows)를 앱과 같은 CSS 위에서 부른다. 조작마다 두 길을 번갈아 잰다.
//   전 행  — 오늘의 동작. 이동 · 복사는 'all', 되돌리기는 골격부터 다시 세우고 전 행(mainRestoreDirty 의 skeleton)
//   좁힌   — 실제로 바뀐 마디만. 이동 · 복사 · 늘이기는 boardOps 의 changedRows, 되돌리기는 행 지문의 차이
// 한 번 잴 때 = 상태 쓰기 + updateRows + 레이아웃 강제(offsetHeight 읽기). 페인트는 빠진다 — 브라우저가 프레임 끝에
// 하므로 JS 가 잴 수 없다. 그래서 문턱(한 프레임 16ms)과 견줄 때는 여유를 둔다(계획서 「판정」).
//
// ⚠ 좁힌 렌더 경로는 **이 파일에만** 있다 — src 의 운영 경로에 남기지 않는다(RM-35 조심할 것).
// ⚠ 좁힌 렌더 뒤에는 DOM 을 데이터와 맞대어 잔상(옛 블록 · 틀린 층)을 센다. 0 이 아니면 좁힌 범위가 틀린 것이다.
//
// 결과는 화면 표와 window.__boardBench 에 함께 남는다(자동 재기 · 스크린숏이 읽는다).

import { buildBigBoard, describeBoard, makeIds, rowFingerprints, changedRowsBetween, BIG_BOARD } from '../tests/fixtures/bigBoard.mjs';
import { createStore, BOARD_MAIN } from '../src/usecases/store.js';
import { docView } from '../src/usecases/docFields.js';
import { docSignature } from '../src/domain/project/snapshot.js';
import { buildProjectFile } from '../src/domain/project/serialize.js';
import { moveGroup, copyGroup, resizeGroup } from '../src/domain/boardOps.js';
import { createBoardView } from '../src/ui/boardView.js';

const FRAME_MS = 16;
const params = new URLSearchParams(location.search);
const RUNS = Math.max(5, Number(params.get('runs')) || 40);

const $ = (id) => document.getElementById(id);

/** 앱의 CSS 를 그대로 입힌다 — index.html 의 첫 <style> 블록. */
// @complexity time=O(n) space=O(n) cc=2
async function adoptAppStyle() {
  const html = await (await fetch('../index.html')).text();
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('index.html 에서 <style> 을 찾지 못했다');
  const style = document.createElement('style');
  style.textContent = m[1];
  document.head.insertBefore(style, $('benchStyle'));
}

/** 정렬한 값의 중앙값 · 최댓값 · 최솟값. */
// @complexity time=O(n log n) space=O(n) cc=1
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], max: s[s.length - 1], min: s[0], n: s.length };
}

/**
 * DOM 과 데이터를 맞대어 어긋난 행 수를 센다 — 행마다 (groupId · 층 top) 목록이 같아야 한다.
 * @returns {number} 어긋난 행 수
 */
// @complexity time=O(r·p) space=O(p) cc=4
function countGhostRows(view, board) {
  let bad = 0;
  for (const [row, ref] of view.rowRefs) {
    const dom = [...ref.track.querySelectorAll('.placement')].map(el => `${el.dataset.groupId}@${el.style.top}`).sort().join('|');
    const cellH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cellH')) || 52;
    const data = board.placements
      .filter(p => p.row === row && p.startIndex < board.cols)
      .map(p => `${p.groupId}@${(p.subRow || 0) * cellH + 6}px`).sort().join('|');
    if (dom !== data) bad++;
  }
  return bad;
}

/** 한 번 그리고 레이아웃까지 강제한 시간(ms). */
// @complexity time=O(r·p) space=O(1) cc=2
function paint(store, view, placements, rows, skeleton) {
  const t = performance.now();
  store.setBoard(BOARD_MAIN, { placements });
  if (skeleton) view.rebuild(store.board(BOARD_MAIN));
  view.updateRows(rows, store.viewDeps(BOARD_MAIN));
  void view.el.offsetHeight;
  return performance.now() - t;
}

/**
 * 조작 넷을 RUNS 번씩, 전 행 · 좁힌 길을 번갈아 잰다. 조작마다 바탕 견본에서 출발하고, 잰 뒤 바탕으로 되돌린다
 * (되돌리는 그리기는 재지 않는다) — 그래야 보드가 자라지 않고 매번 같은 크기에서 잰다.
 */
// @complexity time=O(k·r·p) space=O(k) cc=9
function runBench(store, view, base) {
  const ids = makeIds('bench');
  const baseFp = rowFingerprints(base);
  const groups = [...new Set(base.placements.map(p => p.groupId))];
  const restore = () => paint(store, view, base.placements, 'all', false);

  /** i 번째 조작의 결과 — 같은 i 면 두 길이 같은 조작을 그린다. */
  const ops = {
    '옮기기': (i) => moveGroup(base, { groupId: groups[(i * 37) % groups.length], targetRow: 1 + ((i * 13) % base.rows), targetStartIndex: (i * 3) % base.cols }, ids),
    '복사': (i) => copyGroup(base, { groupId: groups[(i * 41) % groups.length], targetRow: 1 + ((i * 17) % base.rows), targetStartIndex: (i * 5) % base.cols }, ids),
    '늘이기': (i) => resizeGroup(base, { groupId: groups[(i * 43) % groups.length], newCount: 6 + (i % 5) }, ids)
  };

  const out = {};
  for (const [name, op] of Object.entries(ops)) {
    const full = [];
    const narrow = [];
    let ghosts = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = op(i);
      full.push(paint(store, view, r.placements, 'all', false));
      restore();
      narrow.push(paint(store, view, r.placements, r.changedRows, false));
      ghosts += countGhostRows(view, store.board(BOARD_MAIN));
      restore();
    }
    out[name] = { full: stats(full), narrow: stats(narrow), ghosts };
  }

  // 되돌리기 — 옮긴 상태에서 바탕으로. 전 행은 앱과 같이 골격부터(skeleton) 다시 세운다.
  {
    const full = [];
    const narrow = [];
    let ghosts = 0;
    for (let i = 0; i < RUNS; i++) {
      const moved = ops['옮기기'](i);
      paint(store, view, moved.placements, 'all', false);
      full.push(paint(store, view, base.placements, 'all', true));
      paint(store, view, moved.placements, 'all', false);
      const rows = changedRowsBetween(rowFingerprints({ placements: moved.placements }), baseFp);
      narrow.push(paint(store, view, base.placements, rows, false));
      ghosts += countGhostRows(view, store.board(BOARD_MAIN));
    }
    out['되돌리기'] = { full: stats(full), narrow: stats(narrow), ghosts };
  }

  // 스냅샷 문자열화 · 파일 직렬화 — node 시험과 같은 것을 브라우저에서도
  const view0 = docView(store.get());
  const sig = [];
  const file = [];
  for (let i = 0; i < RUNS; i++) {
    let t = performance.now(); docSignature(view0); sig.push(performance.now() - t);
    t = performance.now(); JSON.stringify(buildProjectFile(view0, { fileName: 'bench', savedAt: '' })); file.push(performance.now() - t);
  }
  out['스냅샷 문자열화'] = { full: stats(sig) };
  out['파일 직렬화'] = { full: stats(file) };
  return out;
}

const ms = (x) => (x === undefined ? '—' : x.toFixed(2));

/** 결과 표와 판정. */
// @complexity time=O(k) space=O(k) cc=6
function show(results, info) {
  const worstFull = Math.max(...Object.values(results).map(r => r.full.median));
  const worstMax = Math.max(...Object.values(results).map(r => r.full.max));
  const fast = worstFull < FRAME_MS;
  const rows = Object.entries(results).map(([name, r]) => `<tr><td>${name}</td>`
    + `<td>${ms(r.full.median)}</td><td>${ms(r.full.max)}</td>`
    + `<td>${ms(r.narrow?.median)}</td><td>${ms(r.narrow?.max)}</td>`
    + `<td>${r.ghosts === undefined ? '—' : r.ghosts}</td></tr>`).join('');
  $('benchOut').innerHTML = `<table><thead><tr><th>조작 (${RUNS}번)</th><th>전 행 중앙값 ms</th><th>전 행 최댓값</th>`
    + `<th>좁힌 중앙값 ms</th><th>좁힌 최댓값</th><th>좁힌 뒤 어긋난 행</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p class="verdict ${fast ? 'good' : 'bad'}">판정: 전 행 렌더의 가장 느린 중앙값 ${ms(worstFull)}ms (최댓값 ${ms(worstMax)}ms) — `
    + `${fast ? `한 프레임(${FRAME_MS}ms) 안이다. 전 행 렌더를 규칙으로 둔다` : `한 프레임(${FRAME_MS}ms)을 넘는다. 바뀐 마디만 그리는 쪽을 검토한다`}</p>`;
  window.__boardBench = { runs: RUNS, frameMs: FRAME_MS, info, results, worstFullMedian: worstFull, worstFullMax: worstMax, fast, userAgent: navigator.userAgent };
}

// @complexity time=O(k·r·p) space=O(p) cc=2
async function main() {
  await adoptAppStyle();
  const base = buildBigBoard();
  const d = describeBoard(base);
  const info = `${d.rows}마디 × ${base.cols}카운트 · 동작 ${d.groups}개 · 가장 깊은 ${d.maxLayers}층 (약속: ${BIG_BOARD.rows} · ${BIG_BOARD.groups} · ${BIG_BOARD.maxLayers})`;
  $('benchInfo').textContent = info;

  const store = createStore();
  store.setBoard(BOARD_MAIN, { rows: base.rows, cols: base.cols, placements: base.placements });
  const view = createBoardView({
    el: $('board'),
    boardId: BOARD_MAIN,
    noteRoot: () => $('mainBoardWrap'),
    getViewDeps: () => store.viewDeps(BOARD_MAIN),
    getDrag: () => null
  });
  view.renderAll(true);

  const run = async () => {
    $('benchRun').disabled = true;
    $('benchStatus').textContent = '재는 중…';
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    // 첫 바퀴는 JIT 데우기 — 버린다
    runBench(store, view, base);
    show(runBench(store, view, base), info);
    $('benchStatus').textContent = `끝 — ${new Date().toLocaleTimeString()}`;
    $('benchRun').disabled = false;
  };
  $('benchRun').addEventListener('click', run);
  await run();
}

main().catch(err => {
  $('benchStatus').textContent = `실패: ${err.message}`;
  window.__boardBench = { error: String(err && err.stack || err) };
});
