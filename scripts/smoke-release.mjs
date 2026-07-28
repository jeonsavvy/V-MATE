import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const argumentsByName = new Map()
if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node scripts/smoke-release.mjs --base-url <https-url> [--worker-name <name> --version-id <id>] [--dist-manifest <file>] [--expect-chat-status <status>] [--allow-localhost true]\n')
  process.exit(0)
}
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  if (!name?.startsWith('--') || value === undefined) {
    throw new Error('Usage: node scripts/smoke-release.mjs --base-url <https-url> [--worker-name <name> --version-id <id>] [--dist-manifest <file>] [--expect-chat-status <status>] [--allow-localhost true]')
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

const timeoutFetch = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { ...overrideHeaders, ...options.headers },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}`)
  return response
}

const manifestFile = argumentsByName.get('--dist-manifest')
const manifest = manifestFile ? JSON.parse(await readFile(manifestFile, 'utf8')) : null
if (manifest && (manifest.version !== 1 || !Array.isArray(manifest.files))) {
  throw new Error('Invalid dist manifest')
}
const manifestPaths = manifest
  ? new Set(manifest.files.map((asset) => asset.path))
  : null
const runtimeAssetPaths = (html) => [
  ...html.matchAll(/(?:src|href)=["'](?:\/?)(assets\/[^"']+\.(?:js|css))(?:\?[^"']*)?["']/gi),
].map((match) => match[1])

const appUrl = new URL(baseUrl)
appUrl.pathname = '/'
const homepageAttempts = workerName && manifestPaths ? 10 : 1
let html = ''
for (let attempt = 1; attempt <= homepageAttempts; attempt += 1) {
  const homepage = await timeoutFetch(appUrl, { headers: { Accept: 'text/html' } })
  html = await homepage.text()
  if (!html.includes('window.__V_MATE_RUNTIME_ENV__')) {
    throw new Error('Homepage did not include the runtime environment marker')
  }
  assertNoInternalDetails(html, 'Homepage')

  const unexpectedAssetPath = manifestPaths
    ? runtimeAssetPaths(html).find((assetPath) => !manifestPaths.has(assetPath))
    : undefined
  if (!unexpectedAssetPath) break
  if (attempt === homepageAttempts) {
    throw new Error(`Homepage references an asset absent from the manifest: ${unexpectedAssetPath}`)
  }
  // Cloudflare documents a short propagation window before a newly added
  // zero-traffic version starts honoring version-override requests globally.
  await new Promise((resolve) => setTimeout(resolve, 2_000))
}

const recoveryUrl = new URL('/auth/recovery', baseUrl)
const recoveryPage = await timeoutFetch(recoveryUrl, { headers: { Accept: 'text/html' } })
const recoveryHtml = await recoveryPage.text()
if (!recoveryHtml.includes('window.__V_MATE_RUNTIME_ENV__')) {
  throw new Error('Recovery route did not include the runtime environment marker')
}
assertNoInternalDetails(recoveryHtml, 'Recovery route')

const expectedChatStatus = Number(argumentsByName.get('--expect-chat-status') || '401')
const chatUrl = new URL('/api/chat', baseUrl)
const chatResponse = await fetch(chatUrl, {
  method: 'POST',
  headers: { ...overrideHeaders, Origin: baseUrl.origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ characterId: 'smoke', userMessage: 'smoke', messageHistory: [] }),
  signal: AbortSignal.timeout(20_000),
})
if (chatResponse.status !== expectedChatStatus) {
  throw new Error(`Chat auth smoke expected ${expectedChatStatus}, received ${chatResponse.status}`)
}
const chatBody = await chatResponse.text()
assertNoInternalDetails(chatBody, 'Chat response')
if (expectedChatStatus === 401) {
  const payload = JSON.parse(chatBody)
  if (payload.error_code !== 'AUTH_REQUIRED') throw new Error('Chat auth smoke returned an unexpected error code')
}

if (manifest) {
  for (const asset of manifest.files) {
    const assetUrl = new URL(asset.path, baseUrl)
    const response = await timeoutFetch(assetUrl)
    const content = Buffer.from(await response.arrayBuffer())
    const actualHash = createHash('sha256').update(content).digest('hex')
    if (actualHash !== asset.sha256) throw new Error(`Asset hash mismatch: ${asset.path}`)
  }
}

process.stdout.write(`Release smoke passed for ${baseUrl.origin}\n`)
