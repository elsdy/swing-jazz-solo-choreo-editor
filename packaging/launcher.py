#!/usr/bin/env python3
"""설치형 앱의 런처(2026-11-03, RM-28) — 두 번 눌러 켜면 이것이 돈다.

하는 일은 셋뿐이다.
  1. 앱 묶음 안의 앱 파일 · ffmpeg 자리를 찾아 server.main 에 넘긴다(--static · --ffmpeg).
     포트는 0 — 지난번 포트를 먼저 써서 브라우저 출처(localStorage · IndexedDB)가 켤 때마다 바뀌지 않는다.
     주소는 루프백(127.0.0.1)뿐이다 — 서버에는 인증이 없으니 폰 접속은 이 앱이 열지 않는다.
  2. 기본 브라우저로 안무표 화면을 연다(--open).
  3. 「켜져 있음」 창을 띄운다 — [브라우저로 열기] 는 탭을 다시 열고 [끄기] 는 서버를 끈다. 브라우저 탭을 닫아도
     서버가 남아 「껐다」는 감각이 흐린 것을 이 창이 메운다(결정: 작은 런처 + 기본 브라우저).
     창은 OS 에 이미 있는 것(macOS osascript · 윈도우 PowerShell)으로 띄운다 — GUI 패키지를 싣지 않는다.

서버(server.py)와 앱(src/)은 이 파일을 모른다. 화살표는 런처 → 서버 한쪽이다(tools/check-arch.mjs 가 잰다).
얼린 실행(PyInstaller)이 아니어도 돈다 — `python3 packaging/launcher.py` 로 포장 없이 같은 길을 시험한다.
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
TITLE = '안무 편집기'


# @complexity time=O(1) space=O(1) cc=2
def bundle_dir():
    """앱 묶음 안의 자원 자리. 얼린 실행이면 압축 해제 자리(sys._MEIPASS), 아니면 저장소."""
    meipass = getattr(sys, '_MEIPASS', None)
    return Path(meipass) if meipass else HERE.parent


# @complexity time=O(1) space=O(1) cc=3
def static_dir(base):
    """앱 파일(index.html · src/) 자리. 묶음에는 app/ 아래에 실린다. 포장 없이 돌면 저장소 그대로다."""
    packed = base / 'app'
    return packed if (packed / 'index.html').is_file() else base


# @complexity time=O(1) space=O(1) cc=2
def bundled_ffmpeg(base):
    """묶음에 실은 ffmpeg(LGPL 빌드). 없으면 None — 서버가 CHOREO_FFMPEG · PATH 를 본다."""
    exe = base / 'bin' / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
    return exe if exe.is_file() else None


# @complexity time=O(1) space=O(1) cc=2
def server_argv(base):
    argv = ['--host', '127.0.0.1', '--port', '0', '--open', '--quiet', '--static', str(static_dir(base))]
    ffmpeg = bundled_ffmpeg(base)
    if ffmpeg:
        argv += ['--ffmpeg', str(ffmpeg)]
    return argv


# ── 「켜져 있음」 창 ────────────────────────────────────────────────────────

# @complexity time=O(1) space=O(1) cc=1
def _as_quote(text):
    return str(text).replace('\\', '\\\\').replace('"', '\\"')


# @complexity time=O(1) space=O(1) cc=5
def ask_running(url):
    """「켜져 있음」 창을 띄워 사람의 답을 돌려준다 — 'open' · 'quit' · None(창을 띄울 수 없다)."""
    msg = f'{TITLE}가 켜져 있습니다.\n{url}\n\n브라우저 탭을 닫아도 계속 켜져 있습니다. 다 쓰면 「끄기」를 누르세요.'
    if sys.platform == 'darwin':
        # `tell me to activate` — 앞에 세우지 않으면 창이 방금 연 브라우저 뒤에 숨어 「끄기」를 찾을 수 없다.
        script = ('tell me to activate\n'
                  f'display dialog "{_as_quote(msg)}" with title "{TITLE}" '
                  'buttons {"끄기", "브라우저로 열기"} default button "브라우저로 열기"')
        res = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
        return 'open' if '브라우저로 열기' in res.stdout else 'quit'
    if os.name == 'nt':
        text = msg.replace("'", "''") + '\n\n[예] 브라우저로 열기    [아니요] 끄기'
        ps = ("Add-Type -AssemblyName System.Windows.Forms;"
              f"[System.Windows.Forms.MessageBox]::Show('{text}', '{TITLE}', 'YesNo', 'Information')")
        res = subprocess.run(['powershell', '-NoProfile', '-STA', '-Command', ps], capture_output=True, text=True,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return 'open' if res.stdout.strip() == 'Yes' else 'quit'
    return None


# @complexity time=O(1) space=O(1) cc=3
def show_error(text):
    """켜지 못한 까닭을 창으로 알린다. 창을 못 띄우면 stderr 에."""
    print(text, file=sys.__stderr__ or sys.stderr)
    if sys.platform == 'darwin':
        subprocess.run(['osascript', '-e', f'display alert "{TITLE}를 켜지 못했습니다" message "{_as_quote(text)}" as critical'])
    elif os.name == 'nt':
        ps = ("Add-Type -AssemblyName System.Windows.Forms;"
              f"[System.Windows.Forms.MessageBox]::Show('{text.replace(chr(39), chr(39) * 2)}', '{TITLE}', 'OK', 'Error')")
        subprocess.run(['powershell', '-NoProfile', '-STA', '-Command', ps],
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


# ── 실행 ────────────────────────────────────────────────────────────────────

# @complexity time=O(1) space=O(1) cc=4
def running_instance(server):
    """이미 켜 둔 안무 편집기의 주소. 없으면 None.

    두 번째로 눌러 켜면 서버를 하나 더 세우지 않고 그 창을 다시 연다 — 둘째 서버는 다른 포트(다른 브라우저 출처)라
    최근 목록 · 초안이 비어 보이고, 같은 안무표를 두 서버가 나눠 쓰게 된다."""
    port = server.remembered_port(server.default_config_file())
    if not port:
        return None
    url = f'http://127.0.0.1:{port}/'
    try:
        with urllib.request.urlopen(url + 'api/health', timeout=1) as res:
            return url if json.load(res).get('mode') == 'server' else None
    except (OSError, ValueError):
        return None


# @complexity time=O(1) space=O(1) cc=2
def open_log(server):
    """창 없는 앱(얼린 실행)에는 stdout · stderr 가 없다(None). 설정 폴더의 app.log 로 돌린다 — 켜지 못한 까닭을
    창에 보이려고 읽고, 사람이 문의할 때 건넬 기록이기도 하다."""
    path = server.config_home() / 'app.log'
    path.parent.mkdir(parents=True, exist_ok=True)
    return path, open(path, 'w', encoding='utf-8', buffering=1)


# @complexity time=O(1) space=O(1) cc=9
def main():
    os.environ['CHOREO_PACKAGED'] = '1'          # 옛 자리(저장소 안) 판정을 끈다 — server.is_packaged()
    sys.path.insert(0, str(HERE.parent))         # 포장 없이 돌 때 server.py 를 찾는다(얼린 실행에는 이미 실려 있다)
    import server

    base = bundle_dir()
    already = running_instance(server)
    if already:
        webbrowser.open(already)
        return 0
    log_path, log = open_log(server)
    sys.stdout = sys.stderr = log

    ready = threading.Event()
    state = {}

    def on_ready(url, httpd):
        state.update(url=url, httpd=httpd)
        ready.set()

    def run():
        try:
            state['code'] = server.main(server_argv(base), on_ready=on_ready)
        except Exception as e:                    # 켜는 중의 뜻밖의 오류도 창으로 알린다
            print(f'{type(e).__name__}: {e}', flush=True)
            state['code'] = 1
        ready.set()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    ready.wait()
    if 'url' not in state:
        log.flush()
        reason = log_path.read_text(encoding='utf-8').strip().splitlines()
        show_error((reason[-1] if reason else '까닭을 알 수 없습니다.') + f'\n\n기록: {log_path}')
        return state.get('code') or 1

    time.sleep(1.5)                               # 브라우저가 먼저 뜬 뒤에 창을 그 위에 세운다
    while True:
        answer = ask_running(state['url'])
        if answer == 'open':
            webbrowser.open(state['url'])
            continue
        if answer is None:                        # 창을 못 띄우는 OS — 서버가 끝날 때까지 기다린다(Ctrl+C)
            thread.join()
        break
    state['httpd'].shutdown()
    thread.join(timeout=5)
    return 0


if __name__ == '__main__':
    sys.exit(main())
