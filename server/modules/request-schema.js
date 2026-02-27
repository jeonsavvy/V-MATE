import { isValidCachedContentName } from './prompt-cache.js';

const isAllowedHistoryRole = (role) => role === 'user' || role === 'assistant';
export const MAX_USER_MESSAGE_CHARS = 1200;
export const MAX_HISTORY_ITEMS = 50;
export const MAX_HISTORY_CONTENT_CHARS = 1200;
export const MAX_CACHED_CONTENT_CHARS = 256;
export const MAX_CLIENT_REQUEST_ID_CHARS = 64;
export const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const toHistoryText = (role, content) => {
    if (typeof content === 'string') {
        const normalized = content.trim();
        if (normalized.length > MAX_HISTORY_CONTENT_CHARS) {
            return null;
        }
        return normalized.length > 0 ? normalized : null;
    }

    if (role === 'assistant' && content && typeof content === 'object') {
        const responseText = typeof content.response === 'string' ? content.response.trim() : '';
        if (responseText.length > MAX_HISTORY_CONTENT_CHARS) {
            return null;
        }
        return responseText || null;
    }

    return null;
};

const normalizeMessageHistory = (value) => {
    if (typeof value === 'undefined' || value === null) {
        return { ok: true, value: [] };
    }

    if (!Array.isArray(value)) {
        return {
            ok: false,
            error: 'messageHistory must be an array.',
            errorCode: 'INVALID_MESSAGE_HISTORY',
        };
    }

    if (value.length > MAX_HISTORY_ITEMS) {
        return {
            ok: false,
            error: `messageHistory must contain at most ${MAX_HISTORY_ITEMS} items.`,
            errorCode: 'INVALID_MESSAGE_HISTORY',
        };
    }

    const normalizedHistory = [];

    for (const item of value) {
        if (!item || typeof item !== 'object') {
            return {
                ok: false,
                error: 'Each messageHistory item must be an object.',
                errorCode: 'INVALID_MESSAGE_HISTORY',
            };
        }

        const role = String(item.role || '').trim().toLowerCase();
        if (!isAllowedHistoryRole(role)) {
            return {
                ok: false,
                error: 'messageHistory role must be user or assistant.',
                errorCode: 'INVALID_MESSAGE_HISTORY',
            };
        }

        const normalizedContent = toHistoryText(role, item.content);
        if (!normalizedContent) {
            return {
                ok: false,
                error: 'messageHistory content must be a non-empty string.',
                errorCode: 'INVALID_MESSAGE_HISTORY',
            };
        }

        normalizedHistory.push({
            role,
            content: normalizedContent,
        });
    }

    return {
        ok: true,
        value: normalizedHistory,
    };
};

export const getRequestApiVersion = (event, requestData) => {
    const headerVersion =
        event?.headers?.['x-v-mate-api-version'] || event?.headers?.['X-V-MATE-API-Version'];
    const bodyVersion = requestData?.api_version;
    const resolved = String(bodyVersion || headerVersion || '2').trim();
    return resolved === '1' ? '1' : '2';
};

export const parseRequestBodyObject = (bodyText) => {
    let requestData;
    try {
        requestData = JSON.parse(String(bodyText || ''));
    } catch (parseError) {
        return {
            ok: false,
            error: 'Invalid request body. Expected JSON format.',
            errorCode: 'INVALID_REQUEST_BODY',
            details: parseError?.message,
        };
    }

    if (!requestData || typeof requestData !== 'object' || Array.isArray(requestData)) {
        return {
            ok: false,
            error: 'Invalid request body. Expected JSON object.',
            errorCode: 'INVALID_REQUEST_BODY',
        };
    }

    return {
        ok: true,
        data: requestData,
    };
};

export const validateChatRequestPayload = (requestData, { isSupportedCharacterId }) => {
    const { userMessage, messageHistory, characterId, cachedContent, clientRequestId } = requestData;
    const normalizedCharacterId = String(characterId || '').trim().toLowerCase();

    if (!isSupportedCharacterId(normalizedCharacterId)) {
        return {
            ok: false,
            error: 'characterId is required and must be one of mika | alice | kael.',
            errorCode: 'INVALID_CHARACTER_ID',
        };
    }

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
        return {
            ok: false,
            error: 'userMessage is required and must be a non-empty string.',
            errorCode: 'INVALID_USER_MESSAGE',
        };
    }

    const normalizedUserMessage = userMessage.trim();
    if (normalizedUserMessage.length > MAX_USER_MESSAGE_CHARS) {
        return {
            ok: false,
            error: `userMessage must be ${MAX_USER_MESSAGE_CHARS} characters or less.`,
            errorCode: 'INVALID_USER_MESSAGE',
        };
    }

    const normalizedHistoryResult = normalizeMessageHistory(messageHistory);
    if (!normalizedHistoryResult.ok) {
        return normalizedHistoryResult;
    }

    if (typeof cachedContent !== 'undefined' && cachedContent !== null && typeof cachedContent !== 'string') {
        return {
            ok: false,
            error: 'cachedContent must be a string when provided.',
            errorCode: 'INVALID_CACHED_CONTENT',
        };
    }

    const normalizedCachedContent = typeof cachedContent === 'string'
        ? cachedContent.trim()
        : '';
    if (normalizedCachedContent.length > MAX_CACHED_CONTENT_CHARS) {
        return {
            ok: false,
            error: `cachedContent must be ${MAX_CACHED_CONTENT_CHARS} characters or less.`,
            errorCode: 'INVALID_CACHED_CONTENT',
        };
    }
    if (normalizedCachedContent && !isValidCachedContentName(normalizedCachedContent)) {
        return {
            ok: false,
            error: 'cachedContent format is invalid.',
            errorCode: 'INVALID_CACHED_CONTENT',
        };
    }

    if (typeof clientRequestId !== 'undefined' && clientRequestId !== null) {
        if (typeof clientRequestId !== 'string') {
            return {
                ok: false,
                error: 'clientRequestId must be a string when provided.',
                errorCode: 'INVALID_CLIENT_REQUEST_ID',
            };
        }

        const normalizedClientRequestId = clientRequestId.trim();
        if (
            !normalizedClientRequestId ||
            normalizedClientRequestId.length > MAX_CLIENT_REQUEST_ID_CHARS
        ) {
            return {
                ok: false,
                error: `clientRequestId must be 1-${MAX_CLIENT_REQUEST_ID_CHARS} characters when provided.`,
                errorCode: 'INVALID_CLIENT_REQUEST_ID',
            };
        }

        if (!CLIENT_REQUEST_ID_PATTERN.test(normalizedClientRequestId)) {
            return {
                ok: false,
                error: 'clientRequestId contains unsupported characters.',
                errorCode: 'INVALID_CLIENT_REQUEST_ID',
            };
        }
    }

    return {
        ok: true,
        value: {
            userMessage: normalizedUserMessage,
            messageHistory: normalizedHistoryResult.value,
            characterId,
            cachedContent: normalizedCachedContent || null,
            clientRequestId: typeof clientRequestId === 'string' ? clientRequestId.trim() : null,
            normalizedCharacterId,
        },
    };
};
