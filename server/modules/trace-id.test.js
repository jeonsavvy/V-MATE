import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTraceId } from './trace-id.js';

test('createTraceId returns expected compact token format', () => {
    const traceId = createTraceId();
    assert.match(traceId, /^[a-z0-9]+-[a-z0-9]{6}$/);
});

test('createTraceId produces non-empty distinct values across sequential calls', () => {
    const traceIdA = createTraceId();
    const traceIdB = createTraceId();
    assert.notEqual(traceIdA, '');
    assert.notEqual(traceIdB, '');
    assert.notEqual(traceIdA, traceIdB);
});
