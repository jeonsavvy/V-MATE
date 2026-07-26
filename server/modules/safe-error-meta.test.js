import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySafeError, toSafeErrorMeta } from './safe-error-meta.js';

test('toSafeErrorMeta exposes only a fixed class and safe numeric status', () => {
    const privateValues = [
        'GOOGLE_API_KEY',
        'gemini-2.5-private',
        'private-character-slug',
        'client-request-private-123',
        'fake-google-key-redacted',
        'Error: secret\n    at internal/provider.js:10:2',
    ];
    const error = Object.assign(new Error(privateValues.join(' ')), {
        name: 'ProviderSecretError',
        code: 'PRIVATE_PROVIDER_CODE',
        status: 503,
        stack: privateValues.at(-1),
    });

    const metadata = toSafeErrorMeta(error);
    assert.deepEqual(metadata, { errorClass: 'unavailable', statusCode: 503 });
    const serialized = JSON.stringify(metadata);
    for (const value of privateValues) {
        assert.equal(serialized.includes(value), false);
    }
});

test('classifySafeError maps raw signals to a bounded non-provider taxonomy', () => {
    assert.equal(classifySafeError(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })), 'timeout');
    assert.equal(classifySafeError({ status: 429, message: 'provider quota' }), 'rate_limited');
    assert.equal(classifySafeError({ statusCode: 409, message: 'duplicate' }), 'conflict');
    assert.equal(classifySafeError(new Error('opaque provider failure')), 'unknown');
});
