import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const REQUIRED_FRONTEND_ERROR_MAPPINGS = [
  'REQUEST_BODY_TOO_LARGE',
  'INVALID_CHARACTER_ID',
  'INVALID_USER_MESSAGE',
  'INVALID_MESSAGE_HISTORY',
  'INVALID_CACHED_CONTENT',
  'INVALID_CLIENT_REQUEST_ID',
  'UNSUPPORTED_CONTENT_TYPE',
  'METHOD_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED',
  'AUTH_REQUIRED',
  'AUTH_UNAUTHORIZED',
  'AUTH_PROVIDER_NOT_CONFIGURED',
  'AUTH_PROVIDER_TIMEOUT',
  'AUTH_PROVIDER_UNAVAILABLE',
  'AUTH_PROVIDER_ERROR',
  'AUTH_PROVIDER_INVALID_RESPONSE',
  'SERVER_API_KEY_NOT_CONFIGURED',
  'INTERNAL_SERVER_ERROR',
  'RATE_LIMIT_EXCEEDED',
  'UPSTREAM_CONNECTION_FAILED',
  'UPSTREAM_TIMEOUT',
  'FUNCTION_BUDGET_TIMEOUT',
  'UPSTREAM_EMPTY_RESPONSE',
  'UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS',
  'UPSTREAM_LOCATION_UNSUPPORTED',
  'UPSTREAM_INVALID_RESPONSE',
  'UPSTREAM_INVALID_FORMAT',
  'UPSTREAM_MODEL_ERROR',
];

const extractCaseLabels = (source) => {
  const matches = source.matchAll(/case "([A-Z0-9_]+)":/g);
  return new Set(Array.from(matches, (match) => match[1]));
};

test('frontend error mapper covers core backend/server error codes', async () => {
  const apiClientSource = await readFile(
    path.join(repoRoot, 'src/lib/chat/apiClient.ts'),
    'utf8'
  );

  const mappedCodes = extractCaseLabels(apiClientSource);
  for (const requiredCode of REQUIRED_FRONTEND_ERROR_MAPPINGS) {
    assert.ok(
      mappedCodes.has(requiredCode),
      `mapChatApiErrorMessage is missing case for ${requiredCode}`
    );
  }

  assert.ok(
    apiClientSource.includes('x-v-mate-error-code'),
    'apiClient should read X-V-MATE-Error-Code response header as fallback'
  );
});
