import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  createKvPromptCacheAdapter,
  createKvRateLimitHook,
  resetRuntimeChatContextCacheForTests,
  resolveRuntimeChatHandlerContext,
} from './runtime-chat-context.js';

class MemoryKv {
  constructor() {
    this.store = new Map();
    this.putCalls = [];
    this.deleteCalls = [];
  }

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async put(key, value, options) {
    this.store.set(key, String(value));
    this.putCalls.push({ key, value: String(value), options });
  }

  async delete(key) {
    this.store.delete(key);
    this.deleteCalls.push(key);
  }
}

const ENV_KEYS = [
  'RATE_LIMIT_STORE',
  'PROMPT_CACHE_STORE',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
];

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  resetRuntimeChatContextCacheForTests();
});

test('createKvRateLimitHook enforces limit and resets after window', async () => {
  const kv = new MemoryKv();
  let nowMs = 10_000;
  const hook = createKvRateLimitHook({
    kv,
    windowMs: 1_000,
    prefix: 'test:rl:',
    now: () => nowMs,
  });

  const first = await hook({ key: 'ip:127.0.0.1', defaultLimit: 2 });
  const second = await hook({ key: 'ip:127.0.0.1', defaultLimit: 2 });
  const third = await hook({ key: 'ip:127.0.0.1', defaultLimit: 2 });

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.equal(third.limit, 2);
  assert.ok(kv.putCalls.length >= 2);

  nowMs += 1_100;
  const fourth = await hook({ key: 'ip:127.0.0.1', defaultLimit: 2 });
  assert.equal(fourth.allowed, true);
  assert.equal(fourth.remaining, 1);
});

test('createKvPromptCacheAdapter reads/writes valid cache entries and evicts near-expiry entries', async () => {
  const kv = new MemoryKv();
  let nowMs = 20_000;
  const adapter = createKvPromptCacheAdapter({
    kv,
    prefix: 'test:pc:',
    now: () => nowMs,
  });

  await adapter.set('mika:promptHash', {
    name: 'cachedContents/mika-cache',
    expireAtMs: nowMs + 120_000,
  });

  const cached = await adapter.get('mika:promptHash');
  assert.equal(cached?.name, 'cachedContents/mika-cache');

  nowMs += 111_000;
  const nearExpiry = await adapter.get('mika:promptHash');
  assert.equal(nearExpiry, null);
  assert.ok(kv.deleteCalls.length >= 1);

  const putCountBeforeInvalid = kv.putCalls.length;
  await adapter.set('mika:invalid', {
    name: 'invalid-cache-name',
    expireAtMs: nowMs + 60_000,
  });
  assert.equal(kv.putCalls.length, putCountBeforeInvalid);
});

test('resolveRuntimeChatHandlerContext builds kv hooks when kv store mode is enabled', async () => {
  process.env.RATE_LIMIT_STORE = 'kv';
  process.env.PROMPT_CACHE_STORE = 'kv';
  process.env.RATE_LIMIT_WINDOW_MS = '1000';
  process.env.RATE_LIMIT_MAX_REQUESTS = '3';

  const rateLimitKv = new MemoryKv();
  const promptCacheKv = new MemoryKv();
  const env = {
    V_MATE_RATE_LIMIT_KV: rateLimitKv,
    V_MATE_PROMPT_CACHE_KV: promptCacheKv,
    RATE_LIMIT_KV_PREFIX: 'ctx:rl',
    PROMPT_CACHE_KV_PREFIX: 'ctx:pc',
  };

  const context = resolveRuntimeChatHandlerContext({ env, traceId: 'trace-runtime-context' });
  const cachedContext = resolveRuntimeChatHandlerContext({ env, traceId: 'trace-runtime-context' });

  assert.equal(context, cachedContext);
  assert.equal(typeof context.checkRateLimit, 'function');
  assert.equal(typeof context.promptCache?.get, 'function');

  const first = await context.checkRateLimit({ key: 'fingerprint:test', defaultLimit: 2 });
  const second = await context.checkRateLimit({ key: 'fingerprint:test', defaultLimit: 2 });
  const third = await context.checkRateLimit({ key: 'fingerprint:test', defaultLimit: 2 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);

  await context.promptCache.set('alice:prompt', {
    name: 'cachedContents/alice-cache',
    expireAtMs: Date.now() + 60_000,
  });
  const cachedPrompt = await context.promptCache.get('alice:prompt');
  assert.equal(cachedPrompt?.name, 'cachedContents/alice-cache');
});

test('resolveRuntimeChatHandlerContext falls back to empty context for memory mode', () => {
  process.env.RATE_LIMIT_STORE = 'memory';
  process.env.PROMPT_CACHE_STORE = 'memory';

  const context = resolveRuntimeChatHandlerContext({ env: {} });
  assert.deepEqual(context, {});
});
