import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapGeminiApiError } from './upstream-error-map.js';

test('maps location unsupported message to dedicated error code', () => {
  const mapped = mapGeminiApiError({
    error: {
      message: 'User location is not supported for the API use.',
    },
  });

  assert.equal(mapped.errorCode, 'UPSTREAM_LOCATION_UNSUPPORTED');
  assert.match(mapped.errorMessage, /not available in this server region/i);
});

test('maps API key and quota messages with actionable text', () => {
  const apiKeyMapped = mapGeminiApiError({
    error: { message: 'API key not valid. Please pass a valid API_KEY.' },
  });
  assert.equal(apiKeyMapped.errorCode, 'UPSTREAM_MODEL_ERROR');
  assert.match(apiKeyMapped.errorMessage, /Invalid or expired API key/i);

  const quotaMapped = mapGeminiApiError({
    error: { message: 'Quota exceeded for quota metric' },
  });
  assert.equal(quotaMapped.errorCode, 'UPSTREAM_MODEL_ERROR');
  assert.match(quotaMapped.errorMessage, /API quota exceeded/i);
});

test('returns default mapping when no upstream error exists', () => {
  const mapped = mapGeminiApiError({});

  assert.equal(mapped.errorCode, 'UPSTREAM_MODEL_ERROR');
  assert.equal(mapped.errorMessage, 'Failed to get response from Gemini API');
});
