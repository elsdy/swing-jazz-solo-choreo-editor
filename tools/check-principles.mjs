// tools/check-principles.mjs — 글자만 보고 어긴 것을 알 수 있는 개발 원칙을 기계로 잰다. 의존성 0.
//
//   node tools/check-principles.mjs               어긴 자리가 있으면 exit 1
//   node tools/check-principles.mjs --list        규칙 표와 훑은 파일 수만 찍는다
//   node tools/check-principles.mjs --root <폴더> 다른 폴더를 저장소처럼 훑는다(자기 시험이 쓴다)
//
// 원칙(docs/PRINCIPLES.md)이 30개를 넘자 「어떻게 확인할까」가 grep 한 줄인 것까지 사람이 리뷰 때마다
// 떠올려야 했고, 떠올리지 못하면 같은 버그가 되풀이됐다 — U-12(display 가 hidden 을 이김)가 네 번 났다.
// 잴 수 있는 것은 여기서 잰다. 규칙 하나 = RULES 표 한 줄 { 원칙, 무엇, 고치는 법, scan }.
//
// ⚠ 넓게 잡으면 경보가 잦아지고, 잦은 경보는 무시된다. 그래서 각 규칙은 **글자로 확실한 것만** 잡는다.
//   걸린 자리는 고치는 것이 먼저다(2026-10-01 결정 — 0 에서 시작). 검사기가 글자를 잘못 읽어 걸린 것이
//   분명할 때만 그 줄(또는 바로 윗줄)에 표식을 단다:
//       // 원칙-예외(D-5): 왜 괜찮은지
//   이유가 빈 표식은 표식으로 치지 않는다.
//
// 이 파일은 검사 함수를 내보낸다 — tests/unit/checkPrinciples.test.mjs 가 일부러 어긴 조각을 넣어
// 붉어지는지 본다(검사기가 조용히 아무것도 안 잡는 것이 가장 나쁜 고장이다).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { blankJs, lineAt, scanJs } from './lib/js-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 글자 다루기 ─────────────────────────────────────────────────────────────

/** 그 줄이나 바로 윗줄에 이유가 붙은 예외 표식이 있나. */
function excused(text, line, principle) {
  const lines = text.split('\n');
  const re = new RegExp(`원칙-예외\\(${principle}\\)\\s*:\\s*\\S`);
  return re.test(lines[line - 1] || '') || re.test(lines[line - 2] || '');
}

/** `open` 이 가리키는 여는 괄호의 짝 닫는 괄호 위치. 원문은 blankJs 를 거친 것이어야 한다. */
function matchBrace(text, open) {
  const pair = { '{': '}', '(': ')', '[': ']' }[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === pair && --depth === 0) return i;
  }
  return -1;
}

/** 템플릿 리터럴 `const NAME = \`…\`` · `innerHTML = \`…\`` 의 원문을 위치와 함께 꺼낸다. */
function templatesAfter(text, re) {
  const found = [];
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length; // 여는 백틱 바로 뒤
    let j = start; let depth = 0;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (depth === 0 && text[j] === '`') break;
      if (text[j] === '$' && text[j + 1] === '{') { depth++; j += 2; continue; }
      if (depth > 0 && text[j] === '}') depth--;
      j++;
    }
    found.push({ body: text.slice(start, j), offset: start });
  }
  return found;
}

// ── HTML: 요소 목록(id · class · data-role · hidden) ────────────────────────

/** HTML 조각에서 여는 태그를 모두 읽는다. `${…}` 가 낀 값은 그 부분을 뺀 글자로 본다. */
function parseElements(html, file, offset = 0, fullText = html) {
  const els = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const attrs = m[2];
    const attr = (name) => {
      const a = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
      return a ? (a[2] ?? a[3]) : null;
    };
    const cls = attr('class');
    els.push({
      tag: m[1].toLowerCase(),
      id: attr('id'),
      role: attr('data-role'),
      act: attr('data-act'),
      classes: cls ? cls.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean) : [],
      hidden: /(?:^|\s)hidden(?=[\s/=]|$)/.test(attrs),
      file,
      line: lineAt(fullText, offset + m.index),
    });
  }
  return els;
}

// ── CSS: 잎 규칙(선택자 · 본문) ─────────────────────────────────────────────

/** CSS 원문에서 중첩 없는 규칙만 꺼낸다(@media 안의 규칙도 잎으로 나온다). */
function parseCssRules(css, file, offset, fullText) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '));
  const rules = [];
  const stack = [];
  let segStart = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '{') {
      stack.push({ prelude: clean.slice(segStart, i).trim(), at: segStart, open: i, leaf: true });
      if (stack.length > 1) stack[stack.length - 2].leaf = false;
      segStart = i + 1;
    } else if (c === '}') {
      const top = stack.pop();
      if (top && top.leaf && !top.prelude.startsWith('@')) {
        const lead = clean.slice(top.at, top.open).search(/\S/);
        rules.push({
          selectors: splitTop(top.prelude),
          body: clean.slice(top.open + 1, i),
          bodyAt: offset + top.open + 1, // fullText 안에서 몸통이 시작하는 자리(U-16 가 선언마다 줄을 잰다)
          file,
          line: lineAt(fullText, offset + top.at + Math.max(0, lead)),
        });
      }
      segStart = i + 1;
    } else if (c === ';' && stack.length === 0) {
      segStart = i + 1;
    }
  }
  return rules;
}

/** 괄호 밖의 쉼표로 자른다(`:is(a, b)` 는 한 덩어리). */
function splitTop(s, sep = ',') {
  const parts = []; let depth = 0; let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** 선택자의 마지막 덩어리(실제로 칠해지는 요소). `.a > .b:hover` → `.b:hover`. */
function subjectOf(selector) {
  let depth = 0; let last = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) last = i + 1;
  }
  return selector.slice(last).trim();
}

/** 덩어리의 클래스(`:not(…)` 안은 빼고). */
const classesOf = (compound) => [...compound.replace(/:not\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)].map(m => m[1]);

/** 대략의 명시도 [id, class·attr·pseudo, tag] — 짝 규칙이 실제로 이기는지 견준다. */
function specificity(selector) {
  const s = selector.replace(/:not\(([^)]*)\)/g, ' $1 ').replace(/::[\w-]+/g, ' x ');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g) || []).length;
  const tags = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids, cls, tags];
}
const specGte = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || 0;

const displayOf = (body) => {
  const m = body.match(/(?:^|[;\s{])display\s*:\s*([^;]+)/);
  return m ? m[1].replace(/!important/, '').trim() : null;
};

// ── JS: 변수가 가리키는 요소 ────────────────────────────────────────────────

/** CLS = Object.freeze({ key: 'value' }) 를 표로 읽는다(domContract). */
function readClsTable(files) {
  const text = files['src/ui/domContract.js'] || '';
  const m = text.match(/export const CLS = Object\.freeze\(\{([\s\S]*?)\n\}\)/);
  const table = {};
  if (m) for (const e of m[1].matchAll(/^\s*([\w$]+)\s*:\s*'([^']*)'/gm)) table[e[1]] = e[2];
  return table;
}

/** 클래스 식(`'a b'` · `CLS.x` · `CLS.a + ' ' + CLS.b` · 삼항)에서 나올 수 있는 클래스 이름 전부. */
function classTokens(expr, cls) {
  const out = [];
  for (const m of expr.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`|CLS\.([\w$]+)/g)) {
    const s = m[4] ? (cls[m[4]] || '') : (m[1] ?? m[2] ?? m[3] ?? '');
    out.push(...s.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean));
  }
  return out;
}

/**
 * 한 파일 안에서 변수 이름이 가리키는 요소를 찾는다.
 *   byId('x') · getElementById('x') · $('x')            → 마크업의 id
 *   querySelector('[data-role="x"]') · q('[data-role=…]') → 템플릿의 data-role / data-act
 *   createElement 뒤 x.className = …                     → 그 클래스
 * @returns {{ classes: string[], markup: object|null }|null}
 */
function resolveVar(text, name, elements, cls) {
  const esc = name.replace(/\$/g, '\\$');
  const decl = text.match(new RegExp(`(?:const|let|var)\\s+${esc}\\s*=\\s*([^;\\n]+)`));
  let markup = null;
  if (decl) {
    const rhs = decl[1];
    const byId = rhs.match(/(?:byId|getElementById|\$)\(\s*['"]([\w-]+)['"]/);
    const byAttr = rhs.match(/\[data-(role|act)="([\w-]+)"\]/);
    const byClass = rhs.match(/querySelector\(\s*['"]\.([\w-]+)['"]/);
    if (byId) markup = elements.find(e => e.id === byId[1]) || null;
    else if (byAttr) markup = elements.find(e => (byAttr[1] === 'role' ? e.role : e.act) === byAttr[2]) || null;
    else if (byClass) markup = { classes: [byClass[1]], file: null, line: null };
  }
  const assigned = [];
  for (const m of text.matchAll(new RegExp(`(?<![\\w$.])${esc}\\.className\\s*=\\s*([^;\\n]+)`, 'g'))) {
    assigned.push(...classTokens(m[1], cls));
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\w$.])${esc}\\.classList\\.(?:add|toggle)\\(([^)]*)\\)`, 'g'))) {
    assigned.push(...classTokens(m[1].split(',')[0], cls));
  }
  const classes = [...new Set([...(markup ? markup.classes : []), ...assigned])];
  if (!classes.length && !markup) return null;
  return { classes, markup };
}

// ── 파일 모으기 ─────────────────────────────────────────────────────────────

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/** 저장소에서 검사할 파일을 { 상대경로: 원문 } 으로 읽는다. */
export function loadRepoFiles(root = ROOT) {
  const files = {};
  for (const p of walk(join(root, 'src'))) files[relative(root, p).replaceAll('\\', '/')] = readFileSync(p, 'utf8');
  const html = join(root, 'index.html');
  try { files['index.html'] = readFileSync(html, 'utf8'); } catch { /* 없는 폴더도 훑는다(자기 시험의 임시 폴더) */ }
  return files;
}

const jsFiles = (files, prefix = 'src/') => Object.keys(files).filter(f => f.startsWith(prefix) && f.endsWith('.js'));

/** 마크업 요소(index.html 본문 + 뷰가 innerHTML 로 넣는 템플릿) 전부. */
function collectElements(files) {
  const els = [];
  const html = files['index.html'] || '';
  const bodyAt = Math.max(0, html.indexOf('<body'));
  els.push(...parseElements(html.slice(bodyAt), 'index.html', bodyAt, html));
  for (const f of jsFiles(files)) {
    for (const t of templatesAfter(files[f], /innerHTML\s*=\s*`/g)) els.push(...parseElements(t.body, f, t.offset, files[f]));
  }
  return els;
}

/** CSS 잎 규칙 전부(index.html 의 <style> + 뷰의 `const CSS = \`…\``). */
function collectCss(files) {
  const rules = [];
  const html = files['index.html'] || '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    rules.push(...parseCssRules(m[1], 'index.html', m.index + m[0].indexOf('>') + 1, html));
  }
  for (const f of jsFiles(files)) {
    for (const t of templatesAfter(files[f], /const\s+[A-Z_]*(?:CSS|STYLE)[A-Z_]*\s*=\s*`/g)) {
      rules.push(...parseCssRules(t.body, f, t.offset, files[f]));
    }
  }
  return rules;
}


// ── U-16 디자인 토큰: 선언 하나하나를 본다 ───────────────────────────────────

/** 토큰 밖 색 글자 — hex · rgb() · hsl() · 이름 색. transparent · currentColor 는 색이 아니라 뜻이라 넘긴다. */
const COLOR_RE = /(?<![\w&-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(\s*[\d.]|(?<![\w-])(?:white|black|red|green|blue|yellow|orange|gray|grey|silver|pink|purple|gold)(?![\w-])/;
/** 단계 토큰이 있어야 하는 이름 — :root 에서 하나라도 빠지면 붉어진다. */
export const TOKEN_STEPS = ['--bg', '--panel', '--text', '--muted', '--accent', '--danger', '--warn',
  '--fs-1', '--fs-2', '--fs-3', '--fs-4', '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--r-1', '--r-2', '--r-pill', '--shadow', '--shadow-sm'];
const MAX_FONT_STEPS = 5;
const isRootSel = (s) => /^:root(?:\[data-theme(?:="[\w-]+")?\])?$/.test(s.trim());
const isThemeRootSel = (s) => /^:root\[data-theme(?:="[\w-]+")?\](?:\s+body)?$/.test(s.trim());

/** 괄호 · 따옴표 밖의 `;` 로 선언을 자른다 — { prop, value, at(몸통 안 자리) }. */
function declarations(body) {
  const out = [];
  let depth = 0; let quote = ''; let start = 0;
  const push = (end) => {
    const raw = body.slice(start, end);
    const colon = raw.indexOf(':');
    if (colon > 0 && raw.trim()) {
      const lead = raw.search(/\S/);
      const name = raw.slice(0, colon).trim();
      out.push({ prop: name.startsWith('--') ? name : name.toLowerCase(), value: raw.slice(colon + 1).trim(), at: start + lead });
    }
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { push(i); start = i + 1; }
  }
  push(body.length);
  return out;
}

/** 선언 하나가 U-16 를 어기면 그 까닭을 돌려준다(어기지 않으면 null). */
function tokenBreach(prop, value, selectors) {
  if (/!\s*important/i.test(value)) return '!important — 규칙 순서로 이긴다';
  if (prop.startsWith('--')) {
    if (selectors && selectors.every(isRootSel)) return null; // 토큰을 정의하는 자리
    return COLOR_RE.test(value) ? `${prop} 를 :root 밖에서 색 글자로 정의한다` : null;
  }
  if (selectors && selectors.some(isThemeRootSel)) return `테마 블록이 토큰 아닌 속성 ${prop} 를 적는다`;
  const color = value.match(COLOR_RE);
  if (color) return `토큰 밖 색 ${color[0].replace(/\($/, '(…')}`;
  if ((prop === 'font-size' || prop === 'font') && /(?<![\w.-])\d*\.?\d+(?:px|rem|pt)\b/.test(value)) return `단계 밖 글자 크기 ${value}`;
  return null;
}

/** 줄 · 윗줄 · 그 줄을 감싼 블록의 머리 줄들(들여쓰기가 한 단씩 얕아지는 윗줄 — 규칙 · @media · 객체)과 그 윗줄에 표식이 있나.
 *  여러 줄 규칙 · 객체 · @media 묶음 하나를 한 표식이 덮는다(인쇄 묶음처럼 통째로 이유가 같은 것). */
// @complexity time=O(n) space=O(n) cc=6
function excusedBlock(text, line, principle) {
  if (excused(text, line, principle)) return true;
  const lines = text.split('\n');
  const indent = (s) => s.search(/\S/);
  let own = indent(lines[line - 1] || '');
  for (let i = line - 2; i >= 0 && own > 0; i--) {
    if (!lines[i].trim()) continue;
    if (indent(lines[i]) < own) {
      if (excused(text, i + 1, principle)) return true;
      own = indent(lines[i]);
    }
  }
  return false;
}

/** style="…" 속성의 원문과 자리. */
function styleAttrs(text, base = 0) {
  return [...text.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/g)].map(m => ({ body: m[2], at: base + m.index + m[0].indexOf(m[2]) }));
}

// ── 규칙 표 ─────────────────────────────────────────────────────────────────

/**
 * domain/commands.js 원문에서 등록부의 id 를 글자로 읽는다(D-14). 시험이 이 결과를 실제로 내보낸 COMMANDS 와 맞춰 본다 —
 * 표의 꼴이 바뀌어 읽는 법이 낡으면 거기서 붉어진다.
 * @returns {{ ids: string[], line: number }}
 */
export function commandIdTable(cmdText) {
  const at = cmdText.search(/export const COMMANDS = Object\.freeze\(\[/);
  if (at < 0) return { ids: [], line: 1 };
  const ids = [...cmdText.slice(at).matchAll(/def\(\{\s*id:\s*'([\w-]+)'/g)].map(m => m[1]);
  return { ids, line: lineAt(cmdText, at) };
}

/**
 * 객체 리터럴 `{ … }` 의 최상위 키. 여는 괄호의 자리를 받는다. 주석 · 문자열을 지운 원문(blankJs)에 쓴다.
 * @param {string} code
 * @param {number} open `{` 의 자리
 * @returns {Set<string>}
 */
function topLevelKeys(code, open) {
  const close = matchBrace(code, open);
  let depth = 0;
  let top = '';
  for (const c of code.slice(open + 1, close)) {
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
    else if (depth === 0) top += c;
    if (depth > 0 && top.slice(-1) !== '#') top += '#';
  }
  const keys = new Set();
  for (const m of top.matchAll(/(?:^|,)\s*([\w$]+)\s*(?=[:,(#]|$)/g)) keys.add(m[1]);
  return keys;
}

/**
 * app/main.js 원문에서 `COMMAND_RUNNERS` 의 키를 글자로 읽는다(D-14).
 * @returns {{ keys: Set<string>, line: number }}
 */
export function commandRunnerTable(mainText) {
  const code = blankJs(mainText);
  const m = code.match(/const COMMAND_RUNNERS = Object\.freeze\(\{/);
  if (!m) return { keys: new Set(), line: 1 };
  const open = m.index + m[0].length - 1;
  return { keys: topLevelKeys(code, open), line: lineAt(mainText, open) };
}

/** @typedef {{ file: string, line: number, principle: string, what: string, fix: string }} Violation */

export const RULES = [
  {
    principle: 'U-10',
    what: '폰 확대를 전면 차단한다 — viewport 의 user-scalable=no · maximum-scale=1, 또는 입력을 마칠 때(focusout) scrollTo(0, 0)',
    fix: '확대를 막지 말고 좁은 화면의 input · select · textarea 글자를 16px 로 둔다(iOS 자동 확대가 애초에 안 일어난다). 편집 중 핀치는 잠금 중 차단으로만 막는다',
    scan(files) {
      const out = [];
      const blocks = /user-scalable\s*=\s*(?:no|0)\b|maximum-scale\s*=\s*1(?:\.0*)?(?![\d.])/;
      // ① 마크업의 viewport 메타
      const html = files['index.html'] || '';
      for (const m of html.matchAll(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/gi)) {
        if (!blocks.test(m[0])) continue;
        const line = lineAt(html, m.index);
        if (!excused(html, line, 'U-10')) out.push({ file: 'index.html', line, snippet: m[0].trim() });
      }
      for (const f of jsFiles(files)) {
        const raw = files[f];
        const { blanked, strings } = scanJs(raw);
        // ② JS 가 viewport 에 다시 박는 글자(문자열 속 — 주석은 보지 않는다)
        for (const str of strings) {
          if (!blocks.test(str.text)) continue;
          const line = lineAt(raw, str.offset);
          if (!excused(raw, line, 'U-10')) out.push({ file: f, line, snippet: raw.split('\n')[line - 1].trim() });
        }
        // ③ focusout 처리기 안의 scrollTo(0, 0) — 입력을 마칠 때마다 화면이 꼭대기로 튄다
        for (const str of strings) {
          if (str.text !== 'focusout') continue;
          const open = blanked.indexOf('{', str.offset);
          if (open < 0) continue;
          const close = matchBrace(blanked, open);
          const body = blanked.slice(open, close < 0 ? blanked.length : close);
          const hit = body.search(/scrollTo\(\s*0\s*,\s*0\s*\)/);
          if (hit < 0) continue;
          const line = lineAt(raw, open + hit);
          if (!excused(raw, line, 'U-10')) out.push({ file: f, line, snippet: raw.split('\n')[line - 1].trim() });
        }
      }
      return out;
    },
  },
  {
    principle: 'U-11',
    what: '속성을 빈 문자열로 끈다 — `[data-x]` 선택자는 값이 비어도 걸린다',
    fix: '`delete el.dataset.x` 또는 `el.removeAttribute(\'data-x\')` 로 속성을 없앤다',
    scan(files) {
      const out = [];
      for (const f of jsFiles(files)) {
        const code = blankJs(files[f]);
        const raw = files[f];
        const res = [
          /\.dataset\.[\w$]+\s*=\s*(?=['"`]\s*['"`])/g,
          /\.dataset\[[^\]]+\]\s*=\s*(?=['"`]\s*['"`])/g,
          /\.setAttribute\(/g, // 이름 글자는 지워진 원문에 없다 — 아래에서 원래 줄로 가린다
        ];
        for (const re of res) {
          for (const m of code.matchAll(re)) {
            const tail = raw.slice(m.index, raw.indexOf('\n', m.index));
            if (re.source.includes('setAttribute') && !/setAttribute\(\s*['"]data-[\w-]+['"]\s*,\s*(''|""|``)\s*\)/.test(tail)) continue;
            if (!re.source.includes('setAttribute') && !/=\s*(''|""|``)/.test(tail)) continue;
            const line = lineAt(raw, m.index);
            if (!excused(raw, line, 'U-11')) out.push({ file: f, line, snippet: tail.trim() });
          }
        }
      }
      return out;
    },
  },
  {
    principle: 'U-12',
    what: 'display 를 준 규칙이 숨길 수 있는 요소의 `hidden` 을 이긴다 — hidden 을 붙여도 보인다',
    fix: '같은 선택자에 `[hidden] { display: none; }` 짝을 적는다(명시도가 같거나 높게)',
    scan(files) {
      const cls = readClsTable(files);
      const elements = collectElements(files);
      const rules = collectCss(files);

      // 숨길 수 있는 요소: 마크업에 hidden 이 붙었거나, JS 가 .hidden 을 대입하는 것
      const hideable = elements.filter(e => e.hidden && e.classes.length)
        .map(e => ({ classes: e.classes, where: `${e.file}:${e.line}` }));
      for (const f of jsFiles(files)) {
        const code = blankJs(files[f]);
        const seen = new Set();
        for (const m of code.matchAll(/(?<![\w$.])([\w$]+)\.(?:hidden\s*=(?!=)|toggleAttribute\(\s*(?=['"]hidden))/g)) {
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          const r = resolveVar(files[f], m[1], elements, cls);
          if (r && r.classes.length) hideable.push({ classes: r.classes, where: `${f}:${lineAt(files[f], m.index)} (${m[1]})` });
        }
      }

      const globalHide = rules.some(r => r.selectors.some(s => s === '[hidden]') && /display\s*:\s*none\s*!important/.test(r.body));
      if (globalHide) return [];

      // [hidden] 이 붙은 규칙(값이 무엇이든 — 일부러 다르게 둔 것도 「짝을 생각했다」로 친다)
      const hideRules = [];
      for (const r of rules) for (const s of r.selectors) {
        const subj = subjectOf(s);
        if (/\[hidden\]/.test(subj.replace(/:not\([^)]*\)/g, ''))) hideRules.push({ classes: classesOf(subj), spec: specificity(s) });
      }

      const out = [];
      const reported = new Set();
      for (const r of rules) {
        const d = displayOf(r.body);
        if (!d || d === 'none') continue;
        for (const s of r.selectors) {
          const subj = subjectOf(s);
          if (/\[hidden\]|:not\(\[hidden\]\)/.test(subj)) continue;
          if (/^details\b|\[open\]/.test(subj)) continue; // <details> 는 열림 규칙으로 따로 못박는다(U-12 세 번째)
          const want = classesOf(subj);
          if (!want.length) continue;
          const spec = specificity(s);
          const hit = hideable.find(h => want.every(c => h.classes.includes(c)));
          if (!hit) continue;
          const paired = hideRules.some(h => h.classes.length && h.classes.every(c => hit.classes.includes(c)) && specGte(h.spec, spec) >= 0);
          if (paired) continue;
          const key = `${r.file}:${r.line}:${s}`;
          if (reported.has(key) || excused(files[r.file] || '', r.line, 'U-12')) continue;
          reported.add(key);
          out.push({ file: r.file, line: r.line, snippet: `${s} { display: ${d} } ← 숨기는 자리 ${hit.where}` });
        }
      }
      return out;
    },
  },
  {
    principle: 'D-5',
    what: '`Number(x) || 기본값` — 0 이 들어오면 기본값으로 덮인다 · `Number.isFinite(Number(x))` — null · 빈 글이 0 으로 바뀌어 수로 통과한다',
    fix: "`x != null ? Number(x) : 기본값` 으로, 수 거르기는 `typeof x === 'number' && Number.isFinite(x)` 로 바꾸거나, 검사기가 잘못 읽은 자리면 그 줄에 `// 원칙-예외(D-5): 이유` 를 단다",
    // @complexity time=O(F·L^2)? space=O(L) cc=13
    scan(files) {
      const out = [];
      const push = (f, at) => {
        const line = lineAt(files[f], at);
        if (!excused(files[f], line, 'D-5')) out.push({ file: f, line, snippet: files[f].split('\n')[line - 1].trim() });
      };
      for (const f of jsFiles(files)) {
        const code = blankJs(files[f]);
        // ② `(Number.)isFinite(Number(x))` — 괄호 안이 `Number(…)` 하나로 닫히는 꼴만 잡는다(RM-60).
        //    `Number(a) + b` 처럼 Number 가 식의 일부면 넘긴다 — 거기까지 잡으면 경보가 잦아진다.
        for (const m of code.matchAll(/(?<![\w$.])(?:Number\.)?isFinite\(/g)) {
          const open = m.index + m[0].length - 1;
          const close = matchBrace(code, open);
          if (close < 0) continue;
          const inner = code.slice(open + 1, close);
          const lead = inner.length - inner.trimStart().length;
          if (!inner.startsWith('Number(', lead)) continue;
          const innerClose = matchBrace(code, open + 1 + lead + 'Number'.length);
          if (innerClose < 0 || code.slice(innerClose + 1, close).trim() !== '') continue;
          push(f, m.index);
        }
        // ① `Number(x) || 기본값` — 0 이 기본값으로 덮인다
        for (const m of code.matchAll(/Number\(/g)) {
          const close = matchBrace(code, m.index + 'Number'.length);
          if (close < 0) continue;
          const after = code.slice(close + 1).match(/^\s*\|\|\s*([^,;)\n]+)/);
          if (!after) continue;
          // 기본값이 0 이면 0 이 0 으로 남는다 — 덮이는 것이 없다
          if (/^0(\.0*)?$/.test(after[1].trim())) continue;
          // 하한이 1 이상인 clamp 안이면 0 은 애초에 그 도메인 밖이다
          const before = code.slice(code.lastIndexOf('\n', m.index) + 1, m.index);
          if (/Math\.max\(\s*[1-9]\d*\s*,\s*(?:Math\.(?:floor|round|trunc)\()?\s*$/.test(before)) continue;
          push(f, m.index);
        }
      }
      return out;
    },
  },
  {
    principle: 'R-6',
    what: '마크업이 클래스를 둘 이상 준 요소에 `className =` 통째 대입 — 남이 붙인 클래스가 지워진다',
    fix: '상태 클래스만 `classList.toggle(이름, 켬)` 으로 더하고 뺀다',
    scan(files) {
      const out = [];
      const elements = collectElements(files);
      for (const f of jsFiles(files)) {
        if (!/^src\/(ui|input|app)\//.test(f)) continue;
        const code = blankJs(files[f]);
        for (const m of code.matchAll(/(?<![\w$.])([\w$]+)\.className\s*=(?!=)/g)) {
          const esc = m[1].replace(/\$/g, '\\$');
          const decl = code.match(new RegExp(`(?:const|let|var)\\s+${esc}\\s*=\\s*([^;\\n]+)`));
          if (!decl) continue;
          const rhs = files[f].slice(decl.index, decl.index + decl[0].length);
          const byId = rhs.match(/(?:byId|getElementById|\$)\(\s*['"]([\w-]+)['"]/);
          const byAttr = rhs.match(/\[data-(role|act)="([\w-]+)"\]/);
          const el = byId ? elements.find(e => e.id === byId[1])
            : byAttr ? elements.find(e => (byAttr[1] === 'role' ? e.role : e.act) === byAttr[2]) : null;
          if (!el || el.classes.length < 2) continue;
          const line = lineAt(files[f], m.index);
          if (excused(files[f], line, 'R-6')) continue;
          out.push({ file: f, line, snippet: `${m[1]}.className = … ← 마크업 class="${el.classes.join(' ')}" (${el.file}:${el.line})` });
        }
      }
      return out;
    },
  },
  {
    principle: 'R-10',
    what: '조립부가 같은 뷰 이름(views.X)을 두 번 단다 — 앞의 뷰가 말없이 덮여 그것을 부르는 그리기가 던진다',
    fix: '새 뷰에 아직 없는 이름을 준다(grep 으로 먼저 찾는다). 일부러 바꿔 끼우는 것이면 원칙-예외 표식에 이유를 적는다',
    scan(files) {
      const out = [];
      const main = files['src/app/main.js'];
      if (!main) return out;
      const code = blankJs(main);
      const first = new Map();
      for (const m of code.matchAll(/(?<![\w$.])views\.([\w$]+)\s*=(?![=>])/g)) {
        const line = lineAt(main, m.index);
        if (!first.has(m[1])) { first.set(m[1], line); continue; }
        if (!excused(main, line, 'R-10')) out.push({ file: 'src/app/main.js', line, snippet: `views.${m[1]} 를 ${first.get(m[1])}번째 줄에서 이미 달았다 — 여기서 덮는다` });
      }
      return out;
    },
  },
  {
    principle: 'D-14',
    what: '이름으로 잇는 명령 배선이 어긋났다 — 그 글쇠나 버튼은 말없이 아무 일도 하지 않는다',
    fix: 'domain/commands 의 COMMANDS · app/main 의 COMMAND_RUNNERS · 마크업의 data-command 를 같은 id 로 맞춘다',
    scan(files) {
      const out = [];
      const cmd = files['src/domain/commands.js'];
      const ctl = files['src/input/controls.js'];
      const main = files['src/app/main.js'];
      if (!cmd || !main) return out;
      const blind = (file, what) => out.push({ file, line: 1, snippet: `${what}을(를) 하나도 읽지 못했다 — 표의 꼴이 바뀌었으면 이 검사기의 읽는 법도 고친다(조용히 0개로 통과하지 않는다)` });

      // ① 등록부의 id
      const { ids, line: idLine } = commandIdTable(cmd);
      // ② 조립 층의 실행 표
      const { keys: runners, line: runLine } = commandRunnerTable(main);
      if (!ids.length) blind('src/domain/commands.js', 'COMMANDS 의 id');
      if (!runners.size) blind('src/app/main.js', 'COMMAND_RUNNERS 의 키');
      if (!ids.length || !runners.size) return out;

      for (const id of ids) {
        if (!runners.has(id)) out.push({ file: 'src/app/main.js', line: runLine, snippet: `명령 '${id}' 가 COMMAND_RUNNERS 에 없다` });
      }
      for (const id of runners) {
        if (!ids.includes(id)) out.push({ file: 'src/domain/commands.js', line: idLine, snippet: `COMMAND_RUNNERS.${id} — 등록부(COMMANDS)에 없는 id 다` });
      }
      // ③ 버튼이 가리키는 id — 마크업과 JS 가 만드는 마크업 모두
      for (const [file, text] of Object.entries(files)) {
        if (!/^(?:index\.html|src\/.*\.js)$/.test(file)) continue;
        for (const m of text.matchAll(/data-command="([\w-]+)"/g)) {
          if (!ids.includes(m[1])) out.push({ file, line: lineAt(text, m.index), snippet: `data-command="${m[1]}" — 등록부(COMMANDS)에 없는 id 다` });
        }
      }

      // ④ controls 가 commands.X 로 직접 부르는 이름은 bindControls({ … commands: { … } }) 파사드에 있어야 한다
      if (ctl) {
        const mainCode = blankJs(main);
        const bind = mainCode.search(/\nbindControls\(\{/);
        const cm = bind >= 0 ? mainCode.slice(bind).match(/\n\s*commands\s*:\s*\{/) : null;
        const facade = cm ? topLevelKeys(mainCode, bind + cm.index + cm[0].length - 1) : new Set();
        if (!facade.size) blind('src/app/main.js', 'bindControls 의 commands 파사드 키');
        else {
          const ctlCode = blankJs(ctl);
          for (const m of new Set([...ctlCode.matchAll(/(?<![\w$.])commands\.([\w$]+)/g)].map(m => m[1]))) {
            if (!facade.has(m)) out.push({ file: 'src/input/controls.js', line: lineAt(ctl, ctlCode.search(new RegExp(`commands\\.${m}\\b`))), snippet: `commands.${m} 를 부르는데 bindControls 파사드에 없다` });
          }
        }
      }
      return out.filter(v => !excused(files[v.file], v.line, 'D-14'));
    },
  },
  {
    principle: 'U-15',
    what: '팝업 자리 함수에 붙인 뒤 잰 높이를 주지 않는다 — 줄이 늘면 가정 높이가 낡아 창 밖으로 넘친다',
    fix: '팝업을 body 에 붙인 뒤 `height: popup.offsetHeight` 를 함께 준다',
    // @complexity time=O(n) space=O(n) cc=5
    scan(files) {
      const out = [];
      for (const f of [...jsFiles(files, 'src/ui/'), ...jsFiles(files, 'src/input/')]) {
        const code = blankJs(files[f]);
        for (const m of code.matchAll(/placePlacementActionPopup\(\s*\{/g)) {
          const open = m.index + m[0].length - 1;
          if (topLevelKeys(code, open).has('height')) continue;
          const line = lineAt(files[f], m.index);
          if (!excused(files[f], line, 'U-15')) out.push({ file: f, line, snippet: 'placePlacementActionPopup({ … }) 에 height 가 없다' });
        }
      }
      return out;
    },
  },
  {
    principle: 'U-16',
    what: '스타일이 디자인 토큰 밖의 값을 쓴다 — 색 글자 · 단계 밖 글자 크기 · !important · 테마 블록의 토큰 아닌 속성 · 빠진 단계 토큰',
    fix: 'index.html :root 의 토큰을 쓴다 — 색은 var(--…) · rgba(var(--…-rgb), a), 글자는 var(--fs-1…5). 테마는 :root[data-theme] 에서 토큰 값만 바꾼다. 데이터 색(캔버스 · 고르개 값)은 이유를 단 표식으로 가린다',
    // @complexity time=O(n) space=O(n) cc=20?
    scan(files) {
      const out = [];
      const hit = (file, line, snippet) => { if (!excusedBlock(files[file] || '', line, 'U-16')) out.push({ file, line, snippet }); };

      // ① CSS 규칙(index.html <style> + 뷰의 CSS 템플릿) — 선언마다
      const rules = collectCss(files);
      const fontSteps = new Set();
      const rootProps = new Set();
      let rootSeen = false;
      for (const r of rules) {
        const isRoot = r.selectors.length && r.selectors.every(s => s.trim() === ':root');
        if (isRoot) rootSeen = true;
        for (const d of declarations(r.body)) {
          if (isRoot) rootProps.add(d.prop);
          if (isRoot && /^--fs-\d+$/.test(d.prop)) fontSteps.add(d.prop);
          const why = tokenBreach(d.prop, d.value, r.selectors);
          if (why) hit(r.file, lineAt(files[r.file], r.bodyAt + d.at), `${r.selectors.join(', ')} { ${d.prop}: ${d.value.slice(0, 60)} } — ${why}`);
        }
      }
      if (rootSeen) {
        const html = files['index.html'] || '';
        const rootLine = lineAt(html, Math.max(0, html.search(/:root\s*\{/)));
        const missing = TOKEN_STEPS.filter(n => !rootProps.has(n));
        if (missing.length) hit('index.html', rootLine, `:root 에 단계 토큰이 없다 — ${missing.join(' · ')}`);
        if (fontSteps.size > MAX_FONT_STEPS) hit('index.html', rootLine, `글자 크기 단계가 ${fontSteps.size}개 — ${MAX_FONT_STEPS}개까지(${[...fontSteps].join(' · ')})`);
      }

      // ② index.html 마크업의 style="…"
      const html = files['index.html'] || '';
      const bodyAt = Math.max(0, html.indexOf('<body'));
      const styleBlocks = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m => [m.index, m.index + m[0].length]);
      for (const a of styleAttrs(html.slice(bodyAt), bodyAt)) {
        if (styleBlocks.some(([s, e]) => a.at >= s && a.at < e)) continue;
        for (const d of declarations(a.body)) {
          const why = tokenBreach(d.prop, d.value, null);
          if (why) hit('index.html', lineAt(html, a.at + d.at), `style="${d.prop}: ${d.value.slice(0, 50)}" — ${why}`);
        }
      }

      // ③ JS 문자열(도메인 밖) — CSS 템플릿 밖에서 손으로 적은 스타일(cssText · style 속성 · style.x = …)
      for (const f of jsFiles(files).filter(f => !f.startsWith('src/domain/'))) {
        const src = files[f];
        const cssSpans = templatesAfter(src, /const\s+[A-Z_]*(?:CSS|STYLE)[A-Z_]*\s*=\s*`/g).map(t => [t.offset, t.offset + t.body.length]);
        for (const s of scanJs(src).strings) {
          if (cssSpans.some(([a, b]) => s.offset >= a && s.offset < b)) continue; // ①에서 선언 단위로 봤다
          const text = s.text;
          if (!COLOR_RE.test(text) && !/!\s*important/i.test(text) && !/font-size|fontSize/.test(text)) continue;
          // 선언 꼴이면 선언마다, 아니면 문자열 통째로(style.color = '#fff' 처럼 값만 든 것)
          const decls = /[\w-]+\s*:/.test(text) ? declarations(text) : [{ prop: 'color', value: text, at: 0 }];
          for (const d of decls) {
            const why = tokenBreach(d.prop, d.value, null);
            if (why) hit(f, lineAt(src, s.offset + d.at), `'${text.slice(0, 70)}' — ${why}`);
          }
        }
      }
      return out;
    },
  },
];

/** @returns {Violation[]} */
export function checkPrinciples(files, rules = RULES) {
  const all = [];
  for (const r of rules) for (const v of r.scan(files)) all.push({ ...v, principle: r.principle, what: r.what, fix: r.fix });
  return all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ── 명령줄 ──────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--root');
  const root = at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : ROOT;
  const files = loadRepoFiles(root);
  if (process.argv.includes('--list')) {
    for (const r of RULES) console.log(`${r.principle.padEnd(5)} ${r.what}`);
    console.log(`\n훑은 파일 ${Object.keys(files).length}개`);
    process.exit(0);
  }
  const found = checkPrinciples(files);
  console.log(`원칙 검사 — 규칙 ${RULES.length}개(${RULES.map(r => r.principle).join(' · ')}) / 파일 ${Object.keys(files).length}개`);
  if (found.length) {
    console.error(`\n원칙 검사 실패 ${found.length}건\n`);
    for (const v of found) {
      console.error(`  ✗ ${v.file}:${v.line} — ${v.principle} ${v.what}`);
      console.error(`      ${v.snippet}`);
      console.error(`      → ${v.fix}`);
    }
    console.error('\n괜찮은 자리라고 가렸다면 그 줄에 `// 원칙-예외(원칙번호): 이유` 를 단다. 근거는 docs/PRINCIPLES.md.');
    process.exit(1);
  }
  console.log('원칙 검사 통과 — 어긴 자리 0');
}
