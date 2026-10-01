// tools/docLabels.mjs — 문서가 백틱으로 인용한 화면 라벨이 지금 화면 코드에 있는지 대조한다. 의존성 0.
//
// check-docs 의 다섯째 검사(⑤)가 파일을 읽어 이 모듈의 함수에 **글자만** 넘긴다 — 그래서 시험이 작은 조각으로
// 같은 함수를 부를 수 있다(tests/unit/checkDocs.test.mjs, 계획서 docs/roadmap/plans/RM-06.md 의 「요구 ↔ 시험」 표).
//
// 왜: 라벨을 바꾼 커밋이 문서를 빠뜨려도 다른 검사는 모두 초록이었다(`동작 팔레트` → `동작 목록` 이 그렇게
// 병합됐고, 2026-09-20·21 개편 뒤 튜토리얼 첫 절은 없어진 화면을 설명하고 있었다).
//
// 어떻게:
//   1. 화면 글자 모으기 — index.html · admin.html 의 태그 사이 글자와 placeholder·title·aria-label 값,
//      src/ 의 JS 문자열 리터럴 속 글자(주석은 뺀다 — 주석에 남은 옛 라벨이 없어진 화면을 「있다」로 통과시킨다),
//      server.py 의 문자열(서버가 내는 안내 페이지 · 오류). 템플릿의 `${…}` 는 「무엇이든」 자리(HOLE)로 남긴다.
//   2. 인용 뽑기 — 문서에서 백틱 인용을 줄 번호와 함께. 코드블록 안은 뺀다.
//   3. 백틱 인용 **전부**를 본다(2026-10-01 판의 답). 명령 · 경로 · 주소 · 파일 이름 · 키 이름 · 행 이름처럼
//      꼴로 알 수 있는 것은 NOT_A_LABEL 규칙으로, 하나씩인 것은 NOT_LABELS 목록(이유 필수)으로 뺀다.
//   4. 정규화 — 이모지 · 기호 · 공백 차이를 지우고 숫자는 자리표(#)로 바꿔 `루틴으로 편성 (3)` 이
//      `루틴으로 편성 (${count})` 와 맞게 한다. 기호뿐인 인용(`▾` `✕`)은 정규화하지 않은 글자에서 찾는다.
//   5. 인용이 모은 글자 어딘가에 들어 있으면 통과. 두 글자 이하는 낱말 경계로만 맞춘다(`hi` 가 `this` 에 숨지 않게).
//      없으면 「문서:줄 — 인용 — 비슷한 라벨」로 찍는다.
//
// ⚠ 문자열 긁기라 영리하지 않다 — 주석이 아닌 죽은 코드에 남은 옛 라벨이 있으면 「있다」로 통과한다.
//   라벨의 주인이 표 하나가 되면(RM-09 · RM-10) 긁기 대신 그 표를 읽도록 바꾼다.

import { HOLE, scanJs } from './lib/js-text.mjs';

/** 라벨 인용을 대조하는 문서. 다른 문서(로드맵 · 원칙 · 버그 기록)는 옛 라벨을 이력으로 인용하는 것이 정상이다. */
export const LABEL_DOCS = ['docs/TUTORIAL.md', 'docs/FEATURES.md'];

/**
 * 꼴로 알 수 있는 「라벨 아님」. 이름은 보고에 갈래별 개수로 찍힌다.
 * @type {{ name: string, re: RegExp }[]}
 */
export const NOT_A_LABEL = [
  { name: '명령', re: /^(?:python3?|node|cd|brew|git|curl|npm|pip3?|hf|ffmpeg)(?:\s|$)/ },
  { name: '주소', re: /:\/\/|^(?:www\.)?[\w-]+\.(?:com|be|io|org)\/|^\/(?:admin|api)\b|^\?doc=|^(?:GET|PUT|POST|DELETE|PATCH) \// },
  { name: '경로', re: /^(?:~|\.{1,2})?\/|^\S*\/\S*$|^\.\w[\w-]*\/?$|^\/$|^\.\.$/ },
  { name: '파일 이름', re: /\.(?:html?|js|mjs|json|md|py|mp4|mov|MOV|webm|jpg|png|task|wasm)$/ },
  { name: '키 이름', re: /^(?:(?:Ctrl|Cmd|Alt|Option|Shift|Ctrl\/Cmd)(?:\+\S+)*|Enter|Esc|Tab|Space|Delete|Backspace|[A-Z?]|[←↑→↓]|Home|End)$/ },
  { name: '행 이름', re: /^(?:\d+\s*x\s*(?:\d+|N|\[숫자\])?|\d*x\d+|N?\d*c|Nc|\d+-\d+|\d+)$/ },
  { name: '환경 변수·헤더', re: /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^X-[\w-]+$/ },
  { name: '날짜 이름 틀', re: /YYYY-MM-DD/ },
  { name: '코드 조각', re: /^[\w-]+=[\w-]+$/ },                            // `preload=auto`
];

/**
 * 꼴로는 못 거르는 「라벨 아님」. **하나마다 이유를 적는다** — 이유가 빈 줄, 더는 인용되지 않는 줄은 실패다.
 * 오탐이 날 때마다 습관처럼 더하면 검사가 뜻을 잃는다. 먼저 문서가 낡은 것인지 본다.
 * @type {{ quote: string, why: string }[]}
 */
export const NOT_LABELS = [
  { quote: '9/01 첫 시도', why: '사용자가 영상 줄에 붙이는 이름의 예(TUTORIAL) — 화면이 내는 글자가 아니다' },
  { quote: '해', why: '자동 담기가 타이핑 중간 이름으로 파일을 만들면 생길 파일 이름의 예(FEATURES)' },
  { quote: '해피', why: '자동 담기가 타이핑 중간 이름으로 파일을 만들면 생길 파일 이름의 예(FEATURES)' },
  { quote: '해피핏', why: '자동 담기가 타이핑 중간 이름으로 파일을 만들면 생길 파일 이름의 예(FEATURES)' },
  { quote: '8x1 1카운트부터 8카운트: Charleston', why: 'LLM 이 다듬어 2단에 채우는 설명의 예 — 앱이 아니라 모델이 쓰는 글자다' },
  { quote: 'This video is playing in picture in picture.', why: 'PiP 중에 브라우저가 영상 자리에 그리는 안내판 — 앱 코드에 없다' },
  { quote: '전체 보드 ↗', why: '로드맵 보드의 떠 있는 위젯 글자 — 이 저장소가 아니라 ~/Github/roadmap-board 의 widget.js 가 그린다' },
];

// ── 화면 글자 ───────────────────────────────────────────────────────────────

const decodeEntities = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** HTML 조각에서 사람이 읽는 글자: 라벨 노릇 하는 속성 값 + 태그를 공백으로 바꾼 글자 한 덩이. */
function htmlTexts(html) {
  const out = [];
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  for (const m of clean.matchAll(/\s(?:placeholder|title|aria-label|alt|value|data-label|data-title)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    out.push(decodeEntities(m[2] ?? m[3]));
  }
  // 태그 사이 글자 하나하나 — 단추 하나의 라벨이 비슷한 라벨 후보로 따로 서게
  for (const piece of clean.split(/<[^>]*>/)) {
    const t = decodeEntities(piece).trim();
    if (t) out.push(t);
  }
  // 그리고 태그를 공백으로 바꾼 한 덩이 — `<span class="badge">1</span>말하거나 적는다` 를 문서는
  // `1 말하거나 적는다` 로 인용한다. 태그 이름 · 속성 이름은 여기서 사라진다(글자로 섞이지 않는다).
  const text = decodeEntities(clean.replace(/<[^>]*>/g, ' '));
  if (text.trim()) out.push(text);
  return out;
}

/** JS 문자열 하나 → 글자 조각들. 마크업이 든 템플릿이면 태그를 걷는다. */
function stringTexts(text) {
  const t = text.replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1').replace(/\\u\{?([0-9a-f]+)\}?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return /<[a-z!/]/i.test(t) ? htmlTexts(t) : [t];
}

/**
 * 화면에 뜰 수 있는 글자 한 벌.
 * @param {Record<string, string>} files { 상대경로: 원문 } — *.html · *.js · *.py
 * @returns {{ texts: string[], raw: string }} texts 는 정규화한 글자(겹침 없음), raw 는 정규화 전 글자를 이은 것(기호뿐인 인용용)
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
      const code = text.replace(/^\s*#.*$/gm, '');   // 줄 주석에 남은 옛 라벨이 「있다」로 치이지 않게
      for (const m of code.matchAll(/(?<![\w'"])f?('|")((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const body = m[0].startsWith('f') ? m[2].replace(/\{[^{}]*\}/g, HOLE) : m[2];
        raw.push(...stringTexts(body));
      }
    } else if (/\.m?js$/.test(path)) {
      for (const s of scanJs(text).strings) raw.push(...stringTexts(s.text));
    }
  }
  return { texts: [...new Set(raw.map(normalize).filter(Boolean))], raw: raw.join('\n') };
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

/**
 * 비교용 꼴: 숫자 · 행 이름(`8x1`) · 카운트(`4c`) → #, 글자 · 숫자 · HOLE 이 아닌 것(이모지 · 기호 · 문장부호) → 공백, 공백은 하나로.
 * 「…」 와 「...」, `✎ 이름 바꾸기` 와 `이름 바꾸기`, `(3)` 과 `(${n})` 가 같아진다.
 */
export function normalize(s) {
  return s
    .replace(/\d+x\d+|\d+c(?!\p{L})|\d+(?:\.\d+)?/gu, '#')
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
    // 여는 백틱 수만큼 닫는다 — ``이중 `백틱` 인용`` 은 안의 홑백틱까지 한 인용이다
    for (const m of l.matchAll(/(?<!`)(`+)((?:(?!\1).)+?)\1(?!`)/g)) out.push({ quote: m[2].trim(), line: i + 1 });
  });
  return out;
}

/** 꼴로 알 수 있는 「라벨 아님」이면 그 갈래 이름, 아니면 null. */
export function notALabel(quote) {
  const hit = NOT_A_LABEL.find(r => r.re.test(quote));
  return hit ? hit.name : null;
}

/**
 * 인용을 대조할 조각들로 자른다. 문서가 스스로 쓰는 자리표 — `<이름>` · `[8x1]`(입력칸) · `N개` 의 N·M ·
 * 생략표 `…` · 차례를 잇는 ` → ` — 에서 끊는다. 앞뒤의 숫자 자리표는 뗀다(그때그때 값이다 —
 * `영상이 더 느림 ≈169.2` 는 코드에서 낱말과 숫자가 따로 온다).
 * @returns {{ norm: string, raw: string }[]}  norm 이 비면 기호뿐인 조각이라 raw 로 찾는다
 */
export function labelPieces(quote) {
  const out = [];
  for (const piece of quote.replace(/(?<![A-Za-z])[NM](?=[가-힣])/g, '0').split(/<[^<>]*>|\[[^[\]]*\]|…|\.\.\.| → /)) {
    const raw = piece.trim();
    const norm = normalize(raw).replace(/^(?:# )+|(?: #)+$/g, '');
    if (norm) {
      if (!/^#[A-Za-z]?$/.test(norm)) out.push({ raw, norm }); // `8c` · `(2)` 처럼 값뿐인 조각은 대조할 것이 없다
    } else if (/[^\s\d.,:;()+\-/=~≈]/u.test(raw)) {
      out.push({ raw, norm: '' });                              // `▾` `✕` — 기호뿐인 단추
    }
  }
  return out;
}

// ── 대조 ────────────────────────────────────────────────────────────────────

const hangul = (x) => (x.match(/[가-힣]/g) || []).length;
const letters = (x) => (x.match(/[\p{L}]/gu) || []).length;

/** 두 글자 이하 인용은 낱말 경계로만 맞춘다 — `hi` 가 `this` 에, `해` 가 `해제` 에 숨지 않게. */
function includesWord(t, q) {
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'u').test(t);
}

/**
 * 정규화한 인용 q 가 정규화한 화면 글자 t 의 어딘가에 들어 있나. t 의 HOLE 은 무엇이든(빈 것도) 된다.
 * q 가 「조각 a 의 끝 + 구멍 + 조각 a+1 + … + 구멍 + 조각 b 의 앞」 꼴이면 맞는다. 다만 조각(구멍 밖)이 맞춘
 * 글자가 구멍이 먹은 글자보다 **많아야** 한다 — 그러지 않으면 `동작 ${이름}` 하나가 `동작 팔레트` 를 통과시킨다.
 * 숫자가 든 구멍(`8x1의 1카운트` 같은 그때그때 값)의 글자는 세지 않는다.
 */
export function contains(t, q) {
  if (q.length <= 2) return includesWord(t.replaceAll(HOLE, '#'), q);  // 짧은 것의 구멍은 숫자로 본다 — `${i + 1}번`
  if (t.includes(q)) return true;
  if (!t.includes(HOLE)) return false;
  const eaten = (hole) => (hole.includes('#') ? 0 : letters(hole));
  const parts = t.split(HOLE);
  for (let a = 0; a < parts.length - 1; a++) {
    const pa = parts[a];
    for (let s = 0; s <= pa.length; s++) {
      const head = pa.slice(s);
      if (!q.startsWith(head)) continue;
      let rest = q.slice(head.length);
      let lit = letters(head);
      let holes = 0;
      for (let b = a + 1; b < parts.length; b++) {
        const pb = parts[b];
        // rest 가 (구멍) + parts[b] 의 앞부분 으로 끝나면 여기서 맞춘다 — 앞부분은 길수록 좋다
        for (let k = Math.min(pb.length, rest.length); k >= 0; k--) {
          if (!rest.endsWith(pb.slice(0, k))) continue;
          const l = lit + letters(pb.slice(0, k));
          const h = holes + eaten(rest.slice(0, rest.length - k));
          if (l >= 2 && l > h) return true;
          break;
        }
        // 아니면 parts[b] 를 통째로 지나 다음 조각으로(구멍은 가장 짧게)
        const at = rest.indexOf(pb);
        if (at < 0) break;
        holes += eaten(rest.slice(0, at));
        lit += letters(pb);
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

/**
 * 화면 글자 가운데 인용과 가장 비슷한 것 몇 개 — 개명인지 삭제인지 보이게. 짧은 라벨 통째가 긴 문장의
 * 한 토막보다 앞선다(`동작 팔레트` 의 후보는 `동작 목록` 이지 `동작 이름을 맞추지 못했습니다` 가 아니다).
 */
export function nearest(q, texts, k = 2) {
  const scored = [];
  for (const t of texts) {
    if (t.length > q.length * 4 + 20) continue;
    const whole = t.length <= q.length + 6;
    const d = whole ? distance(q, t) : windowDistance(q, t);
    if (d > Math.max(2, Math.ceil(q.length / 2))) continue;
    scored.push({ t, d, whole, hole: t.includes(HOLE) });
  }
  // 거리가 같으면: 통째로 비슷한 것 > 긴 글의 한 토막, 구멍 없는 라벨 > 템플릿, 짧은 것 > 긴 것
  return scored
    .sort((a, b) => a.d - b.d || Number(b.whole) - Number(a.whole) || Number(a.hole) - Number(b.hole) || a.t.length - b.t.length)
    .slice(0, k)
    .map(x => x.t.replaceAll(HOLE, '…'));
}
function windowDistance(q, t) {
  let best = Infinity;
  for (let i = 0; i + q.length <= t.length; i++) best = Math.min(best, distance(q, t.slice(i, i + q.length)));
  return best;
}

/** 대조 실패 한 건의 보고 줄 — 「문서:줄 — 인용 — 비슷한 라벨」. */
export function formatMiss(m) {
  const near = m.near.length ? ` — 비슷한 라벨: ${m.near.map(n => `\`${n}\``).join(' · ')}` : ' — 비슷한 라벨 없음(삭제됐나?)';
  return `${m.doc}:${m.line} — \`${m.quote}\` 가 화면 어디에도 없다${near}`;
}

/**
 * 문서들의 라벨 인용을 화면 글자와 대조한다. 파일을 읽지 않는다 — 글자만 받는다.
 * @param {Record<string, string>} docs { 문서 경로: 원문 }
 * @param {Record<string, string>} files 화면 쪽 { 경로: 원문 }
 * @param {{ quote: string, why: string }[]} [notLabels]
 * @returns {{ misses: { doc: string, line: number, quote: string, near: string[] }[], checked: number,
 *   filtered: Record<string, number>, skipped: number, badExclusions: string[], unusedExclusions: string[] }}
 */
export function checkDocLabels(docs, files, notLabels = NOT_LABELS) {
  const { texts, raw } = collectScreenTexts(files);
  const exempt = new Set(notLabels.filter(n => n.why && n.why.trim()).map(n => n.quote));
  const badExclusions = notLabels.filter(n => !n.why || !n.why.trim()).map(n => n.quote);
  const misses = [];
  const filtered = {};
  const used = new Set();
  let checked = 0; let skipped = 0;
  const memo = new Map();
  const found = (p) => {
    const key = p.norm || `raw:${p.raw}`;
    if (!memo.has(key)) memo.set(key, p.norm ? texts.some(t => contains(t, p.norm)) : raw.includes(p.raw));
    return memo.get(key);
  };
  for (const [doc, md] of Object.entries(docs)) {
    for (const { quote, line } of docQuotes(md)) {
      const kind = notALabel(quote);
      if (kind) { filtered[kind] = (filtered[kind] || 0) + 1; continue; }
      if (exempt.has(quote)) { skipped++; used.add(quote); continue; }
      const pieces = labelPieces(quote);
      if (!pieces.length) { filtered['행 이름'] = (filtered['행 이름'] || 0) + 1; continue; }
      checked++;
      const miss = pieces.find(p => !found(p));
      if (miss) misses.push({ doc, line, quote, near: miss.norm ? nearest(miss.norm, texts) : [] });
    }
  }
  const unusedExclusions = [...exempt].filter(q => !used.has(q));
  return { misses, checked, filtered, skipped, badExclusions, unusedExclusions };
}
