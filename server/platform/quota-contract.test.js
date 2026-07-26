import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RESERVE_DISPOSITIONS,
  normalizeQuotaResult,
  normalizeReserveDisposition,
} from './quota-contract.js'

test('reserve disposition accepts only the five public contract values', () => {
  assert.deepEqual(RESERVE_DISPOSITIONS, ['reserved', 'replay', 'in_progress', 'conflict', 'limit_exceeded'])
  for (const disposition of RESERVE_DISPOSITIONS) assert.equal(normalizeReserveDisposition(disposition), disposition)
  for (const invalid of [undefined, null, 1, '', 'retry_exhausted', 'RESERVED']) {
    assert.equal(normalizeReserveDisposition(invalid), null)
  }
})

test('quota result normalizes array and object RPC rows without leaking unknown fields', () => {
  assert.deepEqual(normalizeQuotaResult(null, 30), { limit: 30, remaining: 0, resetAt: '' })
  assert.deepEqual(normalizeQuotaResult([{
    disposition: 'replay',
    allowed: 0,
    duplicate: 1,
    response_json: { message: 'saved' },
    room_version: '2',
    lease_expires_at: '2026-07-26T00:00:00Z',
    message_limit: '30',
    remaining: '29',
    reset_at: '2026-07-27T00:00:00+09:00',
    ignored: 'private',
  }], 5), {
    disposition: 'replay',
    allowed: false,
    duplicate: true,
    response: { message: 'saved' },
    roomVersion: 2,
    leaseExpiresAt: '2026-07-26T00:00:00Z',
    limit: 30,
    remaining: 29,
    resetAt: '2026-07-27T00:00:00+09:00',
  })
  assert.deepEqual(normalizeQuotaResult({
    disposition: 'reserved',
    response_json: null,
    room_version: null,
    lease_expires_at: null,
    limit: 7,
    resetAt: 'later',
  }, 30), {
    disposition: 'reserved',
    response: null,
    roomVersion: 0,
    leaseExpiresAt: '',
    limit: 7,
    remaining: 0,
    resetAt: 'later',
  })
})

test('reserve normalization fails closed on an unknown or missing disposition', () => {
  assert.throws(() => normalizeQuotaResult({ disposition: 'retry_exhausted' }, 30, { requireDisposition: true }), /INVALID_QUOTA_DISPOSITION/)
  assert.throws(() => normalizeQuotaResult({}, 30, { requireDisposition: true }), /INVALID_QUOTA_DISPOSITION/)
  assert.equal(normalizeQuotaResult({ disposition: 'conflict' }, 30, { requireDisposition: true }).disposition, 'conflict')
})
