// src/input/dragSession.js — 두 보드가 공유하는 **하나의** 드래그 세션.
//
// 왜 단일 소유자인가:
//   원본은 드래그 상태를 `state.drag`(메인)와 `reState.drag`(루틴 편집) 두 슬롯에 나눠 들고 있지만,
//   팔레트 카드의 dragstart(3079-3086)가
//       const paletteDrag = { type:'palette', moveId, previewCount: DEFAULT_COUNT };
//       state.drag   = paletteDrag;
//       reState.drag = paletteDrag;   // ← **같은 객체**
//   로 두 슬롯에 같은 참조를 넣는다. 즉 실제로는 슬롯이 둘이 아니라 **세션이 하나**이고,
//   두 슬롯은 "이 드래그를 어느 보드가 받아들이는가" 를 표현하는 장치일 뿐이다.
//   그래서 여기서는 세션을 하나만 두고, 그 사실을 `boards` 목록으로 명시한다.
//
// 원본 호출부와 boards 의 대응(전수):
//   | 원본 | 무엇 | boards |
//   |---|---|---|
//   | 3079-3086 팔레트 카드 dragstart      | {type:'palette', moveId, previewCount}                  | ['main','routine'] |
//   | 3936     팔레트 칩 터치 롱프레스     | {type:'palette', moveId, isTouchDragging, lastX, lastY, previewCount} | ['main'] |
//   | 4706-4710 루틴 카드 dragstart        | {type:'routine', routineId}                             | ['main'] |
//   | 2474-2484 보드 move-handle dragstart | {type:'placement-move', groupId, copyMode}              | [그 보드] |
//   | 3839     터치 배치 이동 시작         | {type:'placement-move', groupId, isTouchDragging, lastX, lastY} | [그 보드] |
//
// ⚠ 팔레트 **마우스** 드래그만 두 보드이고 팔레트 **터치** 드래그는 메인뿐이다(3936). 통일하지 마라.
// ⚠ 화면 정리(clearTrackHighlights / clearPreview / unmarkDraggingGroups)는 여기 없다 —
//   그건 overlays 의 몫이고 dragend 핸들러가 부른다. 이 파일은 상태만 소유한다.
// ⚠ 원본 3082 의 `state.activePaletteMove = null`(렌더 없음)은 여기가 아니라
//   input/paletteInput 이 paletteCommands.cancelActivePaletteMove 로 처리한다(STAGE2 계약).

/** 팔레트 마우스 드래그가 쓰는 보드 목록(원본 3084-3085의 두 슬롯 대입). */
const BOTH_BOARDS = Object.freeze(['main', 'routine']);

/**
 * 드래그 세션 하나를 만든다. 앱 전체에 **인스턴스 하나만** 두고 app/main.js 가
 * boardController 2개와 paletteInput, routineListView 에 같은 것을 넘긴다.
 *
 * @returns {{
 *   begin: (kind: 'palette'|'placement-move'|'routine', payload?: object, options?: {boards?: string[]}) => object,
 *   current: (boardId?: string|null) => object|null,
 *   update: (patch: object) => object|null,
 *   end: () => void,
 *   BOTH_BOARDS: readonly string[],
 * }}
 */
export function createDragSession() {
  /** @type {object|null} 동시에 하나만 존재한다. */
  let session = null;

  return {
    /**
     * 드래그를 시작한다. 원본의 `ctx.drag = {...}` 대입 한 줄에 대응한다.
     * @param {'palette'|'placement-move'|'routine'} kind 원본의 `type` 필드 문자열 그대로
     * @param {object} [payload] moveId / groupId / routineId / copyMode / isTouchDragging / lastX / lastY / previewCount
     * @param {{boards?: string[]}} [options] 이 드래그를 받아들이는 보드. 기본은 메인뿐이다
     * @returns {object} 만들어진 세션(호출부가 곧바로 lastX 등을 읽을 수 있게 돌려준다)
     */
    begin(kind, payload = {}, options = {}) {
      const { boards = ['main'] } = options;
      session = { type: kind, ...payload, boards: [...boards] };
      return session;
    },

    /**
     * 지금 드래그. `boardId` 를 주면 **그 보드가 받아들이는 드래그일 때만** 돌려준다.
     * 원본의 `ctx.drag` 읽기(2417·2419·2425·2553·2567·2577·3903·3950·3957 …)에 대응한다.
     * ⚠ 인자를 생략하면 보드와 무관한 원시 세션이다 — 판정에 쓰지 마라.
     * @param {string|null} [boardId]
     * @returns {object|null}
     */
    current(boardId = null) {
      if (!session) return null;
      if (boardId == null) return session;
      return session.boards.includes(boardId) ? session : null;
    },

    /**
     * 진행 중인 세션의 필드를 갱신한다. 터치 고스트가 좌표를 적는 자리다
     * (원본 3857-3858 `ctx.drag.lastX = x; ctx.drag.lastY = y;`, 3977).
     * @param {object} patch
     * @returns {object|null}
     */
    update(patch) {
      if (session) Object.assign(session, patch);
      return session;
    },

    /**
     * 드래그를 끝낸다. 원본의 `ctx.drag = null` 대입 전부에 대응한다.
     * ⚠ 세션이 하나뿐이므로 **모든 보드에 대해** 끝난다. 원본은 drop(2432)에서 자기 보드만
     *   비우고 나머지는 dragend(3087-3092)가 곧바로 비우므로 관찰되는 차이가 없다.
     * @returns {void}
     */
    end() {
      session = null;
    },

    /** 팔레트 마우스 드래그용 상수. `begin('palette', p, { boards: s.BOTH_BOARDS })` */
    BOTH_BOARDS,
  };
}
