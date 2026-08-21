import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'

import {
  buildDatabaseContractEvidence,
  buildDisposableConfig,
  createDisposableProjectId,
  getDisposablePortTargets,
  reserveAvailablePorts,
  resetLocalSchemasSql,
} from '../scripts/run-db-tests.mjs'

test('DB contract evidence preserves canonical fresh and upgrade application fingerprints', () => {
  const freshFingerprint = 'a'.repeat(32)
  const upgradeFingerprint = 'c'.repeat(32)
  assert.deepEqual(buildDatabaseContractEvidence({
    commit: 'b'.repeat(40),
    freshApplicationStateFingerprint: freshFingerprint,
    upgradeApplicationStateFingerprint: upgradeFingerprint,
  }), {
    schemaVersion: 1,
    commit: 'b'.repeat(40),
    freshApplicationStateFingerprint: freshFingerprint,
    upgradeApplicationStateFingerprint: upgradeFingerprint,
    allPassed: true,
  })

  assert.throws(() => buildDatabaseContractEvidence({
    commit: 'b'.repeat(40),
    freshApplicationStateFingerprint: 'not-a-fingerprint',
    upgradeApplicationStateFingerprint: upgradeFingerprint,
  }), /freshApplicationStateFingerprint must be a canonical fingerprint/)
  assert.throws(() => buildDatabaseContractEvidence({
    commit: 'not-a-commit',
    freshApplicationStateFingerprint: freshFingerprint,
    upgradeApplicationStateFingerprint: upgradeFingerprint,
  }), /commit must be a canonical SHA/)
})

const listenErrorCode = (host, port) => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.unref()
  server.once('error', (error) => resolve(error.code))
  server.listen({ host, port, exclusive: true }, () => {
    server.close(() => reject(new Error(`Port ${host}:${port} was not reserved`)))
  })
})

const listenAndClose = (host, port) => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.unref()
  server.once('error', reject)
  server.listen({ host, port, exclusive: true }, () => server.close(resolve))
})

test('DB harness rewrites every local Supabase port without changing unrelated SMTP config', () => {
  const sourceConfig = `project_id = "shared-local"

[api]
port = 54321

[db]
port = 54322
shadow_port = 54320

[db.pooler]
enabled = true
port = 54329

[studio]
port = 54323

[inbucket]
port = 54324
smtp_port = 54325
pop3_port = 54326

[edge_runtime]
inspector_port = 8083

[analytics] # local-only service
enabled = true
port = 54327
vector_port = 54328

[auth.email.smtp]
port = 587
`
  const ports = {
    api: 41001,
    db: 41002,
    shadow: 41003,
    studio: 41004,
    pooler: 41005,
    edgeInspector: 41006,
    analytics: 41007,
    analyticsVector: 41008,
    inbucket: 41009,
    inbucket_smtp_port: 41010,
    inbucket_pop3_port: 41011,
  }

  const disposableConfig = buildDisposableConfig(sourceConfig, 'vmate-contract-7-abcdef123456', ports)

  assert.match(disposableConfig, /^project_id = "vmate-contract-7-abcdef123456"$/m)
  for (const port of Object.values(ports)) assert.match(disposableConfig, new RegExp(`^\\w+_?\\w*\\s*=\\s*${port}$`, 'm'))
  assert.equal(disposableConfig.match(/^\[analytics\]/gm)?.length, 1)
  assert.match(disposableConfig, /\[auth\.email\.smtp\]\nport = 587/)
  assert.doesNotMatch(disposableConfig, /^port = 5432[0-9]$/m)
  assert.match(sourceConfig, /^project_id = "shared-local"$/m)
})

test('DB harness adds unique defaults for implicit local services and supports local_smtp', () => {
  const sourceConfig = `project_id = "shared-local"

[api]
port = 54321

[db]
port = 54322
shadow_port = 54320

[studio]
port = 54323

[local_smtp]
port = 54324
`
  const targets = getDisposablePortTargets(sourceConfig)
  const ports = Object.fromEntries(targets.map(({ name }, index) => [name, 42001 + index]))
  const disposableConfig = buildDisposableConfig(sourceConfig, 'vmate-contract-8-fedcba654321', ports)

  assert.equal(new Set(Object.values(ports)).size, targets.length)
  assert.match(disposableConfig, /\[local_smtp\][\s\S]*?port = 42009/)
  assert.doesNotMatch(disposableConfig, /\[inbucket\]/)
  assert.match(disposableConfig, /\[db\.pooler\]\nport = 42005/)
  assert.match(disposableConfig, /\[edge_runtime\]\ninspector_port = 42006/)
  assert.match(disposableConfig, /\[analytics\]\nport = 42007\n\nvector_port = 42008/)
})

test('DB harness holds unique ports until the disposable stack is ready to start', async () => {
  const reservation = await reserveAvailablePorts(['api', 'db', 'shadow'])
  const ports = Object.values(reservation.ports)
  try {
    assert.equal(new Set(ports).size, ports.length)
    assert.equal(await listenErrorCode('127.0.0.1', ports[0]), 'EADDRINUSE')
    assert.equal(await listenErrorCode('0.0.0.0', ports[0]), 'EADDRINUSE')
  } finally {
    await reservation.release()
  }

  await listenAndClose('127.0.0.1', ports[0])
  await reservation.release()
})

test('DB harness project IDs remain unique beyond process ID reuse', () => {
  const first = createDisposableProjectId(77, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  const second = createDisposableProjectId(77, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  assert.equal(first, 'vmate-contract-77-aaaaaaaaaaaa')
  assert.equal(second, 'vmate-contract-77-bbbbbbbbbbbb')
  assert.notEqual(first, second)
})

test('DB harness resets both application schemas between fresh and upgrade contracts', () => {
  assert.match(resetLocalSchemasSql, /drop schema if exists vmate_private cascade;/)
  assert.match(resetLocalSchemasSql, /drop schema if exists public cascade;/)
  assert.doesNotMatch(resetLocalSchemasSql, /create schema vmate_private;/)
})
