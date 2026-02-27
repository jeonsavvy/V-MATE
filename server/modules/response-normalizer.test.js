import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { extractGeminiResponseText, normalizeAssistantPayload } from './response-normalizer.js';

const ORIGINAL_CONSOLE_WARN = console.warn;

beforeEach(() => {
  console.warn = () => {};
});

afterEach(() => {
  console.warn = ORIGINAL_CONSOLE_WARN;
});

test('normalizeAssistantPayload parses strict json contract', () => {
  const normalized = normalizeAssistantPayload('{"emotion":"happy","inner_heart":"ok","response":"hello"}');
  assert.deepEqual(normalized, {
    emotion: 'happy',
    inner_heart: 'ok',
    response: 'hello',
    narration: '',
  });
});

test('normalizeAssistantPayload falls back to passthrough for plain text', () => {
  const normalized = normalizeAssistantPayload('just plain response text');
  assert.equal(normalized.emotion, 'normal');
  assert.equal(normalized.inner_heart, '');
  assert.equal(normalized.response, 'just plain response text');
});

test('normalizeAssistantPayload uses safe fallback on broken contract-like json', () => {
  const normalized = normalizeAssistantPayload('{"emotion":"happy"');
  assert.equal(normalized.response, '잠시 응답 형식이 불안정했어요. 한 번만 다시 말해줘.');
  assert.equal(normalized.inner_heart, '');
});

test('normalizeAssistantPayload warning metadata omits raw response preview text', () => {
  const warnCalls = [];
  console.warn = (...args) => {
    warnCalls.push(args);
  };

  normalizeAssistantPayload('{"emotion":"happy","response":');

  assert.ok(warnCalls.length > 0);
  const metadata = warnCalls[0][1];
  assert.equal(typeof metadata?.rawTextLength, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(metadata || {}, 'rawTextPreview'), false);
});

test('extractGeminiResponseText returns first non-empty text part', () => {
  const text = extractGeminiResponseText({
    candidates: [
      { content: { parts: [{ text: '' }, { text: 'first' }] } },
      { content: { parts: [{ text: 'second' }] } },
    ],
  });

  assert.equal(text, 'first');
  assert.equal(extractGeminiResponseText({ candidates: [] }), null);
});
