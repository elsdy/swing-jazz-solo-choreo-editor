// src/usecases/videoCommands.js — 영상 패널의 상태 전이와 템포 보정 (usecases 계층)
//
// 신규 파일이다. 원본 index.html 에 대응물이 없다 — 오늘 영상은 링크바의 URL 문자열 하나뿐이고
// 템포라는 개념이 아예 없었다. 그래서 "오늘 동작 보존" 제약이 없는 대신, 아래 두 경계를 어기면
// 이 기능이 통째로 잘못 설계된다.
//
// ⚠ 경계 ① — **재생 위치·재생 상태는 store 에 절대 들어가지 않는다.**
//   초당 60번 바뀌는 값이라 스토어에 넣으면 매 프레임 전체 재렌더가 되고, undo 스택도 오염된다.
//   재생 헤드는 뷰의 rAF 루프가 자기 엘리먼트의 transform 만 직접 쓴다(docs/PORTS.md 채널 B).
//   이 파일에 `currentSec` 이나 `playing` 을 넣고 싶어지면, 그건 이 규칙을 어기려는 순간이다.
//
// ⚠ 경계 ② — **템포는 undo 에 들어간다.** 앵커는 사용자가 공들여 찍는 값이라 오조작 손실이 크고,
//   스냅샷 증가량은 숫자 네 개다(schema.UNDO_FIELDS 의 `media`).
//   다만 **커밋은 이 파일이 하지 않는다.** 저장소 규약대로 히스토리 커밋은 호출부의 몫이고
//   (linkCommands.js 상단과 같은 계약), 드래그·타이핑 중이 아니라 **확정 시점**에만 커밋한다:
//     · 두 점 앵커가 완성된 순간(markTempoPoint 가 committed:true 를 돌려줄 때)
//     · 탭 템포 확정(commitTaps) · bpm/beatsPerCount 직접 입력의 change(blur/Enter)
//     · 재앵커(reanchorTo) · 소스 확정(setSource)
//   패널 열기/접기/따라가기 토글에는 걸지 않는다 — 화면 상태이지 안무가 아니다.
//
// ⚠ 이 파일은 DOM 도 플레이어도 모른다. 시각(초)은 전부 **인자로 들어온다** — usecases 는
//   Date·performance 를 쓸 수 없다(tools/check-arch.mjs 가 막는다).

import { NONE } from './store.js';
import { isEmptyMedia, normalizeMedia, normalizeMediaSource } from '../domain/project/media.js';
import {
  bpmFromTaps, isTempoUsable, normalizeTempo, reanchor, tempoFromTwoPoints, addTempoPoint as addTempoPointOf, removeTempoPoint as removeTempoPointOf, clearTempoPointsOf
} from '../domain/tempo.js';

/** 패널·템포 보정이 다시 그려져야 한다는 뜻. 재생 헤드와는 무관하다(위 경계 ①). */
const VIDEO = Object.freeze({ video: true });

/**
 * 탭이 이만큼 벌어지면 "새로 세는 것"으로 본다. 딴짓하다 돌아와 다시 두드리기 시작한 것을
 * 앞의 탭과 평균 내면 bpm 이 엉뚱해진다.
 */
export const TAP_RESET_SEC = 2;

/** 두 점 앵커에 필요한 점의 개수. 두 점이면 bpm 과 앵커가 동시에 나온다(tempoFromTwoPoints). */
export const TEMPO_POINTS_NEEDED = 2;

// ─────────────────────────────────────────────────────────────────────────────
// 읽기 — 뷰가 store 를 직접 헤집지 않게 하는 접근자
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영상 패널의 휘발성 화면 상태. 없으면 기본값을 만들어 준다(옛 스냅샷 복원 뒤에도 안전하도록).
 * @param {object} store
 * @returns {{open:boolean, collapsed:boolean, follow:boolean, tempoPoints:{count:number,sec:number}[], taps:number[]}}
 */
export function panelState(store) {
  const v = store.get().session.video;
  return v || { open: false, collapsed: false, follow: true, tempoPoints: [], taps: [] };
}

/**
 * 지금의 영상 블록(`{tempo, source}`). **언제나 두 필드를 채워** 돌려준다.
 * @param {object} store
 * @returns {import('../domain/project/schema.js').MediaBlock}
 */
export function mediaState(store) {
  return normalizeMedia(store.get().media);
}

/**
 * 카운트 ↔ 초 변환을 해도 되는가. 뷰는 이게 거짓이면 재생 헤드를 **아예 그리지 않는다** —
 * bpm 0 에서 그리면 그럴듯한 위치에 거짓말이 서 있게 되고, 그게 가장 나쁜 실패다.
 * @param {object} store
 * @returns {boolean}
 */
export function isTempoReady(store) {
  return isTempoUsable(mediaState(store).tempo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** session.video 를 부분 갱신한다. 값이 하나도 안 바뀌면 NONE 을 돌려 헛렌더를 막는다. */
function patchPanel(store, values) {
  const cur = panelState(store);
  let changed = false;
  for (const key of Object.keys(values)) if (cur[key] !== values[key]) changed = true;
  if (!changed) return NONE;
  store.patch('session', { video: { ...cur, ...values } });
  return VIDEO;
}

/** media 블록을 통째로 갈아끼운다(부분 갱신이 아니라 교체 — 블록 하나가 값의 단위다). */
function setMedia(store, next) {
  store.update({ media: normalizeMedia(next) });
  return VIDEO;
}

// ─────────────────────────────────────────────────────────────────────────────
// 패널 — 화면 상태. undo 에 남지 않고 파일에도 안 나간다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 패널을 연다. **켜야 보이는 기능**이라 기본은 닫힘이고, 닫힌 화면은 이 기능이 들어오기 전과 같다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function openPanel(store) {
  return patchPanel(store, { open: true });
}

/**
 * 패널을 닫는다.
 * ⚠ 호출부는 닫으면서 반드시 `player.pause()` 를 불러야 한다 — `display:none` 인 iframe 도
 *   오디오는 계속 나온다(docs/PORTS.md '데스크톱과 모바일'). 그건 어댑터를 아는 자리의 몫이라
 *   여기서 하지 않는다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function closePanel(store) {
  return patchPanel(store, { open: false });
}

/**
 * 열림/닫힘 토글.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function togglePanel(store) {
  return patchPanel(store, { open: !panelState(store).open });
}

/**
 * 접기(헤더만 남긴다). 모바일은 세로 예산이 빡빡해 기본이 접힘이다.
 * ⚠ 접는 것은 숨기는 것과 다르다 — DOM 에서 옮기거나 지우면 iframe 이 리로드되어 재생이 끊긴다.
 * @param {object} store
 * @param {{collapsed?: boolean}} [args] 생략하면 토글
 * @returns {import('./store.js').Dirty}
 */
export function setCollapsed(store, args = {}) {
  const next = typeof args.collapsed === 'boolean' ? args.collapsed : !panelState(store).collapsed;
  return patchPanel(store, { collapsed: next });
}

/**
 * "따라가기" 토글 — 재생 위치를 안무표가 따라 스크롤할 것인가.
 * @param {object} store
 * @param {{follow?: boolean}} [args] 생략하면 토글
 * @returns {import('./store.js').Dirty}
 */
export function setFollow(store, args = {}) {
  const next = typeof args.follow === 'boolean' ? args.follow : !panelState(store).follow;
  return patchPanel(store, { follow: next });
}

// ─────────────────────────────────────────────────────────────────────────────
// 소스 — 링크바의 `YouTube URL 입력...` 칸이 그대로 소스다(새 입력창을 만들지 않는다)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영상 소스를 정한다. 빈 URL 은 **소스 없음**(null)이며 오류가 아니다.
 *
 * ⚠ 템포는 건드리지 않는다. 같은 곡의 다른 업로드로 URL 만 갈아끼우는 일이 흔하고,
 *   그때 애써 찍은 bpm 이 날아가면 안 된다. 싱크가 어긋나면 reanchorTo 한 번이면 된다.
 * ⚠ URL 문자열은 링크바가 가진 것과 **같은 글자**여야 한다. 정규화하지 않는 이유가 그것이다
 *   (videoId 추출은 adapters/media/pickPlayer.js 한 곳에서만 한다).
 * @param {object} store
 * @param {{url?: string|null}} [args]
 * @returns {import('./store.js').Dirty}
 */
export function setSource(store, args = {}) {
  const url = args.url == null ? '' : String(args.url).trim();
  const cur = mediaState(store);
  const next = url ? normalizeMediaSource({ kind: 'youtube', url }) : null;
  // ⚠ 파일 소스가 잡혀 있는데 링크바만 비운 경우는 건드리지 않는다 — 링크를 지운 것이지 영상 파일을
  //   놓은 것이 아니다. 파일을 놓는 것은 clearFileSource 의 몫이다.
  if (!next && cur.source && cur.source.kind === 'file') return NONE;
  if (sameSource(cur.source, next)) return NONE;
  return setMedia(store, { tempo: cur.tempo, source: next });
}

/**
 * 로컬 영상 파일을 소스로 확정한다. 저장되는 것은 **파일명뿐**이다 — blob URL 은 브라우저 것이고
 * 이 계층은 그것을 모른다(app/main 이 만들고 revoke 한다).
 * ⚠ 파일이 유튜브 주소보다 우선한다. 링크바의 주소는 그대로 남아 있으므로 파일을 놓으면(clearFileSource)
 *   다시 유튜브로 돌아간다 — 사용자가 마지막에 고른 것이 소스다.
 * @param {object} store
 * @param {{name?: string|null}} [args]
 * @returns {import('./store.js').Dirty}
 */
export function setFileSource(store, args = {}) {
  const cur = mediaState(store);
  const next = normalizeMediaSource({ kind: 'file', name: args.name });
  if (!next) return NONE;
  if (sameSource(cur.source, next)) return NONE;
  return setMedia(store, { tempo: cur.tempo, source: next });
}

/**
 * 파일 소스를 놓는다. 링크바에 유튜브 주소가 남아 있으면 그것이 다시 소스가 된다(없으면 소스 없음).
 * 템포는 그대로 둔다 — 같은 곡의 다른 파일로 갈아 끼우는 흔한 경우에 애써 찍은 bpm 이 날아가면 안 된다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearFileSource(store) {
  const cur = mediaState(store);
  if (!cur.source || cur.source.kind !== 'file') return NONE;
  const url = String((store.get().links || {}).youtubeUrl || '').trim();
  const next = url ? normalizeMediaSource({ kind: 'youtube', url }) : null;
  return setMedia(store, { tempo: cur.tempo, source: next });
}

/**
 * 두 소스 참조가 같은가. kind 가 같고 그 kind 의 식별 필드(url 또는 name)가 같으면 같다.
 * @param {object|null} a
 * @param {object|null} b
 * @returns {boolean}
 */
function sameSource(a, b) {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'file' ? a.name === b.name : a.url === b.url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 템포 — 사용자는 bpm 을 몰라도 된다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * bpm·beatsPerCount·앵커를 직접 넣는다(숫자를 아는 사용자의 탈출구).
 * 손상된 값은 normalizeTempo 가 걸러 낸다 — bpm 이 유한한 양수가 아니면 **0(미설정)** 으로 남는다.
 * @param {object} store
 * @param {{tempo?: Partial<import('../domain/tempo.js').Tempo>}} args
 * @returns {import('./store.js').Dirty}
 */
export function setTempo(store, args = {}) {
  const cur = mediaState(store);
  return setMedia(store, { tempo: normalizeTempo({ ...cur.tempo, ...(args.tempo || {}) }), source: cur.source });
}

/**
 * 카운트 1칸이 몇 박인가(기본 1, 하프타임 2, 더블타임 0.5). bpm 과 앵커는 그대로다.
 * @param {object} store
 * @param {{beatsPerCount?: number}} args
 * @returns {import('./store.js').Dirty}
 */
export function setBeatsPerCount(store, args = {}) {
  return setTempo(store, { tempo: { beatsPerCount: args.beatsPerCount } });
}

/**
 * 보정점을 하나 넣는다 — "이 카운트가 지금 여기서 시작한다". 템포가 흔들리는 실황 영상에서 동작마다
 * 시작 시각을 찍어 두면 그 사이가 구간별 선형으로 저절로 맞는다(domain/tempo.js 의 tempoPoints).
 *
 * ⚠ 되감기는 점(앞뒤 점과 순서가 맞지 않는 점)은 **거부**한다 — 반환값의 `rejected` 가 그 신호다.
 *   조용히 다른 점을 버리면 사용자는 무엇이 사라졌는지 모른다. 뷰가 이 신호를 보고 안내한다.
 * ⚠ bpm 이 아직 미설정이면 넣지 않는다 — 양 끝 밖을 뻗을 기울기가 없다.
 * @param {object} store
 * @param {{count?: number, sec?: number}} point 선형 카운트와 그때의 영상 시각(초)
 * @returns {import('./store.js').Dirty & {rejected?: boolean}}
 */
export function addTempoPoint(store, point = {}) {
  const count = Number(point.count);
  const sec = Number(point.sec);
  if (!Number.isFinite(count) || !Number.isFinite(sec)) return NONE;
  const cur = mediaState(store);
  if (!isTempoUsable(cur.tempo)) return NONE;
  const next = addTempoPointOf(cur.tempo, { count, sec });
  if (!next) return { ...NONE, rejected: true };
  return setMedia(store, { tempo: next, source: cur.source });
}

/**
 * 그 카운트의 보정점을 뺀다.
 * @param {object} store
 * @param {{count?: number}} args
 * @returns {import('./store.js').Dirty}
 */
export function removeTempoPoint(store, args = {}) {
  const count = Number(args.count);
  if (!Number.isFinite(count)) return NONE;
  const cur = mediaState(store);
  if (!(cur.tempo.points || []).some(p => p.count === count)) return NONE;
  return setMedia(store, { tempo: removeTempoPointOf(cur.tempo, count), source: cur.source });
}

/**
 * 보정점을 전부 뺀다. bpm·앵커는 그대로다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearTempoMap(store) {
  const cur = mediaState(store);
  if ((cur.tempo.points || []).length === 0) return NONE;
  return setMedia(store, { tempo: clearTempoPointsOf(cur.tempo), source: cur.source });
}

/**
 * bpm 은 그대로 두고 앵커만 옮긴다 — 곡 중간에서 어긋난 싱크를 한 번의 클릭으로 되맞추는 경로.
 * bpm 이 아직 0(미설정)이면 앵커만 기록되고 변환은 여전히 불가다(isTempoUsable 이 거짓).
 * @param {object} store
 * @param {{count?: number, sec?: number}} point 선형 카운트와 그때의 영상 시각(초)
 * @returns {import('./store.js').Dirty}
 */
export function reanchorTo(store, point = {}) {
  const count = Number(point.count);
  const sec = Number(point.sec);
  if (!Number.isFinite(count) || !Number.isFinite(sec)) return NONE;
  const cur = mediaState(store);
  return setMedia(store, { tempo: reanchor(cur.tempo, { count, sec }), source: cur.source });
}

/**
 * "여기가 이 카운트" 를 한 번 찍는다. **두 번 찍으면** bpm 과 앵커가 동시에 정해진다.
 *
 * 이 두 점이 이 기능의 UX 전부다 — 8x1 의 1 과 8x5 의 1 은 32카운트 차이라 클릭 오차가
 * bpm 에 미치는 영향이 1/32 로 줄어든다. 멀리 떨어진 두 점을 쓰라는 안내가 그래서 값을 한다.
 *
 * ⚠ 모아 둔 점은 **휘발성**이다(session.video.tempoPoints). 확정된 Tempo 만 media 로 들어가고,
 *   그때만 호출부가 히스토리를 커밋해야 한다 — 반환값의 `committed` 가 그 신호다.
 * ⚠ 순서가 뒤집혔거나 간격이 0 이면 tempoFromTwoPoints 가 null 을 준다. 그때는 **새로 찍은 점을
 *   첫 점으로 삼아** 다시 센다(사용자가 실수로 뒤쪽을 먼저 찍은 흔한 경우가 그대로 복구된다).
 *
 * @param {object} store
 * @param {{count?: number, sec?: number}} point
 * @returns {import('./store.js').Dirty & {committed?: boolean}}
 *   committed:true 면 Tempo 가 확정되었다 — 호출부가 히스토리를 커밋할 자리다.
 */
export function markTempoPoint(store, point = {}) {
  const count = Number(point.count);
  const sec = Number(point.sec);
  if (!Number.isFinite(count) || !Number.isFinite(sec)) return NONE;

  const cur = panelState(store);
  const points = [...cur.tempoPoints, { count, sec }];

  if (points.length < TEMPO_POINTS_NEEDED) {
    store.patch('session', { video: { ...cur, tempoPoints: points } });
    return VIDEO;
  }

  const media = mediaState(store);
  const [a, b] = points.slice(-TEMPO_POINTS_NEEDED);
  const tempo = tempoFromTwoPoints(a, b, media.tempo.beatsPerCount);
  if (!tempo) {
    // 보정 불가 — 마지막 점만 남겨 거기서 다시 센다.
    store.patch('session', { video: { ...cur, tempoPoints: [{ count, sec }] } });
    return VIDEO;
  }
  store.patch('session', { video: { ...cur, tempoPoints: [] } });
  setMedia(store, { tempo, source: media.source });
  return { video: true, committed: true };
}

/**
 * 찍던 점을 버린다(취소 버튼).
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearTempoPoints(store) {
  const cur = panelState(store);
  if (cur.tempoPoints.length === 0) return NONE;
  store.patch('session', { video: { ...cur, tempoPoints: [] } });
  return VIDEO;
}

// ─────────────────────────────────────────────────────────────────────────────
// 탭 템포
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 박자에 맞춰 한 번 두드린다. 시각(초)은 **호출부가 넣는다** — usecases 는 시계를 읽을 수 없다.
 *
 * ⚠ 여기서는 bpm 을 media 에 쓰지 않는다. 두드리는 동안 undo 단계가 쌓이면 안 되고, 값이
 *   매 탭마다 흔들려 화면이 요동친다. 확정은 commitTaps 가 한다.
 * ⚠ TAP_RESET_SEC 보다 벌어지면 앞의 탭을 버리고 새로 센다.
 *
 * @param {object} store
 * @param {{atSec?: number}} args  두드린 시각(초). 벽시계든 미디어 시각이든 **한 가지로만** 넣어라
 * @returns {import('./store.js').Dirty}
 */
export function tapTempo(store, args = {}) {
  const at = Number(args.atSec);
  if (!Number.isFinite(at)) return NONE;
  const cur = panelState(store);
  const last = cur.taps.length ? cur.taps[cur.taps.length - 1] : null;
  const taps = (last === null || (at - last > TAP_RESET_SEC) || !(at > last)) ? [at] : [...cur.taps, at];
  store.patch('session', { video: { ...cur, taps } });
  return VIDEO;
}

/**
 * 두드린 것을 bpm 으로 확정한다. 앵커는 건드리지 않는다 — 탭 템포는 "얼마나 빠른가"만 답한다.
 *
 * ⚠ 탭이 2개 미만이면 bpmFromTaps 가 null 이고 아무 일도 하지 않는다(탭은 그대로 남는다).
 * @param {object} store
 * @param {{beatsPerTap?: number}} [args] 탭 하나가 몇 박인가(기본 1)
 * @returns {import('./store.js').Dirty & {committed?: boolean}}
 */
export function commitTaps(store, args = {}) {
  const cur = panelState(store);
  const beatsPerTap = Number.isFinite(args.beatsPerTap) && args.beatsPerTap > 0 ? args.beatsPerTap : 1;
  const bpm = bpmFromTaps(cur.taps, beatsPerTap);
  if (bpm === null) return NONE;

  const media = mediaState(store);
  store.patch('session', { video: { ...cur, taps: [] } });
  // ⚠ 날 bpm 이다. 20..400 클램프는 normalizeTempo 안에서 일어난다(setMedia 가 부른다).
  setMedia(store, { tempo: { ...media.tempo, bpm }, source: media.source });
  return { video: true, committed: true };
}

/**
 * 두드린 것을 버린다.
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearTaps(store) {
  const cur = panelState(store);
  if (cur.taps.length === 0) return NONE;
  store.patch('session', { video: { ...cur, taps: [] } });
  return VIDEO;
}

/**
 * 템포를 미설정으로 되돌린다(bpm 0). **소스는 남는다** — 패널의 `템포 지우기` 버튼이다.
 * ⚠ `전체 초기화(링크 포함)` 는 이걸 부르지 않고 아래 clearMedia 를 부른다. 그 조작은 링크바의
 *   주소까지 비우므로 소스를 남기면 같은 사실이 두 곳에서 갈라진다(clearMedia 주석 참조).
 * ⚠ beatsPerCount 는 남긴다 — 곡이 아니라 사람의 습관(스윙은 보통 1카운트 = 2박)이라
 *   지울 때마다 다시 넣게 하면 성가시다. 그래서 이걸 만진 사용자의 파일에는 템포를 지운 뒤에도
 *   `media` 키가 남는다(isEmptyMedia 가 거짓이다).
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearTempo(store) {
  const cur = mediaState(store);
  if (!isTempoUsable(cur.tempo) && cur.tempo.anchorSec === 0 && cur.tempo.anchorCount === 0) return NONE;
  return setMedia(store, { tempo: { beatsPerCount: cur.tempo.beatsPerCount }, source: cur.source });
}

/**
 * 영상 블록을 통째로 미설정으로 되돌린다 — **소스도 템포도** 버린다.
 *
 * ⚠ `전체 초기화(링크 포함)`(boardCommands.clearBoard)만 부른다. 이름 그대로 링크바의
 *   `youtubeUrl` 을 함께 비우는 조작이라, 여기서 `media.source` 를 남기면 **같은 사실이 두 곳에서
 *   갈라진다** — 링크바는 비었는데 패널은 옛 영상을 계속 싣고, 다음 저장이 사용자가 지운 주소를
 *   파일에 다시 쓴다(ui/videoPanel.js 경계 ③ "상태를 두 곳에 두지 않는다").
 * ⚠ 템포도 함께 버리는 이유: 앵커와 bpm 은 **그 영상의 시간축**에 붙은 값이다. 소스를 버리고
 *   템포만 남기면 다음에 붙인 다른 영상에 옛 앵커가 조용히 적용되어 재생 헤드가 그럴듯한
 *   거짓 위치를 가리킨다 — 이 기능에서 가장 나쁜 실패다(docs/PORTS.md).
 *   ⚠ 되돌릴 수 있다: media 는 undo 스냅샷 안에 있고(schema.UNDO_FIELDS) clearBoard 의 호출부가
 *     곧바로 히스토리를 커밋하므로, Undo 한 번이면 배치와 함께 템포도 살아난다.
 *     링크는 스냅샷 밖이라 살아나지 않는다 — 그 비대칭은 원래 있던 것이다(boardCommands 주석).
 * ⚠ 이미 비어 있으면 **NONE** 이다. 영상을 한 번도 안 쓴 사용자의 `전체 초기화` 는 이 기능이
 *   들어오기 전과 Dirty 가 글자 하나 다르지 않아야 한다(골든 재생이 그것을 지킨다).
 *
 * @param {object} store
 * @returns {import('./store.js').Dirty}
 */
export function clearMedia(store) {
  const cur = panelState(store);
  const wasEmpty = isEmptyMedia(mediaState(store));
  const hasMarks = cur.tempoPoints.length > 0 || cur.taps.length > 0;
  if (wasEmpty && !hasMarks) return NONE;
  // 찍다 만 점·두드리다 만 탭도 함께 버린다 — 지워진 영상의 시각이라 남겨 두면 다음 한 번의
  // `지금 여기` 가 옛 점과 짝을 이뤄 엉뚱한 bpm 을 만든다.
  if (hasMarks) store.patch('session', { video: { ...cur, tempoPoints: [], taps: [] } });
  if (!wasEmpty) setMedia(store, null);
  return VIDEO;
}
