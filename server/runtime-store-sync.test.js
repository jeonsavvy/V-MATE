import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('README documents runtime store mode flags and KV binding names', async () => {
  const readme = await readUtf8('README.md');

  assert.ok(readme.includes('RATE_LIMIT_STORE'));
  assert.ok(readme.includes('PROMPT_CACHE_STORE'));
  assert.ok(readme.includes('V_MATE_RATE_LIMIT_KV'));
  assert.ok(readme.includes('V_MATE_PROMPT_CACHE_KV'));
});

test('wrangler vars define default runtime store mode as memory', async () => {
  const wranglerConfig = await readUtf8('wrangler.jsonc');

  assert.ok(wranglerConfig.includes('"RATE_LIMIT_STORE": "memory"'));
  assert.ok(wranglerConfig.includes('"PROMPT_CACHE_STORE": "memory"'));
  assert.ok(wranglerConfig.includes('"REQUIRE_AUTH_FOR_CHAT": "true"'));
  assert.ok(wranglerConfig.includes('"AUTH_PROVIDER_TIMEOUT_MS": "3500"'));
  assert.ok(wranglerConfig.includes('"AUTH_PROVIDER_RETRY_COUNT": "1"'));
  assert.ok(wranglerConfig.includes('"CLIENT_REQUEST_DEDUPE_WINDOW_MS": "15000"'));
  assert.ok(wranglerConfig.includes('"CLIENT_REQUEST_DEDUPE_MAX_ENTRIES": "2000"'));
});

test('worker wires runtime chat context resolver', async () => {
  const workerSource = await readUtf8('worker.js');

  assert.ok(workerSource.includes('resolveRuntimeChatHandlerContext'));
  assert.ok(workerSource.includes('mergeChatHandlerContexts'));
});

test('cloud run server wires runtime chat context resolver', async () => {
  const cloudRunSource = await readUtf8('server/cloud-run-server.js');

  assert.ok(cloudRunSource.includes('resolveRuntimeChatHandlerContext'));
  assert.ok(cloudRunSource.includes('mergeChatHandlerContexts'));
  assert.ok(cloudRunSource.includes('runtimeEnv = process.env'));
});
