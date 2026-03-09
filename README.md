# V-MATE

V-MATE는 캐릭터와 월드를 조합해 서사형 대화를 운영하는 캐릭터챗 플랫폼입니다.

## 제품 구조

### 주요 화면
- `/` 홈
- `/characters/:slug` 캐릭터 상세
- `/worlds/:slug` 월드 상세
- `/start/character/:slug` 캐릭터 시작 경로
- `/start/world/:slug` 월드 시작 경로
- `/rooms/:roomId` 플레이 룸
- `/create/character` 캐릭터 제작기
- `/create/world` 월드 제작기
- `/edit/character/:slug` 캐릭터 수정
- `/edit/world/:slug` 월드 수정
- `/recent` 최근 대화
- `/library` 보관함
- `/ops` 운영실

### 핵심 데이터 모델
- **character**: 대화 대상이 되는 캐릭터
- **world**: 장면과 규칙을 담는 배경 단위
- **room**: 실제 플레이 세션과 메시지 기록 단위

### 캐릭터와 월드는 어떻게 합성되나
V-MATE의 조합은 “AI가 두 요소를 즉석에서 알아서 섞는 방식”이 아닙니다.  
먼저 **서버 규칙 로직**이 캐릭터와 월드 정보를 읽어 이 방의 시작 문맥을 만들고, 그 다음 Gemini가 그 문맥 안에서 응답을 생성합니다.

#### 서버가 먼저 읽는 값
- **캐릭터**: 관계 기본값(`relationshipBaseline`), 첫 인사 방향(`characterIntro`), 성격/말투, 이미지 슬롯 규칙
- **월드**: 장르(`genreKey`), 시작 장면(`worldIntro`), 시작 장소(`starterLocations`), 세계 용어(`worldTerms`), 규칙과 이미지 슬롯 규칙

#### 서버가 만드는 중간 결과
방 생성 시 서버는 위 값을 바탕으로 `bridgeProfile`을 만듭니다. 여기에는 아래 정보가 들어갑니다.

- `entryMode`: 캐릭터 단독 시작인지, 월드 안 시작인지
- `characterRoleInWorld`: 이 월드에서 캐릭터가 맡는 역할
- `userRoleInWorld`: 사용자가 어떤 위치에서 시작하는지
- `meetingTrigger`: 첫 장면이 어떻게 열리는지
- `relationshipDistance`: 시작 시점의 관계 거리
- `currentGoal`: 이 장면에서 바로 붙는 대화 목표
- `startingLocation`: 첫 장면 장소
- `worldTerms`, `firstScenePressure`: 세계 용어와 장면 압력

#### 그 다음 단계
1. 서버가 `bridgeProfile`을 생성합니다.
2. 서버가 캐릭터 규칙 + 월드 규칙 + `bridgeProfile` + 현재 상태를 합쳐 `promptSnapshot`을 만듭니다.
3. 방이 열린 뒤에는 고정 `promptSnapshot` 위에 현재 방 상태를 계속 덧붙이고, **10 유저 턴마다 `running summary`를 갱신**합니다.
4. Gemini는 **최근 6턴 raw 대화 + running summary + live room state**를 함께 받아 응답을 생성합니다.
5. 응답 안에 `character_image_slot`, `world_image_slot`이 포함되면 화면도 그 장면에 맞춰 바뀝니다.

즉, **캐릭터는 반응 방식**, **월드는 장면 규칙**, **서버 브리지는 둘을 현재 방의 시작 문맥으로 정리하는 단계**입니다.

### 임의 캐릭터 + 임의 월드 조합이 가능한 이유
- 방 생성 시 캐릭터와 월드를 그대로 읽어 브리지를 만듭니다.
- 월드 자체의 장르/톤/시작 장면 정보를 사용해 첫 장면을 만듭니다.
- 캐릭터의 기본 관계 거리와 말투, 월드의 분위기와 장소가 같은 방 안에서 동시에 반영됩니다.
- 그래서 같은 캐릭터라도 월드가 바뀌면 첫 장면과 목표가 달라지고, 같은 월드라도 캐릭터가 바뀌면 반응 톤과 관계감이 달라집니다.

### 실제로 어떻게 연결되는지 예시
아래 예시는 리포의 현재 로직을 설명하기 위한 예시입니다.

#### 예시 1: 심야 도시 월드에 캐릭터를 넣는 경우
- 캐릭터: 차갑지만 책임감이 강한 캐릭터
- 월드: 비가 막 그친 심야 도시

이 경우 서버는 먼저 캐릭터의 `relationshipBaseline`, `characterIntro`와 월드의 `genreKey`, `worldIntro`, `starterLocations`를 읽습니다.  
그 다음 `generateBridgeProfile(...)` 규칙으로 이 방 전용 시작 문맥을 만듭니다.

- `entryMode`: `in_world`
- `characterRoleInWorld`: 이 월드에 익숙한 인물
- `userRoleInWorld`: 같은 장면을 공유하는 상대
- `meetingTrigger`: 월드 소개나 기본 도시 장면 fallback
- `relationshipDistance`: 캐릭터의 기본 관계 거리
- `startingLocation`: 월드의 첫 시작 장소 또는 월드 이름

이렇게 만든 브리지에 캐릭터 규칙과 월드 규칙을 합쳐 `buildRoomPromptSnapshot(...)` 단계에서 방 전용 시작 스냅샷을 만든 뒤 Gemini에 전달합니다.  
즉, “둘을 일단 억지로 붙여놓고 모델이 알아서 수습하는 구조”가 아니라, **먼저 장면의 뼈대를 만들고 그 위에서 응답을 생성하는 구조**입니다.

#### 예시 2: 레이드 대기실 월드에 다른 캐릭터를 넣는 경우
- 캐릭터: 전투에 익숙한 파티 멤버
- 월드: 레이드 직전 대기실

이 경우에도 별도 연결 데이터를 만들지 않습니다.  
월드의 장르가 `game` 계열이면 서버 규칙 로직이 전투/레이드 직전 장면에 맞는 역할, 목표, 압력을 먼저 정합니다.

- 첫 장면은 월드의 `worldIntro` 또는 장르 fallback으로 정해집니다.
- 관계 거리는 캐릭터의 기본 관계 거리에서 시작합니다.
- 현재 목표는 협력, 역할 분담, 긴장 유지 같은 월드 방향으로 정리됩니다.
- 모델은 이 시작 조건을 전제로 대사를 이어갑니다.

결과적으로 V-MATE의 조합은 아래 순서로 정리할 수 있습니다.

1. 캐릭터 규칙을 읽음
2. 월드 규칙을 읽음
3. 서버가 `bridgeProfile` 생성
4. 서버가 방 전용 시작 스냅샷 생성
5. Gemini가 그 스냅샷을 기준으로 응답 생성

### 채팅 API 계약
- 메서드 정책: **`POST`만 허용**
- **`OPTIONS` preflight 허용**
- 그 외 메서드는 **`405 METHOD_NOT_ALLOWED`**
- `Allow: POST, OPTIONS`

#### 주요 응답 헤더
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

#### 주요 에러 코드
- `METHOD_NOT_ALLOWED`
- `ORIGIN_NOT_ALLOWED`
- `REQUEST_BODY_TOO_LARGE`
- `UNSUPPORTED_CONTENT_TYPE`
- `RATE_LIMIT_EXCEEDED`

## 핵심 기능

- 홈에서 캐릭터와 월드를 바로 탐색
- 캐릭터 단독 대화 시작
- 캐릭터와 월드를 결합한 대화 시작
- 플레이 룸에서 고정 스냅샷 + running summary + 최근 6턴 raw를 함께 유지
- 캐릭터/월드 제작 및 수정
- 최근 대화, 보관함, 즐겨찾기 관리
- owner 전용 운영실에서 노출 상태와 홈 배너 제어
- Supabase Storage 기반 이미지 업로드 및 파생본 운영

## 기술 구성

### 프론트엔드
- React 18
- TypeScript
- Vite 7
- Tailwind CSS
- motion
- Supabase Auth

### 백엔드
- Cloudflare Worker
- Cloud Run adapter
- Supabase Database / Storage
- Gemini API

### 런타임 구성 원칙
- 브라우저는 same-origin `/api`를 기본값으로 사용합니다.
- Worker는 `window.__V_MATE_RUNTIME_ENV__`를 HTML에 주입합니다.
- `wrangler.jsonc`는 `keep_vars: true`와 `run_worker_first`를 사용합니다.

## 빠른 시작

### 1) 런타임 준비
- **Node.js 20 이상**
- `.nvmrc` 포함

```bash
nvm use
npm install
```

### 2) 로컬 환경 변수 설정
```env
# Client
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# 또는
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_CHAT_API_BASE_URL=

# Server
GOOGLE_API_KEY=

# Network / Guardrails
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
ALLOW_ALL_ORIGINS=false
ALLOW_NON_BROWSER_ORIGIN=false

# Runtime stores
RATE_LIMIT_STORE=memory
PROMPT_CACHE_STORE=memory
V_MATE_RATE_LIMIT_KV=
V_MATE_PROMPT_CACHE_KV=

# Auth / Request policy
REQUIRE_AUTH_FOR_CHAT=true
AUTH_PROVIDER_TIMEOUT_MS=3500
AUTH_PROVIDER_RETRY_COUNT=1
CLIENT_REQUEST_DEDUPE_WINDOW_MS=15000
CLIENT_REQUEST_DEDUPE_MAX_ENTRIES=2000
```

### 3) 로컬 실행
```bash
npm run dev
```

## 환경 변수

### 필수 값
| 변수 | 설명 |
| --- | --- |
| `VITE_SUPABASE_URL` | 브라우저에서 사용할 Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` 또는 `VITE_SUPABASE_PUBLISHABLE_KEY` | 브라우저 공개 키 |
| `GOOGLE_API_KEY` | 채팅 생성에 사용하는 Gemini API 키 |

### 교차 출처 / 배포 관련 값
| 변수 | 설명 |
| --- | --- |
| `VITE_CHAT_API_BASE_URL` | 프론트엔드와 API가 다른 출처일 때 사용할 API 기준 URL |
| `ALLOWED_ORIGINS` | API가 허용할 Origin 목록 |
| `ALLOW_ALL_ORIGINS` | 모든 Origin 허용 여부 |
| `ALLOW_NON_BROWSER_ORIGIN` | Origin 없는 요청 허용 여부 |

### 런타임 저장소 관련 값
| 변수 | 설명 |
| --- | --- |
| `RATE_LIMIT_STORE` | rate limit 저장소 모드 (`memory` 또는 KV 기반 확장 모드) |
| `PROMPT_CACHE_STORE` | prompt cache 저장소 모드 |
| `V_MATE_RATE_LIMIT_KV` | Cloudflare KV rate limit binding 이름 |
| `V_MATE_PROMPT_CACHE_KV` | Cloudflare KV prompt cache binding 이름 |

### 기본 운영 원칙
- 저장소 기본값의 `ALLOWED_ORIGINS`는 로컬 개발 Origin만 포함합니다.
- 운영 Origin은 Cloudflare dashboard vars에서 설정합니다.
- 교차 출처 배포에서는 `VITE_CHAT_API_BASE_URL`과 `ALLOWED_ORIGINS`를 함께 맞춰야 합니다.

## 데이터베이스 초기화

Supabase SQL Editor에서 아래 파일을 실행합니다.

```sql
supabase/schema.sql
```

초기화가 끝나면 다음 리소스가 준비됩니다.
- 프로필 / owner 판정 함수
- 캐릭터 / 월드 / 룸 테이블
- 최근 본 항목 / 즐겨찾기
- `vmate-assets` Storage bucket
- 운영 기본 설정(`owner_user_ids`, `home.hero`)

## 운영실 권한 설정

운영실은 owner 계정만 접근할 수 있습니다.

### 방법 A: `profiles.is_owner` 사용
```sql
insert into public.profiles (user_id, is_owner)
values ('YOUR_AUTH_USER_ID', true)
on conflict (user_id)
do update set is_owner = true;
```

### 방법 B: `app_settings.owner_user_ids` 사용
```sql
insert into public.app_settings (key, value_json)
values ('owner_user_ids', jsonb_build_array('YOUR_AUTH_USER_ID'))
on conflict (key)
do update set value_json = excluded.value_json;
```

## 배포

### Cloudflare Worker 배포
- GitHub Actions에서 **main branch push** 이후 품질 검증이 끝나면 Worker를 배포합니다.
- GitHub Secrets는 아래 값이 필요합니다.
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- 런타임 환경 변수는 Cloudflare dashboard vars 또는 secrets에서 관리합니다.
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` 또는 `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_CHAT_API_BASE_URL`

### 배포 체크 포인트
- `PRODUCTION_APP_URL`은 선택값입니다. 설정하면 post-deploy smoke check가 실행됩니다.
- `PRODUCTION_APP_URL` 예시: `https://your-app.example.com`
- `PRODUCTION_APP_URL`이 없으면 Worker 배포는 진행하고 smoke check만 건너뜁니다.
- smoke check는 `PRODUCTION_APP_URL` 기준으로 홈 응답과 chat auth guard를 확인합니다.
- 저장소의 `wrangler.jsonc` 기본값은 로컬 개발 기준입니다.
- 운영 Origin 허용은 Cloudflare dashboard vars의 `ALLOWED_ORIGINS`에서 관리합니다.

### 롤백
```bash
wrangler rollback
```

## 검증

### 자동 검증
```bash
npm run typecheck
npm test
npm run build
npm run verify
```

### 수동 점검
1. 홈 `/` 진입 확인
2. 캐릭터 상세 진입 확인
3. 월드 상세 진입 확인
4. 캐릭터 생성 화면 진입 확인
5. 월드 생성 화면 진입 확인
6. 로그인 다이얼로그 표시 확인
7. 운영실 배너/노출 제어 확인
8. 캐릭터 단독 대화 확인
9. 캐릭터 + 월드 대화 확인

## 라이선스

MIT
