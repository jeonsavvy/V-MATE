import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.dirname(scriptDirectory)
const schemaFile = path.join(repositoryRoot, 'supabase', 'schema.sql')
const migrationDirectory = path.join(repositoryRoot, 'supabase', 'migrations')
const testDirectory = path.join(repositoryRoot, 'supabase', 'tests')
const baselineFixture = path.join(testDirectory, 'fixtures', 'pre_b2c_schema.sql')
const releaseStateQuery = path.join(scriptDirectory, 'capture-release-state.sql')
const migrationStateQuery = path.join(scriptDirectory, 'capture-migration-state.sql')
if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node scripts/run-db-tests.mjs [--fresh|--upgrade|--all]\n')
  process.exit(0)
}
const testMode = process.argv[2] || '--all'

if (!['--fresh', '--upgrade', '--all'].includes(testMode)) {
  throw new Error('Usage: node scripts/run-db-tests.mjs [--fresh|--upgrade|--all]')
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
const assertLocalConnectionEnvironment = () => {
  for (const variableName of ['DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_URL']) {
    const value = process.env[variableName]
    if (!value) continue
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`${variableName} must be unset or point to localhost for DB contract tests`)
    }
    if (!localHosts.has(parsed.hostname)) {
      throw new Error(`${variableName} points outside localhost; refusing to run DB contract tests`)
    }
  }
  if (process.env.SUPABASE_PROJECT_REF) {
    throw new Error('SUPABASE_PROJECT_REF is set; refusing to run a linked database test')
  }
}

const command = (executable, commandArguments, options = {}) => {
  const captureOutput = options.capture || options.silent || options.input !== undefined
  const result = spawnSync(executable, commandArguments, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: captureOutput ? 'pipe' : 'inherit',
    input: options.input,
    env: { ...process.env, ...options.env },
  })
  if (captureOutput && !options.silent) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} ${commandArguments.join(' ')} failed with exit code ${result.status}`)
  return result
}

const supabaseEntry = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js')
const supabaseCommand = (commandArguments, options = {}) => command(process.execPath, [supabaseEntry, ...commandArguments], options)

const assertPrerequisites = () => {
  assertLocalConnectionEnvironment()
  command('docker', ['version', '--format', '{{.Server.Version}}'])
  supabaseCommand(['--version'])
}

const assertCanonicalMigrationVersions = async () => {
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql'))
  const versions = files.map((file) => {
    const match = file.match(/^([0-9]+)_[A-Za-z0-9_-]+\.sql$/)
    if (!match) throw new Error(`Noncanonical migration filename: ${file}`)
    return match[1]
  })
  if (new Set(versions).size !== versions.length) {
    throw new Error('Duplicate Supabase migration versions detected; refusing to start the DB harness')
  }
}

const assertConfiguredPortsAvailable = async () => {
  const config = await readFile(path.join(repositoryRoot, 'supabase', 'config.toml'), 'utf8')
  const ports = [...config.matchAll(/^port\s*=\s*(\d+)\s*$/gm)].map((match) => Number(match[1]))
  for (const port of new Set(ports)) {
    const available = await new Promise((resolve) => {
      const server = net.createServer()
      server.unref()
      server.once('error', () => resolve(false))
      server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolve(true)))
    })
    if (!available) {
      throw new Error(`Local port ${port} is already in use; stop the existing local stack before DB contract tests`)
    }
  }
}

const startLocalSupabase = (workDirectory, projectId) => {
  supabaseCommand(['start', '--workdir', workDirectory], { silent: true })
  const result = command('docker', ['ps', '--filter', `name=^/supabase_db_${projectId}$`, '--format', '{{.ID}}'], { capture: true, silent: true })
  const containerId = result.stdout.trim()
  if (!containerId) throw new Error('Could not find the disposable local Postgres container after supabase start')
  return containerId
}

const runSql = (containerId, sql, label) => {
  const result = spawnSync('docker', [
    'exec', '-i', containerId,
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: sql,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`)
  return result
}

const assertStateFingerprint = async (containerId, queryFile, label) => {
  const result = runSql(
    containerId,
    await readFile(queryFile, 'utf8'),
    label,
  )
  const fingerprints = result.stdout.match(/\b[a-f0-9]{32}\b/g) || []
  if (fingerprints.length !== 1) {
    throw new Error(`${label} did not return exactly one canonical fingerprint`)
  }
}

const resetPublicSchema = (containerId) => runSql(containerId, `
  drop schema if exists public cascade;
  create schema public;
  grant all on schema public to postgres;
  grant all on schema public to public;
`, 'Reset local public schema')

const runPgTap = (workDirectory, { includeUpgradeContracts = false } = {}) => {
  const paths = [path.join(workDirectory, 'supabase', 'tests', 'database')]
  if (includeUpgradeContracts) paths.push(path.join(workDirectory, 'supabase', 'tests', 'upgrade'))
  supabaseCommand(['test', 'db', '--local', '--workdir', workDirectory, ...paths])
}

const runFresh = async (containerId, workDirectory) => {
  process.stdout.write('\n=== Fresh schema contract test ===\n')
  resetPublicSchema(containerId)
  runSql(containerId, await readFile(schemaFile, 'utf8'), 'Apply final schema.sql')
  await assertStateFingerprint(containerId, releaseStateQuery, 'Capture local release-state fingerprint')
  runPgTap(workDirectory)
}

const runUpgrade = async (containerId, workDirectory) => {
  process.stdout.write('\n=== Upgrade schema contract test ===\n')
  resetPublicSchema(containerId)
  runSql(containerId, await readFile(baselineFixture, 'utf8'), 'Apply pre-B2C schema fixture')
  await cp(migrationDirectory, path.join(workDirectory, 'supabase', 'migrations'), { recursive: true })
  supabaseCommand(['migration', 'up', '--local', '--workdir', workDirectory])
  await assertStateFingerprint(containerId, releaseStateQuery, 'Capture local release-state fingerprint')
  await assertStateFingerprint(containerId, migrationStateQuery, 'Capture local migration-row fingerprint')
  runPgTap(workDirectory, { includeUpgradeContracts: true })
}

const prepareDisposableProject = async () => {
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'vmate-db-contracts-'))
  const projectId = `vmate-contract-${process.pid}`
  const config = (await readFile(path.join(repositoryRoot, 'supabase', 'config.toml'), 'utf8'))
    .replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`)
  await mkdir(path.join(workDirectory, 'supabase'), { recursive: true })
  await writeFile(path.join(workDirectory, 'supabase', 'config.toml'), config)
  await cp(testDirectory, path.join(workDirectory, 'supabase', 'tests'), { recursive: true })
  return { projectId, workDirectory }
}

const stopDisposableProject = (workDirectory) => {
  const result = spawnSync(process.execPath, [supabaseEntry, 'stop', '--workdir', workDirectory, '--no-backup'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error) process.stderr.write(`Warning: failed to stop disposable local Supabase stack: ${result.error.message}\n`)
  else if (result.status !== 0) process.stderr.write('Warning: failed to stop disposable local Supabase stack. Remove it with `supabase stop --no-backup`.\n')
}

await assertCanonicalMigrationVersions()
assertPrerequisites()
await assertConfiguredPortsAvailable()
const { projectId, workDirectory } = await prepareDisposableProject()
try {
  const containerId = startLocalSupabase(workDirectory, projectId)
  if (testMode === '--fresh' || testMode === '--all') await runFresh(containerId, workDirectory)
  if (testMode === '--upgrade' || testMode === '--all') await runUpgrade(containerId, workDirectory)
  process.stdout.write('\nLocal DB contract tests passed.\n')
} finally {
  stopDisposableProject(workDirectory)
  await rm(workDirectory, { recursive: true, force: true })
}
