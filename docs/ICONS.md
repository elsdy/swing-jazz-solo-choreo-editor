# 아이콘 한 벌

단추 · 단계 머리 · 스타일시트의 그림이 어디서 오고 어떻게 더하는지를 적은 한 장이다(2026-11-03, 로드맵 RM-18). 그전에는 단추 글자 앞에 그때 떠오른 이모지나 유니코드 기호(✨ 📁 ▶ ⤢ ▮)를 붙였다. 같은 줄에 컬러 그림과 흑백 기호가 섞였고, OS 마다 모양 · 크기가 달랐고, 글자색 · 테마를 따르지 않았다.

## 어디서 오나

그림은 **`index.html` 의 `<body>` 맨 앞에 숨겨 둔 `<svg id="icon-sprite">` 한 덩어리**에서만 온다. 그 안에 아이콘마다 `<symbol id="i-이름" viewBox="0 0 24 24">` 가 하나씩, 지금 54개 있다. 의존성은 늘지 않았다 — 파일을 내려받지 않고 마크업에 적었다.

- **같은 모양 규칙.** 모두 같은 viewBox(24) 이고, 칠은 symbol 에 적지 않는다. 스타일시트의 `.icon` 이 선 굵기(2) · 둥근 끝 · 색(`currentColor`)을 한 번 준다. 그래서 글자색과 테마를 그대로 따르고, 켜진 별(`.star-btn.active .icon { fill: currentColor }`)처럼 채움만 바꿀 수도 있다.
- **높이는 글자를 따른다.** `.icon` 은 `1.15em` 정사각이고 글자 줄 가운데에 맞춘다. 글자 크기 토큰(`--fs-1…5`)을 바꾸면 아이콘도 같이 커진다.
- **글자가 주인이다.** 단추는 `[svg.icon]` + `[span.lbl 글자]` 두 칸이다. 그림은 돕기만 하고, 화면 읽기 프로그램은 글자 칸을 읽는다(그림은 `aria-hidden`).

## 부르는 법

| 자리 | 꼴 | 도우미 |
|---|---|---|
| 마크업의 단추 | `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-play"></use></svg><span class="lbl">재생</span>` | — |
| JS 가 만드는 단추 | `iconLabel(btn, 'play', '재생')` — 여러 번 불러도 같다(같은 아이콘 · 글자 칸이면 글자만 간다) | `src/ui/icon.js` |
| 상태에 따라 글자가 바뀌는 단추(마이크 켜기/끄기 · 재생/멈춤 · 크게/제자리로) | `setLabel(btn, '마이크 끄기')` — 글자 칸만 간다. `textContent` 로 통째로 바꾸면 아이콘이 지워진다 | `src/ui/icon.js` |
| 글자 없이 아이콘만 있는 단추(지우기 · 이름 바꾸기 · 새 창에서 열기) | `iconOnly(btn, 'x', '이 마커 지우기')` — `aria-label` 을 달고, 툴팁이 비었으면 같은 이름을 단다. 이름이 없으면 던진다 | `src/ui/icon.js` |
| 템플릿(innerHTML) | `${iconLabelHtml('x', '닫기')}` · 아이콘만이면 `${iconHtml('pencil')}` + 단추에 `aria-label` | `src/ui/icon.js` |
| 명령(글쇠 · 단추 · 명령 찾기로 부르는 일) | 명령 등록부(`src/domain/commands.js`)의 `icon` 열. `button` 글자는 그림 글자로 시작하지 않는다 | `commandFace(id).icon` |
| 스타일시트의 `::before` · `::after`(서랍 머리 · 잠금 · 루틴 칩 · 색 견본의 고른 표시) | `content: ""` 에 `--mask: var(--icon-chevron-right)` — 칠은 공통 규칙이 `background-color: currentColor` 와 `mask` 로 한다 | `installIconMasks(document)` |
| 영상 패널 단계 머리 | `data-icon="music"` — 스프라이트 이름이다(글자가 아니다) | `iconLabel(el, el.dataset.icon)` |

스타일시트는 `<use>` 를 부를 수 없다. 그래서 부팅 때 `installIconMasks` 가 스프라이트의 symbol 마다 `--icon-이름` 마스크(data URI)를 `:root` 에 단다 — 경로를 CSS 에 두 번 적지 않는다. 어댑터(`clockPlayer` 의 「영상 없이 박자로 재생」)처럼 ui 도우미를 import 할 수 없는 자리도 이 마스크로 그린다.

## 이름 목록

| 이름 | 뜻 · 쓰는 자리 |
|---|---|
| `play` · `pause` · `play-pause` · `square` | 재생 · 멈춤 · 재생/멈춤 명령 · 그만(네모) |
| `square-check` · `mark` · `circle` · `circle-dot` · `dot` | 고름 · 끊기 · 영상 목록의 고르기(빈 동그라미 / 지금 보는 것) · 받는 중 · 단계 머리의 빈자리 |
| `sparkles` · `sparkle` · `mic` · `music` · `settings` | 말로 채우기 · 추가 & 배치 · 마이크 · 프레이즈와 박자 · 설정 |
| `folder` · `folder-open` · `film` · `scissors` · `person` | 영상 파일 열기 · 폴더 고르기 · 고른 대목 잘라 내보내기 · 자르기 · 자세 분석 |
| `pencil` · `x` · `copy` · `merge` · `clipboard` · `download` · `printer` | 편집 · 닫기와 지우기 · 뒤에 복사 · 옆과 합치기 · 텍스트 시트 복사 · 읽기 전용 HTML · 인쇄 |
| `maximize` · `minimize` · `pip` · `swap` · `external` · `link` | 크게 · 제자리로 · PiP · 반대쪽 구석으로 · 새 창에서 열기 · 링크 |
| `hand` · `menu` · `skip-back` · `repeat` · `flip` · `bell` | 직접 놓기 · 동작 목록 · 처음으로 · 반복 · 미러 · 카운트 소리 |
| `arrow-left` · `arrow-right` · `arrow-up` · `arrow-down` | 1카운트 당기기/밀기 · 다음 단계로 · 정렬 방향 |
| `chevron-right` · `chevron-down` · `plus` · `minus` · `grip` | 접힌/펼친 서랍 · 더하기/빼기 · 끌 손잡이 |
| `check` · `star` · `flag` · `target` · `lock` · `lock-open` · `alert` | 고른 색 · 즐겨찾기 · 단계 머리 · 스크롤 잠금 · 담기 경고 |

## 새 아이콘을 더할 때

1. `index.html` 의 스프라이트에 `<symbol id="i-이름" viewBox="0 0 24 24">…</symbol>` 를 더한다. 칠 · 굵기 속성은 적지 않는다(`fill="none"` 으로 빈 도형을 두는 것만 된다).
2. 아래 Lucide 에서 모양을 찾으면 그 경로를 베끼고, 없으면 같은 굵기(2) · 둥근 끝으로 24 격자에 그린다.
3. 부르는 쪽은 위 표의 도우미로 부른다. `tests/unit/icon.test.mjs` 가 스프라이트에 없는 이름을 부르면 붉어진다.
4. 라벨 앞에 그림 글자를 다시 붙이면 원칙 검사기가 붉어진다([개발 원칙 U-19](PRINCIPLES.md#u-19)).

일부러 기호 그대로 둔 것: 단계 번호(①②③), 경고 문장의 ⚠(단추 라벨이 아니라 문장이다), 데이터 글자(`박자 × 행` · `1×` 배속 · 화살표 → 로 적는 흐름), 안무표 비고의 루틴 표시 `▶ 이름`(텍스트 시트 · 골든이 지키는 출력), 로드맵 보드가 띄우는 `🧭 로드맵` 위젯(앱의 코드가 아니다), 서버의 관리 화면 `admin.html`(앱을 불러오지 않는다).

## 라이선스

모양은 [Lucide](https://lucide.dev)(ISC 라이선스, 일부는 Feather 의 MIT)에서 필요한 것만 따라 적었고, 줄이거나 합친 것(`mark` · `pip` · `merge` · `swap` 등)도 있다. 앞으로 상용으로 낼 때(로드맵 M3)도 아래 문구를 함께 두면 된다.

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee
is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING
OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
