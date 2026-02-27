import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildApiErrorResult,
  buildChatSuccessPayload,
  buildErrorPayload,
  buildJsonResult,
  withElapsedHeader,
  withRateLimitHeaders,
} from './http-response.js';

test('builds elapsed header with non-negative elapsed time', () => {
  const now = Date.now();
  const headers = withElapsedHeader({ 'Content-Type': 'application/json' }, now - 5);

  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(typeof headers['X-V-MATE-Elapsed-Ms'], 'string');
  assert.ok(Number(headers['X-V-MATE-Elapsed-Ms']) >= 0);
});

test('builds error payload with optional retryable/details fields', () => {
  const base = buildErrorPayload({
    error: 'Test error',
    errorCode: 'TEST_ERROR',
    traceId: 'trace-1',
  });

  assert.deepEqual(base, {
    error: 'Test error',
    error_code: 'TEST_ERROR',
    trace_id: 'trace-1',
  });

  const extended = buildErrorPayload({
    error: 'Retryable error',
    errorCode: 'RETRYABLE',
    traceId: 'trace-2',
    retryable: true,
    details: 'additional details',
  });

  assert.deepEqual(extended, {
    error: 'Retryable error',
    error_code: 'RETRYABLE',
    trace_id: 'trace-2',
    retryable: true,
    details: 'additional details',
  });
});

test('adds rate-limit headers with safe defaults', () => {
  const headers = withRateLimitHeaders(
    { 'Content-Type': 'application/json' },
    {
      remaining: 7,
      retryAfterMs: 1234,
    },
    30
  );

  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['X-V-MATE-RateLimit-Limit'], '30');
  assert.equal(headers['X-V-MATE-RateLimit-Remaining'], '7');
  assert.equal(headers['X-V-MATE-RateLimit-Reset'], '2');
});

test('buildJsonResult applies elapsed header and serializes object body', () => {
  const result = buildJsonResult({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    startedAtMs: Date.now() - 10,
    body: { ok: true },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Content-Type'], 'application/json');
  assert.equal(typeof result.headers['X-V-MATE-Elapsed-Ms'], 'string');
  assert.equal(result.body, JSON.stringify({ ok: true }));
});

test('buildApiErrorResult builds consistent error envelope response', () => {
  const result = buildApiErrorResult({
    statusCode: 429,
    headers: { 'Content-Type': 'application/json' },
    startedAtMs: Date.now() - 10,
    traceId: 'trace-rate-1',
    error: 'Too many requests',
    errorCode: 'RATE_LIMIT_EXCEEDED',
    retryable: true,
  });

  assert.equal(result.statusCode, 429);
  assert.equal(result.headers['Content-Type'], 'application/json');
  assert.equal(result.headers['X-V-MATE-Error-Code'], 'RATE_LIMIT_EXCEEDED');
  assert.equal(typeof result.headers['X-V-MATE-Elapsed-Ms'], 'string');
  assert.deepEqual(JSON.parse(result.body), {
    error: 'Too many requests',
    error_code: 'RATE_LIMIT_EXCEEDED',
    trace_id: 'trace-rate-1',
    retryable: true,
  });
});

test('buildChatSuccessPayload supports v2 and legacy v1 response shape', () => {
  const payload = {
    emotion: 'happy',
    inner_heart: 'x',
    response: 'y',
    narration: '',
  };

  const v2 = buildChatSuccessPayload({
    apiVersion: '2',
    payload,
    cachedContent: null,
    traceId: 'trace-v2',
  });

  assert.deepEqual(v2, {
    message: payload,
    cachedContent: null,
    trace_id: 'trace-v2',
    api_version: '2',
  });

  const v1 = buildChatSuccessPayload({
    apiVersion: '1',
    payload,
    cachedContent: 'cachedContents/x',
    traceId: 'trace-v1',
  });

  assert.equal(v1.api_version, '1');
  assert.equal(v1.cachedContent, 'cachedContents/x');
  assert.equal(v1.trace_id, 'trace-v1');
  assert.equal(typeof v1.text, 'string');
  assert.deepEqual(JSON.parse(v1.text), payload);
});
