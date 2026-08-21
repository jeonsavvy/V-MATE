import { readdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workflowDirectory = path.resolve(scriptDirectory, '..', '.github', 'workflows')
const expectedReleaseWorkflows = new Set([
  'release-backup-readiness.yml',
  'release-database-baseline-attestation.yml',
  'release-database.yml',
  'release-prelaunch-attestation.yml',
  'release-post-lockdown-observation.yml',
  'release-post-lockdown-privilege-smoke.yml',
  'release-staging-synthetic-smoke.yml',
  'release-worker.yml',
])
const credentialContextPattern = /\$\{\{[\s\S]*?(?:\bsecrets(?:\.|\[)|\bgithub\.token\b)[\s\S]*?\}\}/i
const credentialEnvironmentNamePattern = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIALS?|KEY)(?:$|_)|^(?:SUPABASE_URL|CLOUDFLARE_ACCOUNT_ID)$/i
const expectedExpandBridgeFiles = [
  '.github/workflows/release-database.yml',
  '.github/workflows/release-worker.yml',
  'scripts/smoke-release.mjs',
  'scripts/validate-github-workflows.mjs',
  'server/deployment-workflow-sync.test.js',
  'server/smoke-release.test.js',
]

const fail = (file, message) => {
  throw new Error(`${file}: ${message}`)
}

const significantLines = (source) => source
  .split(/\r?\n/)
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => line.trim() && !line.trimStart().startsWith('#'))

const validateWorkflow = (file, source) => {
  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
    version: '1.2',
  })
  if (document.errors.length) {
    fail(file, `invalid YAML: ${document.errors.map((error) => error.message).join('; ')}`)
  }

  const nodeHeredocs = [...source.matchAll(/\bnode([^\r\n]*?)\s+<<'NODE'\r?\n([\s\S]*?)\r?\n\s*NODE(?=\r?\n|$)/g)]
  nodeHeredocs.forEach((match, index) => {
    const result = spawnSync(
      process.execPath,
      match[1].includes('--input-type=module') ? ['--check', '--input-type=module'] : ['--check'],
      { input: match[2], encoding: 'utf8' },
    )
    if (result.error || result.status !== 0) {
      fail(file, `invalid Node heredoc ${index + 1}`)
    }
  })
  const root = document.toJS()
  if (!root || Array.isArray(root) || typeof root !== 'object') {
    fail(file, 'workflow root must be a mapping')
  }

  const lines = significantLines(source)
  if (!lines.length) fail(file, 'workflow is empty')
  const rootKeys = new Map()
  const stack = []
  let previous = null
  let blockScalarIndentation = null

  for (const entry of lines) {
    const { line, number } = entry
    if (/\t/.test(line)) fail(file, `line ${number} uses a tab indentation`)
    const indentation = line.length - line.trimStart().length
    if (indentation % 2 !== 0) fail(file, `line ${number} does not use two-space indentation`)
    if (blockScalarIndentation !== null && indentation > blockScalarIndentation) continue
    if (blockScalarIndentation !== null) blockScalarIndentation = null
    if (previous && indentation > previous.indentation && !previous.opensBlock) {
      fail(file, `line ${number} is nested below a scalar at line ${previous.number}`)
    }

    while (stack.length && indentation <= stack.at(-1).indentation) stack.pop()
    const trimmed = line.trim()
    const mapping = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*|['"][^'"]+['"]):(?:\s.*)?$/)
    const sequence = trimmed === '-' || trimmed.startsWith('- ')
    if (!mapping && !sequence && !trimmed.startsWith('|') && !trimmed.startsWith('>')) {
      fail(file, `line ${number} is not a YAML mapping or sequence entry`)
    }
    if (indentation === 0 && mapping) {
      const key = mapping[1].replace(/^['"]|['"]$/g, '')
      if (rootKeys.has(key)) fail(file, `root key ${key} is duplicated`)
      rootKeys.set(key, number)
    }
    const opensBlock = /:\s*(?:[|>][-+]?\s*)?$/.test(trimmed) || sequence
    if (opensBlock) stack.push({ indentation, number })
    if (/^.+:\s*[|>][-+]?\s*$/.test(trimmed)) blockScalarIndentation = indentation
    previous = { indentation, number, opensBlock }
  }

  for (const key of ['name', 'on', 'jobs']) {
    if (!rootKeys.has(key)) fail(file, `required root key ${key} is absent`)
  }
  if (!root.jobs || Array.isArray(root.jobs) || typeof root.jobs !== 'object' || !Object.keys(root.jobs).length) {
    fail(file, 'jobs must contain at least one named mapping')
  }
  for (const [jobName, job] of Object.entries(root.jobs)) {
    for (const [stepIndex, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
      if (step?.shell !== 'bash' || typeof step.run !== 'string') continue
      let pendingHeredoc = null
      for (const line of step.run.split(/\r?\n/)) {
        if (pendingHeredoc) {
          const candidate = pendingHeredoc.stripTabs ? line.replace(/^\t+/, '') : line
          if (candidate === pendingHeredoc.delimiter) pendingHeredoc = null
          continue
        }
        const match = line.match(/<<(-?)\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
        if (match) pendingHeredoc = { delimiter: match[2], stripTabs: match[1] === '-' }
      }
      if (pendingHeredoc) {
        fail(file, `job ${jobName} step ${stepIndex + 1} has an unclosed or indented Bash heredoc: ${pendingHeredoc.delimiter}`)
      }
    }
  }
  if (!/^name:\s*\S/m.test(source)) fail(file, 'name must have a value')
  if (!/^jobs:\s*$/m.test(source) || !/^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/m.test(source)) {
    fail(file, 'jobs must contain at least one named mapping')
  }

  const isRelease = expectedReleaseWorkflows.has(file)
  if (isRelease) {
    const triggers = root.on && typeof root.on === 'object' && !Array.isArray(root.on)
      ? Object.keys(root.on)
      : []
    if (triggers.length !== 1 || triggers[0] !== 'workflow_dispatch') {
      fail(file, 'release workflow must declare only workflow_dispatch')
    }
    for (const [jobName, job] of Object.entries(root.jobs)) {
      for (const [name, value] of Object.entries(job?.env || {})) {
        if (credentialEnvironmentNamePattern.test(name) || credentialContextPattern.test(String(value))) {
          fail(file, `job ${jobName} env ${name} exposes a credential to every step`)
        }
      }
      for (const [stepIndex, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
        if (typeof step?.run !== 'string' || !/\bnpm\s+ci\b/.test(step.run)) continue
        for (const [name, value] of Object.entries(step.env || {})) {
          if (credentialEnvironmentNamePattern.test(name) || credentialContextPattern.test(String(value))) {
            fail(file, `job ${jobName} npm ci step ${stepIndex + 1} exposes credential env ${name}`)
          }
        }
      }
    }
  }
  if (!isRelease && file === 'ci.yml' && (!/^  push:/m.test(source) || !/^  pull_request:/m.test(source))) {
    fail(file, 'CI must validate push and pull_request events')
  }
  if (file === 'release-database.yml') {
    for (const required of [
      'staging_privilege_evidence_run_id:',
      'STAGING_PRIVILEGE_EVIDENCE_RUN_ID:',
      'STAGING_PROJECT_REF:',
      'Verify successful staging post-lockdown privilege smoke before production expand',
      "workflowName !== 'release-post-lockdown-privilege-smoke'",
      'post-lockdown-privilege-evidence-staging-',
      "evidence.target === 'staging'",
      'update(process.env.STAGING_PROJECT_REF)',
      'evidence.projectRefHash === stagingRefHash',
      'evidence.allPassed === true',
      'prelaunch_evidence_run_id:',
      'PRELAUNCH_EVIDENCE_RUN_ID:',
      'exactly one staging privilege or prelaunch evidence run is required',
      'Verify fresh production prelaunch attestation',
      'actions/workflows/release-prelaunch-attestation.yml',
      'prelaunch-attestation-evidence-production-',
      'Date.now() - attestedAt <= 6 * 60 * 60 * 1000',
      'evidence.prelaunchDirectApproved === true',
      'Recheck prelaunch data and catalog immediately before apply',
      'scripts/capture-prelaunch-row-counts.sql',
      'scripts/capture-prelaunch-protected-state.sql',
      'current.catalog === process.env.PRELAUNCH_CURRENT_CATALOG_STATE_HASH',
      'current.rows === process.env.PRELAUNCH_CURRENT_ROW_COUNT_HASH',
      'current.protectedState === process.env.PRELAUNCH_CURRENT_PROTECTED_STATE_HASH',
      'evidence.prelaunchOriginalRowCountHash === process.env.PRELAUNCH_CURRENT_ROW_COUNT_HASH',
      'evidence.prelaunchOriginalProtectedStateHash === process.env.PRELAUNCH_CURRENT_PROTECTED_STATE_HASH',
      'prelaunchOriginalEvidenceRunId',
      'prelaunchRenewalEvidenceRunId',
      'actions/runs/$LOCKDOWN_EXPAND_EVIDENCE_RUN_ID',
      'actions/workflows/release-database.yml',
      'run.head_branch === process.env.DEFAULT_BRANCH',
      'fetch-depth: 0',
      'AUTHORIZED_DOMAIN_RELEASE_SHA',
      'LOCKDOWN_EXPAND_EVIDENCE_COMMIT',
      'LOCKDOWN_EXPAND_BRIDGE_PRELAUNCH_EVIDENCE_RUN_ID',
      "evidence.schemaVersion === 4",
      "evidence.expandEvidenceRunId === '30461795102'",
      "evidence.expandEvidenceCommit === 'd839befb167ca1024258ac01198ec96c3d3b3837'",
      "process.env.PRELAUNCH_EVIDENCE_RUN_ID || ''",
      "run.head_sha === process.env.LOCKDOWN_EXPAND_EVIDENCE_COMMIT",
      "evidence.commit === process.env.LOCKDOWN_EXPAND_EVIDENCE_COMMIT",
      'PRELAUNCH_CURRENT_CATALOG_STATE_HASH === expectedCatalogStateHash',
      "createHmac('sha256', process.env.SUPABASE_ACCESS_TOKEN)",
      'expand bridge change scope is not the exact release-only set',
      'lockdown expand bridge files must be in-place modifications',
      'Verify prompt privacy logical backup source contract',
      'vmate_private.prompt_lockdown_room_state_backup_20260729',
      'vmate_private.prompt_lockdown_greeting_backup_20260729',
      'vmate_private.prompt_lockdown_backup_manifest_20260729',
      'Verify immutable prompt backup manifest and role denial after lockdown',
      'prompt logical backup manifest parity failed',
      'state_payload_hash',
      'greeting_payload_hash',
      'prompt_lockdown_manifest_update_delete_guard_20260729',
      'prompt_lockdown_manifest_truncate_guard_20260729',
      "pg_catalog.unnest(array['anon', 'authenticated', 'service_role'])",
    ]) {
      if (!source.includes(required)) fail(file, `missing production expand staging-privilege evidence guard: ${required}`)
    }
    const cutoverEvidenceStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Verify compatible Worker cutover evidence before lockdown')
    if (!cutoverEvidenceStep) fail(file, 'compatible Worker cutover evidence step is absent')
    if (cutoverEvidenceStep.env?.DEFAULT_BRANCH !== '${{ github.event.repository.default_branch }}') {
      fail(file, 'Worker cutover evidence step does not bind the repository default branch')
    }
    if (!String(cutoverEvidenceStep.run).includes('run.head_branch === process.env.DEFAULT_BRANCH')) {
      fail(file, 'Worker cutover evidence run does not require the repository default branch')
    }
    const bridgeAllowlists = [...source.matchAll(/bridge_allowed_files=\$'([^']+)'/g)]
    if (bridgeAllowlists.length !== 1 || JSON.stringify(bridgeAllowlists[0][1].split('\\n')) !== JSON.stringify(expectedExpandBridgeFiles)) {
      fail(file, 'database release expand bridge allowlist is not the exact release-only set')
    }
    for (const required of [
      'run.id === Number(process.env.WORKER_EVIDENCE_RUN_ID)',
      "run.conclusion === 'success'",
      "run.status === 'completed'",
      "run.event === 'workflow_dispatch'",
      'run.head_sha === process.env.GITHUB_SHA',
      'run.path === expectedWorkflowPath',
      'workflow.path === expectedWorkflowPath',
      'run.workflow_id === workflow.id',
      'gh run download "$WORKER_EVIDENCE_RUN_ID"',
      'evidence.monitorChecks === 1',
      'evidence.monitorMinutes === 0',
      'evidence.observabilityPassed === null',
      'evidence.observabilityMetrics === null',
      'evidence.observabilityWindow === null',
      'evidence.baselineWindow === null',
    ]) {
      if (!String(cutoverEvidenceStep.run).includes(required)) fail(file, `Worker cutover evidence step is missing run binding: ${required}`)
    }
  }
  if (file === 'release-worker.yml') {
    for (const required of [
      'echo "APPROVED_ORIGIN=$input_origin" >> "$GITHUB_ENV"',
      'release_allowed_origins="$APPROVED_ORIGIN"',
      'release_allowed_origins="$APPROVED_ORIGIN,$LEGACY_ORIGIN"',
      '--var "ALLOWED_ORIGINS:$release_allowed_origins"',
      'wrangler triggers deploy --env "" --name "$WORKER_NAME" --dry-run',
      'baseline_evidence_run_id:',
      'exactly one expand_evidence_run_id or baseline_evidence_run_id is required',
      'baseline release cannot add, remove, rename, or modify database migrations',
      'AUTHORIZED_DOMAIN_RELEASE_SHA',
      'authorized domain release SHA guard mismatch',
      'AUTHORIZED_BASELINE_RELEASE_SHA',
      'authorized baseline release SHA guard mismatch',
      '084b38123a37e70d3fa51093fe44b39098a36bc2',
      'b2b997f6c0eec183509cf2bc4241fc29eb2f6b7e',
      'post-lockdown proof source change scope is not the exact verified set',
      'Date.now() - Date.parse(evidence.attestedAt) <= 6 * 60 * 60 * 1000',
      'actions/runs/$BASELINE_EVIDENCE_RUN_ID',
      'actions/workflows/release-database-baseline-attestation.yml',
      'actions/runs/$EXPAND_EVIDENCE_RUN_ID',
      'actions/workflows/release-database.yml',
      'run.head_branch === process.env.DEFAULT_BRANCH',
      'run.workflow_id === workflow.id',
      'expand_bridge_prelaunch_evidence_run_id:',
      'EXPAND_BRIDGE_PRELAUNCH_EVIDENCE_RUN_ID:',
      "EXPAND_EVIDENCE_RUN_ID === '30461795102'",
      "run.head_sha === 'd839befb167ca1024258ac01198ec96c3d3b3837'",
      'expand evidence bridge must run from the default branch',
      'expand bridge change scope is not the exact release-only set',
      'expand bridge files must be in-place modifications',
      'expand bridge attestation must be empty for current-commit evidence',
      'prelaunch-attestation-evidence-production-',
      'prelaunchRun.head_sha === process.env.GITHUB_SHA',
      'prelaunchRun.head_branch === process.env.DEFAULT_BRANCH',
      'prelaunch.rowCountHash === evidence.prelaunchOriginalRowCountHash',
      'prelaunch.protectedStateHash === evidence.prelaunchOriginalProtectedStateHash',
      'prelaunch.catalogStateHash === expectedCatalogStateHash',
      "createHmac('sha256', process.env.SUPABASE_ACCESS_TOKEN)",
      'attestedAt >= appliedAt',
      'shadow.schemaVersion === 4',
      'schemaVersion: 4',
      'baselineServingVersionId',
      'baselineV3Keys',
      'previousBaselineEvidenceRunId',
      'servingCutoverEvidenceRunId',
      'serving Worker changed after the baseline attestation',
      'release.previousStableVersionId === process.env.INPUT_VERSION_ID',
      'ROLLBACK_SOURCE_VERSION_ID=${process.env.INPUT_VERSION_ID}',
      'expandEvidenceCommit:',
      'expandBridgePrelaunchEvidenceRunId:',
      'dist/release-version.txt',
      'wrangler versions upload',
    ]) {
      if (!source.includes(required)) fail(file, `missing approved-origin Worker upload guard: ${required}`)
    }
    const approvedTargetStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Validate approved target')
    if (!approvedTargetStep) fail(file, 'approved target validation step is absent')
    if (!/git diff --quiet "\$BASELINE_SOURCE_SHA" "\$GITHUB_SHA" -- supabase\/migrations\//.test(String(approvedTargetStep.run))) {
      fail(file, 'Worker baseline mode does not prove the trusted migration tree is unchanged')
    }
    if (/allowed_files=|baseline evidence change scope is not allowlisted|-- supabase server\/platform server\/chat-handler\.js worker\.js/.test(String(approvedTargetStep.run))) {
      fail(file, 'Worker baseline mode still relies on a release-specific allowlist or runtime-surface ban')
    }
    const shadowEvidenceStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Verify current-commit shadow upload and immutable version metadata')
    if (!shadowEvidenceStep) fail(file, 'current-commit shadow evidence step is absent')
    if (root.jobs?.release?.env?.DEFAULT_BRANCH !== '${{ github.event.repository.default_branch }}') {
      fail(file, 'Worker release does not bind the repository default branch')
    }
    if (!String(shadowEvidenceStep.run).includes('run.head_branch === process.env.DEFAULT_BRANCH')) {
      fail(file, 'shadow evidence run does not require the repository default branch')
    }
    const buildReleaseAssetsStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Build release assets and record hashes')
    if (buildReleaseAssetsStep?.if !== "${{ inputs.operation != 'rollback' }}") {
      fail(file, 'rollback must not build a current-commit asset manifest')
    }
    const rollbackPreflightStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Preflight evidence-bound rollback version with zero-traffic override')
    if (!rollbackPreflightStep || /--dist-manifest/.test(String(rollbackPreflightStep.run))) {
      fail(file, 'historical rollback preflight must use functional smoke without the current manifest')
    }
    const selectedVersionSmokeStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Smoke selected Worker version and applicable assets')
    const rollbackSmokeBranch = String(selectedVersionSmokeStep?.run || '').match(/if \[\[ '\$\{\{ inputs\.operation \}\}' == 'rollback' \]\]; then([\s\S]*?)else/)?.[1] || ''
    if (!rollbackSmokeBranch.includes('smoke-release.mjs') || /--dist-manifest/.test(rollbackSmokeBranch)) {
      fail(file, 'historical rollback smoke must not compare the current asset manifest')
    }
    const liveCutoverSmokeStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Verify live cutover once at public origin')
    const liveCutoverSmoke = String(liveCutoverSmokeStep?.run || '')
    if (liveCutoverSmokeStep?.if !== "${{ inputs.operation == 'cutover' }}"
      || !liveCutoverSmoke.includes('smoke-release.mjs')
      || !liveCutoverSmoke.includes('--base-url "$BASE_URL"')
      || !liveCutoverSmoke.includes('--dist-manifest artifacts/dist-manifest.json')
      || !liveCutoverSmoke.includes('--live-propagation true')
      || !liveCutoverSmoke.includes('--propagation-timeout-ms 20000')
      || /--worker-name|--version-id|\bsleep\b|\bfor\b|\bwhile\b/.test(liveCutoverSmoke)) {
      fail(file, 'cutover must use one 20-second identity-bound public-origin smoke without a version override')
    }
    if (/Observe cutover for 60 minutes|seq 1 13|check-worker-observability\.mjs/.test(source)) {
      fail(file, 'cutover must not use a delayed observation loop')
    }
    const liveRollbackSmokeStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Verify live rollback once at public origin')
    const liveRollbackSmoke = String(liveRollbackSmokeStep?.run || '')
    if (liveRollbackSmokeStep?.if !== "${{ inputs.operation == 'rollback' }}"
      || !liveRollbackSmoke.includes('smoke-release.mjs')
      || !liveRollbackSmoke.includes('--base-url "$BASE_URL"')
      || /--worker-name|--version-id|--dist-manifest|\bsleep\b/.test(liveRollbackSmoke)) {
      fail(file, 'manual rollback must use one immediate public-origin smoke without current assets or a version override')
    }
    const deploymentAfterStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Capture and verify deployment after operation')
    const deploymentAfter = String(deploymentAfterStep?.run || '')
    for (const required of [
      'Array.isArray(source.versions)',
      'ids.size !== entries.length',
      'Math.abs(total - 100) > 1e-9',
      'entries.length !== 1',
      'entries[0].id !== process.env.INPUT_VERSION_ID',
      'entries[0].percentage !== 100',
    ]) {
      if (!deploymentAfter.includes(required)) fail(file, `deployment verification is not strict at the root versions list: ${required}`)
    }
    const automaticRollbackStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Restore the previous stable version after a failed cutover gate')
    const recordReleaseEvidenceStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Record machine-readable release evidence')
    const automaticRollback = String(automaticRollbackStep?.run || '')
    const statusIndex = automaticRollback.indexOf('wrangler deployments status')
    const strictIndex = automaticRollback.indexOf('source.versions.length !== 1')
    const smokeIndex = automaticRollback.indexOf('smoke-release.mjs --base-url "$BASE_URL"')
    const artifactIndex = automaticRollback.indexOf('automatic-rollback.json')
    if (statusIndex < 0 || strictIndex <= statusIndex || smokeIndex <= strictIndex || artifactIndex <= smokeIndex
      || /--worker-name|--version-id|--dist-manifest/.test(automaticRollback)) {
      fail(file, 'automatic rollback must verify exact root deployment state and the public origin before recording evidence')
    }
    if (!recordReleaseEvidenceStep
      || root.jobs.release.steps.indexOf(recordReleaseEvidenceStep) >= root.jobs.release.steps.indexOf(automaticRollbackStep)) {
      fail(file, 'release evidence must be recorded before the final automatic rollback gate')
    }
    const bridgeAllowlists = [...source.matchAll(/bridge_allowed_files=\$'([^']+)'/g)]
    if (bridgeAllowlists.length !== 1 || JSON.stringify(bridgeAllowlists[0][1].split('\\n')) !== JSON.stringify(expectedExpandBridgeFiles)) {
      fail(file, 'Worker release expand bridge allowlist is not the exact release-only set')
    }
    for (const required of [
      'run.id === Number(process.env.SHADOW_EVIDENCE_RUN_ID)',
      "run.conclusion === 'success'",
      "run.status === 'completed'",
      "run.event === 'workflow_dispatch'",
      'run.head_sha === process.env.GITHUB_SHA',
      'run.path === expectedPath',
      'workflow.path === expectedPath',
      'run.workflow_id === workflow.id',
      'gh run download "$SHADOW_EVIDENCE_RUN_ID"',
    ]) {
      if (!String(shadowEvidenceStep.run).includes(required)) fail(file, `shadow evidence step is missing run binding: ${required}`)
    }
    for (const forbidden of [
      'artifacts/database-evidence',
      'artifacts/rollback-evidence',
      'artifacts/deployment-before.json',
      'artifacts/deployment-after.json',
      '$PWD/artifacts/wrangler-output.jsonl',
    ]) {
      if (source.includes(forbidden)) fail(file, `raw release metadata must remain runner-private: ${forbidden}`)
    }
    const releaseEvidenceUpload = root.jobs?.release?.steps?.find((step) => step?.uses === 'actions/upload-artifact@v7' && step?.name === 'Upload release evidence')
    const uploadedPaths = String(releaseEvidenceUpload?.with?.path || '').trim().split(/\r?\n/).filter(Boolean).sort()
    const expectedUploadedPaths = ['artifacts/automatic-rollback.json', 'artifacts/release-evidence.json'].sort()
    if (JSON.stringify(uploadedPaths) !== JSON.stringify(expectedUploadedPaths)) {
      fail(file, 'release artifact upload is not restricted to sanitized evidence files')
    }
    if (/!\s+git diff --quiet/.test(source)) fail(file, 'database runtime diff guard is inverted')
  }
  if (file === 'release-database-baseline-attestation.yml') {
    for (const required of [
      'production-db-baseline-attestation',
      'READ_ONLY_BASELINE_APPROVED',
      'AUTHORIZED_BASELINE_RELEASE_SHA',
      'authorized baseline release SHA guard mismatch',
      'if: ${{ success() }}',
      '084b38123a37e70d3fa51093fe44b39098a36bc2',
      'b2b997f6c0eec183509cf2bc4241fc29eb2f6b7e',
      'release_track:',
      'lockdown_evidence_run_id:',
      'privilege_evidence_run_id:',
      'verification_evidence_run_id:',
      'previous_baseline_evidence_run_id:',
      'serving_cutover_evidence_run_id:',
      'Verify previous read-only baseline renewal source',
      'Verify serving cutover since renewed baseline',
      'Verify deployed post-lockdown lineage',
      '20260727000000',
      '20260727025134',
      'backend_stabilization_lockdown',
      'lockdownMigrationAliasHash',
      'database-baseline-evidence-production-',
      'run-supabase-read-only-query.mjs',
      "queryMode: 'supabase_read_only_user'",
      "trap 'rm -rf private-artifacts' EXIT",
      'read-only-post-lockdown-baseline-attestation',
      'promptPrivacyMigrationsApplied',
      'privatePromptSchemaBlocked',
      'privatePromptTablesBlocked',
      'clientPromptColumnsBlocked',
      'safeViewDefinitionsMatch',
      'pg_get_viewdef',
      'is distinct from expected.definition_hash',
      '71437e126b6b647e3f50ff91d98bd3f3f27a535e4be3df00f1a39d22b49f5533',
      'd6600ea38a78da1ee3a4c4779dd459250f887908eb40b13bbd3f64adb1c9437c',
      'Verify same-commit application database contract evidence',
      'database-contract-evidence-$CI_RUN_ID',
      'scripts/capture-application-release-state.sql',
      'Current migration fingerprint does not match the approved baseline.',
      'Current application catalog does not match same-commit disposable database evidence.',
      'applicationStateFingerprint:',
      'databaseContractEvidenceRunId:',
      'providerCatalogDriftObserved',
      'schemaVersion: 4',
      'previousBaselineEvidenceRunId:',
      'servingCutoverEvidenceRunId:',
    ]) {
      if (!source.includes(required)) fail(file, `missing read-only baseline attestation guard: ${required}`)
    }
    const renewalStep = root.jobs?.attest?.steps?.find((step) => step?.name === 'Verify previous read-only baseline renewal source')
    const servingCutoverStep = root.jobs?.attest?.steps?.find((step) => step?.name === 'Verify serving cutover since renewed baseline')
    const originalLineageStep = root.jobs?.attest?.steps?.find((step) => step?.name === 'Verify deployed post-lockdown lineage')
    if (renewalStep?.if !== "${{ inputs.previous_baseline_evidence_run_id != '' }}" || renewalStep?.env?.GH_TOKEN !== '${{ github.token }}') {
      fail(file, 'previous baseline renewal is not isolated behind its explicit input and step-scoped GitHub token')
    }
    if (originalLineageStep?.if !== "${{ inputs.previous_baseline_evidence_run_id == '' }}") {
      fail(file, 'original post-lockdown lineage path is not preserved as the opposite renewal mode')
    }
    if (servingCutoverStep?.if !== "${{ inputs.previous_baseline_evidence_run_id != '' && inputs.serving_cutover_evidence_run_id != '' }}" || servingCutoverStep?.env?.GH_TOKEN !== '${{ github.token }}') {
      fail(file, 'serving cutover renewal is not isolated behind both explicit lineage inputs and a step-scoped GitHub token')
    }
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
      if (!String(renewalStep?.run).includes(required)) fail(file, `previous baseline renewal is missing: ${required}`)
    }
    if (String(renewalStep?.run).includes('database-release-evidence-production-')) {
      fail(file, 'previous baseline renewal still depends on the expiring original lockdown artifact')
    }
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
      if (!String(servingCutoverStep?.run).includes(required)) fail(file, `serving cutover renewal is missing: ${required}`)
    }
    const baselineScopeStep = root.jobs?.attest?.steps?.find((step) => step?.name === 'Validate protected read-only baseline scope')
    if (!baselineScopeStep) fail(file, 'protected read-only baseline scope step is absent')
    if (!/git diff --quiet "\$BASELINE_SOURCE_SHA" "\$GITHUB_SHA" -- supabase\/migrations\//.test(String(baselineScopeStep.run))) {
      fail(file, 'read-only baseline attestation does not prove the trusted migration tree is unchanged')
    }
    if (!String(baselineScopeStep.run).includes('serving cutover evidence requires previous baseline evidence')) {
      fail(file, 'serving cutover evidence can be detached from the previous baseline renewal source')
    }
    if (/allowed-baseline-files|change scope is not allowlisted|-- supabase server\/platform server\/chat-handler\.js worker\.js/.test(String(baselineScopeStep.run))) {
      fail(file, 'read-only baseline attestation still relies on a release-specific allowlist or runtime-surface ban')
    }
    for (const forbidden of ['supabase db push', 'supabase db query', 'confirm-remote-writes']) {
      if (source.toLowerCase().includes(forbidden)) fail(file, `read-only baseline attestation includes forbidden write surface: ${forbidden}`)
    }
    if (/^\s*(?:insert|update|delete)\s+/im.test(source)) fail(file, 'read-only baseline attestation includes a SQL DML statement')
    if (/!\s+git diff --quiet/.test(source)) fail(file, 'database runtime diff guard is inverted')
  }
  if (file === 'release-prelaunch-attestation.yml') {
    for (const required of [
      'environment: production-db-preflight',
      'PRELAUNCH_DIRECT_APPROVED',
      'PROJECT_REF" == "$EXPECTED_PROJECT_REF"',
      'PROJECT_REF" == "$PRODUCTION_PROJECT_REF"',
      'Require successful CI for this default-branch commit',
      'actions/workflows/ci.yml/runs?head_sha=',
      'Database contracts (local Docker only)',
      'run-supabase-read-only-query.mjs',
      'scripts/capture-prelaunch-row-counts.sql',
      'scripts/capture-prelaunch-protected-state.sql',
      "queryMode: 'supabase_read_only_user'",
      "operation: 'prelaunch-direct-attestation'",
      "releaseTrack: 'prompt-privacy'",
      'catalogStateHash',
      'rowCountHash',
      'protectedStateHash',
      "createHmac('sha256', evidenceKey)",
      'prelaunchDirectApproved:',
      'productionProjectGuardPassed: true',
      'defaultBranchCiPassed: true',
      "trap 'rm -rf -- \"$workdir\"' EXIT",
      'if: ${{ success() }}',
      'prelaunch-attestation-evidence-production-',
    ]) {
      if (!source.includes(required)) fail(file, `missing production prelaunch attestation guard: ${required}`)
    }
    for (const forbidden of ['supabase db push', 'supabase db query', 'confirm-remote-writes']) {
      if (source.toLowerCase().includes(forbidden)) fail(file, `read-only prelaunch attestation includes forbidden write surface: ${forbidden}`)
    }
    if (/^\s*(?:insert|update|delete)\s+/im.test(source)) fail(file, 'read-only prelaunch attestation includes a SQL DML statement')
    if (/\b(?:rowCounts|actualCounts|projectRef)\s*:/m.test(source)) fail(file, 'sanitized prelaunch evidence includes a raw count or project identifier field')
    if (/\brun:\s*npm ci\b/.test(source)) fail(file, 'read-only prelaunch attestation installs unnecessary dependencies')
    const jobEnvironment = root.jobs?.attest?.env || {}
    for (const secretName of ['GH_TOKEN', 'SUPABASE_ACCESS_TOKEN']) {
      if (Object.hasOwn(jobEnvironment, secretName)) fail(file, `${secretName} must be scoped to its consuming step`)
    }
  }
  if (file === 'release-post-lockdown-privilege-smoke.yml') {
    const smokeJob = root.jobs?.smoke
    const checkout = smokeJob?.steps?.find((step) => step?.uses === 'actions/checkout@v6')
    if (checkout?.with?.['fetch-depth'] !== 0) fail(file, 'cross-commit lockdown evidence verification requires full Git history')
    for (const [name, value] of Object.entries({
      DEFAULT_BRANCH: '${{ github.event.repository.default_branch }}',
      AUTHORIZED_POST_LOCKDOWN_SHA: '${{ vars.AUTHORIZED_POST_LOCKDOWN_SHA }}',
      AUTHORIZED_LOCKDOWN_SOURCE_SHA: '${{ vars.AUTHORIZED_LOCKDOWN_SOURCE_SHA }}',
      AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID: '${{ vars.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID }}',
    })) {
      if (smokeJob?.env?.[name] !== value) fail(file, `post-lockdown privilege smoke lacks protected bridge binding: ${name}`)
    }
    for (const secretName of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (Object.hasOwn(smokeJob?.env || {}, secretName)) fail(file, `${secretName} must not persist at job scope`)
    }
    const evidenceBinding = smokeJob?.steps?.find((step) => step?.name === 'Verify applied lockdown evidence binding')
    if (!evidenceBinding || evidenceBinding.env?.GH_TOKEN !== '${{ github.token }}') fail(file, 'lockdown evidence metadata binding is absent')
    for (const required of [
      'actions/runs/$LOCKDOWN_EVIDENCE_RUN_ID',
      'actions/workflows/release-database.yml',
      "run.conclusion === 'success'",
      "run.status === 'completed'",
      "run.event === 'workflow_dispatch'",
      'run.head_sha === value.commit',
      'run.head_branch === process.env.DEFAULT_BRANCH',
      'run.path === expectedWorkflowPath',
      'workflow.path === expectedWorkflowPath',
      'run.workflow_id === workflow.id',
      'LOCKDOWN_REMOTE_STATE_FINGERPRINT',
      'LOCKDOWN_MIGRATION_ROWS_FINGERPRINT',
    ]) {
      if (!String(evidenceBinding?.run).includes(required)) fail(file, `lockdown evidence metadata binding is missing: ${required}`)
    }
    const bridge = smokeJob?.steps?.find((step) => step?.name === 'Verify approved cross-commit lockdown evidence bridge')
    if (!bridge) fail(file, 'cross-commit lockdown evidence bridge is absent')
    for (const required of [
      '"$GITHUB_SHA" == "$AUTHORIZED_POST_LOCKDOWN_SHA"',
      '"$LOCKDOWN_COMMIT" == "$AUTHORIZED_LOCKDOWN_SOURCE_SHA"',
      '"$LOCKDOWN_EVIDENCE_RUN_ID" == "$AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID"',
      'git merge-base --is-ancestor "$LOCKDOWN_COMMIT" "$GITHUB_SHA"',
      'git diff --name-only "$LOCKDOWN_COMMIT" "$GITHUB_SHA"',
      'git diff --name-status "$LOCKDOWN_COMMIT" "$GITHUB_SHA"',
      '$1 != "M"',
      '.github/workflows/release-post-lockdown-observation.yml',
      '.github/workflows/release-post-lockdown-privilege-smoke.yml',
      'scripts/remote-privilege-smoke.mjs',
      'scripts/validate-github-workflows.mjs',
      'server/deployment-workflow-sync.test.js',
      'server/remote-privilege-smoke-contract.test.js',
    ]) {
      if (!String(bridge?.run).includes(required)) fail(file, `cross-commit lockdown evidence bridge is missing: ${required}`)
    }
    const reattest = smokeJob?.steps?.find((step) => step?.name === 'Reattest unchanged remote lockdown state')
    if (!reattest || reattest.env?.SUPABASE_ACCESS_TOKEN !== '${{ secrets.SUPABASE_ACCESS_TOKEN }}') {
      fail(file, 'lockdown state re-attestation lacks a step-scoped database credential')
    }
    for (const required of [
      'scripts/capture-release-state.sql',
      'scripts/capture-migration-state.sql',
      'supabase db query',
      'remoteStateFingerprint !== process.env.LOCKDOWN_REMOTE_STATE_FINGERPRINT',
      'migrationRowsFingerprint !== process.env.LOCKDOWN_MIGRATION_ROWS_FINGERPRINT',
      'LOCKDOWN_STATE_REATTESTED=true',
      'LOCKDOWN_STATE_ATTESTED_AT=',
    ]) {
      if (!String(reattest?.run).includes(required)) fail(file, `lockdown state re-attestation is missing: ${required}`)
    }
    if (/supabase db push|confirm-remote-writes/i.test(String(reattest?.run))) fail(file, 'lockdown state re-attestation includes a remote write surface')
    const httpProbe = smokeJob?.steps?.find((step) => step?.name === 'Verify actual remote anon and authenticated HTTP privilege boundaries')
    if (!httpProbe) fail(file, 'remote HTTP privilege probe step is absent')
    if (httpProbe.env?.SUPABASE_ACCESS_TOKEN !== '${{ secrets.SUPABASE_ACCESS_TOKEN }}') {
      fail(file, 'remote HTTP privilege probe lacks a step-scoped Management API credential')
    }
    for (const required of [
      'api-keys?reveal=true',
      'scripts/select-supabase-project-api-keys.mjs',
      'chmod 600 "$key_file" "$selected_key_file"',
      'trap \'rm -f -- "$key_file" "$selected_key_file"\' EXIT',
      '::add-mask::$SUPABASE_ANON_KEY',
      '::add-mask::$SUPABASE_SERVICE_ROLE_KEY',
      'unset SUPABASE_ACCESS_TOKEN',
      'node scripts/remote-privilege-smoke.mjs',
    ]) {
      if (!String(httpProbe.run).includes(required)) fail(file, `remote HTTP privilege probe is missing transient-key guard: ${required}`)
    }
    if (!/unset SUPABASE_ACCESS_TOKEN[\s\S]*node scripts\/remote-privilege-smoke\.mjs/.test(String(httpProbe.run))) {
      fail(file, 'Management API credential remains available to the remote privilege probe')
    }
    if (/GITHUB_ENV|(?:SUPABASE_ACCESS_TOKEN|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)[^\n]*(?:artifacts|evidence)/.test(String(httpProbe.run))) {
      fail(file, 'remote HTTP privilege probe persists a credential outside its step')
    }
    const record = smokeJob?.steps?.find((step) => step?.name === 'Record sanitized privilege smoke evidence')
    for (const required of [
      'lockdownCommit:',
      'lockdownAppliedAt:',
      'lockdownStateReattested',
      'lockdownStateAttestedAt:',
      'allPassed: lockdownStateReattested && sqlPassed && remotePassed',
    ]) {
      if (!String(record?.run).includes(required)) fail(file, `sanitized privilege evidence is missing: ${required}`)
    }
  }
  if (file === 'release-post-lockdown-observation.yml') {
    if (root.name !== 'release-post-lockdown-verification') {
      fail(file, 'post-lockdown workflow must be an immediate verification')
    }
    const actualInputs = Object.keys(root.on?.workflow_dispatch?.inputs || {}).sort()
    const expectedInputs = [
      'base_url',
      'lockdown_evidence_run_id',
      'privilege_evidence_run_id',
      'target',
      'worker_name',
      'wrangler_env',
    ].sort()
    if (JSON.stringify(actualInputs) !== JSON.stringify(expectedInputs)) {
      fail(file, 'post-lockdown verification inputs must not accept versions or a delayed-start timestamp')
    }
    for (const forbidden of [
      'lockdown_completed_at',
      'check-worker-observability.mjs',
      'CLOUDFLARE_OBSERVABILITY_TOKEN',
      'elapsed<24*60*60*1000',
      '24 * 60 * 60 * 1000',
      '24 hours',
    ]) {
      if (source.includes(forbidden)) fail(file, `post-lockdown verification retains delayed observation logic: ${forbidden}`)
    }
    if (/\bsleep\s+/.test(source)) fail(file, 'post-lockdown verification must not wait before its one live smoke')

    const verificationJob = root.jobs?.verify
    if (!verificationJob) fail(file, 'post-lockdown verification job is absent')
    if (verificationJob['timeout-minutes'] !== 15) fail(file, 'post-lockdown verification timeout must remain 15 minutes')
    if (verificationJob.env?.DEFAULT_BRANCH !== '${{ github.event.repository.default_branch }}') {
      fail(file, 'post-lockdown verification does not bind the repository default branch')
    }
    for (const [name, value] of Object.entries({
      AUTHORIZED_POST_LOCKDOWN_SHA: '${{ vars.AUTHORIZED_POST_LOCKDOWN_SHA }}',
      AUTHORIZED_LOCKDOWN_SOURCE_SHA: '${{ vars.AUTHORIZED_LOCKDOWN_SOURCE_SHA }}',
      AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID: '${{ vars.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID }}',
    })) {
      if (verificationJob.env?.[name] !== value) fail(file, `post-lockdown verification lacks protected bridge binding: ${name}`)
    }
    const checkout = verificationJob.steps?.find((step) => step?.uses === 'actions/checkout@v6')
    if (checkout?.with?.['fetch-depth'] !== 0) fail(file, 'post-lockdown verification requires full Git history')

    const evidenceStep = verificationJob.steps?.find((step) => step?.name === 'Verify fresh lockdown and privilege evidence binding')
    if (!evidenceStep) fail(file, 'post-lockdown evidence binding step is absent')
    if (evidenceStep.env?.GH_TOKEN !== '${{ github.token }}') {
      fail(file, 'post-lockdown evidence binding lacks a step-scoped GitHub token')
    }
    for (const required of [
      'mktemp -d "$RUNNER_TEMP/vmate-post-lockdown-evidence-',
      'trap \'rm -rf -- "$VERIFY_DIR"\' EXIT',
      'actions/runs/$LOCKDOWN_EVIDENCE_RUN_ID',
      'actions/workflows/release-database.yml',
      'actions/runs/$PRIVILEGE_EVIDENCE_RUN_ID',
      'actions/workflows/release-post-lockdown-privilege-smoke.yml',
      'gh run download "$LOCKDOWN_EVIDENCE_RUN_ID"',
      'gh run download "$PRIVILEGE_EVIDENCE_RUN_ID"',
      "run.conclusion === 'success'",
      "run.status === 'completed'",
      "run.event === 'workflow_dispatch'",
      'run.head_sha === headSha',
      'run.head_branch === process.env.DEFAULT_BRANCH',
      'run.path === workflowPath',
      'workflow.path === workflowPath',
      'run.workflow_id === workflow.id',
      "lock.operation === 'apply-lockdown'",
      'lock.migration === expectedMigration',
      'process.env.GITHUB_SHA === process.env.AUTHORIZED_POST_LOCKDOWN_SHA',
      'lock.commit === process.env.AUTHORIZED_LOCKDOWN_SOURCE_SHA',
      'process.env.LOCKDOWN_EVIDENCE_RUN_ID === process.env.AUTHORIZED_LOCKDOWN_EVIDENCE_RUN_ID',
      'exactBridgeDiff(lock.commit)',
      "['diff', '--name-status', '--no-renames', sourceSha, process.env.GITHUB_SHA]",
      'smoke.lockdownCommit === lock.commit',
      'smoke.lockdownAppliedAt === lock.appliedAt',
      'smoke.lockdownStateReattested === true',
      'smoke.lockdownEvidenceRunId === process.env.LOCKDOWN_EVIDENCE_RUN_ID',
      'smoke.workerVersionId === lock.workerVersionId',
      'appliedAt <= lockdownStateAttestedAt',
      'lockdownStateAttestedAt <= privilegeCompletedAt',
      'appliedAt <= privilegeCompletedAt',
      'privilegeCompletedAt <= now',
      'now - appliedAt <= 6 * 60 * 60 * 1000',
      'now - privilegeCompletedAt <= 30 * 60 * 1000',
      'WORKER_VERSION_ID=${lock.workerVersionId}',
      'BASELINE_WORKER_VERSION_ID=${lock.previousStableWorkerVersionId}',
    ]) {
      if (!String(evidenceStep.run).includes(required)) fail(file, `post-lockdown evidence binding is missing: ${required}`)
    }

    const deploymentStep = verificationJob.steps?.find((step) => step?.name === 'Verify v2 Worker is the only serving version')
    if (!deploymentStep) fail(file, 'current Worker deployment verification step is absent')
    if (deploymentStep.env?.CLOUDFLARE_API_TOKEN !== '${{ secrets.CLOUDFLARE_API_TOKEN }}'
      || deploymentStep.env?.CLOUDFLARE_ACCOUNT_ID !== '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}') {
      fail(file, 'current Worker deployment verification lacks step-scoped Cloudflare credentials')
    }
    for (const required of [
      'mktemp "$RUNNER_TEMP/vmate-post-lockdown-deployment-',
      'trap \'rm -f -- "$DEPLOYMENT_STATUS_FILE"\' EXIT',
      'wrangler deployments status',
      '!Array.isArray(source.versions)',
      'source.versions.length === 0',
      "typeof entry.version_id !== 'string'",
      "typeof entry.percentage !== 'number'",
      '!Number.isFinite(entry.percentage)',
      'entry.percentage < 0 || entry.percentage > 100',
      'ids.size !== entries.length',
      'Math.abs(total - 100) > 1e-9',
      'entries.length !== 1',
      'entries[0].id !== process.env.WORKER_VERSION_ID',
      'entries[0].percentage !== 100',
    ]) {
      if (!String(deploymentStep.run).includes(required)) fail(file, `current Worker deployment verification is missing: ${required}`)
    }

    const smokeInvocations = source.match(/node scripts\/smoke-release\.mjs\b/g) || []
    const smokeStep = verificationJob.steps?.find((step) => step?.name === 'Run one immediate live smoke')
    if (smokeInvocations.length !== 1 || !smokeStep || !String(smokeStep.run).includes('node scripts/smoke-release.mjs --base-url "$BASE_URL"')) {
      fail(file, 'post-lockdown verification must run exactly one immediate live smoke')
    }
    if (/--(?:worker-name|version-id)\b/.test(String(smokeStep.run))) {
      fail(file, 'post-lockdown live smoke must exercise normal production routing without a version override')
    }

    const evidenceRecordStep = verificationJob.steps?.find((step) => step?.name === 'Record single verification evidence')
    for (const required of [
      'schemaVersion: 2',
      "operation: 'post-lockdown-verification'",
      "verificationMode: 'single-immediate-live-smoke'",
      'lockdownCommit:',
      'lockdownStateAttestedAt:',
      'servingVersionVerified: true',
      'liveSmokePassed: true',
    ]) {
      if (!String(evidenceRecordStep?.run).includes(required)) fail(file, `sanitized post-lockdown evidence is missing: ${required}`)
    }
    if (/\b(?:baseUrl|workerName|projectRef)\s*:/.test(String(evidenceRecordStep?.run))) {
      fail(file, 'sanitized post-lockdown evidence contains a raw deployment identifier')
    }

    const uploads = verificationJob.steps?.filter((step) => step?.uses === 'actions/upload-artifact@v7') || []
    if (uploads.length !== 1
      || uploads[0].if !== '${{ success() }}'
      || uploads[0].with?.path !== 'artifacts/post-lockdown-verification-evidence.json'
      || uploads[0].with?.['if-no-files-found'] !== 'error') {
      fail(file, 'post-lockdown artifact upload must contain only successful sanitized verification evidence')
    }
  }
}

const workflowFiles = (await readdir(workflowDirectory))
  .filter((file) => /\.ya?ml$/i.test(file))
  .sort()

if (!workflowFiles.length) throw new Error('No GitHub Actions workflows found')
const missingReleaseWorkflows = [...expectedReleaseWorkflows]
  .filter((file) => !workflowFiles.includes(file))
if (missingReleaseWorkflows.length) {
  throw new Error(`Missing release workflows: ${missingReleaseWorkflows.join(', ')}`)
}
const unregisteredReleaseWorkflows = workflowFiles
  .filter((file) => file.startsWith('release-') && !expectedReleaseWorkflows.has(file))
if (unregisteredReleaseWorkflows.length) {
  throw new Error(`Unregistered release workflows: ${unregisteredReleaseWorkflows.join(', ')}`)
}
for (const file of workflowFiles) {
  const source = await readFile(path.join(workflowDirectory, file), 'utf8')
  validateWorkflow(file, source)
}

const readOnlyQueryHelper = await readFile(path.resolve(scriptDirectory, 'run-supabase-read-only-query.mjs'), 'utf8')
if (!readOnlyQueryHelper.includes('/database/query/read-only')) {
  fail('scripts/run-supabase-read-only-query.mjs', 'Supabase read-only Management API endpoint is absent')
}
if (/\/database\/query(?:[`'"]|\?)/.test(readOnlyQueryHelper)) {
  fail('scripts/run-supabase-read-only-query.mjs', 'write-capable Supabase query endpoint is present')
}

const prelaunchRowCounts = await readFile(path.resolve(scriptDirectory, 'capture-prelaunch-row-counts.sql'), 'utf8')
for (const required of ['from auth.users', 'from storage.objects']) {
  if (!prelaunchRowCounts.includes(required)) fail('scripts/capture-prelaunch-row-counts.sql', `missing protected count: ${required}`)
}
if (!/select\s+pg_catalog\.jsonb_build_object/i.test(prelaunchRowCounts)) {
  fail('scripts/capture-prelaunch-row-counts.sql', 'row-count capture must emit one structured aggregate')
}

const prelaunchProtectedState = await readFile(path.resolve(scriptDirectory, 'capture-prelaunch-protected-state.sql'), 'utf8')
for (const required of [
  'from auth.users',
  'character_record.prompt_profile_json',
  'world_record.world_rules_markdown',
  'room_record.resolved_prompt_snapshot_json',
  'room_record.version',
  'from public.room_state_summaries',
  "message_record.sequence_no = 1",
  'from storage.objects',
  'order by kind, sort_key',
  'as protected_state_fingerprint',
]) {
  if (!prelaunchProtectedState.includes(required)) fail('scripts/capture-prelaunch-protected-state.sql', `missing protected-state digest input: ${required}`)
}

const releaseSmoke = await readFile(path.resolve(scriptDirectory, 'smoke-release.mjs'), 'utf8')
for (const required of [
  'performance.now()',
  "asset.path === 'release-version.txt'",
  'maximumAssetBytes',
  'maximumManifestBytes',
  'digestBoundedAsset',
  'response.body.getReader()',
  'propagationMode ? propagationFetchTimeout() : 20_000',
  'livePropagation && !propagationTimeoutValue',
  'livePropagation && propagationTimeoutMs > 20_000',
  'livePropagation && workerName',
  'const propagationMode = Boolean(manifestPaths && (workerName || livePropagation))',
  'Live release identity did not propagate before the deadline',
  'Homepage verification failed after propagation deadline',
]) {
  if (!releaseSmoke.includes(required)) fail('scripts/smoke-release.mjs', `missing bounded candidate smoke contract: ${required}`)
}
if (releaseSmoke.includes('Buffer.from(await response.arrayBuffer())')) {
  fail('scripts/smoke-release.mjs', 'release asset verification must not buffer an unbounded response')
}

process.stdout.write(`Validated ${workflowFiles.length} GitHub Actions workflow structures.\n`)
