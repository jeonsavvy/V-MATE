import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { GEMINI_CHAT_MODEL_NAME } from './gemini-model.js';
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
    emotion: 'happy',
    inner_heart: 'ok',
    response: 'hello',
    narration: '',
    character_image_slot: 'battle',
    world_image_slot: 'night',
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

test('normalizeAssistantPayload recovers truncated contract json when core fields are still extractable', () => {
  const normalized = normalizeAssistantPayload(`{"emotion":"normal","inner_heart":"긴장하고 있다.","response":"지금은 안으로 들어가면 돼.\n서두르자.","narration":"비가 그친 골목이다."`);

  assert.equal(normalized.emotion, 'normal');
  assert.equal(normalized.inner_heart, '긴장하고 있다.');
  assert.equal(normalized.response, '지금은 안으로 들어가면 돼.\n서두르자.');
  assert.equal(normalized.narration, '비가 그친 골목이다.');
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
    modelName: GEMINI_CHAT_MODEL_NAME,
    promptSnapshotLength: 4321,
    historyMessageCount: 7,
    outputLimit: 2048,
    finishReason: 'MAX_TOKENS',
  });

  assert.ok(warnCalls.length > 0);
  const metadata = warnCalls[0][1];
  assert.equal(metadata?.traceId, 'trace-1');
  assert.equal(metadata?.roomId, 'room-1');
  assert.equal(metadata?.modelName, GEMINI_CHAT_MODEL_NAME);
  assert.equal(metadata?.promptSnapshotLength, 4321);
  assert.equal(metadata?.historyMessageCount, 7);
  assert.equal(metadata?.outputLimit, 2048);
  assert.equal(metadata?.finishReason, 'MAX_TOKENS');
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
