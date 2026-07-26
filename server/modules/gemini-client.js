export const isCacheLookupErrorMessage = (message) => {
    const normalized = String(message || '').toLowerCase();
    return (
        normalized.includes('cachedcontent') ||
        normalized.includes('cached content') ||
        normalized.includes('not found') ||
        normalized.includes('expired')
    );
};

export const buildGeminiRequestPayload = ({
    requestContents,
    outputTokens,
    thinkingLevel,
    responseSchema,
    cachedContentName,
    useCachedContent = true,
    useJsonMimeType = true,
    systemPromptText = '',
}) => {
    const payload = {
        contents: requestContents,
        generationConfig: {
            maxOutputTokens: outputTokens,
            thinkingConfig: {
                thinkingLevel,
            },
        },
    };

    if (useJsonMimeType) {
        payload.generationConfig.responseMimeType = 'application/json';
        payload.generationConfig.responseSchema = responseSchema;
    }

    if (useCachedContent && cachedContentName) {
        payload.cachedContent = cachedContentName;
    }

    if (systemPromptText && (!useCachedContent || !cachedContentName)) {
        payload.systemInstruction = {
            parts: [{ text: systemPromptText }],
        };
    }

    return payload;
};

export const callGeminiWithTimeout = async ({
    apiKey,
    modelName,
    payload,
    timeoutMs,
    fetchImpl = fetch,
}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(payload),
                signal: controller.signal,
            }
        );

        let data;
        try {
            data = await response.json();
        } catch {
            return {
                ok: false,
                response,
                data: null,
                error: {
                    status: 502,
                    message: 'The response service returned an invalid response.',
                    code: 'UPSTREAM_INVALID_RESPONSE',
                },
            };
        }

        if (!response.ok || data?.error) {
            return {
                ok: false,
                response,
                data,
                error: {
                    status: response.status || 500,
                    message: data?.error?.message || 'Model call failed',
                    code: 'UPSTREAM_MODEL_ERROR',
                },
            };
        }

        return {
            ok: true,
            response,
            data,
            error: null,
        };
    } catch (fetchError) {
        if (fetchError?.name === 'AbortError') {
            return {
                ok: false,
                response: null,
                data: null,
                error: {
                    status: 504,
                    message: 'The response service timed out.',
                    code: 'UPSTREAM_TIMEOUT',
                },
            };
        }

        return {
            ok: false,
            response: null,
            data: null,
            error: {
                status: 503,
                message: 'The response service is temporarily unavailable.',
                code: 'UPSTREAM_CONNECTION_FAILED',
            },
        };
    } finally {
        clearTimeout(timeoutId);
    }
};

export const createPromptCacheEntry = async ({
    apiKey,
    modelName,
    characterId,
    systemPrompt,
    cacheKey,
    ttlSeconds,
    createTimeoutMs,
    fetchImpl = fetch,
}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), createTimeoutMs);

    try {
        const response = await fetchImpl(
            'https://generativelanguage.googleapis.com/v1beta/cachedContents',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    model: `models/${modelName}`,
                    displayName: `vmate-${characterId}-${cacheKey.slice(-8)}`,
                    ttl: `${Math.max(300, ttlSeconds)}s`,
                    systemInstruction: {
                        role: 'system',
                        parts: [{ text: String(systemPrompt) }],
                    },
                }),
                signal: controller.signal,
            }
        );

        let data;
        try {
            data = await response.json();
        } catch {
            return null;
        }

        if (!response.ok || data?.error || !data?.name) {
            return null;
        }

        const expireAtMs = data?.expireTime ? Date.parse(data.expireTime) : NaN;
        const safeExpireAtMs = Number.isFinite(expireAtMs)
            ? expireAtMs
            : Date.now() + Math.max(300, ttlSeconds) * 1000;

        return {
            name: data.name,
            expireAtMs: safeExpireAtMs,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
};
