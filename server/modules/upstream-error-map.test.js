import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapGeminiApiError } from './upstream-error-map.js';

test('maps location unsupported message to dedicated error code', () => {
  const mapped = mapGeminiApiError({
    error: {
      message: 'User location is not supported for the API use.',
    },
  });

  assert.equal(mapped.errorCode, 'RESPONSE_REGION_UNAVAILABLE');
  assert.match(mapped.errorMessage, /현재 지역/);
});

test('maps API key and quota messages with actionable text', () => {
  const apiKeyMapped = mapGeminiApiError({
    error: { message: 'API key not valid. Please pass a valid API_KEY.' },
  });
  assert.equal(apiKeyMapped.errorCode, 'RESPONSE_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(apiKeyMapped.errorMessage, /API|key|secret|provider|model/i);

  const quotaMapped = mapGeminiApiError({
    error: { message: 'Quota exceeded for quota metric' },
  });
  assert.equal(quotaMapped.errorCode, 'RESPONSE_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(quotaMapped.errorMessage, /API|quota|billing|provider|model/i);
});

test('returns default mapping when no upstream error exists', () => {
  const mapped = mapGeminiApiError({});

  assert.equal(mapped.errorCode, 'RESPONSE_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(mapped.errorMessage, /Gemini|API|provider|model/i);
});
