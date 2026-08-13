import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script, runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';
import { runSupabaseReadOnlyQuery } from '../scripts/run-supabase-read-only-query.mjs';
import { selectSupabaseProjectApiKeys } from '../scripts/select-supabase-project-api-keys.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const readUtf8 = async (relativePath) =>
  readFile(path.join(repoRoot, relativePath), 'utf8');

const normalizeNewlines = (source) => source.replace(/\r\n?/g, '\n');

test('release workflow credentials are absent from job and npm ci environments', async () => {
  const releaseWorkflows = [
    'release-backup-readiness.yml',
    'release-database-baseline-attestation.yml',
    'release-database.yml',
    'release-prelaunch-attestation.yml',
    'release-post-lockdown-observation.yml',
    'release-post-lockdown-privilege-smoke.yml',
    'release-staging-synthetic-smoke.yml',
    'release-worker.yml',
  ];
  const credentialContext = /\$\{\{[\s\S]*?(?:\bsecrets(?:\.|\[)|\bgithub\.token\b)[\s\S]*?\}\}/i;
  const credentialName = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIALS?|KEY)(?:$|_)|^(?:SUPABASE_URL|CLOUDFLARE_ACCOUNT_ID)$/i;

  for (const file of releaseWorkflows) {
    const source = await readUtf8(`.github/workflows/${file}`);
    const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
    assert.deepEqual(document.errors, [], `${file} must parse as YAML`);
    for (const [jobName, job] of Object.entries(document.toJS().jobs || {})) {
      for (const [name, value] of Object.entries(job?.env || {})) {
        assert.equal(credentialName.test(name) || credentialContext.test(String(value)), false, `${file} job ${jobName} env ${name}`);
      }
      for (const [stepIndex, step] of (job?.steps || []).entries()) {
        if (typeof step?.run !== 'string' || !/\bnpm\s+ci\b/.test(step.run)) continue;
        for (const [name, value] of Object.entries(step.env || {})) {
          assert.equal(credentialName.test(name) || credentialContext.test(String(value)), false, `${file} npm ci step ${stepIndex + 1} env ${name}`);
        }
      }
    }
  }
});

test('github ci is read-only and Worker release requires a manual zero-traffic gate', async () => {
  const ci = normalizeNewlines(await readUtf8('.github/workflows/ci.yml'));
  const release = normalizeNewlines(await readUtf8('.github/workflows/release-worker.yml'));
  const releaseWorkflow = parseDocument(release, { uniqueKeys: true, version: '1.2' }).toJS();
  const shadowEvidenceStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Verify current-commit shadow upload and immutable version metadata',
  );
  const databaseEvidenceStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Verify matching database evidence before serving the new Worker',
  );
  const rollbackEvidenceStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Verify evidence-bound manual rollback target',
  );
  const captureBeforeStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Capture deployment before operation',
  );
  const uploadVersionStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Upload and register a zero-traffic Worker version',
  );
  const captureAfterStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Capture and verify deployment after operation',
  );
  const releaseEvidenceUpload = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Upload release evidence',
  );
  const buildReleaseAssetsStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Build release assets and record hashes',
  );
  const rollbackPreflightStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Preflight evidence-bound rollback version with zero-traffic override',
  );
  const selectedVersionSmokeStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Smoke selected Worker version and applicable assets',
  );
  const liveCutoverSmokeStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Verify live cutover once at public origin',
  );
  const liveRollbackSmokeStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Verify live rollback once at public origin',
  );
  const automaticRollbackStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Restore the previous stable version after a failed cutover gate',
  );
  const recordReleaseEvidenceStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Record machine-readable release evidence',
  );
  const baseline = normalizeNewlines(await readUtf8('.github/workflows/release-database-baseline-attestation.yml'));
  const database = normalizeNewlines(await readUtf8('.github/workflows/release-database.yml'));
  const smoke = await readUtf8('scripts/smoke-release.mjs');
  const baselineWorkflow = parseDocument(baseline, { uniqueKeys: true, version: '1.2' }).toJS();
  const releaseTargetStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Validate approved target',
  );
  const baselineScopeStep = baselineWorkflow.jobs.attest.steps.find(
    (step) => step.name === 'Validate protected read-only baseline scope',
  );
  const baselineCiStep = baselineWorkflow.jobs.attest.steps.find(
    (step) => step.name === 'Require successful CI for this default-branch commit',
  );
  const baselineRenewalStep = baselineWorkflow.jobs.attest.steps.find(
    (step) => step.name === 'Verify previous read-only baseline renewal source',
  );
  const baselineServingCutoverStep = baselineWorkflow.jobs.attest.steps.find(
    (step) => step.name === 'Verify serving cutover since renewed baseline',
  );
  const baselineOriginalLineageStep = baselineWorkflow.jobs.attest.steps.find(
    (step) => step.name === 'Verify deployed post-lockdown lineage',
  );
  const commonJsHeredocs = [...release.matchAll(/\bnode([^\r\n]*?)\s+<<'NODE'\r?\n([\s\S]*?)\r?\n\s*NODE(?=\r?\n|$)/g)];
  assert.ok(commonJsHeredocs.length > 0);
  for (const [index, match] of commonJsHeredocs.entries()) {
    assert.doesNotThrow(() => new Script(match[2], { filename: `release-worker.yml:node-heredoc-${index + 1}` }));
  }
  const baselineCommonJsHeredocs = [...baseline.matchAll(/\bnode([^\r\n]*?)\s+<<'NODE'\r?\n([\s\S]*?)\r?\n\s*NODE(?=\r?\n|$)/g)];
  assert.ok(baselineCommonJsHeredocs.length > 0);
  for (const [index, match] of baselineCommonJsHeredocs.entries()) {
    assert.doesNotThrow(() => new Script(`(async () => {\n${match[2]}\n})()`, { filename: `release-database-baseline-attestation.yml:node-heredoc-${index + 1}` }));
  }
  const expectedExpandBridgeFiles = [
    '.github/workflows/release-database.yml',
    '.github/workflows/release-worker.yml',
    'scripts/smoke-release.mjs',
    'scripts/validate-github-workflows.mjs',
    'server/deployment-workflow-sync.test.js',
    'server/smoke-release.test.js',
  ];
  const releaseBridgeAllowlist = release.match(/bridge_allowed_files=\$'([^']+)'/)?.[1].split('\\n');
  const databaseBridgeAllowlist = database.match(/bridge_allowed_files=\$'([^']+)'/)?.[1].split('\\n');

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
  assert.doesNotMatch(release, /seq 1 13|check-worker-observability\.mjs|Observe cutover for 60 minutes/);
  assert.equal(liveCutoverSmokeStep.if, "${{ inputs.operation == 'cutover' }}");
  assert.match(liveCutoverSmokeStep.run, /smoke-release\.mjs/);
  assert.match(liveCutoverSmokeStep.run, /--base-url "\$BASE_URL"/);
  assert.match(liveCutoverSmokeStep.run, /--dist-manifest artifacts\/dist-manifest\.json/);
  assert.match(liveCutoverSmokeStep.run, /--live-propagation true/);
  assert.match(liveCutoverSmokeStep.run, /--propagation-timeout-ms 20000/);
  assert.doesNotMatch(liveCutoverSmokeStep.run, /--worker-name|--version-id|\bsleep\b|\bfor\b|\bwhile\b/);
  assert.equal(liveRollbackSmokeStep.if, "${{ inputs.operation == 'rollback' }}");
  assert.match(liveRollbackSmokeStep.run, /smoke-release\.mjs/);
  assert.match(liveRollbackSmokeStep.run, /--base-url "\$BASE_URL"/);
  assert.doesNotMatch(liveRollbackSmokeStep.run, /--worker-name|--version-id|--dist-manifest|\bsleep\b/);
  assert.match(captureAfterStep.run, /Array\.isArray\(source\.versions\)/);
  assert.match(captureAfterStep.run, /ids\.size !== entries\.length/);
  assert.match(captureAfterStep.run, /Math\.abs\(total - 100\) > 1e-9/);
  assert.match(captureAfterStep.run, /entries\.length !== 1/);
  assert.match(captureAfterStep.run, /entries\[0\]\.id !== process\.env\.INPUT_VERSION_ID/);
  const automaticStatusIndex = automaticRollbackStep.run.indexOf('wrangler deployments status');
  const automaticStrictIndex = automaticRollbackStep.run.indexOf('source.versions.length !== 1');
  const automaticSmokeIndex = automaticRollbackStep.run.indexOf('smoke-release.mjs --base-url "$BASE_URL"');
  const automaticArtifactIndex = automaticRollbackStep.run.indexOf('automatic-rollback.json');
  assert.ok(automaticStatusIndex >= 0);
  assert.ok(automaticStrictIndex > automaticStatusIndex);
  assert.ok(automaticSmokeIndex > automaticStrictIndex);
  assert.ok(automaticArtifactIndex > automaticSmokeIndex);
  assert.ok(releaseWorkflow.jobs.release.steps.indexOf(recordReleaseEvidenceStep) < releaseWorkflow.jobs.release.steps.indexOf(automaticRollbackStep));
  assert.doesNotMatch(automaticRollbackStep.run, /--worker-name|--version-id|--dist-manifest/);
  assert.match(release, /monitorChecks: operation === 'cutover' \? 1 : 0/);
  assert.match(release, /monitorMinutes: 0/);
  assert.match(release, /PREVIOUS_STABLE_VERSION_ID@100%/);
  assert.match(release, /automatic-rollback\.json/);
  assert.match(release, /expand_evidence_run_id/);
  assert.match(release, /shadow_evidence_run_id/);
  assert.match(release, /shadow_evidence_run_id is required for smoke and cutover/);
  assert.match(release, /Verify current-commit shadow upload and immutable version metadata/);
  assert.match(release, /actions\/runs\/\$SHADOW_EVIDENCE_RUN_ID/);
  assert.match(release, /wrangler versions view "\$INPUT_VERSION_ID"/);
  assert.match(release, /workers\/tag/);
  assert.match(release, /workers\/message/);
  assert.match(release, /versionMetadataHash/);
  assert.match(release, /shadow\.schemaVersion === 4/);
  assert.match(release, /database_release_track/);
  assert.match(release, /options: \[backend-stabilization, prompt-privacy\]/);
  assert.match(release, /20260729000000_prompt_read_views_expand\.sql/);
  assert.match(release, /evidence\.releaseTrack === process\.env\.DATABASE_RELEASE_TRACK/);
  assert.match(release, /release\.databaseReleaseTrack === process\.env\.DATABASE_RELEASE_TRACK/);
  assert.match(release, /lockdown\.migration === expectedLockdownMigration/);
  assert.match(release, /release\.databaseEvidenceMode === 'expand'/);
  assert.match(release, /release\.databaseEvidenceMode === 'baseline'/);
  assert.match(release, /vmate\.release_track/);
  assert.match(release, /prompt pre-lockdown contract/);
  assert.match(release, /prompt post-lockdown contract/);
  assert.match(release, /raw_prompt_read_grant_count <> 12/);
  assert.match(release, /raw_prompt_read_grant_count <> 0/);
  assert.match(release, /authenticated_direct_write_grant_count <> 21/);
  assert.match(release, /api_direct_write_grant_count <> 42/);
  assert.match(release, /complete_legacy_chat_message_v2\(uuid,text,text,jsonb\)/);
  assert.match(release, /refund_chat_message_v2\(uuid,text,text,integer\)/);
  assert.match(release, /create_room_v2\(uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb\)/);
  assert.match(release, /reconcile_expired_chat_reservations_v2\(integer\)/);
  assert.match(release, /client_v2_rpc_grant_count <> 0/);
  assert.match(release, /safe_view_security_barrier_count <> 5/);
  assert.match(release, /safe_view_protected_column_count <> 0/);
  assert.match(release, /safe_view_projection_mismatch_count <> 0/);
  assert.match(release, /select \* from expected except select \* from actual/);
  assert.doesNotMatch(release, /pre-lockdown rollback is only valid for backend-stabilization/);
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
  assert.match(release, /const baselineBacked = release\.databaseEvidenceMode === 'baseline'/);
  assert.match(release, /baselineBacked \|\| process\.env\.LOCKDOWN_EVIDENCE_RUN_ID/);
  assert.match(release, /validBaselineRollback/);
  assert.match(release, /!process\.env\.LOCKDOWN_EVIDENCE_RUN_ID/);
  assert.match(release, /DATABASE_EVIDENCE_MODE === 'expand' \|\| process\.env\.DATABASE_EVIDENCE_MODE === 'baseline'/);
  assert.match(release, /rollback-preflight-smoke\.log/);
  assert.match(release, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(release, /APPROVED_ORIGIN=\$input_origin/);
  assert.match(release, /wrangler triggers deploy --env "" --name "\$WORKER_NAME" --dry-run/);
  assert.match(release, /wrangler triggers deploy --env "" --name "\$WORKER_NAME"\n/);
  assert.match(release, /release_allowed_origins="\$APPROVED_ORIGIN,\$LEGACY_ORIGIN"/);
  assert.match(release, /baseline_evidence_run_id/);
  assert.match(release, /exactly one expand_evidence_run_id or baseline_evidence_run_id is required/);
  const unchangedMigrationGuard = /git diff --quiet "\$BASELINE_SOURCE_SHA" "\$GITHUB_SHA" -- supabase\/migrations\//;
  assert.match(baselineScopeStep.run, unchangedMigrationGuard);
  assert.match(releaseTargetStep.run, unchangedMigrationGuard);
  assert.match(baselineScopeStep.run, /baseline attestation requires an approved non-migration release/);
  assert.match(baselineCiStep.run, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$\{process\.env\.GITHUB_SHA\}/);
  assert.match(baselineCiStep.run, /candidate\.event === 'push'/);
  assert.match(baselineCiStep.run, /\['quality', 'Database contracts \(local Docker only\)'\]/);
  assert.match(databaseEvidenceStep.run, /run\.conclusion === 'success'/);
  assert.match(databaseEvidenceStep.run, /run\.head_sha === process\.env\.GITHUB_SHA/);
  assert.match(databaseEvidenceStep.run, /run\.path === expectedPath/);
  assert.doesNotMatch(baselineScopeStep.run, /allowed-baseline-files|change scope is not allowlisted|-- supabase server\/platform server\/chat-handler\.js worker\.js/);
  assert.doesNotMatch(releaseTargetStep.run, /\n\s*allowed_files=|baseline evidence change scope is not allowlisted|-- supabase server\/platform server\/chat-handler\.js worker\.js/);
  assert.match(release, /AUTHORIZED_DOMAIN_RELEASE_SHA/);
  assert.match(release, /AUTHORIZED_BASELINE_RELEASE_SHA/);
  assert.match(release, /post-lockdown proof source change scope is not the exact verified set/);
  assert.match(release, /Date\.now\(\) - Date\.parse\(evidence\.attestedAt\) <= 6 \* 60 \* 60 \* 1000/);
  assert.match(release, /actions\/runs\/\$BASELINE_EVIDENCE_RUN_ID/);
  assert.match(release, /actions\/workflows\/release-database-baseline-attestation\.yml/);
  assert.match(release, /actions\/runs\/\$EXPAND_EVIDENCE_RUN_ID/);
  assert.match(release, /actions\/workflows\/release-database\.yml/);
  assert.deepEqual(releaseBridgeAllowlist, expectedExpandBridgeFiles);
  assert.deepEqual(databaseBridgeAllowlist, expectedExpandBridgeFiles);
  assert.match(release, /expand_bridge_prelaunch_evidence_run_id/);
  assert.match(release, /EXPAND_BRIDGE_PRELAUNCH_EVIDENCE_RUN_ID/);
  assert.match(release, /EXPAND_EVIDENCE_RUN_ID === '30461795102'/);
  assert.match(release, /run\.head_sha === 'd839befb167ca1024258ac01198ec96c3d3b3837'/);
  assert.match(release, /expand evidence bridge must run from the default branch/);
  assert.match(release, /expand bridge change scope is not the exact release-only set/);
  assert.match(release, /expand bridge files must be in-place modifications/);
  assert.match(release, /expand bridge attestation must be empty for current-commit evidence/);
  assert.match(release, /prelaunchRun\.head_sha === process\.env\.GITHUB_SHA/);
  assert.match(release, /prelaunchRun\.head_branch === process\.env\.DEFAULT_BRANCH/);
  assert.match(release, /prelaunch\.rowCountHash === evidence\.prelaunchOriginalRowCountHash/);
  assert.match(release, /prelaunch\.protectedStateHash === evidence\.prelaunchOriginalProtectedStateHash/);
  assert.match(release, /prelaunch\.catalogStateHash === expectedCatalogStateHash/);
  assert.match(release, /createHmac\('sha256', process\.env\.SUPABASE_ACCESS_TOKEN\)/);
  assert.match(release, /attestedAt >= appliedAt/);
  assert.match(release, /schemaVersion: 4/);
  assert.match(release, /baselineServingVersionId/);
  assert.match(release, /serving Worker changed after the baseline attestation/);
  assert.match(captureBeforeStep.run, /previous_stable_version_id" == "\$BASELINE_SERVING_VERSION_ID/);
  assert.match(release, /release\.previousStableVersionId === process\.env\.INPUT_VERSION_ID/);
  assert.match(release, /ROLLBACK_SOURCE_VERSION_ID=\$\{process\.env\.INPUT_VERSION_ID\}/);
  assert.match(release, /expandEvidenceCommit:/);
  assert.match(release, /expandBridgePrelaunchEvidenceRunId:/);
  assert.match(database, /fetch-depth: 0/);
  assert.match(database, /LOCKDOWN_EXPAND_EVIDENCE_COMMIT/);
  assert.match(database, /LOCKDOWN_EXPAND_BRIDGE_PRELAUNCH_EVIDENCE_RUN_ID/);
  assert.match(database, /evidence\.expandEvidenceRunId === '30461795102'/);
  assert.match(database, /evidence\.expandEvidenceCommit === 'd839befb167ca1024258ac01198ec96c3d3b3837'/);
  assert.match(database, /evidence\.expandBridgePrelaunchEvidenceRunId[\s\S]*process\.env\.PRELAUNCH_EVIDENCE_RUN_ID/);
  assert.match(database, /run\.head_sha === process\.env\.LOCKDOWN_EXPAND_EVIDENCE_COMMIT/);
  assert.match(database, /evidence\.commit === process\.env\.LOCKDOWN_EXPAND_EVIDENCE_COMMIT/);
  assert.match(database, /PRELAUNCH_CURRENT_CATALOG_STATE_HASH === expectedCatalogStateHash/);
  assert.match(database, /createHmac\('sha256', process\.env\.SUPABASE_ACCESS_TOKEN\)/);
  assert.match(database, /process\.env\.PRELAUNCH_EVIDENCE_RUN_ID/);
  assert.match(release, /dist\/release-version\.txt/);
  assert.match(smoke, /asset\.path === 'release-version\.txt'/);
  assert.match(smoke, /livePropagation && !propagationTimeoutValue/);
  assert.match(smoke, /livePropagation && propagationTimeoutMs > 20_000/);
  assert.match(smoke, /livePropagation && workerName/);
  assert.match(smoke, /const propagationMode = Boolean\(manifestPaths && \(workerName \|\| livePropagation\)\)/);
  assert.match(smoke, /Live release identity did not propagate before the deadline/);
  assert.match(smoke, /Homepage verification failed after propagation deadline/);
  assert.match(smoke, /performance\.now\(\)/);
  assert.match(smoke, /maximumAssetBytes/);
  assert.match(smoke, /maximumManifestBytes/);
  assert.match(smoke, /digestBoundedAsset/);
  assert.match(smoke, /response\.body\.getReader\(\)/);
  assert.doesNotMatch(smoke, /Buffer\.from\(await response\.arrayBuffer\(\)\)/);
  assert.equal(buildReleaseAssetsStep.if, "${{ inputs.operation != 'rollback' }}");
  assert.doesNotMatch(rollbackPreflightStep.run, /--dist-manifest/);
  const rollbackSmokeBranch = selectedVersionSmokeStep.run.match(/if \[\[ '\$\{\{ inputs\.operation \}\}' == 'rollback' \]\]; then([\s\S]*?)else/)?.[1] || '';
  assert.match(rollbackSmokeBranch, /smoke-release\.mjs/);
  assert.doesNotMatch(rollbackSmokeBranch, /--dist-manifest/);
  assert.equal((selectedVersionSmokeStep.run.match(/--dist-manifest/g) || []).length, 1);
  assert.equal(releaseWorkflow.jobs.release.env.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  for (const binding of [
    /run\.id === Number\(process\.env\.SHADOW_EVIDENCE_RUN_ID\)/,
    /run\.conclusion === 'success'/,
    /run\.status === 'completed'/,
    /run\.event === 'workflow_dispatch'/,
    /run\.head_sha === process\.env\.GITHUB_SHA/,
    /run\.head_branch === process\.env\.DEFAULT_BRANCH/,
    /run\.path === expectedPath/,
    /workflow\.path === expectedPath/,
    /run\.workflow_id === workflow\.id/,
    /gh run download "\$SHADOW_EVIDENCE_RUN_ID"/,
  ]) assert.match(shadowEvidenceStep.run, binding);
  assert.match(release, /run\.workflow_id === workflow\.id/);
  assert.match(release, /run\.path === expectedPath/);
  assert.match(release, /workflow\.path === expectedPath/);
  assert.match(release, /node <<'NODE'\r?\n          const fs = require\('node:fs'\);[\s\S]*?\r?\n          NODE\r?\n            gh run download/);
  assert.doesNotMatch(release, /!\s+git diff --quiet/);
  assert.match(release, /wrangler versions upload[\s\S]*--var "ALLOWED_ORIGINS:\$release_allowed_origins"/);
  assert.match(databaseEvidenceStep.run, /mktemp -d "\$RUNNER_TEMP\/vmate-database-evidence-/);
  assert.match(databaseEvidenceStep.run, /trap 'rm -rf -- "\$DATABASE_VERIFY_DIR"' EXIT/);
  assert.match(rollbackEvidenceStep.run, /mktemp -d "\$RUNNER_TEMP\/vmate-rollback-evidence-/);
  assert.match(rollbackEvidenceStep.run, /run\.head_branch === process\.env\.DEFAULT_BRANCH/);
  assert.match(captureBeforeStep.run, /mktemp "\$RUNNER_TEMP\/vmate-deployment-before-/);
  assert.match(uploadVersionStep.run, /mktemp "\$RUNNER_TEMP\/vmate-wrangler-output-/);
  assert.match(captureAfterStep.run, /mktemp "\$RUNNER_TEMP\/vmate-deployment-after-/);
  assert.doesNotMatch(release, /artifacts\/(?:database-evidence|rollback-evidence|deployment-before\.json|deployment-after\.json|wrangler-output\.jsonl)/);
  assert.deepEqual(
    releaseEvidenceUpload.with.path.trim().split(/\r?\n/).sort(),
    ['artifacts/automatic-rollback.json', 'artifacts/release-evidence.json'].sort(),
  );
  assert.match(baseline, /environment: production-db-baseline-attestation/);
  assert.match(baseline, /READ_ONLY_BASELINE_APPROVED/);
  assert.match(baseline, /AUTHORIZED_BASELINE_RELEASE_SHA/);
  assert.match(baseline, /release_track:/);
  assert.match(baseline, /lockdown_evidence_run_id:/);
  assert.match(baseline, /privilege_evidence_run_id:/);
  assert.match(baseline, /verification_evidence_run_id:/);
  assert.ok(baselineWorkflow.on.workflow_dispatch.inputs.previous_baseline_evidence_run_id);
  assert.ok(baselineWorkflow.on.workflow_dispatch.inputs.serving_cutover_evidence_run_id);
  assert.ok(baselineRenewalStep);
  assert.ok(baselineServingCutoverStep);
  assert.equal(baselineRenewalStep.if, "${{ inputs.previous_baseline_evidence_run_id != '' }}");
  assert.equal(baselineRenewalStep.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(
    baselineServingCutoverStep.if,
    "${{ inputs.previous_baseline_evidence_run_id != '' && inputs.serving_cutover_evidence_run_id != '' }}",
  );
  assert.equal(baselineServingCutoverStep.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(baselineOriginalLineageStep.if, "${{ inputs.previous_baseline_evidence_run_id == '' }}");
  for (const required of [
    'actions/runs/$PREVIOUS_BASELINE_EVIDENCE_RUN_ID',
    'actions/workflows/release-database-baseline-attestation.yml',
    'database-baseline-evidence-production-$PREVIOUS_BASELINE_EVIDENCE_RUN_ID',
    "run.conclusion === 'success'",
    "run.status === 'completed'",
    "run.event === 'workflow_dispatch'",
    'run.head_sha === evidence.commit',
    'run.head_branch === process.env.DEFAULT_BRANCH',
    'run.path === expectedWorkflowPath',
    'workflow.path === expectedWorkflowPath',
    'run.workflow_id === workflow.id',
    'evidence.remoteStateFingerprint',
    'evidence.migrationRowsFingerprint',
    'evidence.lockdownEvidenceRunId === process.env.LOCKDOWN_EVIDENCE_RUN_ID',
    'evidence.privilegeEvidenceRunId === process.env.PRIVILEGE_EVIDENCE_RUN_ID',
    'evidence.verificationEvidenceRunId === process.env.VERIFICATION_EVIDENCE_RUN_ID',
    'fs.writeFileSync(process.env.RENEWAL_COMMIT_FILE',
    'PREVIOUS_BASELINE_COMMIT=$(<"$RENEWAL_COMMIT_FILE")',
    'git merge-base --is-ancestor "$PREVIOUS_BASELINE_COMMIT" "$GITHUB_SHA"',
    'git diff --quiet "$PREVIOUS_BASELINE_COMMIT" "$GITHUB_SHA" -- supabase/migrations/',
  ]) {
    assert.match(baselineRenewalStep.run, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(baselineRenewalStep.run, /database-release-evidence-production-/);
  for (const required of [
    'actions/runs/$SERVING_CUTOVER_EVIDENCE_RUN_ID',
    'actions/workflows/release-worker.yml',
    'release-evidence-production-$SERVING_CUTOVER_EVIDENCE_RUN_ID',
    "run.conclusion === 'success'",
    "run.status === 'completed'",
    "run.event === 'workflow_dispatch'",
    'run.head_sha === evidence.commit',
    'run.head_branch === process.env.DEFAULT_BRANCH',
    'run.path === expectedWorkflowPath',
    'workflow.path === expectedWorkflowPath',
    'run.workflow_id === workflow.id',
    "evidence.operation === 'cutover'",
    "evidence.databaseEvidenceMode === 'baseline'",
    'evidence.baselineEvidenceRunId === process.env.PREVIOUS_BASELINE_EVIDENCE_RUN_ID',
    'evidence.baselineServingVersionId === process.env.LINEAGE_WORKER_VERSION_ID',
    'evidence.previousStableVersionId === process.env.LINEAGE_WORKER_VERSION_ID',
    'evidence.versionTag === `github-${evidence.shadowEvidenceRunId}-${evidence.shadowRunAttempt}`',
    'evidence.smokePassed === true',
    'evidence.monitorChecks === 1',
    'LINEAGE_WORKER_VERSION_ID=${evidence.versionId}',
    'LINEAGE_PREVIOUS_STABLE_VERSION_ID=${evidence.previousStableVersionId}',
    'git merge-base --is-ancestor "$PREVIOUS_BASELINE_COMMIT" "$SERVING_CUTOVER_COMMIT"',
    'git merge-base --is-ancestor "$SERVING_CUTOVER_COMMIT" "$GITHUB_SHA"',
  ]) {
    assert.match(baselineServingCutoverStep.run, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(
    baselineScopeStep.run,
    /serving cutover evidence requires previous baseline evidence/,
  );
  assert.match(baseline, /schemaVersion: 3/);
  assert.match(baseline, /previousBaselineEvidenceRunId:/);
  assert.match(baseline, /servingCutoverEvidenceRunId:/);
  assert.match(release, /baselineV3Keys/);
  assert.match(release, /evidence\.schemaVersion === 3/);
  assert.match(baseline, /Verify deployed post-lockdown lineage/);
  assert.match(baseline, /084b38123a37e70d3fa51093fe44b39098a36bc2/);
  assert.match(baseline, /b2b997f6c0eec183509cf2bc4241fc29eb2f6b7e/);
  assert.match(baseline, /if: \$\{\{ success\(\) \}\}/);
  assert.match(baseline, /database-baseline-evidence-production-/);
  assert.match(baseline, /20260727000000/);
  assert.match(baseline, /20260727025134/);
  assert.match(baseline, /lockdownMigrationAliasHash/);
  assert.match(baseline, /run-supabase-read-only-query\.mjs/);
  assert.match(baseline, /baseline release cannot add, remove, rename, or modify database migrations/);
  assert.match(baseline, /queryMode: 'supabase_read_only_user'/);
  assert.match(baseline, /serviceV2MutationRpcsCallable/);
  assert.match(baseline, /clientV2MutationRpcsBlocked/);
  assert.match(baseline, /promptPrivacyMigrationsApplied/);
  assert.match(baseline, /privatePromptSchemaBlocked/);
  assert.match(baseline, /privatePromptTablesBlocked/);
  assert.match(baseline, /clientPromptColumnsBlocked/);
  assert.match(baseline, /safeViewDefinitionsMatch/);
  assert.match(baseline, /pg_get_viewdef/);
  assert.match(baseline, /is distinct from expected\.definition_hash/);
  for (const definitionHash of [
    '71437e126b6b647e3f50ff91d98bd3f3f27a535e4be3df00f1a39d22b49f5533',
    '47b2bcab5843cc366d8888074e1950ab1e71bf79708124b265e8f313ec6eaafa',
    '2006d2f05a8b3ad0ab3039ef82e29802a5b720e3b7dcca48ef4d7636b6bfcf41',
    '169aa590d66bddec5a10e6428a548ada4cbba51f7c04a147652a8582d9609c74',
    'd6600ea38a78da1ee3a4c4779dd459250f887908eb40b13bbd3f64adb1c9437c',
  ]) {
    assert.match(baseline, new RegExp(definitionHash));
  }
  assert.match(release, /safeViewDefinitionsMatch/);
  assert.match(baseline, /Current database fingerprints do not match the applied lockdown evidence/);
  assert.match(baseline, /complete_legacy_chat_message_v2\(uuid,text,text,jsonb\)/);
  assert.match(baseline, /commit_room_turn_v2\(uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb\)/);
  assert.match(baseline, /Record sanitized read-only baseline evidence[\s\S]*trap 'rm -rf private-artifacts' EXIT/);
  assert.doesNotMatch(baseline, /!\s+git diff --quiet/);
  assert.doesNotMatch(baseline, /supabase db push|supabase db query|confirm-remote-writes|^\s*(?:insert|update|delete)\s+/im);
  assert.match(smoke, /\/auth\/recovery/);
});

test('read-only database attestation uses only the dedicated Management API endpoint', async () => {
  const calls = [];
  const payload = await runSupabaseReadOnlyQuery({
    projectRef: 'shwatxuoowaboymrpdjs',
    accessToken: 'test-access-token',
    query: 'select 1 as ok;',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([{ ok: 1 }]), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.deepEqual(payload, [{ ok: 1 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/shwatxuoowaboymrpdjs/database/query/read-only');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer test-access-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'select 1 as ok;' });

  await assert.rejects(
    runSupabaseReadOnlyQuery({
      projectRef: 'shwatxuoowaboymrpdjs',
      accessToken: 'test-access-token',
      query: 'select 1;',
      fetchImpl: async () => new Response(JSON.stringify({ message: 'private backend detail' }), { status: 403 }),
    }),
    (error) => error.message === 'Supabase read-only query failed with status 403.'
      && !error.message.includes('private backend detail'),
  );
});

test('database release stages expand and lockdown separately behind evidence gates', async () => {
  const release = await readUtf8('.github/workflows/release-database.yml');
  const releaseWorkflow = parseDocument(release, { uniqueKeys: true, version: '1.2' }).toJS();
  const cutoverEvidenceStep = releaseWorkflow.jobs.release.steps.find(
    (step) => step.name === 'Verify compatible Worker cutover evidence before lockdown',
  );
  const fingerprintQuery = await readUtf8('scripts/capture-release-state.sql');
  const migrationFingerprintQuery = await readUtf8('scripts/capture-migration-state.sql');
  const jobEnvironment = release.match(/    env:\r?\n([\s\S]*?)\r?\n\r?\n    steps:/)?.[1] || '';

  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /dry-run-expand/);
  assert.match(release, /apply-expand/);
  assert.match(release, /dry-run-lockdown/);
  assert.match(release, /apply-lockdown/);
  assert.match(release, /release_track/);
  assert.match(release, /options: \[backend-stabilization, prompt-privacy\]/);
  assert.match(release, /worker_evidence_run_id/);
  assert.match(release, /evidence\.monitorChecks === 1/);
  assert.match(release, /evidence\.monitorMinutes === 0/);
  assert.match(release, /evidence\.observabilityPassed === null/);
  assert.match(release, /evidence\.observabilityMetrics === null/);
  assert.match(release, /evidence\.observabilityWindow === null/);
  assert.match(release, /evidence\.baselineWindow === null/);
  assert.match(release, /db push[\s\S]*--dry-run/);
  assert.match(release, /PROJECT_REF.*EXPECTED_PROJECT_REF/);
  assert.match(release, /backup_evidence_run_id/);
  assert.match(release, /backup_evidence_run_id is required before apply-expand and prompt-privacy apply-lockdown unless the approved prelaunch path applies/);
  assert.match(release, /Verify approved backup readiness before expand or prompt privacy lockdown/);
  assert.match(release, /inputs\.prelaunch_evidence_run_id == ''/);
  assert.match(release, /const backupRequired = !prelaunch && \(operation === 'apply-expand'[\s\S]*process\.env\.RELEASE_TRACK === 'prompt-privacy' && operation === 'apply-lockdown'/);
  assert.match(release, /backupEvidenceRunId: backupRequired \? process\.env\.BACKUP_EVIDENCE_RUN_ID : null/);
  assert.match(release, /prelaunch_evidence_run_id/);
  assert.match(release, /PRELAUNCH_EVIDENCE_RUN_ID/);
  assert.match(release, /exactly one staging privilege or prelaunch evidence run is required/);
  assert.match(release, /prelaunch and physical backup evidence are mutually exclusive/);
  assert.match(release, /Verify fresh production prelaunch attestation/);
  assert.match(release, /actions\/workflows\/release-prelaunch-attestation\.yml/);
  assert.match(release, /prelaunch-attestation-evidence-production-/);
  assert.match(release, /run\.workflow_id === workflow\.id/);
  assert.match(release, /run\.head_sha === process\.env\.GITHUB_SHA/);
  assert.match(release, /Date\.now\(\) - attestedAt <= 6 \* 60 \* 60 \* 1000/);
  assert.match(release, /evidence\.prelaunchDirectApproved === true/);
  assert.match(release, /evidence\.productionProjectGuardPassed === true/);
  assert.match(release, /evidence\.defaultBranchCiPassed === true/);
  assert.match(release, /Verify prelaunch evidence matches the production expand chain/);
  assert.match(release, /actions\/runs\/\$LOCKDOWN_EXPAND_EVIDENCE_RUN_ID/);
  assert.match(release, /actions\/workflows\/release-database\.yml/);
  assert.equal(cutoverEvidenceStep.env.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  for (const binding of [
    /run\.id === Number\(process\.env\.WORKER_EVIDENCE_RUN_ID\)/,
    /run\.conclusion === 'success'/,
    /run\.status === 'completed'/,
    /run\.event === 'workflow_dispatch'/,
    /run\.head_sha === process\.env\.GITHUB_SHA/,
    /run\.head_branch === process\.env\.DEFAULT_BRANCH/,
    /run\.path === expectedWorkflowPath/,
    /workflow\.path === expectedWorkflowPath/,
    /run\.workflow_id === workflow\.id/,
    /gh run download "\$WORKER_EVIDENCE_RUN_ID"/,
  ]) assert.match(cutoverEvidenceStep.run, binding);
  assert.match(release, /evidence\.prelaunchOriginalRowCountHash === process\.env\.PRELAUNCH_CURRENT_ROW_COUNT_HASH/);
  assert.match(release, /evidence\.prelaunchOriginalProtectedStateHash === process\.env\.PRELAUNCH_CURRENT_PROTECTED_STATE_HASH/);
  assert.match(release, /prelaunchOriginalEvidenceRunId/);
  assert.match(release, /prelaunchRenewalEvidenceRunId/);
  assert.match(release, /prelaunchRenewalCatalogStateHash/);
  assert.match(release, /Recheck prelaunch data and catalog immediately before apply/);
  assert.match(release, /current\.catalog === process\.env\.PRELAUNCH_CURRENT_CATALOG_STATE_HASH/);
  assert.match(release, /current\.rows === process\.env\.PRELAUNCH_CURRENT_ROW_COUNT_HASH/);
  assert.match(release, /current\.protectedState === process\.env\.PRELAUNCH_CURRENT_PROTECTED_STATE_HASH/);
  assert.match(release, /Verify prompt privacy logical backup source contract/);
  assert.match(release, /vmate_private\.prompt_lockdown_room_state_backup_20260729/);
  assert.match(release, /vmate_private\.prompt_lockdown_greeting_backup_20260729/);
  assert.match(release, /vmate_private\.prompt_lockdown_backup_manifest_20260729/);
  assert.match(release, /Logical backups must be populated before destructive prompt scrubbing/);
  assert.match(release, /Verify immutable prompt backup manifest and role denial after lockdown/);
  assert.match(release, /prompt logical backup manifest parity failed/);
  assert.match(release, /state_payload_hash/);
  assert.match(release, /greeting_payload_hash/);
  assert.match(release, /PUBLIC retains a prompt logical backup table privilege/);
  assert.match(release, /pg_catalog\.unnest\(array\['anon', 'authenticated', 'service_role'\]\)/);
  assert.match(release, /immutablePromptBackupManifestVerified:/);
  const postApplyBackupCheck = release.match(/- name: Verify immutable prompt backup manifest[\s\S]*?(?=\n      - name: Verify complete service-only)/)?.[0] || '';
  assert.doesNotMatch(postApplyBackupCheck, /from public\.room_state_summaries|from public\.room_messages/);
  const sourceCheck = release
    .match(/- name: Verify prompt privacy logical backup source contract[\s\S]*?node <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/)?.[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  assert.ok(sourceCheck);
  assert.doesNotThrow(() => runInNewContext(sourceCheck, { require: createRequire(import.meta.url) }));
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
  assert.match(release, /20260729000000_prompt_read_views_expand\.sql/);
  assert.match(release, /20260729010000_private_prompt_reads_lockdown\.sql/);
  assert.match(release, /evidence\.databaseReleaseTrack === process\.env\.RELEASE_TRACK/);
  assert.match(release, /evidence\.releaseTrack === process\.env\.RELEASE_TRACK/);
  assert.match(release, /evidence\.expandMigration === expectedExpandMigration/);
  assert.match(release, /SYNTHETIC_EXPAND_EVIDENCE_RUN_ID/);
  assert.match(release, /evidence\.expandEvidenceRunId === process\.env\.SYNTHETIC_EXPAND_EVIDENCE_RUN_ID/);
  assert.match(release, /evidence\.schemaVersion === 4/);
  assert.match(release, /immutableVersionBound/);
  assert.match(release, /actions\/runs\/\$WORKER_EVIDENCE_RUN_ID/);
  assert.match(release, /Verify complete service-only v2 RPC contract after apply/);
  assert.match(release, /a browser role retains a service-only v2 RPC grant/);
  assert.match(release, /20260727025134_backend_stabilization_lockdown\.sql/);
  assert.match(release, /Verify production lockdown migration alias before prompt release/);
  assert.match(release, /supabase_migrations\.schema_migrations/);
  assert.match(release, /destination_filename="\$filename"/);
  assert.match(release, /\('anon', 'public\.characters', 'profile_json'\)/);
  assert.match(release, /\('authenticated', 'public\.rooms', 'resolved_prompt_snapshot_json'\)/);
  assert.match(release, /Verify consolidated legacy baseline before expand/);
  assert.match(release, /Require successful CI for this default-branch commit/);
  assert.match(release, /actions\/workflows\/ci\.yml\/runs\?head_sha=/);
  assert.match(release, /Database contracts \(local Docker only\)/);
  assert.doesNotMatch(jobEnvironment, /SUPABASE_ACCESS_TOKEN|GH_TOKEN/);
  assert.match(release, /Capture remote database state before preview/);
  assert.match(release, /scripts\/capture-release-state\.sql/);
  assert.match(fingerprintQuery, /from pg_catalog\.pg_policy policy_record/);
  assert.match(fingerprintQuery, /from pg_catalog\.pg_trigger trigger_record/);
  assert.doesNotMatch(fingerprintQuery, /pg_catalog\.coalesce/);
  assert.doesNotMatch(fingerprintQuery, /\b(?:from|join|left join)\s+pg_(?:class|namespace|attribute|attrdef|constraint|policy|proc|trigger)\b/i);
  assert.match(fingerprintQuery, /release_state_fingerprint/);
  assert.match(fingerprintQuery, /'vmate_private'/);
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

test('prelaunch direct production attestation is protected, read-only, fresh, and sanitized', async () => {
  const attestation = await readUtf8('.github/workflows/release-prelaunch-attestation.yml');
  const release = await readUtf8('.github/workflows/release-database.yml');
  const rowCounts = await readUtf8('scripts/capture-prelaunch-row-counts.sql');
  const protectedState = await readUtf8('scripts/capture-prelaunch-protected-state.sql');
  const evidenceBlock = attestation.match(/const evidence = \{([\s\S]*?)\n\s+\};/)?.[1] || '';
  const jobEnvironment = attestation.match(/    env:\r?\n([\s\S]*?)\r?\n\r?\n    steps:/)?.[1] || '';

  assert.match(attestation, /workflow_dispatch:/);
  assert.match(attestation, /environment: production-db-preflight/);
  assert.match(attestation, /PRELAUNCH_DIRECT_APPROVED/);
  assert.match(attestation, /\$PROJECT_REF" == "\$EXPECTED_PROJECT_REF"/);
  assert.match(attestation, /\$PROJECT_REF" == "\$PRODUCTION_PROJECT_REF"/);
  assert.match(attestation, /Require successful CI for this default-branch commit/);
  assert.match(attestation, /actions\/workflows\/ci\.yml\/runs\?head_sha=/);
  assert.match(attestation, /Database contracts \(local Docker only\)/);
  assert.match(attestation, /run-supabase-read-only-query\.mjs/);
  assert.match(attestation, /scripts\/capture-release-state\.sql/);
  assert.match(attestation, /scripts\/capture-migration-state\.sql/);
  assert.match(attestation, /catalogStateHash/);
  assert.match(attestation, /rowCountHash/);
  assert.match(attestation, /protectedStateHash/);
  assert.match(attestation, /createHmac\('sha256', evidenceKey\)/);
  assert.match(rowCounts, /from auth\.users/);
  assert.match(rowCounts, /from storage\.objects/);
  assert.match(protectedState, /from auth\.users/);
  assert.match(protectedState, /character_record\.prompt_profile_json/);
  assert.match(protectedState, /world_record\.world_rules_markdown/);
  assert.match(protectedState, /room_record\.resolved_prompt_snapshot_json/);
  assert.match(protectedState, /from public\.room_state_summaries/);
  assert.match(protectedState, /message_record\.sequence_no = 1/);
  assert.match(protectedState, /from storage\.objects/);
  assert.match(protectedState, /order by kind, sort_key/);
  assert.match(attestation, /queryMode: 'supabase_read_only_user'/);
  assert.match(attestation, /prelaunchDirectApproved:/);
  assert.match(attestation, /productionProjectGuardPassed: true/);
  assert.match(attestation, /defaultBranchCiPassed: true/);
  assert.match(attestation, /trap 'rm -rf -- "\$workdir"' EXIT/);
  assert.match(attestation, /if: \$\{\{ success\(\) \}\}/);
  assert.match(attestation, /prelaunch-attestation-evidence-production-/);
  assert.match(release, /Date\.now\(\) >= attestedAt/);
  assert.match(release, /Date\.now\(\) - attestedAt <= 6 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(evidenceBlock, /\b(?:rowCounts|actualCounts|projectRef):/);
  assert.doesNotMatch(jobEnvironment, /SUPABASE_ACCESS_TOKEN|GH_TOKEN/);
  assert.doesNotMatch(attestation, /run: npm ci/);
  assert.doesNotMatch(attestation, /supabase db push|supabase db query|confirm-remote-writes|^\s*(?:insert|update|delete)\s+/im);
});

test('every remote database phase gate enforces the complete service-only v2 RPC set', async () => {
  const sources = await Promise.all([
    '.github/workflows/release-worker.yml',
    '.github/workflows/release-database.yml',
    '.github/workflows/release-database-baseline-attestation.yml',
    '.github/workflows/release-post-lockdown-privilege-smoke.yml',
  ].map(readUtf8));
  const signatures = [
    'public.reserve_chat_message_v2(uuid,text,uuid,text,text,integer,integer)',
    'public.complete_legacy_chat_message_v2(uuid,text,text,jsonb)',
    'public.refund_chat_message_v2(uuid,text,text,integer)',
    'public.create_room_v2(uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb)',
    'public.commit_room_turn_v2(uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'public.reconcile_expired_chat_reservations_v2(integer)',
  ];

  for (const source of sources) {
    for (const signature of signatures) {
      assert.ok(source.includes(signature), `remote phase gate is missing ${signature}`);
    }
    assert.match(source, /service_role/);
    assert.match(source, /anon/);
    assert.match(source, /authenticated/);
    assert.match(source, /has_function_privilege/);
  }
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
  assert.match(synthetic, /release_track:/);
  assert.match(synthetic, /options: \[backend-stabilization, prompt-privacy\]/);
  assert.match(synthetic, /value\.releaseTrack === process\.env\.RELEASE_TRACK/);
  assert.match(synthetic, /20260726190559_backend_stabilization_expand\.sql/);
  assert.match(synthetic, /20260729000000_prompt_read_views_expand\.sql/);
  assert.match(synthetic, /expandMigration: process\.env\.EXPAND_MIGRATION/);
  assert.match(synthetic, /expandEvidenceRunId: process\.env\.EXPAND_EVIDENCE_RUN_ID/);
  assert.match(synthetic, /scenarios/);
  assert.match(synthetic, /if: \$\{\{ always\(\) \}\}/);
});

test('post-lockdown privilege and immediate one-shot verification remain evidence-bound without grant restoration', async () => {
  const privilege = await readUtf8('.github/workflows/release-post-lockdown-privilege-smoke.yml');
  const privilegeWorkflow = parseDocument(privilege, { uniqueKeys: true, version: '1.2' }).toJS();
  const privilegeJob = privilegeWorkflow.jobs.smoke;
  const privilegeCheckout = privilegeJob.steps.find((step) => step.uses === 'actions/checkout@v6');
  const lockdownEvidenceBinding = privilegeJob.steps.find(
    (step) => step.name === 'Verify applied lockdown evidence binding',
  );
  const bridgeBinding = privilegeJob.steps.find(
    (step) => step.name === 'Verify approved cross-commit lockdown evidence bridge',
  );
  const reattest = privilegeJob.steps.find(
    (step) => step.name === 'Reattest unchanged remote lockdown state',
  );
  const httpProbe = privilegeJob.steps.find(
    (step) => step.name === 'Verify actual remote anon and authenticated HTTP privilege boundaries',
  );
  const privilegeRecord = privilegeJob.steps.find(
    (step) => step.name === 'Record sanitized privilege smoke evidence',
  );
  const verification = await readUtf8('.github/workflows/release-post-lockdown-observation.yml');
  const verificationWorkflow = parseDocument(verification, { uniqueKeys: true, version: '1.2' }).toJS();
  const verificationJob = verificationWorkflow.jobs.verify;

  assert.match(privilege, /apply-lockdown/);
  assert.match(privilege, /value\.releaseTrack/);
  assert.match(privilege, /20260729010000_private_prompt_reads_lockdown\.sql/);
  assert.match(privilege, /LOCKDOWN_RELEASE_TRACK/);
  assert.match(privilege, /has_column_privilege/);
  assert.match(privilege, /public\.owned_room_summaries/);
  assert.match(privilege, /anon can select an owner-only view/);
  assert.match(privilege, /a safe view exposes a protected prompt column/);
  assert.match(privilege, /security_barrier=true/);
  assert.match(privilege, /service role cannot read a required prompt column/);
  assert.match(privilege, /begin;/);
  assert.match(privilege, /rollback;/);
  assert.match(privilege, /reserve_daily_chat_message/);
  assert.match(privilege, /get_daily_chat_quota/);
  assert.match(privilege, /has_function_privilege/);
  assert.match(privilege, /remote-privilege-smoke\.mjs/);
  assert.match(privilege, /serviceRoleV2ReserveRefundAllowed/);
  assert.match(privilege, /serviceRoleV2RpcSurfaceAllowed/);
  assert.match(privilege, /clientV2RpcSurfaceDenied/);
  assert.match(privilege, /service role cannot execute every required v2 RPC/);
  assert.match(privilege, /a browser role can execute a service-only v2 RPC/);
  assert.match(privilege, /gatewayScenarios/);
  assert.match(privilege, /sqlRoleProbePassed: sqlPassed/);
  assert.match(privilege, /httpGatewayProbePassed: remotePassed/);
  assert.equal(privilegeCheckout.with['fetch-depth'], 0);
  assert.equal(privilegeJob.env.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  assert.equal(privilegeJob.env.AUTHORIZED_POST_LOCKDOWN_SHA, '${{ vars.AUTHORIZED_POST_LOCKDOWN_SHA }}');
  assert.equal(privilegeJob.env.AUTHORIZED_LOCKDOWN_SOURCE_SHA, '${{ vars.AUTHORIZED_LOCKDOWN_SOURCE_SHA }}');
  assert.equal(privilegeJob.env.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID, '${{ vars.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID }}');
  for (const secretName of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.equal(Object.hasOwn(privilegeJob.env || {}, secretName), false, `${secretName} must not persist at job scope`);
  }
  assert.deepEqual(lockdownEvidenceBinding.env, { GH_TOKEN: '${{ github.token }}' });
  for (const pattern of [
    /actions\/runs\/\$LOCKDOWN_EVIDENCE_RUN_ID/,
    /actions\/workflows\/release-database\.yml/,
    /run\.conclusion === 'success'/,
    /run\.status === 'completed'/,
    /run\.event === 'workflow_dispatch'/,
    /run\.head_sha === value\.commit/,
    /run\.head_branch === process\.env\.DEFAULT_BRANCH/,
    /run\.path === expectedWorkflowPath/,
    /workflow\.path === expectedWorkflowPath/,
    /run\.workflow_id === workflow\.id/,
    /LOCKDOWN_REMOTE_STATE_FINGERPRINT/,
    /LOCKDOWN_MIGRATION_ROWS_FINGERPRINT/,
  ]) assert.match(lockdownEvidenceBinding.run, pattern);
  for (const pattern of [
    /"\$GITHUB_SHA" == "\$AUTHORIZED_POST_LOCKDOWN_SHA"/,
    /"\$LOCKDOWN_COMMIT" == "\$AUTHORIZED_LOCKDOWN_SOURCE_SHA"/,
    /"\$LOCKDOWN_EVIDENCE_RUN_ID" == "\$AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID"/,
    /git merge-base --is-ancestor "\$LOCKDOWN_COMMIT" "\$GITHUB_SHA"/,
    /git diff --name-only "\$LOCKDOWN_COMMIT" "\$GITHUB_SHA"/,
    /git diff --name-status "\$LOCKDOWN_COMMIT" "\$GITHUB_SHA"/,
    /\$1 != "M"/,
    /\.github\/workflows\/release-post-lockdown-observation\.yml/,
    /\.github\/workflows\/release-post-lockdown-privilege-smoke\.yml/,
    /scripts\/remote-privilege-smoke\.mjs/,
    /scripts\/validate-github-workflows\.mjs/,
    /server\/deployment-workflow-sync\.test\.js/,
    /server\/remote-privilege-smoke-contract\.test\.js/,
  ]) assert.match(bridgeBinding.run, pattern);
  assert.deepEqual(reattest.env, { SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
  for (const pattern of [
    /scripts\/capture-release-state\.sql/,
    /scripts\/capture-migration-state\.sql/,
    /supabase db query/,
    /remoteStateFingerprint !== process\.env\.LOCKDOWN_REMOTE_STATE_FINGERPRINT/,
    /migrationRowsFingerprint !== process\.env\.LOCKDOWN_MIGRATION_ROWS_FINGERPRINT/,
    /LOCKDOWN_STATE_REATTESTED=true/,
    /LOCKDOWN_STATE_ATTESTED_AT=/,
  ]) assert.match(reattest.run, pattern);
  assert.doesNotMatch(reattest.run, /supabase db push|confirm-remote-writes/i);
  assert.deepEqual(httpProbe.env, { SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
  assert.match(httpProbe.run, /api-keys\?reveal=true/);
  assert.match(httpProbe.run, /scripts\/select-supabase-project-api-keys\.mjs/);
  assert.match(httpProbe.run, /chmod 600 "\$key_file" "\$selected_key_file"/);
  assert.match(httpProbe.run, /trap 'rm -f -- "\$key_file" "\$selected_key_file"' EXIT/);
  assert.match(httpProbe.run, /::add-mask::\$SUPABASE_ANON_KEY/);
  assert.match(httpProbe.run, /::add-mask::\$SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(httpProbe.run, /unset SUPABASE_ACCESS_TOKEN[\s\S]*node scripts\/remote-privilege-smoke\.mjs/);
  assert.doesNotMatch(httpProbe.run, /GITHUB_ENV|(?:SUPABASE_ACCESS_TOKEN|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)[^\n]*(?:artifacts|evidence)/);
  assert.doesNotMatch(privilege, /\bgrant\s+(?:all|insert|update|delete|execute)/i);
  assert.doesNotMatch(privilege, /\brevoke\s+/i);
  for (const pattern of [
    /lockdownCommit:/,
    /lockdownAppliedAt:/,
    /lockdownStateReattested/,
    /lockdownStateAttestedAt:/,
    /allPassed: lockdownStateReattested && sqlPassed && remotePassed/,
  ]) assert.match(privilegeRecord.run, pattern);

  assert.equal(verificationWorkflow.name, 'release-post-lockdown-verification');
  assert.deepEqual(Object.keys(verificationWorkflow.on.workflow_dispatch.inputs).sort(), [
    'base_url',
    'lockdown_evidence_run_id',
    'privilege_evidence_run_id',
    'target',
    'worker_name',
    'wrangler_env',
  ]);
  assert.equal(verificationJob['timeout-minutes'], 15);
  assert.equal(verificationJob.env.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  assert.equal(verificationJob.env.AUTHORIZED_POST_LOCKDOWN_SHA, '${{ vars.AUTHORIZED_POST_LOCKDOWN_SHA }}');
  assert.equal(verificationJob.env.AUTHORIZED_LOCKDOWN_SOURCE_SHA, '${{ vars.AUTHORIZED_LOCKDOWN_SOURCE_SHA }}');
  assert.equal(verificationJob.env.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID, '${{ vars.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID }}');
  assert.equal(verificationJob.steps.find((step) => step.uses === 'actions/checkout@v6').with['fetch-depth'], 0);
  assert.doesNotMatch(verification, /lockdown_completed_at|check-worker-observability\.mjs|CLOUDFLARE_OBSERVABILITY_TOKEN|elapsed<24\*60\*60\*1000|24 \* 60 \* 60 \* 1000|\bsleep\s+/);

  const evidenceBinding = verificationJob.steps.find(
    (step) => step.name === 'Verify fresh lockdown and privilege evidence binding',
  );
  assert.deepEqual(evidenceBinding.env, { GH_TOKEN: '${{ github.token }}' });
  for (const pattern of [
    /mktemp -d "\$RUNNER_TEMP\/vmate-post-lockdown-evidence-/,
    /trap 'rm -rf -- "\$VERIFY_DIR"' EXIT/,
    /actions\/runs\/\$LOCKDOWN_EVIDENCE_RUN_ID/,
    /actions\/workflows\/release-database\.yml/,
    /actions\/runs\/\$PRIVILEGE_EVIDENCE_RUN_ID/,
    /actions\/workflows\/release-post-lockdown-privilege-smoke\.yml/,
    /run\.conclusion === 'success'/,
    /run\.status === 'completed'/,
    /run\.event === 'workflow_dispatch'/,
    /run\.head_sha === headSha/,
    /run\.head_branch === process\.env\.DEFAULT_BRANCH/,
    /run\.path === workflowPath/,
    /workflow\.path === workflowPath/,
    /run\.workflow_id === workflow\.id/,
    /lock\.operation === 'apply-lockdown'/,
    /lock\.migration === expectedMigration/,
    /process\.env\.GITHUB_SHA === process\.env\.AUTHORIZED_POST_LOCKDOWN_SHA/,
    /lock\.commit === process\.env\.AUTHORIZED_LOCKDOWN_SOURCE_SHA/,
    /process\.env\.LOCKDOWN_EVIDENCE_RUN_ID === process\.env\.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID/,
    /exactBridgeDiff\(lock\.commit\)/,
    /\['diff', '--name-status', '--no-renames', sourceSha, process\.env\.GITHUB_SHA\]/,
    /smoke\.lockdownCommit === lock\.commit/,
    /smoke\.lockdownAppliedAt === lock\.appliedAt/,
    /smoke\.lockdownStateReattested === true/,
    /smoke\.lockdownEvidenceRunId === process\.env\.LOCKDOWN_EVIDENCE_RUN_ID/,
    /smoke\.workerVersionId === lock\.workerVersionId/,
    /appliedAt <= lockdownStateAttestedAt/,
    /lockdownStateAttestedAt <= privilegeCompletedAt/,
    /appliedAt <= privilegeCompletedAt/,
    /privilegeCompletedAt <= now/,
    /now - appliedAt <= 6 \* 60 \* 60 \* 1000/,
    /now - privilegeCompletedAt <= 30 \* 60 \* 1000/,
    /WORKER_VERSION_ID=\$\{lock\.workerVersionId\}/,
    /BASELINE_WORKER_VERSION_ID=\$\{lock\.previousStableWorkerVersionId\}/,
  ]) assert.match(evidenceBinding.run, pattern);

  const deploymentBinding = verificationJob.steps.find(
    (step) => step.name === 'Verify v2 Worker is the only serving version',
  );
  assert.deepEqual(deploymentBinding.env, {
    CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
    CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
  });
  assert.match(deploymentBinding.run, /mktemp "\$RUNNER_TEMP\/vmate-post-lockdown-deployment-/);
  assert.match(deploymentBinding.run, /trap 'rm -f -- "\$DEPLOYMENT_STATUS_FILE"' EXIT/);
  assert.match(deploymentBinding.run, /wrangler deployments status/);
  assert.match(deploymentBinding.run, /!Array\.isArray\(source\.versions\)/);
  assert.match(deploymentBinding.run, /typeof entry\.percentage !== 'number'/);
  assert.match(deploymentBinding.run, /entry\.percentage < 0 \|\| entry\.percentage > 100/);
  assert.match(deploymentBinding.run, /ids\.size !== entries\.length/);
  assert.match(deploymentBinding.run, /Math\.abs\(total - 100\) > 1e-9/);
  assert.match(deploymentBinding.run, /entries\.length !== 1/);
  assert.match(deploymentBinding.run, /entries\[0\]\.id !== process\.env\.WORKER_VERSION_ID/);
  assert.match(deploymentBinding.run, /entries\[0\]\.percentage !== 100/);

  const deploymentNodeMatch = deploymentBinding.run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/);
  assert.ok(deploymentNodeMatch, 'deployment status validator must remain executable as one Node heredoc');
  const evaluateDeployment = (status) => runInNewContext(deploymentNodeMatch[1], {
    require(specifier) {
      assert.equal(specifier, 'node:fs');
      return { readFileSync: () => JSON.stringify(status) };
    },
    process: {
      env: { DEPLOYMENT_STATUS_FILE: 'private-status.json', WORKER_VERSION_ID: 'approved-v2' },
      exit(code) {
        throw new Error(`process.exit(${code})`);
      },
    },
  });
  assert.doesNotThrow(() => evaluateDeployment({
    versions: [{ version_id: 'approved-v2', percentage: 100 }],
  }));
  for (const invalid of [
    null,
    [],
    {},
    { versions: {} },
    { versions: [] },
    { versions: [null] },
    { versions: [{ version_id: 'approved-v2', percentage: '100' }] },
    { versions: [{ version_id: 'bad version', percentage: 100 }] },
    { versions: [{ version_id: 'approved-v2', percentage: -1 }] },
    { versions: [{ version_id: 'approved-v2', percentage: 101 }] },
    { versions: [{ version_id: 'approved-v2', percentage: 99 }] },
    { versions: [{ version_id: 'unapproved-v2', percentage: 100 }] },
    { versions: [{ version_id: 'approved-v2', percentage: 100 }, {}] },
    { versions: [{ version_id: 'approved-v2', percentage: 50 }, { version_id: 'approved-v2', percentage: 50 }] },
    { versions: [{ version_id: 'approved-v2', percentage: 100 }, { version_id: 'old-v2', percentage: 0 }] },
    { versions: [{ version_id: 'approved-v2', percentage: 50 }, { version_id: 'old-v2', percentage: 50 }] },
    { versions: [], nested: { version_id: 'approved-v2', percentage: 100 } },
  ]) assert.throws(() => evaluateDeployment(invalid), /process\.exit\(1\)/);

  const smokeStep = verificationJob.steps.find((step) => step.name === 'Run one immediate live smoke');
  assert.equal((verification.match(/node scripts\/smoke-release\.mjs\b/g) || []).length, 1);
  assert.match(smokeStep.run, /node scripts\/smoke-release\.mjs --base-url "\$BASE_URL"/);
  assert.doesNotMatch(smokeStep.run, /--(?:worker-name|version-id)\b/);

  const evidenceRecord = verificationJob.steps.find((step) => step.name === 'Record single verification evidence');
  assert.match(evidenceRecord.run, /schemaVersion: 2/);
  assert.match(evidenceRecord.run, /operation: 'post-lockdown-verification'/);
  assert.match(evidenceRecord.run, /verificationMode: 'single-immediate-live-smoke'/);
  assert.match(evidenceRecord.run, /lockdownCommit:/);
  assert.match(evidenceRecord.run, /lockdownStateAttestedAt:/);
  assert.match(evidenceRecord.run, /servingVersionVerified: true/);
  assert.match(evidenceRecord.run, /liveSmokePassed: true/);
  assert.doesNotMatch(evidenceRecord.run, /\b(?:baseUrl|workerName|projectRef)\s*:/);

  const uploads = verificationJob.steps.filter((step) => step.uses === 'actions/upload-artifact@v4');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].if, '${{ success() }}');
  assert.equal(uploads[0].with.path, 'artifacts/post-lockdown-verification-evidence.json');
  assert.equal(uploads[0].with['if-no-files-found'], 'error');
});

test('Supabase project API key selection is exact and fail-closed', () => {
  const anon = { type: 'legacy', name: 'anon', api_key: 'fake-anon-key', disabled: false };
  const service = { type: 'legacy', name: 'service_role', api_key: 'fake-service-key' };
  assert.deepEqual(selectSupabaseProjectApiKeys([anon, service]), {
    anonKey: 'fake-anon-key',
    serviceRoleKey: 'fake-service-key',
  });

  for (const invalid of [
    null,
    {},
    [],
    [anon],
    [service],
    [anon, { ...anon, api_key: 'second-anon-key' }, service],
    [anon, service, { ...service, api_key: 'second-service-key' }],
    [{ ...anon, disabled: true }, service],
    [anon, { ...service, disabled: true }],
    [{ ...anon, api_key: '' }, service],
    [anon, { ...service, api_key: ' fake-service-key ' }],
    [anon, { ...service, api_key: anon.api_key }],
  ]) assert.throws(() => selectSupabaseProjectApiKeys(invalid));
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

test('operations documentation records manual approved release, runtime prerequisites, and version rollback', async () => {
  const operationsDoc = await readUtf8('docs/operations.md');

  assert.match(operationsDoc, /main.*읽기 전용/i);
  assert.match(operationsDoc, /workflow_dispatch/);
  assert.match(operationsDoc, /CLOUDFLARE_API_TOKEN/);
  assert.match(operationsDoc, /CLOUDFLARE_OBSERVABILITY_TOKEN/);
  assert.match(operationsDoc, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(operationsDoc, /VITE_SUPABASE_URL/);
  assert.match(operationsDoc, /VITE_SUPABASE_ANON_KEY|VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(operationsDoc, /VITE_CHAT_API_BASE_URL/);
  assert.match(operationsDoc, /versions deploy/);
  assert.match(operationsDoc, /append-only migration을 추가·삭제·rename·수정하지 않는 runtime·frontend·fresh-schema snapshot 변경/);
  assert.match(operationsDoc, /`supabase\/migrations\/\*\*`가 동일한지 fail-closed/);
  assert.match(operationsDoc, /같은 SHA의 CI `quality`와 `Database contracts \(local Docker only\)`가 성공/);
  assert.match(operationsDoc, /이미 적용된 migration을 다시 실행하지 않습니다/);
  assert.match(operationsDoc, /`previous_baseline_evidence_run_id`/);
  assert.match(operationsDoc, /원격 fingerprint를 다시 읽어 이전 값과 비교/);
  assert.match(operationsDoc, /유효한 이전 baseline artifact도 없으면 fail-closed/);
  assert.match(operationsDoc, /일반 경로의 `prompt-privacy:apply-lockdown`.*6시간.*physical backup evidence.*필수/);
  assert.match(operationsDoc, /Prelaunch direct 경로만 같은 6시간 제한의 attestation으로 이 gate를 대체/);
  assert.match(operationsDoc, /vmate_private\.prompt_lockdown_room_state_backup_20260729/);
  assert.match(operationsDoc, /vmate_private\.prompt_lockdown_greeting_backup_20260729/);
  assert.match(operationsDoc, /vmate_private\.prompt_lockdown_backup_manifest_20260729/);
  assert.match(operationsDoc, /original과 renewal run ID/);
  assert.match(operationsDoc, /current catalog·row-count·보호 데이터 HMAC/);
  assert.match(operationsDoc, /24시간을 기다리지 않습니다/);
  assert.match(operationsDoc, /privilege smoke evidence는 30분 이내/);
  assert.match(operationsDoc, /version override 없이 공개 origin에 live smoke를 한 번 실행/);
  assert.match(operationsDoc, /baseline-backed cutover evidence/);
  assert.match(operationsDoc, /lockdown_evidence_run_id.*비워/);
});
