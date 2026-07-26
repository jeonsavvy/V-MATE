import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  HELP_TEXT,
  SyntheticSmokeError,
  assertEvidenceOmitsSensitiveValues,
  buildSafeSyntheticEvidence,
  createBaseApiRequester,
  createScenarioState,
  resolveStagingSmokeConfig,
  runIdempotentCleanup,
  toSafeSyntheticErrorCode,
} from './staging-synthetic-smoke-contract.mjs'

// Exact-size, solid-color WebP fixtures keep the smoke independent of image tooling.
export const CHARACTER_VARIANTS = Object.freeze([
  {
    kind: 'smoke-main:thumb',
    width: 300,
    height: 400,
    base64: 'UklGRloBAABXRUJQVlA4IE4BAACQIwCdASosAZABPzmcy18vKyklICgB4CcJaQDYzK+wBPYB77ZOQ99scQyIiIiGRERES2REMjHIiIiIZFFIRERERDIiIiJbvoiIiGXWKBimZx5Qy6xCLbC7xQM264RbYRFlRcof2ac6ItcIiyouUP7NOdEWuERZUXKH9mnOiLXCIsqLlD+zTnRFrhEWVFyh/Zpzoi1wiLKi5Q/s050Ra4RFlRcof2ac6ItcIiyouUP7NOdEWuERZUXKH9mnOiLXCIsqLlD+zTnRFrhEWVFyh/Zpzoi1wiLKi5Q/s050Ra4RFlRcof2ac6ItcIiyouUP7NOdEWuERZUXKH9mnOiLXCIsqLlD+zTnRFrhEWVFyh/Zpzoi1wiLKi5Q/s050Ra4RFlRcof2IAD+7QcvnY9wf0swACcsapMLUmFqTC1JhYs4EAAAAAAAAAAAAAAAAAAA',
  },
  {
    kind: 'smoke-main:card',
    width: 600,
    height: 800,
    base64: 'UklGRroEAABXRUJQVlA4IK4EAADwiQCdASpYAiADPzmcy18vKyklIAgB4CcJaW7hdVEfgU+fgAnsA99snIe+2TkPfbJyHvtkxIiIhkREREMiIiIhkREREMiIiJpIiIZmgREREQyIiIiGREREQyIieiIiIiGREREQyIiIiGREREQyIievsQyIiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0XRPoivoiKuivosqLlD+xR0VBFVxW0WMAD+/p5v+eSoWX918YP298ju8ju8ju8ju8ju8ju8ju8ju8ju8ju8jWcCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  {
    kind: 'smoke-main:detail',
    width: 768,
    height: 1024,
    base64: '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',
  },
])

const clientOptions = Object.freeze({
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
})

const fail = (code) => {
  throw new SyntheticSmokeError(code)
}

const unwrapSupabase = async (operation, promise) => {
  let result
  try {
    result = await promise
  } catch {
    fail(`SUPABASE_${operation}_UNAVAILABLE`)
  }
  if (result?.error) fail(`SUPABASE_${operation}_FAILED`)
  return result?.data
}

const createEphemeralCredentials = (label) => {
  const nonce = randomBytes(16).toString('hex')
  return {
    email: `vmate-${label}-${nonce}@example.invalid`,
    password: `V!${randomBytes(32).toString('base64url')}9a`,
  }
}

const requireString = (value, code) => {
  const normalized = String(value || '').trim()
  if (!normalized) fail(code)
  return normalized
}

const createAuthUser = async ({ adminClient, credentials, label }) => {
  const data = await unwrapSupabase(`CREATE_USER_${label}`, adminClient.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: { display_name: `Synthetic ${label}` },
  }))
  return requireString(data?.user?.id, `CREATE_USER_${label}_INVALID`)
}

const signIn = async ({ client, credentials, label }) => {
  const data = await unwrapSupabase(`SIGN_IN_${label}`, client.auth.signInWithPassword(credentials))
  return requireString(data?.session?.access_token, `SIGN_IN_${label}_INVALID`)
}

const prepareAndUploadCharacterVariants = async ({ apiRequest, userClient, accessToken, label }) => {
  const preparedResult = await apiRequest({
    operation: `PREPARE_UPLOAD_${label}`,
    path: '/api/uploads/prepare',
    method: 'POST',
    accessToken,
    body: {
      entityType: 'character',
      variants: CHARACTER_VARIANTS.map(({ kind, width, height }) => ({ kind, width, height })),
    },
  })
  const uploads = Array.isArray(preparedResult.payload?.uploads) ? preparedResult.payload.uploads : []
  if (uploads.length !== CHARACTER_VARIANTS.length) fail(`PREPARE_UPLOAD_${label}_INVALID`)

  const assets = []
  const storageObjects = []
  for (const variant of CHARACTER_VARIANTS) {
    const target = uploads.find((candidate) => candidate?.kind === variant.kind)
    const path = requireString(target?.path, `PREPARE_UPLOAD_${label}_INVALID`)
    const token = requireString(target?.token, `PREPARE_UPLOAD_${label}_INVALID`)
    const bucket = requireString(target?.bucket || preparedResult.payload?.bucket, `PREPARE_UPLOAD_${label}_INVALID`)
    const publicUrl = requireString(target?.publicUrl, `PREPARE_UPLOAD_${label}_INVALID`)
    const blob = new Blob([Buffer.from(variant.base64, 'base64')], { type: 'image/webp' })
    await unwrapSupabase(`SIGNED_UPLOAD_${label}`, userClient.storage
      .from(bucket)
      .uploadToSignedUrl(path, token, blob, { contentType: 'image/webp', upsert: false }))
    assets.push({ kind: variant.kind, url: publicUrl, width: variant.width, height: variant.height })
    storageObjects.push({ bucket, path })
  }
  return { assets, storageObjects }
}

const findAsset = (assets, variant) => {
  const asset = assets.find((candidate) => candidate.kind.endsWith(`:${variant}`))
  if (!asset) fail('ASSET_SET_INVALID')
  return asset
}

const createPrivateCharacter = async ({ apiRequest, accessToken, assets, runLabel }) => {
  const thumb = findAsset(assets, 'thumb')
  const card = findAsset(assets, 'card')
  const detail = findAsset(assets, 'detail')
  const result = await apiRequest({
    operation: 'CREATE_PRIVATE_CHARACTER_A',
    path: '/api/characters',
    method: 'POST',
    accessToken,
    expectedStatuses: [201],
    body: {
      name: `Synthetic private character ${runLabel}`,
      headline: 'Ephemeral staging validation character',
      summary: 'Created only for an approved staging synthetic smoke.',
      tags: ['synthetic-smoke'],
      visibility: 'private',
      sourceType: 'original',
      rightsConfirmed: false,
      creatorName: 'Synthetic A',
      coverImageUrl: detail.url,
      avatarImageUrl: card.url,
      profileJson: { purpose: 'staging-synthetic' },
      speechStyleJson: { voice: 'concise' },
      promptProfileJson: {
        imageSlots: [{
          id: 'smoke-main',
          thumbUrl: thumb.url,
          cardUrl: card.url,
          detailUrl: detail.url,
        }],
      },
      assets,
    },
  })
  return requireString(result.payload?.item?.slug, 'CREATE_PRIVATE_CHARACTER_A_INVALID')
}

const createPrivateWorld = async ({ apiRequest, accessToken, runLabel }) => {
  const result = await apiRequest({
    operation: 'CREATE_PRIVATE_WORLD_A',
    path: '/api/worlds',
    method: 'POST',
    accessToken,
    expectedStatuses: [201],
    body: {
      name: `Synthetic private world ${runLabel}`,
      headline: 'Ephemeral staging validation world',
      summary: 'Created only for an approved staging synthetic smoke.',
      tags: ['synthetic-smoke'],
      visibility: 'private',
      sourceType: 'original',
      rightsConfirmed: false,
      creatorName: 'Synthetic A',
      worldRulesMarkdown: 'Keep this ephemeral staging scenario isolated.',
      promptProfileJson: {},
    },
  })
  return requireString(result.payload?.item?.slug, 'CREATE_PRIVATE_WORLD_A_INVALID')
}

const verifyPrivateAccessMatrix = async ({ apiRequest, entityType, slug, ownerToken, nonOwnerToken }) => {
  const path = `/api/${entityType}/${encodeURIComponent(slug)}`
  const owner = await apiRequest({ operation: `OWNER_READ_${entityType}`, path, accessToken: ownerToken })
  const anonymous = await apiRequest({ operation: `ANONYMOUS_READ_${entityType}`, path, expectedStatuses: [404] })
  const nonOwner = await apiRequest({ operation: `NON_OWNER_READ_${entityType}`, path, accessToken: nonOwnerToken, expectedStatuses: [404] })
  return owner.status === 200 && anonymous.status === 404 && nonOwner.status === 404
}

const verifyCrossOwnerAssetRejection = async ({ apiRequest, accessToken, bAssets, runLabel }) => {
  const result = await apiRequest({
    operation: 'CROSS_OWNER_ASSET_REFERENCE',
    path: '/api/characters',
    method: 'POST',
    accessToken,
    expectedStatuses: [400],
    body: {
      name: `Synthetic forbidden reference ${runLabel}`,
      headline: 'Must be rejected',
      summary: 'Cross-owner asset isolation check.',
      tags: ['synthetic-smoke'],
      visibility: 'private',
      sourceType: 'original',
      rightsConfirmed: false,
      coverImageUrl: findAsset(bAssets, 'detail').url,
    },
  })
  return result.errorCode === 'INVALID_ASSET_REFERENCE'
}

const getQuota = async ({ apiRequest, accessToken }) => {
  const result = await apiRequest({ operation: 'GET_SHARED_QUOTA', path: '/api/me/chat-quota', accessToken })
  const quota = result.payload?.quota
  const limit = Number(quota?.limit)
  const remaining = Number(quota?.remaining)
  const resetAt = String(quota?.resetAt || '')
  if (!Number.isInteger(limit) || !Number.isInteger(remaining) || !resetAt) fail('SHARED_QUOTA_INVALID')
  return { limit, remaining, resetAt }
}

const objectExists = async ({ adminClient, storageObject }) => {
  const separator = storageObject.path.lastIndexOf('/')
  if (separator < 1) fail('STORAGE_OBJECT_PATH_INVALID')
  const prefix = storageObject.path.slice(0, separator)
  const name = storageObject.path.slice(separator + 1)
  const data = await unwrapSupabase('STORAGE_LIST', adminClient.storage
    .from(storageObject.bucket)
    .list(prefix, { limit: 100, search: name }))
  return Array.isArray(data) && data.some((candidate) => candidate?.name === name)
}

const allObjectsMatch = async ({ adminClient, storageObjects, expected }) => {
  for (const storageObject of storageObjects) {
    if (await objectExists({ adminClient, storageObject }) !== expected) return false
  }
  return true
}

const removeStorageObjects = async ({ adminClient, storageObjects }) => {
  const byBucket = new Map()
  for (const storageObject of storageObjects) {
    if (!byBucket.has(storageObject.bucket)) byBucket.set(storageObject.bucket, [])
    byBucket.get(storageObject.bucket).push(storageObject.path)
  }
  for (const [bucket, paths] of byBucket) {
    await unwrapSupabase('STORAGE_CLEANUP', adminClient.storage.from(bucket).remove(paths))
  }
  if (!(await allObjectsMatch({ adminClient, storageObjects, expected: false }))) fail('STORAGE_CLEANUP_INCOMPLETE')
}

const deleteUserIdempotently = async ({ adminClient, userId }) => {
  if (!userId) return
  let result
  try {
    result = await adminClient.auth.admin.deleteUser(userId, false)
  } catch {
    fail('AUTH_CLEANUP_UNAVAILABLE')
  }
  const status = Number(result?.error?.status || result?.error?.statusCode || 0)
  if (result?.error && status !== 404) fail('AUTH_CLEANUP_FAILED')
}

const writeEvidence = async (artifactPath, evidence) => {
  try {
    await mkdir(dirname(artifactPath), { recursive: true })
    await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    fail('EVIDENCE_WRITE_FAILED')
  }
}

export const runStagingSyntheticSmoke = async (config) => {
  const startedAt = new Date().toISOString()
  const scenarios = createScenarioState()
  const state = {
    adminClient: null,
    aUserId: '',
    bUserId: '',
    aStorageObjects: [],
    bStorageObjects: [],
    sensitiveValues: [
      config.baseUrl,
      config.projectRef,
      config.workerName,
      config.supabaseOrigin,
      config.anonKey,
      config.serviceRoleKey,
    ],
  }
  let failure = null

  try {
    const adminClient = createClient(config.supabaseOrigin, config.serviceRoleKey, clientOptions)
    const aClient = createClient(config.supabaseOrigin, config.anonKey, clientOptions)
    const bClient = createClient(config.supabaseOrigin, config.anonKey, clientOptions)
    state.adminClient = adminClient
    const apiRequest = createBaseApiRequester({
      baseUrl: config.baseUrl,
      workerName: config.workerName,
      versionId: config.versionId,
    })

    const aCredentials = createEphemeralCredentials('a')
    const bCredentials = createEphemeralCredentials('b')
    state.sensitiveValues.push(aCredentials.email, aCredentials.password, bCredentials.email, bCredentials.password)
    state.aUserId = await createAuthUser({ adminClient, credentials: aCredentials, label: 'A' })
    state.bUserId = await createAuthUser({ adminClient, credentials: bCredentials, label: 'B' })
    state.sensitiveValues.push(state.aUserId, state.bUserId)
    scenarios.ephemeralUsersCreated = true

    let aAccessToken = await signIn({ client: aClient, credentials: aCredentials, label: 'A' })
    const bAccessToken = await signIn({ client: bClient, credentials: bCredentials, label: 'B' })
    state.sensitiveValues.push(aAccessToken, bAccessToken)

    const aUpload = await prepareAndUploadCharacterVariants({ apiRequest, userClient: aClient, accessToken: aAccessToken, label: 'A' })
    state.aStorageObjects = aUpload.storageObjects
    state.sensitiveValues.push(...aUpload.storageObjects.flatMap((item) => [item.path]), ...aUpload.assets.map((item) => item.url))
    scenarios.aCharacterVariantsUploaded = true

    const bUpload = await prepareAndUploadCharacterVariants({ apiRequest, userClient: bClient, accessToken: bAccessToken, label: 'B' })
    state.bStorageObjects = bUpload.storageObjects
    state.sensitiveValues.push(...bUpload.storageObjects.flatMap((item) => [item.path]), ...bUpload.assets.map((item) => item.url))
    scenarios.bCharacterVariantsUploaded = true

    const runLabel = randomBytes(6).toString('hex')
    const characterSlug = await createPrivateCharacter({ apiRequest, accessToken: aAccessToken, assets: aUpload.assets, runLabel })
    scenarios.aPrivateCharacterCreated = true
    const worldSlug = await createPrivateWorld({ apiRequest, accessToken: aAccessToken, runLabel })
    scenarios.aPrivateWorldCreated = true
    state.sensitiveValues.push(characterSlug, worldSlug)

    scenarios.privateCharacterAccessMatrixPassed = await verifyPrivateAccessMatrix({
      apiRequest,
      entityType: 'characters',
      slug: characterSlug,
      ownerToken: aAccessToken,
      nonOwnerToken: bAccessToken,
    })
    scenarios.privateWorldAccessMatrixPassed = await verifyPrivateAccessMatrix({
      apiRequest,
      entityType: 'worlds',
      slug: worldSlug,
      ownerToken: aAccessToken,
      nonOwnerToken: bAccessToken,
    })
    if (!scenarios.privateCharacterAccessMatrixPassed || !scenarios.privateWorldAccessMatrixPassed) fail('PRIVATE_ACCESS_MATRIX_FAILED')

    scenarios.crossOwnerAssetReferenceRejected = await verifyCrossOwnerAssetRejection({
      apiRequest,
      accessToken: aAccessToken,
      bAssets: bUpload.assets,
      runLabel,
    })
    if (!scenarios.crossOwnerAssetReferenceRejected) fail('CROSS_OWNER_ASSET_REFERENCE_ACCEPTED')

    const quotaBefore = await getQuota({ apiRequest, accessToken: aAccessToken })
    const requestSuffix = randomBytes(10).toString('base64url')
    await apiRequest({
      operation: 'LEGACY_CHAT',
      path: '/api/chat',
      method: 'POST',
      accessToken: aAccessToken,
      body: {
        characterId: 'mika',
        userMessage: 'Synthetic staging quota validation.',
        messageHistory: [],
        clientRequestId: `legacy_${requestSuffix}`,
      },
    })
    scenarios.legacyChatCompleted = true

    const roomResult = await apiRequest({
      operation: 'CREATE_ROOM',
      path: '/api/rooms',
      method: 'POST',
      accessToken: aAccessToken,
      expectedStatuses: [201],
      body: { characterSlug, worldSlug, userAlias: 'Synthetic' },
    })
    const roomId = requireString(roomResult.payload?.room?.id, 'CREATE_ROOM_INVALID')
    state.sensitiveValues.push(roomId)
    await apiRequest({
      operation: 'ROOM_CHAT',
      path: `/api/rooms/${encodeURIComponent(roomId)}/chat`,
      method: 'POST',
      accessToken: aAccessToken,
      body: { userMessage: 'Synthetic staging room quota validation.', clientRequestId: `room_${requestSuffix}` },
    })
    scenarios.roomChatCompleted = true

    const quotaAfter = await getQuota({ apiRequest, accessToken: aAccessToken })
    scenarios.sharedQuotaIncrementedByTwo = quotaAfter.limit === quotaBefore.limit
      && quotaAfter.resetAt === quotaBefore.resetAt
      && quotaAfter.remaining === quotaBefore.remaining - 2
    if (!scenarios.sharedQuotaIncrementedByTwo) fail('SHARED_QUOTA_DELTA_INVALID')

    const recoveryRedirect = new URL('/auth/recovery', config.baseUrl).toString()
    const recovery = await unwrapSupabase('GENERATE_RECOVERY_LINK', adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: aCredentials.email,
      options: { redirectTo: recoveryRedirect },
    }))
    const actionLink = requireString(recovery?.properties?.action_link, 'RECOVERY_LINK_INVALID')
    const hashedToken = requireString(recovery?.properties?.hashed_token, 'RECOVERY_LINK_INVALID')
    const actionUrl = new URL(actionLink)
    if (actionUrl.origin !== config.supabaseOrigin || actionUrl.searchParams.get('redirect_to') !== recoveryRedirect) {
      fail('RECOVERY_REDIRECT_INVALID')
    }
    state.sensitiveValues.push(actionLink, hashedToken)
    scenarios.recoveryLinkGenerated = true

    const recoveryClient = createClient(config.supabaseOrigin, config.anonKey, clientOptions)
    const recoverySession = await unwrapSupabase('VERIFY_RECOVERY', recoveryClient.auth.verifyOtp({
      type: 'recovery',
      token_hash: hashedToken,
    }))
    const recoveryAccessToken = requireString(recoverySession?.session?.access_token, 'RECOVERY_SESSION_INVALID')
    state.sensitiveValues.push(recoveryAccessToken)
    scenarios.recoverySessionEstablished = true

    const nextPassword = `V!${randomBytes(32).toString('base64url')}8b`
    state.sensitiveValues.push(nextPassword)
    const passwordUpdate = await unwrapSupabase('UPDATE_PASSWORD', recoveryClient.auth.updateUser({ password: nextPassword }))
    if (!passwordUpdate?.user) fail('UPDATE_PASSWORD_INVALID')
    scenarios.recoveryCredentialUpdated = true

    const reloginClient = createClient(config.supabaseOrigin, config.anonKey, clientOptions)
    aAccessToken = await signIn({ client: reloginClient, credentials: { email: aCredentials.email, password: nextPassword }, label: 'A_RECOVERY' })
    state.sensitiveValues.push(aAccessToken)
    scenarios.recoveryReloginSucceeded = true

    const accountDelete = await apiRequest({
      operation: 'DELETE_ACCOUNT_A',
      path: '/api/account',
      method: 'DELETE',
      accessToken: aAccessToken,
    })
    scenarios.accountADeletedByApi = accountDelete.payload?.ok === true && accountDelete.payload?.deleted === true
    if (!scenarios.accountADeletedByApi) fail('ACCOUNT_DELETE_A_INVALID')

    scenarios.accountAAssetsAbsent = await allObjectsMatch({ adminClient, storageObjects: state.aStorageObjects, expected: false })
    scenarios.accountBAssetsRetained = await allObjectsMatch({ adminClient, storageObjects: state.bStorageObjects, expected: true })
    if (!scenarios.accountAAssetsAbsent || !scenarios.accountBAssetsRetained) fail('ACCOUNT_ASSET_ISOLATION_FAILED')
  } catch (error) {
    failure = error
  } finally {
    const adminClient = state.adminClient
    scenarios.cleanupACompleted = await runIdempotentCleanup({
      removeStorage: adminClient && state.aStorageObjects.length > 0
        ? () => removeStorageObjects({ adminClient, storageObjects: state.aStorageObjects })
        : undefined,
      deleteUser: adminClient && state.aUserId
        ? () => deleteUserIdempotently({ adminClient, userId: state.aUserId })
        : undefined,
    })
    scenarios.cleanupBCompleted = await runIdempotentCleanup({
      removeStorage: adminClient && state.bStorageObjects.length > 0
        ? () => removeStorageObjects({ adminClient, storageObjects: state.bStorageObjects })
        : undefined,
      deleteUser: adminClient && state.bUserId
        ? () => deleteUserIdempotently({ adminClient, userId: state.bUserId })
        : undefined,
    })
    if (!failure && (!scenarios.cleanupACompleted || !scenarios.cleanupBCompleted)) {
      failure = new SyntheticSmokeError('SYNTHETIC_CLEANUP_INCOMPLETE')
    }

    const evidence = buildSafeSyntheticEvidence({
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      projectRef: config.projectRef,
      workerName: config.workerName,
      versionId: config.versionId,
      scenarios,
    })
    assertEvidenceOmitsSensitiveValues(evidence, state.sensitiveValues)
    await writeEvidence(config.outputPath, evidence)
  }

  if (failure) throw failure
}

export const main = async ({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) => {
  const config = resolveStagingSmokeConfig({ argv, env, cwd })
  if (config.help) {
    process.stdout.write(HELP_TEXT)
    return
  }
  if (config.checkConfig) {
    process.stdout.write('Synthetic staging smoke configuration passed. No network calls were made.\n')
    return
  }
  await runStagingSyntheticSmoke(config)
  process.stdout.write('Synthetic staging smoke passed.\n')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`Synthetic staging smoke failed (${toSafeSyntheticErrorCode(error)}).\n`)
    process.exitCode = 1
  })
}
