// src/domain/supportMatrix.js — 지원 매트릭스: 기능 × 필요한 조건 × 알려진 OS · 브라우저 결과 (domain 계층, 순수)
//
// 이 앱은 어떤 브라우저로 여느냐 · 로컬 서버(server.py)를 켰느냐에 따라 되는 기능이 다르다. 그 차이가
// 코드 주석과 기능 설명서 여기저기에 흩어져 있어 「고장인가, 이 환경에서 원래 안 되는가」를 가를 수 없었다
// (RM-27). 여기 표 하나가 **주인**이다 — `설정` 의 「이 환경」 절, 켤 때의 토스트, 문서 `docs/SUPPORT.md`
// 가 모두 이 표를 읽는다(문서 표는 시험 `tests/unit/supportMatrix.test.mjs` 가 칸마다 대조한다).
//
// ⚠ 실제 판정은 **탐지**(adapters/capabilities.js)가 한다. 아래 OS · 브라우저 칸은 「알려진 결과」일 뿐이고
//   사용자 에이전트 문자열로 가르는 자리는 어디에도 없다 — 이름으로 가르면 새 판에서 틀린다.
// ⚠ 순수 데이터와 순수 함수뿐이다. window · navigator 를 한 글자도 쓰지 않는다(check-arch 가 잰다).
//
// 행 · 열을 더하는 법: FEATURES 에 한 줄(필요한 조건 id 와 환경마다의 기호), 새 환경이면 ENVIRONMENTS 에 한 줄
// — RM-28(설치형 앱)이 「설치형」 열을, RM-33(IndexedDB 저장)이 저장 칸을 고치게 된다. 문서 표도 같이 고친다.

/** 칸에 적는 기호. 표와 문서가 같은 글자를 쓴다. */
export const SYMBOLS = Object.freeze({ ok: '○', partial: '△', no: '✕' });
const SYMBOL_SET = new Set(Object.values(SYMBOLS));

/**
 * 기능이 요구하는 조건. 탐지가 같은 id 로 참 · 거짓 · 모름을 돌려준다.
 * `missing` 은 그 조건이 없을 때 설정 절에 보이는 까닭, `short` 는 토스트 한 줄에 들어가는 짧은 꼴이다.
 * @type {ReadonlyArray<{id:string, label:string, missing:string, short:string}>}
 */
export const CONDITIONS = Object.freeze([
  Object.freeze({ id: 'server', label: '서버', short: '서버 없음', missing: '로컬 서버(python3 server.py) 없이 정적으로 열었다' }),
  Object.freeze({ id: 'ffmpeg', label: 'ffmpeg', short: 'ffmpeg 없음', missing: '서버에 ffmpeg 이 없다' }),
  Object.freeze({ id: 'model', label: '모델 파일', short: '모델 파일 없음', missing: '자세 분석 모델을 아직 받아 두지 않았다(설정 → 자세 분석 모델)' }),
  Object.freeze({ id: 'folder', label: '폴더 고르기', short: '폴더 고르기 없음', missing: '이 브라우저에는 폴더 고르기(showDirectoryPicker + IndexedDB)가 없다 — 크롬 · 엣지에서만 된다' }),
  Object.freeze({ id: 'speech', label: '음성 인식', short: '음성 인식 없음', missing: '이 브라우저에는 음성 인식(Web Speech)이 없다 — 크롬 계열 · 사파리에서 된다' }),
  // ⚠ late: 켤 때는 모르고 모델을 띄운 뒤에야 아는 조건 — 환경 지문에 넣지 않는다
  Object.freeze({ id: 'gpu', label: 'GPU', short: 'GPU 없음', late: true, missing: '자세 분석이 GPU 로 서지 못해 CPU 로 돈다 — 느릴 뿐 결과는 같다' })
]);
const CONDITION_IDS = new Set(CONDITIONS.map(c => c.id));

/**
 * 알려진 결과를 적어 둔 환경(열). 순서가 문서 표의 열 순서다.
 * @type {ReadonlyArray<{id:string, label:string}>}
 */
export const ENVIRONMENTS = Object.freeze([
  Object.freeze({ id: 'mac-chrome', label: '맥 크롬 · 엣지' }),
  Object.freeze({ id: 'mac-safari', label: '맥 사파리' }),
  Object.freeze({ id: 'mac-firefox', label: '맥 파이어폭스' }),
  Object.freeze({ id: 'win-chrome', label: '윈도 크롬 · 엣지' }),
  Object.freeze({ id: 'win-firefox', label: '윈도 파이어폭스' }),
  Object.freeze({ id: 'ios-safari', label: '아이폰 · 아이패드' }),
  Object.freeze({ id: 'android-chrome', label: '안드로이드 크롬' })
]);

const { ok, partial, no } = SYMBOLS;
/** 모든 환경에 같은 기호. */
const all = (sym) => Object.freeze(Object.fromEntries(ENVIRONMENTS.map(e => [e.id, sym])));
const known = (map) => Object.freeze({ ...all(ok), ...map });

/**
 * 기능 행. `needs` 가 비면 어디서나 된다. `known` 은 환경마다의 알려진 기호다.
 * @typedef {{ id:string, label:string, needs:ReadonlyArray<string>, known:Readonly<Record<string,string>>, note:string }} SupportFeature
 * @type {ReadonlyArray<SupportFeature>}
 */
export const FEATURES = Object.freeze([
  Object.freeze({ id: 'edit', label: '안무표 편집 · 저장 · 되살리기', needs: Object.freeze([]), known: all(ok),
    note: '격자에 놓기 · 루틴 · 되돌리기 · 작업 중 문서 담기. 아무 조건이 없다' }),
  Object.freeze({ id: 'clip-server', label: '영상 보관 — 서버 방식', needs: Object.freeze(['server']), known: all(ok),
    note: '고른 영상을 서버가 데이터 폴더에 복사하고 스트리밍한다. 어느 브라우저든 같다' }),
  Object.freeze({ id: 'clip-folder', label: '영상 보관 — 브라우저 폴더 방식', needs: Object.freeze(['folder']),
    known: known({ 'mac-safari': no, 'mac-firefox': no, 'win-firefox': no, 'ios-safari': no, 'android-chrome': no }),
    note: '서버가 없을 때의 길. 폴더 고르기 API 는 데스크톱 크롬 · 엣지에만 있다' }),
  Object.freeze({ id: 'projects', label: '안무표 폴더 보관', needs: Object.freeze(['server']), known: all(ok),
    note: '저장할 때 <서버 루트>/projects/ 에도 쓴다. 서버가 없으면 내려받기만 된다' }),
  Object.freeze({ id: 'trim', label: '영상 자르기 · 내보내기', needs: Object.freeze(['server', 'ffmpeg']), known: all(ok),
    note: '서버가 ffmpeg 을 돌린다. 브라우저는 상관없다' }),
  Object.freeze({ id: 'pose', label: '자세 분석', needs: Object.freeze(['server', 'model']),
    known: known({ 'mac-safari': partial, 'mac-firefox': partial, 'win-firefox': partial, 'ios-safari': partial, 'android-chrome': partial }),
    note: '모델은 서버가 받아 두고 계산은 브라우저가 한다. 크롬 계열 밖에서는 GPU 로 서지 못해 느릴 수 있다' }),
  Object.freeze({ id: 'pose-gpu', label: '자세 분석 GPU 가속', needs: Object.freeze(['server', 'model', 'gpu']),
    known: known({ 'mac-safari': partial, 'mac-firefox': partial, 'win-firefox': partial, 'ios-safari': partial, 'android-chrome': partial }),
    note: 'WebGL 이 막히면 조용히 CPU 로 떨어진다(약 6배 느림). 섰는지는 모델을 한 번 띄워 봐야 안다' }),
  Object.freeze({ id: 'speech', label: '말로 이름 붙이기 · 말하기', needs: Object.freeze(['speech']),
    known: known({ 'mac-safari': partial, 'mac-firefox': no, 'win-firefox': no, 'ios-safari': partial }),
    note: 'Web Speech API. 크롬은 음성을 구글 서버로 보낸다. 사파리는 있지만 중간 결과가 드물다' }),
  Object.freeze({ id: 'llm', label: '말로 채우기 — LLM', needs: Object.freeze(['server']), known: all(ok),
    note: 'LLM 은 서버가 부르고 키는 서버에만 있다. 말하기 단추는 음성 인식 행을 따른다' })
]);

/**
 * 표의 모양이 맞는지 — 빠진 칸 · 모르는 기호 · 중복 id · 모르는 조건. 빈 배열이면 맞다.
 * 시험이 부르고, 표를 고친 사람이 바로 본다.
 * @returns {string[]}
 */
// @complexity time=O(f·e) space=O(f) cc=10
export function validateMatrix(features = FEATURES, environments = ENVIRONMENTS) {
  const problems = [];
  const seen = new Set();
  for (const f of features) {
    if (seen.has(f.id)) problems.push(`${f.id}: 기능 id 가 두 번 있다`);
    seen.add(f.id);
    if (!f.label) problems.push(`${f.id}: 이름이 비었다`);
    for (const c of f.needs) if (!CONDITION_IDS.has(c)) problems.push(`${f.id}: 모르는 조건 ${c}`);
    for (const e of environments) {
      const sym = f.known[e.id];
      if (sym === undefined) problems.push(`${f.id}: ${e.id} 칸이 비었다`);
      else if (!SYMBOL_SET.has(sym)) problems.push(`${f.id}: ${e.id} 칸의 기호 ${sym} 를 모른다`);
    }
    for (const k of Object.keys(f.known)) {
      if (!environments.some(e => e.id === k)) problems.push(`${f.id}: 모르는 환경 ${k}`);
    }
  }
  return problems;
}

/**
 * 탐지 결과. 조건마다 `true`(있다) · `false`(없다) · `null`(아직 모름 — GPU 는 모델을 띄워 봐야 안다).
 * @typedef {Record<string, boolean|null>} Capabilities
 */

const CONDITION_BY_ID = new Map(CONDITIONS.map(c => [c.id, c]));

/**
 * 기능 하나가 이 환경에서 되는가.
 *   'ok'      — 필요한 조건이 다 있다
 *   'no'      — 없는 조건이 있다(reasons 에 까닭)
 *   'unknown' — 없는 것은 없는데 아직 모르는 조건이 있다
 * ⚠ 서버가 없으면 서버 쪽 조건(ffmpeg · 모델)은 까닭으로 세지 않는다 — 「서버 없음」 하나로 묶는다.
 *   서버가 없는 사람에게 「ffmpeg 도 없다」까지 말하면 둘을 고쳐야 하는 줄 안다.
 * @param {SupportFeature} feature
 * @param {Capabilities} caps
 * @returns {{ status:'ok'|'no'|'unknown', reasons:string[], missing:string[] }} reasons 는 긴 까닭, missing 은 없는 조건 id
 */
// @complexity time=O(k) space=O(k) cc=7
export function featureStatus(feature, caps) {
  const reasons = [];
  const missing = [];
  let unknown = false;
  const serverMissing = feature.needs.includes('server') && caps.server === false;
  for (const id of feature.needs) {
    const v = caps[id];
    if (v === true) continue;
    if (serverMissing && id !== 'server') continue;
    if (v === false) { reasons.push(CONDITION_BY_ID.get(id).missing); missing.push(id); }
    else unknown = true;
  }
  if (reasons.length) return { status: 'no', reasons, missing };
  return { status: unknown ? 'unknown' : 'ok', reasons, missing };
}

/**
 * 「이 환경」 절에 그릴 줄 — 기능마다 상태와 까닭.
 * @param {Capabilities} caps
 * @returns {Array<{ id:string, label:string, status:'ok'|'no'|'unknown', reasons:string[], missing:string[] }>}
 */
// @complexity time=O(f·k) space=O(f) cc=2
export function environmentLines(caps, features = FEATURES) {
  return features.map(f => ({ id: f.id, label: f.label, ...featureStatus(f, caps) }));
}

/**
 * 이 환경에서 **안 되는 것**만 — 켤 때 토스트에 담는 목록. 다 되면 빈 배열.
 * 아직 모르는 것(GPU)은 안 되는 것이 아니므로 들어가지 않는다.
 * @param {Capabilities} caps
 * @returns {Array<{ id:string, label:string, reasons:string[], missing:string[] }>}
 */
// @complexity time=O(f·k) space=O(f) cc=2
export function unsupportedFeatures(caps, features = FEATURES) {
  return environmentLines(caps, features)
    .filter(l => l.status === 'no')
    .map(({ id, label, reasons, missing }) => ({ id, label, reasons, missing }));
}

/** 토스트에 이름을 몇 개까지 적나. 서버가 없으면 여덟 가지가 한꺼번에 안 되므로 다 적으면 읽히지 않는다. */
const TOAST_NAMES = 3;

/**
 * 토스트 한 줄. 안 되는 기능 이름 몇 개와 짧은 까닭을 한 번씩만 붙이고, 자세한 것은 설정으로 보낸다.
 * @param {ReturnType<typeof unsupportedFeatures>} list
 * @returns {string} 빈 목록이면 빈 문자열
 */
// @complexity time=O(f·k) space=O(f·k) cc=4
export function unsupportedMessage(list) {
  if (!list.length) return '';
  const names = list.slice(0, TOAST_NAMES).map(l => l.label).join(' · ');
  const more = list.length > TOAST_NAMES ? ` 등 ${list.length}가지` : '';
  const why = [...new Set(list.flatMap(l => l.missing))].map(id => CONDITION_BY_ID.get(id).short).join(' · ');
  return `이 환경에서는 ${names}${more}가 안 됩니다(${why}). 까닭은 설정 → 이 환경 에 있습니다.`;
}

const LATE_IDS = new Set(CONDITIONS.filter(c => c.late).map(c => c.id));

/**
 * 환경 지문 — 알림을 「환경이 바뀌었을 때만」 다시 띄우기 위한 글자. 아직 모르는 조건(null)과 늦게 아는
 * 조건(GPU)은 지문에 넣지 않는다 — 켤 때마다 바뀌는 값이 지문에 들어가면 매번 새 환경으로 보인다.
 * @param {Capabilities} caps
 * @returns {string} 예: 'folder=1 server=0 speech=1'
 */
// @complexity time=O(k log k) space=O(k) cc=4
export function fingerprintOf(caps) {
  return Object.keys(caps)
    .filter(k => !LATE_IDS.has(k) && (caps[k] === true || caps[k] === false))
    .sort()
    .map(k => `${k}=${caps[k] ? 1 : 0}`)
    .join(' ');
}

/**
 * 켤 때 알릴 것인가 — 끔이면 아니고, 안 되는 것이 없으면 아니고, 지난번과 같은 환경이면 아니다.
 * @param {{ enabled:boolean, fingerprint:string, lastFingerprint:string, anyUnsupported:boolean }} q
 * @returns {boolean}
 */
// @complexity time=O(1) space=O(1) cc=4
export function shouldNotify({ enabled, fingerprint, lastFingerprint, anyUnsupported }) {
  if (!enabled) return false;
  if (!anyUnsupported) return false;
  return fingerprint !== lastFingerprint;
}

/**
 * 문서(docs/SUPPORT.md)에 적는 표의 줄을 만든다 — 시험이 문서와 대조할 때 **기준**이 되는 글자다.
 * 머리줄: `| 기능 | 필요한 것 | <환경 …> |`, 본문: `| 이름 | 조건 · 조건 | ○ | … |`
 * @returns {string[]} 줄마다 한 줄(머리 두 줄 포함)
 */
// @complexity time=O(f·e) space=O(f·e) cc=3
export function matrixTableLines(features = FEATURES, environments = ENVIRONMENTS) {
  const head = ['기능', '필요한 것', ...environments.map(e => e.label)];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const f of features) {
    const needs = f.needs.length ? f.needs.map(id => CONDITION_BY_ID.get(id).label).join(' · ') : '—';
    lines.push(`| ${f.label} | ${needs} | ${environments.map(e => f.known[e.id]).join(' | ')} |`);
  }
  return lines;
}
