export const RESERVE_DISPOSITIONS = Object.freeze([
  'reserved',
  'replay',
  'in_progress',
  'conflict',
  'limit_exceeded',
])

const reserveDispositionSet = new Set(RESERVE_DISPOSITIONS)
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export const normalizeReserveDisposition = (value) => {
  const normalized = typeof value === 'string' ? value : ''
  return reserveDispositionSet.has(normalized) ? normalized : null
}

export const normalizeQuotaResult = (data, fallbackLimit, { requireDisposition = false } = {}) => {
  const candidate = Array.isArray(data) ? data[0] : data
  const row = candidate && typeof candidate === 'object' ? candidate : {}
  const disposition = normalizeReserveDisposition(row.disposition)
  if (requireDisposition && !disposition) throw new Error('INVALID_QUOTA_DISPOSITION')

  const result = {
    limit: Number(row.message_limit || row.limit || fallbackLimit),
    remaining: Number(row.remaining || 0),
    resetAt: row.reset_at || row.resetAt || '',
  }
  if (disposition) result.disposition = disposition
  if (hasOwn(row, 'allowed')) result.allowed = Boolean(row.allowed)
  if (hasOwn(row, 'duplicate')) result.duplicate = Boolean(row.duplicate)
  if (hasOwn(row, 'response_json')) result.response = row.response_json || null
  if (hasOwn(row, 'room_version')) result.roomVersion = Number(row.room_version || 0)
  if (hasOwn(row, 'lease_expires_at')) result.leaseExpiresAt = row.lease_expires_at || ''
  return result
}
