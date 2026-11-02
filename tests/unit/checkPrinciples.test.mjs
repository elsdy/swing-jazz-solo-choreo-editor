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
import { checkPrinciples, loadRepoFiles, commandIdTable, RULES, TOKEN_STEPS } from '../../tools/check-principles.mjs';
import { COMMANDS } from '../../src/domain/commands.js';

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
  assert.deepEqual(RULES.map(r => r.principle), ['U-10', 'U-11', 'U-12', 'D-5', 'R-6', 'R-10', 'R-11', 'D-14', 'U-15', 'U-16']);
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

test('D-14 명령 등록부 · 실행 표 · 버튼의 id 가 어긋나면 잡는다', () => {
  const commands = "export const COMMANDS = Object.freeze([\n  def({ id: 'play', fixed: false }),\n  def({ id: 'undo', fixed: true })\n]);\n";
  const controls = 'function f(commands) { commands.setSortMode(); }\n';
  const main = (runners, facade = '    setSortMode: () => 1,') =>
    `import x from 'y';\nconst COMMAND_RUNNERS = Object.freeze({\n${runners}\n});\nbindControls({\n  els,\n  commands: {\n${facade}\n  }\n});\n`;
  const good = {
    'src/domain/commands.js': commands,
    'src/input/controls.js': controls,
    'src/app/main.js': main("  play: () => Boolean(views.video && views.video.togglePlay()),\n  undo: ({ board }) => { render(undo(board)); return true; }"),
    'index.html': '<button data-command="undo">Undo</button>',
  };
  assert.deepEqual(run('D-14', good), []);
  const said = (files) => run('D-14', files).map(v => v.snippet).join('\n');

  // 등록부에 있는데 실행이 없다 — 2026-09-20 의 스페이스
  assert.match(said({ ...good, 'src/app/main.js': main('  undo: () => true') }), /명령 'play' 가 COMMAND_RUNNERS 에 없다/);
  // 실행만 있고 등록부에 없다
  assert.match(said({ ...good, 'src/app/main.js': main('  play: () => 1,\n  undo: () => 1,\n  redoo: () => 1') }), /COMMAND_RUNNERS\.redoo/);
  // 버튼이 없는 id 를 가리킨다
  assert.match(said({ ...good, 'index.html': '<button data-command="undoo">Undo</button>' }), /data-command="undoo"/);
  // controls 가 commands.X 로 직접 부르는 이름
  assert.match(said({ ...good, 'src/app/main.js': main('  play: () => 1,\n  undo: () => 1', '    addMove: () => 1,') }), /commands\.setSortMode/);
  // 실행 표를 하나도 못 읽으면(꼴이 바뀌었다) 조용히 통과하지 않는다
  assert.match(said({ ...good, 'src/app/main.js': 'const COMMAND_RUNNERS = makeRunners();\nbindControls({\n  commands: {\n    setSortMode,\n  }\n});\n' }), /COMMAND_RUNNERS 의 키을\(를\) 하나도 읽지 못했다/);
});

test('R-10 조립부가 같은 views 이름을 두 번 달면 잡는다', () => {
  // 2026-10-01(RM-09) — 명령 팔레트를 동작 목록 뷰의 이름(views.palette)에 달아 부팅 중 views.palette.render() 가 던졌다
  const bad = "views.palette = paletteView;\nviews.palette.render();\nviews.palette = createCommandPalette({});\n";
  const v = run('R-10', { 'src/app/main.js': bad });
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
  assert.match(v[0].snippet, /views\.palette 를 1번째 줄에서 이미 달았다/);
  // 이름이 다르면, 비교(===)·화살표·읽기는 넘긴다
  const fine = "views.palette = paletteView;\nviews.commandPalette = createCommandPalette({});\nif (views.palette === x) f();\nconst g = () => views.palette;\n";
  assert.equal(run('R-10', { 'src/app/main.js': fine }).length, 0);
  // 일부러 갈아 끼우는 것은 이유를 단 표식으로
  assert.equal(run('R-10', { 'src/app/main.js': bad.replace('views.palette = create', '// 원칙-예외(R-10): 시험용으로 갈아 끼운다\nviews.palette = create') }).length, 0);
});

test('R-11 펼침 리터럴이 앞에서 펼친 것을 뒤의 펼침 호출에 넘기면 잡는다', () => {
  // 2026-11-03(RM-29) — `{ ...out, ...historyTail(out) }` 에서 historyTail 이 out.version 을 3 으로 올렸지만, 앞의 `...out` 은
  // 이미 1 을 펼친 뒤라 판본이 든 파일이 version 1 로 쓰였다(옛 앱이 열어 판본을 버린다)
  const bad = "function build(out) {\n  return { ...out, ...historyTail(out, { versions }), ...rest(p) };\n}\n";
  const v = run('R-11', { 'src/domain/a.js': bad });
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
  assert.match(v[0].snippet, /historyTail\(out/);
  // 호출을 먼저 해 이름에 담은 꼴 · 다른 이름(x.out)을 넘기는 것 · 주석 속 글자는 넘긴다
  const fine = "function build(out) {\n  // { ...out, ...historyTail(out) } 는 쓰지 않는다\n  const tail = historyTail(out, { versions });\n  return { ...out, ...tail, ...other(x.out), ...more(outer) };\n}\n";
  assert.equal(run('R-11', { 'src/domain/a.js': fine }).length, 0);
  // 고치지 않는 것이 분명하면 이유를 단 표식으로
  assert.equal(run('R-11', { 'src/domain/a.js': bad.replace('  return', '  // 원칙-예외(R-11): rest 는 읽기만 한다\n  return') }).length, 0);
});

// ── U-16 디자인 토큰(RM-17) — 요구 ↔ 시험 1 · 5 · 6 ─────────────────────────

/** 단계 토큰을 다 갖춘 :root — 시험마다 여기서 하나씩 빼거나 어긴다. */
const ROOT_TOKENS = ':root {\n' + TOKEN_STEPS.map((n, i) => `  ${n}: ${n.startsWith('--fs') ? 11 + i + 'px' : '#000'};`).join('\n') + '\n}\n';

test('토큰 규칙 — :root 에 단계 토큰이 빠지면 잡는다', () => {
  assert.equal(run('U-16', { 'index.html': page(ROOT_TOKENS, '') }).length, 0);
  const v = run('U-16', { 'index.html': page(ROOT_TOKENS.replace(/  --sp-3: [^\n]+\n/, ''), '') });
  assert.equal(v.length, 1);
  assert.equal(v[0].principle, 'U-16');
  assert.match(v[0].snippet, /단계 토큰이 없다 — --sp-3/);
  // 실제 저장소에서 하나를 지워도 붉어진다(빈 손 통과 막기)
  const files = loadRepoFiles();
  const cut = files['index.html'].replace(/\n\s*--r-pill: 999px;/, '\n').replace(/--r-pill: 999px;/, '');
  assert.notEqual(cut, files['index.html'], '지울 자리를 못 찾았다 — 시험이 빈손이다');
  assert.ok(checkPrinciples({ ...files, 'index.html': cut }, only('U-16')).some(x => /--r-pill/.test(x.snippet)));
});

test('토큰 규칙 — 테마 블록이 토큰 아닌 속성을 적으면 잡는다', () => {
  const good = ROOT_TOKENS + ':root[data-theme="neon"] {\n  --bg: #050b18;\n  --bg-image: linear-gradient(#000, #111);\n}\n';
  assert.equal(run('U-16', { 'index.html': page(good, '') }).length, 0);
  const bad = good + ':root[data-theme="neon"] body {\n  background-attachment: fixed;\n}\n';
  const v = run('U-16', { 'index.html': page(bad, '') });
  assert.equal(v.length, 1);
  assert.match(v[0].snippet, /테마 블록이 토큰 아닌 속성 background-attachment/);
  assert.equal(v[0].file, 'index.html');
  // 테마 블록에 색을 적는 것은 토큰 정의라 괜찮고, 그 밖의 선택자에서 커스텀 속성에 색을 적으면 잡는다
  assert.equal(run('U-16', { 'index.html': page(ROOT_TOKENS + '.x {\n  --c: #fff;\n}\n', '') }).length, 1);
});

test('토큰 규칙 — 토큰 밖 색 · 여섯째 글자 크기 · !important 를 잡는다', () => {
  const css = ROOT_TOKENS + '.a {\n  color: #e5e7eb;\n}\n.b {\n  font-size: 10.5px;\n}\n.c {\n  display: none !important;\n}\n';
  const v = run('U-16', { 'index.html': page(css, '') });
  assert.deepEqual(v.map(x => [x.principle, x.file, x.line]), [['U-16', 'index.html', 24], ['U-16', 'index.html', 27], ['U-16', 'index.html', 30]]);
  assert.match(v[0].snippet, /토큰 밖 색 #e5e7eb/);
  assert.match(v[1].snippet, /단계 밖 글자 크기 10\.5px/);
  assert.match(v[2].snippet, /!important/);
  // 토큰으로 쓰면 지나간다
  assert.equal(run('U-16', { 'index.html': page(ROOT_TOKENS + '.a { color: var(--text); background: rgba(var(--bg-rgb), 0.5); font-size: var(--fs-2); }\n', '') }).length, 0);
  // 여섯째 단계 토큰도 「여섯째 글자 크기」다
  const six = ROOT_TOKENS.replace(':root {\n', ':root {\n  --fs-5: 28px;\n  --fs-6: 30px;\n');
  assert.ok(run('U-16', { 'index.html': page(six, '') }).some(x => /글자 크기 단계가 6개/.test(x.snippet)));
  // 뷰의 CSS 템플릿 · 손으로 적은 cssText · 마크업 style 도 본다
  const view = (s) => `const CSS = \`\n${s}\n\`;\n`;
  assert.equal(run('U-16', { 'index.html': page('', ''), 'src/ui/v.js': view('.x { background: rgba(15, 23, 41, 0.9); }') }).length, 1);
  assert.equal(run('U-16', { 'index.html': page('', ''), 'src/ui/v.js': "el.style.cssText = 'font-size:10px;color:var(--muted);';\n" }).length, 1);
  assert.equal(run('U-16', { 'index.html': page('', '<p style="color:#dbe4ef">x</p>') }).length, 1);
  // 도메인의 데이터 색(카테고리 팔레트)은 보지 않는다
  assert.equal(run('U-16', { 'index.html': page('', ''), 'src/domain/p.js': "export const P = ['#22c55e'];\n" }).length, 0);
  // 데이터 색은 이유를 단 표식이 블록 머리 위에서 덮는다
  const mesh = "// 원칙-예외(U-16): 캔버스에 그리는 데이터 색\nexport const C = Object.freeze({\n  stroke: 'rgba(226,232,240,0.92)',\n  fill: '#0f172a',\n});\n";
  assert.equal(run('U-16', { 'index.html': page('', ''), 'src/ui/m.js': mesh }).length, 0);
  assert.equal(run('U-16', { 'index.html': page('', ''), 'src/ui/m.js': mesh.replace(': 캔버스에 그리는 데이터 색', ':') }).length, 2);
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

test('D-14 · 검사기가 글자로 읽은 등록부의 id 가 실제로 내보낸 COMMANDS 와 같다', () => {
  const text = readFileSync(join(ROOT, 'src', 'domain', 'commands.js'), 'utf8');
  assert.deepEqual(commandIdTable(text).ids, COMMANDS.map(c => c.id));
});

test('실제 저장소 — 짝 하나 · 이름 하나를 틀리면 붉어진다(빈 손 통과 막기)', () => {
  const files = loadRepoFiles();
  const strip = { ...files, 'src/ui/settingsView.js': files['src/ui/settingsView.js'].replace('.settings-row[hidden] { display: none; }', '') };
  assert.ok(checkPrinciples(strip, only('U-12')).some(v => v.snippet.startsWith('.settings-row')));
  const typo = { ...files, 'src/app/main.js': files['src/app/main.js'].replace('\n  play: ', '\n  playy: ') };
  assert.notEqual(typo['src/app/main.js'], files['src/app/main.js'], '바꿀 자리를 못 찾았다 — 시험이 빈손이다');
  assert.ok(checkPrinciples(typo, only('D-14')).length > 0);
});

// ── RM-27 요구 ↔ 시험 8 ────────────────────────────────────────────────────

test('U-10 폰 확대 차단(user-scalable=no · maximum-scale=1 · focusout 때 scrollTo(0,0))을 잡는다', () => {
  const head = (content) => `<!doctype html><html><head><meta name="viewport" content="${content}" /></head><body></body></html>`;
  // ① viewport 메타
  const meta = run('U-10', { 'index.html': head('width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no') });
  assert.equal(meta.length, 1);
  assert.equal(meta[0].file, 'index.html');
  assert.equal(meta[0].line, 1);
  assert.equal(run('U-10', { 'index.html': head('width=device-width, maximum-scale=1') }).length, 1);
  // maximum-scale=5 처럼 확대를 허용하는 값은 넘긴다
  assert.equal(run('U-10', { 'index.html': head('width=device-width, initial-scale=1.0, maximum-scale=5') }).length, 0);

  // ② focusout 처리기가 viewport 를 다시 박고 맨 위로 굴린다 — 두 줄 다 잡는다
  const handler = [
    "on(doc, 'focusout', (e) => {",
    '  win.setTimeout(() => {',
    "    vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');",
    '    win.scrollTo(0, 0);',
    '  }, 100);',
    '});',
    ''
  ].join('\n');
  const v = run('U-10', { 'src/ui/layout.js': handler });
  assert.deepEqual(v.map(x => x.line).sort(), [3, 4]);

  // 명령줄로 띄우면 파일:줄과 종료 코드 1
  const bad = runCli({ 'index.html': head('width=device-width, user-scalable=no'), 'src/ui/layout.js': handler });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /✗ index\.html:1 — U-10 /);
  assert.match(bad.stderr, /✗ src\/ui\/layout\.js:4 — U-10 /);

  // 16px 입력 글자만 둔 꼴 · 다른 처리기의 scrollTo · 주석 속 글자는 통과한다
  const good = runCli({
    // 16px !important 는 U-16(토큰)에 걸리는 글자라 실제 index.html 처럼 이유를 단 표식을 함께 둔다
    'index.html': page('/* 원칙-예외(U-16): iOS 확대 문턱 — 글자 단계가 아니다 */\n@media (max-width: 1040px) { input, select, textarea { font-size: 16px !important; } }', '')
      .replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1.0" />'),
    'src/ui/layout.js': "// 옛날에는 user-scalable=no 를 박았다\non(doc, 'click', () => { win.scrollTo(0, 0); });\non(doc, 'focusout', () => { save(); });\n"
  });
  assert.equal(good.status, 0, good.stdout + good.stderr);
});

test('U-15 · 팝업 자리 함수에 잰 높이를 주지 않으면 잡는다', () => {
  // 2026-11-02(RM-16) — 마디 메뉴 · 블록 팝업이 다섯 줄이 됐는데 가정 높이(132)로 자리를 잡아 창 아래로 40px 넘쳤다
  const bad = "const { left, top } = placePlacementActionPopup({\n  clientX, clientY, viewW: innerWidth, viewH: innerHeight,\n});\n";
  const v = run('U-15', { 'src/ui/p.js': bad });
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
  const good = bad.replace('viewH: innerHeight,', 'viewH: innerHeight, height: popup.offsetHeight,');
  assert.equal(run('U-15', { 'src/ui/p.js': good }).length, 0);
  // 정의(domain)와 시험은 넘긴다 — ui · input 의 호출만 본다
  assert.equal(run('U-15', { 'src/domain/popupPlacement.js': 'export function placePlacementActionPopup({ clientX }) {}\n' }).length, 0);
});
