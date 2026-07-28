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

test('release smoke retries while a zero-traffic version override propagates', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'v-mate-release-smoke-'))
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

  let homepageRequests = 0
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
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error_code: 'AUTH_REQUIRED' }))
      return
    }
    if (request.url === '/assets/candidate.js') {
      response.end(candidateAsset)
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
  assert.match(result.stdout, /Release smoke passed/)
})
