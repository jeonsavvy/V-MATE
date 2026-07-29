import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const argumentsByName = new Map()
if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node scripts/smoke-release.mjs --base-url <https-url> [--worker-name <name> --version-id <id>] [--dist-manifest <file>] [--expect-chat-status <status>] [--allow-localhost true] [--propagation-timeout-ms <milliseconds>]\n')
  process.exit(0)
}
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  if (!name?.startsWith('--') || value === undefined) {
    throw new Error('Usage: node scripts/smoke-release.mjs --base-url <https-url> [--worker-name <name> --version-id <id>] [--dist-manifest <file>] [--expect-chat-status <status>] [--allow-localhost true] [--propagation-timeout-ms <milliseconds>]')
  }
  argumentsByName.set(name, value)
}

const baseUrlValue = argumentsByName.get('--base-url')
if (!baseUrlValue) throw new Error('--base-url is required')
const baseUrl = new URL(baseUrlValue)
const allowLocalhost = argumentsByName.get('--allow-localhost') === 'true'
const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
if (baseUrl.protocol !== 'https:' && !(allowLocalhost && baseUrl.protocol === 'http:' && localHosts.has(baseUrl.hostname))) {
  throw new Error('Release smoke checks require an HTTPS URL; localhost requires --allow-localhost true')
}
if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
  throw new Error('--base-url must be an origin without credentials, query, or fragment')
}
const propagationTimeoutValue = argumentsByName.get('--propagation-timeout-ms')
if (propagationTimeoutValue && !allowLocalhost) {
  throw new Error('--propagation-timeout-ms is limited to localhost test runs')
}
if (propagationTimeoutValue && !/^[1-9][0-9]{0,4}$/.test(propagationTimeoutValue)) {
  throw new Error('--propagation-timeout-ms must be an integer from 1 to 99999')
}
const propagationTimeoutMs = Number(propagationTimeoutValue || '120000')

const workerName = argumentsByName.get('--worker-name')
const versionId = argumentsByName.get('--version-id')
if (Boolean(workerName) !== Boolean(versionId)) {
  throw new Error('--worker-name and --version-id must be supplied together')
}
if (workerName && !/^[A-Za-z0-9._-]+$/.test(workerName)) throw new Error('--worker-name has invalid characters')
if (versionId && !/^[A-Za-z0-9_-]+$/.test(versionId)) throw new Error('--version-id has invalid characters')
const overrideHeaders = workerName
  ? { 'Cloudflare-Workers-Version-Overrides': `${workerName}="${versionId}"` }
  : {}

const forbiddenDetails = [
  'google_api_key',
  'supabase_service_role_key',
  'supabase_anon_key',
  'stack trace',
  'gemini',
]
const assertNoInternalDetails = (value, label) => {
  const normalized = String(value).toLowerCase()
  const match = forbiddenDetails.find((fragment) => normalized.includes(fragment))
  if (match) throw new Error(`${label} exposed a forbidden internal detail`)
}

const fetchWithTimeout = async (url, options = {}, timeoutMs = 20_000) => fetch(url, {
  ...options,
  headers: { ...overrideHeaders, ...options.headers },
  signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
})

const timeoutFetch = async (url, options = {}) => {
  const response = await fetchWithTimeout(url, options)
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}`)
  return response
}

class ResponseSizeLimitError extends Error {}

const readBoundedUtf8Text = async (response, maximumBytes, label) => {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8')
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {})
        throw new ResponseSizeLimitError(`${label} exceeded the response size limit`)
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

const maximumHtmlBytes = 1024 * 1024
const maximumChatBodyBytes = 64 * 1024

const manifestFile = argumentsByName.get('--dist-manifest')
const manifest = manifestFile ? JSON.parse(await readFile(manifestFile, 'utf8')) : null
if (manifest && (manifest.version !== 1 || !Array.isArray(manifest.files))) {
  throw new Error('Invalid dist manifest')
}
if (manifest) {
  const seenPaths = new Set()
  const maximumAssetBytes = 10 * 1024 * 1024
  const maximumManifestBytes = 50 * 1024 * 1024
  let manifestBytes = 0
  for (const asset of manifest.files) {
    const safePath = typeof asset?.path === 'string'
      && /^[A-Za-z0-9._/-]+$/.test(asset.path)
      && !asset.path.startsWith('/')
      && !asset.path.includes('..')
      && !asset.path.includes('//')
    const valid = safePath
      && !seenPaths.has(asset.path)
      && Number.isSafeInteger(asset.bytes)
      && asset.bytes >= 0
      && asset.bytes <= maximumAssetBytes
      && /^[a-f0-9]{64}$/.test(String(asset.sha256 || ''))
    if (!valid) throw new Error('Invalid dist manifest asset entry')
    seenPaths.add(asset.path)
    manifestBytes += asset.bytes
    if (!Number.isSafeInteger(manifestBytes) || manifestBytes > maximumManifestBytes) {
      throw new Error('Dist manifest exceeds the total release asset limit')
    }
  }
}
const manifestPaths = manifest
  ? new Set(manifest.files.map((asset) => asset.path))
  : null
const runtimeAssetPaths = (html) => [
  ...html.matchAll(/(?:src|href)=["'](?:\/?)(assets\/[^"']+\.(?:js|css))(?:\?[^"']*)?["']/gi),
].map((match) => match[1])

const appUrl = new URL(baseUrl)
appUrl.pathname = '/'
const propagationMode = Boolean(workerName && manifestPaths)
if (propagationMode && !manifestPaths.has('release-version.txt')) {
  throw new Error('Version-override smoke requires the release identity asset')
}
const propagationDeadline = propagationMode ? performance.now() + propagationTimeoutMs : null
const remainingPropagationMs = () => propagationDeadline === null ? 0 : propagationDeadline - performance.now()
const waitForPropagation = async () => {
  const remaining = remainingPropagationMs()
  if (remaining <= 0) return false
  await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, remaining)))
  return true
}
const propagationFetchTimeout = () => {
  const remaining = remainingPropagationMs()
  if (remaining <= 0) throw new Error('Candidate propagation deadline elapsed')
  return Math.min(20_000, remaining)
}
let html = ''
let homepageFailure = 'request failed'
while (true) {
  try {
    const homepage = propagationMode
      ? await fetchWithTimeout(appUrl, { headers: { Accept: 'text/html' } }, propagationFetchTimeout())
      : await timeoutFetch(appUrl, { headers: { Accept: 'text/html' } })
    if (!homepage.ok) {
      homepageFailure = `HTTP ${homepage.status}`
    } else {
      html = await readBoundedUtf8Text(homepage, maximumHtmlBytes, 'Homepage')
      assertNoInternalDetails(html, 'Homepage')
      if (!html.includes('window.__V_MATE_RUNTIME_ENV__')) {
        homepageFailure = 'runtime marker missing'
      } else {
        const unexpectedAssetPath = manifestPaths
          ? runtimeAssetPaths(html).find((assetPath) => !manifestPaths.has(assetPath))
          : undefined
        if (!unexpectedAssetPath) break
        homepageFailure = 'manifest asset reference mismatch'
      }
    }
  } catch (error) {
    if (error instanceof ResponseSizeLimitError
      || String(error?.message || '').includes('exposed a forbidden internal detail')) throw error
    homepageFailure = 'request failed'
  }
  if (!propagationMode) {
    throw new Error(`Homepage verification failed: ${homepageFailure}`)
  }
  if (!await waitForPropagation()) {
    throw new Error(`Homepage verification failed after propagation deadline: ${homepageFailure}`)
  }
}

const digestBoundedAsset = async (response, expectedBytes) => {
  const declaredLength = response.headers.get('content-length')
  if (/^[0-9]+$/.test(String(declaredLength || '')) && BigInt(declaredLength) > BigInt(expectedBytes)) {
    await response.body?.cancel()
    return { bytes: expectedBytes + 1, sha256: null }
  }
  const hash = createHash('sha256')
  let bytes = 0
  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > expectedBytes) {
          await reader.cancel()
          return { bytes: expectedBytes + 1, sha256: null }
        }
        hash.update(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  return { bytes, sha256: hash.digest('hex') }
}

if (manifest) {
  const assets = [...manifest.files].sort((left, right) =>
    Number(right.path === 'release-version.txt') - Number(left.path === 'release-version.txt'))
  for (const asset of assets) {
    const assetUrl = new URL(asset.path, baseUrl)
    let assetFailure = null
    while (true) {
      try {
        const response = propagationMode
          ? await fetchWithTimeout(assetUrl, { headers: { 'Cache-Control': 'no-cache' } }, propagationFetchTimeout())
          : await fetchWithTimeout(assetUrl, { headers: { 'Cache-Control': 'no-cache' } })
        const digest = await digestBoundedAsset(response, asset.bytes)
        if (response.ok && digest.bytes === asset.bytes && digest.sha256 === asset.sha256) break
        assetFailure = {
          status: response.status,
          contentType: response.headers.get('content-type')?.split(';', 1)[0] || 'unknown',
          bytes: digest.bytes,
        }
      } catch {
        assetFailure ||= { status: 'request-failed', contentType: 'unknown', bytes: 0 }
      }
      const detail = `path=${asset.path} status=${assetFailure.status} contentType=${assetFailure.contentType} bytes=${assetFailure.bytes}`
      if (!propagationMode) throw new Error(`Asset verification failed: ${detail}`)
      if (!await waitForPropagation()) {
        throw new Error(`Asset verification failed after propagation deadline: ${detail}`)
      }
    }
  }
}

const recoveryUrl = new URL('/auth/recovery', baseUrl)
const recoveryPage = propagationMode
  ? await fetchWithTimeout(recoveryUrl, { headers: { Accept: 'text/html' } }, propagationFetchTimeout())
  : await timeoutFetch(recoveryUrl, { headers: { Accept: 'text/html' } })
if (!recoveryPage.ok) throw new Error(`GET ${recoveryUrl} returned ${recoveryPage.status}`)
const recoveryHtml = await readBoundedUtf8Text(recoveryPage, maximumHtmlBytes, 'Recovery route')
if (!recoveryHtml.includes('window.__V_MATE_RUNTIME_ENV__')) {
  throw new Error('Recovery route did not include the runtime environment marker')
}
assertNoInternalDetails(recoveryHtml, 'Recovery route')

const expectedChatStatus = Number(argumentsByName.get('--expect-chat-status') || '401')
const chatUrl = new URL('/api/chat', baseUrl)
const chatResponse = await fetchWithTimeout(chatUrl, {
  method: 'POST',
  headers: { Origin: baseUrl.origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ characterId: 'smoke', userMessage: 'smoke', messageHistory: [] }),
}, propagationMode ? propagationFetchTimeout() : 20_000)
if (chatResponse.status !== expectedChatStatus) {
  throw new Error(`Chat auth smoke expected ${expectedChatStatus}, received ${chatResponse.status}`)
}
const chatBody = await readBoundedUtf8Text(chatResponse, maximumChatBodyBytes, 'Chat response')
assertNoInternalDetails(chatBody, 'Chat response')
if (expectedChatStatus === 401) {
  const payload = JSON.parse(chatBody)
  if (payload.error_code !== 'AUTH_REQUIRED') throw new Error('Chat auth smoke returned an unexpected error code')
}

process.stdout.write(`Release smoke passed for ${baseUrl.origin}\n`)
