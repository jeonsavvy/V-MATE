import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateObservability, extractCalculationValue } from './modules/release-observability.js'

const passingMetrics = {
  currentRequests: 200,
  current5xx: 1,
  currentFailedOutcomes: 0,
  currentNonChatP95Ms: 42,
  baselineRequests: 2400,
  baseline5xx: 12,
  baselineNonChatP95Ms: 40,
  cronSuccesses: 4,
  cronFailures: 0,
}

test('observability calculation extraction uses the requested aggregate alias', () => {
  assert.equal(extractCalculationValue({ result: { calculations: [{ alias: 'requests', aggregates: [{ value: 12 }] }] } }, 'requests'), 12)
  assert.throws(() => extractCalculationValue({ result: { calculations: [] } }, 'requests'))
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
