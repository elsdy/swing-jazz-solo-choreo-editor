// src/adapters/pose/mediapipePose.js — MediaPipe 로 관절점을 뽑는 PoseEstimator (adapters 계층)
//
// 신설 파일이다(2026-09-11). ports/pose.js 의 계약을 채운다 — 이 파일이 MediaPipe 를 아는 유일한 자리이고,
// 도메인(pose·rom·poseTracks)은 여기서 나온 이름 붙은 점만 본다.
//
// ⚠ 경계 ① — **인덱스를 밖으로 내보내지 않는다.** MediaPipe 는 33개 점을 번호로 주는데, 그 번호는
//   BlazePose 의 사정이지 우리 사정이 아니다. LANDMARK_NAMES 가 번호를 이름으로 옮기는 유일한 표이고,
//   다른 모델로 갈아 끼울 때 고치는 것은 이 표 하나다.
//
// ⚠ 경계 ② — **모델 파일을 여기서 받지 않는다.** 어디에 받아 둘지는 설정의 문제라 server.py 와
//   adapters/modelServer.js 가 맡는다. 여기는 이미 받아 둔 파일의 주소를 받아서 쓰기만 한다.
//
// ⚠ 경계 ③ — **분석은 배치다.** `<video>` 를 구간 안에서 일정 간격으로 탐색하며 한 장씩 본다.
//   실시간이 아니라 "이 구간을 재 달라" 이므로, 재생과 무관하게 돌고 진행률을 콜백으로 낸다.
//   ★ `detectForVideo` 는 **타임스탬프가 반드시 커져야** 한다 — 되감으면 내부 추적이 깨진다.
//   ★ 이미 뽑아 둔 프레임(`{images:[{sec, el}]}`)을 줘도 된다. `<video>` 는 **탭이 보일 때만** 디코드하므로
//     백그라운드 탭·자동화에서는 영원히 readyState 0 이다 — 검사 페이지가 그 길을 쓴다. 장차 서버가
//     ffmpeg 으로 프레임을 뽑아 주는 길도 같은 입구다.
//
// ⚠ 경계 ④ — **던지지 않는다.** 모델을 못 읽는 것(안 받아 둠·오프라인)은 예외가 아니라 상태다.
//   한국어 문구는 뷰가 만들고 여기서는 사실만 돌려준다.
//
// ⚠ 유튜브에는 쓸 수 없다. iframe 안의 픽셀은 읽을 수 없으므로 영상 **파일**에만 된다(자르기와 같은 조건).

import { assertPoseEstimator, normalizePoseFrames } from '../../ports/pose.js';

/**
 * BlazePose 33점의 번호 → 우리 이름. **여기 없는 번호는 쓰지 않는다**(눈·귀·입·손가락은 안무에 쓸 일이 없다).
 * 번호 표의 출처는 MediaPipe 의 Pose landmarker 문서다.
 * @type {Readonly<Record<number, string>>}
 */
export const LANDMARK_NAMES = Object.freeze({
  0: 'nose',
  11: 'leftShoulder', 12: 'rightShoulder',
  13: 'leftElbow', 14: 'rightElbow',
  15: 'leftWrist', 16: 'rightWrist',
  23: 'leftHip', 24: 'rightHip',
  25: 'leftKnee', 26: 'rightKnee',
  27: 'leftAnkle', 28: 'rightAnkle',
  31: 'leftFootIndex', 32: 'rightFootIndex'
});

/** 탐색 한 번을 기다리는 상한(ms). 넘으면 그 프레임을 건너뛴다 — 한 장 때문에 전체가 멈추면 안 된다. */
export const SEEK_TIMEOUT_MS = 4000;

/**
 * 연달아 이만큼 못 읽으면 **바로 그만둔다**.
 * ⚠ 브라우저는 **보이지 않는 탭의 영상을 디코드하지 않는다.** 그때 탐색은 영영 착지하지 않으므로,
 *   그냥 두면 프레임마다 상한을 다 기다려 몇 분을 매달린다. 빨리 포기하고 이유를 말하는 편이 낫다.
 */
export const MAX_CONSECUTIVE_MISSES = 3;

/**
 * 한 사람의 landmark 배열(번호 순) → 이름 붙은 점 사전.
 * @param {Array<{x:number,y:number,z:number,visibility?:number}>|undefined} list
 * @returns {Record<string, object>}
 */
export function namePoints(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const [index, name] of Object.entries(LANDMARK_NAMES)) {
    const p = list[Number(index)];
    if (!p) continue;
    out[name] = { x: p.x, y: p.y, z: p.z, score: p.visibility === undefined ? 1 : p.visibility };
  }
  return out;
}

/**
 * MediaPipe 결과 하나 → PoseFrame 의 subjects.
 * ⚠ `landmarks`(화면 0..1)와 `worldLandmarks`(미터)의 **같은 자리끼리** 짝을 짓는다. 개수가 다르면
 *   world 를 버린다 — 어긋난 짝으로 각도를 재면 조용히 틀린 숫자가 나온다.
 * @param {{landmarks?: any[][], worldLandmarks?: any[][]}} result
 * @param {number} [aspect=1] 이 그림의 폭/높이. 화면 좌표로 각을 잴 때 가로 눌림을 되돌리는 데 쓴다
 * @returns {Array<object>}
 */
export function subjectsOf(result, aspect = 1) {
  const screen = (result && result.landmarks) || [];
  const world = (result && result.worldLandmarks) || [];
  const paired = world.length === screen.length;
  return screen.map((list, i) => {
    const points = namePoints(list);
    const scores = Object.values(points).map(p => p.score);
    return {
      points,
      world: paired ? namePoints(world[i]) : null,
      score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 1,
      aspect
    };
  });
}

/** `<video>` 를 그 시각으로 옮기고 실제로 그 그림이 그려질 때까지 기다린다. */
function seekTo(video, sec, timeoutMs) {
  if (Math.abs(video.currentTime - sec) < 0.001 && video.readyState >= 2) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener('seeked', onSeeked);
    try { video.currentTime = sec; } catch { finish(false); }
  });
}

/**
 * MediaPipe 자세 추정기를 만든다. **만들기만 하고 아무것도 받지 않는다** — `load()` 를 불러야 모델이 올라간다.
 *
 * @param {{
 *   baseUrl?: string,        받아 둔 모델 폴더의 주소. 기본 '/models'
 *   modelFile?: string,      그 폴더 안의 자세 모델 파일 이름
 *   numPoses?: number,       한 프레임에서 찾을 사람 수 상한
 *   minConfidence?: number,
 *   importModule?: (url: string) => Promise<any>,   테스트가 가짜 모듈을 준다
 *   timers?: {setTimeout:Function, clearTimeout:Function}
 * }} [options]
 * @returns {import('../../ports/pose.js').PoseEstimator}
 */
export function createMediapipePose(options = {}) {
  const baseUrl = (options.baseUrl || '/models').replace(/\/$/, '');
  const modelFile = options.modelFile || 'pose_landmarker_full.task';
  const numPoses = Number.isFinite(options.numPoses) ? Math.max(1, options.numPoses) : 2;
  const minConfidence = Number.isFinite(options.minConfidence) ? options.minConfidence : 0.5;
  const importModule = options.importModule || ((url) => import(/* @vite-ignore */ url));

  let landmarker = null;
  let loadState = 'idle';
  let error = '';
  /** 어느 연산 장치로 섰는가('GPU' | 'CPU' | ''). 속도가 6배 갈리므로 결과와 함께 남긴다. */
  let delegateUsed = '';
  /** detectForVideo 에 넘긴 마지막 타임스탬프. **반드시 커져야 한다**(경계 ③). */
  let lastStamp = -1;

  const estimator = {
    id: `mediapipe/${modelFile.replace(/^pose_landmarker_|\.task$/g, '')}`,

    describe() {
      return { name: 'MediaPipe Pose Landmarker', model: modelFile, space: 'world', maxSubjects: numPoses, delegate: delegateUsed };
    },

    getState() {
      return { load: loadState, error, delegate: delegateUsed };
    },

    /** ★ 던지지 않는다. 모델이 없거나 못 읽으면 `{ok:false, error}` 다. */
    async load() {
      if (loadState === 'ready') return { ok: true, error: '' };
      loadState = 'loading';
      error = '';
      try {
        const mod = await importModule(`${baseUrl}/vision_bundle.mjs`);
        const fileset = await mod.FilesetResolver.forVisionTasks(`${baseUrl}/wasm`);
        const build = (delegate) => mod.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${baseUrl}/${modelFile}`, delegate },
          runningMode: 'VIDEO',
          numPoses,
          minPoseDetectionConfidence: minConfidence,
          minPosePresenceConfidence: minConfidence,
          minTrackingConfidence: minConfidence
        });
        // ⚠ **GPU 를 먼저 쓴다**(2026-09-13). 이 값을 안 주면 MediaPipe 는 CPU 로 돈다. 실측(맥북,
        //   pose_landmarker_full, 1020x990, numPoses 2)으로 CPU 5.6fps · GPU 36.6fps — **6.5배**다.
        //   재생하며 따라 그리려면 30fps 를 넘겨야 하므로, 이 한 줄이 "미리 분석해 두는 기능"과
        //   "보면서 따라 그리는 기능"을 가른다.
        // ⚠ 안 되는 기기가 있다(WebGL 차단·오래된 GPU·원격 데스크톱). 그때는 **조용히 CPU 로 떨어진다** —
        //   느릴 뿐 결과는 같으므로 기능을 끄는 것보다 낫다. 어느 쪽으로 섰는지는 delegate 에 남는다.
        try {
          landmarker = await build('GPU');
          delegateUsed = 'GPU';
        } catch (gpuErr) {
          landmarker = await build('CPU');
          delegateUsed = 'CPU';
        }
        loadState = 'ready';
        return { ok: true, error: '' };
      } catch (e) {
        loadState = 'error';
        error = String(e && e.message ? e.message : e);
        landmarker = null;
        delegateUsed = '';
        return { ok: false, error };
      }
    },

    /**
     * 구간을 훑어 프레임마다 관절점을 뽑는다. **절대 reject 하지 않는다**(계약).
     * @param {any} video `<video>` 엘리먼트, 또는 이미 뽑아 둔 프레임 `{images:[{sec, el}]}`
     * @param {import('../../ports/pose.js').PoseRequest} request
     */
    async analyze(video, request = {}) {
      const fail = (msg) => ({ ok: false, frames: [], space: 'world', error: msg });
      if (loadState !== 'ready' || !landmarker) {
        const res = await estimator.load();
        if (!res.ok) return fail(res.error);
      }
      const images = video && Array.isArray(video.images) ? video.images : null;
      if (!images && (!video || typeof video.addEventListener !== 'function')) return fail('영상이 없습니다.');

      /** 그림의 폭/높이. `<video>` 와 `<img>` 가 크기를 다른 이름으로 들고 있다. */
      const aspectOf = (el) => {
        const w = el.videoWidth || el.naturalWidth || el.width || 0;
        const h = el.videoHeight || el.naturalHeight || el.height || 0;
        return w > 0 && h > 0 ? w / h : 1;
      };

      /** 한 장을 넘겨 관절점을 뽑는다. 두 입구가 공유하는 유일한 자리다. */
      const detect = (source, sec) => {
        // ⚠ 타임스탬프는 단조 증가여야 한다. 같은 시각이 두 번 나오면 1ms 를 밀어 준다.
        const stamp = Math.max(lastStamp + 1, Math.round(sec * 1000));
        lastStamp = stamp;
        return landmarker.detectForVideo(source, stamp);
      };

      const fps = Number.isFinite(request.fps) && request.fps > 0 ? request.fps : 15;
      const from = Number.isFinite(request.fromSec) ? Math.max(0, request.fromSec) : 0;
      const duration = images
        ? (images.length ? images[images.length - 1].sec + 1 / fps : null)
        : (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
      const rawTo = Number.isFinite(request.toSec) ? request.toSec : (duration === null ? from : duration);
      const to = duration === null ? rawTo : Math.min(rawTo, duration);
      if (!(to > from)) return fail('분석할 구간이 없습니다.');

      const step = 1 / fps;
      const total = Math.max(1, Math.floor((to - from) / step));
      const onProgress = typeof request.onProgress === 'function' ? request.onProgress : () => {};
      const isCancelled = typeof request.isCancelled === 'function' ? request.isCancelled : () => false;

      const frames = [];

      // ── 이미 뽑아 둔 프레임 ──
      if (images) {
        const picked = [];
        let want = from;
        for (const item of images) {
          if (item.sec + 1e-9 < from || item.sec >= to) continue;
          if (item.sec + 1e-9 < want) continue;
          picked.push(item);
          want += step;
        }
        for (let i = 0; i < picked.length; i++) {
          if (isCancelled()) break;
          let result;
          try {
            result = detect(picked[i].el, picked[i].sec);
          } catch (e) {
            return { ok: false, frames: normalizePoseFrames(frames), space: 'world', error: String(e && e.message ? e.message : e) };
          }
          frames.push({ sec: picked[i].sec, subjects: subjectsOf(result, aspectOf(picked[i].el)) });
          onProgress(i + 1, picked.length);
        }
        return { ok: true, frames: normalizePoseFrames(frames), space: 'world', error: '' };
      }

      // ── <video> 를 탐색하며 ──
      // 메타데이터조차 없으면 탐색할 시간축이 없다. 기다려 봐야 소용없으므로 여기서 접는다.
      if (video.readyState < 1) {
        return fail('영상이 아직 준비되지 않았습니다. 이 탭이 화면에 보이는 상태에서 영상이 뜬 뒤 다시 누르세요.');
      }
      let misses = 0;
      const wasPaused = video.paused;
      try { video.pause(); } catch { /* 무시 */ }

      for (let i = 0; i < total; i++) {
        if (isCancelled()) break;
        const sec = from + i * step;
        const landed = await seekTo(video, sec, SEEK_TIMEOUT_MS);
        if (!landed) {
          onProgress(i + 1, total);
          if (++misses >= MAX_CONSECUTIVE_MISSES && frames.length === 0) {
            if (!wasPaused) { try { video.play(); } catch { /* 무시 */ } }
            return fail('영상 프레임을 읽지 못했습니다. 이 탭이 화면에 보이는 상태에서 다시 누르세요 — 브라우저는 보이지 않는 탭의 영상을 디코드하지 않습니다.');
          }
          continue;
        }
        misses = 0;
        let result;
        try {
          result = detect(video, video.currentTime);
        } catch (e) {
          return { ok: false, frames: normalizePoseFrames(frames), space: 'world', error: String(e && e.message ? e.message : e) };
        }
        frames.push({ sec: video.currentTime, subjects: subjectsOf(result, aspectOf(video)) });
        onProgress(i + 1, total);
      }
      if (!wasPaused) { try { video.play(); } catch { /* 무시 */ } }
      return { ok: true, frames: normalizePoseFrames(frames), space: 'world', error: '' };
    },

    /** ★ 멱등. 다시 쓰려면 load() 를 다시 부른다. */
    destroy() {
      if (landmarker && typeof landmarker.close === 'function') {
        try { landmarker.close(); } catch { /* 무시 */ }
      }
      landmarker = null;
      loadState = 'idle';
      lastStamp = -1;
    }
  };

  return assertPoseEstimator(estimator, 'mediapipePose');
}
