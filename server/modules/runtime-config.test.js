import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  getChatRuntimeLimits,
  getChatAuthConfig,
  getClientRequestDedupeConfig,
  getPromptCacheStoreMode,
  getRateLimitConfig,
  getRateLimitMaxKeys,
  getRateLimitStoreMode,
  getPromptCacheMaxEntries,
  getRequestBodyLimitBytes,
  shouldRequireJsonContentType,
  shouldTrustProxyHeaders,
} from './runtime-config.js';

const KEYS = [
  'GEMINI_HISTORY_MESSAGES',
  'GEMINI_MAX_PART_CHARS',
  'GEMINI_MAX_SYSTEM_PROMPT_CHARS',
  'GEMINI_MAX_OUTPUT_TOKENS',
  'GEMINI_MODEL_TIMEOUT_MS',
  'FUNCTION_TOTAL_TIMEOUT_MS',
  'FUNCTION_TIMEOUT_GUARD_MS',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'RATE_LIMIT_MAX_KEYS',
  'REQUEST_BODY_MAX_BYTES',
  'PROMPT_CACHE_MAX_ENTRIES',
  'TRUST_PROXY_HEADERS',
  'REQUIRE_JSON_CONTENT_TYPE',
  'RATE_LIMIT_STORE',
  'PROMPT_CACHE_STORE',
  'CLIENT_REQUEST_DEDUPE_WINDOW_MS',
  'CLIENT_REQUEST_DEDUPE_MAX_ENTRIES',
  'REQUIRE_AUTH_FOR_CHAT',
  'AUTH_PROVIDER_TIMEOUT_MS',
  'AUTH_PROVIDER_RETRY_COUNT',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_PUBLIC_SUPABASE_URL',
  'VITE_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

const ORIGINAL = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = ORIGINAL[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('returns defaults when env vars are missing', () => {
  for (const key of KEYS) {
    delete process.env[key];
  }

  const limits = getChatRuntimeLimits();
  assert.deepEqual(limits, {
    maxHistoryMessages: 10,
    maxPartChars: 700,
    maxSystemPromptChars: 5000,
    primaryMaxOutputTokens: 1024,
    modelTimeoutMs: 15000,
    functionTotalTimeoutMs: 20000,
    functionTimeoutGuardMs: 1500,
  });
});

test('parses env vars into numeric runtime limits', () => {
  process.env.GEMINI_HISTORY_MESSAGES = '3';
  process.env.GEMINI_MAX_PART_CHARS = '120';
  process.env.GEMINI_MAX_SYSTEM_PROMPT_CHARS = '900';
  process.env.GEMINI_MAX_OUTPUT_TOKENS = '222';
  process.env.GEMINI_MODEL_TIMEOUT_MS = '3333';
  process.env.FUNCTION_TOTAL_TIMEOUT_MS = '4444';
  process.env.FUNCTION_TIMEOUT_GUARD_MS = '555';

  const limits = getChatRuntimeLimits();
  assert.deepEqual(limits, {
    maxHistoryMessages: 3,
    maxPartChars: 120,
    maxSystemPromptChars: 900,
    primaryMaxOutputTokens: 222,
    modelTimeoutMs: 3333,
    functionTotalTimeoutMs: 4444,
    functionTimeoutGuardMs: 555,
  });
});

test('applies sane bounds for invalid or unsafe numeric values', () => {
  process.env.GEMINI_HISTORY_MESSAGES = '-2';
  process.env.GEMINI_MAX_PART_CHARS = '999999';
  process.env.GEMINI_MAX_SYSTEM_PROMPT_CHARS = 'abc';
  process.env.GEMINI_MAX_OUTPUT_TOKENS = '0';
  process.env.GEMINI_MODEL_TIMEOUT_MS = '999999';
  process.env.FUNCTION_TOTAL_TIMEOUT_MS = '100';
  process.env.FUNCTION_TIMEOUT_GUARD_MS = '999999';
  process.env.REQUEST_BODY_MAX_BYTES = '300';
  process.env.PROMPT_CACHE_MAX_ENTRIES = '9000';
  process.env.RATE_LIMIT_WINDOW_MS = '10';
  process.env.RATE_LIMIT_MAX_REQUESTS = '0';
  process.env.RATE_LIMIT_MAX_KEYS = '-1';

  const limits = getChatRuntimeLimits();
  assert.deepEqual(limits, {
    maxHistoryMessages: 1,
    maxPartChars: 4000,
    maxSystemPromptChars: 5000,
    primaryMaxOutputTokens: 64,
    modelTimeoutMs: 60000,
    functionTotalTimeoutMs: 2000,
    functionTimeoutGuardMs: 1900,
  });

  assert.equal(getRequestBodyLimitBytes(), 1024);
  assert.equal(getPromptCacheMaxEntries(), 4096);
  assert.deepEqual(getRateLimitConfig(), {
    windowMs: 1000,
    maxRequests: 1,
  });
  assert.equal(getRateLimitMaxKeys(), 1);
  assert.equal(shouldTrustProxyHeaders(), false);
});

test('parses proxy header trust toggle', () => {
  process.env.TRUST_PROXY_HEADERS = 'true';
  assert.equal(shouldTrustProxyHeaders(), true);

  process.env.TRUST_PROXY_HEADERS = 'false';
  assert.equal(shouldTrustProxyHeaders(), false);
});

test('parses json content-type requirement toggle', () => {
  process.env.REQUIRE_JSON_CONTENT_TYPE = 'true';
  assert.equal(shouldRequireJsonContentType(), true);

  process.env.REQUIRE_JSON_CONTENT_TYPE = 'false';
  assert.equal(shouldRequireJsonContentType(), false);
});

test('parses rate-limit/prompt-cache store mode with safe defaults', () => {
  delete process.env.RATE_LIMIT_STORE;
  delete process.env.PROMPT_CACHE_STORE;
  assert.equal(getRateLimitStoreMode(), 'memory');
  assert.equal(getPromptCacheStoreMode(), 'memory');

  process.env.RATE_LIMIT_STORE = 'kv';
  process.env.PROMPT_CACHE_STORE = 'KV';
  assert.equal(getRateLimitStoreMode(), 'kv');
  assert.equal(getPromptCacheStoreMode(), 'kv');

  process.env.RATE_LIMIT_STORE = 'redis';
  process.env.PROMPT_CACHE_STORE = 'custom';
  assert.equal(getRateLimitStoreMode(), 'memory');
  assert.equal(getPromptCacheStoreMode(), 'memory');
});

test('parses client request dedupe config with bounds', () => {
  delete process.env.CLIENT_REQUEST_DEDUPE_WINDOW_MS;
  delete process.env.CLIENT_REQUEST_DEDUPE_MAX_ENTRIES;
  assert.deepEqual(getClientRequestDedupeConfig(), {
    windowMs: 15000,
    maxEntries: 2000,
  });

  process.env.CLIENT_REQUEST_DEDUPE_WINDOW_MS = '5000';
  process.env.CLIENT_REQUEST_DEDUPE_MAX_ENTRIES = '3000';
  assert.deepEqual(getClientRequestDedupeConfig(), {
    windowMs: 5000,
    maxEntries: 3000,
  });

  process.env.CLIENT_REQUEST_DEDUPE_WINDOW_MS = '-1';
  process.env.CLIENT_REQUEST_DEDUPE_MAX_ENTRIES = '999999';
  assert.deepEqual(getClientRequestDedupeConfig(), {
    windowMs: 0,
    maxEntries: 20000,
  });
});

test('parses chat auth config with secure defaults and env fallback', () => {
  delete process.env.REQUIRE_AUTH_FOR_CHAT;
  delete process.env.AUTH_PROVIDER_TIMEOUT_MS;
  delete process.env.AUTH_PROVIDER_RETRY_COUNT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.VITE_PUBLIC_SUPABASE_URL;
  delete process.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  assert.deepEqual(getChatAuthConfig(), {
    requireAuth: true,
    authProviderTimeoutMs: 3500,
    authProviderRetryCount: 1,
    supabaseUrl: '',
    supabaseAnonKey: '',
  });

  process.env.REQUIRE_AUTH_FOR_CHAT = 'false';
  process.env.AUTH_PROVIDER_TIMEOUT_MS = '2500';
  process.env.AUTH_PROVIDER_RETRY_COUNT = '2';
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_ANON_KEY = 'public-anon-key';
  assert.deepEqual(getChatAuthConfig(), {
    requireAuth: false,
    authProviderTimeoutMs: 2500,
    authProviderRetryCount: 2,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-anon-key',
  });

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.VITE_PUBLIC_SUPABASE_URL = 'https://public-url.supabase.co';
  process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
  assert.deepEqual(getChatAuthConfig(), {
    requireAuth: false,
    authProviderTimeoutMs: 2500,
    authProviderRetryCount: 2,
    supabaseUrl: 'https://public-url.supabase.co',
    supabaseAnonKey: 'publishable-key',
  });
});
