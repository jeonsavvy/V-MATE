import {
    JSON_RESPONSE_SCHEMA,
    extractGeminiResponseText,
} from './response-normalizer.js';
import {
    buildGeminiRequestPayload,
    callGeminiWithTimeout,
    createPromptCacheEntry,
    isCacheLookupErrorMessage,
} from './gemini-client.js';
import {
    buildPromptCacheKey,
    getValidPromptCache,
    parseCachedContentName,
    removePromptCache,
    setPromptCacheEntry,
    toStablePromptHash,
} from './prompt-cache.js';
import {
    getChatRuntimeLimits,
    getGeminiContextCacheConfig,
    getGeminiRetryConfig,
    getGeminiThinkingLevel,
    shouldUseGeminiContextCache,
} from './runtime-config.js';
import { logServerWarn } from './server-logger.js';

const NETWORK_RETRYABLE_ERROR_CODES = new Set([
    'UPSTREAM_CONNECTION_FAILED',
    'UPSTREAM_TIMEOUT',
    'FUNCTION_BUDGET_TIMEOUT',
]);
const PROMPT_CACHE_EXPIRY_BUFFER_MS = 15_000;

const normalizePromptCacheEntry = (entry) => {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const name = parseCachedContentName(entry.name);
    const expireAtMs = Number(entry.expireAtMs);
    if (!name || !Number.isFinite(expireAtMs)) {
        return null;
    }

    return {
        name,
        expireAtMs: Math.floor(expireAtMs),
    };
};

const getPromptCacheFromAdapter = async ({ promptCacheAdapter, cacheKey, logMeta }) => {
    if (typeof promptCacheAdapter?.get !== 'function') {
        return null;
    }

    try {
        const entry = normalizePromptCacheEntry(await promptCacheAdapter.get(cacheKey));
        if (!entry) {
            return null;
        }

        if (Date.now() >= entry.expireAtMs - PROMPT_CACHE_EXPIRY_BUFFER_MS) {
            if (typeof promptCacheAdapter?.remove === 'function') {
                try {
                    await promptCacheAdapter.remove(cacheKey);
                } catch {
                    // noop
                }
            }
            return null;
        }

        return entry;
    } catch (error) {
        logServerWarn('[V-MATE] Prompt cache adapter get failed, fallback to in-memory cache', {
            ...logMeta,
            message: error?.message || String(error),
        });
        return null;
    }
};

const setPromptCacheWithAdapter = async ({ promptCacheAdapter, cacheKey, entry, logMeta }) => {
    if (!cacheKey || !entry?.name) {
        return;
    }

    setPromptCacheEntry(cacheKey, entry);

    if (typeof promptCacheAdapter?.set !== 'function') {
        return;
    }

    try {
        await promptCacheAdapter.set(cacheKey, entry);
    } catch (error) {
        logServerWarn('[V-MATE] Prompt cache adapter set failed, kept in-memory cache only', {
            ...logMeta,
            message: error?.message || String(error),
        });
    }
};

const removePromptCacheWithAdapter = async ({ promptCacheAdapter, cacheKey, logMeta }) => {
    if (!cacheKey) {
        return;
    }

    removePromptCache(cacheKey);

    if (typeof promptCacheAdapter?.remove !== 'function') {
        return;
    }

    try {
        await promptCacheAdapter.remove(cacheKey);
    } catch (error) {
        logServerWarn('[V-MATE] Prompt cache adapter remove failed', {
            ...logMeta,
            message: error?.message || String(error),
        });
    }
};

const buildConversationContents = ({
    messageHistory,
    userMessage,
    maxHistoryMessages,
    clampText,
}) => {
    const contents = [];
    const history = Array.isArray(messageHistory) ? messageHistory.slice(-maxHistoryMessages) : [];

    history.forEach((msg) => {
        if (!msg || typeof msg !== 'object') {
            return;
        }

        if (msg.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: clampText(msg.content) }] });
            return;
        }

        if (msg.role === 'assistant') {
            const assistantText = typeof msg.content === 'object' ? msg.content?.response : msg.content;
            contents.push({ role: 'model', parts: [{ text: clampText(assistantText) }] });
        }
    });

    contents.push({
        role: 'user',
        parts: [{ text: clampText(userMessage) }],
    });

    return contents;
};

export const executeGeminiChatRequest = async ({
    apiKey,
    modelName,
    requestStartedAt,
    requestTraceId,
    normalizedCharacterId,
    userMessage,
    messageHistory,
    requestCachedContent,
    trimmedSystemPrompt,
    promptCacheAdapter = null,
}) => {
    const {
        maxHistoryMessages: MAX_HISTORY_MESSAGES,
        maxPartChars: MAX_PART_CHARS,
        maxSystemPromptChars: MAX_SYSTEM_PROMPT_CHARS,
        primaryMaxOutputTokens: PRIMARY_MAX_OUTPUT_TOKENS,
        modelTimeoutMs: MODEL_TIMEOUT_MS,
        functionTotalTimeoutMs: FUNCTION_TOTAL_TIMEOUT_MS,
        functionTimeoutGuardMs: FUNCTION_TIMEOUT_GUARD_MS,
    } = getChatRuntimeLimits();
    const clampText = (value) => String(value ?? '').slice(0, MAX_PART_CHARS);
    const clampSystemPrompt = (value) => String(value ?? '').slice(0, MAX_SYSTEM_PROMPT_CHARS);
    const GEMINI_THINKING_LEVEL = getGeminiThinkingLevel();
    const {
        cacheLookupRetryEnabled,
        networkRecoveryRetryEnabled,
        emptyResponseRetryEnabled,
    } = getGeminiRetryConfig();
    const logMeta = {
        traceId: requestTraceId,
        characterId: normalizedCharacterId || null,
    };
    const clampedSystemPrompt = trimmedSystemPrompt ? clampSystemPrompt(trimmedSystemPrompt) : '';

    const canUseContextCache =
        shouldUseGeminiContextCache() &&
        Boolean(trimmedSystemPrompt);

    let promptCacheKey = null;
    let cachedContentName = null;

    if (canUseContextCache) {
        const promptHash = toStablePromptHash(trimmedSystemPrompt);
        promptCacheKey = buildPromptCacheKey(normalizedCharacterId, promptHash);
        const localPromptCache = getValidPromptCache(promptCacheKey);
        const adapterPromptCache = localPromptCache
            ? null
            : await getPromptCacheFromAdapter({
                promptCacheAdapter,
                cacheKey: promptCacheKey,
                logMeta,
            });
        const trustedPromptCache = localPromptCache || adapterPromptCache;
        if (trustedPromptCache && !localPromptCache) {
            setPromptCacheEntry(promptCacheKey, trustedPromptCache);
        }
        const trustedCachedContentName = trustedPromptCache?.name || null;
        const requestedCachedContentName = parseCachedContentName(requestCachedContent);

        if (requestedCachedContentName && trustedCachedContentName && requestedCachedContentName !== trustedCachedContentName) {
            logServerWarn('[V-MATE] Ignoring mismatched client cached content', {
                ...logMeta,
                hasRequestedCachedContent: true,
            });
        }

        cachedContentName = requestedCachedContentName && requestedCachedContentName === trustedCachedContentName
            ? requestedCachedContentName
            : trustedCachedContentName;
    }

    const contents = buildConversationContents({
        messageHistory,
        userMessage,
        maxHistoryMessages: MAX_HISTORY_MESSAGES,
        clampText,
    });

    const getRemainingBudget = () =>
        FUNCTION_TOTAL_TIMEOUT_MS - (Date.now() - requestStartedAt);

    if (canUseContextCache && !cachedContentName) {
        const {
            warmupMinChars,
            autoCreateEnabled,
            ttlSeconds,
            createTimeoutMs,
        } = getGeminiContextCacheConfig();
        const hasEnoughBudgetForCacheCreate = getRemainingBudget() > FUNCTION_TIMEOUT_GUARD_MS + 3000;
        const isFirstTurn = !Array.isArray(messageHistory) || messageHistory.length === 0;
        const shouldCreateInline =
            autoCreateEnabled &&
            hasEnoughBudgetForCacheCreate &&
            isFirstTurn &&
            trimmedSystemPrompt.length >= warmupMinChars;

        if (shouldCreateInline) {
            const createdCache = await createPromptCacheEntry({
                apiKey,
                modelName,
                characterId: normalizedCharacterId,
                systemPrompt: clampedSystemPrompt,
                cacheKey: promptCacheKey,
                ttlSeconds,
                createTimeoutMs,
            });

            if (createdCache?.name) {
                cachedContentName = createdCache.name;
                await setPromptCacheWithAdapter({
                    promptCacheAdapter,
                    cacheKey: promptCacheKey,
                    entry: createdCache,
                    logMeta,
                });
            }
        }
    }

    let geminiResponse;
    let geminiData;
    let lastModelError = null;

    const primaryTimeoutMs = Math.min(
        MODEL_TIMEOUT_MS,
        Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
    );

    if (primaryTimeoutMs <= 0) {
        lastModelError = {
            status: 504,
            message: 'Function timeout budget exceeded before model response.',
            code: 'FUNCTION_BUDGET_TIMEOUT',
        };
    } else {
        let primaryResult = await callGeminiWithTimeout({
            apiKey,
            modelName,
            payload: buildGeminiRequestPayload({
                requestContents: contents,
                outputTokens: PRIMARY_MAX_OUTPUT_TOKENS,
                thinkingLevel: GEMINI_THINKING_LEVEL,
                responseSchema: JSON_RESPONSE_SCHEMA,
                cachedContentName,
                systemPromptText: cachedContentName ? '' : clampedSystemPrompt,
            }),
            timeoutMs: primaryTimeoutMs,
        });

        if (
            !primaryResult.ok &&
            primaryResult.error?.code === 'UPSTREAM_MODEL_ERROR' &&
            cachedContentName &&
            cacheLookupRetryEnabled &&
            isCacheLookupErrorMessage(primaryResult.error?.message)
        ) {
            logServerWarn('[V-MATE] Cached content lookup failed, retrying without cache', {
                ...logMeta,
                errorCode: primaryResult.error?.code || null,
                errorStatus: primaryResult.error?.status || null,
                errorMessage: primaryResult.error?.message || null,
                hadCachedContent: Boolean(cachedContentName),
            });
            await removePromptCacheWithAdapter({
                promptCacheAdapter,
                cacheKey: promptCacheKey,
                logMeta,
            });
            cachedContentName = null;

            const cacheResetRetryTimeoutMs = Math.min(
                MODEL_TIMEOUT_MS,
                Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
            );

            if (cacheResetRetryTimeoutMs > 0) {
                primaryResult = await callGeminiWithTimeout({
                    apiKey,
                    modelName,
                    payload: buildGeminiRequestPayload({
                        requestContents: contents,
                        outputTokens: PRIMARY_MAX_OUTPUT_TOKENS,
                        thinkingLevel: GEMINI_THINKING_LEVEL,
                        responseSchema: JSON_RESPONSE_SCHEMA,
                        cachedContentName,
                        useCachedContent: false,
                        systemPromptText: clampedSystemPrompt,
                    }),
                    timeoutMs: cacheResetRetryTimeoutMs,
                });
            }
        }

        if (primaryResult.ok) {
            geminiResponse = primaryResult.response;
            geminiData = primaryResult.data;
            lastModelError = null;
        } else {
            lastModelError = primaryResult.error;
            logServerWarn('[V-MATE] Primary Gemini call failed', {
                ...logMeta,
                errorCode: lastModelError?.code || null,
                errorStatus: lastModelError?.status || null,
                errorMessage: lastModelError?.message || null,
                hadCachedContent: Boolean(cachedContentName),
                networkRecoveryRetryEnabled,
            });

            const shouldRunRecoveryAttempt =
                networkRecoveryRetryEnabled &&
                (
                    lastModelError?.code === 'UPSTREAM_TIMEOUT' ||
                    lastModelError?.code === 'UPSTREAM_CONNECTION_FAILED'
                );

            if (shouldRunRecoveryAttempt) {
                const recoveryTimeoutMs = Math.min(
                    7000,
                    Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
                );

                if (recoveryTimeoutMs > 0) {
                    const minimalSystemPrompt = clampedSystemPrompt.slice(
                        0,
                        Math.min(MAX_SYSTEM_PROMPT_CHARS, 900)
                    );
                    const minimalContents = [
                        {
                            role: 'user',
                            parts: [{ text: clampText(userMessage) }],
                        },
                    ];

                    const recoveryResult = await callGeminiWithTimeout({
                        apiKey,
                        modelName,
                        payload: buildGeminiRequestPayload({
                            requestContents: minimalContents,
                            outputTokens: 220,
                            thinkingLevel: GEMINI_THINKING_LEVEL,
                            responseSchema: JSON_RESPONSE_SCHEMA,
                            cachedContentName,
                            useCachedContent: false,
                            systemPromptText: minimalSystemPrompt,
                        }),
                        timeoutMs: recoveryTimeoutMs,
                    });

                    if (recoveryResult.ok) {
                        geminiResponse = recoveryResult.response;
                        geminiData = recoveryResult.data;
                        lastModelError = null;
                        logServerWarn('[V-MATE] Gemini recovery attempt succeeded', {
                            ...logMeta,
                            recoveryTimeoutMs,
                        });
                    } else {
                        lastModelError = recoveryResult.error;
                        logServerWarn('[V-MATE] Gemini recovery attempt failed', {
                            ...logMeta,
                            errorCode: lastModelError?.code || null,
                            errorStatus: lastModelError?.status || null,
                            errorMessage: lastModelError?.message || null,
                            recoveryTimeoutMs,
                        });
                    }
                }
            } else if (
                !networkRecoveryRetryEnabled &&
                (lastModelError?.code === 'UPSTREAM_TIMEOUT' ||
                    lastModelError?.code === 'UPSTREAM_CONNECTION_FAILED')
            ) {
                logServerWarn('[V-MATE] Network recovery retry skipped by config', {
                    ...logMeta,
                    errorCode: lastModelError?.code || null,
                });
            }
        }
    }

    if (!geminiResponse || !geminiData) {
        return {
            ok: false,
            error: lastModelError || {
                status: 503,
                code: 'UPSTREAM_UNKNOWN_ERROR',
                message: 'Model call failed. Please try again later.',
            },
            retryable: NETWORK_RETRYABLE_ERROR_CODES.has(lastModelError?.code || ''),
            promptCacheKey,
            cachedContentName,
            canUseContextCache,
            geminiResponse: null,
            geminiData: null,
        };
    }

    let modelText = extractGeminiResponseText(geminiData);
    if (!modelText) {
        logServerWarn('[V-MATE] Empty Gemini response text', {
            ...logMeta,
            finishReason: geminiData?.candidates?.[0]?.finishReason || null,
            promptBlockReason: geminiData?.promptFeedback?.blockReason || null,
            emptyResponseRetryEnabled,
        });

        if (cachedContentName) {
            await removePromptCacheWithAdapter({
                promptCacheAdapter,
                cacheKey: promptCacheKey,
                logMeta,
            });
            cachedContentName = null;
        }

        const emptyRecoveryTimeoutMs = Math.min(
            5000,
            Math.max(0, getRemainingBudget() - FUNCTION_TIMEOUT_GUARD_MS)
        );

        if (emptyResponseRetryEnabled && emptyRecoveryTimeoutMs > 0) {
            const minimalSystemPrompt = clampedSystemPrompt.slice(
                0,
                Math.min(MAX_SYSTEM_PROMPT_CHARS, 700)
            );
            const emptyRecoveryContents = [{
                role: 'user',
                parts: [{ text: clampText(userMessage) }],
            }];

            const emptyRecoveryResult = await callGeminiWithTimeout({
                apiKey,
                modelName,
                payload: buildGeminiRequestPayload({
                    requestContents: emptyRecoveryContents,
                    outputTokens: 180,
                    thinkingLevel: GEMINI_THINKING_LEVEL,
                    responseSchema: JSON_RESPONSE_SCHEMA,
                    cachedContentName,
                    useCachedContent: false,
                    useJsonMimeType: true,
                    systemPromptText: minimalSystemPrompt,
                }),
                timeoutMs: emptyRecoveryTimeoutMs,
            });

            if (emptyRecoveryResult.ok) {
                const recoveredText = extractGeminiResponseText(emptyRecoveryResult.data);
                if (recoveredText) {
                    geminiResponse = emptyRecoveryResult.response;
                    geminiData = emptyRecoveryResult.data;
                    modelText = recoveredText;
                    logServerWarn('[V-MATE] Empty-response recovery attempt succeeded', {
                        ...logMeta,
                        emptyRecoveryTimeoutMs,
                    });
                } else {
                    logServerWarn('[V-MATE] Empty recovery response text after retry', {
                        ...logMeta,
                        finishReason: emptyRecoveryResult.data?.candidates?.[0]?.finishReason || null,
                        promptBlockReason: emptyRecoveryResult.data?.promptFeedback?.blockReason || null,
                    });
                }
            }
        } else if (!emptyResponseRetryEnabled) {
            logServerWarn('[V-MATE] Empty-response recovery retry skipped by config', {
                ...logMeta,
            });
        }
    }

    if (!modelText) {
        const finishReason = geminiData?.candidates?.[0]?.finishReason || null;
        return {
            ok: false,
            error: {
                status: 502,
                code:
                    finishReason === 'MAX_TOKENS'
                        ? 'UPSTREAM_EMPTY_RESPONSE_MAX_TOKENS'
                        : 'UPSTREAM_EMPTY_RESPONSE',
                message: 'Gemini returned an empty response. Please retry.',
            },
            retryable: true,
            promptCacheKey,
            cachedContentName,
            canUseContextCache,
            geminiResponse,
            geminiData,
        };
    }

    return {
        ok: true,
        modelText,
        promptCacheKey,
        cachedContentName,
        canUseContextCache,
        geminiResponse,
        geminiData,
    };
};
