import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
    getServerLogLevel,
    logServerWarn,
    sanitizeLogMetadata,
} from './server-logger.js';

const ORIGINAL_ENV = {
    LOG_LEVEL: process.env.LOG_LEVEL,
    V_MATE_LOG_LEVEL: process.env.V_MATE_LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_WARN = console.warn;

const restoreEnv = () => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (typeof value === 'undefined') {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};

afterEach(() => {
    restoreEnv();
    console.warn = ORIGINAL_WARN;
});

test('getServerLogLevel prefers explicit env level and falls back by node env', () => {
    process.env.V_MATE_LOG_LEVEL = 'debug';
    assert.equal(getServerLogLevel(), 'debug');

    delete process.env.V_MATE_LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';
    assert.equal(getServerLogLevel(), 'error');

    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'production';
    assert.equal(getServerLogLevel(), 'warn');
});

test('sanitizeLogMetadata redacts sensitive fields and key-like substrings', () => {
    const sanitized = sanitizeLogMetadata({
        token: 'abc',
        nested: {
            apiKey: '123',
            traceId: 'trace-1',
            text: 'normal text',
        },
        candidate: 'AIzaSyA1b2C3d4E5f6G7h8I9j0KLMNOPQRST',
    });

    assert.equal(sanitized.token, '[REDACTED]');
    assert.equal(sanitized.nested.apiKey, '[REDACTED]');
    assert.equal(sanitized.nested.traceId, 'trace-1');
    assert.equal(sanitized.nested.text, 'normal text');
    assert.equal(sanitized.candidate.includes('AIza'), false);
});

test('logServerWarn respects log level threshold', () => {
    process.env.LOG_LEVEL = 'error';
    const calls = [];
    console.warn = (...args) => calls.push(args);

    logServerWarn('warn skipped');
    assert.equal(calls.length, 0);

    process.env.LOG_LEVEL = 'warn';
    logServerWarn('warn emitted', { apiKey: 'secret-value', ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'warn emitted');
    assert.equal(calls[0][1].apiKey, '[REDACTED]');
    assert.equal(calls[0][1].ok, true);
});
