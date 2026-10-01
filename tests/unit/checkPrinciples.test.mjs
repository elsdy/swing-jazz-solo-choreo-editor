// tests/unit/checkPrinciples.test.mjs — 원칙 검사기(tools/check-principles.mjs)의 자기 시험
//
// 검사기의 가장 나쁜 고장은 **조용히 아무것도 안 잡는 것**이다 — 통과가 「어긴 자리가 없다」인지
// 「훑지 못했다」인지 겉으로는 같다. 그래서 원칙마다 일부러 어긴 조각을 넣어 붉어지는지, 고친 꼴은
// 통과하는지를 본다. 앞의 일곱 시험은 계획서(docs/roadmap/plans/RM-05.md)의 「요구 ↔ 시험」 표 1~7 이고,
// 이름이 표와 같아야 한다. 그 뒤는 표 밖에서 덧댄 것이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPrinciples, loadRepoFiles, hotkeyCommandTable, RULES } from '../../tools/check-principles.mjs';
import { HOTKEY_COMMANDS } from '../../src/input/controls.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = join(ROOT, 'tools', 'check-principles.mjs');

const only = (principle) => RULES.filter(r => r.principle === principle);
const run = (principle, files) => checkPrinciples(files, only(principle));
const page = (style, body) => `<!doctype html><html><head><style>${style}</style></head><body>${body}</body></html>`;

/** 파일 묶음을 임시 폴더에 펼쳐 검사기를 명령줄로 띄운다. */
function runCli(files) {
  const dir = mkdtempSync(join(tmpdir(), 'check-principles-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return spawnSync(process.execPath, [TOOL, '--root', dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 요구 ↔ 시험 1~7 ─────────────────────────────────────────────────────────

test('위반이 있으면 종료 코드 1과 파일:줄 — 원칙 꼴로 찍는다', () => {
  const bad = runCli({
    'index.html': page('', ''),
    'src/domain/a.js': 'export const f = (p) => {\n  const row = Number(p.row) || 1;\n  return row;\n};\n',
    'src/ui/b.js': "el.dataset.on = '';\n",
  });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  // 「파일:줄 — 원칙 무엇」 다음 줄에 원문, 그다음 줄에 「→ 고치는 법」
  assert.match(bad.stderr, /✗ src\/domain\/a\.js:2 — D-5 .+\n\s+const row = Number\(p\.row\) \|\| 1;\n\s+→ .+/);
  assert.match(bad.stderr, /✗ src\/ui\/b\.js:1 — U-11 /);
  assert.match(bad.stderr, /원칙 검사 실패 2건/);

  const good = runCli({ 'index.html': page('', ''), 'src/domain/a.js': 'export const f = (p) => (p.row != null ? Number(p.row) : 1);\n' });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /원칙 검사 통과 — 어긴 자리 0/);

  // 원칙마다 규칙이 표 한 줄 — { 원칙, 무엇, 고치는 법, scan }
  assert.deepEqual(RULES.map(r => r.principle), ['U-11', 'U-12', 'D-5', 'R-6', 'D-14']);
  for (const r of RULES) {
    assert.equal(typeof r.scan, 'function');
    assert.ok(r.what && r.fix, `${r.principle}: 무엇 · 고치는 법이 비었다`);
  }
});

test('U-11 빈 문자열로 속성을 끄면 잡는다', () => {
  const v = run('U-11', { 'src/ui/a.js': "track.dataset.layers = '';\n" });
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
  assert.equal(run('U-11', { 'src/ui/a.js': "track.setAttribute('data-x', \"\");\n" }).length, 1);
  // 속성을 지우는 꼴과 값을 넣는 꼴은 통과
  assert.equal(run('U-11', { 'src/ui/a.js': 'delete track.dataset.layers;\ntrack.dataset.layers = String(n);\n' }).length, 0);
  // 주석·문자열 속 글자는 코드가 아니다
  assert.equal(run('U-11', { 'src/ui/a.js': "// track.dataset.layers = '' 는 안 된다\nconst s = \"x.dataset.y = ''\";\n" }).length, 0);
});

test('U-12 display 선택자에 [hidden] 짝이 없으면 잡는다', () => {
  // ① index.html 의 <style>
  const markup = '<div class="x" id="x" hidden></div>';
  const v = run('U-12', { 'index.html': page('.x { display: flex; }', markup) });
  assert.equal(v.length, 1);
  assert.match(v[0].snippet, /^\.x \{ display: flex \}/);
  assert.equal(run('U-12', { 'index.html': page('.x { display: flex; }\n.x[hidden] { display: none; }', markup) }).length, 0);
  // 미디어 쿼리 안의 짝도 짝이다(.thumb-bar[hidden] 처럼 같은 선택자가 두 번 나오는 자리)
  assert.equal(run('U-12', { 'index.html': page('.x { display: flex; }\n@media (max-width: 600px) { .x[hidden] { display: none; } }', markup) }).length, 0);

  // ② 뷰가 들고 있는 const CSS 백틱 문자열 — 요소는 그 뷰의 innerHTML 템플릿에 있다
  const view = (css) => `const CSS = \`\n${css}\n\`;\noverlay.innerHTML = \`<section class="x" data-role="sec" hidden></section>\`;\n`;
  assert.equal(run('U-12', { 'index.html': page('', ''), 'src/ui/v.js': view('.x { display: flex; }') }).length, 1);
  assert.equal(run('U-12', { 'index.html': page('', ''), 'src/ui/v.js': view('.x { display: flex; }\n.x[hidden] { display: none; }') }).length, 0);

  // ③ 전역 [hidden] 규칙이 있으면 전부 통과
  assert.equal(run('U-12', { 'index.html': page('[hidden] { display: none !important; }\n.x { display: flex; }', markup) }).length, 0);
  assert.equal(run('U-12', { 'index.html': page('', ''), 'src/ui/v.js': view('[hidden] { display: none !important; }\n.x { display: flex; }') }).length, 0);
});

test('D-5 0을 덮는 기본값만 잡는다', () => {
  assert.equal(run('D-5', { 'src/domain/a.js': 'const n = Number(r) || 1;\n' }).length, 1);
  // 기본값 0 — 0 은 0 으로 남는다
  assert.equal(run('D-5', { 'src/domain/a.js': 'const n = Number(r) || 0;\n' }).length, 0);
  // 하한 1 이상의 clamp — 0 은 애초에 도메인 밖
  assert.equal(run('D-5', { 'src/domain/a.js': 'const n = Math.max(1, Number(r) || 4);\n' }).length, 0);
  assert.equal(run('D-5', { 'src/domain/a.js': 'const l = Math.max(1, Math.floor(Number(m.length) || 1));\n' }).length, 0);
  // 하한 0 의 clamp 는 0 이 유효하다 — 6813202 의 버그 꼴이다
  assert.equal(run('D-5', { 'src/domain/a.js': 'const row = Math.max(0, Number(p.row) || 1);\n' }).length, 1);
  // 괄호가 겹친 인자
  assert.equal(run('D-5', { 'src/domain/a.js': 'const s = Number(f(a, (b))) || 2;\n' }).length, 1);
});

test('R-6 마크업 클래스가 둘인 요소의 className 대입만 잡는다', () => {
  const html = page('', '<button id="floatBtn" class="ghost only-wide"></button><button id="one" class="ghost"></button>');
  const v = run('R-6', { 'index.html': html, 'src/ui/v.js': "const floatBtn = byId('floatBtn');\nfloatBtn.className = on ? 'a' : 'b';\n" });
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
  // 클래스가 하나뿐인 요소 · 새로 만든 요소는 넘긴다(오탐을 줄인다)
  const fine = "const one = byId('one');\none.className = 'x';\nconst n = doc.createElement('i');\nn.className = 'y';\n";
  assert.equal(run('R-6', { 'index.html': html, 'src/ui/v.js': fine }).length, 0);
  // classList 로 고친 꼴
  assert.equal(run('R-6', { 'index.html': html, 'src/ui/v.js': "const floatBtn = byId('floatBtn');\nfloatBtn.classList.toggle('on', on);\n" }).length, 0);
});

test('D-14 단축키 표의 커맨드가 파사드에 없으면 잡는다', () => {
  const hotkeys = "export const HOTKEY_ACTIONS = Object.freeze([\n  Object.freeze({ id: 'play', fixed: false }),\n  Object.freeze({ id: 'skip', fixed: false }),\n  Object.freeze({ id: 'undo', fixed: true })\n]);\n";
  const controls = (tbl) => `export const HOTKEY_COMMANDS = Object.freeze({\n${tbl}\n});\nfunction f(commands) { commands.undo(); }\n`;
  const main = (keys) => `import x from 'y';\nbindControls({\n  els,\n  commands: {\n${keys}\n  }\n});\n`;
  const facade = "    togglePlay: () => Boolean(views.video && views.video.togglePlay()),\n    captureSkip: () => 1,\n    undo,";
  const good = {
    'src/domain/hotkeys.js': hotkeys,
    'src/input/controls.js': controls("  play: 'togglePlay',\n  skip: 'captureSkip'"),
    'src/app/main.js': main(facade),
  };
  assert.deepEqual(run('D-14', good), []);
  const said = (files) => run('D-14', files).map(v => v.snippet).join('\n');

  // HOTKEY_COMMANDS 가 가리키는 이름이 파사드에 없다 — 2026-09-20 의 스페이스
  assert.match(said({ ...good, 'src/app/main.js': main('    captureSkip: () => 1,\n    undo,') }), /commands\.togglePlay 가 bindControls 파사드에 없다/);
  // 바꿀 수 있는 동작 id 가 HOTKEY_COMMANDS 에 없다
  assert.match(said({ ...good, 'src/input/controls.js': controls("  play: 'togglePlay'") }), /동작 'skip' 가 HOTKEY_COMMANDS 에 없다/);
  // controls 가 commands.X 로 직접 부르는 이름
  assert.match(said({ ...good, 'src/app/main.js': main('    togglePlay: () => 1,\n    captureSkip: () => 1,') }), /commands\.undo/);
  // 파사드를 하나도 못 읽으면(객체 꼴이 바뀌었다) 조용히 통과하지 않는다
  assert.match(said({ ...good, 'src/app/main.js': 'bindControls(makeDeps());\n' }), /파사드 키을\(를\) 하나도 읽지 못했다/);
});

test('지금 저장소는 통과한다', () => {
  const r = spawnSync(process.execPath, [TOOL], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /원칙 검사 통과 — 어긴 자리 0/);
});

// ── 표 밖에서 덧댄 것 ───────────────────────────────────────────────────────

test('U-12 · 짝의 명시도가 낮으면 이기지 못한다 — 같거나 높아야 통과', () => {
  const body = '<nav class="bar" hidden></nav>';
  assert.equal(run('U-12', { 'index.html': page('body[data-on="1"] .bar { display: flex; }\n.bar[hidden] { display: none; }', body) }).length, 1);
  assert.equal(run('U-12', { 'index.html': page('body[data-on="1"] .bar { display: flex; }\nbody[data-on="1"] .bar[hidden] { display: none; }', body) }).length, 0);
});

test('U-12 · JS 가 .hidden 을 대입하는 요소도 본다 — byId · data-role · className, 숨기지 않는 요소는 넘긴다', () => {
  const files = {
    'index.html': page('.a { display: grid; }\n.b { display: flex; }\n.c { display: block; }\n.toolbar { display: flex; }', '<div class="a" id="aa"></div><div class="toolbar"></div>'),
    'src/ui/v.js': [
      "const aEl = byId('aa');",
      'aEl.hidden = true;',
      'overlay.innerHTML = `<section class="b" data-role="sec"></section>`;',
      'const sec = overlay.querySelector(\'[data-role="sec"]\');',
      'sec.hidden = !on;',
      "const cEl = doc.createElement('div');",
      "cEl.className = 'c';",
      'cEl.hidden = false;',
    ].join('\n'),
  };
  assert.deepEqual(run('U-12', files).map(x => x.snippet.split(' ')[0]).sort(), ['.a', '.b', '.c']);
});

test('예외 표식 — 이유가 붙은 것만 통과한다', () => {
  assert.equal(run('D-5', { 'src/a.js': '// 원칙-예외(D-5): 검사기가 잘못 읽는 자리\nconst d = Number(x) || 3;\n' }).length, 0);
  assert.equal(run('D-5', { 'src/a.js': '// 원칙-예외(D-5):\nconst d = Number(x) || 3;\n' }).length, 1);
  assert.equal(run('D-5', { 'src/a.js': '// 원칙-예외(U-11): 다른 원칙\nconst d = Number(x) || 3;\n' }).length, 1);
});

test('D-14 · 검사기가 글자로 읽은 HOTKEY_COMMANDS 가 실제로 내보낸 값과 같다', () => {
  const text = readFileSync(join(ROOT, 'src', 'input', 'controls.js'), 'utf8');
  assert.deepEqual(hotkeyCommandTable(text).map, { ...HOTKEY_COMMANDS });
});

test('실제 저장소 — 짝 하나 · 이름 하나를 틀리면 붉어진다(빈 손 통과 막기)', () => {
  const files = loadRepoFiles();
  const strip = { ...files, 'src/ui/settingsView.js': files['src/ui/settingsView.js'].replace('.settings-row[hidden] { display: none; }', '') };
  assert.ok(checkPrinciples(strip, only('U-12')).some(v => v.snippet.startsWith('.settings-row')));
  const typo = { ...files, 'src/input/controls.js': files['src/input/controls.js'].replace("play: 'togglePlay'", "play: 'togglePlayy'") };
  assert.ok(checkPrinciples(typo, only('D-14')).length > 0);
});
