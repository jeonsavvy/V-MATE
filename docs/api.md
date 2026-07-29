# API 계약

브라우저는 기본적으로 same-origin `/api`를 사용합니다. Worker는 `/api/chat`을 legacy chat handler로, 나머지 `/api/*`를 platform API로 분기합니다.

## Legacy chat: `/api/chat`

### 메서드 정책

- **`POST`만 허용**
- **`OPTIONS` preflight 허용**
- 그 외 메서드는 **`405 METHOD_NOT_ALLOWED`**
- `Allow: POST, OPTIONS`

### 주요 응답 헤더

- `X-V-MATE-Trace-Id`
- `X-V-MATE-API-Version`
- `X-V-MATE-Elapsed-Ms`
- `X-V-MATE-Error-Code`
- `X-V-MATE-Dedupe-Status`
- `X-V-MATE-RateLimit-Limit`
- `X-V-MATE-RateLimit-Remaining`
- `X-V-MATE-RateLimit-Reset`
- `X-V-MATE-Client-Request-Id`
- `Retry-After`
- `X-Content-Type-Options: nosniff`

### 핵심 에러 코드

| 코드 | 의미 |
| --- | --- |
| `METHOD_NOT_ALLOWED` | 허용되지 않은 HTTP 메서드 |
| `ORIGIN_NOT_ALLOWED` | 허용 목록 밖의 browser origin |
| `REQUEST_BODY_TOO_LARGE` | 설정된 request body 상한 초과 |
| `UNSUPPORTED_CONTENT_TYPE` | JSON content type 정책 위반 |
| `RATE_LIMIT_EXCEEDED` | 짧은 구간 요청 한도 초과 |

## Room chat

### `POST /api/rooms`

대화방을 생성합니다.

```json
{
  "characterSlug": "kael",
  "worldSlug": "rainy-tokyo",
  "userAlias": "나"
}
```

- `characterSlug`: 필수, 최대 120자
- `worldSlug`: 선택, 최대 120자
- `userAlias`: 선택, 기본 `나`, 최대 40자

### `POST /api/rooms/:roomId/chat`

```json
{
  "userMessage": "비가 그쳤네.",
  "clientRequestId": "request_01HXYZ1234"
}
```

- `userMessage`: 1–12,000자
- `clientRequestId`: 선택, 8–128자의 `A-Z`, `a-z`, `0-9`, `_`, `-`
- 서버는 `clientRequestId`와 request fingerprint로 quota 예약과 replay/conflict를 구분합니다.
- 성공 응답에는 `message`, 갱신된 `room`, `quota`, `trace_id`, `history_window`가 포함됩니다.

주요 room chat 에러:

| 코드 | 상태 | 복구 방향 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 로그인 후 재시도 |
| `ROOM_NOT_FOUND` | 404 | 최신 방 목록에서 다시 진입 |
| `CLIENT_REQUEST_ID_CONFLICT` | 409 | 새 request ID 사용 |
| `CHAT_REQUEST_IN_PROGRESS` | 409 | 같은 요청 결과를 기다린 뒤 재시도 |
| `CHAT_STATE_CONFLICT` | 409 | 최신 room 상태를 다시 읽고 재시도 |
| `CHAT_DAILY_LIMIT_EXCEEDED` | 429 | 응답의 reset 시각 이후 재시도 |
| `RESPONSE_RATE_LIMITED` | 429 | 잠시 후 재시도 |
| `RESPONSE_SERVICE_UNAVAILABLE` | 503 | 현재 메시지는 저장되지 않았으므로 재시도 |

실제 prompt와 history 구성은 [채팅 런타임 구조](chat-runtime.md)를 확인하세요.

## 콘텐츠·운영 API

| 메서드/경로 | 역할 |
| --- | --- |
| `GET /api/home` | 캐릭터·월드 홈 feed |
| `GET /api/characters`, `GET /api/worlds` | 콘텐츠 목록 |
| `GET /api/characters/:slug`, `GET /api/worlds/:slug` | 공개 콘텐츠 또는 본인 콘텐츠 상세 |
| `POST/PATCH/DELETE /api/characters...` | 본인 캐릭터 생성·수정·삭제 |
| `POST/PATCH/DELETE /api/worlds...` | 본인 월드 생성·수정·삭제 |
| `GET /api/recent-rooms` | 최근 대화방 |
| `GET /api/library` | 보관함 |
| `GET /api/me/chat-quota` | 한국 시간 기준 일일 사용량과 다음 초기화 시각 |
| `POST /api/reports` | 콘텐츠 신고 |
| `GET /api/ops/reports?status=open` | owner 신고 큐 |
| `PATCH /api/ops/reports/:id` | 기각, 복구, 격리, 삭제 조치 |
| `DELETE /api/account` | 로그인 사용자 계정과 소유 데이터 삭제 |

공개 캐릭터·월드 생성/수정에는 `rightsConfirmed: true`가 필요합니다. 파생 콘텐츠는 `sourceUrl`도 저장합니다. 상세 계정 삭제 범위는 [계정 삭제 계약](specs/account-deletion.md)을 확인하세요.

## 에러 응답 원칙

클라이언트는 provider 원문, stack trace, 내부 환경 이름에 의존하지 않고 HTTP 상태와 `error_code`를 사용해야 합니다. 오류 응답에는 가능한 경우 `trace_id`가 포함됩니다.
