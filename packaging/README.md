# 설치형 앱 짓기 (2026-11-03, RM-28)

이 폴더는 안무 편집기를 **맥 `.dmg` · 윈도우 설치 파일**로 싸는 껍데기다. 앱 코드(`src/`)와 `server.py` 는 이 폴더를 모른다 —
화살표는 `packaging → server.py` 한쪽이고 `node tools/check-arch.mjs` 가 잰다(개발 원칙 D-21). 정한 것과 까닭은
`docs/DECISIONS.md` 의 「빌드 도구 · 의존성 없음은 앱 코드와 server.py 의 규칙」 절에 있다.

| 파일 | 하는 일 |
|---|---|
| `launcher.py` | 앱을 두 번 눌러 켜면 도는 것. `server.main` 을 `--port 0 --open --static <앱 파일> [--ffmpeg <실은 것>]` 으로 부르고 「켜져 있음」 창(「브라우저로 열기」 · 「끄기」)을 띄운다. 이미 켜져 있으면 브라우저만 다시 연다 |
| `build.py` | 앱 파일을 펼치고 PyInstaller 로 얼려 맥 `.app` → `.dmg`, 윈도우는 Inno Setup 설치 파일(없으면 zip)을 만든다 |
| `make_icon.py` | 아이콘을 코드로 그린다(표준 라이브러리만) — png · ico · iconset |
| `app.json` | 이름 · 보이는 이름 · 번들 id · 판 번호 · 펴낸이 |
| `windows/choreo.iss` | 윈도우 설치 파일의 틀(내 계정에만 깔림, 관리자 권한 없음) |
| `ffmpeg-lgpl-mac.sh` | 맥에 실을 LGPL ffmpeg 를 소스에서 짓는다 |

## 짓기

PyInstaller 는 교차 빌드를 하지 않는다 — **맥 앱은 맥에서, 윈도우 앱은 윈도우에서** 짓는다. 도구는 저장소에 붙지 않게 따로 만든 venv 에 깐다.

```
python3 -m venv ~/.venvs/choreo-pack
~/.venvs/choreo-pack/bin/pip install pyinstaller
~/.venvs/choreo-pack/bin/python packaging/build.py --ffmpeg <LGPL ffmpeg>
```

나오는 것은 `packaging/dist/` 에 있다(git 밖). `--ffmpeg` 을 빼면 자르기만 꺼진 앱이 된다.

- **맥** — `SwingChoreo.app` 과 `SwingChoreo-<판>-mac-<arm64|x86_64>.dmg`. 이 맥의 칩 것만 나온다. `build.py` 가 앱 정보를 고친 뒤 임시 서명으로
  다시 봉하고 `codesign --verify --deep --strict` 가 지나야 `.dmg` 를 만든다 — 봉인이 깨진 앱은 받은 맥이 「손상됨」으로 막는다(버그 기록).
- **윈도우** — Inno Setup 6 의 `iscc` 가 PATH 에 있으면 `SwingChoreo-<판>-setup.exe`, 없으면 `SwingChoreo-<판>-win.zip`.
  Inno Setup 을 깔 때 한국어 언어 파일(`Korean.isl`)도 고른다 — 없으면 `choreo.iss` 의 `[Languages]` 줄이 실패한다.

## ffmpeg — LGPL 빌드만 싣는다

결정(2026-10-13)이 「LGPL ffmpeg + OS 하드웨어 인코더」다. libx264 를 품은 GPL 빌드를 실으면 앱 전체가 GPL 조건에 묶인다.
`build.py` 는 받은 ffmpeg 를 재서 **GPL(`--enable-gpl`) · nonfree 빌드, H.264 인코더가 하나도 없는 빌드, 맥에서 `/usr/lib` · `/System` 밖
라이브러리에 링크된 빌드**를 거절한다(Homebrew 의 ffmpeg 는 GPL 이고 동적이라 거절된다 — 2026-11-03 쟀다). 배포하지 않을 시험판만 `--allow-gpl`.

- **맥** — `sh packaging/ffmpeg-lgpl-mac.sh` 가 ffmpeg 7.1.1 소스를 받아 바깥 라이브러리 없이(`--disable-autodetect`) VideoToolbox · AudioToolbox 만
  켜고 정적으로 짓는다 → `packaging/build/ffmpeg/ffmpeg`. Xcode 명령줄 도구가 있어야 한다.
- **윈도우** — BtbN 의 FFmpeg-Builds 에서 이름에 `lgpl` 이 든 win64 정적 빌드(`ffmpeg-n7.1-latest-win64-lgpl-7.1.zip` 꼴)를 받아 `bin\ffmpeg.exe` 를 준다.
  자르기의 H.264 는 Media Foundation(`h264_mf`)이 맡는다.

자르기가 어느 인코더를 쓰는지는 `server.py` 의 `H264_ENCODERS` 차례다 — libx264 → h264_videotoolbox → h264_mf → libopenh264. 저장소에서
Homebrew ffmpeg 로 켜면 전처럼 libx264 를 쓴다.

**배포할 때 지킬 LGPL 조건.** ① 앱의 정보 · 문서에 ffmpeg 를 LGPL 로 실었다고 적고 라이선스 글을 함께 둔다 ② 어느 소스를 어떻게 지었는지
(이 폴더의 스크립트 · 받은 빌드의 주소와 판)를 알린다 ③ ffmpeg 는 앱에 섞여 들지 않은 별도 실행 파일(앱 묶음 안 `bin/ffmpeg` · `bin\ffmpeg.exe`)이라 사용자가 같은 이름의 다른 빌드로 바꿔 끼울 수 있다 — 그렇다고 알린다.

## 서명

첫 판은 서명하지 않는다(결정 2026-10-13). 받은 사람은 처음 한 번 경고를 넘긴다 — 맥은 한 번 켜 보아 막힌 뒤 시스템 설정 →
「개인정보 보호 및 보안」 맨 아래의 「그래도 열기」 → 확인 창의 「그래도 열기」와 암호, 윈도우는 SmartScreen 의 「추가 정보」 → 「실행」.
(오른쪽 단추 → 「열기」로 넘기는 길은 macOS 14 Sonoma 이하에서만 된다 — macOS 15 부터 서명 · 공증 안 된 앱에는 막혔다.) 넘기는 법은 `docs/TUTORIAL.md` 의 「설치형 앱으로 켠다」에 있다. 공증(Apple notarization) ·
코드 서명 인증서는 다음 판의 일이다.

## 손 점검표 — 두 OS 에서 한 번씩

기계가 잴 수 없는 것이다. 새 판을 내기 전에 **지은 기계가 아닌** 기계에서 본다.

1. 받은 `.dmg` · 설치 파일로 깔고 첫 실행 경고를 튜토리얼대로 넘긴다.

   맥은 Finder 에 앱이 `안무 편집기` 로 보이는지도 본다 — `osascript -e 'tell application "Finder" to get displayed name of (POSIX file "/Applications/SwingChoreo.app" as alias)'`
   — `build.py` 가 넣는 한국어 이름 표(`ko.lproj`) 덕이고, Info.plist 의 보이는 이름은 파일 이름 `SwingChoreo` 로 둔다(둘이 다르면
   macOS 가 이름 표를 버린다 — 버그 기록). 이름 표가 한국어 하나뿐이라 언어 목록이 영어 먼저인 맥(en-KR · ko-KR)에서도 `안무 편집기` 로 보였다(2026-11-03 쟀다).

2. 켜면 기본 브라우저에 안무표가 뜨고 「켜져 있음」 창이 그 위에 선다.

3. `영상` 을 켜고 폰으로 찍은 영상 하나를 넣는다 — 데이터 폴더(`설정` 에 보이는 자리)에 복사되는지 본다.

4. In/Out 을 찍고 `✂ 잘라서 새 클립으로` — 새 클립이 생기고 재생되는지(실은 ffmpeg · OS 인코더 길).

5. 안무표를 저장하고 「끄기」 → 다시 켜서 같은 주소(포트)로 열리고 최근 목록 · 영상이 그대로인지.

6. 켜진 채로 아이콘을 또 눌러 둘째 서버가 뜨지 않는지.

7. 앱을 지우고(맥은 휴지통, 윈도우는 앱 제거) 다시 깔아 안무표가 남아 있는지.

## 아직 재지 못한 것 (2026-11-03)

- 맥 `.dmg` 는 이 맥(arm64)에서 짓고, 얼린 앱을 켜서 화면 · 문서 · 예제 · `/admin` 이 뜨는 것, 포트 기억, 둘째 실행, 「끄기」를 쟀다.
  VideoToolbox 로 자르는 길은 인코더 차례를 강제해 쟀다.
- **LGPL ffmpeg 를 실은 빌드**는 아직 짓지 못했다 — `ffmpeg-lgpl-mac.sh` 는 돌려 보지 않은 대본이다.
- **윈도우 빌드 · 설치 파일 · PowerShell 창**은 윈도우 기계에서 아직 돌려 보지 않았다.
- 다른 맥(인텔 칩 · 다른 판의 macOS)에서 켜기.
- 맥 첫 실행의 「그래도 열기」 길(RM-67)은 화면으로 따라가 보지 못했다 — 격리 표시를 붙인 앱을 `spctl --assess` 가 `rejected` 로 막는 것까지 쟀다.
  단추 글자 · 확인 창 차례는 애플 안내를 따른 것이다. 언어 목록에 한국어가 아예 없는 맥에서 Finder 이름도 재지 못했다.
