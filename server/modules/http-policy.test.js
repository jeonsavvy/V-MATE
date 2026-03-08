import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  buildHeaders,
  checkRateLimit,
  getClientKey,
  isOriginAllowed,
  normalizeOrigin,
  parseAllowedOrigins,
  resetAllowedOriginCacheForTests,
  resetRateLimitStoreForTests,
} from './http-policy.js';

const TRACKED_ENV_KEYS = [
  'ALLOWED_ORIGINS',
  'ALLOW_ALL_ORIGINS',
  'ALLOW_NON_BROWSER_ORIGIN',
  'TRUST_PROXY_HEADERS',
  'TRUST_X_FORWARDED_FOR',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'RATE_LIMIT_MAX_KEYS',
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
  resetRateLimitStoreForTests();
  resetAllowedOriginCacheForTests();
});

test('parses and validates origin allowlist with non-browser toggle', () => {
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example/';

  const allowlist = parseAllowedOrigins();
  assert.equal(allowlist.has('https://a.example'), true);
  assert.equal(allowlist.has('https://b.example'), true);
  assert.equal(normalizeOrigin('https://b.example/'), 'https://b.example');
  assert.equal(isOriginAllowed('https://a.example'), true);
  assert.equal(isOriginAllowed('https://unknown.example'), false);
  assert.equal(isOriginAllowed(undefined), false);

  process.env.ALLOW_NON_BROWSER_ORIGIN = 'true';
  assert.equal(isOriginAllowed(undefined), true);
});

test('ALLOW_ALL_ORIGINS overrides allowlist and originless checks', () => {
  process.env.ALLOW_ALL_ORIGINS = 'true';
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOWED_ORIGINS = 'https://only-this-origin.example';

  assert.equal(isOriginAllowed('https://unknown.example'), true);
  assert.equal(isOriginAllowed(undefined), true);
});

test('allows originless same-origin browser fetches with standard fetch metadata', () => {
  process.env.ALLOW_ALL_ORIGINS = 'false';
  process.env.ALLOW_NON_BROWSER_ORIGIN = 'false';
  process.env.ALLOWED_ORIGINS = 'https://only-this-origin.example';

  assert.equal(
    isOriginAllowed(undefined, 'http://localhost:8787', {
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    }),
    true
  );
  assert.equal(
    isOriginAllowed(undefined, 'http://localhost:8787', {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
    }),
    false
  );
});

test('reuses parsed allowlist for same env value and refreshes when env changes', () => {
  process.env.ALLOWED_ORIGINS = 'https://a.example,https://b.example/';
  const first = parseAllowedOrigins();
  const second = parseAllowedOrigins();

  assert.equal(first, second);
  assert.equal(first.has('https://b.example'), true);

  process.env.ALLOWED_ORIGINS = 'https://c.example';
  const third = parseAllowedOrigins();

  assert.notEqual(third, first);
  assert.equal(third.has('https://a.example'), false);
  assert.equal(third.has('https://c.example'), true);
});

test('builds client key with ip > fingerprint > anonymous priority', () => {
  const keyFromIp = getClientKey(
    {
      headers: {
        'cf-ray': '8f1234abcd',
        'cf-connecting-ip': '198.51.100.10',
      },
    },
    'https://a.example'
  );
  assert.equal(keyFromIp, 'ip:198.51.100.10');

  const keyFromFingerprint = getClientKey(
    {
      headers: {
        origin: 'https://a.example',
        'user-agent': 'UnitTestUA',
      },
    },
    'https://a.example'
  );
  assert.match(keyFromFingerprint, /^fingerprint:[a-f0-9]{16}$/);

  const keyFromAnonymous = getClientKey({ headers: {} }, '');
  assert.equal(keyFromAnonymous, 'anonymous:unknown');
});

test('ignores spoofable proxy ip headers unless trusted', () => {
  process.env.TRUST_PROXY_HEADERS = 'false';
  process.env.TRUST_X_FORWARDED_FOR = 'true';

  const keyWithoutTrust = getClientKey(
    {
      headers: {
        'cf-connecting-ip': '203.0.113.12',
        'x-real-ip': '203.0.113.13',
        'x-forwarded-for': '203.0.113.14',
        origin: 'https://a.example',
        'user-agent': 'UnitTestUA',
      },
    },
    'https://a.example'
  );
  assert.match(keyWithoutTrust, /^fingerprint:[a-f0-9]{16}$/);

  process.env.TRUST_PROXY_HEADERS = 'true';
  const keyWithTrust = getClientKey(
    {
      headers: {
        'cf-connecting-ip': '203.0.113.12',
      },
    },
    'https://a.example'
  );
  assert.equal(keyWithTrust, 'ip:203.0.113.12');
});

test('enforces rate limit request count within window', () => {
  process.env.RATE_LIMIT_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_MAX_REQUESTS = '2';
  process.env.RATE_LIMIT_MAX_KEYS = '100';

  const key = 'rate-limit-count-test';
  const first = checkRateLimit(key);
  const second = checkRateLimit(key);
  const third = checkRateLimit(key);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test('evicts oldest key when rate-limit key capacity is exceeded', () => {
  process.env.RATE_LIMIT_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_MAX_REQUESTS = '1';
  process.env.RATE_LIMIT_MAX_KEYS = '2';

  const base = `capacity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const keyA = `${base}-a`;
  const keyB = `${base}-b`;
  const keyC = `${base}-c`;

  assert.equal(checkRateLimit(keyA).allowed, true);
  assert.equal(checkRateLimit(keyB).allowed, true);
  assert.equal(checkRateLimit(keyC).allowed, true);

  const aAfterEviction = checkRateLimit(keyA);
  assert.equal(aAfterEviction.allowed, true);
});

test('buildHeaders returns null origin when request origin is blocked', () => {
  const allowedHeaders = buildHeaders(true, 'https://a.example');
  assert.equal(allowedHeaders['Access-Control-Allow-Origin'], 'https://a.example');
  assert.match(
    String(allowedHeaders['Access-Control-Expose-Headers'] || ''),
    /X-V-MATE-Trace-Id/i
  );
  assert.match(
    String(allowedHeaders['Access-Control-Expose-Headers'] || ''),
    /X-V-MATE-Elapsed-Ms/i
  );
  assert.match(
    String(allowedHeaders['Access-Control-Expose-Headers'] || ''),
    /Retry-After/i
  );
  assert.equal(allowedHeaders['Cache-Control'], 'no-store, max-age=0');
  assert.equal(allowedHeaders['Pragma'], 'no-cache');
  assert.equal(allowedHeaders['X-Content-Type-Options'], 'nosniff');

  const deniedHeaders = buildHeaders(false, 'https://a.example');
  assert.equal(deniedHeaders['Access-Control-Allow-Origin'], 'null');
  assert.match(
    String(deniedHeaders['Access-Control-Expose-Headers'] || ''),
    /X-V-MATE-RateLimit-Limit/i
  );
  assert.equal(deniedHeaders['Cache-Control'], 'no-store, max-age=0');
  assert.equal(deniedHeaders['Pragma'], 'no-cache');
  assert.equal(deniedHeaders['X-Content-Type-Options'], 'nosniff');
});
