# 개발 지침

이 저장소에서 코드를 고치기 전에 읽는다. 무엇을 만드는지는 [프로젝트 소개](README.md), 어떻게 나뉘어 있는지는 [아키텍처](docs/ARCHITECTURE.md), 왜 그렇게 하는지는 [개발 원칙](docs/PRINCIPLES.md)에 있다.

## 이 프로젝트가 무엇인가

스윙/재즈 솔로 안무를 격자에 배치하는 편집기다. 행이 한 마디(8카운트), 칸이 1카운트이고, 동작 블록을 놓아 안무표를 만든다. 개인 도구이며 서버가 없다 — 브라우저에서 도는 정적 파일이 전부다.

빌드 도구, 번들러, npm 의존성, 프레임워크가 **없다**. 브라우저가 그대로 읽는 ES 모듈로만 쓴다. 이 제약을 깨는 변경은 하지 않는다.

## 실행

```
python3 -m http.server 8000
```

그리고 `http://localhost:8000` 을 연다. `index.html` 을 더블클릭하면 안 된다 — `file://` 에서는 ES 모듈과 문서 뷰어의 `fetch` 가 모두 막힌다.

## 고치기 전에 돌리는 것

```
node tests/run.mjs        # 격자 알고리즘 골든 150개
node tools/check-arch.mjs # 계층 방향과 순수성
node tools/check-docs.mjs # 문서 등록 누락과 깨진 앵커
```

셋 다 의존성이 0이고 몇 초 안에 끝난다. 고친 뒤에도 돌린다.

## 계층 규칙

한 줄로: **import 는 언제나 안쪽으로만 — `app(4) → adapters|ui|input(3) → usecases(2) → ports(1) → domain(0)`.**

이 한 줄은 외우기 위한 요약이다. `tools/check-arch.mjs` 의 `RANK` 표는 `adapters` 를 `ports` 와 같은 **rank 1** 에 두어, 어댑터가 `usecases`·`ui`·`input` 을 import 하지 못하게 막는다. 자세한 이유는 [아키텍처](docs/ARCHITECTURE.md)에 있다.

- `src/domain/` — 격자·배치·루틴·저장 포맷 규칙. 순수 함수만. `document` `window` `localStorage` `fetch` `Date` `Math.random` 을 한 글자도 쓰지 않는다. 필요하면 인자로 주입받는다.
- `src/ports/` — 계약(JSDoc typedef)과 상수. **import 가 0개다.**
- `src/usecases/` — 상태를 바꾸고 `Dirty`(무엇을 다시 그릴지)를 돌려준다. DOM 을 만지지 않고 렌더 함수를 부르지 않는다.
- `src/adapters/` — 브라우저 전역을 만지는 유일한 계층. `usecases` 는 어댑터를 import 하지 않고 주입받는다. `src/` 안에서 어댑터를 import 하는 파일은 `app/main.js` 하나뿐이다.
- `src/ui/`, `src/input/` — DOM 렌더와 제스처. **서로 import 하지 않는다.** 협력자는 `app/main.js` 가 주입한다. 유일한 예외가 `src/ui/domContract.js`.
- `src/app/` — 조립과 렌더 라우팅.

`node tools/check-arch.mjs` 가 이 규칙을 강제한다. 규칙을 우회하고 싶어지면 대개 파일 위치가 틀린 것이다.

## 동작을 바꾸는 일과 구조를 바꾸는 일을 섞지 않는다

한 커밋은 둘 중 하나만 한다. 구조를 옮기는 커밋은 골든이 그대로 통과해야 하고, 동작을 바꾸는 커밋은 골든을 함께 고친다. 섞으면 어느 쪽이 회귀인지 알 수 없다.

`tests/golden/placement-algorithms.json` 은 **현재 동작의 기록이지 옳은 동작의 정의가 아니다.** 알려진 결함도 그대로 굳어 있다. 골든이 깨지면 먼저 "내가 동작을 바꿨나"를 묻고, 의도한 변경이면 골든을 다시 만든다.

## 일부러 고치지 않은 것

`index.html` 에서 옮겨 온 코드에는 결함이 그대로 남아 있다. 목록과 이유는 [일부러 두고 온 것](docs/deviations.md)에 있다. 그중 하나를 고치려면 **동작 변경 커밋**으로 따로 내고 골든을 갱신한다. 리팩터링 커밋에 슬쩍 끼워 넣지 않는다.

## 화면에 적힌 글자

버튼·제목·플레이스홀더 문구를 바꾸면 [튜토리얼](docs/TUTORIAL.md)과 [기능 설명서](docs/FEATURES.md)가 통째로 틀린 문서가 된다. 라벨을 바꾼 변경은 두 문서를 함께 고친다. 실제로 `동작 팔레트` → `동작 목록` 개명이 문서 없이 병합된 적이 있다.

사용자에게 보이는 새 한국어 문구를 만들 때는 기존 문구의 어투를 따른다. 확인은 `confirm()` 이 아니라 버튼 라벨이 `정말요?` 로 2초 바뀌는 `confirmOnce` 방식이다.

## PR 을 내기 전에

**PR 생성과 병합 전에는 `/pre-pr-docs` 문서화 패스를 먼저 돌린다.** 코드와 문서를 같은 PR 로 낸다.

문서를 하나 더하면 `src/ui/docsRegistry.js` 에 한 줄을 더한다 — 그래야 안무표 위 도구 모음의 `문서` 버튼에서 읽힌다. 저장소에만 있는 문서는 없는 문서다. `node tools/check-docs.mjs` 가 등록 누락을 잡는다.

## 커밋

한국어로 쓴다. 제목은 `refactor(domain): …` `fix: …` `docs: …` 처럼 무엇을 했는지로 시작하고, 본문에는 **사용자 관점의 변화**와 검증 방법을 적는다. 커밋 메시지 나열이 아니라 무엇이 달라졌는지를 쓴다.
