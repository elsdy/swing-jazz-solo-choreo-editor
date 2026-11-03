#!/usr/bin/env python3
"""설치형 앱을 만든다(2026-11-03, RM-28) — 맥 .app/.dmg, 윈도우 설치 파일(Inno Setup) 또는 zip.

「빌드 도구 · 의존성 없음」은 **저장소의 앱 코드(src/)와 server.py** 의 규칙이다(docs/DECISIONS.md, 2026-11-03).
포장 단계만 도구를 쓴다 — PyInstaller(파이썬 얼리기)와, 윈도우에서 있으면 Inno Setup(iscc). 앱을 쓰는 사람의
기계에는 아무것도 깔리지 않는다. 도구는 이 저장소에 붙지 않게 따로 만든 venv 에 깐다:

    python3 -m venv ~/.venvs/choreo-pack && ~/.venvs/choreo-pack/bin/pip install pyinstaller
    ~/.venvs/choreo-pack/bin/python packaging/build.py --ffmpeg <LGPL 빌드 ffmpeg>

    --ffmpeg PATH     함께 실을 ffmpeg. **LGPL 빌드**만 받는다(결정: 앱의 라이선스를 묶지 않는다) — 없으면 자르기가
                      꺼진 채로 만든다. 다른 라이브러리에 링크된(동적) 빌드도 거절한다 — 다른 기계에서 돌지 않는다
    --allow-gpl       GPL 빌드를 알고 싣는다(시험용 · 배포 금지)
    --out DIR         나갈 자리(기본: packaging/dist)

만드는 것은 각 OS 에서 그 OS 의 것만이다(PyInstaller 는 교차 빌드를 하지 않는다). 손 점검표는 packaging/README.md.
"""

import argparse
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP = json.loads((HERE / 'app.json').read_text(encoding='utf-8'))
BUILD = HERE / 'build'

# 앱 묶음에 싣는 앱 파일. 문서는 앱 안의 「문서」 창이 읽으므로 등록부(src/ui/docsRegistry.js)의 것을 모두 싣는다 —
# 손으로 목록을 따로 두면 문서가 늘 때 묶음에서 빠진다.
APP_FILES = ['index.html', 'admin.html', 'LICENSE', 'src', 'examples']


# @complexity time=O(n) space=O(n) cc=1
def registry_docs():
    text = (ROOT / 'src' / 'ui' / 'docsRegistry.js').read_text(encoding='utf-8')
    return re.findall(r"path:\s*'([^']+)'", text)


# @complexity time=O(n) space=O(n) cc=4
def stage_app(dest):
    """앱 파일을 dest 에 펼친다. 돌려주는 값은 실은 파일 수."""
    if dest.exists():
        shutil.rmtree(dest)
    for rel in APP_FILES + registry_docs():
        src = ROOT / rel
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, target, ignore=shutil.ignore_patterns('.DS_Store', '__pycache__'))
        else:
            shutil.copy2(src, target)
    return sum(1 for p in dest.rglob('*') if p.is_file())


# @complexity time=O(1) space=O(1) cc=9
def check_ffmpeg(path, allow_gpl):
    """실을 ffmpeg 를 잰다. (괜찮은가, 까닭)."""
    sys.path.insert(0, str(ROOT))
    import server                                  # 포장 → 서버 방향은 된다(그 반대가 막힌다)
    exe = server.find_ffmpeg(str(path))
    if not exe:
        return False, f'{path} 는 실행할 수 있는 파일이 아니다'
    version = subprocess.run([exe, '-hide_banner', '-version'], capture_output=True, text=True).stdout
    if '--enable-gpl' in version and not allow_gpl:
        return False, 'GPL 빌드다(--enable-gpl) — LGPL 빌드를 주거나, 배포하지 않을 시험판이면 --allow-gpl'
    if '--enable-nonfree' in version:
        return False, 'nonfree 빌드는 재배포할 수 없다'
    if server.video_encoder_args(server.ffmpeg_encoders(exe)) is None:
        return False, 'H.264 인코더(libx264 · VideoToolbox · Media Foundation · openh264)가 없다 — 자르기가 돌지 않는다'
    if sys.platform == 'darwin':
        links = subprocess.run(['otool', '-L', exe], capture_output=True, text=True).stdout
        foreign = [l.split()[0] for l in links.splitlines()[1:] if l.strip() and not l.strip().startswith(('/usr/lib/', '/System/'))]
        if foreign:
            return False, f'다른 라이브러리에 링크된 빌드다({foreign[0]} …) — 다른 맥에서 돌지 않는다. 정적 빌드를 주라'
    return True, ''


# @complexity time=O(1) space=O(1) cc=2
def make_icon():
    out = BUILD / 'icon'
    subprocess.run([sys.executable, str(HERE / 'make_icon.py'), str(out)], check=True)
    if sys.platform == 'darwin':
        subprocess.run(['iconutil', '-c', 'icns', str(out / 'choreo.iconset'), '-o', str(out / 'choreo.icns')], check=True)
        return out / 'choreo.icns'
    return out / 'choreo.ico'


# @complexity time=O(1) space=O(1) cc=3
def run_pyinstaller(stage, icon, ffmpeg, out):
    sep = os.pathsep                                # --add-data 의 구분자: 윈도우 ; · 그 밖 :
    cmd = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--windowed', '--onedir',
           '--name', APP['name'], '--icon', str(icon),
           '--paths', str(ROOT),                    # launcher 가 import 하는 server.py
           '--add-data', f'{stage}{sep}app',
           '--distpath', str(out), '--workpath', str(BUILD / 'work'), '--specpath', str(BUILD)]
    if sys.platform == 'darwin':
        cmd += ['--osx-bundle-identifier', APP['bundleId']]
    if ffmpeg:
        cmd += ['--add-binary', f'{ffmpeg}{sep}bin']
    cmd.append(str(HERE / 'launcher.py'))
    subprocess.run(cmd, check=True)


# @complexity time=O(1) space=O(1) cc=1
def localize_mac_name(app):
    """맥 묶음에 한국어 이름 표(ko.lproj)를 넣어 Finder 에 displayName 이 보이게 한다(RM-67).

    Info.plist 의 CFBundleDisplayName 만으로는 Finder 가 묶음 이름(SwingChoreo)을 보인다 — LSHasLocalizedDisplayName 을
    켜고 언어별 InfoPlist.strings 가 있어야 그 언어의 이름을 쓴다.
    ⚠ Info.plist 쪽 CFBundleDisplayName 은 **파일 이름(name)** 이어야 한다 — 「안무 편집기」로 두면 파일 이름과 달라 macOS 가
      「사람이 이름을 바꿨다」고 보고 이름 표를 버린다(2026-11-03 지어 쟀다: Finder 가 SwingChoreo 를 보였다).
    """
    lproj = app / 'Contents' / 'Resources' / 'ko.lproj'
    lproj.mkdir(parents=True, exist_ok=True)
    name = APP['displayName'].replace('\\', '\\\\').replace('"', '\\"')
    (lproj / 'InfoPlist.strings').write_text(
        f'"CFBundleDisplayName" = "{name}";\n"CFBundleName" = "{name}";\n', encoding='utf-8')
    plist = app / 'Contents' / 'Info.plist'
    with plist.open('rb') as f:
        info = plistlib.load(f)
    info['CFBundleDisplayName'] = APP['name']
    info['LSHasLocalizedDisplayName'] = True
    plist.write_bytes(plistlib.dumps(info))


# @complexity time=O(1) space=O(1) cc=3
def finish_mac(out):
    """.app 의 보이는 이름 · 판 번호를 채우고 .dmg 로 싼다(서명 없음 — 결정: 첫 판은 경고 넘기는 법을 안내)."""
    app = out / f'{APP["name"]}.app'
    plist = app / 'Contents' / 'Info.plist'
    for key, value in (('CFBundleShortVersionString', APP['version']),
                       ('CFBundleVersion', APP['version']), ('NSHumanReadableCopyright', APP['copyright'])):
        subprocess.run(['plutil', '-replace', key, '-string', value, str(plist)], check=True)
    localize_mac_name(app)
    # ⚠ PyInstaller 가 붙인 임시 서명(ad-hoc)은 Info.plist · 이름 표(ko.lproj)까지 봉한다 — 고친 뒤 다시 봉하지 않으면 받은 사람의 맥이
    #   「확인되지 않은 개발자」가 아니라 「손상되었기 때문에 열 수 없습니다」로 막는다(넘기는 길이 없다). 개발자 서명은
    #   아니다(결정: 첫 판은 서명 없이) — 봉인만 맞춘다.
    subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    # ⚠ .dmg 의 재료는 저장소 **밖** 임시 자리에서 짓고 지운다 — `Applications → /Applications` 링크가 저장소 안에 남으면
    #   저장소를 훑는 검사(check-docs)가 맥의 앱 폴더 전체로 따라 들어가 순환 링크에서 죽는다(2026-11-03 실제로 그랬다).
    dmg = out / f'{APP["name"]}-{APP["version"]}-mac-{os.uname().machine}.dmg'
    with tempfile.TemporaryDirectory(prefix='choreo-dmg-') as tmp:
        dmg_src = Path(tmp)
        shutil.copytree(app, dmg_src / app.name, symlinks=True)
        (dmg_src / 'Applications').symlink_to('/Applications')
        if dmg.exists():
            dmg.unlink()
        subprocess.run(['hdiutil', 'create', '-volname', APP['displayName'], '-srcfolder', str(dmg_src),
                        '-format', 'UDZO', '-ov', str(dmg)], check=True)
    return dmg


# @complexity time=O(1) space=O(1) cc=2
def finish_windows(out):
    """Inno Setup(iscc)이 있으면 설치 파일을, 없으면 zip 을 만든다."""
    folder = out / APP['name']
    iscc = shutil.which('iscc') or shutil.which('ISCC')
    if iscc:
        subprocess.run([iscc, f'/DAppName={APP["name"]}', f'/DDisplayName={APP["displayName"]}',
                        f'/DAppVersion={APP["version"]}', f'/DPublisher={APP["publisher"]}',
                        f'/DSourceDir={folder}', f'/DOutDir={out}', f'/DIconFile={BUILD / "icon" / "choreo.ico"}',
                        str(HERE / 'windows' / 'choreo.iss')], check=True)
        return out / f'{APP["name"]}-{APP["version"]}-setup.exe'
    return Path(shutil.make_archive(str(out / f'{APP["name"]}-{APP["version"]}-win'), 'zip', out, APP['name']))


# @complexity time=O(n) space=O(n) cc=8
def main(argv=None):
    ap = argparse.ArgumentParser(description='안무 편집기 설치형 앱 만들기')
    ap.add_argument('--ffmpeg', default=None)
    ap.add_argument('--allow-gpl', action='store_true')
    ap.add_argument('--out', default=str(HERE / 'dist'))
    args = ap.parse_args(argv)

    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print('PyInstaller 가 없다 — 이 스크립트의 머리말대로 따로 만든 venv 에 깔고 그 파이썬으로 돌린다.', file=sys.stderr)
        return 2
    if args.ffmpeg:
        ok, why = check_ffmpeg(Path(args.ffmpeg), args.allow_gpl)
        if not ok:
            print(f'ffmpeg 를 싣지 않는다 — {why}', file=sys.stderr)
            return 2
    else:
        print('⚠ --ffmpeg 가 없다 — 자르기가 꺼진 앱이 된다(나머지는 모두 된다).')

    out = Path(args.out).resolve()
    stage = BUILD / 'stage'
    print(f'앱 파일 {stage_app(stage)}개를 펼쳤다')
    icon = make_icon()
    run_pyinstaller(stage, icon, args.ffmpeg and Path(args.ffmpeg).resolve(), out)
    if sys.platform == 'darwin':
        result = finish_mac(out)
    elif os.name == 'nt':
        result = finish_windows(out)
    else:
        result = out / APP['name']
    print(f'만들었다: {result}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
