#!/usr/bin/env node
// tests/run.mjs — 골든 회귀 러너 (node, 의존성 0)
//
//   node tests/run.mjs                모두 실행
//   node tests/run.mjs --only=move    id 에 'move' 가 든 시나리오만
//   node tests/run.mjs --verbose      통과한 것도 한 줄씩 출력
//   node tests/run.mjs --list         시나리오 목록만
//   node tests/run.mjs --json         결과를 JSON 으로(에디터/CI 용)
//   node tests/run.mjs --strict       어댑터가 없으면 실패로 간주
//
// 이 러너는 도메인 코드를 직접 부르지 않는다. 오직 아래 어댑터 모듈만 부른다:
//
//     src/testing/golden-adapter.mjs   →  export function createAdapter()
//
// 리팩터링이 해야 할 일은 그 파일 하나를 만들어 tests/replay.mjs 상단에 적힌
// adapter 계약을 새 도메인/유스케이스 모듈 위에 구현하는 것뿐이다.
// 어댑터가 없으면 러너는 PENDING 을 알리고 0으로 끝난다(리팩터링 전에도 CI 가 붉지 않도록).
//
// 골든을 "다시 만드는" 기능은 일부러 넣지 않았다. 골든은 index.html 원문에서만 생성되며
// (스크래치패드의 extract.mjs + make-golden.mjs), 러너가 갱신할 수 있으면 안전망이 아니다.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runAll, lintGolden, REPLAY_VERSION } from './replay.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const GOLDEN_PATH = resolve(HERE, 'golden/placement-algorithms.json');
const ADAPTER_PATH = resolve(ROOT, 'src/testing/golden-adapter.mjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

// ── 골든 로드 ────────────────────────────────────────────────────────────────
if (!existsSync(GOLDEN_PATH)) {
  console.error(`골든이 없다: ${GOLDEN_PATH}`);
  process.exit(1);
}
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

const lint = lintGolden(golden);
if (lint.length) {
  console.error(`${C.r}골든 파일 자체가 깨졌다:${C.x}\n  ` + lint.join('\n  '));
  process.exit(1);
}

const only = opt('only');
if (only) golden.scenarios = golden.scenarios.filter(s => s.id.includes(only) || (s.desc || '').includes(only));

if (flag('list')) {
  for (const s of golden.scenarios) console.log(`${s.id}\n  ${C.d}${s.desc}${C.x}`);
  console.log(`\n${golden.scenarios.length}개`);
  process.exit(0);
}

// ── 어댑터 로드 ──────────────────────────────────────────────────────────────
let createAdapter = null;
let adapterError = null;
if (existsSync(ADAPTER_PATH)) {
  try {
    ({ createAdapter } = await import(pathToFileURL(ADAPTER_PATH).href));
    if (typeof createAdapter !== 'function') throw new Error('createAdapter 를 export 하지 않는다');
  } catch (err) {
    adapterError = err;
  }
}

if (!createAdapter) {
  const why = adapterError ? `\n  로드 실패: ${adapterError.message}` : '';
  console.log(`${C.y}PENDING${C.x} — ${ADAPTER_PATH.replace(ROOT + '/', '')} 이 아직 없다.${why}`);
  console.log(`${C.d}골든 ${golden.scenarios.length}개가 대기 중. 리팩터링 후 아래 모양의 파일 하나만 만들면 검사가 시작된다:${C.x}

  // src/testing/golden-adapter.mjs
  export function createAdapter() {
    return {
      reset(setup) { ... },            // 보드/동작/루틴/시드 배치 주입
      placeMove({board,moveId,row,startIndex,count}) { ... },
      // … tests/replay.mjs 상단의 adapter 계약 참고
      placements(board) { ... },       // 현재 배치 배열
      log() { return { render, alerts }; }
    };
  }
`);
  process.exit(flag('strict') ? 1 : 0);
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
const started = Date.now();
const { results, tally } = runAll(golden, createAdapter());
const ms = Date.now() - started;

if (flag('json')) {
  console.log(JSON.stringify({ tally, ms, replayVersion: REPLAY_VERSION, results: results.map(({ actual, ...r }) => r) }, null, 2));
  process.exit(tally.fail || tally.error ? 1 : 0);
}

for (const r of results) {
  if (r.status === 'pass') {
    if (flag('verbose')) console.log(`${C.g}  ok${C.x}  ${r.id} ${C.d}${r.desc}${C.x}`);
    continue;
  }
  const tag = r.status === 'skip' ? `${C.y}skip${C.x}` : `${C.r}FAIL${C.x}`;
  console.log(`${tag}  ${C.b}${r.id}${C.x}\n      ${C.d}${r.desc}${C.x}`);
  for (const d of r.diffs) console.log('      ' + d.split('\n').join('\n      '));
  console.log('');
}

const bad = tally.fail + tally.error;
const line = `${tally.pass} pass, ${tally.fail} fail, ${tally.skip} skip, ${tally.error} error  (${ms}ms)`;
console.log(bad ? `${C.r}${line}${C.x}` : `${C.g}${line}${C.x}`);
if (bad) {
  console.log(`${C.d}골든은 index.html 의 "현재 동작"을 기록한 것이다. 차이가 의도한 개선이라면
골든을 고치지 말고, 무엇을 왜 바꿨는지 커밋 메시지에 남긴 뒤 스크래치패드의
make-golden.mjs 를 index.html 이 아닌 새 코드 기준으로 다시 만들어야 한다.${C.x}`);
}
process.exit(bad ? 1 : 0);
