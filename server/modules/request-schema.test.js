import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getRequestApiVersion,
  parseRequestBodyObject,
  validateChatRequestPayload,
} from './request-schema.js';

const parseBody = (value) => {
  const parsed = parseRequestBodyObject(value);
  if (!parsed.ok) {
    throw new Error(`Expected parse to succeed: ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
};

test('resolves api version from header/body with v2 default', () => {
  assert.equal(getRequestApiVersion({}, {}), '2');
  assert.equal(getRequestApiVersion({ headers: { 'x-v-mate-api-version': '1' } }, {}), '1');
  assert.equal(getRequestApiVersion({}, { api_version: '1' }), '1');
  assert.equal(getRequestApiVersion({ headers: { 'x-v-mate-api-version': '999' } }, {}), '2');
});

test('parses JSON object body and rejects invalid shape', () => {
  const ok = parseRequestBodyObject('{"characterId":"mika"}');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, { characterId: 'mika' });

  const invalidJson = parseRequestBodyObject('{oops');
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.errorCode, 'INVALID_REQUEST_BODY');

  const invalidObject = parseRequestBodyObject('[]');
  assert.equal(invalidObject.ok, false);
  assert.equal(invalidObject.errorCode, 'INVALID_REQUEST_BODY');
});

test('validates characterId and userMessage schema', () => {
  const validator = (id) => id === 'mika' || id === 'alice' || id === 'kael';

  const valid = validateChatRequestPayload(
    parseBody('{"characterId":"Mika","userMessage":"안녕","messageHistory":[]}'),
    { isSupportedCharacterId: validator }
  );

  assert.equal(valid.ok, true);
  assert.equal(valid.value.normalizedCharacterId, 'mika');
  assert.equal(valid.value.userMessage, '안녕');
  assert.deepEqual(valid.value.messageHistory, []);

  const invalidCharacter = validateChatRequestPayload(
    parseBody('{"characterId":"invalid","userMessage":"안녕","messageHistory":[]}'),
    { isSupportedCharacterId: validator }
  );
  assert.equal(invalidCharacter.ok, false);
  assert.equal(invalidCharacter.errorCode, 'INVALID_CHARACTER_ID');

  const invalidUserMessage = validateChatRequestPayload(
    parseBody('{"characterId":"mika","userMessage":"","messageHistory":[]}'),
    { isSupportedCharacterId: validator }
  );
  assert.equal(invalidUserMessage.ok, false);
  assert.equal(invalidUserMessage.errorCode, 'INVALID_USER_MESSAGE');

  const tooLongUserMessage = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'mika',
        userMessage: 'x'.repeat(1201),
        messageHistory: [],
      })
    ),
    { isSupportedCharacterId: validator }
  );
  assert.equal(tooLongUserMessage.ok, false);
  assert.equal(tooLongUserMessage.errorCode, 'INVALID_USER_MESSAGE');
});

test('normalizes message history and rejects malformed history/cachedContent', () => {
  const validator = (id) => id === 'mika' || id === 'alice' || id === 'kael';

  const validHistory = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'kael',
        userMessage: '  hello  ',
        messageHistory: [
          { role: 'user', content: '  first ' },
          { role: 'assistant', content: { response: ' second ' } },
        ],
      })
    ),
    { isSupportedCharacterId: validator }
  );

  assert.equal(validHistory.ok, true);
  assert.deepEqual(validHistory.value.messageHistory, [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
  ]);
  assert.equal(validHistory.value.userMessage, 'hello');

  const invalidHistory = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'kael',
        userMessage: 'hello',
        messageHistory: [{ role: 'assistant', content: '' }],
      })
    ),
    { isSupportedCharacterId: validator }
  );

  assert.equal(invalidHistory.ok, false);
  assert.equal(invalidHistory.errorCode, 'INVALID_MESSAGE_HISTORY');

  const invalidCachedContent = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'kael',
        userMessage: 'hello',
        messageHistory: [],
        cachedContent: { bad: true },
      })
    ),
    { isSupportedCharacterId: validator }
  );

  assert.equal(invalidCachedContent.ok, false);
  assert.equal(invalidCachedContent.errorCode, 'INVALID_CACHED_CONTENT');

  const oversizedCachedContent = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'kael',
        userMessage: 'hello',
        messageHistory: [],
        cachedContent: 'c'.repeat(257),
      })
    ),
    { isSupportedCharacterId: validator }
  );

  assert.equal(oversizedCachedContent.ok, false);
  assert.equal(oversizedCachedContent.errorCode, 'INVALID_CACHED_CONTENT');

  const invalidCachedContentFormat = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'kael',
        userMessage: 'hello',
        messageHistory: [],
        cachedContent: 'invalid-cache-name',
      })
    ),
    { isSupportedCharacterId: validator }
  );

  assert.equal(invalidCachedContentFormat.ok, false);
  assert.equal(invalidCachedContentFormat.errorCode, 'INVALID_CACHED_CONTENT');

  const validCachedContentFormat = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'kael',
        userMessage: 'hello',
        messageHistory: [],
        cachedContent: 'cachedContents/kael-cache-001',
      })
    ),
    { isSupportedCharacterId: validator }
  );

  assert.equal(validCachedContentFormat.ok, true);
  assert.equal(validCachedContentFormat.value.cachedContent, 'cachedContents/kael-cache-001');

  const validClientRequestId = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'mika',
        userMessage: 'hello',
        messageHistory: [],
        clientRequestId: 'web-abc_123',
      })
    ),
    { isSupportedCharacterId: validator }
  );
  assert.equal(validClientRequestId.ok, true);
  assert.equal(validClientRequestId.value.clientRequestId, 'web-abc_123');

  const invalidClientRequestId = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'mika',
        userMessage: 'hello',
        messageHistory: [],
        clientRequestId: 'web id with space',
      })
    ),
    { isSupportedCharacterId: validator }
  );
  assert.equal(invalidClientRequestId.ok, false);
  assert.equal(invalidClientRequestId.errorCode, 'INVALID_CLIENT_REQUEST_ID');

  const tooManyHistoryItems = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'mika',
        userMessage: 'hello',
        messageHistory: Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' })),
      })
    ),
    { isSupportedCharacterId: validator }
  );
  assert.equal(tooManyHistoryItems.ok, false);
  assert.equal(tooManyHistoryItems.errorCode, 'INVALID_MESSAGE_HISTORY');

  const tooLongHistoryContent = validateChatRequestPayload(
    parseBody(
      JSON.stringify({
        characterId: 'mika',
        userMessage: 'hello',
        messageHistory: [{ role: 'assistant', content: { response: 'x'.repeat(1201) } }],
      })
    ),
    { isSupportedCharacterId: validator }
  );
  assert.equal(tooLongHistoryContent.ok, false);
  assert.equal(tooLongHistoryContent.errorCode, 'INVALID_MESSAGE_HISTORY');
});
