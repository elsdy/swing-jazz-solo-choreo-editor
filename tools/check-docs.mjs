// tools/check-docs.mjs — 문서와 등록부를 기계로 대조한다. 의존성 0.
//
//   node tools/check-docs.mjs
//
// 눈으로 훑으면 반드시 빠뜨린다. 검사하는 것은 다섯이다.
//   ① 등록부에 있는데 파일이 없는 항목 — 목록에서 눌렀을 때 빈 화면이 뜬다
//   ② 파일은 있는데 등록부에 없는 문서 — 사용자 눈에는 문서가 늘지 않은 것과 같다
//   ③ 문서끼리 거는 링크의 앵커가 뷰어가 만드는 id 와 맞는지
//   ④ 뷰어 렌더 결과의 제목·목록·표·코드블록 개수가 원문과 맞는지
//   ⑤ 튜토리얼·기능 설명서가 백틱으로 인용한 화면 라벨이 지금 화면 코드에 있는지(tools/lib/doc-labels.mjs)
//      — 라벨을 바꾸고 두 문서를 빠뜨린 커밋이 여기서 붉어진다

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, buildToc } from '../src/ui/docsHub.js';
import { DOCS, DOC_GROUPS, idForFileName } from '../src/ui/docsRegistry.js';
import { LABEL_DOCS, NOT_LABELS, checkDocLabels, loadScreenFiles } from './lib/doc-labels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 앱에서 읽을 문서가 아닌 것 — 등록 대상에서 의도적으로 제외한다
const NOT_APP_DOCS = [
  /^\.github\//,
  /^node_modules\//,
  /^tests\//,
  /^\.claude\//,
  // 로드맵 보드(~/Github/roadmap-board)가 만들고 읽는 항목별 계획서 — 앱의 문서 허브가 아니라 보드의 항목 자세히와
  // 떠 있는 위젯(`🧭 로드맵`)에서 읽는다. 35개가 등록부에 한 줄씩 들어오면 문서 목록이 계획서로 덮인다(2026-09-29)
  /^docs\/roadmap\/plans\//,
];

function walkMarkdown(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMarkdown(p, acc);
    else if (p.endsWith('.md')) acc.push(relative(ROOT, p).replaceAll('\\', '/'));
  }
  return acc;
}

const problems = [];
const notes = [];

// ── ① 등록부 → 파일 ─────────────────────────────────────────────────────────
const registered = new Set(DOCS.map(d => d.path));
for (const d of DOCS) {
  if (!existsSync(join(ROOT, d.path))) {
    problems.push(`등록부에 있는데 파일이 없다: ${d.path} (id=${d.id}) — 목록에서 누르면 빈 화면이 뜬다`);
  }
  if (!DOC_GROUPS.some(g => g.id === d.group)) {
    problems.push(`${d.id}: 알 수 없는 갈래 '${d.group}'`);
  }
}

// ── ② 파일 → 등록부 ─────────────────────────────────────────────────────────
for (const f of walkMarkdown(ROOT)) {
  if (registered.has(f)) continue;
  if (NOT_APP_DOCS.some(re => re.test(f))) { notes.push(`판정상 등록 제외: ${f}`); continue; }
  problems.push(`파일은 있는데 등록부에 없다: ${f} — 앱에서 읽을 문서면 src/ui/docsRegistry.js 에 한 줄 더하라`);
}

// ── ③④ 렌더와 링크 ──────────────────────────────────────────────────────────
const anchorsOf = new Map();
const links = [];
const stats = [];

for (const d of DOCS) {
  const abs = join(ROOT, d.path);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, 'utf8');
  const { html, headings } = renderMarkdown(src);
  const toc = buildToc(headings);
  anchorsOf.set(d.id, new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])));

  const srcHeadings = (src.match(/^#{1,4} .+$/gm) || []).length;
  const srcFences = (src.match(/^\s*```/gm) || []).length / 2;
  const srcItems = (src.match(/^\s*[-*+] .+$/gm) || []).length;
  const outHeadings = (html.match(/<h[1-4] /g) || []).length;
  const outPre = (html.match(/<pre>/g) || []).length;
  const outItems = (html.match(/<li>/g) || []).length;

  if (outHeadings !== srcHeadings) problems.push(`${d.path}: 제목 ${srcHeadings}개인데 ${outHeadings}개만 렌더됐다`);
  if (outPre !== srcFences) problems.push(`${d.path}: 코드블록 ${srcFences}개인데 ${outPre}개만 렌더됐다`);
  if (outItems < srcItems) problems.push(`${d.path}: 목록 항목 ${srcItems}개인데 ${outItems}개만 렌더됐다`);
  if (/&lt;a (id|name)=/.test(html)) problems.push(`${d.path}: 명시적 앵커가 글자로 새어 나왔다`);

  stats.push(`${d.path.padEnd(24)} 제목 ${String(outHeadings).padStart(3)}  목차 ${toc.length}단1/${toc.reduce((s, n) => s + n.children.length, 0)}단2  ${(src.length / 1024).toFixed(0)}KB`);

  for (const m of src.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:)/i.test(href)) continue;
    const [file, hash] = href.split('#');
    links.push({ from: d.id, fromPath: d.path, file, hash: hash || '' });
  }
}

for (const l of links) {
  const targetId = l.file ? idForFileName(l.file) : l.from;
  if (l.file && !targetId) {
    problems.push(`${l.fromPath}: 등록부에 없는 문서로 링크한다 → ${l.file}`);
    continue;
  }
  if (!anchorsOf.has(targetId)) continue; // 파일 없음은 ①에서 이미 잡혔다
  if (l.hash && !anchorsOf.get(targetId).has(l.hash)) {
    problems.push(`${l.fromPath}: 앵커가 없다 → ${l.file || ''}#${l.hash}`);
  }
}

// ── ⑤ 라벨 인용 ─────────────────────────────────────────────────────────────
const labelDocs = Object.fromEntries(LABEL_DOCS.filter(f => existsSync(join(ROOT, f))).map(f => [f, readFileSync(join(ROOT, f), 'utf8')]));
const labels = checkDocLabels(labelDocs, loadScreenFiles(ROOT));
for (const m of labels.misses) {
  const near = m.near.length ? ` — 비슷한 화면 글자: ${m.near.map(n => `「${n}」`).join(' · ')}` : '';
  problems.push(`${m.doc} ${m.line}줄: \`${m.quote}\` 가 화면 어디에도 없다${near}`);
}
for (const q of labels.badExclusions) problems.push(`tools/lib/doc-labels.mjs NOT_LABELS: '${q}' 에 이유가 없다 — 왜 라벨이 아닌지 적는다`);
for (const q of labels.unusedExclusions) problems.push(`tools/lib/doc-labels.mjs NOT_LABELS: '${q}' 를 인용한 곳이 이제 없다 — 목록에서 지운다`);

// ── 보고 ────────────────────────────────────────────────────────────────────
console.log(stats.join('\n'));
console.log(`\n등록 문서 ${DOCS.length}건 / 갈래 ${DOC_GROUPS.length}개 / 문서 간 링크 ${links.length}개`);
console.log(`라벨 인용 ${labels.checked}개 대조(${LABEL_DOCS.join(' · ')}) / 라벨 아님으로 뺀 것 ${labels.skipped}개(목록 ${NOT_LABELS.length}줄)`);
for (const n of notes) console.log('  · ' + n);

if (problems.length) {
  console.error(`\n문서 검사 실패 ${problems.length}건\n`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('\n문서 검사 통과 — 등록 누락 0, 깨진 앵커 0, 렌더 누락 0, 없는 라벨 인용 0');
