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
//   4. 레코드를 날조하지 않는다. v1 파일은 versions/practiceLogs/media 가 **빈 배열**이지
//      "버전 0" 이 자동 생성되지 않는다(createdAt 이 역사에 대해 거짓말을 하고, 왕복이 멱등을 잃는다).

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
    describe: '링크 4필드를 doc.links 로 묶고 projectId/versions/practiceLogs/media 를 신설한다',
    up(raw, ctx = {}) {
      const {
        youtubeUrl = '', youtubeTitle = '', clickupUrl = '', customLinks = [],
        rows, cols, categories, moveLibrary, placements, routines,
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
          links: { youtubeUrl, youtubeTitle, clickupUrl, customLinks }
        },
        versions: [], practiceLogs: [], media: [],
        // 구버전 index.html(GitHub Pages 캐시 등)이 열어도 링크를 잃지 않도록 남기는 미러.
        // v3 에서 제거한다. 4필드뿐이라 비용이 거의 없다.
        youtubeUrl, youtubeTitle, clickupUrl, customLinks
      };
    }
  })
]);

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
