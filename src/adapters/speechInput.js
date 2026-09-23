// src/adapters/speechInput.js — 마이크로 받아 적기 (adapters 계층)
//
// 신규 파일이다(2026-09-22). 크롬의 Web Speech API(`webkitSpeechRecognition`)를 감싼다.
// 브라우저 전역을 만지는 자리이므로 어댑터다 — usecases·domain 은 이 파일을 모른다.
//
// **왜 브라우저 내장인가** (다른 길과 재 본 값, 2026-09-22):
//   첫 글자가 뜨기까지   내장 0.1~0.3초  ·  녹음→서버→Whisper 는 아예 안 뜬다
//   말 끝나고 확정까지   내장 0.3~1초    ·  Whisper 1.5~3초
// 그런데 속도보다 결정적인 것은 **시각**이다. 받아 적는 중에는 말이 끝났을 때 이미 다음 구간이
// 열려 있을 수 있어서, 말이 *끝난* 시각으로 붙이면 한 구간씩 밀린다. 내장 API 는 **중간 결과가
// 처음 도착한 순간**을 말의 시작으로 쓸 수 있어 그게 풀린다. 덩어리로 올리는 방식은 2초짜리
// 덩어리 안 어디에서 말이 시작됐는지 알려주지 않아 붙일 구간을 짐작해야 한다.
//
// ⚠ **음성은 구글로 간다.** 크롬이 그렇게 만들어져 있고 끌 수 없다. 이 저장소가 LLM 키를 서버에만
//   두는 것과 결이 다르므로, 화면이 켜기 전에 그 사실을 말한다(ui/videoPanel 의 안내 줄).
// ⚠ **조용하면 스스로 멈춘다.** 원하는 동안에는 다시 켜지만, 다시 켜지는 틈에 한마디를 놓칠 수
//   있다. 그래서 듣고 있는지 아닌지를 `onState` 로 늘 밖에 알린다 — 안 듣는 것을 모르는 것이
//   제일 나쁘다.
// ⚠ 어떤 함수도 던지지 않는다. 마이크 거절·미지원은 정상 경로이고 문구로 나간다.

/** 이 환경에 음성 인식이 있는가. 없으면 화면이 버튼을 아예 감춘다. */
export function speechAvailable(win = typeof window === 'undefined' ? null : window) {
  return Boolean(win && (win.SpeechRecognition || win.webkitSpeechRecognition));
}

/** 스스로 멈춘 뒤 다시 켜기까지. 0 이면 브라우저가 같은 프레임에 또 멈추는 일이 있었다. */
const RESTART_MS = 250;

/**
 * @typedef {object} Utterance
 * @property {string} text  인식된 글자
 * @property {boolean} final 확정인가(거짓이면 말하는 중의 중간 결과)
 * @property {number} startedAt 이 말의 **첫 중간 결과**가 도착한 시각. 호출부가 준 now() 의 단위다
 */

/**
 * @param {{
 *   win?: Window,
 *   lang?: string,
 *   now?: () => number,
 *   onUtterance?: (u: Utterance) => void,
 *   onState?: (s: {listening:boolean, wanted:boolean, error:string}) => void
 * }} [options]
 *   now: 말이 시작된 **시각을 무엇으로 셀지**를 호출부가 정한다. 받아 적기에서는 영상의 초를
 *        넘긴다 — 벽시계로 재면 재생을 멈췄다 이어 갈 때 구간과 어긋난다.
 * @returns {{
 *   available(): boolean, start(): void, stop(): void, toggle(): boolean,
 *   listening(): boolean, wanted(): boolean, error(): string, setLang(l:string): void
 * }}
 */
export function createSpeechInput(options = {}) {
  const win = options.win || (typeof window === 'undefined' ? null : window);
  const onUtterance = options.onUtterance || (() => {});
  const onState = options.onState || (() => {});
  const now = options.now || (() => 0);
  let lang = options.lang || 'ko-KR';

  const Ctor = win && (win.SpeechRecognition || win.webkitSpeechRecognition);
  /** @type {any} */ let rec = null;
  let wanted = false;          // 사용자가 켜 두었는가 (스스로 멈춘 것과 구별한다)
  let listening = false;
  let error = '';
  let startedAt = null;        // 지금 말하고 있는 한마디가 시작된 시각
  let restartTimer = null;

  function emitState() {
    onState({ listening, wanted, error });
  }

  function build() {
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;   // ⚠ 이것이 있어야 «말이 시작된 시각» 을 잡을 수 있다
    r.maxAlternatives = 1;

    r.onstart = () => { listening = true; error = ''; emitState(); };

    r.onresult = (ev) => {
      // ⚠ `resultIndex` 부터만 읽는다. 처음부터 읽으면 이미 확정된 말이 매번 다시 나온다.
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = String((res[0] && res[0].transcript) || '').trim();
        if (!text) continue;
        if (startedAt === null) startedAt = now();     // 이 한마디의 시작 — 붙일 구간이 여기서 정해진다
        onUtterance({ text, final: Boolean(res.isFinal), startedAt });
        if (res.isFinal) startedAt = null;
      }
    };

    r.onerror = (ev) => {
      const code = ev && ev.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        wanted = false;
        error = '마이크를 쓸 수 없습니다. 주소창 왼쪽 자물쇠에서 이 사이트의 마이크를 허용하세요.';
      } else if (code === 'audio-capture') {
        wanted = false;
        error = '마이크를 찾지 못했습니다.';
      } else if (code === 'network') {
        error = '음성 인식 서버에 닿지 못했습니다(인터넷이 필요합니다).';
      } else if (code !== 'no-speech' && code !== 'aborted') {
        error = `음성 인식이 멈췄습니다: ${code || '알 수 없는 까닭'}`;
      }
      emitState();
    };

    r.onend = () => {
      listening = false;
      startedAt = null;
      emitState();
      // 조용하면 브라우저가 스스로 멈춘다. 켜 두기로 했으면 다시 켠다.
      if (wanted) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => { if (wanted) safeStart(); }, RESTART_MS);
      }
    };
    return r;
  }

  function safeStart() {
    if (!Ctor) return;
    try {
      if (!rec) rec = build();
      rec.start();
    } catch {
      // 이미 켜져 있는데 또 켜면 던진다 — 그건 아무 일도 아니다.
    }
  }

  return {
    available: () => Boolean(Ctor),
    listening: () => listening,
    wanted: () => wanted,
    error: () => error,
    setLang(next) {
      lang = String(next || 'ko-KR');
      if (rec) rec.lang = lang;
    },
    start() {
      if (!Ctor || wanted) return;
      wanted = true;
      error = '';
      emitState();
      safeStart();
    },
    stop() {
      wanted = false;
      clearTimeout(restartTimer);
      emitState();
      if (rec) { try { rec.stop(); } catch { /* 안 켜져 있으면 던진다 */ } }
    },
    /** 켜져 있으면 끄고 꺼져 있으면 켠다. 돌려주는 값은 **켠 뒤의 상태**다. */
    toggle() {
      if (wanted) { this.stop(); return false; }
      this.start();
      return true;
    }
  };
}
