import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { handler } from './chat-handler.js';
import { resetRateLimitStoreForTests } from './modules/http-policy.js';
import { resetRequestDedupeStoresForTests } from './modules/request-dedupe.js';

const TRACKED_ENV_KEYS = [
  'GOOGLE_API_KEY',
  'ALLOWED_ORIGINS',
  'ALLOW_ALL_ORIGINS',
  'ALLOW_NON_BROWSER_ORIGIN',
  'TRUST_X_FORWARDED_FOR',
  'TRUST_PROXY_HEADERS',
  'REQUIRE_JSON_CONTENT_TYPE',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'REQUEST_BODY_MAX_BYTES',
  'GEMINI_CONTEXT_CACHE_ENABLED',
  'GEMINI_CONTEXT_CACHE_AUTO_CREATE',
  'GEMINI_NETWORK_RECOVERY_RETRY_ENABLED',
  'GEMINI_CACHE_LOOKUP_RETRY_ENABLED',
  'GEMINI_EMPTY_RESPONSE_RETRY_ENABLED',
  'GEMINI_MODEL_TIMEOUT_MS',
  'FUNCTION_TOTAL_TIMEOUT_MS',
  'FUNCTION_TIMEOUT_GUARD_MS',
  'GEMINI_MAX_OUTPUT_TOKENS',
  'GEMINI_HISTORY_MESSAGES',
  'GEMINI_MAX_PART_CHARS',
  'GEMINI_MAX_SYSTEM_PROMPT_CHARS',
  'CLOUDFLARE_DEV',
  'CLIENT_REQUEST_DEDUPE_WINDOW_MS',
  'CLIENT_REQUEST_DEDUPE_MAX_ENTRIES',
];

const ORIGINAL_ENV = Object.fromEntries(TRACKED_ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_WARN = console.warn;
const ORIGINAL_CONSOLE_ERROR = console.error;

const restoreTrackedEnv = () => {
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
  console.error = () => {};
  resetRateLimitStoreForTests();
  resetRequestDedupeStoresForTests();
});

afterEach(() => {
  restoreTrackedEnv();
  globalThis.fetch = ORIGINAL_FETCH;
  console.warn = ORIGINAL_CONSOLE_WARN;
  console.error = ORIGINAL_CONSOLE_ERROR;
});

const applyBaseEnv = (overrides = {}) => {
  const baseEnv = {
    GOOGLE_API_KEY: 'unit-test-api-key',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ALLOW_ALL_ORIGINS: 'false',
    ALLOW_NON_BROWSER_ORIGIN: 'false',
    TRUST_X_FORWARDED_FOR: 'false',
    TRUST_PROXY_HEADERS: 'false',
    REQUIRE_JSON_CONTENT_TYPE: 'false',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '1000',
    REQUEST_BODY_MAX_BYTES: '32768',
    GEMINI_CONTEXT_CACHE_ENABLED: 'false',
    GEMINI_CONTEXT_CACHE_AUTO_CREATE: 'false',
    GEMINI_NETWORK_RECOVERY_RETRY_ENABLED: 'false',
    GEMINI_CACHE_LOOKUP_RETRY_ENABLED: 'false',
    GEMINI_EMPTY_RESPONSE_RETRY_ENABLED: 'false',
    GEMINI_MODEL_TIMEOUT_MS: '5000',
    FUNCTION_TOTAL_TIMEOUT_MS: '10000',
    FUNCTION_TIMEOUT_GUARD_MS: '1000',
    GEMINI_MAX_OUTPUT_TOKENS: '256',
    GEMINI_HISTORY_MESSAGES: '10',
    GEMINI_MAX_PART_CHARS: '700',
    GEMINI_MAX_SYSTEM_PROMPT_CHARS: '5000',
    CLOUDFLARE_DEV: 'false',
  };

  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    process.env[key] = String(value);
  }
};

const makeEvent = ({
  method = 'POST',
  origin = 'http://localhost:5173',
  body,
  ip,
  apiVersion,
  userAgent = 'unit-test-agent',
  extraHeaders = {},
}) => {
  const headers = {
    'content-type': 'application/json',
    ...(origin ? { origin } : {}),
    ...(ip ? { 'cf-connecting-ip': ip } : {}),
    ...(userAgent ? { 'user-agent': userAgent } : {}),
    ...(apiVersion ? { 'x-v-mate-api-version': String(apiVersion) } : {}),
    ...extraHeaders,
  };

  return {
    httpMethod: method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  };
};

const parseBody = (result) => {
  try {
    return JSON.parse(result.body || '{}');
  } catch {
    return {};
  }
};

test('returns 403 when origin is not in allowlist', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for rejected origin');
  };

  const result = await handler(
    makeEvent({
      origin: 'https://evil.example',
      body: {
        characterId: 'mika',
        userMessage: '안녕',
        messageHistory: [],
      },
      ip: '198.51.100.11',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 403);
  assert.match(String(result.body), /Origin is not allowed/i);
  assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
});

test('returns 405 with structured error when method is not POST', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for method mismatch');
  };

  const result = await handler(
    makeEvent({
      method: 'GET',
      body: '',
      ip: '198.51.100.20',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 405);
  assert.equal(payload.error_code, 'METHOD_NOT_ALLOWED');
  assert.equal(typeof payload.trace_id, 'string');
  assert.equal(result.headers['X-V-MATE-Error-Code'], 'METHOD_NOT_ALLOWED');
  assert.equal(typeof result.headers['X-V-MATE-Elapsed-Ms'], 'string');
  assert.equal(result.headers.Allow, 'POST, OPTIONS');
  assert.equal(result.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(result.headers.Pragma, 'no-cache');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
});

test('returns structured 403 for disallowed OPTIONS preflight origin', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for rejected preflight');
  };

  const result = await handler(
    makeEvent({
      method: 'OPTIONS',
      origin: 'https://evil.example',
      body: '',
      ip: '198.51.100.21',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 403);
  assert.equal(payload.error_code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(typeof payload.trace_id, 'string');
});

test('returns 413 for oversized request body', async () => {
  applyBaseEnv({ REQUEST_BODY_MAX_BYTES: '1024' });
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for oversized body');
  };

  const result = await handler(
    makeEvent({
      body: JSON.stringify({ payload: 'x'.repeat(2048) }),
      ip: '198.51.100.12',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 413);
  assert.equal(payload.error_code, 'REQUEST_BODY_TOO_LARGE');
});

test('returns 400 for invalid characterId schema', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'invalid-character',
        userMessage: '안녕',
        messageHistory: [],
      },
      ip: '198.51.100.13',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_CHARACTER_ID');
});

test('returns 400 for invalid messageHistory schema', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: '안녕',
        messageHistory: 'invalid-history',
      },
      ip: '198.51.100.130',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_MESSAGE_HISTORY');
});

test('returns 400 for invalid clientRequestId schema', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: '안녕',
        messageHistory: [],
        clientRequestId: 'invalid request id',
      },
      ip: '198.51.100.131',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_CLIENT_REQUEST_ID');
});

test('returns 400 when userMessage exceeds max length', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'x'.repeat(1201),
        messageHistory: [],
      },
      ip: '198.51.100.132',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_USER_MESSAGE');
});

test('returns 400 when messageHistory exceeds max items', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const tooManyHistory = Array.from({ length: 51 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `item-${index}`,
  }));

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'history-limit',
        messageHistory: tooManyHistory,
      },
      ip: '198.51.100.133',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_MESSAGE_HISTORY');
});

test('returns 400 when messageHistory item content exceeds max length', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'history-content-limit',
        messageHistory: [
          {
            role: 'assistant',
            content: {
              response: 'x'.repeat(1201),
            },
          },
        ],
      },
      ip: '198.51.100.134',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_MESSAGE_HISTORY');
});

test('returns 400 when cachedContent exceeds max length', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'cached-content-limit',
        messageHistory: [],
        cachedContent: `cachedContents/${'x'.repeat(260)}`,
      },
      ip: '198.51.100.135',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_CACHED_CONTENT');
});

test('returns 400 when cachedContent format is invalid', async () => {
  applyBaseEnv();
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for invalid request schema');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'cached-content-format',
        messageHistory: [],
        cachedContent: 'invalid-cache-format',
      },
      ip: '198.51.100.236',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 400);
  assert.equal(payload.error_code, 'INVALID_CACHED_CONTENT');
});

test('returns 415 when content-type is not application/json and strict mode is enabled', async () => {
  applyBaseEnv({
    REQUIRE_JSON_CONTENT_TYPE: 'true',
  });
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for unsupported content type');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'content-type-test',
        messageHistory: [],
      },
      extraHeaders: {
        'content-type': 'text/plain',
      },
      ip: '198.51.100.136',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 415);
  assert.equal(payload.error_code, 'UNSUPPORTED_CONTENT_TYPE');
});

test('returns ChatResponseV2 shape when request succeeds', async () => {
  applyBaseEnv();

  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    assert.match(String(url), /generateContent\?key=/);

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"happy","inner_heart":"기분 좋아","response":"안녕, 선생님!"}',
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

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: '첫 인사야',
        messageHistory: [],
        clientRequestId: 'web-req-1',
      },
      ip: '198.51.100.14',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 200);
  assert.equal(payload.api_version, '2');
  assert.equal(typeof payload.trace_id, 'string');
  assert.equal(typeof payload.cachedContent, 'object');
  assert.equal(payload.cachedContent, null);
  assert.equal(result.headers['X-V-MATE-Client-Request-Id'], 'web-req-1');
  assert.equal(result.headers['X-V-MATE-Dedupe-Status'], 'fresh');
  assert.equal(result.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(result.headers.Pragma, 'no-cache');
  assert.deepEqual(payload.message, {
    emotion: 'happy',
    inner_heart: '기분 좋아',
    response: '안녕, 선생님!',
    narration: '',
  });
  assert.equal(fetchCalls, 1);
});

test('reuses deduped successful response for same clientRequestId and payload', async () => {
  applyBaseEnv({
    CLIENT_REQUEST_DEDUPE_WINDOW_MS: '15000',
    CLIENT_REQUEST_DEDUPE_MAX_ENTRIES: '2000',
  });

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"중복 방지 응답"}',
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

  const event = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: '같은 요청',
      messageHistory: [],
      clientRequestId: 'web-dedupe-1',
    },
    ip: '198.51.100.240',
  });

  const first = await handler(event, {});
  const second = await handler(event, {});
  const firstPayload = parseBody(first);
  const secondPayload = parseBody(second);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['X-V-MATE-Dedupe-Status'], 'fresh');
  assert.equal(second.headers['X-V-MATE-Dedupe-Status'], 'replay');
  assert.equal(firstPayload.message.response, '중복 방지 응답');
  assert.equal(secondPayload.message.response, '중복 방지 응답');
  assert.equal(fetchCalls, 1);
});

test('does not dedupe when payload differs even with same clientRequestId', async () => {
  applyBaseEnv({
    CLIENT_REQUEST_DEDUPE_WINDOW_MS: '15000',
    CLIENT_REQUEST_DEDUPE_MAX_ENTRIES: '2000',
  });

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: `{\"emotion\":\"normal\",\"inner_heart\":\"\",\"response\":\"요청-${fetchCalls}\"}`,
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

  const first = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: '첫 요청',
        messageHistory: [],
        clientRequestId: 'web-dedupe-same-id',
      },
      ip: '198.51.100.241',
    }),
    {}
  );
  const second = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: '다른 요청',
        messageHistory: [],
        clientRequestId: 'web-dedupe-same-id',
      },
      ip: '198.51.100.241',
    }),
    {}
  );

  const firstPayload = parseBody(first);
  const secondPayload = parseBody(second);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['X-V-MATE-Dedupe-Status'], 'fresh');
  assert.equal(second.headers['X-V-MATE-Dedupe-Status'], 'fresh');
  assert.equal(firstPayload.message.response, '요청-1');
  assert.equal(secondPayload.message.response, '요청-2');
  assert.equal(fetchCalls, 2);
});

test('marks second concurrent request as inflight dedupe hit', async () => {
  applyBaseEnv({
    CLIENT_REQUEST_DEDUPE_WINDOW_MS: '15000',
    CLIENT_REQUEST_DEDUPE_MAX_ENTRIES: '2000',
  });

  let fetchCalls = 0;
  let releaseFetch = () => {};
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  globalThis.fetch = async () => {
    fetchCalls += 1;
    await fetchGate;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"동시 요청 응답"}',
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

  const event = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: '동시 요청 테스트',
      messageHistory: [],
      clientRequestId: 'web-dedupe-inflight-1',
    },
    ip: '198.51.100.242',
  });

  const firstPromise = handler(event, {});
  while (fetchCalls === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const secondPromise = handler(event, {});
  releaseFetch();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const firstPayload = parseBody(first);
  const secondPayload = parseBody(second);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['X-V-MATE-Dedupe-Status'], 'fresh');
  assert.equal(second.headers['X-V-MATE-Dedupe-Status'], 'inflight');
  assert.equal(firstPayload.message.response, '동시 요청 응답');
  assert.equal(secondPayload.message.response, '동시 요청 응답');
  assert.equal(fetchCalls, 1);
});

test('returns V1-compatible text payload when api version is 1', async () => {
  applyBaseEnv();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"응답 테스트"}',
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

  const result = await handler(
    makeEvent({
      apiVersion: '1',
      body: {
        characterId: 'alice',
        userMessage: '테스트',
        messageHistory: [],
      },
      ip: '198.51.100.15',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 200);
  assert.equal(payload.api_version, '1');
  assert.equal(typeof payload.text, 'string');
  assert.equal(result.headers['X-V-MATE-Dedupe-Status'], 'bypass');

  const parsedText = JSON.parse(payload.text);
  assert.deepEqual(parsedText, {
    emotion: 'normal',
    inner_heart: '',
    response: '응답 테스트',
    narration: '',
  });
  assert.ok(!('message' in payload));
});

test('returns retryable upstream connection error when fetch fails', async () => {
  applyBaseEnv({
    GEMINI_NETWORK_RECOVERY_RETRY_ENABLED: 'false',
  });

  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'kael',
        userMessage: '연결 테스트',
        messageHistory: [],
      },
      ip: '198.51.100.16',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 503);
  assert.equal(payload.error_code, 'UPSTREAM_CONNECTION_FAILED');
  assert.equal(payload.retryable, true);
});

test('returns retryable upstream timeout when fetch is aborted by timeout budget', async () => {
  applyBaseEnv({
    GEMINI_MODEL_TIMEOUT_MS: '10',
    FUNCTION_TOTAL_TIMEOUT_MS: '2000',
    FUNCTION_TIMEOUT_GUARD_MS: '1',
    GEMINI_NETWORK_RECOVERY_RETRY_ENABLED: 'false',
  });

  globalThis.fetch = async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: '타임아웃 테스트',
        messageHistory: [],
      },
      ip: '198.51.100.17',
    }),
    {}
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 504);
  assert.equal(payload.error_code, 'UPSTREAM_TIMEOUT');
  assert.equal(payload.retryable, true);
});

test('returns structured payload when rate limit is exceeded', async () => {
  applyBaseEnv({
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '1',
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"첫 응답"}',
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

  const event = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: 'rate test',
      messageHistory: [],
    },
    ip: '198.51.100.172',
  });

  const first = await handler(event, {});
  assert.equal(first.statusCode, 200);

  const second = await handler(event, {});
  const payload = parseBody(second);
  assert.equal(second.statusCode, 429);
  assert.equal(payload.error_code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(payload.retryable, true);
  assert.equal(typeof payload.trace_id, 'string');
  assert.equal(second.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(second.headers.Pragma, 'no-cache');
  assert.equal(second.headers['X-V-MATE-RateLimit-Limit'], '1');
  assert.equal(second.headers['X-V-MATE-RateLimit-Remaining'], '0');
  assert.equal(second.headers['Retry-After'], '60');
});

test('uses context checkRateLimit hook when provided', async () => {
  applyBaseEnv({
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '10',
  });

  let hookCalled = false;
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called when custom limiter denies request');
  };

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'custom limiter',
        messageHistory: [],
      },
      ip: '198.51.100.188',
    }),
    {
      checkRateLimit: async ({ key, origin, defaultLimit }) => {
        hookCalled = true;
        assert.equal(typeof key, 'string');
        assert.equal(origin, 'http://localhost:5173');
        assert.equal(defaultLimit, 10);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: 9000,
          limit: 2,
        };
      },
    }
  );

  const payload = parseBody(result);
  assert.equal(hookCalled, true);
  assert.equal(result.statusCode, 429);
  assert.equal(payload.error_code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(result.headers['X-V-MATE-RateLimit-Limit'], '2');
  assert.equal(result.headers['X-V-MATE-RateLimit-Remaining'], '0');
  assert.equal(result.headers['Retry-After'], '9');
});

test('falls back to default limiter when context checkRateLimit hook throws', async () => {
  applyBaseEnv({
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '1',
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"fallback limiter"}',
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

  const context = {
    checkRateLimit: async () => {
      throw new Error('custom limiter unavailable');
    },
  };

  const event = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: 'fallback limiter test',
      messageHistory: [],
    },
    ip: '198.51.100.189',
  });

  const first = await handler(event, context);
  assert.equal(first.statusCode, 200);

  const second = await handler(event, context);
  const payload = parseBody(second);
  assert.equal(second.statusCode, 429);
  assert.equal(payload.error_code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(second.headers['X-V-MATE-RateLimit-Limit'], '1');
});

test('uses prompt cache adapter get/set hooks when context cache is enabled', async () => {
  applyBaseEnv({
    GEMINI_CONTEXT_CACHE_ENABLED: 'true',
  });

  const calls = {
    get: [],
    set: [],
    remove: [],
  };

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"adapter cache ok"}',
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

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'prompt cache adapter test',
        messageHistory: [],
      },
      ip: '198.51.100.190',
    }),
    {
      promptCache: {
        get: async (cacheKey) => {
          calls.get.push(cacheKey);
          return {
            name: 'cachedContents/adapter-entry',
            expireAtMs: Date.now() + 60_000,
          };
        },
        set: async (cacheKey, entry) => {
          calls.set.push({ cacheKey, entry });
        },
        remove: async (cacheKey) => {
          calls.remove.push(cacheKey);
        },
      },
    }
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 200);
  assert.equal(payload.cachedContent, 'cachedContents/adapter-entry');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.set.length, 1);
  assert.equal(calls.remove.length, 0);
  assert.match(String(calls.set[0].cacheKey || ''), /^mika:/);
  assert.equal(calls.set[0].entry?.name, 'cachedContents/adapter-entry');
});

test('removes prompt cache entry through adapter on format fallback error', async () => {
  applyBaseEnv({
    GEMINI_CONTEXT_CACHE_ENABLED: 'true',
  });

  const calls = {
    remove: [],
  };

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"happy"',
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

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'prompt cache remove test',
        messageHistory: [],
      },
      ip: '198.51.100.191',
    }),
    {
      promptCache: {
        get: async () => ({
          name: 'cachedContents/adapter-entry',
          expireAtMs: Date.now() + 60_000,
        }),
        remove: async (cacheKey) => {
          calls.remove.push(cacheKey);
        },
      },
    }
  );

  const payload = parseBody(result);
  assert.equal(result.statusCode, 502);
  assert.equal(payload.error_code, 'UPSTREAM_INVALID_FORMAT');
  assert.equal(calls.remove.length, 1);
  assert.match(String(calls.remove[0] || ''), /^mika:/);
});

test('includes rate limit headers in successful response', async () => {
  applyBaseEnv({
    RATE_LIMIT_MAX_REQUESTS: '5',
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"헤더 테스트"}',
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

  const result = await handler(
    makeEvent({
      body: {
        characterId: 'mika',
        userMessage: 'rate-limit 헤더 확인',
        messageHistory: [],
      },
      ip: '198.51.100.171',
    }),
    {}
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['X-V-MATE-RateLimit-Limit'], '5');
  assert.equal(result.headers['X-V-MATE-RateLimit-Remaining'], '4');
  assert.equal(result.headers['X-V-MATE-RateLimit-Reset'], '60');
  assert.match(String(result.headers['Access-Control-Expose-Headers'] || ''), /X-V-MATE-Trace-Id/i);
  assert.match(String(result.headers['Access-Control-Expose-Headers'] || ''), /X-V-MATE-Dedupe-Status/i);
  assert.match(String(result.headers['Access-Control-Expose-Headers'] || ''), /Retry-After/i);
});

test('blocks forwarded-for spoof bypass when proxy headers are not trusted', async () => {
  applyBaseEnv({
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '1',
    TRUST_PROXY_HEADERS: 'false',
    TRUST_X_FORWARDED_FOR: 'true',
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"ok"}',
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

  const eventA = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: 'spoof-test-a',
      messageHistory: [],
    },
    extraHeaders: {
      'x-forwarded-for': '203.0.113.10',
    },
    userAgent: 'same-agent',
  });

  const eventB = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: 'spoof-test-b',
      messageHistory: [],
    },
    extraHeaders: {
      'x-forwarded-for': '203.0.113.11',
    },
    userAgent: 'same-agent',
  });

  const first = await handler(eventA, {});
  const second = await handler(eventB, {});

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
});

test('allows forwarded-for segmentation when proxy headers are explicitly trusted', async () => {
  applyBaseEnv({
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '1',
    TRUST_PROXY_HEADERS: 'true',
    TRUST_X_FORWARDED_FOR: 'true',
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"emotion":"normal","inner_heart":"","response":"ok"}',
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

  const eventA = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: 'trusted-proxy-a',
      messageHistory: [],
    },
    extraHeaders: {
      'x-forwarded-for': '203.0.113.20',
    },
  });

  const eventB = makeEvent({
    body: {
      characterId: 'mika',
      userMessage: 'trusted-proxy-b',
      messageHistory: [],
    },
    extraHeaders: {
      'x-forwarded-for': '203.0.113.21',
    },
  });

  const first = await handler(eventA, {});
  const second = await handler(eventB, {});

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
});
