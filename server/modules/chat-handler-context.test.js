import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeChatHandlerContexts, resolveChatHandlerContext } from './chat-handler-context.js';

test('resolveChatHandlerContext returns static object context as-is', async () => {
    const context = { promptCache: { get: async () => null } };
    const resolved = await resolveChatHandlerContext({ chatHandlerContext: context });
    assert.equal(resolved, context);
});

test('resolveChatHandlerContext resolves function context with resolver input', async () => {
    const resolved = await resolveChatHandlerContext({
        chatHandlerContext: async ({ req }) => ({
            hasReq: Boolean(req),
        }),
        resolverInput: {
            req: { method: 'POST' },
        },
    });
    assert.deepEqual(resolved, { hasReq: true });
});

test('resolveChatHandlerContext falls back to empty object for invalid result', async () => {
    const resolved = await resolveChatHandlerContext({
        chatHandlerContext: async () => 'invalid',
    });
    assert.deepEqual(resolved, {});
});

test('resolveChatHandlerContext falls back to empty object when resolver throws', async () => {
    const resolved = await resolveChatHandlerContext({
        chatHandlerContext: async () => {
            throw new Error('resolver-failure');
        },
    });
    assert.deepEqual(resolved, {});
});

test('resolveChatHandlerContext calls onError callback when resolver throws', async () => {
    let observedErrorMessage = '';
    const resolved = await resolveChatHandlerContext({
        chatHandlerContext: async () => {
            throw new Error('resolver-callback-failure');
        },
        onError: (error) => {
            observedErrorMessage = error?.message || String(error);
        },
    });
    assert.deepEqual(resolved, {});
    assert.equal(observedErrorMessage, 'resolver-callback-failure');
});

test('mergeChatHandlerContexts prefers configured hooks over runtime hooks', () => {
    const runtimeContext = {
        checkRateLimit: async () => ({ allowed: true }),
        promptCache: { get: async () => null },
        runtimeOnly: true,
    };
    const configuredContext = {
        checkRateLimit: async () => ({ allowed: false }),
        promptCache: { get: async () => ({ name: 'cachedContents/a', expireAtMs: Date.now() + 1000 }) },
        configuredOnly: true,
    };

    const merged = mergeChatHandlerContexts(runtimeContext, configuredContext);
    assert.equal(typeof merged.checkRateLimit, 'function');
    assert.equal(typeof merged.promptCache?.get, 'function');
    assert.equal(merged.runtimeOnly, true);
    assert.equal(merged.configuredOnly, true);
    assert.equal(merged.checkRateLimit, configuredContext.checkRateLimit);
    assert.equal(merged.promptCache, configuredContext.promptCache);
});

test('mergeChatHandlerContexts removes invalid hook values safely', () => {
    const merged = mergeChatHandlerContexts(
        { checkRateLimit: 'invalid', promptCache: null, runtimeOnly: true },
        { checkRateLimit: null, promptCache: 'invalid', configuredOnly: true }
    );

    assert.equal('checkRateLimit' in merged, false);
    assert.equal('promptCache' in merged, false);
    assert.equal(merged.runtimeOnly, true);
    assert.equal(merged.configuredOnly, true);
});
