// tests/unit/tutorialInstall.test.mjs — 설치형 앱의 맥 첫 실행 안내가 지금 앱 · macOS 와 맞는지 (RM-67)
//
// RM-28 마무리에서 잼: 튜토리얼은 .dmg 에서 `안무 편집기` 를 끌라 했지만 Finder 에는 묶음 이름 「SwingChoreo」가 보였다
// (Info.plist 의 CFBundleDisplayName 만 바꾸고 한국어 이름 표가 없었다). 첫 길로 내세운 「오른쪽 단추 → 열기」는
// macOS 15 부터 서명 안 된 앱에 통하지 않는다. 이제 build.py 가 ko.lproj 이름 표를 넣어 Finder 에 「안무 편집기」가 보이고,
// 두 문서는 시스템 설정의 「그래도 열기」를 첫 길로 둔다. 이 시험은 문서 글자와 app.json · build.py 를 대조한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = JSON.parse(readFileSync(join(ROOT, 'packaging', 'app.json'), 'utf8'));
const TUTORIAL = readFileSync(join(ROOT, 'docs', 'TUTORIAL.md'), 'utf8');
const PACK_README = readFileSync(join(ROOT, 'packaging', 'README.md'), 'utf8');

// 머리 `heading` 부터 같은 깊이 이상의 다음 머리 앞까지.
function section(md, heading) {
  const start = md.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `${heading} 절이 없다`);
  const depth = heading.match(/^#+/)[0].length;
  const rest = md.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${depth}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

function macLine() {
  const line = section(TUTORIAL, '### 설치형 앱으로 켠다').split('\n').find((l) => l.startsWith('- **맥**'));
  assert.ok(line, '「설치형 앱으로 켠다」에 맥 줄이 없다');
  return line;
}

// 「앞」이 「뒤」보다 먼저 나온다 — 「뒤」가 아예 없으면 그것도 맞다.
function assertBefore(text, first, then, where) {
  const a = text.indexOf(first);
  assert.ok(a >= 0, `${where}에 ${first} 가 없다`);
  const b = text.indexOf(then);
  assert.ok(b < 0 || a < b, `${where}에서 ${then} 가 ${first} 보다 먼저 나온다`);
}

test('[RM-67 요구 0] 튜토리얼이 끌라고 한 맥 앱 이름이 Finder 에 보일 이름과 같다', () => {
  const m = macLine().match(/`([^`]+)`\s*를[^`.]*「Applications」/);
  assert.ok(m, '맥 줄에서 Applications 로 끌어 넣을 앱 이름을 못 찾았다');
  // Finder 는 묶음에 한국어 이름 표(ko.lproj)가 있어야 displayName 을 보인다 — 없으면 묶음 이름(name)이다.
  const localized = /^def localize_mac_name\(/m.test(readFileSync(join(ROOT, 'packaging', 'build.py'), 'utf8'));
  assert.equal(m[1], localized ? APP.displayName : APP.name);
});

test('[RM-67 요구 1] 맥 첫 실행의 첫 길은 「그래도 열기」다', () => {
  const line = macLine();
  assertBefore(line, '「개인정보 보호 및 보안」', '오른쪽 단추', '튜토리얼 맥 줄');
  assertBefore(line, '「그래도 열기」', '오른쪽 단추', '튜토리얼 맥 줄');
  // 설정의 단추 → 다시 뜨는 확인 창의 단추와 암호까지 적는다.
  assert.ok(line.split('「그래도 열기」').length - 1 >= 2, '확인 창의 「그래도 열기」까지 적지 않았다');
  assert.match(line, /암호/);
});

test('[RM-67 요구 2] 오른쪽 단추 열기는 첫 길이 아니고 옛 macOS 로 한정된다', () => {
  const sentences = macLine().split(/(?<=[.)])\s+/).filter((s) => s.includes('오른쪽 단추'));
  for (const s of sentences) assert.match(s, /macOS 14|Sonoma/, `옛 판 한정 없이 오른쪽 단추 길을 적었다: ${s}`);
});

test('[RM-67 요구 3] 포장 README 의 경고 넘기기도 「그래도 열기」가 먼저다', () => {
  const sign = section(PACK_README, '## 서명');
  assertBefore(sign, '「그래도 열기」', '오른쪽 단추', '포장 README 「서명」 절');
  const sentences = sign.split(/(?<=[.)])\s+/).filter((s) => s.includes('오른쪽 단추'));
  for (const s of sentences) assert.match(s, /macOS 14|Sonoma/, `옛 판 한정 없이 오른쪽 단추 길을 적었다: ${s}`);
});

test('[RM-67 요구 4] build.py 가 ko.lproj 이름 표를 쓴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'choreo-lproj-'));
  try {
    const app = join(dir, `${APP.name}.app`);
    // 빈 .app 을 PyInstaller 가 내는 꼴(XML Info.plist)로 지어 build.py 의 함수를 부른다.
    const py = [
      'import plistlib, sys',
      'from pathlib import Path',
      `sys.path.insert(0, ${JSON.stringify(join(ROOT, 'packaging'))})`,
      'import build',
      'app = Path(sys.argv[1])',
      "(app / 'Contents').mkdir(parents=True)",
      "(app / 'Contents' / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleName': 'SwingChoreo'}))",
      'build.localize_mac_name(app)'
    ].join('\n');
    const r = spawnSync('python3', ['-c', py, app], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const strings = join(app, 'Contents', 'Resources', 'ko.lproj', 'InfoPlist.strings');
    assert.ok(existsSync(strings), 'ko.lproj/InfoPlist.strings 가 생기지 않았다');
    const body = readFileSync(strings, 'utf8');
    assert.ok(body.includes(`"CFBundleDisplayName" = "${APP.displayName}";`), body);
    const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
    assert.match(plist, /<key>LSHasLocalizedDisplayName<\/key>\s*<true\/>/);
    assert.match(plist, /<key>CFBundleName<\/key>\s*<string>SwingChoreo<\/string>/, '있던 키를 잃었다');
    // Info.plist 의 보이는 이름이 파일 이름(SwingChoreo.app)과 다르면 macOS 는 「사람이 이름을 바꿨다」고 보고 이름 표를
    // 쓰지 않는다 — Finder 가 SwingChoreo 를 보였다(2026-11-03 이 맥에서 지어 쟀다). 그래서 Info.plist 쪽은 파일 이름이다.
    assert.match(plist, new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${APP.name}</string>`),
      'Info.plist 의 CFBundleDisplayName 이 파일 이름과 달라 Finder 가 이름 표를 무시한다');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
