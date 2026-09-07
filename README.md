# 안무 편집기 (swing-jazz-solo-choreo-editor)

스윙·재즈 솔로 안무를 격자에 적어 두는 편집기다. 행이 한 마디(8카운트), 칸이 1카운트이고, 동작을 블록으로 놓아 "몇 번째 마디 몇 카운트에 무엇을 하는지"를 한 장으로 본다.

서버가 없다. 브라우저에서 도는 정적 파일이 전부이고, 안무는 JSON 파일로 저장해 주고받는다.

처음 켠다면 [튜토리얼](docs/TUTORIAL.md)을 따라가면 된다. 그 버튼이 무슨 일을 하는지 궁금할 때는 [기능 설명서](docs/FEATURES.md)를 본다. 안무표 위 도구 모음의 `문서` 버튼을 누르면 저장소를 열지 않고도 여기서 다 읽을 수 있다.

## 실행

```
git clone https://github.com/elsdy/swing-jazz-solo-choreo-editor.git
cd swing-jazz-solo-choreo-editor
python3 -m http.server 8000
```

그리고 브라우저에서 `http://localhost:8000` 을 연다.

`index.html` 을 더블클릭해도 열리기는 하지만 **화면이 뜨지 않는다.** `file://` 에서는 브라우저가 ES 모듈 로딩과 문서 `fetch` 를 모두 막기 때문이다. 서버로 열어야 한다. GitHub Pages 같은 정적 호스팅에 올려도 그대로 동작한다.

설치할 것이 없다. Node 도 npm 도 필요 없고, 위 명령의 `python3` 자리에는 정적 파일을 내주는 무엇을 써도 된다.

## 무엇을 할 수 있나

- **안무표에 동작 배치** — 왼쪽 `동작 목록`에서 끌어다 놓거나, `+ 빠른 배치`로 격자를 직접 쓸어 길이를 정한다.
- **겹쳐 쌓기** — 같은 카운트에 동작이 겹치면 지우지 않고 아래층으로 쌓는다. 손과 발을 따로 적을 때 쓴다.
- **루틴** — 자주 쓰는 동작 묶음을 이름 붙여 저장하고, 안무표에 블록 하나로 놓는다.
- **카테고리** — 동작을 갈래로 묶고 색을 준다. 색을 바꾸면 안무표에 바로 반영된다.
- **저장과 합치기** — 프로젝트·동작 목록·카테고리를 각각 JSON 으로 저장한다. `부분 불러오기`로 여러 사람이 나눠 만든 안무를 한 표에 겹쳐 넣을 수 있다.
- **참고 링크** — 안무표 위에 YouTube·ClickUp·임의 링크를 붙여 둔다.

## 구조

`index.html` 이 화면(마크업·CSS)을 갖고, 동작은 `src/` 아래 ES 모듈로 나뉘어 있다.

```
src/domain/     격자·배치·루틴·저장 포맷 규칙 (순수 함수, 브라우저를 모른다)
src/ports/      바깥 세계와의 계약 (동영상 플레이어·저장소·시퀀스 엔진)
src/usecases/   상태를 바꾸고 "무엇을 다시 그릴지"를 값으로 돌려준다
src/adapters/   localStorage·파일·네트워크 등 브라우저 접점
src/ui/         DOM 렌더
src/input/      포인터·터치 제스처
src/app/        조립과 렌더 라우팅
src/testing/    골든 러너가 쓰는 어댑터 (앱은 쓰지 않는다)
```

의존 방향은 언제나 안쪽이다. 자세한 규칙과 그 이유는 [아키텍처](docs/ARCHITECTURE.md)에 있다.

## 고칠 때

```
node tests/run.mjs        # 격자 알고리즘 골든 150개
node tools/check-arch.mjs # 계층 방향과 순수성
node tools/check-docs.mjs # 문서 등록 누락과 깨진 앵커
```

셋 다 의존성이 0이다. 나머지 규칙은 [개발 지침](CLAUDE.md)에 있다.

## 문서

| 문서 | 언제 읽나 |
|---|---|
| [튜토리얼](docs/TUTORIAL.md) | 처음 켰을 때 |
| [기능 설명서](docs/FEATURES.md) | 그 버튼이 무슨 일을 하는지 |
| [개발 이력](docs/HISTORY.md) | 언제부터 이렇게 됐는지 |
| [로드맵](docs/ROADMAP.md) | 앞으로 무엇을 만드는지 |
| [아키텍처](docs/ARCHITECTURE.md) | 코드가 어떻게 나뉘어 있는지 |
| [포트 계약](docs/PORTS.md) | 동영상·시퀀스 엔진이 들어올 자리 |
| [개발 원칙](docs/PRINCIPLES.md) | 같은 실수를 반복하지 않으려고 |
| [버그 기록](docs/BUG_REPORTS.md) | 무엇이 왜 그렇게 됐는지 |
| [일부러 두고 온 것](docs/deviations.md) | 알려진 결함과 그대로 둔 이유 |

## 라이선스

[GPL-3.0](https://github.com/elsdy/swing-jazz-solo-choreo-editor/blob/main/LICENSE) — 저장소 뿌리의 `LICENSE` 파일이 원문이다.
