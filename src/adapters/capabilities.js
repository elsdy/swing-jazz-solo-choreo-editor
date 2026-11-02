// src/adapters/capabilities.js — 이 브라우저 · 이 서버가 무엇을 가졌는지 한 번에 재는 탐지 (adapters 계층)
//
// 지원 매트릭스(domain/supportMatrix)의 조건 id 마다 참 · 거짓 · 모름을 돌려준다. 이미 있는 판정을 모았을 뿐이다 —
//   folder  clipLibrary.isSupported 와 같은 규칙(showDirectoryPicker + indexedDB)
//   speech  speechInput.speechAvailable 과 같은 규칙(SpeechRecognition | webkitSpeechRecognition)
//   server · ffmpeg · model  clipServer.probe() 가 이미 받아 온 /api/health 응답을 **다시 쓴다**(서버를 두 번 두드리지 않는다)
//   gpu     자세 분석 추정기가 섰을 때의 delegate('GPU' | 'CPU'). 켤 때는 모델을 띄우지 않으므로 **모름(null)** 이다
//
// ⚠ **기능이 있는지로만 가른다.** navigator.userAgent 는 읽지 않는다 — 이름으로 가르면 새 판에서 틀린다.
//   시험(tests/unit/supportMatrix.test.mjs)이 이 파일에 그 글자가 없는 것까지 잰다.

/**
 * @param {{
 *   win?: object|null,
 *   serverConfig?: {ffmpeg?:boolean, pose?:boolean}|null,
 *   poseDelegate?: string
 * }} [input]
 *   win          브라우저 전역(테스트는 가짜를 준다). 없으면 브라우저 능력은 모두 거짓이다
 *   serverConfig clipServer.probe() 의 결과. null 이면 서버가 없다
 *   poseDelegate 추정기가 선 연산 장치 — 'GPU' · 'CPU' · ''(아직 안 섰다)
 * @returns {import('../domain/supportMatrix.js').Capabilities}
 */
// @complexity time=O(1) space=O(1) cc=8
export function detectCapabilities(input = {}) {
  const win = input.win === undefined ? (typeof window === 'undefined' ? null : window) : input.win;
  const cfg = input.serverConfig || null;
  const delegate = input.poseDelegate || '';
  const server = !!cfg;
  return {
    server,
    ffmpeg: server ? cfg.ffmpeg === true : false,
    model: server ? cfg.pose === true : false,
    folder: !!(win && typeof win.showDirectoryPicker === 'function' && win.indexedDB),
    speech: !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition)),
    gpu: delegate === 'GPU' ? true : (delegate === 'CPU' ? false : null)
  };
}
