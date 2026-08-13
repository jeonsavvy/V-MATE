import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createKvPromptCacheAdapter,
  createKvRateLimitHook,
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
