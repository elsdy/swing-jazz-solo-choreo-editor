// src/ui/thumbBar.js — 폰에서 지금 할 일을 화면 맨 아래에 고정한다 (ui 계층)
//
// 신설 파일이다(2026-09-20). 폰에는 키보드가 없다 — `B`·`K`(끊기) · `N`(건너뛰기) ·
// `스페이스`(재생) · `Esc`(그만) 로 하던 일이 전부 손가락으로 와야 하는데, 그 버튼들은 영상 패널의
// `③ 받아 적기` 안쪽에 있어 스크롤해야 닿았다. 영상을 보며 눌러야 하는 버튼이 화면 밖에
// 있는 셈이라, 폰에서 받아 적기는 사실상 못 쓰는 기능이었다.
//
// ⚠ **여기에만 있는 기능은 없다.** 전부 이미 있는 진입점과 같은 것을 부른다 — 길을 하나 더
//   만든 것이 아니라 엄지가 닿는 자리로 옮긴 것이다. 새 커맨드를 여기서 만들지 마라.
// ⚠ 화면은 CSS 가 정한다. 이 파일은 **무엇을 보일지**만 정하고 `display` 를 건드리지 않는다 —
//   폰이 아닌 폭에서는 `.thumb-bar { display: none }` 이라 만들어 둬도 보이지 않는다.
// ⚠ `<body data-capturing>` 은 이 뷰가 켜고 끈다. CSS 가 그것을 읽어 받는 동안 화면을 비운다
//   (영상 패널의 단계·캔버스 바의 조작을 접는다). 다른 곳에서 만지지 마라.

/**
 * 한 자리에 놓을 버튼. `main` 은 그 순간의 주 동작이라 넓고 밝게 그린다.
 * @typedef {{ id: string, label: string, title?: string, cls?: string, main?: boolean, disabled?: boolean, run: () => void }} ThumbAction
 */

/**
 * @param {{
 *   elements?: Record<string, HTMLElement|null>,
 *   getState: () => { panelOpen: boolean, capturing: boolean, canCapture: boolean, sheetOpen: boolean },
 *   actions: {
 *     openPanel: () => void,
 *     togglePlay: () => void,
 *     capture: () => void,
 *     skip: () => void,
 *     stop: () => void,
 *     toggleSheet: () => void,
 *     quickPlace: () => void
 *   }
 * }} options
 * @returns {{ render(): void }}
 */
export function createThumbBar(options) {
  const { elements = {}, getState, actions } = options;
  const byId = (id) => (id in elements ? elements[id] : document.getElementById(id));
  const doc = (byId('thumbBar') && byId('thumbBar').ownerDocument) || document;

  const bar = byId('thumbBar');

  /**
   * 지금 화면에 놓을 것. **세 상태뿐이다** — 받는 중 / 영상은 열렸고 받기 전 / 영상이 닫힘.
   * 상태마다 버튼이 서넛을 넘지 않게 한다. 엄지로 고르는 자리라 다섯이 넘으면 하나도 안 읽힌다.
   * @returns {ThumbAction[]}
   */
  function plan() {
    const st = getState();

    if (st.capturing) {
      // 받는 중 — 이 셋 말고는 누를 일이 없다. `끊기` 가 주 동작이다.
      return [
        { id: 'play', label: '⏯', title: '재생·일시정지', cls: 'ghost', run: actions.togglePlay },
        { id: 'cut', label: '▮ 끊기', title: '동작이 바뀌는 자리', cls: 'warn', main: true, run: actions.capture },
        { id: 'skip', label: '건너뛰기', title: '여기까지는 안무가 아니다', cls: 'ghost', run: actions.skip },
        { id: 'stop', label: '■ 그만', title: '받아 적기를 끝낸다', cls: 'ghost', run: actions.stop }
      ];
    }

    if (st.panelOpen) {
      // 영상은 열렸고 아직 안 받는다 — 박자가 없으면 받기를 못 누른다(까닭은 패널이 적는다).
      return [
        { id: 'sheet', label: '≡ 동작', title: '동작 목록을 연다', cls: 'ghost', run: actions.toggleSheet },
        { id: 'play', label: '⏯', title: '재생·일시정지', cls: 'ghost', run: actions.togglePlay },
        {
          id: 'start',
          label: '● 받아 적기',
          title: st.canCapture ? '여기서부터 받는다' : '먼저 ② 박자 맞추기에서 BPM 을 정하세요',
          cls: 'primary',
          main: true,
          disabled: !st.canCapture,
          run: actions.capture
        }
      ];
    }

    // 영상이 닫혀 있다 — 아직 아무것도 안 정한 상태다.
    // ⚠ 주 동작은 `≡ 동작` 이 아니라 **`▶ 영상으로 채우기`** 다. 손으로 놓는 길은 격자를 보면
    //   짐작이 되지만 영상에서 받아 적는 길은 누르기 전에는 있는 줄도 모른다 — 안 보이는 쪽을
    //   크게 둔다. 캔버스 바에도 같은 버튼이 첫 자리에 있다(눈이 가는 자리와 엄지가 닿는 자리).
    return [
      { id: 'sheet', label: '≡ 동작', title: '동작 목록을 연다', cls: 'ghost', run: actions.toggleSheet },
      { id: 'quick', label: '+ 빠른 배치', title: '격자를 눌러 고르며 놓는다', cls: 'ghost', run: actions.quickPlace },
      { id: 'video', label: '▶ 영상으로 채우기', title: '영상을 보며 동작이 바뀌는 자리를 찍는다', cls: 'primary', main: true, run: actions.openPanel }
    ];
  }

  /**
   * 다시 그린다. **버튼을 통째로 갈아 끼우지 않는다** — 같은 id 가 남아 있으면 그 자리를 고쳐 쓴다.
   * 누르는 순간에 엘리먼트가 사라지면 그 탭이 허공에 떨어지고, 폰에서는 그것이 「안 눌린다」로 보인다.
   */
  function render() {
    if (!bar) return;
    const items = plan();
    const st = getState();

    // 받는 동안은 화면이 비워진다(CSS 가 읽는다). 이 표식의 주인은 여기 하나다.
    doc.body.dataset.capturing = st.capturing ? 'on' : 'off';

    const keep = new Map();
    for (const el of [...bar.children]) keep.set(el.dataset.act, el);

    const next = [];
    for (const item of items) {
      let btn = keep.get(item.id);
      if (!btn) {
        btn = doc.createElement('button');
        btn.type = 'button';
        btn.dataset.act = item.id;
      }
      keep.delete(item.id);
      btn.className = item.cls || 'ghost';
      btn.textContent = item.label;
      btn.title = item.title || '';
      btn.disabled = Boolean(item.disabled);
      // ⚠ onclick 이다(addEventListener 가 아니다) — 다시 그릴 때마다 붙이면 한 번 누른 것이
      //   두 번 세 번 돌아간다. 대입은 언제나 마지막 하나만 남는다.
      btn.onclick = item.run;
      if (item.main) btn.dataset.main = '1';
      else delete btn.dataset.main;
      next.push(btn);
    }
    for (const stale of keep.values()) stale.remove();
    // 순서가 바뀐 것만 옮긴다. append 는 이미 붙어 있는 노드를 제자리로 옮겨 준다.
    next.forEach((btn, i) => { if (bar.children[i] !== btn) bar.appendChild(btn); });

    bar.hidden = items.length === 0;
  }

  render();
  return { render };
}
