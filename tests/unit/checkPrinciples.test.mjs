// tests/unit/checkPrinciples.test.mjs — 원칙 검사기(tools/check-principles.mjs)의 자기 시험
//
// 검사기의 가장 나쁜 고장은 **조용히 아무것도 안 잡는 것**이다 — 통과가 「어긴 자리가 없다」인지
// 「훑지 못했다」인지 겉으로는 같다. 그래서 원칙마다 일부러 어긴 조각을 넣어 붉어지는지, 고친 꼴은
// 통과하는지, 예외 표식이 먹는지를 본다. 마지막 시험은 실제 저장소에서 돌려 0 이어야 한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPrinciples, loadRepoFiles, RULES } from '../../tools/check-principles.mjs';

const only = (principle) => RULES.filter(r => r.principle === principle);
const run = (principle, files) => checkPrinciples(files, only(principle));

const page = (style, body) => `<!doctype html><html><head><style>${style}</style></head><body>${body}</body></html>`;

test('U-11 · 속성을 빈 문자열로 끄면 잡고, 지우면 통과한다', () => {
  const bad = { 'src/ui/a.js': "track.dataset.layers = '';\n" };
  const v = run('U-11', bad);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
  assert.equal(run('U-11', { 'src/ui/a.js': "track.setAttribute('data-x', \"\");\n" }).length, 1);
  assert.equal(run('U-11', { 'src/ui/a.js': 'delete track.dataset.layers;\ntrack.dataset.layers = String(n);\n' }).length, 0);
  // 문자열·주석 속 글자는 코드가 아니다
  assert.equal(run('U-11', { 'src/ui/a.js': "// track.dataset.layers = '' 는 안 된다\nconst s = \"x.dataset.y = ''\";\n" }).length, 0);
});

test('U-12 · display 를 준 클래스에 [hidden] 짝이 없으면 잡는다 — 마크업의 hidden', () => {
  const files = { 'index.html': page('.row { display: flex; }', '<div class="row" id="r" hidden></div>') };
  const v = run('U-12', files);
  assert.equal(v.length, 1);
  assert.match(v[0].snippet, /\.row \{ display: flex \}/);
  const fixed = { 'index.html': page('.row { display: flex; }\n.row[hidden] { display: none; }', '<div class="row" id="r" hidden></div>') };
  assert.equal(run('U-12', fixed).length, 0);
});

test('U-12 · JS 가 .hidden 을 대입하는 요소도 본다 — byId · data-role · className', () => {
  const html = page('.a { display: grid; }\n.b { display: flex; }\n.c { display: block; }',
    '<div class="a" id="aa"></div>');
  const files = {
    'index.html': html,
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
  const v = run('U-12', files);
  assert.deepEqual(v.map(x => x.snippet.split(' ')[0]).sort(), ['.a', '.b', '.c']);
});

test('U-12 · 짝의 명시도가 낮으면 이기지 못한다 — 같거나 높아야 통과', () => {
  const body = '<nav class="bar" hidden></nav>';
  const weak = { 'index.html': page('body[data-on="1"] .bar { display: flex; }\n.bar[hidden] { display: none; }', body) };
  assert.equal(run('U-12', weak).length, 1);
  const strong = { 'index.html': page('body[data-on="1"] .bar { display: flex; }\nbody[data-on="1"] .bar[hidden] { display: none; }', body) };
  assert.equal(run('U-12', strong).length, 0);
});

test('U-12 · 뷰가 const CSS 로 들고 있는 스타일도 훑고, 전역 [hidden] 한 줄이면 전부 통과', () => {
  const view = 'const CSS = `\n.pop { display: grid; }\n`;\noverlay.innerHTML = `<div class="pop" hidden></div>`;\n';
  assert.equal(run('U-12', { 'index.html': page('', ''), 'src/ui/p.js': view }).length, 1);
  const global = { 'index.html': page('[hidden] { display: none !important; }', ''), 'src/ui/p.js': view };
  assert.equal(run('U-12', global).length, 0);
});

test('U-12 · 숨기지 않는 요소의 display 는 건드리지 않는다', () => {
  assert.equal(run('U-12', { 'index.html': page('.toolbar { display: flex; }', '<div class="toolbar"></div>') }).length, 0);
});

test('D-5 · Number(x) || 기본값 을 잡되, 덮일 것이 없는 꼴은 넘긴다', () => {
  assert.equal(run('D-5', { 'src/domain/a.js': 'const row = Number(p.row) || 1;\n' }).length, 1);
  // 기본값 0 — 0 은 0 으로 남는다
  assert.equal(run('D-5', { 'src/domain/a.js': 'const n = Number(x) || 0;\n' }).length, 0);
  // 하한 1 이상의 clamp — 0 은 애초에 도메인 밖
  assert.equal(run('D-5', { 'src/domain/a.js': 'const rows = Math.max(1, Number(r.rows) || 4);\nconst l = Math.max(1, Math.floor(Number(m.length) || 1));\n' }).length, 0);
  // 그러나 하한 0 의 clamp 는 0 이 유효하다 — 이것이 6813202 의 버그 꼴이다
  assert.equal(run('D-5', { 'src/domain/a.js': 'const row = Math.max(0, Number(p.row) || 1);\n' }).length, 1);
  // 괄호가 겹친 인자
  assert.equal(run('D-5', { 'src/domain/a.js': 'const s = Number(f(a, (b))) || 2;\n' }).length, 1);
});

test('D-5 · 이유가 붙은 예외 표식은 통과, 이유 없는 표식은 통과하지 않는다', () => {
  const ok = '// 원칙-예외(D-5): 0 초짜리 클립은 없다\nconst d = Number(x) || 3;\n';
  assert.equal(run('D-5', { 'src/a.js': ok }).length, 0);
  const sameLine = 'const d = Number(x) || 3; // 원칙-예외(D-5): 0 은 「모름」\n';
  assert.equal(run('D-5', { 'src/a.js': sameLine }).length, 0);
  const empty = '// 원칙-예외(D-5):\nconst d = Number(x) || 3;\n';
  assert.equal(run('D-5', { 'src/a.js': empty }).length, 1);
  const otherPrinciple = '// 원칙-예외(U-11): 다른 원칙\nconst d = Number(x) || 3;\n';
  assert.equal(run('D-5', { 'src/a.js': otherPrinciple }).length, 1);
});

test('R-6 · 마크업이 클래스를 둘 이상 준 요소에 className = 을 하면 잡는다', () => {
  const html = page('', '<button id="floatBtn" class="ghost only-wide"></button><button id="one" class="ghost"></button>');
  const bad = { 'index.html': html, 'src/ui/v.js': "const floatBtn = byId('floatBtn');\nfloatBtn.className = on ? 'a' : 'b';\n" };
  const v = run('R-6', bad);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
  // 클래스가 하나뿐인 요소 · 새로 만든 요소는 넘긴다(오탐을 줄인다)
  const fine = { 'index.html': html, 'src/ui/v.js': "const one = byId('one');\none.className = 'x';\nconst n = doc.createElement('i');\nn.className = 'y';\n" };
  assert.equal(run('R-6', fine).length, 0);
  // classList 로 고친 꼴
  const fixed = { 'index.html': html, 'src/ui/v.js': "const floatBtn = byId('floatBtn');\nfloatBtn.classList.toggle('on', on);\n" };
  assert.equal(run('R-6', fixed).length, 0);
});

test('D-14 · 단축키 세 표(동작 · HOTKEY_COMMANDS · 파사드)가 어긋나면 잡는다', () => {
  const hotkeys = "export const HOTKEY_ACTIONS = Object.freeze([\n  Object.freeze({ id: 'play', fixed: false }),\n  Object.freeze({ id: 'skip', fixed: false }),\n  Object.freeze({ id: 'undo', fixed: true })\n]);\n";
  const controls = (tbl) => `const HOTKEY_COMMANDS = Object.freeze({\n${tbl}\n});\nfunction f(commands) { commands.undo(); }\n`;
  const main = (keys) => `import x from 'y';\nbindControls({\n  els,\n  commands: {\n${keys}\n  }\n});\n`;
  const facade = "    togglePlay: () => Boolean(views.video && views.video.togglePlay()),\n    captureSkip: () => 1,\n    undo,";
  const good = {
    'src/domain/hotkeys.js': hotkeys,
    'src/input/controls.js': controls("  play: 'togglePlay',\n  skip: 'captureSkip'"),
    'src/app/main.js': main(facade),
  };
  assert.deepEqual(run('D-14', good), []);

  // 2026-09-20 의 꼴 — 표에는 있는데 파사드에 없다
  const noFacade = { ...good, 'src/app/main.js': main('    captureSkip: () => 1,\n    undo,') };
  assert.match(run('D-14', noFacade).map(v => v.snippet).join('\n'), /commands\.togglePlay 가 bindControls 파사드에 없다/);
  // 동작은 있는데 표에 없다
  const noRow = { ...good, 'src/input/controls.js': controls("  play: 'togglePlay'") };
  assert.match(run('D-14', noRow).map(v => v.snippet).join('\n'), /동작 'skip' 가 HOTKEY_COMMANDS 에 없다/);
  // controls 가 직접 부르는 이름
  const noUndo = { ...good, 'src/app/main.js': main("    togglePlay: () => 1,\n    captureSkip: () => 1,") };
  assert.match(run('D-14', noUndo).map(v => v.snippet).join('\n'), /commands\.undo/);
});

test('실제 저장소 — 어긴 자리 0(걸리면 고치거나, 괜찮은 자리면 이유를 단 예외 표식)', () => {
  const found = checkPrinciples(loadRepoFiles());
  assert.deepEqual(found.map(v => `${v.file}:${v.line} ${v.principle} ${v.snippet}`), []);
});

test('실제 저장소 — 다섯 규칙이 실제로 무언가를 훑는다(빈 손 통과 막기)', () => {
  const files = loadRepoFiles();
  // 지금 저장소의 짝 하나를 지우면 U-12 가 붉어져야 한다
  const strip = { ...files, 'src/ui/settingsView.js': files['src/ui/settingsView.js'].replace('.settings-row[hidden] { display: none; }', '') };
  assert.ok(checkPrinciples(strip, only('U-12')).some(v => v.snippet.startsWith('.settings-row')));
  // 단축키 표의 이름 하나를 틀리면 D-14 가 붉어져야 한다
  const typo = { ...files, 'src/input/controls.js': files['src/input/controls.js'].replace("play: 'togglePlay'", "play: 'togglePlayy'") };
  assert.ok(checkPrinciples(typo, only('D-14')).length > 0);
});
