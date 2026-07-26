import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const readUtf8 = async (relativePath) =>
  readFile(path.join(repoRoot, relativePath), 'utf8');

test('github ci is read-only and Worker release requires a manual zero-traffic gate', async () => {
  const ci = await readUtf8('.github/workflows/ci.yml');
  const release = await readUtf8('.github/workflows/release-worker.yml');
  const smoke = await readUtf8('scripts/smoke-release.mjs');

  assert.doesNotMatch(ci, /CLOUDFLARE_API_TOKEN|versions deploy|cf:deploy/);
  assert.match(ci, /npm run verify/);
  assert.match(ci, /npm run test:server:coverage/);
  assert.match(ci, /npm run cf:dry-run/);
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /shadow/);
  assert.match(release, /cutover/);
  assert.match(release, /rollback/);
  assert.match(release, /@0%/);
  assert.match(release, /@100%/);
  assert.match(release, /--dry-run/);
  assert.match(release, /environment:/);
  assert.match(release, /concurrency:/);
  assert.match(release, /CLOUDFLARE_API_TOKEN/);
  assert.match(release, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(release, /Cloudflare-Workers-Version-Overrides|smoke-release\.mjs/);
  assert.match(release, /seq 1 13/);
  assert.match(release, /check-worker-observability\.mjs/);
  assert.match(release, /PREVIOUS_STABLE_VERSION_ID@100%/);
  assert.match(release, /automatic-rollback\.json/);
  assert.match(release, /expand_evidence_run_id/);
  assert.match(release, /EXPAND_PROJECT_REF_HASH/);
  assert.match(release, /rollback_mode/);
  assert.match(release, /rollback_evidence_run_id/);
  assert.match(release, /lockdown_evidence_run_id/);
  assert.match(release, /Prove live database rollback phase/);
  assert.match(release, /has_function_privilege/);
  assert.match(release, /api_direct_write_grant_count <> 0/);
  assert.match(release, /storage_write_policy_count/);
  assert.match(release, /release\.previousStableVersionId !== process\.env\.INPUT_VERSION_ID/);
  assert.match(release, /lockdown\.workerVersionId === release\.versionId/);
  assert.match(release, /rollback-preflight-smoke\.log/);
  assert.match(release, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(release, /APPROVED_ORIGIN=\$input_origin/);
  assert.match(release, /wrangler versions upload[\s\S]*--var "ALLOWED_ORIGINS:\$APPROVED_ORIGIN"/);
  assert.match(smoke, /\/auth\/recovery/);
});

test('database release stages expand and lockdown separately behind evidence gates', async () => {
  const release = await readUtf8('.github/workflows/release-database.yml');
  const fingerprintQuery = await readUtf8('scripts/capture-release-state.sql');
  const migrationFingerprintQuery = await readUtf8('scripts/capture-migration-state.sql');
  const jobEnvironment = release.match(/    env:\r?\n([\s\S]*?)\r?\n\r?\n    steps:/)?.[1] || '';

  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /dry-run-expand/);
  assert.match(release, /apply-expand/);
  assert.match(release, /dry-run-lockdown/);
  assert.match(release, /apply-lockdown/);
  assert.match(release, /worker_evidence_run_id/);
  assert.match(release, /observabilityPassed === true/);
  assert.match(release, /cronSuccesses >= 2/);
  assert.match(release, /db push[\s\S]*--dry-run/);
  assert.match(release, /PROJECT_REF.*EXPECTED_PROJECT_REF/);
  assert.match(release, /backup_evidence_run_id/);
  assert.match(release, /synthetic_evidence_run_id/);
  assert.match(release, /staging_privilege_evidence_run_id/);
  assert.match(release, /STAGING_PRIVILEGE_EVIDENCE_RUN_ID/);
  assert.match(release, /STAGING_PROJECT_REF/);
  assert.match(release, /Verify successful staging post-lockdown privilege smoke before production expand/);
  assert.match(release, /workflowName !== 'release-post-lockdown-privilege-smoke'/);
  assert.match(release, /post-lockdown-privilege-evidence-staging-/);
  assert.match(release, /evidence\.target === 'staging'/);
  assert.match(release, /update\(process\.env\.STAGING_PROJECT_REF\)/);
  assert.match(release, /evidence\.projectRefHash === stagingRefHash/);
  assert.match(release, /evidence\.allPassed === true/);
  assert.match(release, /previousStableWorkerVersionId/);
  assert.match(release, /expandProjectRefHash/);
  assert.match(release, /20260726190559_backend_stabilization_expand\.sql/);
  assert.match(release, /20260727000000_backend_stabilization_lockdown\.sql/);
  assert.match(release, /Verify consolidated legacy baseline before expand/);
  assert.match(release, /Require successful CI for this default-branch commit/);
  assert.match(release, /actions\/workflows\/ci\.yml\/runs\?head_sha=/);
  assert.match(release, /Database contracts \(local Docker only\)/);
  assert.doesNotMatch(jobEnvironment, /SUPABASE_ACCESS_TOKEN|GH_TOKEN/);
  assert.match(release, /Capture remote database state before preview/);
  assert.match(release, /scripts\/capture-release-state\.sql/);
  assert.match(fingerprintQuery, /from pg_policy policy_record/);
  assert.match(fingerprintQuery, /from pg_trigger trigger_record/);
  assert.match(fingerprintQuery, /release_state_fingerprint/);
  assert.match(release, /scripts\/capture-migration-state\.sql/);
  assert.match(migrationFingerprintQuery, /to_jsonb\(migration_record\)/);
  assert.match(migrationFingerprintQuery, /migration_rows_fingerprint/);
  assert.match(release, /migration-state-before\.txt/);
  assert.match(release, /migration-state-after-dry-run\.txt/);
  assert.match(release, /release-state-before\.txt/);
  assert.match(release, /release-state-after-dry-run\.txt/);
  assert.match(release, /path: artifacts\/database-release-evidence\.json/);
  assert.match(release, /retention-days: 7/);
  assert.doesNotMatch(release, /path: artifacts\/\s*$/m);
});

test('backup readiness and staging synthetic smoke are approval-gated and target-bound', async () => {
  const backup = await readUtf8('.github/workflows/release-backup-readiness.yml');
  const synthetic = await readUtf8('.github/workflows/release-staging-synthetic-smoke.yml');

  assert.match(backup, /workflow_dispatch:/);
  assert.match(backup, /options: \[staging, production\]/);
  assert.match(backup, /supabase backups list/);
  assert.doesNotMatch(backup, /npx --no-install supabase backups restore/);
  assert.match(backup, /PITR_APPROVED/);
  assert.match(backup, /BACKUP_APPROVED/);
  assert.match(backup, /private-artifacts/);

  assert.match(synthetic, /environment:/);
  assert.match(synthetic, /percentage === 0/);
  assert.match(synthetic, /staging-synthetic-smoke\.mjs/);
  assert.match(synthetic, /--confirm-staging-writes true/);
  assert.match(synthetic, /Cloudflare|worker-version|WORKER_VERSION_ID/);
  assert.match(synthetic, /scenarios/);
  assert.match(synthetic, /if: \$\{\{ always\(\) \}\}/);
});

test('post-lockdown privilege and delayed observation remain evidence-bound without grant restoration', async () => {
  const privilege = await readUtf8('.github/workflows/release-post-lockdown-privilege-smoke.yml');
  const observation = await readUtf8('.github/workflows/release-post-lockdown-observation.yml');

  assert.match(privilege, /apply-lockdown/);
  assert.match(privilege, /begin;/);
  assert.match(privilege, /rollback;/);
  assert.match(privilege, /reserve_daily_chat_message/);
  assert.match(privilege, /get_daily_chat_quota/);
  assert.match(privilege, /has_function_privilege/);
  assert.match(privilege, /remote-privilege-smoke\.mjs/);
  assert.match(privilege, /serviceRoleV2ReserveRefundAllowed/);
  assert.match(privilege, /gatewayScenarios/);
  assert.match(privilege, /sqlRoleProbePassed: sqlPassed/);
  assert.match(privilege, /httpGatewayProbePassed: remotePassed/);
  assert.doesNotMatch(privilege, /\bgrant\s+(?:all|insert|update|delete|execute)/i);
  assert.doesNotMatch(privilege, /\brevoke\s+/i);

  assert.match(observation, /elapsed<24\*60\*60\*1000/);
  assert.match(observation, /post-lockdown-privilege-evidence/);
  assert.match(observation, /lock\.workerVersionId === process\.env\.WORKER_VERSION_ID/);
  assert.match(observation, /previousStableWorkerVersionId/);
  assert.match(observation, /check-worker-observability\.mjs/);
});

test('local database harness refuses linked or remote targets and runs fresh plus upgrade contracts', async () => {
  const runner = await readUtf8('scripts/run-db-tests.mjs');

  assert.match(runner, /localhost.*127\.0\.0\.1.*::1/);
  assert.match(runner, /SUPABASE_PROJECT_REF is set; refusing to run a linked database test/);
  assert.match(runner, /Apply final schema\.sql/);
  assert.match(runner, /Apply pre-B2C schema fixture/);
  assert.match(runner, /includeUpgradeContracts: true/);
  assert.match(runner, /Duplicate Supabase migration versions detected/);
  assert.match(runner, /migration', 'up', '--local/);
  assert.doesNotMatch(runner, /--linked/);
});


test('wrangler config preserves dashboard vars during deploy', async () => {
  const wranglerConfig = await readUtf8('wrangler.jsonc');

  assert.match(wranglerConfig, /"keep_vars"\s*:\s*true/);
});


test('wrangler config serves SPA deep links while preserving runtime env injection', async () => {
  const wranglerConfig = await readUtf8('wrangler.jsonc');

  assert.match(wranglerConfig, /"not_found_handling"\s*:\s*"single-page-application"/);
  assert.match(wranglerConfig, /"run_worker_first"\s*:\s*\[/);
  for (const route of [
    '/api/*',
    '/',
    '/index.html',
    '/characters/*',
    '/worlds/*',
    '/rooms/*',
    '/chat/*',
    '/create/*',
    '/edit/*',
    '/recent',
    '/library',
    '/ops',
    '/privacy',
  ]) {
    assert.ok(wranglerConfig.includes(`"${route}"`), `missing worker-first route: ${route}`);
  }
});

test('wrangler config enables Cloudflare cron trigger for Supabase keepalive', async () => {
  const wranglerConfig = await readUtf8('wrangler.jsonc');

  assert.match(wranglerConfig, /"triggers"\s*:\s*\{/);
  assert.match(wranglerConfig, /"crons"\s*:\s*\[/);
  assert.match(wranglerConfig, /"3,18,33,48 \* \* \* \*"/);
});

test('README documents manual approved release, runtime prerequisites, and version rollback', async () => {
  const readme = await readUtf8('README.md');

  assert.match(readme, /main.*읽기 전용/i);
  assert.match(readme, /workflow_dispatch/);
  assert.match(readme, /CLOUDFLARE_API_TOKEN/);
  assert.match(readme, /CLOUDFLARE_OBSERVABILITY_TOKEN/);
  assert.match(readme, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(readme, /VITE_SUPABASE_URL/);
  assert.match(readme, /VITE_SUPABASE_ANON_KEY|VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(readme, /VITE_CHAT_API_BASE_URL/);
  assert.match(readme, /versions deploy/);
});
