import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { executeGeminiChatRequest } from './gemini-orchestrator.js';
import {
  buildPromptCacheKey,
  resetPromptCacheStoreForTests,
  setPromptCacheEntry,
  toStablePromptHash,
} from './prompt-cache.js';

const TRACKED_ENV_KEYS = [
  'FUNCTION_TOTAL_TIMEOUT_MS',
  'FUNCTION_TIMEOUT_GUARD_MS',
  'GEMINI_MODEL_TIMEOUT_MS',
  'GEMINI_CACHE_LOOKUP_RETRY_ENABLED',
  'GEMINI_NETWORK_RECOVERY_RETRY_ENABLED',
  'GEMINI_EMPTY_RESPONSE_RETRY_ENABLED',
  'GEMINI_CONTEXT_CACHE_ENABLED',
  'GEMINI_CONTEXT_CACHE_AUTO_CREATE',
];

const ORIGINAL_ENV = Object.fromEntries(TRACKED_ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_WARN = console.warn;

const restoreEnv = () => {
  for (const key of TRACKED_ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

beforeEach(() => {
  console.warn = () => {};
  resetPromptCacheStoreForTests();
});

afterEach(() => {
  restoreEnv();
  globalThis.fetch = ORIGINAL_FETCH;
  console.warn = ORIGINAL_CONSOLE_WARN;
  resetPromptCacheStoreForTests();
});

const applyBaseEnv = (overrides = {}) => {
  const baseEnv = {
    FUNCTION_TOTAL_TIMEOUT_MS: '20000',
    FUNCTION_TIMEOUT_GUARD_MS: '1500',
    GEMINI_MODEL_TIMEOUT_MS: '8000',
    GEMINI_CACHE_LOOKUP_RETRY_ENABLED: 'true',
    GEMINI_NETWORK_RECOVERY_RETRY_ENABLED: 'false',
    GEMINI_EMPTY_RESPONSE_RETRY_ENABLED: 'false',
    GEMINI_CONTEXT_CACHE_ENABLED: 'false',
    GEMINI_CONTEXT_CACHE_AUTO_CREATE: 'false',
  };

  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    process.env[key] = String(value);
  }
};

test('executeGeminiChatRequest returns normalized success payload metadata', async () => {
  applyBaseEnv();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"happy","inner_heart":"ok","response":"hello"}',
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now(),
    requestTraceId: 'trace-1',
    normalizedCharacterId: 'mika',
    userMessage: '안녕',
    messageHistory: [],
    requestCachedContent: null,
    trimmedSystemPrompt: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.modelText, '{"emotion":"happy","inner_heart":"ok","response":"hello"}');
  assert.equal(result.cachedContentName, null);
  assert.equal(result.canUseContextCache, false);
});

test('executeGeminiChatRequest returns function budget timeout before upstream call', async () => {
  applyBaseEnv({
    FUNCTION_TOTAL_TIMEOUT_MS: '2000',
    FUNCTION_TIMEOUT_GUARD_MS: '100',
  });

  globalThis.fetch = async () => {
    throw new Error('fetch should not be called when budget is already exhausted');
  };

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now() - 5000,
    requestTraceId: 'trace-2',
    normalizedCharacterId: 'kael',
    userMessage: '테스트',
    messageHistory: [],
    requestCachedContent: null,
    trimmedSystemPrompt: '',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'FUNCTION_BUDGET_TIMEOUT');
  assert.equal(result.retryable, true);
});

test('executeGeminiChatRequest retries without cache when cached content lookup fails', async () => {
  applyBaseEnv({
    GEMINI_CONTEXT_CACHE_ENABLED: 'true',
    GEMINI_CACHE_LOOKUP_RETRY_ENABLED: 'true',
  });

  const systemPrompt = 'system prompt for cache fallback';
  const promptCacheKey = buildPromptCacheKey('mika', toStablePromptHash(systemPrompt));
  setPromptCacheEntry(promptCacheKey, {
    name: 'cachedContents/stale-entry',
    expireAtMs: Date.now() + 60_000,
  });

  const requestPayloads = [];
  globalThis.fetch = async (_url, options = {}) => {
    requestPayloads.push(JSON.parse(String(options.body || '{}')));

    if (requestPayloads.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Cached content not found',
          },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"retry success"}',
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now(),
    requestTraceId: 'trace-cache-retry',
    normalizedCharacterId: 'mika',
    userMessage: 'cache lookup retry test',
    messageHistory: [],
    requestCachedContent: 'cachedContents/stale-entry',
    trimmedSystemPrompt: systemPrompt,
  });

  assert.equal(result.ok, true);
  assert.equal(requestPayloads.length, 2);
  assert.equal(requestPayloads[0].cachedContent, 'cachedContents/stale-entry');
  assert.equal(Object.hasOwn(requestPayloads[1], 'cachedContent'), false);
  assert.equal(typeof requestPayloads[1].systemInstruction?.parts?.[0]?.text, 'string');
  assert.match(requestPayloads[1].systemInstruction.parts[0].text, /system prompt/i);
});

test('executeGeminiChatRequest ignores untrusted client cached content name', async () => {
  applyBaseEnv({
    GEMINI_CONTEXT_CACHE_ENABLED: 'true',
  });

  const requestPayloads = [];
  globalThis.fetch = async (_url, options = {}) => {
    requestPayloads.push(JSON.parse(String(options.body || '{}')));

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"trusted cache only"}',
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now(),
    requestTraceId: 'trace-cache-ignore',
    normalizedCharacterId: 'mika',
    userMessage: 'cache trust test',
    messageHistory: [],
    requestCachedContent: 'cachedContents/untrusted-entry',
    trimmedSystemPrompt: 'trusted system prompt',
  });

  assert.equal(result.ok, true);
  assert.equal(requestPayloads.length, 1);
  assert.equal(Object.hasOwn(requestPayloads[0], 'cachedContent'), false);
});

test('executeGeminiChatRequest runs network recovery attempt on connection error', async () => {
  applyBaseEnv({
    GEMINI_NETWORK_RECOVERY_RETRY_ENABLED: 'true',
  });

  const requestPayloads = [];
  globalThis.fetch = async (_url, options = {}) => {
    requestPayloads.push(JSON.parse(String(options.body || '{}')));

    if (requestPayloads.length === 1) {
      throw new Error('connect ECONNRESET');
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"happy","inner_heart":"ok","response":"network recovered"}',
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now(),
    requestTraceId: 'trace-network-retry',
    normalizedCharacterId: 'kael',
    userMessage: 'network retry test',
    messageHistory: [
      { role: 'user', content: 'history 1' },
      { role: 'assistant', content: 'history 2' },
    ],
    requestCachedContent: null,
    trimmedSystemPrompt: 'network recovery prompt',
  });

  assert.equal(result.ok, true);
  assert.equal(requestPayloads.length, 2);
  assert.equal(requestPayloads[1].contents.length, 1);
  assert.equal(requestPayloads[1].generationConfig.maxOutputTokens, 220);
});

test('executeGeminiChatRequest retries once when response text is empty', async () => {
  applyBaseEnv({
    GEMINI_EMPTY_RESPONSE_RETRY_ENABLED: 'true',
  });

  const requestPayloads = [];
  globalThis.fetch = async (_url, options = {}) => {
    requestPayloads.push(JSON.parse(String(options.body || '{}')));

    if (requestPayloads.length === 1) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [{ text: '   ' }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"empty recovered"}',
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now(),
    requestTraceId: 'trace-empty-retry',
    normalizedCharacterId: 'alice',
    userMessage: 'empty retry test',
    messageHistory: [],
    requestCachedContent: null,
    trimmedSystemPrompt: 'empty-response retry prompt',
  });

  assert.equal(result.ok, true);
  assert.equal(requestPayloads.length, 2);
  assert.equal(requestPayloads[1].generationConfig.maxOutputTokens, 180);
});

test('executeGeminiChatRequest returns max-token empty response error code', async () => {
  applyBaseEnv({
    GEMINI_EMPTY_RESPONSE_RETRY_ENABLED: 'false',
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: {
              parts: [{ text: '' }],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );

  const result = await executeGeminiChatRequest({
    apiKey: 'test-key',
    modelName: 'gemini-test',
    requestStartedAt: Date.now(),
    requestTraceId: 'trace-empty-max-tokens',
    normalizedCharacterId: 'mika',
    userMessage: 'empty max tokens test',
    messageHistory: [],
    requestCachedContent: null,
    trimmedSystemPrompt: 'max tokens prompt',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS');
  assert.equal(result.retryable, true);
});
