// tools/check-arch.mjs — 계층 규칙을 기계로 검사한다. 의존성 0(node:fs, node:path만).
//
//   node tools/check-arch.mjs          위반이 있으면 exit 1
//   node tools/check-arch.mjs --list   각 파일의 계층과 import 를 나열
//
// 이 검사가 존재하는 이유: 의존 방향은 리뷰가 아니라 스크립트가 지켜야 한다.
// domain 에 Date.now() 가 한 줄 들어가는 순간 골든 테스트가 조용히 불안정해지는데,
// 그건 눈으로 잡히지 않는다. → docs/PRINCIPLES.md 의 R-2, D-1 참조.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// ── 계층: 낮은 rank 쪽만 import 할 수 있다 ──────────────────────────────────
const RANK = {
  domain: 0,
  ports: 1,
  adapters: 1,
  usecases: 2,
  ui: 3,
  input: 3,
  app: 4,
  testing: 4,
};

// 같은 rank 3(ui/input)끼리는 서로 import 하지 않는다 — app/main.js 가 주입으로 잇는다.
// 유일한 예외: 셀렉터·클래스명 상수만 든 공유 리프.
const SAME_RANK_EXCEPTIONS = new Set(['src/ui/domContract.js']);

// rank 가 같아도 금지하는 방향 (adapters 는 구현, ports 는 계약)
const FORBIDDEN_PAIRS = [
  ['ports', 'adapters', 'ports 는 구현을 알면 안 된다'],
  ['ports', 'domain', 'ports 는 import 가 0개여야 한다'],
  ['ports', 'ports', 'ports 는 서로도 import 하지 않는다'],
  ['usecases', 'adapters', 'usecases 는 어댑터를 주입받아야 한다 (import 금지)'],
  ['domain', 'ports', 'domain 은 아무것도 import 하지 않는다 (같은 domain 안은 허용)'],
];

// ── 순수성: 이 계층에서 써서는 안 되는 브라우저·비결정 전역 ──────────────────
const IMPURE = [
  'document', 'window', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'alert', 'prompt', 'confirm', 'navigator', 'location', 'history',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
  'Date', 'Math.random', 'crypto', 'structuredClone', 'performance',
];
const PURE_LAYERS = new Set(['domain', 'ports', 'usecases']);

// ── 소스에서 주석·문자열·정규식 리터럴을 지운다 (오탐 제거) ───────────────────
function strip(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prevMeaningful = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') out += '\n';
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    // 정규식 리터럴: 앞이 값이 아닐 때만 (나눗셈과 구별)
    if (c === '/' && !'})]abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$'.includes(prevMeaningful)) {
      let j = i + 1;
      let ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '/') { ok = true; break; }
        j++;
      }
      if (ok) { i = j + 1; out += '/RE/'; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prevMeaningful = c;
    i++;
  }
  return out;
}

// 객체 리터럴의 메서드 정의(`alert(message) {`)는 전역 호출이 아니다.
// ports/env.js 의 Dialogs 구현이 여기 걸린다 — 계약이 못박은 이름이라 바꿀 수 없다.
const METHOD_DEF = /^\s*(?:async\s+)?(alert|confirm|prompt|fetch|history|location)\s*\([^)]*\)\s*\{/;

function findImpure(stripped) {
  const hits = [];
  stripped.split('\n').forEach((line, idx) => {
    if (METHOD_DEF.test(line)) return;
    for (const token of IMPURE) {
      const pattern = token.includes('.')
        ? new RegExp(`(?<![\\w$.])${token.replace('.', '\\.')}\\b`)
        : new RegExp(`(?<![\\w$.])${token}\\s*[(.\\[]`);
      if (pattern.test(line)) hits.push({ line: idx + 1, token, text: line.trim().slice(0, 90) });
    }
  });
  return hits;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(stripped, srcText) {
  const found = new Set();
  // 문자열을 지운 뒤라 경로가 사라진다 — import 경로만 원문에서 다시 뽑는다.
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(srcText))) found.add(m[1]);
  }
  return [...found];
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

function layerOf(relPath) {
  const m = relPath.match(/^src\/([^/]+)\//);
  return m ? m[1] : null;
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const listOnly = process.argv.includes('--list');
const problems = [];
const files = walk(SRC).sort();

for (const abs of files) {
  const rel = relative(ROOT, abs).replaceAll('\\', '/');
  const layer = layerOf(rel);
  if (layer === null || !(layer in RANK)) {
    problems.push(`${rel}: 알 수 없는 계층. src/<계층>/ 아래에 두어라 (계층: ${Object.keys(RANK).join(', ')})`);
    continue;
  }
  const text = readFileSync(abs, 'utf8');
  const stripped = strip(text);
  const specs = importsOf(stripped, text);

  if (listOnly) {
    console.log(`${layer.padEnd(9)} rank ${RANK[layer]}  ${rel}  ← ${specs.length ? specs.join(' ') : '(없음)'}`);
  }

  // 1) 순수성
  if (PURE_LAYERS.has(layer)) {
    for (const hit of findImpure(stripped)) {
      problems.push(`${rel}:${hit.line}: ${layer} 계층에서 \`${hit.token}\` 사용 — 인자로 주입받아라\n      ${hit.text}`);
    }
  }

  // 2) import 방향
  for (const spec of specs) {
    if (!spec.startsWith('.')) {
      problems.push(`${rel}: 외부 패키지 import 금지 (\`${spec}\`) — 이 프로젝트는 npm 의존성이 0이다`);
      continue;
    }
    const targetAbs = resolve(dirname(abs), spec);
    const targetRel = relative(ROOT, targetAbs).replaceAll('\\', '/');
    const targetLayer = layerOf(targetRel);
    if (targetLayer === null || !(targetLayer in RANK)) {
      problems.push(`${rel}: src/ 밖을 import (\`${spec}\`)`);
      continue;
    }

    if (RANK[layer] < RANK[targetLayer]) {
      problems.push(`${rel}: 안쪽(rank ${RANK[layer]} ${layer}) 이 바깥(rank ${RANK[targetLayer]} ${targetLayer}) 을 import — 방향이 거꾸로다 (\`${spec}\`)`);
      continue;
    }

    for (const [from, to, why] of FORBIDDEN_PAIRS) {
      if (layer === from && targetLayer === to && !(from === 'domain' && to === 'domain')) {
        problems.push(`${rel}: ${from} → ${to} 금지 — ${why} (\`${spec}\`)`);
      }
    }

    if (RANK[layer] === 3 && RANK[targetLayer] === 3 && layer !== targetLayer && !SAME_RANK_EXCEPTIONS.has(targetRel)) {
      problems.push(`${rel}: 같은 rank 3 계층끼리 import 금지 (\`${spec}\`) — app/main.js 가 주입으로 이어라. 예외: ${[...SAME_RANK_EXCEPTIONS].join(', ')}`);
    }
  }
}

// 3) ports 는 import 0개
for (const abs of files) {
  const rel = relative(ROOT, abs).replaceAll('\\', '/');
  if (layerOf(rel) !== 'ports') continue;
  const text = readFileSync(abs, 'utf8');
  if (importsOf(strip(text), text).length) {
    problems.push(`${rel}: ports 는 import 가 0개여야 한다 — 계약만 두고 구현을 참조하지 마라`);
  }
}

if (listOnly) console.log('');

if (problems.length) {
  console.error(`계층 규칙 위반 ${problems.length}건\n`);
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\n규칙: import 는 언제나 안쪽으로만 — app(4) → adapters|ui|input(3) → usecases(2) → ports(1) → domain(0).');
  console.error('자세한 내용은 docs/ARCHITECTURE.md 를 보라.');
  process.exit(1);
}

console.log(`계층 규칙 통과 — ${files.length}개 파일, 위반 0건`);
