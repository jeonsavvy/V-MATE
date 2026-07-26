import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { handlePlatformApi, handleRoomChat, mapStoreError } from './api.js';
import { createCharacter } from './content-store.js';

const CONFIG_KEYS = [
  'APP_ENV',
  'NODE_ENV',
  'REQUIRE_CONFIGURED_SUPABASE_URL',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'GOOGLE_API_KEY',
];
const ORIGINAL_ENV = Object.fromEntries(CONFIG_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_FETCH = globalThis.fetch;

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (typeof value === 'undefined') delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
};

const clearPersistenceEnvironment = () => {
  for (const key of CONFIG_KEYS) delete process.env[key];
  process.env.APP_ENV = 'development';
};

const callApi = (event) => handlePlatformApi({
  event: { headers: {}, ...event },
  headers: { 'Content-Type': 'application/json' },
  startedAtMs: Date.now(),
  traceId: 'trace-api-test',
});

afterEach(restoreEnvironment);

test('anonymous optional detail reads never inherit the local demo owner identity', async () => {
  clearPersistenceEnvironment();
  const character = createCharacter({
    userId: 'demo-user',
    payload: {
      name: `private-demo-${Date.now()}`,
      summary: 'private owner-only content',
      visibility: 'private',
      sourceType: 'original',
      tags: [],
      profileJson: {},
      promptProfileJson: {},
    },
  });

  const result = await callApi({ httpMethod: 'GET', path: `/api/characters/${character.slug}` });
  assert.equal(result.statusCode, 404);
  assert.equal(JSON.parse(result.body).error_code, 'CHARACTER_NOT_FOUND');
});

test('an invalid bearer on an optional detail read returns 401 without anonymous fallback', async () => {
  clearPersistenceEnvironment();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'invalid token' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  const result = await callApi({
    httpMethod: 'GET',
    path: '/api/characters/private-demo',
    headers: { Authorization: 'Bearer invalid-token' },
  });
  assert.equal(result.statusCode, 401);
  assert.equal(JSON.parse(result.body).error_code, 'AUTH_UNAUTHORIZED');
});

test('malformed authorization headers on optional detail reads never fall back to public access', async () => {
  clearPersistenceEnvironment();

  for (const authorization of ['Bearer', 'Bearer   ', 'Basic credentials', 'Bearer token extra']) {
    const result = await callApi({
      httpMethod: 'GET',
      path: '/api/characters/mika',
      headers: { Authorization: authorization },
    });
    assert.equal(result.statusCode, 401, authorization);
    assert.equal(JSON.parse(result.body).error_code, 'AUTH_UNAUTHORIZED', authorization);
  }
});

test('production-like runtimes fail all mutations closed when persistence is missing', async () => {
  for (const mode of ['production', 'required-flag']) {
    clearPersistenceEnvironment();
    if (mode === 'production') process.env.APP_ENV = 'production';
    else process.env.REQUIRE_CONFIGURED_SUPABASE_URL = 'true';

    const result = await callApi({
      httpMethod: 'POST',
      path: '/api/recent-views',
      body: JSON.stringify({ entityType: 'character', entityRef: 'demo-character' }),
    });
    assert.equal(result.statusCode, 503, mode);
    assert.equal(JSON.parse(result.body).error_code, 'FEATURE_TEMPORARILY_UNAVAILABLE', mode);
  }
});

test('configured public persistence without the server mutation credential fails closed', async () => {
  clearPersistenceEnvironment();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';

  const result = await callApi({
    httpMethod: 'POST',
    path: '/api/reports',
    body: JSON.stringify({ entityType: 'character', entityId: 'x', reason: 'other' }),
  });
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body).error_code, 'FEATURE_TEMPORARILY_UNAVAILABLE');
});

test('room chat immediately refunds a reservation when prompt or history reads throw', async () => {
  clearPersistenceEnvironment();
  process.env.GOOGLE_API_KEY = 'test-key';

  for (const failurePoint of ['prompt', 'history']) {
    let refundCalls = 0;
    const store = {
      async getRoom() {
        return { id: 'room-read-failure', version: 3, character: { slug: 'mika' } };
      },
      async reserveChatQuota() {
        return {
          allowed: true,
          disposition: 'reserved',
          roomVersion: 3,
          limit: 30,
          remaining: 29,
          resetAt: '2026-07-27T15:00:00.000Z',
        };
      },
      async refundChatQuota() {
        refundCalls += 1;
        return { limit: 30, remaining: 30, resetAt: '2026-07-27T15:00:00.000Z' };
      },
      async getRoomPromptContext() {
        if (failurePoint === 'prompt') throw new Error('prompt read failed');
        return { promptSnapshot: 'safe prompt' };
      },
      async getRoomHistoryForModel() {
        if (failurePoint === 'history') throw new Error('history read failed');
        return [];
      },
    };

    await assert.rejects(handleRoomChat({
      event: {
        headers: {},
        body: JSON.stringify({ userMessage: 'read failure refund', clientRequestId: `request-${failurePoint}` }),
      },
      headers: { 'Content-Type': 'application/json' },
      startedAtMs: Date.now(),
      traceId: `trace-${failurePoint}`,
      roomId: 'room-read-failure',
      storeOverride: store,
    }), new RegExp(`${failurePoint} read failed`));
    assert.equal(refundCalls, 1, failurePoint);
  }
});

test('content deletion commit-unknown maps to a safe retryable response', () => {
  const result = mapStoreError({
    error: Object.assign(new Error('raw database stack'), { code: 'CONTENT_DELETE_STATE_UNKNOWN' }),
    headers: { 'Content-Type': 'application/json' },
    startedAtMs: Date.now(),
    traceId: 'trace-delete-unknown',
  });
  const payload = JSON.parse(result.body);
  assert.equal(result.statusCode, 503);
  assert.equal(payload.error_code, 'CONTENT_DELETE_STATE_UNKNOWN');
  assert.equal(payload.retryable, true);
  assert.doesNotMatch(result.body, /database|stack/i);
});

test('account cleanup upload errors map to safe actionable API envelopes', () => {
  for (const [code, statusCode, retryable] of [
    ['ACCOUNT_DELETE_IN_PROGRESS', 409, false],
    ['ASSET_UPLOAD_STATE_UNKNOWN', 503, true],
  ]) {
    const result = mapStoreError({
      error: { code, message: 'SUPABASE_SERVICE_ROLE_KEY raw storage failure' },
      headers: { 'Content-Type': 'application/json' },
      startedAtMs: Date.now(),
      traceId: 'trace-cleanup-fence',
    });
    assert.equal(result.statusCode, statusCode, code);
    const payload = JSON.parse(result.body);
    assert.equal(payload.error_code, code);
    assert.equal(Boolean(payload.retryable), retryable);
    assert.doesNotMatch(result.body, /SUPABASE_SERVICE_ROLE_KEY|raw storage failure/);
  }
});
