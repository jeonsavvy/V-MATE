/**
 * @typedef {{
 *   emotion: 'normal' | 'happy' | 'confused' | 'angry',
 *   inner_heart: string,
 *   response: string,
 *   narration: string,
 *   character_image_slot?: string,
 *   world_image_slot?: string,
 * }} AssistantMessage
 *
 * @typedef {{ status: number, code: string, message: string }} ChatModelError
 *
 * @typedef {
 *   | { ok: true, value: AssistantMessage, parseMode: 'strict' | 'recovered' }
 *   | { ok: false, error: ChatModelError }
 * } ModelResult
 */

const INVALID_MODEL_OUTPUT_ERROR = Object.freeze({
    status: 502,
    code: 'INVALID_MODEL_OUTPUT',
    message: 'The response service returned an invalid response.',
});

export const invalidModelOutputResult = () => ({
    ok: false,
    error: { ...INVALID_MODEL_OUTPUT_ERROR },
});

export const successfulModelResult = ({ value, parseMode }) => ({
    ok: true,
    value,
    parseMode,
});

export const toPublicChatModelError = (error) => {
    const rawStatus = Number(error?.status);
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
        ? rawStatus
        : 503;
    const code = typeof error?.code === 'string' && error.code
        ? error.code
        : 'UPSTREAM_UNKNOWN_ERROR';

    if (status === 429) {
        return {
            status,
            code: 'UPSTREAM_RATE_LIMITED',
            message: 'The response service is temporarily rate limited. Please try again later.',
        };
    }

    if (code === 'UPSTREAM_TIMEOUT' || code === 'FUNCTION_BUDGET_TIMEOUT') {
        return {
            status: 504,
            code,
            message: 'The response service timed out. Please try again later.',
        };
    }

    if (code === 'UPSTREAM_INVALID_RESPONSE') {
        return {
            status: 502,
            code,
            message: 'The response service returned an invalid response.',
        };
    }

    return {
        status,
        code,
        message: 'The response service is temporarily unavailable. Please try again later.',
    };
};
