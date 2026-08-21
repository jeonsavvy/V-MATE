import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const scriptFile = fileURLToPath(import.meta.url)
const scriptDirectory = path.dirname(scriptFile)
const repositoryRoot = path.dirname(scriptDirectory)
const schemaFile = path.join(repositoryRoot, 'supabase', 'schema.sql')
const migrationDirectory = path.join(repositoryRoot, 'supabase', 'migrations')
const testDirectory = path.join(repositoryRoot, 'supabase', 'tests')
const baselineFixture = path.join(testDirectory, 'fixtures', 'pre_b2c_schema.sql')
const releaseStateQuery = path.join(scriptDirectory, 'capture-release-state.sql')
const applicationReleaseStateQuery = path.join(scriptDirectory, 'capture-application-release-state.sql')
const migrationStateQuery = path.join(scriptDirectory, 'capture-migration-state.sql')
const databaseContractEvidencePath = 'artifacts/database-contract-evidence.json'

const corePortTargets = [
  { name: 'api', section: 'api', key: 'port' },
  { name: 'db', section: 'db', key: 'port' },
  { name: 'shadow', section: 'db', key: 'shadow_port' },
  { name: 'studio', section: 'studio', key: 'port' },
  { name: 'pooler', section: 'db.pooler', key: 'port' },
  { name: 'edgeInspector', section: 'edge_runtime', key: 'inspector_port' },
  { name: 'analytics', section: 'analytics', key: 'port' },
  { name: 'analyticsVector', section: 'analytics', key: 'vector_port' },
]

const escapeRegularExpression = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const tomlSectionPattern = (section) => new RegExp(`^\\s*\\[${escapeRegularExpression(section)}\\]\\s*(?:#.*)?$`)
const nextTomlSectionPattern = /^\s*\[[^\]]+\]/

const findTomlSection = (lines, section) => lines.findIndex((line) => tomlSectionPattern(section).test(line))

const hasTomlSection = (config, section) => findTomlSection(config.replace(/\r\n/g, '\n').split('\n'), section) !== -1

const hasTomlValue = (config, section, key) => {
  const lines = config.replace(/\r\n/g, '\n').split('\n')
  const sectionStart = findTomlSection(lines, section)
  if (sectionStart === -1) return false
  const sectionEndOffset = lines.slice(sectionStart + 1).findIndex((line) => nextTomlSectionPattern.test(line))
  const sectionEnd = sectionEndOffset === -1 ? lines.length : sectionStart + 1 + sectionEndOffset
  const valuePattern = new RegExp(`^\\s*${escapeRegularExpression(key)}\\s*=`)
  return lines.slice(sectionStart + 1, sectionEnd).some((line) => valuePattern.test(line))
}

const setTomlValue = (config, section, key, value) => {
  const lines = config.replace(/\r\n/g, '\n').split('\n')
  const sectionHeader = `[${section}]`
  const sectionStart = findTomlSection(lines, section)

  if (sectionStart === -1) {
    while (lines.at(-1) === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(sectionHeader, `${key} = ${value}`, '')
    return lines.join('\n')
  }

  const sectionEndOffset = lines.slice(sectionStart + 1).findIndex((line) => nextTomlSectionPattern.test(line))
  const sectionEnd = sectionEndOffset === -1 ? lines.length : sectionStart + 1 + sectionEndOffset
  const valuePattern = new RegExp(`^(\\s*)${escapeRegularExpression(key)}\\s*=.*$`)
  const valueIndex = lines.slice(sectionStart + 1, sectionEnd).findIndex((line) => valuePattern.test(line))

  if (valueIndex === -1) {
    lines.splice(sectionEnd, 0, `${key} = ${value}`)
  } else {
    const absoluteIndex = sectionStart + 1 + valueIndex
    const indentation = lines[absoluteIndex].match(valuePattern)?.[1] || ''
    lines[absoluteIndex] = `${indentation}${key} = ${value}`
  }
  return lines.join('\n')
}

const setRootTomlValue = (config, key, value) => {
  const lines = config.replace(/\r\n/g, '\n').split('\n')
  const firstSection = lines.findIndex((line) => nextTomlSectionPattern.test(line))
  const rootEnd = firstSection === -1 ? lines.length : firstSection
  const valuePattern = new RegExp(`^(\\s*)${escapeRegularExpression(key)}\\s*=.*$`)
  const valueIndex = lines.slice(0, rootEnd).findIndex((line) => valuePattern.test(line))
  if (valueIndex === -1) lines.splice(rootEnd, 0, `${key} = ${value}`)
  else lines[valueIndex] = `${lines[valueIndex].match(valuePattern)?.[1] || ''}${key} = ${value}`
  return lines.join('\n')
}

export const getDisposablePortTargets = (config) => {
  const mailSection = hasTomlSection(config, 'local_smtp') ? 'local_smtp' : 'inbucket'
  const targets = [...corePortTargets, { name: 'inbucket', section: mailSection, key: 'port' }]
  for (const key of ['smtp_port', 'pop3_port']) {
    if (hasTomlValue(config, mailSection, key)) {
      targets.push({ name: `inbucket_${key}`, section: mailSection, key })
    }
  }
  return targets
}

export const buildDisposableConfig = (sourceConfig, projectId, ports) => {
  let config = setRootTomlValue(sourceConfig, 'project_id', JSON.stringify(projectId))
  for (const target of getDisposablePortTargets(sourceConfig)) {
    const port = ports[target.name]
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Missing valid disposable port for ${target.name}`)
    }
    config = setTomlValue(config, target.section, target.key, port)
  }
  return `${config.replace(/\n+$/, '')}\n`
}

const closeServer = (server) => new Promise((resolve) => server.close(() => resolve()))

const listen = (options) => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.unref()
  server.once('error', reject)
  server.listen({ ...options, exclusive: true }, () => {
    server.removeListener('error', reject)
    resolve(server)
  })
})

const reserveAvailablePort = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const servers = []
    try {
      const firstHost = process.platform === 'win32' ? '127.0.0.1' : '0.0.0.0'
      const firstServer = await listen({ host: firstHost, port: 0 })
      servers.push(firstServer)
      const port = firstServer.address().port
      if (process.platform === 'win32') servers.push(await listen({ host: '0.0.0.0', port }))
      try {
        if (process.platform === 'win32') servers.push(await listen({ host: '::1', port, ipv6Only: true }))
        servers.push(await listen({ host: '::', port, ipv6Only: true }))
      } catch (error) {
        if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) throw error
      }
      return { port, servers }
    } catch (error) {
      await Promise.all(servers.map(closeServer))
      if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error
    }
  }
  throw new Error('Could not reserve an available local port for the DB harness')
}

export const reserveAvailablePorts = async (names) => {
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new Error('Disposable port names must be non-empty and unique')
  }
  const reservations = []
  let released = false
  try {
    for (const name of names) reservations.push({ name, ...await reserveAvailablePort() })
  } catch (error) {
    await Promise.all(reservations.flatMap(({ servers }) => servers).map(closeServer))
    throw error
  }
  return {
    ports: Object.fromEntries(reservations.map(({ name, port }) => [name, port])),
    release: async () => {
      if (released) return
      released = true
      await Promise.all(reservations.flatMap(({ servers }) => servers).map(closeServer))
    },
  }
}

export const createDisposableProjectId = (pid = process.pid, uniqueId = randomUUID()) => {
  const suffix = uniqueId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  if (!suffix) throw new Error('Could not create a unique disposable Supabase project ID')
  return `vmate-contract-${pid}-${suffix}`
}

export const buildDatabaseContractEvidence = ({
  commit,
  freshApplicationStateFingerprint,
  upgradeApplicationStateFingerprint,
}) => {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Database contract evidence commit must be a canonical SHA')
  }
  for (const [name, value] of Object.entries({
    freshApplicationStateFingerprint,
    upgradeApplicationStateFingerprint,
  })) {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) {
      throw new Error(`${name} must be a canonical fingerprint`)
    }
  }
  return {
    schemaVersion: 1,
    commit,
    freshApplicationStateFingerprint,
    upgradeApplicationStateFingerprint,
    allPassed: true,
  }
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
  return fingerprints[0]
}

// The final schema and lockdown migration create vmate_private themselves, so reset must leave it absent.
export const resetLocalSchemasSql = `
  drop schema if exists vmate_private cascade;
  drop schema if exists public cascade;
  create schema public;
  grant all on schema public to postgres;
  grant all on schema public to public;
`

const resetLocalSchemas = (containerId) => runSql(containerId, resetLocalSchemasSql, 'Reset local application schemas')

const runPgTap = (workDirectory, { includeUpgradeContracts = false } = {}) => {
  const paths = [path.join(workDirectory, 'supabase', 'tests', 'database')]
  if (includeUpgradeContracts) paths.push(path.join(workDirectory, 'supabase', 'tests', 'upgrade'))
  supabaseCommand(['test', 'db', '--local', '--workdir', workDirectory, ...paths])
}

const runFresh = async (containerId, workDirectory) => {
  process.stdout.write('\n=== Fresh schema contract test ===\n')
  resetLocalSchemas(containerId)
  runSql(containerId, await readFile(schemaFile, 'utf8'), 'Apply final schema.sql')
  await assertStateFingerprint(containerId, releaseStateQuery, 'Capture local release-state fingerprint')
  const applicationStateFingerprint = await assertStateFingerprint(
    containerId,
    applicationReleaseStateQuery,
    'Capture local application release-state fingerprint',
  )
  runPgTap(workDirectory)
  return applicationStateFingerprint
}

const runUpgrade = async (containerId, workDirectory) => {
  process.stdout.write('\n=== Upgrade schema contract test ===\n')
  resetLocalSchemas(containerId)
  runSql(containerId, await readFile(baselineFixture, 'utf8'), 'Apply pre-B2C schema fixture')
  await cp(migrationDirectory, path.join(workDirectory, 'supabase', 'migrations'), { recursive: true })
  supabaseCommand(['migration', 'up', '--local', '--workdir', workDirectory])
  await assertStateFingerprint(containerId, releaseStateQuery, 'Capture local release-state fingerprint')
  await assertStateFingerprint(containerId, migrationStateQuery, 'Capture local migration-row fingerprint')
  const applicationStateFingerprint = await assertStateFingerprint(
    containerId,
    applicationReleaseStateQuery,
    'Capture local application release-state fingerprint',
  )
  runPgTap(workDirectory, { includeUpgradeContracts: true })
  return applicationStateFingerprint
}

const prepareDisposableProject = async () => {
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'vmate-db-contracts-'))
  const projectId = createDisposableProjectId()
  let portReservation
  try {
    const sourceConfig = await readFile(path.join(repositoryRoot, 'supabase', 'config.toml'), 'utf8')
    const portTargets = getDisposablePortTargets(sourceConfig)
    portReservation = await reserveAvailablePorts(portTargets.map(({ name }) => name))
    const config = buildDisposableConfig(sourceConfig, projectId, portReservation.ports)
    await mkdir(path.join(workDirectory, 'supabase'), { recursive: true })
    await writeFile(path.join(workDirectory, 'supabase', 'config.toml'), config)
    await cp(testDirectory, path.join(workDirectory, 'supabase', 'tests'), { recursive: true })
    return { portReservation, projectId, workDirectory }
  } catch (error) {
    await portReservation?.release()
    await rm(workDirectory, { recursive: true, force: true })
    throw error
  }
}

const stopDisposableProject = (workDirectory, projectId) => {
  const result = spawnSync(process.execPath, [
    supabaseEntry, 'stop', '--project-id', projectId, '--workdir', workDirectory, '--no-backup',
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error) process.stderr.write(`Warning: failed to stop disposable local Supabase stack: ${result.error.message}\n`)
  else if (result.status !== 0) process.stderr.write(`Warning: failed to stop disposable local Supabase stack. Remove project ${projectId} with \`supabase stop --project-id ${projectId} --no-backup\`.\n`)
}

export const main = async (arguments_ = process.argv.slice(2)) => {
  if (arguments_.includes('--help')) {
    process.stdout.write('Usage: node scripts/run-db-tests.mjs [--fresh|--upgrade|--all]\n')
    return
  }
  const testMode = arguments_[0] || '--all'
  if (!['--fresh', '--upgrade', '--all'].includes(testMode)) {
    throw new Error('Usage: node scripts/run-db-tests.mjs [--fresh|--upgrade|--all]')
  }
  const configuredEvidencePath = process.env.DB_CONTRACT_EVIDENCE_PATH
  if (configuredEvidencePath && configuredEvidencePath.replace(/\\/g, '/') !== databaseContractEvidencePath) {
    throw new Error(`DB_CONTRACT_EVIDENCE_PATH must be ${databaseContractEvidencePath}`)
  }
  if (configuredEvidencePath && testMode !== '--all') {
    throw new Error('Database contract evidence requires both fresh and upgrade modes')
  }

  await assertCanonicalMigrationVersions()
  assertPrerequisites()
  const disposableProject = await prepareDisposableProject()
  const { portReservation, projectId, workDirectory } = disposableProject
  try {
    await portReservation.release()
    const containerId = startLocalSupabase(workDirectory, projectId)
    let freshApplicationStateFingerprint
    let upgradeApplicationStateFingerprint
    if (testMode === '--fresh' || testMode === '--all') {
      freshApplicationStateFingerprint = await runFresh(containerId, workDirectory)
    }
    if (testMode === '--upgrade' || testMode === '--all') {
      upgradeApplicationStateFingerprint = await runUpgrade(containerId, workDirectory)
    }
    if (configuredEvidencePath) {
      const evidence = buildDatabaseContractEvidence({
        commit: process.env.GITHUB_SHA,
        freshApplicationStateFingerprint,
        upgradeApplicationStateFingerprint,
      })
      const absoluteEvidencePath = path.join(repositoryRoot, databaseContractEvidencePath)
      await mkdir(path.dirname(absoluteEvidencePath), { recursive: true })
      await writeFile(absoluteEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
    }
    process.stdout.write('\nLocal DB contract tests passed.\n')
  } finally {
    await portReservation.release()
    stopDisposableProject(workDirectory, projectId)
    await rm(workDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptFile)) await main()
