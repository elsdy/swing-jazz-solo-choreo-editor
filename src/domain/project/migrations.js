// src/domain/project/migrations.js — 저장 포맷 마이그레이션 (순수, ./schema.js 만 import)
//
// 신설 파일이다. 원본 index.html 은 `version` 을 6곳(4027·4051·4061·4442·4470·5275)에서 **쓰기만** 하고
// 읽는 코드가 한 곳도 없었다(grep "\.version" 0 hits). 이 파일이 그 필드의 첫 독자다.
//
// 배선 지점 4곳(전부 JSON.parse 직후, 정확히 한 번):
//   4394 전체 임포트 · 4413 부분 임포트 · renderSavedList 의 최근목록 항목 로드 · (장차) 오토세이브 복원
//   ⚠ 세 번째를 빠뜨리면 handleProjectImport(4398)가 **원본 raw 를 그대로** 최근목록에 넣기 때문에
//     choreo_saved_files 안에 v1 blob 과 v2 blob 이 섞인다.
//
// 설계 원칙 4가지:
//   1. 마이그레이션은 검증하지 않는다. 시대/모양만 맞추고, 클램프·복구는 normalize.js 가 한다.
//   2. 입력을 변형하지 않는다. up() 은 항상 새 객체를 돌려준다.
//   3. 미래 스키마는 거부한다. 열고 다시 저장하는 순간 다운그레이드로 필드가 소멸하기 때문이다.
//   4. 레코드를 날조하지 않는다. v1 파일은 versions/practiceLogs/mediaRefs 가 **빈 배열**이지
//      "버전 0" 이 자동 생성되지 않는다(createdAt 이 역사에 대해 거짓말을 하고, 왕복이 멱등을 잃는다).
//      거꾸로 파일에 이미 있는 판본 · 기록은 빈 배열로 덮지 않는다(RM-29).

import { SCHEMA_VERSION } from './schema.js';

/**
 * 파일이 선언한 스키마 버전. version 이 없거나 정수가 아니면 v1 로 본다
 * (원본에는 version 을 읽는 코드가 없었으므로 version 없는 임의 JSON 도 지금처럼 열려야 한다).
 * @param {any} raw
 * @returns {number}
 */
export function detectSchemaVersion(raw) {
  const v = raw && raw.version;
  return Number.isInteger(v) && v > 0 ? v : 1;
}

/**
 * 마이그레이션 단계 목록. from 오름차순으로 한 단계씩 적용된다.
 * @type {ReadonlyArray<{from:number,to:number,describe:string,up:(raw:any,ctx:{nowIso:string|null})=>any}>}
 */
export const MIGRATIONS = Object.freeze([
  Object.freeze({
    from: 1,
    to: 2,
    describe: '링크 4필드를 doc.links 로 묶고 최상위 media 블록을 doc.media 로 내리며 projectId/versions/practiceLogs/media 를 신설한다',
    up(raw, ctx = {}) {
      const {
        youtubeUrl = '', youtubeTitle = '', clickupUrl = '', customLinks = [],
        rows, cols, categories, moveLibrary, placements, routines,
        // ⚠ v1 파일의 최상위 `media` 는 우리가 쓴 영상 블록(`{tempo, source}`)이다. 여기서 꺼내
        //   doc.media 로 옮기지 않으면 아래 `media: []`(최상위 MediaRef 자리)가 덮어써 통째로 사라진다.
        //   ⚠ 옛 파일에는 이 키가 아예 없다 — 그때 doc.media 는 null 이고, 읽는 쪽(normalize.js)의
        //     normalizeMedia 가 DEFAULT_MEDIA 로 채운다. 여기서 기본값을 만들지 않는 이유는
        //     "마이그레이션은 검증하지 않는다"(원칙 1) 와 "레코드를 날조하지 않는다"(원칙 4) 때문이다.
        media: docMedia,
        fileName = '', savedAt,
        version: _version,
        ...rest
      } = raw;
      return {
        ...rest,
        version: 2,
        // 결정론적 projectId — 같은 파일을 두 번 열어도 프로젝트가 복제되지 않고,
        // 최근목록의 현행 fileName 기준 dedupe 와도 정확히 일치한다.
        projectId: `v1:${fileName}`,
        fileName,
        savedAt: savedAt || ctx.nowIso || null,
        doc: {
          rows, cols, categories, moveLibrary, placements,
          routines: Array.isArray(routines) ? routines : [],
          links: { youtubeUrl, youtubeTitle, clickupUrl, customLinks },
          media: docMedia === undefined ? null : docMedia
        },
        // ⚠ 최상위 `media` 는 doc.media 와 **이름만 같고 타입이 다르다**(MediaRef[] 자리, 아직 아무도
        //   만들지 않는다). readProjectData 가 `{...value, ...value.doc}` 로 펼칠 때 doc 쪽이 이겨서
        //   우리가 읽고 싶은 블록이 나온다. 이름 충돌 정리는 v3 의 몫이다 — schema.js 의 ProjectFile 참조.
        // ⚠ 파일에 이미 판본 · 기록이 있으면(최상위 배열) **그대로 옮긴다**(RM-29). 전에는 늘 빈 배열로 덮어,
        //   version 1 로 쓰인 판본이 이 단계를 지나며 조용히 사라질 길이 있었다. 모양 검사는 normalize 의 몫이다(원칙 1).
        versions: listOr(raw.versions), practiceLogs: listOr(raw.practiceLogs), media: [],
        // 구버전 index.html(GitHub Pages 캐시 등)이 열어도 링크를 잃지 않도록 남기는 미러.
        // v3 에서 제거한다. 4필드뿐이라 비용이 거의 없다.
        youtubeUrl, youtubeTitle, clickupUrl, customLinks
      };
    }
  }),
  Object.freeze({
    from: 2,
    to: 3,
    describe: '최상위 MediaRef 목록의 이름을 media 에서 mediaRefs 로 옮기고 versions/practiceLogs 를 배열로 맞춘다',
    up(raw) {
      const { media: topMedia, version: _version, ...rest } = raw;
      const out = {
        ...rest,
        version: 3,
        versions: listOr(raw.versions),
        practiceLogs: listOr(raw.practiceLogs)
      };
      // ⚠ 최상위 `media` 가 **배열일 때만** MediaRef 목록이다(v1→v2 가 만든 빈 자리). 배열이 아니면 영상 목록 블록이다 —
      //   최근 목록에는 `{...value, ...value.doc}` 로 펼친 v2 값이 담긴 적이 있어 거기서는 최상위 media 가 doc.media 의 사본이다.
      //   그것을 버리면 doc 이 없는 값에서 영상 목록이 사라진다. 그러니 블록이면 그 자리에 그대로 둔다.
      if (Array.isArray(topMedia)) out.mediaRefs = Array.isArray(raw.mediaRefs) ? raw.mediaRefs : topMedia;
      else if (topMedia !== undefined) out.media = topMedia;
      return out;
    }
  })
]);

/** 배열이면 그대로, 아니면 빈 배열. 마이그레이션은 모양만 맞춘다(원칙 1) — 원소는 normalize 가 본다. */
// @complexity time=O(1) space=O(1) cc=2
function listOr(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 프로젝트 파일을 최신 스키마까지 끌어올린다.
 *
 * 도메인이므로 시각을 스스로 만들지 않는다. savedAt 이 없는 v1 파일에 시각을 채우려면
 * `options.now` 로 ISO 문자열이나 `() => string` 을 넘겨라. 안 넘기면 savedAt 은 null 로 남는다.
 *
 * @param {any} raw  JSON.parse 직후의 값
 * @param {{ now?: string | (() => string) }} [options]
 * @returns {{ok:true, value:any, from:number, to:number, applied:string[]}
 *          |{ok:false, code:'NOT_AN_OBJECT'|'FUTURE_SCHEMA'|'NO_MIGRATION_PATH', from?:number, expected?:number}}
 */
export function migrateProjectFile(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'NOT_AN_OBJECT' };

  const from = detectSchemaVersion(raw);
  if (from > SCHEMA_VERSION) {
    // 미래 파일을 추측해서 열면 안 된다 — 열고 다시 저장하는 순간 다운그레이드로 필드가 소멸한다.
    return { ok: false, code: 'FUTURE_SCHEMA', from, expected: SCHEMA_VERSION };
  }

  const { now = null } = options;
  const nowIso = typeof now === 'function' ? now() : now;

  let cur = raw;
  let v = from;
  const applied = [];
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS.find(m => m.from === v);
    if (!step) return { ok: false, code: 'NO_MIGRATION_PATH', from: v };
    cur = step.up(cur, { nowIso });
    v = step.to;
    applied.push(`${step.from}→${step.to}`);
  }
  return { ok: true, value: cur, from, to: v, applied };
}
