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

설계 메모
- 의존성이 0이다. FastAPI 를 쓰면 pip 환경이 생기고, 그것이 로드맵이 서버를 미룬 이유였다.
- 127.0.0.1 에만 묶는다. 개인 도구이고 인증이 없다. --host 0.0.0.0 은 스스로 정할 때만 쓴다.
- 경로 규칙은 src/domain/clips.js 와 같다: 못 쓰는 글자는 _, 앞의 점은 제거, 빈 조각은 대체 이름.
  프로젝트 파일에 저장되는 path(`<subdir>/<프로젝트>/<파일>`)가 브라우저 폴더 방식과 같은 모양이라
  두 방식 사이에서 파일을 열어도 경로가 그대로 통한다.
- 저장 루트 밖으로는 절대 나가지 않는다(resolve 뒤 prefix 검사). 업로드 크기 상한은 없다 — 로컬 도구다.
"""

import argparse
import json
import mimetypes
import os
import re
import sys
import time
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


# ─────────────────────────────────────────────────────────────────────────────
# 설정 — .clipserver.json
# ─────────────────────────────────────────────────────────────────────────────

class Config:
    def __init__(self, root, subdir, path=CONFIG_FILE):
        self.root = Path(root).expanduser().resolve()
        self.subdir = safe_segment(subdir, DEFAULT_SUBDIR)
        self.path = path

    @property
    def dir(self):
        return self.root / self.subdir

    def to_json(self):
        return {'root': str(self.root), 'subdir': self.subdir, 'dir': str(self.dir)}

    def save(self):
        try:
            self.path.write_text(json.dumps({'root': str(self.root), 'subdir': self.subdir}, ensure_ascii=False, indent=2))
        except OSError:
            pass

    @staticmethod
    def load(default_root, default_subdir, path=CONFIG_FILE):
        root, subdir = default_root, default_subdir
        try:
            data = json.loads(Path(path).read_text())
            root = data.get('root') or root
            subdir = data.get('subdir') or subdir
        except (OSError, ValueError):
            pass
        return Config(root, subdir, path)


# ─────────────────────────────────────────────────────────────────────────────
# 핸들러
# ─────────────────────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    config = None          # Config. main() 이 넣는다
    quiet = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_DIR), **kwargs)

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)

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
            return self._json(HTTPStatus.OK, {'ok': True, 'mode': 'server', **self.config.to_json()})
        if url.path == '/api/config':
            return self._json(HTTPStatus.OK, self.config.to_json())
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
        if url.path == '/api/clips':
            return self._put_clip(parse_qs(url.query))
        return self._error(HTTPStatus.NOT_FOUND, 'no such endpoint')

    # ── 설정 ──

    def _put_config(self):
        data = self._read_json()
        if data is None or not isinstance(data, dict):
            return self._error(HTTPStatus.BAD_REQUEST, 'invalid json')
        root = data.get('root', str(self.config.root))
        subdir = data.get('subdir', self.config.subdir)
        if not isinstance(root, str) or not root.strip():
            return self._error(HTTPStatus.BAD_REQUEST, 'root must be a non-empty path')
        candidate = Config(root.strip(), subdir, self.config.path)
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
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args(argv)

    config = Config.load(str(REPO_DIR), DEFAULT_SUBDIR, Path(args.config))
    if args.root:
        config = Config(args.root, config.subdir, config.path)
    if args.subdir:
        config = Config(config.root, args.subdir, config.path)
    config.dir.mkdir(parents=True, exist_ok=True)

    Handler.config = config
    Handler.quiet = args.quiet
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    port = httpd.server_address[1]
    print(f'안무 편집기: http://{args.host}:{port}/   클립 보관: {config.dir}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    sys.exit(main())
