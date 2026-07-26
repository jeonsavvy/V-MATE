import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluateObservability, extractCalculationValue } from '../server/modules/release-observability.js'

const API_ORIGIN = 'https://api.cloudflare.com/client/v4'
const HOUR_MS = 60 * 60 * 1000

const requiredTelemetryKeys = new Map([
  ['$metadata.statusCode', 'number'],
  ['$metadata.url', 'string'],
  ['$workers.eventType', 'string'],
  ['$workers.outcome', 'string'],
  ['$workers.scriptName', 'string'],
  ['$workers.scriptVersion.id', 'string'],
  ['$workers.wallTimeMs', 'number'],
])

const leaf = (key, type, operation, value) => ({
  kind: 'filter',
  key,
  type,
  operation,
  ...(value === undefined ? {} : { value }),
})

const invocationFilters = ({ workerName, versionId, eventType = 'fetch' }) => [
  leaf('$workers.scriptName', 'string', 'eq', workerName),
  leaf('$workers.scriptVersion.id', 'string', 'eq', versionId),
  leaf('$workers.eventType', 'string', 'eq', eventType),
  leaf('$workers.wallTimeMs', 'number', 'exists'),
]

const parseArguments = (argv) => {
  if (argv.includes('--help')) return { help: true }
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error('Invalid observability arguments')
    values.set(name, value)
  }
  const required = ['--account-id', '--worker-name', '--version-id', '--baseline-version-id', '--window-start', '--window-end', '--output']
  for (const name of required) {
    if (!values.get(name)) throw new Error(`${name} is required`)
  }
  return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]))
}

const assertCanonicalArguments = (options) => {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(options['account-id'])) throw new Error('--account-id is not canonical')
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(options['worker-name'])) throw new Error('--worker-name is not canonical')
  for (const name of ['version-id', 'baseline-version-id']) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(options[name])) throw new Error(`--${name} is not canonical`)
  }
  const startMs = Date.parse(options['window-start'])
  const endMs = Date.parse(options['window-end'])
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs < HOUR_MS || endMs - startMs > 2 * HOUR_MS) {
    throw new Error('The post-cutover observation window must be between 60 and 120 minutes')
  }
  return { startMs, endMs }
}

const cloudflareRequest = async ({ accountId, token, resource, body }) => {
  const response = await fetch(`${API_ORIGIN}/accounts/${accountId}/workers/observability/telemetry/${resource}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare observability ${resource} request failed with status ${response.status}`)
  return payload
}

const verifyKeys = async ({ accountId, token, from, to }) => {
  for (const [key, expectedType] of requiredTelemetryKeys) {
    const payload = await cloudflareRequest({
      accountId,
      token,
      resource: 'keys',
      body: {
        from,
        to,
        limit: 100,
        keyNeedle: { value: key, isRegex: false, matchCase: true },
      },
    })
    const match = Array.isArray(payload.result) ? payload.result.find((entry) => entry?.key === key) : null
    if (match?.type !== expectedType) throw new Error(`Required telemetry key is unavailable: ${key}`)
  }
}

const queryCalculation = async ({ accountId, token, from, to, alias, calculation, filters }) => {
  const payload = await cloudflareRequest({
    accountId,
    token,
    resource: 'query',
    body: {
      queryId: `vmate-release-${alias}`,
      timeframe: { from, to },
      chart: false,
      chartType: 'aggregate',
      dry: true,
      ignoreSeries: true,
      limit: 1,
      view: 'calculations',
      parameters: {
        datasets: [],
        filterCombination: 'and',
        filters,
        calculations: [{ ...calculation, alias }],
        limit: 1,
      },
    },
  })
  return extractCalculationValue(payload, alias)
}

const collectWindowMetrics = async ({ accountId, token, workerName, versionId, from, to, prefix }) => {
  const baseFilters = invocationFilters({ workerName, versionId })
  const countCalculation = { operator: 'count' }
  const [requests, errors5xx, failedOutcomes, nonChatP95Ms] = await Promise.all([
    queryCalculation({ accountId, token, from, to, alias: `${prefix}Requests`, calculation: countCalculation, filters: baseFilters }),
    queryCalculation({ accountId, token, from, to, alias: `${prefix}5xx`, calculation: countCalculation, filters: [...baseFilters, leaf('$metadata.statusCode', 'number', 'gte', 500)] }),
    queryCalculation({ accountId, token, from, to, alias: `${prefix}FailedOutcomes`, calculation: countCalculation, filters: [...baseFilters, leaf('$workers.outcome', 'string', 'neq', 'ok')] }),
    queryCalculation({
      accountId,
      token,
      from,
      to,
      alias: `${prefix}NonChatP95Ms`,
      calculation: { operator: 'p95', key: '$workers.wallTimeMs', keyType: 'number' },
      filters: [...baseFilters, leaf('$metadata.url', 'string', 'not_includes', '/chat')],
    }),
  ])
  return { requests, errors5xx, failedOutcomes, nonChatP95Ms }
}

const collectCronMetrics = async ({ accountId, token, workerName, versionId, from, to }) => {
  const cronEventTypes = {
    kind: 'group',
    filterCombination: 'or',
    filters: [
      leaf('$workers.eventType', 'string', 'eq', 'scheduled'),
      leaf('$workers.eventType', 'string', 'eq', 'cron'),
    ],
  }
  const baseFilters = [
    leaf('$workers.scriptName', 'string', 'eq', workerName),
    leaf('$workers.scriptVersion.id', 'string', 'eq', versionId),
    leaf('$workers.wallTimeMs', 'number', 'exists'),
    cronEventTypes,
  ]
  return Promise.all([
    queryCalculation({ accountId, token, from, to, alias: 'cronSuccesses', calculation: { operator: 'count' }, filters: [...baseFilters, leaf('$workers.outcome', 'string', 'eq', 'ok')] }),
    queryCalculation({ accountId, token, from, to, alias: 'cronFailures', calculation: { operator: 'count' }, filters: [...baseFilters, leaf('$workers.outcome', 'string', 'neq', 'ok')] }),
  ])
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('Usage: node scripts/check-worker-observability.mjs --account-id <id> --worker-name <name> --version-id <id> --baseline-version-id <id> --window-start <ISO> --window-end <ISO> --output <file>\n')
    return
  }
  const token = String(process.env.CLOUDFLARE_OBSERVABILITY_TOKEN || '')
  if (!token) throw new Error('CLOUDFLARE_OBSERVABILITY_TOKEN is required')
  const { startMs, endMs } = assertCanonicalArguments(options)
  const accountId = options['account-id']
  const workerName = options['worker-name']
  const baselineFrom = startMs - 24 * HOUR_MS
  await verifyKeys({ accountId, token, from: baselineFrom, to: endMs })

  const [current, baseline, [cronSuccesses, cronFailures]] = await Promise.all([
    collectWindowMetrics({ accountId, token, workerName, versionId: options['version-id'], from: startMs, to: endMs, prefix: 'current' }),
    collectWindowMetrics({ accountId, token, workerName, versionId: options['baseline-version-id'], from: baselineFrom, to: startMs, prefix: 'baseline' }),
    collectCronMetrics({ accountId, token, workerName, versionId: options['version-id'], from: startMs, to: endMs }),
  ])
  const metrics = {
    currentRequests: current.requests,
    current5xx: current.errors5xx,
    currentFailedOutcomes: current.failedOutcomes,
    currentNonChatP95Ms: current.nonChatP95Ms,
    baselineRequests: baseline.requests,
    baseline5xx: baseline.errors5xx,
    baselineNonChatP95Ms: baseline.nonChatP95Ms,
    cronSuccesses,
    cronFailures,
  }
  const evaluation = evaluateObservability(metrics)
  const report = {
    schemaVersion: 1,
    workerName,
    versionId: options['version-id'],
    baselineVersionId: options['baseline-version-id'],
    window: { from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString(), minutes: (endMs - startMs) / 60_000 },
    baselineWindow: { from: new Date(baselineFrom).toISOString(), to: new Date(startMs).toISOString(), hours: 24 },
    metrics,
    ...evaluation,
  }
  const outputFile = path.resolve(options.output)
  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`)
  if (!evaluation.passed) throw new Error(`Worker observability gate failed with ${evaluation.violations.length} violation(s)`)
  process.stdout.write('Worker observability gate passed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
