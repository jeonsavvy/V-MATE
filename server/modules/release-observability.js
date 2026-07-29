export const extractCalculationValue = (payload, alias) => {
  const calculations = payload?.result?.calculations
  if (!Array.isArray(calculations)) throw new Error('Observability response did not contain calculations')
  const calculation = calculations.find((entry) => entry?.alias === alias)
  const value = calculation?.aggregates?.[0]?.value
  if (!Number.isFinite(value) || value < 0) throw new Error(`Observability response did not contain ${alias}`)
  return Number(value)
}

export const OBSERVABILITY_THRESHOLDS = Object.freeze({
  minimumErrorSampleRequests: 100,
  maximum5xxRate: 0.01,
  maximum5xxBaselineDelta: 0.005,
  minimumLatencySampleRequests: 20,
  maximumNonChatP95Ms: 2000,
  maximumChatP95Ms: 20000,
  maximumP95BaselineRatio: 1.5,
})

const p95RegressionRatio = (currentRequests, currentP95Ms, baselineRequests, baselineP95Ms) => {
  if (
    currentRequests < OBSERVABILITY_THRESHOLDS.minimumLatencySampleRequests
    || baselineRequests < OBSERVABILITY_THRESHOLDS.minimumLatencySampleRequests
    || baselineP95Ms === 0
  ) return null
  return currentP95Ms / baselineP95Ms
}

export const evaluateObservability = (metrics) => {
  const numericKeys = [
    'currentRequests', 'current5xx', 'currentFailedOutcomes',
    'currentNonChatRequests', 'currentNonChatP95Ms',
    'currentChatRequests', 'currentChat5xx', 'currentChatP95Ms',
    'baselineRequests', 'baseline5xx',
    'baselineNonChatRequests', 'baselineNonChatP95Ms',
    'baselineChatRequests', 'baselineChat5xx', 'baselineChatP95Ms',
    'cronSuccesses', 'cronFailures',
  ]
  for (const key of numericKeys) {
    if (!Number.isFinite(metrics[key]) || metrics[key] < 0) throw new Error(`Invalid observability metric: ${key}`)
  }

  const current5xxRate = metrics.currentRequests === 0 ? null : metrics.current5xx / metrics.currentRequests
  const baseline5xxRate = metrics.baselineRequests === 0 ? null : metrics.baseline5xx / metrics.baselineRequests
  const currentChat5xxRate = metrics.currentChatRequests === 0 ? null : metrics.currentChat5xx / metrics.currentChatRequests
  const baselineChat5xxRate = metrics.baselineChatRequests === 0 ? null : metrics.baselineChat5xx / metrics.baselineChatRequests
  const nonChatP95RegressionRatio = p95RegressionRatio(
    metrics.currentNonChatRequests,
    metrics.currentNonChatP95Ms,
    metrics.baselineNonChatRequests,
    metrics.baselineNonChatP95Ms,
  )
  const chatP95RegressionRatio = p95RegressionRatio(
    metrics.currentChatRequests,
    metrics.currentChatP95Ms,
    metrics.baselineChatRequests,
    metrics.baselineChatP95Ms,
  )
  const violations = []
  if (metrics.currentRequests === 0) violations.push('No fetch invocation sample was recorded after cutover')
  if (metrics.baselineRequests === 0) violations.push('The preceding 24-hour baseline has no fetch invocation sample')
  if (metrics.currentRequests < OBSERVABILITY_THRESHOLDS.minimumErrorSampleRequests && metrics.current5xx > 0) {
    violations.push('A 5xx occurred with fewer than 100 post-cutover requests')
  }
  if (current5xxRate !== null && current5xxRate > OBSERVABILITY_THRESHOLDS.maximum5xxRate) {
    violations.push('The post-cutover 5xx rate exceeded 1%')
  }
  if (
    current5xxRate !== null
    && baseline5xxRate !== null
    && current5xxRate > baseline5xxRate + OBSERVABILITY_THRESHOLDS.maximum5xxBaselineDelta
  ) {
    violations.push('The post-cutover 5xx rate exceeded the 24-hour baseline by more than 0.5 percentage points')
  }
  if (metrics.currentChatRequests < OBSERVABILITY_THRESHOLDS.minimumErrorSampleRequests && metrics.currentChat5xx > 0) {
    violations.push('A 5xx occurred in a low-sample chat window')
  }
  if (currentChat5xxRate !== null && currentChat5xxRate > OBSERVABILITY_THRESHOLDS.maximum5xxRate) {
    violations.push('The post-cutover chat 5xx rate exceeded 1%')
  }
  if (
    currentChat5xxRate !== null
    && baselineChat5xxRate !== null
    && currentChat5xxRate > baselineChat5xxRate + OBSERVABILITY_THRESHOLDS.maximum5xxBaselineDelta
  ) {
    violations.push('The post-cutover chat 5xx rate exceeded the 24-hour chat baseline by more than 0.5 percentage points')
  }
  if (
    metrics.currentNonChatRequests >= OBSERVABILITY_THRESHOLDS.minimumLatencySampleRequests
    && metrics.currentNonChatP95Ms > OBSERVABILITY_THRESHOLDS.maximumNonChatP95Ms
  ) {
    violations.push(`The post-cutover non-chat p95 exceeded the ${OBSERVABILITY_THRESHOLDS.maximumNonChatP95Ms} ms SLO`)
  }
  if (nonChatP95RegressionRatio !== null && nonChatP95RegressionRatio > OBSERVABILITY_THRESHOLDS.maximumP95BaselineRatio) {
    violations.push(`The post-cutover non-chat p95 exceeded ${OBSERVABILITY_THRESHOLDS.maximumP95BaselineRatio}x the 24-hour baseline`)
  }
  if (
    metrics.currentChatRequests >= OBSERVABILITY_THRESHOLDS.minimumLatencySampleRequests
    && metrics.currentChatP95Ms > OBSERVABILITY_THRESHOLDS.maximumChatP95Ms
  ) {
    violations.push(`The post-cutover chat p95 exceeded the ${OBSERVABILITY_THRESHOLDS.maximumChatP95Ms} ms SLO`)
  }
  if (chatP95RegressionRatio !== null && chatP95RegressionRatio > OBSERVABILITY_THRESHOLDS.maximumP95BaselineRatio) {
    violations.push(`The post-cutover chat p95 exceeded ${OBSERVABILITY_THRESHOLDS.maximumP95BaselineRatio}x the 24-hour chat baseline`)
  }
  if (metrics.currentFailedOutcomes > 0) violations.push('An uncaught Worker invocation failure was recorded after cutover')
  if (metrics.cronSuccesses < 2) violations.push('Fewer than two successful scheduled invocations were recorded after cutover')
  if (metrics.cronFailures > 0) violations.push('A scheduled invocation failure was recorded after cutover')

  return {
    passed: violations.length === 0,
    violations,
    current5xxRate,
    baseline5xxRate,
    currentChat5xxRate,
    baselineChat5xxRate,
    nonChatP95RegressionRatio,
    chatP95RegressionRatio,
    thresholds: OBSERVABILITY_THRESHOLDS,
  }
}
