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
V-MATE는 캐릭터와 월드를 고르는 순간 서버가 두 정보를 읽어 방의 시작 상태를 만듭니다.

- 캐릭터는 말투, 관계 거리, 첫 반응의 결을 제공합니다.
- 월드는 장면 톤, 시작 장소, 세계 규칙을 제공합니다.
- 서버는 이 둘을 합쳐 첫 장면, 시작 관계, 현재 목표, 장소를 정리합니다.
- 모델은 그 시작 상태를 기준으로 대화를 이어갑니다.

정리하면 캐릭터는 반응의 결을 만들고, 월드는 장면의 틀을 만듭니다.

### 임의 캐릭터 + 임의 월드 조합이 가능한 이유
- 같은 캐릭터라도 월드가 바뀌면 시작 장면과 분위기가 달라집니다.
- 같은 월드라도 캐릭터가 바뀌면 반응 방식과 관계감이 달라집니다.
- 그래서 방을 열 때마다 조합에 맞는 새로운 시작 장면이 만들어집니다.

### 채팅 기억 구조는 어떻게 관리되나
V-MATE는 긴 대화를 위해 시작 설정, 누적 요약, 최근 대화, 현재 상태를 함께 관리합니다.

- 시작 설정은 방이 열릴 때 정해진 기본 장면과 규칙입니다.
- 누적 요약은 길어진 대화의 핵심만 압축해 유지합니다.
- 최근 대화는 바로 직전 말투와 흐름을 살립니다.
- 현재 상태는 위치, 관계, 진행 중인 상황을 따로 관리합니다.

이 구조 덕분에 장기 맥락을 유지하면서도 최근 대화의 자연스러움을 놓치지 않습니다.

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
- 플레이 룸에서 장기 맥락과 최근 대화 흐름을 함께 유지
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
