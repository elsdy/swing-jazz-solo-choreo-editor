# 아키텍처

이 문서는 `src/` 가 어떤 계층으로 나뉘어 있고 왜 그렇게 나뉘었는지를 적는다. 코드를 고치러 왔을 때 "어디를 건드려야 하는가"와 "이 코드를 여기에 두어도 되는가"에 답하는 것이 목적이다. 무엇을 만드는 도구인지는 [프로젝트 소개](../README.md)에, 작업 규칙은 [개발 지침](../CLAUDE.md)에 있다.

## 먼저 실행부터

빌드 도구도 번들러도 npm 의존성도 없다. 브라우저가 그대로 읽는 ES 모듈이 전부다. 대신 `index.html` 을 더블클릭해서는 열리지 않는다 — `file://` 에서는 브라우저가 ES 모듈 로딩과 문서 뷰어의 `fetch` 를 모두 막는다.

```
python3 server.py
```

그리고 `http://localhost:8000` 을 연다. `server.py` 는 저장소를 정적으로 내주면서 영상 클립 API 를 얹은 것이고, 앱 자체는 정적 파일을 내주는 무엇으로 열어도 된다(그때는 영상 보관이 브라우저 폴더 방식으로 떨어진다).

고치기 전과 후에 이 넷을 돌린다. 넷 다 의존성이 0이고 몇 초 안에 끝난다.

```
node tests/run.mjs                     # 격자 알고리즘 골든 150개
node --test 'tests/**/*.test.mjs'      # 도메인·어댑터·유스케이스 단위 66개
node tools/check-arch.mjs              # 계층 방향과 순수성
node tools/check-docs.mjs              # 문서 등록 누락과 깨진 앵커
```

둘의 역할이 다르다. 골든은 **격자 알고리즘의 현재 동작**을 기록한 것이라 undo·링크·영상처럼 격자 밖의 일은 지켜 주지 못한다. 그쪽 안전망이 단위 테스트다.

## 의존 규칙 한 줄

**import 는 언제나 안쪽으로만 — `app(4) → adapters|ui|input(3) → usecases(2) → ports(1) → domain(0)`.**

같은 rank 3 끼리는 서로 import 하지 않는다. `ui` 와 `input` 은 서로를 모르고, 협력자는 `app/main.js` 가 생성자 인자로 주입한다. 예외는 `src/ui/domContract.js` 하나 — 셀렉터·클래스명·dataset 키 상수만 든 공유 리프라서 `input/**` 여섯 파일이 직접 import 한다.

주입이 규칙의 핵심이다. 예를 들어 팔레트 카드의 dragstart 는 원래 `state.drag` 와 `reState.drag` 에 같은 객체를 대입해 뷰와 입력이 한 덩어리였다. 지금은 `createPaletteView({ store, commands, attachCardInput, render })` 처럼 뷰가 협력자를 **받는다**. `attachCardInput` 은 `src/input/paletteInput.js` 가 만들고 `app/main.js` 가 넘긴다. 그래서 계층 교차 import 가 사라졌고 체커가 실제로 통과한다.

한 가지 정확히 해 둘 것이 있다. 위 한 줄은 외우기 위한 요약이고, `tools/check-arch.mjs` 의 `RANK` 표는 `adapters` 를 `ports` 와 같은 **rank 1** 에 둔다. 그래야 어댑터가 `usecases`·`ui`·`input` 을 절대 import 하지 못한다. 어댑터는 포트를 구현하는 가장 안쪽 껍데기이지, ui 와 나란한 바깥층이 아니다. 실제로 오늘 `src/adapters/**` 를 import 하는 파일은 `src/app/main.js` 하나뿐이다 — 어댑터는 조립 지점에서만 소비된다.

## 계층

| 계층 | 무엇을 담는가 | 무엇이 금지인가 | 대표 파일 |
|---|---|---|---|
| `src/domain/` (0) | 격자·레인·배치 전이·카테고리·루틴·저장 포맷·템포. 전부 순수 함수이고 값을 돌려준다 | 브라우저 전역 전부, `Date`, `Math.random`, 타이머, `structuredClone`. 도메인 밖 import | `grid.js` `lanes.js` `boardOps.js` |
| `src/ports/` (1) | 바깥 세계와의 계약(JSDoc typedef)과 상수, 결정적 널 구현 | import 가 0개다. 구현을 참조하지 않는다 | `env.js` `storage.js` `media.js` |
| `src/adapters/` (1) | 브라우저 전역을 만지는 유일한 계층. `localStorage`·파일·`fetch`·`prompt` | `usecases`·`ui`·`input`·`app` import | `browser.js` `localStore.js` |
| `src/usecases/` (2) | 저장소를 갱신하고 `Dirty`(무엇을 다시 그릴지)를 돌려준다. 포트는 주입받는다 | DOM 접근, 렌더 함수 호출, 어댑터 import | `store.js` `boardCommands.js` |
| `src/ui/` (3) | DOM 렌더. 상태를 읽어 엘리먼트를 만든다 | `input/**` import(`domContract.js` 제외), 커맨드 직접 import | `boardView.js` `paletteView.js` |
| `src/input/` (3) | 포인터·터치·키보드 제스처와 이벤트 위임 | `ui/**` import(`domContract.js` 제외), 커맨드 직접 import | `boardController.js` `hitTest.js` |
| `src/app/` (4) | 조립과 렌더 라우팅. 뷰를 아는 유일한 곳 | — | `render.js` |
| `src/testing/` (4) | 골든 러너가 도메인·유스케이스 위에 올려 쓰는 어댑터. 앱은 이 계층을 import 하지 않는다 | — | `golden-adapter.mjs` |

## 자동 검사 — `node tools/check-arch.mjs`

이 스크립트가 잡는 것은 다섯 가지다.

- **방향이 거꾸로인 import** — 안쪽 rank 가 바깥 rank 를 부르면 실패한다.
- **금지된 같은 rank 쌍** — `ports → adapters`, `ports → ports`, `usecases → adapters`, `domain → ports`.
- **rank 3 교차** — `ui ↔ input`. 예외 목록은 `src/ui/domContract.js` 한 줄뿐이다.
- **순수성** — `domain`·`ports`·`usecases` 안에서 `document` `window` `localStorage` `fetch` `alert` `prompt` `confirm` `navigator` `setTimeout` `Date` `Math.random` `crypto` `performance` 등을 쓰면 실패한다. 주석·문자열·정규식 리터럴은 먼저 지우고 검사하므로 오탐이 없다.
- **외부 패키지 import** — 상대 경로가 아니면 실패한다. 이 프로젝트는 npm 의존성이 0이다.

리뷰가 아니라 스크립트가 지켜야 하는 이유는 위반이 **눈에 안 띄기 때문**이다. `domain` 에 `Date.now()` 한 줄이 들어가면 코드는 잘 돌고 리뷰도 통과한다. 대신 골든 테스트가 실행 시각에 따라 조용히 흔들리기 시작하고, 그때는 원인이 어느 줄인지 알 수 없다. 방향 위반도 마찬가지다 — `ui` 가 `input` 을 한 번 import 하는 순간 그 다음 사람은 두 번 하고, 두 계층은 다시 한 덩어리가 된다. `--list` 를 붙이면 각 파일의 계층과 import 를 그대로 나열한다.

## 상태가 화면에 닿는 길 — Dirty 규약

옮겨 오기 전 `index.html` 에는 `render*()` 호출이 143곳 흩어져 있었다. `renderPalette` 31곳, `renderRows` 19곳, `renderBoard` 17곳 같은 식으로, 배치를 계산하는 함수가 계산이 끝나면 자기가 직접 화면을 그렸다. 그래서 격자 규칙 하나를 고치려면 DOM 을 함께 읽어야 했다.

이 사슬을 끊은 방법은 프레임워크도 옵저버도 시그널도 아니다. **"무엇을 다시 그릴지"를 값으로 만들어** 호출부로 끌어올렸다. 도메인 함수는 `{ placements, renderRows, changedRows }` 를 돌려주고, 유스케이스는 그것을 `Dirty` 로 바꿔 돌려주며, `src/app/render.js` 의 presenter 하나가 그 값을 뷰 호출로 번역한다. 구독 API 는 일부러 만들지 않았다.

### Dirty 타입 전문

`src/usecases/store.js` 의 typedef 다(JSDoc 주석 기호만 걷어냈다).

```
BoardDirty = { rows?: number[] or 'all', skeleton?: true }

Dirty = {
  layout?: true,
  boards?: { main?: BoardDirty, routine?: BoardDirty },
  selection?: true,
  palette?: true, legend?: true, categorySelect?: true, categoryManager?: true,
  routineList?: true, routineEditor?: true,
  savedLists?: ('projects' or 'moves' or 'categories')[],
  links?: true, toolbar?: true, history?: true,
  notify?: { kind: 'alert', message: string }
}
```

같은 파일의 `NONE` 이 "다시 그릴 것 없음"이고, `mergeDirty(a, b)` 가 둘을 합친다(rows 합집합, `'all'` 이 흡수, 불리언 OR, `savedLists` 합집합, `notify` 는 나중 것이 이긴다). `assertDirty` 는 알 수 없는 키를 보면 던진다 — 오타 하나로 화면이 조용히 안 그려지는 것을 막는 장치이고, DEV 경로에서만 켠다.

### 렌더 순서와 그 근거

`src/app/render.js` 의 `apply` 는 언제나 같은 순서로 돈다: **layout → boards → selection → 나머지 패널 → notify**.

- **`layout` 이 가장 먼저다.** 원본 `applyBoardSizeFromInput` 은 CSS 변수를 쓰는 `updateMobileCellSize()` 를 부른 **다음에** `renderBoard(true)` 를 부른다. 순서를 뒤집으면 낡은 `--cellW` 로 보드 골격이 서고, `--noteW` 를 `scrollWidth` 로 재는 계산이 한 프레임 어긋난다.
- **`boards` 는 `BOARD_IDS` 고정 순서로 순회한다.** `skeleton` 이 있으면 골격을 다시 세운 뒤 행을 그린다.
- **`notify` 는 언제나 마지막이다.** `부분 불러오기` 가 끝나고 뜨는 `병합 완료:` 로 시작하는 알림은 렌더가 끝난 뒤에 떠야 원본과 같은 순서가 된다. 그래서 이 문구만 `Dirty.notify` 에 실린다. 반대로 `잘못된 프로젝트 파일 형식입니다.` 는 즉시 떠야 하므로 `usecases/projectCommands.js` 가 `dialogs.alert` 를 직접 부른다.

#### `selection` 이 왜 보드 rows 가 아닌가

선택 표시는 오늘 두 경로로 유지된다. 클릭 핸들러가 `.placement` 노드의 클래스를 직접 토글하고, 재렌더가 일어나면 `createPlacementEl` 이 `store.selection` 을 읽어 복원한다. 그래서 presenter 도 `views.board.main.setSelected(store.selection)` 로 **클래스만** 토글한다(`src/ui/boardView.js` 의 `setSelected`).

행 렌더로 대체하면 클릭 한 번마다 그 행의 `.placement` 가 전부 파괴·재생성되고, 그 순간 드래그·툴팁·포커스 동작이 달라진다. 터치 드래그 중 DOM 재생성이 시퀀스를 끊는 부류의 회귀는 이미 겪은 적이 있다([개발 원칙 U-7](PRINCIPLES.md#u-7)). presenter 는 바뀐 것만이 아니라 **선택 집합 전체**를 넘긴다.

#### `categoryManager` 가 왜 `categorySelect` 와 별개인가

원본 `renderCategoryOptions` 는 **무조건** `renderCategoryManager()` 를 부른다. 그런데 카테고리 색상 슬라이더의 `input` 핸들러는 범례·팔레트·두 보드만 갱신하고 관리 행은 **일부러 다시 그리지 않는다**. 매 `input` 마다 다시 그리면 `<input type="color">` 가 파괴되어 네이티브 색상 피커가 첫 드래그에서 닫히기 때문이다.

그래서 플래그를 둘로 나눴다. presenter 는 `categorySelect` 를 볼 때 `renderOptions()` 와 `renderManager()` 를 **둘 다** 불러 원본의 사슬을 재현하고, `categoryManager` 만 있으면 관리 행만 그린다. 반대 방향은 없다. `usecases/categoryCommands.js` 의 `previewColor` 가 돌려주는 Dirty 에는 `legend`·`palette`·`boards` 만 있고 `categoryManager` 가 없다. `src/ui/categoryView.js` 는 이 규칙을 파일 상단 ①②에 못박아 두었다 — 뷰 안에서 `renderOptions` 가 `renderManager` 를 부르지 않는다.

#### `boards` 가 왜 맵인가

두 보드가 **동시에** 더러워지는 경로가 실제로 있다.

- `usecases/categoryCommands.js` 의 `previewColor` — 루틴 편집기가 열려 있으면(`session.editingRoutineId`) `boards.routine` 을 함께 켠다. 색을 바꾸면 두 보드의 블록 색이 같이 바뀌어야 한다.
- `usecases/routineCommands.js` 의 `syncFromEditor` — 루틴 편집을 커밋하면 메인 보드에 놓인 그 루틴 블록이 다시 분배된다. 편집기는 그대로인데 메인 보드의 특정 행들이 바뀐다.

보드마다 `rows` 와 `skeleton` 이 따로 필요하므로 불리언 하나로는 표현할 수 없다.

### 이 흐름을 타지 않는 것

드래그 프리뷰, 고스트, 툴팁, 그리고 재생 헤드는 Dirty 를 거치지 않는다. 60fps 로 움직이는 것을 상태 전이로 만들면 undo 히스토리와 렌더가 오염된다. `src/ui/overlays.js` 가 제스처 상태를 직접 받아 **자기가 만든 엘리먼트의 인라인 스타일만** 바꾸고, 커밋은 제스처가 끝날 때 딱 한 번 유스케이스로 들어간다.

링크바도 예외다. `src/ui/linksBarView.js` 의 입력 핸들러는 원본이 전부 부분 렌더였기 때문에 presenter 를 거치지 않는다. presenter 가 부르는 `render(links)` 는 프로젝트 불러오기·`전체 초기화` 처럼 바깥에서 값이 통째로 바뀔 때만 쓴다.

### 휘발성 렌더 채널 — 재생 헤드는 Dirty 를 타지 않는다

재생 헤드(2026-09-09)는 위 예외들과 **종류가 다르다.** 드래그 프리뷰는 사람의 손가락이 움직이는 동안에만 살아 있고 끝나면 커밋된다. 재생 헤드는 **아무도 아무것도 하지 않는 동안 계속 움직이고, 끝나도 커밋할 것이 없다.** 그래서 이 앱에 처음으로 "상태가 아닌 것을 그리는 상설 루프" 가 생겼고, 그 경계를 여기 적어 둔다.

채널이 둘이다.

| | 채널 A — 도메인 | 채널 B — 휘발성 |
|---|---|---|
| 무엇이 흐르나 | bpm·앵커 확정, 소스 변경, 패널 열림/접힘 | 재생 위치, 지금 지나가는 블록 |
| 경로 | 커맨드 → store → Dirty → `app/render.js` → 뷰 | `ui/playhead.js` 의 rAF 루프 → 자기 엘리먼트와 블록의 클래스 하나 |
| 얼마나 자주 | 사람이 확정할 때 | 초당 60번 |
| store 를 만지나 | 쓴다 | **읽지도 않는다** (주입된 게터로만 본다) |
| undo 에 남나 | 남는다(`media` 는 `UNDO_FIELDS` 안) | 남지 않는다 |
| DOM 쓰기 | 뷰 전체 재구성 가능 | `el.style.transform` · `el.hidden` · 블록의 `is-playing` 클래스 **셋뿐** |

채널 B 를 A 로 합치면 초당 60회 전체 재렌더가 된다. 그것만이 이유가 아니다 — 재생 위치가 store 에 들어가는 순간 undo 스택이 재생 위치로 가득 차고, 저장 파일에 "그때 어디까지 봤는지" 가 섞여 들어간다. **재생 위치는 상태가 아니라 관측값이다.**

그 경계를 코드가 어떻게 지키는지가 중요하다.

- `usecases/videoCommands.js` 에는 `currentSec` 도 `playing` 도 **없다.** 단위 테스트가 store 를 JSON 으로 훑어 그런 키가 없음을 직접 단언한다.
- 어댑터는 시각을 이벤트로 밀지 않고 **표본**(`{sec, atMs, rate, playing}`)으로 들고만 있는다. `ports/media.js` 의 `projectTime(sample, nowMs, duration)` 이 그것을 매 프레임 보간한다 — 순수 함수라 계층을 넘지 않는다.
- 움직임은 `left` 가 아니라 `transform: translateX()` 다. 칸 폭은 `--cellW` 를 읽지 않고 `track.getBoundingClientRect().width / cols` 로 재되 **행이 바뀔 때·리사이즈·패널 개폐에만** 재고 캐시한다(매 프레임 재면 강제 리플로가 초당 60번이다).
- 헤드는 현재 행의 `.track` 안에 살고 8카운트에 한 번만 자리를 옮긴다. `boardView.renderRow` 는 `.placement` 만 걷어내므로 행 재렌더에서 살아남고, 골격 재생성(`innerHTML=''`)으로 끊기면 다음 프레임이 `el.parentElement !== track` 을 보고 다시 붙인다.
- 재생 위치가 지나가는 블록의 `is-playing` 도 이 채널이 붙였다 뗀다. "지금 어느 블록인가"는 재생 위치의 함수이지 상태가 아니므로 store 에 들어가지 않는다. 토글은 **칸이 바뀔 때만** 하고(초당 60번이 아니라 카운트마다 한 번), 헤드가 같은 칸에 멈춰 있는 동안 블록이 다시 그려지면 `app/render.js` 가 `views.playhead.invalidate()` 로 캐시를 버려 다음 프레임이 다시 계산한다 — 렌더러는 헤드를 그리지 않고 "네 캐시가 낡았다"고만 알린다.

실제로 그런지는 브라우저에서 잰다. 재생 중 `#board` 에 `MutationObserver` 를 걸면 **`.playhead` 의 `style`·`hidden` 과 `.placement` 의 `class`(카운트마다 한 번) 말고는 아무 변화도 찍히지 않는다** — 배치의 위치도, 트랙도, 패널도 그대로다. 이 관찰이 이 절의 유일한 증거다.

## `board.rows` 는 행 개수가 아니다

**`board.rows` 는 마지막 행 인덱스다.** 메인 보드는 intro 행(row 0)이 있어 실제 행이 `rows + 1` 개, 루틴 편집 보드는 `rows` 개다. 이 함정 때문에 `src/domain/grid.js` 상단에 경고 블록이 박혀 있다.

이름이 정직하지 않은데도 `lastRow` 로 고치지 않은 이유는 두 가지다.

- **저장 포맷의 키가 `rows` 다.** 프로젝트 JSON, 동작 목록 파일, 루틴 객체가 모두 이 키를 쓴다. 필드명을 바꾸면 마이그레이션이 필요해지고, 이미 사람들이 주고받은 파일이 전부 구버전이 된다.
- **`boardSignature` 의 캐시 키가 `${cols}x${rows}` 다.** 이 문자열이 보드 골격을 다시 세울지 판정하는 값이라, 형식이 바뀌면 재빌드 조건이 달라진다.

대신 필드를 직접 읽지 말고 파생 함수 셋으로만 다룬다. 셋 다 `src/domain/grid.js` 에 있다.

| 함수 | 무엇을 돌려주나 | 무엇을 대체했나 |
|---|---|---|
| `firstRowIndex(board)` | 첫 행 인덱스. 메인 `0`, 루틴 `1` | intro 유무 분기 |
| `rowIndices(board)` | 전체 행 인덱스 배열. 메인 `[0, 1..rows]`, 루틴 `[1..rows]` | `ctx === mainCtx ? [0, ...] : [...]` 4곳 |
| `rowCount(board)` | 실제 행 개수. 메인 `rows + 1`, 루틴 `rows` | `renderBoard` 의 `expectedSize` |

이 함정 덕에 얻은 것도 있다. `totalCellsFrom(row, startIndex, board) = (rows - row) * cols + (cols - startIndex)` 라는 **한 식이 두 보드에서 다 맞는다.** intro 행을 행 개수에 세지 않기 때문이다.

## 카운트 축

격자의 1급 좌표는 (행, 칸) 쌍이 아니라 **선형 카운트** 하나다. `src/domain/grid.js` 의 두 줄이 그 축이다.

```
export const linearOf = (row, index, cols) => (row - 1) * cols + index;
export const cellOf   = (n, cols) => ({ row: Math.floor(n / cols) + 1, index: ((n % cols) + cols) % cols });
```

원점을 row 1 의 0카운트로 잡은 것이 핵심이다. 그러면 **intro 행(row 0)이 `[-cols, -1]` 구간으로 분기 없이 떨어진다.** intro 를 위한 `if` 가 필요 없고, intro 가 없는 루틴 편집 보드(1..rows)에도 같은 식이 그대로 맞는다. `cellOf` 의 나머지 연산이 `((n % cols) + cols) % cols` 인 것도 음수 구간을 위해서다.

⚠ `totalCellsFrom` 과 `calcCrossRowCount` 는 이 축으로 다시 유도하지 않고 원본 식을 글자 그대로 옮겼다. 이 앱에서 산술 오류가 가장 치명적인 두 줄이라, 골든이 초록이 된 뒤에 갈아탈 일이다.

이 축의 반대편이 `src/domain/tempo.js` 다. 동영상은 **없던 축을 추가하는 일이 아니라 이미 있는 축에 곱셈 한 겹을 얹는 일**이다.

```
secondsPerCount(tempo) = (60 / tempo.bpm) * tempo.beatsPerCount
countToTime(count, tempo) = tempo.anchorSec + (count - tempo.anchorCount) * secondsPerCount(tempo)
```

`cellToTime(row, index, cols, tempo)` 는 `countToTime(linearOf(row, index, cols), tempo)` 한 줄이다. intro 행이 음수 카운트이므로 시각도 앵커 이전으로 그대로 나간다. 그 처리를 어떻게 할지는 아직 안 정했다 — [로드맵](ROADMAP.md)의 미결정 사항에 있다.

## 메인 보드와 루틴 편집기

두 보드는 원래 코드가 두 벌이었다. `state` 와 `reState`, `mainCtx` 와 `reCtx`, 빠른 배치 팝업이 네 함수 646줄로 복제돼 있었고, 한쪽만 고쳐 다른 쪽에 버그가 남는 일이 반복됐다([개발 원칙 R-2](PRINCIPLES.md#r-2)).

지금은 한 벌이다. 두 보드는 `store.boards.main` / `store.boards.routine` 두 값 객체이고, 도메인 함수에 넘기는 통로가 `boardOf(state, boardId)` 하나다. 원본에 14곳 있던 `ctx === mainCtx` 분기 중 "격자 형태"에 해당하는 것은 `grid.rowIndices` 가 흡수했고, "보드의 역할"에 해당하는 것은 `usecases/store.js` 의 `BOARD_POLICY` 표가 데이터로 대신한다.

| 정책 키 | 메인 `main` | 루틴 편집기 `routine` | 어디가 읽나 |
|---|---|---|---|
| `hasIntroRow` | `true` — row 0 이 있다 | `false` | `grid.rowIndices` / `grid.rowCount` |
| `allowsRoutineBlocks` | `true` — 루틴 블록을 놓을 수 있다 | `false` | `input/boardController.js` 의 drop·dblclick·터치 4곳 |
| `allowsSelection` | `true` | `false` — `.is-selected` 가 아예 안 붙는다 | `ui/placementView.js`, `usecases/boardCommands.js` |
| `overflowRows` | `drop` — 행 밖 배치를 **삭제**한다 | `keep` — 숨길 뿐 남긴다 | `grid.clampToGrid` |
| `snapshotKind` | `main` | `routine` | `domain/project/snapshot.js` 의 `applySnapshot` |

`overflowRows` 의 비대칭이 특히 눈에 안 띈다. 메인 보드의 행 수를 줄이면 격자 밖 배치가 사라지고 되돌릴 수 없다. 루틴 편집 보드에서 같은 일을 하면 배치는 남아 있다가 행을 다시 늘리면 되살아난다. 두 규칙 다 원본 동작이고, 어느 쪽이 옳은지는 아직 정해진 바가 없다.

빠른 배치 팝업은 `src/ui/quickPicker.js` 한 벌로 합치되 **노브 다섯 개**로 차이를 남겼다. 제목이 `동작 선택` 과 `동작 선택 (루틴)` 으로 다르고, 키보드 내비게이션·엔터 힌트·`+` 버튼 강조·카테고리 화면 자동 강조가 루틴 쪽에는 없다. `MAIN_OPTIONS` 가 기본값이고 `ROUTINE_OPTIONS` 가 뒤집는 값이다.

## 파일 지도

`node tools/check-arch.mjs --list` 가 이 표와 같은 것을 계층·import 와 함께 출력한다.

### `src/domain/` — 순수 규칙

| 파일 | 책임 |
|---|---|
| `grid.js` | 격자 기하와 카운트 축. `rowIndices` `totalCellsFrom` `buildSegments` `clampToGrid` |
| `lanes.js` | `subRow`(레인) 규칙 전담. `overlaps` `findFreeLane` `clearSegmentsArea` `repackLanes`. `clearSegmentsArea` 는 2026-09-07 이후 운영 경로에서 호출되지 않는다 — 정책 플래그로만 살아나는 가지이고 골든 `clear-*` 가 직접 검사한다 |
| `placements.js` | placement 질의와 생성. `makeSegmentPlacements` 가 키 순서를 고정하는 유일한 팩토리 |
| `boardOps.js` | 배치 전이 6개(놓기·루틴 블록·이동·복사·리사이즈·삭제)와 그 정책 상수 |
| `categories.js` | 카테고리 사전 트랜잭션과 색 판정. `deriveKey` `resolvePlacementColor` `textColorOn` `contrastRatio` `darken` |
| `moves.js` | 동작 라이브러리 트랜잭션과 팔레트 검색·정렬 파이프라인 |
| `routines.js` | 루틴 값 객체와 변환. `buildFromSelection` `redistributeBlocks` |
| `gestureMath.js` | 제스처 판정의 순수 부분. `resolveDragCount` 의 `lowerBound` 가 곳마다 다른 하한을 담는다 |
| `links.js` | YouTube URL 정규화와 커스텀 링크 목록 규칙 |
| `defaults.js` | 초기값만. `makeDefaultMoves(ids)` 가 uid 소비 순서를 결정적으로 만든다 |
| `tempo.js` | 카운트 ↔ 초 변환. 카운트 축에 얹는 곱셈 한 겹. 2026-09-09 부터 영상 패널이 실제로 쓴다 |
| `choreoPlan.js` | LLM 플랜(`server.py` PLAN_SCHEMA) → 격자 항목. 이름을 동작 목록과 느슨하게 맞추고(공백·대소문자 무시, 3글자 이상 포함), 마디를 넘는 카운트를 다음 마디로 넘기며, 못 쓰는 항목은 버린 이유와 함께 남긴다 |
| `project/schema.js` | 저장 포맷 상수와 필드 목록. 로직이 없고 import 도 0개. `UNDO_FIELDS` 와 `DOC_FIELDS` 는 같은 집합이다(`rows` `cols` `placements` `moveLibrary` `categories` `routines` `links` `media`, 순서만 다르다) — 파일과 undo 가 같은 것을 상태로 본다 |
| `project/media.js` | 영상 블록(`{tempo, source}`)의 정규화·직렬화. **비어 있으면 `serializeMedia` 가 `null` 을 돌려주고 파일에서 키가 통째로 빠진다** — 영상을 안 쓴 사용자의 저장 파일은 이 기능 전과 바이트가 같다. 로직이 있어야 해서 `schema.js`(import 0개 리프)가 아니라 여기다 |
| `project/serialize.js` | 파일로 내보낼 페이로드 조립 |
| `project/normalize.js` | 불러온 데이터의 정규화·클리핑 |
| `project/merge.js` | `부분 불러오기` 의 전 알고리즘 |
| `project/migrations.js` | 저장 포맷 마이그레이션 |
| `project/snapshot.js` | undo 스냅샷과 문서 복제. `snapshotMain` `snapshotRoutine` `applySnapshot` `toLinkBundle`. 링크만 값 복제다 — 스냅샷이 store 와 `customLinks` 배열을 공유하면 안 된다 |

### `src/ports/` — 계약

| 파일 | 책임 |
|---|---|
| `env.js` | 난수·시계·대화상자의 계약과 결정적 구현(`counterEnv` `silentDialogs`) |
| `storage.js` | 영속 저장소 계약. `STORAGE_KEYS` 와 `StorageError` |
| `media.js` | 재생기와 외부 시퀀스 엔진의 계약. `normalizeEngineSession` 이 불량 엔진을 흡수한다 |

### `src/adapters/` — 브라우저 접점

| 파일 | 책임 |
|---|---|
| `browser.js` | uid·대화상자·파일 읽기/내려받기·`debounce`·`longPress` |
| `localStore.js` | `localStorage` 7키의 유일한 창구. 최근 목록·즐겨찾기·링크 |
| `youtubeOembed.js` | YouTube oEmbed 제목 조회 |
| `nullMediaPlayer.js` | 소스 없음을 정상 상태로 표현하는 재생기 |
| `media/youtubePlayer.js` | YouTube IFrame API 를 `MediaPlayer` 계약으로 감싼다. **이 앱의 첫 외부 스크립트 의존**이라 실패를 예외가 아니라 상태로 다룬다 — 스크립트가 막히면 `getState().load === 'error'` 이고 한국어 문구는 뷰가 만든다. 생성만으로는 DOM 도 네트워크도 안 건드린다 |
| `llmServer.js` | `server.py` 의 LLM 중계 클라이언트(`/api/llm/*`). 브라우저는 모델을 직접 부르지 않는다 — 키가 브라우저에 가면 안 되고 로컬 LLM 은 CORS 에 막힌다. 어떤 함수도 던지지 않는다 |
| `clipServer.js` | `server.py` 의 클립 API 클라이언트. 서버가 있는지 `probe` 하고, 업로드(`PUT /api/clips`, 본문이 파일 바이트라 multipart 가 없다)·존재 확인·재생 URL(`/clips/<path>`)을 준다. 어떤 함수도 던지지 않는다 — 서버가 없으면 null 이고 `app/main` 이 브라우저 폴더 방식으로 떨어진다 |
| `clipLibrary.js` | 영상 보관 폴더(브라우저 방식). File System Access API 의 폴더 핸들을 IndexedDB 에 남기고 `<subdir>/<프로젝트>/<파일>` 로 복사·재읽기한다. 경로 규칙은 `domain/clips.js` 가 정하고 여기서는 이름을 만들지 않는다. 지원하지 않는 브라우저에서는 "없음"으로 답한다 |
| `media/filePlayer.js` | 로컬 영상 파일을 `<video>` 로 재생하는 `MediaPlayer`. blob URL 을 만들지 않는다 — 만든 쪽(`app/main`)이 revoke 까지 책임지므로 여기 들어오는 것은 이미 만들어진 `{kind:'file', url}` 뿐이다. 덕분에 node 에서 가짜 document 하나로 전 경로를 검사한다 |
| `media/pickPlayer.js` | URL 또는 `MediaSource` → 재생기 종류(`youtube`/`file`/`null`). `domain/links.parseYoutubeUrl` 을 재사용하고 언제나 완전한 `MediaPlayer` 를 돌려준다(호출부에 `player?.` 가 생기지 않는다) |

### `src/usecases/` — 상태 전이

| 파일 | 책임 |
|---|---|
| `store.js` | 단일 저장소, `BOARD_POLICY`, `Dirty` 타입, `mergeDirty`, `boardOf`, `expandRows` |
| `boardCommands.js` | 보드 전이·보드 크기·선택·빠른 배치 토글. 선택 집합의 소유자 |
| `paletteCommands.js` | 동작 CRUD·즐겨찾기·검색/정렬·활성 동작 |
| `categoryCommands.js` | 카테고리 추가·색 미리보기/확정·이름 변경·삭제 |
| `routineCommands.js` | 루틴 CRUD 와 편집기 세션(`openEditor` `syncFromEditor` `setRoutineSize`) |
| `projectCommands.js` | 저장·불러오기·`부분 불러오기`·최근 목록 |
| `linkCommands.js` | 링크바 상태 전이와 제목 조회 상태머신 |
| `videoCommands.js` | 영상 패널 상태·두 점 앵커·탭 템포·소스 확정·`clearMedia`. **DOM 도 플레이어도 시계도 모른다** — 시각(초)은 전부 인자로 들어온다(`check-arch` 가 `performance` 를 막는다). 재생 위치·재생 상태는 여기에도 store 에도 없다 |
| `planCommands.js` | 플랜 미리보기와 채우기. 새 배치 경로를 만들지 않고 `paletteCommands.createAndPlace`(빠른 동작 생성과 같은 길)로 하나씩 놓는다 — 겹침·스택·클램프가 손으로 놓을 때와 같아진다. 행이 모자라면 `setBoardRows` |
| `historyCommands.js` | undo/redo 스택 1벌 × 보드 2개. 메인 스냅샷은 8필드(링크·영상 템포 포함), 루틴은 3필드. **유스케이스 중 유일하게 어댑터를 주입받는다** — `createHistory(store, { storage })` 의 `saveLinks` 로 복원한 링크를 localStorage 에 되쓴다 |

### `src/ui/` — DOM 렌더

| 파일 | 책임 |
|---|---|
| `domContract.js` | 셀렉터·클래스명·dataset 키 상수. rank 3 교차의 유일한 예외 |
| `boardView.js` | 보드 1개당 인스턴스. `rowRefs` 를 여기 가두고 `setSelected` 를 제공한다 |
| `placementView.js` | placement 1개 → DOM, 그리고 비고 칸 문자열 |
| `paletteView.js` | `동작 목록` 렌더와 카드 팩토리, 동작 컨텍스트 메뉴 |
| `categoryView.js` | 범례·카테고리 관리 행·`<select>` 세 렌더 |
| `toolbarView.js` | 메인 보드 툴바. `루틴으로 편성` 버튼의 선택 개수 표시를 갱신한다 |
| `routineEditorView.js` | 루틴 편집 패널의 표시/숨김과 툴바 컨트롤 |
| `routineListView.js` | 사이드바의 루틴 카드 목록 |
| `savedListsView.js` | 최근 프로젝트·동작목록·카테고리 세 목록 |
| `linksBarView.js` | 보드 위 링크바. 입력 경로는 presenter 를 거치지 않는다 |
| `quickPicker.js` | 빠른 배치 팝업 1벌. 노브 5개로 메인/루틴 차이를 표현 |
| `routineActionPopup.js` | 메인 보드 루틴 블록의 편집/삭제 팝업 |
| `overlays.js` | 보드 위 비영속 DOM 전부(프리뷰·고스트·툴팁) |
| `videoPanel.js` | 영상 패널 뷰(채널 A). store 를 **읽기만** 하고 커맨드는 주입받는다. 재생기 오류 코드 5종을 한국어 문구로 바꾸는 것이 이 파일의 몫이다 — 어댑터는 문구를 만들지 않는다 |
| `composeView.js` | 상단 `✨ 말로 채우기` 팝업. 음성 인식(webkitSpeechRecognition) → 다듬기 → 스키마 → 미리보기 → 채우기의 세 단. LLM 은 주입받은 어댑터로, 배치는 주입받은 유스케이스로 |
| `settingsView.js` | 상단 `⚙ 설정` 과 설정 팝업. 첫 항목이 영상 보관 폴더다. docsHub 처럼 자기 DOM·CSS 를 만들고, 어댑터는 함수로 주입받는다 |
| `playhead.js` | 안무표 위의 재생 헤드(채널 B). rAF 루프가 자기 엘리먼트의 `transform` 과, 지금 지나가는 블록의 `is-playing` 클래스만 쓴다. 렌더 파이프라인을 타지 않는 유일한 상설 루프다 |
| `layout.js` | 셸의 부작용 전부. 브레이크포인트·스크롤 락·셀 크기 동기화 |
| `cssVars.js` | `--cellW` `--cellH` `--rowLabelW` `--noteW` 의 유일한 소유자 |
| `popup.js` | 팝업 공통 부품(위치 계산, 바깥 클릭 닫기) |
| `widgets.js` | `escapeHtml` `confirmOnce` `makeInlineStarBtn` |
| `docsRegistry.js` | 앱에서 읽을 문서 목록의 유일한 주인 |
| `docsHub.js` | 앱 안에서 문서를 읽는 화면과 마크다운 렌더러 |

### `src/input/` — 제스처

| 파일 | 책임 |
|---|---|
| `boardController.js` | 보드 1개당 위임 이벤트 컨트롤러. 마우스와 터치는 서로 다른 규칙을 쓴다 |
| `controls.js` | 사이드바·툴바의 버튼/입력/파일 인풋 바인딩과 단축키 |
| `hitTest.js` | 화면 좌표 → 보드·행·칸. 보드 밖으로 나가면 앵커 트랙으로 되돌아간다 |
| `dragSession.js` | 두 보드가 공유하는 **하나의** 드래그 세션 |
| `pointerSession.js` | 동시에 하나만 존재하는 리사이즈 세션 |
| `touchDrag.js` | 보드 위 배치의 터치 이동 제스처 |
| `paletteInput.js` | 팔레트 카드의 입력 일체(드래그 시작·길게 누르기) |

### `src/app/` — 조립

| 파일 | 책임 |
|---|---|
| `render.js` | `Dirty` → 뷰 호출. 앱에서 뷰를 아는 유일한 파일이고 렌더 순서를 정한다 |

`app/main.js` 가 이 계층의 나머지 절반이다. 저장소를 만들고, 어댑터를 포트 자리에 꽂고, 뷰와 컨트롤러에 협력자를 주입하고, presenter 를 그 모두에 넘긴다. 모든 뷰와 컨트롤러의 JSDoc 이 "`app/main` 이 넘긴다"고 적어 둔 대상이 이것이다. `index.html` 은 마크업과 CSS만 갖고 이 파일 하나를 `<script type="module">` 로 부른다.

영상 재생기도 여기서만 산다. **재생기를 만드는 것은 패널이 실제로 화면에 보이는 순간**이고, 그 전에는 `pickPlayer('')` 가 준 널 재생기가 자리를 지킨다 — 패널을 한 번도 안 연 사용자에게 유튜브 요청이 나가면 안 되기 때문이다. 소스가 바뀌어도 종류(`youtube`/`file`/`null`)가 같으면 재생기를 다시 만들지 않고 `load()` 만 부른다. iframe 을 다시 만들면 로딩이 눈에 보이게 끊긴다. 로컬 파일의 blob URL 도 여기서만 산다 — `URL.createObjectURL` 을 부르는 자리는 `app/main` 하나이고, store 에는 파일명만 들어간다(파일 객체는 직렬화할 수 없고 blob URL 은 이 실행에서만 산다).

## 안전망 — 골든 150개

`tests/golden/placement-algorithms.json` 은 시나리오 150개와 그 기대값이다. 각 시나리오는 초기 보드·동작·루틴을 세운 뒤 `placeMove` `move` `copy` `rebuild` `remove` `repack` `clearArea` `merge` `boardSize` `syncRoutine` `probe` 같은 op 를 순서대로 재생하고, 끝난 뒤의 배치 배열·렌더 로그·alert 문구를 대조한다. 갈래는 `grid` 20 · `merge` 16 · `place` 15 · `resize` 15 · `move` 13 · `flow` 10 순으로 많다.

**이 파일은 옳은 동작의 정의가 아니라 현재 동작의 기록이다.** 기대값은 리팩터링 전 `index.html` 원문에서 생성했고, 알려진 결함도 그대로 굳어 있다. `copy-05-no-repack` 은 복사만 레인 재정렬을 빠뜨리는 결함을 고정한 것이고, `routine-02-place-no-clamp` 는 루틴 블록이 보드 밖으로 나가면 조용히 사라지는 것을 고정한 것이다. 무엇이 왜 그대로인지는 [일부러 두고 온 것](deviations.md)에 있다.

**예외는 `meta.intentionalChanges` 에 적힌 시나리오들이다.** 결함을 고쳐 동작이 달라지면 그 시나리오의 기대값은 더 이상 원본 기록이 아니므로, 무엇을 왜 바꿨는지와 **이전 기대값이 무엇이었는지**를 그 배열에 남긴다(이름을 바꾼 시나리오는 `previousId`, 설명만 고친 것은 `previousDesc` 도 함께 — 옛 이름으로 찾아도 걸리게 하려는 것이다). 지금 세 항목이 있고 전부 2026-09-07 의 리사이즈 충돌 규칙 변경이다. 새 기대값은 손으로 적지 않고 `tests/replay.mjs` 로 재생한 실제 결과를 기록한다.

그래서 골든이 깨졌을 때 **먼저 물을 것은 "내가 동작을 바꿨나"** 다. 의도한 개선이면 골든을 손으로 고치지 말고, 무엇을 왜 바꿨는지 커밋 메시지에 남긴 뒤 새 코드 기준으로 다시 생성한다. 러너에 "다시 만들기" 기능을 일부러 넣지 않은 이유가 이것이다 — 러너가 골든을 갱신할 수 있으면 안전망이 아니다.

```
node tests/run.mjs                모두 실행
node tests/run.mjs --only=move    id 나 설명에 'move' 가 든 것만
node tests/run.mjs --list         시나리오 목록만
node tests/run.mjs --verbose      통과한 것도 한 줄씩
node tests/run.mjs --json         결과를 JSON 으로
node tests/run.mjs --strict       어댑터가 없으면 실패로 간주
```

러너는 도메인 코드를 직접 부르지 않는다. `src/testing/golden-adapter.mjs` 의 `createAdapter()` 하나만 부르고, 그 파일이 `tests/replay.mjs` 상단에 적힌 계약을 실제 모듈 위에 구현한다. 어댑터가 없으면 `PENDING` 을 알리고 0으로 끝난다 — 재구성 중에도 CI 가 붉지 않게 하기 위해서다. 브라우저에서 보고 싶으면 `tests/index.html` 을 서버로 연다.

골든이 다루지 않는 영역은 `tests/unit/domain.test.mjs` 가 받는다. undo/redo 와 링크 복원, 저장 포맷의 왕복, 색 대비의 전수 대입, 그리고 2026-09-09 부터는 영상 어댑터의 계약 충족과 "재생 위치가 store 어디에도 없다" 는 성질이 여기 있다. **시나리오 결과가 아니라 그 결과를 낳는 성질을 단언하는 것**이 이 파일의 성격이다.

DEV 쪽에도 두 겹이 더 있다. `createRenderer(store, views, { dev: true })` 를 켜면 `assertDirty` 가 알 수 없는 Dirty 키를 던지고, `assertDirtyCovers` 가 **실제로 바뀐 행이 Dirty 에 덮이지 않으면** 즉시 던진다. "덜 그리는" 회귀는 이 앱의 실제 버그 이력이라 눈으로 잡을 수 없다. 배치가 안 바뀌었는데 다시 그려야 하는 경우(선택 표시·카테고리 색)는 이 검사가 못 잡으므로 `paranoid` 옵션이 받는다.

## 여기서 무엇을 고칠 때 어디를 보나

| 하려는 일 | 손대는 곳 | 함께 할 것 |
|---|---|---|
| 격자 규칙(카운트 분할·클램프)을 바꾼다 | `src/domain/grid.js` | 골든 재생성. `grid-*` 20개가 먼저 깨진다 |
| 겹침·쌓기 규칙을 바꾼다 | `src/domain/lanes.js` | `repack-*` `clear-*` 갱신. 네 조작(놓기·이동·복사·리사이즈)이 같은 규칙을 쓰므로 `boardOps` 의 네 정책 상수를 나란히 고친다 |
| 놓기·이동·복사·리사이즈 동작을 바꾼다 | `src/domain/boardOps.js` 의 `*_POLICY` 상수 | 해당 골든 갱신. 반환값의 `renderRows` 와 `changedRows` 를 혼동하지 말 것 |
| 버튼 하나를 추가한다 | `index.html` 마크업 + `src/ui/*View.js` + `src/input/controls.js` | 셀렉터는 `src/ui/domContract.js` 에. 라벨을 바꿨으면 [기능 설명서](FEATURES.md)와 [튜토리얼](TUTORIAL.md) |
| 화면이 안 다시 그려진다 | 그 조작의 커맨드가 돌려주는 `Dirty` | `dev: true` 로 `assertDirtyCovers` 를 켜 본다 |
| 저장 파일 포맷을 바꾼다 | `src/domain/project/schema.js` | `serialize` `normalize` `merge` `migrations` 넷을 함께([개발 원칙 D-4](PRINCIPLES.md#d-4)) |
| 저장 위치·최근 목록을 바꾼다 | `src/ports/storage.js` + `src/adapters/localStore.js` | 용량 상한을 먼저 확인한다 |
| 드래그·터치 판정을 바꾼다 | `src/input/*` + `src/domain/gestureMath.js` | 마우스와 터치는 하한도 알고리즘도 다르다. 통일하려면 동작 변경 커밋으로 |
| 두 보드의 차이를 바꾼다 | `src/usecases/store.js` 의 `BOARD_POLICY` | 새 `if (boardId === 'main')` 를 쓰지 말고 정책 키를 추가한다 |
| 영상 패널의 화면·문구를 바꾼다 | `src/ui/videoPanel.js` + `index.html` 의 `.video-*` 블록 | 오류 코드 5종의 한국어 문구는 뷰가 소유한다. 라벨을 바꿨으면 [기능 설명서](FEATURES.md) |
| 재생 헤드의 움직임을 바꾼다 | `src/ui/playhead.js` | Dirty 를 쓰지 마라 — 초당 60회 재렌더가 된다([휘발성 렌더 채널](#휘발성-렌더-채널-재생-헤드는-dirty-를-타지-않는다)) |
| 템포·앵커의 규칙을 바꾼다 | `src/domain/tempo.js` + `src/usecases/videoCommands.js` | `media` 는 `UNDO_FIELDS` 안이므로 저장 포맷과 undo 를 함께 본다 |
| 다른 재생기(로컬 파일 등)를 붙인다 | `src/adapters/media/` + `src/ports/media.js` | `assertMediaPlayer` 를 마지막 줄에 둔다. [포트 계약](PORTS.md)과 [로드맵](ROADMAP.md)의 미결정 사항 |

규칙을 우회하고 싶어지면 대개 파일 위치가 틀린 것이다. 그리고 구조를 옮기는 커밋과 동작을 바꾸는 커밋은 섞지 않는다 — 섞으면 골든이 깨졌을 때 어느 쪽이 회귀인지 알 수 없다.

## 두 번째 런타임: `server.py`

2026-09-09 에 저장소 밖의 두 번째 런타임이 생겼다. 파이썬 표준 라이브러리만 쓰는 로컬 서버로, `python3 -m http.server` 가 하던 정적 서빙 위에 영상 클립 보관 API 를 얹는다.

| 엔드포인트 | 하는 일 |
|---|---|
| `GET /api/health` | 서버가 있는지. `{ok, mode:'server', root, subdir, dir}` |
| `GET` · `PUT /api/config` | 보관 루트·하위 폴더. 변경은 저장소의 `.clipserver.json` 에 남는다 |
| `PUT /api/clips?project=&name=` | 본문 = 파일 바이트. `<root>/<subdir>/<프로젝트>/<파일>` 로 저장(겹치면 ` (2)`) |
| `GET /api/clips?project=` · `GET /api/clips/<path>` | 목록 · 존재 확인 |
| `GET /clips/<path>` | 파일 스트리밍. `Range` 를 지원한다 — `<video>` 탐색에 필수다 |
| `GET` · `PUT /api/llm/config` | LLM 제공자·모델·주소·키. 키 값은 절대 돌려주지 않는다(`hasKey` 만) |
| `POST /api/llm/refine` · `POST /api/llm/compose` | 말로 적은 안무 → 다듬은 설명(평문) → 안무표 스키마(JSON). 제공자는 anthropic(Messages API, `output_config.format` 구조화 출력, 서버 측 폴백) · openai(chat completions, `response_format: json_schema`) · ollama(`/api/chat` 의 `format`). 서버가 스키마로 손 검증한다 |

경계는 HTTP 뿐이다. `server.py` 는 `src/` 를 모르고 `src/` 는 서버 코드를 모른다(`adapters/clipServer.js` 가 URL 만 안다). 두 가지가 겹친다. **경로 규칙** — `<subdir>/<프로젝트>/<파일>`, 못 쓰는 글자는 `_`, 앞의 점 제거, 빈 조각은 대체 이름 — 은 `src/domain/clips.js` 와 `server.py` 상단에 같은 규칙이 두 번 적혀 있고, **안무표 스키마** — `{title, moves:[{bar,count,length,name,category,note}], notes}` — 는 `server.py` 의 `PLAN_SCHEMA` 와 `src/domain/choreoPlan.js` 가 같은 모양을 두 번 안다. 그래서 프로젝트 파일의 `media.source.path` 가 서버 방식과 브라우저 폴더 방식 사이에서 그대로 통한다. 한쪽을 고치면 다른 쪽도 고친다.

`tools/check-arch.mjs` 는 `src/` 만 본다. 서버는 `tests/server.test.mjs` 가 실제로 띄워 검사한다(업로드 → 번호 붙이기 → Range → 루트 탈출 거부 → 숨김 파일 거부).
