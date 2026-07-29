import assert from 'node:assert/strict'
import test from 'node:test'
import { collectWindowMetrics } from '../scripts/check-worker-observability.mjs'
import { evaluateObservability, extractCalculationValue } from './modules/release-observability.js'

const passingMetrics = {
  currentRequests: 200,
  current5xx: 1,
  currentFailedOutcomes: 0,
  currentNonChatRequests: 160,
  currentNonChatP95Ms: 42,
  currentChatRequests: 40,
  currentChat5xx: 0,
  currentChatP95Ms: 8500,
  baselineRequests: 2400,
  baseline5xx: 12,
  baselineNonChatRequests: 2000,
  baselineNonChatP95Ms: 40,
  baselineChatRequests: 400,
  baselineChat5xx: 2,
  baselineChatP95Ms: 8000,
  cronSuccesses: 4,
  cronFailures: 0,
}

const collectWithTelemetryValues = async (values) => {
  const originalFetch = globalThis.fetch
  const queries = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    const alias = body.parameters.calculations[0].alias
    if (!values.has(alias)) throw new Error(`Unexpected telemetry alias: ${alias}`)
    queries.push(body)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { calculations: [{ alias, aggregates: [{ value: values.get(alias) }] }] },
      }),
    }
  }
  try {
    const metrics = await collectWindowMetrics({
      accountId: 'account-id',
      token: 'token',
      workerName: 'v-mate',
      versionId: 'version-id',
      from: 1,
      to: 2,
      prefix: 'current',
    })
    return { metrics, queries }
  } finally {
    globalThis.fetch = originalFetch
  }
}

const matchesUrlFilter = (filter, url) => {
  if (filter.kind === 'group') {
    const matches = filter.filters.map((entry) => matchesUrlFilter(entry, url))
    return String(filter.filterCombination).toLowerCase() === 'or'
      ? matches.some(Boolean)
      : matches.every(Boolean)
  }
  if (filter.operation === 'includes') return url.includes(filter.value)
  if (filter.operation === 'not_includes') return !url.includes(filter.value)
  throw new Error(`Unsupported URL filter operation in test: ${filter.operation}`)
}

const queryMatchesUrl = (query, url) => query.parameters.filters
  .filter((filter) => filter.key === '$metadata.url' || filter.kind === 'group')
  .every((filter) => matchesUrlFilter(filter, url))

test('observability calculation extraction uses the requested aggregate alias', () => {
  assert.equal(extractCalculationValue({ result: { calculations: [{ alias: 'requests', aggregates: [{ value: 12 }] }] } }, 'requests'), 12)
  assert.throws(() => extractCalculationValue({ result: { calculations: [] } }, 'requests'))
})

test('observability collector separates chat latency and errors from non-chat traffic', async () => {
  const { metrics, queries } = await collectWithTelemetryValues(new Map([
    ['currentRequests', 200],
    ['current5xx', 1],
    ['currentFailedOutcomes', 0],
    ['currentNonChatRequests', 160],
    ['currentChatRequests', 40],
    ['currentChat5xx', 1],
    ['currentNonChatP95Ms', 42],
    ['currentChatP95Ms', 8500],
  ]))

  assert.deepEqual(metrics, {
    requests: 200,
    errors5xx: 1,
    failedOutcomes: 0,
    nonChatRequests: 160,
    nonChatP95Ms: 42,
    chatRequests: 40,
    chat5xx: 1,
    chatP95Ms: 8500,
  })
  const chatP95Query = queries.find((body) => body.parameters.calculations[0].alias === 'currentChatP95Ms')
  const nonChatP95Query = queries.find((body) => body.parameters.calculations[0].alias === 'currentNonChatP95Ms')
  assert.ok(chatP95Query.parameters.filters.some((filter) => filter.operation === 'includes' && filter.value === '/api/rooms/'))
  assert.ok(chatP95Query.parameters.filters.some((filter) => filter.operation === 'includes' && filter.value === '/chat'))
  assert.ok(chatP95Query.parameters.filters.some((filter) => filter.operation === 'not_includes' && filter.value === '/chat-quota'))
  const nonChatGroup = nonChatP95Query.parameters.filters.find((filter) => filter.kind === 'group')
  assert.equal(nonChatGroup.filterCombination, 'or')
  assert.deepEqual(
    nonChatGroup.filters.map(({ operation, value }) => [operation, value]),
    [
      ['not_includes', '/api/rooms/'],
      ['not_includes', '/chat'],
      ['includes', '/chat-quota'],
    ],
  )
})

test('observability URL buckets cover quota, room GET, malformed, and near-match routes exactly once', async () => {
  const { queries } = await collectWithTelemetryValues(new Map([
    ['currentRequests', 8],
    ['current5xx', 0],
    ['currentFailedOutcomes', 0],
    ['currentNonChatRequests', 6],
    ['currentChatRequests', 2],
    ['currentChat5xx', 0],
    ['currentNonChatP95Ms', 20],
    ['currentChatP95Ms', 8000],
  ]))
  const chatQuery = queries.find((body) => body.parameters.calculations[0].alias === 'currentChatRequests')
  const nonChatQuery = queries.find((body) => body.parameters.calculations[0].alias === 'currentNonChatRequests')
  const cases = [
    ['https://v-mate.example/api/rooms/room-1/chat', true],
    ['https://v-mate.example/api/rooms/room-1/chat?retry=1', true],
    ['https://v-mate.example/api/me/chat-quota', false],
    ['https://v-mate.example/api/rooms/room-1', false],
    ['https://v-mate.example/api/chat', false],
    ['https://v-mate.example/api//rooms/room-1/chat', false],
    ['https://v-mate.example/api/rooms/room-1/chat-quota', false],
    ['https://v-mate.example/api/rooms/room-1/not-chat', false],
  ]

  for (const [url, expectedChat] of cases) {
    assert.equal(queryMatchesUrl(chatQuery, url), expectedChat, `chat bucket: ${url}`)
    assert.equal(queryMatchesUrl(nonChatQuery, url), !expectedChat, `non-chat complement: ${url}`)
  }
})

test('observability collector does not request percentiles for empty traffic categories', async () => {
  const { metrics, queries } = await collectWithTelemetryValues(new Map([
    ['currentRequests', 0],
    ['current5xx', 0],
    ['currentFailedOutcomes', 0],
    ['currentNonChatRequests', 0],
    ['currentChatRequests', 0],
    ['currentChat5xx', 0],
  ]))

  assert.equal(metrics.nonChatP95Ms, 0)
  assert.equal(metrics.chatP95Ms, 0)
  assert.equal(queries.some((body) => body.parameters.calculations[0].alias.endsWith('P95Ms')), false)
})

test('observability gate enforces the low-sample 5xx and cron rules', () => {
  assert.equal(evaluateObservability(passingMetrics).passed, true)
  const result = evaluateObservability({ ...passingMetrics, currentRequests: 99, current5xx: 1, cronSuccesses: 1 })
  assert.equal(result.passed, false)
  assert.ok(result.violations.some((value) => value.includes('fewer than 100')))
  assert.ok(result.violations.some((value) => value.includes('scheduled invocations')))
})

test('observability gate enforces absolute, baseline, and uncaught failure rules', () => {
  const result = evaluateObservability({
    ...passingMetrics,
    currentRequests: 1000,
    current5xx: 11,
    currentFailedOutcomes: 1,
    cronFailures: 1,
  })
  assert.equal(result.passed, false)
  assert.ok(result.violations.some((value) => value.includes('exceeded 1%')))
  assert.ok(result.violations.some((value) => value.includes('baseline')))
  assert.ok(result.violations.some((value) => value.includes('uncaught')))
  assert.ok(result.violations.some((value) => value.includes('scheduled invocation failure')))
})

test('observability gate fails closed on extreme non-chat p95 regression', () => {
  const result = evaluateObservability({
    ...passingMetrics,
    currentNonChatP95Ms: 999999,
    baselineNonChatP95Ms: 40,
  })

  assert.equal(result.passed, false)
  assert.ok(result.violations.some((value) => value.includes('non-chat p95')))
  assert.ok(result.violations.some((value) => value.includes('2000 ms SLO')))
  assert.ok(result.violations.some((value) => value.includes('baseline')))
})

test('observability gate treats chat latency and errors as separate release signals', () => {
  const result = evaluateObservability({
    ...passingMetrics,
    current5xx: 1,
    currentChatRequests: 40,
    currentChat5xx: 1,
    currentChatP95Ms: 19000,
    baselineChatP95Ms: 8000,
  })

  assert.equal(result.passed, false)
  assert.ok(result.violations.some((value) => value.includes('low-sample chat window')))
  assert.ok(result.violations.some((value) => value.includes('chat p95')))
})

test('observability gate skips latency checks for missing and insufficient category samples', () => {
  const nonChatOnly = evaluateObservability({
    ...passingMetrics,
    currentNonChatRequests: 200,
    currentChatRequests: 0,
    currentChat5xx: 0,
    currentChatP95Ms: 0,
    baselineNonChatRequests: 2400,
    baselineChatRequests: 0,
    baselineChat5xx: 0,
    baselineChatP95Ms: 0,
  })
  const chatOnly = evaluateObservability({
    ...passingMetrics,
    currentNonChatRequests: 0,
    currentNonChatP95Ms: 0,
    currentChatRequests: 200,
    currentChat5xx: 1,
    baselineNonChatRequests: 0,
    baselineNonChatP95Ms: 0,
    baselineChatRequests: 2400,
    baselineChat5xx: 12,
  })
  const insufficientNonChat = evaluateObservability({
    ...passingMetrics,
    currentNonChatRequests: 19,
    currentNonChatP95Ms: 999999,
  })

  assert.equal(nonChatOnly.passed, true)
  assert.equal(nonChatOnly.currentChat5xxRate, null)
  assert.equal(chatOnly.passed, true)
  assert.equal(insufficientNonChat.passed, true)
})

test('observability gate keeps the no-current-data failure contract', () => {
  const result = evaluateObservability({
    ...passingMetrics,
    currentRequests: 0,
    current5xx: 0,
    currentNonChatRequests: 0,
    currentNonChatP95Ms: 0,
    currentChatRequests: 0,
    currentChat5xx: 0,
    currentChatP95Ms: 0,
  })

  assert.equal(result.passed, false)
  assert.ok(result.violations.some((value) => value.includes('No fetch invocation sample')))
})
