# V-MATE

V-MATE는 **캐릭터 / 월드** 2축으로 구성된 한국형 캐릭터챗 플랫폼입니다.

- 홈에서 캐릭터/월드를 바로 둘러봅니다.
- 캐릭터 단독 대화 또는 **캐릭터 + 월드** 조합 대화가 가능합니다.
- 채팅은 메신저형보다 **서사형 플레이 룸** 중심으로 구성됩니다.
- 캐릭터/월드는 플랫폼 내부에서 생성하고, 운영실에서 노출을 제어합니다.

---

## 현재 제품 구조

### 주요 화면
- `/` 홈
- `/characters/:slug` 캐릭터 상세
- `/worlds/:slug` 월드 상세
- `/rooms/:roomId` 플레이 룸
- `/create/character` 캐릭터 제작기
- `/create/world` 월드 제작기
- `/recent` 최근 대화
- `/library` 내 보관함
- `/ops` 운영실

### 주요 개념
- **캐릭터**: 대화 대상
- **월드**: 대화 배경/규칙
- **character_world_links**: 추천 연결/기본 오프닝 문맥
- **room**: 실제 플레이 세션

---

## 기술 스택

### 프론트엔드
- React 18
- TypeScript
- Vite 7
- Tailwind CSS
- motion
- Supabase Auth / Storage

### 백엔드
- Cloudflare Worker
- Cloud Run adapter
- Supabase
- Gemini API

---

## 빠른 시작

### 0) 런타임 요구사항
- **Node.js 20 이상**
- `.nvmrc` 포함 (`nvm use`)

### 1) 설치
```bash
npm install
```

### 2) 필수 환경 변수
```env
# Client
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
# 또는
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_CHAT_API_BASE_URL=

# Server
GOOGLE_API_KEY=...
```

### 3) 운영에 필요한 추가 값
```env
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://v-mate.jeonsavvy.workers.dev
ALLOW_ALL_ORIGINS=false
ALLOW_NON_BROWSER_ORIGIN=false

RATE_LIMIT_STORE=memory
PROMPT_CACHE_STORE=memory
V_MATE_RATE_LIMIT_KV=
V_MATE_PROMPT_CACHE_KV=

REQUIRE_AUTH_FOR_CHAT=true
AUTH_PROVIDER_TIMEOUT_MS=3500
AUTH_PROVIDER_RETRY_COUNT=1
CLIENT_REQUEST_DEDUPE_WINDOW_MS=15000
CLIENT_REQUEST_DEDUPE_MAX_ENTRIES=2000
```

### 4) DB 초기화
Supabase SQL Editor에서 아래 파일을 실행하세요.

```sql
supabase/schema.sql
```

### 5) 로컬 실행
```bash
npm run dev
```

### 6) 검증
```bash
npm run typecheck
npm test
npm run build
npm run verify
```

---

## 운영실(owner) 설정

운영실은 일반 계정이 아니라 **owner-only** 입니다.

둘 중 하나로 설정하세요.

### 방법 A: profile 플래그
```sql
insert into public.profiles (user_id, is_owner)
values ('YOUR_AUTH_USER_ID', true)
on conflict (user_id)
do update set is_owner = true;
```

### 방법 B: app_settings owner 목록
```sql
insert into public.app_settings (key, value_json)
values ('owner_user_ids', jsonb_build_array('YOUR_AUTH_USER_ID'))
on conflict (key)
do update set value_json = excluded.value_json;
```

---

## Supabase Storage / 에셋 전략

### 중요한 점
이제 캐릭터/월드는 **플랫폼에서 생성**하므로, 운영 중 생성되는 이미지는 로컬 `assets/` 폴더가 아니라 **Supabase Storage**에 저장됩니다.

- Storage bucket: `vmate-assets`
- 캐릭터 이미지: thumb / card / detail 파생본
- 월드 이미지: thumb / card / hero 파생본

### 로컬 `assets/` 폴더는 왜 남아 있나?
로컬 `assets/` 는 아래 용도만 남깁니다.
- 시드/데모 자산
- 초기 진입용 기본 이미지
- 개발 fallback 자산

즉, **운영 데이터용 필수 폴더는 아닙니다.**
운영에서 유저가 만드는 캐릭터/월드는 Storage를 씁니다.

---

## 이미지 정책

### 캐릭터
- 권장 비율: `3:4`
- 최소: `768x1024`
- 파생본: `thumb`, `card`, `detail`
- 감정/상황별 이미지 슬롯 지원
  - 예: `main`, `normal`, `happy`, `angry`, `night`, `battle`

### 월드
- 권장 비율: `16:9`
- 최소: `1280x720`
- 파생본: `thumb`, `card`, `hero`

### 업로드 처리
- 브라우저에서 리사이즈 후 업로드
- 업로드 원본은 JPG/PNG여도 서비스 전달용은 `WebP` 변환 권장
- 자동 크롭 적용
- 원본 비율과 결과 비율을 제작기에서 확인 가능

---

## 홈 / 인기 / 배너 기준

### 둘러보기 필터
- `신작`
- `인기`

### 인기 정렬 기준
1. `chat_start_count DESC`
2. `favorite_count DESC`
3. `updated_at DESC`

### 메인 배너
- 기본: `auto`
  - 실제 이용지표 상위 콘텐츠 자동 노출
- 운영실에서 `manual` 전환 가능
  - 특정 캐릭터/월드를 수동 지정

---

## CORS / Origin 정책

- 기본적으로 `ALLOWED_ORIGINS` 기반 허용
- **같은 호스트에서 서빙된 프론트 → API 요청**은 자동 허용
- 프론트와 API가 서로 다른 도메인/서브도메인이면 반드시 해당 Origin을 `ALLOWED_ORIGINS`에 추가해야 합니다.

예:
```env
ALLOWED_ORIGINS=https://your-frontend-domain.com,https://v-mate.jeonsavvy.workers.dev,http://localhost:5173,http://127.0.0.1:5173
```

---

## 왜 환경 변수가 많나?

많아 보이는 이유는 이 저장소가 **플랫폼 기능 + legacy chat 가드레일 + 운영 보안 옵션**을 같이 갖고 있기 때문입니다.

실제로 필수는 적습니다.

### 최소 필수
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` 또는 `VITE_SUPABASE_PUBLISHABLE_KEY`
- `GOOGLE_API_KEY`

### 운영 시 자주 보는 값
- `ALLOWED_ORIGINS`
- `REQUIRE_AUTH_FOR_CHAT`
- `RATE_LIMIT_STORE`
- `PROMPT_CACHE_STORE`

### 고급/튜닝용
- timeout / rate limit / dedupe / KV 관련 값

즉, **처음부터 전부 만질 필요는 없습니다.**

---

## Chat API 계약 (legacy + current backend guardrail)

- 메서드 정책: **`POST`만 허용**
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

보안 헤더:
- `X-Content-Type-Options: nosniff`

### 주요 에러 코드
- `METHOD_NOT_ALLOWED`
- `ORIGIN_NOT_ALLOWED`
- `REQUEST_BODY_TOO_LARGE`
- `UNSUPPORTED_CONTENT_TYPE`
- `RATE_LIMIT_EXCEEDED`

---

## 배포

### Worker 자동 배포
- GitHub Actions에서 **main branch push** 시 배포됩니다.
- 배포에는 아래 secret/설정이 필요합니다.
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` 또는 `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_CHAT_API_BASE_URL`

### Cloudflare / Wrangler
- `wrangler.jsonc` 는 `keep_vars: true`
- shell route는 `run_worker_first` 사용
- runtime env는 `window.__V_MATE_RUNTIME_ENV__` 로 주입

### 롤백
문제 생기면:
```bash
wrangler rollback
```

---

## 운영 체크리스트

1. migration 실행
2. owner 계정 설정
3. `ALLOWED_ORIGINS` 확인
4. 홈 `/` 확인
5. 캐릭터 생성 확인
6. 월드 생성 확인
7. 이미지 업로드 확인
8. 캐릭터 단독 대화 확인
9. 캐릭터 + 월드 대화 확인
10. 운영실 hide/show/delete 확인

---

## 남아 있는 주의점

- 외부 URL 이미지 삭제는 원격 원본까지 삭제되지 않습니다.
- Supabase migration 미적용 상태에서는 ops / owner / storage 흐름이 정상 동작하지 않습니다.
- cross-origin 구조면 same-host 예외만으로는 해결되지 않으므로 `ALLOWED_ORIGINS` 설정이 필요합니다.
