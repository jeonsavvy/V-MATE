import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import { createCloudRunServer } from './cloud-run-server.js';
import { resetPlatformStoreForTests } from './platform/content-store.js';

const TRACKED_ENV_KEYS = [
  'REQUEST_BODY_MAX_BYTES',
  'ALLOWED_ORIGINS',
  'ALLOW_ALL_ORIGINS',
  'ALLOW_NON_BROWSER_ORIGIN',
  'V_MATE_LOG_LEVEL',
  'RATE_LIMIT_STORE',
  'PROMPT_CACHE_STORE',
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

const startServer = async (chatHandlerImpl, chatHandlerContext = {}, runtimeEnv = process.env) => {
  const server = createCloudRunServer({ chatHandlerImpl, chatHandlerContext, runtimeEnv });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const close = async () =>
    new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

  return { baseUrl, close };
};

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

const sendRawHttpRequest = ({ baseUrl, method = 'GET', path = '/', headers = {}, body = '' }) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: rawBody,
          });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });

afterEach(() => {
  restoreEnv();
  resetPlatformStoreForTests();
});

test('healthz endpoint returns ok payload', async () => {
  const { baseUrl, close } = await startServer(async () => {
    throw new Error('chat handler should not be called for /healthz');
  });

  try {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true });
  } finally {
    await close();
  }
});

test('returns public character detail payload from /api/characters/:slug', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const { baseUrl, close } = await startServer(async () => {
    throw new Error('chat handler should not be called for public character detail route');
  });

  try {
    const response = await fetch(`${baseUrl}/api/characters/mika`, {
      headers: {
        Origin: 'http://localhost:5173',
      },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.item?.slug, 'mika');
    assert.equal(payload.item?.entityType, 'character');
    assert.equal(Array.isArray(payload.item?.worlds), true);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  } finally {
    await close();
  }
});

test('creates and reads a room payload through platform room routes', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.REQUIRE_AUTH_FOR_CHAT = 'false';

  const { baseUrl, close } = await startServer(async () => {
    throw new Error('legacy chat handler should not be called during room route smoke test');
  });

  try {
    const createResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        characterSlug: 'mika',
        worldSlug: 'sao',
        userAlias: '유민',
      }),
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.room?.character?.slug, 'mika');
    assert.equal(created.room?.world?.slug, 'sao');
    assert.equal(created.room?.userAlias, '유민');
    assert.equal(typeof created.room?.bridgeProfile?.meetingTrigger, 'string');

    const getResponse = await fetch(`${baseUrl}/api/rooms/${created.room.id}`, {
      headers: {
        Origin: 'http://localhost:5173',
      },
    });

    assert.equal(getResponse.status, 200);
    const fetched = await getResponse.json();
    assert.equal(fetched.room?.id, created.room.id);
    assert.equal(Array.isArray(fetched.room?.messages), true);
    assert.equal(typeof fetched.room?.state?.relationshipState, 'string');
  } finally {
    await close();
  }
});

test('owner ops endpoint is exposed separately from commercial moderation/reporting flows', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.REQUIRE_AUTH_FOR_CHAT = 'false';

  const { baseUrl, close } = await startServer(async () => {
    throw new Error('legacy chat handler should not be called during ops route smoke test');
  });

  try {
    const response = await fetch(`${baseUrl}/api/ops/dashboard`, {
      headers: {
        Origin: 'http://localhost:5173',
      },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(Array.isArray(payload.items?.visibleCharacters), true);
    assert.equal('reports' in payload, false);
  } finally {
    await close();
  }
});

test('returns 404 for unknown path', async () => {
  const { baseUrl, close } = await startServer(async () => {
    throw new Error('chat handler should not be called for unknown path');
  });

  try {
    const response = await fetch(`${baseUrl}/unknown`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const payload = await response.json();
    assert.equal(payload.error, 'Not found');
  } finally {
    await close();
  }
});

test('routes allowed OPTIONS preflight /api/chat request to chat handler', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let observedMethod = '';
  const { baseUrl, close } = await startServer(async (event) => {
    observedMethod = event.httpMethod;
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: '',
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.equal(response.status, 200);
    assert.equal(observedMethod, 'OPTIONS');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    assert.equal(typeof response.headers.get('x-v-mate-trace-id'), 'string');
  } finally {
    await close();
  }
});

test('returns structured 403 and skips chat handler for blocked OPTIONS preflight origin', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async () => {
    called = true;
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: '',
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(typeof payload.trace_id, 'string');
    assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('returns 413 when request body exceeds configured limit', async () => {
  process.env.REQUEST_BODY_MAX_BYTES = '1024';
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async () => {
    called = true;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ payload: 'x'.repeat(2048) }),
    });

    assert.equal(response.status, 413);
    const payload = await response.json();
    assert.equal(payload.error_code, 'REQUEST_BODY_TOO_LARGE');
    assert.equal(typeof payload.trace_id, 'string');
    assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('returns 413 before body stream when content-length header exceeds limit', async () => {
  process.env.REQUEST_BODY_MAX_BYTES = '16';
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async () => {
    called = true;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  });

  try {
    const oversizedBody = 'x'.repeat(9999);
    const result = await sendRawHttpRequest({
      baseUrl,
      method: 'POST',
      path: '/api/chat',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
        'Content-Length': String(oversizedBody.length),
      },
      body: oversizedBody,
    });

    assert.equal(result.statusCode, 413);
    const payload = JSON.parse(String(result.body || '{}'));
    assert.equal(payload.error_code, 'REQUEST_BODY_TOO_LARGE');
    assert.equal(typeof payload.trace_id, 'string');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('forwards /api/chat request to provided chat handler', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const observed = { called: false, event: null };
  const { baseUrl, close } = await startServer(async (event) => {
    observed.called = true;
    observed.event = event;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, source: 'chat-handler' }),
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ userMessage: '안녕' }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true, source: 'chat-handler' });
    assert.equal(observed.called, true);
    assert.equal(observed.event.httpMethod, 'POST');
    assert.match(String(observed.event.body), /userMessage/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(typeof response.headers.get('x-v-mate-trace-id'), 'string');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('pragma'), 'no-cache');
  } finally {
    await close();
  }
});

test('forwards custom chatHandlerContext into cloud run chat handler', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const observed = { context: null };
  const { baseUrl, close } = await startServer(async (_event, context) => {
    observed.context = context;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }, {
    checkRateLimit: async () => ({
      allowed: true,
      remaining: 9,
      retryAfterMs: 0,
      limit: 10,
    }),
    promptCache: {
      get: async () => null,
    },
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ userMessage: 'context check' }),
    });

    assert.equal(response.status, 200);
    assert.equal(typeof observed.context?.checkRateLimit, 'function');
    assert.equal(typeof observed.context?.promptCache?.get, 'function');
  } finally {
    await close();
  }
});

test('falls back to empty chatHandlerContext when cloud run context resolver throws', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.V_MATE_LOG_LEVEL = 'silent';

  const observed = { context: null };
  const { baseUrl, close } = await startServer(async (_event, context) => {
    observed.context = context;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }, async () => {
    throw new Error('simulated cloud run context resolver failure');
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ userMessage: 'context fallback check' }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true });
    assert.deepEqual(observed.context, {});
  } finally {
    await close();
  }
});

test('applies fallback cors/trace/cache headers when cloud run chat handler omits them', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const { baseUrl, close } = await startServer(async () => ({
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ok: true, source: 'stub' }),
  }));

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'fallback-headers' }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(typeof response.headers.get('x-v-mate-trace-id'), 'string');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true, source: 'stub' });
  } finally {
    await close();
  }
});

test('returns structured 405 when /api/chat is requested with GET', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const { baseUrl, close } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173',
      },
    });

    const payload = await response.json();
    assert.equal(response.status, 405);
    assert.equal(payload.error_code, 'METHOD_NOT_ALLOWED');
    assert.equal(typeof payload.trace_id, 'string');
    assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await close();
  }
});

test('returns structured 403 and skips chat handler when origin is blocked', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async () => {
    called = true;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ userMessage: '차단 테스트' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(typeof payload.trace_id, 'string');
    assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('returns structured 500 with trace id when chat handler throws', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const { baseUrl, close } = await startServer(async () => {
    throw new Error('simulated cloud run handler failure');
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ userMessage: '실패 테스트' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.error_code, 'INTERNAL_SERVER_ERROR');
    assert.equal(typeof payload.trace_id, 'string');
    assert.equal(response.headers.get('x-v-mate-trace-id'), payload.trace_id);
  } finally {
    await close();
  }
});

test('allows originless request when non-browser origin mode is enabled', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'true';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async (event) => {
    called = true;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        method: event.httpMethod,
      }),
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'originless-allow' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true, method: 'POST' });
    assert.equal(called, true);
  } finally {
    await close();
  }
});

test('blocks originless request when non-browser origin mode is disabled', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async () => {
    called = true;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'originless-block' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('allows unknown origin when ALLOW_ALL_ORIGINS is enabled', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'true';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  let called = false;
  const { baseUrl, close } = await startServer(async () => {
    called = true;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: 'https://unknown-origin.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'allow-all-origin' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://unknown-origin.example');
    assert.equal(typeof response.headers.get('x-v-mate-trace-id'), 'string');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(called, true);
  } finally {
    await close();
  }
});

test('returns wildcard allow-origin for originless request when ALLOW_ALL_ORIGINS is enabled', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'true';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

  const { baseUrl, close } = await startServer(async () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  }));

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'allow-all-originless' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true });
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(typeof response.headers.get('x-v-mate-trace-id'), 'string');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  } finally {
    await close();
  }
});

test('merges runtime kv chatHandlerContext hooks when store modes are enabled', async () => {
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.RATE_LIMIT_STORE = 'kv';
  process.env.PROMPT_CACHE_STORE = 'kv';

  const rateLimitKv = new MemoryKv();
  const promptCacheKv = new MemoryKv();
  const runtimeEnv = {
    V_MATE_RATE_LIMIT_KV: rateLimitKv,
    V_MATE_PROMPT_CACHE_KV: promptCacheKv,
  };
  let observed = null;
  const { baseUrl, close } = await startServer(async (_event, context) => {
    const first = await context.checkRateLimit({ key: 'ip:127.0.0.1', defaultLimit: 2 });
    const second = await context.checkRateLimit({ key: 'ip:127.0.0.1', defaultLimit: 2 });
    const third = await context.checkRateLimit({ key: 'ip:127.0.0.1', defaultLimit: 2 });

    await context.promptCache.set('mika:cloud-run', {
      name: 'cachedContents/cloud-run-cache',
      expireAtMs: Date.now() + 60_000,
    });
    const cached = await context.promptCache.get('mika:cloud-run');
    await context.promptCache.remove('mika:cloud-run');
    observed = { first, second, third, cached };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }, {}, runtimeEnv);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userMessage: 'runtime-context' }),
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true });
    assert.equal(observed?.first?.allowed, true);
    assert.equal(observed?.second?.allowed, true);
    assert.equal(observed?.third?.allowed, false);
    assert.equal(observed?.cached?.name, 'cachedContents/cloud-run-cache');
    assert.ok(rateLimitKv.putCalls.length >= 2);
    assert.ok(promptCacheKv.deleteCalls.length >= 1);
  } finally {
    await close();
  }
});
