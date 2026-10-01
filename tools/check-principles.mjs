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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 글자 다루기 ─────────────────────────────────────────────────────────────

/** 오프셋 → 1부터 세는 줄 번호. */
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** 그 줄이나 바로 윗줄에 이유가 붙은 예외 표식이 있나. */
function excused(text, line, principle) {
  const lines = text.split('\n');
  const re = new RegExp(`원칙-예외\\(${principle}\\)\\s*:\\s*\\S`);
  return re.test(lines[line - 1] || '') || re.test(lines[line - 2] || '');
}

/**
 * JS 원문에서 주석과 문자열 **속**을 같은 길이의 공백으로 지운다(줄바꿈은 남겨 줄 번호가 그대로다).
 * 템플릿의 `${…}` 안은 코드이므로 남긴다. 정규식 리터럴은 앞 글자로 어림한다.
 */
function blankJs(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  const stack = []; // '{' 코드 블록 · '`' 템플릿 안 `${` 의 깊이
  const prevSignificant = (k) => { while (k >= 0 && /\s/.test(src[k])) k--; return k >= 0 ? src[k] : ''; };
  function readTemplate() {
    // src[i] === '`'
    let j = i + 1;
    let start = j;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { blank(start, j); i = j + 1; return; }
      if (src[j] === '$' && src[j + 1] === '{') {
        blank(start, j);
        i = j + 2;
        readCode(1);
        j = i;          // i 는 짝 '}' 바로 뒤
        start = j;
        continue;
      }
      j++;
    }
    blank(start, j); i = j;
  }
  function readCode(depth) {
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
      if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
      if (c === '\'' || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        blank(i + 1, j); i = j + 1; continue;
      }
      if (c === '`') { readTemplate(); continue; }
      if (c === '/' && /^[(,=:[!&|?{};+\-*%<>~^]?$/.test(prevSignificant(i - 1)) && !/[\w$)\]]/.test(prevSignificant(i - 1))) {
        let j = i + 1; let inClass = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j++;
        }
        blank(i + 1, j); i = j + 1; continue;
      }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0 && stack !== null) { i++; return; } }
      i++;
    }
  }
  readCode(Infinity);
  return out.join('');
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

// ── 규칙 표 ─────────────────────────────────────────────────────────────────

/**
 * input/controls.js 원문에서 HOTKEY_COMMANDS 표를 글자로 읽는다(D-14). 시험이 이 결과를 실제로 내보낸 값과 맞춰 본다 —
 * 표의 꼴이 바뀌어 읽는 법이 낡으면 거기서 붉어진다.
 * @returns {{ map: Record<string, string>, line: number }}
 */
export function hotkeyCommandTable(ctlText) {
  const tbl = ctlText.match(/(?:export )?const HOTKEY_COMMANDS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  const map = {};
  if (tbl) for (const m of tbl[1].matchAll(/([\w$]+)\s*:\s*'([\w$]+)'/g)) map[m[1]] = m[2];
  return { map, line: tbl ? lineAt(ctlText, tbl.index) : 1 };
}

/** @typedef {{ file: string, line: number, principle: string, what: string, fix: string }} Violation */

export const RULES = [
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
    what: '`Number(x) || 기본값` — 0 이 들어오면 기본값으로 덮인다',
    fix: '`x != null ? Number(x) : 기본값` 으로 바꾸거나, 0 이 뜻 없는 자리면 그 줄에 `// 원칙-예외(D-5): 이유` 를 단다',
    scan(files) {
      const out = [];
      for (const f of jsFiles(files)) {
        const code = blankJs(files[f]);
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
          const line = lineAt(files[f], m.index);
          if (excused(files[f], line, 'D-5')) continue;
          out.push({ file: f, line, snippet: files[f].split('\n')[line - 1].trim() });
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
    principle: 'D-14',
    what: '이름으로 잇는 단축키 배선이 어긋났다 — 그 글쇠는 말없이 아무 일도 하지 않는다',
    fix: 'domain/hotkeys 의 동작 · input/controls 의 HOTKEY_COMMANDS · app/main 의 bindControls 파사드 세 곳을 맞춘다',
    scan(files) {
      const out = [];
      const hk = files['src/domain/hotkeys.js'];
      const ctl = files['src/input/controls.js'];
      const main = files['src/app/main.js'];
      if (!hk || !ctl || !main) return out;
      const blind = (file, what) => out.push({ file, line: 1, snippet: `${what}을(를) 하나도 읽지 못했다 — 표의 꼴이 바뀌었으면 이 검사기의 읽는 법도 고친다(조용히 0개로 통과하지 않는다)` });

      // ① 바꿀 수 있는 동작(fixed: false) — 이것만 HOTKEY_COMMANDS 를 거쳐 커맨드를 부른다
      const editable = [];
      for (const m of hk.matchAll(/id:\s*'([\w-]+)'[\s\S]*?fixed:\s*(true|false)/g)) if (m[2] === 'false') editable.push(m[1]);

      // ② HOTKEY_COMMANDS 표
      const { map, line: tblLine } = hotkeyCommandTable(ctl);

      // ③ app/main 의 bindControls({ … commands: { … } }) 파사드의 최상위 키
      const facade = new Set();
      const mainCode = blankJs(main);
      const bind = mainCode.search(/\nbindControls\(\{/);
      let facadeLine = 1;
      if (bind >= 0) {
        const cm = mainCode.slice(bind).match(/\n\s*commands\s*:\s*\{/);
        if (cm) {
          const open = bind + cm.index + cm[0].length - 1;
          facadeLine = lineAt(main, open);
          const close = matchBrace(mainCode, open);
          let depth = 0;
          const body = mainCode.slice(open + 1, close);
          let top = '';
          for (const c of body) {
            if ('{([' .includes(c)) depth++;
            else if ('})]'.includes(c)) depth--;
            else if (depth === 0) top += c;
            if (depth > 0 && top.slice(-1) !== '#') top += '#';
          }
          for (const m of top.matchAll(/(?:^|,)\s*([\w$]+)\s*(?=[:,(#]|$)/g)) facade.add(m[1]);
        }
      }

      if (!editable.length) blind('src/domain/hotkeys.js', 'HOTKEY_ACTIONS 의 바꿀 수 있는 동작');
      if (!Object.keys(map).length) blind('src/input/controls.js', 'HOTKEY_COMMANDS 표');
      if (!facade.size) blind('src/app/main.js', 'bindControls 의 commands 파사드 키');
      if (!editable.length || !Object.keys(map).length || !facade.size) return out;

      for (const id of editable) {
        if (!map[id]) out.push({ file: 'src/input/controls.js', line: tblLine, snippet: `동작 '${id}' 가 HOTKEY_COMMANDS 에 없다` });
      }
      for (const [id, name] of Object.entries(map)) {
        if (!editable.includes(id)) out.push({ file: 'src/input/controls.js', line: tblLine, snippet: `HOTKEY_COMMANDS.${id} — domain/hotkeys 에 바꿀 수 있는 동작 '${id}' 가 없다` });
        if (!facade.has(name)) out.push({ file: 'src/app/main.js', line: facadeLine, snippet: `HOTKEY_COMMANDS.${id} → commands.${name} 가 bindControls 파사드에 없다` });
      }
      // ④ controls 가 commands.X 로 직접 부르는 이름도 파사드에 있어야 한다
      const ctlCode = blankJs(ctl);
      for (const m of new Set([...ctlCode.matchAll(/(?<![\w$.])commands\.([\w$]+)/g)].map(m => m[1]))) {
        if (!facade.has(m)) out.push({ file: 'src/input/controls.js', line: lineAt(ctl, ctlCode.search(new RegExp(`commands\\.${m}\\b`))), snippet: `commands.${m} 를 부르는데 bindControls 파사드에 없다` });
      }
      return out.filter(v => !excused(files[v.file], v.line, 'D-14'));
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
