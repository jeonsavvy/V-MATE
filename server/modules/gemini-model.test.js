import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEMINI_CHAT_MODEL_NAME } from './gemini-model.js';

const modulesDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.dirname(modulesDirectory);

test('chat routes use the stable Gemini 3.5 Flash model', () => {
  assert.equal(GEMINI_CHAT_MODEL_NAME, 'gemini-3.5-flash');
});

test('legacy and platform chat routes share the canonical model constant', async () => {
  const sources = await Promise.all([
    readFile(path.join(serverDirectory, 'chat-handler.js'), 'utf8'),
    readFile(path.join(serverDirectory, 'platform', 'api.js'), 'utf8'),
  ]);

  for (const source of sources) {
    assert.match(source, /GEMINI_CHAT_MODEL_NAME/);
    assert.doesNotMatch(source, /gemini-3-flash-preview/);
  }
});
