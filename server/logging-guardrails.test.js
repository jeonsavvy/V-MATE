import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const LOGGED_FILES = [
    'server/chat-handler.js',
    'server/modules/gemini-orchestrator.js',
    'server/modules/response-normalizer.js',
    'server/cloud-run-server.js',
];

test('core server files avoid direct console usage and rely on logger module', async () => {
    for (const relativePath of LOGGED_FILES) {
        const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
        assert.equal(/\bconsole\.(warn|error|log)\(/.test(source), false, `${relativePath} should not call console.* directly`);
        assert.ok(source.includes('server-logger'), `${relativePath} should use server logger module`);
    }
});
