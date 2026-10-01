// tools/lib/doc-labels.mjs — 문서가 백틱으로 인용한 화면 라벨이 지금 화면 코드에 있는지 대조한다. 의존성 0.
//
// check-docs 의 다섯째 검사(⑤)가 이 모듈을 부르고, tests/unit/checkDocs.test.mjs 가 일부러 없는 라벨을
// 인용한 조각을 넣어 붉어지는지 본다.
//
// 왜: 라벨을 바꾼 커밋이 문서를 빠뜨려도 다른 검사는 모두 초록이었다(`동작 팔레트` → `동작 목록` 이 그렇게
// 병합됐고, 2026-09-20·21 개편 뒤 튜토리얼 첫 절은 없어진 화면을 설명하고 있었다). docs/roadmap/plans/RM-06.md.
//
// 어떻게:
//   1. 화면 글자 모으기 — index.html · admin.html 의 태그 사이 글자와 placeholder·title·aria-label 값,
//      src/ 의 JS 문자열 리터럴 속 글자(주석은 뺀다), server.py 의 문자열(서버가 내는 안내 페이지 · 오류).
//      템플릿의 `${…}` 는 「무엇이든」 자리(HOLE)로 남긴다.
//   2. 인용 뽑기 — 문서에서 백틱 인용을 줄 번호와 함께. 코드블록 안은 뺀다.
//   3. 한글이 든 인용만 라벨로 본다(2026-10-01 결정). 명령·경로·키·동작 이름이 저절로 빠진다.
//      영어 라벨(`Undo` 같은)은 대조하지 못한다 — RM-32(영어 UI)나 RM-10(라벨 문자열 표)이 들어오면 기준을 다시 세운다.
//   4. 정규화 — 이모지·기호·공백 차이를 지우고 숫자는 자리표(#)로 바꿔, `루틴으로 편성 (3)` 이
//      `루틴으로 편성 (${count})` 와 맞게 한다.
//   5. 인용이 모은 글자 어딘가의 부분 문자열이면 통과. 없으면 비슷한 라벨 후보와 함께 찍는다.
//   라벨이 아닌 한글 인용(사용자가 적는 값의 예 같은 것)은 NOT_LABELS 에 이유와 함께 — 이유가 비었거나
//   더는 문서에 없는 항목도 실패로 친다(목록이 썩지 않게).
//
// ⚠ 문자열 긁기라 영리하지 않다 — 죽은 코드에 남은 옛 라벨이 있으면 없어진 화면도 「있다」로 통과한다.
//   라벨의 주인이 표 하나가 되면(RM-09 · RM-10) 긁기 대신 그 표를 읽도록 바꾼다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HOLE, scanJs } from './js-text.mjs';

/** 라벨 인용을 대조하는 문서. 다른 문서(로드맵 · 원칙 · 버그 기록)는 옛 라벨을 이력으로 인용하는 것이 정상이다. */
export const LABEL_DOCS = ['docs/TUTORIAL.md', 'docs/FEATURES.md'];

/**
 * 라벨처럼 보이지만 화면 글자가 아닌 한글 인용. **하나마다 이유를 적는다** — 이유가 빈 줄은 검사가 실패로 친다.
 * 오탐이 날 때마다 습관처럼 더하면 검사가 뜻을 잃는다. 먼저 문서가 낡은 것인지 본다.
 * @type {{ quote: string, why: string }[]}
 */
export const NOT_LABELS = [
  { quote: '9/01 첫 시도', why: '사용자가 영상 줄에 붙이는 이름의 예(TUTORIAL) — 화면이 내는 글자가 아니다' },
  { quote: '해', why: '자동 담기가 타이핑 중간 이름으로 파일을 만들면 생길 파일 이름의 예(FEATURES)' },
  { quote: '해피', why: '위와 같다' },
  { quote: '해피핏', why: '위와 같다' },
  { quote: '전체 보드 ↗', why: '로드맵 보드의 떠 있는 위젯 글자 — 이 저장소가 아니라 ~/Github/roadmap-board 의 widget.js 가 그린다' },
];

// ── 화면 글자 ───────────────────────────────────────────────────────────────

const decodeEntities = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** HTML 조각에서 사람이 읽는 글자: 태그 사이 글자 + 라벨 노릇 하는 속성 값. */
function htmlTexts(html) {
  const out = [];
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  for (const m of clean.matchAll(/\s(?:placeholder|title|aria-label|alt|value|data-label|data-title)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    out.push(decodeEntities(m[2] ?? m[3]));
  }
  // 태그는 공백으로 — `<span class="badge">1</span>말하거나 적는다` 를 문서는 `1 말하거나 적는다` 로 인용한다
  const text = decodeEntities(clean.replace(/<[^>]*>/g, ' '));
  if (text.trim()) out.push(text);
  return out;
}

/**
 * 화면에 뜰 수 있는 글자 한 벌. 각 글자는 정규화한 꼴로 들어간다.
 * @param {Record<string, string>} files { 상대경로: 원문 } — index.html · admin.html · src/**.js
 * @returns {string[]}
 */
export function collectScreenTexts(files) {
  const raw = [];
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('.html')) {
      raw.push(...htmlTexts(text));
      // 인라인 스크립트 속 문자열도 화면에 뜬다(admin.html 은 모듈이 아니라 한 장이다)
      for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        for (const s of scanJs(m[1]).strings) raw.push(...stringTexts(s.text));
      }
    } else if (path.endsWith('.py')) {
      // 서버가 내는 화면(관리 화면 밖의 안내 페이지)과 오류 문구. f-문자열의 {…} 는 구멍이다.
      const code = text.replace(/^\s*#.*$/gm, '');   // 줄 주석에 남은 옛 라벨이 「있다」로 치이지 않게
      for (const m of code.matchAll(/(?<![\w'"])f?('|")((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const body = m[0].startsWith('f') ? m[2].replace(/\{[^{}]*\}/g, HOLE) : m[2];
        raw.push(...stringTexts(body));
      }
    } else if (path.endsWith('.js') || path.endsWith('.mjs')) {
      for (const s of scanJs(text).strings) raw.push(...stringTexts(s.text));
    }
  }
  return [...new Set(raw.map(normalize).filter(t => /[가-힣]/.test(t)))];
}

/** JS 문자열 하나 → 글자 조각들. 마크업이 든 템플릿이면 태그를 걷는다. */
function stringTexts(text) {
  const t = text.replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1').replace(/\\u\{?([0-9a-f]+)\}?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return /<[a-z!/]/i.test(t) ? htmlTexts(t) : [t];
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

/**
 * 비교용 꼴: 숫자와 행 이름(`8x1`) → #, 글자·숫자·HOLE 이 아닌 것(이모지·기호·문장부호) → 공백, 공백은 하나로.
 * 「…」 와 「...」, `✎ 이름 바꾸기` 와 `이름 바꾸기`, `(3)` 과 `(${n})` 가 같아진다.
 */
export function normalize(s) {
  return s
    .replace(/\d+x\d+|\d+(?:\.\d+)?/g, '#')
    .replace(new RegExp(`[^\\p{L}\\p{N}#${HOLE}]+`, 'gu'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 문서 인용 ───────────────────────────────────────────────────────────────

/**
 * 문서 원문에서 백틱 인용을 줄 번호와 함께 뽑는다. 코드블록(```) 안은 뺀다.
 * @returns {{ quote: string, line: number }[]}
 */
export function docQuotes(md) {
  const out = [];
  let fence = false;
  md.split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return; }
    if (fence) return;
    for (const m of l.matchAll(/(`+)([^`]+?)\1(?!`)/g)) out.push({ quote: m[2].trim(), line: i + 1 });
  });
  return out;
}

/**
 * 인용을 대조할 조각들로 자른다. 문서가 스스로 쓰는 자리표 — `<이름>` · `[8x1]`(입력칸) · `N개` 의 N·M ·
 * 생략표 `…` · 차례를 잇는 ` → ` — 에서 끊고, 한글이 든 조각만 남긴다. 그래서 `python3 server.py --projects <이름>` 은 대조하지 않는다.
 * 경로(`video-clip/데모/take.mp4`) · 파일 이름(`이름 (2).mp4`) · 명령(`python3 … ~/모델폴더`)은 통째로 뺀다.
 * @returns {string[]}
 */
export function labelPieces(quote) {
  if (NOT_A_LABEL.some(re => re.test(quote))) return [];
  return quote
    .replace(/(?<![A-Za-z])[NM](?![A-Za-z])/g, '0')
    .split(/<[^<>]*>|\[[^\[\]]*\]|…|\.\.\.| → /)
    .filter(p => /[가-힣]/.test(p));
}

/** 한글이 들어 있어도 화면 라벨이 아닌 꼴. 규칙으로 거를 수 있는 것은 여기서, 하나씩인 것은 NOT_LABELS 에서. */
const NOT_A_LABEL = [
  /^[^\s]*\/[^\s]*$/,                        // 띄어쓰기 없는 경로 — `video-clip/<프로젝트>/<파일 이름>`
  /\.[a-z][a-z0-9]{1,4}$/i,                   // 확장자로 끝나는 파일 이름 — `이름 (2).mp4`
  /^(?:python3?|node|cd|brew|git|curl|npm)\s/, // 명령줄
];

// ── 대조 ────────────────────────────────────────────────────────────────────

/**
 * 정규화한 인용 q 가 정규화한 화면 글자 t 의 어딘가에 들어 있나. t 의 HOLE 은 무엇이든(빈 것도) 된다.
 * q 가 「조각 a 의 끝 + 구멍 + 조각 a+1 + … + 구멍 + 조각 b 의 앞」 꼴이면 맞는다. 다만 조각(구멍 밖)이 맞춘
 * 한글이 구멍이 먹은 한글보다 **많아야** 한다 — 그러지 않으면 `동작 ${이름}` 하나가 `동작 팔레트` 를 통과시킨다.
 * 숫자가 든 구멍(`8x1의 1카운트` 같은 그때그때 값)의 한글은 세지 않는다.
 */
export function contains(t, q) {
  if (t.includes(q)) return true;
  if (!t.includes(HOLE)) return false;
  const hangul = (x) => (x.match(/[가-힣]/g) || []).length;
  const eaten = (hole) => (hole.includes('#') ? 0 : hangul(hole));
  const parts = t.split(HOLE);
  for (let a = 0; a < parts.length - 1; a++) {
    const pa = parts[a];
    for (let s = 0; s <= pa.length; s++) {
      const head = pa.slice(s);
      if (!q.startsWith(head)) continue;
      let rest = q.slice(head.length);
      let lit = hangul(head);
      let holes = 0;
      for (let b = a + 1; b < parts.length; b++) {
        const pb = parts[b];
        // rest 가 (구멍) + parts[b] 의 앞부분 으로 끝나면 여기서 맞춘다 — 앞부분은 길수록 좋다
        for (let k = Math.min(pb.length, rest.length); k >= 0; k--) {
          if (!rest.endsWith(pb.slice(0, k))) continue;
          const l = lit + hangul(pb.slice(0, k));
          const h = holes + eaten(rest.slice(0, rest.length - k));
          if (l >= 2 && l > h) return true;
          break;
        }
        // 아니면 parts[b] 를 통째로 지나 다음 조각으로(구멍은 가장 짧게)
        const at = rest.indexOf(pb);
        if (at < 0) break;
        holes += eaten(rest.slice(0, at));
        lit += hangul(pb);
        rest = rest.slice(at + pb.length);
      }
    }
  }
  return false;
}

/** 두 글자 사이의 거리(편집 거리) — 후보를 고를 때만 쓴다. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** 화면 글자 가운데 인용과 가장 비슷한 것 몇 개(개명인지 삭제인지 보이게). */
export function nearest(q, texts, k = 2) {
  return texts
    .filter(t => t.length <= q.length * 3 + 10)
    .map(t => ({ t, d: distance(q, t.length > q.length + 6 ? bestWindow(q, t) : t) }))
    .filter(x => x.d <= Math.max(2, Math.ceil(q.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(x => x.t.replaceAll(HOLE, '…'));
}
const bestWindow = (q, t) => {
  let best = t.slice(0, q.length); let bd = Infinity;
  for (let i = 0; i + q.length <= t.length; i++) {
    const w = t.slice(i, i + q.length); const d = distance(q, w);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
};

/**
 * 문서들의 라벨 인용을 화면 글자와 대조한다.
 * @param {Record<string, string>} docs { 문서 경로: 원문 }
 * @param {Record<string, string>} files 화면 쪽 { 경로: 원문 }
 * @param {{ quote: string, why: string }[]} [notLabels]
 * @returns {{ misses: { doc: string, line: number, quote: string, near: string[] }[], checked: number, skipped: number,
 *   badExclusions: string[], unusedExclusions: string[] }}
 */
export function checkDocLabels(docs, files, notLabels = NOT_LABELS) {
  const texts = collectScreenTexts(files);
  const exempt = new Set(notLabels.filter(n => n.why && n.why.trim()).map(n => n.quote));
  const badExclusions = notLabels.filter(n => !n.why || !n.why.trim()).map(n => n.quote);
  const misses = [];
  let checked = 0; let skipped = 0;
  const memo = new Map();
  const used = new Set();
  for (const [doc, md] of Object.entries(docs)) {
    for (const { quote, line } of docQuotes(md)) {
      const pieces = labelPieces(quote);
      if (!pieces.length) continue;
      if (exempt.has(quote)) { skipped++; used.add(quote); continue; }
      checked++;
      for (const piece of pieces) {
        // 앞뒤의 숫자는 그때그때 값이다 — `영상이 더 느림 ≈169.2` 는 코드에서 낱말과 숫자가 따로 온다
        const q = normalize(piece).replace(/^(?:# )+|(?: #)+$/g, '').replace(/^#$/, '');
        if (!/[가-힣]/.test(q)) continue;
        if (!memo.has(q)) memo.set(q, texts.some(t => contains(t, q)));
        if (!memo.get(q)) { misses.push({ doc, line, quote, near: nearest(q, texts) }); break; }
      }
    }
  }
  const unusedExclusions = [...exempt].filter(q => !used.has(q));
  return { misses, checked, skipped, badExclusions, unusedExclusions };
}

/** 저장소에서 화면 쪽 원문을 { 상대경로: 원문 } 으로 읽는다 — src/ 의 JS · index.html · admin.html · server.py. */
export function loadScreenFiles(root) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files[relative(root, p).replaceAll('\\', '/')] = readFileSync(p, 'utf8');
    }
  };
  walk(join(root, 'src'));
  for (const f of ['index.html', 'admin.html', 'server.py']) {
    try { files[f] = readFileSync(join(root, f), 'utf8'); } catch { /* 자기 시험의 임시 폴더에는 없을 수 있다 */ }
  }
  return files;
}
