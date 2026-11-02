// src/ui/coachmarks.js — 처음 한 번 뜨는 안내 말풍선 3장 (ui 계층, 2026-11-02 · RM-26)
//
// 처음 켠 사람이 빈 격자 앞에서 멈추지 않게 **다음에 누를 자리**를 차례로 짚는다. ① 채우기 줄 → ② 동작 목록
// → ③ 영상. 한 번 끝까지 보거나 건너뛰면 본 기록이 서고 다시 뜨지 않는다. ⚙ 설정의 「안내 다시 보기」가
// 그 기록을 지운다.
//
// 둘로 나뉜다.
//   · createCoachFlow — 차례와 본 기록만 아는 **순수 흐름**. DOM 이 없어 node 시험이 그대로 돌린다.
//   · createCoachmarks — 그 흐름을 말풍선으로 그린다. 말풍선은 **대상 요소의 id** 로 붙는다(자리가 아니라) —
//     RM-20 · RM-36 이 마크업을 옮겨도 id 가 남아 있으면 그대로 따라간다.
//
// ⚠ ui 는 localStorage 를 모른다(check-arch). 본 기록의 읽고 쓰기는 adapters/localStore 의 것을 app/main 이 주입한다.
// ⚠ 3장의 차례 · 문구 · 대상 id 의 주인은 아래 COACHMARKS 표 하나다. 화면 코드에 손으로 적지 않는다.

/**
 * @typedef {{
 *   id: string,          표에서의 이름
 *   target: string,      말풍선이 붙는 요소의 id
 *   title: string,
 *   text: string,
 *   when?: (ctx: {hasPlacements: boolean}) => boolean   이 장을 낼 조건. 없으면 늘 낸다
 * }} Coachmark
 */

/** @type {readonly Coachmark[]} */
export const COACHMARKS = Object.freeze([
  Object.freeze({
    id: 'fill',
    target: 'modeBar',
    title: '① 채우기 줄',
    text: '안무표를 채우는 길이 여기 모여 있습니다. 처음이면 격자 안의 예제 열기 로 결과물부터 보고, 영상을 보며 받아 적으려면 ▶ 영상으로 채우기 를 누릅니다.',
    // 되살린 안무표가 이미 있으면 「무엇으로 채울까」는 지난 이야기다 — ② 부터 낸다.
    when: (ctx) => !ctx.hasPlacements
  }),
  Object.freeze({
    id: 'palette',
    target: 'paletteSearch',
    title: '② 동작 목록',
    text: '동작 카드를 격자에 끌어다 놓습니다. 없는 동작은 바로 아래 목록에 없는 동작 만들기 에서 만듭니다.'
  }),
  Object.freeze({
    id: 'video',
    target: 'videoPanelBtn',
    title: '③ 영상',
    text: '참고 영상을 붙이고 박자를 맞추면, 재생하면서 동작이 시작하는 자리를 찍어 안무표에 놓을 수 있습니다.'
  })
]);

/**
 * 순수 흐름 — 본 기록과 차례만 안다.
 *
 * @param {{
 *   steps?: readonly Coachmark[],
 *   seen: { load: () => boolean, save: (seen: boolean) => void },
 *   context?: () => {hasPlacements: boolean}
 * }} deps
 * @returns {{
 *   start(): Coachmark|null, next(): Coachmark|null, skip(): void, reset(): void,
 *   current(): Coachmark|null, running(): boolean, total(): number
 * }}
 *   start — 본 기록이 있으면 null, 없으면 첫 장(조건에 걸리는 장은 건너뛴다).
 *   next  — 다음 장, 마지막이었으면 본 기록을 남기고 null.
 *   skip  — 지금 어디든 끝낸다(본 기록을 남긴다).
 *   reset — 본 기록을 지운다. 다음 start 가 첫 장부터 낸다.
 *   total — 이번에 낼 장 수(조건으로 건너뛴 장은 뺀다). 말풍선의 「1 / 3」 이 이것을 쓴다.
 */
// @complexity time=O(k) space=O(1) cc=3
export function createCoachFlow({ steps = COACHMARKS, seen, context = () => ({ hasPlacements: false }) }) {
  let queue = [];
  let cur = null;
  let count = 0;

  // @complexity time=O(k) space=O(k) cc=2
  function eligible() {
    const ctx = context();
    return steps.filter(s => typeof s.when !== 'function' || s.when(ctx));
  }

  // @complexity time=O(1) space=O(1) cc=2
  function finish() {
    queue = [];
    cur = null;
    seen.save(true);
  }

  return {
    // @complexity time=O(k) space=O(k) cc=3
    start() {
      if (seen.load()) return null;
      queue = eligible();
      count = queue.length;
      cur = queue.shift() || null;
      if (!cur) finish();
      return cur;
    },
    // @complexity time=O(1) space=O(1) cc=3
    next() {
      if (!cur) return null;
      cur = queue.shift() || null;
      if (!cur) finish();
      return cur;
    },
    // @complexity time=O(1) space=O(1) cc=1
    skip() { finish(); },
    // @complexity time=O(1) space=O(1) cc=1
    reset() { queue = []; cur = null; seen.save(false); },
    current() { return cur; },
    running() { return cur !== null; },
    total() { return count; }
  };
}

const STYLE_ID = 'coachmarks-style';
const CSS = `
.coachmark { position: fixed; z-index: 7000; max-width: min(320px, calc(100vw - 32px));
  padding: 10px 12px; border-radius: var(--r-2); background: var(--bg-2); color: var(--text);
  border: 1px solid rgba(var(--accent-rgb), 0.55); box-shadow: var(--shadow);
  font-size: var(--fs-2); line-height: 1.5; }
.coachmark[hidden] { display: none; }
.coachmark b { display: block; font-size: var(--fs-3); margin-bottom: 3px; color: var(--text); }
.coachmark p { margin: 0 0 8px; }
.coachmark-row { display: flex; gap: 6px; align-items: center; }
.coachmark-row .coachmark-count { font-size: var(--fs-1); color: var(--muted); flex: 1; }
.coachmark-row button { font-size: var(--fs-2); padding: 3px 10px; }
/* 코치마크가 가리키는 대상만 숨 쉰다 — btnInvite 는 이제 여기서만 쓴다(RM-26). */
[data-coach="1"] { animation: btnInvite 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { [data-coach="1"] { animation: none; box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.25); } }
`;

/**
 * 말풍선을 그린다. 대상은 id 로 찾고, 안 보이는 대상(접힌 사이드바 · 숨은 버튼)이면 화면 가운데 띄운다.
 *
 * @param {{
 *   flow: ReturnType<typeof createCoachFlow>,
 *   doc?: Document,
 *   byId?: (id: string) => HTMLElement|null
 * }} deps
 * @returns {{ start(): boolean, next(): void, skip(): void, replay(): void, element: HTMLElement }}
 */
// @complexity time=O(1) space=O(1) cc=4
export function createCoachmarks({ flow, doc = document, byId = (id) => doc.getElementById(id) }) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const box = doc.createElement('div');
  box.className = 'coachmark';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '처음 한 번 안내');
  box.hidden = true;
  box.innerHTML = `
    <b data-role="title"></b>
    <p data-role="text"></p>
    <div class="coachmark-row">
      <span class="coachmark-count" data-role="count"></span>
      <button class="ghost" type="button" data-act="skip">건너뛰기</button>
      <button class="primary" type="button" data-act="next">다음</button>
    </div>`;
  doc.body.appendChild(box);
  const titleEl = box.querySelector('[data-role="title"]');
  const textEl = box.querySelector('[data-role="text"]');
  const countEl = box.querySelector('[data-role="count"]');
  const nextBtn = box.querySelector('[data-act="next"]');

  let target = null;
  let shown = 0;

  // @complexity time=O(1) space=O(1) cc=2
  function unmark() {
    if (target) delete target.dataset.coach;
    target = null;
  }

  /** 대상 바로 아래(안 들어가면 위)에 붙인다. 폰에서는 엄지 바를 피해 화면 아래 24px 안쪽에 둔다. */
  // @complexity time=O(1) space=O(1) cc=8
  function place(el) {
    const win = doc.defaultView;
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const bw = box.offsetWidth || 280;
    const bh = box.offsetHeight || 120;
    const vw = win.innerWidth, vh = win.innerHeight;
    // 크기가 있어도 화면 밖이면 안 보이는 것이다 — 폰에서 닫힌 `≡ 동작` 시트 속 검색칸이 그렇다(말풍선이 화면 밖에 떴다).
    const visible = r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
    if (!visible) {
      box.style.left = `${Math.max(16, (vw - bw) / 2)}px`;
      box.style.top = `${Math.max(16, (vh - bh) / 2)}px`;
      return;
    }
    const left = Math.min(Math.max(16, r.left), vw - bw - 16);
    const below = r.bottom + 8;
    const top = Math.min(below + bh <= vh - 24 ? below : Math.max(16, r.top - bh - 8), Math.max(16, vh - bh - 24));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  // @complexity time=O(1) space=O(1) cc=3
  function show(step) {
    unmark();
    if (!step) { box.hidden = true; return; }
    shown += 1;
    titleEl.textContent = step.title;
    textEl.textContent = step.text;
    const total = flow.total();
    countEl.textContent = `${shown} / ${total}`;
    nextBtn.textContent = shown >= total ? '끝' : '다음';
    target = byId(step.target);
    if (target) {
      target.dataset.coach = '1';
      if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
    }
    box.hidden = false;
    place(target);
  }

  box.addEventListener('click', (e) => {
    const act = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!act) return;
    if (act.dataset.act === 'skip') { flow.skip(); show(null); return; }
    show(flow.next());
  });
  doc.defaultView.addEventListener('resize', () => { if (!box.hidden) place(target); });

  // @complexity time=O(1) space=O(1) cc=2
  function start() {
    shown = 0;
    const first = flow.start();
    if (!first) return false;
    show(first);
    return true;
  }

  return {
    start,
    next() { show(flow.next()); },
    skip() { flow.skip(); show(null); },
    /** 「안내 다시 보기」 — 본 기록을 지우고 첫 장부터 바로 띄운다. */
    replay() { flow.reset(); start(); },
    element: box
  };
}
