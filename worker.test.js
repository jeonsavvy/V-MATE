import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import worker, { createWorker } from './worker.js';

const TRACKED_ENV_KEYS = [
  'ALLOWED_ORIGINS',
  'ALLOW_ALL_ORIGINS',
  'ALLOW_NON_BROWSER_ORIGIN',
  'REQUEST_BODY_MAX_BYTES',
  'GOOGLE_API_KEY',
  'RATE_LIMIT_STORE',
  'PROMPT_CACHE_STORE',
  'REQUIRE_AUTH_FOR_CHAT',
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

afterEach(() => {
  restoreEnv();
});

beforeEach(() => {
  process.env.REQUIRE_AUTH_FOR_CHAT = 'false';
});

test('routes /api/chat OPTIONS preflight request to chat handler', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
    },
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('returns structured 405 when /api/chat is requested with GET', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'GET',
    headers: {
      Origin: 'http://localhost:5173',
    },
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 405);
  const payload = await response.json();
  assert.equal(payload.error_code, 'METHOD_NOT_ALLOWED');
  assert.equal(typeof payload.trace_id, 'string');
  assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
  assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('returns structured 403 when preflight origin is blocked', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://malicious.example',
    },
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
});

test('returns structured 403 when post origin is blocked', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'https://malicious.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: '테스트',
      messageHistory: [],
    }),
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(typeof payload.trace_id, 'string');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('allows originless POST when non-browser mode is enabled', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: '테스트',
      messageHistory: [],
    }),
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'true',
  });

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.error_code, 'SERVER_API_KEY_NOT_CONFIGURED');
});

test('blocks originless POST when non-browser mode is disabled', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: '테스트',
      messageHistory: [],
    }),
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
});

test('allows any origin when ALLOW_ALL_ORIGINS is enabled', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'https://unknown-origin.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'allow-all-origin',
      messageHistory: [],
    }),
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'true',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://unknown-origin.example');
  const payload = await response.json();
  assert.equal(payload.error_code, 'SERVER_API_KEY_NOT_CONFIGURED');
});

test('returns wildcard allow-origin when ALLOW_ALL_ORIGINS is enabled for originless request', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'allow-all-originless',
      messageHistory: [],
    }),
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'true',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  const payload = await response.json();
  assert.equal(payload.error_code, 'SERVER_API_KEY_NOT_CONFIGURED');
});

test('returns structured 413 when chat request body exceeds worker read limit', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'x'.repeat(5000),
      messageHistory: [],
    }),
  });

  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
    REQUEST_BODY_MAX_BYTES: '1024',
  });

  assert.equal(response.status, 413);
  const payload = await response.json();
  assert.equal(payload.error_code, 'REQUEST_BODY_TOO_LARGE');
  assert.equal(typeof payload.trace_id, 'string');
  assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
});

test('applies fallback cors/trace/cache headers when chat handler omits them', async () => {
  const isolatedWorker = createWorker({
    chatHandlerImpl: async () => ({
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true }),
    }),
  });

  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'header-fallback',
      messageHistory: [],
    }),
  });

  const response = await isolatedWorker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(typeof response.headers.get('x-v-mate-trace-id'), 'string');
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true });
});

test('forwards custom chatHandlerContext into worker chat handler', async () => {
  const observed = { context: null };
  const isolatedWorker = createWorker({
    chatHandlerContext: {
      checkRateLimit: async () => ({
        allowed: false,
        remaining: 0,
        retryAfterMs: 1200,
        limit: 3,
      }),
      promptCache: {
        get: async () => null,
      },
    },
    chatHandlerImpl: async (_event, context) => {
      observed.context = context;
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Too many requests. Please try again later.',
          error_code: 'RATE_LIMIT_EXCEEDED',
          trace_id: 'trace-custom-context',
          retryable: true,
        }),
      };
    },
  });

  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'context test',
      messageHistory: [],
    }),
  });

  const response = await isolatedWorker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 429);
  assert.equal(typeof observed.context?.checkRateLimit, 'function');
  assert.equal(typeof observed.context?.promptCache?.get, 'function');
});

test('falls back to empty chatHandlerContext when worker context resolver throws', async () => {
  const observed = { context: null };
  const isolatedWorker = createWorker({
    chatHandlerContext: async () => {
      throw new Error('simulated worker context resolver failure');
    },
    chatHandlerImpl: async (_event, context) => {
      observed.context = context;
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ok: true,
        }),
      };
    },
  });

  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'context fallback',
      messageHistory: [],
    }),
  });

  const response = await isolatedWorker.fetch(request, {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true });
  assert.deepEqual(observed.context, {});
});

test('builds runtime kv chatHandlerContext when kv store modes are enabled', async () => {
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

  const rateLimitKv = new MemoryKv();
  const promptCacheKv = new MemoryKv();
  let observed = null;

  const isolatedWorker = createWorker({
    chatHandlerImpl: async (_event, context) => {
      const first = await context.checkRateLimit({ key: 'ip:127.0.0.1', defaultLimit: 2 });
      const second = await context.checkRateLimit({ key: 'ip:127.0.0.1', defaultLimit: 2 });
      const third = await context.checkRateLimit({ key: 'ip:127.0.0.1', defaultLimit: 2 });

      await context.promptCache.set('mika:runtime', {
        name: 'cachedContents/runtime-cache',
        expireAtMs: Date.now() + 60_000,
      });
      const cached = await context.promptCache.get('mika:runtime');
      await context.promptCache.remove('mika:runtime');

      observed = { first, second, third, cached };

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ok: true,
        }),
      };
    },
  });

  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      characterId: 'mika',
      userMessage: 'runtime kv context',
      messageHistory: [],
    }),
  });

  const env = {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
    RATE_LIMIT_STORE: 'kv',
    PROMPT_CACHE_STORE: 'kv',
    V_MATE_RATE_LIMIT_KV: rateLimitKv,
    V_MATE_PROMPT_CACHE_KV: promptCacheKv,
  };

  const response = await isolatedWorker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(observed?.first?.allowed, true);
  assert.equal(observed?.second?.allowed, true);
  assert.equal(observed?.third?.allowed, false);
  assert.equal(observed?.cached?.name, 'cachedContents/runtime-cache');
  assert.ok(rateLimitKv.putCalls.length >= 2);
  assert.ok(promptCacheKv.deleteCalls.length >= 1);
});

test('injects runtime env script into html responses', async () => {
  const request = new Request('https://example.com/', {
    method: 'GET',
    headers: {
      accept: 'text/html',
    },
  });

  const response = await worker.fetch(request, {
    ASSETS: {
      fetch: async () =>
        new Response('<html><head></head><body>Hello</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
    VITE_CHAT_API_BASE_URL: 'https://api.example.com',
  });

  const html = await response.text();
  assert.match(html, /window\.__V_MATE_RUNTIME_ENV__=/);
  assert.match(html, /VITE_CHAT_API_BASE_URL/);
});

test('serves index.html fallback for html route miss', async () => {
  const calledPaths = [];
  const request = new Request('https://example.com/chat/mika', {
    method: 'GET',
    headers: {
      accept: 'text/html',
    },
  });

  const response = await worker.fetch(request, {
    ASSETS: {
      fetch: async (incomingRequest) => {
        const url = new URL(incomingRequest.url);
        calledPaths.push(url.pathname);

        if (url.pathname === '/chat/mika') {
          return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
        }

        if (url.pathname === '/index.html') {
          return new Response('<html><head></head><body>SPA</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }

        return new Response('Unexpected path', { status: 500 });
      },
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /SPA/);
  assert.deepEqual(calledPaths, ['/chat/mika', '/index.html']);
});

test('does not inject runtime env script for non-html static assets', async () => {
  const request = new Request('https://example.com/assets/app.js', {
    method: 'GET',
    headers: {
      accept: '*/*',
    },
  });

  const response = await worker.fetch(request, {
    ASSETS: {
      fetch: async () =>
        new Response('console.log("ok")', {
          status: 200,
          headers: { 'content-type': 'application/javascript' },
        }),
    },
    VITE_CHAT_API_BASE_URL: 'https://api.example.com',
  });

  const body = await response.text();
  assert.equal(body, 'console.log("ok")');
  assert.equal(response.headers.get('content-type'), 'application/javascript');
});
