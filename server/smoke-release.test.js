import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runNodeScript = (script, arguments_) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, ...arguments_], { cwd: repositoryRoot })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.once('error', reject)
  child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
})

test('dist manifest excludes Worker-transformed and deployment metadata files', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-dist-manifest-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))
  const distDirectory = path.join(temporaryDirectory, 'dist')
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await mkdir(path.join(distDirectory, 'assets'), { recursive: true })
  await Promise.all([
    writeFile(path.join(distDirectory, 'index.html'), '<html></html>'),
    writeFile(path.join(distDirectory, '_headers'), '/assets/*\n  Cache-Control: immutable\n'),
    writeFile(path.join(distDirectory, 'assets', 'candidate.js'), 'candidate asset'),
  ])

  const result = await runNodeScript(
    path.join(repositoryRoot, 'scripts', 'create-dist-manifest.mjs'),
    [distDirectory, manifestPath],
  )

  assert.equal(result.exitCode, 0, result.stderr)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.deepEqual(manifest.files.map((file) => file.path), ['assets/candidate.js'])
})

test('release smoke retries homepage and asset bytes while a zero-traffic version override propagates', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))

  const candidateAsset = Buffer.from('candidate asset')
  const releaseVersion = Buffer.from('release-commit\n')
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [
      {
        path: 'assets/candidate.js',
        bytes: candidateAsset.byteLength,
        sha256: createHash('sha256').update(candidateAsset).digest('hex'),
      },
      {
        path: 'release-version.txt',
        bytes: releaseVersion.byteLength,
        sha256: createHash('sha256').update(releaseVersion).digest('hex'),
      },
    ],
  }))

  let homepageRequests = 0
  let candidateAssetRequests = 0
  let releaseVersionRequests = 0
  const server = createServer((request, response) => {
    assert.equal(
      request.headers['cloudflare-workers-version-overrides'],
      'v-mate="candidate-version"',
    )

    if (request.url === '/') {
      homepageRequests += 1
      const asset = homepageRequests === 1 ? 'assets/stable.js' : 'assets/candidate.js'
      response.end(`<script>window.__V_MATE_RUNTIME_ENV__={}</script><script src="/${asset}"></script>`)
      return
    }
    if (request.url === '/auth/recovery') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>')
      return
    }
    if (request.url === '/api/chat') {
      assert.equal(releaseVersionRequests, 1)
      assert.equal(candidateAssetRequests, 2)
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error_code: 'AUTH_REQUIRED' }))
      return
    }
    if (request.url === '/assets/candidate.js') {
      candidateAssetRequests += 1
      response.setHeader('content-type', 'text/javascript')
      response.end(candidateAssetRequests === 1 ? 'stable fallback' : candidateAsset)
      return
    }
    if (request.url === '/release-version.txt') {
      releaseVersionRequests += 1
      response.setHeader('content-type', 'text/plain')
      response.end(releaseVersion)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--worker-name', 'v-mate',
    '--version-id', 'candidate-version',
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(homepageRequests, 2)
  assert.equal(candidateAssetRequests, 2)
  assert.equal(releaseVersionRequests, 1)
  assert.match(result.stdout, /Release smoke passed/)
})

test('release smoke fails closed after the bounded propagation deadline without logging asset bodies', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-deadline-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))

  const candidateAsset = Buffer.from('candidate asset')
  const releaseVersion = Buffer.from('release-commit\n')
  const leakedBody = 'private prompt payload must not appear in logs'
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [
      {
        path: 'assets/candidate.js',
        bytes: candidateAsset.byteLength,
        sha256: createHash('sha256').update(candidateAsset).digest('hex'),
      },
      {
        path: 'release-version.txt',
        bytes: releaseVersion.byteLength,
        sha256: createHash('sha256').update(releaseVersion).digest('hex'),
      },
    ],
  }))

  let candidateAssetRequests = 0
  const server = createServer((request, response) => {
    assert.equal(
      request.headers['cloudflare-workers-version-overrides'],
      'v-mate="candidate-version"',
    )

    if (request.url === '/') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script><script src="/assets/candidate.js"></script>')
      return
    }
    if (request.url === '/auth/recovery') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>')
      return
    }
    if (request.url === '/api/chat') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error_code: 'AUTH_REQUIRED' }))
      return
    }
    if (request.url === '/assets/candidate.js') {
      candidateAssetRequests += 1
      response.setHeader('content-type', 'text/html')
      response.end(leakedBody)
      return
    }
    if (request.url === '/release-version.txt') {
      response.setHeader('content-type', 'text/plain')
      response.end(releaseVersion)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--worker-name', 'v-mate',
    '--version-id', 'candidate-version',
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
    '--propagation-timeout-ms', '250',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.ok(candidateAssetRequests >= 1)
  assert.match(result.stderr, /Asset verification failed after propagation deadline/)
  assert.match(result.stderr, /path=assets\/candidate\.js status=200 contentType=text\/html bytes=/)
  assert.doesNotMatch(result.stderr, new RegExp(leakedBody))
})

test('release smoke does not retry manifest mismatches without a version override', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-no-override-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))

  const candidateAsset = Buffer.from('candidate asset')
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [{
      path: 'assets/candidate.js',
      bytes: candidateAsset.byteLength,
      sha256: createHash('sha256').update(candidateAsset).digest('hex'),
    }],
  }))

  let candidateAssetRequests = 0
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], undefined)
    if (request.url === '/') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script><script src="/assets/candidate.js"></script>')
      return
    }
    if (request.url === '/auth/recovery') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>')
      return
    }
    if (request.url === '/api/chat') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error_code: 'AUTH_REQUIRED' }))
      return
    }
    if (request.url === '/assets/candidate.js') {
      candidateAssetRequests += 1
      response.end('wrong asset')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.equal(candidateAssetRequests, 1)
  assert.match(result.stderr, /Asset verification failed:/)
  assert.doesNotMatch(result.stderr, /propagation deadline/)
})

test('live propagation polls only the release identity before one strict public-origin smoke', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-live-propagation-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))

  const candidateAsset = Buffer.from('candidate asset')
  const releaseVersion = Buffer.from('candidate-release\n')
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [
      { path: 'assets/candidate.js', bytes: candidateAsset.byteLength, sha256: createHash('sha256').update(candidateAsset).digest('hex') },
      { path: 'release-version.txt', bytes: releaseVersion.byteLength, sha256: createHash('sha256').update(releaseVersion).digest('hex') },
    ],
  }))

  let identityRequests = 0
  let homepageRequests = 0
  let assetRequests = 0
  let recoveryRequests = 0
  let chatRequests = 0
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], undefined)
    if (request.url === '/release-version.txt') {
      identityRequests += 1
      response.setHeader('content-type', 'text/plain')
      response.end(identityRequests === 1 ? 'stable-release\n' : releaseVersion)
      return
    }
    if (request.url === '/') {
      homepageRequests += 1
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script><script src="/assets/candidate.js"></script>')
      return
    }
    if (request.url === '/assets/candidate.js') {
      assetRequests += 1
      response.end(candidateAsset)
      return
    }
    if (request.url === '/auth/recovery') {
      recoveryRequests += 1
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>')
      return
    }
    if (request.url === '/api/chat') {
      chatRequests += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error_code: 'AUTH_REQUIRED' }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
    '--live-propagation', 'true',
    '--propagation-timeout-ms', '3000',
  ])

  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(identityRequests, 3)
  assert.equal(homepageRequests, 1)
  assert.equal(assetRequests, 1)
  assert.equal(recoveryRequests, 1)
  assert.equal(chatRequests, 1)
})

test('live propagation fails closed at the identity deadline without logging response bodies', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-live-propagation-deadline-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))

  const releaseVersion = Buffer.from('candidate-release\n')
  const leakedBody = 'private prompt payload must not appear in logs'
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [{ path: 'release-version.txt', bytes: releaseVersion.byteLength, sha256: createHash('sha256').update(releaseVersion).digest('hex') }],
  }))

  let identityRequests = 0
  let homepageRequests = 0
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], undefined)
    if (request.url === '/release-version.txt') {
      identityRequests += 1
      response.setHeader('content-type', 'text/plain')
      response.end(leakedBody)
      return
    }
    if (request.url === '/') homepageRequests += 1
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
    '--live-propagation', 'true',
    '--propagation-timeout-ms', '75',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.ok(identityRequests >= 1)
  assert.equal(homepageRequests, 0)
  assert.match(result.stderr, /Live release identity did not propagate before the deadline/)
  assert.doesNotMatch(result.stderr, new RegExp(leakedBody))
})

test('live propagation does not retry a strict smoke failure after identity convergence', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-live-propagation-strict-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))

  const releaseVersion = Buffer.from('candidate-release\n')
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [{ path: 'release-version.txt', bytes: releaseVersion.byteLength, sha256: createHash('sha256').update(releaseVersion).digest('hex') }],
  }))

  let identityRequests = 0
  let homepageRequests = 0
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], undefined)
    if (request.url === '/release-version.txt') {
      identityRequests += 1
      response.end(releaseVersion)
      return
    }
    if (request.url === '/') {
      homepageRequests += 1
      response.writeHead(503)
      response.end()
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
    '--live-propagation', 'true',
    '--propagation-timeout-ms', '3000',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.equal(identityRequests, 1)
  assert.equal(homepageRequests, 1)
  assert.match(result.stderr, /Homepage verification failed/)
  assert.doesNotMatch(result.stderr, /propagation deadline/)
})

test('live propagation rejects missing identity and version overrides before network access', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-live-propagation-invalid-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))
  const candidateManifestPath = path.join(temporaryDirectory, 'candidate-manifest.json')
  const identityManifestPath = path.join(temporaryDirectory, 'identity-manifest.json')
  await writeFile(candidateManifestPath, JSON.stringify({
    version: 1,
    files: [{ path: 'assets/candidate.js', bytes: 1, sha256: '0'.repeat(64) }],
  }))
  await writeFile(identityManifestPath, JSON.stringify({
    version: 1,
    files: [{ path: 'release-version.txt', bytes: 1, sha256: '0'.repeat(64) }],
  }))

  const missingIdentity = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', 'http://127.0.0.1:1',
    '--dist-manifest', candidateManifestPath,
    '--allow-localhost', 'true',
    '--live-propagation', 'true',
    '--propagation-timeout-ms', '100',
  ])
  const conflictingOverride = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', 'http://127.0.0.1:1',
    '--worker-name', 'v-mate',
    '--version-id', 'candidate-version',
    '--dist-manifest', identityManifestPath,
    '--allow-localhost', 'true',
    '--live-propagation', 'true',
    '--propagation-timeout-ms', '100',
  ])

  assert.notEqual(missingIdentity.exitCode, 0)
  assert.match(missingIdentity.stderr, /Live propagation smoke requires the release identity asset/)
  assert.doesNotMatch(missingIdentity.stderr, /ECONNREFUSED/)
  assert.notEqual(conflictingOverride.exitCode, 0)
  assert.match(conflictingOverride.stderr, /must verify the public origin without a version override/)
  assert.doesNotMatch(conflictingOverride.stderr, /ECONNREFUSED/)
})

test('release smoke rejects unsafe manifest entries before making a request', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-invalid-manifest-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [{ path: 'https://example.com/leak', bytes: 1, sha256: '0'.repeat(64) }],
  }))

  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', 'http://127.0.0.1:1',
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /Invalid dist manifest asset entry/)
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/)
})

test('version-override smoke requires the commit-specific release identity asset before making a request', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-missing-identity-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [{ path: 'assets/candidate.js', bytes: 1, sha256: '0'.repeat(64) }],
  }))

  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', 'http://127.0.0.1:1',
    '--worker-name', 'v-mate',
    '--version-id', 'candidate-version',
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /Version-override smoke requires the release identity asset/)
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/)
})

test('version-override smoke keeps recovery checks inside the global propagation deadline', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-global-deadline-'))
  context.after(async () => rm(temporaryDirectory, { recursive: true, force: true }))
  const candidateAsset = Buffer.from('candidate asset')
  const releaseVersion = Buffer.from('release-commit\n')
  const manifestPath = path.join(temporaryDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    files: [
      { path: 'assets/candidate.js', bytes: candidateAsset.byteLength, sha256: createHash('sha256').update(candidateAsset).digest('hex') },
      { path: 'release-version.txt', bytes: releaseVersion.byteLength, sha256: createHash('sha256').update(releaseVersion).digest('hex') },
    ],
  }))

  let chatRequests = 0
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], 'v-mate="candidate-version"')
    if (request.url === '/') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script><script src="/assets/candidate.js"></script>')
      return
    }
    if (request.url === '/release-version.txt') {
      response.end(releaseVersion)
      return
    }
    if (request.url === '/assets/candidate.js') {
      response.end(candidateAsset)
      return
    }
    if (request.url === '/auth/recovery') {
      setTimeout(() => response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>'), 250)
      return
    }
    if (request.url === '/api/chat') {
      chatRequests += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error_code: 'AUTH_REQUIRED' }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const startedAt = performance.now()
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--worker-name', 'v-mate',
    '--version-id', 'candidate-version',
    '--dist-manifest', manifestPath,
    '--allow-localhost', 'true',
    '--propagation-timeout-ms', '75',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.ok(performance.now() - startedAt < 1_000)
  assert.equal(chatRequests, 0)
  assert.doesNotMatch(result.stdout, /Release smoke passed/)
})

test('release smoke cancels an oversized chunked homepage response', async (context) => {
  let recoveryRequests = 0
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], undefined)
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.write(Buffer.alloc(768 * 1024, 'a'))
      response.end(Buffer.alloc(768 * 1024, 'b'))
      return
    }
    if (request.url === '/auth/recovery') recoveryRequests += 1
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--allow-localhost', 'true',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.equal(recoveryRequests, 0)
  assert.match(result.stderr, /Homepage exceeded the response size limit/)
  assert.doesNotMatch(result.stdout, /Release smoke passed/)
})

test('release smoke cancels an oversized chunked chat response without logging its body', async (context) => {
  const leakedBody = 'private prompt payload must not appear in logs'
  const server = createServer((request, response) => {
    assert.equal(request.headers['cloudflare-workers-version-overrides'], undefined)
    if (request.url === '/') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>')
      return
    }
    if (request.url === '/auth/recovery') {
      response.end('<script>window.__V_MATE_RUNTIME_ENV__={}</script>')
      return
    }
    if (request.url === '/api/chat') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.write(`{"error_code":"AUTH_REQUIRED","padding":"${leakedBody}`)
      response.write(Buffer.alloc(48 * 1024, 'a'))
      response.end(Buffer.alloc(48 * 1024, 'b'))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await runNodeScript(path.join(repositoryRoot, 'scripts', 'smoke-release.mjs'), [
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--allow-localhost', 'true',
  ])

  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /Chat response exceeded the response size limit/)
  assert.doesNotMatch(result.stderr, new RegExp(leakedBody))
  assert.doesNotMatch(result.stdout, new RegExp(leakedBody))
  assert.doesNotMatch(result.stdout, /Release smoke passed/)
})
