// src/app/thumbState.js — 엄지 줄이 그릴 상태를 한 곳에서 짓는다 (app 계층, RM-36)
//
// ui/thumbBar 의 getState 가 돌려줄 값이다. store 에서 읽는 것은 여기서 셈하고, 영상 뷰 · 문서 몸통에서만
// 알 수 있는 것(띠에 붙었나 · 탭 수 · 목소리 · 시트)은 조립부(app/main)가 env 로 넘긴다. DOM 을 만지지 않으므로
// 실제 store 로 시험할 수 있다 — `빠른 배치` 가 켜짐을 놓치지 않는지 잰다.

import { BOARD_MAIN } from '../usecases/store.js';
import * as VideoCmd from '../usecases/videoCommands.js';
import * as CaptureCmd from '../usecases/captureCommands.js';

/**
 * @param {object} store
 * @param {{ docked?:boolean, taps?:number, tapBpm?:number|null,
 *           voice?:{available:boolean,wanted:boolean,listening:boolean}, sheetOpen?:boolean }} [env]
 */
// @complexity time=O(1) space=O(1) cc=4
export function thumbBarState(store, env = {}) {
  return {
    panelOpen: VideoCmd.panelState(store).open,
    capturing: CaptureCmd.captureStartSec(store) !== null,
    docked: !!env.docked,
    taps: env.taps || 0,
    tapBpm: env.tapBpm ?? null,
    canCapture: CaptureCmd.canCapture(store),
    voice: env.voice || { available: false, wanted: false, listening: false },
    sheetOpen: !!env.sheetOpen,
    // 엄지 줄의 `빠른 배치` 는 메인 표의 것이다 — 캔버스 바와 같은 켜짐을 읽는다. 루틴 판의 켜짐은 보지 않는다.
    quickPlaceOn: !!store.get().session.quickPlaceMode[BOARD_MAIN]
  };
}
