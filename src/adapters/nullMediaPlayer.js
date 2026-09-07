// src/adapters/nullMediaPlayer.js — '소스 없음'을 정상 상태로 표현하는 MediaPlayer (adapters 계층)
//
// 신규 파일이다(옮겨 온 원본 코드 없음). 오늘 index.html 에는 재생기가 아예 없고
// window.open 3곳(5150·5162·5192)으로 새 탭을 여는 것이 전부다.
// 이 널 구현이 있으면 뷰가 `player?.getState()` 식으로 열 곳 넘게 오염되지 않고,
// assertMediaPlayer(createNullMediaPlayer()) 한 줄이 곧 ports/media.js 계약의 자기검증이 된다.
// ⚠ nullSequenceEngine 은 만들지 않는다 — 빈 컨테이너를 마운트해 동작하는 척하는 더 나쁜 UI 가 된다.

import { assertMediaPlayer } from '../ports/media.js';

/**
 * 널 재생기의 능력. 전부 "못 한다"이고 **불변**이다.
 * seekToleranceSec 이 Infinity 인 이유: 이 값은 "이 안에 착지하면 성공"이라는 허용 오차인데
 * 널 재생기는 어디로도 실제로 움직이지 않으므로 어떤 요청도 허용 오차 안에 있다고 본다.
 * 0 으로 두면 호출부의 `abs(landed - want) <= tolerance` 판정이 모두 실패로 뒤집힌다.
 * @type {Readonly<{canSeek:false, seekToleranceSec:number, rates:null, isLive:false, needsUserGesture:true}>}
 */
export const NULL_CAPABILITIES = Object.freeze({
  canSeek: false,
  seekToleranceSec: Infinity,
  rates: null,
  isLive: false,
  needsUserGesture: true
});

/** 소스가 없을 때의 상태. 오류가 아니라 정상이다 — error 는 null 이다. */
const IDLE_STATE = Object.freeze({ load: 'idle', play: 'unstarted', error: null });

/**
 * 아무것도 재생하지 않는 완전한 MediaPlayer.
 *
 * 계약 준수의 요점:
 *  · play() 는 **절대 reject 하지 않고** 'no-source' 를 resolve 한다. "재생 못 함"은 예외가 아니라 결과다.
 *  · seek(sec) 은 요청값을 그대로 착지 시각으로 돌려준다("요청 ≠ 결과"를 타입으로 인정하는 자리라
 *    거짓말이 아니라 항등 착지다).
 *  · getDuration()·getTimeSample() 은 0 이 아니라 **null** 이다 — 0 은 "길이가 0초"라는 거짓 정보다.
 *  · onTime/onState 는 구독을 받지만 표본이 존재하지 않으므로 아무것도 내보내지 않는다.
 *    ⚠ 실제 어댑터의 "구독 즉시 1회" 보장은 여기서만 예외다(getTimeSample() 이 null 이라 보낼 값이 없다).
 *    뷰는 projectTime(null, now) === 0 으로 안전하게 처리된다.
 *  · destroy() 는 멱등하다. 두 번 불러도, 부른 뒤 다른 메서드를 불러도 던지지 않는다.
 *
 * @returns {import('../ports/media.js').MediaPlayer}
 */
export function createNullMediaPlayer() {
  let destroyed = false;

  const player = {
    kind: 'null',
    capabilities: NULL_CAPABILITIES,

    getState() {
      return IDLE_STATE;
    },

    /** @returns {null} 모르는 게 아니라 없는 것이다. 0 을 돌려주면 "0초짜리"라는 거짓말이 된다. */
    getDuration() {
      return null;
    },

    /** @returns {null} 표본이 없다. 호출부는 ports/media.js 의 projectTime(null, …) → 0 으로 받는다. */
    getTimeSample() {
      return null;
    },

    /**
     * 어떤 소스를 줘도 "준비 완료"에 resolve 한다 — 널 재생기는 언제나 준비돼 있다(아무것도 못 하는 채로).
     * @returns {Promise<void>}
     */
    load() {
      return Promise.resolve();
    },

    /** @returns {Promise<'no-source'>} 절대 reject 하지 않는다. */
    play() {
      return Promise.resolve('no-source');
    },

    pause() {},

    /**
     * @param {number} sec
     * @returns {Promise<number>} 요청한 시각을 그대로 착지 시각으로
     */
    seek(sec) {
      return Promise.resolve(sec);
    },

    /** capabilities.rates 가 null 이므로 계약상 no-op 이다. */
    setRate() {},

    setMuted() {},

    /**
     * @param {(sample: unknown) => void} _cb
     * @returns {() => void} 해제 함수(할 일 없음)
     */
    onTime(_cb) {
      return () => {};
    },

    /**
     * @param {(state: unknown) => void} _cb
     * @returns {() => void}
     */
    onState(_cb) {
      return () => {};
    },

    /** 멱등. 두 번째 호출부터는 아무 일도 하지 않는다. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  };

  // 포트 계약의 자기검증. 통과하면 받은 것을 그대로 돌려준다(ports/media.js:assertMediaPlayer).
  // ports/media.js 에 멤버가 추가되면 여기서 즉시 TypeError 로 드러난다 — 그것이 이 한 줄의 목적이다.
  return assertMediaPlayer(player, 'nullMediaPlayer');
}
