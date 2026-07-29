import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildArtifact, helpText, isDeniedStatus, isStorageWriteDeniedStatus, parseArguments, validateRemoteConfig } from './remote-privilege-smoke-contracts.mjs'

const headers = (key, token = key, contentType = 'application/json') => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': contentType })
const responseStatus = async (url, init) => (await fetch(url, init)).status
const denied = async (request) => isDeniedStatus(await request())
const fetchJson = async (url, init) => {
  const response = await fetch(url, init)
  let body = null
  try { body = await response.json() } catch {}
  return { ok: response.ok, status: response.status, body }
}
const safeFailure = () => process.stderr.write('Remote privilege smoke failed.\n')
const id = () => `privilege-smoke-${randomUUID()}`
export const V2_RPC_NAMES = Object.freeze([
  'reserve_chat_message_v2',
  'complete_legacy_chat_message_v2',
  'refund_chat_message_v2',
  'create_room_v2',
  'commit_room_turn_v2',
  'reconcile_expired_chat_reservations_v2',
])

export const rpcSurfaceMatchesPrivilegeContract = ({ anonRpcSurface, authenticatedRpcSurface, serviceRpcSurface }) => ({
  serviceAllowed: V2_RPC_NAMES.every((name) => serviceRpcSurface.has(`/rpc/${name}`)),
  clientsDenied: V2_RPC_NAMES.every((name) => !anonRpcSurface.has(`/rpc/${name}`)
    && !authenticatedRpcSurface.has(`/rpc/${name}`)),
})

const fetchRpcSurface = async (rest, roleHeaders) => {
  const response = await fetchJson(`${rest}/`, {
    headers: { ...roleHeaders, Accept: 'application/openapi+json' },
  })
  if (!response.ok || !response.body?.paths || typeof response.body.paths !== 'object') {
    throw new Error('RPC_SURFACE_UNAVAILABLE')
  }
  return new Set(Object.keys(response.body.paths))
}

const writeArtifact = async (output, artifact) => {
  const destination = path.resolve(output)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(artifact)}\n`, { encoding: 'utf8', mode: 0o600 })
}

const createUser = async (config, nonce) => {
  const email = `vmate-privilege-${nonce}@example.invalid`
  const password = `${randomUUID()}-${randomUUID()}`
  const created = await fetch(`${config.url}/auth/v1/admin/users`, { method: 'POST', headers: headers(process.env.SUPABASE_SERVICE_ROLE_KEY), body: JSON.stringify({ email, password, email_confirm: true }) })
  if (!created.ok) throw new Error('USER_CREATE_FAILED')
  const user = await created.json()
  if (!user?.id) throw new Error('USER_CREATE_INVALID')
  const loggedIn = await fetch(`${config.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: headers(process.env.SUPABASE_ANON_KEY), body: JSON.stringify({ email, password }) })
  if (!loggedIn.ok) throw new Error('USER_LOGIN_FAILED')
  const session = await loggedIn.json()
  if (!session?.access_token) throw new Error('USER_SESSION_INVALID')
  return { userId: user.id, accessToken: session.access_token }
}

const deleteUser = async (config, userId) => {
  if (!userId) return false
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: headers(process.env.SUPABASE_SERVICE_ROLE_KEY) })
  return response.ok
}

const run = async (config) => {
  const startedAt = new Date().toISOString()
  const scenarios = {
    ephemeralUserCreated: false, anonCharactersInsertDenied: false, authenticatedCharactersInsertDenied: false,
    anonRoomsInsertDenied: false, authenticatedRoomsInsertDenied: false, legacyQuotaMutationDenied: false,
    authenticatedStorageUploadDenied: false, authenticatedQuotaReadAllowed: false,
    serviceRoleV2RpcSurfaceAllowed: false, clientV2RpcSurfaceDenied: false,
    serviceRoleV2ReserveRefundAllowed: false, ephemeralUserCleanupSucceeded: false,
  }
  let user = null
  let unexpectedStoragePath = ''
  let failure = null
  try {
    user = await createUser(config, randomUUID())
    scenarios.ephemeralUserCreated = true
    const rest = `${config.url}/rest/v1`
    const anon = headers(process.env.SUPABASE_ANON_KEY)
    const authenticated = headers(process.env.SUPABASE_ANON_KEY, user.accessToken)
    const service = headers(process.env.SUPABASE_SERVICE_ROLE_KEY)
    const [anonRpcSurface, authenticatedRpcSurface, serviceRpcSurface] = await Promise.all([
      fetchRpcSurface(rest, anon),
      fetchRpcSurface(rest, authenticated),
      fetchRpcSurface(rest, service),
    ])
    const rpcSurfaceContract = rpcSurfaceMatchesPrivilegeContract({ anonRpcSurface, authenticatedRpcSurface, serviceRpcSurface })
    scenarios.serviceRoleV2RpcSurfaceAllowed = rpcSurfaceContract.serviceAllowed
    scenarios.clientV2RpcSurfaceDenied = rpcSurfaceContract.clientsDenied
    scenarios.anonCharactersInsertDenied = await denied(() => responseStatus(`${rest}/characters`, { method: 'POST', headers: anon, body: '{}' }))
    scenarios.authenticatedCharactersInsertDenied = await denied(() => responseStatus(`${rest}/characters`, { method: 'POST', headers: authenticated, body: '{}' }))
    scenarios.anonRoomsInsertDenied = await denied(() => responseStatus(`${rest}/rooms`, { method: 'POST', headers: anon, body: '{}' }))
    scenarios.authenticatedRoomsInsertDenied = await denied(() => responseStatus(`${rest}/rooms`, { method: 'POST', headers: authenticated, body: '{}' }))
    scenarios.legacyQuotaMutationDenied = await denied(() => responseStatus(`${rest}/rpc/reserve_daily_chat_message`, { method: 'POST', headers: authenticated, body: JSON.stringify({ p_request_id: id(), p_limit: 30 }) }))
    unexpectedStoragePath = `${user.userId}/privilege-smoke-${randomUUID()}.webp`
    const storageStatus = await responseStatus(`${config.url}/storage/v1/object/vmate-assets/${unexpectedStoragePath}`, { method: 'POST', headers: headers(process.env.SUPABASE_ANON_KEY, user.accessToken, 'image/webp'), body: new Uint8Array([82, 73, 70, 70]) })
    scenarios.authenticatedStorageUploadDenied = isStorageWriteDeniedStatus(storageStatus)
    const quotaStatus = await responseStatus(`${rest}/rpc/get_daily_chat_quota`, { method: 'POST', headers: authenticated, body: JSON.stringify({ p_limit: 30 }) })
    scenarios.authenticatedQuotaReadAllowed = quotaStatus >= 200 && quotaStatus < 300
    const requestId = id()
    const fingerprint = randomUUID().replaceAll('-', '')
    const reserve = await fetchJson(`${rest}/rpc/reserve_chat_message_v2`, { method: 'POST', headers: service, body: JSON.stringify({ p_user_id: user.userId, p_route: 'legacy', p_room_id: null, p_request_id: requestId, p_request_fingerprint: fingerprint, p_limit: 30, p_lease_seconds: 120 }) })
    const reservation = Array.isArray(reserve.body) ? reserve.body[0] : reserve.body
    const refund = reserve.ok && reservation?.disposition === 'reserved' && reservation?.allowed === true
      ? await fetchJson(`${rest}/rpc/refund_chat_message_v2`, { method: 'POST', headers: service, body: JSON.stringify({ p_user_id: user.userId, p_request_id: requestId, p_request_fingerprint: fingerprint, p_limit: 30 }) })
      : { ok: false, body: null }
    const refundResult = Array.isArray(refund.body) ? refund.body[0] : refund.body
    scenarios.serviceRoleV2ReserveRefundAllowed = reserve.ok
      && reservation?.disposition === 'reserved'
      && reservation?.allowed === true
      && reservation?.duplicate === false
      && refund.ok
      && Number.isInteger(refundResult?.remaining)
    if (Object.entries(scenarios).some(([key, value]) => key !== 'ephemeralUserCleanupSucceeded' && !value)) throw new Error('SCENARIO_FAILED')
  } catch (error) {
    failure = error
  } finally {
    if (user && unexpectedStoragePath && !scenarios.authenticatedStorageUploadDenied) {
      await fetch(`${config.url}/storage/v1/object/vmate-assets/${unexpectedStoragePath}`, { method: 'DELETE', headers: headers(process.env.SUPABASE_SERVICE_ROLE_KEY) }).catch(() => undefined)
    }
    scenarios.ephemeralUserCleanupSucceeded = await deleteUser(config, user?.userId).catch(() => false)
    if (!failure && user && !scenarios.ephemeralUserCleanupSucceeded) failure = new Error('USER_CLEANUP_FAILED')
    await writeArtifact(config.output, buildArtifact({ ...config, startedAt, finishedAt: new Date().toISOString(), scenarios }))
  }
  if (failure) throw failure
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) { process.stdout.write(`${helpText}\n`); return }
  const config = validateRemoteConfig({ options, env: process.env })
  if (config.checkConfig) { process.stdout.write('Remote privilege smoke configuration valid.\n'); return }
  await run(config)
  process.stdout.write('Remote privilege smoke completed.\n')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main().catch(() => { safeFailure(); process.exitCode = 1 })
