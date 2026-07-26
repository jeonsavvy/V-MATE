import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const LOGGED_FILES = [
    'server/chat-handler.js',
    'server/modules/auth-guard.js',
    'server/modules/chat-context-hooks.js',
    'server/modules/gemini-orchestrator.js',
    'server/modules/response-normalizer.js',
    'server/modules/runtime-chat-context.js',
    'server/platform/supabase-platform-repository.js',
    'server/cloud-run-server.js',
];

const extractLogCalls = (source) => {
    const calls = [];
    let current = null;
    for (const line of source.split(/\r?\n/)) {
        if (current === null && /logServer(?:Error|Warn|Info|Debug)\(/.test(line)) {
            current = line;
        } else if (current !== null) {
            current += `\n${line}`;
        }
        if (current !== null && (/\}\);\s*$/.test(line) || (/logServer/.test(line) && /\);\s*$/.test(line)))) {
            calls.push(current);
            current = null;
        }
    }
    return calls;
};

test('core server files avoid direct console usage and rely on logger module', async () => {
    for (const relativePath of LOGGED_FILES) {
        const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
        assert.equal(/\bconsole\.(warn|error|log)\(/.test(source), false, `${relativePath} should not call console.* directly`);
        assert.ok(source.includes('server-logger'), `${relativePath} should use server logger module`);
    }
});

test('server log calls exclude raw errors, private identifiers, provider names, and config names', async () => {
    const forbiddenMetadataKeys = /\b(?:message|errorMessage|stack|modelName|characterId|clientRequestId|userId|roomId|entityId|targetId|characterSlug|worldSlug|finishReason|promptBlockReason|bindingKeys)\s*:/;
    const forbiddenLiteral = /(?:Gemini|Cloud Run|GOOGLE_API_KEY|SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)|RATE_LIMIT_STORE|PROMPT_CACHE_STORE)/i;

    for (const relativePath of LOGGED_FILES) {
        const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
        const logCalls = extractLogCalls(source);
        assert.ok(logCalls.length > 0, `${relativePath} should contain at least one guarded log call`);
        for (const call of logCalls) {
            const messageLiteral = call.match(/logServer(?:Error|Warn|Info|Debug)\(\s*(['"`])([\s\S]*?)\1\s*,?/)?.[2] || '';
            assert.doesNotMatch(call, forbiddenMetadataKeys, `${relativePath} log metadata must be nonidentifying`);
            assert.doesNotMatch(messageLiteral, forbiddenLiteral, `${relativePath} log text must not name providers or configuration`);
            assert.doesNotMatch(call, /error\?\.message|String\(error\)|\.stack\b/, `${relativePath} must classify errors before logging`);
        }
    }
});
