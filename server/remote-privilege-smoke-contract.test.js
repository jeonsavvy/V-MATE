import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildArtifact, hashProjectRef, isDeniedStatus, isStorageWriteDeniedStatus, parseArguments, validateRemoteConfig } from '../scripts/remote-privilege-smoke-contracts.mjs'
import { createTemporaryPassword, resolveRpcSurfaceResponse, runRemotePrivilegeSmoke, V2_RPC_NAMES, rpcSurfaceMatchesPrivilegeContract } from '../scripts/remote-privilege-smoke.mjs'

const env = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'anon-test-key', SUPABASE_SERVICE_ROLE_KEY: 'service-test-key', PRODUCTION_SUPABASE_PROJECT_REF: 'zyxwvutsrqponmlkjihg',
}
const options = { projectRef: 'abcdefghijklmnopqrst', target: 'staging', commit: '1234567', workerVersionId: 'worker-v1', output: 'artifacts/probe.json', confirmRemoteWrites: true }

test('remote probe has explicit parsing and remote-write gate', () => {
  assert.deepEqual(parseArguments(['--project-ref', options.projectRef, '--target', 'staging', '--commit', options.commit, '--worker-version-id', options.workerVersionId, '--output', options.output, '--confirm-remote-writes']), { ...options, help: false, checkConfig: false })
  assert.throws(() => validateRemoteConfig({ options: { ...options, confirmRemoteWrites: false }, env }), /REMOTE_WRITES_NOT_CONFIRMED/)
})

test('remote probe requires and separates canonical production project ref', () => {
  assert.equal(validateRemoteConfig({ options, env }).url, env.SUPABASE_URL)
  assert.throws(() => validateRemoteConfig({ options, env: { ...env, PRODUCTION_SUPABASE_PROJECT_REF: '' } }), /MISSING_REMOTE_ENV/)
  assert.throws(() => validateRemoteConfig({ options: { ...options, target: 'production' }, env }), /PRODUCTION_PROJECT_MISMATCH/)
  assert.throws(() => validateRemoteConfig({ options: { ...options, projectRef: env.PRODUCTION_SUPABASE_PROJECT_REF }, env: { ...env, SUPABASE_URL: `https://${env.PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` } }), /STAGING_PROJECT_MISMATCH/)
})

test('artifact uses full project hash and only approved safe fields', () => {
  assert.equal(isDeniedStatus(401), true); assert.equal(isDeniedStatus(403), true); assert.equal(isDeniedStatus(404), true); assert.equal(isDeniedStatus(400), false)
  assert.equal(isStorageWriteDeniedStatus(400), true); assert.equal(isStorageWriteDeniedStatus(409), false)
  const artifact = buildArtifact({ target: 'staging', commit: '1234567', projectRef: options.projectRef, workerVersionId: 'worker-v1', startedAt: '2026-07-27T00:00:00.000Z', finishedAt: '2026-07-27T00:01:00.000Z', scenarios: { denied: true } })
  assert.match(artifact.projectRefHash, /^[a-f0-9]{64}$/)
  assert.equal(artifact.projectRefHash, hashProjectRef(options.projectRef))
  assert.deepEqual(Object.keys(artifact).sort(), ['commit', 'projectRefHash', 'scenarios', 'schemaVersion', 'target', 'timestamps', 'workerVersionId'])
})

test('remote probe requires all six v2 RPCs only on the service-role gateway surface', () => {
  assert.deepEqual(V2_RPC_NAMES, [
    'reserve_chat_message_v2',
    'complete_legacy_chat_message_v2',
    'refund_chat_message_v2',
    'create_room_v2',
    'commit_room_turn_v2',
    'reconcile_expired_chat_reservations_v2',
  ])
  const serviceRpcSurface = new Set(V2_RPC_NAMES.map((name) => `/rpc/${name}`))
  const emptyClientSurface = new Set(['/rpc/get_daily_chat_quota'])
  assert.deepEqual(rpcSurfaceMatchesPrivilegeContract({
    anonRpcSurface: emptyClientSurface,
    authenticatedRpcSurface: emptyClientSurface,
    serviceRpcSurface,
  }), { serviceAllowed: true, clientsDenied: true })

  const incompleteServiceSurface = new Set(serviceRpcSurface)
  incompleteServiceSurface.delete('/rpc/commit_room_turn_v2')
  assert.equal(rpcSurfaceMatchesPrivilegeContract({
    anonRpcSurface: emptyClientSurface,
    authenticatedRpcSurface: emptyClientSurface,
    serviceRpcSurface: incompleteServiceSurface,
  }).serviceAllowed, false)

  assert.equal(rpcSurfaceMatchesPrivilegeContract({
    anonRpcSurface: emptyClientSurface,
    authenticatedRpcSurface: new Set(['/rpc/create_room_v2']),
    serviceRpcSurface,
  }).clientsDenied, false)
})

test('remote probe temporary password stays below the bcrypt byte limit', () => {
  const password = createTemporaryPassword()
  assert.match(password, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.byteLength(password, 'utf8'), 43)
  assert.ok(Buffer.byteLength(password, 'utf8') < 72)
})

test('remote probe accepts a gateway-hidden client RPC surface but fails closed for the service role', () => {
  assert.deepEqual(resolveRpcSurfaceResponse(
    { ok: false, status: 401, body: null },
    { deniedMeansEmpty: true },
  ), new Set())
  assert.throws(
    () => resolveRpcSurfaceResponse({ ok: false, status: 401, body: null }),
    /RPC_SURFACE_UNAVAILABLE/,
  )
  assert.deepEqual(
    resolveRpcSurfaceResponse({ ok: true, status: 200, body: { paths: { '/rpc/create_room_v2': {} } } }),
    new Set(['/rpc/create_room_v2']),
  )
  assert.throws(
    () => resolveRpcSurfaceResponse({ ok: true, status: 200, body: { paths: [] } }),
    /RPC_SURFACE_UNAVAILABLE/,
  )
})

test('remote probe deletes a created user when login fails and writes only sanitized cleanup evidence', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'vmate-privilege-smoke-'))
  const output = path.join(temporaryDirectory, 'probe.json')
  const originalFetch = globalThis.fetch
  const userId = 'ephemeral-user-id'
  const calls = []
  let createdCredentials = null
  let artifact = null

  try {
    globalThis.fetch = async (url, init = {}) => {
      const request = { url: String(url), method: init.method || 'GET' }
      calls.push(request)
      if (request.url.endsWith('/auth/v1/admin/users') && request.method === 'POST') {
        createdCredentials = JSON.parse(init.body)
        return { ok: true, json: async () => ({ id: userId }) }
      }
      if (request.url.endsWith('/auth/v1/token?grant_type=password') && request.method === 'POST') return { ok: false }
      if (request.url.endsWith(`/auth/v1/admin/users/${userId}`) && request.method === 'DELETE') return { ok: true }
      throw new Error(`UNEXPECTED_FETCH:${request.method}:${request.url}`)
    }

    await assert.rejects(runRemotePrivilegeSmoke({ ...options, output, url: env.SUPABASE_URL }), /USER_LOGIN_FAILED/)
    artifact = JSON.parse(await readFile(output, 'utf8'))

    assert.deepEqual(calls.map(({ method, url }) => [method, new URL(url).pathname]), [
      ['POST', '/auth/v1/admin/users'],
      ['POST', '/auth/v1/token'],
      ['DELETE', `/auth/v1/admin/users/${userId}`],
    ])
    assert.equal(artifact.scenarios.ephemeralUserCreated, true)
    assert.equal(artifact.scenarios.ephemeralUserCleanupSucceeded, true)
    const serializedArtifact = JSON.stringify(artifact)
    for (const privateValue of [userId, createdCredentials.email, createdCredentials.password, env.SUPABASE_URL]) {
      assert.equal(serializedArtifact.includes(privateValue), false)
    }
  } finally {
    globalThis.fetch = originalFetch
    await rm(temporaryDirectory, { recursive: true, force: true })
  }

  assert.equal(globalThis.fetch, originalFetch)
  await assert.rejects(access(temporaryDirectory), { code: 'ENOENT' })
})
