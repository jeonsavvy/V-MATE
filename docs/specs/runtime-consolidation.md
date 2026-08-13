# Runtime consolidation contract

## Goal

V-MATE의 현재 사용자 동작과 보안·데이터 무결성 계약을 유지하면서, 같은 상태나 정책을 여러 계층이 동시에 소유해 서로 보정하는 구조를 하나의 명시적 소유자로 수렴한다.

완료 조건은 다음과 같다.

- 레거시와 room chat이 동일한 model-output, retry, idempotency, public-error 정책을 사용한다.
- malformed structured model output은 사용자 메시지 문자열로 위장되지 않으며 정상 room turn으로 저장되지 않는다.
- 한 HTTP 요청은 하나의 trace ID와 한 번의 CORS/auth/owner/body/error 정책 평가를 갖는다.
- route의 auth, owner, mutation/persistence 정책은 선언적 route metadata에서 확인할 수 있다.
- Worker runtime config는 요청별 global `process.env` mutation 없이 명시적으로 주입된다.
- 브라우저 URL과 dirty-navigation 상태의 소유자는 하나이며, 취소·승인·새로고침 보호의 사용자 동작은 유지된다.
- 플랫폼 route는 실제 파일·chunk 경계를 가지며 character/world editor의 draft mutation 상태 전이는 한 구현을 공유한다.
- API success payload와 auth session의 호환 처리는 각각 client boundary 한 곳에 모인다.
- 자산 삭제 후보는 canonical asset relation/path를 우선 사용하고, DB와 Storage 사이의 outbox/lease/retry 계약은 유지한다.
- fresh-install `schema.sql`은 최종 상태만 표현하고 과거 일회성 backup/scrub/rollback 실행 절차는 append-only migration에만 남긴다.
- 테스트는 사용자·보안·배포 불변식을 검증하고 Tailwind 문자열, workflow 표시 이름, heredoc 철자 같은 구현 모양을 공공 계약으로 만들지 않는다.

## Non-goals

- 실제 사용량 증거 없이 `/api/chat` 또는 Node adapter public surface를 삭제하지 않는다.
- RLS, owner predicate, prompt input/output/replay guard, quota reservation/commit/refund, room version fencing을 제거하지 않는다.
- Storage deletion outbox, exclusive lease, retry, account cleanup fence를 제거하지 않는다.
- 캐릭터와 월드 편집 UI를 하나의 동적 schema renderer로 합치지 않는다.
- 원격 Supabase schema나 Storage data를 Dashboard/SQL editor에서 직접 수정하지 않는다.
- 기존 migration을 수정하거나 migration history를 재작성하지 않는다.
- 사용자에게 보이는 디자인이나 제품 기능을 의도적으로 변경하지 않는다.

## Confirmed repository facts

- production entrypoint는 Cloudflare Worker이며 승인된 GitHub `workflow_dispatch`가 유일한 release write surface다.
- `/api/chat`은 deprecated이지만 외부 사용량은 저장소만으로 확인할 수 없다.
- 현재 UI는 `POST /api/rooms/:roomId/chat`을 사용한다.
- room chat과 legacy chat의 malformed-output 처리가 다르다.
- Cloudflare Worker와 Node adapter는 같은 core modules를 사용하지만 ingress policy를 복제한다.
- persistent quota/idempotency와 memory dedupe의 conflict semantics가 다르다.
- 모든 platform lazy export가 같은 `Pages.tsx` module을 import한다.
- `schema.sql`은 fresh snapshot으로 문서화됐지만 dated prompt-lockdown backup/scrub/rollback 절차를 포함한다.
- current local verification은 DB container tests를 제외하고 통과한다.

## Consequential assumptions

- deprecated endpoint와 Node adapter는 이번 변경에서 compatibility adapter로 유지한다. 제거 여부는 production traffic/runtime ownership evidence가 생긴 뒤 별도 결정한다.
- 기존 Supabase asset tables를 canonical relation으로 사용한다. 공개 URL column과 prompt JSON은 응답·구버전 데이터 호환 projection으로 취급하고 신규 삭제 판단의 source of truth로 사용하지 않는다.
- DB final state를 바꾸지 않는 `schema.sql` 정리는 원격 DB migration을 요구하지 않는다. 구현 중 실제 schema shape 변경이 필요해지면 새 migration과 fresh/upgrade proof 없이는 진행하지 않는다.
- model retry는 동일 semantic payload에 대해서만 허용한다. history/prompt를 조용히 버리는 축약 응답은 정상 성공으로 취급하지 않는다.
- React routing dependency를 추가할 경우 lockfile에 고정하고 current official API 및 browser-history tests로 검증한다.

## Affected contracts

### Chat

Before:

```text
legacy route -> Gemini orchestrator -> normalizer -> magic fallback string -> legacy-only error mapping
room route   -> Gemini orchestrator -> normalizer -> magic fallback string -> normal turn commit
```

After:

```text
legacy adapter ─┐
                ├─ ChatTurnService -> ModelResult -> privacy guard -> commit/refund
room handler ───┘
```

`ModelResult`는 다음 상태를 구분한다.

```ts
type ModelResult =
  | { ok: true; value: AssistantMessage; parseMode: 'strict' | 'recovered' }
  | { ok: false; error: ChatModelError };
```

텍스트 content와 error status를 같은 필드로 겸용하지 않는다.

### HTTP and routing

Transport adapter는 bounded body stream을 읽고 표준 request/result를 변환한다. 공통 dispatcher가 trace, CORS, route match, method, content type, auth, persistence, owner, validation, error envelope를 소유한다.

Route metadata의 최소 형태는 다음과 같다.

```js
{
  method: 'POST',
  pattern: '/api/rooms/:roomId/chat',
  policy: { auth: 'required', mutation: true, owner: false },
  body: parseRoomChatBody,
  handler: handleRoomChat,
}
```

### Idempotency

persistent와 memory 구현은 같은 disposition을 사용한다.

```text
reserved | replay | in_progress | conflict | limit_exceeded
```

persistent request는 DB implementation 하나만 통과한다. memory implementation은 test/local compatibility에서만 같은 semantics로 사용한다.

### Frontend state

- route table이 pathname parse/generate/render/lazy module을 함께 정의한다.
- navigation blocker 하나가 internal link와 Back/Forward를 처리한다.
- editor는 scoped draft와 mutation revision만 소유하고 app/local navigation generation을 별도로 만들지 않는다.
- resource load는 key, abort signal, discriminated status를 사용한다.
- auth UI와 API bearer resolution은 같은 lazy session resource를 사용한다.
- endpoint decoder가 승인된 old response shape를 canonical client type으로 변환한다.

### Assets and schema

- asset row의 bucket/path/owner/entity/slot/variant가 canonical identity다.
- public URL은 canonical path에서 생성하거나 검증된 projection으로만 사용한다.
- legacy URL-only content는 명시적인 compatibility fallback으로 격리한다.
- outbox transaction, lease, retry ordering, shared-reference preservation은 유지한다.
- `schema.sql`에서는 dated backup objects와 one-time scrub/restore 절차를 제거하되 최종 tables, views, functions, RLS, grants와 prompt lockdown 최종 상태를 유지한다.

## Failure behavior

Chat turn pseudocode:

```text
reservation = idempotency.reserve(requestId, fingerprint)
if reservation is replay/in_progress/conflict/limit_exceeded:
    return the canonical disposition response

context = load authorized room prompt, state, and history
model = generate using the same semantic payload for any retry
decoded = decode structured output
if decoded is invalid:
    refund reservation
    return INVALID_MODEL_OUTPUT
if decoded discloses confidential prompt data:
    replace every output field with the established safe refusal
    commit only that sanitized refusal (never the disclosed value)

commit user + assistant turn atomically with expected room version
return canonical success
```

Transport pseudocode:

```text
transport reads bounded body
requestContext = { traceId, runtimeConfig, executionContext }
dispatcher evaluates route policy once
handler returns ApiResult or throws a typed AppError
dispatcher emits one response envelope and trace ID
```

## Rollback

- Code rollout uses the repository release workflow's shadow → smoke → cutover path.
- A failed cutover uses the workflow's evidence-bound automatic rollback to the previous stable Worker version.
- Legacy adapters remain available during the rollout so rollback does not require a client release.
- No direct grant restoration, remote DML, or down migration is used.
- If an implementation unexpectedly requires a DB shape change, stop before remote write and add an append-only migration with local fresh/upgrade proof and the repository's database release evidence chain.

## Proving checks

- targeted red/green tests for malformed model output on both chat routes
- targeted retry test proving history/system semantics are unchanged
- Worker and Node parameterized ingress conformance, including one trace ID
- route policy matrix tests for public, optional, required, owner, and mutation modes
- idempotency conformance for memory and Supabase adapters
- browser tests for dirty internal navigation, Back, Forward, duplicate confirmation, stale save, and account/slug isolation
- fresh production build showing distinct platform route chunks
- asset deletion tests for canonical, legacy, shared, DB failure, and Storage failure paths
- schema snapshot/final-state contract tests
- `npm run verify`
- `npm run test:server:coverage`
- `npm audit --audit-level=high`
- `npm run test:db` when SQL or migration contracts change
- `npm run cf:dry-run`
- clean publication-boundary scan and clean git diff review
- post-push CI success
- production shadow, smoke, cutover, deployment-status verification, and live public-origin smoke through approved workflows
