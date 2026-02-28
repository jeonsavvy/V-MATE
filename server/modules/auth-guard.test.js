import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  extractBearerToken,
  resolveAuthenticatedUser,
  resolveSupabaseUrlFromAccessToken,
} from './auth-guard.js';

const TRACKED_ENV_KEYS = [
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

const ORIGINAL_ENV = Object.fromEntries(TRACKED_ENV_KEYS.map((key) => [key, process.env[key]]));

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

const toBase64Url = (value) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const buildJwt = (payload) => `${toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${toBase64Url(JSON.stringify(payload))}.signature`;

afterEach(() => {
  restoreEnv();
});

test('extractBearerToken reads bearer token from mixed-case authorization header', () => {
  assert.equal(
    extractBearerToken({
      Authorization: 'Bearer token-123',
    }),
    'token-123'
  );
  assert.equal(
    extractBearerToken({
      authorization: 'bearer token-456',
    }),
    'token-456'
  );
  assert.equal(extractBearerToken({ authorization: 'Basic abcd' }), '');
  assert.equal(extractBearerToken({}), '');
});

test('resolveSupabaseUrlFromAccessToken derives project url from jwt iss', () => {
  const token = buildJwt({
    iss: 'https://demo-project.supabase.co/auth/v1',
    sub: 'user-1',
  });

  assert.equal(
    resolveSupabaseUrlFromAccessToken(token),
    'https://demo-project.supabase.co'
  );
  assert.equal(resolveSupabaseUrlFromAccessToken('invalid-token'), '');
});

test('resolveAuthenticatedUser returns bypass when auth requirement is disabled', async () => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'false';

  const result = await resolveAuthenticatedUser({
    event: { headers: {} },
  });

  assert.deepEqual(result, {
    ok: true,
    userId: '',
  });
});

test('resolveAuthenticatedUser rejects missing bearer token when auth is required', async () => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'true';
  process.env.SUPABASE_URL = 'https://demo-project.supabase.co';

  const result = await resolveAuthenticatedUser({
    event: { headers: {} },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.errorCode, 'AUTH_REQUIRED');
});

test('resolveAuthenticatedUser verifies token and returns user id on success', async () => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'true';
  process.env.SUPABASE_URL = 'https://demo-project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  const fetchCalls = [];
  const result = await resolveAuthenticatedUser({
    event: {
      headers: {
        authorization: 'Bearer user-access-token',
      },
    },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(
        JSON.stringify({
          id: 'user-123',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.userId, 'user-123');
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /auth\/v1\/user$/);
  assert.equal(fetchCalls[0].options.headers.authorization, 'Bearer user-access-token');
  assert.equal(fetchCalls[0].options.headers.apikey, 'anon-key');
});

test('resolveAuthenticatedUser retries once for transient auth provider failure', async () => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'true';
  process.env.SUPABASE_URL = 'https://demo-project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.AUTH_PROVIDER_RETRY_COUNT = '1';

  let fetchCallCount = 0;
  const result = await resolveAuthenticatedUser({
    event: {
      headers: {
        authorization: 'Bearer user-access-token',
      },
    },
    fetchImpl: async () => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        return new Response('temporary', { status: 503 });
      }

      return new Response(
        JSON.stringify({
          id: 'retry-user',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.userId, 'retry-user');
  assert.equal(fetchCallCount, 2);
});

test('resolveAuthenticatedUser maps invalid token to AUTH_UNAUTHORIZED', async () => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'true';
  process.env.SUPABASE_URL = 'https://demo-project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  const result = await resolveAuthenticatedUser({
    event: {
      headers: {
        authorization: 'Bearer invalid-token',
      },
    },
    fetchImpl: async () => new Response('unauthorized', { status: 401 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.errorCode, 'AUTH_UNAUTHORIZED');
});

test('resolveAuthenticatedUser returns AUTH_PROVIDER_NOT_CONFIGURED when anon key is missing', async () => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'true';
  process.env.SUPABASE_URL = 'https://demo-project.supabase.co';
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const result = await resolveAuthenticatedUser({
    event: {
      headers: {
        authorization: 'Bearer user-access-token',
      },
    },
    fetchImpl: async () => {
      throw new Error('fetch should not be called when anon key is missing');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.errorCode, 'AUTH_PROVIDER_NOT_CONFIGURED');
});
