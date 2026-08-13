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
  const normalized = normalizeAssistantPayload('{"emotion":"happy","inner_heart":"ok","response":"hello","character_image_slot":"battle","world_image_slot":"night"}');
  assert.deepEqual(normalized, {
    ok: true,
    value: {
      emotion: 'happy',
      inner_heart: 'ok',
      response: 'hello',
      narration: '',
      character_image_slot: 'battle',
      world_image_slot: 'night',
    },
    parseMode: 'strict',
  });
});

test('normalizeAssistantPayload rejects plain text outside the structured contract', () => {
  const normalized = normalizeAssistantPayload('just plain response text');
  assert.deepEqual(normalized, {
    ok: false,
    error: {
      status: 502,
      code: 'INVALID_MODEL_OUTPUT',
      message: 'The response service returned an invalid response.',
    },
  });
});

test('normalizeAssistantPayload returns a typed failure for broken contract-like json', () => {
  const normalized = normalizeAssistantPayload('{"emotion":"happy"');
  assert.equal(normalized.ok, false);
  assert.equal(normalized.error?.code, 'INVALID_MODEL_OUTPUT');
  assert.equal(JSON.stringify(normalized).includes('잠시 응답 형식이 불안정했어요'), false);
});

test('normalizeAssistantPayload rejects truncated contract json even when core fields are visible', () => {
  const normalized = normalizeAssistantPayload(`{"emotion":"normal","inner_heart":"긴장하고 있다.","response":"지금은 안으로 들어가면 돼.\n서두르자.","narration":"비가 그친 골목이다."`);

  assert.equal(normalized.ok, false);
  assert.equal(normalized.error?.code, 'INVALID_MODEL_OUTPUT');
});

test('normalizeAssistantPayload marks loose contract recovery explicitly', () => {
  const normalized = normalizeAssistantPayload("{emotion:'confused',inner_heart:'hmm',response:'where?',}");

  assert.equal(normalized.ok, true);
  assert.equal(normalized.parseMode, 'recovered');
  assert.deepEqual(normalized.value, {
    emotion: 'confused',
    inner_heart: 'hmm',
    response: 'where?',
    narration: '',
  });
});

test('normalizeAssistantPayload rejects structured json without the required response', () => {
  const normalized = normalizeAssistantPayload('{"emotion":"happy","inner_heart":"ok"}');

  assert.equal(normalized.ok, false);
  assert.equal(normalized.error?.code, 'INVALID_MODEL_OUTPUT');
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

test('normalizeAssistantPayload keeps debug-safe log context for broken contract fallback', () => {
  const warnCalls = [];
  console.warn = (...args) => {
    warnCalls.push(args);
  };

  normalizeAssistantPayload('{"emotion":"happy","response":', {
    traceId: 'trace-1',
    roomId: 'room-1',
    modelName: 'private-provider-model',
    clientRequestId: 'private-client-request',
    promptSnapshotLength: 4321,
    historyMessageCount: 7,
    outputLimit: 2048,
    finishReason: 'MAX_TOKENS',
    hasFinishReason: true,
  });

  assert.ok(warnCalls.length > 0);
  const metadata = warnCalls[0][1];
  assert.equal(metadata?.traceId, 'trace-1');
  assert.equal(Object.hasOwn(metadata || {}, 'roomId'), false);
  assert.equal(Object.hasOwn(metadata || {}, 'modelName'), false);
  assert.equal(Object.hasOwn(metadata || {}, 'clientRequestId'), false);
  assert.equal(metadata?.promptSnapshotLength, 4321);
  assert.equal(metadata?.historyMessageCount, 7);
  assert.equal(metadata?.outputLimit, 2048);
  assert.equal(Object.hasOwn(metadata || {}, 'finishReason'), false);
  assert.equal(metadata?.hasFinishReason, true);
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
