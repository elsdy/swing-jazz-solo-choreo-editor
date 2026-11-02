// src/ui/onceHint.js — 「처음 한 번」 안내 (ui 계층, RM-19)
//
// 늘 떠 있던 안내 문장을 걷으면서(ui/guideLines.js) 그 설명이 사라지지 않게 두는 자리다 — 그 단계를 **처음
// 쓸 때 한 번만** 말풍선으로 뜨고, 본 기록은 이 브라우저에만 남는다(안무표 파일에는 넣지 않는다 — 안무가
// 아니라 이 브라우저의 취향이다. 단축키 · 테마와 같은 규약). `⚙ 설정` 의 `처음 한 번 안내 다시 보기` 가
// 기록을 비워 되살린다. RM-26(첫 실행 코치마크)이 이 틀 위에 얹는다.
//
// ⚠ 두 조각으로 나뉜다 — 「본 적 있는가」를 가르는 createOnceHints 는 DOM 을 모르고(시험이 가짜 kv 로 잰다),
//   말풍선을 그리는 createHintBubble 만 문서를 만진다. 조립부가 둘을 잇는다.
// ⚠ 문장의 주인은 아래 ONCE_HINTS 표 하나다. 기능 설명서 · 튜토리얼이 이 문장을 인용하면
//   tools/check-docs 가 여기서 찾는다(src/ 의 문자열 리터럴을 긁는다).

import { str } from '../domain/strings.js';

/**
 * 단계(열쇠)마다 처음 한 번 뜨는 안내 문장. 걷어 낸 `.helper` 열넷의 설명이 여기로 왔다.
 * 열쇠는 화면의 자리다 — step1~step3 은 영상 패널의 차례 ①②③, step4~step6 은 도구 탭(구간 잡고 잘라내기 · 마커 · 자세 분석 — RM-20 이 열쇠를 그대로 두었다), practice 는 연습 조작 줄,
 * routine · category · file 은 사이드바 서랍.
 * @type {Readonly<Record<string, string>>}
 */
export const ONCE_HINTS = Object.freeze({
  step1: '영상을 고르면 여기 쌓입니다. 같은 안무를 여러 번 찍었으면 영상마다 박자와 마커가 따로 살고, 줄을 누르면 그 영상으로 갈아탑니다.',
  step2: '`탭` 을 박자에 맞춰 네 번 이상 두드리고 `탭으로 BPM 정하기`. 세로선이 어긋나면 아래 「세로선이 어긋날 때」 칸을 열어, 박자가 딱 떨어지는 두 순간에 `지금 여기` 를 누릅니다 — 두 지점은 멀수록 정확합니다. 템포가 흔들리는 영상은 같은 칸의 보정점으로 구간마다 맞춥니다.',
  step3: '`⏮ 처음으로` 로 되감고, 안무가 시작하는 순간 `▮ 끊기`(`K` 나 `B`)를 누르세요 — 처음 누른 자리가 1카운트입니다. 그 뒤로는 동작이 바뀌는 자리마다 한 번씩 누르면 그 사이가 이름 없는 블록(`?`)으로 놓입니다. 누른 자리는 두 카운트 격자(1·3·5·7박)에 붙습니다. 안무가 아닌 대목은 `건너뛰기`(`N`), 스페이스로 재생을 멈췄다 이어 가고, 다 되면 `■ 그만`(`Esc`). 받는 동안 마이크에 동작 이름을 말하면 그때 열려 있던 구간에 붙습니다.',
  // 찍는 법 첫 문장은 문자열 표(RM-10)의 것 — 단추 글자를 표가 인용하므로 개명을 따라간다.
  step4: str('video.inout.empty') + ' `✂ 잘라서 새 클립으로` 는 그 구간만 남긴 새 파일을 만들고 원본은 그대로 둡니다. 거꾸로 안무표에서 블록을 고르고 `🎞 고른 대목 잘라 내보내기` 를 누르면 그 대목의 초를 박자로 계산해 잘라 냅니다.',
  step5: 'In~Out 을 찍은 뒤, 안무표에서 그 구간에 해당하는 블록을 선택하고 `선택한 블록에 맵핑` 을 누르면 영상 구간과 안무표 구간이 짝지어집니다. 블록을 고르지 않았으면 `이 마디에 맵핑` 이 왼쪽 `마디` 칸에서 고른 마디 전체에 맵핑합니다.',
  step6: '`▶ 따라 그리기` 는 재생하면서 그 프레임의 관절을 그 자리에서 찾아 그립니다. 가동 범위 · 가속도 요약은 `🧍 자세 분석` 으로 구간을 미리 분석해야 합니다 — In~Out 을 찍어 두었으면 그 구간만, 아니면 영상 전체를 봅니다.',
  practice: '마디를 골라 `마디 반복`, 또는 안무표에서 블록을 고르고 `고른 블록 반복` 을 누르면 그 구간이 되풀이됩니다. `🔁 반복` 을 켜면 끝에서 처음으로 되감습니다.',
  routine: '루틴을 드래그해서 안무표에 배치하거나, ✏ 버튼으로 편집하세요.',
  category: '동작 카테고리는 팔레트에서 바로 수정되고, 카테고리 이름을 바꾸면 전체 UI에 반영됩니다.',
  file: '내보낸 파일에는 안무표 크기, 카테고리 색상, 동작 목록, 배치 상태가 모두 포함됩니다. 내보내기·불러오기 버튼은 맨 위 줄의 파일 메뉴에 있습니다.'
});

/**
 * 「본 적 있는가」의 주인. 본 열쇠의 목록을 kv(load/save)에 두고, present 로 말풍선을 띄운다.
 * @param {{
 *   load: () => string[],
 *   save: (seen: string[]) => void,
 *   present?: (key: string, text: string) => void,
 *   hints?: Readonly<Record<string, string>>
 * }} deps
 *   load/save: 어댑터(localStore 의 loadOnceHints · saveOnceHints). 시험은 가짜 kv 를 준다.
 *   present: 말풍선을 그리는 쪽(createHintBubble().show). 없으면 기록만 한다.
 * @returns {{ show(key: string): boolean, seen(key: string): boolean, reset(): void, seenKeys(): string[] }}
 */
// @complexity time=O(k) space=O(k) cc=6
export function createOnceHints(deps) {
  const { load, save, present = () => {}, hints = ONCE_HINTS } = deps;
  const seenSet = new Set(Array.isArray(load()) ? load() : []);

  /** 이 열쇠의 안내를 본 적 있는가. 모르는 열쇠는 「본 것」으로 친다 — 뜰 문장이 없다. */
  function seen(key) {
    return !(key in hints) || seenSet.has(key);
  }

  /**
   * 처음이면 띄우고 기록한다. 두 번째부터는 아무 일도 없다.
   * @returns {boolean} 띄웠는가
   */
  function show(key) {
    if (seen(key)) return false;
    seenSet.add(key);
    save([...seenSet]);
    present(key, hints[key]);
    return true;
  }

  /** 본 기록을 비운다 — `처음 한 번 안내 다시 보기`. 다음에 그 단계를 열면 다시 뜬다. */
  function reset() {
    seenSet.clear();
    save([]);
  }

  return { show, seen, reset, seenKeys: () => [...seenSet] };
}

/**
 * 말풍선 하나. 앵커(단계의 머리) 바로 아래에 끼워 넣고, `알겠어요` 나 바깥 누름으로 닫는다. 한 번에 하나만 떠 있다.
 * ⚠ 앵커가 `<details>` 면 `<summary>` 다음 자리에 끼운다 — 접힌 단계의 몸통 안에 두면 보이지 않는다.
 * @param {{ doc?: Document, resolveAnchor: (key: string) => Element|null }} deps
 * @returns {{ show(key: string, text: string): void, close(): void }}
 */
// @complexity time=O(1) space=O(1) cc=9
export function createHintBubble(deps) {
  const doc = deps.doc || document;
  const { resolveAnchor } = deps;
  /** @type {HTMLElement|null} */
  let bubble = null;

  function close() {
    if (bubble) bubble.remove();
    bubble = null;
  }

  function show(key, text) {
    close();
    const anchor = resolveAnchor(key);
    if (!anchor || !text) return;
    bubble = doc.createElement('div');
    bubble.className = 'once-hint';
    bubble.dataset.hint = key;
    bubble.setAttribute('role', 'note');
    const body = doc.createElement('span');
    body.className = 'once-hint-text';
    body.textContent = text;
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.className = 'once-hint-ok';
    ok.textContent = '알겠어요';
    ok.onclick = close;
    bubble.append(body, ok);
    const summary = anchor.tagName === 'DETAILS' ? anchor.querySelector(':scope > summary') : null;
    if (summary) summary.insertAdjacentElement('afterend', bubble);
    else anchor.insertAdjacentElement('afterbegin', bubble);
  }

  return { show, close };
}
