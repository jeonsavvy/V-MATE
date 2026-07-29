import { readdir, readFile } from 'node:fs/promises'
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
      'baseline evidence change scope is not allowlisted',
      'AUTHORIZED_DOMAIN_RELEASE_SHA',
      'authorized domain release SHA guard mismatch',
      'actions/runs/$BASELINE_EVIDENCE_RUN_ID',
      'actions/workflows/release-database-baseline-attestation.yml',
      'actions/runs/$EXPAND_EVIDENCE_RUN_ID',
      'actions/workflows/release-database.yml',
      'run.head_branch === process.env.DEFAULT_BRANCH',
      'run.workflow_id === workflow.id',
      'wrangler versions upload',
    ]) {
      if (!source.includes(required)) fail(file, `missing approved-origin Worker upload guard: ${required}`)
    }
    const shadowEvidenceStep = root.jobs?.release?.steps?.find((step) => step?.name === 'Verify current-commit shadow upload and immutable version metadata')
    if (!shadowEvidenceStep) fail(file, 'current-commit shadow evidence step is absent')
    if (root.jobs?.release?.env?.DEFAULT_BRANCH !== '${{ github.event.repository.default_branch }}') {
      fail(file, 'Worker release does not bind the repository default branch')
    }
    if (!String(shadowEvidenceStep.run).includes('run.head_branch === process.env.DEFAULT_BRANCH')) {
      fail(file, 'shadow evidence run does not require the repository default branch')
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
    const releaseEvidenceUpload = root.jobs?.release?.steps?.find((step) => step?.uses === 'actions/upload-artifact@v4' && step?.name === 'Upload release evidence')
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
      'AUTHORIZED_DOMAIN_RELEASE_SHA',
      'authorized domain release SHA guard mismatch',
      'if: ${{ success() }}',
      '5adce9d2128bc7452e30bae9a2c8fca7790baa49',
      '20260727000000',
      '20260727025134',
      'backend_stabilization_lockdown',
      'lockdownMigrationAliasHash',
      'database-baseline-evidence-production-',
      'run-supabase-read-only-query.mjs',
      "queryMode: 'supabase_read_only_user'",
      "trap 'rm -rf private-artifacts' EXIT",
      'read-only-baseline-attestation',
    ]) {
      if (!source.includes(required)) fail(file, `missing read-only baseline attestation guard: ${required}`)
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
    for (const secretName of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (Object.hasOwn(smokeJob?.env || {}, secretName)) fail(file, `${secretName} must not persist at job scope`)
    }
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

process.stdout.write(`Validated ${workflowFiles.length} GitHub Actions workflow structures.\n`)
