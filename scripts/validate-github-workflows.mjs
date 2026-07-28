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
  'release-post-lockdown-observation.yml',
  'release-post-lockdown-privilege-smoke.yml',
  'release-staging-synthetic-smoke.yml',
  'release-worker.yml',
])

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
    ]) {
      if (!source.includes(required)) fail(file, `missing production expand staging-privilege evidence guard: ${required}`)
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
      'release-database-baseline-attestation.yml@',
      'wrangler versions upload',
    ]) {
      if (!source.includes(required)) fail(file, `missing approved-origin Worker upload guard: ${required}`)
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

process.stdout.write(`Validated ${workflowFiles.length} GitHub Actions workflow structures.\n`)
