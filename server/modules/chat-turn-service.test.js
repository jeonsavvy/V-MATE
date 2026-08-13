import assert from 'node:assert/strict';
import test from 'node:test';
import { executeChatTurn, toChatModelApiFailure } from './chat-turn-service.js';

test('maps invalid structured output to the shared public failure', () => {
    assert.deepEqual(toChatModelApiFailure({
        ok: false,
        error: { status: 502, code: 'INVALID_MODEL_OUTPUT', message: 'private detail' },
        retryable: true,
    }), {
        statusCode: 502,
        error: '응답 형식을 확인하지 못했습니다. 다시 시도해주세요.',
        errorCode: 'RESPONSE_INVALID_FORMAT',
        retryable: true,
    });
});

test('guards confidential prompt disclosure at the shared model boundary', async () => {
    const secret = 'creator-only instruction alpha beta gamma delta epsilon zeta';
    const promptSnapshot = `### CHARACTER\n- Master prompt: ${secret}`;
    const result = await executeChatTurn({
        modelRequest: {},
        promptSnapshot,
        executeModel: async () => ({
            ok: true,
            value: {
                emotion: 'neutral',
                inner_heart: '',
                response: secret,
                narration: '',
            },
            parseMode: 'strict',
        }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.disclosureBlocked, true);
    assert.doesNotMatch(result.value.response, /creator-only instruction/);
});
