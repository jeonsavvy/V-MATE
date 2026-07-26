export const extractCalculationValue = (payload, alias) => {
  const calculations = payload?.result?.calculations
  if (!Array.isArray(calculations)) throw new Error('Observability response did not contain calculations')
  const calculation = calculations.find((entry) => entry?.alias === alias)
  const value = calculation?.aggregates?.[0]?.value
  if (!Number.isFinite(value) || value < 0) throw new Error(`Observability response did not contain ${alias}`)
  return Number(value)
}

export const evaluateObservability = (metrics) => {
  const numericKeys = [
    'currentRequests', 'current5xx', 'currentFailedOutcomes', 'currentNonChatP95Ms',
    'baselineRequests', 'baseline5xx', 'baselineNonChatP95Ms', 'cronSuccesses', 'cronFailures',
  ]
  for (const key of numericKeys) {
    if (!Number.isFinite(metrics[key]) || metrics[key] < 0) throw new Error(`Invalid observability metric: ${key}`)
  }

  const current5xxRate = metrics.currentRequests === 0 ? null : metrics.current5xx / metrics.currentRequests
  const baseline5xxRate = metrics.baselineRequests === 0 ? null : metrics.baseline5xx / metrics.baselineRequests
  const violations = []
  if (metrics.currentRequests === 0) violations.push('No fetch invocation sample was recorded after cutover')
  if (metrics.baselineRequests === 0) violations.push('The preceding 24-hour baseline has no fetch invocation sample')
  if (metrics.currentRequests < 100 && metrics.current5xx > 0) violations.push('A 5xx occurred with fewer than 100 post-cutover requests')
  if (current5xxRate !== null && current5xxRate > 0.01) violations.push('The post-cutover 5xx rate exceeded 1%')
  if (current5xxRate !== null && baseline5xxRate !== null && current5xxRate > baseline5xxRate + 0.005) {
    violations.push('The post-cutover 5xx rate exceeded the 24-hour baseline by more than 0.5 percentage points')
  }
  if (metrics.currentFailedOutcomes > 0) violations.push('An uncaught Worker invocation failure was recorded after cutover')
  if (metrics.cronSuccesses < 2) violations.push('Fewer than two successful scheduled invocations were recorded after cutover')
  if (metrics.cronFailures > 0) violations.push('A scheduled invocation failure was recorded after cutover')

  return {
    passed: violations.length === 0,
    violations,
    current5xxRate,
    baseline5xxRate,
  }
}
