// src/adapters/browser.js — 브라우저 원시 기능 한 파일 (adapters 계층)
//
// 원본 index.html 의 uid(1696-1698) · prompt 3곳(3186·3266·4678) · alert 11곳 ·
// downloadJson(4182-4192) · handle*Import 4벌의 공통 껍데기(4389·4408·4427·4453) ·
// 링크바 700ms 디바운스(5221-5243) · 롱프레스 2벌(3229-3244 480ms / 3932-3944 180ms)을 옮겼다.
// adapters 는 브라우저 전역을 만져도 되는 유일한 계층이다 — usecases 는 여기서 만든 객체를 주입받는다.

/** @typedef {import('../ports/env.js').Env} Env */
/** @typedef {import('../ports/env.js').Dialogs} Dialogs */
/** @typedef {import('../ports/storage.js').FileGateway} FileGateway */

// ─────────────────────────────────────────────────────────────────────────────
// Env — 난수와 시계
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 원본 uid(1696-1698)와 Date.now()의 어댑터.
 * ⚠ uid 의 식은 원문 그대로다. `slice(2, 10)` / `slice(-4)` 를 한 글자라도 바꾸면
 *   기존 프로젝트 파일과 id 모양이 달라진다(길이 12, 앞 8자 난수 + 뒤 4자 시각).
 * @see index.html:1696
 * @type {Env & { nowIso: () => string }}
 */
export const browserEnv = {
  uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  },
  now() {
    return Date.now();
  },
  /**
   * ISO 문자열 시각. 원본이 `new Date().toISOString()` 을 쓰는 6곳(4039·4051·4061·4396·4438·5276)의 자리다.
   * ⚠ Env typedef 밖의 확장 멤버다 — usecases 는 Date 를 쓸 수 없어 number → ISO 변환을 스스로 못 한다.
   *   결정적 테스트에서는 counterEnv 를 `{ ...counterEnv(), nowIso: () => '2024-01-01T00:00:00.000Z' }`
   *   처럼 감싸서 넘겨라(counterEnv 에는 이 멤버가 없다).
   */
  nowIso() {
    return new Date().toISOString();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Dialogs — prompt / alert / confirm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 대화상자의 얇은 껍데기. 문구는 전부 호출부(유스케이스)가 만든다.
 * ⚠ confirm 은 계약을 채우려고 붙였을 뿐 오늘 호출부가 0곳이다. 확인 UX 는 ui/widgets 의
 *   confirmOnce(원본 1700-1714, 버튼 라벨을 2초간 '정말요?'로 바꾸는 위젯)가 맡는다 —
 *   confirmOnce 를 이걸로 바꾸면 동작이 바뀐다.
 * @see index.html:3186 prompt('동작 이름 변경', move.name)
 * @see index.html:3266 prompt('카테고리 키 변경', move.category)
 * @see index.html:4678 prompt('루틴 이름', routine.name)
 * @type {Dialogs}
 */
export const browserDialogs = {
  promptText(message, defaultValue = '') {
    return window.prompt(message, defaultValue);
  },
  alert(message) {
    window.alert(message);
  },
  confirm(message) {
    return window.confirm(message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FileGateway — 내려받기 / 파일 읽기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 파일 내려받기와 <input type="file"> 읽기.
 * ⚠ ports/storage.js 의 FileGateway typedef 는 Promise 반환이지만 downloadJson 은 오늘과 같이
 *   동기다. 원본 saveProjectFile(4038-4045)은 내려받기 → localStorage.setItem → renderSavedList 를
 *   한 틱 안에서 수행한다. Promise 로 바꾸면 setItem 이 마이크로태스크 뒤로 밀려 실행 순서가 달라진다.
 */
export const browserFileIO = {
  /**
   * 원본 downloadJson(4182-4192) 그대로. 들여쓰기 2칸 JSON, a 엘리먼트 클릭, 즉시 revoke.
   * @see index.html:4182
   * @param {unknown} payload
   * @param {string} filename
   * @returns {void}
   */
  downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * File → 파싱된 JSON. 원본 `file.text().then(text => JSON.parse(text))` 부분만 떼어낸 것이다.
   * ⚠ 파싱 실패를 StorageError('CORRUPT')로 감싸지 않고 JSON.parse 가 던진 SyntaxError 를 그대로
   *   흘려보낸다 — 오늘 호출부의 `catch { alert(...) }` 가 오류 종류를 보지 않기 때문이고,
   *   이번 PR 은 StorageError 를 아무도 던지지 않는 상태가 정답이다.
   * @param {{ text: () => Promise<string> }} file
   * @returns {Promise<unknown>}
   */
  readJsonFile(file) {
    return file.text().then(text => JSON.parse(text));
  },

  /**
   * handle*Import 4벌(4389·4408·4427·4453)의 공통 껍데기.
   * 원본 순서를 글자 그대로 지킨다:
   *   ① files?.[0] 이 없으면 즉시 반환(이때 value 는 비우지 않는다)
   *   ② file.text() → JSON.parse → onData(data, file)  ─ 셋이 **같은 try 안**이다
   *   ③ 던지면 onError() — ⚠ onData 안에서 난 오류까지 여기로 잡힌다. 오늘 임포트가
   *      쿼터 초과(setItem)나 렌더 오류를 '올바른 프로젝트 파일이 아닙니다.'로 표시하는 이유다
   *   ④ input.value = '' 는 then 을 건 **직후 동기**로 실행된다(같은 파일 재선택을 가능하게 한다)
   * @see index.html:4389
   * @param {HTMLInputElement|{files: FileList|null, value: string}} input `e.target`
   * @param {(data: unknown, file: File) => void} onData
   * @param {() => void} onError 원본의 alert 한 줄. 문구는 임포트 종류마다 다르다
   * @returns {void}
   */
  readJsonFromInput(input, onData, onError) {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then(text => {
      try {
        const data = JSON.parse(text);
        onData(data, file);
      } catch {
        onError();
      }
    });
    input.value = '';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 타이머 헬퍼 — 디바운스 / 롱프레스
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 원본 링크바의 `let ytTimer` + clearTimeout/setTimeout 쌍(5221-5243)을 그대로 감싼 것.
 * ⚠ cancel() 이 따로 필요한 이유: 원본은 입력마다 **먼저** clearTimeout 을 부르고
 *   그 다음 빈 URL 이면 예약 없이 반환한다(5227-5229). 호출부는 같은 순서로 써야 한다.
 *   호출부(ui/linksBarView)가 700ms 를 소유한다 — 어댑터에는 상수를 두지 않는다.
 * @see index.html:5221
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} waitMs
 * @returns {F & { cancel: () => void, pending: () => boolean }}
 */
export function debounce(fn, waitMs) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  wrapped.pending = () => timer !== null;
  return /** @type {any} */ (wrapped);
}

/**
 * 터치 롱프레스. 원본에 두 벌이 있고 **규칙이 다르다** — 값은 현행 그대로 옵션으로 뺀다.
 *
 *   팔레트 칩 드래그(3932-3944): delayMs 180, 이동 취소 **없음**, touchstart 에서 이전 타이머를
 *     지우지 않는다(3934 가 pressTimer 를 그냥 덮어쓴다).
 *   동작 메뉴(3229-3244)   : delayMs 480, 8px 넘게 움직이면 취소, touchstart 에서 clearTimer() 먼저.
 *
 * onLongPress 는 **touchstart 시점의 좌표**를 받는다(두 원본 모두 touchstart 의 Touch 객체를
 * 클로저로 잡아 두었다가 콜백 안에서 읽는다).
 * 타이머는 touchend/touchcancel 에서 해제된다. 드롭 처리 같은 후속 로직은 호출부가 자기
 * touchend 리스너를 따로 붙인다(원본과 실행 순서가 같다 — 해제가 먼저다).
 * @see index.html:3229
 * @see index.html:3932
 * @param {EventTarget} target
 * @param {{
 *   delayMs: number,
 *   moveTolerancePx?: number|null,
 *   resetOnStart?: boolean,
 *   onLongPress: (hit: { x: number, y: number, touch: Touch, event: TouchEvent }) => void
 * }} options
 * @returns {{ cancel: () => void, dispose: () => void }}
 */
export function longPress(target, options) {
  const { delayMs, moveTolerancePx = null, resetOnStart = false, onLongPress } = options;
  let timer = null;
  let startX = 0;
  let startY = 0;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onTouchStart = (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    if (resetOnStart) clearTimer();
    timer = setTimeout(() => {
      onLongPress({ x: touch.clientX, y: touch.clientY, touch, event: e });
    }, delayMs);
  };

  const onTouchMove = (e) => {
    if (!timer) return;
    const touch = e.touches[0];
    if (Math.abs(touch.clientX - startX) > moveTolerancePx
      || Math.abs(touch.clientY - startY) > moveTolerancePx) clearTimer();
  };

  target.addEventListener('touchstart', onTouchStart, { passive: true });
  // ⚠ moveTolerancePx 가 null 이면 touchmove 리스너를 아예 붙이지 않는다 — 팔레트 칩(3947)은
  //   같은 이벤트에 { passive: false } 로 preventDefault 하는 자기 리스너를 붙이므로,
  //   여기서 아무 일도 안 하는 리스너를 하나 더 얹지 않는다.
  if (moveTolerancePx !== null) target.addEventListener('touchmove', onTouchMove, { passive: true });
  target.addEventListener('touchend', clearTimer);
  target.addEventListener('touchcancel', clearTimer);

  return {
    cancel: clearTimer,
    dispose() {
      clearTimer();
      target.removeEventListener('touchstart', onTouchStart);
      if (moveTolerancePx !== null) target.removeEventListener('touchmove', onTouchMove);
      target.removeEventListener('touchend', clearTimer);
      target.removeEventListener('touchcancel', clearTimer);
    }
  };
}
