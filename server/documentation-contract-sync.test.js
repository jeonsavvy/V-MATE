import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildHeaders } from './modules/http-policy.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const REQUIRED_API_POLICY_SNIPPETS = [
  '`POST`만 허용',
  '`OPTIONS` preflight 허용',
  '`405 METHOD_NOT_ALLOWED`',
  '`Allow: POST, OPTIONS`',
];

const REQUIRED_EXPOSED_HEADER_TOKENS = [
  'X-V-MATE-Trace-Id',
  'X-V-MATE-API-Version',
  'X-V-MATE-Elapsed-Ms',
  'X-V-MATE-Error-Code',
  'X-V-MATE-Dedupe-Status',
  'X-V-MATE-RateLimit-Limit',
  'X-V-MATE-RateLimit-Remaining',
  'X-V-MATE-RateLimit-Reset',
  'X-V-MATE-Client-Request-Id',
  'Retry-After',
];

const REQUIRED_API_ERROR_CODE_TOKENS = [
  'METHOD_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED',
  'REQUEST_BODY_TOO_LARGE',
  'UNSUPPORTED_CONTENT_TYPE',
  'RATE_LIMIT_EXCEEDED',
];

const REQUIRED_SECURITY_HEADER_TOKEN = 'X-Content-Type-Options: nosniff';
const REQUIRED_NODE_RUNTIME_TOKEN = 'Node.js 24 이상';

const readDoc = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('API documentation records chat method policy aligned with backend allow-methods', async () => {
  const headers = buildHeaders(true, 'http://localhost:5173');
  assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');

  const apiDoc = await readDoc('docs/api.md');
  for (const token of REQUIRED_API_POLICY_SNIPPETS) {
    assert.ok(apiDoc.includes(token), `API documentation is missing method policy token: ${token}`);
  }
});

test('API documentation records core exposed headers used by chat responses', async () => {
  const headers = buildHeaders(true, 'http://localhost:5173');
  const exposedHeaders = String(headers['Access-Control-Expose-Headers'] || '');
  const apiDoc = await readDoc('docs/api.md');

  for (const token of REQUIRED_EXPOSED_HEADER_TOKENS) {
    assert.ok(
      exposedHeaders.includes(token),
      `buildHeaders Access-Control-Expose-Headers is missing token: ${token}`
    );
    assert.ok(apiDoc.includes(token), `API documentation is missing exposed header token: ${token}`);
  }
});

test('API documentation includes core server contract error codes', async () => {
  const apiDoc = await readDoc('docs/api.md');

  for (const token of REQUIRED_API_ERROR_CODE_TOKENS) {
    assert.ok(apiDoc.includes(token), `API documentation is missing core error code token: ${token}`);
  }
});

test('API documentation records nosniff security header used by chat responses', async () => {
  const headers = buildHeaders(true, 'http://localhost:5173');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');

  const apiDoc = await readDoc('docs/api.md');
  assert.ok(
    apiDoc.includes(REQUIRED_SECURITY_HEADER_TOKEN),
    `API documentation is missing security header token: ${REQUIRED_SECURITY_HEADER_TOKEN}`
  );
});

test('README runtime requirement stays aligned with package engines field', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf8')
  );
  assert.equal(packageJson?.engines?.node, '>=24.0.0');

  const readme = await readDoc('README.md');
  assert.ok(
    readme.includes(REQUIRED_NODE_RUNTIME_TOKEN),
    `README is missing runtime token: ${REQUIRED_NODE_RUNTIME_TOKEN}`
  );
});
