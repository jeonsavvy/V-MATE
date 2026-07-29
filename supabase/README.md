# Supabase SQL 구조

이 디렉터리는 같은 SQL을 여러 방식으로 실행하는 곳이 아닙니다. 파일 위치마다 적용 대상이 다릅니다.

## 디렉터리 역할

| 경로 | 대상 | 규칙 |
| --- | --- | --- |
| `schema.sql` | 비어 있는 신규 환경 | 현재 최종 상태를 한 번에 만드는 fresh-install snapshot |
| `migrations/*.sql` | 이미 운영 history가 있는 환경 | version 순서대로 적용하는 append-only 변경 이력 |
| `operations/*.sql` | 명시적으로 승인한 데이터 운영 | schema 변경과 분리된 수동 operation |
| `tests/database/*.sql` | 로컬 pgTAP | 최종 보안·동작 계약 |
| `tests/fixtures/*.sql` | 로컬 upgrade test | 과거 상태 재현용 fixture, 원격 적용 금지 |
| `tests/upgrade/*.sql` | 로컬 upgrade test | migration 이후 기존 데이터 보존 확인 |
| `config.toml` | 로컬 Supabase CLI | DB test runtime 설정 |

## 어떤 파일을 사용하는가

### 신규 환경

`schema.sql`을 사용합니다. 이 파일은 migration history를 대체하는 운영 upgrade 스크립트가 아닙니다.

로컬 검증:

```bash
npm run test:db:fresh
```

### 기존 환경

`schema.sql`을 다시 실행하지 않고 `migrations/`의 아직 적용되지 않은 파일만 version 순서대로 적용합니다. 원격 적용은 승인된 `.github/workflows/release-database.yml`을 사용합니다.

로컬 upgrade 검증:

```bash
npm run test:db:upgrade
```

### 수동 데이터 운영

`operations/`는 migration chain에 자동 포함되지 않습니다. 현재 `publish_starter_content.sql`은 starter 콘텐츠를 검토 후 게시하는 별도 operation입니다. schema upgrade나 장애 복구 수단으로 실행하지 않습니다.

## 현재 migration chain

| 순서 | 파일 | 역할 |
| --- | --- | --- |
| 1 | `20260721035619_b2c_platform_hardening.sql` | B2C 데이터 모델, owner 격리, 신고·quota |
| 2 | `20260721040304_tighten_database_function_privileges.sql` | 함수 실행 권한 축소 |
| 3 | `20260721040839_production_security_cleanup.sql` | 내부 함수·Storage 공개 표면 정리 |
| 4 | `20260721043317_remove_age_restrictions.sql` | 연령 확인 제거, 권리 확인 유지 |
| 5 | `20260726190559_backend_stabilization_expand.sql` | v2 호환 additive 확장 |
| 6 | `20260727000000_backend_stabilization_lockdown.sql` | v2 검증 후 브라우저 직접 쓰기 회수 |
| 7 | `20260729000000_prompt_read_views_expand.sql` | 기존 Worker 권한을 유지한 채 공개/owner 조회 view 추가 |
| 8 | `20260729010000_private_prompt_reads_lockdown.sql` | view 호환 Worker 검증 후 프롬프트 base-column 직접 조회 권한 회수 |

## 변경 규칙

1. 운영에 적용된 migration의 filename, version, 이름, SQL 내용을 수정·rename·squash하지 않습니다.
2. 2026-07-21 migration은 현재 운영 history의 version과 이름을 그대로 유지합니다.
3. 새 DB 변경은 새 timestamp의 forward migration으로 추가합니다.
4. 같은 변경의 최종 상태를 `schema.sql`에도 반영해 fresh와 upgrade 결과를 맞춥니다.
5. `operations/`의 데이터 변경을 migration에 숨기거나 migration을 수동 operation처럼 실행하지 않습니다.
6. `tests/fixtures/`는 테스트 입력이며 신규 환경 bootstrap이나 운영 복구에 사용하지 않습니다.

`schema.sql`은 긴 파일이지만 migration을 합쳐 놓은 정리 대상이 아닙니다. 신규 환경 결과와 기존 환경 upgrade 결과를 각각 검증하기 위해 두 진입점을 의도적으로 유지합니다.

## expand → lockdown 경계

적용 순서는 다음과 같습니다.

1. `20260726190559_backend_stabilization_expand.sql`
2. v2 Worker shadow/smoke/cutover 검증
3. 별도 승인
4. `20260727000000_backend_stabilization_lockdown.sql`
5. post-lockdown privilege smoke와 관찰

lockdown 이후에는 브라우저 직접 table/Storage 쓰기 권한을 되살리는 down migration을 사용하지 않습니다. 검증된 v2-compatible Worker를 복원하거나 새 forward migration을 작성합니다.

저장소의 lockdown source version은 `20260727000000`입니다. 기존 production evidence가 확인하는 remote history alias `20260727025134 / backend_stabilization_lockdown`은 release workflow가 관리합니다. source 파일을 alias에 맞춰 rename하거나 remote history를 수동 repair하지 않습니다.

프롬프트 read 경계도 같은 expand → Worker → lockdown 순서를 따릅니다.

1. `release-database.yml`에서 `release_track: prompt-privacy`, `operation: apply-expand`를 선택해 `20260729000000_prompt_read_views_expand.sql`을 적용합니다. 이 단계에서는 기존 base-table `SELECT` 권한을 유지합니다.
2. `release-worker.yml`에서 `database_release_track: prompt-privacy`와 해당 expand evidence를 선택하고 public, owner edit, room, prompt-context read를 검증합니다.
3. 별도 승인 후 `release-database.yml`에서 `release_track: prompt-privacy`, `operation: apply-lockdown`을 선택해 `20260729010000_private_prompt_reads_lockdown.sql`을 적용합니다. 이 단계는 브라우저의 `bridge_profile_json` 직접 읽기를 회수하고, 과거 방 상태에 복사됐을 수 있는 초기 상황·위치·관계·월드 용어 캐시와 첫 assistant 인사 메시지를 안전한 기본값으로 교체하므로 backup evidence가 필요합니다.
4. post-lockdown privilege smoke와 observation workflow가 lockdown evidence의 `releaseTrack`을 이어받아 프롬프트 column 차단과 safe view 권한을 검증합니다.

호환 Worker 검증 전에 prompt-read lockdown을 적용하지 않습니다. expand 단계 rollback은 view만 제거하며, lockdown rollback은 기존 Worker를 긴급 복구할 때만 broad read grant를 일시 복원하므로 disclosure surface가 다시 열립니다.

승인과 rollback evidence의 전체 순서는 [`docs/operations.md`](../docs/operations.md)를 확인하세요.

## 검증

두 DB 경로를 모두 확인합니다.

```bash
npm run test:db
```

이 harness는 로컬 Docker/Supabase만 사용하며 linked/remote target을 거부합니다.
