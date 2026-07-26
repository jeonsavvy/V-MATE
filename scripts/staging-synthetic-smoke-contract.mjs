import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

export const STAGING_CONFIRM_VALUE = 'true'

export const SCENARIO_KEYS = Object.freeze([
  'ephemeralUsersCreated',
  'aCharacterVariantsUploaded',
  'bCharacterVariantsUploaded',
  'aPrivateCharacterCreated',
  'aPrivateWorldCreated',
  'privateCharacterAccessMatrixPassed',
  'privateWorldAccessMatrixPassed',
  'crossOwnerAssetReferenceRejected',
  'legacyChatCompleted',
  'roomChatCompleted',
  'sharedQuotaIncrementedByTwo',
  'recoveryLinkGenerated',
  'recoverySessionEstablished',
  'recoveryCredentialUpdated',
  'recoveryReloginSucceeded',
  'accountADeletedByApi',
  'accountAAssetsAbsent',
  'accountBAssetsRetained',
  'cleanupACompleted',
  'cleanupBCompleted',
])

export const HELP_TEXT = `Usage:
  node scripts/staging-synthetic-smoke.mjs \\
    --base-url <https-staging-origin> \\
    --project-ref <staging-project-ref> \\
    --worker-name <worker-name> \\
    --version-id <zero-traffic-version-id> \\
    --confirm-staging-writes true \\
    [--output <json-file>]

Read-only validation:
  Add --check-config to validate guards and credentials without network calls or writes.

Required environment configuration:
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
  EXPECTED_BASE_URL, EXPECTED_PROJECT_REF, EXPECTED_WORKER_NAME
  PRODUCTION_BASE_URL, PRODUCTION_PROJECT_REF, PRODUCTION_WORKER_NAME

The staging allow targets and production deny targets must be distinct. All application API
requests use the supplied zero-traffic Worker version override. Direct Supabase Auth/Storage
requests never receive that override header.
`

const VALUE_FLAGS = new Set([
  '--base-url',
  '--project-ref',
  '--worker-name',
  '--version-id',
  '--confirm-staging-writes',
  '--output',
])
const BOOLEAN_FLAGS = new Set(['--help', '--check-config'])
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,32}$/
const WORKER_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const VERSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

export class SyntheticSmokeError extends Error {
  constructor(code) {
    super(code)
    this.name = 'SyntheticSmokeError'
    this.code = code
  }
}

const fail = (code) => {
  throw new SyntheticSmokeError(code)
}

const parseHttpsOrigin = (value, code) => {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
      || (parsed.pathname !== '/' && parsed.pathname !== '')) fail(code)
    return parsed.origin
  } catch (error) {
    if (error instanceof SyntheticSmokeError) throw error
    return fail(code)
  }
}

const parseProjectRef = (value, code) => {
  const normalized = String(value || '').trim()
  if (!PROJECT_REF_PATTERN.test(normalized)) fail(code)
  return normalized
}

const requireCredential = (value) => {
  const normalized = String(value || '').trim()
  if (normalized.length < 20 || /\s/.test(normalized)) fail('STAGING_CREDENTIALS_INVALID')
  return normalized
}

export const parseStagingSmokeArguments = (argv = []) => {
  const parsed = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (BOOLEAN_FLAGS.has(name)) {
      if (parsed.has(name)) fail('DUPLICATE_ARGUMENT')
      parsed.set(name, true)
      continue
    }
    if (!VALUE_FLAGS.has(name)) fail('UNKNOWN_ARGUMENT')
    const value = argv[index + 1]
    if (typeof value === 'undefined' || String(value).startsWith('--')) fail('ARGUMENT_VALUE_REQUIRED')
    if (parsed.has(name)) fail('DUPLICATE_ARGUMENT')
    parsed.set(name, String(value))
    index += 1
  }
  return parsed
}

export const resolveStagingSmokeConfig = ({ argv = [], env = process.env, cwd = process.cwd() } = {}) => {
  const args = parseStagingSmokeArguments(argv)
  if (args.has('--help')) return { help: true }

  const baseUrl = parseHttpsOrigin(args.get('--base-url'), 'BASE_URL_GUARD_REJECTED')
  const allowedBaseUrl = parseHttpsOrigin(env.EXPECTED_BASE_URL, 'STAGING_ALLOW_TARGET_INVALID')
  const productionBaseUrl = parseHttpsOrigin(env.PRODUCTION_BASE_URL, 'PRODUCTION_DENY_TARGET_INVALID')
  if (baseUrl !== allowedBaseUrl || baseUrl === productionBaseUrl || allowedBaseUrl === productionBaseUrl) {
    fail('BASE_URL_GUARD_REJECTED')
  }

  const projectRef = parseProjectRef(args.get('--project-ref'), 'PROJECT_GUARD_REJECTED')
  const allowedProjectRef = parseProjectRef(env.EXPECTED_PROJECT_REF, 'STAGING_ALLOW_TARGET_INVALID')
  const productionProjectRef = parseProjectRef(env.PRODUCTION_PROJECT_REF, 'PRODUCTION_DENY_TARGET_INVALID')
  if (projectRef !== allowedProjectRef || projectRef === productionProjectRef || allowedProjectRef === productionProjectRef) {
    fail('PROJECT_GUARD_REJECTED')
  }

  const workerName = String(args.get('--worker-name') || '').trim()
  const versionId = String(args.get('--version-id') || '').trim()
  if (!WORKER_NAME_PATTERN.test(workerName) || !VERSION_ID_PATTERN.test(versionId)) fail('WORKER_OVERRIDE_INVALID')
  const expectedWorkerName = String(env.EXPECTED_WORKER_NAME || '').trim()
  const productionWorkerName = String(env.PRODUCTION_WORKER_NAME || '').trim()
  if (!WORKER_NAME_PATTERN.test(expectedWorkerName) || !WORKER_NAME_PATTERN.test(productionWorkerName)
    || workerName !== expectedWorkerName || workerName === productionWorkerName || expectedWorkerName === productionWorkerName) {
    fail('WORKER_GUARD_REJECTED')
  }
  if (args.get('--confirm-staging-writes') !== STAGING_CONFIRM_VALUE) fail('EXPLICIT_CONFIRMATION_REQUIRED')

  const supabaseOrigin = parseHttpsOrigin(env.SUPABASE_URL, 'STAGING_CREDENTIALS_INVALID')
  const supabaseHost = new URL(supabaseOrigin).hostname
  if (supabaseHost !== `${projectRef}.supabase.co`) fail('PROJECT_GUARD_REJECTED')
  const anonKey = requireCredential(env.SUPABASE_ANON_KEY)
  const serviceRoleKey = requireCredential(env.SUPABASE_SERVICE_ROLE_KEY)
  if (anonKey === serviceRoleKey) fail('STAGING_CREDENTIALS_INVALID')

  const outputPath = resolve(cwd, args.get('--output') || `${tmpdir()}/v-mate-staging-synthetic-smoke.json`)
  return {
    help: false,
    checkConfig: args.has('--check-config'),
    baseUrl,
    projectRef,
    workerName,
    versionId,
    outputPath,
    supabaseOrigin,
    anonKey,
    serviceRoleKey,
  }
}

export const sha256Hex = (value) => createHash('sha256').update(String(value)).digest('hex')

export const buildWorkerVersionOverride = ({ workerName, versionId }) => {
  if (!WORKER_NAME_PATTERN.test(String(workerName || '')) || !VERSION_ID_PATTERN.test(String(versionId || ''))) {
    fail('WORKER_OVERRIDE_INVALID')
  }
  return `${workerName}="${versionId}"`
}

const safeOperationCode = (operation) => String(operation || 'API_REQUEST')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 64) || 'API_REQUEST'

export const createBaseApiRequester = ({
  baseUrl,
  workerName,
  versionId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 90_000,
}) => {
  const origin = parseHttpsOrigin(baseUrl, 'BASE_URL_GUARD_REJECTED')
  const override = buildWorkerVersionOverride({ workerName, versionId })
  if (typeof fetchImpl !== 'function') fail('FETCH_UNAVAILABLE')

  return async ({ operation, path, method = 'GET', accessToken = '', body, expectedStatuses = [200] }) => {
    const normalizedPath = String(path || '')
    if (!normalizedPath.startsWith('/api/')) fail('API_PATH_REJECTED')
    const target = new URL(normalizedPath, origin)
    if (target.origin !== origin) fail('API_PATH_REJECTED')
    const headers = {
      Accept: 'application/json',
      Origin: origin,
      'Cloudflare-Workers-Version-Overrides': override,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`

    let response
    try {
      response = await fetchImpl(target, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      fail(`HTTP_${safeOperationCode(operation)}_UNAVAILABLE`)
    }

    let payload = {}
    try {
      payload = await response.json()
    } catch {
      payload = {}
    }
    if (!expectedStatuses.includes(response.status)) fail(`HTTP_${safeOperationCode(operation)}_STATUS`)
    return {
      status: response.status,
      payload: payload && typeof payload === 'object' ? payload : {},
      errorCode: typeof payload?.error_code === 'string' ? payload.error_code : '',
    }
  }
}

export const createScenarioState = () => Object.fromEntries(SCENARIO_KEYS.map((key) => [key, false]))

const assertIsoTimestamp = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('EVIDENCE_TIMESTAMP_INVALID')
  }
}

export const buildSafeSyntheticEvidence = ({ startedAt, finishedAt, baseUrl, projectRef, workerName, versionId, scenarios }) => {
  assertIsoTimestamp(startedAt)
  assertIsoTimestamp(finishedAt)
  if (Date.parse(finishedAt) < Date.parse(startedAt)) fail('EVIDENCE_TIMESTAMP_INVALID')
  if (!VERSION_ID_PATTERN.test(String(versionId || ''))) fail('EVIDENCE_TARGET_INVALID')
  const scenarioKeys = Object.keys(scenarios || {}).sort()
  const expectedKeys = [...SCENARIO_KEYS].sort()
  if (scenarioKeys.length !== expectedKeys.length
    || scenarioKeys.some((key, index) => key !== expectedKeys[index])
    || scenarioKeys.some((key) => typeof scenarios[key] !== 'boolean')) {
    fail('EVIDENCE_SCENARIOS_INVALID')
  }
  const evidence = {
    startedAt,
    finishedAt,
    targets: {
      baseOriginHash: sha256Hex(baseUrl),
      projectRefHash: sha256Hex(projectRef),
      workerNameHash: sha256Hex(workerName),
      versionId,
    },
    scenarios: Object.fromEntries(SCENARIO_KEYS.map((key) => [key, scenarios[key]])),
    allPassed: SCENARIO_KEYS.every((key) => scenarios[key] === true),
  }
  for (const [key, value] of Object.entries(evidence.targets)) {
    if (key !== 'versionId' && !HASH_PATTERN.test(value)) fail('EVIDENCE_TARGET_INVALID')
  }
  return evidence
}

export const assertEvidenceOmitsSensitiveValues = (evidence, sensitiveValues = []) => {
  const serialized = JSON.stringify(evidence)
  const forbiddenKey = /(?:email|password|token|secret|privateSlug|userId|assetPath|signedUrl|supabaseUrl)/i
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) fail('EVIDENCE_SENSITIVE_FIELD')
      walk(child)
    }
  }
  walk(evidence)
  for (const candidate of sensitiveValues) {
    const normalized = String(candidate || '')
    if (normalized.length >= 8 && serialized.includes(normalized)) fail('EVIDENCE_SENSITIVE_VALUE')
  }
  return true
}

export const runIdempotentCleanup = async ({ removeStorage, deleteUser } = {}) => {
  let ok = true
  if (typeof removeStorage === 'function') {
    try {
      await removeStorage()
    } catch {
      ok = false
    }
  }
  if (typeof deleteUser === 'function') {
    try {
      await deleteUser()
    } catch {
      ok = false
    }
  }
  return ok
}

export const toSafeSyntheticErrorCode = (error) => {
  if (!(error instanceof SyntheticSmokeError) || !/^[A-Z0-9_]{3,96}$/.test(error.code)) {
    return 'SYNTHETIC_SMOKE_FAILED'
  }
  if (/^(?:SUPABASE|GEMINI|CLOUDFLARE)_/.test(error.code)) return 'STAGING_DEPENDENCY_FAILED'
  return error.code
}
