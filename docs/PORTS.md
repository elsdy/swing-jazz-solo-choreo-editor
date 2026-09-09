# 포트 계약

이 문서는 바깥 세계가 이 앱의 **어디로** 들어오는지를 적는다. 셋을 다룬다 — 동영상 플레이어, 외부 시퀀스 엔진, 연습 버전 저장소. **동영상 플레이어는 2026-09-09 에 실물이 들어왔고**(YouTube 어댑터와 영상 패널), 나머지 둘은 계약만 있고 구현이 비어 있다. 계약은 `src/ports/` 와 `src/domain/tempo.js` 에 코드로 들어가 있으므로, 여기 적힌 것과 소스가 다르면 **소스가 맞다**. 계층 규칙 전반은 [아키텍처](ARCHITECTURE.md)에, 앞으로의 순서는 [로드맵](ROADMAP.md)에 있다.

## 붙이기 전에 — 실행 방법

`src/` 가 ES 모듈로 나뉘어 있어 `index.html` 을 더블클릭해 `file://` 로 여는 방식은 더 이상 동작하지 않는다. 저장소 루트에서 `python3 server.py` 를 띄우고 `http://localhost:8000` 으로 연다(정적 서버로 열어도 앱은 뜨지만 영상 보관이 브라우저 폴더 방식이 된다).

```
python3 server.py
```

이 제약은 영상 기능의 전제조건이기도 하다. YouTube IFrame API 는 `enablejsapi=1` 과 함께 `origin` 을 요구하는데 `file://` 문서의 origin 은 `null` 이라 API 가 애초에 붙지 않는다. 정적 서버 위에서 여는 지금 방식이 그대로 조건을 만족한다. 자세한 실행 절차는 [튜토리얼](TUTORIAL.md)에 있다.

## 한 줄 규칙

**시간(초)은 바깥에서 안으로 들어오고, 카운트(행·칸)는 절대 밖으로 나가지 않는다.**

플레이어도 외부 시퀀스 엔진도 초 하나만 주고받는다. `초 ↔ 카운트` 변환은 `src/domain/tempo.js` 의 순수 함수 **한 곳**에서만 일어난다. 이 규칙 하나로 "엔진 내부를 모른다"는 문제가 설계에서 사라진다 — 엔진이 무엇을 하든 우리는 초만 받으면 되고, 엔진은 우리 격자를 영원히 모른다.

| 소유자 | 소유물 | 절대 모르는 것 |
|---|---|---|
| `src/domain/tempo.js` | bpm, 카운트당 박자, 앵커, 격자 ↔ 초 변환 | DOM, 플레이어, 엔진, 시간의 흐름 |
| `src/ports/media.js` | 재생 제어의 계약, `TimeSample` DTO, 엔진 세션 정규화 | 누가 구현하는지, YouTube 인지 `<video>` 인지 |
| `src/ports/storage.js` | 저장소 키와 실패 코드, 저장소 계약 5종 | localStorage 인지 IndexedDB 인지 |
| `src/adapters/**` | YT IFrame API, `<video>`, `localStorage`, 전역 스크립트 로딩 | 카운트, 행, 배치, bpm |
| `src/usecases/**` | 표본 + Tempo → 재생 헤드 위치, 구간 반복, 프리롤 | 어떤 DOM 인지 |
| `src/ui/**` | 패널 DOM, 한국어 라벨, 재생 헤드 엘리먼트 | 초 계산식, YT API |

포트끼리도 서로 import 하지 않는다. `tools/check-arch.mjs` 가 이 규칙을 기계로 검사한다(`ports 는 import 가 0개여야 한다`, `ports 는 서로도 import 하지 않는다`, `ports 는 구현을 알면 안 된다`). MediaPlayer 와 SequenceEngine 이 파일 두 개가 아니라 `src/ports/media.js` 하나로 합쳐져 있는 이유가 이것이다 — `normalizeEngineSession` 이 `isMediaPlayer` 를 써야 하는데 포트끼리 import 할 수 없다.

같은 검사가 `ports` 계층에서 `Date`·`performance`·`Math.random`·`document` 같은 전역을 금지한다. `projectTime(sample, nowMs)` 이 현재 시각을 인자로 받는 것은 취향이 아니라 이 규칙의 결과다.

## MediaPlayer 계약

`src/ports/media.js`. 어댑터가 채우고, 유스케이스와 뷰가 소비한다. 멤버는 전부 필수다.

| 이름 | 무엇 | 반환 | 주의 |
|---|---|---|---|
| `kind` | 어느 어댑터가 만든 재생기인가 | `'youtube' \| 'file' \| 'null' \| 'engine'` | 함수가 아니라 값이다 |
| `capabilities` | 이 재생기가 할 수 있는 것 | `MediaCapabilities` | `Object.freeze` 로 불변. 아래 별도 표 |
| `getState()` | 로드·재생 상태와 오류 | `{load, play, error}` | `error` 는 코드 5종 중 하나 + 메시지. **한국어 문구는 뷰가 만든다** |
| `getDuration()` | 길이 | `number \| null` | 모르면 `null`. `0` 은 "0초짜리"라는 거짓 정보다(라이브는 길이가 없다) |
| `getTimeSample()` | 마지막 시각 표본 | `TimeSample \| null` | 소비자가 이걸 반복해 부르면 안 된다 — `onTime` 을 쓴다 |
| `load(source)` | 소스 교체 | `Promise<void>` | **준비 완료**에 resolve 한다. 준비 전에 온 `seek`/`play` 는 던지지 않고 어댑터가 마지막 의도 1개만 큐잉했다가 적용한다. `kind` 가 같으면 재생성 없이 소스만 바꾼다(YT iframe 재로드 회피) |
| `play()` | 재생 | `Promise<PlayResult>` | **절대 reject 하지 않는다** |
| `pause()` | 일시정지 | `void` | |
| `seek(sec, opts?)` | 탐색 | `Promise<number>` | **실제 착지 시각**을 돌려준다. `opts.scrubbing: true` 는 저비용 미리보기, 기본은 확정 |
| `setRate(rate)` | 배속 | `void` | `capabilities.rates` 가 `null` 이면 no-op. 배속은 카운트 매핑을 바꾸지 않는다 |
| `setMuted(muted)` | 음소거 | `void` | |
| `onTime(cb)` | 시각 표본 구독 | 해제 함수 | 보장 3가지는 아래 |
| `onState(cb)` | 상태 변화 구독 | 해제 함수 | |
| `destroy()` | 정리 | `void` | 멱등. 컨테이너를 **비운 채로** 남긴다 |

이 목록의 원본은 `MEDIA_PLAYER_MEMBERS` 배열이고, `assertMediaPlayer` 의 유일한 판정 근거다.

### capabilities

| 필드 | 무엇 | 값 |
|---|---|---|
| `canSeek` | 탐색이 가능한가 | `boolean` |
| `seekToleranceSec` | 이 안에 착지하면 성공으로 본다 | YouTube ≈ `0.5`, 로컬 `<video>` ≈ `0.05` |
| `rates` | 지원 배속 목록 | 배속 불가면 `null` |
| `isLive` | 라이브 스트림인가 | `boolean` |
| `needsUserGesture` | 첫 `play()` 를 클릭 핸들러 콜스택 안에서 불러야 하는가 | `boolean` |

### 상태와 결과 값

| 타입 | 값 |
|---|---|
| `MediaSource` | `{kind:'youtube', videoId, startSec?}` 또는 `{kind:'file', url, name?}` |
| `LoadState` | `'idle'` `'loading'` `'ready'` `'error'` |
| `PlayState` | `'unstarted'` `'buffering'` `'playing'` `'paused'` `'ended'` |
| `PlayResult` | `'started'` `'blocked'` `'not-ready'` `'no-source'` `'error'` |
| `MediaErrorCode` | `'not-found'` `'not-embeddable'` `'network'` `'unsupported'` `'unknown'` |
| `TimeSample` | `{sec, atMs, rate, playing}` — `atMs` 는 `performance.now()` 기준 |

`MediaErrorCode` 5종은 YouTube 의 오류 코드(2·5·100·101·150)와 `MediaError`(1~4)를 축약한 것이다. 어댑터가 자기 오류를 이 5종으로 접어 넣고, 사용자에게 보일 한국어 문구는 뷰가 코드를 보고 고른다.

### `play()` 가 reject 하지 않고 상태 문자열을 돌려주는 이유

자동재생 차단은 예외가 아니라 **정상 결과**다. 그런데 브라우저마다 알리는 방식이 다르다 — `<video>.play()` 는 `NotAllowedError` 로 reject 하고, YouTube 의 `playVideo()` 는 조용히 아무 일도 하지 않는다. 이 차이를 그대로 두면 호출부가 `try/catch` 와 "1초 뒤에도 안 움직이면 차단으로 간주" 두 벌을 모두 들고 있어야 한다.

그래서 포트는 두 경우를 하나로 접는다. 어댑터가 reject 를 `'blocked'` 로 변환하고, 조용히 실패하는 쪽은 상태 변화를 잠시 기다렸다가 안 오면 `'blocked'` 를 합성한다. 호출부는 `switch` 하나로 끝난다.

`'not-ready'` 와 `'no-source'` 가 따로 있는 것도 같은 이유다. 아직 준비가 안 된 것과 애초에 틀 소스가 없는 것은 사용자에게 다른 말을 해야 한다.

### `seekToleranceSec` 이 필수 필드인 이유

이 값은 "요청한 시각과 실제 착지 시각이 얼마나 벌어질 수 있는가"다. YouTube 의 `seekTo` 는 키프레임에 착지해서 ±0.5초까지 벌어지고, 로컬 `<video>` 는 ±0.05초 안쪽이다.

180bpm 에서 1카운트는 0.333초다. 즉 **"정확한 카운트로 점프"는 YouTube 에서 원리적으로 불가능하다.** 이걸 인터페이스가 숨기면 호출부가 "왜 가끔 한 박 어긋나지"를 영원히 쫓게 된다. 그래서 두 가지를 계약에 박았다.

- `seek()` 은 `Promise<number>` 로 **실제 착지 시각**을 돌려준다. "요청 ≠ 결과"를 타입으로 인정하는 자리다.
- `capabilities.seekToleranceSec` 은 옵셔널이 아니다. 어댑터가 자기 오차를 반드시 밝힌다.

유스케이스는 이 값을 받아 목표보다 앞을 겨냥해 탐색한 뒤 재생으로 통과한다(설계 문서의 `preRollCounts = ceil(tolerance / spc) + 2`). 착지가 부정확할 뿐 **재생 진행 자체는 정확하므로**, 조금 앞에서 틀어 놓고 흘러오게 하면 원하는 카운트에 정확히 도달한다.

`createNullMediaPlayer()` 가 이 값을 `Infinity` 로 두는 이유도 같은 셈법이다. 널 재생기는 어디로도 실제로 움직이지 않으므로 어떤 요청도 허용 오차 안에 있다고 보는 것이 맞다. `0` 으로 두면 호출부의 `abs(착지 - 요청) <= tolerance` 판정이 전부 실패로 뒤집힌다.

### `onTime` 의 보장, 그리고 소비자가 폴링하면 안 되는 이유

어댑터는 다음 셋을 보장한다.

- 재생 중 **10Hz 이상**
- `seek` 이나 상태 변화 **직후 1회**
- **구독 즉시 1회**

시간 이벤트의 현실은 형편없다. YouTube 는 시간 이벤트가 **아예 없어서** 폴링이 필수이고, `<video>.timeupdate` 는 4Hz라 재생 헤드를 그리기엔 너무 성기다. 이 차이를 어댑터가 흡수하고, 포트는 구독 하나만 노출한다.

10Hz 도 60fps 화면에는 부족하다. 그래서 뷰는 표본을 **보간**한다 — `getTimeSample()` 을 매 프레임 부르는 대신, 마지막 표본과 현재 시각으로 `projectTime` 을 계산한다.

그러므로 "10Hz 이상"은 **표본을 10Hz 로 뜨라는 뜻이 아니라, 소비자가 보는 시각이 10Hz 이상으로 정확하라는 뜻**이다. YouTube 어댑터는 이것을 250ms(4Hz) 폴링 + 보간으로 만족시킨다. 표본을 10Hz 로 뜨면 iframe 경계를 넘는 호출이 초당 10번이라 저가 기기에서 눈에 띄게 버벅이는데, 보간은 배속까지 반영하므로 화면은 오히려 60fps 로 매끄럽다. 어댑터가 표본 간격을 정할 때 지켜야 하는 것은 **보간 오차가 1카운트보다 작을 것** 하나다(250ms 는 400bpm·1박 카운트에서도 1.7카운트가 아니라 표본 지연일 뿐이고, 실제 오차는 `rate` 가 바뀌는 순간의 한 표본에만 생긴다).

```js
projectTime(sample, nowMs, durationSec = null)
// !sample          → 0
// !sample.playing  → sample.sec            (멈춰 있으면 표본이 곧 현재다)
// 그 외             → sample.sec + (nowMs - sample.atMs) / 1000 * (sample.rate || 1)
//                     durationSec 를 주면 끝을 넘어가지 않게 자른다
```

배속이 여기에만 들어간다는 점이 중요하다. 포트가 주는 `sec` 은 언제나 미디어 시각이고, 배속은 그 시각이 흐르는 속도만 바꾼다. 카운트 매핑에는 영향이 없다.

`nowMs` 를 인자로 받는 것은 위에서 말한 계층 규칙 때문이다 — `ports` 는 `performance` 를 만질 수 없다. 호출부가 `performance.now()` 를 읽어 넣는다.

### `assertMediaPlayer` — 계약의 자기검증

```js
assertMediaPlayer(player, label = 'MediaPlayer')  // 통과하면 받은 것을 그대로 돌려준다
isMediaPlayer(player)                             // 같은 판정의 불리언판
```

`kind` 와 `capabilities` 는 `null`/`undefined` 만 아니면 되고, 나머지 12개는 함수여야 한다. 빠진 것이 있으면 이름을 전부 나열해 `TypeError` 를 던진다(`… 계약 위반: seek, onTime`).

이게 값을 하는 자리는 두 곳이다.

- **외부 엔진이 준 플레이어를 받을 때.** 남이 만든 객체가 계약을 지키는지 확인하는 유일한 관문이고, `normalizeEngineSession` 의 준수 수준 판정도 `isMediaPlayer` 로 한다.
- **`createNullMediaPlayer()` 의 마지막 한 줄.** 널 재생기가 자기 자신을 `assertMediaPlayer` 에 통과시킨 뒤 돌려준다. 포트에 멤버가 하나 추가되면 널 재생기가 즉시 `TypeError` 로 터진다 — 그것이 그 한 줄의 목적이다.

### `createNullMediaPlayer()` 가 존재하는 이유

`src/adapters/nullMediaPlayer.js`. 아무것도 재생하지 않는 **완전한** MediaPlayer 다.

영상 패널 뷰는 `getState()`·`onTime`·`getDuration`·`play`·`seek` 를 무조건 부른다. 여기서 `null` 을 허용하면 호출부마다 분기가 생겨 열 곳 넘는 자리가 `player?.` 로 오염된다. "소스 없음"을 정상 상태로 표현하는 객체 하나가 그 분기를 전부 없앤다.

지키는 방식은 이렇다.

- `play()` 는 reject 하지 않고 `'no-source'` 를 resolve 한다.
- `seek(sec)` 은 요청값을 그대로 착지 시각으로 돌려준다. 거짓말이 아니라 항등 착지다.
- `getDuration()`·`getTimeSample()` 은 `0` 이 아니라 `null` 이다.
- `getState()` 는 `{load:'idle', play:'unstarted', error:null}` — 오류가 아니라 정상이다.
- `destroy()` 는 멱등하다.

계약에서 유일하게 벗어나는 지점은 `onTime` 의 "구독 즉시 1회"다. 표본이 존재하지 않아 보낼 값이 없다. 뷰는 `projectTime(null, now) === 0` 으로 안전하게 처리된다.

## Tempo — 카운트 ↔ 초

`src/domain/tempo.js`. 순수 함수만 있고, import 는 `domain/grid.js` 하나뿐이다(`linearOf`, `cellOf`, `clamp`).

설계 문서에는 `toLinearCount`/`fromLinearCount` 를 이 파일이 직접 갖는 것으로 적혀 있지만, 실제 코드는 격자 좌표 함수를 새로 만들지 않고 `grid.js` 의 것을 그대로 쓴다. 그 위에 "카운트 하나가 몇 초인가" 곱셈 한 겹만 얹는다.

```js
linearOf(row, index, cols) = (row - 1) * cols + index
```

`intro` 행이 `row 0` 이므로 이 식은 intro 를 자동으로 `[-cols, -1]` 구간, 즉 앵커 이전 시각으로 떨어뜨린다. **분기가 없다.**

### Tempo 값 객체

| 필드 | 무엇 | 비고 |
|---|---|---|
| `bpm` | 분당 박자 | `0` = 아직 정해지지 않음 |
| `beatsPerCount` | 카운트 1칸이 몇 박인가 | 기본 `1`, 하프타임 `2`, 더블타임 `0.5` |
| `anchorSec` | `anchorCount` 가 재생되는 영상 시각(초) | |
| `anchorCount` | `anchorSec` 에 대응하는 선형 카운트 | `0` = 8x1 의 1카운트 |

`DEFAULT_TEMPO` 는 `{bpm: 0, beatsPerCount: 1, anchorSec: 0, anchorCount: 0}` 이고 `Object.freeze` 되어 있다.

시작 오프셋 하나 대신 `(anchorSec, anchorCount)` **쌍**을 두는 이유는 재앵커 때문이다. 사용자가 곡 중간 아무 카운트에서나 "지금 여기가 이 카운트"라고 다시 찍을 수 있어야 하고, 그때 bpm 은 건드리지 않는다. 시작 오프셋은 `anchorCount === 0` 인 특수한 앵커일 뿐이다.

### `bpm: 0` 이 클램프 대상이 아닌 이유

`normalizeTempo` 는 `bpm` 을 20~400, `beatsPerCount` 를 0.125~8 로 클램프한다. 그런데 `bpm` 이 유한한 양수가 **아닐 때는 클램프하지 않고 `0` 으로 둔다.**

`0` 을 20 으로 끌어올리면 "템포를 아직 안 정했다"가 "20bpm 이다"로 둔갑하고, `isTempoUsable` 이 거짓 참을 돌려준다. 그러면 아무도 앵커를 찍지 않은 상태에서 재생 헤드가 그럴듯한 위치에 그려진다 — 가장 나쁜 실패다. `0` 은 값이 아니라 **상태**이므로 클램프의 대상이 아니다.

이 때문에 호출 규약이 하나 붙는다. **변환하기 전에 `isTempoUsable(tempo)` 을 먼저 물어라.** `bpm` 이 `0` 이면 `secondsPerCount` 가 `Infinity` 를 돌려준다.

### 함수 목록

| 시그니처 | 무엇 | 주의 |
|---|---|---|
| `normalizeTempo(raw)` | 손상된 입력 → `Tempo` | `NaN`·`Infinity`·문자열·`null` 을 전부 거른다. `bpm: 0` 은 그대로 둔다 |
| `isTempoUsable(tempo)` | 변환해도 되는가 | 네 필드가 전부 유한하고 `bpm > 0`, `beatsPerCount > 0` |
| `secondsPerCount(tempo)` | 카운트 1칸이 몇 초인가 | `(60 / bpm) * beatsPerCount`. `bpm: 0` 이면 `Infinity` |
| `countToTime(count, tempo)` | 선형 카운트 → 초 | 음수 카운트(intro)는 그대로 음수 방향으로 나간다 |
| `timeToCount(sec, tempo)` | 초 → 선형 카운트 | 실수다. 칸 경계에 딱 떨어지지 않는다 |
| `cellToTime(row, index, cols, tempo)` | (행, 칸) → 초 | |
| `timeToCell(sec, cols, tempo)` | 초 → `{row, index, fraction, linear}` | `fraction` 은 `[0,1)` 이고 그대로 재생 헤드의 칸 안 위치가 된다 |
| `placementToSpan(placement, cols, tempo)` | 배치 세그먼트 → `{startSec, endSec}` | `endSec` 은 배타적이라 `endSec - startSec === length * spc` 가 항상 성립한다 |
| `groupToSpan(segments, cols, tempo)` | 같은 그룹의 세그먼트 배열 → 초 구간 | 세그먼트 사이의 빈틈은 메우지 않고 포함한다. 빈 배열이면 `null` |
| `spanToCountRange(startSec, endSec, cols, tempo)` | 엔진의 초 구간 → `{from, to}` 격자 범위 | 양끝 포함. 뒤집힌/영길이 구간은 한 칸으로 접는다 |
| `tempoFromTwoPoints(a, b, beatsPerCount?)` | 두 점 → `Tempo` | 순서가 뒤집혔거나 간격이 0 이면 `null` |
| `reanchor(tempo, point)` | bpm 유지, 앵커만 이동 | 보정점이 있으면 지우지 않고 지도 전체를 같은 만큼 민다(옛 앵커는 보정점으로 남는다) |
| `tempoPoints(tempo)` | 변환에 실제로 쓰는 점열(앵커 + 보정점, 카운트순) | 길이 ≥ 1. 앵커와 같은 카운트의 보정점이 앵커를 덮고, 앵커와 되감기는 보정점은 버린다 |
| `addTempoPoint(tempo, point)` | 보정점 하나 추가(같은 카운트는 교체) | 되감기는 점이면 **`null`** — 넣지 않는다. 다른 점을 몰래 버리지 않는다 |
| `removeTempoPoint(tempo, count)` · `clearTempoPointsOf(tempo)` | 보정점 제거 | bpm·앵커는 그대로 |
| `normalizeTempoPoints(raw)` | 손상된 보정점 배열 정리 | 카운트순 정렬, 같은 카운트는 뒤가 이김, 앞 점보다 되감기는 점은 버림 |
| `bpmFromTaps(tapSecs, beatsPerTap?)` | 탭 템포 → bpm | 클램프하지 않은 날 값이다. 탭 2개 미만이거나 오름차순이 아니면 `null` |

핵심은 두 줄이고 나머지는 전부 이 둘의 조합이다. 보정점이 없을 때(대부분의 파일)는 정확히 아래 식이다.

```js
countToTime(count, t) = t.anchorSec + (count - t.anchorCount) * secondsPerCount(t)
timeToCount(sec, t)   = t.anchorCount + (sec - t.anchorSec) / secondsPerCount(t)
```

보정점(`t.points`, 2026-09-09)이 있으면 `tempoPoints(t)` 가 앵커와 보정점을 합친 점열을 만들고, 두 함수는 **점열 사이를 구간별 선형으로 잇고 양 끝 밖은 위 식의 기울기로 뻗는다.** 점열이 카운트·초 모두 오름차순이라 두 함수는 서로의 정확한 역함수다. 앵커는 여전히 점 하나일 뿐이라 이 절의 다른 함수(`timeToCell` · `placementToSpan` · `spanToCountRange`)는 한 글자도 바뀌지 않았다.

경계에서는 `1e-9` 카운트의 허용 오차를 흡수해서 내림한다. 이게 없으면 `countToTime` 을 거쳐 돌아온 정확히 8인 카운트가 `7.999999999999998` 로 나오고, 재생 헤드가 한 칸 뒤 칸을 `fraction 0.99999` 로 가리킨다. 400bpm·`beatsPerCount 0.125` 에서도 `1e-9` 카운트는 2e-11 초라 무해하다.

### 두 점으로 템포를 정하는 방식

`tempoFromTwoPoints` 가 이 기능의 UX 전부다. **사용자는 bpm 을 몰라도 된다.**

"여기가 8x1 의 1" 한 번, "여기가 8x5 의 1" 한 번 — 두 점을 찍으면 bpm 과 앵커가 동시에 나온다. 앞선 점이 앵커가 된다.

```js
bpm = (60 * beatsPerCount * (b.count - a.count)) / (b.sec - a.sec)
```

멀리 떨어진 두 점을 쓸수록 정확해진다. 8x1 ↔ 8x5 는 32카운트 차이라 클릭 오차가 bpm 에 미치는 영향이 1/32 로 줄어든다. 이 사실은 그대로 화면 안내 문구가 될 값어치가 있다.

`reanchor` 는 이미 정한 bpm 을 그대로 두고 앵커만 옮긴다 — 곡 중간에서 어긋난 싱크를 한 번의 클릭으로 되맞추는 경로다.

## SequenceEngine 계약

같은 `src/ports/media.js` 안에 있다. 엔진은 다른 프로젝트에서 통째로 들어오고, 내부는 지금 모른다.

### 무엇까지 가정하는가 — 셋뿐이다

- **시간 단위는 초(실수)다.** 이것만 하드 가정이다. 엔진이 프레임 단위면 **어댑터가 fps 로 나눠서** 넘긴다. 포트는 초만 안다.
- **구간(clip/segment)이라는 개념이 있고 목록으로 내보낼 수 있다.** "구간 목록을 받아 편집하고 결과를 돌려준다" 수준이 최소선이다.
- **엔진의 자체 상태를 JSON 직렬화 가능한 무언가로 뽑을 수 있다.** 못 뽑으면 `null` 이 되고 우리는 엔진 상태 저장을 포기한다. 크래시가 아니다.

가정하지 **않는** 것: ES 모듈인지 UMD 전역인지, 우리 테마·CSS 를 존중하는지, undo 를 우리와 공유하는지, 자체 플레이어가 있는지, 마운트를 여러 번 할 수 있는지, 구간이 서로 겹치지 않는지, id 가 안정적인지.

### 준수 수준

엔진이 가정을 안 지키는 경우를 예외가 아니라 **정상 경로**로 만든다. `describe()` 가 수준을 선언하고, 뷰는 그 수준에 따라 UI 를 줄인다.

| 수준 | 엔진이 제공하는 것 | 앱이 얻는 것 | 못 지키면 |
|---|---|---|---|
| **0 · 데이터 전용** | 구간 배열 import/export | 구간 → 카운트 범위 표시, 카운트 범위 → 구간 내보내기 | 여기가 바닥이다. 이보다 못하면 연동을 접는다 |
| **1 · 임베드** | + `mount` / `destroy` / `onChange` | 안무표 옆에서 엔진 UI 를 그대로 쓰고 변경을 실시간으로 받는다 | 수준 0 으로 강등. 가져오기·내보내기 버튼만 노출한다 |
| **2 · 동기 재생** | + `getPlayer()` 가 MediaPlayer 계약을 만족 | 엔진 재생에 안무 재생 헤드가 따라간다 | 수준 1 로 강등. 우리 플레이어를 따로 띄우고 엔진에는 `syncTime(sec)` 을 밀어주기만 한다 |

수준은 선언을 믿지 않고 실제로 판정한다. `normalizeEngineSession` 은 `getPlayer()` 의 결과가 `isMediaPlayer` 를 통과하면 2, 아니면 `destroy` 가 함수인지 보고 1, 그것도 아니면 0 으로 정한다.

### 어댑터와 세션

| 타입 | 멤버 | 비고 |
|---|---|---|
| `SequenceEngineAdapter` | `id`, `describe()`, `mount?`, `importSegments?` | `id` 는 저장 blob 의 네임스페이스가 된다 |
| `RawEngineSession` | `getSegments?`, `setSegments?`, `syncTime?`, `getPlayer?`, `getState?`, `onChange?`, `destroy?` | 엔진이 "대충" 준 것. **전부 옵셔널**이다 |
| `EngineSession` | `level`, `getSegments`, `setSegments`, `syncTime`, `getPlayer`, `getState`, `onChange`, `destroy` | 정규화 뒤. **전부 필수**라 호출부에 분기가 없다 |

`ClipSegment` 는 `{id, startSec, endSec, label?, meta?}` 다.

### `normalizeEngineSession` 이 불량 엔진을 흡수하는 방식

이 함수가 `src/ports/media.js` 의 존재 이유다. 껍데기가 아니라 실제 방어 코드다. **엔진이 던진 예외가 안무표를 죽이면 안 된다.** 외부에서 통째로 들고 오는 코드에 대해 우리가 통제할 수 있는 유일한 지점이 이 래퍼다.

- **모든 호출을 `guard` 로 감싼다.** 엔진이 던지면 `onError` 로 넘기고 미리 정한 대체값을 돌려준다.
- **없는 메서드는 no-op 으로 채운다.** `setSegments` 가 없는 단방향 엔진도 허용되고, `onChange` 가 없으면 영원히 부르지 않는 구독을 돌려준다.
- **구독 해제 함수를 안 주는 엔진도 허용한다.** `onChange` 의 반환이 함수가 아니면 빈 함수로 대체한다.
- **`getSegments` 는 캐시를 돌려준다.** 엔진이 중간에 구간을 못 주게 되어도 마지막으로 본 값이 계속 나온다.
- **엔진 메서드는 `(객체, 이름)` 으로 부른다.** 함수만 떼어 받으면 엔진이 `this` 를 쓰는 메서드로 구현했을 때 조용히 터진다.
- **`getState()` 는 JSON 왕복으로 거른다.** 순환 참조·함수·심볼이 섞여 있으면 `null` 이다.
- **`onChange` 의 페이로드 모양을 둘 다 받는다.** 배열을 그대로 주는 엔진과 `{segments: [...]}` 로 감싸 주는 엔진을 모두 흡수한다.

디바운스는 이 함수 안에 없다. 타이머는 포트에 둘 수 없기 때문이다. 필요하면 어댑터가 `options.wrap` 으로 스케줄러를 주입한다.

`normalizeClipSegments` 는 들어온 배열에서 정상 구간만 남긴다. 숫자가 아닌 시각(문자열 포함)과 `NaN` 은 버리고, 뒤집힌 구간은 앞뒤를 바꾸며, 길이가 0 인 구간은 버린다. `id` 가 없으면 `seg{i}` 로 발급하고 중복이면 `{id}#{i}` 로 갈라 준다. **정렬은 하지 않는다** — 엔진이 준 순서가 의미를 가질 수 있다.

### 엔진에 절대 넘기지 않는 것

`row`, `index`, `groupId`, `placement`, `bpm`, `moveLibrary`, `routines` — 전부 안 넘긴다. 넘기는 것은 `{startSec, endSec, label}` 뿐이고 `label` 조차 우리가 만든 표시용 문자열이다. 되받는 것도 초뿐이다. 이 단방향성 덕분에 엔진 교체가 어댑터 하나 교체로 끝난다.

두 방향 모두 실제로 값을 한다.

- **엔진 → 안무**: 엔진이 잘라 둔 구간의 시작을 `timeToCell` 로 옮겨 "이 구간이 8x3 의 1"로 앵커를 잡는다. 템포 보정 UX 가 공짜로 생긴다.
- **안무 → 엔진**: 선택한 배치들을 `groupToSpan` 으로 초 구간으로 바꿔 `setSegments` 로 넘긴다. "이 8카운트만 잘라서 반복 연습 영상 만들기"가 된다.

### `nullSequenceEngine` 을 일부러 만들지 않은 이유

널 재생기는 만들었지만 널 엔진은 만들지 않았다. 두 경우의 호출부 모양이 다르기 때문이다.

플레이어는 뷰의 열 곳 넘는 자리에서 무조건 불린다. 널 객체가 그 분기를 전부 없앤다.

엔진 호출부는 "시퀀스 탭을 열었을 때" 단 하나다. 여기서 널 객체는 **빈 컨테이너를 마운트해 동작하는 척**하는 더 나쁜 UI 를 만든다. 엔진 진입점이 `null` 을 돌려주고 뷰가 "엔진이 연결되어 있지 않다"는 안내를 그리는 쪽이 정직하다.

## 저장소 포트

`src/ports/storage.js`. 지금 실제로 도는 것은 `src/adapters/localStore.js` 의 localStorage 어댑터 하나다.

### `STORAGE_KEYS` — 7키

문자열을 바꾸면 기존 사용자의 데이터가 통째로 사라진다. 값은 절대 바꾸지 않고, 키 이름은 이 상수를 통해서만 부른다.

| 키 | 담기는 것 | 언제 쓰이나 |
|---|---|---|
| `choreo_saved_files` | 최근 프로젝트 10개. **payload 전체**를 품는다 | 프로젝트 저장·임포트 때 쓰고, 최근 목록에서 열 때 읽는다 |
| `choreo_saved_moves` | 최근 동작목록 파일 3개 | 동작목록 저장·임포트 |
| `choreo_saved_categories` | 최근 카테고리 파일 3개 | 카테고리 저장·임포트 |
| `choreo_fav_moves` | 즐겨찾기한 동작 이름 집합 | 동작 즐겨찾기 토글 |
| `choreo_fav_cats` | 즐겨찾기한 카테고리 키 집합 | 카테고리 즐겨찾기 토글 |
| `choreo_fav_routines` | 즐겨찾기한 루틴 id 집합 | 루틴 즐겨찾기 토글, 프로젝트 불러오기 |
| `choreo_links` | 링크 4필드(YouTube URL·제목, ClickUp URL, 커스텀 링크) | 링크바 편집 때마다. **7키 중 유일하게 자동 저장된다** |

용량 위험은 `choreo_saved_files` 한 곳에 몰려 있다. 프로젝트 payload 10개가 통째로 들어가므로 여기에 버전 기록을 얹으면 즉사한다. 저장 위치를 옮기는 것이 연습 버전 기능의 선결 조건이다.

### 저장소 계약 5종

| 타입 | 무엇 | 핵심 |
|---|---|---|
| `KvStore` | 키-값 창구 | 값은 이미 파싱된 JS 값이다. `JSON.stringify/parse` 는 어댑터 몫 |
| `SnapshotStore` | 현재 보드와 최근 프로젝트 10개 | `listRecents()` 가 **doc 을 포함하지 않는다** |
| `FileGateway` | 파일 내려받기·읽기 | 내려받기 → 저장 순서를 보존한다 |
| `VersionRepository` | 안무 버전 히스토리 | `listVersions()` 가 doc 을 포함하지 않는다. `rebuildVersionMeta()` 로 복구된다 |
| `PracticeLogRepository` | 연습 기록 | 항목이 ~300B 라 통째로 돌려준다 |

`listRecents`·`listVersions` 가 doc 을 빼는 것은 시그니처 선택 중 가장 중요한 것이다. 목록 UI 를 그리려고 20개 × 20KB 를 파싱하면 안 된다. meta 는 doc 에서 파생 가능한 데이터라 손상돼도 재생성할 수 있다.

**계약은 전부 `Promise` 를 반환한다.** 오늘 저장은 전부 동기지만, 지금 동기로 못 박으면 IndexedDB 어댑터를 붙일 때 호출부를 전부 다시 써야 한다. 그래서 어댑터 쪽에는 의도적인 간극이 남아 있다 — `localStore.js` 와 `browser.js` 는 오늘과 같이 동기이고, 각 파일 주석이 그 이유를 적어 두었다. 원본은 `state.x = …; setItem(…); render…()` 를 한 틱 안에서 수행하고 임포트 경로는 그 `setItem` 예외를 **같은 try** 로 잡아 `올바른 프로젝트 파일이 아닙니다.` 를 띄운다. `await` 를 넣으면 렌더 순서가 밀리고 예외가 미처리 거부로 새어 나간다.

### `StorageError` — 정의는 있고 던지는 사람은 없다

```js
class StorageError extends Error { code; cause; }
```

| 코드 | 언제 |
|---|---|
| `QUOTA_EXCEEDED` | 쿼터 초과. `choreo_saved_files` 가 payload 10개를 품는 지금 가장 현실적인 실패다 |
| `UNAVAILABLE` | 저장소 자체를 못 씀(사파리 프라이빗, 서드파티 쿠키 차단) |
| `CORRUPT` | 값은 있는데 JSON 이 깨졌거나 형식이 다름 |
| `NOT_FOUND` | 키가 없음 |

**지금은 아무도 이 예외를 던지지 않는다.** 오늘 동작을 보존하기 위해서다.

- `localStore.js` 의 `set` 은 `try/catch` 로 감싸지 않는다. 쿼터 초과는 오늘처럼 브라우저의 원래 예외 그대로 호출부에 던져진다.
- `localStore.js` 의 `get` 은 파싱 실패를 빈 값으로 조용히 덮는다. 오늘의 `catch` 6벌이 하던 일이다.
- `browser.js` 의 `readJsonFile` 은 `JSON.parse` 의 `SyntaxError` 를 그대로 흘려보낸다. 오늘 호출부의 `catch` 가 오류 종류를 보지 않기 때문이다.

`usecases/projectCommands.js` 에 저장소 결과가 `{ok: false}` 면 `StorageError` 로 바꾸는 자리가 하나 있지만, 지금 어댑터는 그 모양을 절대 돌려주지 않으므로 실제로 도달하지 않는다. **정의만 있는 상태가 이번 단계의 정답이다.** 실패를 사용자에게 알리려면 새 한국어 문구가 생기고, 그건 동작 변경이다 — 무엇을 왜 그대로 두었는지는 [일부러 두고 온 것](deviations.md)에 있다.

## 연습 버전 모델

`src/domain/project/schema.js` 에 타입만 정의되어 있다. 아직 아무도 만들지 않는다.

### 안무 버전과 연습 기록이 다른 축인 이유

두 질문은 서로 다른 것을 묻는다.

- "지난주 안무랑 뭐가 달라졌지?" → 배치의 차이. **안무의 축**이다.
- "지난달보다 얼마나 늘었지?" → 같은 안무를 반복한 결과의 시계열. **연습의 축**이다.

하나로 합치면 깨지는 지점이 분명하다. 안무를 안 바꾸고 연습만 한 날에도 버전이 하나 생겨 부모와 바이트 단위로 같은 레코드가 쌓인다. 더 나쁜 것은 "3주간 향상 곡선"이 2주차의 안무 수정에서 **두 동강 난다**는 점이다. 사용자는 카운트 20~24 만 고쳤을 뿐인데 개선 추이가 끊긴다.

나누면 안무 차이는 버전끼리, 개선 추이는 로그 시계열로 각자 자연스럽게 계산된다. 추이 그래프 위에 "여기서 안무가 바뀜" 세로선만 그으면 된다.

의존은 **한 방향뿐**이다. `PracticeLog.versionId → ChoreoVersion.id`. 버전은 로그를 모른다. 로그가 가리키는 버전이 지워지면 `versionId` 는 dangling 으로 남되 로그는 살아 있다 — 연습 기록이 더 오래 살아야 할 데이터다.

세 번째 엔티티(세션·블록)는 만들지 않는다. 한 번 앉아서 네 번 돌렸으면 그건 로그 하나에 `attempts: 4, cleanRuns: 3` 이다. 루틴도 자체 버전 축을 갖지 않는다 — 루틴은 문서의 부품이라 프로젝트 버전에 함께 스냅샷된다.

### 엔티티

**`ChoreoDoc`** — 편집 대상 상태 전부. 파일 본문 · 버전 스냅샷 · undo 스냅샷 · (장차) 오토세이브가 **한 타입**을 공유한다.

| 필드 | 무엇 |
|---|---|
| `rows` / `cols` | 격자 크기. `rows` 는 마지막 행 인덱스이지 행 개수가 아니다 |
| `categories` | `{키: {label, color}}` |
| `moveLibrary` | `{id, name, category}[]` |
| `placements` | 배치 세그먼트 배열 |
| `routines` | 루틴 배열 |
| `links` | 링크 4필드를 중첩한 것. v1 파일에서는 최상위에 평평하게 놓여 있다 |

버전 스냅샷의 모양 == 프로젝트 파일 본문의 모양 == `ChoreoDoc` 이라는 점이 결정적 이득이다. "이 버전을 파일로 내보내기"와 "이 파일을 버전으로 들여오기"가 공짜가 되고, 마이그레이션 체인이 한 타입 위에서만 돈다. 지금 이 프로젝트가 "상태"를 네 군데에서 다르게 정의하던 문제가 여기서 수렴한다.

버전은 델타가 아니라 **전체 스냅샷**을 담는다. 델타는 복원이 체인 워크가 되고 중간 하나가 깨지면 그 이후 전부가 죽는다. 크기 논거도 성립하지 않는다 — 현실적인 문서가 20KB 남짓이라 20개 버전이 400KB 다. 차이는 저장하지 않고 표시할 때 계산한다.

**`ChoreoVersion`** — `id`, `projectId`, `parentId`(분기한 버전, 최초는 `null`), `createdAt`, `label`, `note`, `doc`, `reference`(이 버전을 찍어 둔 기준 영상, `MediaRef|null`).

**`PracticeLog`** — `id`, `projectId`, `versionId`, `at`(사용자가 수정 가능하다 — 어제 것을 오늘 입력한다), `scope`(`null` = 전곡, 또는 구간 드릴), `bpm`, `rating`, `attempts`, `cleanRuns`, `troubleSpots`, `media`, `note`.

**`CountRef`** — `{row, index}`. `cols` 에 의존하지 않는 구조적 좌표라 보드 크기가 바뀌어도 읽을 수 있다. `row 0` 이 intro 다.

**`MediaRef`** — `{kind, src, startSec?, endSec?, countMap?}`. 버전(기준 영상)에도 로그(오늘 찍은 영상)에도 붙으므로 **둘 중 누구의 소유도 아닌** 공유 타입이다.

### "얼마나 나아졌는지" — 자동 계산분과 사람 입력분

자동으로 계산되는 것은 두 버전 사이의 **안무 차이**다. 추가·삭제·이동·길이변경·이름변경·카테고리변경, 그리고 그룹 개수·사용 카운트 같은 파생 수치. 비교 키는 `groupId` 다 — 이동과 리사이즈가 `groupId` 를 보존하고 새 배치마다 새로 발급되므로, 별도 식별 체계를 만들 필요가 없다.

정직하게 말하면 **이건 "개선"이 아니라 "안무가 어떻게 변했나"다.** 안무 차이로 실력 향상을 측정할 수는 없다. 개선 신호는 전부 사람이 넣어야 한다.

| 사람이 입력하는 것 | 왜 필요한가 |
|---|---|
| `bpm` | 개선의 등뼈. 같은 안무를 160 에서 190 으로 올렸다 = 명백한 향상. 유일하게 객관적인 자기보고 숫자다 |
| `rating` (0~5) | 정수 하나. 동작별도 구간별도 아닌, 한 번 돌린 것에 대한 총평 |
| `attempts` / `cleanRuns` | "5번 중 3번"은 "평점 3"보다 훨씬 많은 것을 말한다 |
| `troubleSpots[]` | 유일하게 **연습 행동을 실제로 바꾸는** 항목. 카운트 범위라 안무표 위에 겹쳐 그릴 수 있고, "17~24 가 3주째 빨갛다"가 곧 다음에 뭘 할지다 |
| `note` | 자유 텍스트 탈출구 |

명시적으로 **거부한 것**: 동작별 평점, 에너지·기분, 연습 시간(분), 태그, 난이도, 파트너. 개인 도구에서 이 필드들은 입력 마찰만 늘리고 둘째 주부터 아무도 채우지 않는다.

버전을 넘나드는 지표 보정도 하지 않는다. 안무가 바뀌면 선을 긋고 사람이 눈으로 판단한다.

### 저장 포맷 마이그레이션 — version 1 파일이 계속 열려야 한다

`src/domain/project/migrations.js`. 이 파일은 이미 배선되어 실제로 돈다.

- `SCHEMA_VERSION = 2` — 앱이 **읽을 수 있는** 최신 스키마.
- `LEGACY_FILE_VERSION = 1` — 파일에 실제로 **쓰는** 값. 오늘과 같다. 쓰기 값을 2 로 올리면 저장 파일의 바이트가 달라져 동작 변경이 된다.

규칙은 한 줄이다. **`JSON.parse` 직후 그 자리에서 마이그레이션을 정확히 한 번 부른다.** 지금 배선된 곳은 역직렬화 경계 네 군데다 — 파일에서 프로젝트 열기, 파일에서 `부분 채우기`, 최근 목록의 `전체 불러오기`, 최근 목록의 `부분 불러오기`. 최근 목록 두 경로를 빠뜨리면 임포트가 v2 를 넣고 로드가 v1 로 읽어 `choreo_saved_files` 안에서 두 포맷이 섞인다.

v1 → v2 단계가 하는 일은 링크 4필드를 `doc.links` 로 묶고, 결정론적 `projectId`(`v1:{fileName}`)를 부여하며, `versions`·`practiceLogs`·`media` 자리를 신설하는 것이다. 링크 4필드는 최상위에 **미러로 남긴다** — 구버전 앱이 열어도 링크를 잃지 않게 하기 위해서이고, v3 에서 제거한다.

원칙 넷을 지킨다.

- **마이그레이션은 검증하지 않는다.** 시대와 모양만 맞추고, 클램프·복구는 `normalize.js` 가 한다. 두 관심사를 섞으면 마이그레이션 테스트가 클램핑 규칙과 얽힌다.
- **입력을 변형하지 않는다.** 항상 새 객체를 돌려준다.
- **미래 스키마는 거부한다.** `version` 이 `SCHEMA_VERSION` 보다 크면 `FUTURE_SCHEMA` 다. 열고 다시 저장하는 순간 다운그레이드로 필드가 소멸하기 때문이다.
- **레코드를 날조하지 않는다.** v1 파일을 열면 `versions`·`practiceLogs`·`media` 가 `null` 이 아니라 **빈 배열**이다. v1 문서로 "버전 0"을 자동 생성하고 싶은 유혹이 있지만 하지 않는다 — `createdAt = 지금` 이 역사에 대해 거짓말을 하고, 열고 저장하고 다시 여는 왕복이 멱등을 잃는다. 최초 버전은 사용자가 처음 저장을 누를 때 만들어진다.

호출부는 마이그레이션 **실패를 흡수한다.** `NOT_AN_OBJECT`·`FUTURE_SCHEMA`·`NO_MIGRATION_PATH` 어느 쪽이든 날값을 그대로 통과시킨다. 오늘 앱에는 `version` 을 읽는 코드가 한 줄도 없어서 어떤 JSON 이든 형태만 맞으면 열리려 시도하고, 여기서 새 안내를 띄우면 동작 변경이다. 이 판단은 미결정 사항이 아니라 **의도적인 보류**이며, 거부 문구를 붙일지는 다음 단계에서 정한다.

미래 필드가 왕복에서 사라지지 않게 하는 장치도 하나 들어가 있다. 파일을 쓸 때 **알 수 없는 최상위 키를 그대로 되돌려준다.** 이게 없으면 새 필드를 아는 앱이 저장한 파일을 모르는 앱이 열었다 저장하는 것만으로 필드가 조용히 소멸한다.

`부분 채우기` 는 `media` 도 링크도 가져오지 않는다. 현재 보드의 곡과 템포를 남의 파일이 덮어쓰면 안 된다.

## 영상 패널이 들어간 자리

**2026-09-09 에 실제로 들어갔다.** 아래 결정은 전부 코드가 되었고, 문단마다 어느 파일이 그것을 지키는지 적어 둔다. 계약이 먼저 쓰였고 구현이 그것을 따라간 자리이므로, 앞으로 이 절을 고칠 때는 코드와 함께 고쳐야 한다.

### 삽입 지점

`#boardsContainer` 의 세 번째 flex 자식으로, `#routineEditorPanel` **뒤에** 넣는다. 근거는 셋이다.

- `.boards-container` 는 이미 `display:flex; flex:1; min-height:0; overflow:hidden` 이다. 구조를 바꿀 필요가 없고, `.routine-editor-panel` 이 이미 같은 패턴의 형제다.
- `.app` 의 직계 자식은 셋(사이드바 / 리사이즈 디바이더 / 메인)이고 모바일 `grid-template-rows` 가 정확히 3트랙이다. `.app` 을 3열로 만드는 안은 이 계약을 깨서 미디어쿼리 두 개를 모두 고쳐야 한다.
- **iframe 은 DOM 에서 부모를 바꾸면 리로드된다.** 그래서 "데스크톱은 옆, 모바일은 위"를 DOM 이동으로 구현하면 안 된다. 이 제약이 삽입 지점을 사실상 하나로 확정한다.

URL 입력은 **새로 만들지 않는다.** 링크바에 이미 있는 `YouTube URL 입력...` 칸이 그대로 소스다. 상태를 두 곳에 두지 않는다.

> 구현: `index.html` 의 `<aside class="video-panel" id="videoPanel" hidden>` 이 `#routineEditorPanel` 뒤에 있고, 링크바의 확정(`change` · `✕`)이 `ui/linksBarView.js` 의 `onYoutubeUrlCommit` 으로 `usecases/videoCommands.setSource` 를 부른다. `input` 에는 걸지 않는다 — 글자마다 iframe 이 다시 로드된다.
>
> 이 "두 곳에 두지 않는다"는 초기화 경로에서도 지켜야 한다. `전체 초기화(링크 포함)` 가 링크바만 비우고 `media.source` 를 남기면 같은 사실이 갈라진다(아래 참조).

### 데스크톱과 모바일

DOM 은 한 자리에 고정하고 CSS 로만 위치를 바꾼다.

- **데스크톱**: 안무표 오른쪽. `flex:0 0 clamp(...)` 로 폭을 잡고 왼쪽 테두리를 준다.
- **좁은 화면**: `.boards-container` 를 `flex-direction: column` 으로 바꾸고 패널에 `order: -1` 만 준다. 위로 올라가지만 **DOM 은 움직이지 않으므로 재생이 끊기지 않는다.**
- **모바일 기본은 접힘**(헤더만). 세로 예산이 이미 빡빡하다.
- 좁은 화면에서 패널 헤더는 오른쪽에 여백이 필요하다. 1040px 이하에서만 나타나는 스크롤 잠금 버튼이 화면 오른쪽 위에 고정되어 그 자리를 덮는다.

영상 프레임에 `aspect-ratio` 를 주는 것은 선택이 아니라 **필수**다. `.app → .panel → .workspace → .boards-container` 가 전부 `overflow:hidden` + `min-height:0` 이라 비율을 명시하지 않으면 iframe 이 0 높이로 붕괴한다.

넓은 화면에서 루틴 편집기와 영상 패널을 동시에 열지 않는다. 루틴 편집 패널이 폭의 절반 가까이를 차지해서 둘 다 열리면 메인 보드가 짜부라진다. 그리고 **숨길 때 반드시 `pause()` 를 부른다** — `display:none` 인 iframe 도 오디오는 계속 나온다.

> 구현: `.boards-container` 에 `data-routine` · `data-video`(`'on'`|`'off'`) 두 표식이 붙고(`ui/domContract.js` 가 소유), CSS 는 그 둘만 본다 — `.boards-container[data-routine="on"] .video-panel { display: none }` 과 `@media (max-width:1040px) .boards-container[data-video="on"] { flex-direction: column }`. 끈 상태에서는 어느 규칙도 매칭되지 않으므로 이 기능이 들어오기 전 화면과 같다. `pause()` 는 `ui/videoPanel.js` 의 `onSync(false)` 를 받은 `app/main.js` 가 부른다(어댑터를 아는 유일한 자리다).

### 재생 헤드가 렌더 파이프라인을 타면 안 되는 이유

지금 모든 상태 변경은 스토어를 거쳐 뷰 갱신으로 라우팅된다. 재생 헤드를 이 경로에 태우면 **초당 60회 전체 재렌더**가 된다.

그래서 채널을 둘로 나눈다.

- **채널 A(도메인)**: 상태 변경 → 스토어 → 뷰 갱신. bpm·앵커 확정, 소스 변경이 여기다.
- **채널 B(휘발성)**: 재생 헤드 루프가 자기가 만든 엘리먼트 하나의 인라인 스타일만 직접 쓴다. **도메인 상태를 건드리지 않는다.**

따라서 재생 위치는 상태에 들어가지 않고 **undo 에도 남지 않는다.** 움직임은 `left` 가 아니라 `transform: translateX()` 로 준다(레이아웃 재계산 회피). 칸 폭은 CSS 변수를 읽지 말고 트랙의 실제 폭을 칸 수로 나눠 구한다 — 레이아웃 변경에 유일하게 안전한 측정법이고, 이미 포인터 좌표 계산이 같은 근거를 쓴다. 렌더·리사이즈마다 한 번만 재고 캐시한다.

반대로 **템포는 undo 에 들어가야 한다.** 앵커는 사용자가 공들여 찍는 값이라 오조작 손실이 크고, 스냅샷 증가량은 숫자 네 개다. 다만 드래그·타이핑 중에는 히스토리를 남기지 않고 확정 시점에만 커밋한다.

### `전체 초기화(링크 포함)` 가 영상까지 지우는 이유

계약을 쓸 때는 "`전체 초기화` 는 곡 정보를 지우지 않는다 — 전체 초기화의 의미는 배치 지우기이지 곡 정보 폐기가 아니다" 로 정해 두었다. **2026-09-09 에 뒤집었다.** 그 전제가 이 버튼에는 맞지 않는다는 것이 실물에서 드러났기 때문이다.

이 버튼은 이름 그대로 링크바의 `youtubeUrl` 을 **이미 지운다**. 그런데 `media.source` 를 남기면 링크바는 비었는데 패널은 옛 영상을 계속 싣고, 다음 저장이 사용자가 지운 주소를 파일에 다시 쓴다 — 위에서 "상태를 두 곳에 두지 않는다" 고 못 박은 그 불변식이 이 한 경로에서만 깨진다. 템포도 함께 버린다. 앵커와 bpm 은 **그 영상의 시간축**에 붙은 값이라, 소스만 버리고 템포를 남기면 다음에 붙인 다른 영상에 옛 앵커가 조용히 적용되어 재생 헤드가 그럴듯한 거짓 위치를 가리킨다 — 이 기능에서 가장 나쁜 실패다.

[개발 원칙 R-4](PRINCIPLES.md#r-4) 가 요구하는 세 가지는 같은 커밋에서 함께 확인했다.

| 확인할 것 | 이 경우 |
|---|---|
| 되돌리기 범위 | `media` 는 이미 `UNDO_FIELDS` 안이고 호출부가 곧바로 커밋한다. `Undo` 한 번이면 배치·링크와 함께 템포와 소스가 살아난다 |
| 복원 경로의 저장소 되쓰기 | 필요 없다. `media` 는 localStorage 에 없다(링크와 달리 프로젝트 파일에만 있다) |
| 버튼 라벨 | 이미 `전체 초기화(링크 포함)` 이다. 영상 소스는 그 링크의 사본이므로 라벨이 이미 그것을 말한다 |

구현은 `usecases/videoCommands.clearMedia` 이고 `boardCommands.clearBoard` 가 `clearLinks` 옆에서 부른다. **비어 있으면 `NONE` 을 돌려준다** — 영상을 한 번도 안 쓴 사용자의 `전체 초기화` 는 Dirty 가 글자 하나 달라지지 않아야 하고, 골든 150 이 그것을 재생한다.

링크가 같은 규칙을 어긴 채 다섯 달 남아 있다가 2026-09-07 에 닫혔다 — 되돌리기 범위(`UNDO_FIELDS`)를 정리 범위와 같게 맞추고 버튼 라벨을 `전체 초기화(링크 포함)` 으로 바꿨다. 이번 것은 같은 함정을 하루 만에 닫은 셈이다.

## 아직 정해지지 않은 것

[로드맵](ROADMAP.md)의 미결정 사항 중 **계약의 모양을 바꾸는 것**만 여기 적는다.

- ~~**intro 행(row 0)을 시간 축에 넣는가.**~~ **2026-09-09 에 넣기로 정했다.** `(row-1)*cols+index` 한 식이 intro 를 음수 카운트로 분기 없이 떨어뜨리고, 재생 헤드도 거기 그대로 선다. `timeToCell` · `spanToCountRange` 의 반환 규약은 바뀌지 않았다.
- ~~**버전마다 영상이 다른가.**~~ **지금은 프로젝트 공통이다.** `media` 블록이 `ChoreoDoc` 최상위에 있다. 나눌 때가 오면 블록 통째로 `ChoreoVersion.reference` 옆으로 내려가고 최상위에는 "기본 영상"만 남는다 — 그래서 `tempo` 와 `source` 를 state 에 평평하게 풀지 않고 블록 하나로 묶어 두었다(`domain/project/media.js`).
- **`media` 최상위 키 이름이 겹친다.** v2 `ProjectFile` 에는 `MediaRef[]` 자리로 예약된 `media`(항상 `[]`)가 이미 있었고, 새 블록도 `media` 다. 지금은 마이그레이션이 `raw.media` 를 명시적으로 `doc.media` 로 내려 충돌을 피하지만, `MediaRef[]` 를 실제로 쓰기 시작할 때 둘 중 하나의 이름을 바꿔야 한다.
- **루틴 편집 보드에도 카운트 ↔ 시간을 적용하는가.** 적용한다면 Tempo 가 보드마다 하나씩 두 벌이 된다. "루틴은 시간 매핑 없음"으로 못 박는 편이 단순하다.
- ~~**로컬 영상 파일을 어디까지 지원하는가.**~~ **2026-09-09 에 정했다.** 저장 포맷의 `MediaSourceRef` 는 `{kind:'file', name, path?}` 이고 url 이 없다. `path` 는 설정의 보관 폴더 기준 상대 경로(`video-clip/<프로젝트>/<파일>`)로, 보관 폴더에 복사한 파일만 갖는다. 실행 중의 blob URL 은 `app/main` 이 `URL.createObjectURL` 로 만들고 revoke 까지 책임지며, 재생기에는 `{kind:'file', url, name}` 으로 들어간다. 저장 참조(이름)와 실물(blob)의 연결은 이름 비교 하나다 — 다시 열면 이름만 있고 실물이 없으므로 패널이 "같은 파일을 다시 골라 달라"고 안내한다.
- **엔진 상태 blob 의 크기 상한을 둘 것인가.** `EngineSession.getState()` 가 돌려주는 것을 우리는 파싱하지 않고 왕복만 시킨다. 그런데 프로젝트 JSON 은 파일과 최근 목록 10개에 동시에 들어가므로 blob 이 크면 쿼터를 때린다. 상한 초과 시 조용히 강등할지 알릴지 정해야 한다.
- **저장 실패를 사용자에게 알릴 것인가.** `StorageError` 의 네 코드는 정의되어 있지만 아무도 던지지 않는다. 던지기 시작하면 새 한국어 문구가 생기고, 그건 동작 변경이다.

## 이번 PR 에 실제로 들어간 것과 비워 둔 것

계약이 먼저 쓰인 자리였다. **2026-09-09 에 영상 패널이 실제로 들어가면서** 아래 표의 절반이 "비워 둔 것" 에서 "들어간 것" 으로 넘어갔다. 여전히 던지기만 하는 미구현 스텁은 만들지 않는다 — 그건 지뢰다.

| 들어간 것 | 무엇 |
|---|---|
| `src/domain/tempo.js` | Tempo 값 객체와 카운트 ↔ 초 변환 14개. import 는 `domain/grid.js` 하나 |
| `src/ports/media.js` | MediaPlayer·SequenceEngine 계약, `assertMediaPlayer` / `isMediaPlayer` / `projectTime` / `normalizeClipSegments` / `normalizeEngineSession` |
| `src/ports/storage.js` | `STORAGE_KEYS` 7키, `STORAGE_ERROR_CODES`, `StorageError`, 저장소 계약 5종 |
| `src/ports/env.js` | `Env` / `Dialogs` 계약과 결정적 테스트 더블(`counterEnv`, `silentDialogs`) |
| `src/adapters/nullMediaPlayer.js` | 아무것도 재생하지 않는 완전한 MediaPlayer. 계약의 자기검증을 겸한다 |
| `src/domain/project/schema.js` | `ChoreoDoc` / `ChoreoVersion` / `PracticeLog` / `MediaRef` / `CountRef` 타입, `SCHEMA_VERSION`, `LEGACY_FILE_VERSION` |
| `src/domain/project/migrations.js` | v1 → v2 마이그레이션. **실제로 배선되어 돈다** |
| `tools/check-arch.mjs` | 계층 방향과 순수성의 기계 검사. `node tools/check-arch.mjs` 로 돌린다 |
| `tests/unit/domain.test.mjs` | 도메인·어댑터·유스케이스 단위 테스트 **85개**(+ `tests/server.test.mjs` 의 서버 실물 2개). `countToTime` ↔ `timeToCount` 왕복(보정점 있을 때 포함), `timeToCell` 의 fraction 범위, `tempoFromTwoPoints` 의 거부 조건, 보정점의 되감기 거부·교체·`reanchor` 밀기·빈 보정점 미저장에 더해 YouTube 어댑터의 계약 충족·스크립트 로드 실패·`onTime` 3보장, `<video>` 어댑터의 계약 충족·디코드 실패·자동재생 차단·착지 시각, 파일 소스가 이름만 남기는 것, 재생 위치가 store 에 없다는 것, 빈 `media` 가 저장 바이트를 안 늘린다는 것을 검사한다. `node --test 'tests/**/*.test.mjs'` 로 돌린다 |
| `src/adapters/media/youtubePlayer.js` | **2026-09-09.** IFrame API 를 MediaPlayer 계약으로 감싼 실물. 마지막 줄이 `assertMediaPlayer` 다. 생성만으로는 DOM·네트워크를 안 건드리고 첫 `load()` 에서 `<script>` 가 붙는다 — 패널을 한 번도 안 연 사용자에게 유튜브 요청이 나가지 않는다 |
| `src/adapters/media/pickPlayer.js` | **2026-09-09.** URL 또는 MediaSource → `'youtube'` \| `'file'` \| `'null'`. `domain/links.parseYoutubeUrl` 을 재사용하고 정규식을 한 글자도 쓰지 않는다. 언제나 완전한 MediaPlayer 를 돌려주므로 호출부에 `player?.` 가 생기지 않는다 |
| `server.py` · `src/adapters/clipServer.js` · `tests/server.test.mjs` | **2026-09-09.** 영상 보관 서버. 파이썬 표준 라이브러리만 쓰는 로컬 서버가 정적 파일 위에 `/api/health` · `/api/config` · `/api/clips` · `/clips/<path>`(Range) 를 얹는다. 클라이언트는 `probe` 로 서버가 있는지 보고 없으면 브라우저 폴더 방식으로 떨어진다. 보관 위치는 `--root`/`--subdir` 또는 앱 설정에서 바꾸고 `.clipserver.json` 에 남는다 |
| `src/ports/clips.js` · `src/adapters/clipLibrary.js` · `src/domain/clips.js` | **2026-09-09.** 영상 보관 폴더(브라우저 방식, 서버가 없을 때). 계약(`ClipLibrary`: `isSupported` · `getFolder` · `pickFolder` · `forgetFolder` · `ensurePermission(interactive)` · `saveClip` · `openClip`), File System Access API + IndexedDB 구현, 그리고 `<subdir>/<프로젝트>/<파일>` 경로 규칙(순수). 폴더 핸들은 IndexedDB `choreo_clips` 에, 표시 이름·하위 폴더는 localStorage `choreo_clip_folder` 에 있다. 지원하지 않는 브라우저에서는 전부 "없음"으로 답하고 던지지 않는다 |
| `src/adapters/media/filePlayer.js` | **2026-09-09.** `<video>` 를 MediaPlayer 계약으로 감싼 실물. `seekToleranceSec` 0.05, 재생 중 100ms 표본 + `timeupdate`. `MediaError.code` 를 포트의 5종 코드로 접고 한국어 문구는 만들지 않는다. blob URL 을 만들지도 놓지도 않는다(그건 `app/main` 의 몫) |
| `src/usecases/videoCommands.js` | **2026-09-09.** 패널 상태 · 두 점 앵커 · 탭 템포 · 소스 확정 · `clearMedia`. DOM 도 플레이어도 시계도 모른다(시각은 전부 인자로 들어온다) |
| `src/ui/videoPanel.js` · `src/ui/playhead.js` | **2026-09-09.** 패널 뷰(채널 A)와 재생 헤드(채널 B). 헤드는 rAF 루프가 자기 엘리먼트의 `transform` 만 쓴다 |
| `src/domain/project/media.js` | **2026-09-09.** `media` 블록의 정규화·직렬화. 비어 있으면 `null` 을 돌려 `buildProjectFile` 이 키째로 뺀다 |
| 저장 포맷의 `media` 블록 | **2026-09-09.** `{tempo, source}` 가 `customLinks` 뒤에 붙는다. `UNDO_FIELDS` 와 `DOC_FIELDS` 양쪽에 있다. `tempo.points`(보정점)는 있을 때만 쓰인다 — 빈 배열은 키째로 뺀다 |
| `index.html` 의 영상 패널 마크업·CSS | **2026-09-09.** `#boardsContainer` 의 세 번째 flex 자식. 기존 규칙은 한 줄도 고치지 않고 `</style>` 앞에 165줄을 더하기만 했다 |

| 비워 둔 것 | 상태 |
|---|---|
| 재생·정지 · 배속 · 구간 반복 조작 | 없다. 재생은 iframe 안의 유튜브 자체 UI 로 한다. 패널이 부르는 것은 배치 클릭의 `seek` + `play` 와 숨길 때의 `pause` 뿐이다 |
| 시퀀스 엔진 진입점 | 없다. 엔진이 실제로 올 때 어댑터와 함께 만든다. [로드맵 3번](ROADMAP.md)이 그 조사 결과다 |
| `nullSequenceEngine` | **일부러 만들지 않았다.** 위의 이유 참조 |
| 저장소 어댑터의 Promise 판 · IndexedDB | 없다. `localStore.js` 는 오늘과 같이 동기 localStorage 다 |
| 버전·연습 기록 리포지토리 구현 | 없다. 인메모리 참조 구현도 만들지 않았다. `VersionRepository` 등은 typedef 뿐이다 |
| `StorageError` 를 던지는 경로 | 정의만 있다 |
