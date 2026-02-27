import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAX_CACHED_CONTENT_CHARS,
  MAX_CLIENT_REQUEST_ID_CHARS,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_ITEMS,
  MAX_USER_MESSAGE_CHARS,
} from './modules/request-schema.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const extractNumber = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match, `${label} not found`);
  return Number(match[1]);
};

test('frontend chat contract limits stay aligned with server request schema limits', async () => {
  const frontendContractSource = await readFile(
    path.join(repoRoot, 'src/lib/chat/chatContract.ts'),
    'utf8'
  );

  const frontendUserMessageMax = extractNumber(
    frontendContractSource,
    /userMessageMaxChars:\s*(\d+)/,
    'userMessageMaxChars'
  );
  const frontendHistoryMaxItems = extractNumber(
    frontendContractSource,
    /historyMaxItems:\s*(\d+)/,
    'historyMaxItems'
  );
  const frontendHistoryContentMax = extractNumber(
    frontendContractSource,
    /historyContentMaxChars:\s*(\d+)/,
    'historyContentMaxChars'
  );
  const frontendCachedContentMax = extractNumber(
    frontendContractSource,
    /cachedContentMaxChars:\s*(\d+)/,
    'cachedContentMaxChars'
  );
  const frontendSendHistoryMaxItems = extractNumber(
    frontendContractSource,
    /frontendHistoryMaxItems:\s*(\d+)/,
    'frontendHistoryMaxItems'
  );
  const frontendClientRequestIdMax = extractNumber(
    frontendContractSource,
    /clientRequestIdMaxChars:\s*(\d+)/,
    'clientRequestIdMaxChars'
  );

  assert.equal(frontendUserMessageMax, MAX_USER_MESSAGE_CHARS);
  assert.equal(frontendHistoryMaxItems, MAX_HISTORY_ITEMS);
  assert.equal(frontendHistoryContentMax, MAX_HISTORY_CONTENT_CHARS);
  assert.equal(frontendCachedContentMax, MAX_CACHED_CONTENT_CHARS);
  assert.equal(frontendClientRequestIdMax, MAX_CLIENT_REQUEST_ID_CHARS);
  assert.ok(
    frontendSendHistoryMaxItems <= MAX_HISTORY_ITEMS,
    'frontendHistoryMaxItems must be <= server history max'
  );
});
