#!/usr/bin/env python3
"""안무 편집기의 로컬 서버 — 정적 파일 + 영상 클립 보관 API. 표준 라이브러리만 쓴다.

    python3 server.py                      # http://127.0.0.1:8000, 클립은 ./video-clip 아래
    python3 server.py --port 8080
    python3 server.py --root ~/Movies      # 클립 보관 루트를 바꾼다(하위 폴더 video-clip 는 그대로)
    python3 server.py --subdir clips       # 하위 폴더 이름을 바꾼다

`python3 -m http.server 8000` 이 하던 일(저장소를 정적으로 내주기)을 그대로 하고, 그 위에 다음을 얹는다.

    GET  /api/health                      서버가 있는지. {ok, mode:'server', root, subdir, dir}
    GET  /api/config                      {root, subdir, dir}
    PUT  /api/config  {root?, subdir?}    보관 루트·하위 폴더 변경. 없는 폴더는 만든다. .clipserver.json 에 남는다
    PUT  /api/clips?project=P&name=N      본문 = 파일 바이트. <root>/<subdir>/<P>/<N> 으로 저장(겹치면 " (2)").
                                          → {path:'<subdir>/<P>/<N>', url:'/clips/<path>', size}
    GET  /api/clips?project=P             그 프로젝트의 클립 목록 [{path, name, size, mtime}]
    HEAD /api/clips/<path>                있는지(200/404)
    GET  /clips/<path>                    파일. Range 를 지원한다(<video> 탐색에 필수)
    POST /api/clips/trim {path, inSec, outSec}   보관된 클립을 [inSec, outSec) 로 잘라 **다시 인코딩**해 같은 폴더에
                                          '<이름> [0m12.3s-0m45.0s].mp4' 로 둔다(원본은 그대로). ffmpeg 이 있어야 한다
                                          (health 의 ffmpeg 필드). → {path, name, url, size, durationSec}

    GET  /api/models                      자세 분석 모델의 보관 위치와 파일별 있음/없음. {dir, poseModel, ready, files[]}
    PUT  /api/models/config {dir?, poseModel?}  보관 위치·모델 크기 변경. 없는 폴더는 만든다. .clipserver.json 에 남는다
    POST /api/models/fetch  {key}         그 파일 하나를 인터넷에서 받아 보관 위치에 둔다(이미 있으면 그대로). → {ok, key, bytes}
    POST /api/models/choose               **네이티브 폴더 고르기 대화상자**를 띄우고, 고른 폴더를 곧바로 보관 위치로 삼는다.
                                          취소하면 {ok:false, canceled:true}. 띄울 수 없는 환경이면 503
    GET  /models/<path>                   받아 둔 모델 파일. 브라우저의 자세 추정기가 여기서 읽는다

    GET  /api/llm/config                  {provider, model, baseUrl, hasKey, available}. 키 값은 절대 돌려주지 않는다
    GET  /api/llm/models                  지금 제공자가 가진 모델 이름 목록(openai 호환 /v1/models, ollama /api/tags)
    PUT  /api/llm/config  {provider?, model?, baseUrl?, apiKey?}   설정 변경. apiKey 는 .clipserver.json 에만 남는다
    POST /api/llm/refine  {text, context}  말하거나 대충 적은 텍스트 → 다듬은 안무 설명(평문)
    POST /api/llm/compose {prompt, context} 다듬은 설명 → 안무표 스키마(JSON). 서버가 스키마로 검증한다

    LLM 제공자: anthropic(Claude, 기본 claude-opus-5) · openai(OpenAI, 기본 gpt-5) · ollama(로컬 — Ollama 든 LM Studio·llama.cpp 같은
    OpenAI 호환이든, 주소만 맞으면 서버가 API 종류를 스스로 알아낸다. 설정의 모델 이름이 그 서버에 없으면 로드된 모델을 쓴다.
    토큰을 요구하는 서버(LM Studio)면 apiKey 를 Bearer 로 붙인다). openai 제공자에 로컬 주소를 줘도 같은 경로다.
    키는 설정 파일의 apiKey 또는 환경 변수 ANTHROPIC_API_KEY / OPENAI_API_KEY 에서 읽는다. 브라우저에는 키가 가지 않는다.

설계 메모
- 의존성이 0이다. FastAPI 를 쓰면 pip 환경이 생기고, 그것이 로드맵이 서버를 미룬 이유였다.
- 127.0.0.1 에만 묶는다. 개인 도구이고 인증이 없다. --host 0.0.0.0 은 스스로 정할 때만 쓴다.
- 경로 규칙은 src/domain/clips.js 와 같다: 못 쓰는 글자는 _, 앞의 점은 제거, 빈 조각은 대체 이름.
  프로젝트 파일에 저장되는 path(`<subdir>/<프로젝트>/<파일>`)가 브라우저 폴더 방식과 같은 모양이라
  두 방식 사이에서 파일을 열어도 경로가 그대로 통한다.
- 저장 루트 밖으로는 절대 나가지 않는다(resolve 뒤 prefix 검사). 업로드 크기 상한은 없다 — 로컬 도구다.
- 자세 분석 모델도 **선택**이다. 받아 두지 않으면 분석만 안 되고 나머지는 전부 된다. 파일은 인터넷에서
  한 번 받아 `--models` 폴더(기본: 저장소의 models/)에 두고, 그 뒤로는 오프라인이다. 브라우저가 계산하므로
  서버에는 파이썬 패키지가 하나도 늘지 않는다 — 서버는 파일을 받아 두고 내주기만 한다.
- ffmpeg 은 **선택**이다. 없으면 자르기만 501 로 거절하고 나머지는 전부 된다. 찾는 순서는 --ffmpeg 인자 →
  환경 변수 CHOREO_FFMPEG → PATH 의 ffmpeg. 자르기는 복사(-c copy)가 아니라 재인코딩이다 — 키프레임에 맞추지
  않고 In/Out 시각 그대로 잘리고, 어떤 소스든 브라우저가 여는 H.264/AAC MP4 가 나온다.
"""

import argparse
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

REPO_DIR = Path(__file__).resolve().parent
CONFIG_FILE = REPO_DIR / '.clipserver.json'
DEFAULT_SUBDIR = 'video-clip'
UNFILED = '_미지정'
BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')

# ES 모듈은 text/javascript 여야 한다. 일부 파이썬 mimetypes 기본값이 .mjs 를 모른다.
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('application/wasm', '.wasm')


# ─────────────────────────────────────────────────────────────────────────────
# 경로 규칙 — domain/clips.js 와 같다
# ─────────────────────────────────────────────────────────────────────────────

def safe_segment(raw, fallback=UNFILED):
    s = BAD_CHARS.sub('_', str(raw or '')).strip().lstrip('.')
    return s or fallback


def project_dir_name(name):
    base = re.sub(r'\.[^.]+$', '', str(name or ''))
    return safe_segment(base, UNFILED)


def numbered_name(file_name, n):
    m = re.match(r'^(.*?)(\.[^.]*)?$', file_name)
    stem, ext = (m.group(1) or file_name, m.group(2) or '') if m else (file_name, '')
    return f'{stem} ({n}){ext}'


def split_clip_path(path):
    """저장된 상대 경로 → 조각. 빈 조각·'.'·'..' 은 버린다(루트 밖으로 나가지 않는다)."""
    return [p.strip() for p in str(path or '').split('/') if p.strip() and p.strip() not in ('.', '..')]


def clock_tag(sec):
    """초 → 파일 이름에 쓸 수 있는 시각 표기. 12.34 → '0m12.3s'. 콜론은 파일 이름에 못 쓰므로 m/s 로 적는다."""
    sec = max(0.0, float(sec))
    m = int(sec // 60)
    return f'{m}m{sec - m * 60:04.1f}s'


def trimmed_name(file_name, in_sec, out_sec):
    """잘라 낸 클립의 이름. 'take.mov' + [12.3, 45.0) → 'take [0m12.3s-0m45.0s].mp4'. 재인코딩이라 확장자는 늘 .mp4 다."""
    stem = re.sub(r'\.[^.]*$', '', file_name) or file_name
    return f'{stem} [{clock_tag(in_sec)}-{clock_tag(out_sec)}].mp4'


# ─────────────────────────────────────────────────────────────────────────────
# ffmpeg — 선택 의존성. 없으면 자르기만 501 이다
# ─────────────────────────────────────────────────────────────────────────────

def find_ffmpeg(explicit=None):
    """쓸 ffmpeg 실행 파일 경로. --ffmpeg 가 있으면 **그것만** 본다(틀리면 None — PATH 로 슬쩍 떨어지지 않는다).
    없으면 CHOREO_FFMPEG → PATH 의 ffmpeg. 실행 파일이 아니면 None."""
    def resolve(cand):
        if os.path.sep in cand:
            return cand if os.access(cand, os.X_OK) and os.path.isfile(cand) else None
        return shutil.which(cand)
    if explicit:
        return resolve(explicit)
    for cand in (os.environ.get('CHOREO_FFMPEG'), 'ffmpeg'):
        if cand:
            found = resolve(cand)
            if found:
                return found
    return None


def run_trim(ffmpeg, src, dst, in_sec, out_sec, timeout=3600):
    """src 의 [in_sec, out_sec) 를 다시 인코딩해 dst 로. 성공이면 (True, ''), 실패면 (False, stderr 끝부분).

    -ss 를 -i 앞에 두면 입력을 그 시각으로 탐색한 뒤 디코드하므로 재인코딩에서는 프레임 단위로 정확하다.
    libx264 veryfast/crf 20 + aac 160k + faststart 는 "브라우저가 바로 여는 MP4" 의 무난한 조합이다.
    소리가 없는 영상도 되게 -c:a 만 두고 오디오 스트림 존재를 전제하지 않는다."""
    cmd = [
        ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', f'{in_sec:.3f}', '-i', str(src), '-t', f'{out_sec - in_sec:.3f}',
        '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
        str(dst),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)
    if res.returncode != 0:
        return False, (res.stderr or '').strip()[-600:] or f'ffmpeg exit {res.returncode}'
    return True, ''


# ─────────────────────────────────────────────────────────────────────────────
# 자세 분석 모델 — 받아 두고 내주기만 한다. 계산은 브라우저가 한다
#
# ⚠ 버전을 못 박는다. `@latest` 로 두면 어느 날 구글이 올린 새 모델 때문에 각도가 몇 도씩 달라지고,
#   어제 잰 가동 범위와 오늘 잰 값을 나란히 놓을 수 없게 된다. 올릴 때는 사람이 올린다.
# ⚠ nosimd 는 선택이다. 요즘 브라우저는 전부 SIMD 를 쓰므로 받지 않아도 되고, 10MB 를 아낀다.
#   FilesetResolver 가 SIMD 를 먼저 보고 고르므로 있으면 쓰고 없으면 안 찾는다.
# ─────────────────────────────────────────────────────────────────────────────

MEDIAPIPE_VERSION = '1.0.1'
_MP = f'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{MEDIAPIPE_VERSION}'
_POSE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker'

POSE_MODELS = ('lite', 'full', 'heavy')
DEFAULT_POSE_MODEL = 'full'

# 받기 전에도 "얼마나 받아야 하는지" 를 화면이 말할 수 있게, 2026-09-11 에 실제로 잰 크기를 적어 둔다.
# 표시용이라 조금 틀려도 되고, 받은 뒤에는 실제 크기(bytes)가 이 자리를 대신한다.
POSE_MODEL_BYTES = {'lite': 5777746, 'full': 9398198, 'heavy': 30664242}

MODEL_FILES = (
    {'key': 'bundle', 'name': 'vision_bundle.mjs', 'url': f'{_MP}/vision_bundle.mjs',
     'label': 'MediaPipe 실행 코드', 'group': 'runtime', 'optional': False, 'approx': 155439},
    {'key': 'wasm-js', 'name': 'wasm/vision_wasm_internal.js', 'url': f'{_MP}/wasm/vision_wasm_internal.js',
     'label': 'WASM 로더', 'group': 'runtime', 'optional': False, 'approx': 323377},
    {'key': 'wasm', 'name': 'wasm/vision_wasm_internal.wasm', 'url': f'{_MP}/wasm/vision_wasm_internal.wasm',
     'label': 'WASM 런타임', 'group': 'runtime', 'optional': False, 'approx': 11756954},
    {'key': 'wasm-nosimd-js', 'name': 'wasm/vision_wasm_nosimd_internal.js', 'url': f'{_MP}/wasm/vision_wasm_nosimd_internal.js',
     'label': 'WASM 로더(SIMD 없는 브라우저용)', 'group': 'runtime', 'optional': True, 'approx': 323180},
    {'key': 'wasm-nosimd', 'name': 'wasm/vision_wasm_nosimd_internal.wasm', 'url': f'{_MP}/wasm/vision_wasm_nosimd_internal.wasm',
     'label': 'WASM 런타임(SIMD 없는 브라우저용)', 'group': 'runtime', 'optional': True, 'approx': 10960242},
) + tuple(
    {'key': f'pose-{size}', 'name': f'pose_landmarker_{size}.task',
     'url': f'{_POSE}/pose_landmarker_{size}/float16/1/pose_landmarker_{size}.task',
     'label': f'자세 모델({size})', 'group': 'model', 'optional': True, 'size': size,
     'approx': POSE_MODEL_BYTES[size]}
    for size in POSE_MODELS
)

MODEL_BY_KEY = {m['key']: m for m in MODEL_FILES}

# ⚠ 대화상자는 **사용자 화면**에 뜬다. 서버가 127.0.0.1 에만 묶여 있으므로 이 컴퓨터의 사람만 부를 수 있고,
#   고르는 것도 그 사람이다. 다만 두 개를 겹쳐 띄우면 어느 것이 답인지 알 수 없으므로 하나만 돈다.
_chooser_lock = threading.Lock()

# 대화상자를 열어 둔 채 자리를 비울 수 있다. 그래도 영원히 매달리지는 않는다.
CHOOSER_TIMEOUT = 300


def folder_chooser():
    """이 운영체제에서 폴더 고르기 대화상자를 띄울 수 있는 명령. 없으면 None(그때는 경로를 직접 넣는다)."""
    if sys.platform == 'darwin' and shutil.which('osascript'):
        return 'osascript'
    for cmd in ('zenity', 'kdialog'):
        if shutil.which(cmd):
            return cmd
    if os.name == 'nt' and shutil.which('powershell'):
        return 'powershell'
    return None


def _as_quote(text):
    """AppleScript 문자열 안에 넣을 수 있게 감싼다. 따옴표가 든 경로에서 스크립트가 깨지지 않게."""
    return str(text).replace('\\', '\\\\').replace('"', '\\"')


def chooser_argv(kind, start):
    """대화상자를 띄우는 명령줄. start 는 처음 보여 줄 폴더다."""
    if kind == 'osascript':
        where = f' default location POSIX file "{_as_quote(start)}"' if start else ''
        return ['osascript', '-e', f'POSIX path of (choose folder with prompt "자세 분석 모델을 둘 폴더를 고르세요"{where})']
    if kind == 'zenity':
        args = ['zenity', '--file-selection', '--directory', '--title=자세 분석 모델을 둘 폴더']
        if start:
            args.append(f'--filename={start}/')
        return args
    if kind == 'kdialog':
        return ['kdialog', '--getexistingdirectory', start or str(Path.home())]
    if kind == 'powershell':
        script = ('Add-Type -AssemblyName System.Windows.Forms;'
                  '$d = New-Object System.Windows.Forms.FolderBrowserDialog;'
                  'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }')
        return ['powershell', '-NoProfile', '-STA', '-Command', script]
    return None


def choose_folder(start=None):
    """폴더 고르기 대화상자. (경로, 오류). 취소는 오류가 아니라 (None, '') 다."""
    kind = folder_chooser()
    if not kind:
        return None, '이 운영체제에서는 폴더 고르기 창을 띄울 수 없습니다. 경로를 직접 넣어 주세요.'
    if not _chooser_lock.acquire(blocking=False):
        return None, '폴더 고르기 창이 이미 열려 있습니다.'
    try:
        res = subprocess.run(chooser_argv(kind, start), capture_output=True, text=True, timeout=CHOOSER_TIMEOUT)
    except subprocess.TimeoutExpired:
        # 상한을 분으로만 적으면 짧게 잡았을 때 "0분" 이 된다.
        span = f'{CHOOSER_TIMEOUT // 60}분' if CHOOSER_TIMEOUT >= 60 else f'{CHOOSER_TIMEOUT}초'
        return None, f'폴더 고르기 창이 {span} 넘게 열려 있어 닫았습니다. 다시 눌러 주세요.'
    except OSError as e:
        return None, f'폴더 고르기 창을 띄우지 못했습니다: {e}'
    finally:
        _chooser_lock.release()
    if res.returncode != 0:
        return None, ''                       # 취소. 오류가 아니다
    path = (res.stdout or '').strip()
    return (path or None), ''


def models_suggestions():
    """추천 위치. 대화상자를 못 띄우는 환경에서도 한 번 눌러 고를 수 있게 한다."""
    home = Path.home()
    out = [
        {'label': '홈 캐시', 'dir': str(home / '.cache' / 'choreo-models'), 'note': '저장소를 다시 받아도 남습니다'},
        {'label': '저장소 안', 'dir': str(REPO_DIR / 'models'), 'note': '프로젝트와 함께 있고 커밋되지 않습니다'},
    ]
    if sys.platform == 'darwin':
        out.append({'label': '앱 지원 폴더',
                    'dir': str(home / 'Library' / 'Application Support' / 'choreo-editor' / 'models'),
                    'note': 'macOS 관례라 백업에 포함됩니다'})
    return out


def model_is_needed(entry, pose_model):
    """지금 설정에서 이 파일이 있어야 하는가. 런타임 필수 + 고른 크기의 자세 모델 하나."""
    if entry['group'] == 'runtime':
        return not entry['optional']
    return entry.get('size') == pose_model


# ─────────────────────────────────────────────────────────────────────────────
# 설정 — .clipserver.json
# ─────────────────────────────────────────────────────────────────────────────

LLM_DEFAULTS = {
    'anthropic': {'model': 'claude-opus-5', 'baseUrl': 'https://api.anthropic.com'},
    'openai': {'model': 'gpt-5', 'baseUrl': 'https://api.openai.com'},
    'ollama': {'model': 'llama3.1', 'baseUrl': 'http://127.0.0.1:11434'},
}
LLM_KEY_ENV = {'anthropic': 'ANTHROPIC_API_KEY', 'openai': 'OPENAI_API_KEY'}


def normalize_llm(raw):
    """설정 파일의 llm 블록을 채운 dict 로. 모르는 제공자는 anthropic 으로 떨어진다."""
    src = raw if isinstance(raw, dict) else {}
    provider = src.get('provider') if src.get('provider') in LLM_DEFAULTS else 'anthropic'
    d = LLM_DEFAULTS[provider]
    return {
        'provider': provider,
        'model': str(src.get('model') or d['model']),
        'baseUrl': str(src.get('baseUrl') or d['baseUrl']).rstrip('/'),
        'apiKey': str(src.get('apiKey') or ''),
    }


class Config:
    def __init__(self, root, subdir, path=CONFIG_FILE, llm=None, models_dir=None, pose_model=None):
        self.root = Path(root).expanduser().resolve()
        self.subdir = safe_segment(subdir, DEFAULT_SUBDIR)
        self.path = path
        self.llm = normalize_llm(llm)
        # ⚠ 모델 보관 위치는 영상 보관 루트와 **따로**다. 영상은 외장 디스크에 두고 모델은 저장소 옆에
        #   두는 것이 흔하고, 무엇보다 사용자가 "어디에 저장할지" 를 이 항목 하나로 정하기를 원한다.
        self.models_dir = Path(models_dir or (REPO_DIR / 'models')).expanduser().resolve()
        self.pose_model = pose_model if pose_model in POSE_MODELS else DEFAULT_POSE_MODEL

    @property
    def dir(self):
        return self.root / self.subdir

    def to_json(self):
        return {'root': str(self.root), 'subdir': self.subdir, 'dir': str(self.dir)}

    def models_json(self):
        """모델 보관 위치와 파일별 있음/없음. 브라우저가 이걸 보고 '받아 두세요' 를 띄운다."""
        files = []
        ready = True
        missing = 0
        missing_bytes = 0
        for entry in MODEL_FILES:
            target = self.models_dir / entry['name']
            present = target.is_file()
            needed = model_is_needed(entry, self.pose_model)
            files.append({
                'key': entry['key'], 'name': entry['name'], 'label': entry['label'],
                'group': entry['group'], 'needed': needed, 'optional': entry['optional'],
                'present': present, 'bytes': target.stat().st_size if present else 0,
                'approx': entry.get('approx', 0), 'url': '/models/' + entry['name'],
            })
            if needed and not present:
                ready = False
                missing += 1
                missing_bytes += entry.get('approx', 0)
        return {'dir': str(self.models_dir), 'poseModel': self.pose_model, 'ready': ready,
                'missing': missing, 'missingBytes': missing_bytes,
                'version': MEDIAPIPE_VERSION, 'sizes': POSE_MODEL_BYTES,
                'canChoose': folder_chooser() is not None, 'suggestions': models_suggestions(),
                'files': files}

    def llm_key(self):
        """설정 파일의 키가 있으면 그것, 없으면 환경 변수. 로컬(ollama)은 키가 필요 없다."""
        if self.llm['apiKey']:
            return self.llm['apiKey']
        env = LLM_KEY_ENV.get(self.llm['provider'])
        return os.environ.get(env, '') if env else ''

    def llm_is_local_openai(self):
        """openai 호환이지만 OpenAI 가 아닌 서버(LM Studio·llama.cpp·vLLM). 키가 없어도 시도한다."""
        return self.llm['provider'] == 'openai' and 'api.openai.com' not in self.llm['baseUrl']

    def llm_public(self):
        """브라우저에 보여도 되는 것만. 키 값은 절대 나가지 않는다."""
        has_key = bool(self.llm_key())
        return {
            'provider': self.llm['provider'], 'model': self.llm['model'], 'baseUrl': self.llm['baseUrl'],
            'hasKey': has_key, 'keyFromEnv': has_key and not self.llm['apiKey'],
            'available': self.llm['provider'] == 'ollama' or self.llm_is_local_openai() or has_key,
        }

    def save(self):
        try:
            self.path.write_text(json.dumps({
                'root': str(self.root), 'subdir': self.subdir, 'llm': self.llm,
                'modelsDir': str(self.models_dir), 'poseModel': self.pose_model,
            }, ensure_ascii=False, indent=2))
        except OSError:
            pass

    @staticmethod
    def load(default_root, default_subdir, path=CONFIG_FILE):
        root, subdir, llm = default_root, default_subdir, None
        models_dir, pose_model = None, None
        try:
            data = json.loads(Path(path).read_text())
            root = data.get('root') or root
            subdir = data.get('subdir') or subdir
            llm = data.get('llm')
            models_dir = data.get('modelsDir')
            pose_model = data.get('poseModel')
        except (OSError, ValueError):
            pass
        return Config(root, subdir, path, llm, models_dir, pose_model)


# ─────────────────────────────────────────────────────────────────────────────
# LLM — 말로 적은 안무 → 다듬은 설명 → 안무표 스키마
# ─────────────────────────────────────────────────────────────────────────────

# 안무표 스키마. 브라우저(src/domain/choreoPlan.js)가 같은 모양을 정규화한다 — 한쪽을 고치면 다른 쪽도 고친다.
PLAN_SCHEMA = {
    'type': 'object',
    'properties': {
        'title': {'type': 'string', 'description': '안무를 한 줄로 요약한 제목'},
        'moves': {
            'type': 'array',
            'description': '안무표에 놓을 동작. 시간 순서대로.',
            'items': {
                'type': 'object',
                'properties': {
                    'bar': {'type': 'integer', 'description': '마디 번호. 1 이 첫 마디(8x1). 0 은 intro'},
                    'count': {'type': 'integer', 'description': '그 마디 안의 시작 카운트. 1 부터 마디의 카운트 수까지'},
                    'length': {'type': 'integer', 'description': '몇 카운트 동안인가. 1 이상. 마디를 넘어가도 된다'},
                    'name': {'type': 'string', 'description': '동작 이름. 동작 목록에 있는 이름이면 정확히 그 표기로'},
                    'category': {'type': 'string', 'description': '카테고리 키. 목록에 없는 새 동작일 때만 고른다'},
                    'note': {'type': 'string', 'description': '비고(선택). 방향·팔 동작 같은 부연'},
                },
                'required': ['bar', 'count', 'length', 'name', 'category', 'note'],
                'additionalProperties': False,
            },
        },
        'notes': {'type': 'array', 'items': {'type': 'string'}, 'description': '애매해서 임의로 정한 것, 사용자에게 물을 것'},
    },
    'required': ['title', 'moves', 'notes'],
    'additionalProperties': False,
}


def plan_system_prompt(context):
    cols = int(context.get('cols') or 8)
    rows = int(context.get('rows') or 8)
    moves = [str(m) for m in (context.get('moves') or [])][:400]
    cats = context.get('categories') or {}
    cat_lines = ', '.join(f'{k}({v})' for k, v in list(cats.items())[:40]) or 'step'
    return (
        '너는 스윙/재즈 솔로 안무 편집기의 도우미다. 안무표는 격자다: 한 행이 한 마디이고 한 마디는 '
        f'{cols}카운트다(카운트 1..{cols}). 지금 안무표는 마디 1..{rows} 가 있고 마디 0 은 intro 다. '
        '사용자는 안무를 말로 하거나 대충 적는다 — 음성 인식 오류, 줄임말, 순서 뒤섞임이 있을 수 있다.\n'
        f'동작 목록(있으면 이 표기를 그대로 쓴다): {", ".join(moves) if moves else "(비어 있음)"}\n'
        f'카테고리 키(라벨): {cat_lines}\n'
        '규칙: 마디·카운트가 명시되지 않으면 앞 동작이 끝난 다음 카운트에 이어 붙인다. 길이가 없으면 '
        '동작 이름으로 흔한 길이를 고른다(예: 찰스턴 8, 재즈 스퀘어 8, 킥볼체인지 2, 스텝 1). '
        '한 마디를 넘어가면 다음 마디로 이어진다. 확실하지 않은 것은 지어내지 말고 notes 에 적는다.'
    )


REFINE_INSTRUCTION = (
    '아래 텍스트를 안무 설명으로 다듬어라. 출력은 한국어 평문이고, 마디와 카운트를 명시한 한 줄이 동작 하나다 '
    '(예: "8x1 1카운트부터 8카운트: 찰스턴"). 동작 목록에 있는 이름은 그 표기로 바꾸고, 음성 인식 오류로 보이는 '
    '단어는 가장 그럴듯한 동작으로 고치되 고친 것은 줄 끝에 (원문: …) 로 남겨라. 설명 외의 말은 붙이지 마라.\n\n텍스트:\n'
)

COMPOSE_INSTRUCTION = '아래 안무 설명을 스키마에 맞는 JSON 으로 만들어라.\n\n설명:\n'


def http_json(url, payload, headers, timeout=180):
    """POST JSON → (status, json). 네트워크·HTTP 오류는 (status, {'error': …}) 로 접는다."""
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode('utf-8') or '{}', strict=False)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode('utf-8') or '{}', strict=False)
        except ValueError:
            detail = {}
        msg = (detail.get('error') or {}).get('message') if isinstance(detail.get('error'), dict) else detail.get('error')
        return e.code, {'error': msg or f'HTTP {e.code}'}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return 0, {'error': str(e)}


def call_llm(config, system, user, schema=None):
    """제공자별 호출. schema 가 있으면 JSON(dict), 없으면 평문(str). 실패는 예외가 아니라 ('', error) 다."""
    llm = config.llm
    provider, model, base = llm['provider'], llm['model'], llm['baseUrl']
    key = config.llm_key()

    if provider == 'anthropic':
        if not key:
            return None, 'ANTHROPIC_API_KEY 가 없습니다. 설정에서 키를 넣거나 서버 환경 변수로 주세요.'
        payload = {
            'model': model, 'max_tokens': 16000,
            'system': system, 'messages': [{'role': 'user', 'content': user}],
            'fallbacks': 'default',                       # 거부 시 서버가 다른 모델로 이어서 답한다
        }
        if schema:
            payload['output_config'] = {'format': {'type': 'json_schema', 'schema': schema}}
        status, data = http_json(f'{base}/v1/messages', payload, {
            'x-api-key': key, 'anthropic-version': '2023-06-01',
            'anthropic-beta': 'server-side-fallback-2026-07-01',
        })
        if status != 200:
            return None, f'Claude 응답 실패: {data.get("error")}'
        if data.get('stop_reason') == 'refusal':
            return None, 'Claude 가 이 요청을 거절했습니다.'
        text = ''.join(b.get('text', '') for b in data.get('content', []) if b.get('type') == 'text')
        return _finish(text, schema)

    if provider == 'openai' and not config.llm_is_local_openai():
        local = False
        if not key and not local:
            return None, 'OPENAI_API_KEY 가 없습니다. 설정에서 키를 넣거나 서버 환경 변수로 주세요.'
        payload = {
            'model': model,
            'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
        }
        if schema:
            payload['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'choreo_plan', 'schema': schema, 'strict': True}}
        headers = {'Authorization': f'Bearer {key}'} if key else {}
        status, data = http_json(f'{base}/v1/chat/completions', payload, headers, timeout=600 if local else 180)
        if status == 401 and local:
            return None, f'{base} 가 API 토큰을 요구합니다(LM Studio 는 Developer 탭의 API token). 설정의 API 키 칸에 넣으세요.'
        if status != 200:
            return None, f'{"로컬 OpenAI 호환 서버" if local else "OpenAI"} 응답 실패: {data.get("error")}'
        choices = data.get('choices') or []
        text = ((choices[0].get('message') or {}).get('content') or '') if choices else ''
        return _finish(text, schema)

    # 로컬 — Ollama 또는 OpenAI 호환(LM Studio·llama.cpp·vLLM). 어느 쪽인지는 서버에 물어서 정한다.
    # 사용자가 제공자 종류를 틀리게 골라도 되게 하려는 것이다: 주소만 맞으면 된다.
    kind, models = detect_local(base, key)
    if kind is None:
        return None, f'{base} 에서 LLM 서버를 찾지 못했습니다. Ollama 나 LM Studio 가 그 주소·포트에 떠 있는지, 토큰이 필요한 서버면 API 키 칸에 넣었는지 확인하세요.'
    if models and model not in models:
        model = models[0]                      # 로드된(또는 첫) 모델로. 설정의 이름은 그 서버에 없다
    headers = {'Authorization': f'Bearer {key}'} if key else {}
    if kind == 'ollama':
        payload = {
            'model': model, 'stream': False,
            'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
        }
        if schema:
            payload['format'] = schema
        status, data = http_json(f'{base}/api/chat', payload, headers, timeout=600)
        if status != 200:
            return None, f'로컬 LLM(Ollama) 응답 실패: {data.get("error")} — 모델 {model} 이 받아져 있는지 확인하세요.'
        text = (data.get('message') or {}).get('content') or ''
        return _finish(text, schema)
    # ⚠ 로컬 OpenAI 호환에는 문법 제약(json_schema strict)을 걸지 않는다. LM Studio 에서 추론 모델에 문법을
    #   걸면 10분이 지나도 답이 없었다(추론 토큰까지 문법에 묶이는 것으로 보인다). 대신 스키마를 프롬프트에
    #   넣고 JSON 만 내라고 한 뒤 느슨하게 파싱한다(코드 펜스·앞뒤 말 제거). 검증은 어차피 validate_plan 이 한다.
    user_text = user
    if schema:
        user_text = (
            user + '\n\n출력은 아래 JSON 스키마를 만족하는 JSON 객체 **하나만**이다. 설명·코드 펜스·다른 말을 붙이지 마라.\n'
            + json.dumps(schema, ensure_ascii=False)
        )
    payload = {
        'model': model, 'stream': False, 'max_tokens': 8000,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user_text}],
    }
    status, data = http_json(f'{base}/v1/chat/completions', payload, headers, timeout=900)
    if status == 401:
        return None, f'{base} 가 API 토큰을 요구합니다(LM Studio 는 Developer 탭의 API token). 설정의 API 키 칸에 넣으세요.'
    if status != 200:
        return None, f'로컬 LLM(OpenAI 호환) 응답 실패: {data.get("error")}'
    choices = data.get('choices') or []
    text = ((choices[0].get('message') or {}).get('content') or '') if choices else ''
    return _finish(text, schema)


LAST_MODEL_DETAILS = {}


def model_details(ids):
    """목록의 id 마다 {id, label, state}. LM Studio 상세가 있으면 아키텍처·양자화·로드 상태를 라벨에 넣는다."""
    out = []
    for i in ids:
        d = LAST_MODEL_DETAILS.get(i)
        if d:
            bits = [b for b in (d['arch'], d['quantization']) if b]
            if d['context']:
                bits.append(f'{int(d["context"]) // 1024}k')
            label = (' · '.join(bits) or i) + (' — 로드됨' if d['state'] == 'loaded' else '') + f'  [{i[:12]}…]' if len(i) > 16 else (' · '.join(bits) or i) + (' — 로드됨' if d['state'] == 'loaded' else '')
            out.append({'id': i, 'label': label, 'state': d['state']})
        else:
            out.append({'id': i, 'label': i, 'state': ''})
    return out


def detect_local(base, key):
    """로컬 주소가 Ollama 인지 OpenAI 호환인지, 그리고 모델 목록. (None, []) 이면 아무것도 안 떠 있다.
    Ollama 는 /api/tags, LM Studio 는 /api/v0/models(종류·로드 상태), 그 밖은 /v1/models 로 안다."""
    headers = {'Authorization': f'Bearer {key}'} if key else {}
    st, d = http_get_json(f'{base}/api/tags', headers, timeout=5)
    if st == 200 and isinstance(d.get('models'), list):
        return 'ollama', sorted(m.get('name', '') for m in d['models'] if m.get('name'))
    st, d = http_get_json(f'{base}/api/v0/models', headers, timeout=5)
    if st == 200 and isinstance(d.get('data'), list):
        llms = [m for m in d['data'] if m.get('id') and m.get('type', 'llm') == 'llm']
        loaded = [m['id'] for m in llms if m.get('state') == 'loaded']
        rest = sorted(m['id'] for m in llms if m.get('state') != 'loaded')
        # 상세는 모듈 전역 캐시에 둔다(list_models 가 details 로 돌려준다). id 가 해시라 사람이 못 읽는다.
        LAST_MODEL_DETAILS.clear()
        for m in llms:
            LAST_MODEL_DETAILS[m['id']] = {
                'arch': m.get('arch') or '', 'quantization': m.get('quantization') or '',
                'state': m.get('state') or '', 'context': m.get('max_context_length') or None,
            }
        return 'openai', loaded + rest
    st, d = http_get_json(f'{base}/v1/models', headers, timeout=5)
    if st == 200 and isinstance(d.get('data'), list):
        return 'openai', sorted(m.get('id', '') for m in d['data'] if m.get('id'))
    if st == 401:
        return 'openai', []                    # 서버는 있는데 토큰이 없다 — 호출부가 401 문구를 낸다
    return None, []


def http_get_json(url, headers, timeout=15):
    req = urllib.request.Request(url, method='GET', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        return e.code, {}
    except (urllib.error.URLError, OSError, ValueError):
        return 0, {}


def list_models(config):
    """제공자가 가진 모델 이름들. 못 물어보면(anthropic 은 목록 API 가 있지만 키가 필요) 빈 목록과 이유."""
    llm = config.llm
    base, key = llm['baseUrl'], config.llm_key()
    if llm['provider'] == 'ollama' or config.llm_is_local_openai():
        kind, models = detect_local(base, key)
        if kind is None:
            return [], f'{base} 에서 LLM 서버를 찾지 못했습니다(Ollama · LM Studio 가 떠 있나요?)'
        if not models:
            return [], '토큰이 없거나 틀려 목록을 못 받았습니다' if key == '' else '모델 목록이 비어 있습니다'
        return models, ''
    headers = {'Authorization': f'Bearer {key}'} if key else {}
    if llm['provider'] == 'anthropic':
        if not key:
            return [], '키가 있어야 목록을 받습니다'
        headers['anthropic-version'] = '2023-06-01'
        status, data = http_get_json(f'{base}/v1/models', headers)
    else:
        status, data = http_get_json(f'{base}/v1/models', headers)
    if status == 401:
        return [], '토큰이 없거나 틀려 목록을 못 받았습니다'
    if status != 200:
        return [], f'{base} 에서 모델 목록을 못 받았습니다'
    return sorted(m.get('id', '') for m in data.get('data', []) if m.get('id')), ''


def _finish(text, schema):
    if not schema:
        return text.strip(), None
    try:
        return json.loads(_strip_fence(text), strict=False), None
    except ValueError:
        pass
    # 앞뒤에 말을 붙였으면 첫 '{' 부터 마지막 '}' 까지만 본다.
    a, b = text.find('{'), text.rfind('}')
    if a >= 0 and b > a:
        try:
            return json.loads(text[a:b + 1], strict=False), None
        except ValueError:
            pass
    return None, f'모델이 JSON 이 아닌 답을 냈습니다: {text[:200]}'


def _strip_fence(text):
    t = text.strip()
    m = re.match(r'^```(?:json)?\s*(.*?)\s*```$', t, re.S)
    return m.group(1) if m else t


def validate_plan(plan):
    """PLAN_SCHEMA 의 손 검증(jsonschema 라이브러리 없이). 틀린 항목은 버리고, 왜 버렸는지를 notes 로 남긴다."""
    if not isinstance(plan, dict):
        return None, 'plan 이 객체가 아닙니다'
    out = {'title': str(plan.get('title') or ''), 'moves': [], 'notes': []}
    for n in plan.get('notes') or []:
        if isinstance(n, str) and n.strip():
            out['notes'].append(n.strip())
    for i, m in enumerate(plan.get('moves') or []):
        if not isinstance(m, dict):
            out['notes'].append(f'{i + 1}번째 항목이 객체가 아니라 버렸습니다')
            continue
        try:
            bar = int(m.get('bar'))
            count = int(m.get('count'))
            length = int(m.get('length'))
        except (TypeError, ValueError):
            out['notes'].append(f'{i + 1}번째 항목의 마디·카운트·길이가 숫자가 아니라 버렸습니다')
            continue
        name = str(m.get('name') or '').strip()
        if not name:
            out['notes'].append(f'{i + 1}번째 항목에 동작 이름이 없어 버렸습니다')
            continue
        out['moves'].append({
            'bar': bar, 'count': count, 'length': max(1, length), 'name': name,
            'category': str(m.get('category') or ''), 'note': str(m.get('note') or ''),
        })
    return out, None


# ─────────────────────────────────────────────────────────────────────────────
# 핸들러
# ─────────────────────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    config = None          # Config. main() 이 넣는다
    quiet = False
    ffmpeg = None          # ffmpeg 실행 파일 경로 또는 None. main() 이 넣는다

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_DIR), **kwargs)

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)

    # ── 캐시 ──
    # ⚠ 정적 파일은 **캐시하지 않는다.** 이 프로젝트에는 빌드 단계가 없어서 브라우저가 읽는 .js 가 곧
    #   저장소의 .js 다. 브라우저가 휴리스틱으로 모듈을 붙들고 있으면 고친 코드가 새로고침해도 안 나오고,
    #   그것이 "고쳤는데 안 바뀐다" 로 보인다(2026-09-11 에 실제로 겪었다). 개발용 로컬 서버이므로
    #   전송량은 문제가 아니다. 모델 파일처럼 스스로 Cache-Control 을 붙인 응답은 그대로 둔다.

    def send_header(self, keyword, value):
        if keyword.lower() == 'cache-control':
            self._own_cache = True
        super().send_header(keyword, value)

    def end_headers(self):
        if not getattr(self, '_own_cache', False):
            super().send_header('Cache-Control', 'no-store')
        self._own_cache = False
        super().end_headers()

    # ── 공통 ──

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _error(self, status, message):
        self._json(status, {'ok': False, 'error': message})

    def _read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        try:
            return json.loads(raw.decode('utf-8') or '{}')
        except ValueError:
            return None

    def _clip_file(self, rel_path):
        """상대 경로 → 실제 파일 경로. 루트 밖이면 None."""
        parts = split_clip_path(rel_path)
        if not parts:
            return None
        target = (self.config.root / Path(*parts)).resolve()
        try:
            target.relative_to(self.config.root)
        except ValueError:
            return None
        return target

    # ── 라우팅 ──

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == '/api/health':
            return self._json(HTTPStatus.OK, {'ok': True, 'mode': 'server', 'ffmpeg': bool(self.ffmpeg),
                                              'pose': self.config.models_json()['ready'], **self.config.to_json()})
        if url.path == '/api/config':
            return self._json(HTTPStatus.OK, self.config.to_json())
        if url.path == '/api/llm/config':
            return self._json(HTTPStatus.OK, self.config.llm_public())
        if url.path == '/api/llm/models':
            models, err = list_models(self.config)
            return self._json(HTTPStatus.OK, {'ok': True, 'models': models, 'details': model_details(models), 'error': err})
        if url.path == '/api/models':
            return self._json(HTTPStatus.OK, self.config.models_json())
        if url.path.startswith('/models/'):
            return self._serve_model(unquote(url.path[len('/models/'):]))
        if url.path == '/api/clips':
            return self._list_clips(parse_qs(url.query))
        if url.path.startswith('/api/clips/'):
            return self._head_clip(unquote(url.path[len('/api/clips/'):]))
        if url.path.startswith('/clips/'):
            return self._serve_clip(unquote(url.path[len('/clips/'):]))
        if self._hidden(url.path):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    @staticmethod
    def _hidden(path):
        """숨김 파일·폴더(.git, .clipserver.json …)는 정적으로 내주지 않는다."""
        return any(seg.startswith('.') for seg in unquote(path).split('/') if seg)

    def do_HEAD(self):
        url = urlsplit(self.path)
        if url.path.startswith('/models/'):
            return self._serve_model(unquote(url.path[len('/models/'):]), head_only=True)
        if url.path.startswith('/api/clips/'):
            return self._head_clip(unquote(url.path[len('/api/clips/'):]))
        if url.path.startswith('/clips/'):
            return self._serve_clip(unquote(url.path[len('/clips/'):]), head_only=True)
        if self._hidden(url.path):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_HEAD()

    def do_PUT(self):
        url = urlsplit(self.path)
        if url.path == '/api/config':
            return self._put_config()
        if url.path == '/api/llm/config':
            return self._put_llm_config()
        if url.path == '/api/clips':
            return self._put_clip(parse_qs(url.query))
        if url.path == '/api/models/config':
            return self._put_models_config()
        return self._error(HTTPStatus.NOT_FOUND, 'no such endpoint')

    def do_POST(self):
        url = urlsplit(self.path)
        if url.path == '/api/llm/refine':
            return self._llm_refine()
        if url.path == '/api/llm/compose':
            return self._llm_compose()
        if url.path == '/api/clips/trim':
            return self._trim_clip()
        if url.path == '/api/models/fetch':
            return self._fetch_model()
        if url.path == '/api/models/choose':
            return self._choose_models_dir()
        return self._error(HTTPStatus.NOT_FOUND, 'no such endpoint')

    # ── LLM ──

    def _put_llm_config(self):
        data = self._read_json()
        if data is None or not isinstance(data, dict):
            return self._error(HTTPStatus.BAD_REQUEST, 'invalid json')
        cur = dict(self.config.llm)
        if 'provider' in data:
            if data['provider'] not in LLM_DEFAULTS:
                return self._error(HTTPStatus.BAD_REQUEST, 'unknown provider')
            if data['provider'] != cur['provider']:
                # 제공자를 바꾸면 모델·주소는 그 제공자의 기본값으로 시작한다(요청에 값이 있으면 그것이 이긴다).
                cur = {'provider': data['provider'], 'model': '', 'baseUrl': '', 'apiKey': cur['apiKey']}
        for k in ('model', 'baseUrl'):
            if isinstance(data.get(k), str):
                cur[k] = data[k].strip()
        if isinstance(data.get('apiKey'), str):
            cur['apiKey'] = data['apiKey'].strip()          # 빈 문자열 = 키 지우기(환경 변수로 돌아간다)
        self.config.llm = normalize_llm(cur)
        self.config.save()
        return self._json(HTTPStatus.OK, self.config.llm_public())

    def _llm_refine(self):
        data = self._read_json()
        if not isinstance(data, dict) or not str(data.get('text') or '').strip():
            return self._error(HTTPStatus.BAD_REQUEST, 'text is required')
        context = data.get('context') if isinstance(data.get('context'), dict) else {}
        text, err = call_llm(self.config, plan_system_prompt(context), REFINE_INSTRUCTION + str(data['text']))
        if err:
            return self._error(HTTPStatus.BAD_GATEWAY, err)
        return self._json(HTTPStatus.OK, {'ok': True, 'prompt': text})

    def _llm_compose(self):
        data = self._read_json()
        if not isinstance(data, dict) or not str(data.get('prompt') or '').strip():
            return self._error(HTTPStatus.BAD_REQUEST, 'prompt is required')
        context = data.get('context') if isinstance(data.get('context'), dict) else {}
        raw, err = call_llm(self.config, plan_system_prompt(context), COMPOSE_INSTRUCTION + str(data['prompt']), PLAN_SCHEMA)
        if err:
            return self._error(HTTPStatus.BAD_GATEWAY, err)
        plan, verr = validate_plan(raw)
        if verr:
            return self._error(HTTPStatus.BAD_GATEWAY, verr)
        return self._json(HTTPStatus.OK, {'ok': True, 'plan': plan})

    # ── 설정 ──

    def _put_config(self):
        data = self._read_json()
        if data is None or not isinstance(data, dict):
            return self._error(HTTPStatus.BAD_REQUEST, 'invalid json')
        root = data.get('root', str(self.config.root))
        subdir = data.get('subdir', self.config.subdir)
        if not isinstance(root, str) or not root.strip():
            return self._error(HTTPStatus.BAD_REQUEST, 'root must be a non-empty path')
        candidate = Config(root.strip(), subdir, self.config.path, self.config.llm)
        try:
            candidate.dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return self._error(HTTPStatus.BAD_REQUEST, f'cannot create {candidate.dir}: {e}')
        type(self).config = candidate
        candidate.save()
        return self._json(HTTPStatus.OK, candidate.to_json())

    # ── 클립 ──

    def _put_clip(self, query):
        name = safe_segment((query.get('name') or [''])[0], 'clip')
        project = project_dir_name((query.get('project') or [''])[0])
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0:
            return self._error(HTTPStatus.BAD_REQUEST, 'empty body')
        target_dir = self.config.dir / project
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f'cannot create {target_dir}: {e}')
        final = name
        n = 2
        while (target_dir / final).exists():
            final = numbered_name(name, n)
            n += 1
        target = target_dir / final
        remaining = length
        try:
            with open(target, 'wb') as out:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    out.write(chunk)
                    remaining -= len(chunk)
        except OSError as e:
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f'write failed: {e}')
        rel = f'{self.config.subdir}/{project}/{final}'
        return self._json(HTTPStatus.CREATED, {'ok': True, 'path': rel, 'url': '/clips/' + rel, 'size': target.stat().st_size})

    # ── 자세 분석 모델 ──

    def _models_file(self, rel_path):
        """모델 폴더 기준 상대 경로 → 실제 파일 경로. 폴더 밖이면 None."""
        parts = split_clip_path(rel_path)
        if not parts:
            return None
        target = (self.config.models_dir / Path(*parts)).resolve()
        try:
            target.relative_to(self.config.models_dir)
        except ValueError:
            return None
        return target

    def _serve_model(self, rel_path, head_only=False):
        target = self._models_file(rel_path)
        if not target or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, 'no such model file')
            return
        size = target.stat().st_size
        ctype = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        # 한 번 받으면 바뀌지 않는 파일이다(버전이 경로가 아니라 내용에 박혀 있으므로 서버가 바꿀 때만 바뀐다).
        self.send_header('Cache-Control', 'public, max-age=86400')
        self.end_headers()
        if head_only or self.command == 'HEAD':
            return
        try:
            with open(target, 'rb') as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _put_models_config(self):
        data = self._read_json()
        if data is None or not isinstance(data, dict):
            return self._error(HTTPStatus.BAD_REQUEST, 'invalid json')
        models_dir = data.get('dir', str(self.config.models_dir))
        pose_model = data.get('poseModel', self.config.pose_model)
        if not isinstance(models_dir, str) or not models_dir.strip():
            return self._error(HTTPStatus.BAD_REQUEST, 'dir must be a non-empty path')
        if pose_model not in POSE_MODELS:
            return self._error(HTTPStatus.BAD_REQUEST, f'poseModel must be one of {", ".join(POSE_MODELS)}')
        candidate = Config(self.config.root, self.config.subdir, self.config.path, self.config.llm,
                           models_dir.strip(), pose_model)
        try:
            candidate.models_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return self._error(HTTPStatus.BAD_REQUEST, f'cannot create {candidate.models_dir}: {e}')
        type(self).config = candidate
        candidate.save()
        return self._json(HTTPStatus.OK, candidate.models_json())

    def _choose_models_dir(self):
        """폴더 고르기 창을 띄우고, 고른 폴더를 **그 자리에서** 보관 위치로 삼는다.
        고르고 또 `적용` 을 누르게 하면 한 번 더 실수할 자리가 생긴다."""
        start = str(self.config.models_dir)
        if not Path(start).is_dir():
            start = str(Path.home())
        path, err = choose_folder(start)
        if err:
            return self._error(HTTPStatus.SERVICE_UNAVAILABLE, err)
        if not path:
            return self._json(HTTPStatus.OK, {'ok': False, 'canceled': True})
        candidate = Config(self.config.root, self.config.subdir, self.config.path, self.config.llm,
                           path, self.config.pose_model)
        try:
            candidate.models_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return self._error(HTTPStatus.BAD_REQUEST, f'cannot create {candidate.models_dir}: {e}')
        type(self).config = candidate
        candidate.save()
        return self._json(HTTPStatus.OK, {'ok': True, **candidate.models_json()})

    def _fetch_model(self):
        """모델 파일 하나를 받아 둔다. 한 번에 하나씩인 이유는 브라우저가 진행률을 보여 줄 수 있게 하려는 것이다."""
        data = self._read_json()
        if not isinstance(data, dict):
            return self._error(HTTPStatus.BAD_REQUEST, 'invalid json')
        entry = MODEL_BY_KEY.get(str(data.get('key') or ''))
        if not entry:
            return self._error(HTTPStatus.BAD_REQUEST, 'unknown model key')
        target = self.config.models_dir / entry['name']
        if target.is_file() and not data.get('force'):
            return self._json(HTTPStatus.OK, {'ok': True, 'key': entry['key'], 'bytes': target.stat().st_size, 'cached': True})
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f'cannot create {target.parent}: {e}')
        # ⚠ 받다 만 파일을 제자리에 남기지 않는다 — .part 로 받아 끝난 뒤에 이름을 바꾼다.
        #   중간에 끊긴 11MB 짜리 wasm 이 "있음" 으로 보이면 그 뒤로 영영 고쳐지지 않는다.
        part = target.with_name(target.name + '.part')
        try:
            req = urllib.request.Request(entry['url'], method='GET', headers={'User-Agent': 'choreo-editor'})
            with urllib.request.urlopen(req, timeout=600) as res, open(part, 'wb') as out:
                while True:
                    chunk = res.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            part.replace(target)
        except (urllib.error.URLError, OSError, ValueError) as e:
            try:
                part.unlink()
            except OSError:
                pass
            return self._error(HTTPStatus.BAD_GATEWAY, f'{entry["name"]} 을 받지 못했습니다: {e}')
        return self._json(HTTPStatus.CREATED, {'ok': True, 'key': entry['key'], 'bytes': target.stat().st_size, 'cached': False})

    def _trim_clip(self):
        """보관된 클립을 [inSec, outSec) 로 잘라 다시 인코딩한다. 원본은 그대로 두고 같은 폴더에 새 파일이 생긴다."""
        data = self._read_json()
        if not isinstance(data, dict):
            return self._error(HTTPStatus.BAD_REQUEST, 'invalid json')
        try:
            in_sec = float(data.get('inSec'))
            out_sec = float(data.get('outSec'))
        except (TypeError, ValueError):
            return self._error(HTTPStatus.BAD_REQUEST, 'inSec/outSec must be numbers')
        if not (in_sec >= 0 and out_sec > in_sec and out_sec - in_sec >= 0.1):
            return self._error(HTTPStatus.BAD_REQUEST, 'need 0 <= inSec < outSec (at least 0.1s)')
        src = self._clip_file(data.get('path'))
        if not src or not src.is_file():
            return self._error(HTTPStatus.NOT_FOUND, 'no such clip')
        if not self.ffmpeg:
            return self._error(HTTPStatus.NOT_IMPLEMENTED, 'ffmpeg 이 없습니다. 설치하고(brew install ffmpeg) 서버를 다시 켜거나 --ffmpeg 로 경로를 주세요.')
        name = trimmed_name(src.name, in_sec, out_sec)
        final, n = name, 2
        while (src.parent / final).exists():
            final = numbered_name(name, n)
            n += 1
        dst = src.parent / final
        ok, err = run_trim(self.ffmpeg, src, dst, in_sec, out_sec)
        if not ok:
            try:
                dst.unlink()                  # 반쯤 쓰인 파일을 남기지 않는다
            except OSError:
                pass
            return self._error(HTTPStatus.BAD_GATEWAY, f'ffmpeg 실패: {err}')
        rel = str(dst.relative_to(self.config.root)).replace(os.path.sep, '/')
        return self._json(HTTPStatus.CREATED, {
            'ok': True, 'path': rel, 'name': final, 'url': '/clips/' + rel,
            'size': dst.stat().st_size, 'durationSec': round(out_sec - in_sec, 3),
        })

    def _list_clips(self, query):
        project = project_dir_name((query.get('project') or [''])[0])
        folder = self.config.dir / project
        items = []
        if folder.is_dir():
            for entry in sorted(folder.iterdir()):
                if entry.is_file() and not entry.name.startswith('.'):
                    st = entry.stat()
                    items.append({
                        'path': f'{self.config.subdir}/{project}/{entry.name}',
                        'name': entry.name, 'size': st.st_size, 'mtime': int(st.st_mtime)
                    })
        return self._json(HTTPStatus.OK, {'project': project, 'clips': items})

    def _head_clip(self, rel_path):
        target = self._clip_file(rel_path)
        if not target or not target.is_file():
            return self._error(HTTPStatus.NOT_FOUND, 'no such clip')
        return self._json(HTTPStatus.OK, {'ok': True, 'path': rel_path, 'size': target.stat().st_size})

    def _serve_clip(self, rel_path, head_only=False):
        target = self._clip_file(rel_path)
        if not target or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, 'no such clip')
            return
        size = target.stat().st_size
        ctype = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        start, end = 0, size - 1
        rng = self.headers.get('Range')
        partial = False
        if rng and rng.startswith('bytes='):
            m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
            if m:
                a, b = m.group(1), m.group(2)
                if a:
                    start = int(a)
                    end = int(b) if b else size - 1
                elif b:                      # bytes=-N : 마지막 N 바이트
                    start = max(0, size - int(b))
                    end = size - 1
                partial = True
        if start >= size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return
        end = min(end, size - 1)
        length = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT if partial else HTTPStatus.OK)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        if partial:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        if head_only or self.command == 'HEAD':
            return
        try:
            with open(target, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass                              # 브라우저가 탐색하며 연결을 끊는 것은 정상이다


# ─────────────────────────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(description='안무 편집기 로컬 서버 (정적 파일 + 영상 클립 보관)')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--root', default=None, help='클립 보관 루트(기본: 저장소 폴더). 설정 파일보다 우선한다')
    ap.add_argument('--subdir', default=None, help='루트 아래 하위 폴더(기본: video-clip)')
    ap.add_argument('--config', default=str(CONFIG_FILE), help='설정 파일 경로(기본: 저장소의 .clipserver.json)')
    ap.add_argument('--models', default=None, help='자세 분석 모델 보관 폴더(기본: 저장소의 models/). 설정에서도 바꾼다')
    ap.add_argument('--ffmpeg', default=None, help='ffmpeg 실행 파일(기본: 환경 변수 CHOREO_FFMPEG 또는 PATH 의 ffmpeg). 없으면 자르기만 꺼진다')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args(argv)

    config = Config.load(str(REPO_DIR), DEFAULT_SUBDIR, Path(args.config))
    if args.root:
        config = Config(args.root, config.subdir, config.path, config.llm, config.models_dir, config.pose_model)
    if args.subdir:
        config = Config(config.root, args.subdir, config.path, config.llm, config.models_dir, config.pose_model)
    if args.models:
        config = Config(config.root, config.subdir, config.path, config.llm, args.models, config.pose_model)
    config.dir.mkdir(parents=True, exist_ok=True)

    Handler.config = config
    Handler.quiet = args.quiet
    Handler.ffmpeg = find_ffmpeg(args.ffmpeg)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    port = httpd.server_address[1]
    cut = f'자르기: {Handler.ffmpeg}' if Handler.ffmpeg else '자르기: 꺼짐(ffmpeg 없음)'
    m = config.models_json()
    pose = f'자세 분석: 준비됨({config.pose_model})' if m['ready'] else f'자세 분석: 모델 {m["missing"]}개 필요 — 설정에서 내려받기'
    print(f'안무 편집기: http://{args.host}:{port}/   클립 보관: {config.dir}   {cut}   {pose}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    sys.exit(main())
