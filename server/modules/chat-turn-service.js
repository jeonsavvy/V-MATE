import { executeGeminiChatRequest } from './gemini-orchestrator.js';
import { guardConfidentialPromptResponse } from '../platform/prompt-builder.js';

export const toChatModelApiFailure = (modelResult) => {
    const modelError = modelResult?.error || {};
    if (modelError.code === 'INVALID_MODEL_OUTPUT') {
        return {
            statusCode: 502,
            error: '응답 형식을 확인하지 못했습니다. 다시 시도해주세요.',
            errorCode: 'RESPONSE_INVALID_FORMAT',
            retryable: true,
        };
    }

    if (modelError.status === 429) {
        return {
            statusCode: 429,
            error: '응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.',
            errorCode: 'RESPONSE_RATE_LIMITED',
            retryable: true,
        };
    }

    return {
        statusCode: modelError.status === 504 ? 504 : 503,
        error: '응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.',
        errorCode: 'RESPONSE_SERVICE_UNAVAILABLE',
        retryable: Boolean(modelResult?.retryable),
    };
};

/**
 * Execute and validate one model turn. Persistence and quota ownership remain
 * with the caller; model decoding, public errors, and prompt confidentiality
 * are shared by legacy and room chat.
 */
export const executeChatTurn = async ({
    modelRequest,
    promptSnapshot,
    executeModel = executeGeminiChatRequest,
}) => {
    const modelResult = await executeModel(modelRequest);
    if (!modelResult?.ok) {
        return {
            ...modelResult,
            ok: false,
            failure: toChatModelApiFailure(modelResult),
        };
    }

    const guarded = guardConfidentialPromptResponse({
        message: modelResult.value,
        promptSnapshot,
    });
    return {
        ...modelResult,
        value: guarded.message,
        disclosureBlocked: guarded.blocked,
    };
};
