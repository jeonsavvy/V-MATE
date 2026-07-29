import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildArtifact, hashProjectRef, isDeniedStatus, isStorageWriteDeniedStatus, parseArguments, validateRemoteConfig } from '../scripts/remote-privilege-smoke-contracts.mjs'
import { V2_RPC_NAMES, rpcSurfaceMatchesPrivilegeContract } from '../scripts/remote-privilege-smoke.mjs'

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
