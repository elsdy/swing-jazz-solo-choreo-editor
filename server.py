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

    GET  /api/llm/config                  {provider, model, baseUrl, hasKey, available}. 키 값은 절대 돌려주지 않는다
    GET  /api/llm/models                  지금 제공자가 가진 모델 이름 목록(openai 호환 /v1/models, ollama /api/tags)
    PUT  /api/llm/config  {provider?, model?, baseUrl?, apiKey?}   설정 변경. apiKey 는 .clipserver.json 에만 남는다
    POST /api/llm/refine  {text, context}  말하거나 대충 적은 텍스트 → 다듬은 안무 설명(평문)
    POST /api/llm/compose {prompt, context} 다듬은 설명 → 안무표 스키마(JSON). 서버가 스키마로 검증한다

    LLM 제공자: anthropic(Claude, 기본 claude-opus-5) · openai(OpenAI 호환 — GPT/Codex, LM Studio, llama.cpp, vLLM; 기본 gpt-5)
    · ollama(로컬, 기본 http://127.0.0.1:11434). openai 호환 로컬 서버는 키가 없어도 부른다(LM Studio 처럼 토큰을 요구하면 넣는다).
    키는 설정 파일의 apiKey 또는 환경 변수 ANTHROPIC_API_KEY / OPENAI_API_KEY 에서 읽는다. 브라우저에는 키가 가지 않는다.

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
    def __init__(self, root, subdir, path=CONFIG_FILE, llm=None):
        self.root = Path(root).expanduser().resolve()
        self.subdir = safe_segment(subdir, DEFAULT_SUBDIR)
        self.path = path
        self.llm = normalize_llm(llm)

    @property
    def dir(self):
        return self.root / self.subdir

    def to_json(self):
        return {'root': str(self.root), 'subdir': self.subdir, 'dir': str(self.dir)}

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
            self.path.write_text(json.dumps({'root': str(self.root), 'subdir': self.subdir, 'llm': self.llm}, ensure_ascii=False, indent=2))
        except OSError:
            pass

    @staticmethod
    def load(default_root, default_subdir, path=CONFIG_FILE):
        root, subdir, llm = default_root, default_subdir, None
        try:
            data = json.loads(Path(path).read_text())
            root = data.get('root') or root
            subdir = data.get('subdir') or subdir
            llm = data.get('llm')
        except (OSError, ValueError):
            pass
        return Config(root, subdir, path, llm)


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
            return res.status, json.loads(res.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode('utf-8') or '{}')
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

    if provider == 'openai':
        local = config.llm_is_local_openai()
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

    # ollama — 로컬. 키가 없다. /api/chat 의 format 에 스키마를 그대로 준다.
    payload = {
        'model': model, 'stream': False,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
    }
    if schema:
        payload['format'] = schema
    status, data = http_json(f'{base}/api/chat', payload, {}, timeout=600)
    if status != 200:
        return None, f'로컬 LLM(ollama) 응답 실패: {data.get("error")} — {base} 에 ollama 가 떠 있고 모델 {model} 이 받아져 있는지 확인하세요.'
    text = (data.get('message') or {}).get('content') or ''
    return _finish(text, schema)


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
    if llm['provider'] == 'ollama':
        status, data = http_get_json(f'{base}/api/tags', {})
        if status != 200:
            return [], f'{base} 에서 모델 목록을 못 받았습니다(ollama 가 떠 있나요?)'
        return sorted(m.get('name', '') for m in data.get('models', []) if m.get('name')), ''
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
        return json.loads(_strip_fence(text)), None
    except ValueError:
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
        if url.path == '/api/llm/config':
            return self._json(HTTPStatus.OK, self.config.llm_public())
        if url.path == '/api/llm/models':
            models, err = list_models(self.config)
            return self._json(HTTPStatus.OK, {'ok': True, 'models': models, 'error': err})
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
        if url.path == '/api/llm/config':
            return self._put_llm_config()
        if url.path == '/api/clips':
            return self._put_clip(parse_qs(url.query))
        return self._error(HTTPStatus.NOT_FOUND, 'no such endpoint')

    def do_POST(self):
        url = urlsplit(self.path)
        if url.path == '/api/llm/refine':
            return self._llm_refine()
        if url.path == '/api/llm/compose':
            return self._llm_compose()
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
