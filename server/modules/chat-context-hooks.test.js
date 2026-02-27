import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
    removePromptCacheWithAdapter,
    resolvePromptCacheAdapter,
    resolveRateLimitState,
    setPromptCacheWithAdapter,
} from './chat-context-hooks.js';
import {
    getValidPromptCache,
    resetPromptCacheStoreForTests,
} from './prompt-cache.js';

const ORIGINAL_LOG_LEVEL = process.env.V_MATE_LOG_LEVEL;

afterEach(() => {
    if (typeof ORIGINAL_LOG_LEVEL === 'undefined') {
        delete process.env.V_MATE_LOG_LEVEL;
    } else {
        process.env.V_MATE_LOG_LEVEL = ORIGINAL_LOG_LEVEL;
    }
    resetPromptCacheStoreForTests();
});

test('resolveRateLimitState falls back to default limiter when custom hook is missing', async () => {
    const defaultStatus = {
        allowed: true,
        remaining: 9,
        retryAfterMs: 0,
    };
    const result = await resolveRateLimitState({
        context: {},
        event: { headers: {} },
        origin: 'http://localhost:5173',
        rateKey: 'ip:test',
        defaultLimit: 10,
        getDefaultStatus: () => defaultStatus,
    });

    assert.deepEqual(result, {
        status: defaultStatus,
        limit: 10,
    });
});

test('resolveRateLimitState normalizes custom limiter response values', async () => {
    const defaultStatus = {
        allowed: true,
        remaining: 9,
        retryAfterMs: 0,
    };
    const result = await resolveRateLimitState({
        context: {
            checkRateLimit: async () => ({
                allowed: false,
                remaining: -100,
                retryAfterMs: 1900.9,
                limit: 5.9,
            }),
        },
        event: { headers: {} },
        origin: 'http://localhost:5173',
        rateKey: 'ip:test',
        defaultLimit: 10,
        getDefaultStatus: () => defaultStatus,
    });

    assert.deepEqual(result, {
        status: {
            allowed: false,
            remaining: 0,
            retryAfterMs: 1900,
        },
        limit: 5,
    });
});

test('resolveRateLimitState falls back to defaults when custom hook throws', async () => {
    process.env.V_MATE_LOG_LEVEL = 'silent';
    const defaultStatus = {
        allowed: true,
        remaining: 9,
        retryAfterMs: 0,
    };
    const result = await resolveRateLimitState({
        context: {
            checkRateLimit: async () => {
                throw new Error('custom-rate-limit-failure');
            },
        },
        event: { headers: {} },
        origin: 'http://localhost:5173',
        rateKey: 'ip:test',
        defaultLimit: 10,
        getDefaultStatus: () => defaultStatus,
    });

    assert.deepEqual(result, {
        status: defaultStatus,
        limit: 10,
    });
});

test('resolveRateLimitState does not touch default limiter when custom hook returns full fields', async () => {
    let defaultStatusCallCount = 0;
    const result = await resolveRateLimitState({
        context: {
            checkRateLimit: async () => ({
                allowed: true,
                remaining: 12,
                retryAfterMs: 0,
                limit: 20,
            }),
        },
        event: { headers: {} },
        origin: 'http://localhost:5173',
        rateKey: 'ip:test',
        defaultLimit: 10,
        getDefaultStatus: () => {
            defaultStatusCallCount += 1;
            return {
                allowed: true,
                remaining: 9,
                retryAfterMs: 0,
            };
        },
    });

    assert.deepEqual(result, {
        status: {
            allowed: true,
            remaining: 12,
            retryAfterMs: 0,
        },
        limit: 20,
    });
    assert.equal(defaultStatusCallCount, 0);
});

test('resolveRateLimitState uses default limiter fallback values when custom hook omits remaining/retryAfter', async () => {
    let defaultStatusCallCount = 0;
    const result = await resolveRateLimitState({
        context: {
            checkRateLimit: async () => ({
                allowed: false,
                limit: 10,
            }),
        },
        event: { headers: {} },
        origin: 'http://localhost:5173',
        rateKey: 'ip:test',
        defaultLimit: 10,
        getDefaultStatus: () => {
            defaultStatusCallCount += 1;
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: 1500,
            };
        },
    });

    assert.deepEqual(result, {
        status: {
            allowed: false,
            remaining: 0,
            retryAfterMs: 1500,
        },
        limit: 10,
    });
    assert.equal(defaultStatusCallCount, 1);
});

test('resolvePromptCacheAdapter returns adapter only when supported methods exist', () => {
    assert.equal(resolvePromptCacheAdapter({}), null);
    assert.equal(resolvePromptCacheAdapter({ promptCache: {} }), null);

    const adapter = {
        get: async () => null,
    };

    assert.equal(resolvePromptCacheAdapter({ promptCache: adapter }), adapter);
});

test('prompt cache adapter helpers keep in-memory cache safe on adapter failures', async () => {
    process.env.V_MATE_LOG_LEVEL = 'silent';
    const cacheKey = 'mika:test';
    const entry = {
        name: 'cachedContents/example',
        expireAtMs: Date.now() + 60_000,
    };

    await setPromptCacheWithAdapter({
        promptCacheAdapter: {
            set: async () => {
                throw new Error('adapter-set-failure');
            },
        },
        promptCacheKey: cacheKey,
        entry,
        traceId: 'trace-test',
        characterId: 'mika',
    });

    assert.deepEqual(getValidPromptCache(cacheKey), entry);

    await removePromptCacheWithAdapter({
        promptCacheAdapter: {
            remove: async () => {
                throw new Error('adapter-remove-failure');
            },
        },
        promptCacheKey: cacheKey,
        traceId: 'trace-test',
        characterId: 'mika',
    });

    assert.equal(getValidPromptCache(cacheKey), null);
});
