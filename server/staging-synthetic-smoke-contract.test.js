import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  SCENARIO_KEYS,
  SyntheticSmokeError,
  assertEvidenceOmitsSensitiveValues,
  buildSafeSyntheticEvidence,
  createBaseApiRequester,
  createScenarioState,
  resolveStagingSmokeConfig,
  runIdempotentCleanup,
  toSafeSyntheticErrorCode,
} from '../scripts/staging-synthetic-smoke-contract.mjs'
import { CHARACTER_VARIANTS } from '../scripts/staging-synthetic-smoke.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = join(ROOT, 'scripts', 'staging-synthetic-smoke.mjs')

const validEnv = () => ({
  EXPECTED_BASE_URL: 'https://staging.vmate.example',
  PRODUCTION_BASE_URL: 'https://vmate.example',
  EXPECTED_PROJECT_REF: 'stageproj123',
  PRODUCTION_PROJECT_REF: 'prodproj1234',
  EXPECTED_WORKER_NAME: 'vmate-staging',
  PRODUCTION_WORKER_NAME: 'vmate-production',
  SUPABASE_URL: 'https://stageproj123.supabase.co',
  SUPABASE_ANON_KEY: 'anon_test_key_abcdefghijklmnopqrstuvwxyz',
  SUPABASE_SERVICE_ROLE_KEY: 'service_test_key_abcdefghijklmnopqrstuvwxyz',
})

const validArgs = (output = 'synthetic-result.json') => [
  '--base-url', 'https://staging.vmate.example',
  '--project-ref', 'stageproj123',
  '--worker-name', 'vmate-staging',
  '--version-id', 'version_zero_traffic_123',
  '--output', output,
  '--confirm-staging-writes', 'true',
]

const expectCode = (callback, code) => assert.throws(callback, (error) => (
  error instanceof SyntheticSmokeError && error.code === code
))

test('staging synthetic config requires exact HTTPS staging base, project, Worker, and explicit confirmation', () => {
  const config = resolveStagingSmokeConfig({ argv: validArgs(), env: validEnv(), cwd: ROOT })
  assert.equal(config.baseUrl, 'https://staging.vmate.example')
  assert.equal(config.projectRef, 'stageproj123')
  assert.equal(config.workerName, 'vmate-staging')
  assert.equal(config.versionId, 'version_zero_traffic_123')
  assert.equal(config.outputPath, join(ROOT, 'synthetic-result.json'))

  const withoutConfirmation = validArgs().filter((_, index, values) => values[index - 1] !== '--confirm-staging-writes' && values[index] !== '--confirm-staging-writes')
  expectCode(() => resolveStagingSmokeConfig({ argv: withoutConfirmation, env: validEnv() }), 'EXPLICIT_CONFIRMATION_REQUIRED')

  const withoutVersionId = validArgs().filter((_, index, values) => values[index - 1] !== '--version-id' && values[index] !== '--version-id')
  expectCode(() => resolveStagingSmokeConfig({ argv: withoutVersionId, env: validEnv() }), 'WORKER_OVERRIDE_INVALID')

  expectCode(() => resolveStagingSmokeConfig({
    argv: [...validArgs(), '--supabase-url', 'https://forbidden.example'],
    env: validEnv(),
  }), 'UNKNOWN_ARGUMENT')
})

test('staging synthetic config rejects HTTP, production, mismatch, and Supabase project ambiguity', () => {
  const httpArgs = validArgs().map((value) => value === 'https://staging.vmate.example' ? 'http://staging.vmate.example' : value)
  expectCode(() => resolveStagingSmokeConfig({ argv: httpArgs, env: validEnv() }), 'BASE_URL_GUARD_REJECTED')

  const productionBaseEnv = { ...validEnv(), PRODUCTION_BASE_URL: 'https://staging.vmate.example' }
  expectCode(() => resolveStagingSmokeConfig({ argv: validArgs(), env: productionBaseEnv }), 'BASE_URL_GUARD_REJECTED')

  const productionProjectEnv = { ...validEnv(), PRODUCTION_PROJECT_REF: 'stageproj123' }
  expectCode(() => resolveStagingSmokeConfig({ argv: validArgs(), env: productionProjectEnv }), 'PROJECT_GUARD_REJECTED')

  const productionWorkerEnv = { ...validEnv(), PRODUCTION_WORKER_NAME: 'vmate-staging' }
  expectCode(() => resolveStagingSmokeConfig({ argv: validArgs(), env: productionWorkerEnv }), 'WORKER_GUARD_REJECTED')

  const foreignSupabaseEnv = { ...validEnv(), SUPABASE_URL: 'https://anotherproj123.supabase.co' }
  expectCode(() => resolveStagingSmokeConfig({ argv: validArgs(), env: foreignSupabaseEnv }), 'PROJECT_GUARD_REJECTED')
})

test('base API requester applies the zero-traffic override and bearer only to canonical /api calls', async () => {
  const calls = []
  const request = createBaseApiRequester({
    baseUrl: 'https://staging.vmate.example',
    workerName: 'vmate-staging',
    versionId: 'version_zero_traffic_123',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  await request({ operation: 'TEST', path: '/api/home', accessToken: 'private-access-token' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://staging.vmate.example/api/home')
  assert.equal(calls[0].options.headers['Cloudflare-Workers-Version-Overrides'], 'vmate-staging="version_zero_traffic_123"')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-access-token')
  await assert.rejects(request({ operation: 'TEST', path: 'https://foreign.example/api/home' }), { code: 'API_PATH_REJECTED' })
  assert.equal(calls.length, 1)
})

test('synthetic evidence contains only booleans, timestamps, target hashes, and the selected version id', () => {
  const scenarios = Object.fromEntries(SCENARIO_KEYS.map((key) => [key, true]))
  const evidence = buildSafeSyntheticEvidence({
    startedAt: '2026-07-27T00:00:00.000Z',
    finishedAt: '2026-07-27T00:05:00.000Z',
    baseUrl: 'https://staging.vmate.example',
    projectRef: 'stageproj123',
    workerName: 'vmate-staging',
    versionId: 'version_zero_traffic_123',
    scenarios,
  })
  assert.deepEqual(Object.keys(evidence).sort(), ['allPassed', 'finishedAt', 'scenarios', 'startedAt', 'targets'])
  assert.equal(evidence.allPassed, true)
  assert.match(evidence.targets.baseOriginHash, /^[a-f0-9]{64}$/)
  assert.match(evidence.targets.projectRefHash, /^[a-f0-9]{64}$/)
  assert.match(evidence.targets.workerNameHash, /^[a-f0-9]{64}$/)
  assert.equal(evidence.targets.versionId, 'version_zero_traffic_123')
  const serialized = JSON.stringify(evidence)
  for (const rawTarget of ['https://staging.vmate.example', 'stageproj123', 'vmate-staging']) {
    assert.equal(serialized.includes(rawTarget), false)
  }
  assert.equal(assertEvidenceOmitsSensitiveValues(evidence, ['private-email@example.invalid', 'private-token-value']), true)
  expectCode(() => assertEvidenceOmitsSensitiveValues({ ...evidence, email: 'private-email@example.invalid' }), 'EVIDENCE_SENSITIVE_FIELD')
})

test('cleanup helper attempts storage and auth cleanup independently and remains idempotent', async () => {
  const storage = new Set(['a', 'b'])
  let userExists = true
  const cleanup = () => runIdempotentCleanup({
    removeStorage: async () => storage.clear(),
    deleteUser: async () => { userExists = false },
  })
  assert.equal(await cleanup(), true)
  assert.equal(await cleanup(), true)
  assert.equal(storage.size, 0)
  assert.equal(userExists, false)

  let authAttempted = false
  assert.equal(await runIdempotentCleanup({
    removeStorage: async () => { throw new Error('private storage failure') },
    deleteUser: async () => { authAttempted = true },
  }), false)
  assert.equal(authAttempted, true)
})

test('operator output maps provider-specific failures to a safe dependency code', () => {
  assert.equal(toSafeSyntheticErrorCode(new SyntheticSmokeError('SUPABASE_CREATE_USER_FAILED')), 'STAGING_DEPENDENCY_FAILED')
  assert.equal(toSafeSyntheticErrorCode(new Error('raw provider failure')), 'SYNTHETIC_SMOKE_FAILED')
})

test('embedded signed-upload fixtures are exact WebP character dimensions', () => {
  const expected = [[300, 400], [600, 800], [768, 1024]]
  assert.equal(CHARACTER_VARIANTS.length, 3)
  CHARACTER_VARIANTS.forEach((variant, index) => {
    const buffer = Buffer.from(variant.base64, 'base64')
    assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WEBP')
    const frameHeader = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]))
    assert.ok(frameHeader > 0)
    assert.equal(buffer.readUInt16LE(frameHeader + 3) & 0x3fff, expected[index][0])
    assert.equal(buffer.readUInt16LE(frameHeader + 5) & 0x3fff, expected[index][1])
    assert.equal(variant.width, expected[index][0])
    assert.equal(variant.height, expected[index][1])
  })
})

test('--help and --check-config are network-free and workflow-compatible', async () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--worker-name <worker-name>/)
  assert.match(help.stdout, /--version-id <zero-traffic-version-id>/)
  assert.match(help.stdout, /--confirm-staging-writes true/)
  assert.match(help.stdout, /--output <json-file>/)

  const temp = await mkdtemp(join(tmpdir(), 'vmate-synthetic-contract-'))
  try {
    const output = join(temp, 'should-not-exist.json')
    const check = spawnSync(process.execPath, [SCRIPT, ...validArgs(output), '--check-config'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...validEnv() },
    })
    assert.equal(check.status, 0, check.stderr)
    assert.match(check.stdout, /No network calls were made/)
    assert.equal(existsSync(output), false)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('script statically covers required scenarios without direct fetch or secret output', () => {
  const script = readFileSync(SCRIPT, 'utf8')
  const helper = readFileSync(join(ROOT, 'scripts', 'staging-synthetic-smoke-contract.mjs'), 'utf8')
  for (const fragment of [
    'uploadToSignedUrl',
    'verifyCrossOwnerAssetRejection',
    "path: '/api/chat'",
    "path: '/api/me/chat-quota'",
    "path: '/api/account'",
    "type: 'recovery'",
    'redirectTo: recoveryRedirect',
    'verifyOtp',
    'updateUser',
    'runIdempotentCleanup',
  ]) assert.match(script, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(script, /\bfetch\s*\(/)
  assert.doesNotMatch(script, /console\.(?:log|error|warn)/)
  assert.doesNotMatch(script, /Cloudflare-Workers-Version-Overrides/)
  assert.match(helper, /'Cloudflare-Workers-Version-Overrides': override/)

  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'release-staging-synthetic-smoke.yml'), 'utf8')
  assert.match(workflow, /--output private-artifacts\/result\.json --confirm-staging-writes true/)
  assert.deepEqual(Object.keys(createScenarioState()), [...SCENARIO_KEYS])
})
