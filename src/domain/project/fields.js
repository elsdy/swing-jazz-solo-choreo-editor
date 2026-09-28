// src/domain/project/fields.js — 필드 등록표(schema.FIELD_TABLE)를 **빠짐없이** 덮었는지 재는 자리 (순수, ./schema.js 만 import)
//
// 필드마다의 규칙은 그 규칙을 쓰는 파일이 갖는다 — 스냅샷에 담고 되살리는 법은 snapshot.js, 파일에 쓰는 법은
// serialize.js, store 의 어느 자리에 사는지는 usecases/docFields.js. 규칙을 한 파일로 모으면 snapshot.js ↔ 그 파일이
// 서로를 부르는 고리가 생기고, 계층이 다른 것(store 의 모양)까지 도메인으로 끌려온다.
//
// 대신 **셋 다 필드 이름을 키로 한 표**로 적고, 이 함수를 지나게 한다. 등록표에 한 줄을 더했는데 어느 한 표에
// 그 줄이 없으면 **모듈을 불러오는 순간 던진다** — 앱이 뜨지 않고 시험이 모두 붉어진다. 전에는 오류 없이 값만
// 사라졌다(schema.FIELD_TABLE 주석의 「겪은 일」).

import { DOC_FIELDS } from './schema.js';

/**
 * 필드별 규칙 표가 등록표와 **같은 키 집합**인지 보고, 얼린 표를 돌려준다.
 * @template T
 * @param {Object<string, T>} ops   필드 이름 → 그 파일의 규칙
 * @param {string} where           어긋났을 때 알릴 자리(파일 이름)
 * @returns {Readonly<Object<string, T>>}
 */
export function byField(ops, where) {
  const have = Object.keys(ops);
  const missing = DOC_FIELDS.filter(k => !have.includes(k));
  const extra = have.filter(k => !DOC_FIELDS.includes(k));
  if (missing.length || extra.length) {
    throw new Error(`${where}: 필드 등록표(schema.FIELD_TABLE)와 어긋난다 — ` +
      (missing.length ? `빠진 필드 ${missing.join(', ')}` : '') +
      (missing.length && extra.length ? ' · ' : '') +
      (extra.length ? `등록표에 없는 필드 ${extra.join(', ')}` : ''));
  }
  return Object.freeze({ ...ops });
}
