// tests/unit/checkArch.test.mjs — 계층 검사기(tools/check-arch.mjs)의 「포장 폴더를 모른다」 규칙 자기 시험
//
// 검사기의 가장 나쁜 고장은 조용히 아무것도 안 잡는 것이다. 일부러 packaging/ 를 가리킨 조각이 붉어지는지,
// 지키는 자리 밖(packaging/ 자신 · 문서)은 걸리지 않는지, 그리고 지금 저장소가 통과하는지를 본다(RM-28 요구 7).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagingRefs, PACKAGING_GUARDED } from '../../tools/check-arch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('계층 검사: src/ 와 server.py 가 packaging/ 를 가리키면 붉어진다', () => {
  assert.equal(packagingRefs('src/app/main.js', "import { x } from '../../packaging/launcher.js';").length, 1);
  assert.equal(packagingRefs('server.py', "LAUNCHER = REPO_DIR / 'packaging/launcher.py'").length, 1);
  assert.equal(packagingRefs('server.py', 'ICON = "packaging\\\\icon.ico"').length, 1, '윈도우 구분자도 잡는다');
  assert.equal(packagingRefs('src/ui/x.js', '// 아이콘은 packaging/ 에서 만든다').length, 1, '주석으로 가리키는 것도 막는다');
  const hit = packagingRefs('src/ui/x.js', 'a\nb\nconst p = "packaging/x";')[0];
  assert.match(hit, /^src\/ui\/x\.js:3: /, '줄 번호를 알린다');
});

test('계층 검사: 포장 폴더 자신 · 문서 · 비슷한 낱말은 걸리지 않는다', () => {
  assert.equal(PACKAGING_GUARDED('packaging/launcher.py'), false);
  assert.equal(PACKAGING_GUARDED('docs/DECISIONS.md'), false);
  assert.deepEqual(packagingRefs('packaging/build.py', "STATIC = ROOT / 'src'  # packaging/ 는 앱을 안다"), []);
  assert.deepEqual(packagingRefs('src/ui/x.js', 'const repackaging = 1; // 포장된 앱(is_packaged)'), []);
  assert.deepEqual(packagingRefs('server.py', 'def is_packaged():'), [], '포장된 채 도는지 아는 것은 된다');
});

test('계층 검사: 지금 저장소는 포장 규칙까지 통과한다', () => {
  const res = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-arch.mjs')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /\+ server\.py, 위반 0건/);
});
