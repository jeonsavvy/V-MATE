import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  buildPromptCacheKey,
  getValidPromptCache,
  isValidCachedContentName,
  parseCachedContentName,
  resetPromptCacheStoreForTests,
  removePromptCache,
  setPromptCacheEntry,
  toStablePromptHash,
} from './prompt-cache.js';

const TRACKED_ENV_KEYS = ['PROMPT_CACHE_MAX_ENTRIES'];
const ORIGINAL_ENV = Object.fromEntries(TRACKED_ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  resetPromptCacheStoreForTests();
  for (const key of TRACKED_ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('builds stable prompt hash and deterministic cache key', () => {
  const hashA = toStablePromptHash('sample prompt');
  const hashB = toStablePromptHash('sample prompt');

  assert.equal(hashA, hashB);
  assert.equal(hashA.length, 24);
  assert.equal(buildPromptCacheKey('mika', hashA), `mika:${hashA}`);
});

test('accepts only valid cached content names', () => {
  assert.equal(isValidCachedContentName('cachedContents/abc123'), true);
  assert.equal(parseCachedContentName(' cachedContents/abc123 '), 'cachedContents/abc123');
  assert.equal(isValidCachedContentName('cachedcontents/abc123'), false);
  assert.equal(parseCachedContentName('http://malicious'), null);
});

test('invalidates near-expiry cache entry with 15s buffer', () => {
  const cacheKey = 'mika:test-expire';
  setPromptCacheEntry(cacheKey, {
    name: 'cachedContents/mika-test',
    expireAtMs: Date.now() + 14_000,
  });

  const cache = getValidPromptCache(cacheKey);
  assert.equal(cache, null);
  removePromptCache(cacheKey);
});

test('returns valid cache entry when ttl buffer is sufficient', () => {
  const cacheKey = 'mika:test-valid';
  const entry = {
    name: 'cachedContents/mika-valid',
    expireAtMs: Date.now() + 60_000,
  };

  setPromptCacheEntry(cacheKey, entry);
  const cache = getValidPromptCache(cacheKey);
  assert.deepEqual(cache, entry);
  removePromptCache(cacheKey);
});

test('evicts oldest cache entries when capacity is exceeded', () => {
  process.env.PROMPT_CACHE_MAX_ENTRIES = '2';
  const keyA = 'mika:cache-a';
  const keyB = 'mika:cache-b';
  const keyC = 'mika:cache-c';
  const entryA = {
    name: 'cachedContents/a',
    expireAtMs: Date.now() + 60_000,
  };
  const entryB = {
    name: 'cachedContents/b',
    expireAtMs: Date.now() + 60_000,
  };
  const entryC = {
    name: 'cachedContents/c',
    expireAtMs: Date.now() + 60_000,
  };

  setPromptCacheEntry(keyA, entryA);
  setPromptCacheEntry(keyB, entryB);
  setPromptCacheEntry(keyC, entryC);

  assert.equal(getValidPromptCache(keyA), null);
  assert.deepEqual(getValidPromptCache(keyB), entryB);
  assert.deepEqual(getValidPromptCache(keyC), entryC);

  removePromptCache(keyA);
  removePromptCache(keyB);
  removePromptCache(keyC);
});
