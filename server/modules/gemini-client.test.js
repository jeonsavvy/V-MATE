import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGeminiRequestPayload,
  callGeminiWithTimeout,
  createPromptCacheEntry,
  isCacheLookupErrorMessage,
} from './gemini-client.js';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    response: { type: 'STRING' },
  },
};

test('buildGeminiRequestPayload includes json schema and cache/system instructions correctly', () => {
  const payloadWithCache = buildGeminiRequestPayload({
    requestContents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    outputTokens: 123,
    thinkingLevel: 'minimal',
    responseSchema: RESPONSE_SCHEMA,
    cachedContentName: 'cachedContents/test',
    systemPromptText: 'system text',
  });

  assert.equal(payloadWithCache.generationConfig.maxOutputTokens, 123);
  assert.equal(payloadWithCache.cachedContent, 'cachedContents/test');
  assert.equal(payloadWithCache.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(payloadWithCache.generationConfig.responseSchema, RESPONSE_SCHEMA);
  assert.equal(payloadWithCache.systemInstruction, undefined);

  const payloadWithoutCache = buildGeminiRequestPayload({
    requestContents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    outputTokens: 80,
    thinkingLevel: 'low',
    responseSchema: RESPONSE_SCHEMA,
    cachedContentName: null,
    useCachedContent: false,
    useJsonMimeType: false,
    systemPromptText: 'system text',
  });

  assert.equal(payloadWithoutCache.cachedContent, undefined);
  assert.equal(payloadWithoutCache.generationConfig.responseMimeType, undefined);
  assert.deepEqual(payloadWithoutCache.systemInstruction, {
    parts: [{ text: 'system text' }],
  });
});

test('isCacheLookupErrorMessage detects cache lookup failures', () => {
  assert.equal(isCacheLookupErrorMessage('cachedContent not found'), true);
  assert.equal(isCacheLookupErrorMessage('resource expired'), true);
  assert.equal(isCacheLookupErrorMessage('generic network error'), false);
});

test('callGeminiWithTimeout returns success for valid upstream response', async () => {
  const result = await callGeminiWithTimeout({
    apiKey: 'key',
    modelName: 'gemini',
    timeoutMs: 200,
    payload: { contents: [] },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.ok(result.data);
});

test('callGeminiWithTimeout maps invalid json and abort errors', async () => {
  const invalidJsonResult = await callGeminiWithTimeout({
    apiKey: 'key',
    modelName: 'gemini',
    timeoutMs: 200,
    payload: { contents: [] },
    fetchImpl: async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  assert.equal(invalidJsonResult.ok, false);
  assert.equal(invalidJsonResult.error?.code, 'UPSTREAM_INVALID_RESPONSE');

  const abortResult = await callGeminiWithTimeout({
    apiKey: 'key',
    modelName: 'gemini',
    timeoutMs: 10,
    payload: { contents: [] },
    fetchImpl: async (_url, options) =>
      new Promise((_, reject) => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        options?.signal?.addEventListener('abort', () => reject(abortError), { once: true });
      }),
  });

  assert.equal(abortResult.ok, false);
  assert.equal(abortResult.error?.code, 'UPSTREAM_TIMEOUT');
});

test('createPromptCacheEntry returns normalized cache entry', async () => {
  const entry = await createPromptCacheEntry({
    apiKey: 'key',
    modelName: 'gemini',
    characterId: 'mika',
    systemPrompt: 'prompt',
    cacheKey: 'cache-key',
    ttlSeconds: 3600,
    createTimeoutMs: 200,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          name: 'cachedContents/generated',
          expireTime: new Date(Date.now() + 60_000).toISOString(),
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      ),
  });

  assert.equal(entry?.name, 'cachedContents/generated');
  assert.equal(typeof entry?.expireAtMs, 'number');
});
