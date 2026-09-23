// src/ui/bpmBadge.js — 오른쪽 위 기준 박자 배지 (ui 계층)
//
// 신규 파일이다(2026-09-22). 사용자 요청: "BPM 은 오른쪽 상단에 표시를 해 줬으면 좋겠다 —
// 기준 박자는 어떤 식으로든 표시를 해 주니까."
//
// 왜 앱바인가: BPM 은 **초를 카운트로 바꾸는 유일한 기준**이다. 받아 적은 자리가 이상하거나
// 재생 헤드가 안 맞을 때 가장 먼저 의심할 값인데, 그전에는 `② 박자 맞추기` 를 펼쳐야만 보였다.
// 늘 보이는 자리에 두면 "표는 이상한데 박자는 맞나?" 를 눈으로 한 번에 답한다.
//
// 이 배지가 하는 일은 둘이다.
//   ① 지금 영상의 기준 박자를 적는다 (없으면 `박자 없음`).
//   ② 받아 적는 중에는 **속도 어긋남**을 꼬리말로 붙인다 (domain/captureDrift 의 판정).
//
// ⚠ **BPM 을 스스로 고치지 않는다.** 추정값은 "재 보니 이쯤" 까지만 말한다. 저절로 바꾸면
//   이미 놓인 블록이 통째로 어긋나고, 그건 사용자가 모르는 사이에 안무가 틀어지는 일이다.
// ⚠ 크기가 상태에 따라 변하지 않는다 — 숫자칸이 고정폭이다(index.html 의 `.bpm-badge` 주석).

import { isTempoUsable, normalizeTempo } from '../domain/tempo.js';
import { driftReport } from '../domain/captureDrift.js';
import { activeClipOf } from '../domain/project/media.js';

/** bpm 을 소수 한 자리까지만. 정수면 소수점을 붙이지 않는다(videoPanel 과 같은 규칙). */
function formatBpm(bpm) {
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * 판정 → 배지 아래 매달리는 꼬리말. 아무 말도 할 것이 없으면 빈 문자열이다.
 * 여기가 이 파일에서 유일하게 «말» 을 만드는 자리다 — 판정 자체는 domain 이 한다.
 * ⚠ 짧게 쓴다. 긴 설명은 title 로 가고, 「그래서 뭘 하면 되나」는 받아 적기 안내 줄이 맡는다.
 */
function noteOf(report) {
  if (report.state === 'fast' || report.state === 'slow') {
    const word = report.state === 'fast' ? '영상이 더 빠름' : '영상이 더 느림';
    return report.bpmEstimate ? `${word} ≈${formatBpm(report.bpmEstimate)}` : word;
  }
  if (report.state === 'lag') {
    // 치우친 방향을 말해 준다 — `표 전체 옮기기` 의 어느 버튼을 누를지가 여기서 갈린다.
    return report.mean > 0 ? '손이 늦음' : '손이 빠름';
  }
  return '';
}

/** 마우스를 올렸을 때 나오는 긴 설명. 짧은 꼬리말이 못 하는 말을 여기서 한다. */
function titleOf(tempo, ready, report) {
  if (!ready) return '아직 박자가 없습니다. 누르면 영상 패널의 `② 박자 맞추기` 로 갑니다.';
  const head = `기준 박자 ${formatBpm(tempo.bpm)} BPM · 1카운트 = ${tempo.beatsPerCount}박. 누르면 \`② 박자 맞추기\` 로 갑니다.`;
  if (report.state === 'fast' || report.state === 'slow') {
    const dir = report.state === 'fast' ? '빠릅니다' : '느립니다';
    const est = report.bpmEstimate ? ` 끊은 자리로 다시 재면 약 ${formatBpm(report.bpmEstimate)} BPM 입니다.` : '';
    return `${head}\n끊은 자리가 갈수록 밀립니다 — 영상이 이 값보다 ${dir}.${est} 여기서 저절로 바꾸지는 않습니다(이미 놓은 블록이 통째로 어긋납니다).`;
  }
  if (report.state === 'lag') {
    const dir = report.mean > 0 ? '늦게' : '일찍';
    return `${head}\n끊은 자리가 고르게 ${dir} 찍힙니다(평균 ${Math.abs(report.mean).toFixed(2)}카운트). 박자가 아니라 손의 문제이므로 \`표 전체 옮기기\` 로 고칩니다.`;
  }
  return head;
}

/**
 * @param {{
 *   store: { get: () => any },
 *   onOpenTempo?: () => void,
 *   elements?: Record<string, HTMLElement|null>
 * }} options
 * @returns {{ render(): void }}
 */
export function createBpmBadge(options) {
  const { store, onOpenTempo = () => {}, elements = {} } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));

  // ⚠ 상태(`data-bpm`·`data-drift`)는 **감싸개**가 쥔다. 꼬리말이 버튼 밖에 있기 때문이다 —
  //   전역 `button { overflow: hidden }`(누름 물결) 이 버튼 안의 떠 있는 것을 잘라 먹는다.
  const wrap = byId('bpmBadgeWrap');
  const root = byId('bpmBadge');
  const numEl = byId('bpmBadgeNum');
  const unitEl = byId('bpmBadgeUnit');
  const noteEl = byId('bpmBadgeNote');

  if (root) root.onclick = () => onOpenTempo();

  function render() {
    if (!root) return;
    const state = store.get();
    const tempo = normalizeTempo(activeClipOf(state.media).tempo);
    const ready = isTempoUsable(tempo);
    const video = state.session.video || {};
    // 받는 중일 때만 판정을 본다. 받아 적기를 끝내면 표본이 비므로 저절로 조용해진다.
    const report = driftReport(video.captureDrift, tempo.bpm);
    const note = ready ? noteOf(report) : '';

    if (numEl) numEl.textContent = ready ? formatBpm(tempo.bpm) : '박자 없음';
    if (unitEl) unitEl.hidden = !ready;
    if (noteEl) {
      noteEl.textContent = note;
      noteEl.hidden = !note;
    }
    if (wrap) {
      wrap.dataset.bpm = ready ? 'on' : 'off';
      // ⚠ dataset 키를 지울 때는 delete 다. 빈 문자열로 두면 `[data-drift]` 가 여전히 걸린다.
      if (ready && report.state !== 'ok' && report.state !== 'idle') wrap.dataset.drift = report.state;
      else delete wrap.dataset.drift;
    }
    root.title = titleOf(tempo, ready, report);
  }

  render();
  return { render };
}
